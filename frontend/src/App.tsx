import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { Empty, Loading } from './components/ui';
import { ChangePasswordPage, LoginPage, SetupPage } from './pages/Auth';
import { DashboardPage } from './pages/Dashboard';
import { DriftPage } from './pages/Drift';
import { IncidentsPage } from './pages/Incidents';
import { MonitorDetailPage } from './pages/MonitorDetail';
import { MonitorFormPage } from './pages/MonitorForm';
import { MonitorsPage } from './pages/Monitors';
import { AccountPage, AuditPage, ChannelsPage, TokensPage, UsersPage } from './pages/Settings';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, needsSetup } = useAuth();
  const loc = useLocation();
  if (loading) return <Loading label="Starting Tripline…" />;
  if (needsSetup) return <Navigate to="/setup" replace />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/change-password" element={<ChangePasswordPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="monitors" element={<MonitorsPage />} />
        <Route path="monitors/new" element={<MonitorFormPage />} />
        <Route path="monitors/:id" element={<MonitorDetailPage />} />
        <Route path="monitors/:id/edit" element={<MonitorFormPage />} />
        <Route path="drift" element={<DriftPage />} />
        <Route path="incidents" element={<IncidentsPage />} />
        <Route path="settings/channels" element={<ChannelsPage />} />
        <Route path="settings/users" element={<UsersPage />} />
        <Route path="settings/tokens" element={<TokensPage />} />
        <Route path="settings/audit" element={<AuditPage />} />
        <Route path="settings/account" element={<AccountPage />} />
        <Route path="*" element={<Empty title="Page not found">That page doesn’t exist.</Empty>} />
      </Route>
    </Routes>
  );
}
