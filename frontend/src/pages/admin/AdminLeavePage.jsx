import React, { useState, useEffect } from 'react';
import { leavesAPI } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';

const LEAVE_TYPES = ['casual','sick','earned','maternity','paternity','unpaid','other'];
const TYPE_LABEL  = { casual:'Casual', sick:'Sick', earned:'Earned/PL', maternity:'Maternity', paternity:'Paternity', unpaid:'Unpaid', other:'Other' };
const TYPE_ICON   = { casual:'🏖️', sick:'🤒', earned:'⭐', maternity:'👶', paternity:'👨', unpaid:'💸', other:'📋' };
const STATUS_CLR  = { pending:'amber', approved:'green', rejected:'red', cancelled:'gray' };

// Modal defined OUTSIDE the page component — never re-created on render
function Modal({ title, onClose, children, maxWidth = 480 }) {
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

export default function AdminLeavePage() {
  const { toast } = useToast();
  const [leaves, setLeaves]         = useState([]);
  const [summary, setSummary]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [tab, setTab]               = useState('requests');
  const [statusFilter, setStatusFilter] = useState('pending');
  const [reviewModal, setReviewModal]   = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null); // leave to delete
  const [adminNote, setAdminNote]       = useState('');
  const [submitting, setSubmitting]     = useState(false);
  const currentYear = new Date().getFullYear().toString();

  const loadLeaves = async () => {
    setLoading(true);
    try {
      const [lr, sr] = await Promise.all([
        leavesAPI.list({ status: statusFilter || undefined }),
        leavesAPI.summary(currentYear)
      ]);
      setLeaves(lr.data);
      setSummary(sr.data);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { loadLeaves(); }, [statusFilter]);

  // ── Review (approve / reject) ─────────────────────────────────────────────
  const handleReview = async (decision) => {
    if (!reviewModal) return;
    if (decision === 'rejected' && !adminNote.trim()) {
      toast('Please provide a reason for rejection', 'error'); return;
    }
    setSubmitting(true);
    try {
      await leavesAPI.review(reviewModal.id, decision, adminNote);
      toast(
        decision === 'approved'
          ? `Leave approved — attendance auto-marked for ${reviewModal.userName}`
          : 'Leave rejected',
        decision === 'approved' ? 'success' : 'warning'
      );
      setReviewModal(null); setAdminNote('');
      loadLeaves();
    } catch (err) {
      toast(err.response?.data?.error || 'Review failed', 'error');
    } finally { setSubmitting(false); }
  };

  // ── Delete leave (admin only) ─────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setSubmitting(true);
    try {
      await leavesAPI.delete(deleteConfirm.id);
      toast(
        deleteConfirm.status === 'approved'
          ? `Leave deleted and attendance records reverted for ${deleteConfirm.userName}`
          : `Leave record deleted for ${deleteConfirm.userName}`,
        'success'
      );
      setDeleteConfirm(null);
      loadLeaves();
    } catch (err) {
      toast(err.response?.data?.error || 'Delete failed', 'error');
    } finally { setSubmitting(false); }
  };

  const pending = leaves.filter(l => l.status === 'pending').length;

  return (
    <div style={{ padding: 24 }}>
      <div className="flex-between mb-24">
        <div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: 26, fontWeight: 800 }}>Leave Management</h1>
          <p style={{ color: 'var(--text2)', fontSize: 14 }}>Review, approve, reject or delete employee leave requests</p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {[['requests','📋 Requests'],['summary','📊 Summary']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`btn btn-sm ${tab === id ? 'btn-primary' : 'btn-ghost'}`}>
            {label}
            {id === 'requests' && pending > 0 && (
              <span style={{ background:'var(--red)', color:'white', borderRadius:10, padding:'1px 6px', fontSize:10, marginLeft:6 }}>{pending}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── REQUESTS TAB ── */}
      {tab === 'requests' && (
        <>
          {/* Filter */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
            <select className="form-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: 160 }}>
              <option value="">All Requests</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          {loading ? (
            <div className="empty-state"><div className="pulsing empty-icon" style={{ fontSize: 32 }}>⟳</div></div>
          ) : leaves.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {leaves.map(l => (
                <div key={l.id} className="card" style={{
                  borderColor: l.status === 'pending'  ? 'rgba(251,191,36,0.35)'
                             : l.status === 'approved' ? 'rgba(52,211,153,0.25)'
                             : l.status === 'rejected' ? 'rgba(248,113,113,0.2)'
                             : 'var(--border)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                    {/* Avatar */}
                    <div className="avatar avatar-md" style={{ background:`${l.color}22`, color:l.color, flexShrink:0 }}>{l.avatar}</div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Header badges */}
                      <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', marginBottom:8 }}>
                        <span style={{ fontWeight:700, fontSize:14 }}>{l.userName}</span>
                        <span style={{ fontSize:12, color:'var(--text3)' }}>{l.dept}</span>
                        <span className={`badge badge-${STATUS_CLR[l.status]||'gray'}`} style={{ fontSize:11 }}>
                          <span className="badge-dot" />{l.status}
                        </span>
                        <span className="badge badge-blue" style={{ fontSize:10 }}>
                          {TYPE_ICON[l.type]} {TYPE_LABEL[l.type]}
                        </span>
                        <span className="badge badge-purple" style={{ fontSize:10 }}>
                          {l.days} day{l.days!==1?'s':''}{l.halfDay?' (half)':''}
                        </span>
                      </div>

                      {/* Date + applied */}
                      <div style={{ display:'flex', gap:20, marginBottom:8, flexWrap:'wrap' }}>
                        <div style={{ fontSize:13 }}>
                          <span style={{ color:'var(--text3)' }}>Dates: </span>
                          <span style={{ fontFamily:'var(--mono)', color:'var(--text)' }}>
                            {l.fromDate === l.toDate ? l.fromDate : `${l.fromDate} → ${l.toDate}`}
                          </span>
                        </div>
                        <div style={{ fontSize:13 }}>
                          <span style={{ color:'var(--text3)' }}>Applied: </span>
                          <span style={{ color:'var(--text)' }}>{new Date(l.appliedAt).toLocaleDateString('en-IN')}</span>
                        </div>
                      </div>

                      {/* Reason box */}
                      <div style={{ background:'var(--bg3)', borderRadius:8, padding:'8px 12px', fontSize:13, color:'var(--text2)', marginBottom: l.adminNote ? 8 : 0 }}>
                        <span style={{ color:'var(--text3)' }}>Reason: </span>{l.reason}
                      </div>

                      {/* Admin note */}
                      {l.adminNote && (
                        <div style={{ fontSize:12, marginTop:8, padding:'7px 12px', borderRadius:8,
                          background: l.status==='approved' ? 'rgba(52,211,153,0.07)' : 'rgba(248,113,113,0.07)',
                          color: l.status==='approved' ? 'var(--green)' : 'var(--red)' }}>
                          💬 {l.adminNote}
                        </div>
                      )}
                    </div>

                    {/* Action buttons — always show Delete; show Review only when pending */}
                    <div style={{ display:'flex', flexDirection:'column', gap:6, flexShrink:0 }}>
                      {l.status === 'pending' && (
                        <button className="btn btn-success btn-sm"
                          onClick={() => { setReviewModal(l); setAdminNote(''); }}>
                          Review
                        </button>
                      )}
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => setDeleteConfirm(l)}
                        title="Permanently delete this leave record"
                      >
                        🗑 Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="card">
              <div className="empty-state">
                <div className="empty-icon">📋</div>
                <div className="empty-text">{statusFilter === 'pending' ? 'No pending leave requests' : `No ${statusFilter || ''} requests`}</div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── SUMMARY TAB ── */}
      {tab === 'summary' && (
        <div className="card" style={{ padding:0, overflow:'hidden' }}>
          <div style={{ padding:'14px 18px', borderBottom:'1px solid var(--border)', fontSize:13, color:'var(--text2)', fontWeight:600 }}>
            Approved leave days per employee — {currentYear}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th style={{ textAlign:'center' }}>Total Days</th>
                  {LEAVE_TYPES.map(t => (
                    <th key={t} style={{ textAlign:'center', fontSize:10 }}>{TYPE_ICON[t]} {TYPE_LABEL[t]}</th>
                  ))}
                  <th style={{ textAlign:'center' }}>Pending</th>
                </tr>
              </thead>
              <tbody>
                {summary.map(e => (
                  <tr key={e.userId}>
                    <td>
                      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                        <div className="avatar avatar-sm" style={{ background:`${e.color}22`, color:e.color }}>{e.avatar}</div>
                        <div>
                          <div style={{ fontWeight:600, color:'var(--text)', fontSize:13 }}>{e.name}</div>
                          <div style={{ fontSize:11, color:'var(--text3)' }}>{e.dept}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ textAlign:'center' }}>
                      <span style={{ fontWeight:700, color:'var(--accent)', fontFamily:'var(--mono)' }}>{e.totalDays}</span>
                    </td>
                    {LEAVE_TYPES.map(t => (
                      <td key={t} style={{ textAlign:'center', fontSize:13, fontFamily:'var(--mono)', color: e.byType[t] > 0 ? 'var(--text)' : 'var(--text3)' }}>
                        {e.byType[t] || '—'}
                      </td>
                    ))}
                    <td style={{ textAlign:'center' }}>
                      {e.pending > 0
                        ? <span className="badge badge-amber" style={{ fontSize:10 }}>{e.pending} pending</span>
                        : <span style={{ color:'var(--text3)', fontSize:12 }}>—</span>
                      }
                    </td>
                  </tr>
                ))}
                {!summary.length && (
                  <tr><td colSpan={10}>
                    <div className="empty-state"><div className="empty-icon">📊</div><div className="empty-text">No data</div></div>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Review Modal ── */}
      {reviewModal && (
        <Modal title={`Review Leave — ${reviewModal.userName}`} onClose={() => { setReviewModal(null); setAdminNote(''); }}>
          <div style={{ background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:10, padding:14, marginBottom:16, fontSize:13 }}>
            <div style={{ display:'flex', gap:16, flexWrap:'wrap', marginBottom:8 }}>
              <div><span style={{ color:'var(--text3)' }}>Type:</span> <strong>{TYPE_ICON[reviewModal.type]} {TYPE_LABEL[reviewModal.type]}</strong></div>
              <div><span style={{ color:'var(--text3)' }}>Dates:</span> <strong style={{ fontFamily:'var(--mono)' }}>{reviewModal.fromDate === reviewModal.toDate ? reviewModal.fromDate : `${reviewModal.fromDate} → ${reviewModal.toDate}`}</strong></div>
              <div><span style={{ color:'var(--text3)' }}>Days:</span> <strong>{reviewModal.days}</strong></div>
            </div>
            <div style={{ color:'var(--text2)' }}><span style={{ color:'var(--text3)' }}>Reason: </span>{reviewModal.reason}</div>
          </div>

          <div style={{ background:'rgba(52,211,153,0.07)', border:'1px solid rgba(52,211,153,0.2)', borderRadius:8, padding:11, marginBottom:14, fontSize:13, color:'var(--green)' }}>
            ✓ Approving will auto-mark attendance as "on-leave" for all working days in this range.
          </div>

          <div className="form-group">
            <label className="form-label">Admin Note <span style={{ color:'var(--text3)', fontWeight:400 }}>(required for rejection)</span></label>
            <textarea className="form-textarea" placeholder="Optional note to employee…"
              value={adminNote} onChange={e => setAdminNote(e.target.value)} rows={3} />
          </div>

          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => { setReviewModal(null); setAdminNote(''); }}>Cancel</button>
            <button className="btn btn-danger" onClick={() => handleReview('rejected')} disabled={submitting}>✗ Reject</button>
            <button className="btn btn-success" onClick={() => handleReview('approved')} disabled={submitting}>✓ Approve</button>
          </div>
        </Modal>
      )}

      {/* ── Delete Confirm Modal ── */}
      {deleteConfirm && (
        <Modal title="Delete Leave Record" onClose={() => setDeleteConfirm(null)} maxWidth={440}>
          <div style={{ background:'rgba(248,113,113,0.08)', border:'1px solid rgba(248,113,113,0.25)', borderRadius:10, padding:16, marginBottom:16 }}>
            <div style={{ fontWeight:700, color:'var(--red)', marginBottom:6, fontSize:14 }}>⚠ This cannot be undone</div>
            <div style={{ fontSize:13, color:'var(--text2)', lineHeight:1.6 }}>
              You are about to permanently delete the{' '}
              <strong style={{ color:'var(--text)' }}>{TYPE_ICON[deleteConfirm.type]} {TYPE_LABEL[deleteConfirm.type]}</strong> leave for{' '}
              <strong style={{ color:'var(--text)' }}>{deleteConfirm.userName}</strong>
              {' '}({deleteConfirm.fromDate === deleteConfirm.toDate ? deleteConfirm.fromDate : `${deleteConfirm.fromDate} → ${deleteConfirm.toDate}`}).
            </div>
          </div>

          {/* Extra warning if approved — attendance records will be reverted */}
          {deleteConfirm.status === 'approved' && (
            <div style={{ background:'rgba(251,191,36,0.08)', border:'1px solid rgba(251,191,36,0.25)', borderRadius:8, padding:12, marginBottom:16, fontSize:13, color:'var(--amber)' }}>
              ⚠ This leave was <strong>approved</strong>. Deleting it will also <strong>remove all attendance records</strong> that were auto-created for this leave period.
            </div>
          )}

          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setDeleteConfirm(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={handleDelete} disabled={submitting}>
              {submitting ? '⟳ Deleting…' : '🗑 Delete Leave Record'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}