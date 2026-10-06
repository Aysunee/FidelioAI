// Data layer for the Terminal page: Binance USDⓈ-M futures (public REST + WebSocket).
//
// Every exported function either resolves or rejects with an Error whose message is Turkish
// and safe to show in the UI. Nothing here throws synchronously.

import type { Candle, ChartInterval, FuturesRow, RatioPeriod, SideRatio } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FAPI_BASE = 'https://fapi.binance.com';
const SPOT_BASE = 'https://api.binance.com';

// Binance serves USDⓈ-M market streams (ticker, markPrice, kline) on the `/market` route.
// The legacy `/stream` route still accepts connections but currently delivers no data, so it is
// kept only as a fallback that is tried when the primary route cannot be reached.
const WS_BASES = ['wss://fstream.binance.com/market/stream', 'wss://fstream.binance.com/stream'];

const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_FUNDING_INTERVAL_HOURS = 8;
const TICKER_PATCH_INTERVAL_MS = 1_000;
const TICKER_STALE_MS = 30_000; // !markPrice@arr@1s pushes every second; silence means a dead socket
const WS_BACKOFF_BASE_MS = 1_000;
const WS_BACKOFF_MAX_MS = 30_000;

const KLINE_INTERVALS: readonly ChartInterval[] = ['1m', '5m', '15m', '1h', '4h', '1d'];
const RATIO_PERIODS: readonly RatioPeriod[] = ['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d'];
const PERPETUAL_CONTRACT_TYPES = new Set(['PERPETUAL', 'TRADIFI_PERPETUAL']);

const MSG = {
    network: 'Binance sunucusuna ulaşılamadı. İnternet bağlantınızı kontrol edin.',
    timeout: 'Binance isteği zaman aşımına uğradı.',
    rateLimit: 'Binance istek limiti aşıldı. Lütfen biraz sonra tekrar deneyin.',
    parse: 'Binance yanıtı okunamadı.',
    universe: 'Vadeli işlem piyasa listesi alınamadı.',
    unknownKind: 'Bilinmeyen oran türü.',
    invalidInterval: (interval: string) => `Geçersiz grafik aralığı: ${interval}`,
    invalidPeriod: (period: string) => `Geçersiz periyot: ${period}`,
    invalidSymbol: (symbol: string) => `Geçersiz sembol: ${symbol || '(boş)'}`,
    http: (status: number) => `Binance isteği başarısız oldu (HTTP ${status}).`,
};

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

class BinanceRequestError extends Error {
    status: number;
    code: number | null;
    retryAfterMs: number | null;

    constructor(message: string, status: number, code: number | null, retryAfterMs: number | null) {
        super(message);
        this.name = 'BinanceRequestError';
        this.status = status;
        this.code = code;
        this.retryAfterMs = retryAfterMs;
    }
}

const isRateLimitStatus = (status: number): boolean => status === 429 || status === 418;

/** Binance answers -1121 (HTTP 400) for symbols that do not exist on that market. */
const isInvalidSymbolError = (err: unknown): boolean =>
    err instanceof BinanceRequestError && err.status === 400 && (err.code === -1121 || err.code === -1100);

const toError = (err: unknown, fallback: string): Error =>
    err instanceof Error && err.message ? err : new Error(fallback);

const buildUrl = (base: string, path: string, params?: Record<string, string | number>): string => {
    if (!params) return `${base}${path}`;
    const qs = Object.entries(params)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
    return `${base}${path}?${qs}`;
};

/** Fetch Priority hint: chart history ('high') wins the bandwidth race against bulk/secondary data ('low'). */
type FetchPriority = 'high' | 'low' | 'auto';

async function fetchJson(
    url: string,
    timeoutMs: number = REQUEST_TIMEOUT_MS,
    priority?: FetchPriority,
): Promise<unknown> {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
        let res: Response;
        try {
            // `priority` is ignored by browsers that do not support it.
            const init: RequestInit & { priority?: FetchPriority } = {};
            if (controller) init.signal = controller.signal;
            if (priority) init.priority = priority;
            res = await fetch(url, init);
        } catch {
            throw new Error(controller?.signal.aborted ? MSG.timeout : MSG.network);
        }

        if (!res.ok) {
            let code: number | null = null;
            try {
                const body = (await res.json()) as { code?: unknown };
                if (typeof body?.code === 'number') code = body.code;
            } catch {
                /* error body is optional */
            }
            if (isRateLimitStatus(res.status)) {
                const retryAfterSec = Number(res.headers.get('Retry-After'));
                const retryAfterMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : null;
                throw new BinanceRequestError(MSG.rateLimit, res.status, code, retryAfterMs);
            }
            throw new BinanceRequestError(MSG.http(res.status), res.status, code, null);
        }

        try {
            return await res.json();
        } catch {
            throw new Error(controller?.signal.aborted ? MSG.timeout : MSG.parse);
        }
    } finally {
        if (timer) clearTimeout(timer);
    }
}

const num = (value: unknown, fallback = 0): number => {
    const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
    return Number.isFinite(n) ? n : fallback;
};

/** Upper-cases and validates a symbol. Binance also lists symbols with CJK characters. */
const normalizeSymbol = (symbol: string): string | null => {
    const s = String(symbol ?? '').trim().toUpperCase();
    return /^[\p{L}\p{N}_]{2,40}$/u.test(s) ? s : null;
};

const requireSymbol = (symbol: string): string => {
    const s = normalizeSymbol(symbol);
    if (!s) throw new Error(MSG.invalidSymbol(String(symbol ?? '')));
    return s;
};

const clampInt = (value: number | undefined, fallback: number, min: number, max: number): number => {
    const n = Math.floor(Number.isFinite(value as number) ? (value as number) : fallback);
    return Math.min(max, Math.max(min, n));
};

// ---------------------------------------------------------------------------
// Shared queue for /futures/data/* (limit ≈1000 requests / 5 min / IP)
// ---------------------------------------------------------------------------

type QueuePriority = 'high' | 'low';

interface QueueTask {
    run: () => Promise<void>;
    reject: (err: Error) => void;
}

const FD_MAX_CONCURRENT = 4;
const FD_WINDOW_MS = 5 * 60_000;
// Binance allows ~1000 requests / 5 min per IP for /futures/data/*. Stay well below it: the same IP may
// have the terminal open in several tabs (each tab has its own budget) or use other tools.
const FD_BUDGET_TOTAL = 600;
const FD_BUDGET_LOW = 400;    // watchlist (low priority) may not starve the sentiment panel
const FD_DEFAULT_BLOCK_MS = 60_000;

const fdHighQueue: QueueTask[] = []; // FIFO
const fdLowQueue: QueueTask[] = [];  // LIFO: the most recently requested (visible) rows go first
const fdStartTimes: number[] = [];
let fdActive = 0;
let fdBlockedUntil = 0;
let fdPumpTimer: ReturnType<typeof setTimeout> | null = null;

function pumpFuturesDataQueue(): void {
    const now = Date.now();

    if (fdBlockedUntil > now) {
        const err = new Error(MSG.rateLimit);
        fdHighQueue.splice(0).forEach((t) => t.reject(err));
        fdLowQueue.splice(0).forEach((t) => t.reject(err));
        return;
    }

    while (fdStartTimes.length && now - fdStartTimes[0] >= FD_WINDOW_MS) fdStartTimes.shift();

    while (fdActive < FD_MAX_CONCURRENT) {
        let task: QueueTask | undefined;
        if (fdHighQueue.length && fdStartTimes.length < FD_BUDGET_TOTAL) task = fdHighQueue.shift();
        else if (fdLowQueue.length && fdStartTimes.length < FD_BUDGET_LOW) task = fdLowQueue.pop();
        if (!task) break;

        fdActive++;
        fdStartTimes.push(now);
        task.run().finally(() => {
            fdActive--;
            pumpFuturesDataQueue();
        });
    }

    // Work left but nothing running for it: we are waiting for the 5-minute budget to free up.
    const pending = fdHighQueue.length + fdLowQueue.length;
    if (pending && fdActive < FD_MAX_CONCURRENT && fdStartTimes.length && !fdPumpTimer) {
        const wait = Math.max(50, FD_WINDOW_MS - (now - fdStartTimes[0]) + 50);
        fdPumpTimer = setTimeout(() => {
            fdPumpTimer = null;
            pumpFuturesDataQueue();
        }, wait);
    }
}

function enqueueFuturesData<T>(fn: () => Promise<T>, priority: QueuePriority): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const task: QueueTask = {
            reject,
            run: () =>
                fn().then(resolve, (err: unknown) => {
                    if (err instanceof BinanceRequestError && isRateLimitStatus(err.status)) {
                        fdBlockedUntil = Math.max(fdBlockedUntil, Date.now() + (err.retryAfterMs ?? FD_DEFAULT_BLOCK_MS));
                    }
                    reject(toError(err, MSG.network));
                }),
        };
        (priority === 'high' ? fdHighQueue : fdLowQueue).push(task);
        pumpFuturesDataQueue();
    });
}

/**
 * Raw GET of a /futures/data/* endpoint through the shared queue above, so other modules (funding
 * squeeze data) spend the same per-IP budget instead of running a second, uncoordinated one.
 * Resolves with the parsed JSON; rejects with a Turkish Error. Never throws synchronously.
 */
export function queuedFuturesDataFetch(
    path: string,
    params: Record<string, string | number>,
    priority: 'high' | 'low' = 'low',
): Promise<unknown> {
    if (typeof path !== 'string' || !path.startsWith('/futures/data/')) {
        return Promise.reject(new Error('Geçersiz istek yolu.'));
    }
    return enqueueFuturesData(
        async () => fetchJson(buildUrl(FAPI_BASE, path, params), REQUEST_TIMEOUT_MS, 'low'),
        priority === 'high' ? 'high' : 'low',
    );
}

// ---------------------------------------------------------------------------
// Universe (exchangeInfo + ticker/24hr + premiumIndex + fundingInfo)
// ---------------------------------------------------------------------------

interface ExchangeInfoSymbol {
    symbol: string;
    contractType: string;
    status: string;
    baseAsset: string;
    quoteAsset: string;
}

interface Ticker24hr {
    symbol: string;
    lastPrice: string;
    priceChangePercent: string;
    quoteVolume: string;
}

interface PremiumIndex {
    symbol: string;
    markPrice: string;
    indexPrice: string;
    lastFundingRate: string;
    nextFundingTime: number;
}

interface FundingInfo {
    symbol: string;
    fundingIntervalHours: number;
}

/** USDT perpetual symbols currently trading; used to drop WS patches for other markets. */
let knownSymbols: Set<string> | null = null;

export async function fetchFuturesUniverse(): Promise<FuturesRow[]> {
    try {
        // Large responses, fetched at low priority so the charts' kline requests are not starved.
        const [infoRaw, tickersRaw, premiumRaw, fundingRaw] = await Promise.all([
            fetchJson(buildUrl(FAPI_BASE, '/fapi/v1/exchangeInfo'), 15_000, 'low'),
            fetchJson(buildUrl(FAPI_BASE, '/fapi/v1/ticker/24hr'), REQUEST_TIMEOUT_MS, 'low'),
            // Non-critical: the markPrice stream fills these within a second.
            fetchJson(buildUrl(FAPI_BASE, '/fapi/v1/premiumIndex'), REQUEST_TIMEOUT_MS, 'low').catch(() => [] as unknown),
            // Only symbols with non-default settings are listed; everything else is 8h.
            fetchJson(buildUrl(FAPI_BASE, '/fapi/v1/fundingInfo'), REQUEST_TIMEOUT_MS, 'low').catch(() => [] as unknown),
        ]);

        const symbols = (infoRaw as { symbols?: ExchangeInfoSymbol[] } | null)?.symbols;
        if (!Array.isArray(symbols) || !Array.isArray(tickersRaw)) throw new Error(MSG.parse);

        const tickers = new Map<string, Ticker24hr>();
        for (const t of tickersRaw as Ticker24hr[]) if (t?.symbol) tickers.set(t.symbol, t);

        const premium = new Map<string, PremiumIndex>();
        if (Array.isArray(premiumRaw)) for (const p of premiumRaw as PremiumIndex[]) if (p?.symbol) premium.set(p.symbol, p);

        const fundingHours = new Map<string, number>();
        if (Array.isArray(fundingRaw)) {
            for (const f of fundingRaw as FundingInfo[]) {
                const h = num(f?.fundingIntervalHours, 0);
                if (f?.symbol && h > 0) fundingHours.set(f.symbol, h);
            }
        }

        const rows: FuturesRow[] = [];
        for (const s of symbols) {
            if (s.status !== 'TRADING' || s.quoteAsset !== 'USDT' || !PERPETUAL_CONTRACT_TYPES.has(s.contractType)) continue;
            const t = tickers.get(s.symbol);
            if (!t) continue; // listed but not trading yet
            const p = premium.get(s.symbol);
            const price = num(t.lastPrice);
            rows.push({
                symbol: s.symbol,
                baseAsset: s.baseAsset,
                ...(s.contractType === 'TRADIFI_PERPETUAL' ? { isTradFi: true } : {}),
                price,
                changePct: num(t.priceChangePercent),
                quoteVolume: num(t.quoteVolume),
                fundingRate: num(p?.lastFundingRate),
                fundingIntervalHours: fundingHours.get(s.symbol) ?? DEFAULT_FUNDING_INTERVAL_HOURS,
                nextFundingTime: num(p?.nextFundingTime),
                markPrice: num(p?.markPrice, price),
                indexPrice: num(p?.indexPrice, price),
            });
        }

        if (!rows.length) throw new Error(MSG.universe);
        rows.sort((a, b) => b.quoteVolume - a.quoteVolume);
        knownSymbols = new Set(rows.map((r) => r.symbol));
        return rows;
    } catch (err) {
        throw toError(err, MSG.universe);
    }
}

// ---------------------------------------------------------------------------
// WebSocket with reconnect + exponential backoff
// ---------------------------------------------------------------------------

interface StreamOptions {
    streams: string[];
    onMessage: (stream: string, data: unknown) => void;
    /** Force a reconnect when no message arrives for this long (only for streams that push constantly). */
    staleMs?: number;
    /** Delay before the first connection attempt (cancelled if the subscription is closed meanwhile). */
    openDelayMs?: number;
}

let preferredWsBase = 0;

function openCombinedStream({ streams, onMessage, staleMs, openDelayMs = 0 }: StreamOptions): () => void {
    if (typeof window === 'undefined' || typeof WebSocket === 'undefined' || !streams.length) return () => {};

    let ws: WebSocket | null = null;
    let closedByUser = false;
    let attempt = 0;
    let baseIndex = preferredWsBase;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let staleTimer: ReturnType<typeof setTimeout> | null = null;

    const query = streams.map((s) => encodeURIComponent(s)).join('/');

    const clearStale = () => {
        if (staleTimer) clearTimeout(staleTimer);
        staleTimer = null;
    };

    const armStale = (socket: WebSocket) => {
        if (!staleMs) return;
        clearStale();
        staleTimer = setTimeout(() => {
            try {
                socket.close();
            } catch {
                /* ignore */
            }
        }, staleMs);
    };

    const scheduleReconnect = () => {
        if (closedByUser || reconnectTimer) return;
        const delay = Math.min(WS_BACKOFF_MAX_MS, WS_BACKOFF_BASE_MS * 2 ** attempt) * (0.8 + Math.random() * 0.4);
        attempt = Math.min(attempt + 1, 10);
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
        }, delay);
    };

    const connect = () => {
        if (closedByUser) return;
        let socket: WebSocket;
        try {
            socket = new WebSocket(`${WS_BASES[baseIndex]}?streams=${query}`);
        } catch {
            baseIndex = (baseIndex + 1) % WS_BASES.length;
            scheduleReconnect();
            return;
        }
        ws = socket;
        let opened = false;
        let received = false;
        armStale(socket); // also bounds a connection stuck in CONNECTING

        socket.onopen = () => {
            opened = true;
            armStale(socket);
        };

        socket.onmessage = (event: MessageEvent) => {
            if (closedByUser || ws !== socket) return;
            if (!received) {
                received = true;
                attempt = 0;
                preferredWsBase = baseIndex;
            }
            armStale(socket);
            let msg: { stream?: unknown; data?: unknown };
            try {
                msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
            } catch {
                return;
            }
            if (typeof msg?.stream !== 'string') return;
            try {
                onMessage(msg.stream, msg.data);
            } catch (err) {
                console.error('[terminalData] stream handler error', err);
            }
        };

        socket.onerror = () => {
            /* onclose follows and handles reconnection */
        };

        socket.onclose = () => {
            if (ws !== socket) return;
            ws = null;
            clearStale();
            if (closedByUser) return;
            // Route unreachable, or (for constantly pushing streams) connected but silent → try the other route.
            if (!opened || (staleMs && !received)) baseIndex = (baseIndex + 1) % WS_BASES.length;
            scheduleReconnect();
        };
    };

    // Deferred open: React StrictMode (dev) mounts, unmounts and re-mounts effects synchronously, and a
    // user clicking quickly through the watchlist unsubscribes within milliseconds. Closing a socket that
    // is still CONNECTING logs a browser warning and counts against Binance's 300 connections / 5 min per
    // IP; a pending open is simply cancelled instead.
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
    }, Math.max(0, openDelayMs));

    return () => {
        closedByUser = true;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = null;
        clearStale();
        const socket = ws;
        ws = null;
        if (socket) {
            socket.onopen = null;
            socket.onmessage = null;
            socket.onerror = null;
            socket.onclose = null;
            try {
                socket.close();
            } catch {
                /* ignore */
            }
        }
    };
}

interface WsTicker {
    s: string;
    c: string;
    P: string;
    q: string;
}

interface WsMarkPrice {
    s: string;
    p: string;
    i: string;
    r: string;
    T: number;
}

const isUsdtSymbol = (symbol: string): boolean =>
    knownSymbols ? knownSymbols.has(symbol) : /USDT$/.test(symbol);

export function subscribeFuturesTickers(
    onPatch: (patch: Record<string, Partial<FuturesRow>>) => void,
): () => void {
    let pending: Record<string, Partial<FuturesRow>> = {};
    let hasPending = false;
    let lastFlush = 0;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let active = true;

    const flush = () => {
        flushTimer = null;
        if (!active || !hasPending) return;
        const batch = pending;
        pending = {};
        hasPending = false;
        lastFlush = Date.now();
        try {
            onPatch(batch);
        } catch (err) {
            console.error('[terminalData] ticker patch handler error', err);
        }
    };

    const merge = (symbol: string, patch: Partial<FuturesRow>) => {
        pending[symbol] = pending[symbol] ? Object.assign(pending[symbol], patch) : patch;
        hasPending = true;
        if (!flushTimer) flushTimer = setTimeout(flush, Math.max(0, lastFlush + TICKER_PATCH_INTERVAL_MS - Date.now()));
    };

    const close = openCombinedStream({
        streams: ['!ticker@arr', '!markPrice@arr@1s'],
        staleMs: TICKER_STALE_MS,
        onMessage: (stream, data) => {
            if (!Array.isArray(data)) return;
            if (stream === '!ticker@arr') {
                for (const t of data as WsTicker[]) {
                    if (!t?.s || !isUsdtSymbol(t.s)) continue;
                    const patch: Partial<FuturesRow> = {};
                    const price = num(t.c, NaN);
                    const changePct = num(t.P, NaN);
                    const quoteVolume = num(t.q, NaN);
                    if (Number.isFinite(price)) patch.price = price;
                    if (Number.isFinite(changePct)) patch.changePct = changePct;
                    if (Number.isFinite(quoteVolume)) patch.quoteVolume = quoteVolume;
                    merge(t.s, patch);
                }
            } else if (stream.startsWith('!markPrice@arr')) {
                for (const m of data as WsMarkPrice[]) {
                    if (!m?.s || !isUsdtSymbol(m.s)) continue;
                    const patch: Partial<FuturesRow> = {};
                    const markPrice = num(m.p, NaN);
                    const indexPrice = num(m.i, NaN);
                    const fundingRate = num(m.r, NaN);
                    const nextFundingTime = num(m.T, NaN);
                    if (Number.isFinite(markPrice)) patch.markPrice = markPrice;
                    if (Number.isFinite(indexPrice)) patch.indexPrice = indexPrice;
                    if (Number.isFinite(fundingRate)) patch.fundingRate = fundingRate;
                    if (Number.isFinite(nextFundingTime) && nextFundingTime > 0) patch.nextFundingTime = nextFundingTime;
                    merge(m.s, patch);
                }
            }
        },
    });

    return () => {
        active = false;
        if (flushTimer) clearTimeout(flushTimer);
        flushTimer = null;
        pending = {};
        close();
    };
}

// ---------------------------------------------------------------------------
// Klines: REST history with in-flight de-duplication, a memory + localStorage cache and prefetch
// ---------------------------------------------------------------------------

type RestKline = [number, string, string, string, string, string, number, string, ...unknown[]];

const KLINE_STEP_SEC: Record<ChartInterval, number> = {
    '1m': 60,
    '5m': 300,
    '15m': 900,
    '1h': 3_600,
    '4h': 14_400,
    '1d': 86_400,
};
const KLINE_DEFAULT_LIMIT = 500;
const KLINE_MAX_LIMIT = 1_500;
// Binance weighs /fapi/v1/klines by limit (100-499 → 2, 500-1000 → 5); the charts ask for 499.
const KLINE_PREFETCH_FALLBACK_LIMIT = 499;

const KLINE_MEMORY_MAX_ENTRIES = 32;
const KLINE_MEMORY_MAX_CANDLES = KLINE_MAX_LIMIT;

const KLINE_STORE_PREFIX = 'fidelio_kline_cache_v1';
const KLINE_STORE_INDEX_KEY = `${KLINE_STORE_PREFIX}:index`; // [[name, usedAt, size, fetchedAt], …]
const KLINE_STORE_ENTRY_PREFIX = `${KLINE_STORE_PREFIX}:k:`; // + 'BTCUSDT|5m'
const KLINE_STORE_VERSION = 1;
const KLINE_STORE_FIELDS = 7; // per candle: [Δtime (s), open, high, low, close, volume, quoteVolume]
const KLINE_STORE_MAX_ENTRIES = 24;
const KLINE_STORE_MAX_CANDLES = 500;
const KLINE_STORE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const KLINE_STORE_MAX_ENTRY_CHARS = 120_000; // a 500-candle entry is typically 30-45k chars
const KLINE_STORE_BUDGET_CHARS = 1_500_000; // all entries together; localStorage holds ~5M chars per origin
// The app keeps its own data (journal, portfolio, settings…) in the same per-origin quota (Safari: ~2.5M
// chars). The cache is only an optimisation, so it shrinks to keep cache + other data below this and
// never makes one of the app's own writes fail with QuotaExceededError.
const KLINE_STORE_ORIGIN_SOFT_LIMIT_CHARS = 2_000_000;
const KLINE_STORE_DELAY_MS = 2_000; // batch window: the three charts of a symbol land in one write
const KLINE_STORE_MIN_GAP_MS = 5_000; // at most one write burst per this period

const PREFETCH_FRESH_MS = 30_000;
const PREFETCH_MAX_CONCURRENT = 3;
const PREFETCH_MAX_QUEUE = 12;
const PREFETCH_RATE_LIMIT_PAUSE_MS = 60_000;
const PREFETCH_DEFAULT_INTERVALS: readonly ChartInterval[] = ['5m', '1h', '1d'];
const RECENT_INTERVALS_MAX = 3;

interface KlineCacheEntry {
    symbol: string;
    interval: ChartInterval;
    candles: Candle[]; // ascending by time; never mutated and never handed out (callers get copies)
    fetchedAt: number;
    exhaustive: boolean; // the last refresh returned fewer candles than requested: this is the whole history
    usedAt: number;
}

interface KlineRequest {
    sym: string;
    interval: ChartInterval;
    limit: number;
    promise: Promise<Candle[]>;
}

interface StoredKlineMeta {
    used: number;
    size: number;
    fetched: number;
}

interface PrefetchTask {
    sym: string;
    interval: ChartInterval;
    limit: number;
}

const klineMemory = new Map<string, KlineCacheEntry>(); // LRU through Map insertion order
const klineInFlight = new Map<string, KlineRequest>(); // 'SYM|interval|limit'
const recentKlineIntervals: ChartInterval[] = []; // most recent first, distinct
const lastKlineLimits = new Map<ChartInterval, number>();
let lastKlineLimit = 0;

const persistDirty = new Map<string, KlineCacheEntry>();
const persistTouched = new Map<string, number>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistLastFlush = 0;
let persistHooked = false;

const prefetchQueue: PrefetchTask[] = []; // most recently requested first
let prefetchActive = 0;
let prefetchBlockedUntil = 0;

const isKlineInterval = (value: unknown): value is ChartInterval =>
    typeof value === 'string' && (KLINE_INTERVALS as readonly string[]).includes(value);

const klineKey = (sym: string, interval: ChartInterval): string => `${sym}|${interval}`;

/** Copies candles for a caller, marking candles whose period has ended since the fetch as closed. */
function exportCandles(list: readonly Candle[], interval: ChartInterval, now: number = Date.now()): Candle[] {
    const stepMs = KLINE_STEP_SEC[interval] * 1000;
    return list.map((c) => ({ ...c, closed: c.closed || c.time * 1000 + stepMs <= now }));
}

// --- memory cache ---

function rememberKlines(key: string, entry: KlineCacheEntry): void {
    klineMemory.delete(key);
    klineMemory.set(key, entry);
    while (klineMemory.size > KLINE_MEMORY_MAX_ENTRIES) {
        const oldest = klineMemory.keys().next().value;
        if (oldest === undefined) break;
        klineMemory.delete(oldest);
    }
}

/** Cached series for (sym, interval): memory first, then localStorage (which then fills memory). */
function peekKlines(sym: string, interval: ChartInterval, now: number): KlineCacheEntry | null {
    const key = klineKey(sym, interval);
    const hit = klineMemory.get(key);
    if (hit) {
        if (hit.symbol === sym && hit.interval === interval && now - hit.fetchedAt <= KLINE_STORE_MAX_AGE_MS) return hit;
        klineMemory.delete(key);
    }
    const stored = readStoredKlines(key, sym, interval, now);
    if (stored) rememberKlines(key, stored);
    return stored;
}

/** Folds a REST response into the cache. Never shrinks a longer cached series with a short refresh. */
function storeKlines(sym: string, interval: ChartInterval, list: readonly Candle[], requested: number): void {
    if (!list.length) return;
    const now = Date.now();
    const key = klineKey(sym, interval);
    const step = KLINE_STEP_SEC[interval];
    const prev = peekKlines(sym, interval, now);
    const first = list[0].time;
    const last = list[list.length - 1].time;
    let exhaustive = list.length < requested;
    let candles: Candle[];

    if (exhaustive || !prev || !prev.candles.length) {
        candles = list.slice();
    } else {
        const prevFirst = prev.candles[0].time;
        const prevLast = prev.candles[prev.candles.length - 1].time;
        if (first > prevLast + step) {
            candles = list.slice(); // the cached series is older and not contiguous: replace it
        } else if (last + step < prevFirst) {
            return; // a late response older than (and disjoint from) the cached series
        } else {
            const head = prev.candles.filter((c) => c.time < first);
            const tail = prev.candles.filter((c) => c.time > last);
            candles = head.concat(list, tail);
            exhaustive = prev.exhaustive;
        }
    }
    if (candles.length > KLINE_MEMORY_MAX_CANDLES) {
        candles = candles.slice(-KLINE_MEMORY_MAX_CANDLES);
        exhaustive = false;
    }

    const entry: KlineCacheEntry = { symbol: sym, interval, candles, fetchedAt: now, exhaustive, usedAt: now };
    rememberKlines(key, entry);
    persistDirty.set(key, entry);
    schedulePersist();
}

// --- persisted cache (localStorage) ---

function klineStorage(): Storage | null {
    try {
        if (typeof window === 'undefined') return null;
        return window.localStorage ?? null;
    } catch {
        return null; // storage blocked (privacy settings, sandboxed frame)
    }
}

function trySetItem(ls: Storage, key: string, value: string): boolean {
    try {
        ls.setItem(key, value);
        return true;
    } catch {
        return false;
    }
}

function safeRemoveItem(ls: Storage, key: string): void {
    try {
        ls.removeItem(key);
    } catch {
        /* ignore */
    }
}

function encodeStoredKlines(entry: KlineCacheEntry): string {
    const list = entry.candles.length > KLINE_STORE_MAX_CANDLES ? entry.candles.slice(-KLINE_STORE_MAX_CANDLES) : entry.candles;
    const flat: number[] = [];
    let prevTime = 0;
    for (const c of list) {
        flat.push(c.time - prevTime, c.open, c.high, c.low, c.close, c.volume, c.quoteVolume);
        prevTime = c.time;
    }
    return JSON.stringify({
        v: KLINE_STORE_VERSION,
        s: entry.symbol,
        i: entry.interval,
        f: entry.fetchedAt,
        x: entry.exhaustive && list.length === entry.candles.length ? 1 : 0,
        c: flat,
    });
}

/** Parses a stored entry; null when it is corrupt, expired or belongs to another symbol/interval. */
function decodeStoredKlines(raw: string, sym: string, interval: ChartInterval, now: number): KlineCacheEntry | null {
    let data: unknown;
    try {
        data = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!data || typeof data !== 'object') return null;
    const d = data as { v?: unknown; s?: unknown; i?: unknown; f?: unknown; x?: unknown; c?: unknown };
    if (d.v !== KLINE_STORE_VERSION || d.s !== sym || d.i !== interval) return null;

    const fetchedAt = d.f;
    if (typeof fetchedAt !== 'number' || !Number.isFinite(fetchedAt)) return null;
    if (now - fetchedAt > KLINE_STORE_MAX_AGE_MS || fetchedAt - now > 60 * 60_000) return null;

    const flat = d.c;
    if (!Array.isArray(flat) || !flat.length || flat.length % KLINE_STORE_FIELDS !== 0) return null;
    if (flat.length / KLINE_STORE_FIELDS > KLINE_STORE_MAX_CANDLES) return null;

    const stepMs = KLINE_STEP_SEC[interval] * 1000;
    const candles: Candle[] = [];
    let time = 0;
    for (let i = 0; i < flat.length; i += KLINE_STORE_FIELDS) {
        for (let j = 0; j < KLINE_STORE_FIELDS; j++) {
            const v: unknown = flat[i + j];
            if (typeof v !== 'number' || !Number.isFinite(v)) return null;
        }
        const dt = flat[i] as number;
        if (!Number.isInteger(dt) || dt <= 0) return null; // strictly ascending
        time += dt;
        if (time > 1e11) return null; // seconds, not milliseconds
        candles.push({
            time,
            open: flat[i + 1] as number,
            high: flat[i + 2] as number,
            low: flat[i + 3] as number,
            close: flat[i + 4] as number,
            volume: flat[i + 5] as number,
            quoteVolume: flat[i + 6] as number,
            closed: time * 1000 + stepMs <= fetchedAt,
        });
    }
    return { symbol: sym, interval, candles, fetchedAt, exhaustive: d.x === 1, usedAt: now };
}

function readStoredKlines(key: string, sym: string, interval: ChartInterval, now: number): KlineCacheEntry | null {
    const ls = klineStorage();
    if (!ls) return null;
    const storageKey = KLINE_STORE_ENTRY_PREFIX + key;
    let raw: string | null;
    try {
        raw = ls.getItem(storageKey);
    } catch {
        return null;
    }
    if (!raw) return null;
    const entry = decodeStoredKlines(raw, sym, interval, now);
    if (!entry) safeRemoveItem(ls, storageKey); // corrupt, foreign or expired
    return entry;
}

function readStoreIndex(ls: Storage): Map<string, StoredKlineMeta> {
    const index = new Map<string, StoredKlineMeta>();
    try {
        const raw = ls.getItem(KLINE_STORE_INDEX_KEY);
        const rows: unknown = raw ? JSON.parse(raw) : null;
        if (Array.isArray(rows)) {
            for (const row of rows as unknown[]) {
                if (!Array.isArray(row) || typeof row[0] !== 'string') continue;
                index.set(row[0], { used: num(row[1]), size: num(row[2]), fetched: num(row[3]) });
            }
        }
    } catch {
        /* corrupt index: rebuilt from the stored keys below */
    }
    return index;
}

function writeStore(ls: Storage, dirty: Map<string, KlineCacheEntry>, touched: Map<string, number>, now: number): void {
    const index = readStoreIndex(ls);

    // Reconcile with what is really stored: another tab may have written or evicted entries.
    const present = new Set<string>();
    let otherChars = 0; // everything in this origin's localStorage that is not the kline cache
    for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (!k) continue;
        if (k.startsWith(KLINE_STORE_ENTRY_PREFIX)) present.add(k.slice(KLINE_STORE_ENTRY_PREFIX.length));
        else if (!k.startsWith(KLINE_STORE_PREFIX)) {
            try {
                otherChars += k.length + (ls.getItem(k)?.length ?? 0);
            } catch {
                /* ignore */
            }
        }
    }
    const budget = Math.min(KLINE_STORE_BUDGET_CHARS, Math.max(0, KLINE_STORE_ORIGIN_SOFT_LIMIT_CHARS - otherChars));
    for (const name of Array.from(index.keys())) if (!present.has(name)) index.delete(name);
    for (const name of present) {
        if (index.has(name)) continue;
        let size = 0;
        try {
            size = ls.getItem(KLINE_STORE_ENTRY_PREFIX + name)?.length ?? 0;
        } catch {
            /* ignore */
        }
        index.set(name, { used: 0, size, fetched: now }); // unknown usage: first in line for eviction
    }

    for (const [name, at] of touched) {
        const meta = index.get(name);
        if (meta && at > meta.used) meta.used = at;
    }

    const writes = new Map<string, string>();
    for (const [name, entry] of dirty) {
        let encoded: string;
        try {
            encoded = encodeStoredKlines(entry);
        } catch {
            continue;
        }
        if (encoded.length > KLINE_STORE_MAX_ENTRY_CHARS) continue;
        writes.set(name, encoded);
        index.set(name, {
            used: Math.max(entry.usedAt, index.get(name)?.used ?? 0),
            size: encoded.length,
            fetched: entry.fetchedAt,
        });
    }

    // Keep the most recently used entries within the count and size budget; drop expired ones.
    const kept: Array<[string, StoredKlineMeta]> = [];
    let total = 0;
    for (const [name, meta] of Array.from(index.entries()).sort((a, b) => b[1].used - a[1].used)) {
        const fits = kept.length < KLINE_STORE_MAX_ENTRIES && total + meta.size <= budget;
        if (fits && now - meta.fetched <= KLINE_STORE_MAX_AGE_MS) {
            kept.push([name, meta]);
            total += meta.size;
        } else {
            writes.delete(name);
            safeRemoveItem(ls, KLINE_STORE_ENTRY_PREFIX + name);
        }
    }

    // Most recently used first, so a full localStorage (the app stores other data too) keeps the newest.
    for (let w = 0; w < kept.length; w++) {
        const name = kept[w][0];
        const encoded = writes.get(name);
        if (encoded === undefined) continue;
        const storageKey = KLINE_STORE_ENTRY_PREFIX + name;
        let stored = trySetItem(ls, storageKey, encoded);
        // Quota exceeded: drop less recently used entries one by one until this one fits.
        for (let i = kept.length - 1; !stored && i > w; i--) {
            const other = kept[i][0];
            safeRemoveItem(ls, KLINE_STORE_ENTRY_PREFIX + other);
            writes.delete(other);
            kept.splice(i, 1);
            stored = trySetItem(ls, storageKey, encoded);
        }
        if (!stored) {
            safeRemoveItem(ls, storageKey); // an older version would no longer match the index
            writes.delete(name);
            kept.splice(w, 1);
            w--;
        }
    }

    trySetItem(ls, KLINE_STORE_INDEX_KEY, JSON.stringify(kept.map(([name, m]) => [name, m.used, m.size, m.fetched])));
}

function flushPersist(): void {
    if (!persistDirty.size && !persistTouched.size) return;
    const dirty = new Map(persistDirty);
    const touched = new Map(persistTouched);
    persistDirty.clear();
    persistTouched.clear();
    persistLastFlush = Date.now();
    const ls = klineStorage();
    if (!ls) return;
    try {
        writeStore(ls, dirty, touched, Date.now());
    } catch {
        /* the cache is an optimisation only */
    }
}

function flushPersistNow(): void {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = null;
    flushPersist();
}

/** Writes pending entries when the tab is hidden or closed, so a reload finds them. */
function hookPersistOnHide(): void {
    if (persistHooked || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    persistHooked = true;
    try {
        window.addEventListener('pagehide', flushPersistNow);
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') flushPersistNow();
            });
        }
    } catch {
        /* ignore */
    }
}

/** Batches cache writes: only REST responses and cache reads get here, never the live WebSocket path. */
function schedulePersist(): void {
    if (persistTimer) return;
    hookPersistOnHide();
    const delay = Math.max(KLINE_STORE_DELAY_MS, persistLastFlush + KLINE_STORE_MIN_GAP_MS - Date.now());
    persistTimer = setTimeout(() => {
        persistTimer = null;
        flushPersist();
    }, delay);
}

// --- requests ---

async function loadKlines(sym: string, interval: ChartInterval, limit: number, priority: FetchPriority): Promise<Candle[]> {
    const raw = await fetchJson(
        buildUrl(FAPI_BASE, '/fapi/v1/klines', { symbol: sym, interval, limit }),
        REQUEST_TIMEOUT_MS,
        priority,
    );
    if (!Array.isArray(raw)) throw new Error(MSG.parse);
    const now = Date.now();
    const candles: Candle[] = [];
    for (const k of raw as RestKline[]) {
        if (!Array.isArray(k) || k.length < 8) continue;
        const candle: Candle = {
            time: Math.floor(num(k[0]) / 1000),
            open: num(k[1]),
            high: num(k[2]),
            low: num(k[3]),
            close: num(k[4]),
            volume: num(k[5]),
            quoteVolume: num(k[7]),
            closed: num(k[6]) < now,
        };
        if (candle.time > 0) candles.push(candle);
    }
    candles.sort((a, b) => a.time - b.time);
    return candles;
}

/**
 * One network request per (symbol, interval, limit) at a time. A request already in flight for at least
 * `limit` candles is shared too (callers slice their tail); a smaller one never is, so nobody gets less
 * history than asked for. The resolved list is shared: callers must copy it.
 */
function requestKlines(sym: string, interval: ChartInterval, limit: number, priority: FetchPriority): Promise<Candle[]> {
    const key = `${sym}|${interval}|${limit}`;
    const exact = klineInFlight.get(key);
    if (exact) return exact.promise;
    for (const req of klineInFlight.values()) {
        if (req.sym === sym && req.interval === interval && req.limit >= limit) return req.promise;
    }

    const req: KlineRequest = { sym, interval, limit, promise: loadKlines(sym, interval, limit, priority) };
    klineInFlight.set(key, req);
    req.promise.then(
        (list) => {
            if (klineInFlight.get(key) === req) klineInFlight.delete(key);
            try {
                storeKlines(sym, interval, list, limit);
            } catch {
                /* caching is best effort */
            }
        },
        (err: unknown) => {
            if (klineInFlight.get(key) === req) klineInFlight.delete(key);
            if (err instanceof BinanceRequestError && isRateLimitStatus(err.status)) {
                prefetchBlockedUntil = Math.max(prefetchBlockedUntil, Date.now() + (err.retryAfterMs ?? PREFETCH_RATE_LIMIT_PAUSE_MS));
            }
        },
    );
    return req.promise;
}

function noteKlineRequest(interval: ChartInterval, limit: number): void {
    const at = recentKlineIntervals.indexOf(interval);
    if (at !== -1) recentKlineIntervals.splice(at, 1);
    recentKlineIntervals.unshift(interval);
    if (recentKlineIntervals.length > RECENT_INTERVALS_MAX) recentKlineIntervals.length = RECENT_INTERVALS_MAX;
    lastKlineLimits.set(interval, limit);
    lastKlineLimit = limit;
}

export async function fetchKlines(symbol: string, interval: ChartInterval, limit: number = KLINE_DEFAULT_LIMIT): Promise<Candle[]> {
    try {
        const sym = requireSymbol(symbol);
        if (!isKlineInterval(interval)) throw new Error(MSG.invalidInterval(String(interval)));
        const lim = clampInt(limit, KLINE_DEFAULT_LIMIT, 1, KLINE_MAX_LIMIT);
        noteKlineRequest(interval, lim);
        const list = await requestKlines(sym, interval, lim, 'high');
        return exportCandles(list.length > lim ? list.slice(-lim) : list, interval);
    } catch (err) {
        if (isInvalidSymbolError(err)) throw new Error(MSG.invalidSymbol(String(symbol)));
        throw toError(err, MSG.network);
    }
}

/**
 * Last known history for (symbol, interval), synchronously, so a chart can draw before its request
 * returns. Memory first, then localStorage. Returns a copy, or null when nothing usable is cached.
 */
export function getCachedKlines(symbol: string, interval: ChartInterval): { candles: Candle[]; fetchedAt: number } | null {
    try {
        const sym = normalizeSymbol(symbol);
        if (!sym || !isKlineInterval(interval)) return null;
        const now = Date.now();
        const entry = peekKlines(sym, interval, now);
        if (!entry || !entry.candles.length || entry.symbol !== sym || entry.interval !== interval) return null;
        const key = klineKey(sym, interval);
        entry.usedAt = now;
        rememberKlines(key, entry);
        persistTouched.set(key, now); // keeps the persisted LRU order current (batched with the next write)
        schedulePersist();
        return { candles: exportCandles(entry.candles, interval, now), fetchedAt: entry.fetchedAt };
    } catch {
        return null;
    }
}

// --- prefetch ---

/** The limit the charts use for this interval; never below a chart's worth of history (a small one-off
 *  request must not turn prefetch into fetching a handful of candles). */
function prefetchLimitFor(interval: ChartInterval): number {
    return Math.max(lastKlineLimits.get(interval) ?? lastKlineLimit, KLINE_PREFETCH_FALLBACK_LIMIT);
}

function isKlineFresh(sym: string, interval: ChartInterval, limit: number, now: number): boolean {
    const entry = peekKlines(sym, interval, now);
    if (!entry || now - entry.fetchedAt >= PREFETCH_FRESH_MS) return false;
    return entry.exhaustive || entry.candles.length >= Math.min(limit, KLINE_STORE_MAX_CANDLES);
}

function isKlineInFlight(sym: string, interval: ChartInterval, limit: number): boolean {
    for (const req of klineInFlight.values()) {
        if (req.sym === sym && req.interval === interval && req.limit >= limit) return true;
    }
    return false;
}

function pumpPrefetch(): void {
    while (prefetchActive < PREFETCH_MAX_CONCURRENT && prefetchQueue.length) {
        const now = Date.now();
        if (prefetchBlockedUntil > now) {
            prefetchQueue.length = 0;
            return;
        }
        const task = prefetchQueue.shift() as PrefetchTask;
        // Re-checked at start time: a chart may have loaded this pair while the task was queued.
        if (isKlineFresh(task.sym, task.interval, task.limit, now) || isKlineInFlight(task.sym, task.interval, task.limit)) continue;
        prefetchActive++;
        let settled: Promise<unknown>;
        try {
            settled = requestKlines(task.sym, task.interval, task.limit, 'low').then(
                () => undefined,
                () => undefined,
            );
        } catch {
            settled = Promise.resolve();
        }
        settled.then(() => {
            prefetchActive--;
            pumpPrefetch();
        });
    }
}

/**
 * Warms the kline cache for a symbol the user is likely to open next (e.g. a hovered watchlist row).
 * Fire-and-forget: never throws or rejects. Pairs cached within the last 30 s or already in flight are
 * skipped; at most three prefetch requests run at once, at low fetch priority.
 */
export function prefetchKlines(symbol: string, intervals?: ChartInterval[]): void {
    try {
        const sym = normalizeSymbol(symbol);
        if (!sym) return;
        const now = Date.now();
        if (prefetchBlockedUntil > now) return;

        const source: readonly ChartInterval[] = Array.isArray(intervals)
            ? intervals
            : recentKlineIntervals.length
              ? recentKlineIntervals
              : PREFETCH_DEFAULT_INTERVALS;
        const wanted: ChartInterval[] = [];
        for (const iv of source) if (isKlineInterval(iv) && !wanted.includes(iv)) wanted.push(iv);

        const tasks: PrefetchTask[] = [];
        for (const iv of wanted) {
            const limit = prefetchLimitFor(iv);
            if (isKlineFresh(sym, iv, limit, now) || isKlineInFlight(sym, iv, limit)) continue;
            const queued = prefetchQueue.findIndex((t) => t.sym === sym && t.interval === iv);
            if (queued !== -1) prefetchQueue.splice(queued, 1);
            tasks.push({ sym, interval: iv, limit });
        }
        if (!tasks.length) return;
        prefetchQueue.unshift(...tasks); // the latest hover is the most likely next click
        if (prefetchQueue.length > PREFETCH_MAX_QUEUE) prefetchQueue.length = PREFETCH_MAX_QUEUE;
        pumpPrefetch();
    } catch {
        /* never throws */
    }
}

interface WsKlinePayload {
    k?: {
        t: number;
        o: string;
        h: string;
        l: string;
        c: string;
        v: string;
        q: string;
        x: boolean;
    };
}

export function subscribeKline(symbol: string, interval: ChartInterval, onCandle: (c: Candle) => void): () => void {
    const sym = normalizeSymbol(symbol);
    if (!sym || !KLINE_INTERVALS.includes(interval)) return () => {};
    return openCombinedStream({
        streams: [`${sym.toLowerCase()}@kline_${interval}`],
        // Charts buffer live candles until their REST history arrives (~200-500 ms), so a short delay loses
        // nothing and avoids opening three sockets for every symbol the user merely clicks past.
        openDelayMs: 300,
        onMessage: (_stream, data) => {
            const k = (data as WsKlinePayload | null)?.k;
            if (!k) return;
            onCandle({
                time: Math.floor(num(k.t) / 1000),
                open: num(k.o),
                high: num(k.h),
                low: num(k.l),
                close: num(k.c),
                volume: num(k.v),
                quoteVolume: num(k.q),
                closed: Boolean(k.x),
            });
        },
    });
}

// ---------------------------------------------------------------------------
// Spot price, open interest, order book
// ---------------------------------------------------------------------------

// Futures contracts such as 1000PEPEUSDT trade a multiple of the spot asset (PEPEUSDT).
const CONTRACT_MULTIPLIER_PREFIXES: ReadonlyArray<[string, number]> = [
    ['1000000', 1_000_000],
    ['100000', 100_000],
    ['10000', 10_000],
    ['1000', 1_000],
    ['1M', 1_000_000],
];
const SPOT_MISSING_TTL_MS = 10 * 60_000;
const spotMissing = new Map<string, number>(); // symbol -> expiry of the "no spot market" verdict

async function fetchSpotTicker(symbol: string): Promise<number | null> {
    try {
        const raw = (await fetchJson(buildUrl(SPOT_BASE, '/api/v3/ticker/price', { symbol }), REQUEST_TIMEOUT_MS, 'low')) as {
            price?: string;
        };
        const price = num(raw?.price, NaN);
        return Number.isFinite(price) && price > 0 ? price : null;
    } catch (err) {
        if (isInvalidSymbolError(err)) return null;
        throw err;
    }
}

// Binance spot answers an unknown symbol with HTTP 400 *without* CORS headers, so in the browser the
// probe surfaces as a network error (and a console CORS error) instead of 'Invalid symbol'. The list of
// spot symbols is therefore loaded once (one request, weight 4) and only listed symbols are queried.
const SPOT_SYMBOLS_TTL_MS = 30 * 60_000;
const SPOT_SYMBOLS_RETRY_MS = 60_000;
let spotSymbols: { set: Set<string>; at: number } | null = null;
let spotSymbolsFailedAt = 0;
let spotSymbolsPromise: Promise<Set<string> | null> | null = null;

/** Resolves to the spot symbol set, or null when it is unavailable (callers then probe directly). */
function loadSpotSymbols(): Promise<Set<string> | null> {
    const now = Date.now();
    if (spotSymbols && now - spotSymbols.at < SPOT_SYMBOLS_TTL_MS) return Promise.resolve(spotSymbols.set);
    if (!spotSymbols && now - spotSymbolsFailedAt < SPOT_SYMBOLS_RETRY_MS) return Promise.resolve(null);
    if (!spotSymbolsPromise) {
        spotSymbolsPromise = fetchJson(buildUrl(SPOT_BASE, '/api/v3/ticker/price'), 15_000, 'low')
            .then((raw) => {
                const set = new Set<string>();
                if (Array.isArray(raw)) for (const t of raw as Array<{ symbol?: unknown }>) if (typeof t?.symbol === 'string') set.add(t.symbol);
                if (!set.size) throw new Error(MSG.parse);
                spotSymbols = { set, at: Date.now() };
                return set;
            })
            .catch(() => {
                spotSymbolsFailedAt = Date.now();
                return spotSymbols ? spotSymbols.set : null; // a stale list beats probing
            })
            .finally(() => {
                spotSymbolsPromise = null;
            });
    }
    return spotSymbolsPromise;
}

export async function fetchSpotPrice(symbol: string): Promise<number | null> {
    try {
        const sym = requireSymbol(symbol);
        const missingUntil = spotMissing.get(sym);
        if (missingUntil && missingUntil > Date.now()) return null;

        const listed = await loadSpotSymbols();
        if (!listed || listed.has(sym)) {
            const direct = await fetchSpotTicker(sym);
            if (direct !== null) return direct;
        }

        for (const [prefix, factor] of CONTRACT_MULTIPLIER_PREFIXES) {
            if (!sym.startsWith(prefix) || sym.length <= prefix.length + 4) continue;
            const baseSymbol = sym.slice(prefix.length);
            if (listed && !listed.has(baseSymbol)) break;
            const base = await fetchSpotTicker(baseSymbol);
            if (base !== null) return base * factor;
            break;
        }

        spotMissing.set(sym, Date.now() + SPOT_MISSING_TTL_MS);
        return null;
    } catch (err) {
        throw toError(err, MSG.network);
    }
}

export async function fetchOpenInterest(symbol: string): Promise<number | null> {
    try {
        const sym = requireSymbol(symbol);
        const raw = (await fetchJson(
            buildUrl(FAPI_BASE, '/fapi/v1/openInterest', { symbol: sym }),
            REQUEST_TIMEOUT_MS,
            'low',
        )) as {
            openInterest?: string;
        };
        const oi = num(raw?.openInterest, NaN);
        return Number.isFinite(oi) ? oi : null;
    } catch (err) {
        if (isInvalidSymbolError(err)) return null;
        throw toError(err, MSG.network);
    }
}

type BookLevel = [string, string];

// Order book bid/ask ratio, measured in a SYMMETRIC price band around the mid price so the result is
// comparable across symbols and not dominated by the first few ticks (100 levels of BTC only cover
// ~±0.015%). Target band ±1%; when 1000 levels don't reach that far on a side (BTC/ETH), the band is
// clipped to the distance BOTH sides cover, so neither side is over-counted. Successive samples of the
// same symbol are smoothed (EMA) so a single wall flickering in and out doesn't swing the bar.
const BOOK_DEPTH_LIMIT = 1000; // request weight 20; polled every 5s and shared between panels
const BOOK_TARGET_BAND = 0.01; // ±1%
const BOOK_EMA_ALPHA = 0.35;
const BOOK_EMA_RESET_MS = 30_000;
const bookEma = new Map<string, { long: number; at: number }>();

const parseLevels = (levels: unknown): Array<[number, number]> => {
    if (!Array.isArray(levels)) return [];
    const out: Array<[number, number]> = [];
    for (const lvl of levels as BookLevel[]) {
        const price = num(lvl?.[0]);
        const qty = num(lvl?.[1]);
        if (price > 0 && qty > 0 && Number.isFinite(price) && Number.isFinite(qty)) out.push([price, qty]);
    }
    return out;
};

async function loadOrderBookRatio(symbol: string): Promise<SideRatio | null> {
    try {
        const sym = requireSymbol(symbol);
        const raw = (await fetchJson(buildUrl(FAPI_BASE, '/fapi/v1/depth', { symbol: sym, limit: BOOK_DEPTH_LIMIT }))) as {
            bids?: unknown;
            asks?: unknown;
            T?: number;
            E?: number;
        };
        const bids = parseLevels(raw?.bids); // best (highest) first
        const asks = parseLevels(raw?.asks); // best (lowest) first
        if (!bids.length || !asks.length) return null;
        const mid = (bids[0][0] + asks[0][0]) / 2;
        if (!(mid > 0)) return null;

        // How far each side's returned levels reach; a side with fewer levels than requested is complete.
        const bidReach = bids.length < BOOK_DEPTH_LIMIT ? Infinity : (mid - bids[bids.length - 1][0]) / mid;
        const askReach = asks.length < BOOK_DEPTH_LIMIT ? Infinity : (asks[asks.length - 1][0] - mid) / mid;
        const band = Math.min(BOOK_TARGET_BAND, bidReach, askReach);
        if (!(band > 0)) return null;

        const lo = mid * (1 - band);
        const hi = mid * (1 + band);
        let bid = 0;
        for (const [price, qty] of bids) {
            if (price < lo) break;
            bid += price * qty;
        }
        let ask = 0;
        for (const [price, qty] of asks) {
            if (price > hi) break;
            ask += price * qty;
        }
        const total = bid + ask;
        if (!(total > 0)) return null;

        const now = Date.now();
        const rawLong = bid / total;
        const prev = bookEma.get(sym);
        const long = prev && now - prev.at < BOOK_EMA_RESET_MS ? prev.long + BOOK_EMA_ALPHA * (rawLong - prev.long) : rawLong;
        bookEma.set(sym, { long, at: now });
        if (bookEma.size > 100) {
            for (const [k, v] of bookEma) if (now - v.at >= BOOK_EMA_RESET_MS) bookEma.delete(k);
        }

        return {
            long,
            short: 1 - long,
            timestamp: num(raw?.T, 0) || num(raw?.E, 0) || now,
            bandPct: band * 100,
        };
    } catch (err) {
        if (isInvalidSymbolError(err)) return null;
        throw toError(err, MSG.network);
    }
}

// The symbol header and the sentiment panel both poll the book every 5s; callers that ask for the
// same symbol while a request is in flight (or within BOOK_SHARE_MS after it settled) share it.
const BOOK_SHARE_MS = 2_000;
const bookShared = new Map<string, { promise: Promise<SideRatio | null>; settledAt: number | null }>();

export function fetchOrderBookRatio(symbol: string): Promise<SideRatio | null> {
    const key = typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';
    if (!key) return loadOrderBookRatio(symbol);
    const hit = bookShared.get(key);
    if (hit && (hit.settledAt === null || Date.now() - hit.settledAt < BOOK_SHARE_MS)) return hit.promise;

    const entry: { promise: Promise<SideRatio | null>; settledAt: number | null } = {
        promise: loadOrderBookRatio(symbol),
        settledAt: null,
    };
    bookShared.set(key, entry);
    const settle = () => {
        entry.settledAt = Date.now();
    };
    entry.promise.then(settle, () => {
        // Failures are not shared after they settle: the next poll retries immediately.
        if (bookShared.get(key) === entry) bookShared.delete(key);
    });
    if (bookShared.size > 50) {
        for (const [k, e] of bookShared) {
            if (e.settledAt !== null && Date.now() - e.settledAt >= BOOK_SHARE_MS) bookShared.delete(k);
        }
    }
    return entry.promise;
}

// ---------------------------------------------------------------------------
// Long/short ratio endpoints
// ---------------------------------------------------------------------------

type RatioKind = 'orderType' | 'longShortAccounts' | 'traderPositioning' | 'marketExposure';

const RATIO_ENDPOINTS: Record<RatioKind, string> = {
    orderType: '/futures/data/takerlongshortRatio',
    longShortAccounts: '/futures/data/globalLongShortAccountRatio',
    traderPositioning: '/futures/data/topLongShortAccountRatio',
    marketExposure: '/futures/data/topLongShortPositionRatio',
};

interface RawRatioPoint {
    longAccount?: string;
    shortAccount?: string;
    buyVol?: string;
    sellVol?: string;
    timestamp?: number | string;
}

function toSideRatios(kind: RatioKind, raw: unknown): SideRatio[] {
    if (!Array.isArray(raw)) throw new Error(MSG.parse);
    const out: SideRatio[] = [];
    for (const p of raw as RawRatioPoint[]) {
        const a = kind === 'orderType' ? num(p?.buyVol, NaN) : num(p?.longAccount, NaN);
        const b = kind === 'orderType' ? num(p?.sellVol, NaN) : num(p?.shortAccount, NaN);
        const total = a + b;
        const timestamp = num(p?.timestamp, NaN);
        if (!Number.isFinite(total) || total <= 0 || a < 0 || b < 0 || !Number.isFinite(timestamp)) continue;
        const long = a / total;
        out.push({ long, short: 1 - long, timestamp });
    }
    out.sort((x, y) => x.timestamp - y.timestamp);
    return out;
}

async function requestRatios(kind: RatioKind, symbol: string, period: RatioPeriod, limit: number): Promise<SideRatio[]> {
    try {
        const raw = await fetchJson(buildUrl(FAPI_BASE, RATIO_ENDPOINTS[kind], { symbol, period, limit }), REQUEST_TIMEOUT_MS, 'low');
        return toSideRatios(kind, raw);
    } catch (err) {
        // Symbols without ratio data answer HTTP 400; treat that as "no data".
        if (isInvalidSymbolError(err)) return [];
        throw err;
    }
}

interface CacheEntry<T> {
    expires: number;
    promise: Promise<T>;
}

const RATIO_TTL_MS = 30_000;
const EXPOSURE_TTL_MS = 5 * 60_000;
const EXPOSURE_ERROR_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 1_000;

const ratioCache = new Map<string, CacheEntry<SideRatio[]>>();
const exposureCache = new Map<string, CacheEntry<SideRatio | null>>();

function pruneCache<T>(cache: Map<string, CacheEntry<T>>): void {
    if (cache.size <= CACHE_MAX_ENTRIES) return;
    const now = Date.now();
    for (const [key, entry] of cache) if (entry.expires <= now) cache.delete(key);
    // Still too big: drop the oldest insertions.
    while (cache.size > CACHE_MAX_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
    }
}

export function fetchRatio(
    kind: 'orderType' | 'longShortAccounts' | 'traderPositioning' | 'marketExposure',
    symbol: string,
    period: RatioPeriod,
    limit: number = 30,
): Promise<SideRatio[]> {
    try {
        if (!Object.prototype.hasOwnProperty.call(RATIO_ENDPOINTS, kind)) throw new Error(MSG.unknownKind);
        if (!RATIO_PERIODS.includes(period)) throw new Error(MSG.invalidPeriod(String(period)));
        const sym = requireSymbol(symbol);
        const lim = clampInt(limit, 30, 1, 500);
        const key = `${kind}|${sym}|${period}|${lim}`;
        const now = Date.now();

        const hit = ratioCache.get(key);
        if (hit && hit.expires > now) return hit.promise.then((list) => list.slice());

        const entry: CacheEntry<SideRatio[]> = {
            expires: Number.POSITIVE_INFINITY, // in flight: share the promise
            promise: enqueueFuturesData(() => requestRatios(kind, sym, period, lim), 'high'),
        };
        ratioCache.set(key, entry);
        pruneCache(ratioCache);
        entry.promise.then(
            () => {
                entry.expires = Date.now() + RATIO_TTL_MS;
            },
            () => {
                if (ratioCache.get(key) === entry) ratioCache.delete(key);
            },
        );
        return entry.promise.then((list) => list.slice());
    } catch (err) {
        return Promise.reject(toError(err, MSG.network));
    }
}

export function fetchMarketExposure(symbol: string): Promise<SideRatio | null> {
    try {
        const sym = requireSymbol(symbol);
        const now = Date.now();

        const hit = exposureCache.get(sym);
        if (hit && hit.expires > now) return hit.promise;

        const entry: CacheEntry<SideRatio | null> = {
            expires: Number.POSITIVE_INFINITY,
            promise: enqueueFuturesData(() => requestRatios('marketExposure', sym, '5m', 1), 'low').then(
                (list) => list[list.length - 1] ?? null,
            ),
        };
        exposureCache.set(sym, entry);
        pruneCache(exposureCache);
        entry.promise.then(
            () => {
                entry.expires = Date.now() + EXPOSURE_TTL_MS;
            },
            () => {
                // Short negative cache so a failing row is not re-requested on every render.
                entry.expires = Date.now() + EXPOSURE_ERROR_TTL_MS;
            },
        );
        return entry.promise;
    } catch (err) {
        return Promise.reject(toError(err, MSG.network));
    }
}
