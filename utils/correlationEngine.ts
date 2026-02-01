/**
 * FidelioAI Advanced Correlation Engine
 * Calculates statistical correlations between crypto assets
 */

import { Ticker } from '../types';

// Store price history for correlation calculation
const priceHistory: Map<string, { price: number; timestamp: number }[]> = new Map();
const HISTORY_LIMIT = 100; // Keep last 100 data points for better correlation accuracy

// Minimum data points required for correlation calculation
const MIN_DATA_POINTS = 5;

export interface CorrelationPair {
    symbolA: string;
    symbolB: string;
    correlation: number; // -1 to 1
    strength: 'VERY_WEAK' | 'WEAK' | 'MODERATE' | 'STRONG' | 'VERY_STRONG';
    trend: 'DIVERGING' | 'CONVERGING' | 'STABLE';
    priceChangeA: number;
    priceChangeB: number;
    opportunityScore: number; // 0-100
}

export interface CorrelationMatrix {
    symbols: string[];
    matrix: number[][]; // 2D correlation matrix
    pairs: CorrelationPair[];
    timestamp: number;
}

/**
 * Add price data point for a symbol
 */
export function addPriceData(symbol: string, price: number): void {
    if (!priceHistory.has(symbol)) {
        priceHistory.set(symbol, []);
    }
    
    const history = priceHistory.get(symbol)!;
    history.push({ price, timestamp: Date.now() });
    
    // Keep only recent history
    if (history.length > HISTORY_LIMIT) {
        history.shift();
    }
}

/**
 * Calculate Pearson correlation coefficient between two arrays
 */
function calculatePearsonCorrelation(x: number[], y: number[]): number {
    const n = Math.min(x.length, y.length);
    if (n < MIN_DATA_POINTS) return 0; // Need minimum data points
    
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
    
    if (denominator === 0) return 0;
    
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
 * Calculate correlation estimate from 24h price changes
 * Used as fallback when we don't have enough historical data
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
        opportunityScore: 0
    };
}

/**
 * Calculate correlation between two symbols
 */
export function calculateCorrelation(symbolA: string, symbolB: string): CorrelationPair | null {
    const historyA = priceHistory.get(symbolA);
    const historyB = priceHistory.get(symbolB);
    
    if (!historyA || !historyB || historyA.length < MIN_DATA_POINTS || historyB.length < MIN_DATA_POINTS) {
        return null;
    }
    
    // Calculate price changes (returns)
    const returnsA: number[] = [];
    const returnsB: number[] = [];
    
    for (let i = 1; i < historyA.length; i++) {
        const ret = (historyA[i].price - historyA[i - 1].price) / historyA[i - 1].price * 100;
        returnsA.push(ret);
    }
    
    for (let i = 1; i < historyB.length; i++) {
        const ret = (historyB[i].price - historyB[i - 1].price) / historyB[i - 1].price * 100;
        returnsB.push(ret);
    }
    
    const correlation = calculatePearsonCorrelation(returnsA, returnsB);
    
    // Calculate 24h price change
    const priceChangeA = historyA.length > 1 
        ? ((historyA[historyA.length - 1].price - historyA[0].price) / historyA[0].price * 100)
        : 0;
    const priceChangeB = historyB.length > 1 
        ? ((historyB[historyB.length - 1].price - historyB[0].price) / historyB[0].price * 100)
        : 0;
    
    // Determine trend based on recent correlation changes
    let trend: CorrelationPair['trend'] = 'STABLE';
    if (historyA.length >= 20 && historyB.length >= 20) {
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
    
    // Calculate opportunity score (0-100)
    // High when there's divergence between correlated assets
    let opportunityScore = 0;
    const correlationStrength = Math.abs(correlation);
    const priceDiff = Math.abs(priceChangeA - priceChangeB);
    
    if (correlationStrength > 0.7 && priceDiff > 2) {
        // Strong correlation but price divergence = opportunity
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
        opportunityScore
    };
}

/**
 * Calculate full correlation matrix for multiple symbols
 */
export function calculateCorrelationMatrix(symbols: string[]): CorrelationMatrix {
    const matrix: number[][] = [];
    const pairs: CorrelationPair[] = [];
    
    for (let i = 0; i < symbols.length; i++) {
        matrix[i] = [];
        for (let j = 0; j < symbols.length; j++) {
            if (i === j) {
                matrix[i][j] = 1;
            } else if (i < j) {
                const pair = calculateCorrelation(symbols[i], symbols[j]);
                if (pair) {
                    matrix[i][j] = pair.correlation;
                    matrix[j][i] = pair.correlation;
                    pairs.push(pair);
                } else {
                    matrix[i][j] = 0;
                    matrix[j][i] = 0;
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
        timestamp: Date.now()
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
export function getPriceHistory(): Map<string, { price: number; timestamp: number }[]> {
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
