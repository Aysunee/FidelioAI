

import { Ticker, FuturesTicker, MarketIndex, Liquidation } from '../types';

// --- Reconnecting WebSocket wrapper ---
// Binance closes stream connections at least every 24h, and network changes / laptop sleep kill
// them silently. Every stream goes through this wrapper: it reports its status, reconnects with
// exponential backoff, treats a silent "open" socket as dead, and never reconnects after close().

export type StreamStatus = 'connecting' | 'connected' | 'disconnected';

interface ReconnectingSocketOptions {
  url: string;
  name: string;
  onMessage: (event: MessageEvent) => void;
  onStatus?: (status: StreamStatus) => void;
  // Force a reconnect when an open socket receives nothing for this long (0 disables the watchdog).
  silentTimeoutMs?: number;
}

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;

export const createReconnectingWebSocket = ({
  url,
  name,
  onMessage,
  onStatus,
  silentTimeoutMs = 20000
}: ReconnectingSocketOptions) => {
  let ws: WebSocket | null = null;
  let closedByUser = false;
  let attempt = 0;
  let lastMessageAt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let watchdogTimer: ReturnType<typeof setInterval> | null = null;

  const setStatus = (status: StreamStatus) => {
    if (closedByUser) return;
    try {
      onStatus?.(status);
    } catch (e) {
      console.error(`[${name}] status callback failed`, e);
    }
  };

  const detach = (socket: WebSocket | null) => {
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close();
    } catch { /* already closed */ }
  };

  const scheduleReconnect = () => {
    if (closedByUser || reconnectTimer) return;
    const delay = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** attempt) * (0.8 + Math.random() * 0.4);
    attempt = Math.min(attempt + 1, 10);
    setStatus('disconnected');
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const connect = () => {
    if (closedByUser) return;
    if (typeof WebSocket === 'undefined') {
      setStatus('disconnected');
      return;
    }

    setStatus('connecting');
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (e) {
      console.warn(`[${name}] WebSocket could not be created`, e);
      scheduleReconnect();
      return;
    }
    ws = socket;

    socket.onopen = () => {
      if (ws !== socket) return;
      lastMessageAt = Date.now();
      setStatus('connected');
    };

    socket.onmessage = (event) => {
      if (ws !== socket) return;
      lastMessageAt = Date.now();
      attempt = 0; // the stream really delivers data, reset the backoff
      onMessage(event);
    };

    socket.onerror = () => {
      if (ws !== socket) return;
      console.warn(`[${name}] WebSocket error`);
      // onclose follows and schedules the reconnect
    };

    socket.onclose = () => {
      if (ws !== socket) return;
      ws = null;
      scheduleReconnect();
    };
  };

  if (silentTimeoutMs > 0) {
    watchdogTimer = setInterval(() => {
      if (closedByUser || !ws || ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - lastMessageAt > silentTimeoutMs) {
        console.warn(`[${name}] no data for ${Math.round(silentTimeoutMs / 1000)}s, reconnecting`);
        const stale = ws;
        ws = null;
        detach(stale);
        scheduleReconnect();
      }
    }, 5000);
  }

  connect();

  return () => {
    closedByUser = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (watchdogTimer) clearInterval(watchdogTimer);
    reconnectTimer = null;
    watchdogTimer = null;
    const socket = ws;
    ws = null;
    detach(socket);
  };
};

// --- Binance Spot WebSocket Logic ---

type MiniTickerPayload = {
  s: string; // Symbol
  c: string; // Close price
  o: string; // Open price
  h: string; // High price
  l: string; // Low price
  v: string; // Total traded base asset volume
  q: string; // Total traded quote asset volume
  E: number; // Event time
};

export const connectToBinance = (
  onTickerUpdate: (tickers: Record<string, Ticker>) => void,
  onStatus?: (status: StreamStatus) => void
) => {
  // We throttle updates to avoid React rendering too often
  let pendingUpdates: Record<string, Ticker> = {};
  let throttleTimer: ReturnType<typeof setTimeout> | null = null;

  const close = createReconnectingWebSocket({
    url: 'wss://stream.binance.com:9443/ws/!miniTicker@arr',
    name: 'Binance Spot',
    onStatus,
    onMessage: (event) => {
      try {
        const data: MiniTickerPayload[] = JSON.parse(event.data);
        if (!Array.isArray(data)) return;

        data.forEach(t => {
          pendingUpdates[t.s] = {
            symbol: t.s,
            lastPrice: parseFloat(t.c),
            openPrice: parseFloat(t.o),
            highPrice: parseFloat(t.h),
            lowPrice: parseFloat(t.l),
            priceChangePercent: ((parseFloat(t.c) - parseFloat(t.o)) / parseFloat(t.o)) * 100,
            volume: parseFloat(t.q), // Using Quote volume (USDT value approx)
            updatedAt: t.E
          };
        });

        if (!throttleTimer) {
          throttleTimer = setTimeout(() => {
            onTickerUpdate({ ...pendingUpdates });
            pendingUpdates = {};
            throttleTimer = null;
          }, 1000); // Update UI once per second
        }
      } catch (e) {
        console.error("WS Parse Error", e);
      }
    }
  });

  return () => {
    close();
    if (throttleTimer) clearTimeout(throttleTimer);
    throttleTimer = null;
  };
};

// --- Binance Spot 24h snapshot (REST) ---
// `!miniTicker@arr` only carries symbols that changed in the last second, so a thinly traded coin has no
// data until its next trade. One REST snapshot at start fills those gaps. Symbols that are no longer
// trading (break / delisted) stay in /ticker/24hr with frozen values: they are skipped (no trades in
// the window or a window that ended long ago).
type Ticker24hMini = {
  symbol: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  lastPrice: string;
  quoteVolume: string;
  closeTime: number;
  count: number;
};

const SPOT_SNAPSHOT_URL = 'https://api.binance.com/api/v3/ticker/24hr?type=MINI';
const SNAPSHOT_MAX_AGE_MS = 60 * 60 * 1000;

export const fetchSpotTickerSnapshot = async (signal?: AbortSignal): Promise<Record<string, Ticker>> => {
  const response = await fetch(SPOT_SNAPSHOT_URL, { headers: { Accept: 'application/json' }, signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new Error('Beklenmeyen yanıt');
  const now = Date.now();
  const tickers: Record<string, Ticker> = {};
  for (const t of body as Ticker24hMini[]) {
    if (!t?.symbol || !(Number(t.count) > 0) || !(now - Number(t.closeTime) < SNAPSHOT_MAX_AGE_MS)) continue;
    const open = parseFloat(t.openPrice);
    const last = parseFloat(t.lastPrice);
    if (!Number.isFinite(open) || !Number.isFinite(last) || open <= 0) continue;
    tickers[t.symbol] = {
      symbol: t.symbol,
      lastPrice: last,
      openPrice: open,
      highPrice: parseFloat(t.highPrice),
      lowPrice: parseFloat(t.lowPrice),
      // Same formula as the miniTicker stream above
      priceChangePercent: ((last - open) / open) * 100,
      volume: parseFloat(t.quoteVolume),
      updatedAt: Number(t.closeTime)
    };
  }
  return tickers;
};

// --- Binance Spot rolling 1h ticker (`!ticker_1h@arr`) ---
// Statistics of the trailing hour for every symbol that traded in the last second. Payload verified
// live: e ('1hTicker'), E, s, p, P, w, o, h, l, c, v, q, O (window open, minute aligned), C, F, L, n.
// Only changed symbols are in a message, so the full picture builds up over the first ~30 s.

type RollingTickerPayload = {
  s: string; // Symbol
  P: string; // Price change percent over the window
  o: string; // Open price of the window
  c: string; // Last price
  q: string; // Quote asset volume traded in the window
  E: number; // Event time
};

export interface RollingHourTicker {
  symbol: string;
  quoteVolume: number;        // USDT traded in the last hour
  priceChangePercent: number; // price change over the last hour, percent
  lastPrice: number;
  eventTime: number;
}

// Delivers USDT pairs only, straight from the socket (no throttle: consumers keep the rows in a ref,
// not in React state).
export const connectToBinanceHourTicker = (
  onTickers: (tickers: RollingHourTicker[]) => void,
  onStatus?: (status: StreamStatus) => void
) => createReconnectingWebSocket({
  url: 'wss://stream.binance.com:9443/ws/!ticker_1h@arr',
  name: 'Binance Spot 1h',
  onStatus,
  onMessage: (event) => {
    try {
      const data: RollingTickerPayload[] = JSON.parse(event.data);
      if (!Array.isArray(data)) return;
      const rows: RollingHourTicker[] = [];
      data.forEach(t => {
        if (!t || typeof t.s !== 'string' || !t.s.endsWith('USDT')) return;
        const quoteVolume = parseFloat(t.q);
        if (!Number.isFinite(quoteVolume)) return;
        const open = parseFloat(t.o);
        const last = parseFloat(t.c);
        const percent = parseFloat(t.P);
        rows.push({
          symbol: t.s,
          quoteVolume,
          priceChangePercent: Number.isFinite(percent) ? percent : (open > 0 ? ((last - open) / open) * 100 : NaN),
          lastPrice: last,
          eventTime: t.E
        });
      });
      if (rows.length > 0) onTickers(rows);
    } catch (e) {
      console.error("1h ticker WS Parse Error", e);
    }
  }
});

// --- Binance Futures WebSocket Logic (Funding Rates & 24h Stats) ---

type MarkPricePayload = {
  s: string; // Symbol
  p: string; // Mark Price
  i: string; // Index Price
  P: string; // Estimated Settle Price
  r: string; // Funding Rate
  T: number; // Next Funding Time
};

export const connectToBinanceFutures = (
  onFuturesUpdate: (data: Record<string, Partial<FuturesTicker>>) => void,
  onStatus?: (status: StreamStatus) => void
) => {
  // We combine markPrice and miniTicker (for volume/24h h-l)
  const streams = ['!markPrice@arr@1s', '!miniTicker@arr'];

  let pendingUpdates: Record<string, Partial<FuturesTicker>> = {};
  let throttleTimer: ReturnType<typeof setTimeout> | null = null;

  const close = createReconnectingWebSocket({
    url: `wss://fstream.binance.com/market/stream?streams=${streams.join('/')}`,
    name: 'Binance Futures',
    onStatus,
    onMessage: (event) => {
      try {
        const wrapped = JSON.parse(event.data);
        const stream = wrapped.stream;
        const data = wrapped.data;
        if (!Array.isArray(data)) return;

        if (stream === '!markPrice@arr@1s') {
          (data as MarkPricePayload[]).forEach(t => {
            if (!t.s.endsWith('USDT')) return;
            pendingUpdates[t.s] = {
              ...pendingUpdates[t.s],
              symbol: t.s,
              markPrice: parseFloat(t.p),
              indexPrice: parseFloat(t.i),
              fundingRate: parseFloat(t.r),
              nextFundingTime: t.T
            };
          });
        } else if (stream === '!miniTicker@arr') {
          (data as MiniTickerPayload[]).forEach(t => {
            if (!t.s.endsWith('USDT')) return;
            pendingUpdates[t.s] = {
              ...pendingUpdates[t.s],
              symbol: t.s,
              lastPrice: parseFloat(t.c),
              highPrice: parseFloat(t.h),
              lowPrice: parseFloat(t.l),
              openPrice: parseFloat(t.o),
              volume: parseFloat(t.q), // Volume in USDT
              priceChangePercent: ((parseFloat(t.c) - parseFloat(t.o)) / parseFloat(t.o)) * 100
            };
          });
        }

        if (!throttleTimer) {
          throttleTimer = setTimeout(() => {
            onFuturesUpdate({ ...pendingUpdates });
            pendingUpdates = {};
            throttleTimer = null;
          }, 1000);
        }

      } catch (e) {
        console.error("Futures WS Parse Error", e);
      }
    }
  });

  return () => {
    close();
    if (throttleTimer) clearTimeout(throttleTimer);
    throttleTimer = null;
  };
};

// --- Binance Liquidations WebSocket Logic ---

type ForceOrderPayload = {
  e: string; // Event Type
  o: {
    s: string; // Symbol
    S: string; // Side of the FORCE ORDER (SELL = Long Liquidation, BUY = Short Liquidation)
    o: string; // Order Type
    q: string; // Original Quantity
    p: string; // Price
    ap: string; // Average Price
    X: string; // Status
    l: string; // Last Filled Quantity
    z: string; // Accumulated Filled Quantity
    T: number; // Trade Time
  }
};

export const connectToLiquidations = (
  onLiquidation: (liq: Liquidation) => void,
  onStatus?: (status: StreamStatus) => void
) => {
  return createReconnectingWebSocket({
    url: 'wss://fstream.binance.com/market/ws/!forceOrder@arr',
    name: 'Binance Liquidations',
    onStatus,
    // Liquidations only arrive when they happen, so quiet minutes are normal for this stream.
    silentTimeoutMs: 5 * 60 * 1000,
    onMessage: (event) => {
      try {
        const payload: ForceOrderPayload = JSON.parse(event.data);
        const o = payload?.o;
        if (!o || typeof o.s !== 'string') return;

        if (!o.s.endsWith('USDT')) return;

        const price = parseFloat(o.ap);
        const amount = parseFloat(o.q);
        const value = price * amount;

        // Filter tiny liquidations to reduce noise (e.g., < $500)
        if (value < 5000) return;

        const liq: Liquidation = {
          id: `${o.s}_${o.T}_${Math.random().toString(36).substring(7)}`,
          symbol: o.s,
          // If the Force Order is SELL, it means a LONG position is being closed.
          // If the Force Order is BUY, it means a SHORT position is being closed.
          side: o.S === 'SELL' ? 'LONG' : 'SHORT',
          price: price,
          amount: amount,
          value: value,
          time: o.T
        };

        onLiquidation(liq);

      } catch (e) {
        console.error("Liquidation WS Parse Error", e);
      }
    }
  });
};

// --- Global crypto market indices (BTC.D, TOTAL, TOTAL3, USDT.D) ---
// Real data from CoinGecko's free /global endpoint (CORS enabled), refreshed about once a minute.
// NASDAQ / S&P 500 have no free CORS-friendly source and are therefore not provided at all.
// A value without a 24h change in the source carries NaN as change so the UI can show '—'.

export const COINGECKO_GLOBAL_URL = 'https://api.coingecko.com/api/v3/global';
export const GLOBAL_INDEX_SYMBOLS = ['BTC.D', 'TOTAL', 'TOTAL3', 'USDT.D'] as const;

const GLOBAL_POLL_INTERVAL_MS = 60 * 1000;
const GLOBAL_MAX_BACKOFF_MS = 5 * 60 * 1000;
const GLOBAL_MAX_DATA_AGE_MS = 10 * 60 * 1000; // older than this -> show as unavailable
const GLOBAL_REQUEST_TIMEOUT_MS = 15 * 1000;

export const parseCoinGeckoGlobal = (body: any): MarketIndex[] | null => {
  const data = body?.data;
  const total = Number(data?.total_market_cap?.usd);
  const btcDominance = Number(data?.market_cap_percentage?.btc);
  const ethDominance = Number(data?.market_cap_percentage?.eth);
  const usdtDominance = Number(data?.market_cap_percentage?.usdt);
  const totalChangePct = Number(data?.market_cap_change_percentage_24h_usd);

  if (!(total > 0) || !Number.isFinite(btcDominance) || !Number.isFinite(ethDominance)) return null;

  const hasTotalChange = Number.isFinite(totalChangePct) && totalChangePct > -100;
  const indices: MarketIndex[] = [
    { symbol: 'BTC.D', price: btcDominance, change: NaN, changePercent: NaN },
    {
      symbol: 'TOTAL',
      price: total,
      change: hasTotalChange ? total - total / (1 + totalChangePct / 100) : NaN,
      changePercent: hasTotalChange ? totalChangePct : NaN
    },
    { symbol: 'TOTAL3', price: total * (1 - (btcDominance + ethDominance) / 100), change: NaN, changePercent: NaN }
  ];
  if (Number.isFinite(usdtDominance)) {
    indices.push({ symbol: 'USDT.D', price: usdtDominance, change: NaN, changePercent: NaN });
  }
  return indices;
};

export const startGlobalMarketPoller = (onUpdate: (indices: MarketIndex[]) => void) => {
  let stopped = false;
  let failures = 0;
  let lastSuccessAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;

  const poll = async () => {
    if (stopped) return;
    controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = setTimeout(() => controller?.abort(), GLOBAL_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(COINGECKO_GLOBAL_URL, {
        headers: { Accept: 'application/json' },
        signal: controller?.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const indices = parseCoinGeckoGlobal(await response.json());
      if (!indices) throw new Error('unexpected response shape');
      if (stopped) return;
      failures = 0;
      lastSuccessAt = Date.now();
      onUpdate(indices);
    } catch (e) {
      if (stopped) return;
      failures++;
      console.warn('[CoinGecko] global market data unavailable:', e instanceof Error ? e.message : e);
      // Keep showing the last good values for a while; after that report them as unavailable.
      if (!lastSuccessAt || Date.now() - lastSuccessAt > GLOBAL_MAX_DATA_AGE_MS) onUpdate([]);
    } finally {
      clearTimeout(timeout);
      controller = null;
      if (!stopped) {
        const delay = failures === 0
          ? GLOBAL_POLL_INTERVAL_MS
          : Math.min(GLOBAL_MAX_BACKOFF_MS, GLOBAL_POLL_INTERVAL_MS * 2 ** Math.min(failures - 1, 3));
        timer = setTimeout(poll, delay);
      }
    }
  };

  poll();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    controller?.abort();
  };
};

// --- REST API: Fetch Historical Klines (Candles) ---

export interface Kline {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export const fetchKlines = async (symbol: string, interval: string = '15m', limit: number = 100): Promise<Kline[]> => {
  try {
    const response = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
    const data = await response.json();

    // Binance API returns array of arrays:
    // [
    //   [
    //     1499040000000,      // Open time
    //     "0.01634790",       // Open
    //     "0.80000000",       // High
    //     "0.01575800",       // Low
    //     "0.01577100",       // Close
    //     ...
    //   ]
    // ]

    return data.map((d: any) => ({
      time: d[0] / 1000, // Lightweight charts expects seconds (or business days)
      open: parseFloat(d[1]),
      high: parseFloat(d[2]),
      low: parseFloat(d[3]),
      close: parseFloat(d[4])
    }));
  } catch (error) {
    console.error("Failed to fetch klines", error);
    return [];
  }
};

// --- Shared crypto-perpetual universe (USDT-M futures) ---
// The futures streams also carry stock / commodity contracts ('TRADIFI_PERPETUAL'), quarterly
// contracts and contracts that are being delisted ('SETTLING'). Every engine that looks at futures
// (funding regime, perp big moves, the Anomaly Radar) works on TRADING + PERPETUAL + USDT contracts
// only. One request, cached in memory for an hour; a failed refresh keeps the last good list.

const FUTURES_EXCHANGE_INFO_URL = 'https://fapi.binance.com/fapi/v1/exchangeInfo';
const FUTURES_FUNDING_INFO_URL = 'https://fapi.binance.com/fapi/v1/fundingInfo';
const FUTURES_META_TTL_MS = 60 * 60 * 1000;
const FUTURES_META_RETRY_MS = 60 * 1000;
const FUTURES_META_TIMEOUT_MS = 20 * 1000;

const fetchFuturesMeta = async (url: string): Promise<unknown> => {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = setTimeout(() => controller?.abort(), FUTURES_META_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller?.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
};

// One cached value with a TTL: concurrent callers share the request, a failure is retried at most
// once a minute, and an expired value stays available while (or if) the refresh fails.
const createCachedLoader = <T>(name: string, load: () => Promise<T>) => {
  let cache: { value: T; fetchedAt: number } | null = null;
  let request: Promise<T> | null = null;
  let failedAt = 0;

  const get = (): Promise<T> => {
    const now = Date.now();
    if (cache && now - cache.fetchedAt < FUTURES_META_TTL_MS) return Promise.resolve(cache.value);
    if (request) return request;
    if (now - failedAt < FUTURES_META_RETRY_MS) {
      return cache ? Promise.resolve(cache.value) : Promise.reject(new Error(`${name} yüklenemedi`));
    }
    request = (async () => {
      try {
        const value = await load();
        cache = { value, fetchedAt: Date.now() };
        return value;
      } catch (e) {
        failedAt = Date.now();
        console.warn(`[Binance Futures] ${name} yüklenemedi:`, e instanceof Error ? e.message : e);
        if (cache) return cache.value;
        throw e;
      } finally {
        request = null;
      }
    })();
    return request;
  };

  return { get, peek: (): T | null => (cache ? cache.value : null) };
};

export const parseCryptoPerpSymbols = (body: unknown): Set<string> => {
  const symbols = new Set<string>();
  const list = (body as { symbols?: unknown } | null)?.symbols;
  if (!Array.isArray(list)) return symbols;
  list.forEach((s: any) => {
    if (!s || typeof s.symbol !== 'string') return;
    // contractType 'PERPETUAL' only: 'TRADIFI_PERPETUAL' (stocks, metals, ETFs) and dated contracts are out.
    if (s.status === 'TRADING' && s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT') symbols.add(s.symbol);
  });
  return symbols;
};

const cryptoPerpLoader = createCachedLoader<Set<string>>('Kripto perp listesi', async () => {
  const symbols = parseCryptoPerpSymbols(await fetchFuturesMeta(FUTURES_EXCHANGE_INFO_URL));
  if (symbols.size === 0) throw new Error('beklenmeyen yanıt');
  return symbols;
});

/** TRADING + PERPETUAL + USDT crypto contracts. Rejects only when the list has never been loaded. */
export async function getCryptoPerpSymbols(): Promise<Set<string>> {
  return cryptoPerpLoader.get();
}

/** The last loaded list, or null until getCryptoPerpSymbols() has succeeded once. Never fetches. */
export const getCryptoPerpSymbolsSync = (): Set<string> | null => cryptoPerpLoader.peek();

// --- Funding intervals (hours) ---
// GET /fapi/v1/fundingInfo lists the contracts whose interval differs from (or was adjusted around)
// the 8h default; a contract missing from a LOADED map settles every 8 hours. While the map is not
// loaded the interval is unknown and 8h-equivalent rates must not be computed (most contracts are 4h).

export const parseFundingIntervals = (body: unknown): Map<string, number> => {
  const intervals = new Map<string, number>();
  if (!Array.isArray(body)) return intervals;
  body.forEach((row: any) => {
    const hours = Number(row?.fundingIntervalHours);
    if (row && typeof row.symbol === 'string' && Number.isFinite(hours) && hours > 0) intervals.set(row.symbol, hours);
  });
  return intervals;
};

const fundingIntervalLoader = createCachedLoader<Map<string, number>>('Fonlama aralıkları', async () => {
  const body = await fetchFuturesMeta(FUTURES_FUNDING_INFO_URL);
  if (!Array.isArray(body)) throw new Error('beklenmeyen yanıt');
  return parseFundingIntervals(body);
});

export async function getFundingIntervals(): Promise<Map<string, number>> {
  return fundingIntervalLoader.get();
}

/** The last loaded interval map, or null until getFundingIntervals() has succeeded once. */
export const getFundingIntervalsSync = (): Map<string, number> | null => fundingIntervalLoader.peek();
