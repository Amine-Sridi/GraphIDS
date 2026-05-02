import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

interface Flow {
  score: number;
  label: number;
}

export function ScoreDistribution({
  flows,
  threshold = 0.35,
}: {
  flows: Flow[];
  threshold?: number;
}) {
  const bins = useMemo(() => {
    const NUM_BINS = 20;
    const counts = Array.from({ length: NUM_BINS }, (_, i) => ({
      bin_start: i / NUM_BINS,
      bin_end: (i + 1) / NUM_BINS,
      label: `${Math.round((i / NUM_BINS) * 100)}`,
      benign: 0,
      anomalous: 0,
    }));

    for (const f of flows) {
      const idx = Math.min(Math.floor(f.score * NUM_BINS), NUM_BINS - 1);
      if (f.label === 1) counts[idx].anomalous += 1;
      else counts[idx].benign += 1;
    }

    return counts;
  }, [flows]);

  return (
    <div style={{ border: '1px solid #374151', background: '#111827', borderRadius: 8, padding: 14 }}>
      <h2 style={{ color: '#d1d5db', fontSize: 13, fontWeight: 700, margin: '0 0 12px 0' }}>
        Anomaly Score Distribution
      </h2>
      {flows.length === 0 ? (
        <p style={{ color: '#6b7280', fontSize: 12, textAlign: 'center', padding: '28px 0', margin: 0 }}>
          No data yet.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={bins} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis
              dataKey="label"
              tick={{ fill: '#6b7280', fontSize: 10 }}
              label={{
                value: 'Anomaly Score (%)',
                position: 'insideBottom',
                offset: -2,
                fill: '#6b7280',
                fontSize: 10,
              }}
            />
            <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} width={36} />
            <Tooltip
              contentStyle={{ background: '#111827', border: '1px solid #374151' }}
              labelFormatter={(v) => `Score bin: ${v}-${Number(v) + 5}%`}
            />
            <ReferenceLine
              x={`${Math.round(threshold * 100)}`}
              stroke="#f59e0b"
              strokeDasharray="4 4"
              label={{
                value: 'Threshold',
                fill: '#f59e0b',
                fontSize: 10,
                position: 'top',
              }}
            />
            <Bar dataKey="benign" stackId="a" fill="#3b82f6" name="Benign" />
            <Bar dataKey="anomalous" stackId="a" fill="#ef4444" name="Anomalous" />
          </BarChart>
        </ResponsiveContainer>
      )}
      <p style={{ color: '#6b7280', fontSize: 11, marginTop: 8 }}>
        Blue = benign flows. Red = detected anomalies. Yellow line = current decision threshold.
      </p>
    </div>
  );
}
