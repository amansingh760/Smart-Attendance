import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth }   from './contexts/AuthContext';
import { ToastProvider }           from './contexts/ToastContext';
import LoginPage                   from './pages/LoginPage';
import Layout                      from './components/Layout';
import CheckInPage                 from './pages/CheckInPage';
import MyHistoryPage               from './pages/MyHistoryPage';
import LeavePage                   from './pages/LeavePage';
import DashboardPage               from './pages/admin/DashboardPage';
import EmployeesPage               from './pages/admin/EmployeesPage';
import AttendancePage              from './pages/admin/AttendancePage';
import MonthlyReportPage           from './pages/admin/MonthlyReportPage';
import OverrideRequestsPage        from './pages/admin/OverrideRequestsPage';
import AdminLeavePage              from './pages/admin/AdminLeavePage';
import HolidaysPage                from './pages/admin/HolidaysPage';
import ZonesPage                   from './pages/admin/ZonesPage';
import AuditPage                   from './pages/admin/AuditPage';
import SettingsPage                from './pages/admin/SettingsPage';

function PrivateRoute({ children, adminOnly = false }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--text2)', fontSize:32 }}>
      <span className="pulsing">⟳</span>
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/checkin" replace />;
  return children;
}

function AppRoutes() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={user.role === 'admin' ? '/dashboard' : '/checkin'} /> : <LoginPage />} />

      <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
        <Route index element={<Navigate to={user?.role === 'admin' ? '/dashboard' : '/checkin'} />} />

        {/* ── Staff routes ── */}
        <Route path="checkin" element={<CheckInPage />} />
        <Route path="history" element={<MyHistoryPage />} />
        <Route path="leaves"  element={<LeavePage />} />

        {/* ── Admin routes ── */}
        <Route path="dashboard"      element={<PrivateRoute adminOnly><DashboardPage /></PrivateRoute>} />
        <Route path="employees"      element={<PrivateRoute adminOnly><EmployeesPage /></PrivateRoute>} />
        <Route path="attendance"     element={<PrivateRoute adminOnly><AttendancePage /></PrivateRoute>} />
        <Route path="monthly-report" element={<PrivateRoute adminOnly><MonthlyReportPage /></PrivateRoute>} />
        <Route path="overrides"      element={<PrivateRoute adminOnly><OverrideRequestsPage /></PrivateRoute>} />
        <Route path="admin-leaves"   element={<PrivateRoute adminOnly><AdminLeavePage /></PrivateRoute>} />
        <Route path="holidays"       element={<PrivateRoute adminOnly><HolidaysPage /></PrivateRoute>} />
        <Route path="zones"          element={<PrivateRoute adminOnly><ZonesPage /></PrivateRoute>} />
        <Route path="audit"          element={<PrivateRoute adminOnly><AuditPage /></PrivateRoute>} />
        <Route path="settings"       element={<PrivateRoute adminOnly><SettingsPage /></PrivateRoute>} />
      </Route>

      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
