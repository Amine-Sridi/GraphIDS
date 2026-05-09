import { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
} from 'recharts';
import { graphIdsApi } from '../../utils/api';

interface TimelinePoint {
  timestamp: number;
  score: number;
  label: number;
  severity: string;
  time_label: string;
}

export function AttackTimeline({ threshold = 0.5 }: { threshold?: number }) {
  const [data, setData] = useState<TimelinePoint[]>([]);

  useEffect(() => {
    const fetch = async () => {
      try {
        const events = await graphIdsApi.getEvents(200);
        const points: TimelinePoint[] = events.map((e) => ({
          timestamp: e.timestamp,
          score: e.score,
          label: e.label,
          severity: e.severity ?? 'low',
          time_label: new Date(e.timestamp * 1000).toLocaleTimeString(),
        }));
        points.sort((a, b) => a.timestamp - b.timestamp);
        setData(points);
      } catch {
        // Keep last known timeline if refresh fails.
      }
    };

    void fetch();
    const interval = setInterval(fetch, 1500);
    return () => clearInterval(interval);
  }, []);

  const CustomDot = (props: any) => {
    const { cx, cy, payload } = props;
    // Recharts may render a default dot when null is returned in some versions.
    // Return an empty SVG group to reliably suppress non-anomalous points.
    if (!payload || payload.label !== 1) return <g />;
    return <circle cx={cx} cy={cy} r={4} fill="#ef4444" stroke="#1f2937" strokeWidth={1} />;
  };

  return (
    <div
      style={{
        border: '1px solid #374151',
        background: '#111827',
        borderRadius: 8,
        padding: 14,
      }}
    >
      <h2 style={{ color: '#d1d5db', fontSize: 13, fontWeight: 700, margin: '0 0 12px 0' }}>
        Attack Timeline - Anomaly Score Over Session
      </h2>

      {data.length === 0 ? (
        <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: 12 }}>
          Waiting for data...
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="anomalyGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="time_label" tick={{ fill: '#6b7280', fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis
              domain={[0, 1]}
              tick={{ fill: '#6b7280', fontSize: 10 }}
              tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
              width={40}
            />
            <Tooltip
              contentStyle={{ background: '#111827', border: '1px solid #374151' }}
              labelStyle={{ color: '#9ca3af', fontSize: 11 }}
              formatter={(value: number) => [`${(value * 100).toFixed(1)}%`, 'Anomaly Score']}
            />
            <ReferenceLine
              y={0.5}
              stroke="#f59e0b"
              strokeDasharray="4 4"
              label={{
                value: 'Threshold 50%',
                fill: '#f59e0b',
                fontSize: 10,
                position: 'right',
              }}
            />
            <Area
              type="linear"
              dataKey="score"
              stroke="#3b82f6"
              strokeWidth={2}
              fill="url(#scoreGrad)"
              dot={<CustomDot />}
              activeDot={{ r: 6, fill: '#60a5fa' }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}

      <p style={{ color: '#6b7280', fontSize: 11, marginTop: 8 }}>
        Red dots indicate detected anomalies. Yellow line is the current decision threshold.
      </p>
    </div>
  );
}
