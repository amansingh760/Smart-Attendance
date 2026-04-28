import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { statsAPI, attendanceAPI, usersAPI, zonesAPI, leavesAPI } from '../../services/api';
import GeoMap from '../../components/GeoMap';
import { fmtTime } from '../../utils/timeUtils';

export default function DashboardPage() {
  const navigate = useNavigate();
  const [stats, setStats]               = useState(null);
  const [todayRecs, setTodayRecs]       = useState([]);
  const [users, setUsers]               = useState([]);
  const [zones, setZones]               = useState([]);
  const [pendingOverrides, setPendingOverrides] = useState([]);
  const [pendingLeaves, setPendingLeaves]       = useState([]);
  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    statsAPI.get().then(r => setStats(r.data)).catch(() => {});
    attendanceAPI.list({ date: today }).then(r => setTodayRecs(r.data)).catch(() => {});
    usersAPI.list().then(r => setUsers(r.data.filter(u => u.role !== 'admin'))).catch(() => {});
    zonesAPI.list().then(r => setZones(r.data)).catch(() => {});
    attendanceAPI.getOverrideRequests('pending').then(r => setPendingOverrides(r.data)).catch(() => {});
    leavesAPI.list({ status: 'pending' }).then(r => setPendingLeaves(r.data)).catch(() => {});
  }, []);

  const statCards = stats ? [
    { label: 'Total Staff',       value: stats.totalStaff,                                             color: 'blue',   icon: '👥',  link: '/employees' },
    { label: 'Present Today',     value: stats.presentToday,                                           color: 'green',  icon: '✅',  link: '/attendance' },
    { label: 'Late Today',        value: stats.lateToday,                                              color: 'amber',  icon: '⏰',  link: '/attendance' },
    { label: 'Absent Today',      value: stats.absentToday,                                            color: 'red',    icon: '❌',  link: '/attendance' },
    { label: 'Avg Attendance',    value: `${stats.avgAttendance}%`,                                    color: 'amber',  icon: '📊',  link: '/monthly-report' },
    { label: 'Pending Overrides', value: stats.pendingOverrides,                                       color: stats.pendingOverrides > 0 ? 'amber' : 'blue', icon: '📡', link: '/overrides' },
    { label: 'Pending Leaves',    value: pendingLeaves.length,                                         color: pendingLeaves.length > 0 ? 'amber' : 'blue',   icon: '🏖️', link: '/admin-leaves' },
    { label: 'Active Zones',      value: stats.activeZones,                                            color: 'purple', icon: '🗺️', link: '/zones' },
    { label: 'Holidays/Month',    value: stats.holidaysThisMonth,                                      color: 'blue',   icon: '🎉',  link: '/holidays' },
  ] : [];

  return (
    <div style={{ padding: 24 }}>
      <div className="mb-24">
        <h1 style={{ fontFamily: 'var(--display)', fontSize: 26, fontWeight: 800 }}>Dashboard</h1>
        <p style={{ color: 'var(--text2)', fontSize: 14 }}>
          {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(148px,1fr))', gap: 12, marginBottom: 24 }}>
        {statCards.map(s => (
          <div key={s.label} className="stat-card"
            style={{ cursor: 'pointer', transition: 'border-color 0.15s' }}
            onClick={() => navigate(s.link)}
            onMouseEnter={e => e.currentTarget.style.borderColor = `var(--${s.color})`}
            onMouseLeave={e => e.currentTarget.style.borderColor = ''}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>{s.icon}</div>
            <div className="stat-label">{s.label}</div>
            <div className="stat-value" style={{ color: `var(--${s.color})`, fontSize: 24 }}>{s.value ?? '—'}</div>
          </div>
        ))}
      </div>

      {/* Alert banners */}
      {pendingOverrides.length > 0 && (
        <div onClick={() => navigate('/overrides')} style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 10, padding: '12px 18px', marginBottom: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 22 }}>📡</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: 'var(--amber)', fontSize: 14 }}>{pendingOverrides.length} out-of-zone override request{pendingOverrides.length > 1 ? 's' : ''} need review</div>
            <div style={{ fontSize: 12, color: 'var(--text2)' }}>{pendingOverrides.map(r => r.userName).join(', ')}</div>
          </div>
          <span style={{ color: 'var(--amber)' }}>→</span>
        </div>
      )}
      {pendingLeaves.length > 0 && (
        <div onClick={() => navigate('/admin-leaves')} style={{ background: 'rgba(99,179,237,0.08)', border: '1px solid rgba(99,179,237,0.25)', borderRadius: 10, padding: '12px 18px', marginBottom: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 22 }}>🏖️</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: 'var(--accent)', fontSize: 14 }}>{pendingLeaves.length} leave request{pendingLeaves.length > 1 ? 's' : ''} awaiting approval</div>
            <div style={{ fontSize: 12, color: 'var(--text2)' }}>{pendingLeaves.map(r => r.userName).join(', ')}</div>
          </div>
          <span style={{ color: 'var(--accent)' }}>→</span>
        </div>
      )}

      <div className="grid-2" style={{ gap: 20 }}>
        {/* Today's check-ins */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 15 }}>Today's Check-ins</span>
          </div>
          {users.length ? users.map(u => {
            const rec = todayRecs.find(r => r.userId === u.id);
            const sc  = rec?.status === 'present' ? 'green' : rec?.status === 'late' ? 'amber' : rec?.status === 'on-leave' ? 'blue' : rec?.status === 'absent' ? 'red' : 'gray';
            return (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 18px', borderBottom: '1px solid var(--border)' }}>
                <div className="avatar avatar-sm" style={{ background: `${u.color}22`, color: u.color }}>{u.avatar}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>{u.dept}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  {rec?.checkIn && <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--green)', marginBottom: 2 }}>{fmtTime(rec.checkIn)}</div>}
                  <span className={`badge badge-${sc}`} style={{ fontSize: 10 }}><span className="badge-dot" />{rec?.status || 'pending'}</span>
                  {rec?.faceVerified && <div style={{ fontSize: 10, color: 'var(--green)', marginTop: 2 }}>🔒 Face</div>}
                  {u.blocked && <span className="badge badge-red" style={{ fontSize: 10, marginLeft: 4 }}>Blocked</span>}
                </div>
              </div>
            );
          }) : <div className="empty-state"><div className="empty-icon">👥</div><div className="empty-text">No staff found</div></div>}
        </div>

        {/* Zone map */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 15 }}>Live Zone View</span>
              <span className="badge badge-green"><span className="badge-dot pulsing" />Live</span>
            </div>
            {zones[0] && <GeoMap activeZone={zones[0]} allZones={zones} />}
          </div>
          <div className="card">
            <div className="card-title">Zones</div>
            {zones.map(z => (
              <div key={z.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 18 }}>{z.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{z.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>r={z.radius}m · {z.address}</div>
                </div>
                <span className="badge badge-green" style={{ fontSize: 10 }}>Active</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
