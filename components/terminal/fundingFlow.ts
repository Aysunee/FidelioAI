// Live funding-flow store for the Terminal page ("negatif funding sıkışması" araçları).
//
// TerminalPage pushes its universe rows into feedFundingRows() on every update. The store runs at most one
// detection pass per second (pure logic lives in utils/fundingSqueeze.ts), keeps the event feed and the list
// of active extreme-funding candidates, and lazily loads the per-symbol details the squeeze checklist needs.
// Everything here is a DESCRIPTIVE state ("what is happening"), never a prediction or a trade signal.
//
// Universe: crypto perpetuals only. TradFi perps (stocks / FX / commodities, FuturesRow.isTradFi) follow other
// funding regimes; they would shift the gates and crowd out crypto candidates, so they are left out of the
// statistics and of the detection (they are never candidates and never appear in the feed).
//
// Scheduling: there is no free-running interval. A pass is a one-shot timeout armed by a feed call or by an
// async load finishing, so when the feed stops the store goes completely quiet within a second.

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { FuturesRow } from './types';
import { formatFundingPct, formatPct } from './format';
import {
    assessSqueeze,
    computeUniverseStats,
    createDetectorState,
    detectFundingEvents,
    fundingTo8h,
    percentileOf,
} from '../../utils/fundingSqueeze';
import type {
    DetectorState,
    FundingEpisode,
    FundingEvent,
    FundingSide,
    SqueezeAssessment,
    SqueezeClass,
    SqueezeDetails,
    UniverseStats,
} from '../../utils/fundingSqueeze';
import { fetchFundingHistory, fetchLatestSettledFunding, loadSqueezeDetails } from './fundingData';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FundingCandidate {
    symbol: string;
    baseAsset: string;
    side: FundingSide;
    f8: number;                 // 8h-equivalent predicted rate (fraction)
    rate: number;               // raw predicted rate of the current interval (fraction)
    intervalHours: number;
    nextFundingTime: number;
    price: number;
    changePct: number;          // 24h %
    quoteVolume: number;
    lowLiquidity: boolean;
    since: number;              // ms epoch the episode started (or was first seen)
    universePercentile: number; // 0..1 share of the universe with f8 <= this symbol's f8
    prevSettledRate: number | null;
    diff: number | null;        // rate - prevSettledRate
    details: SqueezeDetails | null;
    assessment: SqueezeAssessment | null; // negative side only
    detailsLoading: boolean;
}

export interface FundingFlowSnapshot {
    ready: boolean;
    events: FundingEvent[];          // newest first
    candidates: FundingCandidate[];  // negative side first, most negative f8 first
    stats: UniverseStats | null;
    settledBySymbol: Map<string, { rate: number; time: number }> | null;
    updatedAt: number;
}

export type FundingHistoryPoint = { time: number; rate: number };

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const PASS_INTERVAL_MS = 1_000;
const IDLE_AFTER_MS = 30_000;            // no subscribers AND no feed for this long: do nothing at all
const MAX_EVENTS = 200;
const EVENTS_STORAGE_KEY = 'fidelio_funding_events_v1';
const EVENT_MAX_AGE_MS = 24 * 60 * 60_000;
// Declared up here because the stored feed is restored while the module state below is being initialised.
const EVENT_TYPES: ReadonlySet<string> = new Set(['FLIP', 'EXTREME', 'DEEPENING', 'EASING', 'EXIT']);
const OPEN_EPISODE_MEMORY_MS = 6 * 60 * 60_000; // a restored "extreme" event this recent suppresses its re-announcement

const SETTLED_REFRESH_MS = 10 * 60_000;
const SETTLED_RETRY_MS = 60_000;
const SEED_WAIT_MS = 5_000;              // the first pass waits at most this long for settled rates / live funding fields

const DETAILS_TOP_N = 12;
const DETAILS_REFRESH_MS = 5 * 60_000;
const DETAILS_RETRY_MS = 60_000;
const DETAILS_CONCURRENCY = 2;
const DETAILS_KEEP_MS = 10 * 60_000;     // entries of symbols that dropped out of the top list are kept this long

const RESEED_GAP_MS = 5 * 60_000;        // feed paused longer than this: start a fresh detector (no back-dated events)
// A candidate's class changes on the scale of minutes (4h price / open interest); re-assessing every live
// tick would dominate the pass, so an unchanged-details candidate is re-assessed at most every few seconds.
const ASSESS_MIN_INTERVAL_MS = 5_000;
const ASSESS_PER_PASS = 3;
const STATS_PUBLISH_MS = 10_000;
const LOW_LIQUIDITY_QUOTE_VOLUME = 5_000_000;

const SELECTED_REFRESH_MS = 5 * 60_000;
const HISTORY_LIMIT = 100;
const MSG_DETAILS = 'Fiyat ve açık pozisyon verileri alınamadı.';
const MSG_HISTORY = 'Fonlama geçmişi alınamadı.';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const isFiniteNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

const isHidden = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'hidden';

const perfNow = (): number =>
    typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();

const errorMessage = (err: unknown, fallback: string): string =>
    err instanceof Error && err.message ? err.message : fallback;

const hasAnyDetail = (d: SqueezeDetails | null | undefined): d is SqueezeDetails => {
    if (!d) return false;
    return (
        (Array.isArray(d.ownHistoryF8) && d.ownHistoryF8.length > 0) ||
        isFiniteNumber(d.change1hPct) ||
        isFiniteNumber(d.change4hPct) ||
        isFiniteNumber(d.change24hPct) ||
        isFiniteNumber(d.atr1hPct) ||
        isFiniteNumber(d.oiChange4hPct) ||
        isFiniteNumber(d.oiChange24hPct) ||
        isFiniteNumber(d.globalLongShare)
    );
};

const EMPTY_DETAILS: SqueezeDetails = Object.freeze({}) as SqueezeDetails;

/** A promise for `fn()` that never throws synchronously. */
function safeCall<T>(fn: () => Promise<T>): Promise<T> {
    try {
        return Promise.resolve(fn());
    } catch (err) {
        return Promise.reject(err);
    }
}

// ---------------------------------------------------------------------------
// Presentation helpers shared by FundingFlowPanel and SqueezeChecklist
// ---------------------------------------------------------------------------

/** Funding fraction with sign and 4 decimals: '−0.0350%' · '+0.0050%' · '0.0000%'. */
export const formatSignedFunding = (fraction: number | null | undefined, withSymbol = true): string => {
    if (!isFiniteNumber(fraction)) return '—';
    const body = formatFundingPct(Math.abs(fraction), 4, withSymbol);
    if (Number.parseFloat(body) === 0) return body;
    return `${fraction < 0 ? '−' : '+'}${body}`;
};

/** A value that is already a percent, with a typographic minus: '+12.34%' · '−3.10%'. */
export const formatSignedPct = (pct: number | null | undefined, digits = 2, withSymbol = true): string => {
    const text = formatPct(pct, digits).replace('-', '−');
    return withSymbol ? text : text.replace('%', '');
};

/**
 * Turkish upper-casing for badge texts that mix in English terms: CSS `uppercase` under lang="tr" would
 * turn 'funding' into 'FUNDİNG'.
 */
export const upperTr = (text: string): string => text.toLocaleUpperCase('tr-TR').replace(/FUNDİNG/g, 'FUNDING');

/** Badge colours per squeeze class (token colours only). */
export const SQUEEZE_CLASS_BADGE: Record<SqueezeClass, string> = {
    SHORT_CROWDING_HOLDING: 'bg-primary-soft text-primary',
    POST_PUMP_PRESSURE: 'bg-warning-soft text-warning',
    SHORT_COVERING: 'bg-success-soft text-success',
    SHORTS_RIGHT: 'bg-danger-soft text-danger',
    NEGATIVE_ONLY: 'bg-surface-secondary text-secondary',
    NONE: 'bg-surface-secondary text-muted',
};

/** Badge of a candidate that eased back above the gate but is still inside the hysteresis band. */
export const EASING_BADGE_LABEL = 'Gevşiyor';
export const EASING_BADGE_CLASS = 'bg-surface-secondary text-secondary';

/** One-word class names for dense table cells (at most 7 letters; the full label goes into the tooltip). */
export const SQUEEZE_CLASS_SHORT: Record<SqueezeClass, string> = {
    SHORT_CROWDING_HOLDING: 'Yığılma',
    POST_PUMP_PRESSURE: 'Pompa',
    SHORT_COVERING: 'Kapanış',
    SHORTS_RIGHT: 'Haklı',
    NEGATIVE_ONLY: 'Negatif',
    NONE: '—',
};

/** Turkish possessive suffix after a percentage: %3'ü · %5'i · %10'u · %20'si · %100'ü. */
export const percentSuffix = (n: number): string => {
    if (n === 100) return 'ü';
    const ones = n % 10;
    if (ones !== 0) return ['', 'i', 'si', 'ü', 'ü', 'i', 'sı', 'si', 'i', 'u'][ones];
    return ['ı', 'u', 'si', 'u', 'ı', 'si', 'ı', 'i', 'i', 'ı'][Math.floor(n / 10) % 10];
};

/** 0..1 share -> whole percent between 1 and 100 for "en alt %N" style texts. */
export const wholePercent = (share: number): number => Math.min(100, Math.max(1, Math.round(share * 100)));

/**
 * Where a symbol's f8 stands in the universe: "piyasanın en alt %1'i" (share = share of the universe with a
 * rate <= this symbol's) / "piyasanın en üst %2'si".
 */
export const universeRankSentence = (share: number): string => {
    const low = share <= 0.5;
    const pct = wholePercent(low ? share : 1 - share);
    return `piyasanın en ${low ? 'alt' : 'üst'} %${pct}'${percentSuffix(pct)}`;
};

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

type Listener = () => void;

interface DetailsEntry {
    details: SqueezeDetails | null;
    intervalHours: number;
    nextAt: number;       // earliest time of the next load
    lastWantedAt: number;
    loading: boolean;
    queued: boolean;
}

interface CandidateMemo {
    row: FuturesRow;
    since: number;
    detailsLoading: boolean;
    prevSettledRate: number | null;
    candidate: FundingCandidate;
    // Inputs of the cached assessment (negative side only).
    assessedAt: number;
    assessedRate: number;
    assessedChangePct: number;
    assessedInterval: number;
    assessedNegGate: number;
}

const listeners = new Set<Listener>();

let latestRows: FuturesRow[] = [];           // everything that was fed (TradFi included; used for lookups)
let cryptoRows: FuturesRow[] = [];           // the detection universe: latestRows without TradFi perps
let cryptoRowsFor: FuturesRow[] | null = null;
let rowPositions = new Map<string, number>(); // symbol -> index in the fed array (stable across ticker patches)
let positionsFor: FuturesRow[] | null = null;
let firstFeedAt = 0;
let lastFeedAt = 0;

let passTimer: ReturnType<typeof setTimeout> | null = null;
let lastPassAt = 0;
let seeded = false;
let detectorState: DetectorState | null = null;
let detectorFailed = false;

let events: FundingEvent[] = restoreEvents();
let latestStats: UniverseStats | null = null;
let publishedStats: UniverseStats | null = null;

let settled: Map<string, { rate: number; time: number }> | null = null;
let settledRates: Map<string, number> | null = null;
let settledLoading = false;
let settledNextAt = 0;

const detailsEntries = new Map<string, DetailsEntry>();
const detailsQueue: string[] = [];
const wantedDetails = new Set<string>();
let detailsActive = 0;

let candidateMemo = new Map<string, CandidateMemo>();
let candidateBySymbol = new Map<string, FundingCandidate>();

let snapshot: FundingFlowSnapshot = {
    ready: false,
    events,
    candidates: [],
    stats: null,
    settledBySymbol: null,
    updatedAt: 0,
};

const perf = { passes: 0, lastMs: 0, maxMs: 0, totalMs: 0, detectMs: 0 };

// ---------------------------------------------------------------------------
// Event persistence (sessionStorage, best effort)
// ---------------------------------------------------------------------------

function isStoredEvent(value: unknown): value is FundingEvent {
    if (!value || typeof value !== 'object') return false;
    const e = value as Record<string, unknown>;
    return (
        typeof e.id === 'string' &&
        typeof e.symbol === 'string' &&
        isFiniteNumber(e.time) &&
        (e.side === 'NEG' || e.side === 'POS') &&
        typeof e.type === 'string' &&
        EVENT_TYPES.has(e.type) &&
        isFiniteNumber(e.f8) &&
        isFiniteNumber(e.rate) &&
        isFiniteNumber(e.intervalHours) &&
        (e.prevSettledRate === null || isFiniteNumber(e.prevSettledRate)) &&
        (e.diff === null || isFiniteNumber(e.diff)) &&
        isFiniteNumber(e.nextFundingTime) &&
        isFiniteNumber(e.price) &&
        isFiniteNumber(e.changePct) &&
        typeof e.lowLiquidity === 'boolean' &&
        typeof e.initial === 'boolean'
    );
}

function restoreEvents(): FundingEvent[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = window.sessionStorage.getItem(EVENTS_STORAGE_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        const now = Date.now();
        const seen = new Set<string>();
        const list: FundingEvent[] = [];
        for (const item of parsed) {
            if (!isStoredEvent(item)) continue;
            if (item.time > now + 60_000 || now - item.time > EVENT_MAX_AGE_MS) continue;
            if (seen.has(item.id)) continue;
            seen.add(item.id);
            list.push(item);
        }
        list.sort((a, b) => b.time - a.time);
        return list.slice(0, MAX_EVENTS);
    } catch {
        return []; // storage blocked or corrupted: start with an empty feed
    }
}

function persistEvents(): void {
    if (typeof window === 'undefined') return;
    try {
        window.sessionStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(events));
    } catch {
        /* storage blocked or full: the feed simply is not restored after a reload */
    }
}

/**
 * Merges the events of one pass into the feed (newest first). Start-up ("initial") events are dropped when
 * the restored feed already announced them, so a page reload does not repeat the whole list.
 */
function mergeEvents(incoming: FundingEvent[], now: number): boolean {
    if (!incoming.length) return false;
    const ids = new Set<string>();
    for (const e of events) ids.add(e.id);

    const accepted: FundingEvent[] = [];
    for (const e of incoming) {
        if (!e || ids.has(e.id)) continue;
        if (e.initial && isAlreadyAnnounced(e, now)) continue;
        ids.add(e.id);
        accepted.push(e);
    }
    if (!accepted.length) return false;
    events = accepted.concat(events);
    if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
    return true;
}

function isAlreadyAnnounced(event: FundingEvent, now: number): boolean {
    for (const old of events) {
        if (old.symbol !== event.symbol || old.side !== event.side) continue;
        if (event.type === 'FLIP') {
            // Same flip of the same funding interval.
            if (old.type === 'FLIP' && old.nextFundingTime === event.nextFundingTime) return true;
            continue;
        }
        if (old.type === 'FLIP') continue;
        // Newest episode event of this symbol: still open (not an EXIT) and recent -> already in the feed.
        return old.type !== 'EXIT' && now - old.time < OPEN_EPISODE_MEMORY_MS;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

function schedulePass(): void {
    if (passTimer !== null) return;
    const wait = Math.max(0, lastPassAt + PASS_INTERVAL_MS - Date.now());
    passTimer = setTimeout(runPass, wait);
}

function isIdle(now: number): boolean {
    return listeners.size === 0 && now - lastFeedAt > IDLE_AFTER_MS;
}

/** The detection universe of a fed array (crypto perps only); the same array when it holds no TradFi row. */
function cryptoUniverse(rows: FuturesRow[]): FuturesRow[] {
    if (cryptoRowsFor === rows) return cryptoRows;
    let mixed = false;
    for (let i = 0; i < rows.length; i += 1) {
        if (rows[i].isTradFi) {
            mixed = true;
            break;
        }
    }
    cryptoRows = mixed ? rows.filter((r) => !r.isTradFi) : rows;
    cryptoRowsFor = rows;
    return cryptoRows;
}

/**
 * Latest fed row of a symbol. The universe keeps its order while ticker patches replace single rows, so the
 * symbol -> position map is only rebuilt when a lookup no longer lines up (universe reloaded).
 */
function rowOf(symbol: string): FuturesRow | undefined {
    const rows = latestRows;
    let i = rowPositions.get(symbol);
    if (i !== undefined && i < rows.length && rows[i].symbol === symbol) return rows[i];
    if (positionsFor === rows) return undefined; // already rebuilt for this array: the symbol is not in it
    const next = new Map<string, number>();
    for (let k = 0; k < rows.length; k += 1) next.set(rows[k].symbol, k);
    rowPositions = next;
    positionsFor = rows;
    i = next.get(symbol);
    return i === undefined ? undefined : rows[i];
}

// ---------------------------------------------------------------------------
// Settled funding rates (one shared snapshot, refreshed every 10 minutes)
// ---------------------------------------------------------------------------

function maybeLoadSettled(now: number): void {
    if (settledLoading || now < settledNextAt) return;
    settledLoading = true;
    safeCall(fetchLatestSettledFunding).then(
        (map) => {
            settledLoading = false;
            settledNextAt = Date.now() + SETTLED_REFRESH_MS;
            if (map instanceof Map && map.size > 0) {
                const rates = new Map<string, number>();
                map.forEach((value, symbol) => {
                    if (value && isFiniteNumber(value.rate)) rates.set(symbol, value.rate);
                });
                settled = map;
                settledRates = rates;
            }
            schedulePass();
        },
        () => {
            settledLoading = false;
            settledNextAt = Date.now() + SETTLED_RETRY_MS;
            schedulePass();
        },
    );
}

// ---------------------------------------------------------------------------
// Squeeze details of the top negative candidates (max 2 concurrent)
// ---------------------------------------------------------------------------

function requestDetails(symbol: string, intervalHours: number, now: number): DetailsEntry {
    let entry = detailsEntries.get(symbol);
    if (!entry) {
        entry = { details: null, intervalHours, nextAt: 0, lastWantedAt: now, loading: false, queued: false };
        detailsEntries.set(symbol, entry);
    }
    entry.intervalHours = intervalHours;
    entry.lastWantedAt = now;
    // Refreshes wait while the tab is hidden; the first load of a new candidate does not.
    if (!entry.loading && !entry.queued && now >= entry.nextAt && (entry.details === null || !isHidden())) {
        entry.queued = true;
        detailsQueue.push(symbol);
    }
    return entry;
}

function pumpDetails(): void {
    while (detailsActive < DETAILS_CONCURRENCY && detailsQueue.length > 0) {
        const symbol = detailsQueue.shift() as string;
        const entry = detailsEntries.get(symbol);
        if (!entry) continue;
        entry.queued = false;
        if (!wantedDetails.has(symbol)) continue; // dropped out of the top list while waiting

        entry.loading = true;
        detailsActive += 1;
        const intervalHours = entry.intervalHours;
        const finish = (details: SqueezeDetails | null) => {
            const ok = hasAnyDetail(details);
            if (ok) entry.details = details;
            entry.nextAt = Date.now() + (ok ? DETAILS_REFRESH_MS : DETAILS_RETRY_MS);
            entry.loading = false;
            detailsActive -= 1;
            if (isIdle(Date.now())) {
                detailsQueue.length = 0;
                detailsEntries.forEach((e) => {
                    e.queued = false;
                });
                return;
            }
            schedulePass();
            pumpDetails();
        };
        safeCall(() => loadSqueezeDetails(symbol, intervalHours)).then(finish, () => finish(null));
    }
}

function pruneDetails(now: number): void {
    if (detailsEntries.size <= DETAILS_TOP_N) return;
    detailsEntries.forEach((entry, symbol) => {
        if (entry.loading || entry.queued || wantedDetails.has(symbol)) return;
        if (now - entry.lastWantedAt > DETAILS_KEEP_MS) detailsEntries.delete(symbol);
    });
}

// ---------------------------------------------------------------------------
// Detection pass (<= 1 per second)
// ---------------------------------------------------------------------------

/** True once the predicted-funding fields have arrived for most of the universe. */
function fundingFieldsLive(rows: FuturesRow[]): boolean {
    let live = 0;
    for (let i = 0; i < rows.length; i += 1) if (rows[i].nextFundingTime > 0) live += 1;
    return live * 2 >= rows.length;
}

interface RankedEpisode {
    episode: FundingEpisode;
    row: FuturesRow;
    f8: number;
}

const rankEpisodes = (a: RankedEpisode, b: RankedEpisode): number => {
    if (a.episode.side !== b.episode.side) return a.episode.side === 'NEG' ? -1 : 1;
    const diff = a.episode.side === 'NEG' ? a.f8 - b.f8 : b.f8 - a.f8;
    return diff !== 0 ? diff : a.row.symbol < b.row.symbol ? -1 : 1;
};

function buildCandidates(episodes: FundingEpisode[], stats: UniverseStats, now: number): { list: FundingCandidate[]; changed: boolean } {
    const ranked: RankedEpisode[] = [];
    for (const episode of episodes) {
        const row = rowOf(episode.symbol);
        if (!row || row.isTradFi) continue;
        const f8 = fundingTo8h(row.fundingRate, row.fundingIntervalHours);
        if (!Number.isFinite(f8)) continue;
        ranked.push({ episode, row, f8 });
    }
    ranked.sort(rankEpisodes);

    wantedDetails.clear();
    const nextMemo = new Map<string, CandidateMemo>();
    const nextBySymbol = new Map<string, FundingCandidate>();
    const list: FundingCandidate[] = [];
    let negRank = 0;
    let assessBudget = ASSESS_PER_PASS;

    for (const { episode, row, f8 } of ranked) {
        const side = episode.side;
        let details: SqueezeDetails | null = null;
        let detailsLoading = false;
        if (side === 'NEG' && negRank < DETAILS_TOP_N) {
            negRank += 1;
            wantedDetails.add(row.symbol);
            const entry = requestDetails(row.symbol, row.fundingIntervalHours, now);
            details = entry.details;
            detailsLoading = details === null && (entry.loading || entry.queued);
        }
        const prevSettledRate = settledRates?.get(row.symbol) ?? null;

        const key = `${side}:${row.symbol}`;
        const memo = candidateMemo.get(key);
        const old = memo?.candidate;

        // Assessment (negative side): at once when its details or the gate change, otherwise rate-limited.
        let assessment = old ? old.assessment : null;
        let assessedAt = memo ? memo.assessedAt : 0;
        if (side === 'NEG') {
            const must = !memo || !old || old.assessment === null || old.details !== details || memo.assessedNegGate !== stats.negGate;
            let due = must;
            if (!due && memo && assessBudget > 0 && now - memo.assessedAt >= ASSESS_MIN_INTERVAL_MS) {
                due =
                    memo.assessedRate !== row.fundingRate ||
                    memo.assessedChangePct !== row.changePct ||
                    memo.assessedInterval !== row.fundingIntervalHours;
                if (due) assessBudget -= 1;
            }
            if (due) {
                try {
                    assessment = assessSqueeze(row, stats, details ?? EMPTY_DETAILS);
                } catch {
                    assessment = null;
                }
                assessedAt = now;
            }
        }
        const reassessed = assessedAt === now;

        let candidate: FundingCandidate;
        if (
            memo &&
            old &&
            memo.row === row &&
            memo.since === episode.since &&
            memo.detailsLoading === detailsLoading &&
            memo.prevSettledRate === prevSettledRate &&
            old.details === details &&
            old.assessment === assessment
        ) {
            candidate = old;
        } else {
            candidate = {
                symbol: row.symbol,
                baseAsset: row.baseAsset,
                side,
                f8,
                rate: row.fundingRate,
                intervalHours: row.fundingIntervalHours,
                nextFundingTime: row.nextFundingTime,
                price: row.price,
                changePct: row.changePct,
                quoteVolume: row.quoteVolume,
                lowLiquidity: row.quoteVolume < LOW_LIQUIDITY_QUOTE_VOLUME,
                since: episode.since,
                universePercentile: percentileOf(stats.sortedF8, f8),
                prevSettledRate,
                diff: prevSettledRate === null ? null : row.fundingRate - prevSettledRate,
                details,
                assessment,
                detailsLoading,
            };
        }
        nextMemo.set(key, {
            row,
            since: episode.since,
            detailsLoading,
            prevSettledRate,
            candidate,
            assessedAt,
            assessedRate: reassessed || !memo ? row.fundingRate : memo.assessedRate,
            assessedChangePct: reassessed || !memo ? row.changePct : memo.assessedChangePct,
            assessedInterval: reassessed || !memo ? row.fundingIntervalHours : memo.assessedInterval,
            assessedNegGate: reassessed || !memo ? stats.negGate : memo.assessedNegGate,
        });
        nextBySymbol.set(row.symbol, candidate);
        list.push(candidate);
    }

    const prev = snapshot.candidates;
    let changed = prev.length !== list.length;
    if (!changed) {
        for (let i = 0; i < list.length; i += 1) {
            if (prev[i] !== list[i]) {
                changed = true;
                break;
            }
        }
    }
    candidateMemo = nextMemo;
    candidateBySymbol = nextBySymbol;
    return { list: changed ? list : prev, changed };
}

function runPass(): void {
    passTimer = null;
    const now = Date.now();
    if (!latestRows.length) return;
    if (isIdle(now)) {
        detailsQueue.length = 0;
        detailsEntries.forEach((e) => {
            e.queued = false;
        });
        return;
    }
    lastPassAt = now;
    maybeLoadSettled(now);

    const started = perfNow();
    const rows = cryptoUniverse(latestRows);

    if (!seeded) {
        // The first pass decides which states "already existed": give it the settled rates and the live funding
        // fields, but only for a few seconds. Settled rates that arrive later are handled by the detector
        // (its one-off settled-rate check runs on the first pass that has them).
        const waited = now - firstFeedAt;
        if (waited < SEED_WAIT_MS && (settledLoading || !fundingFieldsLive(rows))) {
            // Look again by itself: the wait must end on time even if no further feed arrives.
            passTimer = setTimeout(runPass, Math.min(PASS_INTERVAL_MS, SEED_WAIT_MS - waited));
            return;
        }
    }

    let eventsChanged = false;
    let candidatesChanged = false;
    let candidates = snapshot.candidates;
    try {
        if (!detectorState) detectorState = createDetectorState();
        const stats = computeUniverseStats(rows, now);
        const result = detectFundingEvents(rows, stats, settledRates, detectorState, now);
        detectorState = result.state;
        latestStats = stats;
        seeded = true;
        perf.detectMs += perfNow() - started;

        eventsChanged = mergeEvents(result.events, now);
        const built = buildCandidates(result.episodes, stats, now);
        candidates = built.list;
        candidatesChanged = built.changed;
    } catch (err) {
        if (!detectorFailed) {
            detectorFailed = true;
            console.warn('[fundingFlow] funding tespiti çalıştırılamadı:', err);
        }
        return;
    }
    const elapsed = perfNow() - started;
    perf.passes += 1;
    perf.lastMs = elapsed;
    perf.totalMs += elapsed;
    if (elapsed > perf.maxMs) perf.maxMs = elapsed;

    pruneDetails(now);
    pumpDetails();
    if (eventsChanged) persistEvents();

    const stats = latestStats;
    const statsDue =
        !publishedStats ||
        !stats ||
        stats.negGate !== publishedStats.negGate ||
        stats.posGate !== publishedStats.posGate ||
        stats.count !== publishedStats.count ||
        now - publishedStats.computedAt >= STATS_PUBLISH_MS;

    if (!snapshot.ready || eventsChanged || candidatesChanged || statsDue || snapshot.settledBySymbol !== settled) {
        publishedStats = stats;
        snapshot = {
            ready: true,
            events,
            candidates,
            stats,
            settledBySymbol: settled,
            updatedAt: now,
        };
        listeners.forEach((listener) => {
            try {
                listener();
            } catch {
                /* a failing subscriber must not stop the others */
            }
        });
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Called by TerminalPage on every universe update. Cheap: it only stores the reference and arms the
 * (throttled) detection pass. Pass the whole universe; TradFi perps are left out of the detection here.
 */
export function feedFundingRows(rows: FuturesRow[]): void {
    if (!Array.isArray(rows) || rows.length === 0) return;
    const now = Date.now();
    if (firstFeedAt === 0) {
        firstFeedAt = now;
    } else if (seeded && now - lastFeedAt > RESEED_GAP_MS) {
        // The feed resumes after a long pause (page left, laptop asleep): whatever changed meanwhile has no
        // known time, so start a fresh detector instead of stamping those changes with "now".
        seeded = false;
        detectorState = null;
        firstFeedAt = now;
    }
    latestRows = rows;
    lastFeedAt = now;
    schedulePass();
}

function subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

const getSnapshot = (): FundingFlowSnapshot => snapshot;
const getStats = (): UniverseStats | null => snapshot.stats;

/** Live event feed + active candidates. The returned object keeps its identity until something changes. */
export function useFundingFlow(): FundingFlowSnapshot {
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Side of the symbol's active episode, or null when it is not a candidate. Re-renders only when that changes
 * (the checklist uses it to tell an easing candidate from a symbol without any setup).
 */
export function useFundingCandidateSide(symbol: string): FundingSide | null {
    const getSide = useCallback((): FundingSide | null => candidateBySymbol.get(symbol)?.side ?? null, [symbol]);
    return useSyncExternalStore(subscribe, getSide, getSide);
}

const GATE_EPS = 1e-12; // same float tolerance as utils/fundingSqueeze

/**
 * True for a candidate whose rate eased back out of the "extreme" gate while it is still inside the
 * hysteresis band (±0.03%), i.e. it stays listed only until it leaves that band. Negative side: exactly the
 * candidates assessSqueeze classifies as 'NONE'.
 */
export function isEasingCandidate(candidate: FundingCandidate, stats: UniverseStats | null): boolean {
    if (candidate.side === 'NEG') {
        if (candidate.assessment) return candidate.assessment.cls === 'NONE';
        return stats !== null && candidate.f8 > stats.negGate + GATE_EPS;
    }
    return stats !== null && candidate.f8 < stats.posGate - GATE_EPS;
}

/**
 * Cheap synchronous lookup for watchlist cells; reflects the most recently fed rows. TradFi perps are never
 * candidates. A candidate with cls 'NONE' is still listed thanks to the hysteresis band although its rate
 * eased back above the gate (shown as 'GEVŞİYOR', see isEasingCandidate).
 */
export function getFundingInfoFor(
    symbol: string,
): { f8: number; prevSettledRate: number | null; diff: number | null; isCandidate: boolean; cls: SqueezeClass | null } | null {
    const row = rowOf(symbol);
    if (!row) return null;
    const f8 = fundingTo8h(row.fundingRate, row.fundingIntervalHours);
    if (!Number.isFinite(f8)) return null;
    const prevSettledRate = settledRates?.get(symbol) ?? null;
    const candidate = row.isTradFi ? undefined : candidateBySymbol.get(symbol);
    return {
        f8,
        prevSettledRate,
        diff: prevSettledRate === null ? null : row.fundingRate - prevSettledRate,
        isCandidate: candidate !== undefined,
        cls: candidate?.assessment?.cls ?? null,
    };
}

// ---------------------------------------------------------------------------
// Selected-symbol assessment hook
// ---------------------------------------------------------------------------

interface SelectedState {
    symbol: string;
    details: SqueezeDetails | null;
    history: FundingHistoryPoint[];
    loading: boolean;
    error: string | null;
}

const EMPTY_HISTORY: FundingHistoryPoint[] = [];
const NO_SELECTION: SelectedState = { symbol: '', details: null, history: EMPTY_HISTORY, loading: false, error: null };

/**
 * Squeeze checklist data for ANY symbol (not only candidates). Details + funding history are loaded when the
 * symbol changes and refreshed every 5 minutes; the assessment itself is recomputed on every row update
 * without refetching. Responses that belong to a previously selected symbol are ignored.
 */
export function useSqueezeAssessment(row: FuturesRow | null): {
    assessment: SqueezeAssessment | null;
    details: SqueezeDetails | null;
    history: FundingHistoryPoint[];
    loading: boolean;
    error: string | null;
} {
    const symbol = row?.symbol ?? '';
    const intervalHours = row?.fundingIntervalHours ?? 8;
    const stats = useSyncExternalStore(subscribe, getStats, getStats);
    const [state, setState] = useState<SelectedState>(NO_SELECTION);

    useEffect(() => {
        if (!symbol) return undefined;
        let cancelled = false;
        let inFlight = false;

        const load = () => {
            if (cancelled || inFlight) return;
            inFlight = true;
            // A candidate's details are already in the store: show them at once instead of an empty checklist.
            setState((prev) =>
                prev.symbol === symbol
                    ? prev
                    : {
                          symbol,
                          details: detailsEntries.get(symbol)?.details ?? null,
                          history: EMPTY_HISTORY,
                          loading: true,
                          error: null,
                      },
            );
            Promise.allSettled([
                safeCall(() => loadSqueezeDetails(symbol, intervalHours)),
                safeCall(() => fetchFundingHistory(symbol, HISTORY_LIMIT)),
            ]).then(([detailsResult, historyResult]) => {
                inFlight = false;
                if (cancelled) return;
                setState((prev) => {
                    const base = prev.symbol === symbol ? prev : null;
                    let details = base?.details ?? null;
                    let history = base?.history ?? EMPTY_HISTORY;
                    let error: string | null = null;

                    if (historyResult.status === 'fulfilled') {
                        if (Array.isArray(historyResult.value)) history = historyResult.value;
                    } else {
                        error = errorMessage(historyResult.reason, MSG_HISTORY);
                    }
                    if (detailsResult.status === 'fulfilled') {
                        if (hasAnyDetail(detailsResult.value)) details = detailsResult.value;
                        else if (!details) error = error ?? MSG_DETAILS;
                    } else {
                        error = error ?? errorMessage(detailsResult.reason, MSG_DETAILS);
                    }
                    return { symbol, details, history, loading: false, error };
                });
            });
        };

        load();
        const timer = setInterval(() => {
            if (!isHidden()) load();
        }, SELECTED_REFRESH_MS);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [symbol, intervalHours]);

    // State of another symbol (the render right after a symbol change) is never shown as current.
    const current = symbol !== '' && state.symbol === symbol ? state : null;
    const details = current?.details ?? null;

    const assessment = useMemo<SqueezeAssessment | null>(() => {
        if (!row || !stats) return null;
        try {
            return assessSqueeze(row, stats, details ?? EMPTY_DETAILS);
        } catch {
            return null;
        }
    }, [row, stats, details]);

    if (!row) return { assessment: null, details: null, history: EMPTY_HISTORY, loading: false, error: null };
    return {
        assessment,
        details,
        history: current?.history ?? EMPTY_HISTORY,
        loading: current ? current.loading : true,
        error: current?.error ?? null,
    };
}

// ---------------------------------------------------------------------------
// Diagnostics (used by the preview harness / verification; not part of the UI)
// ---------------------------------------------------------------------------

export function getFundingFlowDebug(): {
    passes: number;
    lastPassMs: number;
    maxPassMs: number;
    avgPassMs: number;
    avgDetectMs: number; // share of the pass spent in computeUniverseStats + detectFundingEvents
    rows: number;
    cryptoRows: number;
    subscribers: number;
    timerArmed: boolean;
    detailsActive: number;
    detailsQueued: number;
    detailsCached: number;
    settledSymbols: number;
} {
    return {
        passes: perf.passes,
        lastPassMs: perf.lastMs,
        maxPassMs: perf.maxMs,
        avgPassMs: perf.passes > 0 ? perf.totalMs / perf.passes : 0,
        avgDetectMs: perf.passes > 0 ? perf.detectMs / perf.passes : 0,
        rows: latestRows.length,
        cryptoRows: cryptoUniverse(latestRows).length,
        subscribers: listeners.size,
        timerArmed: passTimer !== null,
        detailsActive,
        detailsQueued: detailsQueue.length,
        detailsCached: detailsEntries.size,
        settledSymbols: settled ? settled.size : 0,
    };
}
