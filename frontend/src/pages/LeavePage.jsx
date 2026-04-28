import React, { useState, useEffect } from 'react';
import { leavesAPI, holidaysAPI } from '../services/api';
import { useToast } from '../contexts/ToastContext';

const LEAVE_TYPES = [
  { value: 'casual',     label: '🏖️ Casual Leave',     color: 'blue' },
  { value: 'sick',       label: '🤒 Sick Leave',         color: 'red' },
  { value: 'other',      label: '📋 Other',              color: 'gray' }
];

const STATUS_COLOR = { pending:'amber', approved:'green', rejected:'red', cancelled:'gray' };

function Modal({ title, onClose, children, maxWidth = 500 }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth }}>
        <div className="flex-between mb-16">
          <h2 className="modal-title" style={{ margin: 0 }}>{title}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function LeavePage() {
  const { toast } = useToast();
  const [leaves, setLeaves]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showApply, setShowApply] = useState(false);
  const [holidays, setHolidays]   = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [filter, setFilter]       = useState('all');

  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({
    type: 'casual', fromDate: today, toDate: today,
    reason: '', halfDay: false
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const load = async () => {
    setLoading(true);
    try {
      const [lr, hr] = await Promise.all([leavesAPI.myLeaves(), holidaysAPI.list()]);
      setLeaves(lr.data);
      setHolidays(hr.data.map(h => h.date));
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Calculate working days preview
  const workingDays = (() => {
    if (!form.fromDate || !form.toDate || form.fromDate > form.toDate) return 0;
    let count = 0;
    const hSet = new Set(holidays);
    const from = new Date(form.fromDate + 'T00:00:00');
    const to   = new Date(form.toDate + 'T00:00:00');
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      if (d.getDay() !== 0 && !hSet.has(d.toISOString().split('T')[0])) count++;
    }
    return form.halfDay && count === 1 ? 0.5 : count;
  })();

  const handleApply = async () => {
    if (!form.type || !form.fromDate || !form.toDate || !form.reason.trim()) {
      toast('Please fill all required fields', 'error'); return;
    }
    if (form.fromDate > form.toDate) { toast('End date must be after start date', 'error'); return; }
    if (!form.reason.trim()) { toast('Please provide a reason', 'error'); return; }
    setSubmitting(true);
    try {
      await leavesAPI.apply(form);
      toast('Leave application submitted!', 'success');
      setShowApply(false);
      setForm({ type: 'casual', fromDate: today, toDate: today, reason: '', halfDay: false });
      load();
    } catch (err) {
      toast(err.response?.data?.error || 'Application failed', 'error');
    } finally { setSubmitting(false); }
  };

  const handleCancel = async (leave) => {
    if (!window.confirm(`Cancel this ${leave.type} leave request?`)) return;
    try {
      await leavesAPI.cancel(leave.id);
      toast('Leave request cancelled', 'success');
      load();
    } catch (err) {
      toast(err.response?.data?.error || 'Cancel failed', 'error');
    }
  };

  const filtered = leaves.filter(l => filter === 'all' || l.status === filter);
  const pending  = leaves.filter(l => l.status === 'pending').length;
  const approved = leaves.filter(l => l.status === 'approved').length;

  return (
    <div style={{ padding: 24, maxWidth: 820, margin: '0 auto' }}>
      <div className="flex-between mb-24">
        <div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: 26, fontWeight: 800 }}>My Leaves</h1>
          <p style={{ color: 'var(--text2)', fontSize: 14 }}>Apply and track your leave requests</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowApply(true)}>+ Apply for Leave</button>
      </div>

      {/* Summary stats */}
      <div className="grid-4 mb-24">
        {[
          ['Total Applied', leaves.length,                              'blue'],
          ['Pending',       pending,                                    'amber'],
          ['Approved',      approved,                                   'green'],
          ['Rejected',      leaves.filter(l=>l.status==='rejected').length, 'red']
        ].map(([label, val, color]) => (
          <div key={label} className="stat-card">
            <div className="stat-label">{label}</div>
            <div className="stat-value" style={{ color: `var(--${color})`, fontSize: 26 }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {['all','pending','approved','rejected','cancelled'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`btn btn-sm ${filter === s ? 'btn-primary' : 'btn-ghost'}`}
            style={{ textTransform: 'capitalize' }}>
            {s === 'all' ? 'All' : s}
          </button>
        ))}
      </div>

      {/* Leave list */}
      {loading ? (
        <div className="empty-state"><div className="pulsing empty-icon" style={{ fontSize: 32 }}>⟳</div></div>
      ) : filtered.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.map(l => {
            const typeInfo = LEAVE_TYPES.find(t => t.value === l.type) || LEAVE_TYPES[LEAVE_TYPES.length - 1];
            return (
              <div key={l.id} className="card" style={{
                borderColor: l.status === 'pending' ? 'rgba(251,191,36,0.3)'
                  : l.status === 'approved' ? 'rgba(52,211,153,0.25)'
                  : l.status === 'rejected' ? 'rgba(248,113,113,0.2)'
                  : 'var(--border)'
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    {/* Header row */}
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
                      <span style={{ fontWeight: 700, fontSize: 15 }}>{typeInfo.label}</span>
                      <span className={`badge badge-${STATUS_COLOR[l.status] || 'gray'}`} style={{ fontSize: 11 }}>
                        <span className="badge-dot" />{l.status}
                      </span>
                      <span className="badge badge-blue" style={{ fontSize: 10 }}>
                        {l.days} day{l.days !== 1 ? 's' : ''}{l.halfDay ? ' (half day)' : ''}
                      </span>
                    </div>

                    {/* Dates */}
                    <div style={{ display: 'flex', gap: 20, marginBottom: 8, flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>From</div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text)' }}>{l.fromDate}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>To</div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text)' }}>{l.toDate}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Applied</div>
                        <div style={{ fontSize: 13, color: 'var(--text2)' }}>{new Date(l.appliedAt).toLocaleDateString('en-IN')}</div>
                      </div>
                    </div>

                    {/* Reason */}
                    <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: 'var(--text2)', marginBottom: l.adminNote ? 8 : 0 }}>
                      <span style={{ fontSize: 11, color: 'var(--text3)' }}>Reason: </span>{l.reason}
                    </div>

                    {/* Admin note */}
                    {l.adminNote && (
                      <div style={{
                        borderRadius: 8, padding: '8px 12px', fontSize: 12, marginTop: 8,
                        background: l.status === 'approved' ? 'rgba(52,211,153,0.07)' : 'rgba(248,113,113,0.07)',
                        color: l.status === 'approved' ? 'var(--green)' : 'var(--red)',
                        border: `1px solid ${l.status === 'approved' ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)'}`
                      }}>
                        💬 Admin: {l.adminNote}
                      </div>
                    )}
                  </div>

                  {/* Cancel button */}
                  {l.status === 'pending' && (
                    <button className="btn btn-danger btn-sm" onClick={() => handleCancel(l)} style={{ flexShrink: 0 }}>
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card">
          <div className="empty-state">
            <div className="empty-icon">🏖️</div>
            <div className="empty-text">{filter === 'all' ? 'No leave applications yet' : `No ${filter} leaves`}</div>
          </div>
        </div>
      )}

      {/* Apply Modal */}
      {showApply && (
        <Modal title="Apply for Leave" onClose={() => setShowApply(false)}>
          {/* Leave type grid */}
          <div className="form-group">
            <label className="form-label">Leave Type *</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {LEAVE_TYPES.map(t => (
                <label key={t.value} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px',
                  border: `1px solid ${form.type === t.value ? 'var(--accent2)' : 'var(--border)'}`,
                  borderRadius: 8, cursor: 'pointer', fontSize: 13,
                  background: form.type === t.value ? 'rgba(59,130,246,0.08)' : 'transparent'
                }}>
                  <input type="radio" name="leaveType" checked={form.type === t.value} onChange={() => set('type', t.value)} />
                  {t.label}
                </label>
              ))}
            </div>
          </div>

          <div className="grid-2" style={{ gap: 12 }}>
            <div className="form-group">
              <label className="form-label">From Date *</label>
              <input type="date" className="form-input" value={form.fromDate} min={today}
                onChange={e => { set('fromDate', e.target.value); if (e.target.value > form.toDate) set('toDate', e.target.value); }} />
            </div>
            <div className="form-group">
              <label className="form-label">To Date *</label>
              <input type="date" className="form-input" value={form.toDate} min={form.fromDate}
                onChange={e => set('toDate', e.target.value)} />
            </div>
          </div>

          {/* Half day option */}
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13 }}>
              <input type="checkbox" checked={form.halfDay} onChange={e => set('halfDay', e.target.checked)}
                disabled={form.fromDate !== form.toDate} />
              <span style={{ color: form.fromDate !== form.toDate ? 'var(--text3)' : 'var(--text)' }}>
                Half day {form.fromDate !== form.toDate ? '(only available for single-day leaves)' : ''}
              </span>
            </label>
          </div>

          {/* Days preview */}
          {workingDays > 0 && (
            <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18 }}>📅</span>
              <span><strong style={{ color: 'var(--accent)' }}>{workingDays} working day{workingDays !== 1 ? 's' : ''}</strong> will be applied (Sundays &amp; holidays excluded)</span>
            </div>
          )}
          {workingDays === 0 && form.fromDate && (
            <div style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: 'var(--red)' }}>
              ⚠ Selected range has no working days (all Sundays/holidays)
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Reason *</label>
            <textarea className="form-textarea" placeholder="Provide a brief reason for your leave…"
              value={form.reason} onChange={e => set('reason', e.target.value)} rows={3} />
          </div>

          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setShowApply(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleApply}
              disabled={submitting || workingDays === 0 || !form.reason.trim()}>
              {submitting ? '⟳ Submitting…' : 'Submit Application'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
