
import React, { useState, useMemo, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import StatsRow from './components/StatsRow';
import TradingTable from './components/TradingTable';
import RightSidebar from './components/RightSidebar';
import AddTradeModal from './components/AddTradeModal';
import AIInsightPanel from './components/AIInsightPanel';
import TradeJournalModal from './components/TradeJournalModal';
import DashboardCharts from './components/DashboardCharts';
import CalendarView from './components/CalendarView';
import AnalyticsView from './components/AnalyticsView';
import JournalView from './components/JournalView';
import RiskCalculatorModal from './components/RiskCalculatorModal';
import { MOCK_TRADES } from './constants';
import { Trade } from './types';
import { GoogleGenAI } from "@google/genai";
import { AnimatePresence } from "framer-motion";

export type FilterState = {
  symbol: string | null;
  side: string | null;
  status: string | null;
  setup: string | null;
};

const App: React.FC = () => {
  const [trades, setTrades] = useState<Trade[]>(() => {
    try {
      const saved = localStorage.getItem('trades_v2_cache');
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
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCalculatorOpen, setIsCalculatorOpen] = useState(false);
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
    localStorage.setItem('trades_v2_cache', JSON.stringify(trades));
  }, [trades]);

  const filteredTrades = useMemo(() => {
    return trades.filter(t => {
      if (filters.symbol && t.symbol !== filters.symbol) return false;
      if (filters.side && t.side !== filters.side) return false;
      if (filters.status && t.status !== filters.status) return false;
      if (filters.setup && !t.setups.includes(filters.setup)) return false;
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
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const totalProfit = filteredTrades.reduce((acc, t) => acc + (t.status === 'WIN' ? t.returnVal : -t.returnVal), 0);
      const statsSummary = `Data: ${filteredTrades.length} trades, ${Math.round((filteredTrades.filter(t => t.status === 'WIN').length / Math.max(1, filteredTrades.length)) * 100)}% winrate. Total Profit: $${totalProfit}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Provide a short, 2-sentence professional analysis for a trader with these stats: ${statsSummary}`,
      });
      setAiInsight(response.text || "Insight generated.");
    } catch (error) {
      console.error("AI Insight Error:", error);
      setAiInsight("AI Engine is updating. Maintain your risk management and focus on setups with >70% efficiency.");
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

  const handleUpdateNotes = (id: string, notes: string) => {
    setTrades(prev => prev.map(t => t.id === id ? { ...t, notes } : t));
  };

  const updateFilter = (key: keyof FilterState, value: string | null) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="flex h-screen w-screen bg-[#0b0e14] text-slate-200 overflow-hidden relative">
      <div className="fixed inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.1] pointer-events-none z-0"></div>

      <Sidebar activeView={activeView} onViewChange={setActiveView} />

      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        {activeView === 'dashboard' && (
          <>
            <Header
              filters={filters}
              onFilterChange={updateFilter}
              onClear={() => setFilters({ symbol: null, side: null, status: null, setup: null })}
              onOpenModal={() => setIsModalOpen(true)}
              onOpenCalculator={() => setIsCalculatorOpen(true)}
              trades={trades}
            />

            <div className="flex-1 flex min-h-0">
              <div className="flex-1 flex flex-col overflow-y-auto custom-scrollbar">
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

              <RightSidebar trades={filteredTrades} />
            </div>
          </>
        )}

        {activeView === 'calendar' && (
          <CalendarView trades={trades} />
        )}

        {activeView === 'analytics' && (
          <AnalyticsView trades={filteredTrades} />
        )}

        {activeView === 'journal' && (
          <JournalView trades={filteredTrades} onSelectTrade={setSelectedTradeId} />
        )}
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
            onUpdateNotes={(notes) => handleUpdateNotes(selectedTrade.id, notes)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default App;
