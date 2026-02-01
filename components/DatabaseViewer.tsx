import React, { useState, useEffect } from 'react';
import { Database, RefreshCw, Search, Trash2, Download } from 'lucide-react';
import { Signal } from '../types';

export const DatabaseViewer: React.FC = () => {
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
            const res = await fetch('http://localhost:3001/api/signals');
            if (res.ok) {
                const data = await res.json();
                setSignals(data);
                setServerStatus('online');
            } else {
                setServerStatus('offline');
            }
        } catch (error) {
            console.error('Failed to fetch DB:', error);
            setServerStatus('offline');
        } finally {
            setLoading(false);
        }
    };

    const sendTestSignal = async () => {
        try {
            const res = await fetch('http://localhost:3001/api/webhook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: `test_${Date.now()}`,
                    symbol: 'TEST-USDT',
                    side: 'BUY',
                    price: 12345.67,
                    strategy: 'Manual_Test_Signal',
                    note: 'Database Connectivity Check',
                    source: 'TEST_BUTTON'
                })
            });
            if (res.ok) {
                alert('Test Signal Sent! Refreshing...');
                fetchSignals();
            } else {
                alert('Failed to send signal. Server returned error.');
            }
        } catch (err) {
            alert('Failed to connect to server. Is it running?');
        }
    };

    useEffect(() => {
        fetchSignals();
    }, []);

    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 50;

    // ... (fetch logic remains same)

    useEffect(() => {
        fetchSignals();
    }, []);

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

    return (
        <div className="h-full flex flex-col bg-[#0B0C10] text-gray-300 p-6 overflow-hidden">
            {/* Header */}
            <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-gradient-to-br from-blue-600/20 to-cyan-600/20 rounded-lg border border-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.2)]">
                        <Database size={24} className="text-blue-400" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">Database Viewer</h1>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full border ${serverStatus === 'online' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' :
                                    serverStatus === 'offline' ? 'bg-rose-500/10 text-rose-400 border-rose-500/30' :
                                        'bg-gray-500/10 text-gray-400 border-gray-500/30'
                                }`}>
                                {serverStatus === 'online' ? 'CONNECTED' : serverStatus === 'offline' ? 'DISCONNECTED' : 'CHECKING...'}
                            </span>
                        </div>
                        <p className="text-xs text-gray-500">
                            {signals.length.toLocaleString()} records stored • {filteredSignals.length.toLocaleString()} filtering match
                        </p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={sendTestSignal}
                        className="flex items-center gap-2 px-3 py-1.5 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 rounded-lg transition-colors text-xs font-medium border border-purple-500/20"
                    >
                        ⚡ Test Signal
                    </button>
                    <button
                        onClick={downloadJSON}
                        className="flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg transition-colors text-xs font-medium border border-white/10"
                    >
                        <Download size={14} />
                        Export
                    </button>
                    <button
                        onClick={fetchSignals}
                        className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded-lg transition-colors text-xs font-medium border border-blue-500/20"
                    >
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                        Refresh
                    </button>
                </div>
            </div>

            {/* Filters & Search */}
            <div className="mb-4 flex gap-4 backdrop-blur-xl bg-white/5 p-3 rounded-xl border border-white/10">
                <div className="relative flex-1">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                        type="text"
                        placeholder="Search Symbol, Note or ID..."
                        value={searchTerm}
                        onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                        className="w-full bg-black/40 border border-white/10 rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-blue-500/50 transition-colors text-gray-200 placeholder-gray-600"
                    />
                </div>
                <div className="h-full w-px bg-white/10 mx-2"></div>
                <select
                    value={filterStrategy}
                    onChange={(e) => { setFilterStrategy(e.target.value); setCurrentPage(1); }}
                    className="bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-blue-500/50 transition-colors text-gray-300 min-w-[160px]"
                >
                    {strategies.map(s => <option key={s} value={s}>{s === 'ALL' ? 'All Strategies' : s}</option>)}
                </select>
                <select
                    value={filterSide}
                    onChange={(e) => { setFilterSide(e.target.value); setCurrentPage(1); }}
                    className="bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-blue-500/50 transition-colors text-gray-300 min-w-[120px]"
                >
                    <option value="ALL">All Sides</option>
                    <option value="BUY">BUY / LONG</option>
                    <option value="SELL">SELL / SHORT</option>
                </select>
            </div>

            {/* Table Container */}
            <div className="flex-1 overflow-hidden border border-white/10 rounded-xl bg-black/20 flex flex-col">
                <div className="overflow-auto flex-1 custom-scrollbar">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead className="bg-[#16181D] sticky top-0 z-10 shadow-sm">
                            <tr>
                                <th className="p-3 pl-4 font-mono text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Time</th>
                                <th className="p-3 font-mono text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Symbol</th>
                                <th className="p-3 font-mono text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Side</th>
                                <th className="p-3 font-mono text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Price</th>
                                <th className="p-3 font-mono text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Strategy</th>
                                <th className="p-3 font-mono text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Source</th>
                                <th className="p-3 font-mono text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Note</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {loading ? (
                                <tr>
                                    <td colSpan={7} className="p-20 text-center text-gray-500">
                                        <RefreshCw className="animate-spin mx-auto mb-2 opacity-50" size={24} />
                                        Loading database...
                                    </td>
                                </tr>
                            ) : filteredSignals.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="p-20 text-center text-gray-500">
                                        No records match your filters.
                                    </td>
                                </tr>
                            ) : (
                                paginatedSignals.map((signal, idx) => (
                                    <tr key={signal.id || idx} className="hover:bg-white/5 transition-colors group">
                                        <td className="p-3 pl-4 text-gray-400 text-xs font-mono">
                                            {new Date(signal.time).toLocaleDateString()} <span className="text-gray-600">{new Date(signal.time).toLocaleTimeString()}</span>
                                        </td>
                                        <td className="p-3">
                                            <span className="font-bold text-gray-200">{signal.symbol}</span>
                                        </td>
                                        <td className="p-3">
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${signal.side === 'BUY' || signal.side === 'LONG'
                                                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                                    : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                                                }`}>
                                                {signal.side}
                                            </span>
                                        </td>
                                        <td className="p-3 font-mono text-gray-300">
                                            ${signal.price.toFixed(signal.price < 1 ? 5 : 2)}
                                        </td>
                                        <td className="p-3">
                                            <span className="text-blue-300 text-xs">{signal.strategy}</span>
                                        </td>
                                        <td className="p-3">
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${signal.source === 'WEBHOOK' ? 'border-purple-500/30 text-purple-400' :
                                                    signal.source === 'TEST_BUTTON' ? 'border-gray-500/30 text-gray-500' :
                                                        'border-amber-500/30 text-amber-400'
                                                }`}>
                                                {signal.source || 'UNKNOWN'}
                                            </span>
                                        </td>
                                        <td className="p-3 max-w-[300px] truncate text-gray-500 text-xs" title={signal.note}>
                                            {signal.note}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination Footer */}
                <div className="border-t border-white/10 p-3 bg-[#111216] flex items-center justify-between text-xs">
                    <div className="text-gray-500">
                        Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, filteredSignals.length)} of {filteredSignals.length} records
                    </div>
                    <div className="flex gap-2">
                        <button
                            disabled={currentPage === 1}
                            onClick={() => handlePageChange(currentPage - 1)}
                            className="px-3 py-1 rounded bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
                            <span className="px-3 py-1 rounded bg-blue-600/20 text-blue-400 font-bold border border-blue-600/30">
                                Page {currentPage} of {totalPages}
                            </span>
                        </div>
                        <button
                            disabled={currentPage === totalPages}
                            onClick={() => handlePageChange(currentPage + 1)}
                            className="px-3 py-1 rounded bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            Next
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
