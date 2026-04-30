import { useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const PROTOCOL_NAMES: Record<number, string> = {
  6: 'TCP',
  17: 'UDP',
  1: 'ICMP',
  58: 'ICMPv6',
  132: 'SCTP',
};

const COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444'];

interface Flow {
  protocol: number;
  label: number;
}

export function ProtocolBreakdown({ flows }: { flows: Flow[] }) {
  const data = useMemo(() => {
    const anomalous = flows.filter((f) => f.label === 1);
    const counts: Record<string, number> = {};

    for (const f of anomalous) {
      const name = PROTOCOL_NAMES[f.protocol] ?? `Proto-${f.protocol}`;
      counts[name] = (counts[name] ?? 0) + 1;
    }

    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [flows]);

  return (
    <div style={{ border: '1px solid #374151', background: '#111827', borderRadius: 8, padding: 14 }}>
      <h2 style={{ color: '#d1d5db', fontSize: 13, fontWeight: 700, margin: '0 0 8px 0' }}>
        Anomalies by Protocol
      </h2>
      {data.length === 0 ? (
        <p style={{ color: '#6b7280', fontSize: 11, textAlign: 'center', padding: '22px 0', margin: 0 }}>
          No anomalies detected yet.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={40}
              outerRadius={70}
              paddingAngle={3}
              dataKey="value"
              isAnimationActive={false}
            >
              {data.map((_, index) => (
                <Cell key={index} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ background: '#111827', border: '1px solid #374151' }}
              formatter={(value: number, name: string) => [`${value} alerts`, name]}
            />
            <Legend
              iconType="circle"
              iconSize={8}
              formatter={(value) => <span style={{ color: '#9ca3af', fontSize: 11 }}>{value}</span>}
            />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
