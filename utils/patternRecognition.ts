
export interface Candle {
    openTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export interface PatternResult {
    pattern: 'BULL_FLAG' | 'BEAR_FLAG' | 'PENNANT' | 'NONE';
    description: string;
    // Open time of the first / last candle of the pole. Identifies the formation: the same pole seen on a
    // later candle is the same formation, not a new one.
    poleStartTime?: number;
    poleEndTime?: number;
    /**
     * @deprecated Never set any more. The old 70–100 "confidence" was a fixed rule score with no
     * measured hit rate (2h direction accuracy of the rule was ~49%). Nothing in the UI may show it.
     */
    confidence?: number;
}

const NONE: PatternResult = { pattern: 'NONE', description: '' };

// Rule (unchanged in phase 1): inside the last 20 closed candles, the strongest 5-candle move of at
// least 1.5% is the "pole"; the candles after it are the "flag" if they retrace at most 60% of the pole
// and do not run more than 1% against it. The fixed-threshold rule has no measured edge; it is kept
// only as a descriptive formation finder and will be redesigned (ATR-based) in phase 3.
export const detectPatterns = (candles: Candle[]): PatternResult => {
    if (candles.length < 20) return NONE;

    // We analyze the last 20 candles
    const recent = candles.slice(-20);

    const bullFlag = checkBullFlag(recent);
    if (bullFlag) return { ...bullFlag, pattern: 'BULL_FLAG' };

    const bearFlag = checkBearFlag(recent);
    if (bearFlag) return { ...bearFlag, pattern: 'BEAR_FLAG' };

    return NONE;
};

type FlagMatch = Pick<PatternResult, 'description' | 'poleStartTime' | 'poleEndTime'>;

const describeFlag = (sign: '+' | '−', movePct: number, flagBars: number, retracePct: number): string =>
    `Direk ${sign}${movePct.toFixed(2)}% (5 mum), ardından ${flagBars} mumluk konsolidasyon; geri çekilme direğin %${retracePct.toFixed(0)}'i`;

const checkBullFlag = (candles: Candle[]): FlagMatch | null => {

    // Split into Pole (first 10) and Flag (last 10) - roughly
    // A real pole is usually 3-5 candles of strong move

    // Find the "Pole"
    // Look for a sequence of 3-5 candles with significant gain
    let maxRise = 0;
    let poleEndIndex = -1;
    let poleStartIndex = -1;

    for (let i = 0; i < candles.length - 5; i++) {
        const start = candles[i].open;
        const end = candles[i + 4].close;
        const change = (end - start) / start * 100;

        if (change > maxRise) {
            maxRise = change;
            poleStartIndex = i;
            poleEndIndex = i + 4;
        }
    }

    // Pole must be at least 1.5%
    if (maxRise < 1.5) return null;

    // The "Flag" should be after the pole
    // It should be consolidation: low volatility, slight downtrend or sideways
    const flagCandles = candles.slice(poleEndIndex + 1);
    if (flagCandles.length < 3) return null; // Need some consolidation

    const flagLow = Math.min(...flagCandles.map(c => c.low));
    const poleHigh = candles[poleEndIndex].close;

    // 1. Flag should not retrace more than 60% of the pole
    const poleHeight = candles[poleEndIndex].close - candles[poleStartIndex].open;
    const retracement = poleHigh - flagLow;

    if (poleHeight <= 0 || retracement > poleHeight * 0.6) return null;

    // 2. Flag should be relatively tight (channel)
    // We check if the slope is slightly down or flat
    const flagChange = (flagCandles[flagCandles.length - 1].close - flagCandles[0].open) / flagCandles[0].open * 100;

    // Bull flag consolidation is usually slightly downwards or flat
    if (flagChange > 1) return null; // Rising wedge/channel is different

    return {
        description: describeFlag('+', maxRise, flagCandles.length, (retracement / poleHeight) * 100),
        poleStartTime: candles[poleStartIndex].openTime,
        poleEndTime: candles[poleEndIndex].openTime
    };
};

const checkBearFlag = (candles: Candle[]): FlagMatch | null => {
    // Inverse logic of Bull Flag
    let maxDrop = 0;
    let poleEndIndex = -1;
    let poleStartIndex = -1;

    for (let i = 0; i < candles.length - 5; i++) {
        const start = candles[i].open;
        const end = candles[i + 4].close;
        const change = (start - end) / start * 100; // Drop %

        if (change > maxDrop) {
            maxDrop = change;
            poleStartIndex = i;
            poleEndIndex = i + 4;
        }
    }

    if (maxDrop < 1.5) return null;

    const flagCandles = candles.slice(poleEndIndex + 1);
    if (flagCandles.length < 3) return null;

    const flagHigh = Math.max(...flagCandles.map(c => c.high));
    const poleLow = candles[poleEndIndex].close;
    const poleStartOpen = candles[poleStartIndex].open;

    const poleHeight = poleStartOpen - poleLow;
    const retracement = flagHigh - poleLow;

    if (poleHeight <= 0 || retracement > poleHeight * 0.6) return null;

    const flagChange = (flagCandles[flagCandles.length - 1].close - flagCandles[0].open) / flagCandles[0].open * 100;

    // Bear flag consolidation is usually slightly upwards or flat
    if (flagChange < -1) return null;

    return {
        description: describeFlag('−', maxDrop, flagCandles.length, (retracement / poleHeight) * 100),
        poleStartTime: candles[poleStartIndex].openTime,
        poleEndTime: candles[poleEndIndex].openTime
    };
};
