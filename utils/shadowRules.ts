// Shadow rules: hypotheses that are MEASURED by the outcome tracker (signal_outcomes + Karne) but never
// shown, sent or stored as signals. Pure logic like utils/signalEngines.ts: no fetch, no clock, no I/O —
// the engine (engine/engine.ts) passes the data and `now`, fetches the open interest and delivers the
// fired events through its onShadowSignals option only.
//
// Shadow_SqueezeFuel ("short-squeeze fuel", derived from the ORCA rally): after an upward engine signal
// (Momentum_24h_Up or Volume_Spike BUY) perp traders short into the breakout — funding turns sharply
// negative and open interest grows — while the price holds at or above the signal price. Hypothesis only:
// there is no evidence that it predicts anything; the Karne measures it against the base BUY rules.
//
// The state lives in the engine's memory only: a restart or a leader change loses the armed entries and
// the 72 h cooldowns (acceptable for a measurement that only needs a sample, not completeness).

import { fundingTo8h } from './fundingSqueeze';

export const STRATEGY_SHADOW_SQUEEZE_FUEL = 'Shadow_SqueezeFuel';

export const SQUEEZE_FUEL_RULES = {
    windowMs: 12 * 60 * 60 * 1000,        // the conditions must meet within 12 h of the trigger signal
    fundingF8Max: -0.0005,                // fraction: −0.05% 8h-equivalent (f8 = rate * 8 / intervalHours) or lower
    oiGrowthMin: 1.15,                    // open interest at least 15% above the baseline taken at arming
    cooldownMs: 72 * 60 * 60 * 1000,      // per spot symbol, after a fire
    checkEveryMs: 5 * 60 * 1000,
    oiBaselineDeadlineMs: 10 * 60 * 1000, // no baseline open interest by then: disarmed
    maxArmed: 300,
} as const;

const EPS = 1e-12; // float noise at a threshold
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUS = '−';

/** A fired shadow event. Same shape as an EngineSignal minus magnitude; never goes through onSignals. */
export interface ShadowSignal {
    engine: 'SHADOW';
    source: 'ALGO_SHADOW';
    strategy: string;
    symbol: string;  // spot symbol
    side: 'BUY';
    price: number;   // spot last price at the fire
    at: number;
    note: string;
}

/** One armed spot symbol, waiting for the conditions. */
export interface SqueezeArm {
    spot: string;
    perp: string;
    trigger: string;        // strategy of the trigger signal
    tSig: number;           // trigger signal time
    pSig: number;           // trigger signal price (spot)
    armedAt: number;
    oiSig: number | null;   // open interest of `perp` right after arming (null until fetched)
}

export interface SqueezeFuelState {
    armed: readonly SqueezeArm[];                 // oldest first
    cooldowns: Readonly<Record<string, number>>;  // spot symbol -> fire time
    firedAt: readonly number[];                   // fire times of the last 24 h
    lastFiredAt: number | null;
}

export const createSqueezeFuelState = (): SqueezeFuelState => ({ armed: [], cooldowns: {}, firedAt: [], lastFiredAt: null });

/** The part of an emitted engine signal the rule reads. */
export interface SqueezeTriggerInput {
    strategy: string;
    symbol: string;
    side: string;
    price: number;
    at: number;
}

export const isSqueezeFuelTrigger = (signal: SqueezeTriggerInput): boolean =>
    !!signal
    && signal.side === 'BUY'
    && typeof signal.strategy === 'string'
    && (signal.strategy === 'Momentum_24h_Up' || signal.strategy.startsWith('Volume_Spike'));

/** USDT-M perpetual of a spot symbol: the same name, else the '1000' / '1000000' contract, else null. */
export const squeezePerpFor = (spot: string, perps: ReadonlySet<string>): string | null => {
    if (typeof spot !== 'string' || !spot) return null;
    for (const candidate of [spot, `1000${spot}`, `1000000${spot}`]) if (perps.has(candidate)) return candidate;
    return null;
};

/** Current 8h-equivalent funding (fraction) of a mark-price row; null when the rate is unusable. */
export const squeezeFundingF8 = (rate: unknown, intervalHours: number): number | null => {
    if (typeof rate !== 'number' || !Number.isFinite(rate)) return null;
    const f8 = fundingTo8h(rate, intervalHours);
    return Number.isFinite(f8) ? f8 : null;
};

const pruneCooldowns = (cooldowns: Readonly<Record<string, number>>, now: number): Record<string, number> => {
    const next: Record<string, number> = {};
    for (const [symbol, at] of Object.entries(cooldowns)) {
        if (Number.isFinite(at) && now - at < SQUEEZE_FUEL_RULES.cooldownMs) next[symbol] = at;
    }
    return next;
};

const inCooldown = (state: SqueezeFuelState, spot: string, now: number): boolean => {
    const at = state.cooldowns[spot];
    return typeof at === 'number' && now - at < SQUEEZE_FUEL_RULES.cooldownMs;
};

export interface SqueezeArmResult {
    state: SqueezeFuelState;
    armed: SqueezeArm[]; // newly armed entries (the caller fetches their baseline open interest)
}

/**
 * Arms the spot symbols of the EMITTED trigger signals that have a TRADING crypto perpetual, are not in
 * their cooldown and are not armed yet. Over maxArmed the oldest entries are dropped.
 */
export function armSqueezeFuel(
    state: SqueezeFuelState,
    signals: readonly SqueezeTriggerInput[],
    perps: ReadonlySet<string> | null,
    now: number,
): SqueezeArmResult {
    if (!perps || !Array.isArray(signals) || signals.length === 0) return { state, armed: [] };
    const added: SqueezeArm[] = [];
    const taken = new Set(state.armed.map((e) => e.spot));
    for (const signal of signals) {
        if (!isSqueezeFuelTrigger(signal)) continue;
        const spot = signal.symbol;
        if (taken.has(spot) || inCooldown(state, spot, now)) continue;
        if (!(Number.isFinite(signal.price) && signal.price > 0) || !Number.isFinite(signal.at)) continue;
        const perp = squeezePerpFor(spot, perps);
        if (!perp) continue;
        taken.add(spot);
        added.push({ spot, perp, trigger: signal.strategy, tSig: signal.at, pSig: signal.price, armedAt: now, oiSig: null });
    }
    if (added.length === 0) return { state, armed: [] };
    const armed = [...state.armed, ...added].slice(-SQUEEZE_FUEL_RULES.maxArmed);
    const kept = new Set(armed);
    return { state: { ...state, armed }, armed: added.filter((e) => kept.has(e)) };
}

/** Stores the baseline open interest of an armed entry (identified by spot + armedAt). */
export function setSqueezeBaseline(state: SqueezeFuelState, spot: string, armedAt: number, oi: number): SqueezeFuelState {
    if (!(Number.isFinite(oi) && oi > 0)) return state;
    const index = state.armed.findIndex((e) => e.spot === spot && e.armedAt === armedAt && e.oiSig === null);
    if (index < 0) return state;
    const armed = state.armed.slice();
    armed[index] = { ...armed[index], oiSig: oi };
    return { ...state, armed };
}

/** Live data the check reads; both return null when the value is missing or stale. */
export interface SqueezeMarket {
    fundingF8(perp: string): number | null; // current 8h-equivalent funding, fraction
    spotPrice(spot: string): number | null; // spot last price
}

/** An armed entry whose funding (A) and price (B) conditions hold: the caller fetches the current open interest. */
export interface SqueezeCandidate {
    spot: string;
    perp: string;
    armedAt: number;
    f8: number;
    price: number;
}

export interface SqueezePlan {
    state: SqueezeFuelState;
    baseline: SqueezeArm[];          // entries still without a baseline (retry the fetch)
    candidates: SqueezeCandidate[];  // A + B hold
    expired: number;                 // dropped: older than the window
    baselineMissed: number;          // dropped: no baseline by the deadline
}

/**
 * One periodic check: drops entries older than the window and entries without a baseline past the
 * deadline, then gates the rest on A (funding f8 <= fundingF8Max) and B (spot price >= signal price).
 */
export function planSqueezeFuelCheck(state: SqueezeFuelState, market: SqueezeMarket, now: number): SqueezePlan {
    const R = SQUEEZE_FUEL_RULES;
    const armed: SqueezeArm[] = [];
    const baseline: SqueezeArm[] = [];
    const candidates: SqueezeCandidate[] = [];
    let expired = 0;
    let baselineMissed = 0;
    for (const entry of state.armed) {
        if (now - entry.tSig > R.windowMs) {
            expired++;
            continue;
        }
        if (entry.oiSig === null) {
            if (now - entry.armedAt > R.oiBaselineDeadlineMs) {
                baselineMissed++;
                continue;
            }
            armed.push(entry);
            baseline.push(entry);
            continue;
        }
        armed.push(entry);
        const f8 = market.fundingF8(entry.perp);
        const fundingOk = typeof f8 === 'number' && Number.isFinite(f8) && f8 <= R.fundingF8Max + EPS;
        const price = market.spotPrice(entry.spot);
        const priceOk = typeof price === 'number' && Number.isFinite(price) && price > 0 && price >= entry.pSig;
        if (fundingOk && priceOk) candidates.push({ spot: entry.spot, perp: entry.perp, armedAt: entry.armedAt, f8: f8 as number, price: price as number });
    }
    const firedAt = state.firedAt.filter((t) => now - t < DAY_MS);
    const cooldowns = pruneCooldowns(state.cooldowns, now);
    return { state: { ...state, armed, firedAt, cooldowns }, baseline, candidates, expired, baselineMissed };
}

// --- note text (Turkish, descriptive) ---
const signed = (value: number, digits: number): string => {
    const body = Math.abs(value).toFixed(digits);
    if (Number(body) === 0) return body;
    return `${value < 0 ? MINUS : '+'}${body}`;
};

const plainPrice = (price: number): string => String(Number(price.toPrecision(6)));

const utcMinute = (t: number): string => `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

const triggerLabel = (strategy: string): string => {
    if (strategy === 'Momentum_24h_Up') return '24s momentum (yükseliş)';
    const volume = /^Volume_Spike_([\d.]+)x$/.exec(strategy);
    return volume ? `hacim sıçraması ${volume[1]}x (yükseliş)` : strategy;
};

export interface SqueezeFireResult {
    state: SqueezeFuelState;
    signal: ShadowSignal | null;
}

/**
 * Condition C with the freshly fetched open interest: oiNow / oiSig >= oiGrowthMin fires the entry ONCE
 * (disarmed, 72 h cooldown for the spot symbol). Otherwise the entry stays armed for the next check.
 */
export function fireSqueezeFuel(state: SqueezeFuelState, candidate: SqueezeCandidate, oiNow: number, now: number): SqueezeFireResult {
    const entry = state.armed.find((e) => e.spot === candidate.spot && e.armedAt === candidate.armedAt);
    if (!entry || entry.oiSig === null || !(entry.oiSig > 0)) return { state, signal: null };
    if (!(Number.isFinite(oiNow) && oiNow > 0)) return { state, signal: null };
    const growth = oiNow / entry.oiSig;
    if (growth < SQUEEZE_FUEL_RULES.oiGrowthMin - EPS) return { state, signal: null };
    const priceMovePct = (candidate.price / entry.pSig - 1) * 100;
    const note =
        `Gölge kural (sinyal gönderilmez, yalnızca ölçülür). Tetikleyici: ${triggerLabel(entry.trigger)}, ${utcMinute(entry.tSig)}. ` +
        `Fonlama 8s eşdeğeri ${signed(candidate.f8 * 100, 4)}% (eşik ${signed(SQUEEZE_FUEL_RULES.fundingF8Max * 100, 2)}%). ` +
        `Vadeli açık pozisyon (${entry.perp}) sinyalden beri ${growth.toFixed(2)}x. ` +
        `Fiyat ${plainPrice(candidate.price)}, sinyal fiyatı ${plainPrice(entry.pSig)} (${signed(priceMovePct, 2)}%).`;
    const signal: ShadowSignal = {
        engine: 'SHADOW',
        source: 'ALGO_SHADOW',
        strategy: STRATEGY_SHADOW_SQUEEZE_FUEL,
        symbol: entry.spot,
        side: 'BUY',
        price: candidate.price,
        at: now,
        note,
    };
    return {
        state: {
            armed: state.armed.filter((e) => e !== entry),
            cooldowns: { ...pruneCooldowns(state.cooldowns, now), [entry.spot]: now },
            firedAt: [...state.firedAt.filter((t) => now - t < DAY_MS), now],
            lastFiredAt: now,
        },
        signal,
    };
}

export interface ShadowStatus {
    armed: number;
    fired24h: number;
    lastFiredAt: number | null;
}

export const squeezeFuelStatus = (state: SqueezeFuelState, now: number): ShadowStatus => ({
    armed: state.armed.length,
    fired24h: state.firedAt.filter((t) => now - t < DAY_MS).length,
    lastFiredAt: state.lastFiredAt,
});
