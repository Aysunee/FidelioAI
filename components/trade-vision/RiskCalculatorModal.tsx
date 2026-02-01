
import React, { useState, useEffect } from 'react';
import { X, Calculator, DollarSign, Percent, Target, AlertTriangle, Info, Check, ShieldCheck, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/utils/cn';

interface RiskCalculatorModalProps {
    onClose: () => void;
}

const RiskCalculatorModal: React.FC<RiskCalculatorModalProps> = ({ onClose }) => {
    const [accountBalance, setAccountBalance] = useState(10000);
    const [riskPercentage, setRiskPercentage] = useState(1.0);
    const [entryPrice, setEntryPrice] = useState<number | ''>('');
    const [stopLoss, setStopLoss] = useState<number | ''>('');
    const [targetPrice, setTargetPrice] = useState<number | ''>('');

    const [results, setResults] = useState({
        positionSize: 0,
        riskAmount: 0,
        positionValue: 0,
        rewardAmount: 0,
        riskRewardRatio: 0,
        isValid: false
    });

    useEffect(() => {
        if (entryPrice && stopLoss && accountBalance) {
            const riskAmount = (accountBalance * riskPercentage) / 100;
            const riskPerShare = Math.abs(Number(entryPrice) - Number(stopLoss));

            if (riskPerShare === 0) return;

            const positionSize = riskAmount / riskPerShare;
            const positionValue = positionSize * Number(entryPrice);

            let rewardAmount = 0;
            let riskRewardRatio = 0;

            if (targetPrice) {
                const rewardPerShare = Math.abs(Number(targetPrice) - Number(entryPrice));
                rewardAmount = positionSize * rewardPerShare;
                riskRewardRatio = rewardPerShare / riskPerShare;
            }

            setResults({
                positionSize,
                riskAmount,
                positionValue,
                rewardAmount,
                riskRewardRatio,
                isValid: true
            });
        } else {
            setResults(prev => ({ ...prev, isValid: false }));
        }
    }, [accountBalance, riskPercentage, entryPrice, stopLoss, targetPrice]);

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-md animate-in fade-in duration-300">
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 30 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="bg-gray-950/80 border border-white/10 rounded-[32px] w-full max-w-2xl shadow-2xl overflow-hidden backdrop-blur-3xl flex flex-col max-h-[90vh]"
            >
                {/* Header */}
                <div className="px-8 py-6 border-b border-white/5 flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center border border-purple-500/20 shadow-lg shadow-purple-500/5">
                            <Calculator size={20} className="text-purple-400" />
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-white uppercase tracking-tighter">Exposure Matrix</h2>
                            <p className="text-[10px] text-gray-500 font-black uppercase tracking-widest mt-1">Calculated risk mitigation engine</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full text-gray-500 hover:text-white transition-all">
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 flex flex-col md:flex-row min-h-0">
                    {/* Input Section */}
                    <div className="p-8 md:w-1/2 space-y-8 border-b md:border-b-0 md:border-r border-white/5 overflow-y-auto scrollbar-hide">
                        {/* Account Details */}
                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <label className="text-[9px] font-black text-gray-600 uppercase tracking-[0.2em] ml-1">Fluid Capital</label>
                                <span className="text-[10px] text-purple-400 font-black tabular-nums">${accountBalance.toLocaleString()}</span>
                            </div>
                            <div className="relative group">
                                <DollarSign size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-700 group-focus-within:text-purple-500 transition-colors" />
                                <input
                                    type="number"
                                    value={accountBalance}
                                    onChange={(e) => setAccountBalance(Number(e.target.value))}
                                    className="w-full bg-white/[0.02] border border-white/5 rounded-2xl py-3 pl-11 pr-4 text-sm text-white focus:outline-none focus:border-purple-500/40 transition-all tabular-nums"
                                />
                            </div>

                            <div className="flex justify-between items-center mt-6">
                                <label className="text-[9px] font-black text-gray-600 uppercase tracking-[0.2em] ml-1">Risk Threshold</label>
                                <span className="text-[10px] font-black text-rose-500 uppercase tracking-widest">{riskPercentage}% TOLERANCE</span>
                            </div>
                            <div className="relative px-1 pt-2">
                                <input
                                    type="range"
                                    min="0.1"
                                    max="5"
                                    step="0.1"
                                    value={riskPercentage}
                                    onChange={(e) => setRiskPercentage(Number(e.target.value))}
                                    className="w-full accent-purple-500 h-1.5 bg-white/5 rounded-lg appearance-none cursor-pointer"
                                />
                                <div className="flex justify-between text-[8px] text-gray-700 mt-2 font-black uppercase tracking-widest">
                                    <span>0.1%</span>
                                    <span>CONSERVATIVE</span>
                                    <span>5.0%</span>
                                </div>
                            </div>
                        </div>

                        <div className="h-px bg-white/5 mx-2"></div>

                        {/* Trade Setup */}
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-[9px] font-black text-gray-600 uppercase tracking-[0.2em] ml-1">Entry Vector ($)</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    className="w-full bg-white/[0.02] border border-white/5 rounded-2xl px-5 py-3 text-sm text-white focus:outline-none focus:border-purple-500/40 transition-all placeholder:text-gray-800 tabular-nums"
                                    placeholder="0.00"
                                    value={entryPrice}
                                    onChange={(e) => setEntryPrice(Number(e.target.value))}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[9px] font-black text-rose-500/60 uppercase tracking-[0.2em] ml-1">Stop Limitation ($)</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    className="w-full bg-white/[0.02] border border-white/5 rounded-2xl px-5 py-3 text-sm text-white focus:outline-none focus:border-rose-500/40 transition-all placeholder:text-gray-800 tabular-nums"
                                    placeholder="0.00"
                                    value={stopLoss}
                                    onChange={(e) => setStopLoss(Number(e.target.value))}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[9px] font-black text-emerald-500/60 uppercase tracking-[0.2em] ml-1">Yield Target ($)</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    className="w-full bg-white/[0.02] border border-white/5 rounded-2xl px-5 py-3 text-sm text-white focus:outline-none focus:border-emerald-500/40 transition-all placeholder:text-gray-800 tabular-nums"
                                    placeholder="OPTIONAL"
                                    value={targetPrice}
                                    onChange={(e) => setTargetPrice(Number(e.target.value))}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Results Section */}
                    <div className="p-8 md:w-1/2 bg-white/[0.01] flex flex-col justify-center gap-8 overflow-y-auto scrollbar-hide">
                        {!results.isValid ? (
                            <div className="flex flex-col items-center justify-center opacity-20 py-20">
                                <Zap size={64} strokeWidth={1} className="mb-4" />
                                <p className="text-[9px] font-black uppercase tracking-[0.3em] text-center">Awaiting telemetry inputs<br />to generate matrix</p>
                            </div>
                        ) : (
                            <>
                                <div className="bg-gradient-to-br from-purple-500/10 to-indigo-500/10 border border-purple-500/20 rounded-[28px] p-8 relative overflow-hidden group shadow-2xl shadow-purple-500/5">
                                    <div className="absolute -top-4 -right-4 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                                        <Target size={120} className="text-purple-500" />
                                    </div>
                                    <span className="text-[10px] font-black text-purple-400 uppercase tracking-[0.2em] block mb-2">Optimal Exposure Unit</span>
                                    <div className="text-4xl font-black text-white tracking-tighter tabular-nums">
                                        {Math.floor(results.positionSize).toLocaleString()} <span className="text-xs text-gray-600 font-black uppercase tracking-widest ml-1">Shares</span>
                                    </div>
                                    <div className="mt-4 flex items-center gap-2">
                                        <div className="h-1 flex-1 bg-white/5 rounded-full overflow-hidden">
                                            <div className="h-full bg-purple-500 animate-[shimmer_2s_infinite]" style={{ width: '60%' }}></div>
                                        </div>
                                        <span className="text-[9px] text-gray-500 font-black uppercase tracking-widest">Value: ${results.positionValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-6">
                                    <div className="bg-rose-500/[0.03] border border-rose-500/10 rounded-2xl p-6 group/stat hover:bg-rose-500/[0.05] transition-all">
                                        <span className="text-[9px] font-black text-rose-500/60 uppercase tracking-[0.2em] block mb-2 group-hover/stat:text-rose-500 transition-colors">Max Drawdown</span>
                                        <div className="text-2xl font-black text-rose-400 tabular-nums">
                                            ${results.riskAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                        </div>
                                    </div>
                                    {results.rewardAmount > 0 ? (
                                        <div className="bg-emerald-500/[0.03] border border-emerald-500/10 rounded-2xl p-6 group/stat hover:bg-emerald-500/[0.05] transition-all">
                                            <span className="text-[9px] font-black text-emerald-500/60 uppercase tracking-[0.2em] block mb-2 group-hover/stat:text-emerald-500 transition-colors">Yield Horizon</span>
                                            <div className="text-2xl font-black text-emerald-400 tabular-nums">
                                                ${results.rewardAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-6 flex items-center justify-center opacity-30 italic">
                                            <span className="text-[9px] font-black uppercase tracking-widest">No target set</span>
                                        </div>
                                    )}
                                </div>

                                {results.riskRewardRatio > 0 && (
                                    <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-6 flex items-center justify-between">
                                        <div className="flex flex-col">
                                            <span className="text-[9px] font-black text-gray-600 uppercase tracking-widest mb-1">Vector Efficiency (R:R)</span>
                                            <span className={cn(
                                                "text-3xl font-black tabular-nums tracking-tighter",
                                                results.riskRewardRatio >= 2 ? 'text-emerald-400' : results.riskRewardRatio >= 1 ? 'text-amber-400' : 'text-rose-400'
                                            )}>
                                                1:{results.riskRewardRatio.toFixed(2)}
                                            </span>
                                        </div>
                                        {results.riskRewardRatio >= 2 ? (
                                            <div className="flex items-center gap-2 text-[9px] text-emerald-500 font-black uppercase tracking-widest bg-emerald-500/10 px-3 py-1.5 rounded-xl border border-emerald-500/20 shadow-lg shadow-emerald-500/5">
                                                <ShieldCheck size={14} />
                                                High Probability
                                            </div>
                                        ) : results.riskRewardRatio < 1.5 ? (
                                            <div className="flex items-center gap-2 text-[9px] text-rose-500 font-black uppercase tracking-widest bg-rose-500/10 px-3 py-1.5 rounded-xl border border-rose-500/20">
                                                <AlertTriangle size={14} />
                                                Sub-optimal
                                            </div>
                                        ) : null}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </motion.div>
        </div>
    );
};

export default RiskCalculatorModal;
