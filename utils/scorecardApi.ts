// Client side of forward tracking: what happened after every stored signal (signal_outcomes) and the
// per-rule scorecard built from it (GET /api/scorecard). Every return value is a fraction
// (0.0123 = +1.23 %); the helpers at the bottom turn them into Turkish UI text.
import { apiJson } from './config';
import type { SignalOutcome, SignalOutcomeHorizon, SignalOutcomeStatus } from '../types';

export type { SignalOutcome, SignalOutcomeHorizon, SignalOutcomeStatus } from '../types';

// --- Horizons ---

export type OutcomeHorizonKey = 'h15' | 'h60' | 'h240' | 'h1440';
export type ScorecardHorizon = '15m' | '1h' | '4h' | '24h';

export interface OutcomeHorizonInfo {
    key: OutcomeHorizonKey;        // field of SignalOutcome
    scorecard: ScorecardHorizon;   // key in a scorecard row's byHorizon
    minutes: number;
    label: string;                 // short column label: "15dk", "1s", "4s", "24s"
    long: string;                  // "15 dakika", "1 saat" ...
}

export const OUTCOME_HORIZONS: readonly OutcomeHorizonInfo[] = [
    { key: 'h15', scorecard: '15m', minutes: 15, label: '15dk', long: '15 dakika' },
    { key: 'h60', scorecard: '1h', minutes: 60, label: '1s', long: '1 saat' },
    { key: 'h240', scorecard: '4h', minutes: 240, label: '4s', long: '4 saat' },
    { key: 'h1440', scorecard: '24h', minutes: 1440, label: '24s', long: '24 saat' }
];

// Round-trip cost assumed by the server (spot taker in + out; perp taker in + out).
export const DEFAULT_OUTCOME_COSTS = { spot: 0.002, perp: 0.001 } as const;

// --- Defensive parsing: a partial or malformed response must never break the UI ---
const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const finiteOrNull = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
};

const OUTCOME_STATUSES = new Set<SignalOutcomeStatus>(['pending', 'partial', 'done', 'skipped']);

const normalizeHorizon = (raw: unknown): SignalOutcomeHorizon | null => {
    // The server stores the horizon as JSON text; a socket payload may carry it already parsed.
    let value = raw;
    if (typeof value === 'string') {
        try { value = JSON.parse(value); } catch { return null; }
    }
    if (!isRecord(value)) return null;
    const horizon: SignalOutcomeHorizon = {
        raw: finiteOrNull(value.raw),
        ret: finiteOrNull(value.ret),
        net: finiteOrNull(value.net),
        excess: finiteOrNull(value.excess),
        mfe: finiteOrNull(value.mfe),
        mae: finiteOrNull(value.mae),
        closeAt: finiteOrNull(value.closeAt),
        resolvedAt: finiteOrNull(value.resolvedAt)
    };
    if (value.error !== undefined && value.error !== null && value.error !== false) {
        horizon.error = typeof value.error === 'string' && value.error.trim() !== '' ? value.error.trim().slice(0, 200) : 'ölçülemedi';
    } else if (horizon.raw === null) {
        // A horizon without a measured close is a gap (delisted symbol, no candles).
        horizon.error = 'veri yok';
    }
    return horizon;
};

/** Outcome of GET /api/signals (signal.outcome) or of a 'signal_outcome' event; undefined when absent or invalid. */
export const normalizeSignalOutcome = (raw: unknown): SignalOutcome | undefined => {
    if (!isRecord(raw)) return undefined;
    const status = typeof raw.status === 'string' ? raw.status.trim().toLowerCase() as SignalOutcomeStatus : null;
    if (!status || !OUTCOME_STATUSES.has(status)) return undefined;
    const note = typeof raw.note === 'string' && raw.note.trim() !== '' ? raw.note.trim().slice(0, 255) : undefined;
    return {
        status,
        h15: normalizeHorizon(raw.h15),
        h60: normalizeHorizon(raw.h60),
        h240: normalizeHorizon(raw.h240),
        h1440: normalizeHorizon(raw.h1440),
        ...(note ? { note } : {})
    };
};

const isFinalStatus = (status: SignalOutcomeStatus) => status === 'done' || status === 'skipped';

/**
 * Combines two snapshots of the same outcome. A resolved horizon never becomes unresolved again, so
 * the union per horizon is always correct, whichever snapshot is older (a history response that left
 * the server before a 'signal_outcome' event must not erase the event).
 */
export const mergeSignalOutcome = (
    prev: SignalOutcome | undefined,
    next: SignalOutcome | undefined
): SignalOutcome | undefined => {
    if (!next) return prev;
    if (!prev) return next;
    const merged: SignalOutcome = {
        status: isFinalStatus(prev.status) && !isFinalStatus(next.status) ? prev.status : next.status,
        h15: next.h15 ?? prev.h15,
        h60: next.h60 ?? prev.h60,
        h240: next.h240 ?? prev.h240,
        h1440: next.h1440 ?? prev.h1440
    };
    if (next.note) merged.note = next.note;
    const unchanged = merged.status === prev.status
        && merged.note === prev.note
        && OUTCOME_HORIZONS.every(({ key }) => merged[key] === prev[key]);
    return unchanged ? prev : merged;
};

// --- Scorecard (GET /api/scorecard?days=7|30) ---

export type ScorecardVerdict = 'COLLECTING' | 'EARLY' | 'EDGE' | 'NO_EDGE' | 'REVERSE' | 'NEUTRAL';
export type ScorecardDays = 7 | 30;

export interface ScorecardStats {
    n: number;                         // measured signals
    nEff: number;                      // distinct hour buckets (clustered signals count once)
    hitRate: number | null;            // share of signals with a positive net result (directional rows)
    hitCi: [number, number] | null;    // Wilson 95 % interval on nEff
    meanNet: number | null;
    medianNet: number | null;
    meanExcess: number | null;         // against BTC over the same window
    medianRaw: number | null;
    medianAbsRaw: number | null;
    medianMfe: number | null;
    medianMae: number | null;
    tStat: number | null;
    verdict: ScorecardVerdict;
    verdictText: string;
}

export interface ScorecardRow {
    key: string;
    label: string;
    engine: string | null;           // 'MOMENTUM' | 'VOLUME' | 'FUNDING' | 'SHADOW' | 'WEBHOOK' | 'MANUAL' ...
    side: string;
    family: string;
    // Shadow rule (engine 'SHADOW'): measured only, never sent or shown as a signal.
    shadow: boolean;
    total: number;
    byHorizon: Record<ScorecardHorizon, ScorecardStats>;
}

// The one shadow rule so far: short-squeeze fuel after a BUY of the momentum / volume rules.
export const SHADOW_SQUEEZE_FAMILY = 'Shadow_SqueezeFuel';

export interface Scorecard {
    generatedAt: number;
    days: number;
    costs: { spot: number; perp: number };
    horizons: ScorecardHorizon[];
    pending: number;
    rows: ScorecardRow[];
}

const VERDICTS = new Set<ScorecardVerdict>(['COLLECTING', 'EARLY', 'EDGE', 'NO_EDGE', 'REVERSE', 'NEUTRAL']);

// Minimum independent samples before any verdict (the server applies the same rule).
export const SCORECARD_MIN_EARLY = 30;
export const SCORECARD_MIN_VERDICT = 100;

const nonNegativeInt = (value: unknown): number => {
    const n = finiteOrNull(value);
    return n === null ? 0 : Math.max(0, Math.round(n));
};

const toCi = (value: unknown): [number, number] | null => {
    if (!Array.isArray(value) || value.length !== 2) return null;
    const lo = finiteOrNull(value[0]);
    const hi = finiteOrNull(value[1]);
    if (lo === null || hi === null) return null;
    const a = Math.min(1, Math.max(0, Math.min(lo, hi)));
    const b = Math.min(1, Math.max(0, Math.max(lo, hi)));
    return [a, b];
};

const emptyStats = (neutral: boolean): ScorecardStats => ({
    n: 0,
    nEff: 0,
    hitRate: null,
    hitCi: null,
    meanNet: null,
    medianNet: null,
    meanExcess: null,
    medianRaw: null,
    medianAbsRaw: null,
    medianMfe: null,
    medianMae: null,
    tStat: null,
    verdict: neutral ? 'NEUTRAL' : 'COLLECTING',
    verdictText: neutral ? 'Yönsüz — yalnızca hareket büyüklüğü' : `Veri toplanıyor (0/${SCORECARD_MIN_EARLY})`
});

const normalizeStats = (raw: unknown, neutral: boolean): ScorecardStats => {
    if (!isRecord(raw)) return emptyStats(neutral);
    const verdict = typeof raw.verdict === 'string' && VERDICTS.has(raw.verdict as ScorecardVerdict)
        ? raw.verdict as ScorecardVerdict
        : neutral ? 'NEUTRAL' : 'COLLECTING';
    const hitRate = finiteOrNull(raw.hitRate);
    const n = nonNegativeInt(raw.n);
    return {
        n,
        nEff: Math.min(n || Infinity, nonNegativeInt(raw.nEff)),
        hitRate: hitRate === null ? null : Math.min(1, Math.max(0, hitRate)),
        hitCi: toCi(raw.hitCi),
        meanNet: finiteOrNull(raw.meanNet),
        medianNet: finiteOrNull(raw.medianNet),
        meanExcess: finiteOrNull(raw.meanExcess),
        medianRaw: finiteOrNull(raw.medianRaw),
        medianAbsRaw: finiteOrNull(raw.medianAbsRaw),
        medianMfe: finiteOrNull(raw.medianMfe),
        medianMae: finiteOrNull(raw.medianMae),
        tStat: finiteOrNull(raw.tStat),
        verdict,
        verdictText: typeof raw.verdictText === 'string' && raw.verdictText.trim() !== ''
            ? raw.verdictText.slice(0, 120)
            : VERDICT_BADGES[verdict].title
    };
};

const SCORECARD_HORIZONS: readonly ScorecardHorizon[] = OUTCOME_HORIZONS.map(h => h.scorecard);

const normalizeRow = (raw: unknown, index: number): ScorecardRow | null => {
    if (!isRecord(raw)) return null;
    const side = typeof raw.side === 'string' ? raw.side.toUpperCase() : '';
    const byHorizon = isRecord(raw.byHorizon) ? raw.byHorizon : {};
    const verdicts = SCORECARD_HORIZONS.map(h => (isRecord(byHorizon[h]) ? byHorizon[h].verdict : undefined));
    const neutral = side === 'NEUTRAL' || verdicts.some(v => v === 'NEUTRAL');
    const family = typeof raw.family === 'string' ? raw.family : '';
    const key = typeof raw.key === 'string' && raw.key !== '' ? raw.key : `${family || 'row'}_${side || index}`;
    const stats = {} as Record<ScorecardHorizon, ScorecardStats>;
    SCORECARD_HORIZONS.forEach(h => { stats[h] = normalizeStats(byHorizon[h], neutral); });
    const engine = typeof raw.engine === 'string' && raw.engine !== '' ? raw.engine.toUpperCase() : null;
    return {
        key,
        label: typeof raw.label === 'string' && raw.label.trim() !== '' ? raw.label.slice(0, 120) : (family || key),
        engine,
        side: neutral ? 'NEUTRAL' : side,
        family,
        shadow: raw.shadow === true || engine === 'SHADOW' || family === SHADOW_SQUEEZE_FAMILY,
        total: nonNegativeInt(raw.total),
        byHorizon: stats
    };
};

/** Raw response -> a complete Scorecard. Throws only when the body is not an object at all. */
export const normalizeScorecard = (raw: unknown): Scorecard => {
    if (!isRecord(raw)) throw new Error('Karne okunamadı.');
    const costs = isRecord(raw.costs) ? raw.costs : {};
    const seen = new Set<string>();
    const rows = (Array.isArray(raw.rows) ? raw.rows : [])
        .map(normalizeRow)
        .filter((row): row is ScorecardRow => {
            if (!row || seen.has(row.key)) return false;
            seen.add(row.key);
            return true;
        })
        .slice(0, 200);
    return {
        generatedAt: finiteOrNull(raw.generatedAt) ?? Date.now(),
        days: nonNegativeInt(raw.days),
        costs: {
            spot: finiteOrNull(costs.spot) ?? DEFAULT_OUTCOME_COSTS.spot,
            perp: finiteOrNull(costs.perp) ?? DEFAULT_OUTCOME_COSTS.perp
        },
        horizons: [...SCORECARD_HORIZONS],
        pending: nonNegativeInt(raw.pending),
        rows
    };
};

export const getScorecard = async (days: ScorecardDays, signal?: AbortSignal): Promise<Scorecard> =>
    normalizeScorecard(await apiJson<unknown>(`/api/scorecard?days=${days}`, { signal }));

// --- Presentation helpers shared by the signal feed and the scorecard ---

const MINUS = '−';

/** Fraction -> "+1.23%" / "−0.40%" / "0.00%" (never "−0.00%"); '—' for null. */
export const formatOutcomePct = (value: number | null | undefined, digits = 2): string => {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    const pct = value * 100;
    const d = Math.abs(pct) >= 100 ? 0 : Math.abs(pct) >= 10 ? Math.min(digits, 1) : digits;
    const rounded = Number(pct.toFixed(d));
    if (rounded === 0) return `${(0).toFixed(d)}%`;
    return `${rounded > 0 ? '+' : MINUS}${Math.abs(rounded).toFixed(d)}%`;
};

/** Fraction -> "1.23%" (unsigned, e.g. a median absolute move). */
export const formatOutcomeAbsPct = (value: number | null | undefined, digits = 2): string => {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    return `${Math.abs(value * 100).toFixed(digits)}%`;
};

/** Hit rate fraction -> "%58" (Turkish percent sign in front). */
export const formatHitRate = (value: number | null | undefined): string =>
    value === null || value === undefined || !Number.isFinite(value) ? '—' : `%${Math.round(value * 100)}`;

/** Cost fraction -> "%0.20". */
export const formatCostPct = (value: number): string => `%${(value * 100).toFixed(2)}`;

/** Text colour of a signed result; zero / missing stays neutral. */
export const outcomeTone = (value: number | null | undefined): string => {
    if (value === null || value === undefined || !Number.isFinite(value)) return 'text-muted';
    const rounded = Number((value * 100).toFixed(2));
    return rounded > 0 ? 'text-success' : rounded < 0 ? 'text-danger' : 'text-text';
};

export const VERDICT_BADGES: Record<ScorecardVerdict, { text: string; tone: string; title: string }> = {
    COLLECTING: { text: 'Toplanıyor', tone: 'bg-surface-secondary text-muted', title: 'Veri toplanıyor' },
    EARLY: { text: 'Ön sonuç', tone: 'bg-warning-soft text-warning', title: 'Ön sonuç — karar için az veri' },
    EDGE: { text: 'Kenar var', tone: 'bg-success-soft text-success', title: 'Maliyet sonrası pozitif' },
    NO_EDGE: { text: 'Kenar yok', tone: 'bg-surface-highlight text-secondary', title: 'Kenar görünmüyor' },
    REVERSE: { text: 'Ters yön', tone: 'bg-danger-soft text-danger', title: 'Ters yönde tutarlı' },
    NEUTRAL: { text: 'Yönsüz', tone: 'bg-info-soft text-info', title: 'Yönsüz — yalnızca hareket büyüklüğü' }
};
