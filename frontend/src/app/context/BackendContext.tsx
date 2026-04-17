/**
 * BackendContext - Centralized real data from GraphIDS API
 * Replaces SimulationContext for all pages in the app
 */

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { graphIdsApi, type DashboardStats, type ClassificationResult } from '../utils/api';
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
  toggleActive: () => void;
}

const BackendContext = createContext<BackendContextType | null>(null);

export function useBackend() {
  const ctx = useContext(BackendContext);
  if (!ctx) throw new Error('useBackend must be inside BackendProvider');
  return ctx;
}

const CHART_WINDOW = 60;
const POLLING_INTERVAL = 2000; // 2 seconds

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
      const [statsData, eventsData] = await Promise.all([
        graphIdsApi.getStats(),
        graphIdsApi.getEvents(100),
      ]);

      // Update stats
      setStats(statsData);
      setTotalFlows(statsData.total_flows_processed);
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
          const score = p.score;
          let severity: AlertEntry['severity'];
          if (score >= 0.95) severity = 'critical';
          else if (score >= 0.85) severity = 'high';
          else if (score >= 0.75) severity = 'medium';
          else severity = 'low';

          return {
            id: parseInt(p.id.split('_')[1] || `${idx}`, 10),
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
        return unique.slice(0, 100);
      });

      // Create synthetic FlowEntry for GraphPage (from DataPoints)
      const flowEntries: FlowEntry[] = points
        .filter(p => p.isAnomaly)
        .slice(0, 50)
        .map((p, idx) => ({
          id: idx,
          timestamp: p.time,
          srcIP: p.srcIP || `Unknown${idx}`,
          dstIP: p.dstIP || `Unknown${idx}`,
          srcPort: 1024 + idx,
          dstPort: 443,
          protocol: 'TCP',
          packetCount: Math.floor(Math.random() * 500),
          byteCount: Math.floor(Math.random() * 1000000),
          duration: Math.floor(Math.random() * 10000),
          score: p.score,
          isAnomaly: true,
          embX: (Math.random() - 0.5) * 4,
          embY: (Math.random() - 0.5) * 4,
        }));

      setFlowLog(flowEntries);

      // Estimate throughput
      if (eventsData.length > 0) {
        setThroughput(eventsData.length / 2);
      }

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

  const toggleActive = () => {
    setIsActive(!isActive);
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
        toggleActive,
      }}
    >
      {children}
    </BackendContext.Provider>
  );
}
