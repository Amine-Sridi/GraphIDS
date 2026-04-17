import { createBrowserRouter, Navigate, Outlet } from 'react-router';
import { useAuth } from './context/AuthContext';
import { LoginPage } from './components/auth/LoginPage';
import { RootLayout } from './components/layout/RootLayout';
import { IDSDashboard } from './components/IDSDashboard';
import { AlertsPage } from './components/pages/AlertsPage';
import { FlowsPage } from './components/pages/FlowsPage';
import { GraphPage } from './components/pages/GraphPage';
import { LogsPage } from './components/pages/LogsPage';
import { IngestionPage } from './components/pages/IngestionPage';

// Guard: redirect to /login if not authenticated
function RequireAuth() {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}

// Guard: redirect to / if already authenticated
function RedirectIfAuth() {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated) return <Navigate to="/" replace />;
  return <Outlet />;
}

export const router = createBrowserRouter([
  {
    element: <RedirectIfAuth />,
    children: [{ path: '/login', Component: LoginPage }],
  },
  {
    element: <RequireAuth />,
    children: [
      {
        path: '/',
        Component: RootLayout,
        children: [
          { index: true, Component: IDSDashboard },
          { path: 'alerts', Component: AlertsPage },
          { path: 'flows', Component: FlowsPage },
          { path: 'graph', Component: GraphPage },
          { path: 'logs', Component: LogsPage },
          { path: 'ingestion', Component: IngestionPage },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
