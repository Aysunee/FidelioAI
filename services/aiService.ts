import { Ticker, FuturesTicker } from "../types";
import { apiJson, ApiError } from '../utils/config';

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  sources?: { title: string; uri: string }[];
  timestamp: number;
}

// Stablecoins / fiat-pegged bases: their USDT pairs carry no market information for the analyst.
const STABLE_BASES = new Set(['USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'USDE', 'USD1', 'PYUSD', 'EUR', 'EURI', 'AEUR', 'XUSD', 'BFUSD', 'USDS']);

// Common names users type instead of tickers.
const NAME_ALIASES: Record<string, string> = {
  bitcoin: 'BTC', btc: 'BTC',
  ethereum: 'ETH', ether: 'ETH', eth: 'ETH',
  solana: 'SOL', sol: 'SOL',
  ripple: 'XRP', xrp: 'XRP',
  dogecoin: 'DOGE', doge: 'DOGE',
  bnb: 'BNB', binance: 'BNB',
  cardano: 'ADA', ada: 'ADA',
  avalanche: 'AVAX', avax: 'AVAX'
};

const TOP_SPOT_COUNT = 10;
const TOP_FUTURES_COUNT = 10;
const MAX_MENTIONED = 5;

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const isUsdtPair = (symbol: string) => {
  if (!symbol || !symbol.endsWith('USDT')) return false;
  const base = symbol.slice(0, -4);
  return base.length > 0 && !STABLE_BASES.has(base);
};

const formatPrice = (price: number) => {
  if (!isFiniteNumber(price)) return 'n/a';
  if (price >= 1000) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  return price.toPrecision(4);
};

const formatVolume = (v: number | undefined) => {
  if (!isFiniteNumber(v) || v <= 0) return 'n/a';
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
};

const formatPct = (v: number | undefined) => (isFiniteNumber(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : 'n/a');

// fundingRate is a fraction (0.0001 = 0.01%)
const formatFunding = (rate: number | undefined) => (isFiniteNumber(rate) ? `${(rate * 100).toFixed(4)}%` : 'n/a');

const describeSpot = (t: Ticker) =>
  `${t.symbol}: ${formatPrice(t.lastPrice)} USDT (24h ${formatPct(t.priceChangePercent)}, 24h vol ${formatVolume(t.volume)} USDT)`;

const describeFutures = (f: FuturesTicker) => {
  const parts = [
    `mark ${formatPrice(f.markPrice)} USDT`,
    `funding ${formatFunding(f.fundingRate)}`
  ];
  if (isFiniteNumber(f.priceChangePercent)) parts.push(`24h ${formatPct(f.priceChangePercent)}`);
  if (isFiniteNumber(f.volume) && f.volume > 0) parts.push(`24h vol ${formatVolume(f.volume)} USDT`);
  if (isFiniteNumber(f.nextFundingTime) && f.nextFundingTime > 0) parts.push(`next funding ${new Date(f.nextFundingTime).toISOString()}`);
  return `${f.symbol} perp: ${parts.join(', ')}`;
};

// Symbols the user explicitly asked about: all-caps tickers ("BTC", "PEPE") or well-known names ("bitcoin").
const extractMentionedSymbols = (
  prompt: string,
  spot: Record<string, Ticker>,
  futures: Record<string, FuturesTicker>
): string[] => {
  const found: string[] = [];
  const words = prompt.match(/[A-Za-z0-9]{2,15}/g) || [];
  for (const word of words) {
    const alias = NAME_ALIASES[word.toLowerCase()];
    const isTickerLike = word.length >= 2 && word === word.toUpperCase() && /[A-Z]/.test(word);
    const base = alias || (isTickerLike ? word.replace(/USDT$/, '') : null);
    if (!base) continue;
    const symbol = `${base}USDT`;
    if (!isUsdtPair(symbol)) continue;
    if (!spot[symbol] && !futures[symbol]) continue;
    if (!found.includes(symbol)) found.push(symbol);
    if (found.length >= MAX_MENTIONED) break;
  }
  return found;
};

export const buildMarketContext = (
  prompt: string,
  marketContext: { spot: Record<string, Ticker>; futures: Record<string, FuturesTicker> }
): string => {
  const spot = marketContext.spot || {};
  const futures = marketContext.futures || {};

  // Only USDT pairs, ranked by 24h quote volume (in USDT), so fiat pairs (IDR, ARS, JPY...) never dominate.
  const topSpot = Object.values(spot)
    .filter(t => t && isUsdtPair(t.symbol) && isFiniteNumber(t.lastPrice) && t.lastPrice > 0)
    .sort((a, b) => (b.volume || 0) - (a.volume || 0))
    .slice(0, TOP_SPOT_COUNT);

  const topFutures = Object.values(futures)
    .filter(f => f && isUsdtPair(f.symbol) && isFiniteNumber(f.markPrice) && f.markPrice > 0)
    .sort((a, b) => (b.volume || 0) - (a.volume || 0))
    .slice(0, TOP_FUTURES_COUNT);

  const mentioned = extractMentionedSymbols(prompt, spot, futures);

  const lines: string[] = [
    'All prices are quoted in USDT (Binance).',
    `Timestamp: ${new Date().toISOString()}`
  ];

  if (mentioned.length > 0) {
    lines.push('', 'Requested assets:');
    for (const symbol of mentioned) {
      if (spot[symbol]) lines.push(`- Spot ${describeSpot(spot[symbol])}`);
      if (futures[symbol] && isFiniteNumber(futures[symbol].markPrice)) lines.push(`- ${describeFutures(futures[symbol])}`);
    }
  }

  lines.push('', 'Top spot USDT pairs by 24h volume:');
  lines.push(topSpot.length > 0 ? topSpot.map(t => `- ${describeSpot(t)}`).join('\n') : '- (no spot data available yet)');

  lines.push('', 'Top USDT-M perpetual futures by 24h volume:');
  lines.push(topFutures.length > 0 ? topFutures.map(f => `- ${describeFutures(f)}`).join('\n') : '- (no futures data available yet)');

  return lines.join('\n');
};

export const generateAIResponse = async (
  prompt: string,
  marketContext: { spot: Record<string, Ticker>; futures: Record<string, FuturesTicker> }
): Promise<{ text: string; sources: { title: string; uri: string }[] }> => {

  const context = buildMarketContext(prompt, marketContext);

  try {
    const data = await apiJson<{ text?: string; sources?: { title: string; uri: string }[] }>('/api/analyze', {
      method: 'POST',
      body: JSON.stringify({ prompt, context })
    });

    return {
      text: typeof data?.text === 'string' && data.text ? data.text : '⚠️ Fidelio AI bir yanıt üretemedi.',
      sources: Array.isArray(data?.sources) ? data.sources : []
    };
  } catch (error: unknown) {
    console.error("Fidelio AI Error:", error);
    // ApiError carries the server's (Turkish) message; anything else is a network failure.
    const text = error instanceof ApiError && error.message
      ? `⚠️ ${error.message}`
      : '⚠️ Fidelio AI sunucusuna bağlanılamadı. Lütfen daha sonra tekrar deneyin.';
    return { text, sources: [] };
  }
};
