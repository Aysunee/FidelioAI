// Negative-funding squeeze logic for USDT-M perpetuals.
//
// PURE module: no fetch, no DOM, no React, no clock access (callers pass `now`). Shared by the
// Terminal page (funding event feed, candidate list, squeeze checklist) and the signal engine.
//
// HONESTY RULE: nothing in here predicts direction. Events and classes are DESCRIPTIVE states of
// funding / price / open interest; the checklist counts how many conditions of the setup currently
// hold. It is not a probability and never a buy/sell recommendation.

// ---------------------------------------------------------------------------
// Inputs and normalisation
// ---------------------------------------------------------------------------

export interface FundingInput {
    symbol: string;
    fundingRate: number;          // PREDICTED rate of the current interval, as a fraction
    fundingIntervalHours: number; // 1, 4 or 8
    nextFundingTime: number;      // ms epoch
    markPrice: number;
    indexPrice: number;
    price: number;
    changePct: number;            // 24h change, percent
    quoteVolume: number;          // 24h volume in USDT
}

/** Thresholds of the detector and the checklist. Funding values are 8h-equivalent fractions. */
export const FUNDING_THRESHOLDS = {
    extremeF8: 0.0005,            // ±0.05%: the fixed part of the "extreme" gate
    exitF8: 0.0003,               // ±0.03%: hysteresis, an episode ends beyond this
    deadBandF8: 0.0001,           // ±0.01%: a sign flip only counts beyond this
    deepenFactor: 1.5,            // re-alert once |f8| reaches 1.5× the last alerted level
    easeFactor: 0.5,              // "easing" once |f8| is at most half of the episode's peak
    persistMs: 60_000,            // a condition must hold on observations spanning this long
    cooldownMs: 600_000,          // per symbol, between two events of the same type
    staleMs: 900_000,             // a symbol missing from the rows this long (while passes run) is forgotten
    lowLiquidityQuoteVolume: 5_000_000,
    postPumpPct: 10,              // 24h change above this = "post pump" (caution class)
    oiCoveringPct: -5,            // 4h open interest change at or below this = positions closing
    oiStrongPct: 10,              // 24h open interest change at or above this = strong build-up
    ownHistoryMin: 10,            // minimum settlements needed for the own-history percentile
    ownHistoryPass: 0.05,
    ownHistoryWarn: 0.2,
} as const;

const T = FUNDING_THRESHOLDS;
const EPS = 1e-12; // funding rates carry 8 decimals; this only absorbs float noise at a threshold

/** Funding rate of any settlement interval as an 8h-equivalent fraction. */
export const fundingTo8h = (rate: number, intervalHours: number): number =>
    (rate * 8) / (Number.isFinite(intervalHours) && intervalHours > 0 ? intervalHours : 8);

/** Simple (non-compounded) annualisation of an 8h-equivalent rate: three payments a day. */
export const annualizedFromF8 = (f8: number): number => f8 * 3 * 365;

const fin = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const normInterval = (hours: number): number => (Number.isFinite(hours) && hours > 0 ? hours : 8);

// ---------------------------------------------------------------------------
// Universe statistics
// ---------------------------------------------------------------------------

export interface UniverseStats {
    count: number;
    sortedF8: number[]; // ascending
    p2: number;
    p98: number;
    negGate: number;    // Math.min(-0.0005, p2)
    posGate: number;    // Math.max(+0.0005, p98)
    computedAt: number;
}

/** Linear-interpolated quantile of an ascending array (0 for an empty one). */
const quantileSorted = (sortedAsc: number[], q: number): number => {
    const n = sortedAsc.length;
    if (!n) return 0;
    const pos = (n - 1) * Math.min(1, Math.max(0, q));
    const lo = Math.floor(pos);
    const hi = Math.min(n - 1, lo + 1);
    return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
};

/** Cross-section of 8h-equivalent funding. Rows with a non-finite rate are ignored. */
export function computeUniverseStats(rows: FundingInput[], now: number): UniverseStats {
    const sortedF8: number[] = [];
    for (const row of rows ?? []) {
        if (!row || !Number.isFinite(row.fundingRate)) continue;
        const f8 = fundingTo8h(row.fundingRate, row.fundingIntervalHours);
        if (Number.isFinite(f8)) sortedF8.push(f8);
    }
    sortedF8.sort((a, b) => a - b);
    const p2 = quantileSorted(sortedF8, 0.02);
    const p98 = quantileSorted(sortedF8, 0.98);
    return {
        count: sortedF8.length,
        sortedF8,
        p2,
        p98,
        negGate: Math.min(-T.extremeF8, p2),
        posGate: Math.max(T.extremeF8, p98),
        computedAt: now,
    };
}

/** Share (0..1) of the values that are <= `value`. Empty array or non-finite value -> 0. */
export function percentileOf(sortedAsc: number[], value: number): number {
    const n = sortedAsc?.length ?? 0;
    if (!n || !Number.isFinite(value)) return 0;
    let lo = 0;
    let hi = n; // first index whose value is > `value`
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (sortedAsc[mid] <= value) lo = mid + 1;
        else hi = mid;
    }
    return lo / n;
}

// The gates never get looser than the fixed ±0.05%, whatever the caller's stats contain.
const negGateOf = (stats: UniverseStats | null | undefined): number => {
    const g = fin(stats?.negGate);
    return g === null ? -T.extremeF8 : Math.min(-T.extremeF8, g);
};
const posGateOf = (stats: UniverseStats | null | undefined): number => {
    const g = fin(stats?.posGate);
    return g === null ? T.extremeF8 : Math.max(T.extremeF8, g);
};

// ---------------------------------------------------------------------------
// Event detector
// ---------------------------------------------------------------------------

export type FundingSide = 'NEG' | 'POS';
export type FundingEventType = 'FLIP' | 'EXTREME' | 'DEEPENING' | 'EASING' | 'EXIT';

export interface FundingEvent {
    id: string;
    time: number;
    symbol: string;
    side: FundingSide;               // FLIP: the NEW side; otherwise the episode's side
    type: FundingEventType;
    f8: number;                      // predicted rate, 8h-equivalent fraction
    rate: number;                    // predicted rate of the symbol's own interval
    intervalHours: number;
    prevSettledRate: number | null;  // last settled rate of the symbol's own interval
    diff: number | null;             // rate − prevSettledRate
    nextFundingTime: number;
    price: number;
    changePct: number;
    lowLiquidity: boolean;           // 24h quote volume below 5M USDT
    initial: boolean;                // state found at start-up, not a transition seen live
}

export interface FundingEpisode {
    symbol: string;
    side: FundingSide;
    since: number;       // when the symbol entered the gate (first seen there, for seeded episodes)
    peakF8: number;      // most extreme level that was SUSTAINED for the persistence window
    lastAlertF8: number; // f8 at the last EXTREME / DEEPENING alert
    lastEventAt: number;
}

/** [first seen at (ms), f8] — run-length encoded observations of one symbol. */
type Sample = [number, number];

interface EpisodeTrack extends FundingEpisode {
    announced: boolean;            // false while the EXTREME alert is held back by the cooldown
    easedAtPeakF8: number | null;  // peak at the last EASING alert; a deeper peak re-arms it
}

interface SymbolTrack {
    lastSeen: number;
    side: FundingSide;             // confirmed sign side (dead band + persistence); zero counts as POS
    samples: Sample[];             // trailing persistence window, oldest first
    episode: EpisodeTrack | null;
    lastEventAt: Partial<Record<FundingEventType, number>>;
}

/**
 * Detector memory. Treat it as OPAQUE: create it with createDetectorState() and pass the state
 * returned by detectFundingEvents() into the next call. Plain JSON (safe to stringify / parse).
 */
export interface DetectorState {
    version: 1;
    seeded: boolean;
    settledChecked: boolean;
    lastPassAt: number;
    symbols: Record<string, SymbolTrack>;
}

export function createDetectorState(): DetectorState {
    return { version: 1, seeded: false, settledChecked: false, lastPassAt: 0, symbols: {} };
}

const isDetectorState = (s: unknown): s is DetectorState => {
    const st = s as DetectorState | null;
    return !!st && st.version === 1 && typeof st.symbols === 'object' && st.symbols !== null;
};

const isLowLiquidity = (quoteVolume: number): boolean => !(quoteVolume >= T.lowLiquidityQuoteVolume);

/** New sample list with `f8` observed at `now`, trimmed to the persistence window. Never mutates. */
function appendSample(prev: Sample[] | undefined, f8: number, now: number): Sample[] {
    // A clock that moved backwards invalidates the window: start over.
    if (!prev || !prev.length || prev[prev.length - 1][0] > now) return [[now, f8]];
    const cutoff = now - T.persistMs;
    let start = 0; // the newest segment that began at or before the cutoff still covers the window
    for (let i = prev.length - 1; i > 0; i--) {
        if (prev[i][0] <= cutoff) {
            start = i;
            break;
        }
    }
    const same = prev[prev.length - 1][1] === f8;
    if (start === 0 && same) return prev;
    const out = start === 0 ? prev.slice() : prev.slice(start);
    if (!same) out.push([now, f8]);
    return out;
}

/** How long (ms) the predicate has held on every observation up to `now`; -1 if it fails now. */
function heldMs(samples: Sample[], now: number, pred: (f8: number) => boolean): number {
    let since = 0;
    let found = false;
    for (let i = samples.length - 1; i >= 0; i--) {
        if (!pred(samples[i][1])) break;
        since = samples[i][0];
        found = true;
    }
    return found ? now - since : -1;
}

/** Least extreme level seen in the trailing window, i.e. the level that was actually sustained. */
function sustainedLevel(samples: Sample[], side: FundingSide): number {
    let level = samples[samples.length - 1][1];
    for (const s of samples) level = side === 'NEG' ? Math.max(level, s[1]) : Math.min(level, s[1]);
    return level;
}

const readSettled = (settledRates: Map<string, number> | null, symbol: string): number | null => {
    if (!settledRates || typeof settledRates.get !== 'function') return null;
    const v = settledRates.get(symbol) as unknown;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    // Tolerate { rate, time } entries (the shape the data layer caches).
    return fin((v as { rate?: unknown } | null | undefined)?.rate);
};

/**
 * One detection pass over the universe. Deterministic: the result depends only on the arguments.
 * The given state is NOT mutated — continue with the returned `state`.
 *
 * Rules
 *  - Persistence: a condition counts only once it held on every observation over a span of at
 *    least 60 s (measured with `now`, not with call counts).
 *  - Seeding (first pass that sees data): every symbol already inside a gate yields ONE 'EXTREME'
 *    with initial: true. No live transition (persistence based FLIP / EXTREME, DEEPENING, EASING,
 *    EXIT) is emitted on that pass.
 *  - Settled-rate flips: on the first pass that receives `settledRates` (the seeding pass if they
 *    are already loaded, otherwise whichever later pass gets them first), a symbol whose last
 *    settled rate is on the other side of zero than its predicted rate yields a 'FLIP' with
 *    initial: true (zero counts as the positive side; the predicted rate must be beyond the
 *    ±0.01% dead band). This check runs once per detector state.
 *  - Live: FLIP (sign change beyond the dead band), EXTREME (entered the gate), DEEPENING (1.5× the
 *    last alerted level), EASING (half of the sustained peak, still inside the ±0.03% band; once
 *    per peak), EXIT (beyond the ±0.03% band; the episode ends).
 *  - Cooldown: at most one event of a type per symbol per 10 min. A blocked FLIP / EASING / EXIT is
 *    dropped (the state still updates); a blocked EXTREME / DEEPENING is emitted when the cooldown
 *    ends, if the condition still holds.
 */
export function detectFundingEvents(
    rows: FundingInput[],
    stats: UniverseStats,
    settledRates: Map<string, number> | null,
    state: DetectorState,
    now: number,
): { events: FundingEvent[]; episodes: FundingEpisode[]; state: DetectorState } {
    const prev = isDetectorState(state) ? state : createDetectorState();
    const negGate = negGateOf(stats);
    const posGate = posGateOf(stats);
    const seeding = !prev.seeded;
    // An empty map (settled rates still loading / failed) does not use up the one-off check.
    const checkSettled = !prev.settledChecked && !!settledRates && settledRates.size > 0;

    const events: FundingEvent[] = [];
    const symbols: Record<string, SymbolTrack> = {};
    // Forget symbols that stayed out of the rows for 15 min of detector activity (delisted). The age is
    // measured against the previous pass, so a pause of the whole detector (sleeping tab) forgets nothing.
    for (const key of Object.keys(prev.symbols)) {
        const track = prev.symbols[key];
        if (track && prev.lastPassAt - track.lastSeen <= T.staleMs) symbols[key] = track;
    }

    const seen = new Set<string>();
    let observed = 0;

    for (const row of rows ?? []) {
        if (!row || typeof row.symbol !== 'string' || !row.symbol || seen.has(row.symbol)) continue;
        const rate = row.fundingRate;
        if (!Number.isFinite(rate)) continue;
        // A zero rate without a funding time means the premium data has not arrived yet.
        if (rate === 0 && !(row.nextFundingTime > 0)) continue;
        const f8 = fundingTo8h(rate, row.fundingIntervalHours);
        if (!Number.isFinite(f8)) continue;
        seen.add(row.symbol);
        observed++;

        const old = symbols[row.symbol];
        const track: SymbolTrack = {
            lastSeen: now,
            side: old ? old.side : f8 < 0 ? 'NEG' : 'POS',
            samples: appendSample(old?.samples, f8, now),
            episode: old?.episode ? { ...old.episode } : null,
            lastEventAt: old ? { ...old.lastEventAt } : {},
        };
        symbols[row.symbol] = track;
        const samples = track.samples;

        const prevSettledRate = readSettled(settledRates, row.symbol);
        const cooledDown = (type: FundingEventType): boolean => {
            const last = track.lastEventAt[type];
            return !(typeof last === 'number' && now - last < T.cooldownMs);
        };
        const emit = (type: FundingEventType, side: FundingSide, initial: boolean): void => {
            track.lastEventAt[type] = now;
            events.push({
                id: `${row.symbol}:${type}:${side}:${now}`,
                time: now,
                symbol: row.symbol,
                side,
                type,
                f8,
                rate,
                intervalHours: normInterval(row.fundingIntervalHours),
                prevSettledRate,
                diff: prevSettledRate === null ? null : rate - prevSettledRate,
                nextFundingTime: row.nextFundingTime,
                price: row.price,
                changePct: row.changePct,
                lowLiquidity: isLowLiquidity(row.quoteVolume),
                initial,
            });
        };

        // --- settled rate vs predicted rate (once): the sign already flipped before we looked ------
        if (checkSettled && prevSettledRate !== null) {
            const side: FundingSide | null =
                f8 <= -T.deadBandF8 + EPS && prevSettledRate >= 0
                    ? 'NEG'
                    : f8 >= T.deadBandF8 - EPS && prevSettledRate < 0
                        ? 'POS'
                        : null;
            if (side) {
                track.side = side;
                if (cooledDown('FLIP')) emit('FLIP', side, true);
            }
        }

        // --- seeding: symbols that are already extreme; no live transitions on this pass ---------
        if (seeding) {
            const side: FundingSide | null = f8 <= negGate + EPS ? 'NEG' : f8 >= posGate - EPS ? 'POS' : null;
            if (side) {
                track.episode = {
                    symbol: row.symbol,
                    side,
                    since: now,
                    peakF8: f8,
                    lastAlertF8: f8,
                    lastEventAt: now,
                    announced: true,
                    easedAtPeakF8: null,
                };
                emit('EXTREME', side, true);
            }
            continue;
        }

        // --- live sign flip (dead band + persistence) ----------------------------------------------
        const flipTo: FundingSide | null =
            track.side === 'POS' && heldMs(samples, now, (v) => v <= -T.deadBandF8 + EPS) >= T.persistMs
                ? 'NEG'
                : track.side === 'NEG' && heldMs(samples, now, (v) => v >= T.deadBandF8 - EPS) >= T.persistMs
                    ? 'POS'
                    : null;
        if (flipTo) {
            track.side = flipTo;
            if (cooledDown('FLIP')) emit('FLIP', flipTo, false);
        }

        // --- running episode ------------------------------------------------------------------
        let ep = track.episode;
        if (ep) {
            const neg = ep.side === 'NEG';
            const outside = heldMs(samples, now, (v) => (neg ? v > -T.exitF8 + EPS : v < T.exitF8 - EPS));
            if (outside >= T.persistMs) {
                // An episode whose EXTREME alert never went out ends silently.
                if (ep.announced && cooledDown('EXIT')) emit('EXIT', ep.side, false);
                track.episode = null;
                ep = null;
            }
        }
        if (ep) {
            const neg = ep.side === 'NEG';
            const level = sustainedLevel(samples, ep.side);
            if (neg ? level < ep.peakF8 : level > ep.peakF8) ep.peakF8 = level;

            if (!ep.announced) {
                const inGate = neg ? f8 <= negGate + EPS : f8 >= posGate - EPS;
                if (inGate && cooledDown('EXTREME')) {
                    ep.announced = true;
                    ep.lastAlertF8 = f8;
                    ep.lastEventAt = now;
                    emit('EXTREME', ep.side, false);
                }
            } else {
                const deeper = ep.lastAlertF8 * T.deepenFactor;
                const deepening = heldMs(samples, now, (v) => (neg ? v <= deeper + EPS : v >= deeper - EPS));
                if (deepening >= T.persistMs && cooledDown('DEEPENING')) {
                    ep.lastAlertF8 = f8;
                    ep.lastEventAt = now;
                    emit('DEEPENING', ep.side, false);
                } else {
                    const half = ep.peakF8 * T.easeFactor;
                    const armed =
                        ep.easedAtPeakF8 === null ||
                        (neg ? ep.peakF8 < ep.easedAtPeakF8 - EPS : ep.peakF8 > ep.easedAtPeakF8 + EPS);
                    const insideBand = neg ? f8 <= -T.exitF8 + EPS : f8 >= T.exitF8 - EPS;
                    if (armed && insideBand && cooledDown('EASING')) {
                        const easing = heldMs(samples, now, (v) => (neg ? v >= half - EPS : v <= half + EPS));
                        if (easing >= T.persistMs) {
                            ep.easedAtPeakF8 = ep.peakF8;
                            ep.lastEventAt = now;
                            emit('EASING', ep.side, false);
                        }
                    }
                }
            }
        }

        // --- gate entry -----------------------------------------------------------------------
        if (!track.episode) {
            const negHeld = heldMs(samples, now, (v) => v <= negGate + EPS);
            const posHeld = negHeld >= T.persistMs ? -1 : heldMs(samples, now, (v) => v >= posGate - EPS);
            const side: FundingSide | null = negHeld >= T.persistMs ? 'NEG' : posHeld >= T.persistMs ? 'POS' : null;
            if (side) {
                const announce = cooledDown('EXTREME');
                track.episode = {
                    symbol: row.symbol,
                    side,
                    since: now - Math.max(negHeld, posHeld),
                    peakF8: sustainedLevel(samples, side),
                    lastAlertF8: f8,
                    lastEventAt: now,
                    announced: announce,
                    easedAtPeakF8: null,
                };
                if (announce) emit('EXTREME', side, false);
            }
        }
    }

    const episodes: FundingEpisode[] = [];
    for (const key of Object.keys(symbols)) {
        const ep = symbols[key].episode;
        if (!ep) continue;
        episodes.push({
            symbol: ep.symbol,
            side: ep.side,
            since: ep.since,
            peakF8: ep.peakF8,
            lastAlertF8: ep.lastAlertF8,
            lastEventAt: ep.lastEventAt,
        });
    }
    // Negative side first, most extreme sustained level first.
    episodes.sort((a, b) => {
        if (a.side !== b.side) return a.side === 'NEG' ? -1 : 1;
        const d = Math.abs(b.peakF8) - Math.abs(a.peakF8);
        return d !== 0 ? d : a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0;
    });

    return {
        events,
        episodes,
        state: {
            version: 1,
            // Seeding needs data: an empty first pass (universe not loaded yet) does not count.
            seeded: prev.seeded || observed > 0,
            settledChecked: prev.settledChecked || (checkSettled && observed > 0),
            lastPassAt: now,
            symbols,
        },
    };
}

// ---------------------------------------------------------------------------
// Squeeze assessment (negative side)
// ---------------------------------------------------------------------------

export interface SqueezeDetails {
    ownHistoryF8?: number[];   // the symbol's settled rates, 8h-equivalent
    change1hPct?: number;
    change4hPct?: number;
    change24hPct?: number;
    atr1hPct?: number;
    oiChange4hPct?: number;
    oiChange24hPct?: number;
    globalLongShare?: number;  // 0..1 share of accounts that are long
}

export type SqueezeClass =
    | 'SHORT_CROWDING_HOLDING'
    | 'POST_PUMP_PRESSURE'
    | 'SHORT_COVERING'
    | 'SHORTS_RIGHT'
    | 'NEGATIVE_ONLY'
    | 'NONE';

export interface ChecklistItem {
    key: 'extreme' | 'ownHistory' | 'priceHolding' | 'oiRising' | 'notPostPump' | 'shortsCrowded';
    label: string;
    status: 'pass' | 'fail' | 'warn' | 'unknown';
    value: string;
    hint: string;
}

export interface SqueezeAssessment {
    cls: SqueezeClass;
    label: string;
    description: string;
    items: ChecklistItem[];
    passed: number;               // items with status 'pass'
    known: number;                // items whose status is not 'unknown'
    universePercentile: number;   // 0..1 share of the universe with f8 <= this symbol's
    ownPercentile: number | null; // 0..1 share of its own settlements <= the current rate
    f8: number;
    annualized: number;           // fraction per year (simple)
}

export const SQUEEZE_CLASS_LABELS: Record<SqueezeClass, string> = {
    SHORT_CROWDING_HOLDING: 'Short yığılması, fiyat direniyor',
    POST_PUMP_PRESSURE: 'Pompa sonrası short baskısı',
    SHORT_COVERING: 'Short kapanışı (sıkışma sürüyor)',
    SHORTS_RIGHT: "Short'lar haklı",
    NEGATIVE_ONLY: 'Negatif funding',
    NONE: 'Kurulum yok',
};

const DASH = '—';
const MINUS = '−';
const NOT_A_FORECAST = 'Durum tespitidir, yön tahmini değildir.';

const signed = (n: number, digits: number): string => {
    const body = Math.abs(n).toFixed(digits);
    if (Number(body) === 0) return body;
    return `${n < 0 ? MINUS : '+'}${body}`;
};
/** Fraction -> '−0.0700%' (4 decimals, explicit sign). */
const fmtFunding = (fraction: number): string => `${signed(fraction * 100, 4)}%`;
/** Percent value -> '+1.25%'. */
const fmtPct = (pct: number, digits = 2): string => `${signed(pct, digits)}%`;
/** 0..1 share -> whole percent between 1 and 100 for "en alt %N" style texts. */
const sharePct = (share: number): number => Math.min(100, Math.max(1, Math.round(share * 100)));

/**
 * Describes where a symbol stands relative to the "negative funding squeeze" setup.
 * Class priority inside the negative gate: post-pump caution (24h > +10%) first, then
 * "shorts right" (4h price < 0, OI rising), "short covering" (4h price > 0, OI 4h <= −5%),
 * "short crowding, price holding" (4h price >= 0, OI 4h >= 0); anything else — including missing
 * price / OI data — is plain 'NEGATIVE_ONLY'. Outside the gate the class is 'NONE'.
 */
export function assessSqueeze(input: FundingInput, stats: UniverseStats, details: SqueezeDetails): SqueezeAssessment {
    const d: SqueezeDetails = details ?? {};
    const f8 = fundingTo8h(input?.fundingRate, input?.fundingIntervalHours);
    const valid = Number.isFinite(f8);
    const negGate = negGateOf(stats);
    const posGate = posGateOf(stats);
    const inGate = valid && f8 <= negGate + EPS;

    const universePercentile = percentileOf(stats?.sortedF8 ?? [], f8);
    const own = (d.ownHistoryF8 ?? []).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    const ownPercentile = valid && own.length >= T.ownHistoryMin ? percentileOf(own, f8) : null;

    // The live 24h ticker change re-assesses on every row update; klines are only the fallback.
    const chg24 = fin(input?.changePct) ?? fin(d.change24hPct);
    const chg4 = fin(d.change4hPct);
    const atr = fin(d.atr1hPct);
    const oi4 = fin(d.oiChange4hPct);
    const oi24 = fin(d.oiChange24hPct);
    const longShareRaw = fin(d.globalLongShare);
    const longShare = longShareRaw !== null && longShareRaw >= 0 && longShareRaw <= 1 ? longShareRaw : null;

    // --- class ----------------------------------------------------------------------------------
    let cls: SqueezeClass;
    if (!inGate) cls = 'NONE';
    else if (chg24 !== null && chg24 > T.postPumpPct) cls = 'POST_PUMP_PRESSURE';
    else if (chg4 === null || oi4 === null) cls = 'NEGATIVE_ONLY';
    else if (chg4 < 0 && oi4 > 0) cls = 'SHORTS_RIGHT';
    else if (chg4 > 0 && oi4 <= T.oiCoveringPct) cls = 'SHORT_COVERING';
    else if (chg4 >= 0 && oi4 >= 0) cls = 'SHORT_CROWDING_HOLDING';
    else cls = 'NEGATIVE_ONLY';

    let description: string;
    switch (cls) {
        case 'SHORT_CROWDING_HOLDING':
            description =
                "Funding aşırı negatif (short'lar ödüyor), fiyat son 4 saatte düşmüyor ve açık pozisyon azalmıyor" +
                (oi24 !== null && oi24 >= T.oiStrongPct ? ` (24 saatte ${fmtPct(oi24, 1)}: güçlü birikim)` : '') +
                `. Kurulumun koşulları mevcut. ${NOT_A_FORECAST}`;
            break;
        case 'POST_PUMP_PRESSURE':
            description =
                "Funding aşırı negatif, ancak fiyat son 24 saatte %10'dan fazla yükselmiş. Dikkat: bir haftalık küçük " +
                'bir örneklemde (n=19) bu durumlar sonraki 24 saatte ortalama yaklaşık −%5 getirdi. Kanıt zayıf. ' +
                NOT_A_FORECAST;
            break;
        case 'SHORT_COVERING':
            description =
                "Fiyat yükselirken açık pozisyon son 4 saatte %5'ten fazla azaldı: short'lar kapanıyor olabilir, " +
                `hareketin bir kısmı geride kalmış olabilir. ${NOT_A_FORECAST}`;
            break;
        case 'SHORTS_RIGHT':
            description =
                "Funding aşırı negatif ama fiyat düşüyor ve açık pozisyon artıyor: short'lar şimdilik kazanıyor, " +
                `sıkışma belirtisi yok. ${NOT_A_FORECAST}`;
            break;
        case 'NEGATIVE_ONLY':
            description =
                chg4 === null || oi4 === null
                    ? `Funding aşırı negatif; fiyat veya açık pozisyon verisi olmadan kurulumun diğer koşulları değerlendirilemiyor. ${NOT_A_FORECAST}`
                    : `Funding aşırı negatif, ancak fiyat ve açık pozisyon belirgin bir tablo vermiyor. ${NOT_A_FORECAST}`;
            break;
        default:
            description = !valid
                ? 'Funding verisi yok.'
                : f8 >= posGate - EPS
                    ? "Funding pozitif uçta (long'lar ödüyor); bu kontrol listesi negatif funding kurulumu içindir."
                    : `Funding negatif uç eşiğinde değil (8s eşdeğeri ${fmtFunding(f8)}, eşik ${fmtFunding(negGate)}).`;
    }

    // --- checklist ------------------------------------------------------------------------------
    const items: ChecklistItem[] = [];

    items.push({
        key: 'extreme',
        label: 'Funding aşırı negatif',
        status: !valid ? 'unknown' : inGate ? 'pass' : f8 <= -T.exitF8 + EPS ? 'warn' : 'fail',
        value: valid ? fmtFunding(f8) : DASH,
        hint: valid
            ? `8 saatlik eşdeğer funding. Eşik: ≤ ${fmtFunding(negGate)} (sabit −0.0500% ile evrenin en negatif %2 ` +
              `sınırından daha negatif olanı). Evren sıralaması: en negatif %${sharePct(universePercentile)}. ` +
              `Yıllıklandırılmış ≈ ${fmtPct(annualizedFromF8(f8) * 100, 0)}.`
            : 'Funding verisi yok.',
    });

    if (ownPercentile === null) {
        items.push({
            key: 'ownHistory',
            label: 'Kendi geçmişine göre uçta',
            status: 'unknown',
            value: DASH,
            hint: 'Sembolün geçmiş funding ödemeleri yüklenmedi veya yetersiz.',
        });
    } else {
        items.push({
            key: 'ownHistory',
            label: 'Kendi geçmişine göre uçta',
            status: ownPercentile <= T.ownHistoryPass + EPS ? 'pass' : ownPercentile <= T.ownHistoryWarn + EPS ? 'warn' : 'fail',
            value: ownPercentile === 0 ? 'en düşük' : `alt %${sharePct(ownPercentile)}`,
            hint:
                `Tahmini oranın, sembolün son ${own.length} ödemesi içindeki sırası: ` +
                (ownPercentile === 0 ? 'hepsinden düşük' : `en düşük %${sharePct(ownPercentile)}`) +
                '. En düşük %5 içindeyse sembol kendi normaline göre de uçta (%20 içindeyse sınırda).',
        });
    }

    if (chg4 === null) {
        items.push({
            key: 'priceHolding',
            label: 'Fiyat direniyor (4s)',
            status: 'unknown',
            value: DASH,
            hint: '4 saatlik fiyat değişimi yüklenmedi.',
        });
    } else {
        const withinNoise = chg4 < 0 && atr !== null && atr > 0 && Math.abs(chg4) < atr;
        items.push({
            key: 'priceHolding',
            label: 'Fiyat direniyor (4s)',
            status: chg4 >= 0 ? 'pass' : withinNoise ? 'warn' : 'fail',
            value: fmtPct(chg4),
            hint:
                "Son 4 saatlik fiyat değişimi ≥ 0 olmalı: short'lar ödeme yaparken fiyat düşmüyor." +
                (withinNoise ? ` Düşüş 1 saatlik ATR'nin (${fmtPct(atr as number).replace('+', '')}) altında: gürültü sınırında.` : '') +
                (!withinNoise && atr !== null && atr > 0 ? ` 1 saatlik ATR: ${fmtPct(atr).replace('+', '')}.` : '') +
                ' Saatlik mumlardan ölçülür (pencere 4 saat ± 30 dk).',
        });
    }

    if (oi4 === null) {
        items.push({
            key: 'oiRising',
            label: 'Açık pozisyon düşmüyor (4s)',
            status: 'unknown',
            value: DASH,
            hint: 'Açık pozisyon geçmişi yüklenmedi.' + (oi24 !== null ? ` 24 saatlik değişim: ${fmtPct(oi24, 1)}.` : ''),
        });
    } else {
        items.push({
            key: 'oiRising',
            label: 'Açık pozisyon düşmüyor (4s)',
            status: oi4 >= 0 ? 'pass' : oi4 <= T.oiCoveringPct ? 'fail' : 'warn',
            value: fmtPct(oi4, 1),
            hint:
                (oi4 >= 0
                    ? "Açık pozisyon 4 saatte azalmadı: short'lar hâlâ içeride."
                    : oi4 <= T.oiCoveringPct
                        ? "Açık pozisyon 4 saatte %5'ten fazla azaldı: pozisyonlar kapanıyor."
                        : 'Açık pozisyon 4 saatte hafif azaldı.') +
                (oi24 !== null
                    ? ` 24 saatlik değişim: ${fmtPct(oi24, 1)}${oi24 >= T.oiStrongPct ? ' (güçlü birikim)' : ''}.`
                    : '') +
                ' Saatlik veridir (kontrat adedi), en fazla 1 saat geriden gelir.',
        });
    }

    if (chg24 === null) {
        items.push({
            key: 'notPostPump',
            label: 'Pompa sonrası değil (24s)',
            status: 'unknown',
            value: DASH,
            hint: '24 saatlik fiyat değişimi yok.',
        });
    } else {
        items.push({
            key: 'notPostPump',
            label: 'Pompa sonrası değil (24s)',
            status: chg24 > T.postPumpPct ? 'warn' : 'pass',
            value: fmtPct(chg24),
            hint:
                "24 saatlik değişim +%10'un üzerindeyse dikkat: küçük bir örneklemde (n=19) bu durumlar sonraki " +
                '24 saatte ortalama yaklaşık −%5 getirdi.',
        });
    }

    if (longShare === null) {
        items.push({
            key: 'shortsCrowded',
            label: 'Hesaplar short ağırlıklı',
            status: 'unknown',
            value: DASH,
            hint: 'Long/short hesap oranı yüklenmedi.',
        });
    } else {
        items.push({
            key: 'shortsCrowded',
            label: 'Hesaplar short ağırlıklı',
            status: longShare < 0.5 ? 'pass' : longShare < 0.55 ? 'warn' : 'fail',
            value: `Short ${((1 - longShare) * 100).toFixed(1)}%`,
            hint:
                "Hesap sayısına göre long/short dağılımı (pozisyon büyüklüğü değil). Short hesap payı %50'nin " +
                'üzerindeyse kalabalık short tarafında.',
        });
    }

    let passed = 0;
    let known = 0;
    for (const item of items) {
        if (item.status === 'pass') passed++;
        if (item.status !== 'unknown') known++;
    }

    return {
        cls,
        label: SQUEEZE_CLASS_LABELS[cls],
        description,
        items,
        passed,
        known,
        universePercentile,
        ownPercentile,
        f8,
        annualized: annualizedFromF8(f8),
    };
}
