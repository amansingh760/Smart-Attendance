import React, { useState, useEffect } from 'react';
import { holidaysAPI } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';

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

const HOLIDAY_TYPES = [
  { value: 'public', label: '🏛️ Public Holiday', color: 'blue' },
  { value: 'company', label: '🏢 Company Holiday', color: 'purple' },
  { value: 'optional', label: '🗓️ Optional Holiday', color: 'amber' },
  { value: 'restricted', label: '📅 Restricted Holiday', color: 'gray' }
];

export default function HolidaysPage() {
  const { toast } = useToast();
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name: '', date: '', type: 'public', description: '' });
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear().toString());

  const load = () => {
    setLoading(true);
    holidaysAPI.list().then(r => setHolidays(r.data)).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    if (!form.name || !form.date) { toast('Name and date are required', 'error'); return; }
    try {
      await holidaysAPI.create(form);
      toast(`Holiday "${form.name}" added`, 'success');
      setModal(false);
      setForm({ name: '', date: '', type: 'public', description: '' });
      load();
    } catch (err) { toast(err.response?.data?.error || 'Failed to add holiday', 'error'); }
  };

  const handleDelete = async (h) => {
    if (!window.confirm(`Remove holiday "${h.name}"?`)) return;
    try {
      await holidaysAPI.delete(h.id);
      toast('Holiday removed', 'success');
      load();
    } catch (err) { toast('Delete failed', 'error'); }
  };

  const filtered = holidays.filter(h => h.date.startsWith(yearFilter));
  const today = new Date().toISOString().split('T')[0];
  const upcoming = filtered.filter(h => h.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past = filtered.filter(h => h.date < today).sort((a, b) => b.date.localeCompare(a.date));

  const typeInfo = (type) => HOLIDAY_TYPES.find(t => t.value === type) || HOLIDAY_TYPES[0];

  const HolidayRow = ({ h }) => {
    const ti = typeInfo(h.type);
    const isPast = h.date < today;
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px',
        borderBottom: '1px solid var(--border)',
        background: h.date === today ? 'rgba(251,191,36,0.04)' : 'transparent',
        opacity: isPast ? 0.65 : 1
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 10, flexShrink: 0,
          background: 'var(--bg3)', border: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
        }}>
          <div style={{ fontSize: 16, lineHeight: 1 }}>{new Date(h.date + 'T00:00:00').getDate()}</div>
          <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase' }}>
            {new Date(h.date + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short' })}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{h.name}</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
            {new Date(h.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
          {h.description && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3 }}>{h.description}</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {h.date === today && <span className="badge badge-amber" style={{ fontSize: 10 }}>Today</span>}
          <span className={`badge badge-${ti.color}`} style={{ fontSize: 10 }}>{ti.label}</span>
          <button className="btn btn-danger btn-sm" onClick={() => handleDelete(h)}>Remove</button>
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding: 24 }}>
      <div className="flex-between mb-24">
        <div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: 26, fontWeight: 800 }}>Holidays</h1>
          <p style={{ color: 'var(--text2)', fontSize: 14 }}>{filtered.length} holidays in {yearFilter}</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <select className="form-select" value={yearFilter} onChange={e => setYearFilter(e.target.value)} style={{ width: 100 }}>
            {[2023, 2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button className="btn btn-primary" onClick={() => setModal(true)}>+ Mark Holiday</button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid-4 mb-24">
        {HOLIDAY_TYPES.map(t => (
          <div key={t.value} className="stat-card">
            <div className="stat-label">{t.label}</div>
            <div className="stat-value" style={{ color: `var(--${t.color})`, fontSize: 26 }}>
              {filtered.filter(h => h.type === t.value).length}
            </div>
          </div>
        ))}
      </div>

      {/* Calendar grid for current month */}
      <div className="card mb-24">
        <div className="card-title">Current Month</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
            <div key={d} style={{ textAlign: 'center', fontSize: 11, color: 'var(--text3)', fontWeight: 700, padding: '4px 0' }}>{d}</div>
          ))}
          {(() => {
            const now = new Date();
            const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
            const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
            const cells = [];
            for (let i = 0; i < firstDay; i++) cells.push(<div key={`e${i}`} />);
            for (let d = 1; d <= daysInMonth; d++) {
              const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
              const isHoliday = holidays.find(h => h.date === dateStr);
              const isToday = dateStr === today;
              const isSunday = new Date(dateStr).getDay() === 0;
              cells.push(
                <div key={d} style={{
                  textAlign: 'center', padding: '6px 2px', borderRadius: 6, fontSize: 13,
                  background: isHoliday ? 'rgba(251,191,36,0.15)' : isToday ? 'rgba(59,130,246,0.15)' : 'transparent',
                  border: isToday ? '1px solid rgba(59,130,246,0.4)' : isHoliday ? '1px solid rgba(251,191,36,0.3)' : '1px solid transparent',
                  color: isHoliday ? 'var(--amber)' : isSunday ? 'var(--red)' : isToday ? 'var(--accent)' : 'var(--text2)',
                  fontWeight: isToday || isHoliday ? 700 : 400,
                  title: isHoliday?.name
                }}>
                  {d}
                  {isHoliday && <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--amber)', margin: '2px auto 0' }} />}
                </div>
              );
            }
            return cells;
          })()}
        </div>
      </div>

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <div className="card mb-16" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 15 }}>Upcoming Holidays</span>
          </div>
          {loading ? <div className="empty-state"><div className="pulsing empty-icon">⟳</div></div>
            : upcoming.map(h => <HolidayRow key={h.id} h={h} />)}
        </div>
      )}

      {/* Past */}
      {past.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 15, color: 'var(--text2)' }}>Past Holidays</span>
          </div>
          {past.map(h => <HolidayRow key={h.id} h={h} />)}
        </div>
      )}

      {!filtered.length && !loading && (
        <div className="card">
          <div className="empty-state"><div className="empty-icon">🎉</div><div className="empty-text">No holidays marked for {yearFilter}</div></div>
        </div>
      )}

      {/* Add modal */}
      {modal && (
        <Modal title="Mark Holiday" onClose={() => setModal(false)}>
          <div className="form-group">
            <label className="form-label">Holiday Name *</label>
            <input className="form-input" placeholder="e.g. Republic Day" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="grid-2" style={{ gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Date *</label>
              <input type="date" className="form-input" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Type</label>
              <select className="form-select" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                {HOLIDAY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Description (optional)</label>
            <input className="form-input" placeholder="Additional details..." value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 8, padding: 12, fontSize: 13, color: 'var(--amber)', marginBottom: 8 }}>
            ⚠ On this date, employees will see a holiday notice and will NOT be able to mark attendance.
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleAdd}>Mark as Holiday</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
