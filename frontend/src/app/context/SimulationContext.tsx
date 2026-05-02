import { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { DataPoint, AlertEntry, FlowEntry, Protocol } from '../types';
import { toast } from 'sonner';

// ─── Constants ────────────────────────────────────────────────────────────────
export const THRESHOLD = 0.35;
export const CHART_WINDOW = 60;
const BASE_INTERVAL = 1100;
const PROTOCOLS: Protocol[] = ['TCP', 'UDP', 'ICMP', 'HTTP', 'HTTPS', 'DNS'];
const COMMON_PORTS = [80, 443, 22, 21, 25, 53, 3306, 8080, 8443, 3389, 6379, 5432];

// ─── Utilities ────────────────────────────────────────────────────────────────
export const rInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;
export const rFloat = (min: number, max: number) =>
  Math.random() * (max - min) + min;
export const randomIP = () =>
  `${rInt(1, 254)}.${rInt(0, 255)}.${rInt(0, 255)}.${rInt(0, 255)}`;

export const formatTime = (d: Date) =>
  d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const formatTimeShort = (d: Date) =>
  d.toLocaleTimeString('en-US', { hour12: false, minute: '2-digit', second: '2-digit' });

export const formatDate = (d: Date) =>
  d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }) + ' ' + formatTime(d);

export const getSeverity = (score: number): AlertEntry['severity'] => {
  if (score >= 0.95) return 'critical';
  if (score >= 0.85) return 'high';
  if (score >= 0.75) return 'medium';
  return 'low';
};

export const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const generateScore = () => {
  const isAnomaly = Math.random() < 0.085;
  if (isAnomaly) return { score: rFloat(0.68, 1.0), isAnomaly: true };
  const score = Math.max(0.02, Math.min(0.62, 0.18 + (Math.random() - 0.5) * 0.32 + Math.random() * 0.08));
  return { score, isAnomaly: false };
};

const generateEmbedding = (isAnomaly: boolean, score: number) => {
  if (isAnomaly) {
    const angle = Math.random() * 2 * Math.PI;
    const r = 3 + score * 2.5 + Math.random() * 1.5;
    return {
      embX: parseFloat((r * Math.cos(angle)).toFixed(3)),
      embY: parseFloat((r * Math.sin(angle)).toFixed(3)),
    };
  }
  return {
    embX: parseFloat(((Math.random() - 0.5) * 2.8 + (Math.random() - 0.5) * 0.5).toFixed(3)),
    embY: parseFloat(((Math.random() - 0.5) * 2.8 + (Math.random() - 0.5) * 0.5).toFixed(3)),
  };
};

let globalId = 10000;

const createFlow = (time: Date): FlowEntry => {
  const { score, isAnomaly } = generateScore();
  const emb = generateEmbedding(isAnomaly, score);
  return {
    id: globalId++,
    timestamp: time,
    srcIP: randomIP(),
    dstIP: randomIP(),
    srcPort: rInt(1024, 65535),
    dstPort: COMMON_PORTS[rInt(0, COMMON_PORTS.length - 1)],
    protocol: PROTOCOLS[rInt(0, PROTOCOLS.length - 1)],
    packetCount: rInt(1, 500),
    byteCount: rInt(64, 1_500_000),
    duration: rInt(5, 10_000),
    score,
    isAnomaly,
    ...emb,
  };
};

const initFlows = (count: number, baseTime: Date): FlowEntry[] =>
  Array.from({ length: count }, (_, i) =>
    createFlow(new Date(baseTime.getTime() - (count - i) * BASE_INTERVAL))
  );

// ─── Context Type ─────────────────────────────────────────────────────────────
interface SimulationContextType {
  dataPoints: DataPoint[];
  alerts: AlertEntry[];
  flowLog: FlowEntry[];
  totalFlows: number;
  throughput: number;
  isActive: boolean;
  ingestionRate: number;
  toggleActive: () => void;
  setIngestionRate: (rate: number) => void;
  acknowledgeAlert: (id: number) => void;
  acknowledgeAll: () => void;
  clearAlerts: () => void;
  stats: {
    avg: number; peak: number;
    anomalyCount: number; benignCount: number; total: number;
  };
}

const SimulationContext = createContext<SimulationContextType | null>(null);

export function useSimulation(): SimulationContextType {
  const ctx = useContext(SimulationContext);
  if (!ctx) throw new Error('useSimulation must be inside SimulationProvider');
  return ctx;
}

export function SimulationProvider({ children }: { children: ReactNode }) {
  const now = new Date();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialFlows = useMemo(() => initFlows(100, now), []);

  const [isActive, setIsActive] = useState(true);
  const [ingestionRate, setIngestionRateState] = useState(1);
  const isActiveRef = useRef(true);
  const ingestionRateRef = useRef(1);

  const [flowLog, setFlowLog] = useState<FlowEntry[]>(initialFlows);

  const [dataPoints, setDataPoints] = useState<DataPoint[]>(() =>
    initialFlows.slice(-CHART_WINDOW).map(f => ({
      id: f.id,
      time: f.timestamp,
      timeLabel: formatTimeShort(f.timestamp),
      score: f.score,
      isAnomaly: f.isAnomaly,
      srcIP: f.isAnomaly ? f.srcIP : undefined,
      dstIP: f.isAnomaly ? f.dstIP : undefined,
    }))
  );

  const [alerts, setAlerts] = useState<AlertEntry[]>(() =>
    initialFlows
      .filter(f => f.isAnomaly)
      .map(f => ({
        id: f.id,
        timestamp: f.timestamp,
        srcIP: f.srcIP,
        dstIP: f.dstIP,
        score: f.score,
        severity: getSeverity(f.score),
        acknowledged: Math.random() > 0.6,
      }))
      .reverse()
  );

  const [totalFlows, setTotalFlows] = useState(rInt(14000, 80000));
  const [throughput, setThroughput] = useState(rFloat(2, 5));

  const toggleActive = useCallback(() => {
    setIsActive(v => { isActiveRef.current = !v; return !v; });
  }, []);

  const setIngestionRate = useCallback((rate: number) => {
    setIngestionRateState(rate);
    ingestionRateRef.current = rate;
  }, []);

  const acknowledgeAlert = useCallback((id: number) => {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, acknowledged: true } : a));
  }, []);

  const acknowledgeAll = useCallback(() => {
    setAlerts(prev => prev.map(a => ({ ...a, acknowledged: true })));
  }, []);

  const clearAlerts = useCallback(() => setAlerts([]), []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!isActiveRef.current) return;
      const rate = ingestionRateRef.current;
      const time = new Date();
      const flow = createFlow(time);

      const newPoint: DataPoint = {
        id: flow.id,
        time: flow.timestamp,
        timeLabel: formatTimeShort(flow.timestamp),
        score: flow.score,
        isAnomaly: flow.isAnomaly,
        srcIP: flow.isAnomaly ? flow.srcIP : undefined,
        dstIP: flow.isAnomaly ? flow.dstIP : undefined,
      };

      setFlowLog(prev => [flow, ...prev.slice(0, 499)]);
      setDataPoints(prev => [...prev.slice(-(CHART_WINDOW - 1)), newPoint]);

      if (flow.isAnomaly) {
        const newAlert: AlertEntry = {
          id: flow.id,
          timestamp: flow.timestamp,
          srcIP: flow.srcIP,
          dstIP: flow.dstIP,
          score: flow.score,
          severity: getSeverity(flow.score),
          acknowledged: false,
        };
        setAlerts(prev => [newAlert, ...prev.slice(0, 199)]);

        if (newAlert.severity === 'critical') {
          toast.error(`CRITICAL ALERT — Score: ${flow.score.toFixed(4)}`, {
            description: `${flow.srcIP} → ${flow.dstIP}`,
            duration: 5000,
          });
        } else if (newAlert.severity === 'high' && Math.random() < 0.35) {
          toast.warning(`HIGH ALERT — Score: ${flow.score.toFixed(4)}`, {
            description: `${flow.srcIP} → ${flow.dstIP}`,
            duration: 3500,
          });
        }
      }

      setTotalFlows(prev => prev + rInt(1, Math.max(2, Math.round(rate * 4))));
      setThroughput(rFloat(1.5, 5.5) * Math.max(0.5, rate));
    }, BASE_INTERVAL);

    return () => clearInterval(interval);
  }, []);

  const stats = useMemo(() => {
    const recent = dataPoints.slice(-CHART_WINDOW);
    const avg = recent.reduce((a, b) => a + b.score, 0) / Math.max(1, recent.length);
    const peak = recent.reduce((m, d) => Math.max(m, d.score), 0);
    const anomalyCount = recent.filter(d => d.isAnomaly).length;
    return { avg, peak, anomalyCount, benignCount: recent.length - anomalyCount, total: recent.length };
  }, [dataPoints]);

  return (
    <SimulationContext.Provider value={{
      dataPoints, alerts, flowLog, totalFlows, throughput, isActive, ingestionRate,
      toggleActive, setIngestionRate, acknowledgeAlert, acknowledgeAll, clearAlerts, stats,
    }}>
      {children}
    </SimulationContext.Provider>
  );
}
