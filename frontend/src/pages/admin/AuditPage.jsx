import React, { useState, useEffect } from 'react';
import { auditAPI, usersAPI } from '../../services/api';

const ACTION_META = {
  CREATE_USER:     { icon: '➕', color: 'green',  label: 'User Created' },
  UPDATE_USER:     { icon: '✏️', color: 'blue',   label: 'User Updated' },
  DELETE_USER:     { icon: '🗑️', color: 'red',    label: 'User Deleted' },
  BLOCK_USER:      { icon: '🚫', color: 'red',    label: 'User Blocked' },
  UNBLOCK_USER:    { icon: '✅', color: 'green',  label: 'User Unblocked' },
  CREATE_ZONE:     { icon: '📍', color: 'purple', label: 'Zone Created' },
  UPDATE_ZONE:     { icon: '🗺️', color: 'blue',  label: 'Zone Updated' },
  DELETE_ZONE:     { icon: '🗑️', color: 'red',   label: 'Zone Deleted' },
  CREATE_HOLIDAY:  { icon: '🎉', color: 'amber',  label: 'Holiday Marked' },
  DELETE_HOLIDAY:  { icon: '❌', color: 'red',    label: 'Holiday Removed' },
  EDIT_ATTENDANCE: { icon: '📊', color: 'amber',  label: 'Attendance Edited' },
  BULK_ATTENDANCE: { icon: '⚡', color: 'purple', label: 'Bulk Update' },
};

export default function AuditPage() {
  const [logs, setLogs] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    auditAPI.list().then(r => setLogs(r.data)).catch(() => {}).finally(() => setLoading(false));
    usersAPI.list().then(r => setUsers(r.data)).catch(() => {});
  }, []);

  const getUserName = (id) => users.find(u => u.id === id)?.name || 'System';
  const filtered = logs.filter(l =>
    !filter || l.action.includes(filter.toUpperCase()) || l.details?.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div style={{ padding: 24 }}>
      <div className="flex-between mb-24">
        <div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: 26, fontWeight: 800 }}>Audit Log</h1>
          <p style={{ color: 'var(--text2)', fontSize: 14 }}>All admin actions are logged here</p>
        </div>
      </div>

      <div className="card mb-24" style={{ padding: '14px 18px' }}>
        <input className="form-input" placeholder="Search actions or details..." value={filter} onChange={e => setFilter(e.target.value)} style={{ maxWidth: 360 }} />
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div className="empty-state"><div className="pulsing empty-icon">⟳</div></div>
        ) : filtered.length ? (
          <div>
            {filtered.map((log, i) => {
              const meta = ACTION_META[log.action] || { icon: '📋', color: 'gray', label: log.action };
              return (
                <div key={log.id} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 20px',
                  borderBottom: '1px solid var(--border)',
                  animation: `slideUp 0.2s ease ${i * 0.02}s both`
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                    background: `rgba(var(--${meta.color}-rgb, 91,156,246),0.1)`,
                    border: `1px solid rgba(var(--${meta.color}-rgb, 91,156,246),0.2)`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16
                  }}>{meta.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{meta.label}</span>
                      <span className={`badge badge-${meta.color}`} style={{ fontSize: 10 }}>{log.action}</span>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 3 }}>{log.details}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4, fontFamily: 'var(--mono)' }}>
                      by <span style={{ color: 'var(--accent)' }}>{getUserName(log.userId)}</span>
                      &nbsp;·&nbsp;
                      {new Date(log.timestamp).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-icon">🔍</div>
            <div className="empty-text">{filter ? 'No matching logs' : 'No audit logs yet'}</div>
          </div>
        )}
      </div>
    </div>
  );
}
