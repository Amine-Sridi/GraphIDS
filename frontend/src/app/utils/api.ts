/**
 * API Client for GraphIDS Backend
 * Handles all HTTP communication with the FastAPI server
 */

import type { DataPoint, AlertEntry } from '../types';

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
  confidence: number;        // 0.0 - 1.0
  window_id: number;
  processing_time_ms: number;
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
}

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: number;
  uptime: number;
  message?: string;
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
  const score = result.score;

  // Determine severity based on score
  let severity: AlertEntry['severity'];
  if (score >= 0.95) severity = 'critical';
  else if (score >= 0.85) severity = 'high';
  else if (score >= 0.75) severity = 'medium';
  else severity = 'low';

  return {
    id: parseInt(result.flow_id.split('_')[1] || '0', 10),
    timestamp: date,
    srcIP: result.src_ip,
    dstIP: result.dst_ip,
    score: result.score,
    severity,
    acknowledged: false,
  };
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
