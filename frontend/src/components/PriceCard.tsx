import { type FC } from 'react';
import { formatUSD } from '../services/coinGecko';

interface PriceCardProps {
  label: string;
  price: number | null;
  change24h?: number | null;
  subtitle?: string;
  isLoading?: boolean;
  source: 'coingecko' | 'oracle';
}

const PriceCard: FC<PriceCardProps> = ({
  label,
  price,
  change24h,
  subtitle,
  isLoading = false,
  source,
}) => {
  const isPositive = change24h !== null && change24h !== undefined && change24h >= 0;
  const accentColor = source === 'coingecko' ? 'var(--neon-green)' : 'var(--neon-cyan)';
  const sourceLabel = source === 'coingecko' ? 'BINANCE LIVE' : 'ORACLE ON-CHAIN';

  return (
    <div style={styles.card}>
      {/* Corner decorations */}
      <span style={{ ...styles.corner, top: 0, left: 0, borderColor: accentColor }} />
      <span style={{ ...styles.corner, top: 0, right: 0, borderColor: accentColor, transform: 'rotate(90deg)' }} />
      <span style={{ ...styles.corner, bottom: 0, left: 0, borderColor: accentColor, transform: 'rotate(-90deg)' }} />
      <span style={{ ...styles.corner, bottom: 0, right: 0, borderColor: accentColor, transform: 'rotate(180deg)' }} />

      {/* Source badge */}
      <div style={{ ...styles.sourceBadge, color: accentColor, borderColor: accentColor, boxShadow: `0 0 8px ${accentColor}40` }}>
        {sourceLabel}
      </div>

      {/* Label */}
      <div style={styles.label}>{label}</div>

      {/* Price */}
      <div style={styles.priceWrapper}>
        {isLoading ? (
          <div style={styles.skeleton} />
        ) : price !== null ? (
          <span style={{ ...styles.price, color: accentColor, textShadow: `0 0 20px ${accentColor}80` }}>
            {formatUSD(price)}
          </span>
        ) : (
          <span style={styles.noData}>— NOT SYNCED —</span>
        )}
      </div>

      {/* 24h change */}
      {change24h !== null && change24h !== undefined && !isLoading && (
        <div style={{
          ...styles.change,
          color: isPositive ? 'var(--neon-green)' : 'var(--neon-red)',
        }}>
          <span style={styles.changeArrow}>{isPositive ? '▲' : '▼'}</span>
          {Math.abs(change24h).toFixed(2)}% (24h)
        </div>
      )}

      {/* Subtitle */}
      {subtitle && <div style={styles.subtitle}>{subtitle}</div>}

      {/* Horizontal rule */}
      <div style={{ ...styles.divider, background: `linear-gradient(90deg, transparent, ${accentColor}60, transparent)` }} />
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  card: {
    position: 'relative',
    background: 'var(--bg-card)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-lg)',
    padding: '28px 24px 20px',
    boxShadow: 'var(--glow-card)',
    minWidth: 280,
    flex: '1 1 280px',
    transition: 'var(--transition)',
    overflow: 'hidden',
  },
  corner: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderTop: '2px solid',
    borderLeft: '2px solid',
    transformOrigin: 'top left',
  },
  sourceBadge: {
    display: 'inline-block',
    fontFamily: 'var(--font-display)',
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.15em',
    padding: '2px 8px',
    border: '1px solid',
    borderRadius: 2,
    marginBottom: 12,
  },
  label: {
    fontFamily: 'var(--font-display)',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.2em',
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  priceWrapper: {
    minHeight: 56,
    display: 'flex',
    alignItems: 'center',
  },
  price: {
    fontFamily: 'var(--font-display)',
    fontSize: 36,
    fontWeight: 900,
    letterSpacing: '-0.02em',
    lineHeight: 1,
  },
  skeleton: {
    width: 220,
    height: 40,
    borderRadius: 4,
    background: 'linear-gradient(90deg, var(--bg-surface) 25%, #1a1a28 50%, var(--bg-surface) 75%)',
    backgroundSize: '200% 100%',
    animation: 'skeleton-shimmer 1.5s infinite',
  },
  noData: {
    fontFamily: 'var(--font-mono)',
    fontSize: 16,
    color: 'var(--text-muted)',
    letterSpacing: '0.1em',
  },
  change: {
    fontFamily: 'var(--font-mono)',
    fontSize: 13,
    marginTop: 8,
    letterSpacing: '0.05em',
  },
  changeArrow: {
    marginRight: 4,
  },
  subtitle: {
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    color: 'var(--text-muted)',
    marginTop: 6,
    letterSpacing: '0.05em',
  },
  divider: {
    height: 1,
    marginTop: 16,
  },
};

export default PriceCard;
