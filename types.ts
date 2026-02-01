

export interface Ticker {
  symbol: string;
  lastPrice: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
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
  lastPrice?: number;
  highPrice?: number;
  lowPrice?: number;
  openPrice?: number;
  volume?: number;
  priceChangePercent?: number;
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

export interface BigMoveSignal {
  id: string;
  symbol: string;
  type: 'RISE' | 'FALL' | 'HIGH' | 'LOW' | 'PULLBACK' | 'RALLY' | 'VOL_SPIKE' | 'WHALE';
  timeframe?: '5m' | '15m' | '2h' | '24h' | '7d' | '30d';
  changePercent?: number;
  price: number;
  description: string;
  timestamp: number;
  level: 'SMALL' | 'MID' | 'HIGH';
}

export interface Signal {
  id: string;
  strategy: string;
  symbol: string;
  side: Side;
  price: number;
  time: string; // ISO string or HH:mm:ss
  note: string;
  confidence?: number;
  source?: 'WEBHOOK' | 'ALGO_MOMENTUM' | 'ALGO_DIVERGENCE' | 'ALGO_VOLUME' | 'MANUAL';
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

// User Management Types
export type UserRole = 'admin' | 'trader' | 'viewer' | 'analyst';
export type Permission = 'view_dashboard' | 'manage_trades' | 'manage_users' | 'view_analytics' | 'manage_settings';

export interface User {
  id: string;
  email: string;
  name: string;
  username: string;
  password: string;
  role: UserRole;
  status: 'active' | 'inactive';
  createdAt: number;
  updatedAt: number;
  permissions: Permission[];
  lastLogin?: number;
}

export interface UserActivity {
  id: string;
  userId: string;
  action: string;
  timestamp: number;
  details?: string;
}