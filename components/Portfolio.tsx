import React, { useMemo, useState } from 'react';
import { Ticker } from '../types';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Wallet, History, Plus, X, Trash2, TrendingUp, DollarSign } from 'lucide-react';
import { usePortfolio } from '../context/PortfolioContext';
import { useUser } from '../context/UserContext';
import { motion, AnimatePresence } from 'framer-motion';

interface PortfolioProps {
    data: Record<string, Ticker>;
}

const COLORS = ['#A855F7', '#10B981', '#F59E0B', '#3B82F6', '#EC4899'];

export const Portfolio: React.FC<PortfolioProps> = ({ data }) => {
    const { theme } = useUser();
    const { trades, holdings, addTrade, deleteTrade, clearPortfolio, getTotalPnL } = usePortfolio();
    const [activeTab, setActiveTab] = useState<'assets' | 'history'>('assets');
    const [isAdding, setIsAdding] = useState(false);
    const [newSymbol, setNewSymbol] = useState('');
    const [newSide, setNewSide] = useState<'BUY' | 'SELL'>('BUY');
    const [newPrice, setNewPrice] = useState('');
    const [newQty, setNewQty] = useState('');

    const isLight = theme === 'corporate' || theme === 'labs';

    const handleAddTrade = () => {
        if (!newSymbol || !newPrice || !newQty) return;
        addTrade({
            symbol: newSymbol.toUpperCase(),
            side: newSide,
            price: parseFloat(newPrice),
            amount: parseFloat(newQty),
            date: Date.now()
        });
        setIsAdding(false);
        setNewSymbol('');
        setNewPrice('');
        setNewQty('');
    };

    const metrics = useMemo(() => {
        let totalValue = 0;
        let totalCost = 0;

        const items = holdings.map(h => {
            const currentPrice = data[h.symbol]?.lastPrice || h.avgPrice;
            const value = h.amount * currentPrice;
            const cost = h.amount * h.avgPrice;
            totalValue += value;
            totalCost += cost;
            return {
                ...h,
                currentPrice,
                value,
                pnl: value - cost,
                pnlPercent: cost === 0 ? 0 : ((value - cost) / cost) * 100
            };
        });

        const realizedPnL = getTotalPnL();
        const unrealizedPnL = totalValue - totalCost;

        return {
            totalValue,
            totalCost,
            totalPnL: realizedPnL + unrealizedPnL,
            unrealizedPnL,
            realizedPnL,
            pnlPercent: totalCost === 0 ? 0 : (unrealizedPnL / totalCost) * 100,
            items: items.sort((a, b) => b.value - a.value)
        };
    }, [holdings, data, getTotalPnL]);

    const chartData = metrics.items.map(i => ({
        name: i.symbol.replace('USDT', ''),
        value: i.value
    }));

    const isProfitable = metrics.totalPnL >= 0;

    return (
        <div className={`h-full flex flex-col rounded-3xl overflow-hidden ${isLight
                ? 'bg-white border border-gray-200 shadow-sm'
                : 'bg-white/[0.02] border border-white/10 backdrop-blur-xl'
            }`}>
            {/* Header Tabs */}
            <div className={`flex border-b ${isLight ? 'border-gray-200' : 'border-white/10'}`}>
                <button
                    onClick={() => setActiveTab('assets')}
                    className={`flex-1 py-4 text-sm font-bold transition-all flex items-center justify-center gap-2 border-b-2 ${activeTab === 'assets'
                            ? isLight
                                ? 'border-violet-600 text-violet-700 bg-violet-50'
                                : 'border-purple-500 text-purple-300 bg-purple-500/5'
                            : isLight
                                ? 'border-transparent text-gray-600 hover:bg-gray-50'
                                : 'border-transparent text-gray-500 hover:bg-white/5'
                        }`}
                >
                    <Wallet size={16} />
                    Assets
                </button>
                <button
                    onClick={() => setActiveTab('history')}
                    className={`flex-1 py-4 text-sm font-bold transition-all flex items-center justify-center gap-2 border-b-2 ${activeTab === 'history'
                            ? isLight
                                ? 'border-violet-600 text-violet-700 bg-violet-50'
                                : 'border-purple-500 text-purple-300 bg-purple-500/5'
                            : isLight
                                ? 'border-transparent text-gray-600 hover:bg-gray-50'
                                : 'border-transparent text-gray-500 hover:bg-white/5'
                        }`}
                >
                    <History size={16} />
                    History
                </button>
            </div>

            <AnimatePresence mode="wait">
                {activeTab === 'assets' ? (
                    <motion.div
                        key="assets"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex flex-col h-full overflow-hidden"
                    >
                        {/* Balance Header */}
                        <div className={`px-6 py-6 border-b ${isLight ? 'border-gray-200 bg-gray-50/50' : 'border-white/10 bg-white/[0.02]'}`}>
                            <div className="flex items-center gap-3 mb-4">
                                <div className={`p-2 rounded-xl ${isLight ? 'bg-emerald-100' : 'bg-gradient-to-br from-emerald-500/20 to-teal-500/20'}`}>
                                    <DollarSign size={20} className={isLight ? 'text-emerald-600' : 'text-emerald-400'} />
                                </div>
                                <div>
                                    <div className={`text-xs ${isLight ? 'text-gray-500' : 'text-gray-600'} uppercase tracking-wider mb-1`}>
                                        Total Balance
                                    </div>
                                    <div className="flex items-baseline gap-2">
                                        <span className={`text-3xl font-mono font-bold ${isLight ? 'text-gray-900' : 'text-white'}`}>
                                            ${metrics.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </span>
                                        <span className={`text-sm ${isLight ? 'text-gray-500' : 'text-gray-600'}`}>USDT</span>
                                    </div>
                                    <div className={`mt-1 text-sm font-bold ${isProfitable
                                            ? isLight ? 'text-emerald-700' : 'text-emerald-400'
                                            : isLight ? 'text-red-700' : 'text-red-400'
                                        }`}>
                                        {isProfitable ? '+' : ''}${metrics.totalPnL.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                        <span className="ml-2 opacity-70">({isProfitable ? '+' : ''}{metrics.pnlPercent.toFixed(2)}%)</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Chart + Holdings */}
                        <div className="flex-1 p-6 flex flex-col md:flex-row gap-8 overflow-auto">
                            {/* Pie Chart */}
                            <div className="flex items-center justify-center md:w-1/3">
                                <div className="w-48 h-48 relative">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie
                                                data={chartData}
                                                cx="50%"
                                                cy="50%"
                                                innerRadius={60}
                                                outerRadius={90}
                                                paddingAngle={3}
                                                dataKey="value"
                                                stroke="none"
                                            >
                                                {chartData.map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                                ))}
                                            </Pie>
                                            <Tooltip
                                                contentStyle={{
                                                    backgroundColor: isLight ? '#fff' : 'rgba(0,0,0,0.9)',
                                                    border: isLight ? '1px solid #e5e7eb' : '1px solid rgba(255,255,255,0.1)',
                                                    borderRadius: '12px',
                                                    padding: '8px 12px'
                                                }}
                                                formatter={(value: number) => [`$${value.toLocaleString()}`, '']}
                                            />
                                        </PieChart>
                                    </ResponsiveContainer>
                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                        <Wallet size={24} className={isLight ? 'text-gray-300' : 'text-gray-700'} />
                                    </div>
                                </div>
                            </div>

                            {/* Holdings List */}
                            <div className="flex-1 space-y-2">
                                {metrics.items.map((item, index) => {
                                    const color = COLORS[index % COLORS.length];
                                    const symbolBase = item.symbol.replace('USDT', '');
                                    const iconUrl = `https://assets.coincap.io/assets/icons/${symbolBase.toLowerCase()}@2x.png`;

                                    return (
                                        <motion.div
                                            key={item.symbol}
                                            initial={{ opacity: 0, x: -20 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ delay: index * 0.05 }}
                                            className={`flex justify-between items-center p-4 rounded-xl transition-all ${isLight ? 'hover:bg-gray-50' : 'hover:bg-white/5'
                                                }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                                                <div className={`w-10 h-10 rounded-full overflow-hidden ${isLight ? 'bg-gray-100' : 'bg-white/5'}`}>
                                                    <img
                                                        src={iconUrl}
                                                        className="w-full h-full object-cover"
                                                        onError={(e) => e.currentTarget.style.display = 'none'}
                                                        alt={symbolBase}
                                                    />
                                                </div>
                                                <div>
                                                    <div className={`text-sm font-bold ${isLight ? 'text-gray-900' : 'text-white'}`}>{symbolBase}</div>
                                                    <div className={`text-xs ${isLight ? 'text-gray-500' : 'text-gray-600'}`}>
                                                        {item.amount.toFixed(4)} units
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className={`text-sm font-mono font-bold ${isLight ? 'text-gray-900' : 'text-white'}`}>
                                                    ${item.value.toLocaleString()}
                                                </div>
                                                <div className={`text-xs font-bold ${item.pnl >= 0
                                                        ? isLight ? 'text-emerald-700' : 'text-emerald-400'
                                                        : isLight ? 'text-red-700' : 'text-red-400'
                                                    }`}>
                                                    {item.pnl >= 0 ? '+' : ''}{item.pnlPercent.toFixed(1)}%
                                                </div>
                                            </div>
                                        </motion.div>
                                    );
                                })}
                            </div>
                        </div>
                    </motion.div>
                ) : (
                    <motion.div
                        key="history"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex flex-col h-full"
                    >
                        {/* Actions */}
                        <div className={`px-6 py-4 border-b ${isLight ? 'border-gray-200 bg-gray-50/50' : 'border-white/10 bg-white/[0.02]'} flex justify-between items-center`}>
                            <h3 className={`text-sm font-bold ${isLight ? 'text-gray-700' : 'text-gray-300'} uppercase tracking-wider`}>
                                Trade History
                            </h3>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => {
                                        if (confirm('Clear entire portfolio?')) clearPortfolio();
                                    }}
                                    className={`p-2 rounded-xl transition-all ${isLight
                                            ? 'bg-red-100 text-red-700 hover:bg-red-200'
                                            : 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                                        }`}
                                >
                                    <Trash2 size={16} />
                                </button>
                                <button
                                    onClick={() => setIsAdding(!isAdding)}
                                    className={`p-2 rounded-xl transition-all ${isAdding
                                            ? isLight ? 'bg-gray-200 text-gray-700' : 'bg-white/10 text-white'
                                            : isLight ? 'bg-violet-100 text-violet-700 hover:bg-violet-200' : 'bg-purple-500/10 text-purple-400 hover:bg-purple-500/20'
                                        }`}
                                >
                                    {isAdding ? <X size={16} /> : <Plus size={16} />}
                                </button>
                            </div>
                        </div>

                        {/* Add Form */}
                        <AnimatePresence>
                            {isAdding && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className={`overflow-hidden border-b ${isLight ? 'border-gray-200 bg-gray-50' : 'border-white/10 bg-white/[0.02]'}`}
                                >
                                    <div className="p-6 space-y-3">
                                        <div className="grid grid-cols-2 gap-3">
                                            <input
                                                type="text"
                                                placeholder="SYMBOL"
                                                value={newSymbol}
                                                onChange={e => setNewSymbol(e.target.value.toUpperCase())}
                                                className={`px-4 py-2.5 rounded-xl text-sm font-medium uppercase outline-none transition-all ${isLight
                                                        ? 'bg-white border border-gray-200 text-gray-900 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20'
                                                        : 'bg-black/40 border border-white/10 text-white focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20'
                                                    }`}
                                            />
                                            <select
                                                value={newSide}
                                                onChange={e => setNewSide(e.target.value as any)}
                                                className={`px-4 py-2.5 rounded-xl text-sm font-medium outline-none transition-all ${isLight
                                                        ? 'bg-white border border-gray-200 text-gray-900 focus:border-violet-500'
                                                        : 'bg-black/40 border border-white/10 text-white focus:border-purple-500'
                                                    }`}
                                            >
                                                <option value="BUY">BUY</option>
                                                <option value="SELL">SELL</option>
                                            </select>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <input
                                                type="number"
                                                placeholder="PRICE"
                                                value={newPrice}
                                                onChange={e => setNewPrice(e.target.value)}
                                                className={`px-4 py-2.5 rounded-xl text-sm font-medium outline-none transition-all ${isLight
                                                        ? 'bg-white border border-gray-200 text-gray-900 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20'
                                                        : 'bg-black/40 border border-white/10 text-white focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20'
                                                    }`}
                                            />
                                            <input
                                                type="number"
                                                placeholder="QUANTITY"
                                                value={newQty}
                                                onChange={e => setNewQty(e.target.value)}
                                                className={`px-4 py-2.5 rounded-xl text-sm font-medium outline-none transition-all ${isLight
                                                        ? 'bg-white border border-gray-200 text-gray-900 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20'
                                                        : 'bg-black/40 border border-white/10 text-white focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20'
                                                    }`}
                                            />
                                        </div>
                                        <button
                                            onClick={handleAddTrade}
                                            className={`w-full py-3 rounded-xl text-sm font-bold transition-all ${isLight
                                                    ? 'bg-violet-600 text-white hover:bg-violet-700 shadow-lg shadow-violet-500/30'
                                                    : 'bg-gradient-to-r from-purple-600 to-violet-600 text-white hover:from-purple-500 hover:to-violet-500 shadow-lg shadow-purple-500/30'
                                                }`}
                                        >
                                            Log Trade
                                        </button>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Trade List */}
                        <div className="flex-1 overflow-auto">
                            {trades.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full p-12">
                                    <div className={`p-4 rounded-2xl mb-4 ${isLight ? 'bg-gray-100' : 'bg-white/5'}`}>
                                        <History size={32} className={isLight ? 'text-gray-400' : 'text-gray-600'} />
                                    </div>
                                    <p className={`text-sm ${isLight ? 'text-gray-500' : 'text-gray-600'}`}>
                                        No trades logged yet. Click + to add one.
                                    </p>
                                </div>
                            ) : (
                                <div className={`divide-y ${isLight ? 'divide-gray-100' : 'divide-white/5'}`}>
                                    {trades.map((trade, idx) => (
                                        <motion.div
                                            key={trade.id}
                                            initial={{ opacity: 0, y: 20 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: idx * 0.02 }}
                                            className={`px-6 py-4 flex justify-between items-center group transition-all ${isLight ? 'hover:bg-gray-50' : 'hover:bg-white/[0.02]'
                                                }`}
                                        >
                                            <div className="flex flex-col gap-1">
                                                <div className="flex items-center gap-2">
                                                    <span className={`font-bold ${isLight ? 'text-gray-900' : 'text-white'}`}>{trade.symbol}</span>
                                                    <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${trade.side === 'BUY'
                                                            ? isLight ? 'bg-emerald-100 text-emerald-700' : 'bg-emerald-500/10 text-emerald-400'
                                                            : isLight ? 'bg-red-100 text-red-700' : 'bg-red-500/10 text-red-400'
                                                        }`}>
                                                        {trade.side}
                                                    </span>
                                                </div>
                                                <div className={`text-xs ${isLight ? 'text-gray-500' : 'text-gray-600'}`}>
                                                    {new Date(trade.date).toLocaleString()}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-4">
                                                <div className="text-right">
                                                    <div className={`font-mono text-sm font-bold ${isLight ? 'text-gray-900' : 'text-white'}`}>
                                                        ${trade.price.toLocaleString()}
                                                    </div>
                                                    <div className={`text-xs ${isLight ? 'text-gray-500' : 'text-gray-600'}`}>
                                                        {trade.amount} units
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => deleteTrade(trade.id)}
                                                    className={`opacity-0 group-hover:opacity-100 p-2 rounded-lg transition-all ${isLight
                                                            ? 'hover:bg-red-100 text-gray-400 hover:text-red-700'
                                                            : 'hover:bg-red-500/10 text-gray-600 hover:text-red-400'
                                                        }`}
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </motion.div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
