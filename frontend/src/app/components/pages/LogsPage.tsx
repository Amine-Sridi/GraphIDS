import { useState, useMemo } from 'react';
import { Database, Search, Download } from 'lucide-react';
import { useBackend } from '../../context/BackendContext';
import { formatBytes, formatDate } from '../../utils/formatting';

export function LogsPage() {
  const { flowLog, alerts } = useBackend();
  const [tab, setTab] = useState<'flows' | 'anomalies'>('flows');
  const [search, setSearch] = useState('');
  const [minScore, setMinScore] = useState(0);

  const flowResults = useMemo(() => {
    const q = search.toLowerCase();
    return flowLog.filter(f =>
      f.score >= minScore &&
      (!q || f.srcIP.includes(q) || f.dstIP.includes(q) || f.protocol.toLowerCase().includes(q))
    );
  }, [flowLog, search, minScore]);

  const alertResults = useMemo(() => {
    const q = search.toLowerCase();
    return alerts.filter(a =>
      a.score >= minScore &&
      (!q || a.srcIP.includes(q) || a.dstIP.includes(q))
    );
  }, [alerts, search, minScore]);

  const handleExport = () => {
    const data = tab === 'flows' ? flowResults : alertResults;
    const json = JSON.stringify(data.map(d => ({
      ...d,
      timestamp: 'timestamp' in d ? d.timestamp.toISOString() : (d as any).time?.toISOString(),
    })), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `netguard_${tab}_export.json`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      background: '#0d1117', overflow: 'hidden',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 20px', borderBottom: '1px solid #21262d', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Database size={16} color="#58a6ff" />
          <span style={{ color: '#e6edf3', fontSize: 14, fontWeight: 700, letterSpacing: '0.06em' }}>
            LOGS &amp; DATABASE
          </span>
        </div>
        <button
          onClick={handleExport}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 14px', borderRadius: 5,
            background: 'rgba(88,166,255,0.1)', border: '1px solid rgba(88,166,255,0.25)',
            color: '#58a6ff', fontSize: 11, fontWeight: 600, cursor: 'pointer',
          }}
        >
          <Download size={13} /> EXPORT JSON
        </button>
      </div>

      {/* Query controls */}
      <div style={{
        padding: '12px 20px', borderBottom: '1px solid #21262d', flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        {/* Tab */}
        <div style={{ display: 'flex', gap: 4 }}>
          {(['flows', 'anomalies'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '5px 12px', borderRadius: 4, cursor: 'pointer',
                fontSize: 11, fontWeight: 600, letterSpacing: '0.04em',
                background: tab === t ? 'rgba(88,166,255,0.12)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${tab === t ? 'rgba(88,166,255,0.3)' : '#21262d'}`,
                color: tab === t ? '#58a6ff' : '#7d8590',
              }}
            >
              {t === 'flows' ? `FLOWS (${flowLog.length})` : `ANOMALIES (${alerts.length})`}
            </button>
          ))}
        </div>

        <div style={{ width: 1, height: 20, background: '#21262d' }} />

        {/* Search */}
        <div style={{ position: 'relative' }}>
          <Search size={12} color="#4d5666" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter by IP or protocol…"
            style={{
              background: '#161b22', border: '1px solid #30363d', borderRadius: 5,
              padding: '6px 10px 6px 30px', color: '#e6edf3', fontSize: 11, outline: 'none', width: 200,
            }}
          />
        </div>

        {/* Min score */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#7d8590', fontSize: 11, whiteSpace: 'nowrap' }}>Min score:</span>
          <input
            type="range" min={0} max={1} step={0.01}
            value={minScore}
            onChange={e => setMinScore(parseFloat(e.target.value))}
            style={{ width: 100, accentColor: '#58a6ff' }}
          />
          <span style={{ color: '#58a6ff', fontSize: 11, fontFamily: 'monospace', width: 40 }}>
            {minScore.toFixed(2)}
          </span>
        </div>

        <span style={{ color: '#7d8590', fontSize: 11, marginLeft: 'auto' }}>
          {(tab === 'flows' ? flowResults : alertResults).length.toLocaleString()} results
        </span>
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {tab === 'flows' ? (
          <>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '150px 130px 130px 60px 80px 80px 90px',
              padding: '8px 20px', borderBottom: '1px solid #21262d',
              position: 'sticky', top: 0, background: '#0d1117', zIndex: 1,
            }}>
              {['TIMESTAMP', 'SRC IP', 'DST IP', 'PROTO', 'BYTES', 'PKTS', 'SCORE'].map(h => (
                <span key={h} style={{ color: '#4d5666', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em' }}>{h}</span>
              ))}
            </div>
            {flowResults.slice(0, 200).map(f => (
              <div key={f.id} style={{
                display: 'grid',
                gridTemplateColumns: '150px 130px 130px 60px 80px 80px 90px',
                padding: '6px 20px', borderBottom: '1px solid rgba(33,38,45,0.5)',
                alignItems: 'center',
                background: f.isAnomaly ? 'rgba(239,68,68,0.03)' : 'transparent',
              }}>
                <span style={{ color: '#7d8590', fontSize: 10, fontFamily: 'monospace' }}>{formatDate(f.timestamp)}</span>
                <span style={{ color: '#c9d1d9', fontSize: 10, fontFamily: 'monospace' }}>{f.srcIP}</span>
                <span style={{ color: '#c9d1d9', fontSize: 10, fontFamily: 'monospace' }}>{f.dstIP}</span>
                <span style={{ color: '#7d8590', fontSize: 10, fontFamily: 'monospace' }}>{f.protocol}</span>
                <span style={{ color: '#e6edf3', fontSize: 10, fontFamily: 'monospace' }}>{formatBytes(f.byteCount)}</span>
                <span style={{ color: '#e6edf3', fontSize: 10, fontFamily: 'monospace' }}>{f.packetCount}</span>
                <span style={{ color: f.isAnomaly ? '#f85149' : '#7d8590', fontSize: 10, fontFamily: 'monospace', fontWeight: f.isAnomaly ? 700 : 400 }}>
                  {f.score.toFixed(4)}
                </span>
              </div>
            ))}
          </>
        ) : (
          <>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '150px 130px 130px 80px 90px 80px',
              padding: '8px 20px', borderBottom: '1px solid #21262d',
              position: 'sticky', top: 0, background: '#0d1117', zIndex: 1,
            }}>
              {['TIMESTAMP', 'SRC IP', 'DST IP', 'SCORE', 'SEVERITY', 'STATUS'].map(h => (
                <span key={h} style={{ color: '#4d5666', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em' }}>{h}</span>
              ))}
            </div>
            {alertResults.slice(0, 200).map(a => (
              <div key={a.id} style={{
                display: 'grid',
                gridTemplateColumns: '150px 130px 130px 80px 90px 80px',
                padding: '6px 20px', borderBottom: '1px solid rgba(33,38,45,0.5)',
                alignItems: 'center',
              }}>
                <span style={{ color: '#7d8590', fontSize: 10, fontFamily: 'monospace' }}>{formatDate(a.timestamp)}</span>
                <span style={{ color: '#c9d1d9', fontSize: 10, fontFamily: 'monospace' }}>{a.srcIP}</span>
                <span style={{ color: '#c9d1d9', fontSize: 10, fontFamily: 'monospace' }}>{a.dstIP}</span>
                <span style={{ color: '#f85149', fontSize: 10, fontFamily: 'monospace', fontWeight: 700 }}>{a.score.toFixed(4)}</span>
                <span style={{ color: '#f97316', fontSize: 10, fontFamily: 'monospace' }}>{a.severity.toUpperCase()}</span>
                <span style={{ color: a.acknowledged ? '#3fb950' : '#7d8590', fontSize: 10 }}>
                  {a.acknowledged ? 'ACK' : 'OPEN'}
                </span>
              </div>
            ))}
          </>
        )}
      </div>

      {/* DB Info footer */}
      <div style={{
        padding: '8px 20px', borderTop: '1px solid #21262d', flexShrink: 0,
        display: 'flex', gap: 20,
      }}>
        {[
          { label: 'TOTAL FLOWS', value: flowLog.length.toLocaleString() },
          { label: 'TOTAL ALERTS', value: alerts.length.toLocaleString() },
          { label: 'STORAGE (est.)', value: `${((flowLog.length * 0.8) / 1024).toFixed(1)} KB` },
          { label: 'DB ENGINE', value: 'In-Memory (SQLite ready)' },
        ].map(stat => (
          <div key={stat.label}>
            <div style={{ color: '#4d5666', fontSize: 9, letterSpacing: '0.06em', marginBottom: 2 }}>{stat.label}</div>
            <div style={{ color: '#7d8590', fontSize: 11, fontFamily: 'monospace' }}>{stat.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
