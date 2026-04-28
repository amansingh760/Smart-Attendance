import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth }    from '../contexts/AuthContext';
import { statsAPI, leavesAPI } from '../services/api';

const NAV_STAFF = [
  { to: '/checkin', icon: '📍', label: 'Check In / Out' },
  { to: '/history', icon: '📋', label: 'My History' },
  { to: '/leaves',  icon: '🏖️', label: 'My Leaves' },
];

const NAV_ADMIN = [
  { to: '/dashboard',      icon: '⚡',  label: 'Dashboard' },
  { to: '/employees',      icon: '👥',  label: 'Employees' },
  { to: '/attendance',     icon: '📊',  label: 'Attendance' },
  { to: '/monthly-report', icon: '📈',  label: 'Monthly Report' },
  { to: '/overrides',      icon: '📡',  label: 'Override Requests', badgeKey: 'pendingOverrides' },
  { to: '/admin-leaves',   icon: '🏖️', label: 'Leave Management',  badgeKey: 'pendingLeaves' },
  { to: '/holidays',       icon: '🎉',  label: 'Holidays' },
  { to: '/zones',          icon: '🗺️', label: 'Geofence Zones' },
  { to: '/audit',          icon: '🔍',  label: 'Audit Log' },
  { to: '/settings',       icon: '⚙️', label: 'Settings' },
];

export default function Layout() {
  const { user, logout }  = useAuth();
  const navigate          = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [badges, setBadges]       = useState({ pendingOverrides: 0, pendingLeaves: 0 });

  const nav = user?.role === 'admin' ? NAV_ADMIN : NAV_STAFF;

  /* Poll pending counts every 30 s (admin only) */
  useEffect(() => {
    if (user?.role !== 'admin') return;
    const fetch = async () => {
      try {
        const [sr, lr] = await Promise.all([
          statsAPI.get(),
          leavesAPI.list({ status: 'pending' })
        ]);
        setBadges({
          pendingOverrides: sr.data.pendingOverrides || 0,
          pendingLeaves:    lr.data.length           || 0
        });
      } catch {}
    };
    fetch();
    const id = setInterval(fetch, 30000);
    return () => clearInterval(id);
  }, [user]);

  return (
    <div style={{ display:'flex', height:'100vh', overflow:'hidden' }}>

      {/* ── Sidebar ── */}
      <aside style={{
        width: collapsed ? 60 : 228, flexShrink: 0,
        background: 'var(--bg2)', borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        transition: 'width 0.2s ease', overflow: 'hidden'
      }}>

        {/* Logo */}
        <div style={{ padding:'15px 12px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:10, minHeight:60, flexShrink:0 }}>
          <div style={{ width:32, height:32, borderRadius:8, flexShrink:0, background:'linear-gradient(135deg,#3b82f6,#a78bfa)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16 }}>📍</div>
          {!collapsed && <span style={{ fontFamily:'var(--display)', fontWeight:800, fontSize:17, whiteSpace:'nowrap', letterSpacing:'-0.3px' }}>GeoAttend</span>}
        </div>

        {/* Nav links */}
        <nav style={{ flex:1, padding:'10px 6px', display:'flex', flexDirection:'column', gap:1, overflowY:'auto', overflowX:'hidden' }}>
          {nav.map(item => {
            const badgeCount = item.badgeKey ? (badges[item.badgeKey] || 0) : 0;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                title={collapsed ? item.label : undefined}
                style={({ isActive }) => ({
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', borderRadius: 8, textDecoration: 'none',
                  fontSize: 13, fontWeight: 500,
                  color:      isActive ? 'var(--accent)'           : 'var(--text2)',
                  background: isActive ? 'rgba(59,130,246,0.1)'    : 'transparent',
                  transition: 'all 0.12s', whiteSpace: 'nowrap', overflow: 'hidden'
                })}
              >
                {/* Icon + optional red dot when collapsed */}
                <span style={{ fontSize:15, flexShrink:0, position:'relative' }}>
                  {item.icon}
                  {collapsed && badgeCount > 0 && (
                    <span style={{ position:'absolute', top:-4, right:-4, width:7, height:7, borderRadius:'50%', background:'var(--red)', border:'1px solid var(--bg2)' }} />
                  )}
                </span>

                {!collapsed && (
                  <>
                    <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis' }}>{item.label}</span>
                    {badgeCount > 0 && (
                      <span style={{ background:'var(--red)', color:'white', borderRadius:20, padding:'1px 6px', fontSize:10, fontWeight:700, flexShrink:0 }}>
                        {badgeCount}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* Footer — user chip + controls */}
        <div style={{ padding:'10px 6px', borderTop:'1px solid var(--border)', flexShrink:0, display:'flex', flexDirection:'column', gap:4 }}>
          {!collapsed && (
            <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 10px', marginBottom:2 }}>
              <div className="avatar avatar-sm" style={{ background:`${user?.color}22`, color:user?.color, flexShrink:0 }}>{user?.avatar}</div>
              <div style={{ minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{user?.name}</div>
                <div style={{ fontSize:11, color:'var(--text3)', textTransform:'capitalize' }}>{user?.role}</div>
              </div>
            </div>
          )}
          <button onClick={() => setCollapsed(c => !c)} className="btn btn-ghost btn-sm" style={{ width:'100%', justifyContent:'center' }} title={collapsed ? 'Expand' : 'Collapse'}>
            {collapsed ? '→' : '← Collapse'}
          </button>
          <button onClick={() => { logout(); navigate('/login'); }} className="btn btn-sm"
            style={{ width:'100%', justifyContent:'center', background:'rgba(248,113,113,0.08)', color:'var(--red)', border:'1px solid rgba(248,113,113,0.2)' }}
            title={collapsed ? 'Logout' : undefined}>
            {collapsed ? '🚪' : '🚪 Logout'}
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main style={{ flex:1, overflow:'auto', background:'var(--bg)' }}>
        <Outlet />
      </main>
    </div>
  );
}
