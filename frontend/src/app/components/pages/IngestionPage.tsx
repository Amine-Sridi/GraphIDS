import { Sliders, Play, Square, Activity, Zap, TrendingUp } from 'lucide-react';
import { useBackend } from '../../context/BackendContext';
import { useState } from 'react';

export function IngestionPage() {
  const { isActive, toggleActive, throughput, totalFlows, flowLog, stats } = useBackend();
  const [ingestionRate, setIngestionRate] = useState(1);

  const rateLabels: Record<number, string> = {
    0.25: 'Very Slow',
    0.5:  'Slow',
    1:    'Normal',
    2:    'Fast',
    4:    'Burst',
  };

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      background: '#0d1117', overflow: 'auto',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 20px', borderBottom: '1px solid #21262d', flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <Sliders size={16} color="#58a6ff" />
        <span style={{ color: '#e6edf3', fontSize: 14, fontWeight: 700, letterSpacing: '0.06em' }}>
          DATA INGESTION CONTROL
        </span>
      </div>

      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 700 }}>
        {/* Start / Stop */}
        <div style={{
          background: '#161b22', border: '1px solid #21262d', borderRadius: 10,
          padding: '20px 24px',
        }}>
          <div style={{ color: '#7d8590', fontSize: 10, letterSpacing: '0.08em', marginBottom: 16 }}>STREAM CONTROL</div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            {/* Status indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 12, height: 12, borderRadius: '50%',
                background: isActive ? '#3fb950' : '#f85149',
                boxShadow: isActive ? '0 0 8px #3fb950' : '0 0 8px #f85149',
                animation: isActive ? 'pulse 1.5s infinite' : 'none',
                flexShrink: 0,
              }} />
              <span style={{
                color: isActive ? '#3fb950' : '#f85149',
                fontSize: 13, fontWeight: 700, letterSpacing: '0.06em',
              }}>
                {isActive ? 'STREAMING ACTIVE' : 'STREAM STOPPED'}
              </span>
            </div>

            <button
              onClick={toggleActive}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 24px', borderRadius: 7,
                background: isActive ? 'rgba(248,81,73,0.12)' : 'rgba(63,185,80,0.12)',
                border: `1px solid ${isActive ? 'rgba(248,81,73,0.35)' : 'rgba(63,185,80,0.35)'}`,
                color: isActive ? '#f85149' : '#3fb950',
                fontSize: 13, fontWeight: 700, letterSpacing: '0.05em',
                cursor: 'pointer', transition: 'all 0.2s',
              }}
            >
              {isActive ? <Square size={14} /> : <Play size={14} />}
              {isActive ? 'STOP STREAM' : 'START STREAM'}
            </button>
          </div>
        </div>

        {/* Flow Rate */}
        <div style={{
          background: '#161b22', border: '1px solid #21262d', borderRadius: 10,
          padding: '20px 24px',
        }}>
          <div style={{ color: '#7d8590', fontSize: 10, letterSpacing: '0.08em', marginBottom: 16 }}>INGESTION RATE</div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
            <input
              type="range" min={0.25} max={4} step={0.25}
              value={ingestionRate}
              onChange={e => setIngestionRate(parseFloat(e.target.value))}
              style={{ flex: 1, accentColor: '#58a6ff', height: 4 }}
            />
            <div style={{
              padding: '4px 12px', borderRadius: 5,
              background: 'rgba(88,166,255,0.1)', border: '1px solid rgba(88,166,255,0.25)',
              color: '#58a6ff', fontSize: 13, fontWeight: 700, fontFamily: 'monospace',
              minWidth: 50, textAlign: 'center',
            }}>
              {ingestionRate}×
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            {[0.25, 0.5, 1, 2, 4].map(r => (
              <button
                key={r}
                onClick={() => setIngestionRate(r)}
                style={{
                  flex: 1, padding: '6px 0', borderRadius: 5,
                  background: ingestionRate === r ? 'rgba(88,166,255,0.15)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${ingestionRate === r ? 'rgba(88,166,255,0.35)' : '#21262d'}`,
                  color: ingestionRate === r ? '#58a6ff' : '#7d8590',
                  fontSize: 11, cursor: 'pointer', fontWeight: ingestionRate === r ? 700 : 400,
                }}
              >
                {rateLabels[r]}
              </button>
            ))}
          </div>
        </div>

        {/* Live metrics */}
        <div style={{
          background: '#161b22', border: '1px solid #21262d', borderRadius: 10,
          padding: '20px 24px',
        }}>
          <div style={{ color: '#7d8590', fontSize: 10, letterSpacing: '0.08em', marginBottom: 16 }}>LIVE INGESTION METRICS</div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            <MetricTile
              icon={<Zap size={18} color="#58a6ff" />}
              label="THROUGHPUT"
              value={`${throughput.toFixed(2)}`}
              unit="flows/s"
              color="#58a6ff"
            />
            <MetricTile
              icon={<Activity size={18} color="#3fb950" />}
              label="TOTAL INGESTED"
              value={totalFlows.toLocaleString()}
              unit="flows"
              color="#3fb950"
            />
            <MetricTile
              icon={<TrendingUp size={18} color="#f97316" />}
              label="ANOMALY RATE"
              value={`${((stats.anomalyCount / Math.max(1, stats.total)) * 100).toFixed(1)}%`}
              unit="of window"
              color={stats.anomalyCount > 0 ? '#f85149' : '#7d8590'}
            />
          </div>
        </div>

        {/* Pipeline */}
        <div style={{
          background: '#161b22', border: '1px solid #21262d', borderRadius: 10,
          padding: '20px 24px',
        }}>
          <div style={{ color: '#7d8590', fontSize: 10, letterSpacing: '0.08em', marginBottom: 16 }}>PIPELINE STATUS</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { label: 'Packet Capture',     status: isActive, note: 'PCAP / NetFlow source' },
              { label: 'Feature Extraction',  status: isActive, note: 'Statistical + payload features' },
              { label: 'ML Inference',         status: isActive, note: 'Autoencoder reconstruction' },
              { label: 'Threshold Filter',     status: true,     note: `Score > ${0.65} → anomaly` },
              { label: 'Alert Dispatcher',     status: isActive && flowLog.some(f => f.isAnomaly), note: 'CRITICAL / HIGH events' },
            ].map(step => (
              <div key={step.label} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 14px', borderRadius: 6,
                background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(33,38,45,0.8)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: step.status ? '#3fb950' : '#4d5666',
                    boxShadow: step.status ? '0 0 5px #3fb950' : 'none',
                  }} />
                  <span style={{ color: '#c9d1d9', fontSize: 12 }}>{step.label}</span>
                </div>
                <span style={{ color: '#4d5666', fontSize: 10, fontFamily: 'monospace' }}>{step.note}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}

function MetricTile({ icon, label, value, unit, color }: {
  icon: React.ReactNode; label: string;
  value: string; unit: string; color: string;
}) {
  return (
    <div style={{
      padding: '14px 16px', borderRadius: 8,
      background: 'rgba(255,255,255,0.02)', border: '1px solid #21262d',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon}
        <span style={{ color: '#7d8590', fontSize: 10, letterSpacing: '0.06em' }}>{label}</span>
      </div>
      <div>
        <span style={{ color, fontSize: 22, fontWeight: 700, fontFamily: 'monospace' }}>{value}</span>
        <span style={{ color: '#4d5666', fontSize: 11, marginLeft: 5 }}>{unit}</span>
      </div>
    </div>
  );
}
