import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router';
import {
  LayoutDashboard, AlertTriangle, Activity, Share2, Database,
  Sliders, LogOut, ChevronLeft, ChevronRight, ShieldAlert, User, Shield,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useBackend } from '../../context/BackendContext';

const NAV_ITEMS = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard', exact: true },
  { path: '/alerts', icon: AlertTriangle, label: 'Alerts & Incidents' },
  { path: '/flows', icon: Activity, label: 'Flow Inspection' },
  { path: '/graph', icon: Share2, label: 'Graph View' },
  { path: '/logs', icon: Database, label: 'Logs & DB' },
  { path: '/ingestion', icon: Sliders, label: 'Ingestion Control' },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const { user, logout } = useAuth();
  const { alerts } = useBackend();
  const navigate = useNavigate();

  const unackCount = alerts.filter(a => !a.acknowledged).length;
  const w = collapsed ? 64 : 220;

  const handleLogout = () => {
    logout();
    navigate('/login');
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
                    {isAlerts && unackCount > 0 && (
                      <div style={{
                        position: 'absolute', top: -5, right: -6,
                        width: 14, height: 14, borderRadius: '50%',
                        background: '#f85149', color: '#fff',
                        fontSize: 9, fontWeight: 700,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {unackCount > 9 ? '9+' : unackCount}
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
