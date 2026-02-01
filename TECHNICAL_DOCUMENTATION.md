# FidelioAI - Complete Technical Documentation

## 📋 Project Overview

**FidelioAI** is a professional-grade cryptocurrency trading platform that provides real-time market analysis, anomaly detection, pattern recognition, and AI-driven signals for cryptocurrency traders. Built with React, TypeScript, and WebSocket connections to Binance.

---

## 🏗️ Architecture Overview

### Technology Stack
- **Frontend Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **State Management**: React Context API (4 specialized contexts)
- **Styling**: Vanilla CSS with Glassmorphism design
- **Animations**: Framer Motion
- **Charts**: Lightweight Charts (TradingView library)
- **WebSocket**: Native WebSocket + Socket.io
- **Data Source**: Binance WebSocket API (Spot, Futures, Liquidations)

### Project Structure
```
FidelioAI/
├── components/           # React components (24 files)
│   ├── ui/              # Reusable UI components
│   ├── FidelioRadar.tsx # Main market scanner
│   ├── AnomalyRadar.tsx # Anomaly detection display
│   ├── SpotScanner.tsx  # Spot market scanner
│   ├── FundingRates.tsx # Derivatives overview
│   ├── Portfolio.tsx    # Portfolio tracker
│   ├── SignalManager.tsx# Signal management
│   ├── MultiChartGrid.tsx# Multi-chart view
│   ├── FidelioAI.tsx    # AI analysis component
│   └── WebhookManager.tsx# Webhook integration
├── context/             # State management contexts
│   ├── MarketContext.tsx   # Market data & WebSocket
│   ├── UserContext.tsx     # User preferences & theme
│   ├── SignalContext.tsx   # Signal generation & alerts
│   └── PortfolioContext.tsx# Portfolio management
├── services/            # External services
│   ├── marketData.ts    # Binance WebSocket connections
│   ├── patternScanner.ts# Chart pattern detection
│   └── aiService.ts     # AI integration
├── utils/               # Utility functions
│   ├── AnomalyLogic.ts  # Anomaly detection algorithms
│   ├── patternRecognition.ts # Technical pattern detection
│   ├── notifications.ts # Notification & audio system
│   └── formatters.ts    # Data formatting utilities
├── types.ts             # TypeScript type definitions
├── constants.ts         # Application constants
└── App.tsx             # Main application component
```

---

## 🎯 Core Features & Implementation Details

### 1. Real-Time Market Data System

#### MarketContext.tsx
**Purpose**: Manages all real-time market data via WebSocket connections

**State Management**:
```typescript
interface MarketContextType {
    marketData: Record<string, Ticker>;           // Spot market data
    futuresData: Record<string, FuturesTicker>;   // Futures market data
    indicesData: MarketIndex[];                   // Market indices (BTC.D, etc.)
    liquidations: Liquidation[];                  // Recent liquidations
    connectionStatus: 'connected' | 'disconnected' | 'connecting';
    fundingHistory: Record<string, { time: number, rate: number }[]>; // Historical funding rates
}
```

**WebSocket Connections**:
1. **Spot Market** (`connectToBinance`):
   - Endpoint: `wss://stream.binance.com:9443/ws/!miniTicker@arr`
   - Updates: All USDT pairs mini ticker data
   - Frequency: Real-time (sub-second updates)
   - Data: Price, volume, 24h change, high/low

2. **Futures Market** (`connectToBinanceFutures`):
   - Endpoint: `wss://fstream.binance.com/ws/!markPrice@arr@1s`
   - Updates: Mark price, funding rate, index price
   - Frequency: Every 1 second
   - Data: Funding rates, next funding time, mark price

3. **Liquidations** (`connectToLiquidations`):
   - Endpoint: `wss://fstream.binance.com/ws/!forceOrder@arr`
   - Updates: Real-time liquidation events
   - Data: Symbol, side (LONG/SHORT), price, quantity, value

**Funding History System**:
- Snapshots funding rates every 60 seconds
- Stores last 120 data points (2 hours) per symbol
- Persists to localStorage for trend analysis
- Used for funding rate velocity calculations

---

### 2. Signal Generation System

#### SignalContext.tsx
**Purpose**: Generates trading signals using multiple algorithms

**Signal Types & Algorithms**:

##### A. Volume Spike Detection
```typescript
Algorithm: checkVolumeSpikes()
Trigger Conditions:
- Current volume > 3x average volume (configurable threshold)
- Cooldown: 60 seconds per symbol
- Window: Compares current vs last 10 tickers

Signal Generation:
- BUY signal: Volume spike + price increase > 0.5%
- SELL signal: Volume spike + price decrease < -0.5%
- Confidence: 70-85% based on volume multiplier
```

##### B. Momentum Detection (RMI - Relative Momentum Index)
```typescript
Algorithm: checkRMI()
Calculation:
- Tracks price changes over 14 periods
- Calculates up/down momentum ratio
- RMI = 100 - (100 / (1 + upMomentum/downMomentum))

Trigger Conditions:
- RMI > 70: Overbought → SELL signal
- RMI < 30: Oversold → BUY signal
- Cooldown: 120 seconds per symbol
```

##### C. Futures/Spot Divergence Detection
```typescript
Algorithm: checkDivergence()
Trigger Conditions:
- Funding rate extremes: > 0.05% or < -0.05%
- Price divergence: Futures vs Spot > 0.3%

Signal Types:
- Positive funding + price premium → SHORT signal (long squeeze risk)
- Negative funding + price discount → LONG signal (short squeeze opportunity)
```

##### D. Big Move Detection (Spot)
```typescript
Algorithm: scanBigMoves()
Timeframes: 5m, 15m, 2h, 24h, 7d, 30d

Detection Types:
1. RISE/FALL: Significant price changes
   - 5m: ±2%, 15m: ±3%, 2h: ±5%, 24h: ±8%, 7d: ±15%, 30d: ±25%

2. HIGH/LOW: New price extremes
   - 24h high/low breakouts

3. PULLBACK/RALLY: Reversal patterns
   - Pullback: -5% from recent high, then +2% recovery
   - Rally: +5% from recent low, then continuation

4. VOL_SPIKE: Abnormal volume
   - Volume > 5x average

5. WHALE: Large volume moves
   - Volume > 10x average + price change > 3%

Severity Levels:
- SMALL: 2-5% moves
- MID: 5-10% moves
- HIGH: >10% moves
```

##### E. Big Move Detection (Futures/Perpetuals)
```typescript
Algorithm: scanFuturesBigMoves()
Similar to spot but includes:
- Funding rate analysis
- Open interest correlation
- Mark price vs index price divergence
```

##### F. Pattern Recognition
```typescript
Service: patternScanner.ts
Patterns Detected:
1. Bull Flag:
   - Strong uptrend (pole)
   - Consolidation (flag)
   - Breakout potential

2. Bear Flag:
   - Strong downtrend (pole)
   - Consolidation (flag)
   - Breakdown potential

Detection Method:
- Fetches 100 candles (15m timeframe)
- Analyzes slope, consolidation, volume
- Confidence scoring based on pattern clarity
```

**Signal Storage & Persistence**:
- Stores last 50 signals in localStorage
- Auto-cleanup of old signals
- Deduplication based on symbol + strategy + time window

---

### 3. Anomaly Detection System

#### AnomalyLogic.ts
**Purpose**: Detects market anomalies and unusual patterns

**Anomaly Types**:

##### A. Correlation Decoupling
```typescript
Algorithm: detectDecoupling()
Purpose: Find assets moving against BTC

Conditions:
1. Strength Signal:
   - BTC dumping < -0.8%
   - Coin pumping > +1.5%
   - Severity: HIGH, Score: 85

2. Weakness Signal:
   - BTC pumping > +0.8%
   - Coin dumping < -1.5%
   - Severity: MEDIUM, Score: 70

Use Case: Identify independent strength/weakness
```

##### B. Open Interest Squeeze
```typescript
Algorithm: detectOiSqueeze()
Purpose: Detect position buildup before explosive moves

Conditions:
- Price change < 1% (consolidation)
- Open Interest increase > 3%
- Severity: HIGH, Score: 90

Interpretation: Traders building positions → potential breakout
```

##### C. Funding Arbitrage (Short Squeeze Risk)
```typescript
Algorithm: detectFundingArbitrage()
Purpose: Detect short squeeze setups

Conditions:
- Price increase > 3%
- Funding rate < -0.01% (negative)
- Severity: HIGH, Score: 95

Interpretation: Price rising while shorts pay longs → squeeze potential
```

##### D. Funding Trend Analysis
```typescript
Class: FundingAnalyzer
Purpose: Analyze funding rate velocity and direction

Calculation:
- Looks back 1 hour in funding history
- Calculates rate change per hour (velocity)
- Threshold: 0.0005 (0.05% per hour)

Directions:
- DIVING: Rate decreasing (short squeeze risk)
- SPIKING: Rate increasing (long squeeze risk)
- STABLE: Minimal change

Intensity Score: 0-100 based on velocity magnitude
```

---

### 4. Notification System

#### notifications.ts
**Purpose**: Multi-channel notification delivery with audio

**Features**:
1. **Audio Notifications**:
   - Web Audio API integration
   - Multiple sound types (alert, success, warning)
   - Volume control (0-100%)
   - Auto-resume on user interaction (browser policy compliance)

2. **Browser Notifications**:
   - Native browser notification API
   - Permission request handling
   - Icon and badge support

3. **Toast Notifications**:
   - In-app popup messages
   - 3 types: success, alert, info
   - Auto-dismiss after 5 seconds
   - Stack management (max 5 visible)

4. **Notification Manager**:
```typescript
class NotificationManager {
    - audioContext: AudioContext
    - soundEnabled: boolean
    - volume: number (0-1)
    
    Methods:
    - playSound(type): Plays notification sound
    - resumeAudioContext(): Resumes audio (browser requirement)
    - requestPermission(): Requests browser notification permission
}
```

**Notification Routing**:
```typescript
Signal Type → Notification Handler
- Volume Spike → notifySignal() → Audio + Toast + Browser
- Big Move → notifyBigMove() → Audio + Toast
- Price Alert → notifyPriceAlert() → Audio + Toast + Browser
- Pattern Detection → notifySignal() → Audio + Toast
```

---

### 5. User Preference System

#### UserContext.tsx
**Purpose**: Manages user settings, theme, and authentication

**State**:
```typescript
interface UserContextType {
    theme: 'light' | 'dark' | 'corporate' | 'labs';
    visualMode: 'vibrant' | 'minimal';
    viewMode: string; // Current page/view
    watchlist: string[]; // Favorite symbols
    isAuthenticated: boolean;
    // ... methods
}
```

**Theme System**:
1. **Dark Theme** (Default):
   - Background: Black/Gray-950
   - Accent: Purple-400 to Amber-400 gradient
   - Glassmorphism effects
   - Neon glow shadows

2. **Corporate Theme**:
   - Background: White/Light gray
   - Accent: Violet-600 to Purple-600
   - Professional, clean design
   - Subtle shadows

3. **Labs Theme**:
   - Background: Light gray (#F0F2F5)
   - Accent: Google colors (Blue, Red, Yellow, Green)
   - Monospace font
   - Experimental feel

4. **Light Theme**:
   - Background: White
   - Accent: Purple to Amber
   - High contrast

**Visual Modes**:
- **Vibrant**: Full effects, gradients, glows, animations
- **Minimal**: Reduced effects, simpler design, better performance

**Persistence**:
- All preferences saved to localStorage
- Auto-restore on app load
- Keys: `fidelio_theme`, `fidelio_watchlist`, `fidelio_visual_mode`, etc.

---

### 6. Portfolio Management

#### PortfolioContext.tsx
**Purpose**: Track holdings and trade history

**Features**:
1. **Holdings Management**:
   - Add/remove assets
   - Track quantity and cost basis
   - Real-time P&L calculation
   - Percentage gain/loss

2. **Trade History**:
   - Log all trades (buy/sell)
   - Timestamp tracking
   - Price and quantity recording
   - Export capability

3. **Portfolio Summary**:
```typescript
interface PortfolioSummary {
    totalValue: number;      // Current market value
    totalCost: number;       // Total invested
    totalPnL: number;        // Profit/Loss in USD
    pnlPercent: number;      // P&L percentage
}
```

4. **Data Persistence**:
   - localStorage: `fidelio_holdings`, `fidelio_trades`
   - JSON serialization
   - Auto-save on changes

---

### 7. Chart System

#### CandleChart.tsx
**Purpose**: Display professional candlestick charts

**Implementation**:
- Library: `lightweight-charts` (TradingView)
- Data source: Binance REST API (`/api/v3/klines`)
- Default: 15-minute candles, 100 bars
- Features:
  - Candlestick series
  - Volume histogram
  - Responsive sizing
  - Theme-aware colors
  - Real-time updates

**Chart Configuration**:
```typescript
{
    layout: {
        background: transparent,
        textColor: theme-based
    },
    grid: {
        vertLines: { color: 'rgba(255,255,255,0.05)' },
        horzLines: { color: 'rgba(255,255,255,0.05)' }
    },
    crosshair: { mode: CrosshairMode.Normal },
    timeScale: { timeVisible: true, secondsVisible: false }
}
```

---

### 8. Multi-Chart Command Center

#### MultiChartGrid.tsx
**Purpose**: Display multiple charts simultaneously

**Features**:
- 2x2 grid layout
- Independent symbol selection per chart
- Synchronized timeframes
- Resizable panels (future enhancement)
- Minimal, frameless design
- Floating controls

**Use Case**: Professional traders monitoring multiple assets

---

### 9. Webhook Integration

#### WebhookManager.tsx
**Purpose**: Receive signals from TradingView and external sources

**Features**:
1. **Webhook Endpoint**:
   - Backend server receives POST requests
   - Validates webhook secret
   - Parses TradingView alert format

2. **Manual Signal Creation**:
   - UI for creating test signals
   - Strategy selection
   - Symbol, side, price input
   - Confidence level

3. **Signal Format**:
```json
{
    "strategy": "RSI_DIVERGENCE",
    "symbol": "BTCUSDT",
    "side": "BUY",
    "price": 45000,
    "note": "Bullish divergence on 4H",
    "confidence": 85
}
```

4. **TradingView Integration**:
   - Alert message format: JSON
   - Webhook URL: `http://your-server/api/webhook`
   - Secret authentication

---

### 10. AI Analysis Component

#### FidelioAI.tsx
**Purpose**: AI-driven market analysis and insights

**Features** (Planned/Partial):
1. **Market Sentiment Analysis**:
   - Analyzes overall market conditions
   - Bull/bear/neutral classification
   - Confidence scoring

2. **Pattern Suggestions**:
   - AI identifies potential patterns
   - Recommends entry/exit points
   - Risk assessment

3. **Correlation Analysis**:
   - Cross-asset correlation matrix
   - Sector strength analysis
   - Leading indicator identification

4. **Integration**:
   - Uses `aiService.ts` for API calls
   - Gemini API integration (configurable)
   - Real-time data feeding

---

## 🎨 Design System

### Color Palette

#### Dark Theme
```css
Primary Gradient: linear-gradient(to right, #a855f7, #fbbf24)
Background: #000000, #030712
Glass: rgba(255, 255, 255, 0.05)
Border: rgba(255, 255, 255, 0.1)
Text: #e5e7eb, #9ca3af
Glow: rgba(168, 85, 247, 0.4)
```

#### Corporate Theme
```css
Primary Gradient: linear-gradient(to right, #7c3aed, #9333ea)
Background: #ffffff, #fafbfc
Glass: rgba(0, 0, 0, 0.02)
Border: #e5e7eb
Text: #111827, #6b7280
Shadow: rgba(0, 0, 0, 0.1)
```

#### Labs Theme
```css
Primary: #4285F4 (Google Blue)
Secondary: #EA4335 (Google Red)
Accent: #FBBC04 (Google Yellow)
Success: #34A853 (Google Green)
Background: #F0F2F5
Text: #1F2937
Font: Monospace
```

### Component Styling

#### GlassCard
```css
background: rgba(255, 255, 255, 0.03)
backdrop-filter: blur(20px)
border: 1px solid rgba(255, 255, 255, 0.1)
border-radius: 16px
box-shadow: 0 0 40px rgba(168, 85, 247, 0.1)
```

#### Buttons
```css
Primary: gradient background, white text, glow shadow
Secondary: glass background, gradient text
Hover: scale(1.02), increased glow
Active: scale(0.98)
Transition: all 0.2s ease
```

#### Typography
```css
Headings: font-display, bold, gradient text
Body: font-sans, regular, gray text
Code: font-mono, smaller size
Numbers: tabular-nums for alignment
```

### Animations

#### Framer Motion Variants
```typescript
Page Transitions:
- initial: { opacity: 0, x: -20 }
- animate: { opacity: 1, x: 0 }
- exit: { opacity: 0, x: 20 }
- duration: 0.3s

Card Hover:
- whileHover: { scale: 1.02, y: -2 }
- transition: { type: 'spring', stiffness: 300 }

Button Press:
- whileTap: { scale: 0.98 }
```

---

## 📊 Data Types & Interfaces

### Core Types (types.ts)

```typescript
// Market Data
interface Ticker {
    symbol: string;
    lastPrice: number;
    openPrice: number;
    highPrice: number;
    lowPrice: number;
    priceChangePercent: number;
    volume: number;
    updatedAt: number;
}

interface FuturesTicker {
    symbol: string;
    markPrice: number;
    fundingRate: number;
    nextFundingTime: number;
    indexPrice: number;
    sessionStartRate?: number;
    sessionChange?: number;
    lastTrend?: 'UP' | 'DOWN';
}

// Signals
interface Signal {
    id: string;
    strategy: string;
    symbol: string;
    side: 'BUY' | 'SELL' | 'LONG' | 'SHORT' | 'CLOSE';
    price: number;
    time: string;
    note: string;
    confidence?: number;
    source?: 'WEBHOOK' | 'ALGO_MOMENTUM' | 'ALGO_DIVERGENCE' | 'ALGO_VOLUME' | 'MANUAL';
}

// Big Moves
interface BigMoveSignal {
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

// Liquidations
interface Liquidation {
    id: string;
    symbol: string;
    side: 'LONG' | 'SHORT';
    price: number;
    amount: number;
    value: number;
    time: number;
}

// Alerts
interface PriceAlert {
    id: string;
    symbol: string;
    targetPrice: number;
    condition: 'ABOVE' | 'BELOW';
    isActive: boolean;
    createdAt: number;
}

// Portfolio
interface Holding {
    id: string;
    symbol: string;
    qty: number;
    costBasis: number;
}

// Notifications
interface NotificationRule {
    id: string;
    name: string;
    condition: {
        symbol: string;
        side: Side | 'ANY';
    };
    channels: {
        inApp: boolean;
        browser: boolean;
    };
}
```

---

## 🔧 Configuration & Constants

### constants.ts
```typescript
// Default watchlist symbols
DEFAULT_WATCHLIST = [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT',
    'ADAUSDT', 'DOGEUSDT', 'XRPUSDT', 'DOTUSDT'
]

// Strategy names for display
STRATEGY_NAMES = {
    'RSI_DIVERGENCE': 'RSI Divergence',
    'MACD_CROSS': 'MACD Crossover',
    'VOLUME_BREAKOUT': 'Volume Breakout',
    // ... more strategies
}

// Binance WebSocket URLs
BINANCE_WS_SPOT = 'wss://stream.binance.com:9443/ws'
BINANCE_WS_FUTURES = 'wss://fstream.binance.com/ws'

// API Endpoints
BINANCE_API = 'https://api.binance.com/api/v3'
BINANCE_FUTURES_API = 'https://fapi.binance.com/fapi/v1'
```

---

## 🚀 Setup & Deployment

### Installation
```bash
# Clone repository
git clone <repository-url>
cd FidelioAI

# Install dependencies
npm install

# Set environment variables
echo "GEMINI_API_KEY=your_api_key_here" > .env.local

# Run development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Dependencies
```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "framer-motion": "^10.x",
    "lightweight-charts": "^4.x",
    "socket.io-client": "^4.x",
    "lucide-react": "^0.x"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.0.0",
    "typescript": "^5.0.0",
    "vite": "^4.4.0"
  }
}
```

### Environment Variables
```env
GEMINI_API_KEY=your_gemini_api_key
VITE_WEBHOOK_SECRET=your_webhook_secret
VITE_BACKEND_URL=http://localhost:3000
```

---

## 🎯 Key Algorithms & Logic

### 1. Volume Spike Detection
```typescript
// Pseudocode
function detectVolumeSpike(currentVolume, historicalVolumes) {
    avgVolume = average(historicalVolumes)
    threshold = 3.0 // 3x average
    
    if (currentVolume > avgVolume * threshold) {
        volumeMultiplier = currentVolume / avgVolume
        confidence = min(70 + (volumeMultiplier - 3) * 5, 95)
        
        if (priceChange > 0.5%) {
            return { side: 'BUY', confidence }
        } else if (priceChange < -0.5%) {
            return { side: 'SELL', confidence }
        }
    }
    
    return null
}
```

### 2. RMI Calculation
```typescript
// Relative Momentum Index
function calculateRMI(prices, period = 14) {
    upMoves = []
    downMoves = []
    
    for (i = 1; i < prices.length; i++) {
        change = prices[i] - prices[i-1]
        if (change > 0) {
            upMoves.push(change)
            downMoves.push(0)
        } else {
            upMoves.push(0)
            downMoves.push(abs(change))
        }
    }
    
    avgUp = average(upMoves.slice(-period))
    avgDown = average(downMoves.slice(-period))
    
    if (avgDown === 0) return 100
    
    rs = avgUp / avgDown
    rmi = 100 - (100 / (1 + rs))
    
    return rmi
}
```

### 3. Pattern Recognition (Bull Flag)
```typescript
function detectBullFlag(candles) {
    // 1. Find the pole (strong uptrend)
    poleCandles = candles.slice(0, 20)
    poleSlope = calculateSlope(poleCandles)
    
    if (poleSlope < 0.5) return null // Not strong enough
    
    // 2. Find the flag (consolidation)
    flagCandles = candles.slice(20, 40)
    flagSlope = calculateSlope(flagCandles)
    flagVolatility = calculateVolatility(flagCandles)
    
    if (abs(flagSlope) > 0.2) return null // Not consolidating
    if (flagVolatility > 0.5) return null // Too volatile
    
    // 3. Check volume (should decrease in flag)
    poleVolume = average(poleCandles.map(c => c.volume))
    flagVolume = average(flagCandles.map(c => c.volume))
    
    if (flagVolume > poleVolume * 0.7) return null
    
    // Pattern confirmed
    confidence = calculateConfidence(poleSlope, flagSlope, volumeRatio)
    
    return {
        type: 'BULL_FLAG',
        confidence,
        entryPrice: candles[candles.length - 1].close,
        target: entryPrice + (poleHeight * 1.0) // Pole height projection
    }
}
```

### 4. Funding Rate Velocity
```typescript
function calculateFundingVelocity(history, timeWindowHours = 1) {
    if (history.length < 2) return 0
    
    now = Date.now()
    targetTime = now - (timeWindowHours * 60 * 60 * 1000)
    
    latest = history[history.length - 1]
    past = findClosestPoint(history, targetTime)
    
    timeDiffHours = (latest.time - past.time) / (1000 * 60 * 60)
    rateDiff = latest.rate - past.rate
    
    velocity = rateDiff / timeDiffHours // Rate change per hour
    
    return velocity
}
```

---

## 📱 Component Details

### FidelioRadar Component
**Purpose**: Main market scanner and signal aggregator

**Sections**:
1. **Header**: Active signals count, last update time
2. **Signal Radar Panel**: Top 3 most significant signals
3. **Pattern Detection**: Bull/Bear flags with confidence
4. **Big Moves**: Recent significant price movements
5. **Volume Spikes**: Abnormal volume alerts

**Update Frequency**: Real-time (WebSocket driven)

### AnomalyRadar Component
**Purpose**: Display market anomalies

**Tabs**:
1. **Active Anomalies**: Current detected anomalies
2. **Funding Trends**: Funding rate velocity analysis
3. **Correlation Matrix**: Asset correlation heatmap

**Filters**:
- Severity: LOW, MEDIUM, HIGH
- Type: Decoupling, OI Squeeze, Funding Arbitrage
- Time range: Last 1h, 4h, 24h

### SpotScanner Component
**Purpose**: Comprehensive spot market scanner

**Features**:
- Real-time price table
- Sortable columns (price, volume, change %)
- Search/filter by symbol
- Quick add to watchlist
- Set price alerts
- View detailed charts

**Columns**:
- Symbol
- Price
- 24h Change %
- 24h Volume
- 24h High/Low
- Actions (watchlist, alert, chart)

### FundingRates Component
**Purpose**: Derivatives market overview

**Features**:
1. **Signal Table** (Top section):
   - Buy/Sell signals from derivatives
   - Theme-aware styling
   - Always visible

2. **Main Table**:
   - Symbol, Mark Price, Funding Rate
   - Next funding time countdown
   - Funding rate trend (UP/DOWN arrows)
   - Historical funding chart on row click

3. **Detail Card**:
   - Appears on row selection
   - Funding rate history chart
   - Spot vs Futures price comparison
   - Open Interest data (if available)

4. **Alerts Panel**:
   - Set funding rate alerts
   - Notify when rate crosses threshold

### Portfolio Component
**Purpose**: Track holdings and performance

**Sections**:
1. **Summary Card**:
   - Total portfolio value
   - Total cost basis
   - Total P&L (USD and %)
   - Color-coded (green profit, red loss)

2. **Holdings Table**:
   - Symbol, Quantity, Cost Basis
   - Current Price, Current Value
   - P&L per holding
   - Actions: Edit, Remove

3. **Add Holding Form**:
   - Symbol input (autocomplete)
   - Quantity
   - Cost basis per unit
   - Add button

4. **Trade History**:
   - Chronological trade log
   - Buy/Sell indicator
   - Price, quantity, timestamp
   - Export to CSV

### SignalManager Component
**Purpose**: Manage all generated signals

**Features**:
1. **Filters**:
   - By strategy
   - By symbol
   - By side (BUY/SELL/LONG/SHORT)
   - By source (WEBHOOK, ALGO, MANUAL)
   - By date range

2. **Signal List**:
   - Card-based layout
   - Color-coded by side
   - Confidence badge
   - Timestamp
   - Delete individual signal

3. **Bulk Actions**:
   - Clear all signals
   - Export signals to JSON
   - Import signals from file

4. **Statistics**:
   - Total signals count
   - Win rate (if trade outcomes tracked)
   - Most active strategy
   - Most traded symbol

### MultiChartGrid Component
**Purpose**: Professional multi-chart view

**Layout**: 2x2 grid (4 charts)

**Per-Chart Controls**:
- Symbol selector dropdown
- Timeframe selector (1m, 5m, 15m, 1h, 4h, 1D)
- Maximize/minimize button
- Refresh button

**Features**:
- Independent symbol per chart
- Synchronized timeframes (optional)
- Real-time candle updates
- Volume histogram
- Responsive resizing

### WebhookManager Component
**Purpose**: Webhook testing and manual signals

**Sections**:
1. **Webhook Info**:
   - Your webhook URL
   - Secret key (masked)
   - Copy to clipboard button
   - TradingView setup instructions

2. **Manual Signal Creator**:
   - Strategy dropdown
   - Symbol input
   - Side selector (BUY/SELL/LONG/SHORT)
   - Price input
   - Note textarea
   - Confidence slider
   - Send button

3. **Recent Webhooks**:
   - Last 20 received webhooks
   - Timestamp, source, payload
   - Success/failure indicator

4. **Test Webhook**:
   - Send test payload
   - Verify server connection
   - Debug mode

---

## 🔐 Security & Best Practices

### API Key Management
- Store API keys in `.env.local` (never commit)
- Use environment variables in code
- Rotate keys regularly
- Limit API key permissions (read-only for market data)

### WebSocket Security
- Use WSS (secure WebSocket) in production
- Implement reconnection logic with exponential backoff
- Validate all incoming data
- Handle connection errors gracefully

### Data Validation
- Validate all user inputs
- Sanitize data before localStorage
- Type-check WebSocket payloads
- Handle malformed data gracefully

### Performance Optimization
- Debounce rapid state updates
- Memoize expensive calculations
- Lazy load components
- Virtualize long lists
- Optimize re-renders with React.memo

### Error Handling
- Try-catch blocks for async operations
- Fallback UI for errors
- Log errors to console (or external service)
- User-friendly error messages

---

## 🧪 Testing Strategy

### Unit Tests
- Test utility functions (formatters, calculations)
- Test anomaly detection algorithms
- Test pattern recognition logic
- Mock WebSocket connections

### Integration Tests
- Test Context providers
- Test component interactions
- Test data flow between contexts
- Test localStorage persistence

### E2E Tests
- Test complete user flows
- Test signal generation pipeline
- Test notification delivery
- Test chart rendering

---

## 🚀 Future Enhancements

### Planned Features
1. **Backtesting Engine**:
   - Test strategies on historical data
   - Performance metrics
   - Optimization tools

2. **Advanced AI**:
   - Sentiment analysis from news/social media
   - Predictive modeling
   - Auto-trading suggestions

3. **Mobile App**:
   - React Native version
   - Push notifications
   - Simplified UI

4. **Social Features**:
   - Share signals with community
   - Follow top traders
   - Signal marketplace

5. **Advanced Charts**:
   - Drawing tools
   - Technical indicators (RSI, MACD, Bollinger Bands)
   - Multiple timeframes on one chart
   - Compare symbols

6. **Risk Management**:
   - Position sizing calculator
   - Stop-loss/take-profit suggestions
   - Portfolio risk analysis
   - Correlation-based diversification

7. **Exchange Integration**:
   - Direct trading via API
   - Order management
   - Trade execution from signals
   - Multi-exchange support

8. **Custom Strategies**:
   - Strategy builder UI
   - Backtesting custom strategies
   - Strategy sharing
   - Performance leaderboard

---

## 📚 API Reference

### Binance WebSocket Streams

#### Spot Market (Mini Ticker)
```
Endpoint: wss://stream.binance.com:9443/ws/!miniTicker@arr

Payload:
{
    "e": "24hrMiniTicker",
    "E": 1234567890,      // Event time
    "s": "BTCUSDT",       // Symbol
    "c": "45000.00",      // Close price
    "o": "44000.00",      // Open price
    "h": "46000.00",      // High price
    "l": "43000.00",      // Low price
    "v": "1234.56",       // Total traded base asset volume
    "q": "55000000.00"    // Total traded quote asset volume
}
```

#### Futures Market (Mark Price)
```
Endpoint: wss://fstream.binance.com/ws/!markPrice@arr@1s

Payload:
{
    "e": "markPriceUpdate",
    "E": 1234567890,      // Event time
    "s": "BTCUSDT",       // Symbol
    "p": "45000.00",      // Mark price
    "i": "44995.00",      // Index price
    "P": "0.00010000",    // Estimated settle price
    "r": "0.00010000",    // Funding rate
    "T": 1234567890       // Next funding time
}
```

#### Liquidations
```
Endpoint: wss://fstream.binance.com/ws/!forceOrder@arr

Payload:
{
    "e": "forceOrder",
    "E": 1234567890,
    "o": {
        "s": "BTCUSDT",   // Symbol
        "S": "SELL",      // Side (SELL = Long liq, BUY = Short liq)
        "o": "LIMIT",     // Order type
        "q": "1.234",     // Original quantity
        "p": "45000.00",  // Price
        "ap": "45000.00", // Average price
        "X": "FILLED",    // Order status
        "l": "1.234",     // Last filled quantity
        "z": "1.234",     // Accumulated filled quantity
        "T": 1234567890   // Trade time
    }
}
```

### Binance REST API

#### Get Klines (Candlestick Data)
```
GET https://api.binance.com/api/v3/klines

Parameters:
- symbol: BTCUSDT (required)
- interval: 1m, 5m, 15m, 1h, 4h, 1d, etc. (required)
- limit: Number of candles (default 500, max 1000)
- startTime: Timestamp in ms
- endTime: Timestamp in ms

Response:
[
    [
        1234567890,      // Open time
        "45000.00",      // Open
        "46000.00",      // High
        "44000.00",      // Low
        "45500.00",      // Close
        "1234.56",       // Volume
        1234567899,      // Close time
        "55000000.00",   // Quote asset volume
        1000,            // Number of trades
        "600.00",        // Taker buy base asset volume
        "27000000.00",   // Taker buy quote asset volume
        "0"              // Ignore
    ],
    // ... more candles
]
```

#### Get Open Interest
```
GET https://fapi.binance.com/fapi/v1/openInterest

Parameters:
- symbol: BTCUSDT (required)

Response:
{
    "openInterest": "123456.789",
    "symbol": "BTCUSDT",
    "time": 1234567890
}
```

---

## 🎓 Usage Examples

### Adding a New Signal Strategy

```typescript
// 1. Define strategy in SignalContext.tsx
const checkCustomStrategy = useCallback(() => {
    Object.values(marketData).forEach(ticker => {
        // Your strategy logic
        const condition = ticker.priceChangePercent > 5;
        
        if (condition) {
            const signal: Signal = {
                id: `custom-${ticker.symbol}-${Date.now()}`,
                strategy: 'CUSTOM_STRATEGY',
                symbol: ticker.symbol,
                side: 'BUY',
                price: ticker.lastPrice,
                time: new Date().toLocaleTimeString(),
                note: 'Custom strategy triggered',
                confidence: 80,
                source: 'ALGO_MOMENTUM'
            };
            
            addSignal(signal);
            notifySignal(signal);
        }
    });
}, [marketData]);

// 2. Add to useEffect
useEffect(() => {
    const interval = setInterval(checkCustomStrategy, 30000); // Every 30s
    return () => clearInterval(interval);
}, [checkCustomStrategy]);
```

### Creating a Custom Anomaly Detector

```typescript
// In AnomalyLogic.ts
export class CustomAnomalyDetector extends AnomalyDetector {
    detectCustomAnomaly(ticker: Ticker): Anomaly | null {
        // Your detection logic
        const isAnomaly = /* your condition */;
        
        if (isAnomaly) {
            return {
                id: `custom-${ticker.symbol}-${Date.now()}`,
                symbol: ticker.symbol,
                type: 'CUSTOM_TYPE',
                severity: 'HIGH',
                score: 90,
                description: 'Custom anomaly detected',
                timestamp: Date.now(),
                metrics: { /* your metrics */ }
            };
        }
        
        return null;
    }
}
```

### Adding a New Theme

```typescript
// In UserContext.tsx
const themes = ['light', 'dark', 'corporate', 'labs', 'custom'] as const;

// In App.tsx
const getBackgroundClass = () => {
    if (theme === 'custom') return 'bg-custom-bg text-custom-text';
    // ... existing themes
};

const getGradientClasses = () => {
    if (theme === 'custom') return 'from-custom-primary to-custom-secondary';
    // ... existing themes
};

// In index.css
.bg-custom-bg { background: #your-color; }
.text-custom-text { color: #your-color; }
```

---

## 🐛 Troubleshooting

### WebSocket Connection Issues
**Problem**: "Connecting..." status stuck
**Solutions**:
1. Check internet connection
2. Verify Binance API is accessible
3. Check browser console for errors
4. Try different WebSocket endpoint (backup servers)

### Audio Not Playing
**Problem**: Notification sounds don't play
**Solutions**:
1. Click anywhere on the page (browser autoplay policy)
2. Check notification settings (sound enabled?)
3. Verify browser audio permissions
4. Check system volume

### High CPU Usage
**Problem**: Browser tab consuming too much CPU
**Solutions**:
1. Switch to minimal visual mode
2. Reduce number of active charts
3. Increase signal check intervals
4. Close unused browser tabs

### LocalStorage Quota Exceeded
**Problem**: "QuotaExceededError" in console
**Solutions**:
1. Clear old signal history
2. Reduce funding history retention
3. Clear browser cache
4. Implement data compression

---

## 📖 Glossary

**Funding Rate**: Periodic payment between long and short positions in perpetual futures
**Open Interest**: Total number of outstanding derivative contracts
**Mark Price**: Fair price used for liquidation calculations
**Liquidation**: Forced closure of a leveraged position
**Decoupling**: Asset moving independently from market (BTC)
**Squeeze**: Rapid price movement forcing position closures
**RMI**: Relative Momentum Index, momentum oscillator
**Pattern**: Recognizable formation in price chart
**Signal**: Trading recommendation (buy/sell)
**Anomaly**: Unusual market behavior
**Ticker**: Real-time price update
**Candle**: OHLC price data for a time period
**Divergence**: Disagreement between price and indicator

---

## 📞 Support & Contributing

### Getting Help
- Check documentation first
- Search existing issues on GitHub
- Ask in community Discord/Telegram
- Create detailed bug reports

### Contributing
1. Fork the repository
2. Create feature branch
3. Make changes with tests
4. Submit pull request
5. Follow code style guidelines

### Code Style
- Use TypeScript strict mode
- Follow ESLint rules
- Write descriptive comments
- Use meaningful variable names
- Keep functions small and focused

---

## 📄 License

MIT License - See LICENSE file for details

---

## 🙏 Acknowledgments

- Binance for WebSocket API
- TradingView for lightweight-charts
- Framer Motion for animations
- React team for amazing framework
- Open source community

---

**Last Updated**: December 29, 2025
**Version**: 1.0.0
**Author**: FidelioAI Team
