/**
 * API Client for GraphIDS Backend
 * Handles all HTTP communication with the FastAPI server
 */

import type { DataPoint, AlertEntry } from '../types';

export interface TimelinePoint {
  timestamp: number;
  score: number;
  label: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

// ─── Types ──────────────────────────────────────────────────────────────────
export interface ClassificationResult {
  flow_id: string;
  timestamp: number;         // Unix timestamp in seconds
  src_ip: string;
  dst_ip: string;
  src_port: number;
  dst_port: number;
  score: number;             // 0.0 - 1.0
  label: number;             // 0=benign, 1=anomalous
  severity: 'critical' | 'high' | 'medium' | 'low';
  confidence: number;        // 0.0 - 1.0
  window_id: number;
  processing_time_ms: number;
  ground_truth_label?: number | null;
  protocol?: number;
  bytes?: number;
  packets?: number;
  duration_ms?: number;
}

export interface DashboardStats {
  total_flows_processed: number;
  total_anomalies_detected: number;
  anomaly_rate: number;
  avg_anomaly_score: number;
  current_window_id: number;
  model_version: string;
  uptime_seconds: number;
  node_count: number;
  buffer_size: number;
  // Performance metrics (FPR monitoring)
  true_positives: number;
  false_positives: number;
  true_negatives: number;
  false_negatives: number;
  fpr: number;  // False Positive Rate
  tpr: number;  // True Positive Rate
  precision: number;
  f1_score: number;
  retraining_threshold_fpr?: number;
  should_retrain: boolean;
  windowed_fpr: number;
  windowed_tpr: number;
  windowed_precision: number;
  windowed_f1: number;
  windowed_window_sec: number;
  windowed_event_count: number;
  alert_active: boolean;
  alert_triggered_at: number | null;
  alert_fpr_value: number | null;
  alert_threshold: number | null;
}

export interface AlertStatus {
  alert_active: boolean;
  alert_triggered_at: number | null;
  alert_fpr_value: number | null;
  alert_threshold: number | null;
  windowed_fpr: number;
  windowed_stats: {
    window_sec: number;
    window_event_count: number;
    tp: number;
    fp: number;
    tn: number;
    fn: number;
    fpr: number;
    tpr: number;
    precision: number;
    f1: number;
  };
  message: string | null;
  recent_alerts: Array<{
    alert_id: string;
    triggered_at: number;
    windowed_fpr: number;
    threshold: number;
  }>;
}

export interface FlowSubgraph {
  flow_id: string;
  center_ips: string[];
  nodes: Array<{ id: string; label: string; hop: number; is_center?: boolean }>;
  edges: Array<{ source: string; target: string; ground_truth?: number | null }>;
  node_count: number;
  edge_count: number;
}

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: number;
  uptime: number;
  message?: string;
}

export interface StreamControlState {
  is_active: boolean;
  ingestion_rate: number;
  updated_at: number;
}

// ─── API Client ─────────────────────────────────────────────────────────────

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const API_TIMEOUT = parseInt(import.meta.env.VITE_API_TIMEOUT || '5000', 10);

/**
 * Helper function to fetch with timeout
 */
async function fetchWithTimeout(url: string, options?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Transforms backend ClassificationResult to frontend DataPoint
 */
function transformToDataPoint(result: ClassificationResult): DataPoint {
  const date = new Date(result.timestamp * 1000);
  return {
    id: result.flow_id,
    time: date,
    timeLabel: date.toLocaleTimeString('en-US', {
      hour12: false,
      minute: '2-digit',
      second: '2-digit',
    }),
    score: result.score,
    isAnomaly: result.label === 1,
    srcIP: result.src_ip,
    dstIP: result.dst_ip,
  };
}

/**
 * Transforms backend ClassificationResult to frontend AlertEntry
 */
function transformToAlertEntry(result: ClassificationResult): AlertEntry {
  const date = new Date(result.timestamp * 1000);
  const id = flowIdToNumeric(result.flow_id, 0);

  return {
    id,
    timestamp: date,
    srcIP: result.src_ip,
    dstIP: result.dst_ip,
    score: result.score,
    severity: result.severity,
    acknowledged: false,
  };
}

function flowIdToNumeric(flowId: string, fallback: number): number {
  const parsed = parseInt(flowId, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  let hash = 0;
  for (let i = 0; i < flowId.length; i += 1) {
    hash = ((hash << 5) - hash + flowId.charCodeAt(i)) | 0;
  }

  const value = Math.abs(hash);
  return value > 0 ? value : fallback;
}

// ─── Public API Methods ──────────────────────────────────────────────────────

export const graphIdsApi = {
  /**
   * Check backend health status
   */
  async getHealth(): Promise<HealthResponse> {
    try {
      const response = await fetchWithTimeout(`${API_BASE_URL}/health`);
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Health check error:', error);
      throw error;
    }
  },

  /**
   * Get dashboard statistics from backend
   */
  async getStats(): Promise<DashboardStats> {
    try {
      const response = await fetchWithTimeout(`${API_BASE_URL}/stats`);
      if (!response.ok) {
        throw new Error(`Failed to fetch stats: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching stats:', error);
      throw error;
    }
  },

  /**
   * Get recent classification events from backend
   */
  async getEvents(limit = 100, minScore = 0): Promise<ClassificationResult[]> {
    try {
      const params = new URLSearchParams({
        limit: limit.toString(),
        min_score: minScore.toString(),
      });
      const response = await fetchWithTimeout(`${API_BASE_URL}/events?${params}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch events: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching events:', error);
      throw error;
    }
  },

  /**
   * Get recent events transformed as DataPoints for the chart
   */
  async getDataPoints(limit = 100): Promise<DataPoint[]> {
    try {
      const events = await this.getEvents(limit);
      return events.map(transformToDataPoint);
    } catch (error) {
      console.error('Error getting data points:', error);
      throw error;
    }
  },

  /**
   * Get anomalies only, transformed as AlertEntries
   */
  async getAnomalies(limit = 100): Promise<AlertEntry[]> {
    try {
      const events = await this.getEvents(limit, 0.65); // Only anomalies above threshold
      return events
        .filter((e) => e.label === 1) // Only anomalous flows
        .map(transformToAlertEntry)
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    } catch (error) {
      console.error('Error getting anomalies:', error);
      throw error;
    }
  },

  async getAlertStatus(): Promise<AlertStatus> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/alert`);
    if (!response.ok) {
      throw new Error(`Failed to fetch alert status: ${response.status}`);
    }
    return response.json();
  },

  async acknowledgeAlert(): Promise<{ status: string; message: string }> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/alert/acknowledge`, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error(`Failed to acknowledge alert: ${response.status}`);
    }
    return response.json();
  },

  async setAlertThreshold(thresholdFpr: number, windowSec = 300): Promise<void> {
    const response = await fetchWithTimeout(
      `${API_BASE_URL}/alert/threshold?threshold_fpr=${thresholdFpr}&window_sec=${windowSec}`,
      { method: 'POST' }
    );
    if (!response.ok) {
      throw new Error(`Failed to set alert threshold: ${response.status}`);
    }
  },

  async getTimelineData(limit = 200): Promise<TimelinePoint[]> {
    const events = await this.getEvents(limit);
    return events.map((e) => ({
      timestamp: e.timestamp,
      score: e.score,
      label: e.label,
      severity: e.severity,
    }));
  },

  async getSubgraph(flowId: string): Promise<FlowSubgraph> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/subgraph/${flowId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch subgraph for flow ${flowId}: ${response.status}`);
    }
    return response.json();
  },

  /**
   * Set the FPR (False Positive Rate) threshold for retraining
   */
  async setRetrainingThreshold(thresholdFpr: number): Promise<any> {
    try {
      const response = await fetchWithTimeout(
        `${API_BASE_URL}/retraining-threshold?threshold_fpr=${thresholdFpr}`,
        { method: 'POST' }
      );
      if (!response.ok) {
        throw new Error(`Failed to set retraining threshold: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error setting retraining threshold:', error);
      throw error;
    }
  },

  /**
   * Get the current FPR retraining threshold
   */
  async getRetrainingThreshold(): Promise<any> {
    try {
      const response = await fetchWithTimeout(`${API_BASE_URL}/retraining-threshold`);
      if (!response.ok) {
        throw new Error(`Failed to fetch retraining threshold: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching retraining threshold:', error);
      throw error;
    }
  },

  /**
   * Get current stream control state (active/rate)
   */
  async getStreamControl(): Promise<StreamControlState> {
    try {
      const response = await fetchWithTimeout(`${API_BASE_URL}/stream-control`);
      if (!response.ok) {
        throw new Error(`Failed to fetch stream control: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching stream control:', error);
      throw error;
    }
  },

  /**
   * Update stream control state
   */
  async updateStreamControl(params: { is_active?: boolean; ingestion_rate?: number }): Promise<StreamControlState> {
    try {
      const searchParams = new URLSearchParams();
      if (typeof params.is_active === 'boolean') {
        searchParams.set('is_active', String(params.is_active));
      }
      if (typeof params.ingestion_rate === 'number') {
        searchParams.set('ingestion_rate', String(params.ingestion_rate));
      }

      const response = await fetchWithTimeout(
        `${API_BASE_URL}/stream-control?${searchParams.toString()}`,
        { method: 'POST' }
      );
      if (!response.ok) {
        throw new Error(`Failed to update stream control: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error updating stream control:', error);
      throw error;
    }
  },

  async resetStats(): Promise<{ status: string; message: string }> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/reset`, { method: 'POST' });
    if (!response.ok) {
      throw new Error(`Failed to reset stats: ${response.status}`);
    }
    return response.json();
  },

  async startStream(): Promise<{ status: string; message: string; pid?: number }> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/stream/start`, { method: 'POST' });
    if (!response.ok) {
      throw new Error(`Failed to start stream: ${response.status}`);
    }
    return response.json();
  },

  async stopStream(): Promise<{ status: string; message: string }> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/stream/stop`, { method: 'POST' });
    if (!response.ok) {
      throw new Error(`Failed to stop stream: ${response.status}`);
    }
    return response.json();
  },
};

/**
 * Helper function to check if backend is available
 */
export async function isBackendAvailable(): Promise<boolean> {
  try {
    await graphIdsApi.getHealth();
    return true;
  } catch {
    return false;
  }
}

/**
 * Get configured API base URL (useful for debugging)
 */
export function getApiBaseUrl(): string {
  return API_BASE_URL;
}
