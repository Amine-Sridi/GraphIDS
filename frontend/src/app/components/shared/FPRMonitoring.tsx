import { useEffect, useRef, useState } from 'react';
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ReferenceLine, ComposedChart, Area,
} from 'recharts';
import { AlertTriangle, TrendingUp, Activity } from 'lucide-react';
import { graphIdsApi, type DashboardStats } from '../../utils/api';

interface FPRDataPoint {
  timestamp: string;
  fpr: number;
  tpr: number;
  precision: number;
  f1: number;
}

interface MetricCardProps {
  label: string;
  value: string | number;
  unit?: string;
  icon?: React.ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  color?: 'red' | 'yellow' | 'green' | 'blue';
  alert?: boolean;
}

const MetricCard = ({ label, value, unit, icon, trend, color = 'blue', alert }: MetricCardProps) => {
  const colorMap = {
    red: '#ef4444',
    yellow: '#f97316',
    green: '#10b981',
    blue: '#3b82f6',
  };

  const bgColorMap = {
    red: 'rgba(239, 68, 68, 0.1)',
    yellow: 'rgba(249, 115, 22, 0.1)',
    green: 'rgba(16, 185, 129, 0.1)',
    blue: 'rgba(59, 130, 246, 0.1)',
  };

  const borderColorMap = {
    red: 'rgba(239, 68, 68, 0.3)',
    yellow: 'rgba(249, 115, 22, 0.3)',
    green: 'rgba(16, 185, 129, 0.3)',
    blue: 'rgba(59, 130, 246, 0.3)',
  };

  return (
    <div
      style={{
        background: bgColorMap[color],
        border: `1px solid ${borderColorMap[color]}`,
        borderRadius: 8,
        padding: '16px',
        minWidth: '140px',
        position: 'relative',
        ...(alert && { boxShadow: `0 0 12px ${colorMap[color]}40` }),
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: '#7d8590', fontWeight: 500, textTransform: 'uppercase' }}>
          {label}
        </span>
        {icon && <div style={{ color: colorMap[color], opacity: 0.7 }}>{icon}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 24, fontWeight: 700, color: colorMap[color], fontFamily: 'monospace' }}>
          {typeof value === 'number' ? value.toFixed(2) : value}
        </span>
        {unit && <span style={{ fontSize: 12, color: '#7d8590' }}>{unit}</span>}
      </div>
      {trend && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#7d8590', display: 'flex', alignItems: 'center', gap: 4 }}>
          <TrendingUp size={14} style={{ transform: trend === 'down' ? 'scaleY(-1)' : 'none' }} />
          {trend === 'up' ? '📈 Increasing' : trend === 'down' ? '📉 Decreasing' : '→ Stable'}
        </div>
      )}
    </div>
  );
};

const FPRTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const data = payload[0]?.payload;
  return (
    <div
      style={{
        background: '#0d1117',
        border: '1px solid #21262d',
        padding: '12px',
        borderRadius: 6,
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      }}
    >
      <div style={{ color: '#7d8590', fontSize: 10, marginBottom: 6 }}>
        {data?.timestamp}
      </div>
      {payload.map((entry: any, idx: number) => (
        <div key={idx} style={{ color: entry.color, fontSize: 12, fontWeight: 500, fontFamily: 'monospace' }}>
          {entry.name}: {(entry.value * 100).toFixed(2)}%
        </div>
      ))}
    </div>
  );
};

export const FPRMonitoring = () => {
  const [data, setData] = useState<FPRDataPoint[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch current stats
  const fetchStats = async () => {
    try {
      const stats = await graphIdsApi.getStats();
      setStats(stats);

      // Add to historical data
      setData((prevData) => {
        const now = new Date();
        const timeLabel = now.toLocaleTimeString('en-US', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });

        const newPoint: FPRDataPoint = {
          timestamp: timeLabel,
          fpr: stats.fpr,
          tpr: stats.tpr,
          precision: stats.precision,
          f1: stats.f1_score,
        };

        // Keep last 60 data points
        const updated = [...prevData, newPoint];
        return updated.slice(-60);
      });

      setError(null);
    } catch (err) {
      setError('Failed to fetch stats');
      console.error(err);
    }
  };

  // Initial fetch and setup polling
  useEffect(() => {
    fetchStats();

    // Poll every 2 seconds
    pollIntervalRef.current = setInterval(() => {
      fetchStats();
    }, 2000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // Determine color based on FPR value
  const fprColor = (stats?.fpr ?? 0) > 0.15 ? 'yellow' : 'green';

  return (
    <div style={{ padding: '24px', background: '#0d1117', borderRadius: 8, border: '1px solid #21262d' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <Activity size={24} style={{ color: '#3b82f6' }} />
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#e6edf3', margin: 0 }}>
            Model Performance Monitoring (FPR)
          </h2>
        </div>
        <p style={{ fontSize: 13, color: '#7d8590', margin: '4px 0 0 0' }}>
          Real-time False Positive Rate tracking with automatic retraining alerts
        </p>
      </div>

      {/* Error Message */}
      {error && (
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 6,
            padding: 12,
            marginBottom: 16,
            color: '#f85149',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* Metrics Row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 12,
          marginBottom: 24,
        }}
      >
        <MetricCard
          label="False Positive Rate"
          value={(stats?.fpr ?? 0) * 100}
          unit="%"
          color={fprColor}
          icon={<Activity size={16} />}
        />
        <MetricCard
          label="Precision"
          value={(stats?.precision ?? 0) * 100}
          unit="%"
          color="blue"
          icon={<Activity size={16} />}
        />
        <MetricCard
          label="F1 Score"
          value={stats?.f1_score ?? 0}
          unit=""
          color="blue"
          icon={<Activity size={16} />}
        />
      </div>

      {/* FPR Historical Chart */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: '#e6edf3', margin: '0 0 12px 0' }}>
          Performance Metrics Over Time
        </h3>
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={data} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
              <XAxis dataKey="timestamp" stroke="#7d8590" style={{ fontSize: 12 }} />
              <YAxis stroke="#7d8590" style={{ fontSize: 12 }} domain={[0, 1]} />
              <Tooltip content={<FPRTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: 12, color: '#7d8590' }}
                iconType="line"
              />
              <ReferenceLine
                y={0.5}
                stroke="#f97316"
                strokeDasharray="5 5"
                label={{
                  value: 'Threshold: 50%',
                  fill: '#f97316',
                  fontSize: 11,
                  position: 'topRight',
                }}
              />
              <Area
                type="monotone"
                dataKey="fpr"
                fill="rgba(239, 68, 68, 0.1)"
                stroke="#ef4444"
                strokeWidth={2}
                name="False Positive Rate"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="precision"
                stroke="#3b82f6"
                strokeWidth={2}
                name="Precision"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="f1"
                stroke="#f97316"
                strokeWidth={2}
                name="F1 Score"
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div
            style={{
              textAlign: 'center',
              padding: 40,
              color: '#7d8590',
              fontSize: 13,
            }}
          >
            No data yet. Start streaming flows to see FPR metrics...
          </div>
        )}
      </div>


    </div>
  );
};
