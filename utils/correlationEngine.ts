/**
 * FidelioAI Short-Horizon Correlation Engine
 * Pearson correlation of ~1 second log-returns sampled from the live Binance ticker stream.
 * NOTE: this is a short window (a few minutes), not a historical / 24h correlation.
 */

import { Ticker } from '../types';

interface PricePoint {
    price: number;
    timestamp: number;
}

// Store price history for correlation calculation
const priceHistory: Map<string, PricePoint[]> = new Map();

// Market data is throttled to ~1 update per second, so 300 samples ≈ the last 5 minutes.
export const HISTORY_LIMIT = 300;

// Minimum number of aligned 1s returns before a correlation value is shown (≈ 1 minute of data).
export const MIN_SAMPLES = 60;

// Minimum data points for any Pearson calculation (used for the trend halves as well)
const MIN_DATA_POINTS = 5;

// If a symbol was not sampled for longer than this (e.g. the Nexus page was closed), the old series is
// discarded instead of treating the whole gap as a single 1s return.
const MAX_SAMPLE_GAP_MS = 5000;

export interface CorrelationPair {
    symbolA: string;
    symbolB: string;
    correlation: number; // -1 to 1
    strength: 'VERY_WEAK' | 'WEAK' | 'MODERATE' | 'STRONG' | 'VERY_STRONG';
    trend: 'DIVERGING' | 'CONVERGING' | 'STABLE';
    priceChangeA: number; // % change over the sampled window (NOT 24h)
    priceChangeB: number; // % change over the sampled window (NOT 24h)
    opportunityScore: number; // 0-100 (short-window divergence score)
    sampleCount: number; // number of aligned returns used
    windowMs: number; // time span covered by the aligned samples
}

export interface CorrelationMatrix {
    symbols: string[];
    matrix: number[][]; // 2D correlation matrix, NaN = not enough data
    pairs: CorrelationPair[];
    timestamp: number;
    windowMs: number; // longest window used by any pair
    sampleCount: number; // largest sample count used by any pair
}

/**
 * Add a price sample for a symbol.
 * Pass the same `timestamp` for every symbol of one market snapshot so series can be aligned.
 */
export function addPriceData(symbol: string, price: number, timestamp: number = Date.now()): void {
    if (!Number.isFinite(price) || price <= 0) return;

    let history = priceHistory.get(symbol);
    if (!history) {
        history = [];
        priceHistory.set(symbol, history);
    }

    const last = history[history.length - 1];
    if (last) {
        if (timestamp - last.timestamp > MAX_SAMPLE_GAP_MS) {
            // Sampling was interrupted: start a fresh series
            history.length = 0;
        } else if (timestamp <= last.timestamp) {
            // Same snapshot delivered twice: keep the latest price only
            last.price = price;
            return;
        }
    }

    history.push({ price, timestamp });

    // Keep only recent history
    if (history.length > HISTORY_LIMIT) {
        history.splice(0, history.length - HISTORY_LIMIT);
    }
}

/**
 * Number of price samples currently stored for a symbol
 */
export function getSampleCount(symbol: string): number {
    return priceHistory.get(symbol)?.length ?? 0;
}

/**
 * Calculate Pearson correlation coefficient between two arrays
 */
function calculatePearsonCorrelation(x: number[], y: number[]): number {
    const n = Math.min(x.length, y.length);
    if (n < MIN_DATA_POINTS) return NaN; // Need minimum data points

    // Use last n points
    const xSlice = x.slice(-n);
    const ySlice = y.slice(-n);

    const sumX = xSlice.reduce((a, b) => a + b, 0);
    const sumY = ySlice.reduce((a, b) => a + b, 0);

    const sumX2 = xSlice.reduce((a, b) => a + b * b, 0);
    const sumY2 = ySlice.reduce((a, b) => a + b * b, 0);

    const sumXY = xSlice.reduce((sum, xi, i) => sum + xi * ySlice[i], 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

    // A flat series (e.g. no trades in the window) has no defined correlation
    if (!Number.isFinite(denominator) || denominator === 0) return NaN;

    return numerator / denominator;
}

/**
 * Get correlation strength label
 */
function getCorrelationStrength(correlation: number): CorrelationPair['strength'] {
    const abs = Math.abs(correlation);
    if (abs >= 0.9) return 'VERY_STRONG';
    if (abs >= 0.7) return 'STRONG';
    if (abs >= 0.5) return 'MODERATE';
    if (abs >= 0.3) return 'WEAK';
    return 'VERY_WEAK';
}

/**
 * Heuristic "direction agreement" from 24h price changes.
 * NOT a statistical correlation - do not present it as one.
 */
export function estimateCorrelationFrom24h(
    symbolA: string,
    symbolB: string,
    changeA: number,
    changeB: number
): CorrelationPair | null {
    // Simple heuristic: if both move in same direction, positive correlation
    // if opposite directions, negative correlation
    // magnitude based on how similar the moves are
    const sameDirection = (changeA >= 0 && changeB >= 0) || (changeA < 0 && changeB < 0);
    const diff = Math.abs(changeA - changeB);
    const magnitude = Math.max(0, 1 - (diff / 10)); // Normalize to 0-1

    const correlation = sameDirection ? magnitude : -magnitude;

    return {
        symbolA,
        symbolB,
        correlation,
        strength: getCorrelationStrength(correlation),
        trend: 'STABLE',
        priceChangeA: changeA,
        priceChangeB: changeB,
        opportunityScore: 0,
        sampleCount: 0,
        windowMs: 0
    };
}

/**
 * Calculate correlation between two symbols from their aligned ~1s log-returns.
 * Returns null when there are fewer than MIN_SAMPLES aligned returns or the correlation is undefined.
 */
export function calculateCorrelation(symbolA: string, symbolB: string): CorrelationPair | null {
    const historyA = priceHistory.get(symbolA);
    const historyB = priceHistory.get(symbolB);

    if (!historyA || !historyB || historyA.length <= MIN_SAMPLES || historyB.length <= MIN_SAMPLES) {
        return null;
    }

    // Align both series on identical sample timestamps
    const pricesB = new Map<number, number>();
    historyB.forEach(p => pricesB.set(p.timestamp, p.price));

    const aligned: { timestamp: number; a: number; b: number }[] = [];
    historyA.forEach(p => {
        const b = pricesB.get(p.timestamp);
        if (b !== undefined) aligned.push({ timestamp: p.timestamp, a: p.price, b });
    });

    if (aligned.length <= MIN_SAMPLES) return null;

    // Log returns between consecutive aligned samples
    const returnsA: number[] = [];
    const returnsB: number[] = [];
    for (let i = 1; i < aligned.length; i++) {
        returnsA.push(Math.log(aligned[i].a / aligned[i - 1].a));
        returnsB.push(Math.log(aligned[i].b / aligned[i - 1].b));
    }

    if (returnsA.length < MIN_SAMPLES) return null;

    const correlation = calculatePearsonCorrelation(returnsA, returnsB);
    if (!Number.isFinite(correlation)) return null;

    const first = aligned[0];
    const last = aligned[aligned.length - 1];

    // Price change over the sampled window (a few minutes, NOT 24h)
    const priceChangeA = (last.a - first.a) / first.a * 100;
    const priceChangeB = (last.b - first.b) / first.b * 100;

    // Determine trend based on recent correlation changes
    let trend: CorrelationPair['trend'] = 'STABLE';
    if (returnsA.length >= 20) {
        // Calculate correlation for first half vs second half
        const mid = Math.floor(returnsA.length / 2);
        const earlyCorr = calculatePearsonCorrelation(returnsA.slice(0, mid), returnsB.slice(0, mid));
        const lateCorr = calculatePearsonCorrelation(returnsA.slice(mid), returnsB.slice(mid));

        if (Math.abs(lateCorr) < Math.abs(earlyCorr) - 0.1) {
            trend = 'DIVERGING';
        } else if (Math.abs(lateCorr) > Math.abs(earlyCorr) + 0.1) {
            trend = 'CONVERGING';
        }
    }

    // Divergence score (0-100): high when correlated assets moved apart within the same short window
    let opportunityScore = 0;
    const correlationStrength = Math.abs(correlation);
    const priceDiff = Math.abs(priceChangeA - priceChangeB);

    if (correlationStrength > 0.7 && priceDiff > 2) {
        opportunityScore = Math.min((correlationStrength * priceDiff * 10), 100);
    }

    return {
        symbolA,
        symbolB,
        correlation,
        strength: getCorrelationStrength(correlation),
        trend,
        priceChangeA,
        priceChangeB,
        opportunityScore,
        sampleCount: returnsA.length,
        windowMs: last.timestamp - first.timestamp
    };
}

/**
 * Calculate full correlation matrix for multiple symbols
 */
export function calculateCorrelationMatrix(symbols: string[]): CorrelationMatrix {
    const matrix: number[][] = [];
    const pairs: CorrelationPair[] = [];

    // Initialize empty rows first
    for (let i = 0; i < symbols.length; i++) {
        matrix[i] = [];
    }

    for (let i = 0; i < symbols.length; i++) {
        for (let j = 0; j < symbols.length; j++) {
            if (i === j) {
                matrix[i][j] = 1;
            } else if (i < j) {
                const pair = calculateCorrelation(symbols[i], symbols[j]);
                if (pair) {
                    matrix[i][j] = pair.correlation;
                    matrix[j][i] = pair.correlation; // This is now safe
                    pairs.push(pair);
                } else {
                    // Not enough aligned samples: unknown, not "0 correlation"
                    matrix[i][j] = NaN;
                    matrix[j][i] = NaN;
                }
            }
        }
    }

    // Sort pairs by opportunity score
    pairs.sort((a, b) => b.opportunityScore - a.opportunityScore);

    return {
        symbols,
        matrix,
        pairs,
        timestamp: Date.now(),
        windowMs: pairs.reduce((max, p) => Math.max(max, p.windowMs), 0),
        sampleCount: pairs.reduce((max, p) => Math.max(max, p.sampleCount), 0)
    };
}

/**
 * Find the most correlated assets with a given symbol
 */
export function findCorrelatedAssets(symbol: string, minCorrelation = 0.7): CorrelationPair[] {
    const results: CorrelationPair[] = [];

    for (const [otherSymbol] of priceHistory) {
        if (otherSymbol !== symbol) {
            const pair = calculateCorrelation(symbol, otherSymbol);
            if (pair && Math.abs(pair.correlation) >= minCorrelation) {
                results.push(pair);
            }
        }
    }

    return results.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
}

/**
 * Detect decoupling events with correlation context
 */
export interface DecouplingEvent {
    symbol: string;
    referenceSymbol: string;
    type: 'POSITIVE_DECOUPLING' | 'NEGATIVE_DECOUPLING';
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
    priceChange: number;
    referenceChange: number;
    expectedChange: number;
    deviation: number;
    historicalCorrelation: number;
}

export function detectDecouplingEvents(
    symbol: string,
    referenceSymbol: string = 'BTCUSDT'
): DecouplingEvent | null {
    const pair = calculateCorrelation(symbol, referenceSymbol);
    if (!pair) return null;

    // Only detect decoupling for historically correlated assets
    if (Math.abs(pair.correlation) < 0.6) return null;

    const { priceChangeA, priceChangeB, correlation } = pair;

    // Calculate expected price change based on correlation
    const expectedChange = priceChangeB * correlation;
    const deviation = priceChangeA - expectedChange;

    // Determine if this is significant decoupling
    const absDeviation = Math.abs(deviation);
    if (absDeviation < 1.5) return null;

    // Determine severity
    let severity: DecouplingEvent['severity'] = 'LOW';
    if (absDeviation > 8) severity = 'EXTREME';
    else if (absDeviation > 5) severity = 'HIGH';
    else if (absDeviation > 3) severity = 'MEDIUM';

    // Determine type
    const type = deviation > 0 ? 'POSITIVE_DECOUPLING' : 'NEGATIVE_DECOUPLING';

    return {
        symbol,
        referenceSymbol,
        type,
        severity,
        priceChange: priceChangeA,
        referenceChange: priceChangeB,
        expectedChange,
        deviation,
        historicalCorrelation: correlation
    };
}

/**
 * Get correlation color for UI
 */
export function getCorrelationColor(correlation: number): string {
    if (correlation >= 0.8) return '#10b981'; // Strong positive - emerald
    if (correlation >= 0.5) return '#34d399'; // Moderate positive
    if (correlation >= 0.2) return '#6ee7b7'; // Weak positive
    if (correlation > -0.2) return '#9ca3af'; // Neutral - gray
    if (correlation > -0.5) return '#fca5a5'; // Weak negative
    if (correlation > -0.8) return '#f87171'; // Moderate negative
    return '#ef4444'; // Strong negative
}

/**
 * Get correlation description
 */
export function getCorrelationDescription(correlation: number): string {
    if (correlation >= 0.9) return 'Moves together perfectly';
    if (correlation >= 0.7) return 'Strong positive correlation';
    if (correlation >= 0.5) return 'Moderate positive correlation';
    if (correlation >= 0.3) return 'Weak positive correlation';
    if (correlation > -0.3) return 'No significant correlation';
    if (correlation > -0.5) return 'Weak negative correlation';
    if (correlation > -0.7) return 'Moderate negative correlation';
    if (correlation > -0.9) return 'Strong negative correlation';
    return 'Moves opposite perfectly';
}

// Export price history for debugging
export function getPriceHistory(): Map<string, PricePoint[]> {
    return new Map(priceHistory);
}

// Clear old data (older than 24 hours)
export function cleanupOldData(maxAgeMs: number = 24 * 60 * 60 * 1000): void {
    const now = Date.now();
    for (const [symbol, history] of priceHistory) {
        const filtered = history.filter(h => now - h.timestamp < maxAgeMs);
        if (filtered.length === 0) {
            priceHistory.delete(symbol);
        } else {
            priceHistory.set(symbol, filtered);
        }
    }
}

// Human readable (Turkish) label for a sampling window, e.g. "45 sn" or "5 dk"
export function formatCorrelationWindow(windowMs: number): string {
    if (!Number.isFinite(windowMs) || windowMs <= 0) return '—';
    const seconds = Math.round(windowMs / 1000);
    if (seconds < 90) return `${seconds} sn`;
    return `${Math.round(seconds / 60)} dk`;
}
