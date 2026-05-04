'use strict';

const express  = require('express');
const cors     = require('cors');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const https    = require('https');

// ── Vercel uses KV store for persistence (no filesystem) ──────────────────────
// We use @vercel/kv which is a Redis-compatible key-value store.
// If KV_REST_API_URL env var is present, use KV. Otherwise fall back to
// in-memory (resets on cold start — only for local dev / testing).
let kv = null;
try {
  if (process.env.KV_REST_API_URL) {
    kv = require('@vercel/kv').kv;
  }
} catch {}

const DB_KEY = 'geoattend_db';
const JWT_SECRET = process.env.JWT_SECRET || 'geoattend_secret_2024';

// In-memory fallback (lost on cold start — use KV in production)
let memDB = null;

async function readDB() {
  if (kv) {
    try {
      const data = await kv.get(DB_KEY);
      if (data) return typeof data === 'string' ? JSON.parse(data) : data;
    } catch (e) { console.error('KV read error:', e.message); }
  }
  if (!memDB) memDB = initDB();
  return memDB;
}

async function writeDB(data) {
  if (kv) {
    try { await kv.set(DB_KEY, JSON.stringify(data)); return; }
    catch (e) { console.error('KV write error:', e.message); }
  }
  memDB = data;
}

function initDB() {
  return {
    users: [
      { id:'admin-1', name:'Admin User',    email:'admin@geoattend.in', password: bcrypt.hashSync('admin123',10), role:'admin', dept:'Administration', phone:'9000000001', avatar:'AU', color:'#f6ad55', status:'active', joinedAt:new Date().toISOString(), blocked:false, faceDescriptor:null },
      { id:'user-1',  name:'Arjun Sharma',  email:'arjun@geoattend.in', password: bcrypt.hashSync('user123',10),  role:'user',  dept:'Engineering',    phone:'9000000002', avatar:'AS', color:'#63b3ed', status:'active', joinedAt:new Date().toISOString(), blocked:false, faceDescriptor:null },
      { id:'user-2',  name:'Priya Patel',   email:'priya@geoattend.in', password: bcrypt.hashSync('user123',10),  role:'user',  dept:'Design',         phone:'9000000003', avatar:'PP', color:'#b794f4', status:'active', joinedAt:new Date().toISOString(), blocked:false, faceDescriptor:null }
    ],
    zones:    [{ id:'zone-1', name:'Main Office HQ', lat:25.3176, lng:82.9739, radius:200, icon:'🏢', address:'Varanasi, UP', active:true }],
    records:  [], holidays: [], auditLog: [], overrideRequests: [], leaves: [],
    settings: { emailDomain:'', companyName:'GeoAttend', timezone:'Asia/Kolkata', workStartTime:'09:00', workEndTime:'18:00', lateGraceMinutes:15, checkInOpenTime:'08:00', requireFaceAuth:false, allowOutOfZoneRequest:true }
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatPhone(phone) {
  if (!phone) return null;
  const d = String(phone).replace(/\D/g,'');
  if (d.length===10) return `91${d}`;
  if (d.length===12&&d.startsWith('91')) return d;
  if (d.length>=10) return `91${d.slice(-10)}`;
  return null;
}
function sendSMS(toMobile, message) {
  const authKey=process.env.MSG91_AUTH_KEY, senderId=process.env.MSG91_SENDER_ID||'GEOATT', templateId=process.env.MSG91_TEMPLATE_ID||'', route=process.env.MSG91_ROUTE||'4';
  if (!authKey||!toMobile) return Promise.resolve();
  const mobile=formatPhone(toMobile); if (!mobile) return Promise.resolve();
  const body=JSON.stringify({ sender:senderId, route, country:'91', sms:[{ message, to:[mobile], ...(templateId?{template_id:templateId}:{}) }] });
  return new Promise(resolve => {
    const req=https.request({ hostname:'api.msg91.com', path:'/api/v2/sendsms', method:'POST', headers:{'authkey':authKey,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)} }, res => { let d=''; res.on('data',c=>{d+=c;}); res.on('end',()=>{ try{const r=JSON.parse(d);if(r.type==='success')console.log(`[SMS] OK → ${mobile}`);}catch{} resolve(); }); });
    req.on('error',()=>resolve()); req.write(body); req.end();
  });
}
function localTime(isoStr, timezone) {
  if (!isoStr) return '';
  try { return new Date(isoStr).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true,timeZone:timezone||'Asia/Kolkata'}); } catch { return ''; }
}
function haversine(lat1,lon1,lat2,lon2) {
  const R=6371000,dLat=(lat2-lat1)*Math.PI/180,dLon=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function isLateCI(db, iso) {
  const s=db.settings||{}; const [sh,sm]=(s.workStartTime||'09:00').split(':').map(Number); const grace=parseInt(s.lateGraceMinutes||15);
  if (!iso) return false; const d=new Date(iso); return (d.getHours()*60+d.getMinutes())>(sh*60+sm+grace);
}
function applyDomain(email, domain) { if (!domain) return email; const l=email.includes('@')?email.split('@')[0]:email; return `${l}@${domain}`; }
function logAudit(db, userId, action, details) { db.auditLog.unshift({id:uuidv4(),userId,action,details,timestamp:new Date().toISOString()}); if(db.auditLog.length>200) db.auditLog=db.auditLog.slice(0,200); }

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '5mb' }));

function authMw(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error:'Unauthorized' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); } catch { res.status(401).json({ error:'Invalid token' }); }
}
function adminOnly(req, res, next) { if (req.user.role!=='admin') return res.status(403).json({ error:'Admin only' }); next(); }

// ── Auth ──────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req,res) => {
  const { email, password } = req.body;
  const db = await readDB();
  const user = db.users.find(u=>u.email===email);
  if (!user||!bcrypt.compareSync(password,user.password)) return res.status(401).json({ error:'Invalid credentials' });
  if (user.blocked) return res.status(403).json({ error:'Account blocked' });
  const token = jwt.sign({ id:user.id, role:user.role, name:user.name }, JWT_SECRET, { expiresIn:'24h' });
  const { password:_, faceDescriptor:_f, ...safe } = user;
  res.json({ token, user:safe });
});
app.get('/api/auth/me', authMw, async (req,res) => {
  const db=await readDB(); const user=db.users.find(u=>u.id===req.user.id);
  if (!user) return res.status(404).json({ error:'Not found' });
  const { password:_, faceDescriptor:_f, ...safe }=user; res.json(safe);
});

// ── Settings ──────────────────────────────────────────────────────────────────
app.get('/api/settings', authMw, async (req,res) => { const db=await readDB(); res.json(db.settings||{}); });
app.put('/api/settings', authMw, adminOnly, async (req,res) => {
  const db=await readDB(); if (!db.settings) db.settings={};
  if (req.body.emailDomain!==undefined) req.body.emailDomain=req.body.emailDomain.replace(/^@/,'').toLowerCase().trim();
  db.settings={...db.settings,...req.body}; logAudit(db,req.user.id,'UPDATE_SETTINGS','Updated settings');
  await writeDB(db); res.json(db.settings);
});

// ── Face ──────────────────────────────────────────────────────────────────────
app.post('/api/face/enroll', authMw, async (req,res) => {
  const { descriptor }=req.body; if (!descriptor||!Array.isArray(descriptor)) return res.status(400).json({ error:'descriptor required' });
  const db=await readDB(); const idx=db.users.findIndex(u=>u.id===req.user.id); if (idx===-1) return res.status(404).json({ error:'Not found' });
  db.users[idx].faceDescriptor=descriptor; logAudit(db,req.user.id,'FACE_ENROLL',`Face enrolled for ${db.users[idx].name}`);
  await writeDB(db); res.json({ success:true });
});
app.get('/api/face/status', authMw, async (req,res) => { const db=await readDB(); const u=db.users.find(u=>u.id===req.user.id); res.json({ enrolled:!!(u?.faceDescriptor) }); });
app.post('/api/face/verify', authMw, async (req,res) => {
  const { descriptor }=req.body; if (!descriptor||!Array.isArray(descriptor)) return res.status(400).json({ error:'descriptor required' });
  const db=await readDB(); const user=db.users.find(u=>u.id===req.user.id);
  if (!user?.faceDescriptor) return res.status(400).json({ error:'No face enrolled' });
  let dist=0; for (let i=0;i<user.faceDescriptor.length;i++) dist+=(user.faceDescriptor[i]-descriptor[i])**2; dist=Math.sqrt(dist);
  if (dist>0.6) return res.status(401).json({ error:`Face not recognised (${dist.toFixed(3)})`, distance:dist });
  res.json({ success:true, distance:dist });
});
app.post('/api/face/enroll/:userId', authMw, adminOnly, async (req,res) => {
  const { descriptor }=req.body; if (!descriptor||!Array.isArray(descriptor)) return res.status(400).json({ error:'descriptor required' });
  const db=await readDB(); const idx=db.users.findIndex(u=>u.id===req.params.userId); if (idx===-1) return res.status(404).json({ error:'Not found' });
  db.users[idx].faceDescriptor=descriptor; logAudit(db,req.user.id,'FACE_ENROLL_ADMIN',`Admin enrolled face for ${db.users[idx].name}`);
  await writeDB(db); res.json({ success:true });
});
app.delete('/api/face/enroll/:userId', authMw, adminOnly, async (req,res) => {
  const db=await readDB(); const idx=db.users.findIndex(u=>u.id===req.params.userId); if (idx===-1) return res.status(404).json({ error:'Not found' });
  db.users[idx].faceDescriptor=null; logAudit(db,req.user.id,'FACE_REMOVE',`Removed face for ${db.users[idx].name}`);
  await writeDB(db); res.json({ success:true });
});

// ── Users ─────────────────────────────────────────────────────────────────────
app.get('/api/users', authMw, adminOnly, async (req,res) => {
  const db=await readDB(); res.json(db.users.map(({password:_,faceDescriptor,...u})=>({...u,faceEnrolled:!!faceDescriptor})));
});
app.post('/api/users', authMw, adminOnly, async (req,res) => {
  const { name, password, role, dept, phone, color }=req.body; let { email }=req.body;
  if (!name||!email||!password) return res.status(400).json({ error:'Missing required fields' });
  const db=await readDB(); email=applyDomain(email,db.settings?.emailDomain);
  if (db.users.find(u=>u.email===email)) return res.status(400).json({ error:'Email already exists' });
  const initials=name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  const newUser={ id:uuidv4(), name, email, password:bcrypt.hashSync(password,10), role:role||'user', dept:dept||'General', phone:phone||'', avatar:initials, color:color||'#63b3ed', status:'active', joinedAt:new Date().toISOString(), blocked:false, faceDescriptor:null };
  db.users.push(newUser); logAudit(db,req.user.id,'CREATE_USER',`Created ${name}`);
  await writeDB(db); const { password:_,faceDescriptor:_f,...safe }=newUser; res.status(201).json(safe);
});
app.put('/api/users/:id', authMw, adminOnly, async (req,res) => {
  const db=await readDB(); const idx=db.users.findIndex(u=>u.id===req.params.id); if (idx===-1) return res.status(404).json({ error:'Not found' });
  const { password, faceDescriptor, ...updates }=req.body;
  if (updates.email) updates.email=applyDomain(updates.email,db.settings?.emailDomain);
  if (password) updates.password=bcrypt.hashSync(password,10);
  if (updates.name) updates.avatar=updates.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  db.users[idx]={...db.users[idx],...updates}; logAudit(db,req.user.id,'UPDATE_USER',`Updated ${db.users[idx].name}`);
  await writeDB(db); const { password:_,faceDescriptor:_f,...safe }=db.users[idx]; res.json(safe);
});
app.post('/api/users/:id/block', authMw, adminOnly, async (req,res) => {
  const db=await readDB(); const user=db.users.find(u=>u.id===req.params.id);
  if (!user) return res.status(404).json({ error:'Not found' }); if (user.role==='admin') return res.status(400).json({ error:'Cannot block admin' });
  user.blocked=!user.blocked; logAudit(db,req.user.id,user.blocked?'BLOCK_USER':'UNBLOCK_USER',`${user.blocked?'Blocked':'Unblocked'} ${user.name}`);
  await writeDB(db); res.json({ blocked:user.blocked });
});
app.delete('/api/users/:id', authMw, adminOnly, async (req,res) => {
  const db=await readDB(); const user=db.users.find(u=>u.id===req.params.id);
  if (!user) return res.status(404).json({ error:'Not found' }); if (user.role==='admin') return res.status(400).json({ error:'Cannot delete admin' });
  db.users=db.users.filter(u=>u.id!==req.params.id); logAudit(db,req.user.id,'DELETE_USER',`Deleted ${user.name}`);
  await writeDB(db); res.json({ success:true });
});

// ── Zones ─────────────────────────────────────────────────────────────────────
app.get('/api/zones', authMw, async (req,res) => { const db=await readDB(); res.json(db.zones); });
app.post('/api/zones', authMw, adminOnly, async (req,res) => {
  const { name,lat,lng,radius,icon,address }=req.body; if (!name||!lat||!lng||!radius) return res.status(400).json({ error:'Missing fields' });
  const db=await readDB(); const zone={ id:uuidv4(), name, lat:parseFloat(lat), lng:parseFloat(lng), radius:parseInt(radius), icon:icon||'📍', address:address||'', active:true };
  db.zones.push(zone); logAudit(db,req.user.id,'CREATE_ZONE',`Created zone ${name}`); await writeDB(db); res.status(201).json(zone);
});
app.put('/api/zones/:id', authMw, adminOnly, async (req,res) => {
  const db=await readDB(); const idx=db.zones.findIndex(z=>z.id===req.params.id); if (idx===-1) return res.status(404).json({ error:'Not found' });
  db.zones[idx]={...db.zones[idx],...req.body}; logAudit(db,req.user.id,'UPDATE_ZONE',`Updated ${db.zones[idx].name}`); await writeDB(db); res.json(db.zones[idx]);
});
app.delete('/api/zones/:id', authMw, adminOnly, async (req,res) => {
  const db=await readDB(); const zone=db.zones.find(z=>z.id===req.params.id); if (!zone) return res.status(404).json({ error:'Not found' });
  db.zones=db.zones.filter(z=>z.id!==req.params.id); logAudit(db,req.user.id,'DELETE_ZONE',`Deleted ${zone.name}`); await writeDB(db); res.json({ success:true });
});

// ── Holidays ──────────────────────────────────────────────────────────────────
app.get('/api/holidays', authMw, async (req,res) => { const db=await readDB(); res.json(db.holidays); });
app.post('/api/holidays', authMw, adminOnly, async (req,res) => {
  const { name,date,type,description }=req.body; if (!name||!date) return res.status(400).json({ error:'Missing fields' });
  const db=await readDB(); if (db.holidays.find(h=>h.date===date)) return res.status(400).json({ error:'Holiday exists for this date' });
  const h={ id:uuidv4(), name, date, type:type||'public', description:description||'', createdBy:req.user.id, createdAt:new Date().toISOString() };
  db.holidays.push(h); logAudit(db,req.user.id,'CREATE_HOLIDAY',`Marked ${date}: ${name}`); await writeDB(db); res.status(201).json(h);
});
app.delete('/api/holidays/:id', authMw, adminOnly, async (req,res) => {
  const db=await readDB(); const h=db.holidays.find(h=>h.id===req.params.id); if (!h) return res.status(404).json({ error:'Not found' });
  db.holidays=db.holidays.filter(h=>h.id!==req.params.id); logAudit(db,req.user.id,'DELETE_HOLIDAY',`Removed ${h.name}`); await writeDB(db); res.json({ success:true });
});

// ── Attendance check-in ───────────────────────────────────────────────────────
app.post('/api/attendance/checkin', authMw, async (req,res) => {
  const { lat,lng,zoneId,faceVerified,lateReason }=req.body;
  const db=await readDB(); const user=db.users.find(u=>u.id===req.user.id);
  if (!user||user.blocked) return res.status(403).json({ error:'Account is blocked' });
  const today=new Date().toISOString().split('T')[0];
  if (db.holidays.find(h=>h.date===today)) return res.status(400).json({ error:'Today is a holiday.' });
  const zone=db.zones.find(z=>z.id===zoneId); if (!zone) return res.status(404).json({ error:'Zone not found' });
  if (haversine(lat,lng,zone.lat,zone.lng)>zone.radius) return res.status(400).json({ error:`Outside geofence. ${Math.round(haversine(lat,lng,zone.lat,zone.lng))}m away` });
  const openTime=db.settings?.checkInOpenTime;
  if (openTime) { const n=new Date(),nm=n.getHours()*60+n.getMinutes(),[oh,om]=openTime.split(':').map(Number); if(nm<oh*60+om) return res.status(400).json({ error:`Check-in not allowed before ${openTime}`, code:'BEFORE_OPEN_TIME' }); }
  if (db.settings?.requireFaceAuth&&user.faceDescriptor&&!faceVerified) return res.status(403).json({ error:'Face authentication required', code:'FACE_REQUIRED' });
  const now=new Date().toISOString(); const late=isLateCI(db,now);
  const existing=db.records.find(r=>r.userId===req.user.id&&r.date===today);
  if (existing) {
    const sessions=existing.sessions||[]; const lastOpen=sessions.find(s=>s.checkIn&&!s.checkOut);
    if (lastOpen) return res.status(400).json({ error:'Please check out before checking in again.' });
    const ns={ sessionId:uuidv4(), checkIn:now, checkOut:null, zoneId, zoneName:zone.name, lat, lng, faceVerified:!!faceVerified, lateReason:lateReason||'', method:'geofence' };
    existing.sessions=[...sessions,ns]; existing.status=late?'late':'present'; existing.zoneId=zoneId; existing.zoneName=zone.name;
  } else {
    const fs2={ sessionId:uuidv4(), checkIn:now, checkOut:null, zoneId, zoneName:zone.name, lat, lng, faceVerified:!!faceVerified, lateReason:lateReason||'', method:'geofence' };
    db.records.unshift({ id:uuidv4(), userId:req.user.id, userName:user.name, dept:user.dept, zoneId, zoneName:zone.name, date:today, checkIn:now, checkOut:null, sessions:[fs2], status:late?'late':'present', lat, lng, method:'geofence', note:lateReason?`Late: ${lateReason}`:'', editedBy:null, faceVerified:!!faceVerified, lateReason:lateReason||'' });
  }
  await writeDB(db);
  const rec2=db.records.find(r=>r.userId===req.user.id&&r.date===today);
  const sn=rec2?.sessions?.length||1; const tz=db.settings?.timezone||'Asia/Kolkata'; const co=db.settings?.companyName||'GeoAttend';
  const ciTime=localTime(now,tz);
  sendSMS(user.phone, late?`${co}: Dear ${user.name}, you checked IN at ${ciTime} (LATE) at ${zone.name}. Reason: ${lateReason||'Not provided'}.`:`${co}: Dear ${user.name}, you checked IN at ${ciTime} at ${zone.name}${sn>1?` (session ${sn})`:''}.`);
  res.json({ success:true, checkIn:now, zoneName:zone.name, late, status:late?'late':'present', sessionNumber:sn });
});

// ── Attendance check-out ──────────────────────────────────────────────────────
app.post('/api/attendance/checkout', authMw, async (req,res) => {
  const { lat,lng,zoneId,faceVerified }=req.body;
  const db=await readDB(); const today=new Date().toISOString().split('T')[0];
  const user=db.users.find(u=>u.id===req.user.id);
  const rec=db.records.find(r=>r.userId===req.user.id&&r.date===today);
  if (!rec) return res.status(400).json({ error:'No check-in found for today.' });
  const sessions=rec.sessions||[]; const openSession=sessions.slice().reverse().find(s=>s.checkIn&&!s.checkOut);
  if (!openSession) return res.status(400).json({ error:'No active check-in.' });
  if (db.settings?.requireFaceAuth&&user?.faceDescriptor&&!faceVerified) return res.status(403).json({ error:'Face authentication required', code:'FACE_REQUIRED' });
  const zone=db.zones.find(z=>z.id===(zoneId||openSession.zoneId||rec.zoneId));
  if (zone&&haversine(lat,lng,zone.lat,zone.lng)>zone.radius) return res.status(400).json({ error:'Outside geofence zone' });
  const now=new Date().toISOString(); openSession.checkOut=now; rec.checkOut=now;
  const totalMins=sessions.reduce((sum,s)=>{ if(!s.checkIn||!s.checkOut) return sum; return sum+Math.round((new Date(s.checkOut)-new Date(s.checkIn))/60000); },0);
  rec.totalMins=totalMins;
  await writeDB(db);
  const sn=sessions.length; const h=Math.floor(totalMins/60),m=totalMins%60; const ts=totalMins>0?` Total: ${h}h ${m}m.`:'';
  const tz2=db.settings?.timezone||'Asia/Kolkata'; const co2=db.settings?.companyName||'GeoAttend'; const coTime=localTime(now,tz2);
  if (user) sendSMS(user.phone, `${co2}: Dear ${user.name}, you checked OUT at ${coTime} from ${rec.zoneName}${sn>1?` (session ${sn})`:''}. ${ts}`);
  res.json({ success:true, checkOut:now, totalMins, sessionNumber:sn });
});

// ── List attendance ───────────────────────────────────────────────────────────
app.get('/api/attendance', authMw, async (req,res) => {
  const db=await readDB(); const { userId,date,from,to }=req.query;
  let records=db.records;
  if (req.user.role!=='admin') { records=records.filter(r=>r.userId===req.user.id); if(date) records=records.filter(r=>r.date===date); if(from) records=records.filter(r=>r.date>=from); if(to) records=records.filter(r=>r.date<=to); return res.json(records.slice(0,200)); }
  if (userId) records=records.filter(r=>r.userId===userId);
  if (date)   records=records.filter(r=>r.date===date);
  if (from)   records=records.filter(r=>r.date>=from);
  if (to)     records=records.filter(r=>r.date<=to);
  if (date&&!userId) {
    const isHoliday=(db.holidays||[]).some(h=>h.date===date); const isSunday=new Date(date+'T00:00:00').getDay()===0;
    if (!isHoliday&&!isSunday) {
      const staff=db.users.filter(u=>u.role!=='admin'&&!u.blocked); const presentIds=new Set(records.map(r=>r.userId));
      staff.forEach(u=>{ if(!presentIds.has(u.id)) records=[...records,{ id:`virtual-absent-${u.id}-${date}`, userId:u.id, userName:u.name, dept:u.dept, avatar:u.avatar, color:u.color, zoneId:null, zoneName:'—', date, checkIn:null, checkOut:null, sessions:[], status:'absent', lat:null, lng:null, method:'auto', note:'', lateReason:'', editedBy:null, virtual:true }]; });
    }
  }
  res.json(records.slice(0,200));
});
app.put('/api/attendance/:id', authMw, adminOnly, async (req,res) => {
  const db=await readDB(); const idx=db.records.findIndex(r=>r.id===req.params.id); if (idx===-1) return res.status(404).json({ error:'Not found' });
  const rec=db.records[idx]; const { status,checkInTime,checkOutTime,date,zoneId,zoneName,note }=req.body;
  const targetDate=date||rec.date;
  let ni=rec.checkIn, no=rec.checkOut;
  if (status==='absent') { ni=null; no=null; } else { if(checkInTime) ni=`${targetDate}T${checkInTime}:00`; if(checkOutTime) no=`${targetDate}T${checkOutTime}:00`; else no=rec.checkOut; }
  db.records[idx]={...rec,date:targetDate,status:status||rec.status,checkIn:ni,checkOut:no,zoneId:zoneId||rec.zoneId,zoneName:zoneName||rec.zoneName,note:note!==undefined?note:rec.note,editedBy:req.user.id,editedAt:new Date().toISOString(),method:'manual'};
  logAudit(db,req.user.id,'EDIT_ATTENDANCE',`Edited ${rec.userName} on ${targetDate}`); await writeDB(db); res.json(db.records[idx]);
});
app.delete('/api/attendance/:id', authMw, adminOnly, async (req,res) => {
  const db=await readDB(); const rec=db.records.find(r=>r.id===req.params.id); if (!rec) return res.status(404).json({ error:'Not found' });
  db.records=db.records.filter(r=>r.id!==req.params.id); logAudit(db,req.user.id,'DELETE_ATTENDANCE',`Deleted ${rec.userName} on ${rec.date}`); await writeDB(db); res.json({ success:true });
});
app.post('/api/attendance/bulk', authMw, adminOnly, async (req,res) => {
  const { date,status,userIds,note }=req.body; const db=await readDB();
  const st=db.settings?.workStartTime||'09:00'; const et=db.settings?.workEndTime||'18:00';
  userIds.forEach(uid=>{ const ex=db.records.find(r=>r.userId===uid&&r.date===date); const u=db.users.find(u=>u.id===uid);
    if (ex) { ex.status=status;ex.note=note||'';ex.editedBy=req.user.id;ex.method='manual'; if(status==='absent'){ex.checkIn=null;ex.checkOut=null;}else{if(!ex.checkIn)ex.checkIn=`${date}T${st}:00`;if(!ex.checkOut)ex.checkOut=status==='present'?`${date}T${et}:00`:null;} }
    else if (u) { db.records.unshift({ id:uuidv4(),userId:uid,userName:u.name,dept:u.dept,zoneId:null,zoneName:'N/A',date,checkIn:status!=='absent'?`${date}T${st}:00`:null,checkOut:status==='present'?`${date}T${et}:00`:null,sessions:[],status,lat:null,lng:null,method:'manual',note:note||'',editedBy:req.user.id }); }
  });
  logAudit(db,req.user.id,'BULK_ATTENDANCE',`Bulk ${userIds.length} users ${status} on ${date}`); await writeDB(db); res.json({ success:true });
});
app.post('/api/attendance/bulk-range', authMw, adminOnly, async (req,res) => {
  const { fromDate,toDate,status,userIds,note,skipHolidays,skipSundays }=req.body;
  if (!fromDate||!toDate||!status||!userIds?.length) return res.status(400).json({ error:'Missing fields' });
  const db=await readDB(); const st=db.settings?.workStartTime||'09:00'; const et=db.settings?.workEndTime||'18:00';
  const hSet=new Set(db.holidays.map(h=>h.date)); let count=0;
  const from=new Date(fromDate+'T00:00:00'),to=new Date(toDate+'T00:00:00');
  for (let d=new Date(from);d<=to;d.setDate(d.getDate()+1)) {
    const ds=d.toISOString().split('T')[0]; if(skipSundays&&d.getDay()===0) continue; if(skipHolidays&&hSet.has(ds)) continue;
    userIds.forEach(uid=>{ const u=db.users.find(u=>u.id===uid); if(!u) return; const ex=db.records.find(r=>r.userId===uid&&r.date===ds);
      if (ex) { ex.status=status;ex.note=note||'';ex.editedBy=req.user.id;ex.method='manual'; if(status==='absent'){ex.checkIn=null;ex.checkOut=null;}else{if(!ex.checkIn)ex.checkIn=`${ds}T${st}:00`;if(!ex.checkOut)ex.checkOut=status==='present'?`${ds}T${et}:00`:null;} }
      else { db.records.unshift({ id:uuidv4(),userId:uid,userName:u.name,dept:u.dept,zoneId:null,zoneName:'N/A',date:ds,checkIn:status!=='absent'?`${ds}T${st}:00`:null,checkOut:status==='present'?`${ds}T${et}:00`:null,sessions:[],status,lat:null,lng:null,method:'manual',note:note||'',editedBy:req.user.id }); }
      count++;
    });
  }
  logAudit(db,req.user.id,'BULK_RANGE',`Range ${fromDate}→${toDate} ${status} ${count} records`); await writeDB(db); res.json({ success:true, count });
});

// ── Override requests ─────────────────────────────────────────────────────────
app.post('/api/attendance/override-request', authMw, async (req,res) => {
  const { zoneId,action,reason,faceVerified,lat,lng }=req.body; if (!reason) return res.status(400).json({ error:'Reason required' });
  const db=await readDB(); const user=db.users.find(u=>u.id===req.user.id);
  if (!user||user.blocked) return res.status(403).json({ error:'Account is blocked' });
  if (!db.settings?.allowOutOfZoneRequest) return res.status(403).json({ error:'Override requests disabled' });
  if (user.faceDescriptor&&!faceVerified) return res.status(403).json({ error:'Face authentication required', code:'FACE_REQUIRED' });
  const today=new Date().toISOString().split('T')[0];
  const ex=(db.overrideRequests||[]).find(r=>r.userId===user.id&&r.date===today&&r.action===action&&r.status==='pending');
  if (ex) return res.status(400).json({ error:'Override already pending' });
  const ov={ id:uuidv4(), userId:user.id, userName:user.name, dept:user.dept, avatar:user.avatar, color:user.color, zoneId, zoneName:db.zones.find(z=>z.id===zoneId)?.name||'Unknown', action, reason, lat:lat||null, lng:lng||null, date:today, requestedAt:new Date().toISOString(), status:'pending', reviewedBy:null, reviewedAt:null, reviewNote:'', faceVerified:!!faceVerified };
  if (!db.overrideRequests) db.overrideRequests=[];
  db.overrideRequests.unshift(ov); logAudit(db,user.id,'OVERRIDE_REQUEST',`${user.name} requested ${action} override`);
  await writeDB(db); res.status(201).json({ success:true, requestId:ov.id });
});
app.get('/api/attendance/override-requests', authMw, adminOnly, async (req,res) => {
  const db=await readDB(); const { status }=req.query; let r=db.overrideRequests||[]; if(status) r=r.filter(x=>x.status===status); res.json(r);
});
app.get('/api/attendance/my-override', authMw, async (req,res) => {
  const db=await readDB(); const today=new Date().toISOString().split('T')[0]; res.json((db.overrideRequests||[]).filter(r=>r.userId===req.user.id&&r.date===today));
});
app.post('/api/attendance/override-requests/:id/review', authMw, adminOnly, async (req,res) => {
  const { decision,note }=req.body; const db=await readDB();
  const ov=(db.overrideRequests||[]).find(r=>r.id===req.params.id); if(!ov) return res.status(404).json({ error:'Not found' });
  if (ov.status!=='pending') return res.status(400).json({ error:'Already reviewed' });
  ov.status=decision; ov.reviewedBy=req.user.id; ov.reviewedAt=new Date().toISOString(); ov.reviewNote=note||'';
  if (decision==='approved') {
    const user=db.users.find(u=>u.id===ov.userId); const late=isLateCI(db,ov.requestedAt);
    const existing=db.records.find(r=>r.userId===ov.userId&&r.date===ov.date);
    if (ov.action==='checkin') {
      if (existing) { existing.checkIn=ov.requestedAt; existing.status=late?'late':'present'; existing.method='override'; }
      else if (user) { db.records.unshift({ id:uuidv4(),userId:ov.userId,userName:ov.userName,dept:ov.dept,zoneId:ov.zoneId,zoneName:ov.zoneName,date:ov.date,checkIn:ov.requestedAt,checkOut:null,sessions:[{sessionId:uuidv4(),checkIn:ov.requestedAt,checkOut:null,zoneId:ov.zoneId,zoneName:ov.zoneName,lat:ov.lat,lng:ov.lng,faceVerified:ov.faceVerified,lateReason:'',method:'override'}],status:late?'late':'present',lat:ov.lat,lng:ov.lng,method:'override',note:`Override: ${ov.reason}`,editedBy:req.user.id,faceVerified:ov.faceVerified,lateReason:'' }); }
    } else if (ov.action==='checkout'&&existing?.checkIn) { existing.checkOut=ov.requestedAt; }
    logAudit(db,req.user.id,'OVERRIDE_APPROVED',`Approved override for ${ov.userName}`);
    const ovUser=db.users.find(u=>u.id===ov.userId);
    if (ovUser) { const tz=db.settings?.timezone||'Asia/Kolkata';const co=db.settings?.companyName||'GeoAttend';const t=localTime(ov.requestedAt,tz); sendSMS(ovUser.phone, ov.action==='checkin'?`${co}: Dear ${ov.userName}, out-of-zone check-IN at ${t} on ${ov.date} APPROVED.`:`${co}: Dear ${ov.userName}, out-of-zone check-OUT at ${t} on ${ov.date} APPROVED.`); }
  } else { logAudit(db,req.user.id,'OVERRIDE_DENIED',`Denied for ${ov.userName}`); }
  await writeDB(db); res.json({ success:true, status:ov.status });
});

// ── Monthly report ────────────────────────────────────────────────────────────
app.get('/api/attendance/monthly-report', authMw, adminOnly, async (req,res) => {
  const { month }=req.query; if (!month||!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error:'month required YYYY-MM' });
  const db=await readDB(); const s=db.settings||{}; const workStart=s.workStartTime||'09:00'; const lateGrace=parseInt(s.lateGraceMinutes||15);
  const [year,mon]=month.split('-').map(Number); const dim=new Date(year,mon,0).getDate();
  const mHol=new Set(db.holidays.filter(h=>h.date.startsWith(month)).map(h=>h.date));
  const allDays=[]; for(let d=1;d<=dim;d++){const ds=`${month}-${String(d).padStart(2,'0')}`;const dow=new Date(ds+'T00:00:00').getDay();allDays.push({date:ds,isHoliday:mHol.has(ds),isSunday:dow===0,isWorkday:dow!==0&&!mHol.has(ds)});}
  const workdays=allDays.filter(d=>d.isWorkday).length;
  function toMin(iso){if(!iso)return null;const d=new Date(iso);return d.getHours()*60+d.getMinutes();}
  const staff=db.users.filter(u=>u.role!=='admin');
  const mr=db.records.filter(r=>r.date>=`${month}-01`&&r.date<=`${month}-${String(dim).padStart(2,'0')}`);
  const employees=staff.map(user=>{
    const ur=mr.filter(r=>r.userId===user.id); let pd=0,ad=0,ld=0,tm=0; const dm={};
    ur.forEach(r=>{dm[r.date]=r;if(r.status==='present'||r.status==='late'){pd++;if(r.status==='late')ld++;if(r.sessions?.length>0){r.sessions.forEach(s=>{if(s.checkIn&&s.checkOut)tm+=Math.round((new Date(s.checkOut)-new Date(s.checkIn))/60000);});}else{const ci=toMin(r.checkIn),co=toMin(r.checkOut);if(ci!==null&&co!==null&&co>ci)tm+=co-ci;}}else if(r.status==='absent')ad++;});
    ad+=allDays.filter(d=>d.isWorkday&&!dm[d.date]).length;
    const days=allDays.map(d=>{
      const rec=dm[d.date]; let status='none';
      if(rec) status=rec.status; else if(d.isHoliday) status='holiday'; else if(d.isSunday) status='sunday'; else if(d.isWorkday) status='absent';
      let wm=0; if(rec){if(rec.sessions?.length>0){rec.sessions.forEach(s=>{if(s.checkIn&&s.checkOut)wm+=Math.round((new Date(s.checkOut)-new Date(s.checkIn))/60000);});}else{const ci=toMin(rec.checkIn),co=toMin(rec.checkOut);if(ci!==null&&co!==null&&co>ci)wm=co-ci;}}
      return {date:d.date,status,isHoliday:d.isHoliday,isSunday:d.isSunday,sessions:rec?.sessions||[],checkIn:rec?.checkIn||null,checkOut:rec?.checkOut||null,workMins:wm,late:rec?rec.status==='late':false,note:rec?.note||'',lateReason:rec?.lateReason||'',method:rec?.method||''};
    });
    return {userId:user.id,name:user.name,dept:user.dept,avatar:user.avatar,color:user.color,presentDays:pd,absentDays:ad,lateDays:ld,totalMins:tm,avgMinsPerDay:pd>0?Math.round(tm/pd):0,attendancePct:workdays>0?Math.round((pd/workdays)*100):0,workdays,days};
  });
  res.json({month,workdays,holidays:[...mHol],allDays,employees});
});

// ── Leaves ────────────────────────────────────────────────────────────────────
const LT=['casual','sick','earned','maternity','paternity','unpaid','other'];
app.post('/api/leaves', authMw, async (req,res) => {
  const { type,fromDate,toDate,reason,halfDay }=req.body;
  if (!type||!fromDate||!toDate||!reason) return res.status(400).json({ error:'Missing fields' });
  if (!LT.includes(type)) return res.status(400).json({ error:'Invalid type' }); if (fromDate>toDate) return res.status(400).json({ error:'fromDate must be ≤ toDate' });
  const db=await readDB(); const user=db.users.find(u=>u.id===req.user.id); if (!user||user.blocked) return res.status(403).json({ error:'Blocked' });
  if (!db.leaves) db.leaves=[];
  const ov=db.leaves.find(l=>l.userId===req.user.id&&['pending','approved'].includes(l.status)&&l.fromDate<=toDate&&l.toDate>=fromDate);
  if (ov) return res.status(400).json({ error:'Overlaps existing leave' });
  const hSet=new Set((db.holidays||[]).map(h=>h.date)); let days=0;
  const f=new Date(fromDate+'T00:00:00'),t=new Date(toDate+'T00:00:00');
  for(let d=new Date(f);d<=t;d.setDate(d.getDate()+1)){const ds=d.toISOString().split('T')[0];if(d.getDay()!==0&&!hSet.has(ds))days++;}
  if (halfDay&&days===1) days=0.5;
  const leave={id:uuidv4(),userId:req.user.id,userName:user.name,dept:user.dept,avatar:user.avatar,color:user.color,type,fromDate,toDate,reason,halfDay:!!halfDay,days,status:'pending',appliedAt:new Date().toISOString(),reviewedBy:null,reviewedAt:null,adminNote:'',cancelledAt:null};
  db.leaves.unshift(leave); logAudit(db,req.user.id,'LEAVE_APPLY',`${user.name} applied ${type} leave`);
  await writeDB(db); res.status(201).json(leave);
});
app.get('/api/leaves/my', authMw, async (req,res) => { const db=await readDB(); res.json((db.leaves||[]).filter(l=>l.userId===req.user.id)); });
app.post('/api/leaves/:id/cancel', authMw, async (req,res) => {
  const db=await readDB(); const l=(db.leaves||[]).find(l=>l.id===req.params.id); if(!l) return res.status(404).json({ error:'Not found' });
  if (l.userId!==req.user.id) return res.status(403).json({ error:'Not your leave' }); if (l.status!=='pending') return res.status(400).json({ error:'Only pending can be cancelled' });
  l.status='cancelled'; l.cancelledAt=new Date().toISOString(); logAudit(db,req.user.id,'LEAVE_CANCEL',`${l.userName} cancelled leave`); await writeDB(db); res.json({ success:true });
});
app.get('/api/leaves', authMw, adminOnly, async (req,res) => {
  const db=await readDB(); const { status,userId,month }=req.query; let leaves=db.leaves||[];
  if(status) leaves=leaves.filter(l=>l.status===status); if(userId) leaves=leaves.filter(l=>l.userId===userId); if(month) leaves=leaves.filter(l=>l.fromDate.startsWith(month)||l.toDate.startsWith(month));
  res.json(leaves);
});
app.post('/api/leaves/:id/review', authMw, adminOnly, async (req,res) => {
  const { decision,adminNote }=req.body; if(!['approved','rejected'].includes(decision)) return res.status(400).json({ error:'Invalid decision' });
  const db=await readDB(); const leave=(db.leaves||[]).find(l=>l.id===req.params.id); if(!leave) return res.status(404).json({ error:'Not found' });
  if (leave.status!=='pending') return res.status(400).json({ error:'Already reviewed' });
  leave.status=decision; leave.reviewedBy=req.user.id; leave.reviewedAt=new Date().toISOString(); leave.adminNote=adminNote||'';
  if (decision==='approved') {
    const hSet=new Set((db.holidays||[]).map(h=>h.date)); const user=db.users.find(u=>u.id===leave.userId);
    const f=new Date(leave.fromDate+'T00:00:00'),t=new Date(leave.toDate+'T00:00:00');
    for(let d=new Date(f);d<=t;d.setDate(d.getDate()+1)){const ds=d.toISOString().split('T')[0];if(d.getDay()===0||hSet.has(ds))continue;const ex=db.records.find(r=>r.userId===leave.userId&&r.date===ds);if(ex){ex.status='on-leave';ex.note=`${leave.type} leave`;ex.editedBy=req.user.id;ex.method='leave';}else if(user){db.records.unshift({id:uuidv4(),userId:leave.userId,userName:user.name,dept:user.dept,zoneId:null,zoneName:'—',date:ds,checkIn:null,checkOut:null,sessions:[],status:'on-leave',lat:null,lng:null,method:'leave',note:`${leave.type} leave`,editedBy:req.user.id,leaveId:leave.id});}}
  }
  logAudit(db,req.user.id,decision==='approved'?'LEAVE_APPROVED':'LEAVE_REJECTED',`${decision} ${leave.type} for ${leave.userName}`);
  await writeDB(db);
  const lu=db.users.find(u=>u.id===leave.userId);
  if (lu) { const co=db.settings?.companyName||'GeoAttend';const tl=leave.type.charAt(0).toUpperCase()+leave.type.slice(1);const dr=leave.fromDate===leave.toDate?leave.fromDate:`${leave.fromDate} to ${leave.toDate}`;const ds2=`${leave.days} day${leave.days!==1?'s':''}`;const ns=leave.adminNote?` Note: ${leave.adminNote}`:'';sendSMS(lu.phone,decision==='approved'?`${co}: Dear ${lu.name}, your ${tl} Leave for ${dr} (${ds2}) has been APPROVED.${ns}`:`${co}: Dear ${lu.name}, your ${tl} Leave for ${dr} (${ds2}) has been REJECTED.${ns||' Contact HR.'}`); }
  res.json(leave);
});
app.delete('/api/leaves/:id', authMw, adminOnly, async (req,res) => {
  const db=await readDB(); const l=(db.leaves||[]).find(l=>l.id===req.params.id); if(!l) return res.status(404).json({ error:'Not found' });
  if (l.status==='approved') db.records=db.records.filter(r=>r.leaveId!==l.id);
  db.leaves=db.leaves.filter(x=>x.id!==req.params.id); logAudit(db,req.user.id,'DELETE_LEAVE',`Deleted ${l.type} leave for ${l.userName}`); await writeDB(db); res.json({ success:true });
});
app.get('/api/leaves/summary', authMw, adminOnly, async (req,res) => {
  const db=await readDB(); const y=(req.query.year||new Date().getFullYear()).toString();
  const staff=db.users.filter(u=>u.role!=='admin'); const leaves=(db.leaves||[]).filter(l=>l.fromDate.startsWith(y)&&l.status==='approved');
  const summary=staff.map(user=>{const ul=leaves.filter(l=>l.userId===user.id);const bt={};LT.forEach(t=>{bt[t]=ul.filter(l=>l.type===t).reduce((s,l)=>s+l.days,0);});return{userId:user.id,name:user.name,dept:user.dept,avatar:user.avatar,color:user.color,totalDays:ul.reduce((s,l)=>s+l.days,0),byType:bt,pending:(db.leaves||[]).filter(l=>l.userId===user.id&&l.status==='pending').length};});
  res.json(summary);
});

// ── Stats ─────────────────────────────────────────────────────────────────────
app.get('/api/stats', authMw, adminOnly, async (req,res) => {
  const db=await readDB(); const today=new Date().toISOString().split('T')[0];
  const staff=db.users.filter(u=>u.role!=='admin'); const tr=db.records.filter(r=>r.date===today);
  const pt=tr.filter(r=>r.status==='present').length; const lt=tr.filter(r=>r.status==='late').length;
  const l30=new Date(Date.now()-30*86400000).toISOString().split('T')[0];
  const avg=staff.length?Math.round((db.records.filter(r=>r.date>=l30&&r.status==='present').length/(staff.length*30))*100):0;
  const po=(db.overrideRequests||[]).filter(r=>r.status==='pending').length;
  res.json({totalStaff:staff.length,presentToday:pt,lateToday:lt,absentToday:staff.length-pt-lt,activeZones:db.zones.filter(z=>z.active).length,avgAttendance:avg,blockedUsers:staff.filter(u=>u.blocked).length,holidaysThisMonth:db.holidays.filter(h=>h.date.startsWith(today.slice(0,7))).length,pendingOverrides:po});
});

// ── Audit ─────────────────────────────────────────────────────────────────────
app.get('/api/audit', authMw, adminOnly, async (req,res) => { const db=await readDB(); res.json(db.auditLog.slice(0,200)); });

// ── Export for Vercel ─────────────────────────────────────────────────────────
module.exports = app;
