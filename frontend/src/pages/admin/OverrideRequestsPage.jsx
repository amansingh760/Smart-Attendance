import React, { useState, useEffect } from 'react';
import { attendanceAPI } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { fmtTime } from '../../utils/timeUtils';

function Modal({ title, onClose, children, maxWidth = 460 }) {
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

export default function OverrideRequestsPage() {
  const { toast } = useToast();
  const [requests, setRequests]         = useState([]);
  const [loading, setLoading]           = useState(true);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [reviewModal, setReviewModal]   = useState(null);
  const [reviewNote, setReviewNote]     = useState('');
  const [submitting, setSubmitting]     = useState(false);

  const load = async () => {
    setLoading(true);
    try { const r = await attendanceAPI.getOverrideRequests(statusFilter||undefined); setRequests(r.data); }
    catch {}
    setLoading(false);
  };
  useEffect(() => { load(); }, [statusFilter]);

  const handleReview = async (decision) => {
    if (decision === 'denied' && !reviewNote.trim()) { toast('Provide a reason for denial', 'error'); return; }
    setSubmitting(true);
    try {
      await attendanceAPI.reviewOverride(reviewModal.id, decision, reviewNote);
      toast(decision === 'approved' ? `Approved — attendance created for ${reviewModal.userName}` : 'Request denied', decision === 'approved' ? 'success' : 'warning');
      setReviewModal(null); setReviewNote(''); load();
    } catch (err) { toast(err.response?.data?.error||'Failed','error'); }
    setSubmitting(false);
  };

  const counts = { pending: requests.filter(r=>r.status==='pending').length, approved: requests.filter(r=>r.status==='approved').length, denied: requests.filter(r=>r.status==='denied').length };

  return (
    <div style={{ padding: 24 }}>
      <div className="flex-between mb-24">
        <div>
          <h1 style={{ fontFamily:'var(--display)',fontSize:26,fontWeight:800 }}>Override Requests</h1>
          <p style={{ color:'var(--text2)',fontSize:14 }}>Out-of-zone attendance requests needing admin approval</p>
        </div>
        <select className="form-select" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} style={{width:140}}>
          <option value="">All</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="denied">Denied</option>
        </select>
      </div>

      <div className="grid-3 mb-24">
        {[['Pending',counts.pending,'amber'],['Approved',counts.approved,'green'],['Denied',counts.denied,'red']].map(([l,v,c])=>(
          <div key={l} className="stat-card" style={{cursor:'pointer',border:statusFilter===l.toLowerCase()?`1px solid var(--${c})`:'1px solid var(--border)'}} onClick={()=>setStatusFilter(l.toLowerCase())}>
            <div className="stat-label">{l}</div>
            <div className="stat-value" style={{color:`var(--${c})`,fontSize:28}}>{v}</div>
          </div>
        ))}
      </div>

      {loading ? <div className="empty-state"><div className="pulsing empty-icon" style={{fontSize:32}}>⟳</div></div>
      : requests.length ? (
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          {requests.map(req=>(
            <div key={req.id} className="card" style={{borderColor:req.status==='pending'?'rgba(251,191,36,0.3)':req.status==='approved'?'rgba(52,211,153,0.25)':'rgba(248,113,113,0.2)'}}>
              <div style={{display:'flex',alignItems:'flex-start',gap:14}}>
                <div className="avatar avatar-md" style={{background:`${req.color}22`,color:req.color,flexShrink:0}}>{req.avatar}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',marginBottom:6}}>
                    <span style={{fontWeight:700,fontSize:15}}>{req.userName}</span>
                    <span style={{fontSize:12,color:'var(--text3)'}}>{req.dept}</span>
                    <span className={`badge badge-${req.status==='pending'?'amber':req.status==='approved'?'green':'red'}`} style={{fontSize:11}}><span className="badge-dot"/>{req.status}</span>
                    <span className={`badge badge-${req.action==='checkin'?'blue':'purple'}`} style={{fontSize:11}}>{req.action==='checkin'?'📍 Check-in':'🚪 Check-out'}</span>
                    {req.faceVerified&&<span className="badge badge-green" style={{fontSize:10}}>🔒 Face Verified</span>}
                  </div>
                  <div style={{display:'flex',gap:20,flexWrap:'wrap',marginBottom:8}}>
                    <div><span style={{fontSize:11,color:'var(--text3)'}}>Date </span><span style={{fontFamily:'var(--mono)',fontSize:13}}>{req.date}</span></div>
                    <div><span style={{fontSize:11,color:'var(--text3)'}}>Requested </span><span style={{fontFamily:'var(--mono)',fontSize:13}}>{fmtTime(req.requestedAt)}</span></div>
                    <div><span style={{fontSize:11,color:'var(--text3)'}}>Zone </span><span style={{fontSize:13}}>{req.zoneName}</span></div>
                  </div>
                  <div style={{background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:8,padding:'8px 12px',fontSize:13,color:'var(--text2)',marginBottom:req.reviewNote?8:0}}>
                    <span style={{color:'var(--text3)',fontSize:11}}>Employee's reason: </span>{req.reason}
                  </div>
                  {req.reviewNote&&<div style={{borderRadius:8,padding:'7px 12px',fontSize:12,background:req.status==='approved'?'rgba(52,211,153,0.06)':'rgba(248,113,113,0.06)',color:req.status==='approved'?'var(--green)':'var(--red)',border:`1px solid ${req.status==='approved'?'rgba(52,211,153,0.2)':'rgba(248,113,113,0.2)'}`}}>Admin note: {req.reviewNote}</div>}
                </div>
                {req.status==='pending'&&<button className="btn btn-success btn-sm" style={{flexShrink:0}} onClick={()=>{setReviewModal(req);setReviewNote('');}}>Review</button>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card"><div className="empty-state"><div className="empty-icon">📡</div><div className="empty-text">{statusFilter==='pending'?'No pending override requests':`No ${statusFilter} requests`}</div></div></div>
      )}

      {reviewModal&&(
        <Modal title={`Review Override — ${reviewModal.userName}`} onClose={()=>{setReviewModal(null);setReviewNote('');}}>
          <div style={{background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:10,padding:14,marginBottom:16,fontSize:13}}>
            <div style={{display:'flex',gap:16,flexWrap:'wrap',marginBottom:8}}>
              <div><span style={{color:'var(--text3)'}}>Employee:</span> <strong>{reviewModal.userName}</strong></div>
              <div><span style={{color:'var(--text3)'}}>Date:</span> <strong style={{fontFamily:'var(--mono)'}}>{reviewModal.date}</strong></div>
              <div><span style={{color:'var(--text3)'}}>Action:</span> <strong>{reviewModal.action}</strong></div>
            </div>
            <div style={{color:'var(--text2)'}}><span style={{color:'var(--text3)'}}>Reason: </span>{reviewModal.reason}</div>
            {reviewModal.faceVerified&&<div style={{color:'var(--green)',marginTop:6,fontSize:12}}>✓ Face authentication completed</div>}
          </div>
          <div style={{background:'rgba(52,211,153,0.07)',border:'1px solid rgba(52,211,153,0.2)',borderRadius:10,padding:11,marginBottom:14,fontSize:13,color:'var(--green)'}}>✓ Approving will automatically create the attendance record.</div>
          <div className="form-group"><label className="form-label">Admin Note <span style={{color:'var(--text3)',fontWeight:400}}>(required for denial)</span></label><textarea className="form-textarea" placeholder="Optional note…" value={reviewNote} onChange={e=>setReviewNote(e.target.value)} rows={3}/></div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={()=>{setReviewModal(null);setReviewNote('');}}>Cancel</button>
            <button className="btn btn-danger" onClick={()=>handleReview('denied')} disabled={submitting}>✗ Deny</button>
            <button className="btn btn-success" onClick={()=>handleReview('approved')} disabled={submitting}>✓ Approve</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
