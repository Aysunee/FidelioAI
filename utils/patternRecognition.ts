
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
    confidence: number; // 0-100
    description: string;
}

export const detectPatterns = (candles: Candle[]): PatternResult => {
    if (candles.length < 20) return { pattern: 'NONE', confidence: 0, description: '' };

    // We analyze the last 20 candles
    const recent = candles.slice(-20);

    // 1. Check for Bull Flag
    // Logic: Sharp rise (Pole) followed by consolidation (Flag)
    const bullFlag = checkBullFlag(recent);
    if (bullFlag.confidence > 70) return { ...bullFlag, pattern: 'BULL_FLAG' };

    // 2. Check for Bear Flag
    const bearFlag = checkBearFlag(recent);
    if (bearFlag.confidence > 70) return { ...bearFlag, pattern: 'BEAR_FLAG' };

    return { pattern: 'NONE', confidence: 0, description: '' };
};

const checkBullFlag = (candles: Candle[]): { confidence: number; description: string } => {
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

    // Pole must be at least 2% (for lower timeframes) or dynamic based on volatility
    if (maxRise < 1.5) return { confidence: 0, description: '' };

    // The "Flag" should be after the pole
    // It should be consolidation: low volatility, slight downtrend or sideways
    const flagCandles = candles.slice(poleEndIndex + 1);
    if (flagCandles.length < 3) return { confidence: 0, description: '' }; // Need some consolidation

    const flagHigh = Math.max(...flagCandles.map(c => c.high));
    const flagLow = Math.min(...flagCandles.map(c => c.low));
    const poleHigh = candles[poleEndIndex].close;

    // 1. Flag should not retrace more than 50% of the pole
    const poleHeight = candles[poleEndIndex].close - candles[poleStartIndex].open;
    const retracement = poleHigh - flagLow;

    if (retracement > poleHeight * 0.6) return { confidence: 0, description: 'Retracement too deep' };

    // 2. Flag should be relatively tight (channel)
    // We check if the slope is slightly down or flat
    const flagChange = (flagCandles[flagCandles.length - 1].close - flagCandles[0].open) / flagCandles[0].open * 100;

    // Bull flag consolidation is usually slightly downwards or flat
    if (flagChange > 1) return { confidence: 0, description: 'Flag is rising too much' }; // Rising wedge/channel is different

    // If we are here, we have a potential bull flag
    // Confidence calculation
    let confidence = 70;
    if (maxRise > 3) confidence += 10; // Stronger pole
    if (flagCandles.length >= 5 && flagCandles.length <= 10) confidence += 10; // Ideal duration
    if (retracement < poleHeight * 0.382) confidence += 10; // Shallow retracement (strong)

    return {
        confidence,
        description: `Pole: +${maxRise.toFixed(2)}%, Flag: ${flagCandles.length} bars`
    };
};

const checkBearFlag = (candles: Candle[]): { confidence: number; description: string } => {
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

    if (maxDrop < 1.5) return { confidence: 0, description: '' };

    const flagCandles = candles.slice(poleEndIndex + 1);
    if (flagCandles.length < 3) return { confidence: 0, description: '' };

    const flagHigh = Math.max(...flagCandles.map(c => c.high));
    const poleLow = candles[poleEndIndex].close;
    const poleStartOpen = candles[poleStartIndex].open;

    const poleHeight = poleStartOpen - poleLow;
    const retracement = flagHigh - poleLow;

    if (retracement > poleHeight * 0.6) return { confidence: 0, description: 'Retracement too deep' };

    const flagChange = (flagCandles[flagCandles.length - 1].close - flagCandles[0].open) / flagCandles[0].open * 100;

    // Bear flag consolidation is usually slightly upwards or flat
    if (flagChange < -1) return { confidence: 0, description: 'Flag is dropping too much' };

    let confidence = 70;
    if (maxDrop > 3) confidence += 10;
    if (flagCandles.length >= 5 && flagCandles.length <= 10) confidence += 10;
    if (retracement < poleHeight * 0.382) confidence += 10;

    return {
        confidence,
        description: `Pole: -${maxDrop.toFixed(2)}%, Flag: ${flagCandles.length} bars`
    };
};
