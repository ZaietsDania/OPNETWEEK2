import { type FC, useMemo, useRef, useState } from 'react';
import type { PricePoint } from '../services/coinGecko';
import { formatUSD } from '../services/coinGecko';

interface PriceChartProps {
  data: PricePoint[];
  isLoading?: boolean;
  height?: number;
}

const W = 800;  // viewBox width
const H = 280;  // viewBox height
const PAD = { top: 20, right: 16, bottom: 36, left: 72 };

const CHART_W = W - PAD.left - PAD.right;
const CHART_H = H - PAD.top - PAD.bottom;

function lerp(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  if (inMax === inMin) return (outMin + outMax) / 2;
  return ((value - inMin) / (inMax - inMin)) * (outMax - outMin) + outMin;
}

function buildLinePath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(' ');
}

function buildAreaPath(points: { x: number; y: number }[], baseY: number): string {
  if (points.length === 0) return '';
  const line = buildLinePath(points);
  const last = points[points.length - 1];
  const first = points[0];
  return `${line} L ${last.x.toFixed(2)} ${baseY} L ${first.x.toFixed(2)} ${baseY} Z`;
}

const PriceChart: FC<PriceChartProps> = ({ data, isLoading = false, height = 280 }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    point: PricePoint;
  } | null>(null);

  const { points, minPrice, maxPrice, yTicks, xTicks } = useMemo(() => {
    if (data.length < 2) {
      return { points: [], minPrice: 0, maxPrice: 0, yTicks: [], xTicks: [] };
    }

    const prices = data.map((d) => d.price);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);

    // Add 2% padding to price range
    const range = maxP - minP || 1;
    const minPrice = minP - range * 0.02;
    const maxPrice = maxP + range * 0.02;

    const timestamps = data.map((d) => d.timestamp);
    const minT = Math.min(...timestamps);
    const maxT = Math.max(...timestamps);

    const pts = data.map((d) => ({
      x: PAD.left + lerp(d.timestamp, minT, maxT, 0, CHART_W),
      y: PAD.top + lerp(d.price, maxPrice, minPrice, 0, CHART_H),
    }));

    // Y axis ticks (5 steps)
    const yTicks = Array.from({ length: 5 }, (_, i) => {
      const price = minPrice + (i / 4) * (maxPrice - minPrice);
      const y = PAD.top + lerp(price, maxPrice, minPrice, 0, CHART_H);
      return { price, y };
    });

    // X axis ticks (6 labels)
    const xTicks = Array.from({ length: 6 }, (_, i) => {
      const t = minT + (i / 5) * (maxT - minT);
      const x = PAD.left + lerp(t, minT, maxT, 0, CHART_W);
      const label = new Date(t).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      return { x, label };
    });

    return { points: pts, minPrice, maxPrice, yTicks, xTicks };
  }, [data]);

  const linePath = buildLinePath(points);
  const areaPath = buildAreaPath(points, PAD.top + CHART_H);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || data.length < 2) return;
    const rect = svgRef.current.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const chartX = svgX - PAD.left;
    const ratio = Math.max(0, Math.min(1, chartX / CHART_W));
    const idx = Math.round(ratio * (data.length - 1));
    const point = data[idx];
    const px = points[idx];
    if (point && px) {
      setTooltip({ x: px.x, y: px.y, point });
    }
  };

  return (
    <div style={styles.wrapper}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.title}>BTC/USD  24H CHART</span>
        <span style={styles.range}>
          {data.length > 0
            ? `${formatUSD(Math.min(...data.map((d) => d.price)))} — ${formatUSD(Math.max(...data.map((d) => d.price)))}`
            : '—'}
        </span>
      </div>

      {/* SVG Chart */}
      <div style={styles.svgWrapper}>
        {isLoading ? (
          <div style={styles.loadingOverlay}>
            <span style={styles.loadingText}>LOADING CHART DATA...</span>
          </div>
        ) : data.length < 2 ? (
          <div style={styles.loadingOverlay}>
            <span style={styles.loadingText}>NO DATA AVAILABLE</span>
          </div>
        ) : (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="xMidYMid meet"
            style={{ width: '100%', height }}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setTooltip(null)}
          >
            <defs>
              {/* Neon glow filter */}
              <filter id="glow-green" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3" result="blur1" />
                <feGaussianBlur stdDeviation="8" result="blur2" />
                <feMerge>
                  <feMergeNode in="blur2" />
                  <feMergeNode in="blur1" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              {/* Area gradient */}
              <linearGradient id="area-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#00ff41" stopOpacity="0.18" />
                <stop offset="60%"  stopColor="#00ff41" stopOpacity="0.04" />
                <stop offset="100%" stopColor="#00ff41" stopOpacity="0" />
              </linearGradient>
              {/* Clip path */}
              <clipPath id="chart-clip">
                <rect x={PAD.left} y={PAD.top} width={CHART_W} height={CHART_H} />
              </clipPath>
            </defs>

            {/* ── Grid lines ───────────────────────────────────────────────── */}
            {yTicks.map((tick, i) => (
              <g key={i}>
                <line
                  x1={PAD.left} y1={tick.y}
                  x2={PAD.left + CHART_W} y2={tick.y}
                  stroke="#00ff41" strokeOpacity="0.08" strokeWidth="1"
                  strokeDasharray="4 6"
                />
                <text
                  x={PAD.left - 8} y={tick.y + 4}
                  textAnchor="end"
                  fill="#00ff41"
                  fillOpacity="0.5"
                  fontSize="9"
                  fontFamily="Share Tech Mono, monospace"
                >
                  {formatUSD(tick.price).replace('$', '')}
                </text>
              </g>
            ))}

            {/* ── X-axis labels ─────────────────────────────────────────────── */}
            {xTicks.map((tick, i) => (
              <text
                key={i}
                x={tick.x} y={PAD.top + CHART_H + 22}
                textAnchor="middle"
                fill="#00ff41"
                fillOpacity="0.4"
                fontSize="9"
                fontFamily="Share Tech Mono, monospace"
              >
                {tick.label}
              </text>
            ))}

            {/* ── Area fill ────────────────────────────────────────────────── */}
            <path
              d={areaPath}
              fill="url(#area-gradient)"
              clipPath="url(#chart-clip)"
            />

            {/* ── Main price line ───────────────────────────────────────────── */}
            <path
              d={linePath}
              fill="none"
              stroke="#00ff41"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              clipPath="url(#chart-clip)"
              filter="url(#glow-green)"
            />

            {/* ── Tooltip crosshair ─────────────────────────────────────────── */}
            {tooltip && (
              <g>
                {/* Vertical line */}
                <line
                  x1={tooltip.x} y1={PAD.top}
                  x2={tooltip.x} y2={PAD.top + CHART_H}
                  stroke="#00ff41" strokeOpacity="0.4" strokeWidth="1"
                  strokeDasharray="3 4"
                />
                {/* Data point circle */}
                <circle
                  cx={tooltip.x} cy={tooltip.y}
                  r="4"
                  fill="#00ff41"
                  filter="url(#glow-green)"
                />
                <circle
                  cx={tooltip.x} cy={tooltip.y}
                  r="2"
                  fill="#050508"
                />

                {/* Tooltip box */}
                {(() => {
                  const boxW = 148;
                  const boxH = 44;
                  const bx = Math.min(tooltip.x + 10, W - boxW - 8);
                  const by = Math.max(tooltip.y - boxH - 8, PAD.top);
                  return (
                    <g>
                      <rect
                        x={bx} y={by} width={boxW} height={boxH}
                        rx="3" ry="3"
                        fill="#0d0d14"
                        stroke="#00ff41"
                        strokeOpacity="0.5"
                        strokeWidth="1"
                      />
                      <text
                        x={bx + 8} y={by + 16}
                        fill="#00ff41"
                        fontSize="11"
                        fontFamily="Share Tech Mono, monospace"
                        fontWeight="bold"
                      >
                        {formatUSD(tooltip.point.price)}
                      </text>
                      <text
                        x={bx + 8} y={by + 32}
                        fill="#00ff41"
                        fillOpacity="0.5"
                        fontSize="9"
                        fontFamily="Share Tech Mono, monospace"
                      >
                        {new Date(tooltip.point.timestamp).toLocaleTimeString('en-US', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                          hour12: false,
                        })}
                      </text>
                    </g>
                  );
                })()}
              </g>
            )}

            {/* ── Axes ─────────────────────────────────────────────────────── */}
            <line
              x1={PAD.left} y1={PAD.top}
              x2={PAD.left} y2={PAD.top + CHART_H}
              stroke="#00ff41" strokeOpacity="0.2" strokeWidth="1"
            />
            <line
              x1={PAD.left} y1={PAD.top + CHART_H}
              x2={PAD.left + CHART_W} y2={PAD.top + CHART_H}
              stroke="#00ff41" strokeOpacity="0.2" strokeWidth="1"
            />
          </svg>
        )}
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-lg)',
    padding: '20px 20px 12px',
    boxShadow: 'var(--glow-card)',
    width: '100%',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontFamily: 'var(--font-display)',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.2em',
    color: 'var(--neon-green)',
    textShadow: '0 0 8px rgba(0,255,65,0.5)',
  },
  range: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    color: 'var(--text-muted)',
    letterSpacing: '0.05em',
  },
  svgWrapper: {
    position: 'relative',
    width: '100%',
    minHeight: 200,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingOverlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontFamily: 'var(--font-display)',
    fontSize: 11,
    letterSpacing: '0.2em',
    color: 'var(--text-muted)',
    animation: 'pulse-glow 2s ease-in-out infinite',
  },
};

export default PriceChart;
