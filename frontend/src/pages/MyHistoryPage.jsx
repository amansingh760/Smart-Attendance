import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { attendanceAPI, leavesAPI } from '../services/api';
import { fmtTime, fmtDuration } from '../utils/timeUtils';

export default function MyHistoryPage() {
  const { user } = useAuth();
  const [records, setRecords]   = useState([]);
  const [leaves, setLeaves]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [tab, setTab]           = useState('attendance'); // 'attendance' | 'leaves'
  const [month, setMonth]       = useState(new Date().toISOString().slice(0, 7));

  useEffect(() => {
    setLoading(true);
    Promise.all([
      attendanceAPI.list({ userId: user.id, from: `${month}-01`, to: `${month}-31` }),
      leavesAPI.myLeaves()
    ])
      .then(([ar, lr]) => { setRecords(ar.data); setLeaves(lr.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [month, user.id]);

  const presentCount  = records.filter(r => r.status === 'present').length;
  const lateCount     = records.filter(r => r.status === 'late').length;
  const onLeaveCount  = records.filter(r => r.status === 'on-leave').length;
  const absentCount   = records.filter(r => r.status === 'absent').length;

  const leaveStatusColor = s => ({ pending:'amber', approved:'green', rejected:'red', cancelled:'gray' }[s] || 'gray');

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <div className="flex-between mb-24">
        <div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: 26, fontWeight: 800 }}>My History</h1>
          <p style={{ color: 'var(--text2)', fontSize: 14 }}>Personal attendance &amp; leave log</p>
        </div>
        <input type="month" className="form-input" value={month}
          onChange={e => setMonth(e.target.value)} style={{ width: 168 }} />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {[['attendance','📊 Attendance'],['leaves','🏖️ My Leaves']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`btn btn-sm ${tab === id ? 'btn-primary' : 'btn-ghost'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'attendance' && (
        <>
          <div className="grid-4 mb-24">
            {[
              ['Present',  presentCount,  'green'],
              ['Late',     lateCount,     'amber'],
              ['On Leave', onLeaveCount,  'blue'],
              ['Absent',   absentCount,   'red']
            ].map(([label, val, color]) => (
              <div key={label} className="stat-card">
                <div className="stat-label">{label}</div>
                <div className="stat-value" style={{ color: `var(--${color})`, fontSize: 26 }}>{val}</div>
              </div>
            ))}
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="table-wrap">
              {loading ? (
                <div className="empty-state"><div className="pulsing empty-icon">⟳</div></div>
              ) : records.length ? (
                <table>
                  <thead>
                    <tr><th>Date</th><th>Day</th><th>Zone</th><th>Check In</th><th>Check Out</th><th>Duration</th><th>Status</th><th>Note</th></tr>
                  </thead>
                  <tbody>
                    {records.map(r => (
                      <tr key={r.id}>
                        <td className="primary mono">{r.date}</td>
                        <td>{new Date(r.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' })}</td>
                        <td style={{ fontSize: 12 }}>{r.zoneName || '—'}</td>
                        <td className="mono" style={{ fontSize: 12 }}>{fmtTime(r.checkIn)}</td>
                        <td className="mono" style={{ fontSize: 12 }}>{fmtTime(r.checkOut)}</td>
                        <td className="mono" style={{ fontSize: 12 }}>{fmtDuration(r.checkIn, r.checkOut)}</td>
                        <td>
                          <span className={`badge badge-${r.status === 'present' ? 'green' : r.status === 'late' ? 'amber' : r.status === 'on-leave' ? 'blue' : r.status === 'absent' ? 'red' : 'gray'}`}>
                            <span className="badge-dot" />{r.status}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text3)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.note || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="empty-state"><div className="empty-icon">📋</div><div className="empty-text">No records for this month</div></div>
              )}
            </div>
          </div>
        </>
      )}

      {tab === 'leaves' && (
        <div>
          {leaves.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {leaves.map(l => (
                <div key={l.id} className="card" style={{ borderColor: l.status === 'pending' ? 'rgba(251,191,36,0.3)' : l.status === 'approved' ? 'rgba(52,211,153,0.25)' : 'var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                        <span style={{ fontWeight: 700, fontSize: 15, textTransform: 'capitalize' }}>{l.type} Leave</span>
                        <span className={`badge badge-${leaveStatusColor(l.status)}`} style={{ fontSize: 11 }}>
                          <span className="badge-dot" />{l.status}
                        </span>
                        <span className="badge badge-blue" style={{ fontSize: 10 }}>{l.days} day{l.days !== 1 ? 's' : ''}{l.halfDay ? ' (half)' : ''}</span>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 4 }}>
                        📅 {l.fromDate === l.toDate ? l.fromDate : `${l.fromDate} → ${l.toDate}`}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text2)' }}>Reason: {l.reason}</div>
                      {l.adminNote && (
                        <div style={{ fontSize: 12, color: l.status === 'approved' ? 'var(--green)' : 'var(--red)', marginTop: 6 }}>
                          Admin note: {l.adminNote}
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'right', flexShrink: 0 }}>
                      Applied: {new Date(l.appliedAt).toLocaleDateString('en-IN')}
                      {l.reviewedAt && <div>Reviewed: {new Date(l.reviewedAt).toLocaleDateString('en-IN')}</div>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="card">
              <div className="empty-state"><div className="empty-icon">🏖️</div><div className="empty-text">No leave applications yet</div></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
