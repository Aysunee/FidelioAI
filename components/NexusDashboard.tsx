import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    TrendingUp, TrendingDown, Activity, Layers, Link as LinkIcon,
    Search, Zap, Shield, Database, ArrowRight, BarChart3
} from 'lucide-react';
import { useMarketData } from '../context/MarketContext';
import { useUser } from '../context/UserContext';
import { 
    addPriceData, 
    calculateCorrelationMatrix, 
    getPriceHistory,
    CorrelationMatrix as CorrelationMatrixType,
    CorrelationPair,
    getCorrelationColor,
    cleanupOldData
} from '../utils/correlationEngine';
import CorrelationMatrix from './CorrelationMatrix';
import ErrorBoundary from './ErrorBoundary';

// --- DATA CONSTANTS ---
const CATEGORIES = [
    { name: "Smart Contract Platforms", coins: ["ETH", "SOL", "BNB", "ADA", "DOT"], desc: "Akıllı sözleşmeler ve dApp altyapısı." },
    { name: "DeFi", coins: ["UNI", "LINK", "AAVE", "MKR"], desc: "Aracısız finansal işlemler ve protokoller." },
    { name: "Memes", coins: ["DOGE", "SHIB", "PEPE", "FLOKI", "BONK", "WIF"], desc: "Topluluk odaklı, şaka amaçlı varlıklar." },
    { name: "AI & Big Data", coins: ["FET", "NEAR", "RNDR", "GRT"], desc: "Yapay zeka ve veri işleme." },
    { name: "Layer 2 (L2)", coins: ["ARB", "OP", "MATIC", "MNT"], desc: "Ölçeklendirme çözümleri." },
    { name: "RWA", coins: ["ONDO", "LINK", "OM"], desc: "Gerçek dünya varlıkları." },
    { name: "Gaming / Metaverse", coins: ["AXS", "SAND", "MANA", "GALA", "IMX"], desc: "Oyun ve sanal evrenler." },
    { name: "Liquid Staking", coins: ["LDO", "RPL", "ENA"], desc: "Likidite sağlayan staking." },
    { name: "Solana Ecosystem", coins: ["SOL", "JUP", "RAY", "PYTH"], desc: "Solana ağı projeleri." },
    { name: "DePIN", coins: ["RNDR", "HNT", "FIL", "AR"], desc: "Fiziksel altyapı ağları." },
    { name: "Oracles", coins: ["LINK", "PYTH", "BAND"], desc: "Veri akışı sağlayıcıları." },
    { name: "Privacy", coins: ["XMR", "ZEC", "ROSE", "SCRT"], desc: "Gizlilik odaklı." },
    { name: "Storage", coins: ["FIL", "AR", "STORJ", "SC"], desc: "Veri depolama." },
    { name: "CEX Tokens", coins: ["BNB", "OKB", "CRO", "KCS"], desc: "Borsa tokenları." },
    { name: "Payments", coins: ["XRP", "XLM", "ACH"], desc: "Ödeme sistemleri." },
    { name: "Bitcoin Ecosystem", coins: ["STX", "ORDI", "SATS"], desc: "BTC katmanları." },
    { name: "Fan Tokens", coins: ["SANTOS", "BAR", "CITY", "PORTO", "LAZIO", "PSG", "OG", "ASR", "ATM", "ACM"], desc: "Spor ve taraftar tokenları." },
    { name: "Çin Kökenli / Odaklı", coins: ["TRX", "VET", "NEO", "QTUM", "FIL", "CAKE", "CFX", "SUN", "CKB", "SUSHI", "ACH", "JST", "ONT", "NKN", "GHST", "HOOK", "WAN", "DYDX", "PHB"], desc: "Asya pazarı odaklı projeler." },
    { name: "2017 Boğa Efsaneleri", coins: ["XRP", "TRX", "ADA", "BCH", "ZEC", "XMR", "XLM", "LTC", "ETC", "FIL", "XTZ", "IOTA", "NEO", "EOS"], desc: "Eski döngülerin popüler coinleri." }
];

const CORRELATIONS = [
    { driver: "WLFI", followers: ["TRUMP", "MELANIA"], note: "Politik Tokenlar" },
    { driver: "BTC", followers: ["ETH", "SOL", "AVAX", "ADA"], note: "Piyasa Liderleri (TOTAL)" },
    { driver: "DOGE", followers: ["PEPE", "SHIB"], note: "OG Memes" },
    { driver: "FLOKI", followers: ["BONK"], note: "Köpek Tokenları" },
    { driver: "WIF", followers: ["NEIRO", "GIGGLE"], note: "Yeni Nesil Meme" },
    { driver: "AVAX", followers: ["JOE"], note: "Avalanche Ekosistemi" },
    { driver: "NEO", followers: ["ONT", "GAS"], note: "Legacy China" },
    { driver: "ADA", followers: ["XLM"], note: "Eski Nesil L1" },
    { driver: "ATOM", followers: ["KAVA", "ALGO"], note: "Cosmos & Interop" },
    { driver: "SANTOS", followers: ["PORTO", "LAZIO"], note: "Fan Token Liderleri" },
    { driver: "USTC", followers: ["LUNC"], note: "Terra Classic" },
    { driver: "LUNC", followers: ["ANC", "MIR"], note: "Terra Classic Eco" },
    { driver: "MANA", followers: ["SAND", "ENJ"], note: "Metaverse" },
    { driver: "AXS", followers: ["SLP"], note: "Play to Earn" },
    { driver: "SFP", followers: ["C98", "TWT"], note: "Cüzdan Tokenları" },
    { driver: "JST", followers: ["SUN"], note: "Tron Ekosistemi" },
];

const getSymbolPair = (symbol: string) => {
    const s = symbol.toUpperCase();
    if (s === "TOTAL") return "BTCUSDT";
    if (s === "GIGGLE") return null; // Only this one might not exist
    if (s === "SATS") return "1000SATSUSDT";
    const specialRules: Record<string, string> = {
        "BONK": "BONKUSDT", "PEPE": "PEPEUSDT", "SHIB": "SHIBUSDT", "FLOKI": "FLOKIUSDT", "WIF": "WIFUSDT"
    };
    return specialRules[s] || `${s}USDT`;
};

const cn = (...classes: any[]) => classes.filter(Boolean).join(' ');

// --- TABLE COMPONENTS ---

const ArchitectTableRow: React.FC<{
    symbol: string;
    price?: string;
    change?: string;
    role?: string;
    isDriver?: boolean;
    isLagging?: boolean;
    cluster?: string;
}> = ({ symbol, price, change, role, isDriver = false, isLagging = false, cluster }) => {
    const isPositive = parseFloat(change || '0') >= 0;
    const { theme } = useUser();

    // Safety check for symbol
    if (!symbol) return null;

    return (
        <motion.tr
            initial={{ opacity: 0, x: -5 }}
            animate={{ opacity: 1, x: 0 }}
            className={cn(
                "group transition-all duration-500 relative overflow-hidden",
                isDriver ? "bg-indigo-500/[0.03]" : "hover:bg-white/[0.02]",
                isLagging && "bg-amber-500/[0.03] shadow-[inset_0_0_20px_rgba(245,158,11,0.05)]",
                theme === 'corporate' && (isDriver ? "bg-gray-50" : "hover:bg-gray-50/50"),
                theme === 'corporate' && isLagging && "bg-amber-50"
            )}
        >
            <td className="py-3 px-4">
                <div className="flex items-center gap-3">
                    <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center font-black text-[10px] border shadow-sm transition-colors duration-500",
                        isDriver ? "bg-indigo-600 text-white border-indigo-500 shadow-indigo-500/20" :
                            isLagging ? "bg-amber-500 text-black border-amber-400 shadow-amber-500/20" :
                                "bg-white/5 border-white/5 text-gray-400"
                    )}>
                        {symbol.charAt(0)}
                    </div>
                    <div>
                        <div className="text-sm font-bold text-gray-100 flex items-center gap-2">
                            {symbol}
                            {isDriver && <Zap size={10} className="text-amber-400 fill-amber-400" />}
                            {isLagging && (
                                <motion.div
                                    animate={{ opacity: [0.4, 1, 0.4] }}
                                    transition={{ duration: 2, repeat: Infinity }}
                                >
                                    <Activity size={10} className="text-amber-400" />
                                </motion.div>
                            )}
                        </div>
                        {cluster && <div className="text-[10px] text-gray-500 font-medium uppercase tracking-tighter">{cluster}</div>}
                    </div>
                </div>
            </td>
            <td className="py-3 px-4 tabular-nums">
                <div className="text-sm font-medium text-gray-200">
                    {price ? `$${parseFloat(price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}` : '---'}
                </div>
            </td>
            <td className="py-3 px-4 tabular-nums">
                {change ? (
                    <div className={cn(
                        "inline-flex items-center text-xs font-bold px-2 py-0.5 rounded-md border",
                        isPositive ? "text-emerald-400 border-emerald-500/10 bg-emerald-500/5" : "text-rose-400 border-rose-500/10 bg-rose-500/5"
                    )}>
                        {isPositive ? <TrendingUp size={10} className="mr-1" /> : <TrendingDown size={10} className="mr-1" />}
                        {parseFloat(change).toFixed(2)}%
                    </div>
                ) : (
                    <div className="inline-flex items-center text-xs font-bold px-2 py-0.5 rounded-md border border-gray-500/10 bg-gray-500/5 text-gray-500">
                        <span className="text-[10px] uppercase tracking-wider">N/A</span>
                    </div>
                )}
            </td>
            <td className="py-3 px-4">
                <div className="flex items-center gap-2">
                    <div className={cn(
                        "text-[10px] font-bold uppercase tracking-widest",
                        isDriver ? "text-indigo-400" : isLagging ? "text-amber-400" : "text-gray-500"
                    )}>
                        {role || (isDriver ? "Primary Driver" : "Secondary Pair")}
                    </div>
                    {isLagging && (
                        <motion.span
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="text-[8px] px-1.5 py-0.5 bg-amber-500 text-black font-black rounded uppercase tracking-tighter shadow-lg shadow-amber-500/20"
                        >
                            Opportunity
                        </motion.span>
                    )}
                </div>
            </td>
            <td className="py-3 px-4 text-right">
                <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <button className="text-gray-500 hover:text-purple-400 transition-colors">
                        <ArrowRight size={14} />
                    </button>
                </div>
            </td>
            {/* Visual Flare for Lagging */}
            {isLagging && (
                <div className="absolute left-0 top-0 w-1 h-full bg-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.5)]" />
            )}
        </motion.tr>
    );
};

const MAJOR_SYMBOLS = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 
    'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'MATICUSDT', 'LINKUSDT',
    'UNIUSDT', 'ATOMUSDT', 'LTCUSDT', 'BCHUSDT', 'ALGOUSDT',
    'VETUSDT', 'FILUSDT', 'TRXUSDT', 'ETCUSDT', 'XLMUSDT'
];

export const NexusDashboard: React.FC = () => {
    const { marketData } = useMarketData();
    const [activeTab, setActiveTab] = useState<'clusters' | 'correlations' | 'matrix'>('clusters');
    const [correlationMatrix, setCorrelationMatrix] = useState<CorrelationMatrixType | null>(null);
    const [lastUpdate, setLastUpdate] = useState<number>(Date.now());
    const [searchTerm, setSearchTerm] = useState("");
    const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
    const [sortConfig, setSortConfig] = useState<{ field: 'name' | 'velocity' | 'price' | 'change', direction: 'asc' | 'desc' }>({
        field: 'velocity',
        direction: 'desc'
    });

    const toggleCat = (name: string) => {
        const next = new Set(expandedCats);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        setExpandedCats(next);
    };

    const handleSort = (field: 'name' | 'velocity' | 'price' | 'change') => {
        setSortConfig(prev => ({
            field,
            direction: prev.field === field && prev.direction === 'desc' ? 'asc' : 'desc'
        }));
    };

    // Track price history for correlation calculation
    useEffect(() => {
        // Add current prices to history whenever marketData updates
        Object.entries(marketData).forEach(([symbol, data]) => {
            if (data && data.lastPrice) {
                addPriceData(symbol, parseFloat(data.lastPrice));
            }
        });
    }, [marketData]);

    // Calculate correlation matrix periodically
    useEffect(() => {
        // Initial calculation after 2 seconds
        const initialTimeout = setTimeout(() => {
            const priceHist = getPriceHistory();
            const symbolsWithData = MAJOR_SYMBOLS.filter(symbol => {
                const history = priceHist.get(symbol);
                return history && history.length >= 5;
            });
            if (symbolsWithData.length >= 3) {
                const matrix = calculateCorrelationMatrix(symbolsWithData);
                setCorrelationMatrix(matrix);
                setLastUpdate(Date.now());
                console.log('[Correlation] Initial matrix calculated');
            }
        }, 2000);

        const interval = setInterval(() => {
            // Get symbols that have enough data in priceHistory
            const priceHist = getPriceHistory();
            const symbolsWithData = MAJOR_SYMBOLS.filter(symbol => {
                const history = priceHist.get(symbol);
                return history && history.length >= 5;
            });
            
            if (symbolsWithData.length >= 3) {
                try {
                    const matrix = calculateCorrelationMatrix(symbolsWithData);
                    console.log('[Correlation] Matrix calculated:', {
                        symbols: matrix.symbols.length,
                        pairs: matrix.pairs.length,
                        timestamp: new Date(matrix.timestamp).toLocaleTimeString()
                    });
                    setCorrelationMatrix(matrix);
                    setLastUpdate(Date.now());
                } catch (err) {
                    console.error('[Correlation] Error calculating matrix:', err);
                }
            } else {
                console.log('[Correlation] Not enough symbols:', symbolsWithData.length);
            }
        }, 5000);

        return () => {
            clearInterval(interval);
            clearTimeout(initialTimeout);
        };
    }, []);

    // Calculate correlations using 24h price change as fallback - only recalculate every 10 seconds
    const [correlationTick, setCorrelationTick] = useState(0);
    
    useEffect(() => {
        const tickInterval = setInterval(() => {
            setCorrelationTick(t => t + 1);
        }, 10000); // Update every 10 seconds
        return () => clearInterval(tickInterval);
    }, []);

    const estimatedCorrelations = useMemo(() => {
        return CORRELATIONS.map(corr => {
            const driverPair = getSymbolPair(corr.driver);
            const driverChangePercent = driverPair && marketData[driverPair] 
                ? parseFloat(marketData[driverPair].priceChangePercent) 
                : 0;

            const followers = Array.isArray(corr.followers) ? corr.followers.map(followerSymbol => {
                const pair = getSymbolPair(followerSymbol);
                const pairChange = pair && marketData[pair] 
                    ? parseFloat(marketData[pair].priceChangePercent) 
                    : 0;

                // Estimate correlation from 24h moves
                const sameDirection = (driverChangePercent >= 0 && pairChange >= 0) || 
                                     (driverChangePercent < 0 && pairChange < 0);
                const diff = Math.abs(driverChangePercent - pairChange);
                const estimatedCorr = sameDirection 
                    ? Math.max(0.3, 1 - (diff / 10)) 
                    : -Math.max(0.3, 1 - (diff / 10));

                // Lag detection
                const isLagging = Math.abs(estimatedCorr) > 0.5 && 
                    driverChangePercent > 2.0 && 
                    pairChange < 0.5 && 
                    (driverChangePercent - pairChange) > 1.5;

                return { 
                    symbol: followerSymbol, 
                    change: pairChange, 
                    isLagging,
                    correlation: estimatedCorr,
                    correlationStrength: Math.abs(estimatedCorr) > 0.7 ? 'STRONG' : 
                                        Math.abs(estimatedCorr) > 0.4 ? 'MODERATE' : 'WEAK'
                };
            }) : [];

            const maxChange = followers.length > 0 
                ? Math.max(driverChangePercent, ...followers.map(f => f.change ?? 0)) 
                : driverChangePercent;
            const hasOpportunity = followers.some(f => f.isLagging);
            const avgCorrelation = followers.length > 0 
                ? (followers.reduce((sum, f) => sum + (f.correlation ?? 0), 0) / followers.length)
                : 0.7;

            return { 
                ...corr, 
                followers, 
                maxChange: isNaN(maxChange) ? 0 : maxChange, 
                driverChange: driverChangePercent, 
                hasOpportunity,
                avgCorrelation: isNaN(avgCorrelation) ? 0.7 : avgCorrelation,
                correlationQuality: avgCorrelation > 0.7 ? 'STRONG' : avgCorrelation > 0.4 ? 'MODERATE' : 'WEAK'
            };
        });
    }, [correlationTick, marketData]);

    // Calculate enhanced correlations with real data (when available)
    const enhancedCorrelations = useMemo(() => {
        // If no correlation matrix yet, use estimated correlations
        if (!correlationMatrix) return estimatedCorrelations;
        
        return CORRELATIONS.map(corr => {
            const driverPair = getSymbolPair(corr.driver);
            const driverChangePercent = driverPair && marketData[driverPair] 
                ? parseFloat(marketData[driverPair].priceChangePercent) 
                : 0;

            const followers = Array.isArray(corr.followers) ? corr.followers.map(followerSymbol => {
                const pair = getSymbolPair(followerSymbol);
                const pairChange = pair && marketData[pair] 
                    ? parseFloat(marketData[pair].priceChangePercent) 
                    : 0;

                // Find actual correlation data
                const corrData = correlationMatrix?.pairs?.find(p => 
                    (p.symbolA === driverPair && p.symbolB === pair) ||
                    (p.symbolA === pair && p.symbolB === driverPair)
                );

                // Use real correlation if available, otherwise estimated
                const estimatedCorrData = estimatedCorrelations.find(ec => ec.driver === corr.driver);
                const fallbackCorr = estimatedCorrData?.followers?.find((ef: any) => ef.symbol === followerSymbol)?.correlation;
                const correlationValue = corrData?.correlation ?? fallbackCorr ?? 0;

                // Enhanced lag logic with correlation context
                const correlationStrength = Math.abs(correlationValue);
                const isLagging = correlationStrength > 0.5 && 
                    driverChangePercent > 2.0 && 
                    pairChange < 0.5 && 
                    (driverChangePercent - pairChange) > 1.5;

                return { 
                    symbol: followerSymbol, 
                    change: pairChange, 
                    isLagging,
                    correlation: correlationValue,
                    correlationStrength: corrData?.strength ?? 
                        (correlationStrength > 0.7 ? 'STRONG' : correlationStrength > 0.4 ? 'MODERATE' : 'WEAK')
                };
            }) : [];

            const maxChange = followers.length > 0 
                ? Math.max(driverChangePercent, ...followers.map(f => f.change ?? 0)) 
                : driverChangePercent;
            const hasOpportunity = followers.some(f => f.isLagging);
            const avgCorrelation = followers.length > 0 
                ? (followers.reduce((sum, f) => sum + Math.abs(f.correlation ?? 0), 0) / followers.length)
                : 0.7;

            return { 
                ...corr, 
                followers, 
                maxChange: isNaN(maxChange) ? 0 : maxChange, 
                driverChange: driverChangePercent, 
                hasOpportunity,
                avgCorrelation: isNaN(avgCorrelation) ? 0.7 : avgCorrelation,
                correlationQuality: avgCorrelation > 0.7 ? 'STRONG' : avgCorrelation > 0.4 ? 'MODERATE' : 'WEAK'
            };
        });
    }, [correlationMatrix, correlationTick]);

    const processedData = useMemo(() => {
        const lowSearch = searchTerm.toLowerCase();

        if (activeTab === 'clusters') {
            const clusters = CATEGORIES.map(cat => {
                const filteredCoins = cat.coins.filter(c => c.toLowerCase().includes(lowSearch) || cat.name.toLowerCase().includes(lowSearch));
                const validCoins = cat.coins.filter(c => getSymbolPair(c) && marketData[getSymbolPair(c)!]);
                const avgChange = validCoins.length > 0
                    ? validCoins.reduce((acc, c) => acc + parseFloat(marketData[getSymbolPair(c)!].priceChangePercent), 0) / validCoins.length
                    : 0;

                // Also sort coins within cluster if price/change sort is active
                const sortedCoins = [...filteredCoins].sort((a, b) => {
                    // Only sort coins if the sortConfig field is 'price' or 'change'
                    if (sortConfig.field !== 'price' && sortConfig.field !== 'change') {
                        return 0; // No coin-level sorting for 'name' or 'velocity'
                    }

                    const dataA = marketData[getSymbolPair(a)!];
                    const dataB = marketData[getSymbolPair(b)!];
                    if (!dataA || !dataB) return 0;

                    const valA = sortConfig.field === 'price' ? parseFloat(dataA.lastPrice) : parseFloat(dataA.priceChangePercent);
                    const valB = sortConfig.field === 'price' ? parseFloat(dataB.lastPrice) : parseFloat(dataB.priceChangePercent);

                    return sortConfig.direction === 'desc' ? valB - valA : valA - valB;
                });

                return { ...cat, filteredCoins: sortedCoins, avgChange };
            }).filter(cat => cat.filteredCoins.length > 0);

            // Sort clusters
            return clusters.sort((a, b) => {
                if (sortConfig.field === 'name') {
                    return sortConfig.direction === 'desc'
                        ? b.name.localeCompare(a.name)
                        : a.name.localeCompare(b.name);
                }
                // Default or 'velocity' sort
                return sortConfig.direction === 'desc' ? b.avgChange - a.avgChange : a.avgChange - b.avgChange;
            });
        } else if (activeTab === 'correlations') {
            return enhancedCorrelations
                .filter(corr =>
                    corr.driver.toLowerCase().includes(lowSearch) ||
                    corr.followers.some(f => f.symbol.toLowerCase().includes(lowSearch)) ||
                    corr.note.toLowerCase().includes(lowSearch)
                )
                .sort((a, b) => {
                    // Prioritize those with active opportunities, then by correlation strength, then by max momentum
                    if (a.hasOpportunity !== b.hasOpportunity) return a.hasOpportunity ? -1 : 1;
                    if (b.avgCorrelation !== a.avgCorrelation) return b.avgCorrelation - a.avgCorrelation;
                    return b.maxChange - a.maxChange;
                });
        } else {
            return []; // matrix tab handles its own data
        }
    }, [searchTerm, activeTab, sortConfig, enhancedCorrelations]);

    return (
        <div className="flex-1 overflow-hidden flex flex-col space-y-4">
            {/* Minimalist Sub-Header */}
            <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white/[0.02] border border-white/5 p-2 rounded-2xl backdrop-blur-xl">
                <div className="flex items-center gap-1">
                    <TabButton
                        active={activeTab === 'clusters'}
                        onClick={() => setActiveTab('clusters')}
                        icon={<Layers size={14} />}
                        label="Alpha Clusters"
                    />
                    <TabButton
                        active={activeTab === 'correlations'}
                        onClick={() => setActiveTab('correlations')}
                        icon={<LinkIcon size={14} />}
                        label="Correlations"
                    />
                    <TabButton
                        active={activeTab === 'matrix'}
                        onClick={() => setActiveTab('matrix')}
                        icon={<BarChart3 size={14} />}
                        label="Live Matrix"
                    />
                </div>

                <div className="relative w-full md:w-64 group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 transition-colors group-focus-within:text-purple-400" size={14} />
                    <input
                        type="text"
                        placeholder="Search Nexus..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-transparent border-none text-xs text-gray-200 pl-9 pr-4 py-2 focus:outline-none placeholder-gray-600"
                    />
                </div>
            </div>

            {/* Content Container */}
            <div className="flex-1 overflow-y-auto scrollbar-hide border border-white/5 rounded-2xl bg-black/20 backdrop-blur-sm">
                {activeTab === 'matrix' ? (
                    <ErrorBoundary>
                        <div className="p-6">
                            {correlationMatrix ? (
                                <CorrelationMatrix matrix={correlationMatrix} />
                            ) : (
                                <div className="flex flex-col items-center justify-center py-20 text-center">
                                    <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 flex items-center justify-center mb-4 animate-pulse">
                                        <Activity size={32} className="text-indigo-400" />
                                    </div>
                                    <h3 className="text-lg font-black text-white uppercase tracking-tighter mb-2">
                                        Correlation Data Loading
                                    </h3>
                                    <p className="text-sm text-gray-500 max-w-md mb-4">
                                        Collecting market data to calculate real-time correlations. 
                                        This may take a few seconds...
                                    </p>
                                    <MatrixDebugInfo />
                                </div>
                            )}
                        </div>
                    </ErrorBoundary>
                ) : activeTab === 'correlations' ? (
                    <ErrorBoundary>
                        <CorrelationTableContent 
                            processedData={processedData}
                            marketData={marketData}
                            correlationMatrix={correlationMatrix}
                        />
                    </ErrorBoundary>
                ) : (
                <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 z-10 bg-gray-950/80 backdrop-blur-3xl">
                        <tr className="border-b border-white/5">
                            <th
                                onClick={() => handleSort('name')}
                                className="py-3 px-4 text-[10px] font-black text-gray-600 uppercase tracking-[0.2em] cursor-pointer hover:text-gray-400 transition-colors group"
                            >
                                <div className="flex items-center gap-1">
                                    Asset Cluster
                                    <SortIcon active={sortConfig.field === 'name'} direction={sortConfig.direction} />
                                </div>
                            </th>
                            <th
                                onClick={() => handleSort('price')}
                                className="py-3 px-4 text-[10px] font-black text-gray-600 uppercase tracking-[0.2em] cursor-pointer hover:text-gray-400 transition-colors"
                            >
                                <div className="flex items-center gap-1">
                                    Live Price
                                    <SortIcon active={sortConfig.field === 'price'} direction={sortConfig.direction} />
                                </div>
                            </th>
                            <th
                                onClick={() => handleSort('change')}
                                className="py-3 px-4 text-[10px] font-black text-gray-600 uppercase tracking-[0.2em] cursor-pointer hover:text-gray-400 transition-colors"
                            >
                                <div className="flex items-center gap-1">
                                    24h Velocity
                                    <SortIcon active={sortConfig.field === 'change' || sortConfig.field === 'velocity'} direction={sortConfig.direction} />
                                </div>
                            </th>
                            <th className="py-3 px-4 text-[10px] font-black text-gray-600 uppercase tracking-[0.2em]">Market Role</th>
                            <th className="py-3 px-4"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.02]">
                        <AnimatePresence mode="popLayout">
                            {activeTab === 'clusters' ? (
                                (processedData as any[]).map((cat) => (
                                    <React.Fragment key={cat.name}>
                                        <tr
                                            onClick={() => toggleCat(cat.name)}
                                            className="bg-white/[0.01] hover:bg-white/[0.03] cursor-pointer transition-colors group/header"
                                        >
                                            <td colSpan={5} className="py-3 px-4">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-3">
                                                        <div className={cn(
                                                            "transition-transform duration-300",
                                                            expandedCats.has(cat.name) ? "rotate-90" : ""
                                                        )}>
                                                            <ArrowRight size={12} className="text-purple-500/50" />
                                                        </div>
                                                        <span className="text-[10px] font-black text-white/70 uppercase tracking-widest">{cat.name}</span>
                                                    </div>
                                                    <div className="flex items-center gap-3">
                                                        <span className={cn(
                                                            "text-[10px] font-bold tabular-nums px-2 py-0.5 rounded-md border",
                                                            cat.avgChange >= 0 ? "text-emerald-400 border-emerald-500/10 bg-emerald-500/5" : "text-rose-400 border-rose-500/10 bg-rose-500/5"
                                                        )}>
                                                            AVG. {cat.avgChange.toFixed(2)}%
                                                        </span>
                                                        <div className="w-32 h-[1px] bg-gradient-to-r from-purple-500/20 to-transparent" />
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                        {expandedCats.has(cat.name) && cat.filteredCoins.map((coin: string) => {
                                            const pair = getSymbolPair(coin);
                                            const data = pair ? marketData[pair] : null;
                                            return (
                                                <ArchitectTableRow
                                                    key={coin}
                                                    symbol={coin}
                                                    price={data?.lastPrice}
                                                    change={data?.priceChangePercent}
                                                    cluster={cat.name}
                                                />
                                            );
                                        })}
                                    </React.Fragment>
                                ))
                            ) : (
                                (processedData as any[]).map((corr) => (
                                    <React.Fragment key={corr.driver + corr.note}>
                                        <tr className={cn(
                                            "transition-colors",
                                            corr.hasOpportunity ? "bg-amber-500/[0.05]" : "bg-indigo-500/[0.02]"
                                        )}>
                                            <td colSpan={5} className="py-2 px-4">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <span className={cn(
                                                            "text-[10px] font-black uppercase tracking-widest",
                                                            corr.hasOpportunity ? "text-amber-500" : "text-indigo-500/50"
                                                        )}>{corr.note}</span>
                                                        <div className={cn(
                                                            "flex-1 h-[1px] bg-gradient-to-r to-transparent",
                                                            corr.hasOpportunity ? "from-amber-500/20" : "from-indigo-500/10"
                                                        )} />
                                                    </div>
                                                    <div className="flex items-center gap-3">
                                                        {/* Correlation Quality Badge */}
                                                        <span 
                                                            className={cn(
                                                                "text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded border",
                                                                corr.correlationQuality === 'STRONG' 
                                                                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" 
                                                                    : corr.correlationQuality === 'MODERATE'
                                                                    ? "bg-blue-500/10 border-blue-500/30 text-blue-400"
                                                                    : "bg-gray-500/10 border-gray-500/30 text-gray-400"
                                                            )}
                                                            title={correlationMatrix ? "Calculated from live price history" : "Estimated from 24h price change"}
                                                        >
                                                            {corr.correlationQuality === 'STRONG' && '● '}
                                                            {corr.correlationQuality === 'MODERATE' && '◐ '}
                                                            {corr.correlationQuality === 'WEAK' && '○ '}
                                                            r={correlationMatrix ? '' : '~'}{corr.avgCorrelation ? corr.avgCorrelation.toFixed(2) : '0.7'}
                                                            {correlationMatrix ? ' ✓' : ''}
                                                        </span>
                                                        {corr.hasOpportunity && (
                                                            <span className="text-[8px] font-black text-amber-500 animate-pulse">LAGGING ALERT</span>
                                                        )}
                                                        <span className="text-[9px] font-bold text-indigo-400/50 uppercase tracking-tighter">Peak: {corr.maxChange.toFixed(2)}%</span>
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                        {/* Driver Row */}
                                        {(() => {
                                            const pair = getSymbolPair(corr.driver);
                                            const data = pair ? marketData[pair] : null;
                                            return (
                                                <ArchitectTableRow
                                                    symbol={corr.driver}
                                                    price={data?.lastPrice}
                                                    change={data?.priceChangePercent}
                                                    isDriver={true}
                                                    role="Catalyst Driver"
                                                />
                                            );
                                        })()}
                                        {/* Follower Rows */}
                                        {corr.followers.map((f: any) => {
                                            const pair = getSymbolPair(f.symbol);
                                            const data = pair ? marketData[pair] : null;
                                            // Build role text with correlation info
                                            let roleText = f.isLagging ? "Laggard Follower" : "Follower Pair";
                                            if (f.correlation != null && !isNaN(f.correlation)) {
                                                const corrStr = f.correlation > 0 ? `+${f.correlation.toFixed(2)}` : f.correlation.toFixed(2);
                                                roleText += ` (${corrStr})`;
                                            }
                                            return (
                                                <ArchitectTableRow
                                                    key={f.symbol}
                                                    symbol={f.symbol}
                                                    price={data?.lastPrice}
                                                    change={data?.priceChangePercent}
                                                    isLagging={f.isLagging}
                                                    role={roleText}
                                                />
                                            );
                                        })}
                                    </React.Fragment>
                                ))
                            )}
                        </AnimatePresence>
                    </tbody>
                </table>
                )}
            </div>
        </div>
    );
};

// Separate component for Correlations table to better isolate errors
const CorrelationTableContent: React.FC<{
    processedData: any[];
    marketData: Record<string, any>;
    correlationMatrix: CorrelationMatrixType | null;
}> = ({ processedData, marketData, correlationMatrix }) => {
    const getSymbolPair = (symbol: string) => {
        const s = symbol.toUpperCase();
        if (s === "TOTAL") return "BTCUSDT";
        if (s === "SATS") return "1000SATSUSDT";
        const specialRules: Record<string, string> = {
            "BONK": "BONKUSDT", "PEPE": "PEPEUSDT", "SHIB": "SHIBUSDT", "FLOKI": "FLOKIUSDT", "WIF": "WIFUSDT"
        };
        return specialRules[s] || `${s}USDT`;
    };

    const cn = (...classes: any[]) => classes.filter(Boolean).join(' ');

    return (
        <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 z-10 bg-gray-950/80 backdrop-blur-3xl">
                <tr className="border-b border-white/5">
                    <th className="py-3 px-4 text-[10px] font-black text-gray-600 uppercase tracking-[0.2em]">Asset Cluster</th>
                    <th className="py-3 px-4 text-[10px] font-black text-gray-600 uppercase tracking-[0.2em]">Live Price</th>
                    <th className="py-3 px-4 text-[10px] font-black text-gray-600 uppercase tracking-[0.2em]">24h Velocity</th>
                    <th className="py-3 px-4 text-[10px] font-black text-gray-600 uppercase tracking-[0.2em]">Market Role</th>
                    <th className="py-3 px-4"></th>
                </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.02]">
                <AnimatePresence mode="popLayout">
                    {(processedData as any[]).map((corr) => (
                        <React.Fragment key={`${corr.driver}-${corr.note}`}>
                            <tr className={cn(
                                "transition-colors",
                                corr.hasOpportunity ? "bg-amber-500/[0.05]" : "bg-indigo-500/[0.02]"
                            )}>
                                <td colSpan={5} className="py-2 px-4">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className={cn(
                                                "text-[10px] font-black uppercase tracking-widest",
                                                corr.hasOpportunity ? "text-amber-500" : "text-indigo-500/50"
                                            )}>{corr.note}</span>
                                            <div className={cn(
                                                "flex-1 h-[1px] bg-gradient-to-r to-transparent",
                                                corr.hasOpportunity ? "from-amber-500/20" : "from-indigo-500/10"
                                            )} />
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <span 
                                                className={cn(
                                                    "text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded border",
                                                    corr.correlationQuality === 'STRONG' 
                                                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" 
                                                        : corr.correlationQuality === 'MODERATE'
                                                        ? "bg-blue-500/10 border-blue-500/30 text-blue-400"
                                                        : "bg-gray-500/10 border-gray-500/30 text-gray-400"
                                                )}
                                                title={correlationMatrix ? "Calculated from live price history" : "Estimated from 24h price change"}
                                            >
                                                {corr.correlationQuality === 'STRONG' && '● '}
                                                {corr.correlationQuality === 'MODERATE' && '◐ '}
                                                {corr.correlationQuality === 'WEAK' && '○ '}
                                                r={correlationMatrix ? '' : '~'}{corr.avgCorrelation != null && !isNaN(corr.avgCorrelation) ? corr.avgCorrelation.toFixed(2) : '0.7'}
                                                {correlationMatrix ? ' ✓' : ''}
                                            </span>
                                            {corr.hasOpportunity && (
                                                <span className="text-[8px] font-black text-amber-500 animate-pulse">LAGGING ALERT</span>
                                            )}
                                            <span className="text-[9px] font-bold text-indigo-400/50 uppercase tracking-tighter">Peak: {(corr.maxChange ?? 0).toFixed(2)}%</span>
                                        </div>
                                    </div>
                                </td>
                            </tr>
                            {/* Driver Row */}
                            {(() => {
                                const pair = getSymbolPair(corr.driver);
                                const data = pair ? marketData[pair] : null;
                                return (
                                    <ArchitectTableRow
                                        symbol={corr.driver}
                                        price={data?.lastPrice}
                                        change={data?.priceChangePercent}
                                        isDriver={true}
                                        role="Catalyst Driver"
                                    />
                                );
                            })()}
                            {/* Follower Rows */}
                            {Array.isArray(corr.followers) && corr.followers.filter(f => f && f.symbol).map((f: any, idx: number) => {
                                const pair = getSymbolPair(f.symbol);
                                const data = pair ? marketData[pair] : null;
                                let roleText = f?.isLagging ? "Laggard Follower" : "Follower Pair";
                                if (f?.correlation != null && !isNaN(f.correlation)) {
                                    const corrStr = f.correlation > 0 ? `+${f.correlation.toFixed(2)}` : f.correlation.toFixed(2);
                                    roleText += ` (${corrStr})`;
                                }
                                return (
                                    <ArchitectTableRow
                                        key={f.symbol || idx}
                                        symbol={f.symbol}
                                        price={data?.lastPrice}
                                        change={data?.priceChangePercent}
                                        isLagging={f?.isLagging}
                                        role={roleText}
                                    />
                                );
                            })}
                        </React.Fragment>
                    ))}
                </AnimatePresence>
            </tbody>
        </table>
    );
};

// Debug component to show correlation data collection status
const MatrixDebugInfo: React.FC = () => {
    const { marketData } = useMarketData();
    const priceHist = getPriceHistory();
    
    const symbolsWithData = MAJOR_SYMBOLS.filter(symbol => {
        const history = priceHist.get(symbol);
        return history && history.length >= 5;
    });
    
    const availableInMarket = MAJOR_SYMBOLS.filter(s => marketData[s]);
    
    return (
        <div className="bg-white/5 rounded-xl p-4 text-left max-w-md">
            <div className="text-xs text-gray-400 mb-2">Debug Info:</div>
            <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                    <span className="text-gray-500">Available in MarketData:</span>
                    <span className="text-emerald-400">{availableInMarket.length}/{MAJOR_SYMBOLS.length}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-gray-500">Price History (5+ points):</span>
                    <span className={symbolsWithData.length >= 3 ? "text-emerald-400" : "text-amber-400"}>
                        {symbolsWithData.length}/{MAJOR_SYMBOLS.length}
                    </span>
                </div>
                {symbolsWithData.length > 0 && (
                    <div className="pt-2 border-t border-white/10">
                        <span className="text-gray-500">Ready: </span>
                        <span className="text-gray-300">{symbolsWithData.slice(0, 5).join(', ')}{symbolsWithData.length > 5 ? '...' : ''}</span>
                    </div>
                )}
            </div>
        </div>
    );
};

const SortIcon: React.FC<{ active: boolean, direction: 'asc' | 'desc' }> = ({ active, direction }) => {
    if (!active) return <motion.div className="opacity-0 group-hover:opacity-100 transition-opacity"><TrendingUp size={10} className="text-gray-700" /></motion.div>;
    return (
        <motion.div initial={{ scale: 0.8 }} animate={{ scale: 1 }}>
            {direction === 'asc' ? <TrendingUp size={10} className="text-purple-400" /> : <TrendingDown size={10} className="text-purple-400" />}
        </motion.div>
    );
};

const TabButton: React.FC<{ active: boolean; onClick: () => void; icon: React.ReactNode; label: string }> = ({ active, onClick, icon, label }) => (
    <button
        onClick={onClick}
        className={cn(
            "flex items-center gap-2 px-6 py-2 rounded-xl text-xs font-bold transition-all duration-500",
            active
                ? "bg-gradient-to-r from-purple-500 to-indigo-500 text-white shadow-lg shadow-purple-500/20"
                : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
        )}
    >
        {icon}
        {label}
    </button>
);
