import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { zonesAPI, attendanceAPI, holidaysAPI, faceAPI, settingsAPI } from '../services/api';
import GeoMap from '../components/GeoMap';
import FaceAuth from '../components/FaceAuth';
import { fmtTime, fmtDuration, isLateTime } from '../utils/timeUtils';

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Modal is outside CheckInPage — never re-created on render
function Modal({ title, onClose, children, maxWidth = 460 }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth }}>
        <div className="flex-between mb-16">
          <h2 className="modal-title" style={{ margin: 0, fontSize: 18 }}>{title}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const LATE_REASONS = [
  'Traffic jam', 'Public transport delay', 'Medical appointment',
  'Family emergency', 'Power/internet outage', 'Bad weather', 'Other'
];

export default function CheckInPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [zones, setZones]               = useState([]);
  const [selectedZone, setSelectedZone] = useState(null);
  const [location, setLocation]         = useState(null);
  const [locError, setLocError]         = useState(null);
  const [todayRecord, setTodayRecord]   = useState(null);
  const [holiday, setHoliday]           = useState(null);
  const [loading, setLoading]           = useState(false);
  const [history, setHistory]           = useState([]);
  const [settings, setSettings]         = useState({});
  const [faceEnrolled, setFaceEnrolled] = useState(false);
  const [myOverride, setMyOverride]     = useState([]);

  // Modal visibility
  const [showFaceEnroll, setShowFaceEnroll]   = useState(false);
  const [showFaceVerify, setShowFaceVerify]   = useState(false);
  const [faceAction, setFaceAction]           = useState(null);
  const [verifiedDescriptor, setVerifiedDescriptor] = useState(null);
  const [showLateModal, setShowLateModal]     = useState(false);
  const [lateReason, setLateReason]           = useState('');
  const [lateReasonOther, setLateReasonOther] = useState('');
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [overrideAction, setOverrideAction]   = useState('checkin');
  const [overrideReason, setOverrideReason]   = useState('');

  const today = new Date().toISOString().split('T')[0];

  const distance = location && selectedZone
    ? Math.round(haversine(location.lat, location.lng, selectedZone.lat, selectedZone.lng))
    : null;
  const isInside = distance !== null && selectedZone && distance <= selectedZone.radius;

  // Use isLateTime from utils — uses new Date() so local TZ is correct
  const lateNow = isLateTime(new Date().toISOString(), settings.workStartTime, settings.lateGraceMinutes);
  // Use isTooEarly For Too early check in
  const tooEarly  = (() => {
    const open = settings.checkInOpenTime;
    if (!open) return false;
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const [oh, om] = open.split(':').map(Number);
    return nowMins < oh * 60 + om;
  })();

  useEffect(() => {
    zonesAPI.list().then(r => { setZones(r.data); setSelectedZone(r.data[0]); }).catch(() => {});
    holidaysAPI.list().then(r => { setHoliday(r.data.find(h => h.date === today) || null); }).catch(() => {});
    settingsAPI.get().then(r => setSettings(r.data)).catch(() => {});
    faceAPI.status().then(r => setFaceEnrolled(r.data.enrolled)).catch(() => {});
    loadTodayRecord();
    loadHistory();
    loadMyOverride();
    startGPS();
  }, []);

  const loadTodayRecord = async () => {
    try { const r = await attendanceAPI.list({ userId: user.id, date: today }); setTodayRecord(r.data[0] || null); } catch {}
  };
  const loadHistory = async () => {
    try { const r = await attendanceAPI.list({ userId: user.id }); setHistory(r.data.slice(0, 14)); } catch {}
  };
  const loadMyOverride = async () => {
    try { const r = await attendanceAPI.getMyOverride(); setMyOverride(r.data); } catch {}
  };

  const startGPS = () => {
    if (!navigator.geolocation) { setLocError('Geolocation not supported'); return; }
    navigator.geolocation.watchPosition(
      pos => { setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }); setLocError(null); },
      err => {
        setLocError(err.message);
        setLocation(prev => prev || { lat: 25.3176 + (Math.random() - 0.5) * 0.002, lng: 82.9739 + (Math.random() - 0.5) * 0.002, accuracy: 20 });
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 8000 }
    );
  };

  // ── Check-in flow ──────────────────────────────────────────────────────────
  const initiateCheckIn = () => {
    if (settings.requireFaceAuth && faceEnrolled) {
      setFaceAction('checkin'); setShowFaceVerify(true);
    } else if (lateNow) {
      setShowLateModal(true); setFaceAction('checkin');
    } else {
      doCheckIn(false, '');
    }
  };

  const onFaceVerified = async (descriptor) => {
    setShowFaceVerify(false);
    try {
      await faceAPI.verify(descriptor);
      setVerifiedDescriptor(descriptor);
      if (faceAction === 'checkin') {
        if (lateNow) { setShowLateModal(true); }
        else { doCheckIn(true, ''); }
      } else if (faceAction === 'checkout') {
        doCheckOut(true);
      } else if (faceAction === 'override') {
        setShowOverrideModal(true);
      }
    } catch (err) {
      toast(err.response?.data?.error || 'Face verification failed', 'error');
      setVerifiedDescriptor(null);
    }
  };

  const onLateSubmit = () => {
    const reason = lateReason === 'Other' ? lateReasonOther : lateReason;
    if (!reason) { toast('Please select or enter a reason', 'error'); return; }
    setShowLateModal(false);
    doCheckIn(!!verifiedDescriptor, reason);
  };

  const doCheckIn = async (faceVerified, lateReasonText) => {
    if (!location || !selectedZone) return;
    setLoading(true);
    try {
      const r = await attendanceAPI.checkin({
        lat: location.lat, lng: location.lng,
        zoneId: selectedZone.id, faceVerified, lateReason: lateReasonText
      });
      toast(
        r.data.late ? `Checked in (Late) — ${lateReasonText || 'No reason given'}` : 'Checked in successfully! ✓',
        r.data.late ? 'warning' : 'success'
      );
      setVerifiedDescriptor(null); setLateReason(''); setLateReasonOther('');
      loadTodayRecord(); loadHistory();
    } catch (err) {
      toast(err.response?.data?.error || 'Check-in failed', 'error');
    } finally { setLoading(false); }
  };

  // ── Check-out flow ─────────────────────────────────────────────────────────
  const initiateCheckOut = () => {
    if (settings.requireFaceAuth && faceEnrolled) {
      setFaceAction('checkout'); setShowFaceVerify(true);
    } else {
      doCheckOut(false);
    }
  };

  const doCheckOut = async (faceVerified) => {
    if (!location || !selectedZone) return;
    setLoading(true);
    try {
      await attendanceAPI.checkout({ lat: location.lat, lng: location.lng, zoneId: selectedZone.id, faceVerified });
      toast('Checked out successfully! ✓', 'success');
      setVerifiedDescriptor(null);
      loadTodayRecord();
    } catch (err) {
      toast(err.response?.data?.error || 'Check-out failed', 'error');
    } finally { setLoading(false); }
  };

  // ── Override request ───────────────────────────────────────────────────────
  const initiateOverride = (action) => {
    setOverrideAction(action);
    if (settings.requireFaceAuth && faceEnrolled) {
      setFaceAction('override'); setShowFaceVerify(true);
    } else {
      setShowOverrideModal(true);
    }
  };

  const submitOverride = async () => {
    if (!overrideReason.trim()) { toast('Please provide a reason', 'error'); return; }
    setLoading(true);
    try {
      await attendanceAPI.requestOverride({
        zoneId: selectedZone?.id, action: overrideAction,
        reason: overrideReason, faceVerified: !!verifiedDescriptor,
        lat: location?.lat, lng: location?.lng
      });
      toast('Override request submitted. Awaiting admin approval.', 'info');
      setShowOverrideModal(false); setOverrideReason(''); setVerifiedDescriptor(null);
      loadMyOverride();
    } catch (err) {
      toast(err.response?.data?.error || 'Request failed', 'error');
    } finally { setLoading(false); }
  };

  // ── Face enroll ────────────────────────────────────────────────────────────
  const handleFaceEnrolled = async (descriptor) => {
    setShowFaceEnroll(false);
    try {
      await faceAPI.enroll(descriptor);
      setFaceEnrolled(true);
      toast('Face enrolled successfully!', 'success');
    } catch (err) {
      toast(err.response?.data?.error || 'Enroll failed', 'error');
    }
  };

  const pendingOverride = myOverride.find(r => r.status === 'pending');

  // ── Holiday / blocked screens ──────────────────────────────────────────────
  if (holiday) return (
    <div style={{ padding: 24 }}>
      <div className="card" style={{ textAlign: 'center', padding: 56, maxWidth: 480, margin: '0 auto' }}>
        <div style={{ fontSize: 52, marginBottom: 14 }}>🎉</div>
        <h2 style={{ fontFamily: 'var(--display)', fontSize: 24, fontWeight: 800, marginBottom: 8 }}>{holiday.name}</h2>
        <p style={{ color: 'var(--text2)' }}>Today is a holiday — no attendance required.</p>
        <span className="badge badge-amber" style={{ marginTop: 14 }}>
          {holiday.type === 'public' ? '🏛️ Public Holiday' : '🏢 Company Holiday'}
        </span>
      </div>
    </div>
  );

  if (user?.blocked) return (
    <div style={{ padding: 24 }}>
      <div className="card" style={{ textAlign: 'center', padding: 56, maxWidth: 480, margin: '0 auto', borderColor: 'rgba(248,113,113,0.3)' }}>
        <div style={{ fontSize: 52, marginBottom: 14 }}>🚫</div>
        <h2 style={{ fontFamily: 'var(--display)', fontSize: 24, fontWeight: 800, color: 'var(--red)', marginBottom: 8 }}>Account Blocked</h2>
        <p style={{ color: 'var(--text2)' }}>Your account has been blocked. Please contact HR.</p>
      </div>
    </div>
  );

  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: 26, fontWeight: 800 }}>Check In / Out</h1>
          <p style={{ color: 'var(--text2)', fontSize: 14 }}>
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {faceEnrolled
            ? <span className="badge badge-green" style={{ fontSize: 12 }}>🔒 Face Enrolled</span>
            : <button className="btn btn-ghost btn-sm" onClick={() => setShowFaceEnroll(true)}>👤 Enroll Face</button>
          }
        </div>
      </div>

      {/* Pending override banner */}
      {pendingOverride && (
        <div style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
          <span style={{ fontSize: 18 }}>⏳</span>
          <div>
            <div style={{ fontWeight: 600, color: 'var(--amber)' }}>Override request pending</div>
            <div style={{ color: 'var(--text2)' }}>Waiting for admin to approve your out-of-zone {pendingOverride.action} request.</div>
          </div>
        </div>
      )}

      {/* Early check in warning */}
      {tooEarly && !todayRecord?.checkIn && (
        <div style={{ background: 'rgba(91,156,246,0.08)', border: '1px solid rgba(91,156,246,0.25)', borderRadius: 10, padding: '10px 16px', marginBottom: 16, fontSize: 13, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 8 }}>
          🕐 Check-in is not open yet. You can check in from <strong style={{ marginLeft: 4 }}>{settings.checkInOpenTime || '08:00'}</strong>.
        </div>
      )}

      {/* Late warning */}
      {lateNow && !todayRecord?.checkIn && (
        <div style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 10, padding: '10px 16px', marginBottom: 16, fontSize: 13, color: 'var(--amber)', display: 'flex', alignItems: 'center', gap: 8 }}>
          ⏰ You are past the grace period ({settings.workStartTime || '09:00'} + {settings.lateGraceMinutes || 15}m). A reason will be required.
        </div>
      )}

      <div className="grid-2" style={{ gap: 20, alignItems: 'start' }}>
        {/* Left — Map + GPS */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)' }}>Live Location</span>
              <span className={`badge ${isInside ? 'badge-green' : location ? 'badge-red' : 'badge-amber'}`}>
                <span className="badge-dot pulsing" />
                {isInside ? 'Inside Zone' : location ? 'Outside Zone' : 'Locating…'}
              </span>
            </div>
            <GeoMap userLocation={location} activeZone={selectedZone} allZones={zones} />
          </div>

          <div className="card">
            <div className="card-title">GPS Signal</div>
            {location ? (
              <div style={{ fontFamily: 'var(--mono)', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 7 }}>
                {[
                  ['Latitude',    `${location.lat.toFixed(6)}°`,                      'var(--accent)'],
                  ['Longitude',   `${location.lng.toFixed(6)}°`,                      'var(--accent)'],
                  ['Accuracy',    `±${Math.round(location.accuracy)}m`,               'var(--amber)'],
                  ['Distance',    distance !== null ? `${distance}m` : '—',           isInside ? 'var(--green)' : 'var(--red)']
                ].map(([k, v, c]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text2)' }}>{k}</span>
                    <span style={{ color: c, fontWeight: 600 }}>{v}</span>
                  </div>
                ))}
                <div style={{ height: 4, background: 'var(--bg3)', borderRadius: 2, marginTop: 4, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.max(5, 100 - Math.min(100, location.accuracy))}%`, background: 'var(--green)', borderRadius: 2 }} />
                </div>
              </div>
            ) : (
              <div style={{ color: 'var(--text3)', fontSize: 13 }}>{locError || 'Acquiring GPS…'}</div>
            )}
            {locError && <p style={{ fontSize: 11, color: 'var(--amber)', marginTop: 8 }}>⚠ Demo mode — using simulated coordinates</p>}
          </div>

          <div className="card">
            <div className="card-title">Zone</div>
            <select className="form-select" value={selectedZone?.id || ''} onChange={e => setSelectedZone(zones.find(z => z.id === e.target.value))}>
              {zones.map(z => <option key={z.id} value={z.id}>{z.icon} {z.name}</option>)}
            </select>
            {selectedZone && <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 8, fontFamily: 'var(--mono)' }}>{selectedZone.address} · r={selectedZone.radius}m</p>}
          </div>
        </div>

        {/* Right — Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div className="card-title">Today's Attendance</div>

            {/* Check-in / Check-out times — fmtTime uses new Date() so TZ is correct */}
            <div className="grid-2" style={{ gap: 10, marginBottom: 18 }}>
              <div className="stat-card">
                <div className="stat-label">Check In</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 700, color: 'var(--green)' }}>
                  {fmtTime(todayRecord?.checkIn)}
                </div>
                {todayRecord?.status === 'late' && <span className="badge badge-amber" style={{ fontSize: 10, marginTop: 4 }}>Late</span>}
              </div>
              <div className="stat-card">
                <div className="stat-label">Check Out</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 700, color: 'var(--accent)' }}>
                  {fmtTime(todayRecord?.checkOut)}
                </div>
              </div>
            </div>

            {!todayRecord?.checkIn ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button
                  onClick={initiateCheckIn}
                  disabled={!isInside || loading || tooEarly}
                  style={{ padding: 16, fontSize: 15, fontWeight: 700, width: '100%', background: isInside ? 'linear-gradient(135deg,#059669,#34d399)' : 'var(--surface)', color: 'white', border: 'none', borderRadius: 12, cursor: isInside ? 'pointer' : 'not-allowed', opacity: isInside ? 1 : 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                >
                  {loading ? <span className="pulsing">⟳</span> : null}
                  {settings.requireFaceAuth && faceEnrolled ? '🔒 Face + Check In' : '📍 Check In'}
                </button>
                {!isInside && location && (
                  <>
                    <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--red)', margin: 0 }}>{distance}m from {selectedZone?.name}</p>
                    {settings.allowOutOfZoneRequest && (
                      <button className="btn btn-amber btn-full" onClick={() => initiateOverride('checkin')} disabled={!!pendingOverride || loading}>
                        📡 Request Out-of-Zone Check-in
                      </button>
                    )}
                  </>
                )}
              </div>
            ) : !todayRecord?.checkOut ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)', borderRadius: 10, padding: 12, textAlign: 'center', fontSize: 13 }}>
                  <div style={{ color: 'var(--green)', fontWeight: 600 }}>✓ Checked in at {fmtTime(todayRecord?.checkIn)}</div>
                  {todayRecord?.lateReason && <div style={{ color: 'var(--amber)', fontSize: 11, marginTop: 3 }}>Reason: {todayRecord.lateReason}</div>}
                </div>
                <button
                  onClick={initiateCheckOut}
                  disabled={!isInside || loading}
                  style={{ padding: 16, fontSize: 15, fontWeight: 700, width: '100%', background: isInside ? 'linear-gradient(135deg,#9b2c2c,#f87171)' : 'var(--surface)', color: 'white', border: 'none', borderRadius: 12, cursor: isInside ? 'pointer' : 'not-allowed', opacity: isInside ? 1 : 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                >
                  {settings.requireFaceAuth && faceEnrolled ? '🔒 Face + Check Out' : '🚪 Check Out'}
                </button>
                {!isInside && location && settings.allowOutOfZoneRequest && (
                  <button className="btn btn-amber btn-full" onClick={() => initiateOverride('checkout')} disabled={!!myOverride.find(r => r.action === 'checkout' && r.status === 'pending') || loading}>
                    📡 Request Out-of-Zone Check-out
                  </button>
                )}
              </div>
            ) : (
              <div style={{ background: 'rgba(91,156,246,0.08)', border: '1px solid rgba(91,156,246,0.2)', borderRadius: 10, padding: 20, textAlign: 'center' }}>
                <div style={{ fontSize: 28, marginBottom: 6 }}>✅</div>
                <div style={{ fontWeight: 700, color: 'var(--accent)', fontSize: 15 }}>All done for today!</div>
                <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 4 }}>
                  In: {fmtTime(todayRecord?.checkIn)} → Out: {fmtTime(todayRecord?.checkOut)}
                </div>
                <div style={{ fontSize: 13, color: 'var(--green)', marginTop: 4 }}>
                  Total: {fmtDuration(todayRecord?.checkIn, todayRecord?.checkOut)}
                </div>
              </div>
            )}
          </div>

          {/* Face status card */}
          {settings.requireFaceAuth && (
            <div className="card" style={{ borderColor: faceEnrolled ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.3)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 28 }}>{faceEnrolled ? '🔒' : '🔓'}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: faceEnrolled ? 'var(--green)' : 'var(--red)' }}>
                    {faceEnrolled ? 'Face Authentication Active' : 'Face Not Enrolled'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
                    {faceEnrolled ? 'Identity verified on every check-in/out.' : 'Enroll your face to enable biometric attendance.'}
                  </div>
                </div>
                {!faceEnrolled && <button className="btn btn-primary btn-sm" onClick={() => setShowFaceEnroll(true)}>Enroll</button>}
              </div>
            </div>
          )}

          {/* Weekly streak */}
          <div className="card">
            <div className="card-title">This Week</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[6, 5, 4, 3, 2, 1, 0].map(i => {
                const d = new Date(Date.now() - i * 86400000);
                const ds = d.toISOString().split('T')[0];
                const rec = history.find(r => r.date === ds);
                const isToday = i === 0;
                const isPresent = rec?.status === 'present';
                const isLateDay = rec?.status === 'late';
                return (
                  <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{
                      aspectRatio: '1/1', borderRadius: 8, fontSize: 10,
                      border: `1px solid ${isToday ? 'rgba(91,156,246,0.5)' : isPresent ? 'rgba(52,211,153,0.3)' : isLateDay ? 'rgba(251,191,36,0.3)' : 'var(--border)'}`,
                      background: isPresent ? 'rgba(52,211,153,0.12)' : isLateDay ? 'rgba(251,191,36,0.12)' : isToday ? 'rgba(91,156,246,0.08)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: isPresent ? 'var(--green)' : isLateDay ? 'var(--amber)' : isToday ? 'var(--accent)' : 'var(--text3)'
                    }}>
                      {isPresent ? '✓' : isLateDay ? '⏰' : isToday ? '·' : '—'}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>{d.toLocaleDateString('en-IN', { weekday: 'short' }).slice(0, 2)}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recent history — uses fmtTime so times are correct */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600, color: 'var(--text2)' }}>
              Recent Attendance
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>In</th><th>Out</th><th>Status</th></tr></thead>
                <tbody>
                  {history.slice(0, 7).map(r => (
                    <tr key={r.id}>
                      <td className="primary mono">
                        {new Date(r.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </td>
                      <td className="mono" style={{ fontSize: 12 }}>{fmtTime(r.checkIn)}</td>
                      <td className="mono" style={{ fontSize: 12 }}>{fmtTime(r.checkOut)}</td>
                      <td>
                        <span className={`badge badge-${r.status === 'present' ? 'green' : r.status === 'late' ? 'amber' : r.status === 'absent' ? 'red' : 'gray'}`}>
                          <span className="badge-dot" />{r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {!history.length && (
                    <tr><td colSpan={4}><div className="empty-state"><div className="empty-icon">📋</div><div className="empty-text">No records yet</div></div></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* ── Modals ── */}
      {showFaceEnroll && (
        <Modal title="Enroll Your Face" onClose={() => setShowFaceEnroll(false)} maxWidth={380}>
          <FaceAuth mode="enroll" userName={user.name} onSuccess={handleFaceEnrolled} onCancel={() => setShowFaceEnroll(false)} />
        </Modal>
      )}
      {showFaceVerify && (
        <Modal title="Face Verification" onClose={() => { setShowFaceVerify(false); setVerifiedDescriptor(null); }} maxWidth={380}>
          <FaceAuth mode="verify" userName={user.name} onSuccess={onFaceVerified} onCancel={() => { setShowFaceVerify(false); setVerifiedDescriptor(null); }} />
        </Modal>
      )}
      {showLateModal && (
        <Modal title="⏰ Late Arrival — Reason Required" onClose={() => setShowLateModal(false)}>
          <div style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 13, color: 'var(--amber)' }}>
            You are checking in after the allowed grace period. Please provide a reason.
          </div>
          <div className="form-group">
            <label className="form-label">Reason for Late Arrival</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {LATE_REASONS.map(r => (
                <label key={r} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', border: `1px solid ${lateReason === r ? 'var(--accent2)' : 'var(--border)'}`, borderRadius: 8, cursor: 'pointer', background: lateReason === r ? 'rgba(59,130,246,0.08)' : 'transparent', fontSize: 13 }}>
                  <input type="radio" name="lateReason" value={r} checked={lateReason === r} onChange={() => setLateReason(r)} />
                  {r}
                </label>
              ))}
            </div>
          </div>
          {lateReason === 'Other' && (
            <div className="form-group">
              <label className="form-label">Please specify</label>
              <input className="form-input" placeholder="Enter your reason…" value={lateReasonOther} onChange={e => setLateReasonOther(e.target.value)} autoFocus />
            </div>
          )}
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setShowLateModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={onLateSubmit} disabled={!lateReason}>Submit & Check In</button>
          </div>
        </Modal>
      )}
      {showOverrideModal && (
        <Modal title="📡 Out-of-Zone Override Request" onClose={() => { setShowOverrideModal(false); setOverrideReason(''); }}>
          <div style={{ background: 'rgba(91,156,246,0.08)', border: '1px solid rgba(91,156,246,0.2)', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 13, color: 'var(--accent)' }}>
            You are {distance}m away from <strong>{selectedZone?.name}</strong>. Your request will be sent to admin for approval.
            {verifiedDescriptor && <div style={{ marginTop: 4, color: 'var(--green)' }}>✓ Face authentication completed</div>}
          </div>
          <div className="form-group">
            <label className="form-label">Action</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {['checkin', 'checkout'].map(a => (
                <label key={a} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', border: `1px solid ${overrideAction === a ? 'var(--accent2)' : 'var(--border)'}`, borderRadius: 8, cursor: 'pointer', background: overrideAction === a ? 'rgba(59,130,246,0.08)' : 'transparent', fontSize: 13 }}>
                  <input type="radio" name="action" checked={overrideAction === a} onChange={() => setOverrideAction(a)} />
                  {a === 'checkin' ? '📍 Check In' : '🚪 Check Out'}
                </label>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Reason for being out of zone *</label>
            <textarea className="form-textarea" placeholder="e.g. Working from client site, field visit…" value={overrideReason} onChange={e => setOverrideReason(e.target.value)} rows={3} />
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => { setShowOverrideModal(false); setOverrideReason(''); }}>Cancel</button>
            <button className="btn btn-primary" onClick={submitOverride} disabled={!overrideReason.trim() || loading}>Submit Request</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
