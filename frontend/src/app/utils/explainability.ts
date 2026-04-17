/**
 * Explainability engine for NETGUARD IDS.
 */

import type { FlowEntry, FeatureContribution, FlowExplanation } from '../types';
import { formatBytes } from '../context/SimulationContext';

// Standard ports considered "expected" in normal traffic
const STANDARD_PORTS = [80, 443, 22, 21, 25, 53, 3306, 8080, 8443, 3389, 6379, 5432];

// ─── Deterministic seeded random (no dependency on Math.random state) ────────
function sr(seed: number, salt: number): number {
  const x = Math.sin(seed * 9301 + salt * 49297 + 12345) * 233280;
  return x - Math.floor(x);
}

// ─── Expected baseline values (normalised 0–1) ────────────────────────────────
// These represent the "learned" normal-traffic distribution from the autoencoder.
// Max values used for normalisation come from the simulation's generation ranges.
const B = {
  byteCount:   { max: 1_500_000, mean: 0.12, std: 0.20 }, // ~180 KB typical
  packetCount: { max: 500,       mean: 0.10, std: 0.15 }, // ~50 pkts typical
  duration:    { max: 10_000,    mean: 0.45, std: 0.28 }, // ~4.5 s typical
  pktSize:     { max: 3_000,     mean: 0.32, std: 0.22 }, // ~960 B/pkt typical
  byteRate:    { max: 150,       mean: 0.15, std: 0.20 }, // ~22 B/ms typical
};

function zscore(norm: number, mean: number, std: number): number {
  return Math.min(1, Math.abs(norm - mean) / Math.max(0.01, std));
}

// ─── Main export ──────────────────────────────────────────────────────────────
export function generateExplanation(flow: FlowEntry): FlowExplanation {
  const avgPktSize = flow.byteCount / Math.max(1, flow.packetCount);
  const byteRateVal = flow.byteCount / Math.max(1, flow.duration); // bytes/ms

  // Normalised feature values
  const normByte   = Math.min(1, flow.byteCount   / B.byteCount.max);
  const normPkt    = Math.min(1, flow.packetCount / B.packetCount.max);
  const normDur    = Math.min(1, flow.duration    / B.duration.max);
  const normPktSz  = Math.min(1, avgPktSize       / B.pktSize.max);
  const normBRate  = Math.min(1, byteRateVal      / B.byteRate.max);
  const isUncommon = !STANDARD_PORTS.includes(flow.dstPort);

  // Raw "surprise" per feature — how many std devs from the normal mean
  const surprises: [string, number][] = [
    ['byte_volume',   zscore(normByte,  B.byteCount.mean,   B.byteCount.std)   * (0.55 + sr(flow.id, 1) * 0.40)],
    ['packet_count',  zscore(normPkt,   B.packetCount.mean, B.packetCount.std) * (0.40 + sr(flow.id, 2) * 0.40)],
    ['duration',      zscore(normDur,   B.duration.mean,    B.duration.std)    * (0.40 + sr(flow.id, 3) * 0.40)],
    ['pkt_size',      zscore(normPktSz, B.pktSize.mean,     B.pktSize.std)     * (0.30 + sr(flow.id, 4) * 0.40)],
    ['byte_rate',     zscore(normBRate, B.byteRate.mean,     B.byteRate.std)   * (0.35 + sr(flow.id, 5) * 0.40)],
    ['port_access',   (isUncommon ? 0.55 : 0.05)                               * (0.70 + sr(flow.id, 6) * 0.30)],
  ];

  // Scale so total contribution sums to ≈ anomaly score
  const rawTotal = surprises.reduce((s, [, v]) => s + v, 0);
  const scale    = (flow.score * 0.92) / Math.max(0.001, rawTotal);

  const features: FeatureContribution[] = surprises.map(([feat, raw]) => {
    const contribution = Math.min(flow.score * 0.65, raw * scale);
    return buildContrib(feat, contribution, flow, {
      avgPktSize, byteRateVal, normByte, normPkt,
      normDur, normPktSz, normBRate, isUncommon,
    });
  });

  features.sort((a, b) => b.contribution - a.contribution);
  const top = features.slice(0, 5);

  // ─── Anomaly classification ───────────────────────────────────────────────
  const primary = top[0].feature;
  let anomalyType: string;
  let primaryReason: string;

  if (primary === 'byte_volume' && normByte > B.byteCount.mean) {
    anomalyType   = normByte > 0.6 ? 'Data Exfiltration' : 'Suspicious Transfer';
    primaryReason = `${formatBytes(flow.byteCount)} transferred — ${(normByte / B.byteCount.mean).toFixed(1)}× above baseline volume`;
  } else if (primary === 'byte_rate' && normBRate > B.byteRate.mean) {
    anomalyType   = 'High-Rate Data Transfer';
    primaryReason = `${(byteRateVal * 1_000).toFixed(0)} B/s sustained — ${(normBRate / B.byteRate.mean).toFixed(1)}× expected transfer rate`;
  } else if (primary === 'packet_count' && normPkt > B.packetCount.mean * 1.5) {
    anomalyType   = 'Flood / DDoS Indicator';
    primaryReason = `${flow.packetCount} packets sent — ${(normPkt / B.packetCount.mean).toFixed(1)}× expected packet count`;
  } else if (primary === 'duration' && normDur < B.duration.mean * 0.35) {
    anomalyType   = 'Network / Port Scan';
    primaryReason = `Connection lasted only ${flow.duration} ms — indicative of automated probe or sweep`;
  } else if (primary === 'duration' && normDur > B.duration.mean * 1.6) {
    anomalyType   = 'Persistent Connection';
    primaryReason = `Connection held for ${(flow.duration / 1_000).toFixed(1)} s — ${(normDur / B.duration.mean).toFixed(1)}× typical session length`;
  } else if (primary === 'port_access' && isUncommon) {
    anomalyType   = 'Unauthorized Service Access';
    primaryReason = `Port ${flow.dstPort}/${flow.protocol} is outside the standard service catalogue`;
  } else if (primary === 'pkt_size') {
    anomalyType   = normPktSz > B.pktSize.mean ? 'Large-Payload Attack' : 'Fragmented / Malformed Packets';
    primaryReason = `Avg packet size ${Math.round(avgPktSize)} B — ${Math.abs((normPktSz / B.pktSize.mean - 1) * 100).toFixed(0)}% ${normPktSz > B.pktSize.mean ? 'above' : 'below'} baseline`;
  } else {
    anomalyType   = 'Behavioural Anomaly';
    primaryReason = top[0].description;
  }

  return {
    anomalyType,
    primaryReason,
    confidence: Math.min(0.99, 0.52 + flow.score * 0.48),
    reconstructionError: flow.score,
    topFeatures: top,
  };
}

// ─── Feature contribution builder ────────────────────────────────────────────
function buildContrib(
  feature: string,
  contribution: number,
  flow: FlowEntry,
  ctx: {
    avgPktSize: number; byteRateVal: number;
    normByte: number; normPkt: number; normDur: number;
    normPktSz: number; normBRate: number; isUncommon: boolean;
  },
): FeatureContribution {
  const { avgPktSize, byteRateVal, normByte, normPkt, normDur, normPktSz, normBRate, isUncommon } = ctx;

  switch (feature) {
    case 'byte_volume': {
      const E = B.byteCount.mean;
      return {
        feature, label: 'Transfer Volume',
        normalizedValue: normByte, expectedValue: E,
        contribution,
        direction: normByte > E ? 'high' : 'low',
        description: `${formatBytes(flow.byteCount)} transferred (expected ≈ ${formatBytes(Math.round(E * B.byteCount.max))})`,
      };
    }
    case 'packet_count': {
      const E = B.packetCount.mean;
      return {
        feature, label: 'Packet Count',
        normalizedValue: normPkt, expectedValue: E,
        contribution,
        direction: normPkt > E ? 'high' : 'low',
        description: `${flow.packetCount} pkts (expected ≈ ${Math.round(E * B.packetCount.max)})`,
      };
    }
    case 'duration': {
      const E = B.duration.mean;
      return {
        feature, label: 'Flow Duration',
        normalizedValue: normDur, expectedValue: E,
        contribution,
        direction: normDur > E ? 'high' : 'low',
        description: `${flow.duration} ms duration (expected ≈ ${Math.round(E * B.duration.max)} ms)`,
      };
    }
    case 'pkt_size': {
      const E = B.pktSize.mean;
      return {
        feature, label: 'Avg Packet Size',
        normalizedValue: normPktSz, expectedValue: E,
        contribution,
        direction: normPktSz > E ? 'high' : 'low',
        description: `${Math.round(avgPktSize)} B/pkt (expected ≈ ${Math.round(E * B.pktSize.max)} B)`,
      };
    }
    case 'byte_rate': {
      const E = B.byteRate.mean;
      return {
        feature, label: 'Transfer Rate',
        normalizedValue: normBRate, expectedValue: E,
        contribution,
        direction: normBRate > E ? 'high' : 'low',
        description: `${(byteRateVal * 1_000).toFixed(1)} B/s  (expected ≈ ${Math.round(E * B.byteRate.max * 1_000)} B/s)`,
      };
    }
    case 'port_access': {
      return {
        feature, label: 'Destination Port',
        normalizedValue: isUncommon ? 0.88 : 0.12, expectedValue: 0.12,
        contribution,
        direction: 'unusual',
        description: `Port ${flow.dstPort}/${flow.protocol} — ${isUncommon ? 'non-standard service' : 'standard port, anomalous usage pattern'}`,
      };
    }
    default:
      return {
        feature, label: feature,
        normalizedValue: 0.5, expectedValue: 0.2,
        contribution,
        direction: 'unusual',
        description: 'Anomalous pattern detected',
      };
  }
}