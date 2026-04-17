/**
 * ExplanationPanel — shows why a flow was flagged as an anomaly.
 */

import type { FlowExplanation, FeatureContribution } from '../../types';

interface Props {
  explanation: FlowExplanation;
  compact?: boolean; // trimmed 3-feature version for sidebars / alert cards
}

// ─── Direction colours ────────────────────────────────────────────────────────
const DIR_COLOR: Record<FeatureContribution['direction'], string> = {
  high:    '#f97316',   // orange-red  — value above baseline
  low:     '#58a6ff',   // blue        — value below baseline
  unusual: '#a371f7',   // purple      — qualitatively different
};

const DIR_LABEL: Record<FeatureContribution['direction'], string> = {
  high:    '▲ HIGH',
  low:     '▼ LOW',
  unusual: '◆ UNUSUAL',
};

// ─── Anomaly-type colour mapping ──────────────────────────────────────────────
function typeColor(t: string): { bg: string; border: string; text: string } {
  if (/exfil|transfer|payload/i.test(t))    return { bg: 'rgba(239,68,68,0.12)',    border: 'rgba(239,68,68,0.4)',    text: '#fca5a5' };
  if (/flood|ddos/i.test(t))                return { bg: 'rgba(249,115,22,0.12)',   border: 'rgba(249,115,22,0.4)',   text: '#fdba74' };
  if (/scan|sweep/i.test(t))                return { bg: 'rgba(234,179,8,0.12)',    border: 'rgba(234,179,8,0.4)',    text: '#fde68a' };
  if (/unauthori|access/i.test(t))          return { bg: 'rgba(163,113,247,0.12)',  border: 'rgba(163,113,247,0.4)', text: '#c4b5fd' };
  if (/persistent|connect/i.test(t))        return { bg: 'rgba(88,166,255,0.12)',   border: 'rgba(88,166,255,0.4)',   text: '#93c5fd' };
  return                                           { bg: 'rgba(248,81,73,0.10)',    border: 'rgba(248,81,73,0.35)',   text: '#fca5a5' };
}

// ─── Confidence gauge ─────────────────────────────────────────────────────────
const ConfidenceGauge = ({ value }: { value: number }) => {
  const pct = Math.round(value * 100);
  const color = pct >= 85 ? '#ef4444' : pct >= 70 ? '#f97316' : '#eab308';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 52, height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      <span style={{ color, fontSize: 10, fontFamily: 'monospace', fontWeight: 700 }}>{pct}%</span>
    </div>
  );
};

// ─── Feature contribution row ─────────────────────────────────────────────────
const FeatureRow = ({ f, maxContrib }: { f: FeatureContribution; maxContrib: number }) => {
  const color    = DIR_COLOR[f.direction];
  const barPct   = Math.min(100, (f.normalizedValue / 1) * 100);
  const expPct   = Math.min(100, (f.expectedValue  / 1) * 100);
  const relWidth = maxContrib > 0 ? (f.contribution / maxContrib) * 100 : 0;

  return (
    <div style={{ marginBottom: 10 }}>
      {/* Label row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ color: '#c9d1d9', fontSize: 11 }}>{f.label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Contribution share */}
          <span style={{ color: '#7d8590', fontSize: 10, fontFamily: 'monospace' }}>
            {(f.contribution * 100).toFixed(1)}%
          </span>
          {/* Direction badge */}
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
            color, fontFamily: 'monospace',
          }}>
            {DIR_LABEL[f.direction]}
          </span>
        </div>
      </div>

      {/* Stacked bar: actual value */}
      <div style={{ position: 'relative', height: 7, background: 'rgba(255,255,255,0.05)', borderRadius: 3 }}>
        {/* Actual value fill */}
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${barPct}%`,
          background: `linear-gradient(90deg, ${color}cc, ${color}66)`,
          borderRadius: 3,
          transition: 'width 0.4s ease',
        }} />
        {/* Contribution intensity overlay */}
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${relWidth}%`,
          background: `${color}33`,
          borderRadius: 3,
          border: `1px solid ${color}44`,
        }} />
        {/* Expected baseline marker */}
        <div style={{
          position: 'absolute', top: -1, bottom: -1,
          left: `${expPct}%`,
          width: 1.5,
          background: 'rgba(255,255,255,0.45)',
          borderRadius: 1,
        }} />
      </div>

      {/* Expected marker label */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
        <span style={{ color: '#4d5666', fontSize: 9 }}>{f.description}</span>
        <span style={{ color: '#4d5666', fontSize: 9 }}>
          ┊ baseline {Math.round(f.expectedValue * 100)}%
        </span>
      </div>
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────
export function ExplanationPanel({ explanation: ex, compact = false }: Props) {
  const tc      = typeColor(ex.anomalyType);
  const features = compact ? ex.topFeatures.slice(0, 3) : ex.topFeatures;
  const maxC    = features[0]?.contribution ?? 1;

  return (
    <div style={{
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid #21262d',
      borderLeft: `3px solid ${tc.border}`,
      borderRadius: 6,
      padding: compact ? '10px 12px' : '14px 16px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* ── Header: anomaly type + confidence ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            padding: '2px 8px', borderRadius: 3,
            background: tc.bg, border: `1px solid ${tc.border}`,
            color: tc.text, fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
            fontFamily: 'monospace', whiteSpace: 'nowrap',
          }}>
            {ex.anomalyType.toUpperCase()}
          </span>
          {!compact && (
            <span style={{ color: '#4d5666', fontSize: 10, letterSpacing: '0.05em' }}>CONFIDENCE</span>
          )}
        </div>
        <ConfidenceGauge value={ex.confidence} />
      </div>

      {/* ── Primary reason ── */}
      <div style={{
        padding: '6px 10px',
        background: 'rgba(248,81,73,0.05)',
        border: '1px solid rgba(248,81,73,0.12)',
        borderRadius: 4,
        marginBottom: 12,
      }}>
        <span style={{ color: '#7d8590', fontSize: 9, letterSpacing: '0.06em' }}>PRIMARY TRIGGER  </span>
        <span style={{ color: '#e6edf3', fontSize: 11 }}>{ex.primaryReason}</span>
      </div>

      {/* ── Feature contributions ── */}
      <div style={{ marginBottom: 2 }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 8,
        }}>
          <span style={{ color: '#4d5666', fontSize: 9, letterSpacing: '0.08em' }}>
            RECONSTRUCTION ERROR — FEATURE CONTRIBUTIONS
          </span>
          <span style={{ color: '#4d5666', fontSize: 9 }}>
            ┊ = expected baseline
          </span>
        </div>

        {features.map(f => (
          <FeatureRow key={f.feature} f={f} maxContrib={maxC} />
        ))}
      </div>

      {/* ── Reconstruction error total ── */}
      {!compact && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          paddingTop: 8, borderTop: '1px solid #21262d',
          marginTop: 4,
        }}>
          <span style={{ color: '#4d5666', fontSize: 10 }}>Total reconstruction error</span>
          <span style={{
            color: tc.text, fontSize: 12, fontWeight: 700, fontFamily: 'monospace',
            textShadow: `0 0 8px ${tc.border}`,
          }}>
            {ex.reconstructionError.toFixed(4)}
          </span>
        </div>
      )}
    </div>
  );
}