import { useMemo, useRef, useEffect, useState } from 'react';
import { Share2, ZoomIn, ZoomOut, RefreshCw } from 'lucide-react';
import {
  ScatterChart, Scatter, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { useBackend } from '../../context/BackendContext';

export function GraphPage() {
  const { flowLog } = useBackend();
  const [activeTab, setActiveTab] = useState<'subgraph' | 'embedding'>('embedding');

  // Embedding data: sample last 300 flows
  const embData = useMemo(() =>
    flowLog.slice(0, 300).map(f => ({
      x: f.embX,
      y: f.embY,
      isAnomaly: f.isAnomaly,
      score: f.score,
      srcIP: f.srcIP,
      dstIP: f.dstIP,
    })),
    [flowLog]
  );

  // Anomalous subgraph: last 80 anomalous flows
  const anomalousFlows = useMemo(() =>
    flowLog.filter(f => f.isAnomaly).slice(0, 80),
    [flowLog]
  );

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      background: '#0d1117', overflow: 'hidden',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 20px', borderBottom: '1px solid #21262d', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Share2 size={16} color="#58a6ff" />
          <span style={{ color: '#e6edf3', fontSize: 14, fontWeight: 700, letterSpacing: '0.06em' }}>
            GRAPH VIEW
          </span>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          {(['embedding', 'subgraph'] as const).map(t => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              style={{
                padding: '5px 14px', borderRadius: 5, cursor: 'pointer',
                fontSize: 11, fontWeight: 600, letterSpacing: '0.04em',
                background: activeTab === t ? 'rgba(88,166,255,0.15)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${activeTab === t ? 'rgba(88,166,255,0.35)' : '#21262d'}`,
                color: activeTab === t ? '#58a6ff' : '#7d8590',
              }}
            >
              {t === 'embedding' ? 'EMBEDDING SPACE' : 'ANOMALOUS SUBGRAPH'}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'embedding' ? (
        <EmbeddingView data={embData} />
      ) : (
        <SubgraphView flows={anomalousFlows} />
      )}
    </div>
  );
}

// ─── Embedding Space (2D scatter) ────────────────────────────────────────────
const EmbScatterTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div style={{
      background: '#161b22', border: `1px solid ${d?.isAnomaly ? '#ef4444' : '#21262d'}`,
      padding: '8px 12px', borderRadius: 6, fontSize: 11,
    }}>
      <div style={{ color: d?.isAnomaly ? '#f85149' : '#58a6ff', fontWeight: 700, marginBottom: 4 }}>
        {d?.isAnomaly ? '⚠ ANOMALY' : '● NORMAL'}
      </div>
      <div style={{ color: '#7d8590' }}>Score: <span style={{ color: '#e6edf3', fontFamily: 'monospace' }}>{d?.score?.toFixed(4)}</span></div>
      <div style={{ color: '#7d8590' }}>{d?.srcIP} → {d?.dstIP}</div>
    </div>
  );
};

function EmbeddingView({ data }: { data: ReturnType<typeof useBackend>['flowLog'][number][] & any[] }) {
  const normal = data.filter(d => !d.isAnomaly);
  const anomaly = data.filter(d => d.isAnomaly);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px 20px', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12, flexShrink: 0 }}>
        <span style={{ color: '#7d8590', fontSize: 11 }}>
          2D Embedding Space (PCA / t-SNE) — {data.length} samples
        </span>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#3b82f6', opacity: 0.7 }} />
            <span style={{ color: '#7d8590', fontSize: 10 }}>Normal ({normal.length})</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444' }} />
            <span style={{ color: '#7d8590', fontSize: 10 }}>Anomaly ({anomaly.length})</span>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
              <XAxis
                dataKey="x" type="number" name="PC1"
                tick={{ fill: '#4d5666', fontSize: 9, fontFamily: 'monospace' }}
                axisLine={{ stroke: '#21262d' }} tickLine={false}
                domain={['auto', 'auto']}
              />
              <YAxis
                dataKey="y" type="number" name="PC2"
                tick={{ fill: '#4d5666', fontSize: 9, fontFamily: 'monospace' }}
                axisLine={false} tickLine={false} width={32}
                domain={['auto', 'auto']}
              />
              <Tooltip content={<EmbScatterTooltip />} cursor={false} />
              {/* Normal traffic cluster */}
              <Scatter name="Normal" data={normal} isAnimationActive={false}>
                {normal.map((_, i) => (
                  <Cell key={`n-${i}`} fill="#3b82f6" fillOpacity={0.45} />
                ))}
              </Scatter>
              {/* Anomalies — rendered on top */}
              <Scatter name="Anomaly" data={anomaly} isAnimationActive={false}>
                {anomaly.map((_, i) => (
                  <Cell key={`a-${i}`} fill="#ef4444" fillOpacity={0.85} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ─── Anomalous Subgraph (canvas-based) ───────────────────────────────────────
function SubgraphView({ flows }: { flows: any[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);

  const { nodes, edges } = useMemo(() => {
    const ipMap = new Map<string, { ip: string; connections: number; maxScore: number }>();
    const edgeList: { src: string; dst: string; score: number }[] = [];

    flows.forEach(f => {
      if (!ipMap.has(f.srcIP)) ipMap.set(f.srcIP, { ip: f.srcIP, connections: 0, maxScore: 0 });
      if (!ipMap.has(f.dstIP)) ipMap.set(f.dstIP, { ip: f.dstIP, connections: 0, maxScore: 0 });
      const src = ipMap.get(f.srcIP)!;
      const dst = ipMap.get(f.dstIP)!;
      src.connections++;
      dst.connections++;
      src.maxScore = Math.max(src.maxScore, f.score);
      dst.maxScore = Math.max(dst.maxScore, f.score);
      edgeList.push({ src: f.srcIP, dst: f.dstIP, score: f.score });
    });

    const nodeArr = Array.from(ipMap.values());
    return { nodes: nodeArr, edges: edgeList };
  }, [flows]);

  const nodePositions = useMemo(() => {
    const pos = new Map<string, { x: number; y: number }>();
    nodes.forEach((n, i) => {
      const angle = (i / nodes.length) * 2 * Math.PI;
      const r = 0.3 + (n.connections / 10) * 0.1;
      pos.set(n.ip, {
        x: 0.5 + r * Math.cos(angle),
        y: 0.5 + r * Math.sin(angle),
      });
    });
    return pos;
  }, [nodes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    // Draw edges
    edges.forEach(e => {
      const sp = nodePositions.get(e.src);
      const dp = nodePositions.get(e.dst);
      if (!sp || !dp) return;
      const alpha = 0.15 + e.score * 0.4;
      const lw = 0.5 + e.score * 2;
      ctx.beginPath();
      ctx.moveTo(sp.x * W, sp.y * H);
      ctx.lineTo(dp.x * W, dp.y * H);
      ctx.strokeStyle = `rgba(239,68,68,${alpha})`;
      ctx.lineWidth = lw;
      ctx.stroke();
    });

    // Draw nodes
    nodes.forEach(n => {
      const p = nodePositions.get(n.ip);
      if (!p) return;
      const r = 4 + n.connections * 1.5;
      const intensity = Math.min(1, n.maxScore);
      const color = `rgba(${Math.round(239 * intensity + 88 * (1 - intensity))},${Math.round(68 * intensity + 166 * (1 - intensity))},${Math.round(68 * intensity + 255 * (1 - intensity))},0.9)`;

      ctx.beginPath();
      ctx.arc(p.x * W, p.y * H, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.stroke();

      if (n.connections >= 3) {
        ctx.fillStyle = '#e6edf3';
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(n.ip.split('.').slice(0, 2).join('.') + '…', p.x * W, p.y * H - r - 3);
      }
    });
  }, [nodes, edges, nodePositions, zoom]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px 20px', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexShrink: 0 }}>
        <span style={{ color: '#7d8590', fontSize: 11 }}>
          Anomalous Subgraph — {nodes.length} nodes, {edges.length} edges
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <IconBtn onClick={() => setZoom(z => Math.min(3, z + 0.25))}><ZoomIn size={13} /></IconBtn>
          <IconBtn onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}><ZoomOut size={13} /></IconBtn>
          <IconBtn onClick={() => setZoom(1)}><RefreshCw size={13} /></IconBtn>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, position: 'relative', border: '1px solid #21262d', borderRadius: 8, overflow: 'hidden' }}>
        <canvas
          ref={canvasRef}
          width={800}
          height={500}
          style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%`, display: 'block' }}
        />

        {/* Legend */}
        <div style={{
          position: 'absolute', bottom: 12, left: 12,
          background: 'rgba(13,17,23,0.85)', border: '1px solid #21262d',
          borderRadius: 6, padding: '8px 12px',
          display: 'flex', flexDirection: 'column', gap: 5,
        }}>
          <span style={{ color: '#7d8590', fontSize: 10, letterSpacing: '0.06em' }}>LEGEND</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#58a6ff' }} />
            <span style={{ color: '#7d8590', fontSize: 10 }}>Low anomaly</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444' }} />
            <span style={{ color: '#7d8590', fontSize: 10 }}>High anomaly</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 20, height: 2, background: 'rgba(239,68,68,0.5)', borderRadius: 1 }} />
            <span style={{ color: '#7d8590', fontSize: 10 }}>Anomalous flow</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function IconBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 8px', borderRadius: 4,
        background: 'rgba(255,255,255,0.04)', border: '1px solid #21262d',
        color: '#7d8590', cursor: 'pointer', display: 'flex', alignItems: 'center',
      }}
    >
      {children}
    </button>
  );
}
