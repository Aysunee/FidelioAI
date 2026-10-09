

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

// 'NEUTRAL' = a record without a direction (label 'Yönsüz', no colour / arrow). On signals produced
// by the local engines BUY / SELL is the DIRECTION OF THE MEASURED MOVE (up / down), never advice.
export type Side = 'BUY' | 'SELL' | 'LONG' | 'SHORT' | 'CLOSE' | 'NEUTRAL';

export interface BigMoveSignal {
  id: string;
  symbol: string;
  type: 'RISE' | 'FALL' | 'HIGH' | 'LOW' | 'PULLBACK' | 'RALLY' | 'VOL_SPIKE' | 'WHALE';
  timeframe?: '1m' | '5m' | '15m' | '2h' | '24h' | '7d' | '30d';
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
  // Only shared (webhook / manual) signals may carry a confidence. The local engines never write
  // one: they report the measured size in `magnitude` instead.
  confidence?: number;
  // 'ALGO_DIVERGENCE' is the legacy source key of the funding engine.
  source?: 'WEBHOOK' | 'ALGO_MOMENTUM' | 'ALGO_DIVERGENCE' | 'ALGO_VOLUME' | 'MANUAL';
  // Which engine produced the record. Local engines always set it together with `magnitude`.
  engine?: 'MOMENTUM' | 'VOLUME' | 'FUNDING' | 'WEBHOOK' | 'MANUAL';
  // The measured size behind the record, e.g. { value: 9.1, text: '+9.1%', caption: '24s değişim, yeni 24s zirve' },
  // { value: 5.4, text: '5.4x', caption: 'son 1 saat hacmi / 24s ortalama saat' },
  // { value: -0.0712, text: '−0.0712%', caption: '8s eşdeğeri fonlama' }.
  magnitude?: { value: number; text: string; caption: string };
  // What happened after the signal (forward tracking, signal_outcomes). Missing for market-wide
  // records, browser-local entries and servers without the outcome table.
  outcome?: SignalOutcome;
}

// One measured horizon after a signal. Every value is a fraction (0.0123 = +1.23 %).
// raw = close / signal price − 1; ret = raw in the signal's direction; net = ret − round-trip cost;
// excess = direction × (raw − BTC over the same window); mfe / mae = best / worst excursion on the path
// (direction-signed; for a NEUTRAL record the highest high and the lowest low against the signal price).
// ret / net / excess are null for NEUTRAL records. `error` = the horizon could not be measured.
export interface SignalOutcomeHorizon {
  raw: number | null;
  ret: number | null;
  net: number | null;
  excess: number | null;
  mfe: number | null;
  mae: number | null;
  closeAt: number | null;
  resolvedAt: number | null;
  error?: string;
}

export type SignalOutcomeStatus = 'pending' | 'partial' | 'done' | 'skipped';

// Horizons: 15 minutes, 1 hour, 4 hours, 24 hours. null = not resolved (yet).
export interface SignalOutcome {
  status: SignalOutcomeStatus;
  h15: SignalOutcomeHorizon | null;
  h60: SignalOutcomeHorizon | null;
  h240: SignalOutcomeHorizon | null;
  h1440: SignalOutcomeHorizon | null;
  note?: string; // server note, e.g. why the record is skipped or a horizon has a gap
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
  // Never returned by the API; only set in the add/edit user form when (re)setting a password.
  password?: string;
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