import { useEffect, useRef, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ComposedChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, ReferenceArea,
} from 'recharts';
import { BarChart, Bar, Cell } from 'recharts';
import {
  Activity, AlertTriangle, Shield, ShieldAlert,
  Radio, Database, Zap, Clock, TrendingUp, ChevronRight,
} from 'lucide-react';
import type { DataPoint, AlertEntry, FlowEntry } from '../types';
import { graphIdsApi, type DashboardStats } from '../utils/api';
import { generateExplanation } from '../utils/explainability';
import { ExplanationPanel } from './shared/ExplanationPanel';
import { AttackTimeline } from './shared/AttackTimeline';
import { TopTalkers } from './shared/TopTalkers';
import { ProtocolBreakdown } from './shared/ProtocolBreakdown';

// ─── Constants ────────────────────────────────────────────────────────────────
// Visual guide line for score charts only. Detection decisions come from backend labels.
const THRESHOLD = 0.35;
const CHART_WINDOW = 60;
const UPDATE_INTERVAL = 1100;

// ─── Utilities ────────────────────────────────────────────────────────────────
const formatTime = (d: Date) =>
  d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

// ─── Sub-components ───────────────────────────────────────────────────────────

const SeverityBadge = ({ severity }: { severity: AlertEntry['severity'] }) => {
  const configs = {
    low:      { label: 'LOW',      bg: 'rgba(234,179,8,0.15)',  color: '#eab308', border: 'rgba(234,179,8,0.35)' },
    medium:   { label: 'MEDIUM',   bg: 'rgba(249,115,22,0.15)', color: '#f97316', border: 'rgba(249,115,22,0.35)' },
    high:     { label: 'HIGH',     bg: 'rgba(239,68,68,0.15)',  color: '#ef4444', border: 'rgba(239,68,68,0.35)' },
    critical: { label: 'CRITICAL', bg: 'rgba(239,68,68,0.25)',  color: '#fca5a5', border: 'rgba(239,68,68,0.6)' },
  };
  const c = configs[severity];
  return (
    <span style={{
      background: c.bg, color: c.color, border: `1px solid ${c.border}`,
      padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 700,
      letterSpacing: '0.05em', fontFamily: 'monospace', whiteSpace: 'nowrap',
    }}>
      {c.label}
    </span>
  );
};

const TimeTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const score = payload[0]?.value ?? 0;
  const isAnomaly = Boolean(payload[0]?.payload?.isAnomaly);
  return (
    <div style={{
      background: '#0d1117', border: `1px solid ${isAnomaly ? '#ef4444' : '#21262d'}`,
      padding: '8px 12px', borderRadius: 6, boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
    }}>
      <div style={{ color: '#7d8590', fontSize: 10, marginBottom: 4 }}>
        {payload[0]?.payload?.timeLabel}
      </div>
      <div style={{ color: isAnomaly ? '#f85149' : '#58a6ff', fontSize: 13, fontWeight: 700, fontFamily: 'monospace' }}>
        Score: {score.toFixed(4)}
      </div>
      {isAnomaly && (
        <div style={{ color: '#f97316', fontSize: 10, marginTop: 3 }}>⚠ ANOMALY DETECTED</div>
      )}
    </div>
  );
};

const HistTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div style={{
      background: '#0d1117', border: '1px solid #21262d',
      padding: '6px 10px', borderRadius: 6,
    }}>
      <div style={{ color: '#7d8590', fontSize: 10 }}>Range: {d?.range}</div>
      <div style={{ color: d?.isAnomaly ? '#f85149' : '#58a6ff', fontSize: 12, fontWeight: 600 }}>
        {d?.count} flows
      </div>
    </div>
  );
};

// Fixed: no key on root element; return null for non-anomaly dots
const AnomalyDot = (props: any) => {
  const { cx, cy, payload } = props;
  if (!payload || !payload.isAnomaly) return <g />;
  return (
    <g>
      <circle cx={cx} cy={cy} r={5} fill="#ef4444" stroke="#f87171" strokeWidth={1.5} opacity={0.9} />
      <circle cx={cx} cy={cy} r={9} fill="#ef4444" opacity={0.15} />
    </g>
  );
};

// ─── Status Bar ───────────────────────────────────────────────────────────────
interface StatusBarProps {
  isActive: boolean;
  throughput: number;
  totalFlows: number;
  anomalyCount: number;
  onToggle: () => void;
}

const StatusBar = ({ isActive, throughput, totalFlows, anomalyCount, onToggle }: StatusBarProps) => (
  <div style={{
    background: '#0d1117', borderBottom: '1px solid #21262d',
    padding: '0 20px', height: 52, display: 'flex', alignItems: 'center',
    gap: 8, flexShrink: 0,
  }}>
    {/* System Status */}
    <StatusCard
      icon={<Radio size={14} />}
      label="SYSTEM STATUS"
      value={
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: isActive ? '#3fb950' : '#7d8590',
            boxShadow: isActive ? '0 0 6px #3fb950' : 'none',
            animation: isActive ? 'pulse 2s infinite' : 'none',
          }} />
          <span style={{ color: isActive ? '#3fb950' : '#7d8590', fontWeight: 700, fontSize: 13 }}>
            {isActive ? 'ACTIVE' : 'STOPPED'}
          </span>
        </div>
      }
      onClick={onToggle}
      clickable
    />

    <div style={{ width: 1, height: 32, background: '#21262d', margin: '0 6px' }} />

    <StatusCard
      icon={<Zap size={14} />}
      label="THROUGHPUT"
      value={
        <>
          <span style={{ color: '#58a6ff', fontSize: 15, fontWeight: 700 }}>{throughput.toFixed(1)}</span>
          <span style={{ color: '#7d8590', fontSize: 11, marginLeft: 3 }}>flows/s</span>
        </>
      }
    />

    <div style={{ width: 1, height: 32, background: '#21262d', margin: '0 6px' }} />

    <StatusCard
      icon={<Database size={14} />}
      label="TOTAL FLOWS"
      value={<span style={{ color: '#e6edf3', fontSize: 15, fontWeight: 700 }}>{totalFlows.toLocaleString()}</span>}
    />

    <div style={{ width: 1, height: 32, background: '#21262d', margin: '0 6px' }} />

    <StatusCard
      icon={<AlertTriangle size={14} />}
      label="ANOMALIES"
      value={
        <span style={{
          color: anomalyCount > 0 ? '#f85149' : '#7d8590', fontSize: 15, fontWeight: 700,
          textShadow: anomalyCount > 0 ? '0 0 12px rgba(248,81,73,0.5)' : 'none',
        }}>
          {anomalyCount}
        </span>
      }
      highlight={anomalyCount > 0}
    />

    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        padding: '4px 10px', borderRadius: 4,
        background: 'rgba(88,166,255,0.08)', border: '1px solid rgba(88,166,255,0.2)',
        color: '#7d8590', fontSize: 10, fontFamily: 'monospace',
      }}>
        THRESHOLD: {THRESHOLD.toFixed(2)}
      </div>
      <div style={{
        padding: '4px 10px', borderRadius: 4,
        background: 'rgba(63,185,80,0.08)', border: '1px solid rgba(63,185,80,0.2)',
        color: '#3fb950', fontSize: 10, fontFamily: 'monospace',
        display: 'flex', alignItems: 'center', gap: 5,
      }}>
        <Activity size={10} />
        LIVE
      </div>
    </div>
  </div>
);

const StatusCard = ({ icon, label, value, highlight = false, onClick, clickable = false }: {
  icon: ReactNode; label: string; value: ReactNode;
  highlight?: boolean; onClick?: () => void; clickable?: boolean;
}) => (
  <div
    onClick={onClick}
    style={{
      padding: '5px 12px', borderRadius: 6,
      background: highlight ? 'rgba(248,81,73,0.08)' : 'rgba(255,255,255,0.03)',
      border: `1px solid ${highlight ? 'rgba(248,81,73,0.25)' : '#21262d'}`,
      cursor: clickable ? 'pointer' : 'default',
      transition: 'all 0.2s', minWidth: 100,
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
      <span style={{ color: highlight ? '#f85149' : '#7d8590' }}>{icon}</span>
      <span style={{ color: '#7d8590', fontSize: 10, letterSpacing: '0.06em' }}>{label}</span>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{value}</div>
  </div>
);

// ─── Stats Panel ──────────────────────────────────────────────────────────────
interface StatsPanelProps {
  avgScore: number;
  peakScore: number;
  benignCount: number;
  anomalyCount: number;
  totalRecent: number;
  recentData: DataPoint[];
}

const StatsPanel = ({ avgScore, peakScore, benignCount, anomalyCount, totalRecent, recentData }: StatsPanelProps) => {
  const benignPct = totalRecent > 0 ? (benignCount / totalRecent) * 100 : 100;
  const anomalyPct = 100 - benignPct;
  const anomalyRate = totalRecent > 0 ? (anomalyCount / totalRecent) * 100 : 0;

  return (
    <div style={{
      width: 220, flexShrink: 0, background: '#0d1117', borderRight: '1px solid #21262d',
      overflowY: 'auto', display: 'flex', flexDirection: 'column',
    }}>
      <SectionHeader title="ACTIVITY STATS" icon={<TrendingUp size={12} />} />

      <div style={{ padding: '0 14px 12px' }}>
        <StatRow label="Avg Score" value={avgScore.toFixed(4)}
          valueColor={avgScore > THRESHOLD ? '#f85149' : '#58a6ff'} mono />
        <StatRow label="Peak Score" value={peakScore.toFixed(4)}
          valueColor={peakScore > THRESHOLD ? '#f85149' : '#e6edf3'} mono />
        <StatRow label="Threshold" value={THRESHOLD.toFixed(2)} valueColor="#f97316" mono />
        <StatRow label="Anomaly Rate" value={`${anomalyRate.toFixed(1)}%`}
          valueColor={anomalyRate > 5 ? '#f85149' : '#e6edf3'} />

        <div style={{ height: 1, background: '#21262d', margin: '10px 0' }} />

        <div style={{ marginBottom: 8 }}>
          <div style={{ color: '#7d8590', fontSize: 10, letterSpacing: '0.06em', marginBottom: 8 }}>
            FLOW DISTRIBUTION
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <FlowBar label="BENIGN" count={benignCount} pct={benignPct} color="#3fb950" />
            <FlowBar label="ANOMALOUS" count={anomalyCount} pct={anomalyPct} color="#f85149" />
          </div>
        </div>

        <div style={{ height: 1, background: '#21262d', margin: '10px 0' }} />

        <div>
          <div style={{ color: '#7d8590', fontSize: 10, letterSpacing: '0.06em', marginBottom: 8 }}>
            SYSTEM HEALTH
          </div>
          <HealthMeter avgScore={avgScore} />
        </div>

        <div style={{ height: 1, background: '#21262d', margin: '10px 0' }} />

        <div>
          <div style={{ color: '#7d8590', fontSize: 10, letterSpacing: '0.06em', marginBottom: 6 }}>
            SCORE SPARKLINE
          </div>
          <MiniSparkline data={recentData.slice(-20)} />
        </div>

        <div style={{ height: 1, background: '#21262d', margin: '10px 0' }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 2, background: '#58a6ff', borderRadius: 1 }} />
            <span style={{ color: '#7d8590', fontSize: 10 }}>Normal traffic</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444' }} />
            <span style={{ color: '#7d8590', fontSize: 10 }}>Anomaly spike</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 12, height: 1, borderTop: '1px dashed #f97316' }} />
            <span style={{ color: '#7d8590', fontSize: 10 }}>Threshold line</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const SectionHeader = ({ title, icon }: { title: string; icon?: ReactNode }) => (
  <div style={{
    padding: '10px 14px', borderBottom: '1px solid #21262d',
    display: 'flex', alignItems: 'center', gap: 6,
  }}>
    <span style={{ color: '#7d8590' }}>{icon}</span>
    <span style={{ color: '#7d8590', fontSize: 10, letterSpacing: '0.08em', fontWeight: 600 }}>{title}</span>
  </div>
);

const StatRow = ({ label, value, valueColor, mono = false }: {
  label: string; value: string; valueColor?: string; mono?: boolean;
}) => (
  <div style={{
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '5px 0', borderBottom: '1px solid rgba(33,38,45,0.5)',
  }}>
    <span style={{ color: '#7d8590', fontSize: 11 }}>{label}</span>
    <span style={{
      color: valueColor ?? '#e6edf3', fontSize: 12, fontWeight: 600,
      fontFamily: mono ? 'monospace' : 'inherit',
    }}>
      {value}
    </span>
  </div>
);

const FlowBar = ({ label, count, pct, color }: { label: string; count: number; pct: number; color: string }) => (
  <div>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
      <span style={{ color: '#7d8590', fontSize: 10 }}>{label}</span>
      <span style={{ color, fontSize: 10, fontFamily: 'monospace' }}>{count} ({pct.toFixed(1)}%)</span>
    </div>
    <div style={{ height: 4, background: '#21262d', borderRadius: 2, overflow: 'hidden' }}>
      <div style={{
        width: `${Math.min(100, pct)}%`, height: '100%',
        background: color, borderRadius: 2, transition: 'width 0.5s ease',
      }} />
    </div>
  </div>
);

const HealthMeter = ({ avgScore }: { avgScore: number }) => {
  const healthPct = Math.max(0, Math.min(100, (1 - avgScore / 0.7) * 100));
  const color = healthPct > 70 ? '#3fb950' : healthPct > 40 ? '#f97316' : '#f85149';
  const label = healthPct > 70 ? 'GOOD' : healthPct > 40 ? 'DEGRADED' : 'CRITICAL';
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ color, fontSize: 11, fontWeight: 700 }}>{label}</span>
        <span style={{ color, fontSize: 11, fontFamily: 'monospace' }}>{healthPct.toFixed(0)}%</span>
      </div>
      <div style={{ height: 6, background: '#21262d', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          width: `${healthPct}%`, height: '100%', borderRadius: 3,
          background: `linear-gradient(90deg, ${color}cc, ${color})`,
          transition: 'width 0.6s ease',
        }} />
      </div>
    </div>
  );
};

const MiniSparkline = ({ data }: { data: DataPoint[] }) => {
  if (data.length < 2) return null;
  const w = 192, h = 40;
  const pts = data.map((d, i) => ({
    x: (i / (data.length - 1)) * w,
    y: h - (d.score / 1.0) * h,
    isAnomaly: d.isAnomaly,
  }));
  const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const threshY = h - (THRESHOLD / 1.0) * h;
  return (
    <svg width={w} height={h} style={{ overflow: 'visible' }}>
      <line x1={0} y1={threshY} x2={w} y2={threshY} stroke="#f97316" strokeWidth={1} strokeDasharray="3 2" opacity={0.6} />
      <path d={pathD} fill="none" stroke="#3b82f6" strokeWidth={1.5} opacity={0.8} />
      {pts.filter(p => p.isAnomaly).map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill="#ef4444" />
      ))}
    </svg>
  );
};

// Custom dot component for anomaly markers
const AnomalyMarker = (props: any) => {
  const { cx, cy, payload } = props;
  if (!payload || !payload.isAnomaly) return <g />;
  return (
    <g>
      <circle cx={cx} cy={cy} r={5} fill="#ef4444" stroke="#f87171" strokeWidth={2} opacity={0.95} />
      <circle cx={cx} cy={cy} r={8} fill="#ef4444" opacity={0.2} />
    </g>
  );
};

// ─── Heartbeat Chart ─────────────────────────────────────────────────────────
// Discrete event visualization: renders aggregated heartbeat events as spikes
// on a continuous line with anomaly markers (red dots)
const HeartbeatChart = ({ data }: { data: DataPoint[] }) => {
  // Create discrete heartbeat events
  const heartbeatData = useMemo(() => {
    return data.map((d, idx) => ({
      idx,
      timeLabel: d.timeLabel,
      score: parseFloat(d.score.toFixed(4)),
      isAnomaly: d.isAnomaly,
    }));
  }, [data]);

  const maxIdx = Math.max(heartbeatData.length - 1, 1);

  return (
    <div style={{
      flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
      background: '#0d1117', padding: '12px 16px 8px',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Activity size={14} color="#58a6ff" />
          <span style={{ color: '#e6edf3', fontSize: 12, fontWeight: 600, letterSpacing: '0.05em' }}>
            HEARTBEAT MONITOR — ANOMALY SPIKES
          </span>
          <div style={{
            width: 6, height: 6, borderRadius: '50%', background: '#3fb950',
            boxShadow: '0 0 6px #3fb950', animation: 'pulse 1.5s infinite',
          }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: '#7d8590', fontSize: 10, fontFamily: 'monospace' }}>
            ANOMALIES: {heartbeatData.filter(d => d.isAnomaly).length}
          </span>
        </div>
      </div>

      {/* Heartbeat chart - discrete events */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={heartbeatData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="heartbeatGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#3b82f6" stopOpacity={0.35} />
                  <stop offset="60%"  stopColor="#3b82f6" stopOpacity={0.1}  />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" stroke="#21262d" vertical={false} />

              <XAxis
                dataKey="idx"
                type="number"
                domain={[0, maxIdx]}
                allowDataOverflow
                tickCount={5}
                tickFormatter={(val) => {
                  const pt = heartbeatData[Math.round(val)];
                  return pt?.timeLabel ?? '';
                }}
                tick={{ fill: '#4d5666', fontSize: 9, fontFamily: 'monospace' }}
                axisLine={{ stroke: '#21262d' }}
                tickLine={false}
              />

              <YAxis
                domain={[0, 1]}
                tick={{ fill: '#4d5666', fontSize: 9, fontFamily: 'monospace' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => v.toFixed(1)}
                width={32}
                label={{ value: 'INTENSITY', angle: -90, position: 'insideLeft', style: { fill: '#7d8590' } }}
              />

              <Tooltip content={<TimeTooltip />} />

              {/* Anomaly threshold zone */}
              <ReferenceArea y1={THRESHOLD} y2={1} fill="#ef4444" fillOpacity={0.04} />

              {/* Baseline threshold line */}
              <ReferenceLine
                y={THRESHOLD}
                stroke="#f97316"
                strokeDasharray="5 3"
                strokeWidth={1.5}
                label={{
                  value: `THRESHOLD ${THRESHOLD}`,
                  position: 'insideTopRight',
                  fill: '#f97316',
                  fontSize: 10,
                  fontFamily: 'monospace',
                }}
              />

              {/* Continuous line with gradient fill and anomaly markers */}
              <Area
                type="monotone"
                dataKey="score"
                stroke="#3b82f6"
                strokeWidth={2}
                fill="url(#heartbeatGradient)"
                dot={<AnomalyMarker />}
                activeDot={{ r: 6, fill: '#58a6ff', stroke: '#fff', strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

// ─── Time Series Chart ────────────────────────────────────────────────────────
// FIX: use numeric idx as XAxis dataKey to avoid duplicate-key warnings from
//      repeated MM:SS timeLabel values in the 60-second sliding window.
// FIX: position:absolute wrapper so ResponsiveContainer height="100%" resolves
//      correctly inside a flex-grown parent.
const TimeSeriesChart = ({ data }: { data: DataPoint[] }) => {
  const chartData = data.map((d, idx) => ({
    idx,                                   // unique, used as XAxis dataKey
    timeLabel: d.timeLabel,
    score: parseFloat(d.score.toFixed(4)),
    id: d.id,
    isAnomaly: d.isAnomaly,
  }));

  const maxIdx = Math.max(chartData.length - 1, 1);

  return (
    <div style={{
      flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
      background: '#0d1117', padding: '12px 16px 8px',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Activity size={14} color="#58a6ff" />
          <span style={{ color: '#e6edf3', fontSize: 12, fontWeight: 600, letterSpacing: '0.05em' }}>
            ANOMALY SCORE — LIVE FEED
          </span>
          <div style={{
            width: 6, height: 6, borderRadius: '50%', background: '#3fb950',
            boxShadow: '0 0 6px #3fb950', animation: 'pulse 1.5s infinite',
          }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: '#7d8590', fontSize: 10, fontFamily: 'monospace' }}>
            WINDOW: {CHART_WINDOW}s
          </span>
          <span style={{ color: '#7d8590', fontSize: 10, fontFamily: 'monospace' }}>
            SAMPLE: {(1000 / UPDATE_INTERVAL).toFixed(1)}/s
          </span>
        </div>
      </div>

      {/* Chart area — position:relative + absolute inner div is the key fix */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#3b82f6" stopOpacity={0.35} />
                  <stop offset="60%"  stopColor="#3b82f6" stopOpacity={0.1}  />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" stroke="#21262d" vertical={false} />

              {/* FIX: numeric XAxis avoids duplicate-key warning */}
              <XAxis
                dataKey="idx"
                type="number"
                domain={[0, maxIdx]}
                allowDataOverflow
                tickCount={5}
                tickFormatter={(val) => {
                  const pt = chartData[Math.round(val)];
                  return pt?.timeLabel ?? '';
                }}
                tick={{ fill: '#4d5666', fontSize: 9, fontFamily: 'monospace' }}
                axisLine={{ stroke: '#21262d' }}
                tickLine={false}
              />

              <YAxis
                domain={[0, 1]}
                tick={{ fill: '#4d5666', fontSize: 9, fontFamily: 'monospace' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => v.toFixed(1)}
                width={32}
              />

              <Tooltip content={<TimeTooltip />} />

              <ReferenceArea y1={THRESHOLD} y2={1} fill="#ef4444" fillOpacity={0.04} />

              <ReferenceLine
                y={THRESHOLD}
                stroke="#f97316"
                strokeDasharray="5 3"
                strokeWidth={1.5}
                label={{
                  value: `THRESHOLD ${THRESHOLD}`,
                  position: 'insideTopRight',
                  fill: '#f97316',
                  fontSize: 10,
                  fontFamily: 'monospace',
                }}
              />

              <Area
                type="monotone"
                dataKey="score"
                stroke="#3b82f6"
                strokeWidth={1.5}
                fill="url(#areaGradient)"
                dot={<AnomalyDot />}
                activeDot={{ r: 5, fill: '#58a6ff', stroke: '#fff', strokeWidth: 1 }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

// ─── Score Histogram ──────────────────────────────────────────────────────────
// FIX: switch to flexbox layout + position:absolute wrapper for ResponsiveContainer.
const ScoreHistogram = ({ data }: { data: DataPoint[] }) => {
  const histData = useMemo(() => {
    const bins = Array.from({ length: 10 }, (_, i) => {
      const binStart = i * 0.1;
      return {
        range: `${binStart.toFixed(1)}–${((i + 1) * 0.1).toFixed(1)}`,
        rangeShort: binStart.toFixed(1),
        count: 0,
        // Only mark as anomaly if bin is at or above threshold
        isAnomaly: binStart >= THRESHOLD,
      };
    });
    data.forEach(d => {
      const bin = Math.min(9, Math.floor(d.score * 10));
      bins[bin].count++;
    });
    return bins;
  }, [data]);

  return (
    <div style={{
      height: 160, flexShrink: 0,
      background: '#0d1117', borderTop: '1px solid #21262d',
      padding: '8px 16px 6px',
      display: 'flex', flexDirection: 'column',   // flex column to allow chart to fill
    }}>
      {/* Header — fixed height */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        marginBottom: 4, flexShrink: 0,
      }}>
        <span style={{ color: '#7d8590', fontSize: 10, letterSpacing: '0.06em' }}>
          SCORE DISTRIBUTION — DENSITY HISTOGRAM
        </span>
        <span style={{ color: '#7d8590', fontSize: 10, fontFamily: 'monospace' }}>
          (n={data.length})
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 8, height: 8, background: '#3b82f6', borderRadius: 1 }} />
            <span style={{ color: '#7d8590', fontSize: 9 }}>NORMAL</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 8, height: 8, background: '#ef4444', borderRadius: 1 }} />
            <span style={{ color: '#7d8590', fontSize: 9 }}>ANOMALY</span>
          </div>
        </div>
      </div>

      {/* Chart area — flex:1 with position:absolute trick */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={histData} margin={{ top: 2, right: 6, bottom: 0, left: 0 }} barSize={18}>
              <XAxis
                dataKey="rangeShort"
                tick={{ fill: '#4d5666', fontSize: 9, fontFamily: 'monospace' }}
                axisLine={{ stroke: '#21262d' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: '#4d5666', fontSize: 9 }}
                axisLine={false}
                tickLine={false}
                width={24}
              />
              <Tooltip content={<HistTooltip />} />
              <Bar dataKey="count" radius={[2, 2, 0, 0]} isAnimationActive={false}>
                {histData.map((entry, i) => (
                  <Cell
                    key={`hist-cell-${i}`}
                    fill={entry.isAnomaly ? '#ef4444' : '#3b82f6'}
                    fillOpacity={entry.isAnomaly ? 0.8 : 0.6}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

// ─── Alert Log ────────────────────────────────────────────────────────────────
const AlertLog = ({ alerts, flowLog }: { alerts: AlertEntry[]; flowLog: FlowEntry[] }) => {
  const listRef = useRef<HTMLDivElement>(null);
  
  // Deduplicate alerts by flow ID, keeping only most recent
  const uniqueAlerts = useMemo(() => {
    const seenIds = new Set<number>();
    const unique: AlertEntry[] = [];
    for (const alert of alerts) {
      if (!seenIds.has(alert.id)) {
        seenIds.add(alert.id);
        unique.push(alert);
      }
    }
    return unique;
  }, [alerts]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [uniqueAlerts.length]);

  return (
    <div style={{
      width: 300, flexShrink: 0, background: '#0d1117', borderLeft: '1px solid #21262d',
      display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0,
    }}>
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid #21262d', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <AlertTriangle size={12} color="#f85149" />
          <span style={{ color: '#7d8590', fontSize: 10, letterSpacing: '0.08em', fontWeight: 600 }}>
            ALERT LOG
          </span>
        </div>
        <div style={{
          padding: '2px 6px', borderRadius: 3,
          background: uniqueAlerts.length > 0 ? 'rgba(248,81,73,0.15)' : 'rgba(255,255,255,0.05)',
          border: `1px solid ${uniqueAlerts.length > 0 ? 'rgba(248,81,73,0.3)' : '#21262d'}`,
          color: uniqueAlerts.length > 0 ? '#f85149' : '#7d8590', fontSize: 10, fontFamily: 'monospace',
        }}>
          {uniqueAlerts.length}
        </div>
      </div>

      {uniqueAlerts.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <Shield size={28} color="#21262d" />
          <span style={{ color: '#4d5666', fontSize: 11 }}>No anomalies detected</span>
        </div>
      ) : (
        <div
          ref={listRef}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '8px 10px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'stretch',
            gap: 6,
          }}
        >
          {uniqueAlerts.map((alert) => {
            const flow = flowLog.find(f => f.id === alert.id);
            return <AlertCard key={alert.id} alert={alert} flow={flow} />;
          })}
        </div>
      )}
    </div>
  );
};

const AlertCard = ({ alert, flow }: { alert: AlertEntry; flow?: FlowEntry }) => {
  const [expanded, setExpanded] = useState(false);
  const severityLeft: Record<AlertEntry['severity'], string> = {
    low: '#eab308', medium: '#f97316', high: '#ef4444', critical: '#f87171',
  };
  const leftColor = severityLeft[alert.severity];
  const explanation = flow ? generateExplanation(flow) : null;

  return (
    <div style={{
      background: 'rgba(255,255,255,0.02)', border: '1px solid #21262d',
      borderRadius: 6, overflow: 'hidden',
      borderLeft: `3px solid ${leftColor}`,
      minHeight: 132,
      flexShrink: 0,
    }}>
      {/* Main card content */}
      <div style={{ padding: '8px 10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Clock size={9} color="#7d8590" />
            <span style={{ color: '#7d8590', fontSize: 9, fontFamily: 'monospace' }}>
              {formatTime(alert.timestamp)}
            </span>
          </div>
          <SeverityBadge severity={alert.severity} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 5 }}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ color: '#4d5666', fontSize: 9, width: 24 }}>SRC</span>
            <span
              style={{
                color: '#c9d1d9',
                fontSize: 10,
                fontFamily: 'monospace',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
              title={alert.srcIP}
            >
              {alert.srcIP}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <ChevronRight size={10} color="#4d5666" style={{ marginLeft: 22 }} />
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ color: '#4d5666', fontSize: 9, width: 24 }}>DST</span>
            <span
              style={{
                color: '#c9d1d9',
                fontSize: 10,
                fontFamily: 'monospace',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
              title={alert.dstIP}
            >
              {alert.dstIP}
            </span>
          </div>
        </div>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '3px 6px', background: 'rgba(239,68,68,0.06)',
          borderRadius: 3, border: '1px solid rgba(239,68,68,0.12)',
        }}>
          <span style={{ color: '#7d8590', fontSize: 9 }}>SCORE</span>
          <span style={{
            color: leftColor, fontSize: 11, fontWeight: 700, fontFamily: 'monospace',
            textShadow: `0 0 8px ${leftColor}66`,
          }}>
            {alert.score.toFixed(4)}
          </span>
        </div>
      </div>

      {/* Explain toggle button */}
      {explanation && (
        <button
          onClick={() => setExpanded(v => !v)}
          style={{
            width: '100%', padding: '5px 10px',
            background: expanded ? 'rgba(163,113,247,0.08)' : 'rgba(255,255,255,0.02)',
            border: 'none', borderTop: '1px solid #21262d',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            cursor: 'pointer', transition: 'background 0.15s',
          }}
        >
          <span style={{ color: expanded ? '#a371f7' : '#4d5666', fontSize: 9, letterSpacing: '0.06em', fontWeight: 600 }}>
            {expanded ? '▲ HIDE EXPLANATION' : '▼ WHY WAS THIS FLAGGED?'}
          </span>
          <span style={{
            padding: '1px 5px', borderRadius: 2,
            background: 'rgba(163,113,247,0.12)', border: '1px solid rgba(163,113,247,0.25)',
            color: '#a371f7', fontSize: 9, fontFamily: 'monospace',
          }}>
            {explanation.anomalyType}
          </span>
        </button>
      )}

      {/* Compact explanation panel */}
      {expanded && explanation && (
        <div style={{ padding: '8px 10px', borderTop: '1px solid #21262d' }}>
          <ExplanationPanel explanation={explanation} compact />
        </div>
      )}
    </div>
  );
};

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export function IDSDashboard() {
  // State for real backend data
  const [dataPoints, setDataPoints] = useState<DataPoint[]>([]);
  const [alerts, setAlerts] = useState<AlertEntry[]>([]);
    const hashToNumericId = (rawId: string, fallback: number): number => {
      let h = 0;
      for (let i = 0; i < rawId.length; i += 1) {
        h = ((h << 5) - h + rawId.charCodeAt(i)) | 0;
      }
      const v = Math.abs(h);
      return Number.isFinite(v) && v > 0 ? v : fallback;
    };

  const [flowLog, setFlowLog] = useState<FlowEntry[]>([]);
  const [rawEvents, setRawEvents] = useState<any[]>([]);
  const [totalFlows, setTotalFlows] = useState(0);
  const [throughput, setThroughput] = useState(0);
  const [isActive, setIsActive] = useState(true);
  const [stats, setStats] = useState({ avg: 0, peak: 0, anomalyCount: 0, benignCount: 0, total: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [backendStats, setBackendStats] = useState<DashboardStats | null>(null);

  // Fetch data from backend
  const fetchData = async () => {
    try {
      const [statsData, eventsData] = await Promise.all([
        graphIdsApi.getStats(),
        graphIdsApi.getEvents(100),
      ]);
      setRawEvents(eventsData);

      // Update dashboard stats
      setTotalFlows(statsData.total_flows_processed);
      setBackendStats(statsData);

      // Transform backend events to frontend data types.
      // Detection state must come from backend labels, not frontend score heuristics.
      const points: DataPoint[] = eventsData.map(event => ({
        id: event.flow_id,
        time: new Date(event.timestamp * 1000),
        timeLabel: new Date(event.timestamp * 1000).toLocaleTimeString('en-US', {
          hour12: false,
          minute: '2-digit',
          second: '2-digit',
        }),
        score: event.score,
        isAnomaly: event.label === 1,
        srcIP: event.src_ip,
        dstIP: event.dst_ip,
        flowId: event.flow_id,
      }));

      // Keep only recent dataPoints (last 60 for the chart)
      setDataPoints(prev => {
        const combined = [...points, ...prev];
        const unique = Array.from(new Map(combined.map(p => [p.id, p])).values());
        return unique.slice(-CHART_WINDOW);
      });

      // Extract anomalies as alerts
      const newAlerts: AlertEntry[] = points
        .filter(p => p.isAnomaly)
        .map((p, idx) => {
          const sourceEvent = eventsData.find((e) => e.flow_id === p.id);
          const severity: AlertEntry['severity'] = sourceEvent?.severity ?? 'low';

          return {
            id: hashToNumericId(String(p.id), idx + 1),
            timestamp: p.time,
            srcIP: p.srcIP || 'Unknown',
            dstIP: p.dstIP || 'Unknown',
            score: p.score,
            severity,
            acknowledged: false,
          };
        });

      setAlerts(prev => {
        const combined = [...newAlerts, ...prev];
        const unique = Array.from(new Map(combined.map(a => [a.id, a])).values());
        return unique.slice(0, 100); // Keep last 100 alerts
      });

      const flowEntries: FlowEntry[] = eventsData.map((event, idx) => {
        let protocol: 'TCP' | 'UDP' | 'ICMP' | 'HTTP' | 'HTTPS' | 'DNS' = 'TCP';
        const proto = event.protocol ?? 6;
        if (proto === 17) protocol = 'UDP';
        else if (proto === 1) protocol = 'ICMP';
        else if (proto === 6) {
          if (event.src_port === 443 || event.dst_port === 443) protocol = 'HTTPS';
          else if (event.src_port === 80 || event.dst_port === 80) protocol = 'HTTP';
          else if (event.src_port === 53 || event.dst_port === 53) protocol = 'DNS';
        }

        return {
          id: idx,
          flowId: event.flow_id,
          timestamp: new Date(event.timestamp * 1000),
          srcIP: event.src_ip,
          dstIP: event.dst_ip,
          srcPort: event.src_port,
          dstPort: event.dst_port,
          protocol,
          packetCount: event.packets ?? 0,
          byteCount: event.bytes ?? 0,
          duration: event.duration_ms ?? 0,
          score: event.score,
          isAnomaly: event.label === 1,
          predictedLabel: event.label === 1 ? 1 : 0,
          groundTruthLabel: event.ground_truth_label ?? null,
          severity: event.severity ?? 'low',
          embX: (Math.random() - 0.5) * 4,
          embY: (Math.random() - 0.5) * 4,
        };
      });
      setFlowLog(flowEntries);

      // Calculate statistics
      if (points.length > 0) {
        const recent = points.slice(-CHART_WINDOW);
        const avg = recent.reduce((a, b) => a + b.score, 0) / recent.length;
        const peak = Math.max(...recent.map(d => d.score));
        const anomalyCount = recent.filter(d => d.isAnomaly).length;
        const benignCount = recent.length - anomalyCount;

        setStats({ avg, peak, anomalyCount, benignCount, total: recent.length });
      }

      // Estimate throughput (flows per second)
      if (eventsData.length > 0) {
        const avgProcessingTime = eventsData.reduce((a, b) => a + b.processing_time_ms, 0) / eventsData.length;
        setThroughput(eventsData.length / 2); // Approximate (polls every 2 seconds)
      }

      setError(null);
      setIsLoading(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch dashboard data';
      setError(message);
      console.error('Dashboard fetch error:', err);
      setIsLoading(false);
    }
  };

  // Poll backend every 2 seconds
  useEffect(() => {
    fetchData(); // Initial fetch

    const interval = setInterval(fetchData, 2000); // Poll every 2 seconds

    return () => clearInterval(interval);
  }, []);

  const toggleActive = () => {
    setIsActive(!isActive);
  };

  // Show loading or error state if needed
  if (isLoading && dataPoints.length === 0) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0d1117',
        color: '#e6edf3',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 20, marginBottom: 10 }}>Connecting to backend...</div>
          <div style={{ color: '#7d8590', fontSize: 14 }}>Loading real-time data from GraphIDS</div>
        </div>
      </div>
    );
  }

  if (error && dataPoints.length === 0) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0d1117',
        color: '#f85149',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 20, marginBottom: 10 }}>⚠️ Connection Error</div>
          <div style={{ color: '#f97316', fontSize: 14, marginBottom: 10 }}>{error}</div>
          <div style={{ color: '#7d8590', fontSize: 12 }}>Ensure backend is running: python serve.py</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      background: '#0d1117',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      overflow: 'hidden',
    }}>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0d1117; }
        ::-webkit-scrollbar-thumb { background: #30363d; border-radius: 2px; }
        ::-webkit-scrollbar-thumb:hover { background: #484f58; }
      `}</style>

      {/* Status Bar */}
      <StatusBar
        isActive={isActive}
        throughput={throughput}
        totalFlows={totalFlows}
        anomalyCount={alerts.length}
        onToggle={toggleActive}
      />

      {/* Main Content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {/* Left: Stats Panel */}
        <StatsPanel
          avgScore={stats.avg}
          peakScore={stats.peak}
          benignCount={stats.benignCount}
          anomalyCount={stats.anomalyCount}
          totalRecent={stats.total}
          recentData={dataPoints}
        />

        {/* Center: Charts */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflowY: 'auto' }}>
          <HeartbeatChart data={dataPoints} />
          <ScoreHistogram data={dataPoints} />
          <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <AttackTimeline threshold={backendStats?.retraining_threshold_fpr ?? 0.35} />
            <TopTalkers
              flows={rawEvents.map((e) => ({
                src_ip: e.src_ip,
                dst_ip: e.dst_ip,
                dst_port: e.dst_port,
                label: e.label,
                score: e.score,
              }))}
            />
            <ProtocolBreakdown
              flows={rawEvents.map((e) => ({
                protocol: e.protocol ?? 6,
                label: e.label,
              }))}
            />
          </div>
        </div>

        {/* Right: Alert Log — flowLog is passed so each card can look up its flow for explanation */}
        <AlertLog alerts={alerts} flowLog={flowLog} />
      </div>
    </div>
  );
}