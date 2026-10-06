// Shared types for the Terminal page (Binance USDT-M perpetual futures).

export type ChartInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

// Periods supported by Binance /futures/data/* ratio endpoints
export type RatioPeriod = '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '12h' | '1d';

export interface Candle {
    time: number;        // open time, unix SECONDS (lightweight-charts UTCTimestamp)
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;      // base asset volume
    quoteVolume: number; // USDT volume
    closed: boolean;     // false while the candle is still forming
}

export interface FuturesRow {
    symbol: string;               // e.g. 'ARKUSDT'
    baseAsset: string;            // e.g. 'ARK'
    price: number;                // last price
    changePct: number;            // 24h change, percent (e.g. 57.07)
    quoteVolume: number;          // 24h volume in USDT
    fundingRate: number;          // last funding rate as a fraction (e.g. -0.0013387)
    fundingIntervalHours: number; // 1, 4 or 8
    nextFundingTime: number;      // ms epoch
    markPrice: number;
    indexPrice: number;
    isTradFi?: boolean;           // true for TRADIFI_PERPETUAL contracts (stocks, FX, commodities); crypto perps omit it
}

// Long/short (or buy/sell, bid/ask) split. long + short === 1.
export interface SideRatio {
    long: number;      // 0..1  (bid side / taker buy / long)
    short: number;     // 0..1  (ask side / taker sell / short)
    timestamp: number; // ms epoch of the data point
    bandPct?: number;  // order book only: the symmetric ±% price band around mid that was measured
}

export interface SentimentSnapshot {
    orderBook: SideRatio | null;         // bid vs ask notional in the visible depth (fapi/v1/depth)
    orderType: SideRatio | null;         // taker (market order) buy vs sell volume (takerlongshortRatio)
    longShortAccounts: SideRatio | null; // all accounts long/short ratio (globalLongShortAccountRatio)
    traderPositioning: SideRatio | null; // top trader accounts ratio (topLongShortAccountRatio)
    marketExposure: SideRatio | null;    // top trader positions ratio (topLongShortPositionRatio)
}

export type SentimentKind = keyof SentimentSnapshot;
