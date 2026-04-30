import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { graphIdsApi, type AlertStatus } from '../../utils/api';

export function AlertsPage() {
  const [alertStatus, setAlertStatus] = useState<AlertStatus | null>(null);
  const [acknowledging, setAcknowledging] = useState(false);
  const [thresholdInput, setThresholdInput] = useState('0.05');
  const [windowInput, setWindowInput] = useState('300');

  const fetchAlert = async () => {
    try {
      const data = await graphIdsApi.getAlertStatus();
      setAlertStatus(data);
      if (data.alert_threshold !== null) {
        setThresholdInput(String(data.alert_threshold));
      }
      setWindowInput(String(data.windowed_stats.window_sec));
    } catch {
      // Keep current values when polling fails.
    }
  };

  useEffect(() => {
    void fetchAlert();
    const interval = setInterval(fetchAlert, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleAcknowledge = async () => {
    setAcknowledging(true);
    try {
      await graphIdsApi.acknowledgeAlert();
      await fetchAlert();
    } finally {
      setAcknowledging(false);
    }
  };

  const handleSetThreshold = async () => {
    const fpr = parseFloat(thresholdInput);
    const sec = parseInt(windowInput, 10);
    if (isNaN(fpr) || fpr < 0 || fpr > 1) return;
    if (isNaN(sec) || sec < 60) return;
    await graphIdsApi.setAlertThreshold(fpr, sec);
    await fetchAlert();
  };

  return (
    <div
      style={{
        flex: 1,
        background: '#0d1117',
        overflowY: 'auto',
        padding: 24,
        color: '#e5e7eb',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <AlertTriangle size={18} color="#f87171" />
        <h1 style={{ fontSize: 20, margin: 0 }}>Retraining Alerts</h1>
      </div>

      {alertStatus?.alert_active && (
        <div
          style={{
            border: '1px solid #b91c1c',
            background: '#2b0b0b',
            borderRadius: 8,
            padding: 16,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <p style={{ color: '#fca5a5', fontWeight: 700, fontSize: 13, margin: 0 }}>
              ALERT ACTIVE - Human Review Required
            </p>
            <p style={{ color: '#fca5a5', fontSize: 12, margin: 0, fontFamily: 'monospace' }}>
              {alertStatus.message}
            </p>
            <p style={{ color: '#9ca3af', fontSize: 12, margin: 0 }}>
              Triggered at:{' '}
              {alertStatus.alert_triggered_at
                ? new Date(alertStatus.alert_triggered_at * 1000).toLocaleTimeString()
                : '-'}
              {' | '}Windowed FPR:{' '}
              {alertStatus.alert_fpr_value !== null
                ? `${(alertStatus.alert_fpr_value * 100).toFixed(2)}%`
                : '-'}
              {' | '}Threshold:{' '}
              {alertStatus.alert_threshold !== null
                ? `${(alertStatus.alert_threshold * 100).toFixed(2)}%`
                : '-'}
            </p>
          </div>
          <button
            onClick={() => void handleAcknowledge()}
            disabled={acknowledging}
            style={{
              padding: '8px 12px',
              border: '1px solid #dc2626',
              background: '#b91c1c',
              borderRadius: 6,
              color: '#fff',
              fontSize: 12,
              fontWeight: 700,
              cursor: acknowledging ? 'not-allowed' : 'pointer',
              opacity: acknowledging ? 0.7 : 1,
            }}
          >
            {acknowledging ? 'Acknowledging...' : 'Acknowledge'}
          </button>
        </div>
      )}

      {alertStatus && !alertStatus.alert_active && (
        <div
          style={{
            border: '1px solid #166534',
            background: '#052e16',
            borderRadius: 8,
            padding: 14,
          }}
        >
          <p style={{ color: '#4ade80', fontSize: 13, fontWeight: 700, margin: 0 }}>
            No active alert - model performance within threshold
          </p>
          <p style={{ color: '#9ca3af', fontSize: 12, margin: '6px 0 0 0' }}>
            Current windowed FPR: {(alertStatus.windowed_fpr * 100).toFixed(2)}%
          </p>
        </div>
      )}

      {alertStatus?.windowed_stats && (
        <div style={{ border: '1px solid #374151', background: '#111827', borderRadius: 8, padding: 16 }}>
          <h2 style={{ fontSize: 14, margin: '0 0 12px 0', color: '#d1d5db' }}>
            Current Window ({alertStatus.windowed_stats.window_sec}s)
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: 10,
            }}
          >
            {([
              ['FPR', `${(alertStatus.windowed_stats.fpr * 100).toFixed(2)}%`],
              ['TPR', `${(alertStatus.windowed_stats.tpr * 100).toFixed(2)}%`],
              ['Precision', `${(alertStatus.windowed_stats.precision * 100).toFixed(2)}%`],
              ['F1', alertStatus.windowed_stats.f1.toFixed(4)],
            ] as [string, string][]).map(([label, value]) => (
              <div key={label} style={{ background: '#1f2937', borderRadius: 6, padding: 12, textAlign: 'center' }}>
                <p style={{ color: '#9ca3af', fontSize: 11, margin: 0 }}>{label}</p>
                <p style={{ color: '#f3f4f6', fontSize: 20, margin: '6px 0 0 0', fontFamily: 'monospace', fontWeight: 700 }}>
                  {value}
                </p>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 12, maxWidth: 280 }}>
            {([
              ['TP', alertStatus.windowed_stats.tp, '#4ade80'],
              ['FP', alertStatus.windowed_stats.fp, '#f87171'],
              ['FN', alertStatus.windowed_stats.fn, '#fb923c'],
              ['TN', alertStatus.windowed_stats.tn, '#60a5fa'],
            ] as [string, number, string][]).map(([label, value, color]) => (
              <div key={label} style={{ background: '#1f2937', borderRadius: 6, padding: 8, textAlign: 'center' }}>
                <span style={{ color: '#9ca3af', fontSize: 11 }}>{label} </span>
                <span style={{ color, fontFamily: 'monospace', fontWeight: 700, fontSize: 13 }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ border: '1px solid #374151', background: '#111827', borderRadius: 8, padding: 16 }}>
        <h2 style={{ fontSize: 14, margin: '0 0 10px 0', color: '#d1d5db' }}>Alert Threshold Configuration</h2>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ color: '#9ca3af', fontSize: 11, display: 'block', marginBottom: 4 }}>
              FPR Threshold (0.0 - 1.0)
            </label>
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={thresholdInput}
              onChange={(e) => setThresholdInput(e.target.value)}
              style={{
                background: '#1f2937',
                border: '1px solid #4b5563',
                color: '#f3f4f6',
                borderRadius: 6,
                padding: '6px 10px',
                width: 130,
              }}
            />
          </div>
          <div>
            <label style={{ color: '#9ca3af', fontSize: 11, display: 'block', marginBottom: 4 }}>
              Window (seconds)
            </label>
            <input
              type="number"
              min="60"
              max="3600"
              step="60"
              value={windowInput}
              onChange={(e) => setWindowInput(e.target.value)}
              style={{
                background: '#1f2937',
                border: '1px solid #4b5563',
                color: '#f3f4f6',
                borderRadius: 6,
                padding: '6px 10px',
                width: 130,
              }}
            />
          </div>
          <button
            onClick={() => void handleSetThreshold()}
            style={{
              padding: '7px 14px',
              borderRadius: 6,
              border: '1px solid #2563eb',
              background: '#1d4ed8',
              color: '#fff',
              fontWeight: 700,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Apply
          </button>
        </div>
      </div>

      {alertStatus && alertStatus.recent_alerts.length > 0 && (
        <div style={{ border: '1px solid #374151', background: '#111827', borderRadius: 8, padding: 16 }}>
          <h2 style={{ fontSize: 14, margin: '0 0 10px 0', color: '#d1d5db' }}>Recent Alert History</h2>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: '#9ca3af', fontSize: 11, borderBottom: '1px solid #374151' }}>
                <th style={{ textAlign: 'left', paddingBottom: 8 }}>Time</th>
                <th style={{ textAlign: 'left', paddingBottom: 8 }}>Windowed FPR</th>
                <th style={{ textAlign: 'left', paddingBottom: 8 }}>Threshold</th>
              </tr>
            </thead>
            <tbody>
              {[...alertStatus.recent_alerts].reverse().map((a) => (
                <tr key={a.alert_id} style={{ borderBottom: '1px solid #1f2937' }}>
                  <td style={{ padding: '8px 0', color: '#d1d5db', fontFamily: 'monospace', fontSize: 12 }}>
                    {new Date(a.triggered_at * 1000).toLocaleTimeString()}
                  </td>
                  <td style={{ padding: '8px 0', color: '#f87171', fontFamily: 'monospace' }}>
                    {(a.windowed_fpr * 100).toFixed(2)}%
                  </td>
                  <td style={{ padding: '8px 0', color: '#9ca3af', fontFamily: 'monospace' }}>
                    {(a.threshold * 100).toFixed(2)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}