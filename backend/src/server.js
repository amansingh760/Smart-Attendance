const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
// import express from "express";
// import path from "path";
// Force HTTPS redirect middleware
app.use((req, res, next) => {
  if (req.headers['x-forwarded-proto'] !== 'https') {
    return res.redirect('https://' + req.headers.host + req.url);
  }
  next();
});

//  const app = express();
// app.use(cors());
// app.use(express.json({ limit: '5mb' })); // face descriptors can be large

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Works both locally (from backend/src/) and on Railway (from repo root)
const FRONTEND_DIST = process.env.FRONTEND_DIST
  || path.join(__dirname, '../../frontend/dist');
app.use(express.static(FRONTEND_DIST));


// // Works both locally (from backend/src/) and on Railway (from repo root)
// const FRONTEND_DIST = process.env.FRONTEND_DIST
//   || path.join(__dirname, '../../frontend/dist');
// app.use(express.static(FRONTEND_DIST));

// const DB_PATH = path.join(__dirname, '../db.json');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../db.json');
const JWT_SECRET = process.env.JWT_SECRET || 'geoattend_secret_2024';


// ── MSG91 SMS helper ───────────────────────────────────────────────────────
// Uses MSG91 REST API — no SDK, no extra npm package required.
// Cheapest trusted SMS provider for India (₹0.18–0.25/SMS, DLT compliant).
//
// Setup:
//  1. Sign up at https://msg91.com
//  2. Complete DLT registration (free, mandatory for Indian numbers)
//  3. Create a transactional SMS template on MSG91 dashboard
//  4. Set env vars in backend/.env
//
// If env vars are not set, SMS is silently skipped — app works without it.

const https = require('https');

async function sendSMS(toNumber, message) {
  const authKey    = process.env.MSG91_AUTH_KEY;
  const senderId   = process.env.MSG91_SENDER_ID   || 'GEOATT';
  const templateId = process.env.MSG91_TEMPLATE_ID;
  const route      = process.env.MSG91_ROUTE        || '4';

  // Silently skip if not configured
  if (!authKey || !toNumber) return;

  // Normalise to 10-digit Indian mobile (MSG91 needs 91XXXXXXXXXX format)
  const digits = toNumber.replace(/\D/g, '');
  let mobile = digits;
  if (digits.length === 10)                           mobile = `91${digits}`;
  else if (digits.length === 12 && digits.startsWith('91')) mobile = digits;
  else if (digits.startsWith('+91') && digits.length === 13) mobile = digits.slice(1);
  else mobile = digits; // pass as-is for non-Indian numbers

  const payload = JSON.stringify({
    sender:   senderId,
    route:    route,
    country:  '91',
    sms: [{
      message:  message,
      to:       [mobile],
      ...(templateId ? { template_id: templateId } : {})
    }]
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.msg91.com',
      path:     '/api/v2/sendsms',
      method:   'POST',
      headers: {
        'authkey':      authKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const r = JSON.parse(data);
          if (r.type === 'success') console.log(`SMS sent to ${mobile}`);
          else console.warn('MSG91 response:', data);
        } catch { console.log('MSG91 raw response:', data); }
        resolve();
      });
    });

    req.on('error', err => {
      // Never crash the app over SMS failure
      console.error('SMS send error:', err.message);
      resolve();
    });

    req.write(payload);
    req.end();
  });
}

// Format Indian phone to 10-digit string (strips +91, country code etc.)
function formatPhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 13 && digits.startsWith('091')) return digits.slice(3);
  return digits.length >= 10 ? digits.slice(-10) : null;
}

// ── DB helpers ────────────────────────────────────────────────────────────────
function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return initDB(); }
}
function writeDB(data) { fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2)); }

function initDB() {
  const data = {
    users: [
      { id: 'admin-1', name: 'Admin User', email: 'admin@geoattend.in', password: bcrypt.hashSync('admin123', 10), role: 'admin', dept: 'Administration', phone: '9000000001', avatar: 'AU', color: '#f6ad55', status: 'active', joinedAt: new Date().toISOString(), blocked: false, faceDescriptor: null },
      { id: 'user-1', name: 'Demo', email: 'Demo@geoattend.in', password: bcrypt.hashSync('demo123', 10), role: 'user', dept: 'Engineering', phone: '9000000002', avatar: 'AS', color: '#63b3ed', status: 'active', joinedAt: new Date().toISOString(), blocked: false, faceDescriptor: null },
    ],
    zones: [{ id: 'zone-1', name: 'Main Office HQ', lat: 25.3176, lng: 82.9739, radius: 200, icon: '🏢', address: 'Varanasi, UP', active: true }],
    records: [],
    holidays: [],
    auditLog: [],
    overrideRequests: [],  // out-of-zone override requests
    settings: {
      emailDomain: '', companyName: 'GeoAttend', timezone: 'Asia/Kolkata',
      workStartTime: '09:00', workEndTime: '18:00', lateGraceMinutes: 15,
      checkInOpenTime: '08:00',   // earliest time employees are allowed to check in
      requireFaceAuth: true,         // require face auth for check-in/out
      allowOutOfZoneRequest: true,   // allow employees to request out-of-zone override
    }
  };
  writeDB(data); return data;
}

// ── Middleware ─────────────────────────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' }); next();
}
function logAudit(db, userId, action, details) {
  db.auditLog.unshift({ id: uuidv4(), userId, action, details, timestamp: new Date().toISOString() });
  if (db.auditLog.length > 500) db.auditLog = db.auditLog.slice(0, 500);
}
function applyDomain(email, domain) {
  if (!domain) return email;
  const local = email.includes('@') ? email.split('@')[0] : email;
  return `${local}@${domain}`;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const db = readDB();
  const user = db.users.find(u => u.email === email);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Invalid credentials' });
  if (user.blocked) return res.status(403).json({ error: 'Your account has been blocked by admin' });
  const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '24h' });
  const { password: _, faceDescriptor: _f, ...safeUser } = user;
  res.json({ token, user: safeUser });
});
app.get('/api/auth/me', auth, (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { password: _, faceDescriptor: _f, ...safeUser } = user;
  res.json(safeUser);
});

// ── Face Authentication ───────────────────────────────────────────────────────
// Enroll: store face descriptor for user
app.post('/api/face/enroll', auth, (req, res) => {
  const { descriptor } = req.body; // Float32Array serialised as plain Array
  if (!descriptor || !Array.isArray(descriptor))
    return res.status(400).json({ error: 'descriptor required' });
  const db = readDB();
  const idx = db.users.findIndex(u => u.id === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  db.users[idx].faceDescriptor = descriptor;
  logAudit(db, req.user.id, 'FACE_ENROLL', `Face enrolled for ${db.users[idx].name}`);
  writeDB(db);
  res.json({ success: true, message: 'Face enrolled successfully' });
});

// Check if user has face enrolled
app.get('/api/face/status', auth, (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.user.id);
  res.json({ enrolled: !!(user?.faceDescriptor) });
});

// Verify: compare submitted descriptor with stored — Euclidean distance
app.post('/api/face/verify', auth, (req, res) => {
  const { descriptor } = req.body;
  if (!descriptor || !Array.isArray(descriptor))
    return res.status(400).json({ error: 'descriptor required' });
  const db = readDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user?.faceDescriptor)
    return res.status(400).json({ error: 'No face enrolled. Please enroll your face first.' });
  // Euclidean distance between descriptors (face-api standard threshold: 0.6)
  const stored = user.faceDescriptor;
  let dist = 0;
  for (let i = 0; i < stored.length; i++) dist += (stored[i] - descriptor[i]) ** 2;
  dist = Math.sqrt(dist);
  const threshold = 0.6;
  if (dist > threshold) return res.status(401).json({ error: `Face not recognised (distance: ${dist.toFixed(3)}). Please try again.`, distance: dist });
  res.json({ success: true, distance: dist });
});

// Admin can enroll face for any user (for kiosk / HR setup)
app.post('/api/face/enroll/:userId', auth, adminOnly, (req, res) => {
  const { descriptor } = req.body;
  if (!descriptor || !Array.isArray(descriptor)) return res.status(400).json({ error: 'descriptor required' });
  const db = readDB();
  const idx = db.users.findIndex(u => u.id === req.params.userId);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  db.users[idx].faceDescriptor = descriptor;
  logAudit(db, req.user.id, 'FACE_ENROLL_ADMIN', `Admin enrolled face for ${db.users[idx].name}`);
  writeDB(db);
  res.json({ success: true });
});

app.delete('/api/face/enroll/:userId', auth, adminOnly, (req, res) => {
  const db = readDB();
  const idx = db.users.findIndex(u => u.id === req.params.userId);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  db.users[idx].faceDescriptor = null;
  logAudit(db, req.user.id, 'FACE_REMOVE', `Removed face for ${db.users[idx].name}`);
  writeDB(db); res.json({ success: true });
});

// ── Settings ──────────────────────────────────────────────────────────────────
app.get('/api/settings', auth, (req, res) => { const db = readDB(); res.json(db.settings || {}); });
app.put('/api/settings', auth, adminOnly, (req, res) => {
  const db = readDB();
  if (!db.settings) db.settings = {};
  if (req.body.emailDomain !== undefined)
    req.body.emailDomain = req.body.emailDomain.replace(/^@/, '').toLowerCase().trim();
  db.settings = { ...db.settings, ...req.body };
  logAudit(db, req.user.id, 'UPDATE_SETTINGS', 'Updated system settings');
  writeDB(db); res.json(db.settings);
});

// ── Users ─────────────────────────────────────────────────────────────────────
app.get('/api/users', auth, adminOnly, (req, res) => {
  const db = readDB();
  res.json(db.users.map(({ password: _, faceDescriptor, ...u }) => ({ ...u, faceEnrolled: !!faceDescriptor })));
});
app.post('/api/users', auth, adminOnly, (req, res) => {
  const { name, password, role, dept, phone, color } = req.body;
  let { email } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing required fields' });
  const db = readDB();
  email = applyDomain(email, db.settings?.emailDomain);
  if (db.users.find(u => u.email === email)) return res.status(400).json({ error: 'Email already exists' });
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const newUser = { id: uuidv4(), name, email, password: bcrypt.hashSync(password, 10), role: role || 'user', dept: dept || 'General', phone: phone || '', avatar: initials, color: color || '#63b3ed', status: 'active', joinedAt: new Date().toISOString(), blocked: false, faceDescriptor: null };
  db.users.push(newUser);
  logAudit(db, req.user.id, 'CREATE_USER', `Created user ${name} (${email})`);
  writeDB(db);
  const { password: _, faceDescriptor: _f, ...safeUser } = newUser;
  res.status(201).json(safeUser);
});
app.put('/api/users/:id', auth, adminOnly, (req, res) => {
  const db = readDB();
  const idx = db.users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  const { password, faceDescriptor, ...updates } = req.body;
  if (updates.email) updates.email = applyDomain(updates.email, db.settings?.emailDomain);
  if (password) updates.password = bcrypt.hashSync(password, 10);
  if (updates.name) updates.avatar = updates.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  db.users[idx] = { ...db.users[idx], ...updates };
  logAudit(db, req.user.id, 'UPDATE_USER', `Updated user ${db.users[idx].name}`);
  writeDB(db);
  const { password: _, faceDescriptor: _f, ...safeUser } = db.users[idx];
  res.json(safeUser);
});
app.post('/api/users/:id/block', auth, adminOnly, (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role === 'admin') return res.status(400).json({ error: 'Cannot block admin' });
  user.blocked = !user.blocked;
  logAudit(db, req.user.id, user.blocked ? 'BLOCK_USER' : 'UNBLOCK_USER', `${user.blocked ? 'Blocked' : 'Unblocked'} ${user.name}`);
  writeDB(db); res.json({ blocked: user.blocked, message: `User ${user.blocked ? 'blocked' : 'unblocked'} successfully` });
});
app.delete('/api/users/:id', auth, adminOnly, (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role === 'admin') return res.status(400).json({ error: 'Cannot delete admin' });
  db.users = db.users.filter(u => u.id !== req.params.id);
  logAudit(db, req.user.id, 'DELETE_USER', `Deleted user ${user.name}`);
  writeDB(db); res.json({ success: true });
});

// ── Zones ─────────────────────────────────────────────────────────────────────
app.get('/api/zones', auth, (req, res) => { const db = readDB(); res.json(db.zones); });
app.post('/api/zones', auth, adminOnly, (req, res) => {
  const { name, lat, lng, radius, icon, address } = req.body;
  if (!name || !lat || !lng || !radius) return res.status(400).json({ error: 'Missing fields' });
  const db = readDB();
  const zone = { id: uuidv4(), name, lat: parseFloat(lat), lng: parseFloat(lng), radius: parseInt(radius), icon: icon || '📍', address: address || '', active: true };
  db.zones.push(zone); logAudit(db, req.user.id, 'CREATE_ZONE', `Created zone ${name}`);
  writeDB(db); res.status(201).json(zone);
});
app.put('/api/zones/:id', auth, adminOnly, (req, res) => {
  const db = readDB(); const idx = db.zones.findIndex(z => z.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Zone not found' });
  db.zones[idx] = { ...db.zones[idx], ...req.body };
  logAudit(db, req.user.id, 'UPDATE_ZONE', `Updated zone ${db.zones[idx].name}`);
  writeDB(db); res.json(db.zones[idx]);
});
app.delete('/api/zones/:id', auth, adminOnly, (req, res) => {
  const db = readDB(); const zone = db.zones.find(z => z.id === req.params.id);
  if (!zone) return res.status(404).json({ error: 'Zone not found' });
  db.zones = db.zones.filter(z => z.id !== req.params.id);
  logAudit(db, req.user.id, 'DELETE_ZONE', `Deleted zone ${zone.name}`); writeDB(db); res.json({ success: true });
});

// ── Holidays ──────────────────────────────────────────────────────────────────
app.get('/api/holidays', auth, (req, res) => { const db = readDB(); res.json(db.holidays); });
app.post('/api/holidays', auth, adminOnly, (req, res) => {
  const { name, date, type, description } = req.body;
  if (!name || !date) return res.status(400).json({ error: 'Missing fields' });
  const db = readDB();
  if (db.holidays.find(h => h.date === date)) return res.status(400).json({ error: 'Holiday already exists for this date' });
  const holiday = { id: uuidv4(), name, date, type: type || 'public', description: description || '', createdBy: req.user.id, createdAt: new Date().toISOString() };
  db.holidays.push(holiday); logAudit(db, req.user.id, 'CREATE_HOLIDAY', `Marked ${date} as holiday: ${name}`);
  writeDB(db); res.status(201).json(holiday);
});
app.delete('/api/holidays/:id', auth, adminOnly, (req, res) => {
  const db = readDB(); const h = db.holidays.find(h => h.id === req.params.id);
  if (!h) return res.status(404).json({ error: 'Holiday not found' });
  db.holidays = db.holidays.filter(h => h.id !== req.params.id);
  logAudit(db, req.user.id, 'DELETE_HOLIDAY', `Removed holiday ${h.name} on ${h.date}`); writeDB(db); res.json({ success: true });
});

// ── Attendance ────────────────────────────────────────────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function isLateCheckIn(db, checkInISO) {
  const settings = db.settings || {};
  const [sh, sm] = (settings.workStartTime || '09:00').split(':').map(Number);
  const grace = parseInt(settings.lateGraceMinutes || 15);
  if (!checkInISO) return false;
  // Use Date object so UTC strings are converted to local time correctly
  const d = new Date(checkInISO);
  const ciMins = d.getHours() * 60 + d.getMinutes();
  return ciMins > (sh * 60 + sm + grace);
}

// GPS-based check-in — supports multiple sessions per day
app.post('/api/attendance/checkin', auth, (req, res) => {
  const { lat, lng, zoneId, faceVerified, lateReason } = req.body;
  const db = readDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user || user.blocked) return res.status(403).json({ error: 'Account is blocked' });
  const today = new Date().toISOString().split('T')[0];
  if (db.holidays.find(h => h.date === today))
    return res.status(400).json({ error: 'Today is a holiday. Attendance not required.' });

  const zone = db.zones.find(z => z.id === zoneId);
  if (!zone) return res.status(404).json({ error: 'Zone not found' });
  const distance = haversine(lat, lng, zone.lat, zone.lng);
  if (distance > zone.radius)
    return res.status(400).json({ error: `Outside geofence. You are ${Math.round(distance)}m away (max ${zone.radius}m)` });

  // Check-in window
  const openTime = db.settings?.checkInOpenTime;
  if (openTime) {
    const now_ = new Date();
    const nowMins = now_.getHours() * 60 + now_.getMinutes();
    const [oh, om] = openTime.split(':').map(Number);
    if (nowMins < oh * 60 + om)
      return res.status(400).json({ error: `Check-in not allowed before ${openTime}.`, code: 'BEFORE_OPEN_TIME' });
  }

  if (db.settings?.requireFaceAuth && user.faceDescriptor && !faceVerified)
    return res.status(403).json({ error: 'Face authentication required', code: 'FACE_REQUIRED' });

  const now = new Date().toISOString();
  const late = isLateCheckIn(db, now);

  const existing = db.records.find(r => r.userId === req.user.id && r.date === today);

  if (existing) {
    // Block if last session is still open (not checked out yet)
    const sessions = existing.sessions || [];
    const lastSession = sessions[sessions.length - 1];
    if (lastSession && !lastSession.checkOut)
      return res.status(400).json({ error: 'Please check out before checking in again.' });

    // Add new session
    const newSession = {
      sessionId: uuidv4(), checkIn: now, checkOut: null,
      zoneId, zoneName: zone.name, lat, lng,
      faceVerified: !!faceVerified, lateReason: lateReason || '',
      method: 'geofence'
    };
    existing.sessions = [...sessions, newSession];
    // Keep root checkIn as first session's time for backward compat
    if (!existing.checkIn) existing.checkIn = now;
    existing.status = late ? 'late' : 'present';
    if (late && lateReason) existing.lateReason = lateReason;
  } else {
    // First check-in of the day — create record with first session
    const newSession = {
      sessionId: uuidv4(), checkIn: now, checkOut: null,
      zoneId, zoneName: zone.name, lat, lng,
      faceVerified: !!faceVerified, lateReason: lateReason || '',
      method: 'geofence'
    };
    db.records.unshift({
      id: uuidv4(), userId: req.user.id, userName: user.name, dept: user.dept,
      zoneId, zoneName: zone.name, date: today,
      checkIn: now, checkOut: null,
      sessions: [newSession],
      status: late ? 'late' : 'present',
      lat, lng, method: 'geofence',
      note: lateReason ? `Late reason: ${lateReason}` : '',
      editedBy: null, faceVerified: !!faceVerified, lateReason: lateReason || ''
    });
  }

  writeDB(db);

  // SMS — GPS check-in only
  const tz = db.settings?.timezone || 'Asia/Kolkata';
  const ciTimeStr = new Date(now).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: tz });
  const existingNow = db.records.find(r => r.userId === req.user.id && r.date === today);
  const sessionNum = existingNow?.sessions?.length || 1;
  const smsText = late
    ? `${db.settings?.companyName || 'GeoAttend'}: Dear ${user.name}, you checked IN at ${ciTimeStr} (LATE) at ${zone.name}. Reason: ${lateReason || 'Not provided'}.`
    : `${db.settings?.companyName || 'GeoAttend'}: Dear ${user.name}, you checked IN at ${ciTimeStr} at ${zone.name}${sessionNum > 1 ? ` (session ${sessionNum})` : ''}.`;
  sendSMS(formatPhone(user.phone), smsText);

  res.json({ success: true, checkIn: now, zoneName: zone.name, late, status: late ? 'late' : 'present', sessionNumber: sessionNum });
});

// GPS-based check-out — closes the latest open session
app.post('/api/attendance/checkout', auth, (req, res) => {
  const { lat, lng, zoneId, faceVerified } = req.body;
  const db = readDB();
  const today = new Date().toISOString().split('T')[0];
  const rec = db.records.find(r => r.userId === req.user.id && r.date === today);
  if (!rec) return res.status(400).json({ error: 'No check-in found for today.' });

  // Find the last open session
  const sessions = rec.sessions || [];
  const openSession = [...sessions].reverse().find(s => s.checkIn && !s.checkOut);
  if (!openSession) return res.status(400).json({ error: 'No active check-in found. Please check in first.' });

  const user = db.users.find(u => u.id === req.user.id);
  if (db.settings?.requireFaceAuth && user?.faceDescriptor && !faceVerified)
    return res.status(403).json({ error: 'Face authentication required', code: 'FACE_REQUIRED' });

  const zone = db.zones.find(z => z.id === (zoneId || openSession.zoneId || rec.zoneId));
  if (zone && haversine(lat, lng, zone.lat, zone.lng) > zone.radius)
    return res.status(400).json({ error: 'Outside geofence zone' });

  const now = new Date().toISOString();
  openSession.checkOut = now;

  // Update root checkOut to the latest session's checkOut for backward compat
  rec.checkOut = now;

  // Recalculate total worked minutes across all completed sessions
  const totalMins = sessions.reduce((sum, s) => {
    if (!s.checkIn || !s.checkOut) return sum;
    return sum + Math.round((new Date(s.checkOut) - new Date(s.checkIn)) / 60000);
  }, 0);
  rec.totalMins = totalMins;

  writeDB(db);

  // SMS — GPS check-out only
  const tz_ = db.settings?.timezone || 'Asia/Kolkata';
  const coTimeStr = new Date(now).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: tz_ });
  const sessionNum = sessions.length;
  const h = Math.floor(totalMins / 60), m = totalMins % 60;
  const totalStr = totalMins > 0 ? ` Total today: ${h}h ${m}m.` : '';
  if (user) {
    sendSMS(formatPhone(user.phone),
      `${db.settings?.companyName || 'GeoAttend'}: Dear ${user.name}, you checked OUT at ${coTimeStr} from ${rec.zoneName}${sessionNum > 1 ? ` (session ${sessionNum})` : ''}.${totalStr}`);
  }

  res.json({ success: true, checkOut: now, totalMins, sessionNumber: sessionNum });
});

// ── Out-of-zone override request ──────────────────────────────────────────────
app.post('/api/attendance/override-request', auth, (req, res) => {
  const { zoneId, action, reason, faceVerified, lat, lng } = req.body; // action: 'checkin'|'checkout'
  if (!reason) return res.status(400).json({ error: 'Reason is required for out-of-zone request' });
  const db = readDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user || user.blocked) return res.status(403).json({ error: 'Account is blocked' });
  if (!db.settings?.allowOutOfZoneRequest)
    return res.status(403).json({ error: 'Out-of-zone requests are disabled by admin' });
  if (user.faceDescriptor && !faceVerified)
    return res.status(403).json({ error: 'Face authentication required for out-of-zone request', code: 'FACE_REQUIRED' });
  const today = new Date().toISOString().split('T')[0];
  // Check not already requested today for same action
  const existing = (db.overrideRequests || []).find(r => r.userId === user.id && r.date === today && r.action === action && r.status === 'pending');
  if (existing) return res.status(400).json({ error: 'Override request already pending for today' });
  const req_ = {
    id: uuidv4(), userId: user.id, userName: user.name, dept: user.dept,
    avatar: user.avatar, color: user.color,
    zoneId, zoneName: db.zones.find(z => z.id === zoneId)?.name || 'Unknown',
    action, reason, lat: lat || null, lng: lng || null,
    date: today, requestedAt: new Date().toISOString(),
    status: 'pending', reviewedBy: null, reviewedAt: null, reviewNote: '',
    faceVerified: !!faceVerified
  };
  if (!db.overrideRequests) db.overrideRequests = [];
  db.overrideRequests.unshift(req_);
  logAudit(db, user.id, 'OVERRIDE_REQUEST', `${user.name} requested out-of-zone ${action} override`);
  writeDB(db);
  res.status(201).json({ success: true, requestId: req_.id, message: 'Request submitted. Waiting for admin approval.' });
});

// Admin: list override requests
app.get('/api/attendance/override-requests', auth, adminOnly, (req, res) => {
  const db = readDB();
  const { status } = req.query;
  let reqs = db.overrideRequests || [];
  if (status) reqs = reqs.filter(r => r.status === status);
  res.json(reqs);
});

// Employee: get own pending override
app.get('/api/attendance/my-override', auth, (req, res) => {
  const db = readDB();
  const today = new Date().toISOString().split('T')[0];
  const reqs = (db.overrideRequests || []).filter(r => r.userId === req.user.id && r.date === today);
  res.json(reqs);
});

// Admin: approve or deny override
app.post('/api/attendance/override-requests/:id/review', auth, adminOnly, (req, res) => {
  const { decision, note } = req.body; // decision: 'approved'|'denied'
  const db = readDB();
  const ov = (db.overrideRequests || []).find(r => r.id === req.params.id);
  if (!ov) return res.status(404).json({ error: 'Request not found' });
  if (ov.status !== 'pending') return res.status(400).json({ error: 'Request already reviewed' });
  ov.status = decision;
  ov.reviewedBy = req.user.id;
  ov.reviewedAt = new Date().toISOString();
  ov.reviewNote = note || '';

  if (decision === 'approved') {
    // Auto-create attendance record on approval
    const user = db.users.find(u => u.id === ov.userId);
    const zone = db.zones.find(z => z.id === ov.zoneId);
    const now = new Date().toISOString();
    const existing = db.records.find(r => r.userId === ov.userId && r.date === ov.date);

    if (ov.action === 'checkin') {
      const late = isLateCheckIn(db, ov.requestedAt);
      if (existing) {
        existing.checkIn = ov.requestedAt;
        existing.status = late ? 'late' : 'present';
        existing.method = 'override';
        existing.note = `Out-of-zone override approved. Reason: ${ov.reason}`;
        existing.faceVerified = ov.faceVerified;
      } else {
        db.records.unshift({
          id: uuidv4(), userId: ov.userId, userName: ov.userName, dept: ov.dept,
          zoneId: ov.zoneId, zoneName: ov.zoneName, date: ov.date,
          checkIn: ov.requestedAt, checkOut: null,
          status: late ? 'late' : 'present', lat: ov.lat, lng: ov.lng,
          method: 'override', note: `Out-of-zone override. Reason: ${ov.reason}`,
          editedBy: req.user.id, faceVerified: ov.faceVerified, lateReason: ''
        });
      }
    } else if (ov.action === 'checkout') {
      if (existing && existing.checkIn && !existing.checkOut) {
        existing.checkOut = ov.requestedAt;
        existing.note += ` | Checkout override approved.`;
      }
    }
    logAudit(db, req.user.id, 'OVERRIDE_APPROVED', `Approved override for ${ov.userName} on ${ov.date}`);
    
    // SMS — override is GPS-equivalent (employee was physically present), so notify
    const ovUser = db.users.find(u => u.id === ov.userId);
    if (ovUser) {
      const ovTz = db.settings?.timezone || 'Asia/Kolkata';
      const ovTimeStr = new Date(ov.requestedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: ovTz });
      const ovSms = ov.action === 'checkin'
        ? `${db.settings?.companyName || 'GeoAttend'}: Dear ${ov.userName}, your out-of-zone check-IN at ${ovTimeStr} on ${ov.date} has been approved by admin.`
        : `${db.settings?.companyName || 'GeoAttend'}: Dear ${ov.userName}, your out-of-zone check-OUT at ${ovTimeStr} on ${ov.date} has been approved by admin.`;
      sendSMS(formatPhone(ovUser.phone), ovSms);
    }

  } else {
    logAudit(db, req.user.id, 'OVERRIDE_DENIED', `Denied override for ${ov.userName}: ${note}`);
  }
  writeDB(db);
  res.json({ success: true, status: ov.status });
});

// ── List attendance ──────────────────────────────────────────────────────────
app.get('/api/attendance', auth, (req, res) => {
  const db = readDB();
  const { userId, date, from, to } = req.query;
  let records = db.records;

  if (req.user.role !== 'admin') {
    // Staff: only own records
    records = records.filter(r => r.userId === req.user.id);
    if (userId) records = records.filter(r => r.userId === userId);
    if (date)   records = records.filter(r => r.date === date);
    if (from)   records = records.filter(r => r.date >= from);
    if (to)     records = records.filter(r => r.date <= to);
    return res.json(records.slice(0, 200));
  }

  // Admin filters
  if (userId) records = records.filter(r => r.userId === userId);
  if (date)   records = records.filter(r => r.date === date);
  if (from)   records = records.filter(r => r.date >= from);
  if (to)     records = records.filter(r => r.date <= to);

  // When filtering by a specific date, inject virtual absent records
  // for every staff member who has no record for that day
  if (date && !userId) {
    const isHoliday = (db.holidays || []).some(h => h.date === date);
    const isSunday  = new Date(date + 'T00:00:00').getDay() === 0;

    if (!isHoliday && !isSunday) {
      const staff = db.users.filter(u => u.role !== 'admin' && !u.blocked);
      const presentIds = new Set(records.map(r => r.userId));

      staff.forEach(u => {
        if (!presentIds.has(u.id)) {
          records = [
            ...records,
            {
              id:        `virtual-absent-${u.id}-${date}`,
              userId:    u.id,
              userName:  u.name,
              dept:      u.dept,
              avatar:    u.avatar,
              color:     u.color,
              zoneId:    null,
              zoneName:  '—',
              date,
              checkIn:   null,
              checkOut:  null,
              status:    'absent',
              lat:       null,
              lng:       null,
              method:    'auto',
              note:      '',
              lateReason:'',
              editedBy:  null,
              virtual:   false  // flag so frontend knows it's not a real DB record make it true if want false record
            }
          ];
        }
      });
    }
  }

  res.json(records.slice(0, 200));
});

// Edit single record (admin)
app.put('/api/attendance/:id', auth, adminOnly, (req, res) => {
  const db = readDB();
  const idx = db.records.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Record not found' });
  const rec = db.records[idx];
  const { status, checkInTime, checkOutTime, date, zoneId, zoneName, note } = req.body;
  const targetDate = date || rec.date;
  let newCheckIn = rec.checkIn, newCheckOut = rec.checkOut;
  if (status === 'absent') { newCheckIn = null; newCheckOut = null; }
  else {
    if (checkInTime) newCheckIn = `${targetDate}T${checkInTime}:00`;
    if (checkOutTime) newCheckOut = `${targetDate}T${checkOutTime}:00`;
    else newCheckOut = rec.checkOut;
  }
  db.records[idx] = { ...rec, date: targetDate, status: status || rec.status, checkIn: newCheckIn, checkOut: newCheckOut, zoneId: zoneId || rec.zoneId, zoneName: zoneName || rec.zoneName, note: note !== undefined ? note : rec.note, editedBy: req.user.id, editedAt: new Date().toISOString(), method: 'manual' };
  logAudit(db, req.user.id, 'EDIT_ATTENDANCE', `Edited record for ${rec.userName} on ${targetDate} → ${status}`);
  writeDB(db); res.json(db.records[idx]);
});

// Delete single record (admin)
app.delete('/api/attendance/:id', auth, adminOnly, (req, res) => {
  const db = readDB();
  const rec = db.records.find(r => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: 'Record not found' });
  db.records = db.records.filter(r => r.id !== req.params.id);
  logAudit(db, req.user.id, 'DELETE_ATTENDANCE', `Deleted attendance for ${rec.userName} on ${rec.date}`);
  writeDB(db); res.json({ success: true });
});
// Bulk update (admin) — single day
app.post('/api/attendance/bulk', auth, adminOnly, (req, res) => {
  const { date, status, userIds, note } = req.body;
  const db = readDB();
  const startTime = db.settings?.workStartTime || '09:00';
  const endTime   = db.settings?.workEndTime   || '18:00';

  userIds.forEach(uid => {
    const existing = db.records.find(r => r.userId === uid && r.date === date);
    const user = db.users.find(u => u.id === uid);
    if (existing) {
      existing.status   = status;
      existing.note     = note || '';
      existing.editedBy = req.user.id;
      existing.method   = 'manual';
      if (status === 'absent') {
        existing.checkIn  = null;
        existing.checkOut = null;
      } else {
        // Set times from settings if not already present
        if (!existing.checkIn)  existing.checkIn  = `${date}T${startTime}:00`;
        if (!existing.checkOut) existing.checkOut = status === 'present' ? `${date}T${endTime}:00` : null;
      }
    } else if (user) {
      db.records.unshift({
        id: uuidv4(), userId: uid, userName: user.name, dept: user.dept,
        zoneId: null, zoneName: 'N/A', date,
        checkIn:  status !== 'absent' ? `${date}T${startTime}:00` : null,
        checkOut: status === 'present' ? `${date}T${endTime}:00`  : null,
        status, lat: null, lng: null, method: 'manual',
        note: note || '', editedBy: req.user.id
      });
    }
  });
  logAudit(db, req.user.id, 'BULK_ATTENDANCE', `Bulk marked ${userIds.length} users as ${status} on ${date}`);
  writeDB(db); res.json({ success: true });
});

// Bulk mark for a date range
app.post('/api/attendance/bulk-range', auth, adminOnly, (req, res) => {
  const { fromDate, toDate, status, userIds, note, skipHolidays, skipSundays } = req.body;
  if (!fromDate || !toDate || !status || !userIds?.length)
    return res.status(400).json({ error: 'fromDate, toDate, status and userIds required' });
  const db = readDB();
  const startTime  = db.settings?.workStartTime || '09:00';
  const endTime    = db.settings?.workEndTime   || '18:00';
  const holidaySet = new Set(db.holidays.map(h => h.date));
  let count = 0;

  const from = new Date(fromDate + 'T00:00:00');
  const to   = new Date(toDate   + 'T00:00:00');
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const dow = d.getDay();
    if (skipSundays  && dow === 0)              continue;
    if (skipHolidays && holidaySet.has(dateStr)) continue;

    userIds.forEach(uid => {
      const user = db.users.find(u => u.id === uid);
      if (!user) return;
      const existing = db.records.find(r => r.userId === uid && r.date === dateStr);
      if (existing) {
        existing.status   = status;
        existing.note     = note || '';
        existing.editedBy = req.user.id;
        existing.method   = 'manual';
        if (status === 'absent') {
          existing.checkIn  = null;
          existing.checkOut = null;
        } else {
          if (!existing.checkIn)  existing.checkIn  = `${dateStr}T${startTime}:00`;
          if (!existing.checkOut) existing.checkOut = status === 'present' ? `${dateStr}T${endTime}:00` : null;
        }
      } else {
        db.records.unshift({
          id: uuidv4(), userId: uid, userName: user.name, dept: user.dept,
          zoneId: null, zoneName: 'N/A', date: dateStr,
          checkIn:  status !== 'absent' ? `${dateStr}T${startTime}:00` : null,
          checkOut: status === 'present' ? `${dateStr}T${endTime}:00`  : null,
          status, lat: null, lng: null, method: 'manual',
          note: note || '', editedBy: req.user.id
        });
      }
      count++;
    });
  }
  logAudit(db, req.user.id, 'BULK_RANGE_ATTENDANCE', `Bulk range: ${userIds.length} users, ${fromDate}→${toDate}, status=${status}, ${count} records`);
  writeDB(db); res.json({ success: true, count });
});

// ── Audit ─────────────────────────────────────────────────────────────────────
app.get('/api/audit', auth, adminOnly, (req, res) => {
  const db = readDB(); res.json(db.auditLog.slice(0, 200));
});

// ── Stats ─────────────────────────────────────────────────────────────────────
app.get('/api/stats', auth, adminOnly, (req, res) => {
  const db = readDB();
  const today = new Date().toISOString().split('T')[0];
  const staff = db.users.filter(u => u.role !== 'admin');
  const todayRecs = db.records.filter(r => r.date === today);
  const presentToday = todayRecs.filter(r => r.status === 'present').length;
  const lateToday    = todayRecs.filter(r => r.status === 'late').length;
  const last30Start = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const avgRate = staff.length ? Math.round((db.records.filter(r => r.date >= last30Start && r.status === 'present').length / (staff.length * 30)) * 100) : 0;
  const pendingOverrides = (db.overrideRequests || []).filter(r => r.status === 'pending').length;
  res.json({
    totalStaff: staff.length, presentToday, lateToday, absentToday: staff.length - presentToday - lateToday,
    activeZones: db.zones.filter(z => z.active).length, avgAttendance: avgRate,
    blockedUsers: staff.filter(u => u.blocked).length,
    holidaysThisMonth: db.holidays.filter(h => h.date.startsWith(today.slice(0, 7))).length,
    pendingOverrides
  });
});

// ── Monthly Report ────────────────────────────────────────────────────────────
app.get('/api/attendance/monthly-report', auth, adminOnly, (req, res) => {
  const { month } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month param required in YYYY-MM format' });
  const db = readDB();
  const settings = db.settings || {};
  const workStart = settings.workStartTime || '09:00';
  const lateGrace = parseInt(settings.lateGraceMinutes || 15);
  const [year, mon] = month.split('-').map(Number);
  const daysInMonth = new Date(year, mon, 0).getDate();
  const monthHolidays = new Set(db.holidays.filter(h => h.date.startsWith(month)).map(h => h.date));
  const allDays = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${month}-${String(d).padStart(2, '0')}`;
    const dow = new Date(dateStr + 'T00:00:00').getDay();
    allDays.push({ date: dateStr, isHoliday: monthHolidays.has(dateStr), isSunday: dow === 0, isWorkday: dow !== 0 && !monthHolidays.has(dateStr) });
  }
  const workdays = allDays.filter(d => d.isWorkday).length;
function toMinutes(isoStr) { if (!isoStr) return null; const d = new Date(isoStr); return d.getHours() * 60 + d.getMinutes(); }
  function isLate(checkIn) { if (!checkIn) return false; const ciMins = toMinutes(checkIn); if (ciMins === null) return false; const [sh, sm] = workStart.split(':').map(Number); return ciMins > (sh * 60 + sm + lateGrace); }
  const staff = db.users.filter(u => u.role !== 'admin');
  const fromDate = `${month}-01`, toDate = `${month}-${String(daysInMonth).padStart(2, '0')}`;
  const monthRecords = db.records.filter(r => r.date >= fromDate && r.date <= toDate);
  const employees = staff.map(user => {
    const userRecs = monthRecords.filter(r => r.userId === user.id);
    let presentDays = 0, absentDays = 0, lateDays = 0, totalMins = 0;
    const dailyMap = {};
    userRecs.forEach(r => {
      dailyMap[r.date] = r;
      if (r.status === 'present' || r.status === 'late') {
        presentDays++;
        // Trust the stored status — do not recalculate late from time
        if (r.status === 'late') lateDays++;
        // Sum all completed sessions (supports multiple check-in/out per day)
        if (r.sessions && r.sessions.length > 0) {
          r.sessions.forEach(s => {
            if (s.checkIn && s.checkOut) {
              totalMins += Math.round((new Date(s.checkOut) - new Date(s.checkIn)) / 60000);
            }
          });
        } else {
          // Fallback for old records without sessions array
          const ciMins = toMinutes(r.checkIn), coMins = toMinutes(r.checkOut);
          if (ciMins !== null && coMins !== null && coMins > ciMins) totalMins += coMins - ciMins;
        }
      } else if (r.status === 'absent') { absentDays++; }
    });
    absentDays += allDays.filter(d => d.isWorkday && !dailyMap[d.date]).length;
    const avgMinsPerDay = presentDays > 0 ? Math.round(totalMins / presentDays) : 0;
    const days = allDays.map(d => {
      const rec = dailyMap[d.date];
      let status = 'none';
      if (rec) {
        // Attendance record exists — always use it, even on holidays/Sundays
        status = rec.status;
      } else if (d.isHoliday) {
        status = 'holiday';
      } else if (d.isSunday) {
        status = 'sunday';
      } else if (d.isWorkday) {
        status = 'absent';
      }
      let workMins = 0;
      if (rec) {
        if (rec.sessions && rec.sessions.length > 0) {
          rec.sessions.forEach(s => {
            if (s.checkIn && s.checkOut)
              workMins += Math.round((new Date(s.checkOut) - new Date(s.checkIn)) / 60000);
          });
        } else if (rec.checkIn && rec.checkOut) {
          const ci = toMinutes(rec.checkIn), co = toMinutes(rec.checkOut);
          if (ci !== null && co !== null && co > ci) workMins = co - ci;
        }
      }
      return { date: d.date, status, isHoliday: d.isHoliday, isSunday: d.isSunday,
        checkIn: rec?.checkIn || null, checkOut: rec?.checkOut || null,
        sessions: rec?.sessions || [],
        workMins, late: rec ? rec.status === 'late' : false,
        note: rec?.note || '', lateReason: rec?.lateReason || '', method: rec?.method || '' };
      });
    return { userId: user.id, name: user.name, dept: user.dept, avatar: user.avatar, color: user.color, presentDays, absentDays, lateDays, totalMins, avgMinsPerDay, attendancePct: workdays > 0 ? Math.round((presentDays / workdays) * 100) : 0, workdays, days };
  });
  res.json({ month, workdays, holidays: [...monthHolidays], allDays, employees });
});

// ── Leave Management ──────────────────────────────────────────────────────────
const LEAVE_TYPES = ['casual','sick','earned','maternity','paternity','unpaid','other'];

app.post('/api/leaves', auth, (req, res) => {
  const { type, fromDate, toDate, reason, halfDay } = req.body;
  if (!type || !fromDate || !toDate || !reason)
    return res.status(400).json({ error: 'type, fromDate, toDate and reason are required' });
  if (!LEAVE_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid leave type' });
  if (fromDate > toDate) return res.status(400).json({ error: 'fromDate must be on or before toDate' });
  const db = readDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user || user.blocked) return res.status(403).json({ error: 'Account is blocked' });
  if (!db.leaves) db.leaves = [];
  const overlap = db.leaves.find(l => l.userId === req.user.id && ['pending','approved'].includes(l.status) && l.fromDate <= toDate && l.toDate >= fromDate);
  if (overlap) return res.status(400).json({ error: 'You already have a leave overlapping these dates' });
  const holidaySet = new Set((db.holidays||[]).map(h => h.date));
  let days = 0;
  const from = new Date(fromDate+'T00:00:00'), to = new Date(toDate+'T00:00:00');
  for (let d=new Date(from); d<=to; d.setDate(d.getDate()+1)) {
    const ds = d.toISOString().split('T')[0];
    if (d.getDay()!==0 && !holidaySet.has(ds)) days++;
  }
  if (halfDay && days===1) days=0.5;
  const leave = { id:uuidv4(), userId:req.user.id, userName:user.name, dept:user.dept, avatar:user.avatar, color:user.color, type, fromDate, toDate, reason, halfDay:!!halfDay, days, status:'pending', appliedAt:new Date().toISOString(), reviewedBy:null, reviewedAt:null, adminNote:'', cancelledAt:null };
  db.leaves.unshift(leave);
  logAudit(db, req.user.id, 'LEAVE_APPLY', `${user.name} applied for ${type} leave (${fromDate} to ${toDate}, ${days} days)`);
  writeDB(db); res.status(201).json(leave);
});

app.get('/api/leaves/my', auth, (req, res) => {
  const db = readDB();
  res.json((db.leaves||[]).filter(l => l.userId===req.user.id));
});

app.post('/api/leaves/:id/cancel', auth, (req, res) => {
  const db = readDB();
  const leave = (db.leaves||[]).find(l => l.id===req.params.id);
  if (!leave) return res.status(404).json({ error: 'Leave not found' });
  if (leave.userId!==req.user.id) return res.status(403).json({ error: 'Not your leave' });
  if (leave.status!=='pending') return res.status(400).json({ error: 'Only pending leaves can be cancelled' });
  leave.status='cancelled'; leave.cancelledAt=new Date().toISOString();
  logAudit(db, req.user.id, 'LEAVE_CANCEL', `${leave.userName} cancelled ${leave.type} leave`);
  writeDB(db); res.json({ success:true });
});

app.get('/api/leaves', auth, adminOnly, (req, res) => {
  const db = readDB();
  const { status, userId, month } = req.query;
  let leaves = db.leaves||[];
  if (status) leaves = leaves.filter(l => l.status===status);
  if (userId) leaves = leaves.filter(l => l.userId===userId);
  if (month) leaves = leaves.filter(l => l.fromDate.startsWith(month)||l.toDate.startsWith(month));
  res.json(leaves);
});

app.post('/api/leaves/:id/review', auth, adminOnly, (req, res) => {
  const { decision, adminNote } = req.body;
  if (!['approved','rejected'].includes(decision)) return res.status(400).json({ error: 'decision must be approved or rejected' });
  const db = readDB();
  const leave = (db.leaves||[]).find(l => l.id===req.params.id);
  if (!leave) return res.status(404).json({ error: 'Leave not found' });
  if (leave.status!=='pending') return res.status(400).json({ error: 'Leave already reviewed' });
  leave.status=decision; leave.reviewedBy=req.user.id; leave.reviewedAt=new Date().toISOString(); leave.adminNote=adminNote||'';
  if (decision==='approved') {
    const holidaySet = new Set((db.holidays||[]).map(h => h.date));
    const user = db.users.find(u => u.id===leave.userId);
    const from=new Date(leave.fromDate+'T00:00:00'), to=new Date(leave.toDate+'T00:00:00');
    for (let d=new Date(from); d<=to; d.setDate(d.getDate()+1)) {
      const dateStr=d.toISOString().split('T')[0];
      if (d.getDay()===0||holidaySet.has(dateStr)) continue;
      const existing=db.records.find(r=>r.userId===leave.userId&&r.date===dateStr);
      if (existing) { existing.status='on-leave'; existing.note=`${leave.type} leave approved`; existing.editedBy=req.user.id; existing.method='leave'; }
      else if (user) { db.records.unshift({ id:uuidv4(), userId:leave.userId, userName:user.name, dept:user.dept, zoneId:null, zoneName:'—', date:dateStr, checkIn:null, checkOut:null, status:'on-leave', lat:null, lng:null, method:'leave', note:`${leave.type} leave approved`, editedBy:req.user.id, leaveId:leave.id }); }
    }
  }
  logAudit(db, req.user.id, decision==='approved'?'LEAVE_APPROVED':'LEAVE_REJECTED', `${decision} ${leave.type} leave for ${leave.userName}`);
  writeDB(db); res.json(leave);
});

app.get('/api/leaves/summary', auth, adminOnly, (req, res) => {
  const db = readDB();
  const y = (req.query.year||new Date().getFullYear()).toString();
  const staff = db.users.filter(u=>u.role!=='admin');
  const leaves = (db.leaves||[]).filter(l=>l.fromDate.startsWith(y)&&l.status==='approved');
  const summary = staff.map(user => {
    const ul=leaves.filter(l=>l.userId===user.id);
    const byType={};
    LEAVE_TYPES.forEach(t=>{byType[t]=ul.filter(l=>l.type===t).reduce((s,l)=>s+l.days,0);});
    return { userId:user.id, name:user.name, dept:user.dept, avatar:user.avatar, color:user.color, totalDays:ul.reduce((s,l)=>s+l.days,0), byType, pending:(db.leaves||[]).filter(l=>l.userId===user.id&&l.status==='pending').length };
  });
  res.json(summary);
});


// Admin: permanently delete a leave record
app.delete('/api/leaves/:id', auth, adminOnly, (req, res) => {
  const db = readDB();
  const leave = (db.leaves || []).find(l => l.id === req.params.id);
  if (!leave) return res.status(404).json({ error: 'Leave not found' });

  // If the leave was approved, also revert the attendance records that were auto-created
  if (leave.status === 'approved') {
    db.records = db.records.filter(r => r.leaveId !== leave.id);
  }

  db.leaves = db.leaves.filter(l => l.id !== req.params.id);
  logAudit(db, req.user.id, 'DELETE_LEAVE',
    `Deleted ${leave.type} leave for ${leave.userName} (${leave.fromDate} → ${leave.toDate})`);
  writeDB(db);
  res.json({ success: true });
});

// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => console.log(`GeoAttend API running on port ${PORT}`));

// // All non-API routes serve the React app (client-side routing)
// app.get('*', (req, res) => {
//   if (!req.path.startsWith('/api')) {
//     res.sendFile(path.join(__dirname, '../../frontend/dist/index.html'));
//   }
// });
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  }
});


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`GeoAttend API running on port ${PORT}`));
