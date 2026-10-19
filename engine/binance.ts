// Binance public market data for the engine host: stream URLs, payload parsers (same mapping as the
// browser's services/marketData.ts + context/MarketContext.tsx) and the REST metadata loaders.

import type { FuturesTicker, Ticker } from '../types';
import type { HourTicker } from '../utils/signalEngines';
import { parseCryptoPerpSymbols, parseFundingIntervals } from '../services/marketData';
import type { EngineUrls, FetchLike } from './types';

export { parseCryptoPerpSymbols, parseFundingIntervals };

// Primary URL first. Spot: port 443 as fallback for hosts that block 9443 outbound. Futures: the
// `/market/stream` route delivers data (verified live, 2026-10-06); the legacy `/stream` route still
// accepts connections but stays silent, it is only kept as a fallback.
// Mark price: the 3 s variant (`!markPrice@arr`, ~50 KB/s) instead of `@1s` (~140 KB/s, 2/3 of all
// inbound engine traffic). The funding pass runs every 10 s and its gate needs 60 s of persistence,
// so 1 s updates add nothing but bandwidth and JSON parsing on the host.
export const DEFAULT_STREAM_URLS: EngineUrls = {
    spotMini: [
        'wss://stream.binance.com:9443/ws/!miniTicker@arr',
        'wss://stream.binance.com:443/ws/!miniTicker@arr',
    ],
    spotHour: [
        'wss://stream.binance.com:9443/ws/!ticker_1h@arr',
        'wss://stream.binance.com:443/ws/!ticker_1h@arr',
    ],
    futuresMark: [
        'wss://fstream.binance.com/market/stream?streams=!markPrice@arr',
        'wss://fstream.binance.com/stream?streams=!markPrice@arr',
    ],
    futuresMini: [
        'wss://fstream.binance.com/market/stream?streams=!miniTicker@arr',
        'wss://fstream.binance.com/stream?streams=!miniTicker@arr',
    ],
};

export const FAPI_BASE = 'https://fapi.binance.com';
export const EXCHANGE_INFO_URL = `${FAPI_BASE}/fapi/v1/exchangeInfo`;
export const FUNDING_INFO_URL = `${FAPI_BASE}/fapi/v1/fundingInfo`;
export const FUNDING_RATE_URL = `${FAPI_BASE}/fapi/v1/fundingRate`;
export const OPEN_INTEREST_URL = `${FAPI_BASE}/fapi/v1/openInterest`;
export const SPOT_API_BASE = 'https://api.binance.com';
export const SPOT_KLINES_URL = `${SPOT_API_BASE}/api/v3/klines`;
const REQUEST_TIMEOUT_MS = 20_000;

/** Raw array (`/ws/...`) or combined-stream envelope (`/stream?streams=...` → { stream, data }). */
export const unwrapRows = (payload: unknown): unknown[] | null => {
    if (Array.isArray(payload)) return payload;
    if (payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)) {
        return (payload as { data: unknown[] }).data;
    }
    return null;
};

const str = (row: Record<string, unknown>, key: string): number => {
    const v = row[key];
    return typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
};

const isRow = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && typeof (value as { s?: unknown }).s === 'string';

/** Spot `!miniTicker@arr` → Ticker rows (all quotes, like MarketContext; the universe filter picks USDT). */
export function applySpotMini(payload: unknown, into: Map<string, Ticker>): number {
    const rows = unwrapRows(payload);
    if (!rows) return 0;
    let n = 0;
    for (const t of rows) {
        if (!isRow(t)) continue;
        const open = str(t, 'o');
        const close = str(t, 'c');
        into.set(t.s as string, {
            symbol: t.s as string,
            lastPrice: close,
            openPrice: open,
            highPrice: str(t, 'h'),
            lowPrice: str(t, 'l'),
            priceChangePercent: ((close - open) / open) * 100,
            volume: str(t, 'q'), // quote volume (USDT for USDT pairs)
            updatedAt: typeof t.E === 'number' ? t.E : NaN,
        });
        n++;
    }
    return n;
}

/** Spot `!ticker_1h@arr` → rolling-hour rows of USDT pairs, stamped with the local receive time. */
export function applySpotHour(payload: unknown, receivedAt: number, into: Map<string, HourTicker>): number {
    const rows = unwrapRows(payload);
    if (!rows) return 0;
    let n = 0;
    for (const t of rows) {
        if (!isRow(t) || !(t.s as string).endsWith('USDT')) continue;
        const quoteVolume = str(t, 'q');
        if (!Number.isFinite(quoteVolume)) continue;
        const open = str(t, 'o');
        const last = str(t, 'c');
        const percent = str(t, 'P');
        into.set(t.s as string, {
            symbol: t.s as string,
            quoteVolume,
            priceChangePercent: Number.isFinite(percent) ? percent : open > 0 ? ((last - open) / open) * 100 : NaN,
            lastPrice: last,
            receivedAt,
        });
        n++;
    }
    return n;
}

const mergeFutures = (into: Map<string, FuturesTicker>, symbol: string, update: Partial<FuturesTicker>) => {
    const current = into.get(symbol);
    into.set(symbol, {
        ...current,
        ...update,
        symbol,
        markPrice: update.markPrice ?? current?.markPrice ?? 0,
        fundingRate: update.fundingRate ?? current?.fundingRate ?? 0,
        nextFundingTime: update.nextFundingTime ?? current?.nextFundingTime ?? 0,
        indexPrice: update.indexPrice ?? current?.indexPrice ?? 0,
    });
};

/** Futures `!markPrice@arr` (3 s) → mark / index price, predicted funding rate, next funding time. */
export function applyFuturesMark(payload: unknown, into: Map<string, FuturesTicker>, seenAt: Map<string, number>, now: number): number {
    const rows = unwrapRows(payload);
    if (!rows) return 0;
    let n = 0;
    for (const t of rows) {
        if (!isRow(t) || !(t.s as string).endsWith('USDT')) continue;
        mergeFutures(into, t.s as string, {
            markPrice: str(t, 'p'),
            indexPrice: str(t, 'i'),
            fundingRate: str(t, 'r'),
            nextFundingTime: typeof t.T === 'number' ? t.T : 0,
        });
        seenAt.set(t.s as string, now);
        n++;
    }
    return n;
}

/** Futures `!miniTicker@arr` → last price, 24h high / low / open, quote volume, 24h change. */
export function applyFuturesMini(payload: unknown, into: Map<string, FuturesTicker>, seenAt: Map<string, number>, now: number): number {
    const rows = unwrapRows(payload);
    if (!rows) return 0;
    let n = 0;
    for (const t of rows) {
        if (!isRow(t) || !(t.s as string).endsWith('USDT')) continue;
        const open = str(t, 'o');
        const close = str(t, 'c');
        mergeFutures(into, t.s as string, {
            lastPrice: close,
            highPrice: str(t, 'h'),
            lowPrice: str(t, 'l'),
            openPrice: open,
            volume: str(t, 'q'),
            priceChangePercent: ((close - open) / open) * 100,
        });
        seenAt.set(t.s as string, now);
        n++;
    }
    return n;
}

// ---------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------

export async function getJson(fetchImpl: FetchLike, url: string): Promise<unknown> {
    const response = await fetchImpl(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

/** TRADING + PERPETUAL + USDT crypto contracts (GET /fapi/v1/exchangeInfo). Throws on an empty answer. */
export async function loadCryptoPerps(fetchImpl: FetchLike): Promise<Set<string>> {
    const symbols = parseCryptoPerpSymbols(await getJson(fetchImpl, EXCHANGE_INFO_URL));
    if (symbols.size === 0) throw new Error('beklenmeyen yanıt');
    return symbols;
}

/** Funding interval (hours) of the contracts that differ from 8 h (GET /fapi/v1/fundingInfo). */
export async function loadFundingIntervals(fetchImpl: FetchLike): Promise<Map<string, number>> {
    const body = await getJson(fetchImpl, FUNDING_INFO_URL);
    if (!Array.isArray(body)) throw new Error('beklenmeyen yanıt');
    return parseFundingIntervals(body);
}

/** Current open interest (contracts) of one USDT-M contract (GET /fapi/v1/openInterest, weight 1). Throws on a bad answer. */
export async function loadOpenInterest(fetchImpl: FetchLike, symbol: string): Promise<number> {
    const body = await getJson(fetchImpl, `${OPEN_INTEREST_URL}?symbol=${encodeURIComponent(symbol)}`);
    const oi = Number((body as { openInterest?: unknown } | null)?.openInterest);
    if (!Number.isFinite(oi) || oi <= 0) throw new Error('beklenmeyen yanıt');
    return oi;
}

// --- Latest settled funding rate of every symbol --------------------------------------------
// Same procedure as the Terminal (components/terminal/fundingData.ts, verified live 2026-10-05):
// GET /fapi/v1/fundingRate without a symbol returns the newest `limit` (max 1000) settlement records of
// all symbols. Every symbol settles at the 8h boundaries; once the 4h / 1h settlements after that push
// the 8h batch out of the newest 1000, the batch is read by its own ±1 min window (1–3 requests).

export interface SettledFunding {
    rate: number;
    time: number;
}

const HOUR_MS = 3_600_000;
const EIGHT_HOURS_MS = 8 * HOUR_MS;
const SETTLED_PAGE_LIMIT = 1000;
const SETTLED_BATCH_WINDOW_MS = 60_000;
const SETTLE_PUBLISH_GRACE_MS = 90_000;
const SETTLED_PARTIAL_TTL_MS = 60_000;

const mergeSettlements = (into: Map<string, SettledFunding>, records: unknown[]): void => {
    for (const r of records) {
        if (!r || typeof r !== 'object') continue;
        const row = r as Record<string, unknown>;
        const symbol = typeof row.symbol === 'string' ? row.symbol : '';
        const time = Number(row.fundingTime);
        const rate = Number(row.fundingRate);
        if (!symbol || !Number.isFinite(time) || time <= 0 || !Number.isFinite(rate)) continue;
        const prev = into.get(symbol);
        if (!prev || time > prev.time) into.set(symbol, { rate, time });
    }
};

const requestSettlements = async (fetchImpl: FetchLike, params: Record<string, number>): Promise<unknown[]> => {
    const query = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
    const body = await getJson(fetchImpl, `${FUNDING_RATE_URL}?${query}`);
    if (!Array.isArray(body)) throw new Error('beklenmeyen yanıt');
    return body;
};

export async function loadLatestSettled(fetchImpl: FetchLike): Promise<{ map: Map<string, SettledFunding>; complete: boolean }> {
    const map = new Map<string, SettledFunding>();
    const latest = await requestSettlements(fetchImpl, { limit: SETTLED_PAGE_LIMIT });
    mergeSettlements(map, latest);
    if (map.size === 0) throw new Error('son fonlama ödemeleri boş');

    let complete = true;
    if (latest.length >= SETTLED_PAGE_LIMIT) {
        let oldest = Number.POSITIVE_INFINITY;
        let newest = 0;
        for (const entry of map.values()) if (entry.time > newest) newest = entry.time;
        for (const r of latest) {
            const time = Number((r as { fundingTime?: unknown } | null)?.fundingTime);
            if (Number.isFinite(time) && time > 0 && time < oldest) oldest = time;
        }
        // Boundaries come from the data, not from the local clock.
        const lastAllSymbolBatch = Math.floor(newest / EIGHT_HOURS_MS) * EIGHT_HOURS_MS;
        const batches: number[] = [];
        if (!(oldest < lastAllSymbolBatch - SETTLED_BATCH_WINDOW_MS)) batches.push(lastAllSymbolBatch);
        if (newest - lastAllSymbolBatch < SETTLED_BATCH_WINDOW_MS) batches.push(lastAllSymbolBatch - EIGHT_HOURS_MS);
        const results = await Promise.all(
            batches.map((boundary) =>
                requestSettlements(fetchImpl, {
                    startTime: boundary - SETTLED_BATCH_WINDOW_MS,
                    endTime: boundary + SETTLED_BATCH_WINDOW_MS,
                    limit: SETTLED_PAGE_LIMIT,
                }).then((list) => list, () => null),
            ),
        );
        for (const list of results) {
            if (list) mergeSettlements(map, list);
            else complete = false;
        }
    }
    return { map, complete };
}

/** When the settled map has to be reloaded: at most `ttlMs` later and never across a funding hour. */
export function settledExpiry(now: number, complete: boolean, ttlMs: number): number {
    if (!complete) return now + Math.min(ttlMs, SETTLED_PARTIAL_TTL_MS);
    const hour = Math.floor(now / HOUR_MS) * HOUR_MS;
    const published = hour + SETTLE_PUBLISH_GRACE_MS;
    const nextLook = now < published ? published : hour + HOUR_MS + SETTLE_PUBLISH_GRACE_MS;
    return Math.min(now + ttlMs, nextLook);
}

// --- Liquidity gate: median daily quote volume ------------------------------------------------
// GET /api/v3/klines?interval=1d (weight 2) per symbol, once a day for every USDT pair the engine sees.
// Binance's spot limit is 6000 weight per minute; ~500 pairs cost ~1000, fetched a few at a time.

const DAY_MS = 24 * HOUR_MS;

/**
 * Median quote volume (kline field 7) of the last `days` COMPLETED daily candles, given the raw answer of
 * `/api/v3/klines?interval=1d&limit=days+1` fetched at `now`. The candle still open at `now` is left out.
 * null when fewer than `days` completed candles exist (a pair younger than `days` days) or the answer is
 * malformed.
 */
export function parseMedianDailyQuoteVolume(body: unknown, days: number, now: number): number | null {
    if (!Array.isArray(body) || !(days > 0)) return null;
    const volumes: number[] = [];
    for (const k of body) {
        if (!Array.isArray(k)) continue;
        const openTime = Number(k[0]);
        const closeTime = Number(k[6]);
        const quote = typeof k[7] === 'number' ? k[7] : typeof k[7] === 'string' ? parseFloat(k[7]) : NaN;
        if (!Number.isFinite(openTime) || !Number.isFinite(closeTime) || !Number.isFinite(quote) || quote < 0) continue;
        if (closeTime >= now) continue; // still open
        if (now - openTime > (days + 2) * DAY_MS) continue; // outside the window (defensive)
        volumes.push(quote);
    }
    if (volumes.length < days) return null;
    const window = volumes.slice(-days).sort((a, b) => a - b);
    const mid = window.length >> 1;
    return window.length % 2 === 1 ? window[mid] : (window[mid - 1] + window[mid]) / 2;
}

export interface MedianVolumeLoad {
    medians: Map<string, number>; // symbols with `days` completed candles
    young: number;                // answered, but fewer than `days` completed candles
    failed: number;               // request failed (left out of the map)
    aborted: boolean;             // stopped early on a rate-limit answer (HTTP 429 / 418)
}

const isRateLimited = (err: unknown): boolean => err instanceof Error && /HTTP (429|418)/.test(err.message);

/**
 * Median daily quote volume of every symbol (see parseMedianDailyQuoteVolume), `concurrency` requests at a
 * time. A rate-limit answer stops the load at once (aborted = true; the partial map is still returned).
 */
export async function loadMedianDailyVolumes(
    fetchImpl: FetchLike,
    symbols: readonly string[],
    days: number,
    now: () => number,
    concurrency = 4,
): Promise<MedianVolumeLoad> {
    const result: MedianVolumeLoad = { medians: new Map(), young: 0, failed: 0, aborted: false };
    const queue = symbols.slice();
    const worker = async () => {
        while (queue.length > 0 && !result.aborted) {
            const symbol = queue.shift() as string;
            try {
                const body = await getJson(fetchImpl, `${SPOT_KLINES_URL}?symbol=${encodeURIComponent(symbol)}&interval=1d&limit=${days + 1}`);
                const median = parseMedianDailyQuoteVolume(body, days, now());
                if (median === null) result.young++;
                else result.medians.set(symbol, median);
            } catch (err) {
                if (isRateLimited(err)) result.aborted = true;
                result.failed++;
            }
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, symbols.length)) }, worker));
    return result;
}
