// Pure technical indicators for the Terminal charts (TradingView-compatible definitions).
//
// Every function returns an array with the same length as its input. Positions without enough
// history (warm-up) are NaN. Non-finite inputs are treated as gaps.

const isNum = (v: number): boolean => typeof v === 'number' && Number.isFinite(v);

const validPeriod = (period: number): number | null => {
    const p = Math.floor(period);
    return Number.isFinite(p) && p >= 1 ? p : null;
};

const nanArray = (length: number): number[] => new Array<number>(length).fill(NaN);

/** Simple moving average. */
export function sma(values: number[], period: number): number[] {
    const n = values.length;
    const out = nanArray(n);
    const p = validPeriod(period);
    if (!p) return out;

    let sum = 0;
    let gaps = 0;
    for (let i = 0; i < n; i++) {
        const v = values[i];
        if (isNum(v)) sum += v;
        else gaps++;
        if (i >= p) {
            const old = values[i - p];
            if (isNum(old)) sum -= old;
            else gaps--;
        }
        if (i >= p - 1 && gaps === 0) {
            // Re-sum the window occasionally so the rolling sum cannot drift.
            if (i % 256 === 0) {
                sum = 0;
                for (let j = i - p + 1; j <= i; j++) sum += values[j];
            }
            out[i] = sum / p;
        }
    }
    return out;
}

/**
 * Exponential moving average, alpha = 2 / (period + 1), seeded with the SMA of the first
 * `period` consecutive valid values (same as TradingView's ta.ema warm-up).
 */
export function ema(values: number[], period: number): number[] {
    const n = values.length;
    const out = nanArray(n);
    const p = validPeriod(period);
    if (!p) return out;

    const alpha = 2 / (p + 1);
    let prev = NaN;
    let seedSum = 0;
    let seedCount = 0;
    for (let i = 0; i < n; i++) {
        const v = values[i];
        if (!isNum(v)) {
            if (!isNum(prev)) {
                seedSum = 0;
                seedCount = 0;
            }
            continue;
        }
        if (!isNum(prev)) {
            seedSum += v;
            seedCount++;
            if (seedCount === p) {
                prev = seedSum / p;
                out[i] = prev;
            }
            continue;
        }
        prev = alpha * v + (1 - alpha) * prev;
        out[i] = prev;
    }
    return out;
}

/** Double EMA: 2 * EMA(x) - EMA(EMA(x)). */
export function dema(values: number[], period: number): number[] {
    const e1 = ema(values, period);
    const e2 = ema(e1, period);
    return e1.map((v, i) => (isNum(v) && isNum(e2[i]) ? 2 * v - e2[i] : NaN));
}

/** Bollinger Bands: SMA ± mult × population standard deviation (TradingView's ta.stdev). */
export function bollinger(
    values: number[],
    period: number = 20,
    mult: number = 2,
): { upper: number[]; middle: number[]; lower: number[] } {
    const n = values.length;
    const middle = sma(values, period);
    const upper = nanArray(n);
    const lower = nanArray(n);
    const p = validPeriod(period);
    if (!p) return { upper, middle, lower };

    for (let i = p - 1; i < n; i++) {
        const mean = middle[i];
        if (!isNum(mean)) continue;
        let sq = 0;
        for (let j = i - p + 1; j <= i; j++) {
            const d = values[j] - mean;
            sq += d * d;
        }
        const dev = Math.sqrt(sq / p);
        upper[i] = mean + mult * dev;
        lower[i] = mean - mult * dev;
    }
    return { upper, middle, lower };
}

/**
 * Relative Strength Index with Wilder's smoothing (RMA, alpha = 1 / period) seeded by the SMA of
 * the first `period` changes — identical to TradingView's ta.rsi. First value at index `period`.
 */
export function rsi(values: number[], period: number = 14): number[] {
    const n = values.length;
    const out = nanArray(n);
    const p = validPeriod(period);
    if (!p) return out;

    const calc = (up: number, down: number): number => (down === 0 ? 100 : up === 0 ? 0 : 100 - 100 / (1 + up / down));

    let avgUp = NaN;
    let avgDown = NaN;
    let sumUp = 0;
    let sumDown = 0;
    let count = 0;
    for (let i = 1; i < n; i++) {
        const prevV = values[i - 1];
        const v = values[i];
        if (!isNum(prevV) || !isNum(v)) {
            if (!isNum(avgUp)) {
                sumUp = 0;
                sumDown = 0;
                count = 0;
            }
            continue;
        }
        const change = v - prevV;
        const up = change > 0 ? change : 0;
        const down = change < 0 ? -change : 0;
        if (!isNum(avgUp)) {
            sumUp += up;
            sumDown += down;
            count++;
            if (count === p) {
                avgUp = sumUp / p;
                avgDown = sumDown / p;
                out[i] = calc(avgUp, avgDown);
            }
            continue;
        }
        avgUp = (avgUp * (p - 1) + up) / p;
        avgDown = (avgDown * (p - 1) + down) / p;
        out[i] = calc(avgUp, avgDown);
    }
    return out;
}

const clamp100 = (v: number): number => (isNum(v) ? Math.min(100, Math.max(0, v)) : NaN);

/**
 * Stochastic RSI (TradingView defaults 14, 14, 3, 3):
 *   rsi1 = rsi(src, rsiLen)
 *   k = sma(stoch(rsi1, rsi1, rsi1, stochLen), smoothK)
 *   d = sma(k, smoothD)
 * When the RSI window is completely flat (highest == lowest) the previous raw value is carried
 * forward (50 if there is none) instead of producing a gap. Values are clamped to 0..100.
 */
export function stochRsi(
    values: number[],
    rsiLen: number = 14,
    stochLen: number = 14,
    smoothK: number = 3,
    smoothD: number = 3,
): { k: number[]; d: number[] } {
    const n = values.length;
    const r = rsi(values, rsiLen);
    const raw = nanArray(n);
    const sl = validPeriod(stochLen);
    if (!sl) return { k: nanArray(n), d: nanArray(n) };

    let prevRaw = NaN;
    for (let i = sl - 1; i < n; i++) {
        let hh = -Infinity;
        let ll = Infinity;
        let complete = true;
        for (let j = i - sl + 1; j <= i; j++) {
            const v = r[j];
            if (!isNum(v)) {
                complete = false;
                break;
            }
            if (v > hh) hh = v;
            if (v < ll) ll = v;
        }
        if (!complete) {
            prevRaw = NaN;
            continue;
        }
        const range = hh - ll;
        raw[i] = range > 0 ? (100 * (r[i] - ll)) / range : isNum(prevRaw) ? prevRaw : 50;
        prevRaw = raw[i];
    }

    const k = sma(raw, smoothK).map(clamp100);
    const d = sma(k, smoothD).map(clamp100);
    return { k, d };
}

/**
 * Wilder's moving average (RMA, alpha = 1 / period) seeded with the SMA of the first `period`
 * consecutive valid values — TradingView's ta.rma. Gaps before the seed restart the seed window;
 * gaps after it produce NaN at that bar and the average continues from the last valid value.
 */
function rma(values: number[], period: number): number[] {
    const n = values.length;
    const out = nanArray(n);
    const p = validPeriod(period);
    if (!p) return out;

    let prev = NaN;
    let seedSum = 0;
    let seedCount = 0;
    for (let i = 0; i < n; i++) {
        const v = values[i];
        if (!isNum(v)) {
            if (!isNum(prev)) {
                seedSum = 0;
                seedCount = 0;
            }
            continue;
        }
        if (!isNum(prev)) {
            seedSum += v;
            seedCount++;
            if (seedCount === p) {
                prev = seedSum / p;
                out[i] = prev;
            }
            continue;
        }
        prev = (prev * (p - 1) + v) / p;
        out[i] = prev;
    }
    return out;
}

/**
 * MACD (TradingView ta.macd): macd = EMA(fast) - EMA(slow), signal = EMA(macd, signal),
 * hist = macd - signal. With the defaults the MACD line starts at index 25 and the signal /
 * histogram at index 33.
 */
export function macd(
    close: number[],
    fast: number = 12,
    slow: number = 26,
    signal: number = 9,
): { macd: number[]; signal: number[]; hist: number[] } {
    const n = close.length;
    const fastMa = ema(close, fast);
    const slowMa = ema(close, slow);
    const line = nanArray(n);
    for (let i = 0; i < n; i++) {
        const f = fastMa[i];
        const s = slowMa[i];
        if (isNum(f) && isNum(s)) line[i] = f - s;
    }
    const sig = ema(line, signal);
    const hist = nanArray(n);
    for (let i = 0; i < n; i++) {
        const m = line[i];
        const s = sig[i];
        if (isNum(m) && isNum(s)) hist[i] = m - s;
    }
    return { macd: line, signal: sig, hist };
}

/**
 * Average True Range (TradingView ta.atr): RMA of the true range. The first bar (or a bar whose
 * previous close is missing) uses high - low as its true range. First value at index period - 1.
 */
export function atr(high: number[], low: number[], close: number[], period: number = 14): number[] {
    const n = close.length;
    const tr = nanArray(n);
    for (let i = 0; i < n; i++) {
        const h = high[i];
        const l = low[i];
        if (!isNum(h) || !isNum(l)) continue;
        const pc = i > 0 ? close[i - 1] : NaN;
        tr[i] = isNum(pc) ? Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)) : h - l;
    }
    return rma(tr, period);
}

/**
 * On-Balance Volume (TradingView ta.obv = ta.cum(sign(change(close)) * volume)).
 * Starts at 0 on the first bar. A bar with a missing close is NaN; a missing close or volume adds
 * nothing to the running total (Pine's nz semantics).
 */
export function obv(close: number[], volume: number[]): number[] {
    const n = close.length;
    const out = nanArray(n);
    let cum = 0;
    for (let i = 0; i < n; i++) {
        const c = close[i];
        if (!isNum(c)) continue;
        if (i > 0) {
            const pc = close[i - 1];
            const v = volume[i];
            if (isNum(pc) && isNum(v)) {
                if (c > pc) cum += v;
                else if (c < pc) cum -= v;
            }
        }
        out[i] = cum;
    }
    return out;
}

const SECONDS_PER_DAY = 86400;

/**
 * Session VWAP anchored to the UTC day (TradingView's ta.vwap(hlc3) with the 'D' anchor on
 * crypto exchanges): cumulative hlc3 × volume / cumulative volume, reset on the first bar of each
 * 00:00 UTC day. `timeSec` is the bar open time in UNIX seconds. NaN while the day's cumulative
 * volume is 0 and on bars with missing data.
 */
export function vwap(
    high: number[],
    low: number[],
    close: number[],
    volume: number[],
    timeSec: number[],
): number[] {
    const n = close.length;
    const out = nanArray(n);
    let day = NaN;
    let pv = 0;
    let vol = 0;
    for (let i = 0; i < n; i++) {
        const t = timeSec[i];
        if (!isNum(t)) continue;
        const d = Math.floor(t / SECONDS_PER_DAY);
        if (d !== day) {
            day = d;
            pv = 0;
            vol = 0;
        }
        const h = high[i];
        const l = low[i];
        const c = close[i];
        const v = volume[i];
        if (!isNum(h) || !isNum(l) || !isNum(c) || !isNum(v)) continue;
        pv += ((h + l + c) / 3) * v;
        vol += v;
        if (vol > 0) out[i] = pv / vol;
    }
    return out;
}

/**
 * Heikin Ashi candles:
 *   haClose = (o + h + l + c) / 4
 *   haOpen  = (prev haOpen + prev haClose) / 2, first bar (o + c) / 2
 *   haHigh  = max(h, haOpen, haClose), haLow = min(l, haOpen, haClose)
 * Bars with a missing OHLC value are NaN; the next valid bar continues from the last valid one.
 */
export function heikinAshi(
    open: number[],
    high: number[],
    low: number[],
    close: number[],
): { open: number[]; high: number[]; low: number[]; close: number[] } {
    const n = close.length;
    const haOpen = nanArray(n);
    const haHigh = nanArray(n);
    const haLow = nanArray(n);
    const haClose = nanArray(n);
    let prevOpen = NaN;
    let prevClose = NaN;
    for (let i = 0; i < n; i++) {
        const o = open[i];
        const h = high[i];
        const l = low[i];
        const c = close[i];
        if (!isNum(o) || !isNum(h) || !isNum(l) || !isNum(c)) continue;
        const hc = (o + h + l + c) / 4;
        const ho = isNum(prevOpen) ? (prevOpen + prevClose) / 2 : (o + c) / 2;
        haOpen[i] = ho;
        haClose[i] = hc;
        haHigh[i] = Math.max(h, ho, hc);
        haLow[i] = Math.min(l, ho, hc);
        prevOpen = ho;
        prevClose = hc;
    }
    return { open: haOpen, high: haHigh, low: haLow, close: haClose };
}
