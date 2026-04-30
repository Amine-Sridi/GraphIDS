/**
 * BackendContext - Centralized real data from GraphIDS API
 * Replaces SimulationContext for all pages in the app
 */

import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { graphIdsApi, type DashboardStats } from '../utils/api';
import type { DataPoint, AlertEntry, FlowEntry } from '../types';

interface BackendContextType {
  // Connection status
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;

  // Data
  dataPoints: DataPoint[];
  alerts: AlertEntry[];
  flowLog: FlowEntry[];
  stats: DashboardStats | null;
  
  // Derived stats
  totalFlows: number;
  throughput: number;
  aggregatedStats: {
    avg: number;
    peak: number;
    anomalyCount: number;
    benignCount: number;
    total: number;
  };

  // Control
  isActive: boolean;
  ingestionRate: number;
  toggleActive: () => Promise<void>;
  setIngestionRate: (rate: number) => Promise<void>;
}

const BackendContext = createContext<BackendContextType | null>(null);

export function useBackend() {
  const ctx = useContext(BackendContext);
  if (!ctx) throw new Error('useBackend must be inside BackendProvider');
  return ctx;
}

const CHART_WINDOW = 60;
const POLLING_INTERVAL = 2000; // 2 seconds

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

export function BackendProvider({ children }: { children: ReactNode }) {
  // Connection and loading state
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Real data from backend
  const [dataPoints, setDataPoints] = useState<DataPoint[]>([]);
  const [alerts, setAlerts] = useState<AlertEntry[]>([]);
  const [flowLog, setFlowLog] = useState<FlowEntry[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);

  // Derived state
  const [totalFlows, setTotalFlows] = useState(0);
  const [throughput, setThroughput] = useState(0);
  const [isActive, setIsActive] = useState(true);
  const [ingestionRate, setIngestionRateValue] = useState(1);
  const previousStatsRef = useRef<{ totalFlows: number; timestampMs: number } | null>(null);

  // Calculate aggregated statistics
  const aggregatedStats = {
    avg: dataPoints.length > 0 ? dataPoints.reduce((a, b) => a + b.score, 0) / dataPoints.length : 0,
    peak: dataPoints.length > 0 ? Math.max(...dataPoints.map(d => d.score)) : 0,
    anomalyCount: dataPoints.filter(d => d.isAnomaly).length,
    benignCount: dataPoints.filter(d => !d.isAnomaly).length,
    total: dataPoints.length,
  };

  // Fetch data from backend
  const fetchData = async () => {
    try {
      const [statsData, eventsData, streamControl] = await Promise.all([
        graphIdsApi.getStats(),
        graphIdsApi.getEvents(100),
        graphIdsApi.getStreamControl(),
      ]);

      // Update stats
      setStats(statsData);
      setTotalFlows(statsData.total_flows_processed);
      setIsActive(streamControl.is_active);
      setIngestionRateValue(streamControl.ingestion_rate);
      setIsConnected(true);
      setError(null);

      // Transform backend events to DataPoints
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

      // Keep only recent dataPoints
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

          return {
            id: flowIdToNumeric(String(p.id), idx + 1),
            timestamp: p.time,
            srcIP: p.srcIP || 'Unknown',
            dstIP: p.dstIP || 'Unknown',
            score: p.score,
            severity: sourceEvent?.severity ?? 'low',
            acknowledged: false,
          };
        });

      setAlerts(prev => {
        const combined = [...newAlerts, ...prev];
        const unique = Array.from(new Map(combined.map(a => [a.id, a])).values());
        return unique.slice(0, 100);
      });

      // Create FlowEntry from real backend data (ClassificationResult)
      const flowEntries: FlowEntry[] = eventsData
        .map((event, idx) => {
          // Convert protocol number to name (protocol field may be optional)
          let protocol: 'TCP' | 'UDP' | 'ICMP' | 'HTTP' | 'HTTPS' | 'DNS' = 'TCP';
          const proto = (event as any).protocol || 6; // default to 6 (TCP)
          
          if (proto === 6) protocol = 'TCP';
          else if (proto === 17) protocol = 'UDP';
          else if (proto === 1) protocol = 'ICMP';
          
          // Apply heuristic protocol detection based on ports as fallback
          if (proto === 6) {
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
            packetCount: (event as any).packets || 0,
            byteCount: (event as any).bytes || 0,
            duration: (event as any).duration_ms || 0,
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

      // Estimate throughput from true counter deltas between polling ticks.
      const nowMs = Date.now();
      const previous = previousStatsRef.current;
      if (previous) {
        const deltaFlows = Math.max(0, statsData.total_flows_processed - previous.totalFlows);
        const deltaSeconds = Math.max(0.001, (nowMs - previous.timestampMs) / 1000);
        setThroughput(deltaFlows / deltaSeconds);
      }
      previousStatsRef.current = { totalFlows: statsData.total_flows_processed, timestampMs: nowMs };

      setIsLoading(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch backend data';
      setError(message);
      setIsConnected(false);
      setIsLoading(false);
      console.error('Backend fetch error:', err);
    }
  };

  // Poll backend every 2 seconds
  useEffect(() => {
    fetchData(); // Initial fetch

    const interval = setInterval(fetchData, POLLING_INTERVAL);

    return () => clearInterval(interval);
  }, []);

  const toggleActive = async () => {
    const next = !isActive;
    setIsActive(next);
    try {
      const result = await graphIdsApi.updateStreamControl({ is_active: next });
      setIsActive(result.is_active);
      setIngestionRateValue(result.ingestion_rate);
    } catch (err) {
      setIsActive(!next);
      const message = err instanceof Error ? err.message : 'Failed to update stream state';
      setError(message);
    }
  };

  const setIngestionRate = async (rate: number) => {
    setIngestionRateValue(rate);
    try {
      const result = await graphIdsApi.updateStreamControl({ ingestion_rate: rate });
      setIsActive(result.is_active);
      setIngestionRateValue(result.ingestion_rate);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update ingestion rate';
      setError(message);
    }
  };

  return (
    <BackendContext.Provider
      value={{
        isConnected,
        isLoading,
        error,
        dataPoints,
        alerts,
        flowLog,
        stats,
        totalFlows,
        throughput,
        aggregatedStats,
        isActive,
        ingestionRate,
        toggleActive,
        setIngestionRate,
      }}
    >
      {children}
    </BackendContext.Provider>
  );
}
