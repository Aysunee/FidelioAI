import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Activity, Zap, TrendingUp, TrendingDown, Link2, Unlink, AlertTriangle } from 'lucide-react';
import { 
    CorrelationMatrix as CorrelationMatrixType, 
    CorrelationPair,
    getCorrelationColor,
    getCorrelationDescription 
} from '../utils/correlationEngine';
import { cn } from '../utils/cn';

interface CorrelationMatrixProps {
    matrix: CorrelationMatrixType;
    maxDisplay?: number;
    className?: string;
}

const CorrelationMatrix: React.FC<CorrelationMatrixProps> = ({ 
    matrix, 
    maxDisplay = 8,
    className 
}) => {
    const [selectedPair, setSelectedPair] = useState<CorrelationPair | null>(null);
    const [hoveredCell, setHoveredCell] = useState<{i: number, j: number} | null>(null);

    // Limit displayed symbols
    const displaySymbols = matrix.symbols.slice(0, maxDisplay);
    const displayMatrix = matrix.matrix.slice(0, maxDisplay).map(row => 
        row.slice(0, maxDisplay)
    );

    // Get top opportunities
    const topOpportunities = useMemo(() => {
        return matrix.pairs
            .filter(p => p.opportunityScore > 20)
            .slice(0, 5);
    }, [matrix.pairs]);

    // Get strongest correlations
    const strongestCorrelations = useMemo(() => {
        return matrix.pairs
            .filter(p => Math.abs(p.correlation) > 0.7)
            .slice(0, 5);
    }, [matrix.pairs]);

    const getCellIntensity = (value: number) => {
        const abs = Math.abs(value);
        return Math.min(abs * 100, 100);
    };

    const getBgColor = (value: number) => {
        if (value === 1) return 'bg-white/10';
        const color = getCorrelationColor(value);
        const opacity = Math.abs(value) * 0.3;
        return value > 0 
            ? `rgba(16, 185, 129, ${opacity})`  // Green for positive
            : `rgba(244, 63, 94, ${opacity}`;    // Red for negative
    };

    return (
        <div className={cn("space-y-6", className)}>
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
                        <Link2 size={20} className="text-indigo-400" />
                    </div>
                    <div>
                        <h3 className="text-lg font-black text-white uppercase tracking-tighter">
                            Live Correlation Matrix
                        </h3>
                        <p className="text-[10px] text-gray-500 font-black uppercase tracking-widest">
                            Real-time statistical correlation analysis
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-gray-500">
                    <span className="w-3 h-3 rounded bg-emerald-500/30"></span> Positive
                    <span className="w-3 h-3 rounded bg-rose-500/30 ml-2"></span> Negative
                    <span className="w-3 h-3 rounded bg-gray-500/30 ml-2"></span> Neutral
                </div>
            </div>

            {/* Matrix Grid */}
            <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-6 overflow-x-auto">
                <div className="min-w-[400px]">
                    {/* Header row with symbols */}
                    <div className="grid" style={{ gridTemplateColumns: `80px repeat(${displaySymbols.length}, 1fr)` }}>
                        <div></div>
                        {displaySymbols.map((sym, i) => (
                            <div key={sym} className="text-center pb-2">
                                <span className="text-[10px] font-black text-gray-500 uppercase tracking-wider">
                                    {sym.replace('USDT', '')}
                                </span>
                            </div>
                        ))}
                    </div>

                    {/* Matrix rows */}
                    {displaySymbols.map((rowSym, i) => (
                        <div 
                            key={rowSym} 
                            className="grid items-center"
                            style={{ gridTemplateColumns: `80px repeat(${displaySymbols.length}, 1fr)` }}
                        >
                            <div className="pr-3">
                                <span className="text-[10px] font-black text-gray-500 uppercase tracking-wider">
                                    {rowSym.replace('USDT', '')}
                                </span>
                            </div>
                            {displaySymbols.map((colSym, j) => {
                                const value = displayMatrix[i]?.[j] ?? 0;
                                const isDiagonal = i === j;
                                const pair = matrix.pairs.find(p => 
                                    (p.symbolA === rowSym && p.symbolB === colSym) ||
                                    (p.symbolA === colSym && p.symbolB === rowSym)
                                );
                                
                                return (
                                    <motion.div
                                        key={`${i}-${j}`}
                                        initial={{ opacity: 0, scale: 0.8 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        transition={{ delay: (i * displaySymbols.length + j) * 0.01 }}
                                        className={cn(
                                            "aspect-square m-0.5 rounded-lg flex items-center justify-center cursor-pointer transition-all duration-200",
                                            isDiagonal && "bg-white/5 cursor-default"
                                        )}
                                        style={{
                                            backgroundColor: isDiagonal ? undefined : getBgColor(value)
                                        }}
                                        onMouseEnter={() => !isDiagonal && setHoveredCell({i, j})}
                                        onMouseLeave={() => setHoveredCell(null)}
                                        onClick={() => pair && setSelectedPair(pair)}
                                    >
                                        {!isDiagonal && (
                                            <span className={cn(
                                                "text-[9px] font-black tabular-nums",
                                                Math.abs(value) > 0.5 ? 'text-white' : 'text-gray-500'
                                            )}>
                                                {value.toFixed(2)}
                                            </span>
                                        )}
                                        
                                        {/* Hover tooltip */}
                                        {hoveredCell?.i === i && hoveredCell?.j === j && pair && (
                                            <div className="fixed z-50 pointer-events-none"
                                                style={{
                                                    transform: 'translate(10px, -50%)'
                                                }}
                                            >
                                                <div className="bg-gray-950/95 border border-white/10 rounded-xl p-3 shadow-2xl backdrop-blur-xl min-w-[180px]">
                                                    <div className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2">
                                                        {pair.symbolA.replace('USDT', '')} ↔ {pair.symbolB.replace('USDT', '')}
                                                    </div>
                                                    <div className="space-y-1.5">
                                                        <div className="flex justify-between items-center">
                                                            <span className="text-[9px] text-gray-600 uppercase">Correlation:</span>
                                                            <span className={cn(
                                                                "text-[11px] font-black",
                                                                pair.correlation > 0 ? 'text-emerald-400' : 'text-rose-400'
                                                            )}>
                                                                {pair.correlation.toFixed(3)}
                                                            </span>
                                                        </div>
                                                        <div className="flex justify-between items-center">
                                                            <span className="text-[9px] text-gray-600 uppercase">Strength:</span>
                                                            <span className="text-[10px] font-black text-white">
                                                                {pair.strength.replace('_', ' ')}
                                                            </span>
                                                        </div>
                                                        <div className="flex justify-between items-center">
                                                            <span className="text-[9px] text-gray-600 uppercase">Trend:</span>
                                                            <span className={cn(
                                                                "text-[10px] font-black",
                                                                pair.trend === 'DIVERGING' ? 'text-amber-400' : 
                                                                pair.trend === 'CONVERGING' ? 'text-emerald-400' : 'text-gray-400'
                                                            )}>
                                                                {pair.trend}
                                                            </span>
                                                        </div>
                                                        {pair.opportunityScore > 0 && (
                                                            <div className="pt-1 mt-1 border-t border-white/10">
                                                                <div className="flex justify-between items-center">
                                                                    <span className="text-[9px] text-amber-500 uppercase">Opportunity:</span>
                                                                    <span className="text-[11px] font-black text-amber-400">
                                                                        {pair.opportunityScore.toFixed(0)}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </motion.div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>

            {/* Opportunities Section */}
            {topOpportunities.length > 0 && (
                <div className="bg-amber-500/[0.03] border border-amber-500/20 rounded-2xl p-5">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
                            <AlertTriangle size={16} className="text-amber-400" />
                        </div>
                        <div>
                            <h4 className="text-sm font-black text-white uppercase tracking-tighter">
                                Correlation Arbitrage Opportunities
                            </h4>
                            <p className="text-[9px] text-amber-500/70 font-black uppercase tracking-widest">
                                Divergence detected in correlated pairs
                            </p>
                        </div>
                    </div>
                    
                    <div className="space-y-2">
                        {topOpportunities.map((opp, idx) => (
                            <motion.div
                                key={`${opp.symbolA}-${opp.symbolB}`}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: idx * 0.05 }}
                                className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] hover:bg-white/[0.04] transition-colors cursor-pointer group"
                                onClick={() => setSelectedPair(opp)}
                            >
                                <div className="flex items-center gap-4">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-black text-white">
                                            {opp.symbolA.replace('USDT', '')}
                                        </span>
                                        <Link2 size={12} className="text-gray-600" />
                                        <span className="text-sm font-black text-white">
                                            {opp.symbolB.replace('USDT', '')}
                                        </span>
                                    </div>
                                    <div className={cn(
                                        "px-2 py-0.5 rounded text-[9px] font-black uppercase",
                                        opp.correlation > 0 ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
                                    )}>
                                        r = {opp.correlation.toFixed(2)}
                                    </div>
                                </div>
                                <div className="flex items-center gap-4">
                                    <div className="text-right">
                                        <div className="text-[10px] text-gray-500 uppercase">Gap</div>
                                        <div className="text-sm font-black text-amber-400">
                                            {Math.abs(opp.priceChangeA - opp.priceChangeB).toFixed(2)}%
                                        </div>
                                    </div>
                                    <div className="text-right min-w-[60px]">
                                        <div className="text-[10px] text-gray-500 uppercase">Score</div>
                                        <div className="text-sm font-black text-white">
                                            {opp.opportunityScore.toFixed(0)}
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                </div>
            )}

            {/* Strong Correlations */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
                    <div className="flex items-center gap-2 mb-4">
                        <TrendingUp size={16} className="text-emerald-400" />
                        <h4 className="text-xs font-black text-white uppercase tracking-widest">
                            Strongest Correlations
                        </h4>
                    </div>
                    <div className="space-y-2">
                        {strongestCorrelations.slice(0, 4).map((corr, idx) => (
                            <div key={idx} className="flex items-center justify-between text-sm">
                                <div className="flex items-center gap-2">
                                    <span className="text-gray-400">{corr.symbolA.replace('USDT', '')}</span>
                                    <span className="text-gray-600">→</span>
                                    <span className="text-gray-400">{corr.symbolB.replace('USDT', '')}</span>
                                </div>
                                <span className={cn(
                                    "font-black tabular-nums",
                                    corr.correlation > 0 ? "text-emerald-400" : "text-rose-400"
                                )}>
                                    {corr.correlation > 0 ? '+' : ''}{corr.correlation.toFixed(2)}
                                </span>
                            </div>
                        ))}
                        {strongestCorrelations.length === 0 && (
                            <div className="text-[11px] text-gray-600 italic">Collecting data...</div>
                        )}
                    </div>
                </div>

                <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
                    <div className="flex items-center gap-2 mb-4">
                        <Activity size={16} className="text-purple-400" />
                        <h4 className="text-xs font-black text-white uppercase tracking-widest">
                            Correlation Stats
                        </h4>
                    </div>
                    <div className="space-y-3">
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-gray-400">Total Pairs</span>
                            <span className="text-sm font-black text-white">{matrix.pairs.length}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-gray-400">Strong Correlations</span>
                            <span className="text-sm font-black text-emerald-400">
                                {matrix.pairs.filter(p => Math.abs(p.correlation) > 0.7).length}
                            </span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-gray-400">Opportunities</span>
                            <span className="text-sm font-black text-amber-400">
                                {matrix.pairs.filter(p => p.opportunityScore > 20).length}
                            </span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-gray-400">Diverging</span>
                            <span className="text-sm font-black text-rose-400">
                                {matrix.pairs.filter(p => p.trend === 'DIVERGING').length}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Selected Pair Detail Modal */}
            {selectedPair && (
                <div 
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                    onClick={() => setSelectedPair(null)}
                >
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-gray-950 border border-white/10 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-xl bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
                                    <Link2 size={24} className="text-indigo-400" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-black text-white">
                                        {selectedPair.symbolA.replace('USDT', '')} 
                                        <span className="text-gray-600 mx-2">↔</span>
                                        {selectedPair.symbolB.replace('USDT', '')}
                                    </h3>
                                    <p className="text-[10px] text-gray-500 uppercase tracking-widest">
                                        {getCorrelationDescription(selectedPair.correlation)}
                                    </p>
                                </div>
                            </div>
                            <button 
                                onClick={() => setSelectedPair(null)}
                                className="text-gray-500 hover:text-white transition-colors"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div className="flex items-center justify-between p-4 rounded-xl bg-white/[0.02]">
                                <span className="text-sm text-gray-400">Correlation Coefficient</span>
                                <span className={cn(
                                    "text-2xl font-black tabular-nums",
                                    selectedPair.correlation > 0 ? 'text-emerald-400' : 'text-rose-400'
                                )}>
                                    {selectedPair.correlation.toFixed(3)}
                                </span>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="p-3 rounded-xl bg-white/[0.02]">
                                    <div className="text-[10px] text-gray-500 uppercase mb-1">
                                        {selectedPair.symbolA.replace('USDT', '')} Change
                                    </div>
                                    <div className={cn(
                                        "text-lg font-black",
                                        selectedPair.priceChangeA >= 0 ? 'text-emerald-400' : 'text-rose-400'
                                    )}>
                                        {selectedPair.priceChangeA >= 0 ? '+' : ''}
                                        {selectedPair.priceChangeA.toFixed(2)}%
                                    </div>
                                </div>
                                <div className="p-3 rounded-xl bg-white/[0.02]">
                                    <div className="text-[10px] text-gray-500 uppercase mb-1">
                                        {selectedPair.symbolB.replace('USDT', '')} Change
                                    </div>
                                    <div className={cn(
                                        "text-lg font-black",
                                        selectedPair.priceChangeB >= 0 ? 'text-emerald-400' : 'text-rose-400'
                                    )}>
                                        {selectedPair.priceChangeB >= 0 ? '+' : ''}
                                        {selectedPair.priceChangeB.toFixed(2)}%
                                    </div>
                                </div>
                            </div>

                            {selectedPair.opportunityScore > 0 && (
                                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Zap size={16} className="text-amber-400" />
                                        <span className="text-sm font-black text-amber-400 uppercase">
                                            Arbitrage Opportunity Detected
                                        </span>
                                    </div>
                                    <div className="text-[11px] text-gray-400">
                                        Price divergence of {' '}
                                        <span className="text-amber-400 font-black">
                                            {Math.abs(selectedPair.priceChangeA - selectedPair.priceChangeB).toFixed(2)}%
                                        </span>
                                        {' '}despite {' '}
                                        <span className="text-emerald-400 font-black">
                                            {(selectedPair.correlation * 100).toFixed(0)}%
                                        </span>
                                        {' '}historical correlation
                                    </div>
                                </div>
                            )}

                            <div className="pt-4 border-t border-white/5">
                                <div className="text-[10px] text-gray-600 uppercase tracking-widest mb-2">
                                    Trend Analysis
                                </div>
                                <div className="flex items-center gap-2">
                                    {selectedPair.trend === 'DIVERGING' ? (
                                        <>
                                            <Unlink size={16} className="text-rose-400" />
                                            <span className="text-sm text-rose-400">Correlation weakening - assets decoupling</span>
                                        </>
                                    ) : selectedPair.trend === 'CONVERGING' ? (
                                        <>
                                            <Link2 size={16} className="text-emerald-400" />
                                            <span className="text-sm text-emerald-400">Correlation strengthening</span>
                                        </>
                                    ) : (
                                        <>
                                            <Activity size={16} className="text-gray-400" />
                                            <span className="text-sm text-gray-400">Stable correlation pattern</span>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
        </div>
    );
};

export default CorrelationMatrix;
