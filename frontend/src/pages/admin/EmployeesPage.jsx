import React, { useState, useEffect } from 'react';
import { usersAPI, settingsAPI } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';

const COLORS = ['#63b3ed','#b794f4','#34d399','#f6ad55','#f472b6','#fb7185','#a3e635','#38bdf8'];
const emptyForm = { name: '', email: '', password: '', role: 'user', dept: '', phone: '', color: COLORS[0] };

// ── Modal is defined OUTSIDE EmployeesPage so its identity never changes ────
function Modal({ title, onClose, children }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="flex-between mb-16">
          <h2 className="modal-title" style={{ margin: 0 }}>{title}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function EmployeesPage() {
  const { toast } = useToast();
  const [users, setUsers]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [modal, setModal]             = useState(null); // null | 'add' | 'edit' | 'block'
  const [form, setForm]               = useState(emptyForm);
  const [editId, setEditId]           = useState(null);
  const [search, setSearch]           = useState('');
  const [confirmBlock, setConfirmBlock] = useState(null);
  const [domain, setDomain]           = useState('');

  // helpers
  const set = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }));
  const setVal = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const resolvedEmail = (raw) => {
    if (!raw || !domain) return raw;
    const local = raw.includes('@') ? raw.split('@')[0] : raw;
    return `${local}@${domain}`;
  };

  const load = () => {
    setLoading(true);
    usersAPI.list()
      .then(r => setUsers(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    settingsAPI.get().then(r => setDomain(r.data.emailDomain || '')).catch(() => {});
  }, []);

  // ── CRUD handlers ──────────────────────────────────────────────────────────
  const handleAdd = async () => {
    if (!form.name || !form.email || !form.password) {
      toast('Name, email and password are required', 'error'); return;
    }
    try {
      await usersAPI.create(form);
      toast('Employee added successfully', 'success');
      setModal(null); setForm(emptyForm); load();
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to add employee', 'error');
    }
  };

  const handleEdit = async () => {
    if (!form.name || !form.email) { toast('Name and email are required', 'error'); return; }
    const payload = { ...form };
    if (!payload.password) delete payload.password;
    try {
      await usersAPI.update(editId, payload);
      toast('Employee updated', 'success');
      setModal(null); setForm(emptyForm); setEditId(null); load();
    } catch (err) {
      toast(err.response?.data?.error || 'Update failed', 'error');
    }
  };

  const handleBlock = async () => {
    try {
      const r = await usersAPI.block(confirmBlock.id);
      toast(r.data.message, confirmBlock.blocked ? 'success' : 'warning');
      setConfirmBlock(null); setModal(null); load();
    } catch (err) {
      toast(err.response?.data?.error || 'Failed', 'error');
    }
  };

  const handleDelete = async (user) => {
    if (!window.confirm(`Permanently delete ${user.name}? This cannot be undone.`)) return;
    try {
      await usersAPI.delete(user.id);
      toast('Employee deleted', 'success'); load();
    } catch (err) {
      toast(err.response?.data?.error || 'Delete failed', 'error');
    }
  };

  const openAdd = () => {
    setForm(emptyForm); setEditId(null); setModal('add');
  };

  const openEdit = (u) => {
    setEditId(u.id);
    const emailDisplay =
      domain && u.email.endsWith(`@${domain}`)
        ? u.email.split('@')[0]
        : u.email;
    setForm({
      name: u.name,
      email: emailDisplay,
      password: '',
      role: u.role,
      dept: u.dept || '',
      phone: u.phone || '',
      color: u.color || COLORS[0]
    });
    setModal('edit');
  };

  const openBlock = (u) => { setConfirmBlock(u); setModal('block'); };

  const filtered = users.filter(u =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    (u.dept || '').toLowerCase().includes(search.toLowerCase())
  );

  // ── Shared form JSX — inlined directly, NOT as a sub-component ────────────
  // This is the critical fix: defining FormBody/EmailField as functions inside
  // EmployeesPage caused React to unmount+remount every field on every keystroke.
  const formJSX = (isEdit) => (
    <>
      {/* Row 1: Name + Email */}
      <div className="grid-2" style={{ gap: 12 }}>
        <div className="form-group">
          <label className="form-label">Full Name *</label>
          <input
            className="form-input"
            placeholder="Arjun Sharma"
            value={form.name}
            onChange={set('name')}
          />
        </div>

        {/* Email / Username field */}
        <div className="form-group">
          <label className="form-label">{domain ? 'Username *' : 'Email Address *'}</label>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              className="form-input"
              type="text"
              autoComplete="off"
              placeholder={domain ? 'john.doe' : 'john.doe@company.in'}
              value={form.email}
              onChange={e => setVal('email', e.target.value.replace(/\s/g, ''))}
              style={{ paddingRight: domain ? `${domain.length * 8 + 36}px` : undefined }}
            />
            {domain && (
              <span style={{
                position: 'absolute', right: 10, pointerEvents: 'none',
                fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--mono)',
                background: 'var(--bg3)', paddingLeft: 2, userSelect: 'none'
              }}>
                @{domain}
              </span>
            )}
          </div>
          {domain && form.email && (
            <span className="form-hint" style={{ color: 'var(--green)' }}>
              ✓ Login email: <strong>{resolvedEmail(form.email)}</strong>
            </span>
          )}
          {!domain && (
            <span className="form-hint">Tip: lock domain in ⚙ Settings</span>
          )}
        </div>
      </div>

      {/* Row 2: Password + Phone */}
      <div className="grid-2" style={{ gap: 12 }}>
        <div className="form-group">
          <label className="form-label">
            Password {isEdit ? <span style={{ color: 'var(--text3)', fontWeight: 400 }}>(leave blank to keep)</span> : '*'}
          </label>
          <input
            className="form-input"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            value={form.password}
            onChange={set('password')}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Phone</label>
          <input
            className="form-input"
            placeholder="9876543210"
            value={form.phone}
            onChange={set('phone')}
          />
        </div>
      </div>

      {/* Row 3: Department + Role */}
      <div className="grid-2" style={{ gap: 12 }}>
        <div className="form-group">
          <label className="form-label">Department</label>
          <input
            className="form-input"
            placeholder="Engineering"
            value={form.dept}
            onChange={set('dept')}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Role</label>
          <select className="form-select" value={form.role} onChange={set('role')}>
            <option value="user">Employee</option>
            <option value="admin">Admin</option>
          </select>
        </div>
      </div>

      {/* Color picker */}
      <div className="form-group">
        <label className="form-label">Avatar Color</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
          {COLORS.map(c => (
            <div
              key={c}
              onClick={() => setVal('color', c)}
              style={{
                width: 28, height: 28, borderRadius: '50%', background: c,
                cursor: 'pointer',
                border: form.color === c ? '3px solid white' : '2px solid transparent',
                boxShadow: form.color === c ? `0 0 0 2px ${c}` : 'none',
                transition: 'all 0.12s'
              }}
            />
          ))}
        </div>
      </div>
    </>
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 24 }}>

      {/* Page header */}
      <div className="flex-between mb-24">
        <div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: 26, fontWeight: 800 }}>Employees</h1>
          <p style={{ color: 'var(--text2)', fontSize: 14 }}>
            {users.filter(u => u.role !== 'admin').length} staff members
            {domain && (
              <span style={{ color: 'var(--accent)', fontFamily: 'var(--mono)', marginLeft: 8 }}>
                · @{domain} locked
              </span>
            )}
          </p>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>+ Add Employee</button>
      </div>

      {/* Table card */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <input
            className="form-input"
            placeholder="Search by name, email or department…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ maxWidth: 380 }}
          />
        </div>

        <div className="table-wrap">
          {loading ? (
            <div className="empty-state"><div className="pulsing empty-icon">⟳</div></div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Email</th>
                  <th>Department</th>
                  <th>Phone</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Joined</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div
                          className="avatar avatar-sm"
                          style={{ background: `${u.color}22`, color: u.color }}
                        >{u.avatar}</div>
                        <span style={{ fontWeight: 600, color: 'var(--text)' }}>{u.name}</span>
                      </div>
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>{u.email}</td>
                    <td>{u.dept || '—'}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{u.phone || '—'}</td>
                    <td>
                      <span className={`badge badge-${u.role === 'admin' ? 'purple' : 'blue'}`}>
                        {u.role}
                      </span>
                    </td>
                    <td>
                      <span className={`badge badge-${u.blocked ? 'red' : 'green'}`}>
                        <span className="badge-dot" />{u.blocked ? 'Blocked' : 'Active'}
                      </span>
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {new Date(u.joinedAt).toLocaleDateString('en-IN')}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit(u)}>
                          Edit
                        </button>
                        {u.role !== 'admin' && (
                          <>
                            <button
                              className={`btn btn-sm ${u.blocked ? 'btn-success' : 'btn-amber'}`}
                              onClick={() => openBlock(u)}
                            >
                              {u.blocked ? 'Unblock' : 'Block'}
                            </button>
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => handleDelete(u)}
                            >
                              Del
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!filtered.length && (
                  <tr>
                    <td colSpan={8}>
                      <div className="empty-state">
                        <div className="empty-icon">👥</div>
                        <div className="empty-text">No employees found</div>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Add modal ── */}
      {modal === 'add' && (
        <Modal title="Add New Employee" onClose={() => setModal(null)}>
          {formJSX(false)}
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleAdd}>Add Employee</button>
          </div>
        </Modal>
      )}

      {/* ── Edit modal ── */}
      {modal === 'edit' && (
        <Modal
          title="Edit Employee"
          onClose={() => { setModal(null); setEditId(null); }}
        >
          {formJSX(true)}
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => { setModal(null); setEditId(null); }}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleEdit}>Save Changes</button>
          </div>
        </Modal>
      )}

      {/* ── Block/unblock confirm modal ── */}
      {modal === 'block' && confirmBlock && (
        <Modal
          title={`${confirmBlock.blocked ? 'Unblock' : 'Block'} Employee`}
          onClose={() => { setConfirmBlock(null); setModal(null); }}
        >
          <div style={{
            background: confirmBlock.blocked ? 'rgba(52,211,153,0.07)' : 'rgba(248,113,113,0.07)',
            border: `1px solid ${confirmBlock.blocked ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)'}`,
            borderRadius: 10, padding: 16, marginBottom: 16, fontSize: 14, color: 'var(--text2)',
            lineHeight: 1.6
          }}>
            {confirmBlock.blocked
              ? <>Unblock <strong style={{ color: 'var(--text)' }}>{confirmBlock.name}</strong>?<br />They will be able to mark attendance again.</>
              : <>Block <strong style={{ color: 'var(--text)' }}>{confirmBlock.name}</strong>?<br />They will <strong>not</strong> be able to mark attendance until unblocked.</>
            }
          </div>
          <div className="modal-footer">
            <button
              className="btn btn-ghost"
              onClick={() => { setConfirmBlock(null); setModal(null); }}
            >
              Cancel
            </button>
            <button
              className={`btn ${confirmBlock.blocked ? 'btn-success' : 'btn-danger'}`}
              onClick={handleBlock}
            >
              {confirmBlock.blocked ? 'Yes, Unblock' : 'Yes, Block User'}
            </button>
          </div>
        </Modal>
      )}

    </div>
  );
}
