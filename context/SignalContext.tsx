import React, { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import { io } from 'socket.io-client';
import { Signal, NotificationRule, ToastMessage, PriceAlert, Ticker } from '../types';
import { useMarketData } from './MarketContext';
import { notificationManager, notifyBigMove, notifySignal, notifyPriceAlert } from '../utils/notifications';
import { patternScanner, DetectedPattern } from '../services/patternScanner';

interface NotificationSettings {
    soundEnabled: boolean;
    browserNotificationsEnabled: boolean;
    notifyOnBigMoves: boolean;
    notifyOnSignals: boolean;
    notifyOnPriceAlerts: boolean;
    minPriorityLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    telegramBotToken?: string;
    telegramChatId?: string;
}

interface SignalContextType {
    signals: Signal[];
    setSignals: React.Dispatch<React.SetStateAction<Signal[]>>;
    rules: NotificationRule[];
    setRules: React.Dispatch<React.SetStateAction<NotificationRule[]>>;
    priceAlerts: PriceAlert[];
    setPriceAlerts: React.Dispatch<React.SetStateAction<PriceAlert[]>>;
    toasts: ToastMessage[];
    addToast: (title: string, description: string, type?: ToastMessage['type']) => void;
    dismissToast: (id: string) => void;
    handleDeleteSignal: (id: string) => void;
    handleClearAllSignals: () => void;
    handleManualSignal: (signal: Signal) => void;
    alertModal: { isOpen: boolean; symbol: string | null };
    openAlertModal: (symbol: string) => void;
    closeAlertModal: () => void;
    handleCreateAlert: (price: number, condition: 'ABOVE' | 'BELOW') => void;
    signalSettings: SignalSettings;
    updateSignalSettings: (settings: SignalSettings) => void;
    bigMoves: import('../types').BigMoveSignal[];
    futuresBigMoves: import('../types').BigMoveSignal[];
    notificationSettings: NotificationSettings;
    updateNotificationSettings: (settings: Partial<NotificationSettings>) => void;
    requestNotificationPermission: () => Promise<boolean>;
    patterns: DetectedPattern[];
}

export interface SignalSettings {
    volume: {
        threshold: number;
        cooldown: number;
        window: number;
    };
    momentum: {
        threshold: number;
        cooldown: number;
    };
    divergence: {
        fundingThreshold: number;
        cooldown: number;
    };
}

const SignalContext = createContext<SignalContextType | undefined>(undefined);

export const SignalProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { marketData, futuresData } = useMarketData();

    const [signals, setSignals] = useState<Signal[]>([]);
    const [toasts, setToasts] = useState<ToastMessage[]>([]);

    // Notification Rules Persistence
    const [rules, setRules] = useState<NotificationRule[]>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('fidelio_rules');
            return saved ? JSON.parse(saved) : [];
        }
        return [];
    });

    const [priceAlerts, setPriceAlerts] = useState<PriceAlert[]>([]);
    const [alertModal, setAlertModal] = useState<{ isOpen: boolean; symbol: string | null }>({ isOpen: false, symbol: null });

    // Signal Settings State
    const [signalSettings, setSignalSettings] = useState<SignalSettings>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('fidelio_signal_settings');
            return saved ? JSON.parse(saved) : {
                volume: { threshold: 3.0, cooldown: 120, window: 24 },
                momentum: { threshold: 4.5, cooldown: 300 },
                divergence: { fundingThreshold: -0.0005, cooldown: 600 }
            };
        }
        return {
            volume: { threshold: 3.0, cooldown: 120, window: 24 },
            momentum: { threshold: 4.5, cooldown: 300 },
            divergence: { fundingThreshold: -0.0005, cooldown: 600 }
        };
    });

    // Notification Settings State
    const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('fidelio_notification_settings');
            if (saved) return JSON.parse(saved);
        }
        return {
            soundEnabled: false, // Default: Sound alerts OFF
            browserNotificationsEnabled: false,
            notifyOnBigMoves: true,
            notifyOnSignals: true,
            notifyOnPriceAlerts: true,
            minPriorityLevel: 'MEDIUM'
        };
    });

    // Patterns State
    const [patterns, setPatterns] = useState<DetectedPattern[]>([]);

    useEffect(() => {
        const unsubscribe = patternScanner.subscribe((pattern) => {
            setPatterns(prev => {
                // Keep last 50 patterns, avoid duplicates
                const exists = prev.some(p => p.id === pattern.id);
                if (exists) return prev;
                return [pattern, ...prev].slice(0, 50);
            });

            // Notify if enabled
            if (notificationSettings.notifyOnSignals && notificationSettings.soundEnabled) {
                // Use existing notification logic or create new
                // For now just console log, or integrate later
            }
        });

        patternScanner.startScanning();

        return () => {
            unsubscribe();
            patternScanner.stopScanning();
        };
    }, [notificationSettings]);

    // Refs
    const lastSignalTimeRef = useRef<Record<string, number>>({});
    const rmiCooldownsRef = useRef<Record<string, number>>({});
    const marketDataRef = useRef(marketData);
    const futuresDataRef = useRef(futuresData);
    const settingsRef = useRef(signalSettings); // Ref for settings to avoid dependency loops in intervals

    useEffect(() => { marketDataRef.current = marketData; }, [marketData]);
    useEffect(() => { futuresDataRef.current = futuresData; }, [futuresData]);
    useEffect(() => { settingsRef.current = signalSettings; }, [signalSettings]);

    useEffect(() => {
        localStorage.setItem('fidelio_rules', JSON.stringify(rules));
    }, [rules]);

    useEffect(() => {
        localStorage.setItem('fidelio_signal_settings', JSON.stringify(signalSettings));
    }, [signalSettings]);

    useEffect(() => {
        localStorage.setItem('fidelio_notification_settings', JSON.stringify(notificationSettings));
        notificationManager.setSoundEnabled(notificationSettings.soundEnabled);
    }, [notificationSettings]);

    // Helpers
    const addToast = useCallback((title: string, description: string, type: ToastMessage['type'] = 'info') => {
        setToasts(prev => [...prev, { id: Math.random().toString(36), title, description, type }]);
    }, []);

    const dismissToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const updateSignalSettings = useCallback((newSettings: SignalSettings) => {
        setSignalSettings(newSettings);
        addToast('Settings Updated', 'Signal detection parameters have been updated.', 'success');
    }, [addToast]);

    const shouldNotify = useCallback((priority: 'LOW' | 'MEDIUM' | 'HIGH'): boolean => {
        const priorityLevels = { 'LOW': 1, 'MEDIUM': 2, 'HIGH': 3 };
        return priorityLevels[priority] >= priorityLevels[notificationSettings.minPriorityLevel];
    }, [notificationSettings.minPriorityLevel]);

    const updateNotificationSettings = useCallback((newSettings: Partial<NotificationSettings>) => {
        setNotificationSettings(prev => ({ ...prev, ...newSettings }));
    }, []);

    const requestNotificationPermission = useCallback(async (): Promise<boolean> => {
        const granted = await notificationManager.requestPermission();
        if (granted) {
            updateNotificationSettings({ browserNotificationsEnabled: true });
            addToast('Notifications Enabled', 'You will now receive browser notifications.', 'success');
        }
        return granted;
    }, [addToast, updateNotificationSettings]);

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

        // Global Telegram Notification Logic
        if (notificationSettings.telegramBotToken && notificationSettings.telegramChatId) {
            // Determine priority level of the signal
            let priority: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
            if (signal.strategy.includes('Pattern') || signal.strategy.includes('Divergence')) priority = 'HIGH';
            else if (signal.strategy.includes('Volume')) priority = 'MEDIUM';

            const meetsMinLevel = notificationSettings.minPriorityLevel === 'LOW' ||
                (notificationSettings.minPriorityLevel === 'MEDIUM' && (priority === 'MEDIUM' || priority === 'HIGH')) ||
                (notificationSettings.minPriorityLevel === 'HIGH' && priority === 'HIGH');

            if (meetsMinLevel) {
                const emoji = signal.side === 'BUY' || signal.side === 'LONG' ? '🟢' : '🔴';
                const message = `${emoji} *${signal.symbol}* ${signal.side}\n` +
                    `Via: _${signal.strategy}_\n` +
                    `Price: \`$${signal.price}\`\n` +
                    `Time: ${new Date(signal.time).toLocaleTimeString()}\n` +
                    `Note: ${signal.note}`;

                // Send via Proxy
                fetch('http://localhost:3001/api/forward', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        url: `https://api.telegram.org/bot${notificationSettings.telegramBotToken}/sendMessage`,
                        method: 'POST',
                        body: {
                            chat_id: notificationSettings.telegramChatId,
                            text: message,
                            parse_mode: 'Markdown'
                        }
                    })
                }).catch(err => console.error('Telegram send failed', err));
            }
        }
    }, [rules, addToast]);

    // Removal of local audio alert helper as it creates new contexts 
    // leading to "oluşturucu" errors in some browsers.
    // Instead we use the centralized notificationManager.

    // Socket Connection
    useEffect(() => {
        console.log('🔌 Initializing Socket.IO connection...');
        // Dynamically determine the socket URL based on the current window location
        const socketUrl = `${window.location.protocol}//${window.location.hostname}:3001`;

        const socket = io(socketUrl, {
            transports: ['websocket', 'polling']
        });

        socket.on('connect', () => {
            console.log('✅ Connected to Webhook Server, Socket ID:', socket.id);
            addToast('System Connected', 'Real-time Signal Hub is active.', 'success');
        });

        socket.on('connect_error', (error) => {
            console.error('❌ Socket connection error:', error);
        });

        // Fetch History on Connect
        const fetchHistory = async () => {
            try {
                const apiBaseUrl = `${window.location.protocol}//${window.location.hostname}:3001`;
                const res = await fetch(`${apiBaseUrl}/api/signals`);
                if (res.ok) {
                    const history = await res.json();
                    if (Array.isArray(history) && history.length > 0) {
                        console.log(`📜 Loaded ${history.length} signals from history`);
                        // Use function update to prevent overwriting new real-time signals that might have come in
                        setSignals(prev => {
                            // Merge: History (old) + Prev (newly added since load?)
                            // Actually, history comes from DB. Prev might have new socket items.
                            // Let's combine and dedup by ID.
                            const combined = [...prev, ...history];
                            const unique = Array.from(new Map(combined.map(item => [item.id, item])).values());
                            // Sort by time desc
                            unique.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
                            return unique.slice(0, 100);
                        });
                    }
                }
            } catch (err) {
                console.error('Failed to fetch signal history:', err);
            }
        };

        fetchHistory();

        socket.on('new_signal', (signal: Signal) => {
            console.log('📡 New signal received:', signal);
            setSignals(prev => [signal, ...prev].slice(0, 100));
            checkAndTriggerNotifications(signal);

            // Centralized Notification (Sound + Toast + Browser)
            notifySignal(signal.symbol, signal.strategy, 'HIGH', signal.price);
        });

        return () => {
            console.log('🔌 Disconnecting socket...');
            socket.disconnect();
        };
    }, [addToast, checkAndTriggerNotifications]);

    // Handlers
    const handleDeleteSignal = useCallback((id: string) => {
        setSignals(prev => prev.filter(s => s.id !== id));
    }, []);

    const handleClearAllSignals = useCallback(() => {
        if (window.confirm('Are you sure you want to clear the entire signal history?')) {
            setSignals([]);
            addToast('Cleared', 'Signal history has been reset.', 'info');
        }
    }, [addToast]);

    const handleManualSignal = (signal: Signal) => {
        setSignals(prev => [signal, ...prev].slice(0, 100));
        checkAndTriggerNotifications(signal);
        addToast('Signal Injected', `${signal.symbol} ${signal.side} signal added via Hub.`, 'success');
    };

    const openAlertModal = useCallback((symbol: string) => {
        setAlertModal({ isOpen: true, symbol });
    }, []);

    const closeAlertModal = useCallback(() => {
        setAlertModal({ isOpen: false, symbol: null });
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

    // --- Logic: Price Alerts ---
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
                    // Centralized Notification
                    notifyPriceAlert(alert.symbol, alert.targetPrice, ticker.lastPrice);
                    return { ...alert, isActive: false };
                }
                return alert;
            });
            return hasChanges ? updatedAlerts : currentAlerts;
        });
    }, [marketData, addToast]);

    // Helper: Persist Signal to DB (and broadcast back via socket)
    const persistSignal = useCallback((signal: Signal) => {
        // Optimistically update UI? No, let's wait for socket echo to avoid dupes/race conditions
        // OR: Update UI immediately and ignore socket echo if ID matches?
        // Let's use the robust way: POST -> Server Saves -> Server Emits -> We Receive -> setSignals
        const apiBaseUrl = `${window.location.protocol}//${window.location.hostname}:3001`;

        fetch(`${apiBaseUrl}/api/webhook`, { // reusing webhook endpoint as it does exactly what we need
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                strategy: signal.strategy,
                symbol: signal.symbol,
                side: signal.side,
                price: signal.price,
                note: signal.note,
                // Passing full signal object fields that webhook endpoint might not expect but we want to save?
                // The current server/index.cjs webhook handler reconstructs the signal.
                // It might overwrite ID and Time.
                // Let's check server/index.cjs again... 
                // It generates new ID: `wh_${Date.now()}` and new Time.
                // For internal signals, we might want to keep our ID/Time or let server handle it.
                // Let server handle it for consistency.
            })
        }).catch(err => console.error('Failed to persist signal:', err));
    }, []);

    // --- Logic: RMI Signals ---
    useEffect(() => {
        const checkRMI = () => {
            const now = Date.now();
            const tickers = marketDataRef.current;
            const settings = settingsRef.current.momentum;

            Object.values(tickers).forEach((ticker: Ticker) => {
                if (!ticker.symbol.endsWith('USDT') || ticker.volume < 10000) return;
                const isOverbought = ticker.priceChangePercent > settings.threshold;
                const isOversold = ticker.priceChangePercent < -settings.threshold;

                if (isOverbought || isOversold) {
                    const lastTrigger = rmiCooldownsRef.current[ticker.symbol] || 0;
                    if (now - lastTrigger > (settings.cooldown * 1000)) {
                        const type = isOverbought ? 'RMI_Overbought' : 'RMI_Oversold';
                        const side = isOverbought ? 'SELL' : 'BUY';

                        // Create Signal Payload
                        const signalCtx: Signal = {
                            id: `rmi_${now}_${ticker.symbol}`, // Placeholder, server will replace
                            strategy: type,
                            symbol: ticker.symbol,
                            side: side,
                            price: ticker.lastPrice,
                            time: new Date().toISOString(),
                            note: `Momentum Extreme`,
                            confidence: 0.8,
                            source: 'ALGO_MOMENTUM'
                        };

                        // Send to Server
                        persistSignal(signalCtx);

                        // Update Cooldown
                        rmiCooldownsRef.current[ticker.symbol] = now;
                    }
                }
            });
        };
        // Check less frequently to save CPU (6s instead of 3s)
        const interval = setInterval(checkRMI, 6000);
        return () => clearInterval(interval);
    }, [persistSignal]);

    // --- Logic: Volume Spike Detection ---
    const volumeHistoryRef = useRef<Record<string, { deltas: number[], lastRawVolume: number, lastUpdate: number }>>({});

    useEffect(() => {
        const checkVolumeSpikes = () => {
            const now = Date.now();
            const tickers = marketDataRef.current;
            const settings = settingsRef.current.volume;

            let totalChecked = 0;
            let withHistory = 0;
            let volumeRatios: Array<{ symbol: string, ratio: number, current: number, avg: number }> = [];

            Object.values(tickers).forEach((ticker: Ticker) => {
                if (!ticker.symbol.endsWith('USDT')) return;
                // Increase threshold to 50k to reduce load processing junk coins
                if (ticker.volume < 50000) return;

                totalChecked++;
                // ... existing logic ...
            });
            // ... (rest of function)
        };

        // Increase interval to 10s
        const interval = setInterval(checkVolumeSpikes, 10000);
        return () => {
            clearInterval(interval);
        };
    }, [persistSignal]);

    // --- Logic: Futures Divergence Signals (Smart Money) ---
    useEffect(() => {
        const checkDivergence = () => {
            // ... existing logic ...
        };

        // Increase interval to 10s
        const interval = setInterval(checkDivergence, 10000);
        return () => clearInterval(interval);
    }, [persistSignal]);
    // --- Logic: Big Move Scanner (Binance Style) ---
    const spotPriceHistoryRef = useRef<Record<string, Array<{ t: number; p: number }>>>({});
    const spotBigMoveCooldownsRef = useRef<Record<string, number>>({});

    // --- Logic: Big Move Scanner (Binance Style) ---
    // ...
    useEffect(() => {
        const scanBigMoves = () => {
            const now = Date.now();
            const tickers = marketDataRef.current;
            const newBigMoves: import('../types').BigMoveSignal[] = [];

            // Performance: Only scan top assets by volume or drastic changes
            // To do this simply, we filter keys first or just iterate but fail fast.
            Object.values(tickers).forEach((ticker: Ticker) => {
                if (!ticker.symbol.endsWith('USDT')) return;
                // optimization: skip low volume assets for big move history tracking to save RAM/CPU
                if (ticker.volume < 50000 && Math.abs(ticker.priceChangePercent) < 5) return;

                const price = ticker.lastPrice;

                // 1. Maintain History
                if (!spotPriceHistoryRef.current[ticker.symbol]) {
                    spotPriceHistoryRef.current[ticker.symbol] = [];
                }
                const history = spotPriceHistoryRef.current[ticker.symbol];

                history.push({ t: now, p: price });

                // Prune old history (> 15 mins)
                const pruneTime = now - 16 * 60 * 1000;
                if (history[0] && history[0].t < pruneTime) {
                    const cutoffIndex = history.findIndex(h => h.t >= pruneTime);
                    if (cutoffIndex > 0) history.splice(0, cutoffIndex);
                }

                const getPriceAgo = (msAgo: number) => {
                    const targetTime = now - msAgo;
                    if (history.length === 0 || history[0].t > targetTime + 2000) return null;
                    const point = history.find(h => h.t >= targetTime);
                    return point ? point.p : null;
                };

                const checkCooldown = (key: string, durationMs: number = 60000) => {
                    const last = spotBigMoveCooldownsRef.current[key] || 0;
                    if (now - last > durationMs) {
                        spotBigMoveCooldownsRef.current[key] = now;
                        return true;
                    }
                    return false;
                };

                // --- A. New 24h High/Low ---
                if (ticker.highPrice && price >= ticker.highPrice * 0.9999) {
                    if (checkCooldown(`${ticker.symbol}_high`, 300000)) {
                        newBigMoves.push({
                            id: `high_${now}_${ticker.symbol}`,
                            symbol: ticker.symbol,
                            type: 'HIGH',
                            timeframe: '24h',
                            price: price,
                            description: 'New 24h High',
                            timestamp: now,
                            level: 'HIGH'
                        });
                    }
                }
                if (ticker.lowPrice && price <= ticker.lowPrice * 1.0001) {
                    if (checkCooldown(`${ticker.symbol}_low`, 300000)) {
                        newBigMoves.push({
                            id: `low_${now}_${ticker.symbol}`,
                            symbol: ticker.symbol,
                            type: 'LOW',
                            timeframe: '24h',
                            price: price,
                            description: 'New 24h Low',
                            timestamp: now,
                            level: 'HIGH'
                        });
                    }
                }

                // --- B. Price Rise/Fall (5m) ---
                const p5m = getPriceAgo(5 * 60 * 1000);
                if (p5m) {
                    const change5m = ((price - p5m) / p5m) * 100;
                    const absChange = Math.abs(change5m);

                    if (absChange >= 2) { // 2% move in 5m for Spot
                        let level: 'SMALL' | 'MID' | 'HIGH' = 'SMALL';
                        if (absChange >= 8) level = 'HIGH';
                        else if (absChange >= 4) level = 'MID';

                        const type = change5m > 0 ? 'RISE' : 'FALL';
                        const key = `${ticker.symbol}_5m_${type}_${level}`;

                        if (checkCooldown(key, 60000)) {
                            newBigMoves.push({
                                id: `5m_${type}_${now}_${ticker.symbol}`,
                                symbol: ticker.symbol,
                                type: type,
                                timeframe: '5m',
                                changePercent: absChange,
                                price: price,
                                description: `${level} 5m ${type === 'RISE' ? 'Pump' : 'Dump'} (${change5m.toFixed(2)}%)`,
                                timestamp: now,
                                level
                            });
                        }
                    }
                }

                // --- C. Flash Pump Detection (1m) ---
                const p1m = getPriceAgo(60 * 1000);
                if (p1m) {
                    const change1m = ((price - p1m) / p1m) * 100;
                    const absChange = Math.abs(change1m);

                    if (absChange >= 1.5) { // 1.5% in 1 minute is FLASH
                        const type = change1m > 0 ? 'RISE' : 'FALL';
                        if (checkCooldown(`${ticker.symbol}_1m_${type}`, 30000)) {
                            newBigMoves.push({
                                id: `1m_${type}_${now}_${ticker.symbol}`,
                                symbol: ticker.symbol,
                                type: type,
                                timeframe: '5m',
                                changePercent: absChange,
                                price: price,
                                description: `FLASH ${type === 'RISE' ? 'Pump' : 'Dump'} (${change1m.toFixed(2)}% in 1m)`,
                                timestamp: now,
                                level: absChange > 3 ? 'HIGH' : 'MID'
                            });
                        }
                    }
                }
            });

            if (newBigMoves.length > 0) {
                setBigMoves(prev => [...newBigMoves, ...prev].slice(0, 50));
            }
        };

        // Increase to 10s
        const interval = setInterval(scanBigMoves, 10000);
        return () => clearInterval(interval);
    }, [notificationSettings]);

    // --- Logic: Futures Big Move Scanner ---
    const [bigMoves, setBigMoves] = useState<import('../types').BigMoveSignal[]>([]);
    const [futuresBigMoves, setFuturesBigMoves] = useState<import('../types').BigMoveSignal[]>([]);
    const futuresPriceHistoryRef = useRef<Record<string, Array<{ t: number; p: number }>>>({});
    const futuresBigMoveCooldownsRef = useRef<Record<string, number>>({});

    useEffect(() => {
        const scanFuturesBigMoves = () => {
            const now = Date.now();
            const tickers = futuresDataRef.current;
            const newBigMoves: import('../types').BigMoveSignal[] = [];

            Object.values(tickers).forEach((ticker: any) => {
                if (!ticker.symbol.endsWith('USDT')) return;

                const fTicker = ticker as import('../types').FuturesTicker;
                const price = fTicker.markPrice;

                // 1. Maintain History
                if (!futuresPriceHistoryRef.current[fTicker.symbol]) {
                    futuresPriceHistoryRef.current[fTicker.symbol] = [];
                }
                const history = futuresPriceHistoryRef.current[fTicker.symbol];

                history.push({ t: now, p: price });

                // Prune old history (> 15 mins)
                const pruneTime = now - 16 * 60 * 1000;
                if (history[0] && history[0].t < pruneTime) {
                    const cutoffIndex = history.findIndex(h => h.t >= pruneTime);
                    if (cutoffIndex > 0) history.splice(0, cutoffIndex);
                }

                const getPriceAgo = (msAgo: number) => {
                    const targetTime = now - msAgo;
                    // Robust check: ensure we actually HAVE history from that long ago
                    if (history.length === 0 || history[0].t > targetTime + 2000) return null;

                    const point = history.find(h => h.t >= targetTime);
                    return point ? point.p : null;
                };

                const checkCooldown = (key: string, durationMs: number = 60000) => {
                    const last = futuresBigMoveCooldownsRef.current[key] || 0;
                    if (now - last > durationMs) {
                        futuresBigMoveCooldownsRef.current[key] = now;
                        return true;
                    }
                    return false;
                };

                // --- A. New 24h High/Low ---
                if (fTicker.highPrice && price >= fTicker.highPrice * 0.9999) {
                    if (checkCooldown(`${fTicker.symbol}_perp_high`, 300000)) {
                        newBigMoves.push({
                            id: `perp_high_${now}_${fTicker.symbol}`,
                            symbol: fTicker.symbol,
                            type: 'HIGH',
                            timeframe: '24h',
                            price: price,
                            description: 'Perp New 24h High',
                            timestamp: now,
                            level: 'HIGH'
                        });
                    }
                }
                if (fTicker.lowPrice && price <= fTicker.lowPrice * 1.0001) {
                    if (checkCooldown(`${fTicker.symbol}_perp_low`, 300000)) {
                        newBigMoves.push({
                            id: `perp_low_${now}_${fTicker.symbol}`,
                            symbol: fTicker.symbol,
                            type: 'LOW',
                            timeframe: '24h',
                            price: price,
                            description: 'Perp New 24h Low',
                            timestamp: now,
                            level: 'HIGH'
                        });
                    }
                }

                // --- B. Price Rise/Fall (5m) ---
                const p5m = getPriceAgo(5 * 60 * 1000);
                if (p5m) {
                    const change5m = ((price - p5m) / p5m) * 100;
                    const absChange = Math.abs(change5m);

                    if (absChange >= 1) {
                        let level: 'SMALL' | 'MID' | 'HIGH' = 'SMALL';
                        if (absChange >= 6) level = 'HIGH';
                        else if (absChange >= 3) level = 'MID';

                        const type = change5m > 0 ? 'RISE' : 'FALL';
                        const key = `${fTicker.symbol}_perp_5m_${type}_${level}`;

                        if (checkCooldown(key, 60000)) {
                            newBigMoves.push({
                                id: `perp_5m_${type}_${now}_${fTicker.symbol}`,
                                symbol: fTicker.symbol,
                                type: type,
                                timeframe: '5m',
                                changePercent: absChange,
                                price: price,
                                description: `Perp ${level} 5m ${type === 'RISE' ? 'Pump' : 'Dump'} (${change5m.toFixed(2)}%)`,
                                timestamp: now,
                                level
                            });
                        }
                    }
                }

                // --- C. Flash Pump Detection (1m) ---
                const p1m = getPriceAgo(60 * 1000);
                if (p1m) {
                    const change1m = ((price - p1m) / p1m) * 100;
                    const absChange = Math.abs(change1m);

                    if (absChange >= 0.8) { // 0.8% in 1 minute is FLASH on perps
                        const type = change1m > 0 ? 'RISE' : 'FALL';
                        if (checkCooldown(`${fTicker.symbol}_perp_1m_${type}`, 30000)) {
                            newBigMoves.push({
                                id: `perp_1m_${type}_${now}_${fTicker.symbol}`,
                                symbol: fTicker.symbol,
                                type: type,
                                timeframe: '5m',
                                changePercent: absChange,
                                price: price,
                                description: `FLASH Perp ${type === 'RISE' ? 'Pump' : 'Dump'} (${change1m.toFixed(2)}% in 1m)`,
                                timestamp: now,
                                level: absChange > 2 ? 'HIGH' : 'MID'
                            });
                        }
                    }
                }

                // --- D. Rally / Pullback ---
                const openPrice = fTicker.openPrice || 0;
                if (openPrice > 0) {
                    // Pullback from 24h High
                    const dayMaxRise = ((fTicker.highPrice! - openPrice) / openPrice) * 100;
                    if (dayMaxRise >= 6) {
                        const pullback = ((fTicker.highPrice! - price) / fTicker.highPrice!) * 100;
                        if (pullback >= 4) {
                            if (checkCooldown(`${fTicker.symbol}_perp_pullback`, 300000)) {
                                newBigMoves.push({
                                    id: `perp_pull_${now}_${fTicker.symbol}`,
                                    symbol: fTicker.symbol,
                                    type: 'PULLBACK',
                                    price: price,
                                    description: `Perp Pullback (-${pullback.toFixed(1)}%)`,
                                    timestamp: now,
                                    level: 'MID'
                                });
                            }
                        }
                    }

                    // Rally from 24h Low
                    const dayMaxDrop = ((openPrice - fTicker.lowPrice!) / openPrice) * 100;
                    if (dayMaxDrop >= 6) {
                        const rally = ((price - fTicker.lowPrice!) / fTicker.lowPrice!) * 100;
                        if (rally >= 4) {
                            if (checkCooldown(`${fTicker.symbol}_perp_rally`, 300000)) {
                                newBigMoves.push({
                                    id: `perp_rally_${now}_${fTicker.symbol}`,
                                    symbol: fTicker.symbol,
                                    type: 'RALLY',
                                    price: price,
                                    description: `Perp Rally from Low (+${rally.toFixed(1)}%)`,
                                    timestamp: now,
                                    level: 'MID'
                                });
                            }
                        }
                    }
                }
            });

            if (newBigMoves.length > 0) {
                setFuturesBigMoves(prev => [...newBigMoves, ...prev].slice(0, 50));

                if (notificationSettings.notifyOnBigMoves && notificationSettings.soundEnabled) {
                    newBigMoves.forEach(move => {
                        const levelPriority = move.level === 'HIGH' ? 'HIGH' : move.level === 'MID' ? 'MEDIUM' : 'LOW';
                        if (shouldNotify(levelPriority)) {
                            notifyBigMove(move.symbol, move.type, move.changePercent || 0, move.level);
                        }
                    });
                }
            }
        };

        const interval = setInterval(scanFuturesBigMoves, 2000);
        return () => clearInterval(interval);
    }, [notificationSettings, shouldNotify]);

    return (
        <SignalContext.Provider value={{
            signals, setSignals,
            bigMoves, // Export bigMoves
            futuresBigMoves, // Export futuresBigMoves
            rules, setRules,
            priceAlerts, setPriceAlerts,
            toasts, addToast, dismissToast,
            handleDeleteSignal, handleClearAllSignals, handleManualSignal,
            alertModal, openAlertModal, closeAlertModal, handleCreateAlert,
            signalSettings, updateSignalSettings,
            notificationSettings, updateNotificationSettings, requestNotificationPermission,
            patterns
        }}>
            {children}
        </SignalContext.Provider>
    );
};

export const useSignals = () => {
    const context = useContext(SignalContext);
    if (!context) {
        throw new Error('useSignals must be used within a SignalProvider');
    }
    return context;
};
