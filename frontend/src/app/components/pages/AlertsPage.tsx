import { useState } from 'react';
import { AlertTriangle, CheckCheck, Trash2, Filter, Clock } from 'lucide-react';
import { useBackend } from '../../context/BackendContext';
import { generateExplanation } from '../../utils/explainability';
import { ExplanationPanel } from '../shared/ExplanationPanel';
import type { AlertEntry } from '../../types';

const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };

const severityColors: Record<AlertEntry['severity'], { bg: string; border: string; text: string }> = {
  critical: { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.4)', text: '#fca5a5' },
  high:     { bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.3)', text: '#ef4444' },
  medium:   { bg: 'rgba(249,115,22,0.08)', border: 'rgba(249,115,22,0.3)', text: '#f97316' },
  low:      { bg: 'rgba(234,179,8,0.08)', border: 'rgba(234,179,8,0.3)', text: '#eab308' },
};

export function AlertsPage() {
  const { alerts, flowLog } = useBackend();
  const [filterSeverity, setFilterSeverity] = useState<AlertEntry['severity'] | 'all'>('all');
  const [showAcked, setShowAcked] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Stub functions - in real backend these would call API endpoints
  const acknowledgeAlert = () => {};
  const acknowledgeAll = () => {};
  const clearAlerts = () => {};

  const filtered = alerts
    .filter(a => filterSeverity === 'all' || a.severity === filterSeverity)
    .filter(a => showAcked || !a.acknowledged)
    .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  const unackCount = alerts.filter(a => !a.acknowledged).length;

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      background: '#0d1117', overflow: 'hidden',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Page header */}
      <div style={{
        padding: '14px 20px', borderBottom: '1px solid #21262d', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <AlertTriangle size={16} color="#f85149" />
          <span style={{ color: '#e6edf3', fontSize: 14, fontWeight: 700, letterSpacing: '0.06em' }}>
            ALERTS &amp; INCIDENTS
          </span>
          {unackCount > 0 && (
            <div style={{
              padding: '2px 8px', borderRadius: 10,
              background: 'rgba(248,81,73,0.15)', border: '1px solid rgba(248,81,73,0.3)',
              color: '#f85149', fontSize: 11, fontWeight: 700,
            }}>
              {unackCount} unacknowledged
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={acknowledgeAll}
            style={btnStyle('#3fb950')}
          >
            <CheckCheck size={13} /> ACK ALL
          </button>
          <button
            onClick={clearAlerts}
            style={btnStyle('#f85149')}
          >
            <Trash2 size={13} /> CLEAR
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{
        padding: '10px 20px', borderBottom: '1px solid #21262d', flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <Filter size={13} color="#7d8590" />
        <span style={{ color: '#7d8590', fontSize: 11, letterSpacing: '0.04em' }}>SEVERITY:</span>
        {(['all', 'critical', 'high', 'medium', 'low'] as const).map(s => (
          <button
            key={s}
            onClick={() => setFilterSeverity(s)}
            style={{
              padding: '3px 10px', borderRadius: 4, border: 'none', cursor: 'pointer',
              fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', fontFamily: 'monospace',
              background: filterSeverity === s
                ? (s === 'all' ? 'rgba(88,166,255,0.2)' : severityColors[s as AlertEntry['severity']]?.bg ?? 'rgba(88,166,255,0.2)')
                : 'rgba(255,255,255,0.04)',
              color: filterSeverity === s
                ? (s === 'all' ? '#58a6ff' : severityColors[s as AlertEntry['severity']]?.text ?? '#58a6ff')
                : '#7d8590',
            }}
          >
            {s.toUpperCase()}
          </button>
        ))}
        <div style={{ width: 1, height: 20, background: '#21262d', margin: '0 4px' }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showAcked}
            onChange={e => setShowAcked(e.target.checked)}
            style={{ accentColor: '#58a6ff' }}
          />
          <span style={{ color: '#7d8590', fontSize: 11 }}>Show acknowledged</span>
        </label>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Table header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '160px 140px 140px 80px 90px 80px 80px',
          padding: '8px 20px', borderBottom: '1px solid #21262d',
          position: 'sticky', top: 0, background: '#0d1117', zIndex: 1,
        }}>
          {['TIMESTAMP', 'SOURCE IP', 'DEST IP', 'SCORE', 'SEVERITY', 'STATUS', 'ACTION'].map(h => (
            <span key={h} style={{ color: '#4d5666', fontSize: 10, letterSpacing: '0.06em', fontWeight: 600 }}>
              {h}
            </span>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#4d5666', fontSize: 12 }}>
            No alerts match the current filters.
          </div>
        ) : (
          filtered.map(alert => {
            const sc = severityColors[alert.severity];
            const isExpanded = expandedId === alert.id;
            const flow = flowLog.find(f => f.id === alert.id);
            const explanation = flow ? generateExplanation(flow) : null;
            return (
              <div key={alert.id}>
                <div
                  onClick={() => setExpandedId(isExpanded ? null : alert.id)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '160px 140px 140px 80px 90px 80px 80px',
                    padding: '8px 20px',
                    borderBottom: isExpanded ? 'none' : '1px solid rgba(33,38,45,0.6)',
                    background: isExpanded
                      ? 'rgba(163,113,247,0.06)'
                      : alert.acknowledged ? 'transparent' : sc.bg,
                    alignItems: 'center',
                    opacity: alert.acknowledged ? 0.5 : 1,
                    transition: 'all 0.2s',
                    cursor: explanation ? 'pointer' : 'default',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Clock size={10} color="#4d5666" />
                    <span style={{ color: '#7d8590', fontSize: 10, fontFamily: 'monospace' }}>
                      {alert.timestamp.toLocaleTimeString('en-US', { hour12: false })}
                    </span>
                  </div>
                  <span style={{ color: '#c9d1d9', fontSize: 11, fontFamily: 'monospace' }}>{alert.srcIP}</span>
                  <span style={{ color: '#c9d1d9', fontSize: 11, fontFamily: 'monospace' }}>{alert.dstIP}</span>
                  <span style={{ color: sc.text, fontSize: 11, fontFamily: 'monospace', fontWeight: 700 }}>
                    {alert.score.toFixed(4)}
                  </span>
                  <span style={{
                    display: 'inline-flex', padding: '2px 8px', borderRadius: 3,
                    background: sc.bg, border: `1px solid ${sc.border}`,
                    color: sc.text, fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
                    width: 'fit-content',
                  }}>
                    {alert.severity.toUpperCase()}
                  </span>
                  <span style={{ color: alert.acknowledged ? '#3fb950' : '#7d8590', fontSize: 10 }}>
                    {alert.acknowledged ? '✓ ACK' : 'OPEN'}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {!alert.acknowledged && (
                      <button
                        onClick={e => { e.stopPropagation(); acknowledgeAlert(alert.id); }}
                        style={{
                          padding: '3px 8px', borderRadius: 3,
                          background: 'rgba(63,185,80,0.1)', border: '1px solid rgba(63,185,80,0.25)',
                          color: '#3fb950', fontSize: 10, cursor: 'pointer',
                        }}
                      >
                        ACK
                      </button>
                    )}
                    {explanation && (
                      <span style={{ color: isExpanded ? '#a371f7' : '#4d5666', fontSize: 10 }}>
                        {isExpanded ? '▲' : '▼'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Expandable explanation row */}
                {isExpanded && explanation && (
                  <div style={{
                    padding: '12px 20px 16px',
                    background: 'rgba(163,113,247,0.03)',
                    borderBottom: '1px solid rgba(33,38,45,0.6)',
                    borderLeft: '2px solid rgba(163,113,247,0.4)',
                  }}>
                    <ExplanationPanel explanation={explanation} />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function btnStyle(color: string) {
  return {
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '5px 12px', borderRadius: 5,
    background: `${color}18`, border: `1px solid ${color}44`,
    color, fontSize: 11, fontWeight: 600, cursor: 'pointer',
    letterSpacing: '0.04em',
  } as React.CSSProperties;
}