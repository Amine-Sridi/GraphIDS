import { useEffect, useState } from 'react';
import { graphIdsApi } from '../../utils/api';

interface SessionStats {
  total_flows_processed: number;
  total_anomalies_detected: number;
  windowed_fpr: number;
  uptime_seconds: number;
  alert_active: boolean;
}

export function SessionHeader() {
  const [stats, setStats] = useState<SessionStats | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const data = await graphIdsApi.getStats();
        setStats({
          total_flows_processed: data.total_flows_processed,
          total_anomalies_detected: data.total_anomalies_detected,
          windowed_fpr: data.windowed_fpr ?? 0,
          uptime_seconds: data.uptime_seconds ?? 0,
          alert_active: data.alert_active ?? false,
        });
      } catch {
        // Keep last known values if refresh fails.
      }
    };

    void fetchStats();
    const interval = setInterval(fetchStats, 3000);
    return () => clearInterval(interval);
  }, []);

  function formatUptime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  return (
    <div
      style={{
        height: 48,
        background: '#0f1720',
        borderBottom: '1px solid #21262d',
        display: 'flex',
        alignItems: 'center',
        padding: '0 24px',
        gap: 28,
        flexShrink: 0,
      }}
    >
      {stats?.alert_active && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: '#f87171',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.04em',
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#ef4444',
              display: 'inline-block',
              boxShadow: '0 0 8px rgba(239,68,68,0.8)',
            }}
          />
          RETRAINING ALERT
        </div>
      )}

      <StatItem
        label="Flows Processed"
        value={stats ? stats.total_flows_processed.toLocaleString() : '-'}
      />
      <StatItem
        label="Anomalies Detected"
        value={stats ? stats.total_anomalies_detected.toLocaleString() : '-'}
        highlight={stats ? stats.total_anomalies_detected > 0 : false}
      />
      <StatItem
        label="FPR (5 min)"
        value={stats ? `${(stats.windowed_fpr * 100).toFixed(2)}%` : '-'}
        highlight={stats ? stats.windowed_fpr > 0.05 : false}
      />
      <StatItem
        label="Uptime"
        value={stats ? formatUptime(stats.uptime_seconds) : '-'}
      />
    </div>
  );
}

function StatItem({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span
        style={{
          color: '#6b7280',
          fontSize: 10,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          lineHeight: 1,
        }}
      >
        {label}
      </span>
      <span
        style={{
          color: highlight ? '#f97316' : '#e5e7eb',
          fontSize: 13,
          fontFamily: 'monospace',
          fontWeight: 700,
        }}
      >
        {value}
      </span>
    </div>
  );
}
