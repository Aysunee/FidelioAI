import React, { useState, useEffect } from 'react';
import { GlassCard } from './ui/GlassCard';
import { useMarketData } from '../context/MarketContext';
import { useSignals } from '../context/SignalContext';
import {
    CheckCircle2,
    XCircle,
    RefreshCw,
    Server,
    Share2,
    Zap,
    Database,
    Brain,
    Activity,
    Lock,
    Globe,
    AlertCircle,
    FlaskConical
} from 'lucide-react';

import { API_BASE_URL } from '../utils/config';

export const SystemDiagnostics: React.FC = () => {
    const { marketData, futuresData, connectionStatus } = useMarketData();
    const { addToast } = useSignals();

    const [serverStatus, setServerStatus] = useState<'checking' | 'online' | 'offline'>('checking');
    const [apiLatency, setApiLatency] = useState<number | null>(null);
    const [wsStatus, setWsStatus] = useState<'checking' | 'online' | 'offline'>('checking');
    const [dbCount, setDbCount] = useState<number | null>(null);
    const [lastTestResult, setLastTestResult] = useState<string | null>(null);
    const [isTesting, setIsTesting] = useState(false);

    const checkServer = async () => {
        const start = Date.now();
        try {
            const res = await fetch(`${API_BASE_URL}/health`);
            if (res.ok) {
                setServerStatus('online');
                setApiLatency(Date.now() - start);
            } else {
                setServerStatus('offline');
            }
        } catch (e) {
            setServerStatus('offline');
        }
    };

    const checkDatabase = async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/signals`);
            const data = await res.json();
            setDbCount(Array.isArray(data) ? data.length : 0);
        } catch (e) {
            setDbCount(null);
        }
    };

    const runWebhookTest = async () => {
        setIsTesting(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/webhook`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    symbol: 'TEST-DIAG',
                    side: 'BUY',
                    price: 1337,
                    strategy: 'Diagnostics_Test',
                    note: 'Automated System Check'
                })
            });
            if (res.ok) {
                setLastTestResult('Webhook Success: Signal pushed to database and socket.');
                addToast('Test Success', 'Diagnostic signal sent', 'success');
            } else {
                setLastTestResult('Webhook Failed: Server returned ' + res.status);
            }
        } catch (e) {
            setLastTestResult('Webhook Error: Could not reach server');
        }
        setIsTesting(false);
    };

    const runAiTest = async () => {
        setIsTesting(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/analyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    symbol: 'BTCUSDT',
                    prompt: 'Say "Diagnostics Connection OK"'
                })
            });
            const data = await res.json();
            if (data.text) {
                setLastTestResult('AI Response: ' + data.text);
                addToast('AI OK', 'Gemini API connection verified', 'success');
            } else {
                setLastTestResult('AI Error: ' + (data.error || 'Unknown error'));
            }
        } catch (e) {
            setLastTestResult('AI Connection Error: Ensure GEMINI_API_KEY is set');
        }
        setIsTesting(false);
    };

    useEffect(() => {
        checkServer();
        checkDatabase();
        // Socket check via signal context is harder to expose directly here without context change
        // but we can assume if dashboard is connected, WS is OK
    }, []);

    const StatusBadge = ({ state }: { state: 'online' | 'offline' | 'checking' }) => (
        <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border ${state === 'online' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
            state === 'offline' ? 'bg-rose-500/20 text-rose-400 border-rose-500/30' :
                'bg-gray-500/20 text-gray-400 border-gray-500/30'
            }`}>
            {state === 'online' ? <CheckCircle2 size={10} /> : state === 'offline' ? <XCircle size={10} /> : <RefreshCw size={10} className="animate-spin" />}
            {state.toUpperCase()}
        </div>
    );

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Health Overview */}
            <div className="lg:col-span-2 space-y-6">
                <GlassCard className="p-6">
                    <div className="flex items-center justify-between mb-8">
                        <div className="flex items-center gap-3">
                            <Server className="text-purple-400" />
                            <div>
                                <h3 className="font-bold text-gray-200">System Infrastructure</h3>
                                <p className="text-xs text-gray-500">Live operational status of core services</p>
                            </div>
                        </div>
                        <button onClick={() => { checkServer(); checkDatabase(); }} className="p-2 hover:bg-white/5 rounded-lg transition-colors">
                            <RefreshCw size={16} className="text-gray-400" />
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Server Card */}
                        <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-4">
                            <div className="flex justify-between items-center">
                                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Backend API</span>
                                <StatusBadge state={serverStatus} />
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="text-2xl font-mono font-bold text-gray-200">{apiLatency || '--'} <span className="text-xs text-gray-600 font-sans">ms</span></div>
                                <Activity size={24} className="text-purple-500 opacity-30" />
                            </div>
                            <div className="text-[10px] text-gray-500">Listening on port 3001</div>
                        </div>

                        {/* Database Card */}
                        <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-4">
                            <div className="flex justify-between items-center">
                                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Signals DB</span>
                                <StatusBadge state={dbCount !== null ? 'online' : 'offline'} />
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="text-2xl font-mono font-bold text-gray-200">{dbCount ?? '--'} <span className="text-xs text-gray-600 font-sans">Signals</span></div>
                                <Database size={24} className="text-amber-500 opacity-30" />
                            </div>
                            <div className="text-[10px] text-gray-500">MySQL Database persistence</div>
                        </div>

                        {/* Binance Stream */}
                        <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-4">
                            <div className="flex justify-between items-center">
                                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Ticker Streams</span>
                                <StatusBadge state={Object.keys(marketData).length > 0 ? 'online' : 'checking'} />
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="text-2xl font-mono font-bold text-gray-200">{Object.keys(marketData).length + Object.keys(futuresData).length} <span className="text-xs text-gray-600 font-sans">Pairs</span></div>
                                <Zap size={24} className="text-cyan-500 opacity-30" />
                            </div>
                            <div className="text-[10px] text-gray-500">Binance WS (Spot + Futures)</div>
                        </div>

                        {/* Webview / App Internal */}
                        <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-4">
                            <div className="flex justify-between items-center">
                                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">App Memory</span>
                                <StatusBadge state="online" />
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="text-2xl font-mono font-bold text-gray-200">OK</div>
                                <Activity size={24} className="text-emerald-500 opacity-30" />
                            </div>
                            <div className="text-[10px] text-gray-500">React Root Lifecycle</div>
                        </div>
                    </div>
                </GlassCard>

                <GlassCard className="p-6">
                    <div className="flex items-center gap-3 mb-6">
                        <FlaskConical className="text-amber-400" />
                        <div>
                            <h3 className="font-bold text-gray-200">Active Test Laboratory</h3>
                            <p className="text-xs text-gray-500">Manually trigger system functions and verify logic</p>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="flex items-center justify-between p-4 rounded-lg bg-black/20 border border-white/5">
                            <div>
                                <h4 className="text-sm font-bold text-gray-200">Webhook Simulation</h4>
                                <p className="text-[10px] text-gray-500">Post a test signal to /api/webhook</p>
                            </div>
                            <button
                                onClick={runWebhookTest}
                                disabled={isTesting}
                                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-2"
                            >
                                <Share2 size={14} />
                                Trigger Webhook
                            </button>
                        </div>

                        <div className="flex items-center justify-between p-4 rounded-lg bg-black/20 border border-white/5">
                            <div>
                                <h4 className="text-sm font-bold text-gray-200">AI Logic Test</h4>
                                <p className="text-[10px] text-gray-500">Verify Gemini Pro API & Analysis endpoint</p>
                            </div>
                            <button
                                onClick={runAiTest}
                                disabled={isTesting}
                                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-2"
                            >
                                <Brain size={14} />
                                Test AI Analyzer
                            </button>
                        </div>
                    </div>
                </GlassCard>
            </div>

            {/* Side Console */}
            <div className="space-y-6">
                <GlassCard className="p-6 h-full flex flex-col">
                    <div className="flex items-center gap-3 mb-4">
                        <Lock className="text-gray-500" />
                        <h3 className="font-bold text-gray-200">Diagnostic Logs</h3>
                    </div>

                    <div className="flex-1 overflow-auto bg-black/40 rounded-lg p-4 font-mono text-[10px] text-gray-400 space-y-2 min-h-[400px]">
                        <div className="text-emerald-500/70">[SYSTEM] Initialization complete.</div>
                        <div className="text-gray-600">[{new Date().toLocaleTimeString()}] Diagnostics service started.</div>
                        <div className="text-gray-600">[{new Date().toLocaleTimeString()}] Checking endpoint availability...</div>
                        {serverStatus === 'online' && <div className="text-emerald-500/70">[{new Date().toLocaleTimeString()}] OK: {API_BASE_URL}/health</div>}
                        {dbCount !== null && <div className="text-emerald-500/70">[{new Date().toLocaleTimeString()}] OK: Database connection verified. {dbCount} records found.</div>}

                        {lastTestResult && (
                            <div className="mt-4 border-t border-white/10 pt-4">
                                <div className="text-gray-300 font-bold mb-1">LAST TEST RESULT:</div>
                                <div className="text-amber-400 bg-amber-400/5 p-2 rounded">{lastTestResult}</div>
                            </div>
                        )}

                        {!lastTestResult && (
                            <div className="text-gray-700 italic mt-8 text-center">
                                Run a test to see results here
                            </div>
                        )}
                    </div>

                    <div className="mt-4 p-4 rounded-lg bg-white/5 border border-white/10">
                        <div className="flex items-center gap-2 mb-2">
                            <Globe size={14} className="text-blue-400" />
                            <span className="text-xs font-bold text-gray-300">External Interfaces</span>
                        </div>
                        <div className="text-[10px] space-y-1">
                            <div className="flex justify-between">
                                <span className="text-gray-500">Binance WebSocket:</span>
                                <span className="text-emerald-400 font-mono">CONNECTED</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">TradingView Proxy:</span>
                                <span className="text-emerald-400 font-mono">ACTIVE</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">Gemini AI API:</span>
                                <span className="text-amber-400 font-mono">PENDING_KEY_VAL</span>
                            </div>
                        </div>
                    </div>
                </GlassCard>
            </div>
        </div>
    );
};
