import React, { useState, useEffect, useMemo } from 'react';
import { useUser } from '../context/UserContext';
import { FuturesTicker, Ticker } from '../types';
import { fetchOpenInterest, startOpenInterestPoller, OpenInterestData } from '../services/marketData';
import { anomalyDetector, Anomaly, FundingAnalyzer } from '../utils/AnomalyLogic';
import { Radar, Zap, Link2Off, TrendingUp, AlertTriangle, Activity } from 'lucide-react';

interface AnomalyRadarProps {
    data: Record<string, FuturesTicker>;
    spotData: Record<string, Ticker>;
    fundingHistory: Record<string, { time: number, rate: number }[]>;
}

export const AnomalyRadar: React.FC<AnomalyRadarProps> = ({ data, spotData, fundingHistory }) => {
    const { theme } = useUser();
    const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
    const [oiData, setOiData] = useState<Record<string, number>>({});
    const [lastScanTime, setLastScanTime] = useState<number>(Date.now());

    // Effect: Initialize Poller for top volume assets
    useEffect(() => {
        // Get top 20 symbols by volume to poll for OI
        const topSymbols = (Object.values(spotData) as Ticker[])
            .sort((a, b) => b.volume - a.volume)
            .slice(0, 30)
            .map(t => t.symbol);

        if (topSymbols.length === 0) return;

        const stopPoller = startOpenInterestPoller(topSymbols, (updates) => {
            setOiData(prev => {
                const next = { ...prev };
                updates.forEach(u => next[u.symbol] = u.openInterest);
                return next;
            });
            setLastScanTime(Date.now());
        });

        return () => stopPoller();
    }, []); // Run once on mount (or when spotData loads initially? No, we need stable list. Better to run once)

    // Effect: Run Anomaly Detection Loop
    useEffect(() => {
        if (Object.keys(data).length === 0 || Object.keys(spotData).length === 0) return;

        const btcSymbol = 'BTCUSDT';
        const btcTicker = spotData[btcSymbol];
        if (!btcTicker) return;

        const detected: Anomaly[] = [];

        (Object.values(spotData) as Ticker[]).forEach(spot => {
            const futures = data[spot.symbol];
            if (!futures) return; // Need both for some checks

            // 1. Check Decoupling
            const decoupling = anomalyDetector.detectDecoupling(spot, btcTicker);
            if (decoupling) detected.push(decoupling);

            // 2. Check Funding Arbitrage
            const arbitrage = anomalyDetector.detectFundingArbitrage(futures, spot);
            if (arbitrage) detected.push(arbitrage);

            // 3. Check PUMP Detection (Volume + Price)
            // Use priceChangePercent which is already calculated by Binance for 24h
            const pump = anomalyDetector.detectPump(spot);
            if (pump) detected.push(pump);

            // 4. Check Funding Trends (from History)
            const history = fundingHistory[spot.symbol];
            if (history && history.length > 5) {
                const trend = FundingAnalyzer.analyze(spot.symbol, history);
                if (trend.direction !== 'STABLE') {
                    detected.push({
                        id: `fund-trend-${spot.symbol}-${Date.now()}`,
                        symbol: spot.symbol,
                        type: 'FUNDING_ARBITRAGE', // Reusing type or could add new
                        severity: trend.intensity > 70 ? 'HIGH' : 'MEDIUM',
                        score: trend.intensity,
                        description: `${trend.direction}: Funding moving at ${trend.velocity.toFixed(5)}/hr`,
                        timestamp: Date.now(),
                        metrics: { fundingRate: trend.currentRate }
                    });
                }
            }
        });

        // Dedup and set (Keep existing ones if they haven't expired, or just replace? Let's replace for freshness)
        setAnomalies(detected);

    }, [data, spotData, oiData]); // Re-run when data updates

    // Group anomalies by type for UI
    const groupedAnomalies = useMemo(() => {
        return {
            decoupling: anomalies.filter(a => a.type === 'DECOUPLING'),
            squeeze: anomalies.filter(a => a.type === 'FUNDING_ARBITRAGE'),
            pump: anomalies.filter(a => a.type === 'PUMP_DETECTED'),
        };
    }, [anomalies]);

    // --- Helper UI Components ---

    const AnomalyCard = ({ title, icon: Icon, items, colorClass }: { title: string, icon: any, items: Anomaly[], colorClass: string }) => (
        <div className={`p-4 rounded-xl border flex flex-col h-full transition-all duration-300 ${theme === 'corporate' ? 'bg-white border-gray-200 shadow-sm'
            : theme === 'labs' ? 'bg-white border-[#DADCE0] shadow-sm rounded-[32px]'
                : 'bg-[#161A1E] border-white/5'
            }`}>
            <div className={`flex items-center gap-2 mb-4 pb-2 ${theme === 'labs' ? 'border-b-0' : 'border-b border-white/5'}`}>
                <div className={`p-2 rounded-lg bg-opacity-10 ${theme === 'labs' ? 'rounded-xl' : ''} ${colorClass.replace('text-', 'bg-')}`}>
                    <Icon size={18} className={colorClass} />
                </div>
                <h3 className={`font-bold ${theme === 'corporate' || theme === 'labs' ? 'text-gray-800' : 'text-gray-200'}`}>{title}</h3>
                <span className={`ml-auto text-xs font-mono px-2 py-0.5 rounded-full ${theme === 'corporate' || theme === 'labs' ? 'bg-gray-100 text-gray-600' : 'bg-white/10'}`}>{items.length}</span>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 max-h-[600px] scrollbar-hide">
                {items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-500 text-xs py-8 opacity-50">
                        <Activity size={24} className="mb-2" />
                        Scanning...
                    </div>
                ) : (
                    items.map(item => (
                        <div key={item.id} className={`p-2 rounded border text-[10px] relative overflow-hidden group hover:scale-[1.02] transition-transform cursor-pointer ${theme === 'corporate' ? 'bg-gray-50 border-gray-100'
                            : theme === 'labs' ? 'bg-gray-50 border-transparent hover:bg-blue-50/50 hover:border-blue-100 rounded-[16px]'
                                : 'bg-black/20 border-white/5'
                            }`}>
                            <div className={`absolute left-0 top-0 bottom-0 w-1 ${item.severity === 'HIGH' ? 'bg-red-500' : 'bg-yellow-500'} ${theme === 'labs' ? 'rounded-l-lg' : ''}`} />

                            <div className="flex items-center justify-between mb-1 pl-2">
                                <span className={`font-bold text-xs ${theme === 'labs' ? 'text-gray-900' : ''}`}>{item.symbol.replace('USDT', '')}</span>
                                <span className={`text-[9px] px-1 py-0.5 rounded ${theme === 'corporate' || theme === 'labs' ? 'bg-gray-200 text-gray-600' : 'bg-white/10'}`}>
                                    {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </div>
                            <p className={`pl-2 opacity-70 mb-1.5 leading-relaxed text-[10px] ${theme === 'labs' ? 'text-gray-600' : ''}`}>{item.description}</p>

                            <div className="pl-2 flex gap-1.5">
                                {item.metrics.priceChange && (
                                    <span className={`px-1 py-0.5 rounded text-[9px] font-mono ${item.metrics.priceChange > 0 ? (theme === 'labs' ? 'text-green-600 bg-green-100' : 'text-green-400 bg-green-400/10') : (theme === 'labs' ? 'text-red-600 bg-red-100' : 'text-red-400 bg-red-400/10')}`}>
                                        Price: {item.metrics.priceChange > 0 ? '+' : ''}{item.metrics.priceChange.toFixed(2)}%
                                    </span>
                                )}
                                {item.metrics.oiChange && (
                                    <span className={`px-1 py-0.5 rounded text-[9px] font-mono ${theme === 'labs' ? 'text-amber-600 bg-amber-100' : 'text-amber-400 bg-amber-400/10'}`}>
                                        OI: +{item.metrics.oiChange.toFixed(2)}%
                                    </span>
                                )}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );

    return (
        <div className={`grid grid-cols-1 md:grid-cols-3 gap-4 h-full p-4 overflow-y-auto ${theme === 'corporate' ? 'bg-[#FAFBFC]' : theme === 'labs' ? 'bg-[#F0F2F5]' : 'bg-[#0b0e11]'}`}>

            {/* 1. Correlation Decoupling */}
            <AnomalyCard
                title="Decoupling (Asiler)"
                icon={Link2Off}
                items={groupedAnomalies.decoupling}
                colorClass="text-purple-400"
            />

            {/* 2. Funding Squeeze */}
            <AnomalyCard
                title="Short Squeeze Alert"
                icon={Zap}
                items={groupedAnomalies.squeeze}
                colorClass="text-emerald-400"
            />

            {/* 3. PUMP Detection */}
            <AnomalyCard
                title="PUMP Detection"
                icon={TrendingUp}
                items={groupedAnomalies.pump}
                colorClass="text-emerald-400"
            />

            {/* Footer / Status Area */}
            <div className="md:col-span-3 flex items-center justify-between p-2 opacity-50 text-[10px]">
                <span>Fidelio Anomaly Engine v1.0 running</span>
                <span>Last Scan: {new Date(lastScanTime).toLocaleTimeString()}</span>
            </div>
        </div>
    );
};
