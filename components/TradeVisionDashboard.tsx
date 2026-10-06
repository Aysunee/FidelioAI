
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useUser } from '../context/UserContext';
import { Trade } from './trade-vision/types';
import { apiJson, ApiError } from '../utils/config';
import { readScoped, writeScoped, scopedKey } from '../utils/userStorage';
import {
    getClosedTrades,
    getSignedPnl,
    getTradeTimestamp,
    isLegacyDemoTrade,
    isMigrationChange,
    normalizeTrade
} from './trade-vision/tradeMath';
import { deleteImages, isImageRef, saveDataUrl } from './trade-vision/imageStore';

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

// Per-user journal (scoped as `fidelio_trades_cache:<userId>` via utils/userStorage).
const JOURNAL_KEY = 'fidelio_trades_cache';
const QUOTA_WARNING = 'Günlük kaydedilemedi: tarayıcı depolama alanı dolu. Son değişiklikleriniz bu oturumda görünür ancak sayfa yenilenince kaybolabilir. Eski görselleri veya işlemleri silmeyi deneyin.';

const UNREADABLE_BACKED_UP_WARNING = 'Kayıtlı işlem günlüğü okunamadı. Eski veri yedeklendi ve boş bir günlükle devam ediliyor.';
const UNREADABLE_NOT_BACKED_UP_WARNING = 'Kayıtlı işlem günlüğü okunamadı ve depolama alanı dolu olduğu için yedeklenemedi. Mevcut kaydın üzerine yazılmaması için bu oturumdaki değişiklikler kaydedilmeyecek.';

type JournalStore = {
    owner: string | null;
    trades: Trade[];
    loadWarning: string | null;
    // false: the stored record could neither be read nor backed up, so it must never be overwritten.
    persist: boolean;
    // true: data was read from the legacy unscoped key (copying it failed, e.g. storage full);
    // that key is removed only after the first successful write under the user's key.
    fromLegacyKey: boolean;
};

const emptyJournal = (owner: string | null, overrides: Partial<JournalStore> = {}): JournalStore =>
    ({ owner, trades: [], loadWarning: null, persist: true, fromLegacyKey: false, ...overrides });

const storageGet = (key: string): string | null => {
    if (typeof window === 'undefined') return null;
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
};

const storageSet = (key: string, value: string): boolean => {
    if (typeof window === 'undefined') return false;
    try {
        window.localStorage.setItem(key, value);
        return true;
    } catch {
        return false;
    }
};

const storageRemove = (key: string) => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.removeItem(key);
    } catch { /* ignore */ }
};

// Unreadable record: keep a copy; if even that fails, stop persisting so the original is never overwritten.
const unreadableJournal = (owner: string, stored: string): JournalStore =>
    storageSet(`${scopedKey(JOURNAL_KEY, owner)}:corrupt-backup`, stored)
        ? emptyJournal(owner, { loadWarning: UNREADABLE_BACKED_UP_WARNING })
        : emptyJournal(owner, { loadWarning: UNREADABLE_NOT_BACKED_UP_WARNING, persist: false });

// One-time copy of the raw records before they are rewritten in the new format.
// Screenshots are left out: normalisation never changes them and they would only fill the quota again.
const backupBeforeMigration = (owner: string, list: unknown[]) => {
    const backupKey = `${scopedKey(JOURNAL_KEY, owner)}:pre-migration-backup`;
    if (storageGet(backupKey) !== null) return;
    const slim = list.map(r => (r && typeof r === 'object' ? { ...(r as Record<string, unknown>), images: undefined } : r));
    if (!storageSet(backupKey, JSON.stringify(slim))) {
        console.warn('[Journal] taşıma öncesi yedek alınamadı (depolama dolu olabilir).');
    }
};

const loadJournal = (userId: string | null): JournalStore => {
    if (!userId) return emptyJournal(null);
    const missing = Symbol('missing');
    let raw: unknown = readScoped<unknown>(JOURNAL_KEY, userId, missing);
    let fromLegacyKey = false;
    if (raw === missing) {
        // Distinguish "no data yet" from "unreadable data": never silently overwrite a corrupt record.
        const stored = storageGet(scopedKey(JOURNAL_KEY, userId));
        if (stored !== null) {
            return stored === 'null' ? emptyJournal(userId) : unreadableJournal(userId, stored);
        }
        // readScoped could not copy the legacy unscoped key (e.g. QuotaExceededError): read it in place.
        const legacy = storageGet(JOURNAL_KEY);
        if (legacy === null || legacy === 'null') return emptyJournal(userId);
        try {
            raw = JSON.parse(legacy);
        } catch {
            return unreadableJournal(userId, legacy);
        }
        fromLegacyKey = true;
    }
    if (!Array.isArray(raw)) {
        return raw === null ? emptyJournal(userId) : unreadableJournal(userId, JSON.stringify(raw));
    }
    const normalized = raw.map(normalizeTrade);
    if (raw.some((record, i) => isMigrationChange(record, normalized[i]))) backupBeforeMigration(userId, raw);
    const trades = normalized
        .filter((t): t is Trade => t !== null)
        // Older builds seeded demo trades into every journal; they are not the user's data.
        .filter(t => !isLegacyDemoTrade(t));
    return emptyJournal(userId, { trades, fromLegacyKey });
};

// Gemini answers in Markdown; show it as clean plain text (no HTML rendering).
const toPlainText = (text: string) =>
    text
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/__(.+?)__/g, '$1')
        .replace(/^#{1,6}\s*/gm, '')
        .replace(/^\s*[-*]\s+/gm, '• ')
        .trim();

export const TradeVisionDashboard: React.FC = () => {
    const { theme, user } = useUser();
    const userId = user?.id ? String(user.id) : null;

    const [store, setStore] = useState<JournalStore>(() => loadJournal(userId));
    // Account switch: load that user's journal before rendering anything of the previous one.
    if (store.owner !== userId) {
        setStore(loadJournal(userId));
    }
    const trades = store.owner === userId ? store.trades : [];

    const setTrades = useCallback((updater: (prev: Trade[]) => Trade[]) => {
        setStore(prev => ({ ...prev, trades: updater(prev.trades) }));
    }, []);

    const [storageWarning, setStorageWarning] = useState<string | null>(null);

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

    // Persist per user; a quota error shows a warning instead of crashing the app.
    useEffect(() => {
        if (!store.owner || !store.persist) return;
        const ok = writeScoped(JOURNAL_KEY, store.owner, store.trades);
        // The user's copy is now stored: the legacy unscoped key is no longer needed.
        if (ok && store.fromLegacyKey) storageRemove(JOURNAL_KEY);
        setStorageWarning(ok ? null : QUOTA_WARNING);
    }, [store]);

    // One-time migration of legacy base64 screenshots from localStorage into IndexedDB.
    const migratedOwnerRef = useRef<string | null>(null);
    useEffect(() => {
        const owner = store.owner;
        if (!owner || migratedOwnerRef.current === owner) return;
        migratedOwnerRef.current = owner;
        const legacy = store.trades.flatMap(t => (t.images || []).filter(img => !isImageRef(img) && img.startsWith('data:')));
        if (legacy.length === 0) return;
        // Not cancelled on re-render: the replacement below is idempotent and scoped to the same owner.
        (async () => {
            const replacements = new Map<string, string>();
            for (const dataUrl of legacy) {
                try {
                    replacements.set(dataUrl, await saveDataUrl(dataUrl));
                } catch (err) {
                    console.warn('[Journal] eski görsel taşınamadı:', err);
                }
            }
            if (replacements.size === 0) return;
            setStore(prev => prev.owner !== owner ? prev : {
                ...prev,
                trades: prev.trades.map(t => ({
                    ...t,
                    images: (t.images || []).map(img => replacements.get(img) ?? img)
                }))
            });
        })();
    }, [store]);

    const filteredTrades = useMemo(() => {
        return trades.filter(t => {
            if (filters.symbol && t.symbol !== filters.symbol) return false;
            if (filters.side && t.side !== filters.side) return false;
            if (filters.status && t.status !== filters.status) return false;
            if (filters.setup && !t.setups.includes(filters.setup)) return false;
            if (filters.tag && !t.tags?.includes(filters.tag)) return false;
            return true;
        }).sort((a, b) => getTradeTimestamp(b) - getTradeTimestamp(a));
    }, [trades, filters]);

    const selectedTrade = useMemo(() =>
        trades.find(t => t.id === selectedTradeId) || null
        , [trades, selectedTradeId]);

    const analyzeWithAI = async () => {
        if (isAnalyzing) return;
        setIsAnalyzing(true);
        try {
            // Only closed trades have realised P&L; open ones are reported separately.
            const closed = getClosedTrades(filteredTrades);
            const openCount = filteredTrades.length - closed.length;
            const totalProfit = closed.reduce((acc, t) => acc + getSignedPnl(t), 0);
            const winRate = closed.length > 0 ? Math.round((closed.filter(t => t.status === 'WIN').length / closed.length) * 100) : 0;
            const statsSummary = `${closed.length} closed trades (${openCount} still open), ${winRate}% win rate on closed trades. Net realised P&L: $${totalProfit.toFixed(2)}`;

            const data = await apiJson<{ text?: string }>('/api/analyze', {
                method: 'POST',
                body: JSON.stringify({
                    prompt: `Provide a short, professional analysis for a trader with these stats: ${statsSummary}. Speak as Fidelio AI. Yanıtı Türkçe ver.`,
                    context: `User is viewing their trading journal. Recent trades performance: ${statsSummary}`
                })
            });

            setAiInsight(data?.text ? toPlainText(data.text) : 'Analiz sonucu alınamadı.');
        } catch (error) {
            console.error("AI Insight Error:", error);
            setAiInsight(error instanceof ApiError
                ? error.message
                : 'Yapay zeka servisine ulaşılamadı. Lütfen bağlantınızı kontrol edin.');
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleAddTrade = (newTrade: Trade) => {
        setTrades(prev => [newTrade, ...prev]);
        setIsModalOpen(false);
    };

    const handleDeleteTrade = (id: string) => {
        const target = trades.find(t => t.id === id);
        setTrades(prev => prev.filter(t => t.id !== id));
        setSelectedTradeId(null);
        if (target?.images?.length) deleteImages(target.images);
    };

    const handleUpdateTrade = (id: string, updates: Partial<Trade>) => {
        const current = trades.find(t => t.id === id);
        if (current && updates.images) {
            const kept = new Set(updates.images);
            const removed = (current.images || []).filter(img => !kept.has(img));
            if (removed.length > 0) deleteImages(removed);
        }
        setTrades(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    };

    const updateFilter = (key: keyof FilterState, value: string | null) => {
        setFilters(prev => ({ ...prev, [key]: value }));
    };

    return (
        // Terminal workspace: every child is a panel; the 1px lines between panels are this root's background.
        <div className="relative flex min-h-full w-full flex-1 flex-col gap-px bg-border lg:h-full lg:min-h-0 lg:flex-row">
            {/* Dynamic Sidebar for Journal Views */}
            <Sidebar activeView={activeView} onViewChange={setActiveView} />

            <div className="flex min-w-0 flex-1 flex-col gap-px lg:min-h-0">
                <Header
                    filters={filters}
                    onFilterChange={updateFilter}
                    onClear={() => setFilters({ symbol: null, side: null, status: null, setup: null, tag: null })}
                    onOpenModal={() => setIsModalOpen(true)}
                    onOpenCalculator={() => setIsCalculatorOpen(true)}
                    trades={filteredTrades}
                    allTrades={trades}
                />

                {(storageWarning || store.loadWarning) && (
                    <div role="alert" className="shrink-0 bg-surface">
                        <div className="flex items-start gap-2 bg-warning-soft px-3 py-1.5 text-[11px] font-medium text-warning">
                            <AlertTriangle size={14} className="mt-px shrink-0" />
                            <span className="flex-1">{storageWarning || store.loadWarning}</span>
                            {!storageWarning && store.loadWarning && store.persist && (
                                <button
                                    type="button"
                                    aria-label="Uyarıyı kapat"
                                    onClick={() => setStore(prev => ({ ...prev, loadWarning: null }))}
                                    className="shrink-0 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {activeView === 'dashboard' && (
                    <div className="flex flex-1 flex-col gap-px lg:min-h-0 xl:flex-row">
                        <div className="flex min-w-0 flex-1 flex-col gap-px lg:min-h-0 lg:overflow-y-auto">
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

                        <div className="hidden w-72 shrink-0 xl:flex">
                            <RightSidebar trades={filteredTrades} />
                        </div>
                    </div>
                )}

                {activeView === 'calendar' && (
                    <div className="flex flex-1 flex-col lg:min-h-0">
                        <CalendarView trades={filteredTrades} />
                    </div>
                )}

                {activeView === 'analytics' && (
                    <div className="flex flex-1 flex-col lg:min-h-0">
                        <AnalyticsView trades={filteredTrades} />
                    </div>
                )}

                {activeView === 'journal' && (
                    <div className="flex flex-1 flex-col lg:min-h-0">
                        <JournalView trades={filteredTrades} onSelectTrade={setSelectedTradeId} />
                    </div>
                )}
            </div>

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
        </div>
    );
};
