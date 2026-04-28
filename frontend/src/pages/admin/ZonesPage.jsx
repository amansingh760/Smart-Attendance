import React, { useState, useEffect } from 'react';
import { zonesAPI } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import GeoMap from '../../components/GeoMap';

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

const ICONS = ['🏢', '🏛️', '🏭', '🔬', '🏗️', '🏪', '🏥', '🏫', '🏬', '📍', '🗺️', '🏠'];
const emptyForm = { name: '', lat: '', lng: '', radius: 150, icon: '🏢', address: '', active: true };

export default function ZonesPage() {
  const { toast } = useToast();
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState(null);
  const [previewZone, setPreviewZone] = useState(null);

  const load = () => {
    setLoading(true);
    zonesAPI.list().then(r => { setZones(r.data); setPreviewZone(r.data[0] || null); }).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    if (!form.name || !form.lat || !form.lng || !form.radius) { toast('Fill all required fields', 'error'); return; }
    const payload = { ...form, lat: parseFloat(form.lat), lng: parseFloat(form.lng), radius: parseInt(form.radius) };
    try {
      if (editId) {
        await zonesAPI.update(editId, payload);
        toast('Zone updated', 'success');
      } else {
        await zonesAPI.create(payload);
        toast('Zone created', 'success');
      }
      setModal(null); setForm(emptyForm); setEditId(null);
      load();
    } catch (err) { toast(err.response?.data?.error || 'Save failed', 'error'); }
  };

  const handleDelete = async (zone) => {
    if (!window.confirm(`Delete zone "${zone.name}"?`)) return;
    try {
      await zonesAPI.delete(zone.id);
      toast('Zone deleted', 'success');
      load();
    } catch (err) { toast('Delete failed', 'error'); }
  };

  const openEdit = (z) => {
    setEditId(z.id);
    setForm({ name: z.name, lat: z.lat, lng: z.lng, radius: z.radius, icon: z.icon, address: z.address, active: z.active });
    setModal('form');
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) { toast('Geolocation not supported', 'error'); return; }
    navigator.geolocation.getCurrentPosition(
      pos => setForm(f => ({ ...f, lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) })),
      () => toast('Could not get location', 'error')
    );
  };

  return (
    <div style={{ padding: 24 }}>
      <div className="flex-between mb-24">
        <div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: 26, fontWeight: 800 }}>Geofence Zones</h1>
          <p style={{ color: 'var(--text2)', fontSize: 14 }}>{zones.length} zone{zones.length !== 1 ? 's' : ''} configured</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setForm(emptyForm); setEditId(null); setModal('form'); }}>+ Add Zone</button>
      </div>

      <div className="grid-2" style={{ gap: 20, alignItems: 'start' }}>
        {/* Zones list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {loading ? <div className="card"><div className="empty-state pulsing">⟳ Loading...</div></div>
            : zones.map(z => (
              <div key={z.id} className="card" style={{
                cursor: 'pointer',
                border: previewZone?.id === z.id ? '1px solid rgba(91,156,246,0.4)' : '1px solid var(--border)',
                transition: 'border 0.15s'
              }} onClick={() => setPreviewZone(z)}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                  <div style={{
                    width: 48, height: 48, borderRadius: 12, flexShrink: 0,
                    background: 'rgba(91,156,246,0.1)', border: '1px solid rgba(91,156,246,0.2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22
                  }}>{z.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{z.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--mono)', marginTop: 3 }}>
                      {z.lat.toFixed(4)}, {z.lng.toFixed(4)}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{z.address}</div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className="badge badge-blue" style={{ fontSize: 11 }}>📐 {z.radius}m radius</span>
                      <span className={`badge badge-${z.active ? 'green' : 'gray'}`} style={{ fontSize: 11 }}>
                        <span className="badge-dot" />{z.active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); openEdit(z); }}>Edit</button>
                    <button className="btn btn-danger btn-sm" onClick={e => { e.stopPropagation(); handleDelete(z); }}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
          {!zones.length && !loading && (
            <div className="card">
              <div className="empty-state"><div className="empty-icon">🗺️</div><div className="empty-text">No zones created yet</div></div>
            </div>
          )}
        </div>

        {/* Map preview */}
        <div style={{ position: 'sticky', top: 24 }}>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 15 }}>
                {previewZone ? `Preview: ${previewZone.name}` : 'Zone Preview'}
              </span>
              {previewZone && <span className="badge badge-blue" style={{ fontSize: 11 }}>r = {previewZone.radius}m</span>}
            </div>
            {previewZone
              ? <GeoMap activeZone={previewZone} allZones={zones} />
              : <div className="empty-state" style={{ height: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <div className="empty-icon">🗺️</div><div className="empty-text">Select a zone to preview</div>
                </div>
            }
          </div>
          {previewZone && (
            <div className="card mt-16" style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
              <div className="card-title">Zone Details</div>
              {[
                ['Name', previewZone.name],
                ['Latitude', previewZone.lat.toFixed(6) + '°'],
                ['Longitude', previewZone.lng.toFixed(6) + '°'],
                ['Radius', previewZone.radius + ' meters'],
                ['Address', previewZone.address || '—'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', color: 'var(--text2)' }}>
                  <span style={{ color: 'var(--text3)' }}>{k}</span>
                  <span style={{ color: 'var(--accent)' }}>{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Form Modal */}
      {modal === 'form' && (
        <Modal title={editId ? 'Edit Zone' : 'Add Geofence Zone'} onClose={() => { setModal(null); setEditId(null); }}>
          <div className="form-group">
            <label className="form-label">Zone Name *</label>
            <input className="form-input" placeholder="e.g. Main Office HQ" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Icon</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {ICONS.map(ic => (
                <div key={ic} onClick={() => setForm(f => ({ ...f, icon: ic }))}
                  style={{ width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, cursor: 'pointer', border: form.icon === ic ? '2px solid var(--accent)' : '1px solid var(--border)', background: form.icon === ic ? 'rgba(91,156,246,0.1)' : 'transparent' }}>
                  {ic}
                </div>
              ))}
            </div>
          </div>
          <div className="grid-2" style={{ gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Latitude *</label>
              <input className="form-input" type="number" step="0.000001" placeholder="25.317600" value={form.lat} onChange={e => setForm(f => ({ ...f, lat: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Longitude *</label>
              <input className="form-input" type="number" step="0.000001" placeholder="82.973900" value={form.lng} onChange={e => setForm(f => ({ ...f, lng: e.target.value }))} />
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" style={{ marginBottom: 12 }} onClick={useMyLocation}>📍 Use my current location</button>
          <div className="grid-2" style={{ gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Radius (meters) *</label>
              <input className="form-input" type="number" min="10" max="5000" value={form.radius} onChange={e => setForm(f => ({ ...f, radius: e.target.value }))} />
              <span className="form-hint">Min 10m, Max 5000m</span>
            </div>
            <div className="form-group">
              <label className="form-label">Status</label>
              <select className="form-select" value={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.value === 'true' }))}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Address / Description</label>
            <input className="form-input" placeholder="e.g. Varanasi, UP" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => { setModal(null); setEditId(null); }}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave}>{editId ? 'Save Changes' : 'Create Zone'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
