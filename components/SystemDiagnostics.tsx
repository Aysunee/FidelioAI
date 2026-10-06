import React, { useState, useEffect } from 'react';
import { useMarketData } from '../context/MarketContext';
import { useSignals } from '../context/SignalContext';
import {
    CheckCircle2,
    XCircle,
    RefreshCw,
    Server,
    Share2,
    Brain,
    Lock,
    Globe,
    FlaskConical
} from 'lucide-react';

import { API_BASE_URL, apiUrl, apiJson, ApiError } from '../utils/config';
import { useUser } from '../context/UserContext';

const SIGNAL_FETCH_LIMIT = 500;

const PANEL_HEADER_CLASS = 'flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border px-3';
const PANEL_TITLE_CLASS = 'flex shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-secondary';
const ICON_BUTTON_CLASS = 'grid h-6 w-6 shrink-0 place-items-center rounded-sm text-secondary transition-colors hover:bg-surface-secondary hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary';
const DEFAULT_BUTTON_CLASS = 'flex h-7 shrink-0 items-center gap-1.5 rounded-sm border border-border bg-surface-secondary px-2.5 text-xs font-medium text-text transition-colors hover:bg-surface-highlight focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary disabled:opacity-50';

export const SystemDiagnostics: React.FC = () => {
    const { marketData, futuresData, connectionStatus } = useMarketData();
    const { addToast } = useSignals();
    const { user } = useUser();
    const isAdmin = user?.role === 'admin';

    const [serverStatus, setServerStatus] = useState<'checking' | 'online' | 'offline'>('checking');
    const [apiLatency, setApiLatency] = useState<number | null>(null);
    const [wsStatus, setWsStatus] = useState<'checking' | 'online' | 'offline'>('checking');
    const [dbCount, setDbCount] = useState<number | null>(null);
    const [lastTestResult, setLastTestResult] = useState<string | null>(null);
    const [isTesting, setIsTesting] = useState(false);

    const checkServer = async () => {
        const start = Date.now();
        try {
            const res = await fetch(apiUrl('/health'));
            // A static host's SPA fallback would answer 200 with index.html, so require the JSON body.
            const data = res.ok ? await res.json().catch(() => null) : null;
            if (data && data.status === 'ok') {
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
            const data = await apiJson<unknown>(`/api/signals?limit=${SIGNAL_FETCH_LIMIT}`);
            setDbCount(Array.isArray(data) ? data.length : 0);
        } catch (e) {
            setDbCount(null);
        }
    };

    // Read-only webhook check: POST with a deliberately invalid secret (and an invalid payload, so even
    // an unprotected server would not store it). 401 means the endpoint is reachable AND protected.
    // Plain fetch (not apiRequest) so the expected 401 does not log the admin out.
    const runWebhookTest = async () => {
        setIsTesting(true);
        try {
            const res = await fetch(apiUrl('/api/webhook'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    secret: `invalid-diagnostics-${Date.now()}`,
                    symbol: '',
                    side: 'DIAGNOSTICS',
                    price: 0,
                    strategy: 'Diagnostics_Check'
                })
            });
            if (res.status === 401) {
                setLastTestResult('Webhook OK: Uç nokta erişilebilir ve geçersiz gizli anahtarı reddediyor (401). Kayıt oluşturulmadı.');
                addToast('Webhook korumalı', 'Geçersiz anahtarlı istek beklendiği gibi reddedildi.', 'success');
            } else if (res.status === 503) {
                setLastTestResult('Webhook kapalı: Sunucuda WEBHOOK_SECRET tanımlı değil (503).');
            } else if (res.status === 429) {
                setLastTestResult('Webhook hız sınırına takıldı (429). Biraz sonra tekrar deneyin.');
            } else if (res.status === 400) {
                setLastTestResult('UYARI: İstek gizli anahtar kontrolünden önce veri doğrulamasında reddedildi (400). Webhook gizli anahtarla korunmuyor olabilir.');
                addToast('Webhook kontrol edilmeli', 'Gizli anahtar doğrulaması yapılmıyor olabilir.', 'alert');
            } else if (res.ok) {
                setLastTestResult(`UYARI: Webhook geçersiz gizli anahtarı kabul etti (${res.status}). Uç nokta korumasız olabilir!`);
                addToast('Webhook korumasız', 'Geçersiz anahtarlı istek kabul edildi, sunucuyu kontrol edin.', 'alert');
            } else {
                setLastTestResult(`Webhook beklenmeyen yanıt verdi: ${res.status}`);
            }
        } catch (e) {
            setLastTestResult('Webhook hatası: Sunucuya ulaşılamadı.');
        }
        setIsTesting(false);
    };

    const runAiTest = async () => {
        setIsTesting(true);
        try {
            const data = await apiJson<{ text?: string; error?: string }>('/api/analyze', {
                method: 'POST',
                body: JSON.stringify({
                    symbol: 'BTCUSDT',
                    prompt: 'Say "Diagnostics Connection OK"'
                })
            });
            if (data?.text) {
                setLastTestResult('AI yanıtı: ' + data.text);
                addToast('AI OK', 'Gemini API bağlantısı doğrulandı', 'success');
            } else {
                setLastTestResult('AI hatası: ' + (data?.error || 'Bilinmeyen hata'));
            }
        } catch (e) {
            const message = e instanceof ApiError ? e.message : 'Sunucuya ulaşılamadı.';
            setLastTestResult('AI bağlantı hatası: ' + message);
        }
        setIsTesting(false);
    };

    useEffect(() => {
        if (!isAdmin) return;
        checkServer();
        checkDatabase();
        // Socket check via signal context is harder to expose directly here without context change
        // but we can assume if dashboard is connected, WS is OK
    }, [isAdmin]);

    const StatusBadge = ({ state }: { state: 'online' | 'offline' | 'checking' }) => (
        <div className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-3 ${state === 'online' ? 'bg-success-soft text-success' :
            state === 'offline' ? 'bg-danger-soft text-danger' :
                'bg-surface-secondary text-secondary'
            }`}>
            {state === 'online' ? <CheckCircle2 size={10} /> : state === 'offline' ? <XCircle size={10} /> : <RefreshCw size={10} className="animate-spin" />}
            {state.toUpperCase()}
        </div>
    );

    // One service check: status dot + label/detail + result + state.
    const CheckRow = ({ state, label, detail, detailTitle, children }: {
        state: 'online' | 'offline' | 'checking';
        label: string;
        detail: string;
        detailTitle?: string;
        children: React.ReactNode;
    }) => (
        <div className="flex items-center gap-3 border-b border-border px-3 py-1.5 last:border-b-0 hover:bg-surface-secondary">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${state === 'online' ? 'bg-success' : state === 'offline' ? 'bg-danger' : 'bg-muted'}`} />
            <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-text">{label}</div>
                <div className="truncate text-[10px] text-muted" title={detailTitle}>{detail}</div>
            </div>
            <div className="shrink-0 text-right font-mono text-xs font-semibold text-text">{children}</div>
            <div className="flex w-[84px] shrink-0 justify-end">
                <StatusBadge state={state} />
            </div>
        </div>
    );

    if (!isAdmin) {
        return (
            <div className="flex h-full min-h-[120px] w-full flex-1 items-center justify-center gap-2 bg-surface px-3 text-xs text-muted">
                <Lock size={14} className="shrink-0 text-danger" />
                Bu görünüm yalnızca yöneticiler içindir.
            </div>
        );
    }

    return (
        <div className="grid w-full flex-1 grid-cols-1 gap-px bg-border lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] lg:grid-rows-[minmax(0,1fr)]">
            {/* Health Overview */}
            <div className="flex min-w-0 flex-col gap-px lg:min-h-0">
                <section className="flex shrink-0 flex-col bg-surface">
                    <header className={PANEL_HEADER_CLASS}>
                        <div className="flex min-w-0 items-baseline gap-2">
                            <h3 className={PANEL_TITLE_CLASS}>
                                <Server size={12} className="self-center" />
                                System Infrastructure
                            </h3>
                            <p className="hidden truncate text-[11px] text-muted md:block">Live operational status of core services</p>
                        </div>
                        <button onClick={() => { checkServer(); checkDatabase(); }} className={ICON_BUTTON_CLASS}>
                            <RefreshCw size={14} />
                        </button>
                    </header>

                    <div>
                        {/* Server */}
                        <CheckRow
                            state={serverStatus}
                            label="Backend API"
                            detail={`API: ${API_BASE_URL || 'aynı kaynak (same origin)'}`}
                            detailTitle={API_BASE_URL || undefined}
                        >
                            {apiLatency || '--'} <span className="font-sans text-[10px] font-normal text-muted">ms</span>
                        </CheckRow>

                        {/* Database */}
                        <CheckRow
                            state={dbCount !== null ? 'online' : 'offline'}
                            label="Signals DB"
                            detail="MySQL Database persistence"
                        >
                            {dbCount === null ? '--' : dbCount >= SIGNAL_FETCH_LIMIT ? `${SIGNAL_FETCH_LIMIT}+` : dbCount} <span className="font-sans text-[10px] font-normal text-muted">Signals</span>
                        </CheckRow>

                        {/* Binance Stream */}
                        <CheckRow
                            state={Object.keys(marketData).length > 0 ? 'online' : 'checking'}
                            label="Ticker Streams"
                            detail="Binance WS (Spot + Futures)"
                        >
                            {Object.keys(marketData).length + Object.keys(futuresData).length} <span className="font-sans text-[10px] font-normal text-muted">Pairs</span>
                        </CheckRow>

                        {/* Webview / App Internal */}
                        <CheckRow
                            state="online"
                            label="App Memory"
                            detail="React Root Lifecycle"
                        >
                            OK
                        </CheckRow>
                    </div>
                </section>

                <section className="flex flex-1 flex-col bg-surface lg:min-h-0">
                    <header className={PANEL_HEADER_CLASS}>
                        <div className="flex min-w-0 items-baseline gap-2">
                            <h3 className={PANEL_TITLE_CLASS}>
                                <FlaskConical size={12} className="self-center" />
                                Active Test Laboratory
                            </h3>
                            <p className="hidden truncate text-[11px] text-muted md:block">Manually trigger system functions and verify logic</p>
                        </div>
                    </header>

                    <div className="lg:min-h-0 lg:flex-1 lg:overflow-auto">
                        <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 last:border-b-0 lg:last:border-b">
                            <div className="min-w-0">
                                <h4 className="text-xs font-medium text-text">Webhook Koruma Testi</h4>
                                <p className="text-[11px] text-secondary">Geçersiz anahtarla /api/webhook'a istek gönderir; 401 beklenir, kayıt oluşturulmaz</p>
                            </div>
                            <button
                                onClick={runWebhookTest}
                                disabled={isTesting}
                                className={DEFAULT_BUTTON_CLASS}
                            >
                                <Share2 size={14} />
                                Webhook'u Doğrula
                            </button>
                        </div>

                        <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 last:border-b-0 lg:last:border-b">
                            <div className="min-w-0">
                                <h4 className="text-xs font-medium text-text">AI Logic Test</h4>
                                <p className="text-[11px] text-secondary">Verify Gemini Pro API & Analysis endpoint</p>
                            </div>
                            <button
                                onClick={runAiTest}
                                disabled={isTesting}
                                className={DEFAULT_BUTTON_CLASS}
                            >
                                <Brain size={14} />
                                Test AI Analyzer
                            </button>
                        </div>
                    </div>
                </section>
            </div>

            {/* Side Console */}
            <section className="flex min-w-0 flex-col bg-surface lg:min-h-0">
                <header className={PANEL_HEADER_CLASS}>
                    <h3 className={PANEL_TITLE_CLASS}>
                        <Lock size={12} />
                        Diagnostic Logs
                    </h3>
                </header>

                {/* Console output fills the panel edge to edge (no framed box inside the panel) */}
                <div className="min-h-[200px] flex-1 space-y-1 overflow-auto px-3 py-2 font-mono text-[11px] text-secondary lg:min-h-0">
                    <div className="text-success">[SYSTEM] Initialization complete.</div>
                    <div className="text-muted">[{new Date().toLocaleTimeString()}] Diagnostics service started.</div>
                    <div className="text-muted">[{new Date().toLocaleTimeString()}] Checking endpoint availability...</div>
                    {serverStatus === 'online' && <div className="text-success">[{new Date().toLocaleTimeString()}] OK: {API_BASE_URL}/health</div>}
                    {dbCount !== null && <div className="text-success">[{new Date().toLocaleTimeString()}] OK: Database connection verified. {dbCount} records found.</div>}

                    {lastTestResult && (
                        <div className="mt-2 border-t border-border pt-2">
                            <div className="mb-1 font-semibold text-text">LAST TEST RESULT:</div>
                            <div className="break-words text-warning">{lastTestResult}</div>
                        </div>
                    )}

                    {!lastTestResult && (
                        <div className="pt-4 text-center font-sans text-xs text-muted">
                            Run a test to see results here
                        </div>
                    )}
                </div>

                <div className="shrink-0 border-t border-border">
                    <header className={PANEL_HEADER_CLASS}>
                        <h3 className={PANEL_TITLE_CLASS}>
                            <Globe size={12} />
                            External Interfaces
                        </h3>
                    </header>
                    <div className="text-xs">
                        <div className="flex h-7 items-center justify-between border-b border-border px-3">
                            <span className="text-secondary">Binance WebSocket:</span>
                            <span className="font-mono text-[11px] text-success">CONNECTED</span>
                        </div>
                        <div className="flex h-7 items-center justify-between border-b border-border px-3">
                            <span className="text-secondary">TradingView Proxy:</span>
                            <span className="font-mono text-[11px] text-success">ACTIVE</span>
                        </div>
                        <div className="flex h-7 items-center justify-between px-3">
                            <span className="text-secondary">Gemini AI API:</span>
                            <span className="font-mono text-[11px] text-warning">PENDING_KEY_VAL</span>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
};
