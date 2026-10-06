export const DEFAULT_WATCHLIST = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 
  'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'MATICUSDT'
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