
import React, { useMemo, useState, useEffect } from 'react';
import { Holding, Ticker } from '../types';
import { Card } from './ui/Card';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Wallet, History, Plus, X, Trash2 } from 'lucide-react';

interface PortfolioProps {
  holdings: Holding[];
  data: Record<string, Ticker>;
}

interface Trade {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  qty: number;
  price: number;
  time: number;
}

const COLORS = [
  '#F7A600', // Brand Yellow
  '#2DBD85', // Success Green
  '#5D636E', // Gray
  '#4169E1', // Royal Blue
  '#E0E0E0', // Light Gray
];

export const Portfolio: React.FC<PortfolioProps> = ({ holdings, data }) => {
  const [activeTab, setActiveTab] = useState<'assets' | 'history'>('assets');
  const [trades, setTrades] = useState<Trade[]>([]);
  
  // Manual Add Form State
  const [isAdding, setIsAdding] = useState(false);
  const [newSymbol, setNewSymbol] = useState('');
  const [newSide, setNewSide] = useState<'BUY' | 'SELL'>('BUY');
  const [newPrice, setNewPrice] = useState('');
  const [newQty, setNewQty] = useState('');

  // Load from local storage on mount
  useEffect(() => {
      const saved = localStorage.getItem('fidelio_trade_history');
      if (saved) {
          try {
              setTrades(JSON.parse(saved));
          } catch (e) { console.error("Failed to load trade history", e); }
      }
  }, []);

  // Save to local storage on change
  useEffect(() => {
      localStorage.setItem('fidelio_trade_history', JSON.stringify(trades));
  }, [trades]);

  const handleAddTrade = () => {
      if (!newSymbol || !newPrice || !newQty) return;
      const trade: Trade = {
          id: Date.now().toString(),
          symbol: newSymbol.toUpperCase(),
          side: newSide,
          price: parseFloat(newPrice),
          qty: parseFloat(newQty),
          time: Date.now()
      };
      setTrades(prev => [trade, ...prev]);
      setIsAdding(false);
      setNewSymbol('');
      setNewPrice('');
      setNewQty('');
  };
  
  const handleDeleteTrade = (id: string) => {
      setTrades(prev => prev.filter(t => t.id !== id));
  };

  const metrics = useMemo(() => {
    let totalValue = 0;
    let totalCost = 0;
    const items = holdings.map(h => {
      const currentPrice = data[h.symbol]?.lastPrice || h.costBasis;
      const value = h.qty * currentPrice;
      const cost = h.qty * h.costBasis;
      totalValue += value;
      totalCost += cost;
      return {
        ...h,
        currentPrice,
        value,
        pnl: value - cost,
        pnlPercent: ((value - cost) / cost) * 100
      };
    });

    return {
      totalValue,
      totalCost,
      totalPnL: totalValue - totalCost,
      pnlPercent: totalCost === 0 ? 0 : ((totalValue - totalCost) / totalCost) * 100,
      items: items.sort((a, b) => b.value - a.value)
    };
  }, [holdings, data]);

  const chartData = metrics.items.map(i => ({
    name: i.symbol.replace('USDT', ''),
    value: i.value
  }));

  const isProfitable = metrics.totalPnL >= 0;

  return (
    <Card className="h-full flex flex-col" noPadding>
        {/* Header Tabs */}
        <div className="flex items-center border-b border-border bg-surface shrink-0">
            <button 
                onClick={() => setActiveTab('assets')}
                className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors flex items-center justify-center gap-2 ${
                    activeTab === 'assets' ? 'border-primary text-text' : 'border-transparent text-secondary hover:text-text'
                }`}
            >
                <Wallet size={16} /> Assets
            </button>
            <button 
                onClick={() => setActiveTab('history')}
                className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors flex items-center justify-center gap-2 ${
                    activeTab === 'history' ? 'border-primary text-text' : 'border-transparent text-secondary hover:text-text'
                }`}
            >
                <History size={16} /> History
            </button>
        </div>

        {activeTab === 'assets' ? (
           <div className="flex flex-col h-full overflow-hidden">
            {/* Asset Summary Header */}
            <div className="px-5 py-4 border-b border-border bg-surface-secondary/20 shrink-0">
                <div className="text-secondary text-xs font-medium uppercase tracking-wider mb-1">Estimated Balance</div>
                <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-mono font-bold text-text tracking-tight">
                        {metrics.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    <span className="text-sm font-medium text-secondary">USDT</span>
                </div>
                <div className={`mt-1 text-sm font-medium ${isProfitable ? 'text-success' : 'text-danger'}`}>
                    {isProfitable ? '+' : ''}{metrics.totalPnL.toLocaleString(undefined, { minimumFractionDigits: 2 })} 
                    <span className="ml-1 opacity-70">({isProfitable ? '+' : ''}{metrics.pnlPercent.toFixed(2)}%)</span>
                </div>
            </div>

            <div className="flex-1 p-4 flex flex-col md:flex-row gap-6 items-center justify-center overflow-hidden">
                <div className="h-40 w-40 shrink-0 relative">
                    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                        <PieChart>
                            <Pie
                                data={chartData}
                                cx="50%"
                                cy="50%"
                                innerRadius={55}
                                outerRadius={75}
                                paddingAngle={2}
                                dataKey="value"
                                stroke="var(--bg-surface)"
                                strokeWidth={2}
                            >
                                {chartData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                            </Pie>
                            <Tooltip 
                                contentStyle={{ 
                                    backgroundColor: 'var(--bg-surface-highlight)', 
                                    borderColor: 'var(--color-border)', 
                                    borderRadius: '4px', 
                                    border: '1px solid var(--color-border)',
                                    color: 'var(--color-text)',
                                    padding: '8px 12px',
                                    fontSize: '12px'
                                }}
                                itemStyle={{ color: 'var(--color-text)', fontWeight: 600 }}
                                formatter={(value: number) => [`$${value.toLocaleString()}`, '']}
                            />
                        </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex items-center justify-center text-secondary pointer-events-none">
                        <Wallet size={20} opacity={0.5} />
                    </div>
                </div>

                <div className="w-full space-y-2 pr-1 overflow-y-auto max-h-[200px] scrollbar-thin">
                    {metrics.items.map((item, index) => {
                        const color = COLORS[index % COLORS.length];
                        const symbolBase = item.symbol.replace('USDT', '');
                        const iconUrl = `https://assets.coincap.io/assets/icons/${symbolBase.toLowerCase()}@2x.png`;

                        return (
                            <div key={item.id} className="flex justify-between items-center group py-1 px-1 rounded hover:bg-surface-secondary/50">
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }}></div>
                                    <div className="relative w-5 h-5 rounded-full bg-surface-secondary overflow-hidden">
                                        <img 
                                            src={iconUrl} 
                                            className="absolute inset-0 w-full h-full object-cover"
                                            onError={(e) => e.currentTarget.style.display = 'none'}
                                        />
                                    </div>
                                    <div className="text-sm font-medium text-text">{symbolBase}</div>
                                </div>
                                <div className="text-right">
                                    <div className="text-sm font-mono text-text">${item.value.toLocaleString()}</div>
                                    <div className={`text-[11px] ${item.pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                                        {item.pnl >= 0 ? '+' : ''}{item.pnlPercent.toFixed(1)}%
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
           </div>
        ) : (
            <div className="flex flex-col h-full bg-surface overflow-hidden">
                {/* Actions */}
                <div className="p-3 border-b border-border flex justify-between items-center bg-surface-secondary/10 shrink-0">
                    <h3 className="text-xs font-bold text-secondary uppercase tracking-wider">Recent Trades</h3>
                    <button 
                        onClick={() => setIsAdding(!isAdding)}
                        className="p-1.5 bg-primary/10 text-primary hover:bg-primary/20 rounded-md transition-colors"
                        title="Add Trade"
                    >
                        {isAdding ? <X size={16} /> : <Plus size={16} />}
                    </button>
                </div>

                {/* Add Trade Form */}
                {isAdding && (
                    <div className="p-3 bg-surface-highlight border-b border-border animate-enter shrink-0">
                        <div className="grid grid-cols-2 gap-2 mb-2">
                            <input 
                                type="text" placeholder="SYMBOL" 
                                value={newSymbol} onChange={e => setNewSymbol(e.target.value.toUpperCase())}
                                className="bg-surface border border-border rounded px-2 py-1.5 text-xs text-text focus:border-primary outline-none uppercase"
                            />
                            <select 
                                value={newSide} onChange={e => setNewSide(e.target.value as any)}
                                className="bg-surface border border-border rounded px-2 py-1.5 text-xs text-text focus:border-primary outline-none"
                            >
                                <option value="BUY">BUY</option>
                                <option value="SELL">SELL</option>
                            </select>
                            <input 
                                type="number" placeholder="PRICE" 
                                value={newPrice} onChange={e => setNewPrice(e.target.value)}
                                className="bg-surface border border-border rounded px-2 py-1.5 text-xs text-text focus:border-primary outline-none"
                            />
                            <input 
                                type="number" placeholder="QTY" 
                                value={newQty} onChange={e => setNewQty(e.target.value)}
                                className="bg-surface border border-border rounded px-2 py-1.5 text-xs text-text focus:border-primary outline-none"
                            />
                        </div>
                        <button 
                            onClick={handleAddTrade}
                            className="w-full bg-primary text-white py-1.5 rounded text-xs font-bold hover:bg-primary/90 transition-colors"
                        >
                            Log Trade
                        </button>
                    </div>
                )}

                {/* Trade List */}
                <div className="flex-1 overflow-y-auto">
                    <div className="divide-y divide-border">
                        {trades.length === 0 ? (
                            <div className="text-center py-8 text-secondary text-xs opacity-60">
                                No trades logged yet. <br/> Use + to add one.
                            </div>
                        ) : (
                            trades.map(trade => (
                                <div key={trade.id} className="p-3 hover:bg-surface-secondary/50 flex justify-between items-center group transition-colors">
                                    <div className="flex flex-col gap-0.5">
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-sm text-text">{trade.symbol}</span>
                                            <span className={`text-[10px] px-1 rounded font-bold uppercase tracking-wider ${trade.side === 'BUY' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
                                                {trade.side}
                                            </span>
                                        </div>
                                        <div className="text-[10px] text-secondary">
                                            {new Date(trade.time).toLocaleString()}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <div className="text-right">
                                            <div className="font-mono text-sm text-text font-medium">{trade.price.toLocaleString()}</div>
                                            <div className="text-[10px] text-secondary">{trade.qty} Units</div>
                                        </div>
                                        <button 
                                            onClick={() => handleDeleteTrade(trade.id)}
                                            className="opacity-0 group-hover:opacity-100 p-1.5 text-secondary hover:text-danger hover:bg-danger/10 rounded-md transition-all"
                                            title="Delete Log"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        )}
    </Card>
  );
};
