import { FuturesTicker, Ticker } from '../types';

// What the Radar really lists (all are DESCRIPTIVE states of the current 24h tickers, none is a forecast):
//  DECOUPLING        24h move against BTC's 24h move
//  FUNDING_ARBITRAGE negative funding while the 24h price is up (card "negatif fonlama")
//  FUNDING_TREND     funding rising over the last hour (own card; it is NOT the same as the one above)
//  PUMP_DETECTED     24h gain well above BTC's on a liquid pair
// Open interest, order-book and pump-and-dump types were never produced and were removed; nothing in
// here reads open interest.
export type AnomalyType = 'DECOUPLING' | 'FUNDING_ARBITRAGE' | 'FUNDING_TREND' | 'PUMP_DETECTED';

export interface Anomaly {
    id: string;
    symbol: string;
    type: AnomalyType;
    severity: 'LOW' | 'MEDIUM' | 'HIGH';
    // Fixed rule score used for ordering only. It is not a probability and the UI must not present it as confidence.
    score: number;
    description: string;
    timestamp: number;
    metrics: {
        priceChange?: number;
        fundingRate?: number;
        volumeSpike?: number;
    };
}

const signedPct = (value: number, digits = 2) => `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;

// --- Detection Logic Class ---

export class AnomalyDetector {
    // 1. CORRELATION DECOUPLING
    // Detects when an asset's 24h change runs against BTC's 24h change.
    detectDecoupling(
        ticker: Ticker,
        btcTicker: Ticker
    ): Anomaly | null {
        const coinChg = ticker.priceChangePercent;
        const btcChg = btcTicker.priceChangePercent;
        const base = ticker.symbol.replace('USDT', '');

        // Condition: BTC down more than 0.8%, coin up more than 1.5%
        if (btcChg < -0.8 && coinChg > 1.5) {
            return {
                id: `dec-${ticker.symbol}-${Date.now()}`,
                symbol: ticker.symbol,
                type: 'DECOUPLING',
                severity: 'HIGH',
                score: 85,
                description: `BTC 24s ${signedPct(btcChg)} iken ${base} 24s ${signedPct(coinChg)}`,
                timestamp: Date.now(),
                metrics: { priceChange: coinChg }
            };
        }

        // Condition: BTC up more than 0.8%, coin down more than 1.5%
        if (btcChg > 0.8 && coinChg < -1.5) {
            return {
                id: `dec-weak-${ticker.symbol}-${Date.now()}`,
                symbol: ticker.symbol,
                type: 'DECOUPLING',
                severity: 'MEDIUM',
                score: 70,
                description: `BTC 24s ${signedPct(btcChg)} iken ${base} 24s ${signedPct(coinChg)}`,
                timestamp: Date.now(),
                metrics: { priceChange: coinChg }
            };
        }

        return null;
    }

    // 2. NEGATIVE FUNDING WHILE THE 24H PRICE IS UP
    // Descriptive only: shorts are paying while the price rose over 24h. The caller passes the
    // 8h-equivalent funding rate. (Type name kept for the Radar's card grouping.)
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
                description: `24s fiyat ${signedPct(priceChange)}, fonlama negatif (${fundingRate.toFixed(4)}%)`,
                timestamp: Date.now(),
                metrics: { fundingRate, priceChange }
            };
        }

        return null;
    }

    // 3. 24H GAIN WELL ABOVE BTC
    // An outlier against the market, not any green day. The old rule (24h change >= 1% with
    // >$1M volume, or >= 3% at any volume) matched roughly a third of all USDT pairs.
    // Rule now: liquid pair (24h quote volume >= $1M) whose 24h change beats BTC's by at least
    // PUMP_MIN_EXCESS_PCT points (BTC is the market reference; pass btcTicker when available).
    // On a sample of ~500 active USDT pairs this flags ~5-7% of the market instead of ~36%.
    private static PUMP_MIN_EXCESS_PCT = 6;
    private static PUMP_MIN_QUOTE_VOLUME = 1_000_000;

    detectPump(
        ticker: Ticker,
        btcTicker?: Ticker
    ): Anomaly | null {
        const priceChange = ticker.priceChangePercent;
        const volumeUSDT = ticker.volume; // quote volume in USDT
        if (!Number.isFinite(priceChange) || !Number.isFinite(volumeUSDT)) return null;
        if (ticker.symbol === 'BTCUSDT') return null;
        if (volumeUSDT < AnomalyDetector.PUMP_MIN_QUOTE_VOLUME) return null;

        const btcChange = btcTicker && Number.isFinite(btcTicker.priceChangePercent) ? btcTicker.priceChangePercent : 0;
        // Only a rising market raises the bar; a falling BTC does not make a small gain a "pump".
        const excess = priceChange - Math.max(btcChange, 0);

        if (priceChange < AnomalyDetector.PUMP_MIN_EXCESS_PCT || excess < AnomalyDetector.PUMP_MIN_EXCESS_PCT) return null;

        const severity: 'LOW' | 'MEDIUM' | 'HIGH' =
            excess >= 15 ? 'HIGH' :
                excess >= 10 ? 'MEDIUM' : 'LOW';

        return {
            id: `pump-${ticker.symbol}-${Date.now()}`,
            symbol: ticker.symbol,
            type: 'PUMP_DETECTED',
            severity,
            score: Math.min(Math.round(excess * 5), 100),
            description: `24s ${signedPct(priceChange)} (BTC'den ${excess.toFixed(2)} puan fazla) · 24s hacim $${(volumeUSDT / 1_000_000).toFixed(1)}M`,
            timestamp: Date.now(),
            metrics: { priceChange, volumeSpike: volumeUSDT / 1_000_000 }
        };
    }
}

export const anomalyDetector = new AnomalyDetector();

// --- Funding Trend Analysis ---

export interface FundingTrend {
    symbol: string;
    currentRate: number;
    velocity: number; // Change per hour (normalized)
    direction: 'STABLE' | 'DIVING' | 'SPIKING'; // DIVING = funding falling over the last hour, SPIKING = rising
    intensity: number; // 0-100 score
}

export class FundingAnalyzer {
    // Thresholds
    private static VELOCITY_THRESHOLD = 0.0005; // 0.05% change per hour is significant
    private static TIME_WINDOW_MS = 60 * 60 * 1000; // Look back 1 hour
    // Minimum data before any trend is reported. With only a few minutes of data, extrapolating a
    // single rate tick to "per hour" inflates it up to 60x, so short histories are always STABLE.
    private static MIN_SPAN_MS = 30 * 60 * 1000;
    private static MIN_POINTS = 10;

    static analyze(symbol: string, history: { time: number, rate: number }[]): FundingTrend {
        if (!history || history.length < 2) {
            return { symbol, currentRate: 0, velocity: 0, direction: 'STABLE', intensity: 0 };
        }

        const latest = history[history.length - 1];
        const stable: FundingTrend = { symbol, currentRate: latest.rate, velocity: 0, direction: 'STABLE', intensity: 0 };

        // Fixed window: the last hour of data ending at the latest point.
        const windowStart = latest.time - this.TIME_WINDOW_MS;
        const points = history.filter(p => Number.isFinite(p.time) && Number.isFinite(p.rate) && p.time >= windowStart);
        if (points.length < this.MIN_POINTS) return stable;

        const span = points[points.length - 1].time - points[0].time;
        if (span < this.MIN_SPAN_MS) return stable;

        // Least-squares slope of rate over time, expressed per hour. Using every point in a fixed
        // window gives the same sensitivity regardless of how long the session has been open.
        const t0 = points[0].time;
        const xs = points.map(p => (p.time - t0) / (1000 * 60 * 60));
        const ys = points.map(p => p.rate);
        const n = points.length;
        const meanX = xs.reduce((a, b) => a + b, 0) / n;
        const meanY = ys.reduce((a, b) => a + b, 0) / n;
        let num = 0;
        let den = 0;
        for (let i = 0; i < n; i++) {
            num += (xs[i] - meanX) * (ys[i] - meanY);
            den += (xs[i] - meanX) ** 2;
        }
        if (den === 0) return stable;
        const velocity = num / den; // Rate change per hour

        // DIVING = funding falling over the window, SPIKING = funding rising (descriptive labels only)
        let direction: 'STABLE' | 'DIVING' | 'SPIKING' = 'STABLE';
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

// Converts a funding trend into an anomaly with the right card:
// DIVING  -> FUNDING_ARBITRAGE (joins the "negatif fonlama" card)
// SPIKING -> FUNDING_TREND (own card; must NOT be shown with the negative-funding rows)
// The text states the measured slope only; it does not interpret who is crowded or what follows.
export const fundingTrendToAnomaly = (trend: FundingTrend): Anomaly | null => {
    if (trend.direction === 'STABLE') return null;
    const isDiving = trend.direction === 'DIVING';
    return {
        id: `fund-trend-${trend.symbol}-${Date.now()}`,
        symbol: trend.symbol,
        type: isDiving ? 'FUNDING_ARBITRAGE' : 'FUNDING_TREND',
        severity: trend.intensity > 70 ? 'HIGH' : 'MEDIUM',
        score: trend.intensity,
        description: isDiving
            ? `Fonlama son 1 saatte düşüyor (${(trend.velocity * 100).toFixed(3)}%/saat); şu an ${(trend.currentRate * 100).toFixed(4)}%`
            : `Fonlama son 1 saatte yükseliyor (+${(trend.velocity * 100).toFixed(3)}%/saat); şu an ${(trend.currentRate * 100).toFixed(4)}%`,
        timestamp: Date.now(),
        metrics: { fundingRate: trend.currentRate }
    };
};
