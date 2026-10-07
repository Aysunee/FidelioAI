// ===== SIGNAL OUTCOMES (forward tracking + per-strategy scorecard) =====
// Every stored signal (except the market-wide 'MARKET' aggregates) gets a row in `signal_outcomes`. The engine
// leader measures, from Binance klines, what the price did 15 min / 1 h / 4 h / 24 h after the signal and stores
// it per horizon; GET /api/scorecard summarises it per strategy family. Descriptive only: net of a round-trip
// cost, benchmarked against BTC over the same window, clustering-aware (nEff = distinct hour buckets), no verdict
// before enough independent samples, and no direction verdict for NEUTRAL signals.
//
// This file has no Express / socket.io inside. server/index.cjs creates one tracker per process with
// createOutcomeTracker({ db, fetch, now, isLeader, hasTimeMs, emit, log }). Everything below the tracker is pure
// and exported for tests.

const MIN_MS = 60 * 1000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;

// Horizons: column in signal_outcomes, key in the API outcome ('h15' ...), label in the scorecard ('15m' ...).
const HORIZONS = Object.freeze([
    { minutes: 15, column: 'o15', field: 'h15', label: '15m', interval: '1m', intervalMs: MIN_MS },
    { minutes: 60, column: 'o60', field: 'h60', label: '1h', interval: '1m', intervalMs: MIN_MS },
    { minutes: 240, column: 'o240', field: 'h240', label: '4h', interval: '1m', intervalMs: MIN_MS },
    { minutes: 1440, column: 'o1440', field: 'h1440', label: '24h', interval: '5m', intervalMs: 5 * MIN_MS }
].map(h => Object.freeze({ ...h, ms: h.minutes * MIN_MS })));
const HORIZON_LABELS = HORIZONS.map(h => h.label);

// Round-trip cost assumption (fraction of price): spot taker in + out, perp taker in + out.
const COSTS = Object.freeze({ spot: 0.002, perp: 0.001 });

const MARKET_SYMBOL = 'MARKET';
const BTC_SYMBOL = 'BTCUSDT';
const SPOT_KLINES_URL = 'https://api.binance.com/api/v3/klines';
const PERP_KLINES_URL = 'https://fapi.binance.com/fapi/v1/klines';
const SPOT_INFO_URL = 'https://api.binance.com/api/v3/exchangeInfo?showPermissionSets=false&symbolStatus=TRADING';
const PERP_INFO_URL = 'https://fapi.binance.com/fapi/v1/exchangeInfo';

const RESOLVE_INTERVAL_MS = 60 * 1000;     // resolver tick (leader only)
const FIRST_TICK_DELAY_MS = 5 * 1000;      // first tick (with the backfill) after becoming leader
const ROWS_PER_TICK = 20;
const DUE_GRACE_MS = 30 * 1000;            // a horizon is measured 30 s after it ends (last candle closed)
const MAX_ATTEMPTS = 6;                    // failed fetches per row before the due horizons are marked { error }
const REQUEST_BUDGET = 40;                 // Binance requests per rolling minute (klines + exchangeInfo), per process
const REQUEST_WINDOW_MS = 60 * 1000;
const RATE_PAUSE_MS = 2 * 60 * 1000;       // after HTTP 429 / 418 without Retry-After
const FETCH_TIMEOUT_MS = 10 * 1000;
const SYMBOLS_TTL_MS = HOUR_MS;            // exchangeInfo symbol sets
const SYMBOLS_RETRY_MS = 5 * MIN_MS;
const BTC_CACHE_MAX = 300;
const BTC_CACHE_TTL_MS = 15 * MIN_MS;
const BACKFILL_DAYS = 7;
const BACKFILL_MAX_ROWS = 5000;
const SCORECARD_CACHE_MS = 60 * 1000;
const SCORECARD_DAYS = Object.freeze([7, 30]);
const SCORECARD_MAX_ROWS = 50000;
// A stored price this far from the market at t0 (factor) is a typo / test input, not a signal: never measured.
const P0_MAX_RATIO = 1.5;
const MIN_NEFF_EARLY = 30;
const MIN_NEFF_VERDICT = 100;
const T_EDGE = 2;
// Below this the spread of net results is rounding noise (identical results): no t statistic.
const SD_EPSILON = 1e-12;
const Z95 = 1.959963984540054;
const WARN_INTERVAL_MS = 5 * MIN_MS;

const OUTCOME_COLUMNS = 'signal_id, symbol, market, side, strategy, engine, source, t0, p0, o15, o60, o240, o1440, next_due, status, attempts, note';

const CREATE_TABLE_SQL = 'CREATE TABLE IF NOT EXISTS signal_outcomes ('
    + 'signal_id VARCHAR(50) PRIMARY KEY, symbol VARCHAR(32) NOT NULL, market VARCHAR(8) NOT NULL, side VARCHAR(10) NOT NULL, '
    + 'strategy VARCHAR(100), engine VARCHAR(16) NULL, source VARCHAR(50) NULL, t0 BIGINT NOT NULL, p0 DOUBLE NOT NULL, '
    + 'o15 TEXT NULL, o60 TEXT NULL, o240 TEXT NULL, o1440 TEXT NULL, next_due BIGINT NULL, '
    + "status VARCHAR(10) NOT NULL DEFAULT 'pending', attempts INT NOT NULL DEFAULT 0, note VARCHAR(255) NULL, "
    + 'INDEX idx_outcomes_next_due (next_due), INDEX idx_outcomes_t0 (t0)'
    + ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
const PROBE_TABLE_SQL = 'SELECT signal_id FROM signal_outcomes LIMIT 1';

const ENGINE_BY_SOURCE = Object.freeze({ ALGO_MOMENTUM: 'MOMENTUM', ALGO_VOLUME: 'VOLUME', ALGO_DIVERGENCE: 'FUNDING' });
const ENGINE_KINDS = ['MOMENTUM', 'VOLUME', 'FUNDING'];

// ---------------------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------------------

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/** +1 for BUY / LONG, -1 for SELL / SHORT, 0 for anything else (NEUTRAL). */
const sideDirection = (side) => {
    const s = String(side || '').toUpperCase();
    if (s === 'BUY' || s === 'LONG') return 1;
    if (s === 'SELL' || s === 'SHORT') return -1;
    return 0;
};

const clip = (text, max) => {
    const s = String(text);
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
};

/**
 * The outcome row a freshly stored signal gets, before the Binance symbol check. null = no row at all
 * (symbol 'MARKET': a market-wide aggregate, not a tradable pair). market: perp for Funding_* strategies or a
 * TradingView perp symbol ('BTCUSDT.P', an exchange prefix such as 'BINANCE:' is dropped), else spot.
 */
const buildRegistration = (signal) => {
    if (!signal || typeof signal !== 'object') return null;
    const rawSymbol = String(signal.symbol == null ? '' : signal.symbol).trim().toUpperCase();
    if (!rawSymbol || rawSymbol === MARKET_SYMBOL) return null;
    const strategy = String(signal.strategy == null ? '' : signal.strategy).slice(0, 100);
    let symbol = rawSymbol;
    const colon = symbol.lastIndexOf(':');
    if (colon >= 0) symbol = symbol.slice(colon + 1);
    let perp = strategy.startsWith('Funding_');
    if (symbol.endsWith('.P')) {
        perp = true;
        symbol = symbol.slice(0, -2);
    }
    symbol = symbol.replace(/[^A-Z0-9]/g, '').slice(0, 32);
    const source = signal.source == null || signal.source === '' ? null : String(signal.source).slice(0, 50);
    const engine = ENGINE_KINDS.includes(signal.engine) ? signal.engine : (source && ENGINE_BY_SOURCE[source]) || null;
    const timeMs = Number(signal.timeMs);
    const t0 = Number.isFinite(timeMs) && timeMs > 0 ? timeMs : Date.parse(signal.time);
    const p0 = Number(signal.price);
    const draft = {
        signalId: String(signal.id),
        symbol: symbol || rawSymbol.slice(0, 32),
        market: perp ? 'perp' : 'spot',
        side: String(signal.side == null ? '' : signal.side).toUpperCase().slice(0, 10) || 'NEUTRAL',
        strategy,
        engine,
        source,
        t0: Number.isFinite(t0) && t0 > 0 ? t0 : 0,
        p0: Number.isFinite(p0) && p0 > 0 ? p0 : 0,
        status: 'pending',
        note: null
    };
    if (!symbol) {
        draft.status = 'skipped';
        draft.note = 'Sembol okunamadı';
    } else if (!(draft.t0 > 0)) {
        draft.status = 'skipped';
        draft.note = 'Sinyal zamanı okunamadı';
    } else if (!(p0 > 0)) {
        draft.status = 'skipped';
        draft.note = 'Sinyal fiyatı yok (0 veya geçersiz)';
    }
    return draft;
};

/** Market the symbol is listed on: the preferred one, else the other one, else null. */
const resolveMarket = (symbol, preferred, sets) => {
    const other = preferred === 'perp' ? 'spot' : 'perp';
    if (sets[preferred] && sets[preferred].has(symbol)) return preferred;
    if (sets[other] && sets[other].has(symbol)) return other;
    return null;
};

/**
 * Kline request covering [t0, t0 + minutes] plus the candle before the one containing t0 (the reference
 * close at t0): startTime = start of that previous candle, limit = minutes / interval + 2.
 */
const klineWindow = (t0, minutes, intervalMs) => ({
    startTime: Math.floor(t0 / intervalMs) * intervalMs - intervalMs,
    endTime: t0 + minutes * MIN_MS,
    limit: Math.round((minutes * MIN_MS) / intervalMs) + 2
});

const parseKlines = (raw) => (Array.isArray(raw) ? raw : [])
    .map(k => (Array.isArray(k) ? {
        openTime: Number(k[0]),
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        closeTime: Number(k[6])
    } : null))
    .filter(k => k && [k.openTime, k.high, k.low, k.close, k.closeTime].every(Number.isFinite) && k.close > 0 && k.high > 0 && k.low > 0)
    .sort((a, b) => a.openTime - b.openTime);

/** The last candle whose closeTime <= t (candles sorted by openTime), or null. */
const lastClosedBy = (candles, t) => {
    let found = null;
    for (const c of candles) {
        if (c.closeTime <= t) found = c;
        else break;
    }
    return found;
};

/**
 * One horizon from klines (pure):
 *  close_h = close of the last candle with closeTime <= t0 + h (it must be the window's final candle, else gap)
 *  path    = candles with openTime >= t0 - interval and closeTime <= t0 + h
 *  raw = close_h / p0 - 1; ret = dir * raw; net = ret - cost; btc = BTC close_h / close_t0 - 1 (close_t0 = close
 *  of the last BTC candle with closeTime <= t0); excess = dir * (raw - btc); mfe / mae = best / worst dir-signed
 *  excursion of the path's high / low against p0. NEUTRAL: ret / net / excess null, mfe = max(high) / p0 - 1,
 *  mae = min(low) / p0 - 1.
 * Returns { value } or { gap: reason } (symbol data missing: the horizon is skipped) or { btcGap: reason }
 * (benchmark missing: retried).
 */
const computeHorizon = ({ t0, p0, side, market, minutes, intervalMs, candles, btcCandles, now }) => {
    const end = t0 + minutes * MIN_MS;
    const last = lastClosedBy(candles, end);
    if (!last || last.closeTime < end - intervalMs) return { gap: 'Veri boşluğu: pencerenin son mumu yok' };
    const path = candles.filter(c => c.openTime >= t0 - intervalMs && c.closeTime <= end);
    if (path.length === 0) return { gap: 'Veri boşluğu: pencerede mum yok' };
    const btcEnd = lastClosedBy(btcCandles, end);
    const btcStart = lastClosedBy(btcCandles, t0);
    if (!btcEnd || !btcStart || btcEnd.closeTime < end - intervalMs || btcStart.closeTime < t0 - intervalMs) {
        return { btcGap: 'BTC karşılaştırma verisi eksik' };
    }
    let high = -Infinity;
    let low = Infinity;
    for (const c of path) {
        if (c.high > high) high = c.high;
        if (c.low < low) low = c.low;
    }
    const raw = last.close / p0 - 1;
    const btc = btcEnd.close / btcStart.close - 1;
    const dir = sideDirection(side);
    const up = high / p0 - 1;
    const down = low / p0 - 1;
    const base = { closeAt: last.closeTime, resolvedAt: now };
    if (dir === 0) {
        return { value: { raw, ret: null, net: null, excess: null, mfe: up, mae: down, btc, ...base } };
    }
    const ret = dir * raw;
    const cost = COSTS[market === 'perp' ? 'perp' : 'spot'];
    return {
        value: {
            raw,
            ret,
            net: ret - cost,
            excess: dir * (raw - btc),
            mfe: dir > 0 ? up : -down,
            mae: dir > 0 ? down : -up,
            btc,
            ...base
        }
    };
};

const parseHorizon = (raw) => {
    if (raw === null || raw === undefined || raw === '') return null;
    if (typeof raw === 'object') return raw;
    try {
        const v = JSON.parse(String(raw));
        return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    } catch {
        return null;
    }
};

const statusOf = (results) => {
    const resolved = HORIZONS.filter(h => results[h.column]).length;
    if (resolved === HORIZONS.length) return 'done';
    return resolved === 0 ? 'pending' : 'partial';
};

/** When the next unresolved horizon becomes measurable (null when all are resolved). */
const nextDueOf = (t0, results) => {
    for (const h of HORIZONS) {
        if (!results[h.column]) return t0 + h.ms + DUE_GRACE_MS;
    }
    return null;
};

/** Retry delay after the n-th consecutive failure: 2, 4, 8, 16, 32 min (capped at 60). */
const backoffMs = (attempts) => Math.min(60, 2 ** Math.max(1, attempts)) * MIN_MS;

/** The API shape of an outcome row: { status, h15, h60, h240, h1440 } (+ note when set). */
const outcomeDto = (row) => {
    const dto = { status: String(row.status || 'pending') };
    for (const h of HORIZONS) dto[h.field] = parseHorizon(row[h.column]);
    if (row.note !== null && row.note !== undefined && row.note !== '') dto.note = String(row.note);
    return dto;
};

// ---- statistics ----
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

const median = (xs) => {
    if (!xs.length) return null;
    const s = xs.slice().sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Sample standard deviation (n - 1); null below 2 values. */
const sampleSd = (xs) => {
    if (xs.length < 2) return null;
    const m = mean(xs);
    return Math.sqrt(xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1));
};

/** Number of distinct UTC hour buckets: signals of one burst (same hour) count once. */
const effectiveCount = (times) => new Set(times.filter(Number.isFinite).map(t => Math.floor(t / HOUR_MS))).size;

/** Wilson 95% interval of the proportion `rate`, with the effective sample size nEff. */
const wilsonInterval = (rate, nEff) => {
    if (!Number.isFinite(rate) || !(nEff > 0)) return null;
    const z2 = Z95 * Z95;
    const denom = 1 + z2 / nEff;
    const center = (rate + z2 / (2 * nEff)) / denom;
    const half = (Z95 * Math.sqrt((rate * (1 - rate)) / nEff + z2 / (4 * nEff * nEff))) / denom;
    return [Math.max(0, center - half), Math.min(1, center + half)];
};

const VERDICT_TEXT = Object.freeze({
    EARLY: 'Ön sonuç — karar için az veri',
    EDGE: 'Maliyet sonrası pozitif',
    REVERSE: 'Ters yönde tutarlı',
    NO_EDGE: 'Kenar görünmüyor',
    NEUTRAL: 'Yönsüz — yalnızca hareket büyüklüğü'
});

const verdictFor = ({ neutral, nEff, tStat, meanExcess }) => {
    if (neutral) return { verdict: 'NEUTRAL', verdictText: VERDICT_TEXT.NEUTRAL };
    if (nEff < MIN_NEFF_EARLY) return { verdict: 'COLLECTING', verdictText: `Veri toplanıyor (${nEff}/${MIN_NEFF_EARLY})` };
    if (nEff < MIN_NEFF_VERDICT) return { verdict: 'EARLY', verdictText: VERDICT_TEXT.EARLY };
    if (Number.isFinite(tStat) && tStat >= T_EDGE && Number.isFinite(meanExcess) && meanExcess > 0) return { verdict: 'EDGE', verdictText: VERDICT_TEXT.EDGE };
    if (Number.isFinite(tStat) && tStat <= -T_EDGE) return { verdict: 'REVERSE', verdictText: VERDICT_TEXT.REVERSE };
    return { verdict: 'NO_EDGE', verdictText: VERDICT_TEXT.NO_EDGE };
};

/**
 * Stats of one family x horizon. samples: [{ t0, raw, net, excess, mfe, mae }] (measured horizons only).
 * Point estimates use every sample; the uncertainty (Wilson interval, t statistic) uses nEff = distinct hour
 * buckets, because signals of one market burst are not independent. hit = net > 0 (after costs).
 * tStat = meanNet / (sd / sqrt(nEff)), sd = sample sd of net over all samples.
 */
const computeStats = (samples, { neutral = false } = {}) => {
    const list = neutral
        ? samples.filter(s => isFiniteNumber(s.raw))
        : samples.filter(s => isFiniteNumber(s.raw) && isFiniteNumber(s.net));
    const n = list.length;
    const nEff = effectiveCount(list.map(s => s.t0));
    const raws = list.map(s => s.raw);
    const shared = {
        medianRaw: median(raws),
        medianAbsRaw: median(raws.map(Math.abs)),
        medianMfe: median(list.map(s => s.mfe).filter(isFiniteNumber)),
        medianMae: median(list.map(s => s.mae).filter(isFiniteNumber))
    };
    if (neutral) {
        return {
            n, nEff, hitRate: null, hitCi: null, meanNet: null, medianNet: null, meanExcess: null,
            ...shared, tStat: null, ...verdictFor({ neutral: true })
        };
    }
    const nets = list.map(s => s.net);
    const hitRate = n ? nets.filter(x => x > 0).length / n : null;
    const meanNet = mean(nets);
    const sd = sampleSd(nets);
    const tStat = sd !== null && sd > SD_EPSILON && nEff > 0 ? meanNet / (sd / Math.sqrt(nEff)) : null;
    const excesses = list.map(s => s.excess).filter(isFiniteNumber);
    const meanExcess = mean(excesses);
    return {
        n,
        nEff,
        hitRate,
        hitCi: hitRate === null ? null : wilsonInterval(hitRate, nEff),
        meanNet,
        medianNet: median(nets),
        meanExcess,
        ...shared,
        tStat,
        ...verdictFor({ neutral: false, nEff, tStat, meanExcess })
    };
};

// ---- scorecard families ----
const FIXED_FAMILIES = Object.freeze([
    { key: 'Momentum_24h_Up', label: '24s Momentum (yükseliş)', engine: 'MOMENTUM', side: 'BUY', family: 'Momentum_24h_Up', neutral: false },
    { key: 'Momentum_24h_Down', label: '24s Momentum (düşüş)', engine: 'MOMENTUM', side: 'SELL', family: 'Momentum_24h_Down', neutral: false },
    { key: 'Volume_Spike:BUY', label: 'Hacim Sıçraması (yükseliş)', engine: 'VOLUME', side: 'BUY', family: 'Volume_Spike', neutral: false },
    { key: 'Volume_Spike:SELL', label: 'Hacim Sıçraması (düşüş)', engine: 'VOLUME', side: 'SELL', family: 'Volume_Spike', neutral: false },
    { key: 'Volume_Spike:NEUTRAL', label: 'Hacim Sıçraması (yönsüz)', engine: 'VOLUME', side: 'NEUTRAL', family: 'Volume_Spike', neutral: true },
    { key: 'Funding_Regime_Neg', label: 'Negatif Fonlama Rejimi', engine: 'FUNDING', side: 'NEUTRAL', family: 'Funding_Regime_Neg', neutral: true }
].map(f => Object.freeze(f)));

const sideKind = (side) => {
    const d = sideDirection(side);
    return d > 0 ? 'BUY' : d < 0 ? 'SELL' : 'NEUTRAL';
};

/**
 * Family of an outcome row: engine signals (source ALGO_*) by strategy (Volume_Spike split by side); webhook
 * rows 'TV · <strategy>', manual rows 'Manuel · <strategy>'. Returns { key, label, engine, family, fixed }.
 */
const familyOf = (row) => {
    const strategy = String(row.strategy || '');
    const source = String(row.source || '');
    if (source.startsWith('ALGO_') || ENGINE_KINDS.includes(row.engine)) {
        const engine = ENGINE_KINDS.includes(row.engine) ? row.engine : ENGINE_BY_SOURCE[source] || null;
        if (strategy === 'Momentum_24h_Up' || strategy === 'Momentum_24h_Down' || strategy === 'Funding_Regime_Neg') {
            return { key: strategy, fixed: true };
        }
        if (strategy.startsWith('Volume_Spike')) return { key: `Volume_Spike:${sideKind(row.side)}`, fixed: true };
        return { key: `ENGINE:${strategy}`, label: strategy || 'Motor', engine, family: 'OTHER', fixed: false };
    }
    if (source === 'WEBHOOK') return { key: `TV:${strategy}`, label: `TV · ${strategy || 'External_Webhook'}`, engine: null, family: 'WEBHOOK', fixed: false };
    return { key: `MANUAL:${strategy}`, label: `Manuel · ${strategy || 'Manual_Injection'}`, engine: null, family: 'MANUAL', fixed: false };
};

const DYNAMIC_ORDER = { WEBHOOK: 0, MANUAL: 1, OTHER: 2 };

/**
 * Scorecard from outcome rows (pure). rows: signal_outcomes rows of the period. Skipped rows are left out;
 * pending = rows of the period that still wait for at least one horizon.
 */
const buildScorecard = (rows, { days, now }) => {
    const groups = new Map();
    for (const f of FIXED_FAMILIES) groups.set(f.key, { def: f, rows: [] });
    let pending = 0;
    for (const row of Array.isArray(rows) ? rows : []) {
        if (!row) continue;
        const status = String(row.status || '');
        if (status === 'skipped') continue;
        if (status === 'pending' || status === 'partial') pending++;
        const fam = familyOf(row);
        if (!groups.has(fam.key)) {
            groups.set(fam.key, { def: { key: fam.key, label: fam.label, engine: fam.engine, side: null, family: fam.family, neutral: false }, rows: [] });
        }
        groups.get(fam.key).rows.push(row);
    }
    const out = [];
    for (const { def, rows: list } of groups.values()) {
        let side = def.side;
        let neutral = def.neutral;
        if (side === null) {
            const kinds = new Set(list.map(r => sideKind(r.side)));
            side = kinds.size === 1 ? [...kinds][0] : 'MIXED';
            neutral = kinds.size === 1 && kinds.has('NEUTRAL');
        }
        const parsed = list.map(r => ({ t0: Number(r.t0), h: Object.fromEntries(HORIZONS.map(h => [h.label, parseHorizon(r[h.column])])) }));
        const byHorizon = {};
        for (const h of HORIZONS) {
            const samples = [];
            for (const p of parsed) {
                const v = p.h[h.label];
                if (!v || v.error !== undefined) continue;
                samples.push({ t0: p.t0, raw: v.raw, net: v.net, excess: v.excess, mfe: v.mfe, mae: v.mae });
            }
            byHorizon[h.label] = computeStats(samples, { neutral });
        }
        out.push({ key: def.key, label: def.label, engine: def.engine, side, family: def.family, total: list.length, byHorizon, _fixed: FIXED_FAMILIES.includes(def) });
    }
    const fixedOrder = new Map(FIXED_FAMILIES.map((f, i) => [f.key, i]));
    out.sort((a, b) => {
        if (a._fixed || b._fixed) {
            if (a._fixed && b._fixed) return fixedOrder.get(a.key) - fixedOrder.get(b.key);
            return a._fixed ? -1 : 1;
        }
        const fa = DYNAMIC_ORDER[a.family] ?? 9;
        const fb = DYNAMIC_ORDER[b.family] ?? 9;
        if (fa !== fb) return fa - fb;
        if (a.total !== b.total) return b.total - a.total;
        return a.label.localeCompare(b.label, 'tr');
    });
    for (const r of out) delete r._fixed;
    return {
        generatedAt: now,
        days,
        costs: { spot: COSTS.spot, perp: COSTS.perp },
        horizons: HORIZON_LABELS.slice(),
        pending,
        rows: out
    };
};

// ---------------------------------------------------------------------------------------------------------
// Request budget (rolling window)
// ---------------------------------------------------------------------------------------------------------
const createBudget = (limit = REQUEST_BUDGET, windowMs = REQUEST_WINDOW_MS) => {
    const budget = {
        limit,
        windowMs,
        stamps: [],
        used(now) {
            while (budget.stamps.length && now - budget.stamps[0] >= windowMs) budget.stamps.shift();
            return budget.stamps.length;
        },
        take(now) {
            if (budget.used(now) >= limit) return false;
            budget.stamps.push(now);
            return true;
        }
    };
    return budget;
};

class OutcomeError extends Error {
    constructor(kind, message) {
        super(message);
        this.kind = kind; // 'budget' | 'rate' | 'symbol' | 'network' | 'http' | 'data'
    }
}

// ---------------------------------------------------------------------------------------------------------
// Tracker (one per process)
// ---------------------------------------------------------------------------------------------------------
/**
 * deps:
 *  db         mysql2 pool (query)
 *  fetch      fetch implementation (resolved at call time by the caller, so tests can stub it)
 *  now        clock (ms)
 *  isLeader   () => boolean: the resolver only works in the engine leader
 *  hasTimeMs  async () => boolean: signals.time_ms exists (backfill)
 *  emit       (event, payload) => void: socket.io broadcast to this process's clients
 *  log        { info, warn }
 */
const createOutcomeTracker = (deps) => {
    const db = deps.db;
    const now = typeof deps.now === 'function' ? deps.now : Date.now;
    const log = deps.log || console;
    const fetchImpl = (...args) => (deps.fetch || globalThis.fetch)(...args);
    const isLeader = typeof deps.isLeader === 'function' ? deps.isLeader : () => false;
    const emit = typeof deps.emit === 'function' ? deps.emit : () => {};
    const hasTimeMs = typeof deps.hasTimeMs === 'function' ? deps.hasTimeMs : async () => true;

    const state = {
        table: null,            // signal_outcomes usable: true / false / null (not checked yet)
        running: false,         // resolver loop active (leader)
        timer: null,
        ticking: null,          // the tick in progress (promise)
        backfillDone: false,
        backfill: null,         // { at, scanned, inserted } of the backfill
        budget: createBudget(),
        pausedUntil: 0,         // after HTTP 429 / 418
        requests: 0,            // Binance requests made by this process (diagnostics / tests)
        symbols: { value: null, at: 0, failedAt: 0, pending: null },
        btcCache: new Map(),    // key -> { at, promise }
        scorecard: new Map(),   // days -> { at, value, pending }
        lastTick: null,         // { at, rows, processed, stoppedBy }
        warnedAt: new Map()
    };

    // One line per key every 5 minutes. log.warn takes a single string (server/index.cjs engineLog).
    const warn = (key, ...args) => {
        const t = now();
        if (t - (state.warnedAt.get(key) || 0) < WARN_INTERVAL_MS) return;
        state.warnedAt.set(key, t);
        log.warn(args.filter(a => a !== undefined && a !== null && a !== '').map(String).join(' '));
    };

    // ---- Binance REST ----
    const binanceGet = async (url) => {
        const t = now();
        if (t < state.pausedUntil) throw new OutcomeError('rate', 'Binance hız sınırı nedeniyle bekleniyor');
        if (!state.budget.take(t)) throw new OutcomeError('budget', `Dakikalık Binance istek sınırı (${REQUEST_BUDGET}) doldu`);
        state.requests++;
        let res;
        try {
            res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        } catch (err) {
            throw new OutcomeError('network', `Binance'e ulaşılamadı (${(err && (err.name || err.code)) || 'hata'})`);
        }
        if (res.status === 429 || res.status === 418) {
            const retryAfter = Number(res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : NaN);
            state.pausedUntil = now() + (Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 3600) * 1000 : RATE_PAUSE_MS);
            throw new OutcomeError('rate', `Binance hız sınırı (HTTP ${res.status})`);
        }
        let body = null;
        try {
            body = await res.json();
        } catch { /* not JSON */ }
        if (!res.ok) {
            if (body && Number(body.code) === -1121) throw new OutcomeError('symbol', 'Geçersiz sembol');
            throw new OutcomeError('http', `Binance HTTP ${res.status}`);
        }
        if (body === null || body === undefined) throw new OutcomeError('http', 'Binance yanıtı okunamadı');
        return body;
    };

    const klinesUrl = (market, symbol, interval, w) =>
        `${market === 'perp' ? PERP_KLINES_URL : SPOT_KLINES_URL}?symbol=${encodeURIComponent(symbol)}&interval=${interval}`
        + `&startTime=${w.startTime}&endTime=${w.endTime}&limit=${w.limit}`;

    const fetchKlines = async (market, symbol, interval, w) => parseKlines(await binanceGet(klinesUrl(market, symbol, interval, w)));

    // BTC benchmark klines: fetched once per (market, interval, window) and cached (signals of one engine pass share t0).
    const btcKey = (market, interval, w) => `${market}|${interval}|${w.startTime}|${w.endTime}|${w.limit}`;
    const fetchBtcKlines = (market, interval, w) => {
        const key = btcKey(market, interval, w);
        const t = now();
        const hit = state.btcCache.get(key);
        if (hit && t - hit.at < BTC_CACHE_TTL_MS) return hit.promise;
        const promise = fetchKlines(market, BTC_SYMBOL, interval, w);
        state.btcCache.set(key, { at: t, promise });
        promise.catch(() => {
            if (state.btcCache.get(key) && state.btcCache.get(key).promise === promise) state.btcCache.delete(key);
        });
        for (const [k, v] of state.btcCache) {
            if (state.btcCache.size <= BTC_CACHE_MAX && t - v.at < BTC_CACHE_TTL_MS) break;
            state.btcCache.delete(k);
        }
        return promise;
    };

    // exchangeInfo symbol sets (status TRADING), cached 1 h; on failure the previous sets (or null) for 5 min.
    const getSymbolSets = async () => {
        const s = state.symbols;
        const t = now();
        if (s.value && t - s.at < SYMBOLS_TTL_MS) return s.value;
        if (s.pending) return s.pending;
        if (s.failedAt && t - s.failedAt < SYMBOLS_RETRY_MS) return s.value;
        s.pending = (async () => {
            try {
                const [spot, perp] = await Promise.all([binanceGet(SPOT_INFO_URL), binanceGet(PERP_INFO_URL)]);
                const toSet = (info) => new Set((info && Array.isArray(info.symbols) ? info.symbols : [])
                    .filter(x => x && typeof x.symbol === 'string' && (x.status === undefined || x.status === 'TRADING'))
                    .map(x => x.symbol));
                const value = { spot: toSet(spot), perp: toSet(perp) };
                if (value.spot.size === 0 || value.perp.size === 0) throw new OutcomeError('http', 'Binance sembol listesi boş');
                s.value = value;
                s.at = now();
                s.failedAt = 0;
                return value;
            } catch (err) {
                s.failedAt = now();
                warn('symbols', `[outcomes] Binance sembol listesi alınamadı (${err.message}); sinyaller doğrulanmadan kaydediliyor.`);
                return s.value;
            } finally {
                s.pending = null;
            }
        })();
        return s.pending;
    };

    const insertRow = async (d) => {
        try {
            await db.query(
                'INSERT INTO signal_outcomes (signal_id, symbol, market, side, strategy, engine, source, t0, p0, next_due, status, attempts, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [d.signalId, d.symbol, d.market, d.side, d.strategy, d.engine, d.source, d.t0, d.p0, d.nextDue, d.status, 0, d.note === null ? null : clip(d.note, 255)]
            );
            return true;
        } catch (err) {
            if (err && err.code === 'ER_DUP_ENTRY') return false; // already registered (idempotent)
            throw err;
        }
    };

    /**
     * Registers a stored signal ({ id, strategy, symbol, side, price, source, engine?, timeMs?, time? }).
     * Returns the stored draft, or null (no row: MARKET, table missing, already registered). Throws on DB errors.
     */
    const register = async (signal) => {
        if (state.table === false) return null;
        const draft = buildRegistration(signal);
        if (!draft) return null;
        if (draft.status !== 'skipped') {
            const sets = await getSymbolSets();
            if (sets) {
                const market = resolveMarket(draft.symbol, draft.market, sets);
                if (market) {
                    draft.market = market;
                } else {
                    draft.status = 'skipped';
                    draft.note = `${draft.symbol} Binance spot/vadeli piyasasında bulunamadı`;
                }
            }
            // Symbol lists unavailable: stored unverified; the resolver skips it when Binance rejects the symbol.
        }
        draft.nextDue = draft.status === 'skipped' ? null : nextDueOf(draft.t0, {});
        const inserted = await insertRow(draft);
        return inserted ? draft : null;
    };

    // Fire and forget for the publish paths: never delays or breaks the signal itself.
    const registerQuietly = (signal) => {
        register(signal).catch(err => warn('register', '[outcomes] Sinyal sonucu kaydı oluşturulamadı:', err && (err.code || err.message)));
    };

    // ---- GET /api/signals ----
    const attach = async (signals) => {
        if (state.table === false || !Array.isArray(signals) || signals.length === 0) return signals;
        const ids = signals.filter(s => s && s.id !== undefined && String(s.symbol).toUpperCase() !== MARKET_SYMBOL).map(s => String(s.id));
        if (ids.length === 0) return signals;
        try {
            const [rows] = await db.query(
                `SELECT signal_id, status, o15, o60, o240, o1440, note FROM signal_outcomes WHERE signal_id IN (${ids.map(() => '?').join(', ')})`,
                ids
            );
            const byId = new Map((Array.isArray(rows) ? rows : []).map(r => [String(r.signal_id), r]));
            for (const s of signals) {
                const row = byId.get(String(s.id));
                if (row) s.outcome = outcomeDto(row);
            }
        } catch (err) {
            warn('attach', '[outcomes] Sinyal sonuçları okunamadı (liste sonuçsuz döndü):', err && (err.code || err.message));
        }
        return signals;
    };

    // Best effort (DELETE /api/signals/:id): a removed signal leaves the scorecard as well.
    const remove = async (id) => {
        if (state.table === false) return;
        try {
            await db.query('DELETE FROM signal_outcomes WHERE signal_id = ?', [String(id)]);
        } catch (err) {
            warn('delete', '[outcomes] Sinyal sonucu silinemedi:', err && (err.code || err.message));
        }
    };

    // ---- resolver ----
    // Written only if next_due is still the value this pass read: when another process measured the row in
    // the meantime (a leader change mid-pass, two leaders for a few seconds), its write stands and this one
    // is dropped instead of putting an older state back.
    const saveRow = (id, results, fields, readNextDue) => db.query(
        'UPDATE signal_outcomes SET o15 = ?, o60 = ?, o240 = ?, o1440 = ?, next_due = ?, status = ?, attempts = ?, note = ? WHERE signal_id = ? AND next_due = ?',
        [
            ...HORIZONS.map(h => (results[h.column] ? JSON.stringify(results[h.column]) : null)),
            fields.nextDue,
            fields.status,
            fields.attempts,
            fields.note === null || fields.note === undefined ? null : clip(fields.note, 255),
            id,
            readNextDue
        ]
    );

    // Measures every due horizon of one row. Returns 'stop' when the request budget / rate limit ends the tick.
    const processRow = async (row) => {
        const t = now();
        const id = String(row.signal_id);
        const t0 = Number(row.t0);
        const p0 = Number(row.p0);
        const market = row.market === 'perp' ? 'perp' : 'spot';
        const symbol = String(row.symbol || '');
        const results = {};
        for (const h of HORIZONS) results[h.column] = parseHorizon(row[h.column]);
        const before = JSON.stringify(results);
        const firstMeasurement = HORIZONS.every(h => !results[h.column]);
        const prevStatus = String(row.status || 'pending');
        let attempts = Math.max(0, Number(row.attempts) || 0);
        let note = row.note === undefined ? null : row.note;
        let status;
        let nextDue;
        let stop = false;
        let failure = null;
        let skipReason = null;
        let gapNote = null;

        if (!(t0 > 0) || !(p0 > 0) || !symbol) {
            skipReason = 'Geçersiz kayıt (zaman, fiyat veya sembol yok)';
        } else {
            const due = HORIZONS.filter(h => !results[h.column] && t0 + h.ms + DUE_GRACE_MS <= t);
            const groups = [];
            for (const h of due) {
                let g = groups.find(x => x.intervalMs === h.intervalMs);
                if (!g) groups.push(g = { interval: h.interval, intervalMs: h.intervalMs, horizons: [] });
                g.horizons.push(h);
            }
            for (const g of groups) {
                const w = klineWindow(t0, Math.max(...g.horizons.map(h => h.minutes)), g.intervalMs);
                let candles;
                let btcCandles;
                try {
                    candles = await fetchKlines(market, symbol, g.interval, w);
                    btcCandles = symbol === BTC_SYMBOL ? candles : await fetchBtcKlines(market, g.interval, w);
                } catch (err) {
                    if (err.kind === 'budget' || err.kind === 'rate') {
                        stop = true;
                        break;
                    }
                    if (err.kind === 'symbol') {
                        skipReason = `${symbol} Binance ${market === 'perp' ? 'vadeli' : 'spot'} piyasasında bulunamadı`;
                        break;
                    }
                    failure = err;
                    continue;
                }
                // Typo / test price guard, once, before anything is measured: p0 vs the last close before t0.
                const ref = firstMeasurement ? lastClosedBy(candles, t0) : null;
                if (ref && ref.closeTime >= t0 - 2 * g.intervalMs && Math.max(p0 / ref.close, ref.close / p0) > P0_MAX_RATIO) {
                    skipReason = clip(`Sinyal fiyatı (${p0}) t0 piyasa fiyatından (${ref.close}) çok uzak; ölçülmedi`, 255);
                    break;
                }
                for (const h of g.horizons) {
                    const r = computeHorizon({ t0, p0, side: row.side, market, minutes: h.minutes, intervalMs: g.intervalMs, candles, btcCandles, now: t });
                    if (r.btcGap) {
                        failure = new OutcomeError('data', r.btcGap);
                        state.btcCache.delete(btcKey(market, g.interval, w)); // incomplete: fetched again on the retry
                    } else if (r.gap) {
                        results[h.column] = { error: r.gap, resolvedAt: t };
                        gapNote = `${h.label}: ${r.gap}`;
                    } else {
                        results[h.column] = r.value;
                    }
                }
            }
            if (!skipReason && failure && !stop) {
                attempts += 1;
                if (attempts >= MAX_ATTEMPTS) {
                    for (const h of due) {
                        if (!results[h.column]) results[h.column] = { error: clip(`Ölçülemedi: ${failure.message}`, 200), resolvedAt: t };
                    }
                    note = `${MAX_ATTEMPTS} denemede ölçülemedi: ${failure.message}`;
                    attempts = 0;
                } else {
                    note = `Deneme ${attempts}/${MAX_ATTEMPTS} başarısız: ${failure.message}`;
                }
            } else if (!skipReason && !stop) {
                attempts = 0;
                if (gapNote) note = gapNote;
                else if (note && /^Deneme \d/.test(String(note))) note = null;
            } else if (stop && gapNote) {
                note = gapNote;
            }
        }

        if (skipReason) {
            status = 'skipped';
            nextDue = null;
            note = skipReason;
        } else {
            status = statusOf(results);
            nextDue = nextDueOf(t0, results);
            if (failure && !stop && attempts > 0) nextDue = t + backoffMs(attempts);
        }

        const changed = JSON.stringify(results) !== before || status !== prevStatus;
        if (stop && !changed) return 'stop';
        const written = await saveRow(id, results, { nextDue, status, attempts, note }, row.next_due);
        const saved = Array.isArray(written) ? written[0] : written;
        if (saved && saved.affectedRows === 0) return stop ? 'stop' : 'ok'; // written by another process meanwhile
        if (changed) {
            const outcome = outcomeDto({ status, note, ...Object.fromEntries(HORIZONS.map(h => [h.column, results[h.column]])) });
            try {
                emit('signal_outcome', { id, outcome });
            } catch { /* socket errors never break the resolver */ }
        }
        return stop ? 'stop' : 'ok';
    };

    // Engine / webhook / manual signals of the last 7 days without an outcome row get one (idempotent).
    const backfill = async () => {
        const t = now();
        const from = t - BACKFILL_DAYS * DAY_MS;
        const useTimeMs = await hasTimeMs();
        // Newest first: with more than BACKFILL_MAX_ROWS signals in the window the most recent ones get a row.
        const [rows] = await db.query(
            useTimeMs
                ? 'SELECT id, strategy, symbol, side, price, time, time_ms, source FROM signals WHERE time_ms >= ? ORDER BY time_ms DESC LIMIT ?'
                : 'SELECT id, strategy, symbol, side, price, time, source FROM signals WHERE time >= ? ORDER BY time DESC LIMIT ?',
            [useTimeMs ? from : new Date(from).toISOString(), BACKFILL_MAX_ROWS]
        );
        const candidates = (Array.isArray(rows) ? rows : [])
            .filter(r => r && r.id !== null && r.id !== undefined && String(r.symbol || '').toUpperCase() !== MARKET_SYMBOL);
        const existing = new Set();
        for (let i = 0; i < candidates.length; i += 200) {
            const ids = candidates.slice(i, i + 200).map(r => String(r.id));
            const [found] = await db.query(`SELECT signal_id FROM signal_outcomes WHERE signal_id IN (${ids.map(() => '?').join(', ')})`, ids);
            for (const f of Array.isArray(found) ? found : []) existing.add(String(f.signal_id));
        }
        let inserted = 0;
        for (const r of candidates) {
            if (existing.has(String(r.id))) continue;
            const ms = r.time_ms === null || r.time_ms === undefined ? NaN : Number(r.time_ms);
            const created = await register({
                id: r.id,
                strategy: r.strategy,
                symbol: r.symbol,
                side: r.side,
                price: r.price,
                source: r.source,
                timeMs: Number.isFinite(ms) ? ms : undefined,
                time: r.time
            });
            if (created) inserted++;
        }
        state.backfillDone = true;
        state.backfill = { at: t, scanned: candidates.length, inserted };
        if (inserted > 0 || candidates.length >= BACKFILL_MAX_ROWS) {
            log.info(`[outcomes] Geriye dönük kayıt: son ${BACKFILL_DAYS} günün ${candidates.length} sinyalinden ${inserted} tanesine sonuç kaydı açıldı.`);
        }
        return state.backfill;
    };

    const runTick = async () => {
        const t = now();
        const result = { at: t, rows: 0, processed: 0, stoppedBy: null };
        if (!state.backfillDone) {
            try {
                await backfill();
            } catch (err) {
                warn('backfill', '[outcomes] Geriye dönük sonuç kaydı yapılamadı (sonraki turda yeniden denenecek):', err && (err.code || err.message));
            }
        }
        if (!isLeader()) {
            result.stoppedBy = 'not-leader';
            return result;
        }
        if (t < state.pausedUntil) {
            result.stoppedBy = 'rate';
            return result;
        }
        const [rows] = await db.query(
            `SELECT ${OUTCOME_COLUMNS} FROM signal_outcomes WHERE next_due <= ? ORDER BY next_due ASC LIMIT ?`,
            [t, ROWS_PER_TICK]
        );
        const list = Array.isArray(rows) ? rows : [];
        result.rows = list.length;
        for (const row of list) {
            if (!isLeader()) {
                result.stoppedBy = 'not-leader';
                break;
            }
            let outcome;
            try {
                outcome = await processRow(row);
            } catch (err) {
                warn('row', '[outcomes] Sinyal sonucu yazılamadı:', err && (err.code || err.message));
                outcome = 'ok';
            }
            if (outcome === 'stop') {
                result.stoppedBy = now() < state.pausedUntil ? 'rate' : 'budget';
                break;
            }
            result.processed++;
        }
        return result;
    };

    /** One resolver pass (leader only; one at a time). Returns { at, rows, processed, stoppedBy } or { skipped }. */
    const tick = async () => {
        if (!isLeader() || state.table !== true) return { skipped: state.table !== true ? 'no-table' : 'not-leader' };
        if (state.ticking) return { skipped: 'busy' };
        const p = (async () => {
            try {
                state.lastTick = await runTick();
            } catch (err) {
                warn('tick', '[outcomes] Sinyal sonuçları okunamadı:', err && (err.code || err.message));
                state.lastTick = { at: now(), rows: 0, processed: 0, stoppedBy: 'error' };
            }
            return state.lastTick;
        })();
        state.ticking = p;
        try {
            return await p;
        } finally {
            if (state.ticking === p) state.ticking = null;
        }
    };

    const schedule = (ms) => {
        if (!state.running) return;
        if (state.timer) clearTimeout(state.timer);
        state.timer = setTimeout(() => {
            state.timer = null;
            tick().catch(() => { /* never rejects */ }).finally(() => schedule(RESOLVE_INTERVAL_MS));
        }, ms);
        if (typeof state.timer.unref === 'function') state.timer.unref();
    };

    /** Leader: start the 60 s resolver loop (the first pass, 5 s later, runs the one-time backfill). */
    const startResolver = () => {
        if (state.running) return;
        state.running = true;
        schedule(FIRST_TICK_DELAY_MS);
    };

    const stopResolver = () => {
        state.running = false;
        if (state.timer) clearTimeout(state.timer);
        state.timer = null;
    };

    // ---- GET /api/scorecard ----
    const scorecard = async (days) => {
        const d = SCORECARD_DAYS.includes(days) ? days : SCORECARD_DAYS[0];
        const t = now();
        const cached = state.scorecard.get(d);
        if (cached && cached.value && t - cached.at < SCORECARD_CACHE_MS) return cached.value;
        if (cached && cached.pending) return cached.pending;
        const entry = cached || { at: 0, value: null, pending: null };
        state.scorecard.set(d, entry);
        entry.pending = (async () => {
            let rows = [];
            if (state.table !== false) {
                try {
                    [rows] = await db.query(
                        'SELECT signal_id, symbol, market, side, strategy, engine, source, t0, status, o15, o60, o240, o1440 FROM signal_outcomes WHERE t0 >= ? LIMIT ?',
                        [t - d * DAY_MS, SCORECARD_MAX_ROWS]
                    );
                } catch (err) {
                    if (!err || err.code !== 'ER_NO_SUCH_TABLE') throw err;
                    rows = [];
                }
            }
            const value = buildScorecard(rows, { days: d, now: t });
            entry.value = value;
            entry.at = t;
            return value;
        })();
        try {
            return await entry.pending;
        } finally {
            entry.pending = null;
        }
    };

    return {
        state,
        setTable: (available) => { state.table = available; },
        register,
        registerQuietly,
        attach,
        remove,
        backfill,
        tick,
        tickNow: async () => {
            for (let i = 0; i < 50 && state.ticking; i++) await state.ticking.catch(() => {});
            return tick();
        },
        startResolver,
        stopResolver,
        scorecard,
        getSymbolSets
    };
};

module.exports = {
    createOutcomeTracker,
    // constants
    HORIZONS,
    HORIZON_LABELS,
    COSTS,
    CREATE_TABLE_SQL,
    PROBE_TABLE_SQL,
    RESOLVE_INTERVAL_MS,
    FIRST_TICK_DELAY_MS,
    ROWS_PER_TICK,
    DUE_GRACE_MS,
    MAX_ATTEMPTS,
    REQUEST_BUDGET,
    BACKFILL_DAYS,
    SCORECARD_CACHE_MS,
    SCORECARD_DAYS,
    P0_MAX_RATIO,
    MIN_NEFF_EARLY,
    MIN_NEFF_VERDICT,
    VERDICT_TEXT,
    FIXED_FAMILIES,
    // pure helpers (tests)
    sideDirection,
    buildRegistration,
    resolveMarket,
    klineWindow,
    parseKlines,
    lastClosedBy,
    computeHorizon,
    parseHorizon,
    statusOf,
    nextDueOf,
    backoffMs,
    outcomeDto,
    mean,
    median,
    sampleSd,
    effectiveCount,
    wilsonInterval,
    verdictFor,
    computeStats,
    familyOf,
    buildScorecard,
    createBudget
};
