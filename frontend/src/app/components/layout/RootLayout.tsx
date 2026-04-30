import { Outlet } from 'react-router';
import { Sidebar } from './Sidebar';
import { BackendProvider } from '../../context/BackendContext';
import { SessionHeader } from './SessionHeader';

export function RootLayout() {
  return (
    <BackendProvider>
      <div
        style={{
          display: 'flex',
          height: '100vh',
          overflow: 'hidden',
          background: '#0d1117',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <Sidebar />
        {/* Main content area — flex column so children can also flex */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <SessionHeader />
          <Outlet />
        </div>
      </div>
    </BackendProvider>
  );
}
