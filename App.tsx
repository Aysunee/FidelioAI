
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Ticker, Signal, NotificationRule, ToastMessage, FuturesTicker, PriceAlert, MarketIndex, Liquidation } from './types';
import { DEFAULT_WATCHLIST, MOCK_HOLDINGS } from './constants';
import { connectToBinance, connectToBinanceFutures, generateMockSignal, startGlobalIndicesMock, connectToLiquidations } from './services/marketData';
import { Watchlist } from './components/Watchlist';
import { SignalFeed } from './components/SignalFeed';
import { LiquidationsFeed } from './components/LiquidationsFeed';
import { FundingRates } from './components/FundingRates';
import { FidelioRadar } from './components/FidelioRadar';
import { WebhookManager } from './components/WebhookManager';
import { SignalManager } from './components/SignalManager';
import { GlobalTicker } from './components/GlobalTicker';
import { SpotScanner } from './components/SpotScanner';
import { Portfolio } from './components/Portfolio';
import { FidelioAI } from './components/FidelioAI';
import { Modal } from './components/ui/Modal';
import { SetAlertModal } from './components/SetAlertModal';
import { NotificationSettings } from './components/NotificationSettings';
import { ToastContainer } from './components/ui/Toast';
import { Settings, Moon, Sun, Hexagon, Sparkles } from 'lucide-react';

type ViewMode = 'dashboard' | 'funding' | 'signals-manager' | 'lab' | 'spot-scanner' | 'portfolio' | 'fidelio-ai';
type Theme = 'light' | 'dark';

const App: React.FC = () => {
  // --- Global State ---
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard');
  const [theme, setTheme] = useState<Theme>('dark');
  const [marketData, setMarketData] = useState<Record<string, Ticker>>({});
  const [futuresData, setFuturesData] = useState<Record<string, FuturesTicker>>({});
  const [indicesData, setIndicesData] = useState<MarketIndex[]>([]);
  const [liquidations, setLiquidations] = useState<Liquidation[]>([]);
  
  const [signals, setSignals] = useState<Signal[]>([]);
  const [watchlist, setWatchlist] = useState<string[]>(DEFAULT_WATCHLIST);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'connecting'>('connecting');
  
  // Notification State
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Price Alert State
  const [priceAlerts, setPriceAlerts] = useState<PriceAlert[]>([]);
  const [alertModal, setAlertModal] = useState<{ isOpen: boolean; symbol: string | null }>({ isOpen: false, symbol: null });

  // Refs for Logic
  const marketDataRef = useRef(marketData);
  const lastSignalTimeRef = useRef<Record<string, number>>({});
  const rmiCooldownsRef = useRef<Record<string, number>>({});

  useEffect(() => {
    marketDataRef.current = marketData;
  }, [marketData]);

  // --- Theme Management ---
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  // --- Helpers for Notifications ---
  const addToast = useCallback((title: string, description: string, type: ToastMessage['type'] = 'info') => {
    setToasts(prev => [...prev, { id: Math.random().toString(36), title, description, type }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const checkAndTriggerNotifications = useCallback((signal: Signal) => {
    rules.forEach(rule => {
      const symbolMatch = !rule.condition.symbol || rule.condition.symbol === signal.symbol;
      const sideMatch = rule.condition.side === 'ANY' || rule.condition.side === signal.side;

      if (symbolMatch && sideMatch) {
        const title = `Alert: ${signal.symbol} ${signal.side}`;
        const body = `${signal.strategy} at ${signal.price.toFixed(2)}`;

        if (rule.channels.inApp) addToast(title, body, 'alert');
        if (rule.channels.browser && Notification.permission === 'granted') {
          new Notification(title, { body, icon: '/favicon.ico' });
        }
      }
    });
  }, [rules, addToast]);

  // --- Signal Management Helpers ---
  const handleDeleteSignal = useCallback((id: string) => {
      setSignals(prev => prev.filter(s => s.id !== id));
  }, []);

  const handleClearAllSignals = useCallback(() => {
      if (window.confirm('Are you sure you want to clear the entire signal history?')) {
          setSignals([]);
          addToast('Cleared', 'Signal history has been reset.', 'info');
      }
  }, [addToast]);

  // --- Price Alert Checker ---
  useEffect(() => {
    setPriceAlerts(currentAlerts => {
        let hasChanges = false;
        const updatedAlerts = currentAlerts.map(alert => {
            if (!alert.isActive) return alert;
            const ticker = marketDataRef.current[alert.symbol];
            if (!ticker) return alert;

            let triggered = false;
            if (alert.condition === 'ABOVE' && ticker.lastPrice >= alert.targetPrice) triggered = true;
            if (alert.condition === 'BELOW' && ticker.lastPrice <= alert.targetPrice) triggered = true;

            if (triggered) {
                hasChanges = true;
                const title = `Price Alert: ${alert.symbol}`;
                const body = `${alert.symbol} is now ${alert.condition.toLowerCase()} ${alert.targetPrice}`;
                addToast(title, body, 'success');
                if (Notification.permission === 'granted') new Notification(title, { body });
                return { ...alert, isActive: false };
            }
            return alert;
        });
        return hasChanges ? updatedAlerts : currentAlerts;
    });
  }, [marketData, addToast]);

  // --- Handlers ---
  const addToWatchlist = useCallback((symbol: string) => {
      const formatted = symbol.toUpperCase();
      setWatchlist(prev => {
          if (prev.includes(formatted)) {
              addToast('Duplicate', `${formatted} is already in your watchlist.`, 'info');
              return prev;
          }
          addToast('Added', `${formatted} added to watchlist.`, 'success');
          return [formatted, ...prev];
      });
  }, [addToast]);

  const removeFromWatchlist = useCallback((symbol: string) => {
      setWatchlist(prev => prev.filter(s => s !== symbol));
      addToast('Removed', `${symbol} removed from watchlist.`, 'info');
  }, [addToast]);

  const openAlertModal = useCallback((symbol: string) => {
      setAlertModal({ isOpen: true, symbol });
  }, []);

  const handleCreateAlert = (price: number, condition: 'ABOVE' | 'BELOW') => {
      if (!alertModal.symbol) return;
      const newAlert: PriceAlert = {
          id: Math.random().toString(36).substring(7),
          symbol: alertModal.symbol,
          targetPrice: price,
          condition,
          isActive: true,
          createdAt: Date.now()
      };
      setPriceAlerts(prev => [...prev, newAlert]);
      addToast('Alert Set', `Notify when ${alertModal.symbol} is ${condition.toLowerCase()} ${price}`, 'success');
      setAlertModal({ isOpen: false, symbol: null });
  };

  const handleManualSignal = (signal: Signal) => {
      setSignals(prev => [signal, ...prev].slice(0, 100));
      checkAndTriggerNotifications(signal);
      addToast('Signal Injected', `${signal.symbol} ${signal.side} signal added via Hub.`, 'success');
  };

  // --- RMI Logic Detector ---
  useEffect(() => {
    const checkRMI = () => {
        const now = Date.now();
        const tickers = marketDataRef.current;
        const newRmiSignals: Signal[] = [];

        Object.values(tickers).forEach((ticker: Ticker) => {
            if (!ticker.symbol.endsWith('USDT') || ticker.volume < 10000) return;
            const isOverbought = ticker.priceChangePercent > 4.5;
            const isOversold = ticker.priceChangePercent < -4.5;

            if (isOverbought || isOversold) {
                const lastTrigger = rmiCooldownsRef.current[ticker.symbol] || 0;
                if (now - lastTrigger > 300000) {
                     const type = isOverbought ? 'RMI_Overbought' : 'RMI_Oversold';
                     const side = isOverbought ? 'SELL' : 'BUY';
                     newRmiSignals.push({
                        id: `rmi_${now}_${ticker.symbol}`,
                        strategy: type,
                        symbol: ticker.symbol,
                        side: side,
                        price: ticker.lastPrice,
                        time: new Date().toISOString(),
                        note: `Momentum Extreme`,
                        confidence: 0.8,
                        source: 'ALGO_MOMENTUM'
                     });
                     rmiCooldownsRef.current[ticker.symbol] = now;
                }
            }
        });

        if (newRmiSignals.length > 0) {
            setSignals(prev => [...newRmiSignals, ...prev].slice(0, 100));
            newRmiSignals.forEach(s => checkAndTriggerNotifications(s));
        }
    };
    const interval = setInterval(checkRMI, 3000);
    return () => clearInterval(interval);
  }, [checkAndTriggerNotifications]);

  // --- WebSocket Connections ---
  useEffect(() => {
    const disconnect = connectToBinance((newTickers) => {
        setConnectionStatus('connected');
        setMarketData(prev => ({ ...prev, ...newTickers }));
    });
    return () => { disconnect(); setConnectionStatus('disconnected'); };
  }, []);

  useEffect(() => {
    const disconnect = connectToBinanceFutures((updates) => {
        setFuturesData(prev => {
            const next = { ...prev };
            const now = Date.now();
            const newSignals: Signal[] = [];
            const FUNDING_THRESHOLD = 0.0003; 

            Object.values(updates).forEach((update: Partial<FuturesTicker>) => {
                const symbol = update.symbol!;
                const current = prev[symbol];
                
                let sessionStartRate = current?.sessionStartRate;
                if (sessionStartRate === undefined && update.fundingRate !== undefined) sessionStartRate = update.fundingRate;
                
                let sessionChange = current?.sessionChange || 0;
                if (update.fundingRate !== undefined && sessionStartRate !== undefined) sessionChange = update.fundingRate - sessionStartRate;

                // Divergence Logic
                if (current && update.fundingRate !== undefined && update.markPrice !== undefined) {
                    const priceChange = update.markPrice - current.markPrice;
                    const fundingChange = update.fundingRate - current.fundingRate;
                    const lastTime = lastSignalTimeRef.current[symbol] || 0;
                    
                    if (now - lastTime > 15000) {
                        if (fundingChange < 0 && priceChange > 0 && update.fundingRate <= -FUNDING_THRESHOLD) {
                             if ((priceChange / current.markPrice) > 0.0005) {
                                newSignals.push({
                                    id: `auto_${now}_${symbol}`,
                                    strategy: 'SmartMoney_Divergence',
                                    symbol, side: 'LONG', price: update.markPrice,
                                    time: new Date().toISOString(),
                                    note: `Funding Short Squeeze Alert`,
                                    confidence: 0.85, source: 'ALGO'
                                });
                                lastSignalTimeRef.current[symbol] = now;
                             }
                        }
                        if (fundingChange > 0 && priceChange < 0 && update.fundingRate >= FUNDING_THRESHOLD) {
                             if ((priceChange / current.markPrice) < -0.0005) {
                                newSignals.push({
                                    id: `auto_${now}_${symbol}`,
                                    strategy: 'SmartMoney_Divergence',
                                    symbol, side: 'SHORT', price: update.markPrice,
                                    time: new Date().toISOString(),
                                    note: `Funding Long Trap Alert`,
                                    confidence: 0.85, source: 'ALGO'
                                });
                                lastSignalTimeRef.current[symbol] = now;
                             }
                        }
                    }
                }
                next[symbol] = { ...current, ...update, symbol, markPrice: update.markPrice ?? current?.markPrice ?? 0, fundingRate: update.fundingRate ?? current?.fundingRate ?? 0, nextFundingTime: update.nextFundingTime ?? current?.nextFundingTime ?? 0, indexPrice: update.indexPrice ?? current?.indexPrice ?? 0, sessionStartRate, sessionChange } as FuturesTicker;
            });

            if (newSignals.length > 0) {
                setTimeout(() => {
                    setSignals(prev => {
                         const combined = [...newSignals, ...prev].slice(0, 100);
                         newSignals.forEach(s => checkAndTriggerNotifications(s));
                         return combined;
                    });
                    newSignals.forEach(s => addToast(`${s.side} Signal: ${s.symbol.replace('USDT', '')}`, s.note || 'Divergence', s.side === 'LONG' ? 'success' : 'alert'));
                }, 0);
            }
            return next;
        });
    });
    return () => disconnect();
  }, [checkAndTriggerNotifications, addToast]);

  useEffect(() => {
    const disconnect = connectToLiquidations((liq) => {
        setLiquidations(prev => [liq, ...prev].slice(0, 50));
    });
    return () => disconnect();
  }, []);

  useEffect(() => {
    const stopMock = startGlobalIndicesMock(setIndicesData);
    return () => stopMock();
  }, []);

  const NavLink = ({ mode, label, icon }: { mode: ViewMode, label: string, icon?: React.ReactNode }) => (
    <button onClick={() => setViewMode(mode)} className={`relative px-1 py-4 text-[14px] font-medium transition-colors flex items-center gap-1.5 ${viewMode === mode ? 'text-primary font-bold' : 'text-secondary hover:text-text'}`}>
        {icon}
        {label}
        {viewMode === mode && <span className="absolute bottom-0 left-0 w-full h-[2px] bg-primary" />}
    </button>
  );

  return (
    <div className="min-h-screen bg-background text-text font-sans selection:bg-primary/30 flex flex-col transition-colors duration-200">
       <ToastContainer toasts={toasts} onDismiss={dismissToast} />
       
       <Modal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} title="Preferences">
         <NotificationSettings rules={rules} setRules={setRules} />
       </Modal>

       <Modal isOpen={alertModal.isOpen} onClose={() => setAlertModal({ isOpen: false, symbol: null })} title={`Set Alert: ${alertModal.symbol?.replace('USDT', '')}`}>
          {alertModal.symbol && <SetAlertModal symbol={alertModal.symbol} currentPrice={marketData[alertModal.symbol]?.lastPrice || 0} onSave={handleCreateAlert} onCancel={() => setAlertModal({ isOpen: false, symbol: null })} />}
       </Modal>

       <header className="sticky top-0 z-30 shrink-0 bg-surface border-b border-border shadow-sm h-16">
          <div className="container mx-auto px-4 h-full flex items-center justify-between">
             <div className="flex items-center gap-6 h-full overflow-x-auto scrollbar-hide">
                 <div className="flex items-center gap-2 group cursor-pointer shrink-0" onClick={() => setViewMode('dashboard')}>
                    <div className="text-primary"><Hexagon size={24} fill="currentColor" strokeWidth={0} /></div>
                    <span className="font-display font-bold text-lg text-text tracking-tight uppercase hidden md:block">Fidelio</span>
                 </div>
                 <nav className="flex gap-6 h-full shrink-0">
                    <NavLink mode="dashboard" label="Markets" />
                    <NavLink mode="spot-scanner" label="Spot Sniper" />
                    <NavLink mode="funding" label="Derivatives" />
                    <NavLink mode="portfolio" label="Portfolio" />
                    <NavLink mode="signals-manager" label="Signals" />
                    <NavLink mode="fidelio-ai" label="Fidelio.ai" icon={<Sparkles size={14} className={viewMode === 'fidelio-ai' ? 'animate-pulse' : ''} />} />
                    <NavLink mode="lab" label="Lab" />
                 </nav>
             </div>
             
             {/* Center-Right Ticker */}
             <div className="flex-1 flex justify-end md:justify-center px-4 min-w-0 hidden lg:flex">
                 <GlobalTicker spotData={marketData} indicesData={indicesData} />
             </div>

             <div className="flex items-center gap-4 shrink-0">
                <div className={`hidden lg:flex items-center gap-2 text-[12px] font-medium px-2 py-1 rounded bg-surface-secondary text-secondary`}>
                   <div className={`w-1.5 h-1.5 rounded-full ${connectionStatus === 'connected' ? 'bg-success' : 'bg-warning'}`} />
                   {connectionStatus === 'connected' ? 'Connected' : '...'}
                </div>
                <button onClick={toggleTheme} className="p-2 rounded hover:bg-surface-secondary text-secondary hover:text-text"><ThemeIcon theme={theme} /></button>
                <button onClick={() => setIsSettingsOpen(true)} className="p-2 rounded hover:bg-surface-secondary text-secondary hover:text-text"><Settings size={20} /></button>
                <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-black font-bold text-xs cursor-pointer hover:opacity-90">U</div>
             </div>
          </div>
       </header>

       <main className="flex-1 container mx-auto px-4 py-6 overflow-hidden flex flex-col relative z-10 animate-enter pb-16">
          {viewMode === 'dashboard' && (
            <div className="flex flex-col gap-4 h-full">
                <div className="shrink-0">
                    <div className="mb-4">
                        <FidelioRadar spotData={marketData} futuresData={futuresData} />
                    </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 min-h-0">
                    <div className="lg:col-span-4 flex flex-col h-full min-h-[400px]">
                        <Watchlist symbols={watchlist} data={marketData} activeAlerts={priceAlerts} onAdd={addToWatchlist} onRemove={removeFromWatchlist} onSetAlert={openAlertModal} />
                    </div>
                    <div className="lg:col-span-8 flex flex-col h-full min-h-[400px]">
                        <SignalFeed signals={signals} marketData={marketData} />
                    </div>
                </div>
            </div>
          )}

          {viewMode === 'spot-scanner' && <SpotScanner data={marketData} />}

          {viewMode === 'funding' && (
             <div className="h-full flex flex-col gap-4">
                <div className="flex flex-col gap-1 px-1">
                    <h2 className="text-xl font-bold text-text">Derivatives Overview</h2>
                    <p className="text-secondary text-sm">Real-time funding rates and next settlement timers.</p>
                </div>
                <div className="flex-1 overflow-hidden rounded-card shadow-brand border border-border"><FundingRates data={futuresData} /></div>
            </div>
          )}

          {viewMode === 'portfolio' && (
             <div className="h-full flex flex-col gap-4">
                 <div className="flex flex-col gap-1 px-1">
                    <h2 className="text-xl font-bold text-text">Portfolio Tracker</h2>
                    <p className="text-secondary text-sm">Track assets and log trade history.</p>
                </div>
                <div className="flex-1 overflow-hidden"><Portfolio holdings={MOCK_HOLDINGS} data={marketData} /></div>
             </div>
          )}

          {viewMode === 'signals-manager' && <SignalManager signals={signals} onDelete={handleDeleteSignal} onClearAll={handleClearAllSignals} />}
          {viewMode === 'fidelio-ai' && <FidelioAI spotData={marketData} futuresData={futuresData} />}
          {viewMode === 'lab' && <WebhookManager onManualSignal={handleManualSignal} />}
       </main>

       {/* Footer Ticker */}
       <div className="fixed bottom-0 left-0 right-0 h-10 bg-surface border-t border-border z-40">
           <LiquidationsFeed liquidations={liquidations} />
       </div>
    </div>
  );
};

const ThemeIcon = ({ theme }: { theme: Theme }) => (theme === 'light' ? <Moon size={20} /> : <Sun size={20} />);

export default App;
