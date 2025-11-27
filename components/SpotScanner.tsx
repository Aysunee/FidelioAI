import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Ticker } from '../types';
import { Card } from './ui/Card';
import { 
    Crosshair, Filter, ArrowUp, ArrowDown, Activity, Zap, 
    BarChart2, Settings, Play, Pause, RefreshCw, Save, ChevronRight, ChevronLeft, Sliders, Trash2, Clock,
    LineChart, ExternalLink
} from 'lucide-react';

interface SpotScannerProps {
  data: Record<string, Ticker>;
}

// --- Data Structures ---

interface AnalyzerState {
  symbol: string;
  price: number;
  priceChangePercent: number;
  
  // Accumulated Flow
  buyVolume: number;
  sellVolume: number;
  totalVolumeWindow: number; // Quote Volume (USDT)
  
  // Metrics
  pressure: number; // 0 to 100
  rvol: number; // Relative Volume Multiplier
  netFlow: number; // Net USDT
  
  updatedAt: number;
}

// Wrapper for the UI list to handle "Sticky" behavior
interface DetectedSignal extends AnalyzerState {
    status: 'ACTIVE' | 'COOLDOWN';
    lastActiveAt: number; // Timestamp when it last met strict rules
    firstDetectedAt: number;
}

interface ScannerRules {
  minRvol: number;
  minPressure: number;
  maxPressure: number;
  minFlowUsdt: number; // Minimum 1m Volume in USDT to filter dust
  minPriceChange: number;
  maxPriceChange: number;
}

type PresetName = 'DEFAULT' | 'WHALE_ACCUMULATION' | 'BREAKOUT' | 'DIP_SNIPER';

const RETENTION_MS = 45000; // Keep signals for 45 seconds after they stop meeting criteria

// Stablecoins to ignore to reduce noise
const IGNORED_COINS = ['USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'USDE', 'EURI', 'EUR', 'AEUR'];

const PRESETS: Record<PresetName, ScannerRules> = {
    DEFAULT: {
        minRvol: 1.5,
        minPressure: 0,
        maxPressure: 100,
        minFlowUsdt: 5000,
        minPriceChange: -100,
        maxPriceChange: 100
    },
    WHALE_ACCUMULATION: {
        minRvol: 3.0,
        minPressure: 65, // Strong Buying
        maxPressure: 100,
        minFlowUsdt: 50000, // Significant Volume
        minPriceChange: -2, // Price hasn't pumped yet (or is slightly down)
        maxPriceChange: 2   // Catching before the pump
    },
    BREAKOUT: {
        minRvol: 4.0,
        minPressure: 60,
        maxPressure: 100,
        minFlowUsdt: 20000,
        minPriceChange: 1, // Already moving up
        maxPriceChange: 15
    },
    DIP_SNIPER: {
        minRvol: 2.5,
        minPressure: 55, // Absorption starting
        maxPressure: 100,
        minFlowUsdt: 10000,
        minPriceChange: -20, // Creating a bottom
        maxPriceChange: -2
    }
};

export const SpotScanner: React.FC<SpotScannerProps> = ({ data }) => {
  // Raw Analysis State
  const [analyzers, setAnalyzers] = useState<Record<string, AnalyzerState>>({});
  
  // Persistence State (The list displayed to user)
  const [detectedSignals, setDetectedSignals] = useState<Record<string, DetectedSignal>>({});

  // Cockpit State
  const [isPaused, setIsPaused] = useState(false);
  const [showConfig, setShowConfig] = useState(true);
  const [activePreset, setActivePreset] = useState<PresetName>('DEFAULT');
  const [rules, setRules] = useState<ScannerRules>(PRESETS.DEFAULT);
  
  // Refs
  const prevDataRef = useRef<Record<string, { vol: number, price: number, time: number }>>({});

  // --- Core Algorithm (Data Processing) ---
  useEffect(() => {
    if (isPaused) return;

    const now = Date.now();
    const updates: Record<string, AnalyzerState> = {};
    let hasUpdates = false;

    Object.values(data).forEach((t: Ticker) => {
       if (!t.symbol.endsWith('USDT')) return;

       // Filter out Stablecoins
       const symbolBase = t.symbol.replace('USDT', '');
       if (IGNORED_COINS.includes(symbolBase)) return;

       const prev = prevDataRef.current[t.symbol];
       const currentAnalyzer = analyzers[t.symbol] || {
           symbol: t.symbol,
           price: t.lastPrice,
           priceChangePercent: t.priceChangePercent,
           buyVolume: 0,
           sellVolume: 0,
           totalVolumeWindow: 0,
           pressure: 50,
           rvol: 0,
           netFlow: 0,
           updatedAt: now
       };

       if (prev) {
           const timeDelta = now - prev.time;
           
           // Process tick (>500ms debounce for metric calculation)
           if (timeDelta > 500) {
               const volDelta = t.volume - prev.vol; // Change in Quote Volume
               const priceDelta = t.lastPrice - prev.price;
               
               if (volDelta > 0) {
                   const isBuy = priceDelta > 0 || (priceDelta === 0 && t.lastPrice >= prev.price); // Simple tick rule

                   // Decay to keep window fresh (~1-2 minute rolling window effect)
                   const DECAY = 0.90; 
                   const newBuyVol = (currentAnalyzer.buyVolume * DECAY) + (isBuy ? volDelta : 0);
                   const newSellVol = (currentAnalyzer.sellVolume * DECAY) + (!isBuy ? volDelta : 0);
                   const total = newBuyVol + newSellVol;

                   // Metrics
                   const pressure = total > 0 ? (newBuyVol / total) * 100 : 50;
                   
                   // RVOL Logic
                   // Avg daily ms flow = volume / 86,400,000
                   const avgRate = t.volume / 86400000; 
                   const currentRate = volDelta / timeDelta;
                   const rvol = avgRate > 0 ? currentRate / avgRate : 0;

                   updates[t.symbol] = {
                       ...currentAnalyzer,
                       price: t.lastPrice,
                       priceChangePercent: t.priceChangePercent,
                       buyVolume: newBuyVol,
                       sellVolume: newSellVol,
                       totalVolumeWindow: total,
                       pressure,
                       rvol,
                       netFlow: newBuyVol - newSellVol,
                       updatedAt: now
                   };
                   hasUpdates = true;
               }
           }
       }

       if (!prev || (now - prev.time > 500)) {
           prevDataRef.current[t.symbol] = { vol: t.volume, price: t.lastPrice, time: now };
       }
    });

    if (hasUpdates) {
        setAnalyzers(prev => {
            const nextAnalyzers = { ...prev, ...updates };
            
            // --- SIGNAL LIFECYCLE MANAGEMENT (Retention Logic) ---
            setDetectedSignals(currentSignals => {
                const nextSignals = { ...currentSignals };
                const loopTime = Date.now();
                let signalListChanged = false;

                // 1. Check all Analyzers against Rules
                Object.values(nextAnalyzers).forEach((analysis: AnalyzerState) => {
                    // Rule Check
                    let isMatch = true;
                    if (analysis.totalVolumeWindow < rules.minFlowUsdt) isMatch = false;
                    else if (analysis.rvol < rules.minRvol) isMatch = false;
                    else if (analysis.pressure < rules.minPressure) isMatch = false;
                    else if (analysis.pressure > rules.maxPressure) isMatch = false;
                    else if (analysis.priceChangePercent < rules.minPriceChange) isMatch = false;
                    else if (analysis.priceChangePercent > rules.maxPriceChange) isMatch = false;

                    const existing = nextSignals[analysis.symbol];

                    if (isMatch) {
                        // NEW or CONTINUING Signal -> Set ACTIVE
                        nextSignals[analysis.symbol] = {
                            ...analysis,
                            status: 'ACTIVE',
                            lastActiveAt: loopTime,
                            firstDetectedAt: existing ? existing.firstDetectedAt : loopTime
                        };
                        signalListChanged = true;
                    } else if (existing) {
                        // NO MATCH, but exists -> COOLDOWN or REMOVE
                        if (loopTime - existing.lastActiveAt < RETENTION_MS) {
                            // Keep updating data, but mark as COOLDOWN
                            nextSignals[analysis.symbol] = {
                                ...analysis, // Update price/vol/pressure
                                status: 'COOLDOWN',
                                lastActiveAt: existing.lastActiveAt, // Don't refresh timer
                                firstDetectedAt: existing.firstDetectedAt
                            };
                            signalListChanged = true;
                        } else {
                            // Expired
                            delete nextSignals[analysis.symbol];
                            signalListChanged = true;
                        }
                    }
                });

                // 2. Cleanup orphaned signals (if analyzer data is gone/stale)
                // (Optional: usually handled by expiration above)

                return signalListChanged ? nextSignals : currentSignals;
            });

            return nextAnalyzers;
        });
    }
  }, [data, isPaused, rules]); // Re-run logic when Rules change to immediately filter/unfilter

  // --- Display Sorting ---
  const sortedSignals = useMemo(() => {
    return Object.values(detectedSignals).sort((a: DetectedSignal, b: DetectedSignal) => {
        // 1. Status Priority: ACTIVE > COOLDOWN
        if (a.status === 'ACTIVE' && b.status === 'COOLDOWN') return -1;
        if (a.status === 'COOLDOWN' && b.status === 'ACTIVE') return 1;

        // 2. Score Priority (RVOL + NetFlow)
        const scoreA = (a.rvol * 2) + (Math.abs(a.netFlow) / 10000); 
        const scoreB = (b.rvol * 2) + (Math.abs(b.netFlow) / 10000);
        return scoreB - scoreA;
    });
  }, [detectedSignals]);

  // --- Handlers ---
  const applyPreset = (name: PresetName) => {
      setActivePreset(name);
      setRules(PRESETS[name]);
      // Optional: Clear existing signals when switching strategies? 
      // User might prefer to keep them, so we leave them to decay naturally or verify against new rules.
  };

  const handleRuleChange = (field: keyof ScannerRules, value: number) => {
      setRules(prev => ({ ...prev, [field]: value }));
      setActivePreset('DEFAULT'); // Custom now
  };

  const clearSignals = () => {
      setDetectedSignals({});
  };

  return (
    <div className="h-full flex flex-col md:flex-row gap-4 overflow-hidden">
        
        {/* Left Sidebar: Cockpit Controls */}
        <div className={`shrink-0 flex flex-col gap-4 transition-all duration-300 ${showConfig ? 'w-full md:w-72' : 'w-0 hidden md:flex md:w-0 overflow-hidden opacity-0'}`}>
            <Card title="Mission Control" className="h-full bg-surface shadow-xl border-r border-border">
                <div className="p-4 space-y-6 overflow-y-auto max-h-full">
                    
                    {/* Presets */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-secondary uppercase tracking-wider">Strategy Presets</label>
                        <div className="grid grid-cols-1 gap-2">
                            <button 
                                onClick={() => applyPreset('WHALE_ACCUMULATION')}
                                className={`px-3 py-2.5 rounded-lg text-xs font-bold text-left border transition-all flex items-center gap-2 ${activePreset === 'WHALE_ACCUMULATION' ? 'bg-primary/20 border-primary text-primary' : 'bg-surface-secondary border-transparent text-text hover:bg-surface-highlight'}`}
                            >
                                <Activity size={14} /> Whale Accumulation
                            </button>
                            <button 
                                onClick={() => applyPreset('BREAKOUT')}
                                className={`px-3 py-2.5 rounded-lg text-xs font-bold text-left border transition-all flex items-center gap-2 ${activePreset === 'BREAKOUT' ? 'bg-success/20 border-success text-success' : 'bg-surface-secondary border-transparent text-text hover:bg-surface-highlight'}`}
                            >
                                <Zap size={14} /> Breakout Hunter
                            </button>
                            <button 
                                onClick={() => applyPreset('DIP_SNIPER')}
                                className={`px-3 py-2.5 rounded-lg text-xs font-bold text-left border transition-all flex items-center gap-2 ${activePreset === 'DIP_SNIPER' ? 'bg-purple-500/20 border-purple-500 text-purple-500' : 'bg-surface-secondary border-transparent text-text hover:bg-surface-highlight'}`}
                            >
                                <Crosshair size={14} /> Dip Sniper
                            </button>
                        </div>
                    </div>

                    <hr className="border-border/50" />

                    {/* Custom Rules */}
                    <div className="space-y-5">
                        <div className="flex items-center justify-between">
                             <label className="text-xs font-bold text-secondary uppercase tracking-wider">Custom Filters</label>
                             <button onClick={() => applyPreset('DEFAULT')} className="text-[10px] text-primary hover:underline">Reset</button>
                        </div>

                        {/* RVOL Slider */}
                        <div>
                            <div className="flex justify-between mb-2">
                                <span className="text-xs font-medium text-text">Min RVOL</span>
                                <span className="text-xs font-mono font-bold text-primary">{rules.minRvol.toFixed(1)}x</span>
                            </div>
                            <input 
                                type="range" min="0" max="20" step="0.5" 
                                value={rules.minRvol} 
                                onChange={(e) => handleRuleChange('minRvol', parseFloat(e.target.value))}
                                className="w-full h-1.5 bg-surface-secondary rounded-lg appearance-none cursor-pointer accent-primary"
                            />
                        </div>

                        {/* Min USDT Flow */}
                        <div>
                            <div className="flex justify-between mb-2">
                                <span className="text-xs font-medium text-text">Min 1m Volume ($)</span>
                                <span className="text-xs font-mono font-bold text-text">${(rules.minFlowUsdt/1000).toFixed(0)}k</span>
                            </div>
                            <input 
                                type="range" min="0" max="200000" step="5000" 
                                value={rules.minFlowUsdt} 
                                onChange={(e) => handleRuleChange('minFlowUsdt', parseFloat(e.target.value))}
                                className="w-full h-1.5 bg-surface-secondary rounded-lg appearance-none cursor-pointer accent-primary"
                            />
                        </div>

                        {/* Pressure Range */}
                        <div>
                            <div className="flex justify-between mb-2">
                                <span className="text-xs font-medium text-text">Buy Pressure %</span>
                                <span className="text-xs font-mono font-bold text-text">{rules.minPressure}% - {rules.maxPressure}%</span>
                            </div>
                            <div className="flex gap-2">
                                <input 
                                    type="number" 
                                    value={rules.minPressure} 
                                    onChange={(e) => handleRuleChange('minPressure', parseFloat(e.target.value))}
                                    className="w-1/2 bg-surface-secondary rounded p-1.5 text-xs text-center border border-border focus:border-primary outline-none"
                                    placeholder="Min"
                                />
                                <input 
                                    type="number" 
                                    value={rules.maxPressure} 
                                    onChange={(e) => handleRuleChange('maxPressure', parseFloat(e.target.value))}
                                    className="w-1/2 bg-surface-secondary rounded p-1.5 text-xs text-center border border-border focus:border-primary outline-none"
                                    placeholder="Max"
                                />
                            </div>
                        </div>

                         {/* Price Change Range */}
                        <div>
                            <div className="flex justify-between mb-2">
                                <span className="text-xs font-medium text-text">24h Change %</span>
                                <span className="text-xs font-mono font-bold text-text">{rules.minPriceChange}% to {rules.maxPriceChange}%</span>
                            </div>
                            <div className="flex gap-2">
                                <input 
                                    type="number" 
                                    value={rules.minPriceChange} 
                                    onChange={(e) => handleRuleChange('minPriceChange', parseFloat(e.target.value))}
                                    className="w-1/2 bg-surface-secondary rounded p-1.5 text-xs text-center border border-border focus:border-primary outline-none"
                                    placeholder="Min"
                                />
                                <input 
                                    type="number" 
                                    value={rules.maxPriceChange} 
                                    onChange={(e) => handleRuleChange('maxPriceChange', parseFloat(e.target.value))}
                                    className="w-1/2 bg-surface-secondary rounded p-1.5 text-xs text-center border border-border focus:border-primary outline-none"
                                    placeholder="Max"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </Card>
        </div>

        {/* Main Content: Scanner List */}
        <div className="flex-1 flex flex-col h-full overflow-hidden">
             
             {/* Toolbar */}
             <div className="flex items-center justify-between mb-4 px-1">
                 <div className="flex items-center gap-3">
                    <button 
                        onClick={() => setShowConfig(!showConfig)}
                        className={`p-2 rounded-lg transition-colors border ${showConfig ? 'bg-primary text-black border-primary' : 'bg-surface text-secondary border-border hover:text-text'}`}
                    >
                        <Sliders size={18} />
                    </button>
                    <div>
                        <h2 className="text-xl font-display font-bold text-text tracking-tight flex items-center gap-2">
                            Fidelio Spot Cockpit
                            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/30 font-mono">PRO</span>
                        </h2>
                        <p className="text-xs text-secondary hidden sm:block">
                            Real-time flow analysis with signal retention.
                        </p>
                    </div>
                 </div>

                 <div className="flex items-center gap-3">
                     <div className="text-right hidden sm:block">
                         <div className="text-xs font-bold text-text">{sortedSignals.length} Signals</div>
                         <div className="text-[10px] text-secondary">Active & Retained</div>
                     </div>
                     <button 
                        onClick={clearSignals}
                        className="p-2 rounded-lg bg-surface-highlight text-secondary hover:text-danger hover:bg-danger/10 transition-colors"
                        title="Clear List"
                     >
                        <Trash2 size={16} />
                     </button>
                     <button 
                        onClick={() => setIsPaused(!isPaused)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all border ${isPaused ? 'bg-warning/20 text-warning border-warning' : 'bg-surface-highlight text-text border-border'}`}
                    >
                        {isPaused ? <Play size={14} fill="currentColor" /> : <Pause size={14} fill="currentColor" />}
                        {isPaused ? 'RESUME' : 'FREEZE'}
                     </button>
                 </div>
             </div>

             {/* Results Table */}
             <div className="flex-1 bg-surface border border-border rounded-card flex flex-col shadow-brand overflow-hidden relative">
                {/* Headers */}
                <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-surface-secondary/50 border-b border-border text-[10px] font-bold text-secondary uppercase tracking-wider sticky top-0 z-10 backdrop-blur-sm">
                    <div className="col-span-3">Asset</div>
                    <div className="col-span-2 text-right">Price</div>
                    <div className="col-span-4 pl-4">Momentum (Pressure)</div>
                    <div className="col-span-1 text-right">RVOL</div>
                    <div className="col-span-2 text-right">Net Flow (1m)</div>
                </div>

                {/* Rows */}
                <div className="flex-1 overflow-y-auto">
                    {sortedSignals.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-secondary gap-4 p-8 opacity-60">
                            <Settings size={48} className="animate-spin-slow opacity-20" />
                            <div className="text-center">
                                <p className="font-medium text-sm">No signals matching your strict rules.</p>
                                <p className="text-xs mt-1">Waiting for volume spikes...</p>
                            </div>
                        </div>
                    ) : (
                        <div className="divide-y divide-border">
                            {sortedSignals.map(item => {
                                const symbolBase = item.symbol.replace('USDT', '');
                                const iconUrl = `https://assets.coincap.io/assets/icons/${symbolBase.toLowerCase()}@2x.png`;
                                const buyPct = item.pressure;
                                const sellPct = 100 - buyPct;
                                
                                // Status
                                const isActive = item.status === 'ACTIVE';
                                
                                // Calculate retention progress for cooldown items
                                const now = Date.now();
                                const msSinceActive = now - item.lastActiveAt;
                                const timeLeftPct = isActive ? 100 : Math.max(0, 100 - (msSinceActive / RETENTION_MS) * 100);

                                // Visual Cues
                                const isSuperHighRvol = item.rvol > 5;
                                const isBreakout = item.pressure > 75 && item.rvol > 3;
                                const isAccumulation = item.pressure > 70 && Math.abs(item.priceChangePercent) < 2;

                                const tvLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${item.symbol}`;
                                const binanceLink = `https://www.binance.com/en/trade/${symbolBase}_USDT`;

                                return (
                                    <div key={item.symbol} className={`relative grid grid-cols-12 gap-2 px-4 py-2.5 transition-all items-center group overflow-hidden ${
                                        isActive ? (isBreakout ? 'bg-success/10' : 'hover:bg-surface-secondary/40') : 'opacity-60 grayscale-[0.3] hover:opacity-80'
                                    }`}>
                                        
                                        {/* Cooldown Bar Background */}
                                        {!isActive && (
                                            <div 
                                                className="absolute bottom-0 left-0 h-[2px] bg-secondary/30 transition-all duration-1000"
                                                style={{ width: `${timeLeftPct}%` }}
                                            />
                                        )}

                                        {/* Asset */}
                                        <div className="col-span-3 flex items-center gap-3 relative">
                                            <div className="relative">
                                                <div className="w-8 h-8 rounded-full bg-surface-secondary p-0.5 shrink-0 overflow-hidden">
                                                    <img src={iconUrl} className="w-full h-full object-cover" onError={(e) => e.currentTarget.style.display = 'none'} />
                                                </div>
                                                {isAccumulation && (
                                                    <div className="absolute -top-1 -right-1 bg-purple-500 text-white text-[8px] font-bold px-1 rounded-sm shadow-sm border border-surface">
                                                        ACC
                                                    </div>
                                                )}
                                                {!isActive && (
                                                     <div className="absolute -bottom-1 -right-1 bg-surface-secondary text-secondary border border-border p-[2px] rounded-full">
                                                        <Clock size={10} />
                                                     </div>
                                                )}
                                            </div>
                                            <div className="group-hover:opacity-0 transition-opacity">
                                                <div className="font-bold text-sm text-text leading-none flex items-center gap-1">
                                                    {symbolBase}
                                                    {isSuperHighRvol && <Zap size={12} className="text-warning fill-warning" />}
                                                </div>
                                                <div className={`text-[10px] mt-0.5 font-medium ${item.priceChangePercent >= 0 ? 'text-success' : 'text-danger'}`}>
                                                    {item.priceChangePercent >= 0 ? '+' : ''}{item.priceChangePercent.toFixed(2)}%
                                                </div>
                                            </div>

                                            {/* Hover Actions Overlay */}
                                            <div className="absolute left-10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 bg-surface shadow-sm rounded border border-border px-1 py-0.5 z-20">
                                                <a 
                                                    href={tvLink} target="_blank" rel="noopener noreferrer"
                                                    className="p-1 hover:text-primary text-secondary transition-colors" title="TradingView"
                                                >
                                                    <LineChart size={14} />
                                                </a>
                                                <a 
                                                    href={binanceLink} target="_blank" rel="noopener noreferrer"
                                                    className="p-1 hover:text-warning text-secondary transition-colors" title="Binance"
                                                >
                                                    <ExternalLink size={14} />
                                                </a>
                                            </div>
                                        </div>

                                        {/* Price */}
                                        <div className="col-span-2 text-right font-mono text-sm text-text font-medium">
                                            {item.price < 1 ? item.price.toFixed(5) : item.price.toFixed(2)}
                                        </div>

                                        {/* Pressure Meter */}
                                        <div className="col-span-4 pl-4 pr-2">
                                            <div className="flex justify-between text-[9px] font-bold mb-1 opacity-70">
                                                <span className={buyPct > 50 ? 'text-success' : 'text-secondary'}>{buyPct.toFixed(0)}% Buy</span>
                                                <span className={sellPct > 50 ? 'text-danger' : 'text-secondary'}>{sellPct.toFixed(0)}% Sell</span>
                                            </div>
                                            <div className="h-1.5 w-full bg-surface-secondary rounded-full overflow-hidden flex relative">
                                                {/* Center Marker */}
                                                <div className="absolute left-1/2 top-0 bottom-0 w-[1px] bg-surface z-10 opacity-50"></div>
                                                <div 
                                                    className="h-full bg-success transition-all duration-300 shadow-[0_0_8px_rgba(45,189,133,0.5)]" 
                                                    style={{ width: `${buyPct}%`, opacity: buyPct > 50 ? 1 : 0.4 }} 
                                                />
                                                <div 
                                                    className="h-full bg-danger transition-all duration-300" 
                                                    style={{ width: `${sellPct}%`, opacity: sellPct > 50 ? 1 : 0.4 }} 
                                                />
                                            </div>
                                        </div>

                                        {/* RVOL */}
                                        <div className="col-span-1 text-right">
                                            <div className={`font-mono text-xs font-bold px-1.5 py-0.5 rounded w-fit ml-auto ${
                                                item.rvol > 3 ? 'bg-purple-500/10 text-purple-500' : 'text-text'
                                            }`}>
                                                {item.rvol.toFixed(1)}x
                                            </div>
                                        </div>

                                        {/* Net Flow */}
                                        <div className="col-span-2 text-right">
                                            <div className={`text-xs font-bold font-mono ${item.netFlow > 0 ? 'text-success' : 'text-danger'}`}>
                                                {item.netFlow > 0 ? '+' : '-'}${Math.abs(item.netFlow).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                            </div>
                                        </div>

                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
             </div>
        </div>
    </div>
  );
};