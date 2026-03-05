// Binance public API — no key, no CORS issues on localhost
const BASE = 'https://api.binance.com/api/v3';

export interface BTCSpotPrice {
  usd: number;
  usd_24h_change: number;
  last_updated_at: number; // unix timestamp (seconds)
}

export interface PricePoint {
  timestamp: number; // ms
  price: number;     // USD
}

/**
 * Fetch the current BTC spot price plus 24-hour change percentage.
 * Uses Binance /ticker/24hr — public, no key required.
 */
export async function fetchSpotPrice(): Promise<BTCSpotPrice> {
  const res = await fetch(`${BASE}/ticker/24hr?symbol=BTCUSDT`);
  if (!res.ok) throw new Error(`Binance spot error: ${res.status}`);
  const d = await res.json();
  return {
    usd:             parseFloat(d.lastPrice),
    usd_24h_change:  parseFloat(d.priceChangePercent),
    last_updated_at: Math.floor(d.closeTime / 1000),
  };
}

/**
 * Fetch hourly close prices for the last 24 hours.
 * Uses Binance /klines — public, no key required.
 * Kline format: [openTime, open, high, low, close, vol, closeTime, ...]
 */
export async function fetchPriceHistory(_days: 1 | 7 | 30 = 1): Promise<PricePoint[]> {
  const res = await fetch(`${BASE}/klines?symbol=BTCUSDT&interval=1h&limit=24`);
  if (!res.ok) throw new Error(`Binance klines error: ${res.status}`);
  const rows: [number, string, string, string, string, ...unknown[]][] = await res.json();
  return rows.map((r) => ({
    timestamp: r[0],          // openTime in ms
    price:     parseFloat(r[4]), // close price
  }));
}

export function formatUSD(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
