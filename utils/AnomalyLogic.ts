import { FuturesTicker, Ticker } from '../types';
import { OpenInterestData } from '../services/marketData';

export type AnomalyType = 'DECOUPLING' | 'OI_SQUEEZE' | 'FUNDING_ARBITRAGE' | 'ORDERBOOK_WALL' | 'PUMP_DUMP' | 'PUMP_DETECTED';

export interface Anomaly {
    id: string;
    symbol: string;
    type: AnomalyType;
    severity: 'LOW' | 'MEDIUM' | 'HIGH';
    score: number; // 0-100 confidence score
    description: string;
    timestamp: number;
    metrics: {
        priceChange?: number;
        btcCorrelation?: number;
        oiChange?: number;
        fundingRate?: number;
        volumeSpike?: number;
    };
}

// Helper to calculate percentage change
const calcPercentChange = (current: number, previous: number) => {
    if (previous === 0) return 0;
    return ((current - previous) / previous) * 100;
};

// --- Detection Logic Class ---

export class AnomalyDetector {
    private correlationWindow: Map<string, number[]> = new Map(); // Stores recent price % diffs
    private oiHistory: Map<string, number> = new Map(); // Previous OI values for comparison

    // 1. CORRELATION DECOUPLING
    // Detects when an asset moves significantly against BTC
    detectDecoupling(
        ticker: Ticker,
        btcTicker: Ticker
    ): Anomaly | null {
        const coinChg = ticker.priceChangePercent;
        const btcChg = btcTicker.priceChangePercent;

        // Condition: BTC Dumping (> -0.8%), Coin Pumping (> 1.5%)
        if (btcChg < -0.8 && coinChg > 1.5) {
            return {
                id: `dec-${ticker.symbol}-${Date.now()}`,
                symbol: ticker.symbol,
                type: 'DECOUPLING',
                severity: 'HIGH',
                score: 85,
                description: `Strength against market: BTC ${btcChg.toFixed(2)}%, ${ticker.symbol.replace('USDT', '')} ${coinChg.toFixed(2)}%`,
                timestamp: Date.now(),
                metrics: { priceChange: coinChg, btcCorrelation: -1 } // Simplified correlation
            };
        }

        // Condition: BTC Pumping (> 0.8%), Coin Dumping (< -1.5%) -> Weakness
        if (btcChg > 0.8 && coinChg < -1.5) {
            return {
                id: `dec-weak-${ticker.symbol}-${Date.now()}`,
                symbol: ticker.symbol,
                type: 'DECOUPLING',
                severity: 'MEDIUM',
                score: 70,
                description: `Weakness against market: BTC +${btcChg.toFixed(2)}%, ${ticker.symbol.replace('USDT', '')} ${coinChg.toFixed(2)}%`,
                timestamp: Date.now(),
                metrics: { priceChange: coinChg, btcCorrelation: -1 }
            };
        }

        return null;
    }

    // 2. OPEN INTEREST SQUEEZE
    // Detects when Price is flat/ranging but OI is increasing rapidly (Position buildup)
    detectOiSqueeze(
        ticker: Ticker,
        currentOi: number
    ): Anomaly | null {
        const prevOi = this.oiHistory.get(ticker.symbol);

        // Update history
        this.oiHistory.set(ticker.symbol, currentOi);

        if (!prevOi) return null;

        const oiChange = calcPercentChange(currentOi, prevOi);
        const priceChange = Math.abs(ticker.priceChangePercent);

        // Condition: Price Flat (< 1.0% change) BUT OI Increasing (> 3% in last poll interval)
        if (priceChange < 1.0 && oiChange > 3.0) {
            return {
                id: `ois-${ticker.symbol}-${Date.now()}`,
                symbol: ticker.symbol,
                type: 'OI_SQUEEZE',
                severity: 'HIGH',
                score: 90,
                description: `Explosive Setup: OI +${oiChange.toFixed(2)}% while Price is consolidating.`,
                timestamp: Date.now(),
                metrics: { oiChange, priceChange }
            };
        }

        return null;
    }

    // 3. FUNDING ARBITRAGE (Short Squeeze Risk)
    // Detects Price UP + Negative Funding
    detectFundingArbitrage(
        ticker: FuturesTicker,
        spotTicker: Ticker
    ): Anomaly | null {
        const fundingRate = ticker.fundingRate * 100;
        const priceChange = spotTicker.priceChangePercent;

        if (priceChange > 3.0 && fundingRate < -0.01) {
            return {
                id: `fund-${ticker.symbol}-${Date.now()}`,
                symbol: ticker.symbol,
                type: 'FUNDING_ARBITRAGE',
                severity: 'HIGH',
                score: 95,
                description: `Short Squeeze Risk: Price +${priceChange.toFixed(2)}% yet Funding is Negative (${fundingRate.toFixed(4)}%)`,
                timestamp: Date.now(),
                metrics: { fundingRate, priceChange }
            };
        }

        return null;
    }

    // 4. PUMP DETECTION
    // Detects real pumps: Strong price increase (>1%) with high volume
    // Uses Binance's 24h priceChangePercent and volume metrics
    detectPump(
        ticker: Ticker
    ): Anomaly | null {
        const priceChange = ticker.priceChangePercent;

        // Must have at least 1% price increase
        if (priceChange < 1.0) return null;

        // Check if volume is significant (using quoteVolume in USDT)
        // High volume threshold: > 1M USDT for smaller coins, > 10M for larger ones
        const volumeUSDT = ticker.volume; // This is quote volume in USDT
        const isHighVolume = volumeUSDT > 1_000_000; // At least 1M USDT volume

        // For a real PUMP, we want both price movement AND volume
        // But we'll be more lenient - if price is really high, volume can be lower
        const isPump = (priceChange >= 1.0 && isHighVolume) || priceChange >= 3.0;

        if (isPump) {
            const severity: 'LOW' | 'MEDIUM' | 'HIGH' =
                priceChange >= 5.0 ? 'HIGH' :
                    priceChange >= 2.5 ? 'MEDIUM' : 'LOW';

            return {
                id: `pump-${ticker.symbol}-${Date.now()}`,
                symbol: ticker.symbol,
                type: 'PUMP_DETECTED',
                severity,
                score: Math.min(priceChange * 10, 100),
                description: `PUMP: +${priceChange.toFixed(2)}% | Vol: $${(volumeUSDT / 1_000_000).toFixed(1)}M`,
                timestamp: Date.now(),
                metrics: { priceChange, volumeSpike: volumeUSDT / 1_000_000 }
            };
        }

        return null;
    }
}

export const anomalyDetector = new AnomalyDetector();

// --- Funding Trend Analysis ---

export interface FundingTrend {
    symbol: string;
    currentRate: number;
    velocity: number; // Change per hour (normalized)
    direction: 'STABLE' | 'DIVING' | 'SPIKING'; // DIVING = Becoming more negative (Short Squeeze Risk)
    intensity: number; // 0-100 score
}

export class FundingAnalyzer {
    // Thresholds
    private static VELOCITY_THRESHOLD = 0.0005; // 0.05% change per hour is significant
    private static TIME_WINDOW_MS = 60 * 60 * 1000; // Look back 1 hour

    static analyze(symbol: string, history: { time: number, rate: number }[]): FundingTrend {
        if (!history || history.length < 2) {
            return { symbol, currentRate: 0, velocity: 0, direction: 'STABLE', intensity: 0 };
        }

        const latest = history[history.length - 1];
        const now = Date.now();

        // Find a point roughly 1 hour ago (or oldest available)
        const targetTime = now - this.TIME_WINDOW_MS;
        const past = history.find(p => p.time >= targetTime) || history[0];

        if (latest.time === past.time) {
            return { symbol, currentRate: latest.rate, velocity: 0, direction: 'STABLE', intensity: 0 };
        }

        const timeDiffHours = (latest.time - past.time) / (1000 * 60 * 60);
        const rateDiff = latest.rate - past.rate;
        const velocity = rateDiff / timeDiffHours; // Rate change per hour

        // Determine Direction
        let direction: 'STABLE' | 'DIVING' | 'SPIKING' = 'STABLE';

        // Diving: Rate is negative AND velocity is negative (Lowering further)
        // OR Rate is positive but dropping fast
        if (velocity < -this.VELOCITY_THRESHOLD) {
            direction = 'DIVING';
        } else if (velocity > this.VELOCITY_THRESHOLD) {
            direction = 'SPIKING';
        }

        // Intensity Score (0-100)
        // Map velocity 0.0005 -> 0.005 (0.05% -> 0.5% per hour range)
        const absVel = Math.abs(velocity);
        const intensity = Math.min((absVel / 0.005) * 100, 100);

        return {
            symbol,
            currentRate: latest.rate,
            velocity,
            direction,
            intensity
        };
    }
}
