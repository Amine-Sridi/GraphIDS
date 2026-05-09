import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router';
import {
  Activity, Bell, List, TrendingUp, Settings,
  LogOut, ChevronLeft, ChevronRight, ShieldAlert, User, Shield,
  Play, Pause,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { graphIdsApi } from '../../utils/api';

const NAV_ITEMS = [
  { path: '/', icon: Activity, label: 'Live Detection', exact: true },
  { path: '/alerts', icon: Bell, label: 'Alerts' },
  { path: '/flows', icon: List, label: 'Flow Inspector' },
  { path: '/performance', icon: TrendingUp, label: 'Model Performance' },
  { path: '/settings', icon: Settings, label: 'Settings' },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [alertActive, setAlertActive] = useState(false);
  const [streamActive, setStreamActive] = useState(true);
  const [streamLoading, setStreamLoading] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const w = collapsed ? 64 : 220;

  useEffect(() => {
    const check = async () => {
      try {
        const status = await graphIdsApi.getAlertStatus();
        setAlertActive(status.alert_active);
      } catch {
        // Keep last known indicator state when poll fails.
      }
    };

    void check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const checkStream = async () => {
      try {
        const status = await graphIdsApi.getStreamControl();
        setStreamActive(status.is_active);
      } catch {
        // Keep last known stream state when poll fails
      }
    };

    void checkStream();
    const interval = setInterval(checkStream, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleStreamToggle = async () => {
    setStreamLoading(true);
    try {
      if (streamActive) {
        // Stop the stream
        await graphIdsApi.stopStream();
        setStreamActive(false);
      } else {
        // Start the stream
        await graphIdsApi.startStream();
        setStreamActive(true);
      }
    } catch (error) {
      console.error('Failed to toggle stream:', error);
    } finally {
      setStreamLoading(false);
    }
  };

  return (
    <div style={{
      width: w, flexShrink: 0, background: '#0d1117',
      borderRight: '1px solid #21262d',
      display: 'flex', flexDirection: 'column',
      transition: 'width 0.25s ease',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* Logo */}
      <div style={{
        padding: collapsed ? '14px 0' : '14px 16px',
        borderBottom: '1px solid #21262d',
        display: 'flex', alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'space-between',
        flexShrink: 0,
      }}>
        {!collapsed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 7,
              background: 'rgba(88,166,255,0.12)', border: '1px solid rgba(88,166,255,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <ShieldAlert size={16} color="#58a6ff" />
            </div>
            <div>
              <div style={{ color: '#e6edf3', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', lineHeight: 1.2 }}>
                NETGUARD
              </div>
              <div style={{ color: '#4d5666', fontSize: 9, letterSpacing: '0.05em' }}>IDS PLATFORM</div>
            </div>
          </div>
        )}
        {collapsed && (
          <div style={{
            width: 30, height: 30, borderRadius: 7,
            background: 'rgba(88,166,255,0.12)', border: '1px solid rgba(88,166,255,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <ShieldAlert size={16} color="#58a6ff" />
          </div>
        )}
        {!collapsed && (
          <button
            onClick={() => setCollapsed(true)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#4d5666', padding: 4, borderRadius: 4,
              display: 'flex', alignItems: 'center',
            }}
          >
            <ChevronLeft size={14} />
          </button>
        )}
      </div>

      {/* Collapse toggle (when collapsed) */}
      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#4d5666', padding: '6px', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            borderBottom: '1px solid #21262d',
          }}
        >
          <ChevronRight size={14} />
        </button>
      )}

      {/* Nav Items */}
      <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto' }}>
        {NAV_ITEMS.map(item => {
          const Icon = item.icon;
          const isAlerts = item.path === '/alerts';
          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.exact}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center',
                gap: collapsed ? 0 : 10,
                padding: collapsed ? '10px 0' : '9px 16px',
                justifyContent: collapsed ? 'center' : 'flex-start',
                textDecoration: 'none',
                borderLeft: `2px solid ${isActive ? '#58a6ff' : 'transparent'}`,
                background: isActive ? 'rgba(88,166,255,0.08)' : 'transparent',
                color: isActive ? '#58a6ff' : '#7d8590',
                transition: 'all 0.15s',
                position: 'relative',
              })}
            >
              {({ isActive }) => (
                <>
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <Icon size={16} color={isActive ? '#58a6ff' : '#7d8590'} />
                    {isAlerts && alertActive && (
                      <div style={{
                        position: 'absolute', top: -2, right: -4,
                        width: 8, height: 8, borderRadius: '50%',
                        background: '#ef4444',
                        boxShadow: '0 0 8px rgba(239,68,68,0.8)',
                      }}>
                      </div>
                    )}
                  </div>
                  {!collapsed && (
                    <span style={{
                      fontSize: 12, fontWeight: isActive ? 600 : 400,
                      letterSpacing: '0.02em', whiteSpace: 'nowrap',
                    }}>
                      {item.label}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Capture Control */}
      <div style={{
        padding: collapsed ? '8px 0' : '8px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        borderBottom: '1px solid #21262d',
      }}>
        <div style={{
          display: 'flex',
          gap: 6,
          justifyContent: collapsed ? 'center' : 'flex-start',
        }}>
          <button
            onClick={handleStreamToggle}
            disabled={streamLoading}
            title={streamActive ? 'Stop Capture' : 'Start Capture'}
            style={{
              flex: collapsed ? 0 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '6px 10px',
              background: streamActive ? 'rgba(240,82,82,0.15)' : 'rgba(63,185,80,0.15)',
              border: `1px solid ${streamActive ? 'rgba(240,82,82,0.3)' : 'rgba(63,185,80,0.3)'}`,
              borderRadius: 4,
              color: streamActive ? '#f05252' : '#3fb950',
              cursor: streamLoading ? 'not-allowed' : 'pointer',
              fontSize: 12,
              fontWeight: 600,
              transition: 'all 0.15s',
              opacity: streamLoading ? 0.6 : 1,
            }}
            onMouseEnter={e => {
              if (!streamLoading) {
                (e.currentTarget as HTMLButtonElement).style.background = streamActive
                  ? 'rgba(240,82,82,0.25)'
                  : 'rgba(63,185,80,0.25)';
              }
            }}
            onMouseLeave={e => {
              if (!streamLoading) {
                (e.currentTarget as HTMLButtonElement).style.background = streamActive
                  ? 'rgba(240,82,82,0.15)'
                  : 'rgba(63,185,80,0.15)';
              }
            }}
          >
            {streamActive ? <Pause size={14} /> : <Play size={14} />}
            {!collapsed && (streamActive ? 'Stop' : 'Start')}
          </button>
        </div>
        {!collapsed && (
          <div style={{
            fontSize: 10,
            color: '#4d5666',
            letterSpacing: '0.02em',
            textAlign: 'center',
          }}>
            {streamLoading ? 'Updating...' : (streamActive ? 'Capturing' : 'Paused')}
          </div>
        )}
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: '#21262d', margin: '0 12px' }} />

      {/* User info */}
      <div style={{
        padding: collapsed ? '12px 0' : '12px 14px',
        display: 'flex', flexDirection: collapsed ? 'column' : 'row',
        alignItems: 'center', gap: 8,
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
          background: user?.role === 'admin' ? 'rgba(88,166,255,0.15)' : 'rgba(63,185,80,0.15)',
          border: `1px solid ${user?.role === 'admin' ? 'rgba(88,166,255,0.3)' : 'rgba(63,185,80,0.3)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {user?.role === 'admin'
            ? <Shield size={13} color="#58a6ff" />
            : <User size={13} color="#3fb950" />
          }
        </div>
        {!collapsed && (
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: '#e6edf3', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user?.username}
            </div>
            <div style={{ color: '#4d5666', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {user?.role}
            </div>
          </div>
        )}
        <button
          onClick={handleLogout}
          title="Logout"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#4d5666', padding: 4, borderRadius: 4,
            display: 'flex', alignItems: 'center',
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#f85149'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#4d5666'; }}
        >
          <LogOut size={14} />
        </button>
      </div>
    </div>
  );
}
