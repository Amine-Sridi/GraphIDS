import { useMemo } from 'react';

interface Flow {
  src_ip: string;
  dst_ip: string;
  src_port: number;
  dst_port: number;
  label: number;
  score: number;
}

interface TalkerEntry {
  ip: string;
  count: number;
  max_score: number;
  port?: number;
}

function computeTopSources(flows: Flow[], limit = 5): TalkerEntry[] {
  const anomalous = flows.filter((f) => f.label === 1);
  const counts: Record<string, { count: number; max_score: number; port: number }> = {};

  for (const f of anomalous) {
    const key = `${f.src_ip}:${f.src_port}`;
    if (!counts[key]) counts[key] = { count: 0, max_score: 0, port: f.src_port };
    counts[key].count += 1;
    counts[key].max_score = Math.max(counts[key].max_score, f.score);
  }

  return Object.entries(counts)
    .map(([ip, { count, max_score, port }]) => ({ ip: ip.split(':')[0], count, max_score, port }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function computeTopTargets(flows: Flow[], limit = 5): TalkerEntry[] {
  const anomalous = flows.filter((f) => f.label === 1);
  const counts: Record<string, { count: number; max_score: number; port: number }> = {};

  for (const f of anomalous) {
    const key = `${f.dst_ip}:${f.dst_port}`;
    if (!counts[key]) counts[key] = { count: 0, max_score: 0, port: f.dst_port };
    counts[key].count += 1;
    counts[key].max_score = Math.max(counts[key].max_score, f.score);
  }

  return Object.entries(counts)
    .map(([ip, { count, max_score, port }]) => ({ ip: ip.split(':')[0], count, max_score, port }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function TopTalkers({ flows }: { flows: Flow[] }) {
  const sources = useMemo(() => computeTopSources(flows), [flows]);
  const targets = useMemo(() => computeTopTargets(flows), [flows]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
      <TalkerTable title="Top Anomalous Sources" rows={sources} showPort={true} />
      <TalkerTable title="Top Targeted Destinations" rows={targets} showPort={true} />
    </div>
  );
}

function TalkerTable({
  title,
  rows,
  showPort,
}: {
  title: string;
  rows: TalkerEntry[];
  showPort: boolean;
}) {
  return (
    <div style={{ border: '1px solid #374151', background: '#111827', borderRadius: 8, padding: 14 }}>
      <h2 style={{ color: '#d1d5db', fontSize: 13, fontWeight: 700, margin: '0 0 10px 0' }}>{title}</h2>
      {rows.length === 0 ? (
        <p style={{ color: '#6b7280', fontSize: 11, margin: 0 }}>No anomalous flows yet.</p>
      ) : (
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: '#9ca3af', textTransform: 'uppercase', borderBottom: '1px solid #374151' }}>
              <th style={{ textAlign: 'left', paddingBottom: 6 }}>IP Address</th>
              {showPort && <th style={{ textAlign: 'left', paddingBottom: 6 }}>Port</th>}
              <th style={{ textAlign: 'right', paddingBottom: 6 }}>Alerts</th>
              <th style={{ textAlign: 'right', paddingBottom: 6 }}>Max Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={`${row.ip}-${i}`} style={{ borderBottom: '1px solid #1f2937' }}>
                <td style={{ padding: '6px 0', color: '#e5e7eb', fontFamily: 'monospace' }}>{row.ip}</td>
                {showPort && <td style={{ padding: '6px 0', color: '#9ca3af', fontFamily: 'monospace' }}>{row.port}</td>}
                <td style={{ padding: '6px 0', textAlign: 'right', color: '#fb923c', fontWeight: 700 }}>{row.count}</td>
                <td style={{ padding: '6px 0', textAlign: 'right', color: '#f87171', fontFamily: 'monospace' }}>
                  {(row.max_score * 100).toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
