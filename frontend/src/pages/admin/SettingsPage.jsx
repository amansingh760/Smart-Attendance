import React, { useState, useEffect } from 'react';
import { settingsAPI } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';

// Toggle switch — defined outside to avoid re-mount on every render
function Toggle({ checked, onChange, label, description, color = 'var(--accent2)' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: '14px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>{label}</div>
        <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>{description}</div>
      </div>
      <div
        onClick={() => onChange(!checked)}
        style={{
          width: 44, height: 24, borderRadius: 12, flexShrink: 0, cursor: 'pointer',
          background: checked ? color : 'var(--surface)',
          border: `1px solid ${checked ? color : 'var(--border)'}`,
          position: 'relative', transition: 'all 0.2s'
        }}
      >
        <div style={{
          position: 'absolute', top: 3,
          left: checked ? 22 : 3,
          width: 16, height: 16, borderRadius: '50%',
          background: 'white', transition: 'left 0.2s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
        }} />
      </div>
    </div>
  );
}

const DEFAULT = {
  emailDomain: '', companyName: 'GeoAttend',
  timezone: 'Asia/Kolkata', workStartTime: '09:00',
  workEndTime: '18:00', lateGraceMinutes: 15,
  requireFaceAuth: true, allowOutOfZoneRequest: true
};

export default function SettingsPage() {
  const { toast } = useToast();
  const [s, setS]           = useState(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [domainPreview, setDomainPreview] = useState('');

  const set = (key, val) => setS(prev => ({ ...prev, [key]: val }));

  useEffect(() => {
    settingsAPI.get()
      .then(r => { setS({ ...DEFAULT, ...r.data }); setDomainPreview(r.data.emailDomain || ''); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const r = await settingsAPI.update(s);
      setS({ ...DEFAULT, ...r.data });
      setDomainPreview(r.data.emailDomain || '');
      toast('Settings saved', 'success');
    } catch (err) {
      toast(err.response?.data?.error || 'Save failed', 'error');
    } finally { setSaving(false); }
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
      <span className="pulsing" style={{ fontSize: 32 }}>⟳</span>
    </div>
  );

  const sampleEmail = domainPreview ? `john@${domainPreview}` : 'john@yourcompany.com';

  return (
    <div style={{ padding: 24, maxWidth: 760 }}>
      <div className="mb-24">
        <h1 style={{ fontFamily: 'var(--display)', fontSize: 26, fontWeight: 800 }}>System Settings</h1>
        <p style={{ color: 'var(--text2)', fontSize: 14 }}>Configure company-wide attendance policies and security</p>
      </div>

      {/* ── Security & Authentication ── */}
      <div className="card mb-16">
        <div style={{ display: 'flex', gap: 14, marginBottom: 6 }}>
          <div style={{ fontSize: 26 }}>🔒</div>
          <div>
            <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 16, marginBottom: 2 }}>Security & Authentication</div>
            <div style={{ fontSize: 12, color: 'var(--text2)' }}>Control how employees verify identity when marking attendance</div>
          </div>
        </div>

        <Toggle
          checked={!!s.requireFaceAuth}
          onChange={v => set('requireFaceAuth', v)}
          label="Require Face Authentication"
          description="Employees must verify their face via webcam before check-in or check-out. Falls back gracefully if face is not enrolled — enroll faces in the Attendance page."
          color="var(--accent2)"
        />
        <Toggle
          checked={!!s.allowOutOfZoneRequest}
          onChange={v => set('allowOutOfZoneRequest', v)}
          label="Allow Out-of-Zone Override Requests"
          description="When outside the geofence, employees can submit an override request with a reason and face verification. Admin must approve before attendance is marked."
          color="var(--green)"
        />
      </div>

      {/* ── Email Domain Lock ── */}
      <div className="card mb-16">
        <div style={{ display: 'flex', gap: 14, marginBottom: 18 }}>
          <div style={{ fontSize: 26 }}>🔗</div>
          <div>
            <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 16, marginBottom: 2 }}>Email Domain Lock</div>
            <div style={{ fontSize: 12, color: 'var(--text2)' }}>
              Fix the email suffix for all user accounts. Admin only types the username — the domain is appended automatically.
            </div>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Company Domain</label>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ color: 'var(--text3)', fontSize: 16, fontFamily: 'var(--mono)' }}>@</span>
            <input
              className="form-input"
              placeholder="company.in"
              value={s.emailDomain}
              onChange={e => {
                const v = e.target.value.replace(/^@/, '').toLowerCase();
                set('emailDomain', v);
                setDomainPreview(v);
              }}
              style={{ fontFamily: 'var(--mono)', maxWidth: 280 }}
            />
            {s.emailDomain && (
              <button className="btn btn-ghost btn-sm" onClick={() => { set('emailDomain', ''); setDomainPreview(''); }}>
                Clear
              </button>
            )}
          </div>
          <span className="form-hint">e.g. <code>company.in</code> or <code>myorg.com</code></span>
        </div>

        {/* Live preview */}
        <div style={{
          background: domainPreview ? 'rgba(52,211,153,0.05)' : 'var(--bg3)',
          border: `1px solid ${domainPreview ? 'rgba(52,211,153,0.22)' : 'var(--border)'}`,
          borderRadius: 10, padding: 14
        }}>
          <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Preview</div>
          {domainPreview ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                ['Admin types', 'john', 'var(--text2)'],
                ['System stores as', sampleEmail, 'var(--green)'],
                ['Employee logs in with', sampleEmail, 'var(--green)'],
              ].map(([k, v, c]) => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 12, color: 'var(--text3)', width: 160, flexShrink: 0 }}>{k}</span>
                  <code style={{ background: 'var(--bg2)', padding: '2px 10px', borderRadius: 6, fontSize: 12, color: c }}>{v}</code>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text3)' }}>
              No domain set — admin must enter full email addresses when creating users.
            </div>
          )}
        </div>

        {domainPreview && (
          <div style={{ background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 8, padding: 11, marginTop: 12, fontSize: 12, color: 'var(--amber)', lineHeight: 1.6 }}>
            ⚠ Changing the domain only affects new/updated users — existing emails are not retroactively changed.
          </div>
        )}
      </div>

      {/* ── Company Info ── */}
      <div className="card mb-16">
        <div style={{ display: 'flex', gap: 14, marginBottom: 18 }}>
          <div style={{ fontSize: 26 }}>🏢</div>
          <div>
            <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 16, marginBottom: 2 }}>Company Information</div>
            <div style={{ fontSize: 12, color: 'var(--text2)' }}>Shown in reports and notifications</div>
          </div>
        </div>
        <div className="grid-2" style={{ gap: 12 }}>
          <div className="form-group">
            <label className="form-label">Company Name</label>
            <input
              className="form-input" placeholder="GeoAttend Corp"
              value={s.companyName || ''}
              onChange={e => set('companyName', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Timezone</label>
            <select className="form-select" value={s.timezone || 'Asia/Kolkata'} onChange={e => set('timezone', e.target.value)}>
              <option value="Asia/Kolkata">Asia/Kolkata (IST +5:30)</option>
              <option value="Asia/Dubai">Asia/Dubai (GST +4:00)</option>
              <option value="Asia/Singapore">Asia/Singapore (SGT +8:00)</option>
              <option value="Europe/London">Europe/London (GMT/BST)</option>
              <option value="America/New_York">America/New_York (EST/EDT)</option>
              <option value="America/Los_Angeles">America/Los_Angeles (PST/PDT)</option>
              <option value="UTC">UTC</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Work Hours Policy ── */}
      <div className="card mb-24">
        <div style={{ display: 'flex', gap: 14, marginBottom: 18 }}>
          <div style={{ fontSize: 26 }}>⏰</div>
          <div>
            <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 16, marginBottom: 2 }}>Work Hours Policy</div>
            <div style={{ fontSize: 12, color: 'var(--text2)' }}>
              Sets when check-in is considered "on time" vs "late". Affects the late reason prompt in the employee check-in screen.
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
          <div className="form-group">
            <label className="form-label">Check-in Opens At</label>
            <input type="time" className="form-input" value={s.checkInOpenTime || '08:00'} onChange={e => set('checkInOpenTime', e.target.value)} />
            <span className="form-hint">Earliest time employees can check in</span>
          </div>
          <div className="form-group">
            <label className="form-label">Work Start Time</label>
            <input type="time" className="form-input" value={s.workStartTime || '09:00'} onChange={e => set('workStartTime', e.target.value)} />
            <span className="form-hint">On-time threshold</span>
          </div>
          <div className="form-group">
            <label className="form-label">Work End Time</label>
            <input type="time" className="form-input" value={s.workEndTime || '18:00'} onChange={e => set('workEndTime', e.target.value)} />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Late Grace Period (minutes)</label>
          <input
            type="number" className="form-input" min={0} max={120}
            style={{ maxWidth: 160 }}
            value={s.lateGraceMinutes ?? 15}
            onChange={e => set('lateGraceMinutes', parseInt(e.target.value) || 0)}
          />
          <span className="form-hint">
            Employees checking in within {s.lateGraceMinutes ?? 15} min after work start are still marked <strong>Present</strong> (not Late)
          </span>
        </div>

        {/* Policy visual */}
        <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Timeline</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { label: 'On time', range: `Before ${s.workStartTime || '09:00'}`, color: 'green' },
              { label: 'Grace', range: `+${s.lateGraceMinutes ?? 15} min`, color: 'amber' },
              { label: 'Late', range: `After grace`, color: 'red' },
            ].map(item => (
              <div key={item.label} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 14px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={`badge badge-${item.color}`} style={{ fontSize: 10 }}>{item.label}</span>
                <span style={{ color: 'var(--text3)', fontFamily: 'var(--mono)', fontSize: 11 }}>{item.range}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Save */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button
          className="btn btn-ghost"
          onClick={() => {
            settingsAPI.get().then(r => { setS({ ...DEFAULT, ...r.data }); setDomainPreview(r.data.emailDomain || ''); }).catch(() => {});
          }}
        >
          Reset
        </button>
        <button className="btn btn-primary btn-lg" onClick={handleSave} disabled={saving}>
          {saving ? <span className="spinning">⟳</span> : '💾'} {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
