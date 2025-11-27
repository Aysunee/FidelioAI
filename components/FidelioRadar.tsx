

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Ticker, FuturesTicker } from '../types';
import { Radar, AlertCircle, TrendingUp, TrendingDown, Zap, Droplets, Activity, Gauge } from 'lucide-react';

interface FidelioRadarProps {
  spotData: Record<string, Ticker>;
  futuresData: Record<string, FuturesTicker>;
}

type AnomalyType = 'PUMP' | 'DUMP' | 'DIV_BULL' | 'DIV_BEAR' | 'NEG_FUNDING' | 'VOLUME_SPIKE';

interface Anomaly {
  id: string;
  symbol: string;
  type: AnomalyType;
  value: number;
  message: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
}

export const FidelioRadar: React.FC<FidelioRadarProps> = ({ spotData, futuresData }) => {
  // Internal state for volume spikes
  const [spikes, setSpikes] = useState<Record<string, { ratio: number, timestamp: number }>>({});
  const historyRef = useRef<Record<string, { vol: number, time: number }>>({});

  // Market Sentiment Calculation
  const sentiment = useMemo(() => {
    let score = 50; // Neutral 50
    const tickers = (Object.values(spotData) as Ticker[]).filter(t => t.symbol.endsWith('USDT'));
    if (tickers.length === 0) return { score: 50, label: 'NEUTRAL', color: 'text-secondary' };

    const gainers = tickers.filter(t => t.priceChangePercent > 0).length;
    const losers = tickers.length - gainers;
    const ratio = gainers / tickers.length; // 0 to 1

    // Map ratio to 0-100 score
    score = ratio * 100;
    
    let label = 'NEUTRAL';
    let color = 'text-secondary';
    
    if (score >= 75) { label = 'GREED'; color = 'text-success'; }
    else if (score >= 60) { label = 'BULLISH'; color = 'text-success'; }
    else if (score <= 25) { label = 'FEAR'; color = 'text-danger'; }
    else if (score <= 40) { label = 'BEARISH'; color = 'text-danger'; }

    return { score, label, color };
  }, [spotData]);

  // Volume Spike Detection Logic
  useEffect(() => {
    const now = Date.now();
    const newSpikes: Record<string, { ratio: number, timestamp: number }> = {};
    let hasNewSpikes = false;

    Object.values(spotData).forEach((t: Ticker) => {
        if (!t.symbol.endsWith('USDT')) return;

        const prev = historyRef.current[t.symbol];
        if (prev) {
            const timeDelta = now - prev.time;
            if (timeDelta >= 1000) {
                const volDelta = t.volume - prev.vol;
                if (volDelta > 0) {
                    const avgFlowRate = t.volume / (24 * 60 * 60 * 1000);
                    const currentFlowRate = volDelta / timeDelta;
                    if (avgFlowRate > 0) {
                        const ratio = currentFlowRate / avgFlowRate;
                        if (ratio >= 10) {
                            newSpikes[t.symbol] = { ratio, timestamp: now };
                            hasNewSpikes = true;
                        }
                    }
                }
                historyRef.current[t.symbol] = { vol: t.volume, time: now };
            }
        } else {
            historyRef.current[t.symbol] = { vol: t.volume, time: now };
        }
    });

    if (hasNewSpikes || Object.keys(spikes).length > 0) {
        setSpikes(prev => {
            const merged = { ...prev, ...newSpikes };
            const filtered: typeof merged = {};
            const RETENTION_MS = 5 * 60 * 1000; 
            Object.entries(merged).forEach(([key, val]: [string, { ratio: number, timestamp: number }]) => {
                if (now - val.timestamp < RETENTION_MS) filtered[key] = val;
            });
            return filtered;
        });
    }
  }, [spotData]);

  const anomalies = useMemo(() => {
    const list: Anomaly[] = [];

    // Check Spot Data
    (Object.values(spotData) as Ticker[]).forEach(t => {
      if (!t.symbol.endsWith('USDT')) return;
      if (t.priceChangePercent > 5) list.push({ id: `pump-${t.symbol}`, symbol: t.symbol, type: 'PUMP', value: t.priceChangePercent, message: 'Rapid Price Surge', severity: 'MEDIUM' });
      if (t.priceChangePercent < -5) list.push({ id: `dump-${t.symbol}`, symbol: t.symbol, type: 'DUMP', value: t.priceChangePercent, message: 'Sharp Decline', severity: 'MEDIUM' });
    });

    // Check Futures
    (Object.values(futuresData) as FuturesTicker[]).forEach(f => {
       const fundingPct = f.fundingRate * 100;
       if (f.fundingRate < -0.0005) list.push({ id: `neg-fund-${f.symbol}`, symbol: f.symbol, type: 'NEG_FUNDING', value: fundingPct, message: 'Extreme Neg. Funding', severity: 'MEDIUM' });
       
       const spot = spotData[f.symbol];
       if (spot) {
           if (f.fundingRate <= -0.0003 && spot.priceChangePercent > 1.0) {
               list.push({ id: `div-bull-${f.symbol}`, symbol: f.symbol, type: 'DIV_BULL', value: fundingPct, message: 'SHORT SQUEEZE SETUP', severity: 'HIGH' });
           }
           if (f.fundingRate >= 0.0003 && spot.priceChangePercent < -1.0) {
                list.push({ id: `div-bear-${f.symbol}`, symbol: f.symbol, type: 'DIV_BEAR', value: fundingPct, message: 'LONG TRAP SETUP', severity: 'HIGH' });
           }
       }
    });

    Object.entries(spikes).forEach(([symbol, data]: [string, { ratio: number, timestamp: number }]) => {
        list.push({ id: `vol-${symbol}-${data.timestamp}`, symbol, type: 'VOLUME_SPIKE', value: data.ratio, message: 'Volume Explosion', severity: data.ratio > 50 ? 'HIGH' : 'MEDIUM' });
    });

    return list.sort((a, b) => {
        if (a.severity === 'HIGH' && b.severity !== 'HIGH') return -1;
        if (b.severity === 'HIGH' && a.severity !== 'HIGH') return 1;
        return 0;
    }).slice(0, 4); 
  }, [spotData, futuresData, spikes]);

  const getStyle = (type: AnomalyType) => {
      switch(type) {
          case 'DIV_BULL': return { text: 'text-success', border: 'border-success', icon: Zap, bg: 'bg-surface' };
          case 'DIV_BEAR': return { text: 'text-danger', border: 'border-danger', icon: AlertCircle, bg: 'bg-surface' };
          case 'PUMP': return { text: 'text-success', border: 'border-success', icon: TrendingUp, bg: 'bg-surface' };
          case 'DUMP': return { text: 'text-danger', border: 'border-danger', icon: TrendingDown, bg: 'bg-surface' };
          case 'NEG_FUNDING': return { text: 'text-warning', border: 'border-warning', icon: Droplets, bg: 'bg-surface' };
          case 'VOLUME_SPIKE': return { text: 'text-purple-500', border: 'border-purple-500', icon: Activity, bg: 'bg-surface' };
          default: return { text: 'text-primary', border: 'border-primary', icon: Radar, bg: 'bg-surface' };
      }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-full">
        {/* Sentiment Gauge (New) */}
        <div className="lg:w-48 shrink-0 bg-surface border border-border rounded-card p-4 flex flex-col items-center justify-center relative overflow-hidden">
             <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-danger via-warning to-success"></div>
             <div className="text-xs font-bold text-secondary uppercase tracking-wider mb-2">Market Sentiment</div>
             
             {/* Gauge Visual */}
             <div className="relative w-20 h-10 mb-1">
                <div className="absolute bottom-0 w-20 h-20 rounded-full border-4 border-surface-secondary border-t-transparent border-l-transparent -rotate-45"></div>
                <div 
                    className="absolute bottom-0 w-20 h-20 rounded-full border-4 border-current border-t-transparent border-l-transparent transition-all duration-1000 ease-out"
                    style={{ 
                        transform: `rotate(${ -45 + (sentiment.score * 1.8) }deg)`,
                        color: sentiment.score > 50 ? 'var(--color-success)' : 'var(--color-danger)'
                    }}
                ></div>
             </div>
             
             <div className={`text-xl font-display font-bold ${sentiment.color}`}>
                {sentiment.score.toFixed(0)}
             </div>
             <div className={`text-[10px] font-bold tracking-widest ${sentiment.color}`}>
                {sentiment.label}
             </div>
        </div>

        {/* Anomaly Cards Grid */}
        <div className="flex-1 grid grid-cols-2 lg:grid-cols-4 gap-4">
            {anomalies.length === 0 ? (
                <div className="col-span-full bg-surface border border-border rounded-card p-6 flex items-center justify-center gap-4 text-secondary">
                    <div className="p-2 bg-surface-secondary rounded">
                        <Radar size={20} className="opacity-50" />
                    </div>
                    <span className="font-medium text-sm">Scanning for opportunities...</span>
                </div>
            ) : (
                anomalies.map(item => {
                    const style = getStyle(item.type);
                    const Icon = style.icon;
                    const symbolBase = item.symbol.replace('USDT', '');
                    const iconUrl = `https://assets.coincap.io/assets/icons/${symbolBase.toLowerCase()}@2x.png`;

                    return (
                        <div key={item.id} className={`${style.bg} border ${style.border} rounded-card p-4 shadow-sm hover:bg-surface-secondary/20 transition-all cursor-default flex flex-col justify-between relative overflow-hidden group`}>
                             {/* Background Glow */}
                            <div className={`absolute -right-4 -top-4 w-16 h-16 ${style.text} opacity-5 blur-xl rounded-full group-hover:opacity-10 transition-opacity`}></div>

                            <div className="flex justify-between items-start mb-1">
                                <div className="flex items-center gap-2 z-10">
                                    <div className="w-5 h-5 rounded-full bg-surface-secondary shrink-0 overflow-hidden">
                                        <img src={iconUrl} className="w-full h-full object-cover" onError={(e) => e.currentTarget.style.display = 'none'} />
                                    </div>
                                    <span className="text-sm font-bold text-text uppercase">{symbolBase}</span>
                                </div>
                                <Icon size={14} className={style.text} />
                            </div>
                            
                            <div className="z-10">
                                <div className={`text-2xl font-display font-bold ${style.text} tracking-tight leading-none my-1`}>
                                    {item.type === 'VOLUME_SPIKE' ? `${item.value.toFixed(1)}x` : (
                                        <>
                                            {item.value > 0 && item.type !== 'NEG_FUNDING' ? '+' : ''}{item.value.toFixed(2)}%
                                        </>
                                    )}
                                </div>
                                <div className="text-[9px] font-bold text-secondary uppercase tracking-wider">{item.message}</div>
                            </div>
                        </div>
                    );
                })
            )}
        </div>
    </div>
  );
};
