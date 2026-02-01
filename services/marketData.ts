

import { Ticker, Signal, Side, FuturesTicker, MarketIndex, Liquidation } from '../types';
import { STRATEGY_NAMES, DEFAULT_WATCHLIST } from '../constants';

// --- Binance Spot WebSocket Logic ---

type MiniTickerPayload = {
  s: string; // Symbol
  c: string; // Close price
  o: string; // Open price
  h: string; // High price
  l: string; // Low price
  v: string; // Total traded base asset volume
  q: string; // Total traded quote asset volume
  E: number; // Event time
};

export const connectToBinance = (
  onTickerUpdate: (tickers: Record<string, Ticker>) => void
) => {
  const ws = new WebSocket('wss://stream.binance.com:9443/ws/!miniTicker@arr');

  // We throttle updates to avoid React rendering too often
  let pendingUpdates: Record<string, Ticker> = {};
  let throttleTimer: number | null = null;

  ws.onmessage = (event) => {
    try {
      const data: MiniTickerPayload[] = JSON.parse(event.data);

      data.forEach(t => {
        pendingUpdates[t.s] = {
          symbol: t.s,
          lastPrice: parseFloat(t.c),
          openPrice: parseFloat(t.o),
          highPrice: parseFloat(t.h),
          lowPrice: parseFloat(t.l),
          priceChangePercent: ((parseFloat(t.c) - parseFloat(t.o)) / parseFloat(t.o)) * 100,
          volume: parseFloat(t.q), // Using Quote volume (USDT value approx)
          updatedAt: t.E
        };
      });

      if (!throttleTimer) {
        throttleTimer = window.setTimeout(() => {
          onTickerUpdate({ ...pendingUpdates });
          pendingUpdates = {};
          throttleTimer = null;
        }, 1000); // Update UI once per second
      }

    } catch (e) {
      console.error("WS Parse Error", e);
    }
  };

  return () => {
    ws.close();
    if (throttleTimer) clearTimeout(throttleTimer);
  };
};

// --- Binance Futures WebSocket Logic (Funding Rates & 24h Stats) ---

type MarkPricePayload = {
  s: string; // Symbol
  p: string; // Mark Price
  i: string; // Index Price
  P: string; // Estimated Settle Price
  r: string; // Funding Rate
  T: number; // Next Funding Time
};

export const connectToBinanceFutures = (
  onFuturesUpdate: (data: Record<string, Partial<FuturesTicker>>) => void
) => {
  // We combine markPrice and miniTicker (for volume/24h h-l)
  const streams = ['!markPrice@arr@1s', '!miniTicker@arr'];
  const ws = new WebSocket(`wss://fstream.binance.com/stream?streams=${streams.join('/')}`);

  let pendingUpdates: Record<string, Partial<FuturesTicker>> = {};
  let throttleTimer: number | null = null;

  ws.onmessage = (event) => {
    try {
      const wrapped = JSON.parse(event.data);
      const stream = wrapped.stream;
      const data = wrapped.data;

      if (stream === '!markPrice@arr@1s') {
        (data as MarkPricePayload[]).forEach(t => {
          if (!t.s.endsWith('USDT')) return;
          pendingUpdates[t.s] = {
            ...pendingUpdates[t.s],
            symbol: t.s,
            markPrice: parseFloat(t.p),
            indexPrice: parseFloat(t.i),
            fundingRate: parseFloat(t.r),
            nextFundingTime: t.T
          };
        });
      } else if (stream === '!miniTicker@arr') {
        (data as MiniTickerPayload[]).forEach(t => {
          if (!t.s.endsWith('USDT')) return;
          pendingUpdates[t.s] = {
            ...pendingUpdates[t.s],
            symbol: t.s,
            lastPrice: parseFloat(t.c),
            highPrice: parseFloat(t.h),
            lowPrice: parseFloat(t.l),
            openPrice: parseFloat(t.o),
            volume: parseFloat(t.q), // Volume in USDT
            priceChangePercent: ((parseFloat(t.c) - parseFloat(t.o)) / parseFloat(t.o)) * 100
          };
        });
      }

      if (!throttleTimer) {
        throttleTimer = window.setTimeout(() => {
          onFuturesUpdate({ ...pendingUpdates });
          pendingUpdates = {};
          throttleTimer = null;
        }, 1000);
      }

    } catch (e) {
      console.error("Futures WS Parse Error", e);
    }
  };

  return () => {
    ws.close();
    if (throttleTimer) clearTimeout(throttleTimer);
  };
};

// --- Binance Liquidations WebSocket Logic ---

type ForceOrderPayload = {
  e: string; // Event Type
  o: {
    s: string; // Symbol
    S: string; // Side of the FORCE ORDER (SELL = Long Liquidation, BUY = Short Liquidation)
    o: string; // Order Type
    q: string; // Original Quantity
    p: string; // Price
    ap: string; // Average Price
    X: string; // Status
    l: string; // Last Filled Quantity
    z: string; // Accumulated Filled Quantity
    T: number; // Trade Time
  }
};

export const connectToLiquidations = (
  onLiquidation: (liq: Liquidation) => void
) => {
  const ws = new WebSocket('wss://fstream.binance.com/ws/!forceOrder@arr');

  ws.onmessage = (event) => {
    try {
      const payload: ForceOrderPayload = JSON.parse(event.data);
      const o = payload.o;

      if (!o.s.endsWith('USDT')) return;

      const price = parseFloat(o.ap);
      const amount = parseFloat(o.q);
      const value = price * amount;

      // Filter tiny liquidations to reduce noise (e.g., < $500)
      if (value < 5000) return;

      const liq: Liquidation = {
        id: `${o.s}_${o.T}_${Math.random().toString(36).substring(7)}`,
        symbol: o.s,
        // If the Force Order is SELL, it means a LONG position is being closed.
        // If the Force Order is BUY, it means a SHORT position is being closed.
        side: o.S === 'SELL' ? 'LONG' : 'SHORT',
        price: price,
        amount: amount,
        value: value,
        time: o.T
      };

      onLiquidation(liq);

    } catch (e) {
      console.error("Liquidation WS Parse Error", e);
    }
  };

  return () => {
    ws.close();
  };
};

// --- Mock Signal Generator (Simulating Webhooks) ---

export const generateMockSignal = (tickers: Record<string, Ticker>): Signal | null => {
  // Only generate a signal for symbols we actually have price data for
  const availableSymbols = Object.keys(tickers).filter(s => DEFAULT_WATCHLIST.includes(s));

  if (availableSymbols.length === 0) return null;

  const randomSymbol = availableSymbols[Math.floor(Math.random() * availableSymbols.length)];
  const ticker = tickers[randomSymbol];

  // Random Strategy
  const strategy = STRATEGY_NAMES[Math.floor(Math.random() * STRATEGY_NAMES.length)];

  // Logic for RMI Side
  let side: Side = Math.random() > 0.5 ? 'BUY' : 'SELL';
  if (strategy === 'RMI_Oversold') side = 'BUY';
  if (strategy === 'RMI_Overbought') side = 'SELL';

  // Generate a "realistic" price close to current
  const variance = ticker.lastPrice * 0.001; // 0.1% variance
  const signalPrice = ticker.lastPrice + (Math.random() * variance * (Math.random() > 0.5 ? 1 : -1));

  let note = `Simulated Alert: ${strategy} triggered on 15m timeframe.`;

  // Custom notes for RMI to look realistic
  if (strategy.includes('RMI')) {
    const rmiVal = side === 'BUY' ? Math.floor(Math.random() * 20 + 10) : Math.floor(Math.random() * 20 + 70); // 10-30 or 70-90
    note = `RMI Value: ${rmiVal} - Momentum Reversal Likely`;
  }

  return {
    id: Math.random().toString(36).substring(7),
    strategy,
    symbol: randomSymbol,
    side,
    price: signalPrice,
    time: new Date().toISOString(),
    note
  };
};

// --- Global Index Simulator (BTC.D, NASDAQ, TOTAL, TOTAL3) ---

export const startGlobalIndicesMock = (onUpdate: (indices: MarketIndex[]) => void) => {
  // Initial Baselines
  const indices: Record<string, MarketIndex> = {
    'BTC.D': { symbol: 'BTC.D', price: 54.20, change: 0.12, changePercent: 0.22 },
    'NASDAQ': { symbol: 'NASDAQ', price: 17850.50, change: -45.20, changePercent: -0.25 },
    'S&P 500': { symbol: 'S&P 500', price: 5105.10, change: 12.50, changePercent: 0.24 },
    'USDT.D': { symbol: 'USDT.D', price: 4.85, change: -0.02, changePercent: -0.41 },
    'TOTAL': { symbol: 'TOTAL', price: 2350000000000, change: 15000000000, changePercent: 0.65 },
    'TOTAL3': { symbol: 'TOTAL3', price: 650000000000, change: -2000000000, changePercent: -0.30 },
  };

  const interval = setInterval(() => {
    // Random walk simulation
    Object.keys(indices).forEach(key => {
      const idx = indices[key];
      const volatility = idx.price * 0.0001; // 0.01% per tick
      const move = (Math.random() - 0.5) * volatility;

      idx.price += move;
      idx.change += move;
      idx.changePercent = (idx.change / (idx.price - idx.change)) * 100;
    });

    onUpdate(Object.values(indices));
  }, 2000);

  return () => clearInterval(interval);
};

// --- REST API: Fetch Historical Klines (Candles) ---

export interface Kline {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export const fetchKlines = async (symbol: string, interval: string = '15m', limit: number = 100): Promise<Kline[]> => {
  try {
    const response = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
    const data = await response.json();

    // Binance API returns array of arrays:
    // [
    //   [
    //     1499040000000,      // Open time
    //     "0.01634790",       // Open
    //     "0.80000000",       // High
    //     "0.01575800",       // Low
    //     "0.01577100",       // Close
    //     ...
    //   ]
    // ]

    return data.map((d: any) => ({
      time: d[0] / 1000, // Lightweight charts expects seconds (or business days)
      open: parseFloat(d[1]),
      high: parseFloat(d[2]),
      low: parseFloat(d[3]),
      close: parseFloat(d[4])
    }));
  } catch (error) {
    console.error("Failed to fetch klines", error);
    return [];
  }
};

// --- Open Interest & Anomaly Detection Service ---

export interface OpenInterestData {
  symbol: string;
  openInterest: number; // In Base Asset (e.g. BTC)
  openInterestValue: number; // In USDT
  time: number;
}

// Fetch Open Interest for a single symbol
export const fetchOpenInterest = async (symbol: string): Promise<OpenInterestData | null> => {
  try {
    const response = await fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`);
    const data = await response.json();
    return {
      symbol: data.symbol,
      openInterest: parseFloat(data.openInterest),
      openInterestValue: parseFloat(data.openInterest) * 0, // Value calc needs price but for now we trust the diff
      time: parseInt(data.time)
    };
  } catch (error) {
    return null;
  }
};

// Batch Polling for Open Interest
export const startOpenInterestPoller = (
  symbols: string[],
  onUpdate: (data: OpenInterestData[]) => void
) => {
  let isRunning = true;

  const poll = async () => {
    if (!isRunning) return;

    const chunkSize = 5;
    const results: OpenInterestData[] = [];

    for (let i = 0; i < symbols.length; i += chunkSize) {
      if (!isRunning) break;
      const chunk = symbols.slice(i, i + chunkSize);
      const promises = chunk.map(s => fetchOpenInterest(s));
      const chunkResults = await Promise.all(promises);

      chunkResults.forEach(r => {
        if (r) results.push(r);
      });

      await new Promise(resolve => setTimeout(resolve, 200));
    }

    if (isRunning) {
      onUpdate(results);
      setTimeout(poll, 30000);
    }
  };

  poll();

  return () => {
    isRunning = false;
  };
};