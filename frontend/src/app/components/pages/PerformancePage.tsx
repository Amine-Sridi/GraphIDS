import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { FPRMonitoring } from '../shared/FPRMonitoring';
import { graphIdsApi, type DashboardStats, type ClassificationResult } from '../../utils/api';
import { ScoreDistribution } from '../shared/ScoreDistribution';

function DualMetricCard({
  label,
  cumulative,
  windowed,
  format = (v: number) => `${(v * 100).toFixed(2)}%`,
}: {
  label: string;
  cumulative: number;
  windowed: number;
  format?: (v: number) => string;
}) {
  return (
    <div style={{ border: '1px solid #374151', background: '#111827', borderRadius: 8, padding: 14 }}>
      <p style={{ color: '#9ca3af', fontSize: 11, textTransform: 'uppercase', margin: '0 0 10px 0' }}>{label}</p>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <p style={{ color: '#9ca3af', fontSize: 11, margin: 0 }}>Session</p>
          <p style={{ color: '#e5e7eb', fontSize: 22, fontFamily: 'monospace', fontWeight: 700, margin: '4px 0 0 0' }}>
            {format(cumulative)}
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ color: '#60a5fa', fontSize: 11, margin: 0 }}>Last 5 min</p>
          <p style={{ color: '#93c5fd', fontSize: 22, fontFamily: 'monospace', fontWeight: 700, margin: '4px 0 0 0' }}>
            {format(windowed)}
          </p>
        </div>
      </div>
    </div>
  );
}

export function PerformancePage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [events, setEvents] = useState<ClassificationResult[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statsData, eventsData] = await Promise.all([
          graphIdsApi.getStats(),
          graphIdsApi.getEvents(300),
        ]);
        setStats(statsData);
        setEvents(eventsData);
      } catch {
        // Keep displaying last values if refresh fails.
      }
    };

    void fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: '#0d1117',
        overflow: 'hidden',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Page header */}
      <div
        style={{
          padding: '14px 20px',
          borderBottom: '1px solid #21262d',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <Activity size={16} color="#58a6ff" />
        <span
          style={{
            color: '#e6edf3',
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: '0.06em',
          }}
        >
          MODEL PERFORMANCE
        </span>
      </div>

      {/* Content */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {stats && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <DualMetricCard
              label="False Positive Rate"
              cumulative={stats.fpr}
              windowed={stats.windowed_fpr}
            />
            <DualMetricCard
              label="True Positive Rate"
              cumulative={stats.tpr}
              windowed={stats.windowed_tpr}
            />
            <DualMetricCard
              label="Precision"
              cumulative={stats.precision}
              windowed={stats.windowed_precision}
            />
            <DualMetricCard
              label="F1 Score"
              cumulative={stats.f1_score}
              windowed={stats.windowed_f1}
              format={(v) => v.toFixed(4)}
            />
          </div>
        )}

        <ScoreDistribution
          flows={events.map((e) => ({ score: e.score, label: e.label }))}
          threshold={stats?.retraining_threshold_fpr ?? 0.5}
        />

        <FPRMonitoring />
      </div>
    </div>
  );
}
