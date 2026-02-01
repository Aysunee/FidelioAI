
import React, { useState, useMemo, useEffect } from 'react';
import { AnimatePresence, motion } from "framer-motion";
import { useUser } from '../context/UserContext';
import { GlassCard } from './ui/GlassCard';
import { Trade } from './trade-vision/types';
import { MOCK_TRADES } from './trade-vision/constants';

// Ported Components
import Sidebar from './trade-vision/Sidebar';
import Header from './trade-vision/Header';
import StatsRow from './trade-vision/StatsRow';
import TradingTable from './trade-vision/TradingTable';
import RightSidebar from './trade-vision/RightSidebar';
import AddTradeModal from './trade-vision/AddTradeModal';
import AIInsightPanel from './trade-vision/AIInsightPanel';
import TradeJournalModal from './trade-vision/TradeJournalModal';
import DashboardCharts from './trade-vision/DashboardCharts';
import CalendarView from './trade-vision/CalendarView';
import AnalyticsView from './trade-vision/AnalyticsView';
import JournalView from './trade-vision/JournalView';
import RiskCalculatorModal from './trade-vision/RiskCalculatorModal';

export type FilterState = {
    symbol: string | null;
    side: string | null;
    status: string | null;
    setup: string | null;
    tag: string | null;
};

export const TradeVisionDashboard: React.FC = () => {
    const { theme } = useUser();
    const [trades, setTrades] = useState<Trade[]>(() => {
        try {
            const saved = localStorage.getItem('fidelio_trades_cache');
            return saved ? JSON.parse(saved) : MOCK_TRADES;
        } catch (e) {
            return MOCK_TRADES;
        }
    });

    const [activeView, setActiveView] = useState<'dashboard' | 'calendar' | 'analytics' | 'journal'>('dashboard');

    const [filters, setFilters] = useState<FilterState>({
        symbol: null,
        side: null,
        status: null,
        setup: null,
        tag: null,
    });

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isCalculatorOpen, setIsCalculatorOpen] = useState(false);
    const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
    const [aiInsight, setAiInsight] = useState<string | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    useEffect(() => {
        localStorage.setItem('fidelio_trades_cache', JSON.stringify(trades));
    }, [trades]);

    const filteredTrades = useMemo(() => {
        return trades.filter(t => {
            if (filters.symbol && t.symbol !== filters.symbol) return false;
            if (filters.side && t.side !== filters.side) return false;
            if (filters.status && t.status !== filters.status) return false;
            if (filters.setup && !t.setups.includes(filters.setup)) return false;
            if (filters.tag && !t.tags?.includes(filters.tag)) return false;
            return true;
        }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [trades, filters]);

    const selectedTrade = useMemo(() =>
        trades.find(t => t.id === selectedTradeId) || null
        , [trades, selectedTradeId]);

    const analyzeWithAI = async () => {
        if (isAnalyzing) return;
        setIsAnalyzing(true);
        try {
            // Integration with Fidelio's backend
            const totalProfit = filteredTrades.reduce((acc, t) => acc + (t.status === 'WIN' ? t.returnVal : -t.returnVal), 0);
            const statsSummary = `${filteredTrades.length} trades, ${Math.round((filteredTrades.filter(t => t.status === 'WIN').length / Math.max(1, filteredTrades.length)) * 100)}% winrate. Profit: $${totalProfit}`;

            const response = await fetch('/api/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: `Provide a short, professional analysis for a trader with these stats: ${statsSummary}. Speak as Fidelio AI.`,
                    context: `User is viewing their trading journal. Recent trades performance: ${statsSummary}`
                })
            });

            const data = await response.json();

            if (!response.ok) {
                setAiInsight(data.error || "⚠️ AI Service Unavailable");
            } else {
                setAiInsight(data.text || "No analysis available.");
            }
        } catch (error) {
            console.error("AI Insight Error:", error);
            setAiInsight("⚠️ AI Service Unavailable. Please check backend connection.");
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleAddTrade = (newTrade: Trade) => {
        setTrades(prev => [newTrade, ...prev]);
        setIsModalOpen(false);
    };

    const handleDeleteTrade = (id: string) => {
        setTrades(prev => prev.filter(t => t.id !== id));
        setSelectedTradeId(null);
    };

    const handleUpdateTrade = (id: string, updates: Partial<Trade>) => {
        setTrades(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    };

    const updateFilter = (key: keyof FilterState, value: string | null) => {
        setFilters(prev => ({ ...prev, [key]: value }));
    };

    return (
        <div className="flex-1 flex flex-col min-h-0 bg-transparent relative overflow-hidden">
            <div className="flex-1 flex flex-col md:flex-row min-h-0 gap-4">
                {/* Dynamic Sidebar for Journal Views */}
                <Sidebar activeView={activeView} onViewChange={setActiveView} />

                <div className="flex-1 flex flex-col min-w-0 min-h-0">
                    <Header
                        filters={filters}
                        onFilterChange={updateFilter}
                        onClear={() => setFilters({ symbol: null, side: null, status: null, setup: null, tag: null })}
                        onOpenModal={() => setIsModalOpen(true)}
                        onOpenCalculator={() => setIsCalculatorOpen(true)}
                        trades={filteredTrades}
                    />

                    {activeView === 'dashboard' && (
                        <div className="flex-1 flex min-h-0 gap-4 mt-4 overflow-hidden">
                            <div className="flex-1 flex flex-col overflow-y-auto scrollbar-hide space-y-4">
                                <AIInsightPanel
                                    insight={aiInsight}
                                    isAnalyzing={isAnalyzing}
                                    onAnalyze={analyzeWithAI}
                                />
                                <StatsRow trades={filteredTrades} />
                                <DashboardCharts trades={filteredTrades} />
                                <TradingTable
                                    trades={filteredTrades}
                                    onRowClick={(id) => setSelectedTradeId(id)}
                                />
                            </div>

                            <div className="hidden xl:block w-80">
                                <RightSidebar trades={filteredTrades} />
                            </div>
                        </div>
                    )}

                    {activeView === 'calendar' && (
                        <div className="flex-1 min-h-0 pt-4">
                            <CalendarView trades={trades} />
                        </div>
                    )}

                    {activeView === 'analytics' && (
                        <div className="flex-1 min-h-0 pt-4">
                            <AnalyticsView trades={filteredTrades} />
                        </div>
                    )}

                    {activeView === 'journal' && (
                        <div className="flex-1 min-h-0 pt-4">
                            <JournalView trades={filteredTrades} onSelectTrade={setSelectedTradeId} />
                        </div>
                    )}
                </div>
            </div>

            <AnimatePresence>
                {isModalOpen && (
                    <AddTradeModal
                        onClose={() => setIsModalOpen(false)}
                        onSubmit={handleAddTrade}
                    />
                )}

                {isCalculatorOpen && (
                    <RiskCalculatorModal onClose={() => setIsCalculatorOpen(false)} />
                )}

                {selectedTrade && (
                    <TradeJournalModal
                        trade={selectedTrade}
                        onClose={() => setSelectedTradeId(null)}
                        onDelete={() => handleDeleteTrade(selectedTrade.id)}
                        onUpdateTrade={(updates) => handleUpdateTrade(selectedTrade.id, updates)}
                    />
                )}
            </AnimatePresence>
        </div>
    );
};
