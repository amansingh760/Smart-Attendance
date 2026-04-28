import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

export default function LoginPage() {
  const { login } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const user = await login(form.email, form.password);
      toast(`Welcome back, ${user.name}!`, 'success');
      navigate(user.role === 'admin' ? '/dashboard' : '/checkin');
    } catch (err) {
      toast(err.response?.data?.error || 'Login failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  // const fillDemo = (role) => {
  //   if (role === 'admin') setForm({ email: 'admin@geoattend.in', password: 'admin123' });
  //   else setForm({ email: 'arjun@geoattend.in', password: 'user123' });
  // };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 20 }}>
      {/* Background effect */}
      <div style={{ position: 'fixed', inset: 0, background: 'radial-gradient(ellipse 60% 50% at 50% 0%, rgba(59,130,246,0.08) 0%, transparent 70%)', pointerEvents: 'none' }} />

      <div style={{ width: '100%', maxWidth: 420, animation: 'slideUp 0.3s ease' }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg,#3b82f6,#a78bfa)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, margin: '0 auto 16px' }}>📍</div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: 32, fontWeight: 800, marginBottom: 6 }}>GeoAttend</h1>
          <p style={{ color: 'var(--text2)', fontSize: 14 }}>Geofencing-powered attendance system</p>
        </div>

        <div className="card" style={{ padding: 32 }}>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Email Address</label>
              <input className="form-input" type="email" placeholder="you@company.in" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
            </div>
            <div className="form-group" style={{ marginBottom: 20 }}>
              <label className="form-label">Password</label>
              <input className="form-input" type="password" placeholder="••••••••" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required />
            </div>
            <button className="btn btn-primary btn-full btn-lg" type="submit" disabled={loading}>
              {loading ? <span className="spinning">⟳</span> : null}
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          {/* <div className="divider" style={{ margin: '24px 0 16px' }} /> 
           <p style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'center', marginBottom: 10 }}>Quick demo access</p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost" style={{ flex: 1, fontSize: 12 }} onClick={() => fillDemo('admin')}>👑 Admin Demo</button>
            <button className="btn btn-ghost" style={{ flex: 1, fontSize: 12 }} onClick={() => fillDemo('user')}>👤 Staff Demo</button>
          </div> */}
        </div>

        {/* <p style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: 'var(--text3)' }}>
          Default credentials — Admin: admin@geoattend.in / admin123
        </p> */}
      </div>
    </div>
  );
}
