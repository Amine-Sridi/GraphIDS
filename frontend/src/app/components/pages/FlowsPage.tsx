import { useState, useMemo } from 'react';
import { Activity, Search, ChevronUp, ChevronDown } from 'lucide-react';
import { useBackend } from '../../context/BackendContext';
import { formatBytes } from '../../utils/formatting';
import { generateExplanation } from '../../utils/explainability';
import { ExplanationPanel } from '../shared/ExplanationPanel';
import type { FlowEntry } from '../../types';

const PAGE_SIZE = 20;
type FlowFilter = 'all' | 'anomalous' | 'benign' | 'false_positives';

type SortKey = 'timestamp' | 'score' | 'byteCount' | 'packetCount' | 'duration';
type SortDir = 'asc' | 'desc';

const protocolColors: Record<string, string> = {
  TCP: '#58a6ff', UDP: '#3fb950', ICMP: '#f97316',
  HTTP: '#a371f7', HTTPS: '#79c0ff', DNS: '#eab308',
};

export function FlowsPage() {
  const { flowLog } = useBackend();
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<FlowFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('timestamp');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<FlowEntry | null>(null);

  const uniqueFlows = useMemo(() => {
    // Keep only the most recent entry per communication tuple.
    const seen = new Set<string>();
    const unique: FlowEntry[] = [];

    for (let i = flowLog.length - 1; i >= 0; i -= 1) {
      const f = flowLog[i];
      const key = `${f.srcIP}|${f.dstIP}|${f.srcPort}|${f.dstPort}|${f.protocol}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(f);
    }

    return unique.reverse();
  }, [flowLog]);

  const searched = useMemo(() => {
    const q = search.toLowerCase();
    return uniqueFlows.filter(f =>
      !q ||
      f.srcIP.includes(q) ||
      f.dstIP.includes(q) ||
      f.protocol.toLowerCase().includes(q)
    );
  }, [uniqueFlows, search]);

  const filtered = useMemo(() => {
    return searched.filter((flow) => {
      switch (activeFilter) {
        case 'anomalous':
          return flow.predictedLabel === 1;
        case 'benign':
          return flow.predictedLabel === 0;
        case 'false_positives':
          return flow.predictedLabel === 1 && flow.groundTruthLabel === 0;
        default:
          return true;
      }
    });
  }, [searched, activeFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let av: number, bv: number;
      if (sortKey === 'timestamp') { av = a.timestamp.getTime(); bv = b.timestamp.getTime(); }
      else { av = a[sortKey] as number; bv = b[sortKey] as number; }
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [filtered, sortKey, sortDir]);

  const filterCounts = useMemo(
    () => ({
      all: searched.length,
      anomalous: searched.filter((f) => f.predictedLabel === 1).length,
      benign: searched.filter((f) => f.predictedLabel === 0).length,
      false_positives: searched.filter((f) => f.predictedLabel === 1 && f.groundTruthLabel === 0).length,
    }),
    [searched]
  );

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paged = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const SortIcon = ({ k }: { k: SortKey }) => (
    sortKey === k
      ? sortDir === 'desc' ? <ChevronDown size={11} /> : <ChevronUp size={11} />
      : null
  );

  const cols: { label: string; key?: SortKey; width: string }[] = [
    { label: 'TIME',       key: 'timestamp',   width: '120px' },
    { label: 'SRC IP',                          width: '130px' },
    { label: 'DST IP',                          width: '130px' },
    { label: 'PORTS',                           width: '100px' },
    { label: 'PROTO',                           width: '70px'  },
    { label: 'PKTS',       key: 'packetCount',  width: '70px'  },
    { label: 'BYTES',      key: 'byteCount',    width: '90px'  },
    { label: 'DUR(ms)',    key: 'duration',     width: '80px'  },
    { label: 'SCORE',      key: 'score',        width: '80px'  },
    { label: 'GROUND TRUTH',                    width: '110px' },
    { label: 'MATCH',                           width: '90px' },
  ];

  const gridCols = cols.map(c => c.width).join(' ');

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
          <Activity size={16} color="#58a6ff" />
          <span style={{ color: '#e6edf3', fontSize: 14, fontWeight: 700, letterSpacing: '0.06em' }}>
            FLOW INSPECTION
          </span>
          <span style={{ color: '#7d8590', fontSize: 11, fontFamily: 'monospace' }}>
            {filtered.length.toLocaleString()} flows
          </span>
        </div>

        <div style={{ position: 'relative' }}>
          <Search size={13} color="#4d5666" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search IP, protocol…"
            style={{
              background: '#161b22', border: '1px solid #30363d',
              borderRadius: 6, padding: '7px 12px 7px 32px',
              color: '#e6edf3', fontSize: 12, outline: 'none', width: 220,
            }}
          />
        </div>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '10px 20px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {([
            ['all', 'All Flows'],
            ['anomalous', 'Anomalous'],
            ['benign', 'Benign'],
            ['false_positives', 'False Positives'],
          ] as [FlowFilter, string][]).map(([filter, label]) => (
            <button
              key={filter}
              onClick={() => {
                setActiveFilter(filter);
                setPage(0);
              }}
              style={{
                padding: '5px 10px',
                borderRadius: 6,
                border: `1px solid ${activeFilter === filter ? '#2563eb' : '#4b5563'}`,
                background: activeFilter === filter ? '#1d4ed8' : '#1f2937',
                color: activeFilter === filter ? '#fff' : '#9ca3af',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {label}
              <span style={{ marginLeft: 8, padding: '1px 5px', borderRadius: 999, background: '#374151', color: '#d1d5db' }}>
                {filterCounts[filter]}
              </span>
            </button>
          ))}
        </div>

        {/* Column headers */}
        <div style={{
          display: 'grid', gridTemplateColumns: gridCols,
          padding: '8px 20px', borderBottom: '1px solid #21262d',
          flexShrink: 0,
        }}>
          {cols.map(c => (
            <div
              key={c.label}
              onClick={() => c.key && handleSort(c.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 3,
                color: sortKey === c.key ? '#58a6ff' : '#4d5666',
                fontSize: 10, letterSpacing: '0.06em', fontWeight: 600,
                cursor: c.key ? 'pointer' : 'default',
              }}
            >
              {c.label} {c.key && <SortIcon k={c.key} />}
            </div>
          ))}
        </div>

        {/* Rows */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {paged.map(f => (
            <div
              key={f.id}
              onClick={() => setSelected(selected?.id === f.id ? null : f)}
              style={{
                display: 'grid', gridTemplateColumns: gridCols,
                padding: '7px 20px', borderBottom: '1px solid rgba(33,38,45,0.5)',
                alignItems: 'center', cursor: 'pointer',
                background: selected?.id === f.id
                  ? 'rgba(88,166,255,0.06)'
                  : f.isAnomaly
                    ? 'rgba(239,68,68,0.04)'
                    : 'transparent',
                transition: 'background 0.15s',
              }}
            >
              <span style={{ color: '#7d8590', fontSize: 10, fontFamily: 'monospace' }}>
                {f.timestamp.toLocaleTimeString('en-US', { hour12: false })}
              </span>
              <span style={{ color: '#c9d1d9', fontSize: 11, fontFamily: 'monospace' }}>{f.srcIP}</span>
              <span style={{ color: '#c9d1d9', fontSize: 11, fontFamily: 'monospace' }}>{f.dstIP}</span>
              <span style={{ color: '#7d8590', fontSize: 10, fontFamily: 'monospace' }}>
                {f.srcPort}:{f.dstPort}
              </span>
              <span style={{
                color: protocolColors[f.protocol] ?? '#7d8590',
                fontSize: 10, fontFamily: 'monospace', fontWeight: 700,
              }}>
                {f.protocol}
              </span>
              <span style={{ color: '#e6edf3', fontSize: 11, fontFamily: 'monospace' }}>{f.packetCount}</span>
              <span style={{ color: '#e6edf3', fontSize: 11, fontFamily: 'monospace' }}>{formatBytes(f.byteCount)}</span>
              <span style={{ color: '#e6edf3', fontSize: 11, fontFamily: 'monospace' }}>{f.duration}</span>
              <span style={{
                color: f.isAnomaly ? '#f85149' : '#58a6ff',
                fontSize: 11, fontFamily: 'monospace', fontWeight: f.isAnomaly ? 700 : 400,
              }}>
                {f.score.toFixed(4)}
              </span>
              <span style={{ fontSize: 11 }}>
                {f.groundTruthLabel !== null
                  ? (
                    <span style={{ color: f.groundTruthLabel === 1 ? '#f87171' : '#4ade80' }}>
                      {f.groundTruthLabel === 1 ? 'Malicious' : 'Benign'}
                    </span>
                  )
                  : <span style={{ color: '#6b7280' }}>-</span>}
              </span>
              <span style={{ fontSize: 11 }}>
                {f.groundTruthLabel !== null
                  ? (
                    f.predictedLabel === f.groundTruthLabel
                      ? <span style={{ color: '#4ade80' }}>Correct</span>
                      : <span style={{ color: '#f87171', fontWeight: 700 }}>Wrong</span>
                  )
                  : <span style={{ color: '#6b7280' }}>-</span>}
              </span>
            </div>
          ))}
        </div>

        {/* Pagination */}
        <div style={{
          padding: '10px 20px', borderTop: '1px solid #21262d', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ color: '#7d8590', fontSize: 11 }}>
            Page {page + 1} of {Math.max(1, totalPages)} ({sorted.length} results)
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            {[0, 1, 2, 3, 4].map(delta => {
              const p = page - 2 + delta;
              if (p < 0 || p >= totalPages) return <span key={delta} style={{ width: 28 }} />;
              return (
                <button
                  key={delta}
                  onClick={() => setPage(p)}
                  style={{
                    width: 28, height: 28, borderRadius: 4,
                    background: p === page ? 'rgba(88,166,255,0.15)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${p === page ? 'rgba(88,166,255,0.3)' : '#21262d'}`,
                    color: p === page ? '#58a6ff' : '#7d8590',
                    fontSize: 11, cursor: 'pointer',
                  }}
                >
                  {p + 1}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setPage(0)} disabled={page === 0} style={navBtn(page === 0)}>«</button>
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={navBtn(page === 0)}>‹</button>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={navBtn(page >= totalPages - 1)}>›</button>
            <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} style={navBtn(page >= totalPages - 1)}>»</button>
          </div>
        </div>
      </div>

      {/* Detail panel */}
      {selected && (
        <div style={{
          position: 'absolute', right: 0, top: 0, bottom: 0, width: 340,
          background: '#161b22', borderLeft: '1px solid #21262d',
          padding: 20, overflowY: 'auto', zIndex: 10,
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
            <span style={{ color: '#e6edf3', fontSize: 13, fontWeight: 700 }}>FLOW DETAIL</span>
            <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: '#7d8590', cursor: 'pointer', fontSize: 16 }}>✕</button>
          </div>
          {[
            ['Flow ID', `#${selected.id}`],
            ['Source IP', selected.srcIP],
            ['Dest IP', selected.dstIP],
            ['Src Port', String(selected.srcPort)],
            ['Dst Port', String(selected.dstPort)],
            ['Protocol', selected.protocol],
            ['Packets', String(selected.packetCount)],
            ['Bytes', formatBytes(selected.byteCount)],
            ['Duration', `${selected.duration} ms`],
            ['Score', selected.score.toFixed(6)],
            ['Anomaly', selected.isAnomaly ? 'YES' : 'NO'],
            ['Emb X', selected.embX.toFixed(4)],
            ['Emb Y', selected.embY.toFixed(4)],
          ].map(([k, v]) => (
            <div key={k} style={{
              display: 'flex', justifyContent: 'space-between', padding: '6px 0',
              borderBottom: '1px solid rgba(33,38,45,0.6)',
            }}>
              <span style={{ color: '#7d8590', fontSize: 11 }}>{k}</span>
              <span style={{
                color: k === 'Score' ? (selected.isAnomaly ? '#f85149' : '#58a6ff') :
                  k === 'Anomaly' ? (selected.isAnomaly ? '#f85149' : '#3fb950') : '#e6edf3',
                fontSize: 11, fontFamily: 'monospace', fontWeight: k === 'Score' || k === 'Anomaly' ? 700 : 400,
              }}>
                {v}
              </span>
            </div>
          ))}

          {/* Explainability section — only for anomalous flows */}
          {selected.isAnomaly && (() => {
            const explanation = generateExplanation(selected);
            return (
              <div style={{ marginTop: 16 }}>
                <div style={{
                  color: '#7d8590', fontSize: 10, letterSpacing: '0.08em',
                  marginBottom: 10, paddingBottom: 6,
                  borderBottom: '1px solid #21262d',
                }}>
                  WHY WAS THIS FLOW FLAGGED?
                </div>
                <ExplanationPanel explanation={explanation} />
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function navBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: '4px 8px', borderRadius: 4,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid #21262d',
    color: disabled ? '#21262d' : '#7d8590',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 12,
  };
}