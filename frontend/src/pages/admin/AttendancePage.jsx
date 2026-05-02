import React, { useState, useEffect, useCallback, useRef } from 'react';
import { attendanceAPI, usersAPI, zonesAPI, faceAPI } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import FaceAuth from '../../components/FaceAuth';
import { fmtTime, fmtDuration, toTimeInput } from '../../utils/timeUtils';

const DEFAULT_DATE = new Date().toISOString().split('T')[0];

// Modal outside component — prevents re-mount on every keystroke
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

const statusBadge = s => ({
  present:    'badge-green',
  absent:     'badge-red',
  late:       'badge-amber',
  'on-leave': 'badge-blue',
  pending:    'badge-gray'
}[s] || 'badge-gray');

const methodBadge = m => ({
  geofence: { cls: 'badge-blue',   label: '📍 GPS' },
  leave:    { cls: 'badge-green',  label: '🏖️ Leave' },
  override: { cls: 'badge-purple', label: '📡 Override' },
}[m] || { cls: 'badge-gray', label: '✏ Manual' });

export default function AttendancePage() {
  const { toast } = useToast();

  // ── Data ──────────────────────────────────────────────────────────────────
  const [records, setRecords]   = useState([]);
  const [users, setUsers]       = useState([]);
  const [zones, setZones]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [filters, setFilters]   = useState({ date: DEFAULT_DATE || '', userId: '', status: '' });

  // ── Row selection ─────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState(new Set());
  const selectAllRef = useRef(null); // for indeterminate state on header checkbox

  // ── Modals ────────────────────────────────────────────────────────────────
  const [editModal, setEditModal]               = useState(null);
  const [editForm, setEditForm]                 = useState({});
  const [singleDeleteConfirm, setSingleDelete]  = useState(null);
  const [bulkDeleteConfirm, setBulkDelete]      = useState(false);
  const [markModal, setMarkModal]               = useState(false);   // 'single' | 'range'
  const [faceModal, setFaceModal]               = useState(null);

  // ── Bulk mark forms ───────────────────────────────────────────────────────
  const [bulkForm, setBulkForm]   = useState({ date: DEFAULT_DATE, status: 'present', userIds: [], note: '' });
  const [rangeForm, setRangeForm] = useState({ fromDate: DEFAULT_DATE, toDate: DEFAULT_DATE, status: 'present', userIds: [], note: '', skipHolidays: true, skipSundays: true });

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setSelectedIds(new Set());
    try {
      const params = {};
      if (filters.date)   params.date   = filters.date;
      if (filters.userId) params.userId = filters.userId;
      const r = await attendanceAPI.list(params);
      let recs = r.data;
      if (filters.status) recs = recs.filter(r => r.status === filters.status);
      setRecords(recs);
    } catch {}
    setLoading(false);
  }, [filters]);

  useEffect(() => {
    usersAPI.list().then(r => setUsers(r.data.filter(u => u.role !== 'admin'))).catch(() => {});
    zonesAPI.list().then(r => setZones(r.data)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  // ── Keep header checkbox indeterminate state in sync ──────────────────────
  const realRecords    = records.filter(r => !r.virtual);
  const allSelected    = realRecords.length > 0 && realRecords.every(r => selectedIds.has(r.id));
  const someSelected   = selectedIds.size > 0;
  const noneOrAll      = !someSelected || allSelected;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected && !allSelected;
    }
  }, [someSelected, allSelected]);

  const toggleRow = id => setSelectedIds(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(realRecords.map(r => r.id)));
  };

  // ── Single edit ───────────────────────────────────────────────────────────
  const openEdit = rec => {
    setEditForm({
      date:         rec.date,
      status:       rec.status || 'present',
      checkInTime:  toTimeInput(rec.checkIn)  || '09:30',
      checkOutTime: toTimeInput(rec.checkOut) || '',
      zoneId:       rec.zoneId || zones[0]?.id || '',
      note:         rec.note || ''
    });
    setEditModal(rec);
  };

  const saveEdit = async () => {
    if (!editForm.date) { toast('Date is required', 'error'); return; }
    try {
      await attendanceAPI.update(editModal.id, {
        date:         editForm.date,
        status:       editForm.status,
        checkInTime:  editForm.status !== 'absent' ? editForm.checkInTime : null,
        checkOutTime: editForm.status === 'present' && editForm.checkOutTime ? editForm.checkOutTime : null,
        zoneId:       editForm.zoneId,
        zoneName:     zones.find(z => z.id === editForm.zoneId)?.name || 'N/A',
        note:         editForm.note
      });
      toast('Record updated', 'success');
      setEditModal(null);
      load();
    } catch (err) { toast(err.response?.data?.error || 'Update failed', 'error'); }
  };

  // ── Single delete ─────────────────────────────────────────────────────────
  const doSingleDelete = async () => {
    try {
      await attendanceAPI.delete(singleDeleteConfirm.id);
      toast('Record deleted', 'success');
      setSingleDelete(null);
      load();
    } catch (err) { toast(err.response?.data?.error || 'Delete failed', 'error'); }
  };

  // ── Bulk delete selected checkboxes ───────────────────────────────────────
  const doBulkDelete = async () => {
    const ids = [...selectedIds];
    let ok = 0, fail = 0;
    for (const id of ids) {
      try { await attendanceAPI.delete(id); ok++; }
      catch { fail++; }
    }
    if (ok)   toast(`${ok} record${ok > 1 ? 's' : ''} deleted`, 'success');
    if (fail) toast(`${fail} record${fail > 1 ? 's' : ''} failed`, 'error');
    setBulkDelete(false);
    load();
  };

  // ── Bulk mark (single day) ────────────────────────────────────────────────
  const saveBulkMark = async () => {
    if (!bulkForm.userIds.length) { toast('Select at least one employee', 'error'); return; }
    try {
      await attendanceAPI.bulk(bulkForm);
      toast(`Updated ${bulkForm.userIds.length} employee(s)`, 'success');
      setMarkModal(false);
      setBulkForm({ date: DEFAULT_DATE, status: 'present', userIds: [], note: '' });
      load();
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error'); }
  };

  // ── Bulk mark (date range) ────────────────────────────────────────────────
  const saveBulkRange = async () => {
    if (!rangeForm.userIds.length) { toast('Select at least one employee', 'error'); return; }
    if (rangeForm.fromDate > rangeForm.toDate) { toast('From date must be before To date', 'error'); return; }
    try {
      const r = await attendanceAPI.bulkRange(rangeForm);
      toast(`Marked ${r.data.count} records as ${rangeForm.status}`, 'success');
      setMarkModal(false);
      setRangeForm({ fromDate: DEFAULT_DATE, toDate: DEFAULT_DATE, status: 'present', userIds: [], note: '', skipHolidays: true, skipSundays: true });
      load();
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error'); }
  };

  const toggleUser = (id, form, setForm) =>
    setForm(f => ({ ...f, userIds: f.userIds.includes(id) ? f.userIds.filter(x => x !== id) : [...f.userIds, id] }));

  // ── Face helpers ──────────────────────────────────────────────────────────
  const handleFaceEnrolled = async descriptor => {
    try {
      await faceAPI.enrollForUser(faceModal.userId, descriptor);
      toast(`Face enrolled for ${faceModal.userName}`, 'success');
      setFaceModal(null);
      usersAPI.list().then(r => setUsers(r.data.filter(u => u.role !== 'admin'))).catch(() => {});
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error'); }
  };
  const removeFace = async (userId, userName) => {
    if (!window.confirm(`Remove face data for ${userName}?`)) return;
    try {
      await faceAPI.removeForUser(userId);
      toast('Face data removed', 'success');
      usersAPI.list().then(r => setUsers(r.data.filter(u => u.role !== 'admin'))).catch(() => {});
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error'); }
  };

  // ── Inline employee selector (no sub-component — avoids focus loss) ───────
  const empSelector = (form, setForm) => (
    <div className="form-group">
      <label className="form-label">Employees</label>
      <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', maxHeight: 220, overflowY: 'auto' }}>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setForm(f => ({ ...f, userIds: users.map(u => u.id) }))}>All</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setForm(f => ({ ...f, userIds: [] }))}>None</button>
          <span style={{ fontSize: 11, color: 'var(--text3)', alignSelf: 'center' }}>{form.userIds.length} selected</span>
        </div>
        {users.map(u => (
          <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', background: form.userIds.includes(u.id) ? 'rgba(59,130,246,0.05)' : 'transparent' }}>
            <input type="checkbox" checked={form.userIds.includes(u.id)} onChange={() => toggleUser(u.id, form, setForm)} />
            <div className="avatar avatar-sm" style={{ background: `${u.color}22`, color: u.color }}>{u.avatar}</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{u.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>{u.dept}</div>
            </div>
          </label>
        ))}
      </div>
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 24 }}>

      {/* Header */}
      <div className="flex-between mb-24">
        <div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: 26, fontWeight: 800 }}>Attendance Records</h1>
          <p style={{ color: 'var(--text2)', fontSize: 14 }}>View, edit, delete, or bulk-mark attendance</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost" onClick={() => setMarkModal('single')}>⚡ Bulk Day</button>
          <button className="btn btn-amber" onClick={() => setMarkModal('range')}>📅 Bulk Range</button>
        </div>
      </div>

      {/* Filters */}
      
      <div className="card mb-24" style={{ padding: '14px 20px' }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label className="form-label">Date</label>
            <input type="date" className="form-input" value={filters.date} onChange={e => setFilters(f => ({ ...f, date: e.target.value }))} style={{ width: 168 }} max={DEFAULT_DATE} />
          </div>
          <div>
            <label className="form-label">Employee</label>
            <select className="form-select" value={filters.userId} onChange={e => {
              const val = e.target.value;
              // When selecting a specific employee, auto-clear the date
              // so all their records across dates are shown
              setFilters(f => ({ ...f, userId: val, date: val ? '' : f.date }));
            }} style={{ width: 200 }}>
              <option value="">All Employees</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            {filters.userId && !filters.date && (
              <span className="form-hint" style={{ color: 'var(--accent)' }}>
                Showing all dates for this employee
              </span>
            )}
          </div>
          <div>
            <label className="form-label">Status</label>
            <select className="form-select" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))} style={{ width: 140 }}>
              <option value="">All</option>
              <option value="present">Present</option>
              <option value="absent">Absent</option>
              <option value="late">Late</option>
              <option value="on-leave">On Leave</option>
              <option value="pending">Pending</option>
            </select>
          </div>
          <button className="btn btn-ghost" onClick={() => setFilters({ date: '', userId: '', status: '' })}>Clear</button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid-4 mb-24">
        {[
          ['Present', records.filter(r => r.status === 'present').length, 'green'],
          ['Absent',  records.filter(r => r.status === 'absent').length,  'red'],
          ['Late',    records.filter(r => r.status === 'late').length,    'amber'],
          ['Total',   records.length,                                      'blue']
        ].map(([l, v, c]) => (
          <div key={l} className="stat-card">
            <div className="stat-label">{l}</div>
            <div className="stat-value" style={{ color: `var(--${c})`, fontSize: 26 }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Face enrollment */}
      <div className="card mb-24">
        <div className="card-title">Employee Face Enrollment</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {users.map(u => (
            <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'var(--bg3)', border: `1px solid ${u.faceEnrolled ? 'rgba(52,211,153,0.3)' : 'var(--border)'}`, borderRadius: 8 }}>
              <div className="avatar avatar-sm" style={{ background: `${u.color}22`, color: u.color }}>{u.avatar}</div>
              <span style={{ fontSize: 12, fontWeight: 500 }}>{u.name}</span>
              {u.faceEnrolled
                ? <><span className="badge badge-green" style={{ fontSize: 10 }}>🔒 Enrolled</span>
                    <button className="btn btn-danger btn-sm" style={{ padding: '2px 8px', fontSize: 10 }} onClick={() => removeFace(u.id, u.name)}>Remove</button></>
                : <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => setFaceModal({ userId: u.id, userName: u.name })}>Enroll Face</button>
              }
            </div>
          ))}
        </div>
      </div>

      {/* ── Floating selection action bar (appears when rows checked) ── */}
      {someSelected && (
        <div style={{
          position: 'sticky', top: 12, zIndex: 50,
          background: 'var(--surface2)', border: '1px solid var(--border2)',
          borderRadius: 12, padding: '11px 18px', marginBottom: 16,
          display: 'flex', alignItems: 'center', gap: 14,
          boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
          animation: 'slideUp 0.18s ease'
        }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(59,130,246,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>
            ☑
          </div>
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>
            {selectedIds.size} record{selectedIds.size !== 1 ? 's' : ''} selected
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost btn-sm" onClick={() => setSelectedIds(new Set())}>
            ✕ Clear
          </button>
          <button
            className="btn btn-danger"
            style={{ fontWeight: 700, padding: '8px 20px' }}
            onClick={() => setBulkDelete(true)}
          >
            🗑 Delete {selectedIds.size} Selected
          </button>
        </div>
      )}

      {/* ── Table ── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-wrap">
          {loading ? (
            <div className="empty-state"><div className="pulsing empty-icon">⟳</div></div>
          ) : records.length ? (
            <table>
              <thead>
                <tr>
                  {/* Header checkbox — select all / deselect all */}
                  <th style={{ width: 44, textAlign: 'center', paddingLeft: 14, paddingRight: 0 }}>
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      title={allSelected ? 'Deselect all' : 'Select all deletable records'}
                      style={{ cursor: 'pointer', width: 15, height: 15, accentColor: 'var(--accent2)' }}
                    />
                  </th>
                  <th>Employee</th>
                  <th>Date</th>
                  <th>Zone</th>
                  <th>Check In</th>
                  <th>Check Out</th>
                  <th>Duration</th>
                  <th>Status</th>
                  <th>Method</th>
                  <th>Note</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map(r => {
                  const checked = selectedIds.has(r.id);
                  const mb = methodBadge(r.method);
                  return (
                    <tr key={r.id} style={{
                      background: checked ? 'rgba(59,130,246,0.07)' : undefined,
                      outline: checked ? '1px solid rgba(59,130,246,0.2)' : 'none',
                      transition: 'background 0.1s'
                    }}>
                      {/* Row checkbox — virtual absent rows cannot be deleted */}
                      <td style={{ textAlign: 'center', paddingLeft: 14, paddingRight: 0 }}>
                        {!r.virtual ? (
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleRow(r.id)}
                            style={{ cursor: 'pointer', width: 15, height: 15, accentColor: 'var(--accent2)' }}
                          />
                        ) : (
                          <span style={{ color: 'var(--text3)', fontSize: 10, display: 'block', textAlign: 'center' }}>—</span>
                        )}
                      </td>

                      <td className="primary">{r.userName}</td>
                      <td className="mono">{r.date}</td>
                      <td style={{ fontSize: 12 }}>{r.zoneName || '—'}</td>
                      <td className="mono" style={{ fontSize: 12 }}>{fmtTime(r.checkIn)}</td>
                      <td className="mono" style={{ fontSize: 12 }}>{fmtTime(r.checkOut)}</td>
                      <td className="mono" style={{ fontSize: 12 }}>{fmtDuration(r.checkIn, r.checkOut)}</td>
                      <td>
                        <span className={`badge ${statusBadge(r.status)}`}>
                          <span className="badge-dot" />{r.status}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${mb.cls}`} style={{ fontSize: 10 }}>{mb.label}</span>
                      </td>
                      <td style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
                        {r.note || (r.lateReason ? `Late: ${r.lateReason}` : '—')}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => openEdit(r)}>✏</button>
                          {!r.virtual && (
                            <button className="btn btn-danger btn-sm" onClick={() => setSingleDelete(r)}>🗑</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="empty-state">
              <div className="empty-icon">📊</div>
              <div className="empty-text">No records found</div>
            </div>
          )}
        </div>

        {/* Footer count when something is selected */}
        {someSelected && (
          <div style={{ padding: '9px 18px', borderTop: '1px solid var(--border)', background: 'var(--bg3)', fontSize: 12, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <strong style={{ color: 'var(--accent)' }}>{selectedIds.size}</strong>&nbsp;of {realRecords.length} records selected
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 4 }} onClick={toggleAll}>
              {allSelected ? 'Deselect All' : 'Select All'}
            </button>
          </div>
        )}
      </div>

      {/* ══════════════════ MODALS ══════════════════ */}

      {/* Edit single record */}
      {editModal && (
        <Modal title={`Edit — ${editModal.userName} · ${editModal.date}`} onClose={() => setEditModal(null)}>
          <div style={{ background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.2)', borderRadius: 10, padding: 11, marginBottom: 16, fontSize: 13, color: 'var(--purple)' }}>
            🔒 Admin override — will be marked as manually edited
          </div>
          <div className="form-group">
            <label className="form-label">Date</label>
            <input type="date" className="form-input" value={editForm.date} onChange={e => setEditForm(f => ({ ...f, date: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Status</label>
            <select className="form-select" value={editForm.status} onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}>
              <option value="present">Present</option>
              <option value="absent">Absent</option>
              <option value="late">Late</option>
              <option value="on-leave">On Leave</option>
              <option value="pending">Pending</option>
            </select>
          </div>
          {editForm.status !== 'absent' && editForm.status !== 'on-leave' && (
            <div className="grid-2" style={{ gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Check-in Time</label>
                <input type="time" className="form-input" value={editForm.checkInTime} onChange={e => setEditForm(f => ({ ...f, checkInTime: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Check-out Time</label>
                <input type="time" className="form-input" value={editForm.checkOutTime} onChange={e => setEditForm(f => ({ ...f, checkOutTime: e.target.value }))} />
                <span className="form-hint">Leave blank if not checked out</span>
              </div>
            </div>
          )}
          <div className="form-group">
            <label className="form-label">Zone</label>
            <select className="form-select" value={editForm.zoneId} onChange={e => setEditForm(f => ({ ...f, zoneId: e.target.value }))}>
              <option value="">— None —</option>
              {zones.map(z => <option key={z.id} value={z.id}>{z.icon} {z.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Admin Note</label>
            <input className="form-input" placeholder="Reason for edit…" value={editForm.note} onChange={e => setEditForm(f => ({ ...f, note: e.target.value }))} />
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setEditModal(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveEdit}>Save Changes</button>
          </div>
        </Modal>
      )}

      {/* Single delete confirm */}
      {singleDeleteConfirm && (
        <Modal title="Delete Record" onClose={() => setSingleDelete(null)} maxWidth={420}>
          <div style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <div style={{ fontWeight: 600, color: 'var(--red)', marginBottom: 4 }}>⚠ Cannot be undone</div>
            <div style={{ fontSize: 13, color: 'var(--text2)' }}>
              Delete record for <strong style={{ color: 'var(--text)' }}>{singleDeleteConfirm.userName}</strong> on <strong style={{ color: 'var(--text)' }}>{singleDeleteConfirm.date}</strong>?
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setSingleDelete(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={doSingleDelete}>Delete</button>
          </div>
        </Modal>
      )}

      {/* Bulk delete confirm */}
      {bulkDeleteConfirm && (
        <Modal title={`Delete ${selectedIds.size} Records`} onClose={() => setBulkDelete(false)} maxWidth={440}>
          <div style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <div style={{ fontWeight: 600, color: 'var(--red)', marginBottom: 8 }}>⚠ This cannot be undone</div>
            <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>
              You are about to permanently delete <strong style={{ color: 'var(--text)' }}>{selectedIds.size} attendance record{selectedIds.size !== 1 ? 's' : ''}</strong>.
            </div>
          </div>
          {/* Preview list of selected employees + dates */}
          <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 16 }}>
            {records.filter(r => selectedIds.has(r.id)).map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                <div className="avatar avatar-sm" style={{ background: `${r.color || '#63b3ed'}22`, color: r.color || '#63b3ed', width: 24, height: 24, fontSize: 9 }}>
                  {r.userName?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <span style={{ fontWeight: 500, color: 'var(--text)' }}>{r.userName}</span>
                <span style={{ color: 'var(--text3)', fontFamily: 'var(--mono)' }}>{r.date}</span>
                <span className={`badge ${statusBadge(r.status)}`} style={{ fontSize: 10, marginLeft: 'auto' }}>{r.status}</span>
              </div>
            ))}
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setBulkDelete(false)}>Cancel</button>
            <button className="btn btn-danger" style={{ fontWeight: 700 }} onClick={doBulkDelete}>
              🗑 Delete All {selectedIds.size} Records
            </button>
          </div>
        </Modal>
      )}

      {/* Bulk mark — single day */}
      {markModal === 'single' && (
        <Modal title="⚡ Bulk Update — Single Day" onClose={() => setMarkModal(false)}>
          <div className="grid-2" style={{ gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Date</label>
              <input type="date" className="form-input" value={bulkForm.date} onChange={e => setBulkForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Status</label>
              <select className="form-select" value={bulkForm.status} onChange={e => setBulkForm(f => ({ ...f, status: e.target.value }))}>
                <option value="present">Present</option>
                <option value="absent">Absent</option>
                <option value="late">Late</option>
              </select>
            </div>
          </div>
          {empSelector(bulkForm, setBulkForm)}
          <div className="form-group">
            <label className="form-label">Note</label>
            <input className="form-input" placeholder="e.g. Office trip" value={bulkForm.note} onChange={e => setBulkForm(f => ({ ...f, note: e.target.value }))} />
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setMarkModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveBulkMark}>
              Apply to {bulkForm.userIds.length} Employee{bulkForm.userIds.length !== 1 ? 's' : ''}
            </button>
          </div>
        </Modal>
      )}

      {/* Bulk mark — date range */}
      {markModal === 'range' && (
        <Modal title="📅 Bulk Mark — Date Range" onClose={() => setMarkModal(false)} maxWidth={560}>
          <div style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 13, color: 'var(--amber)' }}>
            Mark all selected employees for a date range — useful for leaves, training, or WFH periods.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">From Date</label>
              <input type="date" className="form-input" value={rangeForm.fromDate} onChange={e => setRangeForm(f => ({ ...f, fromDate: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">To Date</label>
              <input type="date" className="form-input" value={rangeForm.toDate} onChange={e => setRangeForm(f => ({ ...f, toDate: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Status</label>
              <select className="form-select" value={rangeForm.status} onChange={e => setRangeForm(f => ({ ...f, status: e.target.value }))}>
                <option value="present">Present</option>
                <option value="absent">Absent</option>
                <option value="late">Late</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={rangeForm.skipSundays} onChange={e => setRangeForm(f => ({ ...f, skipSundays: e.target.checked }))} /> Skip Sundays
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={rangeForm.skipHolidays} onChange={e => setRangeForm(f => ({ ...f, skipHolidays: e.target.checked }))} /> Skip Holidays
            </label>
          </div>
          {empSelector(rangeForm, setRangeForm)}
          <div className="form-group">
            <label className="form-label">Note</label>
            <input className="form-input" placeholder="e.g. Annual leave, Training, WFH" value={rangeForm.note} onChange={e => setRangeForm(f => ({ ...f, note: e.target.value }))} />
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setMarkModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveBulkRange} disabled={!rangeForm.userIds.length}>
              Apply to {rangeForm.userIds.length} Employee{rangeForm.userIds.length !== 1 ? 's' : ''}
            </button>
          </div>
        </Modal>
      )}

      {/* Face enroll for employee */}
      {faceModal && (
        <Modal title={`Enroll Face — ${faceModal.userName}`} onClose={() => setFaceModal(null)} maxWidth={400}>
          <FaceAuth mode="enroll" userName={faceModal.userName} onSuccess={handleFaceEnrolled} onCancel={() => setFaceModal(null)} />
        </Modal>
      )}
    </div>
  );
}