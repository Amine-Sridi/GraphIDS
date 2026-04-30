export interface DataPoint {
  id: number | string;
  time: Date;
  timeLabel: string;
  score: number;
  isAnomaly: boolean;
  srcIP?: string;
  dstIP?: string;
}

export interface AlertEntry {
  id: number;
  timestamp: Date;
  srcIP: string;
  dstIP: string;
  score: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  acknowledged: boolean;
}

export type Protocol = 'TCP' | 'UDP' | 'ICMP' | 'HTTP' | 'HTTPS' | 'DNS';

export interface FlowEntry {
  id: number;
  flowId: string;
  timestamp: Date;
  srcIP: string;
  dstIP: string;
  srcPort: number;
  dstPort: number;
  protocol: Protocol;
  packetCount: number;
  byteCount: number;
  duration: number;
  score: number;
  isAnomaly: boolean;
  predictedLabel: 0 | 1;
  groundTruthLabel: 0 | 1 | null;
  severity: 'low' | 'medium' | 'high' | 'critical';
  embX: number;
  embY: number;
}

export interface User {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'analyst';
  lastLogin: Date;
}

// ─── Explainability ───────────────────────────────────────────────────────────

export interface FeatureContribution {
  feature: string;
  label: string;
  /** 0–1: actual value normalised to its max range */
  normalizedValue: number;
  /** 0–1: expected "normal-traffic" baseline value */
  expectedValue: number;
  /** 0–1: share of the total reconstruction error attributed to this feature */
  contribution: number;
  direction: 'high' | 'low' | 'unusual';
  description: string;
}

export interface FlowExplanation {
  anomalyType: string;
  primaryReason: string;
  confidence: number;
  reconstructionError: number;
  topFeatures: FeatureContribution[];
}