// Data access for the funding-squeeze views of the Terminal (Binance USDⓈ-M futures, public REST).
//
// Every exported function either resolves (possibly with null / partial data) or rejects with an Error
// whose message is Turkish and safe to show in the UI. Nothing here throws synchronously.
//
// Rate limits this module lives under:
//   - GET /fapi/v1/fundingRate shares 500 requests / 5 min / IP with /fapi/v1/fundingInfo and reports no
//     used-weight header, so it gets its own limiter below (≤ 60 / 5 min, 2 concurrent, pause on 429/418).
//   - GET /futures/data/openInterestHist shares ~1000 requests / 5 min / IP with the ratio endpoints and
//     therefore goes through terminalData's shared queue (low priority).
//   - GET /fapi/v1/klines with limit < 100 costs weight 1 of the general 2400 / min budget.

import { fundingTo8h } from '../../utils/fundingSqueeze';
import type { SqueezeDetails } from '../../utils/fundingSqueeze';
import { atr } from './indicators';
import { fetchRatio, queuedFuturesDataFetch } from './terminalData';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FAPI_BASE = 'https://fapi.binance.com';
const REQUEST_TIMEOUT_MS = 10_000;
const HOUR_MS = 3_600_000;
const EIGHT_HOURS_MS = 8 * HOUR_MS;
const DEFAULT_FUNDING_INTERVAL_HOURS = 8;
const ERROR_TTL_MS = 30_000; // short negative cache: a failing symbol is not re-requested on every call
const CACHE_MAX_ENTRIES = 300;

const MSG = {
    network: 'Binance sunucusuna ulaşılamadı. İnternet bağlantınızı kontrol edin.',
    timeout: 'Binance isteği zaman aşımına uğradı.',
    rateLimit: 'Binance istek limiti aşıldı. Lütfen biraz sonra tekrar deneyin.',
    budget: 'Funding istek kotası doldu. Birkaç dakika içinde tekrar denenecek.',
    parse: 'Binance yanıtı okunamadı.',
    settled: 'Son funding ödemeleri alınamadı.',
    history: 'Funding geçmişi alınamadı.',
    openInterest: 'Açık pozisyon geçmişi alınamadı.',
    price: 'Fiyat geçmişi alınamadı.',
    invalidSymbol: (symbol: string) => `Geçersiz sembol: ${symbol || '(boş)'}`,
    http: (status: number) => `Binance isteği başarısız oldu (HTTP ${status}).`,
};

// ---------------------------------------------------------------------------
// HTTP helpers (same conventions as terminalData.ts, whose fetchJson is module-private)
// ---------------------------------------------------------------------------

class FundingRequestError extends Error {
    status: number;
    code: number | null;
    retryAfterMs: number | null;

    constructor(message: string, status: number, code: number | null, retryAfterMs: number | null) {
        super(message);
        this.name = 'FundingRequestError';
        this.status = status;
        this.code = code;
        this.retryAfterMs = retryAfterMs;
    }
}

const isRateLimitStatus = (status: number): boolean => status === 429 || status === 418;

/** Works for this module's errors and for terminalData's (which carry the same fields). */
const errorStatus = (err: unknown): number | null => {
    const status = (err as { status?: unknown } | null)?.status;
    return typeof status === 'number' ? status : null;
};

const errorRetryAfterMs = (err: unknown): number | null => {
    const ms = (err as { retryAfterMs?: unknown } | null)?.retryAfterMs;
    return typeof ms === 'number' && ms > 0 ? ms : null;
};

/** Binance answers HTTP 400 (-1121 / -1100) for symbols that do not exist on the market. */
const isInvalidSymbolError = (err: unknown): boolean => {
    if (errorStatus(err) !== 400) return false;
    const code = (err as { code?: unknown } | null)?.code;
    return code === -1121 || code === -1100;
};

const toError = (err: unknown, fallback: string): Error =>
    err instanceof Error && err.message ? err : new Error(fallback);

const num = (value: unknown, fallback = 0): number => {
    const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
    return Number.isFinite(n) ? n : fallback;
};

const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const requireSymbol = (symbol: string): string => {
    const s = String(symbol ?? '').trim().toUpperCase();
    // Binance also lists symbols with CJK characters.
    if (!/^[\p{L}\p{N}_]{2,40}$/u.test(s)) throw new Error(MSG.invalidSymbol(String(symbol ?? '')));
    return s;
};

const clampInt = (value: number | undefined, fallback: number, min: number, max: number): number => {
    const n = Math.floor(Number.isFinite(value as number) ? (value as number) : fallback);
    return Math.min(max, Math.max(min, n));
};

/** GET fapi JSON at low fetch priority: everything here is secondary to the charts' own requests. */
async function getJson(path: string, params: Record<string, string | number>): Promise<unknown> {
    const qs = Object.entries(params)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
    const url = qs ? `${FAPI_BASE}${path}?${qs}` : `${FAPI_BASE}${path}`;

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
    try {
        let res: Response;
        try {
            // `priority` is ignored by browsers that do not support it.
            const init: RequestInit & { priority?: 'high' | 'low' | 'auto' } = { priority: 'low' };
            if (controller) init.signal = controller.signal;
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
                throw new FundingRequestError(MSG.rateLimit, res.status, code, retryAfterMs);
            }
            throw new FundingRequestError(MSG.http(res.status), res.status, code, null);
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

// ---------------------------------------------------------------------------
// Small promise cache (in-flight sharing + TTL + short negative cache)
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
    expires: number;
    promise: Promise<T>;
}

function pruneCache(cache: Map<string, { expires: number }>): void {
    if (cache.size <= CACHE_MAX_ENTRIES) return;
    const now = Date.now();
    for (const [key, entry] of cache) if (entry.expires <= now) cache.delete(key);
    while (cache.size > CACHE_MAX_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
    }
}

function cachedLoad<T>(cache: Map<string, CacheEntry<T>>, key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.promise;

    const entry: CacheEntry<T> = { expires: Number.POSITIVE_INFINITY, promise: load() }; // in flight: shared
    cache.set(key, entry);
    pruneCache(cache);
    entry.promise.then(
        () => {
            entry.expires = Date.now() + ttlMs;
        },
        () => {
            entry.expires = Date.now() + ERROR_TTL_MS;
        },
    );
    return entry.promise;
}

// ---------------------------------------------------------------------------
// Limiter for /fapi/v1/fundingRate (500 requests / 5 min / IP, shared with /fapi/v1/fundingInfo)
// ---------------------------------------------------------------------------

type FundingRequestKind = 'bulk' | 'history';

interface LimiterTask {
    run: () => Promise<void>;
    reject: (err: Error) => void;
}

const FR_MAX_CONCURRENT = 2;
const FR_WINDOW_MS = 5 * 60_000;
// Far below Binance's 500: the same IP may have several tabs open (each has its own budget), and the
// terminal itself loads /fapi/v1/fundingInfo from the same allowance.
const FR_BUDGET_TOTAL = 60;
const FR_BUDGET_HISTORY = 54; // per-symbol history may not starve the bulk "last settlement" load
const FR_DEFAULT_BLOCK_MS = 60_000;

const frBulkQueue: LimiterTask[] = [];    // FIFO
const frHistoryQueue: LimiterTask[] = []; // LIFO: the most recently requested (selected) symbol goes first
const frStartTimes: number[] = [];
let frActive = 0;
let frBlockedUntil = 0;

function pumpFundingQueue(): void {
    const now = Date.now();

    if (frBlockedUntil > now) {
        const err = new Error(MSG.rateLimit);
        frBulkQueue.splice(0).forEach((t) => t.reject(err));
        frHistoryQueue.splice(0).forEach((t) => t.reject(err));
        return;
    }

    while (frStartTimes.length && now - frStartTimes[0] >= FR_WINDOW_MS) frStartTimes.shift();

    while (frActive < FR_MAX_CONCURRENT) {
        let task: LimiterTask | undefined;
        if (frBulkQueue.length && frStartTimes.length < FR_BUDGET_TOTAL) task = frBulkQueue.shift();
        else if (frHistoryQueue.length && frStartTimes.length < FR_BUDGET_HISTORY) task = frHistoryQueue.pop();
        if (!task) break;

        frActive++;
        frStartTimes.push(now);
        task.run().finally(() => {
            frActive--;
            pumpFundingQueue();
        });
    }

    // A free slot with work left means the 5-minute budget is spent. Fail fast instead of holding the
    // promises (and the UI's loading states) for minutes; callers ask again on their next refresh.
    if (frActive < FR_MAX_CONCURRENT) {
        const err = new Error(MSG.budget);
        if (frStartTimes.length >= FR_BUDGET_TOTAL) frBulkQueue.splice(0).forEach((t) => t.reject(err));
        if (frStartTimes.length >= FR_BUDGET_HISTORY) frHistoryQueue.splice(0).forEach((t) => t.reject(err));
    }
}

function enqueueFunding<T>(fn: () => Promise<T>, kind: FundingRequestKind): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const task: LimiterTask = {
            reject,
            run: () =>
                fn().then(resolve, (err: unknown) => {
                    const status = errorStatus(err);
                    if (status !== null && isRateLimitStatus(status)) {
                        frBlockedUntil = Math.max(frBlockedUntil, Date.now() + (errorRetryAfterMs(err) ?? FR_DEFAULT_BLOCK_MS));
                    }
                    reject(toError(err, MSG.network));
                }),
        };
        (kind === 'bulk' ? frBulkQueue : frHistoryQueue).push(task);
        pumpFundingQueue();
    });
}

// ---------------------------------------------------------------------------
// Last settled funding rate of every symbol
// ---------------------------------------------------------------------------
//
// What GET /fapi/v1/fundingRate does without `symbol` (verified live, 2026-10-05):
//   - no time range: the most recent `limit` (max 1000) settlement records of ALL symbols, ascending by
//     fundingTime; with startTime/endTime: the first `limit` records inside the window, ascending.
//   - every record of one settlement carries (nearly) the same fundingTime: the boundary + 0..2 ms. Paging
//     by time inside a batch is therefore impossible; whole batches are read with a ±1 min window.
//   - every symbol settles at the 8h boundaries (00/08/16 UTC): that batch has one record per symbol
//     (791 records, all 740 trading USDT perpetuals among them). 4h symbols (473) also settle at
//     04/12/20 UTC and the single 1h symbol every hour.
//   - so "latest 1000" covers everything only during the first 4 hours after an 8h boundary
//     (791 + ≤3 records): 1 request. Afterwards (473 + ≤7 newer records) the 8h batch is cut off and is
//     read by its own window: 2 requests.
//   - whether the batch of a boundary that has just passed is published atomically could not be observed.
//     While the 8h batch is the newest thing in the response (the hour after an 8h boundary) the previous
//     8h batch is therefore merged underneath as a floor, so every symbol has a value: 2 requests.
//   - 3 requests would only be needed if one settlement had more than 1000 records; a batch that large
//     cannot be read completely at all (same timestamp, no paging), the result is then partial.

interface SettledFunding {
    rate: number;
    time: number;
}

interface RawFundingRecord {
    symbol?: unknown;
    fundingTime?: unknown;
    fundingRate?: unknown;
}

const SETTLED_TTL_MS = 10 * 60_000;
const SETTLED_PARTIAL_TTL_MS = 60_000;
const SETTLED_PAGE_LIMIT = 1000;
const SETTLED_BATCH_WINDOW_MS = 60_000;
// How long after a funding boundary its records are assumed to be published completely.
const SETTLE_PUBLISH_GRACE_MS = 90_000;

let settledCache: CacheEntry<Map<string, SettledFunding>> | null = null;

async function requestSettlements(params: Record<string, string | number>): Promise<RawFundingRecord[]> {
    const raw = await enqueueFunding(() => getJson('/fapi/v1/fundingRate', params), 'bulk');
    if (!Array.isArray(raw)) throw new Error(MSG.parse);
    return raw as RawFundingRecord[];
}

const requestSettlementBatch = (boundary: number): Promise<RawFundingRecord[]> =>
    requestSettlements({
        startTime: boundary - SETTLED_BATCH_WINDOW_MS,
        endTime: boundary + SETTLED_BATCH_WINDOW_MS,
        limit: SETTLED_PAGE_LIMIT,
    });

/** Keeps the newest record of each symbol. */
function mergeSettlements(into: Map<string, SettledFunding>, records: RawFundingRecord[]): void {
    for (const r of records) {
        const symbol = typeof r?.symbol === 'string' ? r.symbol : '';
        const time = num(r?.fundingTime, NaN);
        const rate = num(r?.fundingRate, NaN);
        if (!symbol || !Number.isFinite(time) || time <= 0 || !Number.isFinite(rate)) continue;
        const prev = into.get(symbol);
        if (!prev || time > prev.time) into.set(symbol, { rate, time });
    }
}

async function loadLatestSettled(): Promise<{ map: Map<string, SettledFunding>; complete: boolean }> {
    const map = new Map<string, SettledFunding>();
    const latest = await requestSettlements({ limit: SETTLED_PAGE_LIMIT });
    mergeSettlements(map, latest);
    if (!map.size) throw new Error(MSG.settled);

    let complete = true;
    if (latest.length >= SETTLED_PAGE_LIMIT) {
        let oldest = Number.POSITIVE_INFINITY;
        let newest = 0;
        for (const entry of map.values()) if (entry.time > newest) newest = entry.time;
        for (const r of latest) {
            const time = num(r?.fundingTime, NaN);
            if (Number.isFinite(time) && time > 0 && time < oldest) oldest = time;
        }

        // Boundaries come from the data, not from the local clock (which may be wrong).
        const lastAllSymbolBatch = Math.floor(newest / EIGHT_HOURS_MS) * EIGHT_HOURS_MS;
        const batches: number[] = [];
        // The response does not reach back past the 8h batch: part of that batch is cut off.
        if (!(oldest < lastAllSymbolBatch - SETTLED_BATCH_WINDOW_MS)) batches.push(lastAllSymbolBatch);
        // Nothing newer than the 8h batch itself: it may still be being published.
        if (newest - lastAllSymbolBatch < SETTLED_BATCH_WINDOW_MS) batches.push(lastAllSymbolBatch - EIGHT_HOURS_MS);

        const results = await Promise.all(
            batches.map((boundary) =>
                requestSettlementBatch(boundary).then(
                    (list) => list,
                    () => null,
                ),
            ),
        );
        for (const list of results) {
            if (list) mergeSettlements(map, list);
            else complete = false; // partial result: still useful, retried soon
        }
    }
    return { map, complete };
}

/** Never serves a result across a funding boundary: the "last settlement" changes there. */
function settledExpiry(now: number, complete: boolean): number {
    if (!complete) return now + SETTLED_PARTIAL_TTL_MS;
    const hour = Math.floor(now / HOUR_MS) * HOUR_MS;
    const published = hour + SETTLE_PUBLISH_GRACE_MS;
    const nextLook = now < published ? published : hour + HOUR_MS + SETTLE_PUBLISH_GRACE_MS;
    return Math.min(now + SETTLED_TTL_MS, nextLook);
}

/**
 * The most recent SETTLED funding rate (fraction, per the symbol's own interval) and its settlement time
 * for every symbol, in 1–2 requests (never more than 3). Cached for up to 10 minutes and never across
 * a funding hour; the same Map instance is returned while the cache is valid, so treat it as read-only.
 */
export function fetchLatestSettledFunding(): Promise<Map<string, { rate: number; time: number }>> {
    try {
        const hit = settledCache;
        if (hit && hit.expires > Date.now()) return hit.promise;

        const entry: CacheEntry<Map<string, SettledFunding>> = {
            expires: Number.POSITIVE_INFINITY, // in flight: share the promise
            promise: Promise.resolve(null).then(async () => {
                try {
                    const { map, complete } = await loadLatestSettled();
                    entry.expires = settledExpiry(Date.now(), complete);
                    return map;
                } catch (err) {
                    entry.expires = Date.now() + ERROR_TTL_MS;
                    throw toError(err, MSG.settled);
                }
            }),
        };
        settledCache = entry;
        return entry.promise;
    } catch (err) {
        return Promise.reject(toError(err, MSG.settled));
    }
}

// ---------------------------------------------------------------------------
// Funding history of one symbol
// ---------------------------------------------------------------------------

interface FundingPoint {
    time: number;
    rate: number;
}

interface HistoryEntry extends CacheEntry<FundingPoint[]> {
    limit: number;
    complete: boolean; // fewer records than requested came back: this is the symbol's whole history
}

const HISTORY_TTL_MS = 60 * 60_000;
const HISTORY_DEFAULT_LIMIT = 100;
const HISTORY_MAX_LIMIT = 1000;
const HISTORY_OVERDUE_RETRY_MS = 2 * 60_000;
const HISTORY_OVERDUE_MAX_MS = 15 * 60_000;

const historyCache = new Map<string, HistoryEntry>();

async function requestHistory(sym: string, limit: number): Promise<FundingPoint[]> {
    const raw = await getJson('/fapi/v1/fundingRate', { symbol: sym, limit });
    if (!Array.isArray(raw)) throw new Error(MSG.parse);
    const out: FundingPoint[] = [];
    for (const r of raw as RawFundingRecord[]) {
        const time = num(r?.fundingTime, NaN);
        const rate = num(r?.fundingRate, NaN);
        if (Number.isFinite(time) && time > 0 && Number.isFinite(rate)) out.push({ time, rate });
    }
    out.sort((a, b) => a.time - b.time);
    return out;
}

/** One hour at most, but not across the symbol's next settlement (which appends a record). */
function historyExpiry(list: FundingPoint[], now: number): number {
    const ttl = now + HISTORY_TTL_MS;
    if (list.length < 2) return ttl;
    const last = list[list.length - 1].time;
    const step = last - list[list.length - 2].time;
    if (!(step >= HOUR_MS - 60_000 && step <= EIGHT_HOURS_MS + 60_000)) return ttl;
    const due = last + step + SETTLE_PUBLISH_GRACE_MS; // when the next settlement should be readable
    if (due > now) return Math.min(ttl, due);
    // Overdue: not published yet (look again soon), or the interval changed / the symbol stopped (give up).
    return now - due < HISTORY_OVERDUE_MAX_MS ? now + HISTORY_OVERDUE_RETRY_MS : ttl;
}

/**
 * Settled funding rates of a symbol, oldest → newest (default: the last 100 settlements). Cached for up
 * to one hour. An unknown symbol resolves to an empty list.
 */
export function fetchFundingHistory(
    symbol: string,
    limit: number = HISTORY_DEFAULT_LIMIT,
): Promise<Array<{ time: number; rate: number }>> {
    try {
        const sym = requireSymbol(symbol);
        const lim = clampInt(limit, HISTORY_DEFAULT_LIMIT, 1, HISTORY_MAX_LIMIT);
        const tail = (list: FundingPoint[]): FundingPoint[] => list.slice(-lim);

        const hit = historyCache.get(sym);
        if (hit && hit.expires > Date.now() && (hit.limit >= lim || hit.complete)) return hit.promise.then(tail);

        const entry: HistoryEntry = {
            limit: lim,
            complete: false,
            expires: Number.POSITIVE_INFINITY, // in flight: share the promise
            promise: enqueueFunding(() => requestHistory(sym, lim), 'history'),
        };
        historyCache.set(sym, entry);
        pruneCache(historyCache);
        entry.promise.then(
            (list) => {
                entry.complete = list.length < lim;
                entry.expires = historyExpiry(list, Date.now());
            },
            () => {
                entry.expires = Date.now() + ERROR_TTL_MS;
            },
        );
        return entry.promise.then(tail, (err: unknown) => {
            throw toError(err, MSG.history);
        });
    } catch (err) {
        return Promise.reject(toError(err, MSG.history));
    }
}

const FUNDING_INTERVALS_HOURS: readonly number[] = [1, 2, 4, 8];

/**
 * 8h-equivalent rates of a funding history (oldest → newest). Binance shortens the interval of volatile
 * symbols (8h → 4h → 1h), so each settlement is converted with the interval it actually closed — the gap
 * to its neighbour — and only falls back to `intervalHours` (the symbol's current interval) when that gap
 * is not a funding interval (first listing, missing records).
 */
export function historyToF8(history: Array<{ time: number; rate: number }>, intervalHours: number): number[] {
    const fallback = isNum(intervalHours) && intervalHours > 0 ? intervalHours : DEFAULT_FUNDING_INTERVAL_HOURS;
    const gapHours = (a: number, b: number): number | null => {
        const hours = (b - a) / HOUR_MS;
        const rounded = Math.round(hours);
        return Math.abs(hours - rounded) < 0.05 && FUNDING_INTERVALS_HOURS.includes(rounded) ? rounded : null;
    };
    const out: number[] = [];
    for (let i = 0; i < history.length; i++) {
        let hours: number | null = null;
        if (i > 0) hours = gapHours(history[i - 1].time, history[i].time);
        else if (history.length > 1) hours = gapHours(history[0].time, history[1].time);
        out.push(fundingTo8h(history[i].rate, hours ?? fallback));
    }
    return out;
}

// ---------------------------------------------------------------------------
// Open interest change (hourly statistics)
// ---------------------------------------------------------------------------

interface OiChange {
    oi: number;
    change1hPct: number | null;
    change4hPct: number | null;
    change24hPct: number | null;
}

interface RawOiPoint {
    sumOpenInterest?: unknown;
    timestamp?: unknown;
}

const OI_TTL_MS = 5 * 60_000;
const OI_POINTS = 25; // hourly: the last full hour and the 24 before it
const OI_MATCH_TOLERANCE_MS = 5 * 60_000;
const STALE_AFTER_MS = 3 * HOUR_MS;

const oiCache = new Map<string, CacheEntry<OiChange | null>>();

/**
 * Open interest in contracts (base asset), not in USDT: the notional value moves with the price even
 * when nobody opens or closes a position. The newest point is the last full hour, so the changes are
 * measured hour boundary to hour boundary and trail the present by up to 60 minutes.
 */
function toOiChange(raw: unknown, now: number): OiChange | null {
    if (!Array.isArray(raw)) throw new Error(MSG.parse);
    const points: Array<{ time: number; oi: number }> = [];
    for (const p of raw as RawOiPoint[]) {
        const time = num(p?.timestamp, NaN);
        const oi = num(p?.sumOpenInterest, NaN);
        if (Number.isFinite(time) && time > 0 && Number.isFinite(oi) && oi > 0) points.push({ time, oi });
    }
    if (!points.length) return null;
    points.sort((a, b) => a.time - b.time);

    const last = points[points.length - 1];
    if (now - last.time > STALE_AFTER_MS) return null; // statistics stopped (halted / delisted symbol)

    const changeOver = (hours: number): number | null => {
        const target = last.time - hours * HOUR_MS;
        for (let i = points.length - 2; i >= 0; i--) {
            const delta = points[i].time - target;
            if (Math.abs(delta) <= OI_MATCH_TOLERANCE_MS) return (last.oi / points[i].oi - 1) * 100;
            if (delta < 0) break;
        }
        return null; // the symbol is younger than that, or the point is missing
    };

    return { oi: last.oi, change1hPct: changeOver(1), change4hPct: changeOver(4), change24hPct: changeOver(24) };
}

async function loadOiChange(sym: string): Promise<OiChange | null> {
    try {
        const raw = await queuedFuturesDataFetch(
            '/futures/data/openInterestHist',
            { symbol: sym, period: '1h', limit: OI_POINTS },
            'low',
        );
        return toOiChange(raw, Date.now());
    } catch (err) {
        if (isInvalidSymbolError(err)) return null;
        throw toError(err, MSG.openInterest);
    }
}

/**
 * Latest hourly open interest (contracts) and its change over 1h / 4h / 24h in percent. Resolves null
 * when Binance has no open interest statistics for the symbol. Cached for 5 minutes.
 */
export function fetchOiChange(
    symbol: string,
): Promise<{ oi: number; change1hPct: number | null; change4hPct: number | null; change24hPct: number | null } | null> {
    try {
        const sym = requireSymbol(symbol);
        return cachedLoad(oiCache, sym, OI_TTL_MS, () => loadOiChange(sym)).then((v) => (v ? { ...v } : null));
    } catch (err) {
        return Promise.reject(toError(err, MSG.openInterest));
    }
}

// ---------------------------------------------------------------------------
// Price context (1h klines of the futures contract itself)
// ---------------------------------------------------------------------------
//
// Requested directly (30 hourly candles, weight 1, low fetch priority) instead of through
// terminalData.fetchKlines: that loader runs at high priority and writes into the charts' kline cache,
// where a 30-candle series of every candidate would (a) be painted as the "instant" history of the 1h
// chart when the symbol is opened, (b) push real chart history out of the 24-entry persisted cache and
// (c) change the intervals the watchlist prefetches on hover.

interface PriceContext {
    change1hPct: number | null;
    change4hPct: number | null;
    change24hPct: number | null;
    atr1hPct: number | null;
}

interface HourBar {
    time: number; // open time, ms
    open: number;
    high: number;
    low: number;
    close: number;
}

const PRICE_TTL_MS = 2 * 60_000;
const PRICE_KLINE_LIMIT = 30;
const ATR_PERIOD = 14;
const KLINE_DEFAULT_BLOCK_MS = 60_000;

const priceCache = new Map<string, CacheEntry<PriceContext | null>>();
let klineBlockedUntil = 0;

/**
 * Change of the latest price against the price N hours ago. Hourly candles only know the price at hour
 * boundaries, so "N hours ago" is snapped to the nearest one: the window is N h ± 30 min and uses traded
 * prices only (no interpolation inside a candle). ATR(14, Wilder) runs on closed candles and is given
 * as a percentage of the latest price.
 */
function toPriceContext(bars: HourBar[], now: number): PriceContext | null {
    if (!bars.length) return null;
    const last = bars[bars.length - 1];
    if (now - last.time > STALE_AFTER_MS) return null; // no recent trading
    const price = last.close;
    if (!(price > 0)) return null;

    const forming = now - last.time < HOUR_MS;
    const elapsed = Math.min(HOUR_MS, Math.max(0, now - last.time));

    /** Price at the hour boundary `time`: the open of the candle starting there, else the close before it. */
    const priceAt = (time: number): number | null => {
        for (let i = bars.length - 1; i >= 0; i--) {
            if (bars[i].time === time) return bars[i].open;
            if (bars[i].time === time - HOUR_MS) return bars[i].close;
            if (bars[i].time < time - HOUR_MS) break;
        }
        return null;
    };

    const changeOver = (hours: number): number | null => {
        const boundary = last.time - hours * HOUR_MS + (elapsed >= HOUR_MS / 2 ? HOUR_MS : 0);
        const ref = priceAt(boundary);
        return ref !== null && ref > 0 ? (price / ref - 1) * 100 : null;
    };

    let atr1hPct: number | null = null;
    const closed = forming ? bars.slice(0, -1) : bars;
    if (closed.length >= ATR_PERIOD) {
        const series = atr(
            closed.map((b) => b.high),
            closed.map((b) => b.low),
            closed.map((b) => b.close),
            ATR_PERIOD,
        );
        const value = series[series.length - 1];
        if (isNum(value)) atr1hPct = (value / price) * 100;
    }

    return { change1hPct: changeOver(1), change4hPct: changeOver(4), change24hPct: changeOver(24), atr1hPct };
}

async function loadPriceContext(sym: string): Promise<PriceContext | null> {
    try {
        if (klineBlockedUntil > Date.now()) throw new Error(MSG.rateLimit);
        const raw = await getJson('/fapi/v1/klines', { symbol: sym, interval: '1h', limit: PRICE_KLINE_LIMIT });
        if (!Array.isArray(raw)) throw new Error(MSG.parse);

        const bars: HourBar[] = [];
        for (const k of raw as unknown[][]) {
            if (!Array.isArray(k) || k.length < 5) continue;
            const bar: HourBar = { time: num(k[0], NaN), open: num(k[1], NaN), high: num(k[2], NaN), low: num(k[3], NaN), close: num(k[4], NaN) };
            if (bar.time > 0 && bar.open > 0 && bar.high > 0 && bar.low > 0 && bar.close > 0) bars.push(bar);
        }
        bars.sort((a, b) => a.time - b.time);
        return toPriceContext(bars, Date.now());
    } catch (err) {
        if (isInvalidSymbolError(err)) return null;
        const status = errorStatus(err);
        if (status !== null && isRateLimitStatus(status)) {
            klineBlockedUntil = Math.max(klineBlockedUntil, Date.now() + (errorRetryAfterMs(err) ?? KLINE_DEFAULT_BLOCK_MS));
        }
        throw toError(err, MSG.price);
    }
}

/**
 * Price change of the futures contract over ~1h / ~4h / ~24h (percent) and its hourly ATR(14) as a
 * percentage of the price. Resolves null for an unknown or inactive symbol. Cached for 2 minutes.
 */
export function fetchPriceContext(
    symbol: string,
): Promise<{ change1hPct: number | null; change4hPct: number | null; change24hPct: number | null; atr1hPct: number | null } | null> {
    try {
        const sym = requireSymbol(symbol);
        return cachedLoad(priceCache, sym, PRICE_TTL_MS, () => loadPriceContext(sym)).then((v) => (v ? { ...v } : null));
    } catch (err) {
        return Promise.reject(toError(err, MSG.price));
    }
}

// ---------------------------------------------------------------------------
// Everything the squeeze checklist needs for one symbol
// ---------------------------------------------------------------------------

// A request normally answers within a second and times out after 10 s, but one waiting in the shared
// /futures/data queue for budget (a heavily scrolled watchlist can spend the low-priority share) may
// take minutes. The checklist must not wait for that: the late answer still lands in its cache and is
// picked up by the next refresh.
const DETAIL_SOURCE_TIMEOUT_MS = 15_000;

/** A source that fails, throws or takes too long simply contributes nothing. */
function settle<T>(start: () => Promise<T>): Promise<T | null> {
    return new Promise<T | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), DETAIL_SOURCE_TIMEOUT_MS);
        const done = (value: T | null) => {
            clearTimeout(timer);
            resolve(value);
        };
        try {
            start().then(done, () => done(null));
        } catch {
            done(null);
        }
    });
}

/**
 * Funding history, open interest change, price context and the global long/short account ratio of a
 * symbol, loaded concurrently. Never rejects: a source that fails leaves its fields undefined.
 * `intervalHours` is the symbol's current funding interval (FuturesRow.fundingIntervalHours).
 */
export function loadSqueezeDetails(symbol: string, intervalHours: number): Promise<SqueezeDetails> {
    return Promise.all([
        settle(() => fetchFundingHistory(symbol)),
        settle(() => fetchOiChange(symbol)),
        settle(() => fetchPriceContext(symbol)),
        settle(() => fetchRatio('longShortAccounts', symbol, '1h', 1)),
    ]).then(([history, oi, price, ratios]) => {
        const details: SqueezeDetails = {};

        if (history && history.length) details.ownHistoryF8 = historyToF8(history, intervalHours);

        if (price) {
            if (isNum(price.change1hPct)) details.change1hPct = price.change1hPct;
            if (isNum(price.change4hPct)) details.change4hPct = price.change4hPct;
            if (isNum(price.change24hPct)) details.change24hPct = price.change24hPct;
            if (isNum(price.atr1hPct)) details.atr1hPct = price.atr1hPct;
        }

        if (oi) {
            if (isNum(oi.change4hPct)) details.oiChange4hPct = oi.change4hPct;
            if (isNum(oi.change24hPct)) details.oiChange24hPct = oi.change24hPct;
        }

        const latestRatio = ratios && ratios.length ? ratios[ratios.length - 1] : null;
        if (latestRatio && isNum(latestRatio.long)) details.globalLongShare = latestRatio.long;

        return details;
    });
}
