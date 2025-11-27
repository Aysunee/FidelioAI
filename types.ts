

export interface Ticker {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  volume: number;
  updatedAt: number;
}

export interface FuturesTicker {
  symbol: string;
  markPrice: number;
  fundingRate: number; // 0.0001 = 0.01%
  nextFundingTime: number;
  indexPrice: number;
  // Computed for UI
  sessionStartRate?: number; // To track change since session started
  sessionChange?: number;
  lastTrend?: 'UP' | 'DOWN';
}

export interface MarketIndex {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
}

export type Side = 'BUY' | 'SELL' | 'LONG' | 'SHORT' | 'CLOSE';

export interface Signal {
  id: string;
  strategy: string;
  symbol: string;
  side: Side;
  price: number;
  time: string; // ISO string or HH:mm:ss
  note?: string;
  source?: string;
  confidence?: number;
}

export interface Liquidation {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT'; // The position side that got liquidated
  price: number;
  amount: number; // Quantity in original units
  value: number; // Value in USDT
  time: number;
}

export interface Holding {
  id: string;
  symbol: string;
  qty: number;
  costBasis: number;
}

export interface PortfolioSummary {
  totalValue: number;
  totalCost: number;
  totalPnL: number;
  pnlPercent: number;
}

export interface UserProfile {
  id: string;
  email: string;
  webhookSecret: string;
}

export interface NotificationRule {
  id: string;
  name: string;
  condition: {
    symbol: string; // Empty string means 'Any'
    side: Side | 'ANY';
  };
  channels: {
    inApp: boolean;
    browser: boolean;
  };
}

export interface PriceAlert {
  id: string;
  symbol: string;
  targetPrice: number;
  condition: 'ABOVE' | 'BELOW';
  isActive: boolean;
  createdAt: number;
}

export interface ToastMessage {
  id: string;
  title: string;
  description: string;
  type: 'success' | 'alert' | 'info';
}