
import React, { useState, useEffect } from 'react';
import { X, Calculator, DollarSign, Percent, Target, AlertTriangle, Info, Check } from 'lucide-react';
import { motion } from 'framer-motion';

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
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
            <motion.div
                initial={{ scale: 0.95, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.95, y: 20 }}
                className="bg-[#0b0e14] border border-white/10 rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
                {/* Header */}
                <div className="px-6 py-5 border-b border-white/5 flex justify-between items-center bg-[#11141f]/50">
                    <div className="flex items-center gap-3">
                        <div className="bg-cyan-500/10 text-cyan-400 p-2 rounded-lg border border-cyan-500/20">
                            <Calculator size={20} />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white">Position Size Calculator</h2>
                            <p className="text-xs text-slate-500 font-medium">Manage your risk per trade effectively</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 flex flex-col md:flex-row">
                    {/* Input Section */}
                    <div className="p-6 md:w-1/2 space-y-5 border-b md:border-b-0 md:border-r border-white/5">
                        {/* Account Details */}
                        <div className="space-y-3">
                            <div className="flex justify-between items-center">
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Account Balance</label>
                                <span className="text-xs text-slate-400 font-mono">${accountBalance.toLocaleString()}</span>
                            </div>
                            <div className="relative">
                                <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                                <input
                                    type="number"
                                    value={accountBalance}
                                    onChange={(e) => setAccountBalance(Number(e.target.value))}
                                    className="w-full bg-[#11141f] border border-gray-800 rounded-xl py-2 pl-9 pr-3 text-sm text-white focus:outline-none focus:border-cyan-500 transition-colors"
                                />
                            </div>

                            <div className="flex justify-between items-center mt-2">
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Risk Tolerance</label>
                                <span className="text-xs font-bold text-rose-400">{riskPercentage}%</span>
                            </div>
                            <div className="relative">
                                <input
                                    type="range"
                                    min="0.1"
                                    max="5"
                                    step="0.1"
                                    value={riskPercentage}
                                    onChange={(e) => setRiskPercentage(Number(e.target.value))}
                                    className="w-full accent-cyan-500 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                                />
                                <div className="flex justify-between text-[9px] text-slate-600 mt-1 font-bold">
                                    <span>0.1%</span>
                                    <span>1%</span>
                                    <span>2%</span>
                                    <span>5%</span>
                                </div>
                            </div>
                        </div>

                        <div className="h-px bg-white/5 my-2"></div>

                        {/* Trade Setup */}
                        <div className="space-y-3">
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Entry Price ($)</label>
                                <input
                                    type="number"
                                    className="w-full bg-[#11141f] border border-gray-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
                                    placeholder="0.00"
                                    value={entryPrice}
                                    onChange={(e) => setEntryPrice(Number(e.target.value))}
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest text-rose-400/80">Stop Loss ($)</label>
                                <input
                                    type="number"
                                    className="w-full bg-[#11141f] border border-gray-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-rose-500/50"
                                    placeholder="0.00"
                                    value={stopLoss}
                                    onChange={(e) => setStopLoss(Number(e.target.value))}
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest text-emerald-400/80">Take Profit ($)</label>
                                <input
                                    type="number"
                                    className="w-full bg-[#11141f] border border-gray-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                                    placeholder="Optional"
                                    value={targetPrice}
                                    onChange={(e) => setTargetPrice(Number(e.target.value))}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Results Section */}
                    <div className="p-6 md:w-1/2 bg-[#161b22]/30 flex flex-col justify-center gap-6">
                        {!results.isValid ? (
                            <div className="text-center text-slate-600">
                                <Calculator size={48} className="mx-auto mb-4 opacity-20" />
                                <p className="text-sm">Enter trade details to see<br />risk & position sizing.</p>
                            </div>
                        ) : (
                            <>
                                <div className="bg-[#11141f] border border-white/5 rounded-2xl p-5 relative overflow-hidden group">
                                    <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                                        <Target size={64} className="text-cyan-500" />
                                    </div>
                                    <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest block mb-1">Recommended Position Size</span>
                                    <div className="text-3xl font-black text-white tracking-tight">
                                        {Math.floor(results.positionSize).toLocaleString()} <span className="text-sm text-slate-500 font-medium">Units</span>
                                    </div>
                                    <div className="text-sm text-slate-400 mt-2 font-medium">
                                        Total Value: <span className="text-slate-200">${results.positionValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="bg-rose-500/10 border border-rose-500/20 rounded-2xl p-4">
                                        <span className="text-[10px] font-bold text-rose-500 uppercase tracking-widest block mb-1">Max Risk</span>
                                        <div className="text-xl font-bold text-rose-400">
                                            ${results.riskAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                        </div>
                                    </div>
                                    {results.rewardAmount > 0 && (
                                        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4">
                                            <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest block mb-1">Est. Reward</span>
                                            <div className="text-xl font-bold text-emerald-400">
                                                ${results.rewardAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {results.riskRewardRatio > 0 && (
                                    <div className="bg-[#11141f] border border-white/5 rounded-2xl p-4 flex items-center justify-between">
                                        <div className="flex flex-col">
                                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Ratio (R:R)</span>
                                            <span className={`text-2xl font-bold ${results.riskRewardRatio >= 2 ? 'text-emerald-400' : results.riskRewardRatio >= 1 ? 'text-amber-400' : 'text-rose-400'}`}>
                                                1:{results.riskRewardRatio.toFixed(2)}
                                            </span>
                                        </div>
                                        {results.riskRewardRatio < 1.5 && (
                                            <div className="flex items-center gap-2 text-[10px] text-amber-500 font-bold bg-amber-500/10 px-2 py-1 rounded-lg border border-amber-500/20">
                                                <AlertTriangle size={12} />
                                                Unfavorable Ratio
                                            </div>
                                        )}
                                        {results.riskRewardRatio >= 2 && (
                                            <div className="flex items-center gap-2 text-[10px] text-emerald-500 font-bold bg-emerald-500/10 px-2 py-1 rounded-lg border border-emerald-500/20">
                                                <Check size={12} />
                                                Excellent Setup
                                            </div>
                                        )}
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
