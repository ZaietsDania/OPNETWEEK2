import { useCallback, useEffect, useRef, useState } from 'react';
import PriceCard from './components/PriceCard';
import SyncButton from './components/SyncButton';
import PriceChart from './components/PriceChart';
import {
  fetchSpotPrice,
  fetchPriceHistory,
  type BTCSpotPrice,
  type PricePoint,
} from './services/coinGecko';
import { readOraclePrice, pushOraclePrice, type OraclePrice } from './services/contractService';

type SyncState = 'idle' | 'loading' | 'success' | 'error';

const REFRESH_INTERVAL_MS = 30_000; // 30 s

export default function App() {
  // ── State ───────────────────────────────────────────────────────────────────
  const [spotPrice, setSpotPrice]   = useState<BTCSpotPrice | null>(null);
  const [oraclePrice, setOraclePrice] = useState<OraclePrice | null>(null);
  const [history, setHistory]       = useState<PricePoint[]>([]);
  const [syncState, setSyncState]   = useState<SyncState>('idle');
  const [spotLoading, setSpotLoading]   = useState(true);
  const [chartLoading, setChartLoading] = useState(true);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [spotError, setSpotError]   = useState<string | null>(null);
  const [oracleError, setOracleError] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Data fetchers ───────────────────────────────────────────────────────────

  const loadSpot = useCallback(async () => {
    try {
      const price = await fetchSpotPrice();
      setSpotPrice(price);
      setSpotError(null);
    } catch (e) {
      setSpotError(`Binance: ${(e as Error).message}`);
    } finally {
      setSpotLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setChartLoading(true);
    try {
      const pts = await fetchPriceHistory(1);
      setHistory(pts);
    } catch (e) {
      console.error('History fetch failed:', e);
    } finally {
      setChartLoading(false);
    }
  }, []);

  const loadOracle = useCallback(async () => {
    try {
      const price = await readOraclePrice();
      if (price && price.rawPrice > 0n) {
        setOraclePrice(price);
        setOracleError(null);
      } else {
        setOracleError('Contract not yet indexed by node');
      }
    } catch (e) {
      const msg = (e as Error).message ?? '';
      const isNotFound = /not found|empty result|bytecode/i.test(msg);
      setOracleError(
        isNotFound
          ? 'Awaiting OP_NET indexing (block #4863087)'
          : msg
      );
      console.error('Oracle read failed:', e);
    }
  }, []);

  // ── Sync handler (push CoinGecko price → oracle) ────────────────────────────

  const handleSync = useCallback(async () => {
    console.log('Sync button clicked');
    if (!spotPrice) return;
    setSyncState('loading');
    try {
      const txid = await pushOraclePrice(spotPrice.usd);
      console.log('Oracle sync txid:', txid);
      setLastSynced(new Date());
      setSyncState('success');
      // Re-read oracle after write (may still show pending if node not indexed)
      await loadOracle();
    } catch (e) {
      console.error('Sync failed:', e);
      setSyncState('error');
    } finally {
      setTimeout(() => setSyncState('idle'), 3000);
    }
  }, [spotPrice, loadOracle]);

  // ── Effects ─────────────────────────────────────────────────────────────────

  const oracleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadSpot();
    loadHistory();
    loadOracle();

    // Refresh spot price every 30s
    timerRef.current = setInterval(() => {
      loadSpot();
    }, REFRESH_INTERVAL_MS);

    // Retry oracle every 15s until we get a price
    oracleTimerRef.current = setInterval(() => {
      setOraclePrice((prev) => {
        if (!prev) loadOracle();
        return prev;
      });
    }, 15_000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (oracleTimerRef.current) clearInterval(oracleTimerRef.current);
    };
  }, [loadSpot, loadHistory, loadOracle]);

  // ── Derived ─────────────────────────────────────────────────────────────────

  const oracleSubtitle = oraclePrice
    ? `BLOCK #${oraclePrice.lastUpdatedBlock.toString()}`
    : oracleError
    ? (oracleError.includes('Awaiting') ? 'AWAITING OP_NET INDEXING…' : `ERR: ${oracleError.slice(0, 40)}`)
    : 'LOADING...';

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={styles.root}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.logo}>
            <span style={styles.logoBracket}>[</span>
            <span style={styles.logoText}>BTC</span>
            <span style={styles.logoSep}>/</span>
            <span style={styles.logoAccent}>ORACLE</span>
            <span style={styles.logoBracket}>]</span>
          </div>
          <div style={styles.headerSub}>OP_NET PRICE ORACLE  ·  BITCOIN MAINNET</div>
        </div>

        <div style={styles.headerRight}>
          {/* Live indicator */}
          <div style={styles.liveIndicator}>
            <span style={styles.liveDot} />
            <span style={styles.liveText}>LIVE</span>
          </div>
          {lastSynced && (
            <div style={styles.lastSync}>
              LAST PUSH:{' '}
              {lastSynced.toLocaleTimeString('en-US', {
                hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
              })}
            </div>
          )}
        </div>
      </header>

      {/* ── Error banners (independent) ────────────────────────────────────── */}
      {spotError && (
        <div style={styles.errorBanner}>
          <span style={styles.errorIcon}>⚠</span> SPOT: {spotError}
        </div>
      )}
      {oracleError && !oraclePrice && (
        <div style={{ ...styles.errorBanner, borderColor: 'rgba(0,200,255,0.3)', color: 'var(--neon-cyan)' }}>
          <span style={styles.errorIcon}>{oracleError.includes('Awaiting') ? '⏳' : '⚠'}</span>{' '}
          ORACLE: {oracleError} — retrying every 15s…
        </div>
      )}

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <main style={styles.main}>

        {/* ── Price cards ──────────────────────────────────────────────────── */}
        <section style={styles.cardsRow}>
          <PriceCard
            label="BTC / USD  SPOT PRICE"
            price={spotPrice?.usd ?? null}
            change24h={spotPrice?.usd_24h_change ?? null}
            subtitle={
              spotPrice
                ? `UPDATED: ${new Date(spotPrice.last_updated_at * 1000).toLocaleTimeString('en-US', { hour12: false })}`
                : undefined
            }
            isLoading={spotLoading}
            source="coingecko"
          />

          <PriceCard
            label="BTC / USD  ORACLE"
            price={oraclePrice?.usd ?? null}
            subtitle={oracleSubtitle}
            isLoading={false}
            source="oracle"
          />
        </section>

        {/* ── Chart ────────────────────────────────────────────────────────── */}
        <section style={styles.chartSection}>
          <PriceChart data={history} isLoading={chartLoading} height={260} />
        </section>

        {/* ── Sync panel ───────────────────────────────────────────────────── */}
        <section style={styles.syncPanel}>
          <div style={styles.syncInfo}>
            <div style={styles.syncInfoTitle}>ORACLE SYNCHRONIZATION</div>
            <div style={styles.syncInfoBody}>
              Push the latest Binance spot price to the on-chain PriceOracle contract.
              Requires an OP_NET-compatible wallet and owner privileges.
            </div>
            {spotPrice && (
              <div style={styles.syncPreview}>
                WILL WRITE: <strong style={{ color: 'var(--neon-green)' }}>
                  ${spotPrice.usd.toFixed(2)}
                </strong>{' '}
                → scaled ×10⁸ →{' '}
                <strong style={{ color: 'var(--neon-cyan)' }}>
                  {Math.round(spotPrice.usd * 1e8).toLocaleString()}
                </strong>
              </div>
            )}
          </div>

          <SyncButton
            onSync={handleSync}
            state={syncState}
            disabled={!spotPrice}
          />
        </section>

        {/* ── Stats footer ─────────────────────────────────────────────────── */}
        <section style={styles.statsRow}>
          {[
            { label: 'NETWORK',  value: 'BITCOIN MAINNET' },
            { label: 'PROTOCOL', value: 'OP_NET v1' },
            { label: 'SCALE',    value: '×10⁸ (satoshi-precision)' },
            { label: 'REFRESH',  value: `${REFRESH_INTERVAL_MS / 1000}s AUTO` },
          ].map((stat) => (
            <div key={stat.label} style={styles.statItem}>
              <span style={styles.statLabel}>{stat.label}</span>
              <span style={styles.statValue}>{stat.value}</span>
            </div>
          ))}
        </section>
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer style={styles.footer}>
        <span style={{ color: 'var(--text-muted)' }}>
          PRICE DATA: BINANCE PUBLIC API  ·  SMART CONTRACT: OP_NET BITCOIN TESTNET  ·  UI: CYBERPUNK FINTECH
        </span>
      </footer>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg-void)',
  },

  // Header
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 32px',
    borderBottom: '1px solid var(--border-subtle)',
    background: 'linear-gradient(180deg, rgba(0,255,65,0.04) 0%, transparent 100%)',
    flexWrap: 'wrap',
    gap: 12,
  },
  headerLeft: { display: 'flex', flexDirection: 'column', gap: 4 },
  logo: {
    fontFamily: 'var(--font-display)',
    fontSize: 22,
    fontWeight: 900,
    letterSpacing: '0.1em',
  },
  logoBracket: { color: 'var(--text-secondary)' },
  logoText:    { color: 'var(--text-primary)' },
  logoSep:     { color: 'var(--text-muted)', margin: '0 4px' },
  logoAccent:  { color: 'var(--neon-green)', textShadow: 'var(--glow-green)' },
  headerSub: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    color: 'var(--text-muted)',
    letterSpacing: '0.15em',
  },
  headerRight: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 },
  liveIndicator: { display: 'flex', alignItems: 'center', gap: 6 },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: 'var(--neon-green)',
    boxShadow: 'var(--glow-green)',
    animation: 'pulse-glow 2s ease-in-out infinite',
    display: 'inline-block',
  },
  liveText: {
    fontFamily: 'var(--font-display)',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.2em',
    color: 'var(--neon-green)',
  },
  lastSync: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    color: 'var(--text-muted)',
    letterSpacing: '0.1em',
  },

  // Error
  errorBanner: {
    background: 'rgba(255,45,85,0.1)',
    border: '1px solid rgba(255,45,85,0.3)',
    color: 'var(--neon-red)',
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    padding: '10px 32px',
    letterSpacing: '0.05em',
  },
  errorIcon: { marginRight: 8 },

  // Main
  main: {
    flex: 1,
    padding: '32px',
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
    maxWidth: 1100,
    margin: '0 auto',
    width: '100%',
    animation: 'slide-in-up 0.4s ease-out',
  },

  // Cards
  cardsRow: {
    display: 'flex',
    gap: 20,
    flexWrap: 'wrap',
  },

  // Chart
  chartSection: { width: '100%' },

  // Sync panel
  syncPanel: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-lg)',
    padding: '24px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 20,
    flexWrap: 'wrap',
  },
  syncInfo: { flex: '1 1 400px' },
  syncInfoTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.2em',
    color: 'var(--neon-green)',
    marginBottom: 8,
  },
  syncInfoBody: {
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    color: 'var(--text-secondary)',
    lineHeight: 1.6,
    marginBottom: 10,
  },
  syncPreview: {
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    color: 'var(--text-secondary)',
    background: 'rgba(0,255,65,0.04)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-sm)',
    padding: '8px 12px',
    letterSpacing: '0.05em',
  },

  // Stats
  statsRow: {
    display: 'flex',
    gap: 0,
    borderTop: '1px solid var(--border-subtle)',
    paddingTop: 20,
    flexWrap: 'wrap',
  },
  statItem: {
    flex: '1 1 180px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: '0 16px',
    borderRight: '1px solid var(--border-subtle)',
  },
  statLabel: {
    fontFamily: 'var(--font-display)',
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.2em',
    color: 'var(--text-muted)',
  },
  statValue: {
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    color: 'var(--neon-green)',
    letterSpacing: '0.05em',
  },

  // Footer
  footer: {
    padding: '16px 32px',
    borderTop: '1px solid var(--border-subtle)',
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    letterSpacing: '0.1em',
    textAlign: 'center',
  },
};
