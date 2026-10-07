// Local signal engines (24h momentum, 1h volume ratio, negative funding regime) as PURE evaluators,
// plus the market-wide burst guard that folds a whole-market move into one aggregate record.
//
// No fetch, no DOM, no React, no clock access: callers pass the data, the previous state and `now`,
// and get back the signals plus the next state. That makes every engine replayable in tests.
// context/SignalContext.tsx wires them to the live Binance streams and to the notification plumbing.
//
// HONESTY RULES (phase 1 of the signal review):
//  - A record states only what was measured ("the last hour traded 5.4x the average hour").
//  - `side` is the DIRECTION OF THE MOVE that was measured, never advice; without a measured
//    direction the record is 'NEUTRAL'.
//  - No engine writes `confidence`. The measured size goes into `magnitude`.
//  - A signal is an EVENT: it fires once on entry into a condition (first sight only seeds the state),
//    then the per-symbol cooldown applies.

import type { BigMoveSignal, FuturesTicker, Side, Signal, Ticker } from '../types';
import {
    computeUniverseStats,
    createDetectorState,
    detectFundingEvents,
    fundingTo8h,
    FUNDING_THRESHOLDS,
    type DetectorState,
    type FundingEvent,
    type FundingInput,
} from './fundingSqueeze';

// ---------------------------------------------------------------------------
// Settings (schema version 2)
// ---------------------------------------------------------------------------

export interface SignalSettings {
    version: 2;
    momentum: {
        threshold: number;     // |24h change| in percent. default 8, min 4, max 50
        cooldownHours: number; // per symbol + direction. default 12, min 6, max 72
    };
    volume: {
        ratio: number;         // last hour's volume / average hour of the last 24h. default 5, min 3, max 50
        cooldownHours: number; // per symbol. default 6, min 1, max 48
    };
    funding: {
        thresholdPct: number;  // 8h-equivalent funding in percent. default -0.05, allowed -1 … -0.03
        cooldownHours: number; // per symbol. default 4, min 4, max 48
    };
}

export const SIGNAL_SETTINGS_VERSION = 2 as const;

/** Bounds and defaults of every setting; the settings dialog validates against the same numbers. */
export const SIGNAL_SETTINGS_LIMITS = {
    momentum: {
        threshold: { min: 4, max: 50, default: 8 },
        cooldownHours: { min: 6, max: 72, default: 12 },
    },
    volume: {
        ratio: { min: 3, max: 50, default: 5 },
        cooldownHours: { min: 1, max: 48, default: 6 },
    },
    funding: {
        thresholdPct: { min: -1, max: -0.03, default: -0.05 },
        cooldownHours: { min: 4, max: 48, default: 4 },
    },
} as const;

export const DEFAULT_SIGNAL_SETTINGS: SignalSettings = {
    version: SIGNAL_SETTINGS_VERSION,
    momentum: {
        threshold: SIGNAL_SETTINGS_LIMITS.momentum.threshold.default,
        cooldownHours: SIGNAL_SETTINGS_LIMITS.momentum.cooldownHours.default,
    },
    volume: {
        ratio: SIGNAL_SETTINGS_LIMITS.volume.ratio.default,
        cooldownHours: SIGNAL_SETTINGS_LIMITS.volume.cooldownHours.default,
    },
    funding: {
        thresholdPct: SIGNAL_SETTINGS_LIMITS.funding.thresholdPct.default,
        cooldownHours: SIGNAL_SETTINGS_LIMITS.funding.cooldownHours.default,
    },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

interface Limit { min: number; max: number; default: number }

/** Finite numbers are clamped into the limit; anything else (null, '', NaN, booleans) is the default. */
const clampSetting = (value: unknown, limit: Limit): number => {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return limit.default;
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return limit.default;
    return Math.min(limit.max, Math.max(limit.min, n));
};

/**
 * Stored settings -> valid version 2 settings. Anything that does not carry `version: 2` is discarded
 * as a whole: the previous schema stored seconds and raw funding fractions under similar names, and
 * reading those with the new units would silently produce absurd thresholds.
 */
export function sanitizeSignalSettings(raw: unknown): SignalSettings {
    if (!isRecord(raw) || raw.version !== SIGNAL_SETTINGS_VERSION) {
        return {
            version: SIGNAL_SETTINGS_VERSION,
            momentum: { ...DEFAULT_SIGNAL_SETTINGS.momentum },
            volume: { ...DEFAULT_SIGNAL_SETTINGS.volume },
            funding: { ...DEFAULT_SIGNAL_SETTINGS.funding },
        };
    }
    const mom = isRecord(raw.momentum) ? raw.momentum : {};
    const vol = isRecord(raw.volume) ? raw.volume : {};
    const fund = isRecord(raw.funding) ? raw.funding : {};
    const L = SIGNAL_SETTINGS_LIMITS;
    return {
        version: SIGNAL_SETTINGS_VERSION,
        momentum: {
            threshold: clampSetting(mom.threshold, L.momentum.threshold),
            cooldownHours: clampSetting(mom.cooldownHours, L.momentum.cooldownHours),
        },
        volume: {
            ratio: clampSetting(vol.ratio, L.volume.ratio),
            cooldownHours: clampSetting(vol.cooldownHours, L.volume.cooldownHours),
        },
        funding: {
            thresholdPct: clampSetting(fund.thresholdPct, L.funding.thresholdPct),
            cooldownHours: clampSetting(fund.cooldownHours, L.funding.cooldownHours),
        },
    };
}

// ---------------------------------------------------------------------------
// Shared output types
// ---------------------------------------------------------------------------

export type EngineKind = 'MOMENTUM' | 'VOLUME' | 'FUNDING';

/** A signal without id / time; the caller adds those (ids need randomness, which stays out of here). */
export interface EngineSignal {
    engine: EngineKind;
    source: NonNullable<Signal['source']>;
    strategy: string;
    symbol: string;
    side: Side;
    price: number;
    note: string;
    magnitude: NonNullable<Signal['magnitude']>;
    at: number;
}

/** How many symbols of the engine's universe satisfy the current threshold right now. */
export interface EngineStat {
    matching: number;
    universe: number;
}

export interface EngineStats {
    momentum: EngineStat;
    volume: EngineStat;
    funding: EngineStat;
    updatedAt: number;
}

export const EMPTY_ENGINE_STAT: EngineStat = { matching: 0, universe: 0 };

export const EMPTY_ENGINE_STATS: EngineStats = {
    momentum: EMPTY_ENGINE_STAT,
    volume: EMPTY_ENGINE_STAT,
    funding: EMPTY_ENGINE_STAT,
    updatedAt: 0,
};

// Strategy keys. The old keys ('RMI_Overbought', 'RMI_Oversold', 'SmartMoney_Divergence') are no
// longer produced; they only survive in labels for signals stored before this change.
export const STRATEGY_MOMENTUM_UP = 'Momentum_24h_Up';
export const STRATEGY_MOMENTUM_DOWN = 'Momentum_24h_Down';
export const STRATEGY_FUNDING_REGIME_NEG = 'Funding_Regime_Neg';
/** 'Volume_Spike_5.4x' — the 'N.Nx' part is parsed by the Radar, keep the format. */
export const volumeStrategyKey = (ratio: number): string => `Volume_Spike_${ratio.toFixed(1)}x`;

/**
 * Symbol of the market-wide aggregate records of the burst guard (see applyBurstGuard). It is NOT a
 * tradable pair: no price lookups, no chart / exchange links, no PnL. Its records carry price 0.
 */
export const MARKET_SYMBOL = 'MARKET';

export type MarketWideSide = 'UP' | 'DOWN' | 'NEUTRAL';

/** Direction of a record: BUY / LONG = up, SELL / SHORT = down, anything else = NEUTRAL. */
const sideKind = (side: Side): MarketWideSide =>
    side === 'BUY' || side === 'LONG' ? 'UP' : side === 'SELL' || side === 'SHORT' ? 'DOWN' : 'NEUTRAL';

const MARKET_WIDE_PREFIX = 'Market_Wide_';
const MARKET_WIDE_END_SUFFIX = '_End';
const SIDE_WORD: Record<MarketWideSide, string> = { UP: 'Up', DOWN: 'Down', NEUTRAL: 'Neutral' };

/** 'Market_Wide_Momentum_Down', 'Market_Wide_Volume_Up', … ('…_End' for the closing record). */
export const marketWideStrategyKey = (engine: 'MOMENTUM' | 'VOLUME', side: MarketWideSide, end = false): string =>
    `${MARKET_WIDE_PREFIX}${engine === 'MOMENTUM' ? 'Momentum' : 'Volume'}_${SIDE_WORD[side]}${end ? MARKET_WIDE_END_SUFFIX : ''}`;

export const isMarketWideStrategy = (strategy: unknown): boolean =>
    typeof strategy === 'string' && strategy.startsWith(MARKET_WIDE_PREFIX);

/** The closing ('bitti') record of a market-wide move. */
export const isMarketWideEndStrategy = (strategy: unknown): boolean =>
    isMarketWideStrategy(strategy) && (strategy as string).endsWith(MARKET_WIDE_END_SUFFIX);

const MARKET_WIDE_BASE_LABELS: Record<string, string> = {
    [marketWideStrategyKey('MOMENTUM', 'UP')]: 'Piyasa geneli yükseliş · 24s momentum',
    [marketWideStrategyKey('MOMENTUM', 'DOWN')]: 'Piyasa geneli düşüş · 24s momentum',
    [marketWideStrategyKey('MOMENTUM', 'NEUTRAL')]: 'Piyasa geneli hareket · 24s momentum',
    [marketWideStrategyKey('VOLUME', 'UP')]: 'Piyasa geneli hacim artışı · yükselişte',
    [marketWideStrategyKey('VOLUME', 'DOWN')]: 'Piyasa geneli hacim artışı · düşüşte',
    [marketWideStrategyKey('VOLUME', 'NEUTRAL')]: 'Piyasa geneli hacim artışı',
};

/** Turkish labels of every market-wide strategy key, including the closing ('… · bitti') records. */
export const MARKET_WIDE_STRATEGY_LABELS: Readonly<Record<string, string>> = Object.freeze(
    Object.fromEntries(
        Object.entries(MARKET_WIDE_BASE_LABELS).flatMap(([key, label]) => [
            [key, label],
            [`${key}${MARKET_WIDE_END_SUFFIX}`, `${label} · bitti`],
        ]),
    ),
);

/** Turkish label of a market-wide strategy key; null for any other key. */
export const marketWideStrategyLabel = (strategy: unknown): string | null =>
    typeof strategy === 'string' && Object.prototype.hasOwnProperty.call(MARKET_WIDE_STRATEGY_LABELS, strategy)
        ? MARKET_WIDE_STRATEGY_LABELS[strategy]
        : null;

// ---------------------------------------------------------------------------
// Text helpers (Turkish, descriptive)
// ---------------------------------------------------------------------------

const MINUS = '−';

/** 9.123 -> '+9.1', -9.123 -> '−9.1', 0 -> '0.0' (no sign on a rounded zero). */
const signedNumber = (value: number, digits: number): string => {
    const body = Math.abs(value).toFixed(digits);
    if (Number(body) === 0) return body;
    return `${value < 0 ? MINUS : '+'}${body}`;
};

const formatUsdCompact = (value: number): string => {
    if (!Number.isFinite(value)) return '—';
    const abs = Math.abs(value);
    if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
    return `$${value.toFixed(0)}`;
};

/** Remaining time as '2 sa 14 dk' / '14 dk' / '1 dk'den az'. */
const formatRemaining = (ms: number): string => {
    if (!Number.isFinite(ms) || ms <= 0) return 'şimdi';
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1) return "1 dk'dan az";
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (hours === 0) return `${rest} dk`;
    return rest === 0 ? `${hours} sa` : `${hours} sa ${rest} dk`;
};

const trimNumber = (value: number): string => String(Number(value.toFixed(4)));

/** Label of a signal's side for local engine signals: the direction of the measured move. */
export const moveDirectionLabel = (side: Side): string =>
    side === 'BUY' || side === 'LONG' ? 'yukarı' : side === 'SELL' || side === 'SHORT' ? 'aşağı' : 'yönsüz';

// ---------------------------------------------------------------------------
// Spot universe
// ---------------------------------------------------------------------------

export const SPOT_UNIVERSE = {
    quote: 'USDT',
    minQuoteVolume: 1_000_000, // 24h quote volume
    minRangePct: 0.3,          // (high − low) / low; anything tighter behaves like a pegged asset
    staleMs: 10 * 60 * 1000,   // not updated this long (relative to the newest ticker) = not trading
} as const;

// Stable / wrapped / pegged base assets: their "moves" are peg noise, not market moves.
const EXCLUDED_BASES = new Set(['USDC', 'FDUSD', 'TUSD', 'USDP', 'DAI', 'PAXG', 'WBTC', 'WBETH', 'BNSOL']);

export const isExcludedSpotBase = (base: string): boolean => EXCLUDED_BASES.has(base) || base.startsWith('EUR');

/** Binance event time of the newest ticker; the reference for staleness and data gaps (no local clock). */
export function newestTickerTime(tickers: readonly Ticker[]): number {
    let newest = 0;
    for (const t of tickers) {
        if (t && Number.isFinite(t.updatedAt) && t.updatedAt > newest) newest = t.updatedAt;
    }
    return newest;
}

/**
 * Liquid, non-pegged spot USDT pairs that are currently trading.
 * `dataAt` is newestTickerTime(tickers); pass 0 to skip the staleness check.
 */
export function inSpotUniverse(t: Ticker, dataAt = 0): boolean {
    if (!t || typeof t.symbol !== 'string' || !t.symbol.endsWith(SPOT_UNIVERSE.quote)) return false;
    const base = t.symbol.slice(0, -SPOT_UNIVERSE.quote.length);
    if (!base || isExcludedSpotBase(base)) return false;
    if (!(t.volume >= SPOT_UNIVERSE.minQuoteVolume)) return false;
    if (!(t.lastPrice > 0) || !(t.lowPrice > 0) || !(t.highPrice >= t.lowPrice)) return false;
    if (!Number.isFinite(t.priceChangePercent)) return false;
    if (!(((t.highPrice - t.lowPrice) / t.lowPrice) * 100 >= SPOT_UNIVERSE.minRangePct)) return false;
    if (dataAt > 0 && Number.isFinite(t.updatedAt) && dataAt - t.updatedAt > SPOT_UNIVERSE.staleMs) return false;
    return true;
}

export function selectSpotUniverse(tickers: readonly Ticker[]): { universe: Ticker[]; dataAt: number } {
    const dataAt = newestTickerTime(tickers);
    const universe: Ticker[] = [];
    for (const t of tickers) if (inSpotUniverse(t, dataAt)) universe.push(t);
    return { universe, dataAt };
}

// ---------------------------------------------------------------------------
// Cooldown stamps (persisted by the caller so that a page reload does not re-emit a signal)
// ---------------------------------------------------------------------------

export type CooldownMap = Record<string, number>;

export interface EngineCooldowns {
    version: 1;
    momentum: CooldownMap; // key: `${symbol}:UP` | `${symbol}:DOWN`
    volume: CooldownMap;   // key: symbol
    funding: CooldownMap;  // key: symbol
}

export const COOLDOWN_MAX_AGE_MS = 72 * 60 * 60 * 1000;

export const createEngineCooldowns = (): EngineCooldowns => ({ version: 1, momentum: {}, volume: {}, funding: {} });

const pruneCooldownMap = (raw: unknown, now: number): CooldownMap => {
    const out: CooldownMap = {};
    if (!isRecord(raw)) return out;
    for (const key of Object.keys(raw)) {
        const at = raw[key];
        // A stamp from the future (clock was changed) would block the symbol indefinitely: drop it.
        if (typeof at === 'number' && Number.isFinite(at) && at <= now && now - at <= COOLDOWN_MAX_AGE_MS) out[key] = at;
    }
    return out;
};

/** Validates stored stamps and drops everything older than 72 h (longer than any allowed cooldown). */
export function sanitizeEngineCooldowns(raw: unknown, now: number): EngineCooldowns {
    const r = isRecord(raw) && raw.version === 1 ? raw : {};
    return {
        version: 1,
        momentum: pruneCooldownMap(r.momentum, now),
        volume: pruneCooldownMap(r.volume, now),
        funding: pruneCooldownMap(r.funding, now),
    };
}

const HOUR_MS = 60 * 60 * 1000;

const inCooldown = (cooldowns: CooldownMap, key: string, now: number, cooldownMs: number): boolean => {
    const last = cooldowns[key];
    return typeof last === 'number' && now >= last && now - last < cooldownMs;
};

/** A gap this long in the data (sleeping laptop, long disconnect) re-seeds an engine silently. */
export const MAX_DATA_GAP_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Engine 1 — 24h momentum at a fresh 24h extreme
// ---------------------------------------------------------------------------

export const MOMENTUM_RULES = {
    extremeProximity: 0.001, // price within 0.1% of the 24h high (up) / low (down)
    maxPerPass: 5,
} as const;

export type MomentumCondition = 'NONE' | 'UP' | 'DOWN';

export interface MomentumState {
    seededThreshold: number | null;
    lastDataAt: number;
    /** Condition of every universe symbol at the previous pass. A missing symbol has not been seen yet. */
    conditions: Record<string, MomentumCondition>;
}

export const createMomentumState = (): MomentumState => ({ seededThreshold: null, lastDataAt: 0, conditions: {} });

export const momentumCondition = (t: Ticker, threshold: number): MomentumCondition => {
    const pct = t.priceChangePercent;
    if (pct >= threshold && t.lastPrice >= t.highPrice * (1 - MOMENTUM_RULES.extremeProximity)) return 'UP';
    if (pct <= -threshold && t.lastPrice <= t.lowPrice * (1 + MOMENTUM_RULES.extremeProximity)) return 'DOWN';
    return 'NONE';
};

export interface MomentumResult {
    signals: EngineSignal[];
    state: MomentumState;
    cooldowns: CooldownMap; // same object as the input when nothing fired
    stat: EngineStat;       // matching = |24h%| >= threshold inside the universe
    /**
     * Entries beyond the per-pass cap, as signals: NOT emitted and NOT stamped. Only the market-wide
     * burst guard looks at them (they belong to the same market event); when it folds them into an
     * aggregate, the caller stamps them with stampMomentumCooldowns.
     */
    overflow: EngineSignal[];
}

/** Cooldown key of a momentum signal: `${symbol}:UP` / `${symbol}:DOWN`. */
export const momentumCooldownKey = (symbol: string, condition: 'UP' | 'DOWN'): string => `${symbol}:${condition}`;

/** Stamps the momentum cooldowns of the given signals (BUY = UP, SELL = DOWN). Returns a new map. */
export function stampMomentumCooldowns(cooldowns: CooldownMap, signals: readonly EngineSignal[], now: number): CooldownMap {
    if (signals.length === 0) return cooldowns;
    const next = { ...cooldowns };
    for (const signal of signals) {
        const kind = sideKind(signal.side);
        if (kind === 'NEUTRAL') continue;
        next[momentumCooldownKey(signal.symbol, kind)] = now;
    }
    return next;
}

/**
 * Trigger: |24h change| >= threshold AND the price is at a fresh 24h extreme (within 0.1% of the 24h
 * high for an up move, of the 24h low for a down move). One signal on ENTRY into that combined
 * condition; the side is the direction of the move. At most 5 signals per pass (largest |24h%| first);
 * entries beyond that are not queued — the symbol can fire on its next entry.
 *
 * The first sight of a symbol only seeds its state. A changed threshold or a data gap of more than
 * 5 minutes re-seeds every symbol, so neither produces a burst.
 */
export function evaluateMomentum(
    tickers: readonly Ticker[],
    settings: SignalSettings['momentum'],
    state: MomentumState,
    cooldowns: CooldownMap,
    now: number,
): MomentumResult {
    const threshold = settings.threshold;
    const cooldownMs = settings.cooldownHours * HOUR_MS;
    const { universe, dataAt } = selectSpotUniverse(tickers);

    const gap = state.lastDataAt > 0 && dataAt > 0 && Math.abs(dataAt - state.lastDataAt) > MAX_DATA_GAP_MS;
    const reseed = state.seededThreshold !== threshold || gap;
    const previous = reseed ? {} : state.conditions;

    const conditions: Record<string, MomentumCondition> = {};
    const entries: { ticker: Ticker; condition: 'UP' | 'DOWN' }[] = [];
    let matching = 0;

    for (const t of universe) {
        if (Math.abs(t.priceChangePercent) >= threshold) matching++;
        const condition = momentumCondition(t, threshold);
        const before = previous[t.symbol];
        conditions[t.symbol] = condition;
        if (before === undefined || condition === 'NONE' || condition === before) continue;
        if (inCooldown(cooldowns, momentumCooldownKey(t.symbol, condition), now, cooldownMs)) continue;
        entries.push({ ticker: t, condition });
    }

    entries.sort((a, b) => Math.abs(b.ticker.priceChangePercent) - Math.abs(a.ticker.priceChangePercent));
    const fired = entries.slice(0, MOMENTUM_RULES.maxPerPass);

    const toSignal = ({ ticker, condition }: { ticker: Ticker; condition: 'UP' | 'DOWN' }): EngineSignal => {
        const up = condition === 'UP';
        const pct = ticker.priceChangePercent;
        return {
            engine: 'MOMENTUM',
            source: 'ALGO_MOMENTUM',
            strategy: up ? STRATEGY_MOMENTUM_UP : STRATEGY_MOMENTUM_DOWN,
            symbol: ticker.symbol,
            side: up ? 'BUY' : 'SELL',
            price: ticker.lastPrice,
            note:
                `24s değişim ${signedNumber(pct, 2)}% (eşik %${trimNumber(threshold)}) ve fiyat yeni 24s ` +
                `${up ? 'zirvede' : 'dipte'}. Hareket yönü: ${up ? 'yukarı' : 'aşağı'}.`,
            magnitude: {
                value: pct,
                text: `${signedNumber(pct, 1)}%`,
                caption: `24s değişim, yeni 24s ${up ? 'zirve' : 'dip'}`,
            },
            at: now,
        };
    };

    let nextCooldowns = cooldowns;
    const signals: EngineSignal[] = fired.map((entry) => {
        if (nextCooldowns === cooldowns) nextCooldowns = { ...cooldowns };
        nextCooldowns[momentumCooldownKey(entry.ticker.symbol, entry.condition)] = now;
        return toSignal(entry);
    });

    return {
        signals,
        state: { seededThreshold: threshold, lastDataAt: dataAt > 0 ? dataAt : state.lastDataAt, conditions },
        cooldowns: nextCooldowns,
        stat: { matching, universe: universe.length },
        overflow: entries.slice(MOMENTUM_RULES.maxPerPass).map(toSignal),
    };
}

// ---------------------------------------------------------------------------
// Engine 2 — last hour's volume against the average hour of the last 24h
// ---------------------------------------------------------------------------

/** One row of Binance's rolling 1h ticker stream (`!ticker_1h@arr`), with the local receive time. */
export interface HourTicker {
    symbol: string;
    quoteVolume: number;        // q: quote volume traded in the rolling hour
    priceChangePercent: number; // P: price change over the rolling hour, percent
    lastPrice: number;          // c
    receivedAt: number;         // local clock, ms
}

export const VOLUME_RULES = {
    rearmRatio: 3,           // the condition ends (and can fire again) below this ratio …
    lowThreshold: 3.6,       // … unless the threshold is under 3.6:
    rearmFactor: 0.6,        //   then it ends below 60% of the threshold
    directionMinPct: 1,      // |1h change| below this = no direction ('NEUTRAL')
    hourTickerStaleMs: 3 * 60 * 1000,
} as const;

export const volumeRearmLevel = (threshold: number): number =>
    threshold < VOLUME_RULES.lowThreshold ? threshold * VOLUME_RULES.rearmFactor : VOLUME_RULES.rearmRatio;

/** Last hour's quote volume divided by the average hour of the last 24h (NaN when not computable). */
export const hourVolumeRatio = (hourQuoteVolume: number, dayQuoteVolume: number): number =>
    hourQuoteVolume >= 0 && dayQuoteVolume > 0 ? hourQuoteVolume / (dayQuoteVolume / 24) : NaN;

export interface VolumeState {
    seededRatio: number | null;
    lastDataAt: number;
    /** true = the ratio crossed the threshold and has not fallen below the re-arm level since. */
    above: Record<string, boolean>;
}

export const createVolumeState = (): VolumeState => ({ seededRatio: null, lastDataAt: 0, above: {} });

export interface VolumeResult {
    signals: EngineSignal[];
    state: VolumeState;
    cooldowns: CooldownMap;
    stat: EngineStat; // universe = universe symbols with a fresh 1h ticker; matching = ratio >= threshold
}

/**
 * ratio = q_1h / (q_24h / 24). One signal when the ratio crosses UP through the threshold; the
 * condition re-arms once the ratio falls below 3 (below 60% of the threshold if that is under 3.6).
 * Side: sign of the 1h price change when |1h%| >= 1, otherwise NEUTRAL.
 */
export function evaluateVolume(
    tickers: readonly Ticker[],
    hourTickers: ReadonlyMap<string, HourTicker>,
    settings: SignalSettings['volume'],
    state: VolumeState,
    cooldowns: CooldownMap,
    now: number,
): VolumeResult {
    const threshold = settings.ratio;
    const rearm = volumeRearmLevel(threshold);
    const cooldownMs = settings.cooldownHours * HOUR_MS;
    const { universe, dataAt } = selectSpotUniverse(tickers);

    const gap = state.lastDataAt > 0 && dataAt > 0 && Math.abs(dataAt - state.lastDataAt) > MAX_DATA_GAP_MS;
    const reseed = state.seededRatio !== threshold || gap;
    const previous = reseed ? {} : state.above;

    const above: Record<string, boolean> = {};
    const signals: EngineSignal[] = [];
    let nextCooldowns = cooldowns;
    let matching = 0;
    let evaluated = 0;

    for (const t of universe) {
        const before = previous[t.symbol];
        const hour = hourTickers.get(t.symbol);
        const fresh = !!hour && now - hour.receivedAt <= VOLUME_RULES.hourTickerStaleMs && now >= hour.receivedAt - 1000;
        const ratio = fresh ? hourVolumeRatio(hour.quoteVolume, t.volume) : NaN;
        if (!Number.isFinite(ratio)) {
            // No usable 1h data for this pass: keep what we knew, decide nothing.
            if (before !== undefined) above[t.symbol] = before;
            continue;
        }
        evaluated++;
        if (ratio >= threshold) matching++;

        if (before === undefined) {
            above[t.symbol] = ratio >= threshold; // first sight only seeds the state
            continue;
        }
        if (before) {
            above[t.symbol] = !(ratio < rearm);
            continue;
        }
        if (!(ratio >= threshold)) {
            above[t.symbol] = false;
            continue;
        }

        // Crossed up through the threshold.
        above[t.symbol] = true;
        if (inCooldown(cooldowns, t.symbol, now, cooldownMs)) continue;
        if (nextCooldowns === cooldowns) nextCooldowns = { ...cooldowns };
        nextCooldowns[t.symbol] = now;

        const hourPct = (hour as HourTicker).priceChangePercent;
        const directional = Number.isFinite(hourPct) && Math.abs(hourPct) >= VOLUME_RULES.directionMinPct;
        const side: Side = !directional ? 'NEUTRAL' : hourPct > 0 ? 'BUY' : 'SELL';
        const ratioText = `${ratio.toFixed(1)}x`;
        const priceText = !Number.isFinite(hourPct)
            ? '1s fiyat değişimi bilinmiyor: yönsüz.'
            : directional
                ? `1s fiyat değişimi ${signedNumber(hourPct, 2)}%. Hareket yönü: ${hourPct > 0 ? 'yukarı' : 'aşağı'}.`
                : `1s fiyat değişimi ${signedNumber(hourPct, 2)}% (%${VOLUME_RULES.directionMinPct} altında): yönsüz.`;
        signals.push({
            engine: 'VOLUME',
            source: 'ALGO_VOLUME',
            strategy: volumeStrategyKey(ratio),
            symbol: t.symbol,
            side,
            price: t.lastPrice,
            // The note starts with the 'N.Nx' ratio: the Radar reads the first such token.
            note:
                `${ratioText} hacim: son 1 saatin hacmi ${formatUsdCompact((hour as HourTicker).quoteVolume)}, ` +
                `24s ortalama saat ${formatUsdCompact(t.volume / 24)} (eşik ${trimNumber(threshold)} kat). ${priceText}`,
            magnitude: { value: ratio, text: ratioText, caption: 'son 1 saat hacmi / 24s ortalama saat' },
            at: now,
        });
    }

    return {
        signals,
        state: { seededRatio: threshold, lastDataAt: dataAt > 0 ? dataAt : state.lastDataAt, above },
        cooldowns: nextCooldowns,
        stat: { matching, universe: evaluated },
    };
}

// ---------------------------------------------------------------------------
// Engine 3 — negative funding regime (built on utils/fundingSqueeze.ts)
// ---------------------------------------------------------------------------

const DEFAULT_FUNDING_INTERVAL_HOURS = 8;

/**
 * Futures tickers -> detector rows, restricted to the crypto perpetual universe.
 * `intervals` holds the funding interval (hours) of the contracts that differ from the 8h default
 * (Binance GET /fapi/v1/fundingInfo); it must be LOADED — with unknown intervals the 8h-equivalent
 * rate of most contracts would be off by a factor of two.
 */
export function buildFundingRows(
    futures: readonly FuturesTicker[],
    perpSymbols: ReadonlySet<string>,
    intervals: ReadonlyMap<string, number>,
): FundingInput[] {
    const rows: FundingInput[] = [];
    for (const f of futures) {
        if (!f || typeof f.symbol !== 'string' || !perpSymbols.has(f.symbol)) continue;
        if (!Number.isFinite(f.fundingRate) || !(f.nextFundingTime > 0)) continue;
        const interval = intervals.get(f.symbol);
        const last = typeof f.lastPrice === 'number' && f.lastPrice > 0 ? f.lastPrice : f.markPrice;
        rows.push({
            symbol: f.symbol,
            fundingRate: f.fundingRate,
            fundingIntervalHours: typeof interval === 'number' && interval > 0 ? interval : DEFAULT_FUNDING_INTERVAL_HOURS,
            nextFundingTime: f.nextFundingTime,
            markPrice: f.markPrice,
            indexPrice: f.indexPrice,
            price: last,
            changePct: typeof f.priceChangePercent === 'number' ? f.priceChangePercent : NaN,
            quoteVolume: typeof f.volume === 'number' ? f.volume : NaN,
        });
    }
    return rows;
}

/** A contract that is inside the negative funding gate right now ("active now" list). */
export interface FundingRegimeEntry {
    symbol: string;
    f8Pct: number;     // current 8h-equivalent funding, percent
    peakF8Pct: number; // most negative sustained level of the episode, percent
    since: number;     // first seen inside the gate (for episodes found at start-up: start-up time)
}

export interface FundingEngineState {
    seededThresholdPct: number | null;
    lastPassAt: number;
    detector: DetectorState;
}

export const createFundingEngineState = (): FundingEngineState => ({
    seededThresholdPct: null,
    lastPassAt: 0,
    detector: createDetectorState(),
});

export interface FundingResult {
    signals: EngineSignal[];
    state: FundingEngineState;
    cooldowns: CooldownMap;
    stat: EngineStat;        // matching = 8h-equivalent funding <= gate
    active: FundingRegimeEntry[];
    gateF8: number;          // effective negative gate, 8h-equivalent fraction
}

/**
 * Negative gate actually used by the detector: the more negative of the user's threshold and the
 * universe's 2nd percentile — and never looser than the detector's fixed −0.05% (fundingSqueeze.ts
 * clamps it, so a threshold between −0.05% and −0.03% behaves like −0.05%).
 */
export const effectiveFundingGate = (thresholdPct: number, universeP2: number): number =>
    Math.min(-FUNDING_THRESHOLDS.extremeF8, thresholdPct / 100, Number.isFinite(universeP2) ? universeP2 : 0);

const GATE_EPS = 1e-12;

const fundingPct = (fraction: number): string => `${signedNumber(fraction * 100, 4)}%`;

const fundingNote = (event: FundingEvent, row: FundingInput | undefined, gateF8: number, now: number): string => {
    const head = `Fonlama negatif uç bölgeye girdi: 8s eşdeğeri ${fundingPct(event.f8)} (eşik ${fundingPct(gateF8)}).`;
    const raw = `Ham oran ${fundingPct(event.rate)}, ${trimNumber(event.intervalHours)} saatlik aralık.`;
    const next = event.nextFundingTime > 0 ? ` Sonraki fonlamaya ${formatRemaining(event.nextFundingTime - now)}.` : '';
    const volume = row && Number.isFinite(row.quoteVolume) && row.quoteVolume < FUNDING_THRESHOLDS.lowLiquidityQuoteVolume
        ? ` 24s hacim ${formatUsdCompact(row.quoteVolume)} (düşük likidite).`
        : '';
    return `${head} ${raw}${next}${volume} Yönsüz kayıt.`;
};

/**
 * Emits a NEUTRAL 'Funding_Regime_Neg' signal only when a contract ENTERS the negative gate (detector
 * event 'EXTREME' on the negative side, not the ones found at start-up). A sign flip to slightly below
 * zero ('FLIP') is not a signal: most perps sit at +0.01%, so a mild market dip flips dozens of them at
 * once (−0.010 … −0.013%) without anything extreme happening. FLIPs still exist inside the detector
 * (the Terminal's Funding Flow panel shows them). Contracts that are already extreme at start-up are
 * only listed in `active`. A changed threshold or a pause of more than 5 minutes restarts the detector,
 * which makes the next pass a silent seeding pass.
 */
export function evaluateFunding(
    rows: FundingInput[],
    settings: SignalSettings['funding'],
    state: FundingEngineState,
    cooldowns: CooldownMap,
    now: number,
): FundingResult {
    const cooldownMs = settings.cooldownHours * HOUR_MS;
    const stats = computeUniverseStats(rows, now);
    const gateF8 = effectiveFundingGate(settings.thresholdPct, stats.count > 0 ? stats.p2 : 0);
    const detectorStats = { ...stats, negGate: gateF8 };

    const paused = state.lastPassAt > 0 && (now - state.lastPassAt > MAX_DATA_GAP_MS || now < state.lastPassAt);
    const reseed = state.seededThresholdPct !== settings.thresholdPct || paused;
    const detected = detectFundingEvents(rows, detectorStats, null, reseed ? createDetectorState() : state.detector, now);

    const rowBySymbol = new Map<string, FundingInput>();
    let matching = 0;
    for (const row of rows) {
        rowBySymbol.set(row.symbol, row);
        const f8 = fundingTo8h(row.fundingRate, row.fundingIntervalHours);
        if (Number.isFinite(f8) && f8 <= gateF8 + GATE_EPS) matching++;
    }

    // One signal per symbol and pass, for a live entry into the negative gate only (no FLIP signals).
    const chosen = new Map<string, FundingEvent>();
    for (const event of detected.events) {
        if (event.initial || event.side !== 'NEG' || event.type !== 'EXTREME') continue;
        if (!chosen.has(event.symbol)) chosen.set(event.symbol, event);
    }

    let nextCooldowns = cooldowns;
    const signals: EngineSignal[] = [];
    chosen.forEach((event) => {
        if (inCooldown(nextCooldowns, event.symbol, now, cooldownMs)) return;
        if (nextCooldowns === cooldowns) nextCooldowns = { ...cooldowns };
        nextCooldowns[event.symbol] = now;
        const row = rowBySymbol.get(event.symbol);
        signals.push({
            engine: 'FUNDING',
            // 'ALGO_DIVERGENCE' is the legacy source key of the funding engine; existing filters use it.
            source: 'ALGO_DIVERGENCE',
            strategy: STRATEGY_FUNDING_REGIME_NEG,
            symbol: event.symbol,
            side: 'NEUTRAL',
            price: event.price,
            note: fundingNote(event, row, gateF8, now),
            magnitude: { value: event.f8 * 100, text: fundingPct(event.f8), caption: '8s eşdeğeri fonlama' },
            at: now,
        });
    });

    const active: FundingRegimeEntry[] = [];
    for (const episode of detected.episodes) {
        if (episode.side !== 'NEG') continue;
        const row = rowBySymbol.get(episode.symbol);
        if (!row) continue;
        active.push({
            symbol: episode.symbol,
            f8Pct: fundingTo8h(row.fundingRate, row.fundingIntervalHours) * 100,
            peakF8Pct: episode.peakF8 * 100,
            since: episode.since,
        });
    }

    return {
        signals,
        state: { seededThresholdPct: settings.thresholdPct, lastPassAt: now, detector: detected.state },
        cooldowns: nextCooldowns,
        stat: { matching, universe: stats.count },
        active,
        gateF8,
    };
}

// ---------------------------------------------------------------------------
// Market-wide burst guard (momentum and volume)
// ---------------------------------------------------------------------------
//
// When the whole market moves at once, the momentum and volume rules fire for dozens of coins within
// minutes: one event reported 75 times. The guard keeps, per (engine, direction), a rolling 15-minute
// window of CANDIDATES (what the evaluator emitted). In normal mode they pass through unchanged. When a
// pass would push the window past the limit, that (engine, direction) switches to burst mode: ONE
// aggregate record (symbol MARKET) goes out instead, and further individual records of that
// (engine, direction) are held back (still counted) until the market calms down. The evaluators have
// already stamped the cooldowns of every candidate, so a held-back coin does not fire right after the
// burst either. State is in memory only: after a restart the evaluators' seeding prevents re-announcing.

export type BurstEngine = 'MOMENTUM' | 'VOLUME';

export const BURST_RULES = {
    windowMs: 15 * 60 * 1000,      // rolling window of candidates per (engine, direction)
    limits: { MOMENTUM: 6, VOLUME: 8 } as Readonly<Record<BurstEngine, number>>, // more than this in the window = burst
    universeShare: 0.04,           // … or at least 4% of the engine's current universe …
    minShareCount: 6,              // … and at least 6 coins
    exitQuietMs: 30 * 60 * 1000,   // the burst ends after 30 min …
    exitMaxPerWindow: 3,           // … with fewer than 3 candidates in every 15-minute window
    noteSymbols: 12,               // coins listed by name in the aggregate note
} as const;

interface BurstCoin {
    symbol: string;
    at: number;
    value: number; // magnitude.value of the candidate (24h % or volume ratio)
    text: string;  // magnitude.text ('−8.1%', '5.2x')
}

interface BurstGroup {
    window: BurstCoin[]; // one entry per coin with a candidate in the last 15 min, oldest first
    lastAt: number[];    // times of the last 2 candidates (any age), oldest first
    /**
     * End of the last "dense" period: the moment the 15-minute count last fell below 3 (0 = never
     * dense). The burst ends once this lies 30 minutes back.
     */
    denseUntil: number;
    burst: { since: number; coins: Record<string, BurstCoin> } | null;
}

export interface BurstGuardState {
    /** key: `${engine}:${UP | DOWN | NEUTRAL}`; a group without a window and without a burst is dropped. */
    groups: Record<string, BurstGroup>;
}

export const createBurstGuardState = (): BurstGuardState => ({ groups: {} });

export interface BurstGuardResult {
    /** To emit: the individual signals of groups in normal mode plus the aggregate start / end records. */
    signals: EngineSignal[];
    state: BurstGuardState;
    /** Candidates of this pass (including folded overflow) that went into an aggregate instead of out. */
    suppressed: number;
    /** The `overflow` signals that were folded into an aggregate: the caller stamps their cooldowns. */
    folded: EngineSignal[];
    /**
     * `overflow` signals of a direction that is NOT in burst mode, moved into the per-pass slots that
     * held-back candidates freed (e.g. one coin rising while the whole market falls): they are treated
     * like this pass's candidates (normally emitted). The caller stamps their cooldowns.
     */
    promoted: EngineSignal[];
}

export interface BurstGuardOptions {
    /** More than this many coins in the window = burst. Default: BURST_RULES.limits[engine]. */
    limit?: number;
    /**
     * Entries the evaluator found but did not emit because of its per-pass cap (momentum: 5). They only
     * count when they belong to a burst (this pass enters one or one is running): then they are folded
     * into the aggregate and returned in `folded`. When held-back candidates free some of the capped
     * slots, overflow entries of the other directions take them (`promoted`). Otherwise they are dropped
     * as before.
     */
    overflow?: readonly EngineSignal[];
}

const SIDE_OF_KIND: Record<MarketWideSide, Side> = { UP: 'BUY', DOWN: 'SELL', NEUTRAL: 'NEUTRAL' };

const baseOf = (symbol: string): string =>
    symbol.endsWith(SPOT_UNIVERSE.quote) && symbol.length > SPOT_UNIVERSE.quote.length
        ? symbol.slice(0, -SPOT_UNIVERSE.quote.length)
        : symbol;

/** 'BTC −8.1%, ETH −7.4%, …, +N diğer': the largest moves first, at most 12 names. */
const coinList = (coins: readonly BurstCoin[]): string => {
    const sorted = [...coins].sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.symbol.localeCompare(b.symbol));
    const named = sorted.slice(0, BURST_RULES.noteSymbols).map((c) => `${baseOf(c.symbol)} ${c.text}`);
    const rest = sorted.length - named.length;
    return `${named.join(', ')}${rest > 0 ? `, +${rest} diğer` : ''}`;
};

const durationText = (ms: number): string => (ms >= 60_000 ? formatRemaining(ms) : "1 dk'dan kısa");

const burstWhat = (engine: BurstEngine, side: MarketWideSide): string => {
    if (engine === 'MOMENTUM') {
        return side === 'UP'
            ? '24s değişim eşiğini aşıp yeni 24s zirveye çıktı'
            : side === 'DOWN'
                ? '24s değişim eşiğini aşıp yeni 24s dibe indi'
                : '24s momentum koşulunu sağladı';
    }
    return side === 'UP'
        ? 'hacim eşiğini aştı, son 1 saatlik fiyat yönü yukarı'
        : side === 'DOWN'
            ? 'hacim eşiğini aştı, son 1 saatlik fiyat yönü aşağı'
            : 'hacim eşiğini aştı, son 1 saatlik fiyat değişimi %1\'in altında (yönsüz)';
};

const RULE_WORD: Record<BurstEngine, string> = { MOMENTUM: 'momentum', VOLUME: 'hacim' };

const marketRecord = (
    engine: BurstEngine,
    side: MarketWideSide,
    end: boolean,
    count: number,
    caption: string,
    note: string,
    now: number,
): EngineSignal => ({
    engine,
    source: engine === 'MOMENTUM' ? 'ALGO_MOMENTUM' : 'ALGO_VOLUME',
    strategy: marketWideStrategyKey(engine, side, end),
    symbol: MARKET_SYMBOL,
    side: SIDE_OF_KIND[side],
    price: 0, // MARKET is not a pair: no price
    note,
    magnitude: { value: count, text: `${count} coin`, caption },
    at: now,
});

const startRecord = (engine: BurstEngine, side: MarketWideSide, coins: readonly BurstCoin[], now: number): EngineSignal =>
    marketRecord(
        engine,
        side,
        false,
        coins.length,
        'son 15 dk içinde koşulu sağlayan coin sayısı',
        `Piyasa geneli hareket: son 15 dk içinde ${coins.length} coin ${burstWhat(engine, side)}. ` +
            `Hareket durulana kadar bu yöndeki tekil ${RULE_WORD[engine]} kayıtları ayrı ayrı açılmaz, ` +
            `yalnızca sayılır. ${coinList(coins)}.`,
        now,
    );

const endRecord = (engine: BurstEngine, side: MarketWideSide, coins: readonly BurstCoin[], now: number): EngineSignal => {
    let first = Infinity;
    let last = -Infinity;
    for (const c of coins) {
        if (c.at < first) first = c.at;
        if (c.at > last) last = c.at;
    }
    const span = coins.length > 0 ? durationText(last - first) : durationText(0);
    return marketRecord(
        engine,
        side,
        true,
        coins.length,
        'piyasa geneli hareket boyunca koşulu sağlayan coin sayısı',
        `Piyasa geneli hareket bitti: toplam ${coins.length} coin ${burstWhat(engine, side)} ` +
            `(ilk kayıttan son kayda ${span}). 30 dk boyunca 15 dk'da 3'ten az yeni kayıt geldi; ` +
            `tekil ${RULE_WORD[engine]} kayıtları yeniden açılıyor. ${coinList(coins)}.`,
        now,
    );
};

const SIDE_KINDS: readonly MarketWideSide[] = ['UP', 'DOWN', 'NEUTRAL'];

const toBurstCoin = (signal: EngineSignal, now: number): BurstCoin => ({
    symbol: signal.symbol,
    at: now,
    value: signal.magnitude && Number.isFinite(signal.magnitude.value) ? signal.magnitude.value : 0,
    text: signal.magnitude && typeof signal.magnitude.text === 'string' ? signal.magnitude.text : '',
});

/**
 * Records `count` candidates seen at `now`. The 15-minute count is at least 3 from a candidate's time
 * until 15 minutes after the second candidate before it, if that one is less than 15 minutes older.
 */
const countCandidates = (lastAt: readonly number[], denseUntil: number, count: number, now: number): { lastAt: number[]; denseUntil: number } => {
    const times = [...lastAt];
    let until = denseUntil;
    for (let i = 0; i < count; i++) {
        const thirdLast = times.length >= BURST_RULES.exitMaxPerWindow - 1 ? times[times.length - (BURST_RULES.exitMaxPerWindow - 1)] : null;
        if (thirdLast !== null && now - thirdLast < BURST_RULES.windowMs) until = Math.max(until, thirdLast + BURST_RULES.windowMs);
        times.push(now);
        if (times.length > BURST_RULES.exitMaxPerWindow - 1) times.shift();
    }
    return { lastAt: times, denseUntil: until };
};

/** The window with `coins` added (one entry per symbol, the newest wins), oldest first. */
const addToWindow = (window: readonly BurstCoin[], coins: readonly BurstCoin[]): BurstCoin[] => {
    if (coins.length === 0) return [...window];
    const added = new Set(coins.map((c) => c.symbol));
    return [...window.filter((c) => !added.has(c.symbol)), ...coins];
};

/**
 * Market-wide burst guard for the signals of ONE momentum or volume pass (pure; `state` is not mutated).
 *
 * Per (engine, direction) — BUY = up, SELL = down, NEUTRAL — a rolling 15-minute window of candidates:
 *  - Normal mode: the candidates pass through.
 *  - Entry: when this pass's candidates make the window count exceed `limit` (default 6 momentum,
 *    8 volume) — or reach 4% of `universe` while being at least 6 — the group switches to burst mode.
 *    ONE aggregate record goes out instead of this pass's candidates: symbol 'MARKET', price 0, side =
 *    the direction, strategy 'Market_Wide_<Momentum|Volume>_<Up|Down|Neutral>', magnitude = coins in the
 *    window ('N coin'), note listing up to 12 coins with their values.
 *  - Burst mode: further candidates of that group are not emitted, only counted.
 *  - Exit: once the 15-minute count has stayed below 3 for 30 minutes (checked on every pass, before
 *    this pass's candidates are added), a closing '…_End' record with the total number of coins goes
 *    out and the group is back in normal mode. A slow trickle (e.g. one coin every 8 minutes) does not
 *    keep a burst alive.
 * Candidates of one pass carry the same time and count together: a pass that crosses the limit is
 * folded into the aggregate as a whole (no "5 single records + 1 aggregate" in the same instant).
 * Slots of the evaluator's per-pass cap that held-back candidates free go to `overflow` entries of the
 * directions in normal mode (`promoted`), so a genuine move against the market still gets through.
 * The guard must be called on every pass (also with no candidates), so that a burst can end.
 */
export function applyBurstGuard(
    engine: BurstEngine,
    candidates: readonly EngineSignal[],
    universe: number,
    state: BurstGuardState,
    now: number,
    options: BurstGuardOptions = {},
): BurstGuardResult {
    const overflow = options.overflow ?? [];
    const first = guardPass(engine, candidates, universe, state, now, options.limit, overflow);
    const freed = candidates.length - first.individual;
    if (freed > 0 && overflow.length > 0) {
        // Same pass again from the same state, with the promoted entries as candidates: the directions in
        // burst mode see the same input (same decision); a direction that only had overflow may now enter
        // a burst itself (then its promoted entries are folded like any candidate).
        const promoted = overflow.filter((signal) => !first.result.state.groups[`${engine}:${sideKind(signal.side)}`]?.burst).slice(0, freed);
        if (promoted.length > 0) {
            const rest = overflow.filter((signal) => !promoted.includes(signal));
            return { ...guardPass(engine, [...candidates, ...promoted], universe, state, now, options.limit, rest).result, promoted };
        }
    }
    return first.result;
}

function guardPass(
    engine: BurstEngine,
    candidates: readonly EngineSignal[],
    universe: number,
    state: BurstGuardState,
    now: number,
    limitOption: number | undefined,
    overflow: readonly EngineSignal[],
): { result: BurstGuardResult; individual: number } {
    const limit = typeof limitOption === 'number' && Number.isFinite(limitOption) ? limitOption : BURST_RULES.limits[engine];
    const groups: Record<string, BurstGroup> = { ...(state && state.groups ? state.groups : {}) };
    const batches: Record<MarketWideSide, EngineSignal[]> = { UP: [], DOWN: [], NEUTRAL: [] };
    const extras: Record<MarketWideSide, EngineSignal[]> = { UP: [], DOWN: [], NEUTRAL: [] };
    for (const signal of candidates) batches[sideKind(signal.side)].push(signal);
    for (const signal of overflow) extras[sideKind(signal.side)].push(signal);

    const ends: EngineSignal[] = [];
    const starts: EngineSignal[] = [];
    const folded: EngineSignal[] = [];
    const passing = new Set<MarketWideSide>();
    let suppressed = 0;

    for (const side of SIDE_KINDS) {
        const key = `${engine}:${side}`;
        const prev = groups[key];
        const batch = batches[side];
        const extra = extras[side];
        if (!prev && batch.length === 0) continue;

        // A clock that jumped back must not stretch a burst: nothing later than `now` is kept (the dense
        // period ends at most 15 min from now). With a steady clock these bounds never apply.
        let window = (prev?.window ?? []).filter((c) => c.at <= now && now - c.at < BURST_RULES.windowMs);
        let lastAt = (prev?.lastAt ?? []).filter((at) => at <= now);
        let denseUntil = prev && Number.isFinite(prev.denseUntil) ? Math.min(prev.denseUntil, now + BURST_RULES.windowMs) : 0;
        let burst = prev?.burst ? { since: Math.min(prev.burst.since, now), coins: { ...prev.burst.coins } } : null;

        // Exit first: it is decided on the candidates seen before this pass.
        if (burst) {
            const quietSince = Math.max(denseUntil, burst.since);
            if (now - quietSince >= BURST_RULES.exitQuietMs) {
                ends.push(endRecord(engine, side, Object.values(burst.coins), now));
                burst = null;
            }
        }

        // Overflow alone never starts a burst, but it is folded into a running one (and it can be promoted
        // into freed slots, see applyBurstGuard).
        if (batch.length > 0 || (burst && extra.length > 0)) {
            const all = [...batch, ...extra];
            const allCoins = all.map((signal) => toBurstCoin(signal, now));
            const widened = addToWindow(window, allCoins);
            const count = widened.length;
            const share = universe > 0 && count >= BURST_RULES.minShareCount && count >= BURST_RULES.universeShare * universe;
            if (burst || count > limit || share) {
                // Running burst, or this pass starts one: everything of this pass is folded in.
                window = widened;
                ({ lastAt, denseUntil } = countCandidates(lastAt, denseUntil, all.length, now));
                if (burst) {
                    for (const coin of allCoins) burst.coins[coin.symbol] = coin;
                } else {
                    const coins: Record<string, BurstCoin> = {};
                    for (const coin of widened) coins[coin.symbol] = coin;
                    burst = { since: now, coins };
                    starts.push(startRecord(engine, side, widened, now));
                }
                suppressed += all.length;
                folded.push(...extra);
            } else {
                // Normal mode: the emitted candidates count; the overflow is dropped as before.
                window = addToWindow(window, batch.map((signal) => toBurstCoin(signal, now)));
                ({ lastAt, denseUntil } = countCandidates(lastAt, denseUntil, batch.length, now));
                passing.add(side);
            }
        }

        if (!burst && window.length === 0) delete groups[key];
        else groups[key] = { window, lastAt, denseUntil, burst };
    }

    const individual = candidates.filter((signal) => passing.has(sideKind(signal.side)));
    return {
        result: { signals: [...ends, ...individual, ...starts], state: { groups }, suppressed, folded, promoted: [] },
        individual: individual.length,
    };
}

// ---------------------------------------------------------------------------
// Big moves — entry rules for "new 24h high / low" and "pullback / rally"
// ---------------------------------------------------------------------------

export const EXTREME_RULES = {
    atExtreme: 0.0001,      // price within 0.01% of the 24h high / low counts as "at the extreme"
    awayFraction: 1 / 3,    // … and only after it had moved away by a third of the 24h range
    minRangePct: 0.3,       // tighter 24h ranges are pegged assets: no records
    dayMovePct: 6,          // pullback / rally need a 24h move of at least this much from the open
    retracePct: 4,          // … and this much retrace from the high / bounce from the low
} as const;

export type ExtremeEvent = Extract<BigMoveSignal['type'], 'HIGH' | 'LOW' | 'PULLBACK' | 'RALLY'>;

export interface ExtremeTrack {
    highArmed: boolean;     // price has been away from the 24h high since the last "new high" record
    lowArmed: boolean;
    pullbackArmed: boolean; // no pullback record since the last 24h high
    rallyArmed: boolean;    // no rally record since the last 24h low
}

export interface ExtremeInput {
    price: number;
    high: number;
    low: number;
    open?: number;
}

export interface ExtremeStep {
    track: ExtremeTrack | undefined; // undefined while the 24h stats are missing
    events: ExtremeEvent[];
    pullbackPct: number;             // retrace from the 24h high, percent
    rallyPct: number;                // bounce from the 24h low, percent
}

/**
 * One observation of a symbol. Records are created only on ENTRY into a state:
 *  - 'HIGH' / 'LOW': the price is at the 24h extreme after it had first moved away from it by at
 *    least a third of the 24h range.
 *  - 'PULLBACK' / 'RALLY': once per 24h extreme; re-armed only by a new 24h high / low.
 * The first observation (`prev` undefined) only seeds the track and never returns events.
 * Pass `withRetrace: false` to track highs / lows only.
 */
export function stepExtremeTrack(prev: ExtremeTrack | undefined, input: ExtremeInput, withRetrace = true): ExtremeStep {
    const { price, high, low } = input;
    const none: ExtremeStep = { track: prev, events: [], pullbackPct: 0, rallyPct: 0 };
    if (!(price > 0) || !(low > 0) || !(high >= low)) return none;
    const range = high - low;
    if (!((range / low) * 100 >= EXTREME_RULES.minRangePct)) return none;

    const atHigh = price >= high * (1 - EXTREME_RULES.atExtreme);
    const atLow = price <= low * (1 + EXTREME_RULES.atExtreme);
    const awayFromHigh = !atHigh && price <= high - range * EXTREME_RULES.awayFraction;
    const awayFromLow = !atLow && price >= low + range * EXTREME_RULES.awayFraction;

    const open = typeof input.open === 'number' && input.open > 0 ? input.open : 0;
    const pullbackPct = ((high - price) / high) * 100;
    const rallyPct = ((price - low) / low) * 100;
    const inPullback = withRetrace && open > 0
        && ((high - open) / open) * 100 >= EXTREME_RULES.dayMovePct && pullbackPct >= EXTREME_RULES.retracePct;
    const inRally = withRetrace && open > 0
        && ((open - low) / open) * 100 >= EXTREME_RULES.dayMovePct && rallyPct >= EXTREME_RULES.retracePct;

    if (!prev) {
        return {
            track: { highArmed: awayFromHigh, lowArmed: awayFromLow, pullbackArmed: !inPullback, rallyArmed: !inRally },
            events: [],
            pullbackPct,
            rallyPct,
        };
    }

    const track: ExtremeTrack = { ...prev };
    const events: ExtremeEvent[] = [];
    if (awayFromHigh) track.highArmed = true;
    if (awayFromLow) track.lowArmed = true;
    if (atHigh) {
        if (track.highArmed) events.push('HIGH');
        track.highArmed = false;
        track.pullbackArmed = true;
    }
    if (atLow) {
        if (track.lowArmed) events.push('LOW');
        track.lowArmed = false;
        track.rallyArmed = true;
    }
    if (inPullback && track.pullbackArmed) {
        events.push('PULLBACK');
        track.pullbackArmed = false;
    }
    if (inRally && track.rallyArmed) {
        events.push('RALLY');
        track.rallyArmed = false;
    }
    return { track, events, pullbackPct, rallyPct };
}
