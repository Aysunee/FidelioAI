import React, { useState, useEffect } from 'react';
import { Database, RefreshCw, Search, Download, ShieldAlert, Zap } from 'lucide-react';
import { Signal } from '../types';
import { apiJson, ApiError } from '../utils/config';
import { useUser } from '../context/UserContext';
import { getStrategyLabel } from '../context/SignalContext';

const INPUT_CLASS = 'h-7 rounded-sm border border-border bg-surface-secondary px-2 text-xs text-text placeholder:text-muted outline-none focus:border-primary';
const HEADER_BUTTON_CLASS = 'flex h-6 items-center gap-1.5 rounded-sm border border-border bg-surface-secondary px-2 text-[11px] font-medium text-text transition-colors hover:bg-surface-highlight focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary';
const PAGE_BUTTON_CLASS = 'h-6 rounded-sm border border-border bg-surface-secondary px-2 text-[11px] font-medium text-text transition-colors hover:bg-surface-highlight focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50';
const TH_CLASS = 'sticky top-0 z-10 h-7 border-b border-border bg-surface px-3 text-[10px] font-medium uppercase tracking-wider text-muted';
const TD_CLASS = 'h-7 border-b border-border px-3';

export const DatabaseViewer: React.FC = () => {
    const { user } = useUser();
    const isAdmin = user?.role === 'admin';
    // The test-signal tool writes to the real DB and broadcasts to everyone,
    // so it only exists in development builds (and only for admins).
    const canSendTestSignal = isAdmin && Boolean(import.meta.env.DEV);
    const [signals, setSignals] = useState<Signal[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [serverStatus, setServerStatus] = useState<'checking' | 'online' | 'offline'>('checking');

    // Filters
    const [filterStrategy, setFilterStrategy] = useState('ALL');
    const [filterSide, setFilterSide] = useState('ALL');

    const fetchSignals = async () => {
        setLoading(true);
        try {
            const data = await apiJson<Signal[]>('/api/signals?limit=500');
            setSignals(Array.isArray(data) ? data : []);
            setServerStatus('online');
        } catch (error) {
            console.error('Failed to fetch DB:', error);
            setServerStatus('offline');
        } finally {
            setLoading(false);
        }
    };

    // Writes a REAL signal to the production DB and broadcasts it to every user,
    // so it is dev-only + admin-only (server enforces admin too) and requires explicit confirmation.
    const sendTestSignal = async () => {
        if (!canSendTestSignal) return;
        if (typeof window === 'undefined' || !window.confirm(
            'Bu işlem veritabanına gerçek bir test sinyali (TESTUSDT) yazacak ve TÜM kullanıcılara canlı olarak yayınlayacak. Devam edilsin mi?'
        )) return;
        try {
            await apiJson('/api/signals', {
                method: 'POST',
                body: JSON.stringify({
                    symbol: 'TESTUSDT',
                    side: 'BUY',
                    price: 12345.67,
                    strategy: 'Manual_Test_Signal',
                    note: 'Veritabanı bağlantı testi',
                    source: 'MANUAL'
                })
            });
            alert('Test sinyali gönderildi, liste yenileniyor...');
            fetchSignals();
        } catch (err) {
            const message = err instanceof ApiError ? err.message : 'Sunucuya bağlanılamadı.';
            alert(`Test sinyali gönderilemedi: ${message}`);
        }
    };

    useEffect(() => {
        if (isAdmin) fetchSignals();
    }, [isAdmin]);

    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 50;

    // Extract unique strategies for filter dropdown
    const strategies = ['ALL', ...Array.from(new Set(signals.map(s => s.strategy)))].sort();

    const filteredSignals = signals.filter(s => {
        const matchesSearch = s.symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
            s.note?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStrategy = filterStrategy === 'ALL' || s.strategy === filterStrategy;
        const matchesSide = filterSide === 'ALL' || s.side === filterSide;

        return matchesSearch && matchesStrategy && matchesSide;
    });

    // Pagination Logic
    const totalPages = Math.ceil(filteredSignals.length / itemsPerPage);
    const paginatedSignals = filteredSignals.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    const handlePageChange = (page: number) => {
        if (page >= 1 && page <= totalPages) {
            setCurrentPage(page);
        }
    };

    const downloadJSON = () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(signals, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", "fidelio_db_export.json");
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    };

    if (!isAdmin) {
        return (
            <div className="flex h-full min-h-[120px] w-full flex-1 items-center justify-center gap-2 bg-surface px-3 text-xs text-muted">
                <ShieldAlert size={14} className="shrink-0 text-danger" />
                Bu görünüm yalnızca yöneticiler içindir.
            </div>
        );
    }

    return (
        <section className="flex h-full min-h-0 w-full flex-1 flex-col bg-surface">
            {/* Header */}
            <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
                <div className="flex min-w-0 items-center gap-2">
                    <h1 className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-secondary">
                        <Database size={12} />
                        Database Viewer
                    </h1>
                    <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-3 ${serverStatus === 'online' ? 'bg-success-soft text-success' :
                        serverStatus === 'offline' ? 'bg-danger-soft text-danger' :
                            'bg-surface-secondary text-secondary'
                        }`}>
                        {serverStatus === 'online' ? 'CONNECTED' : serverStatus === 'offline' ? 'DISCONNECTED' : 'CHECKING...'}
                    </span>
                    <p className="hidden truncate font-mono text-[11px] text-muted lg:block">
                        {signals.length.toLocaleString()} records stored • {filteredSignals.length.toLocaleString()} filtering match
                    </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    {canSendTestSignal && (
                        <button
                            onClick={sendTestSignal}
                            className="flex h-6 items-center gap-1.5 rounded-sm bg-primary-soft px-2 text-[11px] font-medium text-primary transition-colors hover:opacity-80 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                        >
                            <Zap size={12} />
                            <span className="hidden sm:inline">Test Signal</span>
                        </button>
                    )}
                    <button
                        onClick={downloadJSON}
                        className={HEADER_BUTTON_CLASS}
                    >
                        <Download size={12} />
                        <span className="hidden sm:inline">Export</span>
                    </button>
                    <button
                        onClick={fetchSignals}
                        className={HEADER_BUTTON_CLASS}
                    >
                        <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                        <span className="hidden sm:inline">Refresh</span>
                    </button>
                </div>
            </header>

            {/* Filters & Search */}
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1">
                <div className="relative min-w-[160px] flex-1 sm:max-w-[280px]">
                    <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
                    <input
                        type="text"
                        placeholder="Search Symbol, Note or ID..."
                        value={searchTerm}
                        onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                        className={`${INPUT_CLASS} w-full pl-7`}
                    />
                </div>
                <select
                    value={filterStrategy}
                    onChange={(e) => { setFilterStrategy(e.target.value); setCurrentPage(1); }}
                    className={`${INPUT_CLASS} max-w-[180px]`}
                >
                    {strategies.map(s => <option key={s} value={s}>{s === 'ALL' ? 'All Strategies' : getStrategyLabel(s)}</option>)}
                </select>
                <select
                    value={filterSide}
                    onChange={(e) => { setFilterSide(e.target.value); setCurrentPage(1); }}
                    className={INPUT_CLASS}
                >
                    <option value="ALL">All Sides</option>
                    <option value="BUY">BUY / LONG</option>
                    <option value="SELL">SELL / SHORT</option>
                </select>
            </div>

            {/* Table */}
            <div className="min-h-0 flex-1 overflow-auto">
                <table className="w-full border-separate border-spacing-0 whitespace-nowrap text-left text-xs">
                    <thead>
                        <tr>
                            <th className={TH_CLASS}>Time</th>
                            <th className={TH_CLASS}>Symbol</th>
                            <th className={TH_CLASS}>Side</th>
                            <th className={`${TH_CLASS} text-right`}>Price</th>
                            <th className={TH_CLASS}>Strategy</th>
                            <th className={TH_CLASS}>Source</th>
                            <th className={`${TH_CLASS} w-full min-w-[200px]`}>Note</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={7} className="px-3 py-8 text-center text-xs text-muted">
                                    <RefreshCw className="mr-2 inline animate-spin align-[-2px]" size={14} />
                                    Loading database...
                                </td>
                            </tr>
                        ) : filteredSignals.length === 0 ? (
                            <tr>
                                <td colSpan={7} className="px-3 py-8 text-center text-xs text-muted">
                                    No records match your filters.
                                </td>
                            </tr>
                        ) : (
                            paginatedSignals.map((signal, idx) => (
                                <tr key={signal.id || idx} className="hover:bg-surface-secondary">
                                    <td className={`${TD_CLASS} font-mono text-[11px] text-secondary`}>
                                        {new Date(signal.time).toLocaleDateString()} <span className="text-muted">{new Date(signal.time).toLocaleTimeString()}</span>
                                    </td>
                                    <td className={TD_CLASS}>
                                        <span className="font-medium text-text">{signal.symbol}</span>
                                    </td>
                                    <td className={TD_CLASS}>
                                        <span className={`rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase ${signal.side === 'NEUTRAL'
                                            ? 'bg-surface-secondary text-secondary'
                                            : signal.side === 'BUY' || signal.side === 'LONG'
                                                ? 'bg-success-soft text-success'
                                                : 'bg-danger-soft text-danger'
                                            }`}>
                                            {signal.side === 'NEUTRAL' ? 'Yönsüz' : signal.side}
                                        </span>
                                    </td>
                                    <td className={`${TD_CLASS} text-right font-mono text-text`}>
                                        ${signal.price.toFixed(signal.price < 1 ? 5 : 2)}
                                    </td>
                                    <td className={`${TD_CLASS} text-secondary`}>
                                        {getStrategyLabel(signal.strategy)}
                                    </td>
                                    <td className={TD_CLASS}>
                                        <span className={`rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase ${signal.source === 'WEBHOOK' ? 'bg-primary-soft text-primary' :
                                            (signal.source as string | undefined) === 'TEST_BUTTON' ? 'bg-surface-secondary text-secondary' :
                                                'bg-warning-soft text-warning'
                                            }`}>
                                            {signal.source || 'UNKNOWN'}
                                        </span>
                                    </td>
                                    {/* w-full + max-w-0: the note takes the spare width and truncates instead of widening the table */}
                                    <td className={`${TD_CLASS} w-full max-w-0 truncate text-muted`} title={signal.note}>
                                        {signal.note}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Pagination Footer */}
            <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-t border-border px-3 text-[11px]">
                <div className="truncate text-muted">
                    Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, filteredSignals.length)} of {filteredSignals.length} records
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <button
                        disabled={currentPage === 1}
                        onClick={() => handlePageChange(currentPage - 1)}
                        className={PAGE_BUTTON_CLASS}
                    >
                        Previous
                    </button>
                    <div className="flex items-center gap-1">
                        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                            // Simple logic to show window of pages around current
                            let p = i + 1;
                            if (totalPages > 5) {
                                if (currentPage > 3) p = currentPage - 2 + i;
                                if (p > totalPages) p = 1 + (i - (totalPages - currentPage)); // simple fallback, mostly works
                                // Let's just do simple first 5 or simpler text input for massive pages
                            }
                            return null;
                        })}
                        <span className="px-2 font-mono text-text">
                            Page {currentPage} of {totalPages}
                        </span>
                    </div>
                    <button
                        disabled={currentPage === totalPages}
                        onClick={() => handlePageChange(currentPage + 1)}
                        className={PAGE_BUTTON_CLASS}
                    >
                        Next
                    </button>
                </div>
            </div>
        </section>
    );
};
