import { Holding } from './types';

export const DEFAULT_WATCHLIST = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 
  'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'MATICUSDT'
];

export const MOCK_HOLDINGS: Holding[] = [
  { id: '1', symbol: 'BTCUSDT', qty: 0.45, costBasis: 62000 },
  { id: '2', symbol: 'ETHUSDT', qty: 5.2, costBasis: 3100 },
  { id: '3', symbol: 'SOLUSDT', qty: 150, costBasis: 85 },
];

export const STRATEGY_NAMES = [
  'RSI_Oversold', 
  'MACD_Cross', 
  'BB_Breakout', 
  'Trend_Follower_V2',
  'RMI_Oversold',   // Added RMI
  'RMI_Overbought'  // Added RMI
];

export const BINANCE_WS_URL = 'wss://stream.binance.com:9443/ws/!miniTicker@arr';