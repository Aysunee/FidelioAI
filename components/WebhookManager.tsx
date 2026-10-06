import React, { useState, useEffect } from 'react';
import { Side } from '../types';
import { Copy, Check, Play, ShieldAlert, AlertTriangle, Zap, Activity, CheckCircle2, XCircle, Loader2, Send, Sparkles, Code, QrCode, TrendingUp, TrendingDown, BarChart3, Layers, Clock, Radio, KeyRound, Eye, EyeOff } from 'lucide-react';
import { useSignals, getStrategyLabel } from '../context/SignalContext';
import { useUser } from '../context/UserContext';
import { apiUrl, apiJson, ApiError } from '../utils/config';

// The admin enters the TradingView webhook secret (same value as the server's WEBHOOK_SECRET env var).
// It is kept only in this browser and used to build TradingView templates / test calls.
const WEBHOOK_SECRET_KEY = 'fidelio_webhook_secret';
const SECRET_PLACEHOLDER = 'WEBHOOK_SECRET_BURAYA';

const readStoredSecret = (): string => {
    if (typeof window === 'undefined') return '';
    try {
        return localStorage.getItem(WEBHOOK_SECRET_KEY) || '';
    } catch {
        return '';
    }
};

const storeSecret = (value: string) => {
    if (typeof window === 'undefined') return;
    try {
        if (value) localStorage.setItem(WEBHOOK_SECRET_KEY, value);
        else localStorage.removeItem(WEBHOOK_SECRET_KEY);
    } catch { /* storage unavailable */ }
};

// Public URL that TradingView must call. In production the API is either on VITE_API_URL
// (absolute) or served from the same origin as the frontend (relative -> prefix with origin).
const getPublicWebhookUrl = (): string => {
    const url = apiUrl('/api/webhook');
    if (/^https?:\/\//i.test(url)) return url;
    if (typeof window !== 'undefined') return `${window.location.origin}${url}`;
    return url;
};

// TradingView only delivers webhooks to public hosts on port 80/443.
const isLikelyUnreachableForTradingView = (url: string): boolean => {
    try {
        const parsed = new URL(url);
        const host = parsed.hostname;
        const privateHost = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' ||
            /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
        const nonStandardPort = parsed.port !== '' && parsed.port !== '80' && parsed.port !== '443';
        return privateHost || nonStandardPort;
    } catch {
        return true;
    }
};

// Preset Templates
const WEBHOOK_TEMPLATES = [
    {
        id: 'breakout',
        name: 'Price Breakout',
        icon: TrendingUp,
        description: 'Trigger when price breaks resistance',
        condition: 'close > high[1]',
        message: {
            symbol: '{{ticker}}',
            side: 'BUY',
            price: '{{close}}',
            strategy: 'Breakout_Alert'
        }
    },
    {
        id: 'breakdown',
        name: 'Price Breakdown',
        icon: TrendingDown,
        description: 'Trigger when price breaks support',
        condition: 'close < low[1]',
        message: {
            symbol: '{{ticker}}',
            side: 'SELL',
            price: '{{close}}',
            strategy: 'Breakdown_Alert'
        }
    },
    {
        id: 'volume_spike',
        name: 'Volume Spike',
        icon: BarChart3,
        description: 'High volume anomaly detected',
        condition: 'volume > volume[1] * 2',
        message: {
            symbol: '{{ticker}}',
            side: 'BUY',
            price: '{{close}}',
            strategy: 'Volume_Spike'
        }
    },
    {
        id: 'rsi_oversold',
        name: 'RSI Oversold',
        icon: Layers,
        description: 'RSI below 30 - potential reversal',
        condition: 'rsi(14) < 30',
        message: {
            symbol: '{{ticker}}',
            side: 'LONG',
            price: '{{close}}',
            strategy: 'RSI_Oversold'
        }
    }
];

const INPUT_CLASS = 'h-7 rounded-sm border border-border bg-surface-secondary px-2 text-xs text-text placeholder:text-muted outline-none focus:border-primary';
const LABEL_CLASS = 'mb-1 block text-[11px] text-secondary';
const ICON_BUTTON_CLASS = 'grid h-7 w-7 shrink-0 place-items-center rounded-sm text-secondary transition-colors hover:bg-surface-secondary hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary';
const DEFAULT_BUTTON_CLASS = 'h-7 rounded-sm border border-border bg-surface-secondary px-2.5 text-xs font-medium text-text transition-colors hover:bg-surface-highlight focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary';
const PANEL_HEADER_CLASS = 'flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border px-3';
const PANEL_TITLE_CLASS = 'text-[11px] font-semibold uppercase tracking-wider text-secondary';
const FIELD_TITLE_CLASS = 'text-[10px] font-medium uppercase tracking-wider text-muted';
const CODE_BLOCK_CLASS = 'rounded-sm border border-border bg-surface-secondary p-2 font-mono text-[11px]';
// Shared by the header and rows of the recent-signals table so every column lines up.
const RECENT_COLS = 'minmax(52px,0.9fr) 46px minmax(0,1.3fr) minmax(68px,1fr) 58px';

export const WebhookManager: React.FC = () => {
    const { signals, addToast } = useSignals();
    const { user } = useUser();
    const isAdmin = user?.role === 'admin';
    const [activeTab, setActiveTab] = useState<'templates' | 'custom' | 'manual'>('templates');
    const [copied, setCopied] = useState(false);
    const [serverStatus, setServerStatus] = useState<'CHECKING' | 'ONLINE' | 'OFFLINE'>('CHECKING');
    const [testing, setTesting] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
    const [showQR, setShowQR] = useState(false);

    // Filter only webhook signals
    const recentWebhookSignals = signals.filter(s => s.source === 'WEBHOOK').slice(0, 5);

    // Public webhook URL + admin-provided secret
    const webhookUrl = getPublicWebhookUrl();
    const webhookUrlWarning = isLikelyUnreachableForTradingView(webhookUrl);
    const [secretInput, setSecretInput] = useState<string>(readStoredSecret);
    const [showSecret, setShowSecret] = useState(false);
    const [injecting, setInjecting] = useState(false);
    // Pasted secrets often carry trailing whitespace/newlines; never send those.
    const secret = secretInput.trim();

    const handleSecretChange = (value: string) => {
        setSecretInput(value);
        storeSecret(value.trim());
    };

    // Custom Builder State
    const [customSymbol, setCustomSymbol] = useState('{{ticker}}');
    const [customSide, setCustomSide] = useState<'BUY' | 'SELL' | 'LONG' | 'SHORT'>('BUY');
    const [customStrategy, setCustomStrategy] = useState('Custom_Alert');
    const [customCondition, setCustomCondition] = useState('');

    // Manual Form State
    const [manualSymbol, setManualSymbol] = useState('');
    const [manualSide, setManualSide] = useState<Side>('BUY');
    const [manualPrice, setManualPrice] = useState('');
    const [manualStrategy, setManualStrategy] = useState('Manual_Override');

    // Check server status on mount
    useEffect(() => {
        if (!isAdmin) return;
        checkServerStatus();
        const interval = setInterval(checkServerStatus, 10000);
        return () => clearInterval(interval);
    }, [isAdmin]);

    const checkServerStatus = async () => {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 3000);
            const response = await fetch(apiUrl('/health'), {
                method: 'GET',
                signal: controller.signal
            });
            clearTimeout(timer);
            setServerStatus(response.ok ? 'ONLINE' : 'OFFLINE');
        } catch (e) {
            setServerStatus('OFFLINE');
        }
    };

    // Non-destructive check, two requests, both with a deliberately invalid payload so nothing is
    // ever stored or broadcast:
    //  1) wrong secret  -> must be 401 (proves the server checks the secret before validating data)
    //  2) real secret   -> 400 means the secret was accepted and only the dummy payload was rejected.
    // Plain fetch (not apiRequest) so a 401 from the webhook never logs the admin out.
    const postWebhookProbe = (probeSecret: string) => fetch(apiUrl('/api/webhook'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            secret: probeSecret,
            symbol: '',
            side: 'CONNECTION_TEST',
            price: 0,
            strategy: 'Webhook_Connection_Test'
        })
    });

    const testWebhook = async () => {
        if (!secret) {
            addToast('Gizli anahtar gerekli', 'Test için önce webhook gizli anahtarını girin.', 'alert');
            return;
        }
        setTesting(true);
        try {
            const control = await postWebhookProbe(`invalid-${Date.now()}`);
            setServerStatus('ONLINE');
            if (control.status === 503) {
                addToast('Webhook kapalı', 'Sunucuda WEBHOOK_SECRET ortam değişkeni tanımlı değil.', 'alert');
                return;
            }
            if (control.status === 429) {
                addToast('Çok fazla istek', 'Webhook hız sınırına takıldı, biraz sonra tekrar deneyin.', 'alert');
                return;
            }
            if (control.status !== 401) {
                addToast('Webhook korumasız olabilir', `Hatalı anahtarlı istek 401 yerine ${control.status} döndürdü; gizli anahtar doğrulanamadı.`, 'alert');
                return;
            }

            const response = await postWebhookProbe(secret);
            if (response.status === 400) {
                addToast('Webhook hazır', 'Sunucuya ulaşıldı ve gizli anahtar doğrulandı. Test verisi bilerek geçersiz gönderildi; kayıt oluşturulmadı.', 'success');
            } else if (response.status === 401) {
                addToast('Gizli anahtar hatalı', 'Sunucu gizli anahtarı reddetti. Sunucudaki WEBHOOK_SECRET ile aynı değeri girin.', 'alert');
            } else if (response.status === 429) {
                addToast('Çok fazla istek', 'Webhook hız sınırına takıldı, biraz sonra tekrar deneyin.', 'alert');
            } else {
                addToast('Beklenmeyen yanıt', `Sunucu ${response.status} durum kodu döndürdü.`, 'alert');
            }
        } catch (e) {
            addToast('Bağlantı hatası', 'Webhook sunucusuna ulaşılamadı.', 'alert');
            setServerStatus('OFFLINE');
        } finally {
            setTesting(false);
        }
    };

    const copyToClipboard = async (text: string) => {
        try {
            if (typeof navigator === 'undefined' || !navigator.clipboard) throw new Error('clipboard unavailable');
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            addToast('Kopyalanamadı', 'Tarayıcı panoya erişime izin vermedi; metni elle seçip kopyalayın.', 'alert');
        }
    };

    // Manual injection goes through the admin-only REST endpoint; the signal reaches the
    // dashboard via the server's socket 'new_signal' echo (no local insert here).
    const handleInject = async (e: React.FormEvent) => {
        e.preventDefault();
        const rawSymbol = manualSymbol.trim().toUpperCase();
        const price = Number(manualPrice.trim().replace(',', '.'));
        if (!rawSymbol) {
            addToast('Eksik bilgi', 'Lütfen bir sembol girin.', 'alert');
            return;
        }
        if (!Number.isFinite(price) || price <= 0) {
            addToast('Geçersiz fiyat', 'Fiyat sıfırdan büyük bir sayı olmalı.', 'alert');
            return;
        }
        const symbol = rawSymbol.includes('USDT') ? rawSymbol : `${rawSymbol}USDT`;
        const strategy = manualStrategy.trim() || 'Manual_Override';

        if (typeof window !== 'undefined' && !window.confirm(
            `${symbol} ${manualSide} @ ${price} sinyali veritabanına kaydedilecek ve TÜM kullanıcılara canlı olarak yayınlanacak. Devam edilsin mi?`
        )) return;

        setInjecting(true);
        try {
            await apiJson('/api/signals', {
                method: 'POST',
                body: JSON.stringify({
                    symbol,
                    side: manualSide,
                    price,
                    strategy,
                    note: 'Signal Hub üzerinden manuel eklendi',
                    source: 'MANUAL',
                    confidence: 0.99
                })
            });
            addToast('Sinyal gönderildi', `${symbol} ${manualSide} sinyali sunucuya kaydedildi.`, 'success');
            setManualSymbol('');
            setManualPrice('');
        } catch (err) {
            const message = err instanceof ApiError ? err.message : 'Sunucuya ulaşılamadı.';
            addToast('Sinyal gönderilemedi', message, 'alert');
        } finally {
            setInjecting(false);
        }
    };

    // `reveal` = include the real secret (for copying). The on-screen preview masks it.
    const secretForTemplate = (reveal: boolean) =>
        secret ? (reveal ? secret : '•'.repeat(Math.min(secret.length, 12))) : SECRET_PLACEHOLDER;

    const generateTemplateJSON = (templateId: string, reveal = false) => {
        const template = WEBHOOK_TEMPLATES.find(t => t.id === templateId);
        if (!template) return '';

        return JSON.stringify({
            secret: secretForTemplate(reveal),
            ...template.message
        }, null, 2);
    };

    const generateCustomJSON = (reveal = false) => {
        return JSON.stringify({
            secret: secretForTemplate(reveal),
            symbol: customSymbol,
            side: customSide,
            price: '{{close}}',
            strategy: customStrategy
        }, null, 2);
    };

    const generateQRCode = (data: string) => {
        return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data)}`;
    };

    const StatusBadge = () => {
        if (serverStatus === 'CHECKING') {
            return (
                <div className="flex items-center gap-1.5 text-secondary">
                    <Loader2 size={12} className="animate-spin" />
                    <span className="text-[11px] font-medium">Checking...</span>
                </div>
            );
        }
        if (serverStatus === 'ONLINE') {
            return (
                <div className="flex items-center gap-1.5 text-success">
                    <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse"></span>
                    <span className="text-[11px] font-semibold">ONLINE</span>
                </div>
            );
        }
        return (
            <div className="flex items-center gap-1.5 text-danger">
                <XCircle size={12} />
                <span className="text-[11px] font-semibold">OFFLINE</span>
            </div>
        );
    };

    if (!isAdmin) {
        return (
            <div className="flex h-full min-h-[120px] w-full flex-1 items-center justify-center gap-2 bg-surface px-3 text-xs text-muted">
                <ShieldAlert size={14} className="shrink-0 text-danger" />
                Bu görünüm yalnızca yöneticiler içindir.
            </div>
        );
    }

    const tabClass = (active: boolean) =>
        `flex items-center gap-1.5 border-b-2 px-3 text-[11px] font-medium uppercase tracking-wider transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary ${active
            ? 'border-primary text-text'
            : 'border-transparent text-secondary hover:text-text'
        }`;

    return (
        <div className="flex w-full flex-1 flex-col gap-px bg-border lg:h-full lg:min-h-0">
            {/* Header */}
            <header className="flex h-8 shrink-0 items-center justify-between gap-3 bg-surface px-3">
                <div className="flex min-w-0 items-baseline gap-2">
                    <h1 className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-secondary">
                        Webhook Creator Studio
                    </h1>
                    <p className="hidden truncate text-[11px] text-muted md:block">Build, test, and deploy custom trading alerts</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <div className="hidden text-[10px] uppercase tracking-wider text-muted sm:block">Server Status</div>
                    <StatusBadge />
                </div>
            </header>

            {/* Webhook Secret + Public URL */}
            <div className="grid shrink-0 grid-cols-1 gap-px lg:grid-cols-2">
                <div className="min-w-0 bg-surface px-3 py-2">
                    <label htmlFor="webhook-secret" className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-secondary">
                        <KeyRound size={12} />
                        Webhook gizli anahtarı
                    </label>
                    <div className="flex items-center gap-1">
                        <input
                            id="webhook-secret"
                            type={showSecret ? 'text' : 'password'}
                            value={secretInput}
                            onChange={e => handleSecretChange(e.target.value)}
                            placeholder="Sunucudaki WEBHOOK_SECRET değeri"
                            autoComplete="off"
                            spellCheck={false}
                            className={`${INPUT_CLASS} min-w-0 flex-1 font-mono`}
                        />
                        <button
                            type="button"
                            onClick={() => setShowSecret(v => !v)}
                            className={ICON_BUTTON_CLASS}
                            title={showSecret ? 'Gizle' : 'Göster'}
                        >
                            {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                    </div>
                    <p className="mt-1 text-[10px] text-muted">
                        Yalnızca bu tarayıcıda saklanır; TradingView mesaj şablonlarına eklenir. Sunucudaki WEBHOOK_SECRET ile birebir aynı olmalı.
                    </p>
                    {!secret && (
                        <p className="mt-1 flex items-center gap-1 text-[10px] text-warning">
                            <ShieldAlert size={10} className="shrink-0" />
                            Gizli anahtar girilmeden oluşturulan şablonlar sunucu tarafından reddedilir (401).
                        </p>
                    )}
                </div>
                <div className="min-w-0 bg-surface px-3 py-2">
                    <div className="mb-1 text-[11px] font-medium text-secondary">TradingView webhook adresi</div>
                    <div className="flex items-center gap-1">
                        <code className="flex min-h-[28px] min-w-0 flex-1 items-center break-all rounded-sm border border-border bg-surface-secondary px-2 py-1 font-mono text-[11px] text-primary">
                            {webhookUrl}
                        </code>
                        <button
                            type="button"
                            onClick={() => copyToClipboard(webhookUrl)}
                            className={ICON_BUTTON_CLASS}
                            title="Kopyala"
                        >
                            {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                        </button>
                    </div>
                    {webhookUrlWarning && (
                        <p className="mt-1 flex items-start gap-1 text-[10px] text-warning">
                            <AlertTriangle size={10} className="mt-0.5 shrink-0" />
                            Bu adres dışarıdan erişilebilir görünmüyor. TradingView yalnızca 80/443 portundaki genel (tercihen HTTPS) adreslere istek gönderir.
                        </p>
                    )}
                </div>
            </div>

            <div className="grid flex-1 grid-cols-1 gap-px lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[minmax(0,1fr)]">
                {/* Builder */}
                <div className="flex min-w-0 flex-col gap-px lg:min-h-0">
                    {/* Tabs */}
                    <div className="flex h-8 shrink-0 items-stretch overflow-x-auto bg-surface px-1">
                        <button onClick={() => setActiveTab('templates')} className={tabClass(activeTab === 'templates')}>
                            <Layers size={12} className="shrink-0" />
                            <span className="whitespace-nowrap">Templates</span>
                        </button>
                        <button onClick={() => setActiveTab('custom')} className={tabClass(activeTab === 'custom')}>
                            <Code size={12} className="shrink-0" />
                            <span className="whitespace-nowrap">Custom Builder</span>
                        </button>
                        <button onClick={() => setActiveTab('manual')} className={tabClass(activeTab === 'manual')}>
                            <Play size={12} className="shrink-0" />
                            <span className="whitespace-nowrap">Manual Test</span>
                        </button>
                    </div>

                    {/* Templates Tab */}
                    {activeTab === 'templates' && (
                        <div className="grid flex-1 grid-cols-1 gap-px lg:min-h-0 lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)]">
                            {/* Template list */}
                            <section className="flex min-w-0 flex-col bg-surface lg:min-h-0">
                                <header className={PANEL_HEADER_CLASS}>
                                    <h3 className={PANEL_TITLE_CLASS}>Preset Templates</h3>
                                </header>
                                <div className="lg:min-h-0 lg:flex-1 lg:overflow-auto">
                                    {WEBHOOK_TEMPLATES.map(template => {
                                        const Icon = template.icon;
                                        const isSelected = selectedTemplate === template.id;
                                        return (
                                            <div
                                                key={template.id}
                                                onClick={() => setSelectedTemplate(template.id)}
                                                className={`flex cursor-pointer items-start gap-2 border-b border-border px-3 py-2 transition-colors last:border-b-0 lg:last:border-b ${isSelected
                                                    ? 'bg-surface-highlight shadow-[inset_2px_0_0_var(--color-brand)]'
                                                    : 'hover:bg-surface-secondary'
                                                    }`}
                                            >
                                                <Icon size={14} className={`mt-0.5 shrink-0 ${isSelected ? 'text-primary' : 'text-secondary'}`} />
                                                <div className="min-w-0 flex-1">
                                                    <h4 className="text-xs font-medium text-text">{template.name}</h4>
                                                    <p className="text-[11px] text-secondary">{template.description}</p>
                                                    <code className="mt-0.5 block truncate font-mono text-[10px] text-muted">
                                                        {template.condition}
                                                    </code>
                                                </div>
                                                {isSelected && (
                                                    <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-primary" />
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>

                            {/* Generated Code */}
                            <section className="flex min-w-0 flex-col bg-surface lg:min-h-0">
                                <header className={PANEL_HEADER_CLASS}>
                                    <h3 className={PANEL_TITLE_CLASS}>Generated Alert Code</h3>
                                </header>
                                {selectedTemplate ? (
                                    <div className="lg:min-h-0 lg:flex-1 lg:overflow-auto">
                                        <div className="border-b border-border px-3 pb-2 pt-1">
                                            <div className="flex items-center justify-between">
                                                <span className={FIELD_TITLE_CLASS}>TradingView Message</span>
                                                <button
                                                    onClick={() => copyToClipboard(generateTemplateJSON(selectedTemplate, true))}
                                                    className={ICON_BUTTON_CLASS}
                                                >
                                                    {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                                                </button>
                                            </div>
                                            <pre className={`${CODE_BLOCK_CLASS} overflow-x-auto text-text`}>
                                                {generateTemplateJSON(selectedTemplate)}
                                            </pre>
                                        </div>

                                        <div className="border-b border-border px-3 pb-2 pt-1">
                                            <div className="flex items-center justify-between">
                                                <span className={FIELD_TITLE_CLASS}>Webhook URL</span>
                                                <button
                                                    onClick={() => copyToClipboard(webhookUrl)}
                                                    className={ICON_BUTTON_CLASS}
                                                    title="Kopyala"
                                                >
                                                    {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                                                </button>
                                            </div>
                                            <code className={`${CODE_BLOCK_CLASS} block break-all text-primary`}>
                                                {webhookUrl}
                                            </code>
                                        </div>

                                        <div className="border-b border-border px-3 py-2">
                                            <button
                                                onClick={() => setShowQR(!showQR)}
                                                className={`${DEFAULT_BUTTON_CLASS} inline-flex items-center gap-1.5`}
                                            >
                                                <QrCode size={14} />
                                                {showQR ? 'Hide QR Code' : 'Show QR Code'}
                                            </button>

                                            {showQR && (
                                                <div className="mt-2">
                                                    {/* QR codes need a white quiet zone to scan in every theme */}
                                                    <div className="inline-block rounded-sm bg-white p-2">
                                                        <img
                                                            src={generateQRCode(webhookUrl)}
                                                            alt="QR Code"
                                                            className="h-40 w-40"
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        <p className="px-3 py-2 text-[11px] text-secondary">
                                            <strong className="font-semibold text-text">Quick Setup:</strong> Copy the JSON message and webhook URL, then paste them into your TradingView alert settings.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="flex min-h-[96px] flex-1 items-center justify-center gap-2 px-3 text-xs text-muted">
                                        <Sparkles size={14} className="shrink-0" />
                                        <p>Select a template to generate alert code</p>
                                    </div>
                                )}
                            </section>
                        </div>
                    )}

                    {/* Custom Builder Tab */}
                    {activeTab === 'custom' && (
                        <div className="grid flex-1 grid-cols-1 gap-px lg:min-h-0 lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)]">
                            <section className="flex min-w-0 flex-col bg-surface lg:min-h-0">
                                <header className={PANEL_HEADER_CLASS}>
                                    <h3 className={PANEL_TITLE_CLASS}>Custom Alert Builder</h3>
                                </header>

                                <div className="space-y-3 p-3 lg:min-h-0 lg:flex-1 lg:overflow-auto">
                                    <div>
                                        <label className={LABEL_CLASS}>Symbol (TradingView Variable)</label>
                                        <input
                                            type="text"
                                            value={customSymbol}
                                            onChange={e => setCustomSymbol(e.target.value)}
                                            placeholder="{{ticker}}"
                                            className={`${INPUT_CLASS} w-full`}
                                        />
                                        <p className="mt-1 text-[10px] text-muted">Use {'{{ticker}}'} for dynamic symbol</p>
                                    </div>

                                    <div>
                                        <label className={LABEL_CLASS}>Side</label>
                                        <select
                                            value={customSide}
                                            onChange={e => setCustomSide(e.target.value as any)}
                                            className={`${INPUT_CLASS} w-full`}
                                        >
                                            <option value="BUY">BUY</option>
                                            <option value="SELL">SELL</option>
                                            <option value="LONG">LONG</option>
                                            <option value="SHORT">SHORT</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className={LABEL_CLASS}>Strategy Name</label>
                                        <input
                                            type="text"
                                            value={customStrategy}
                                            onChange={e => setCustomStrategy(e.target.value)}
                                            placeholder="My_Custom_Strategy"
                                            className={`${INPUT_CLASS} w-full`}
                                        />
                                    </div>

                                    <div>
                                        <label className={LABEL_CLASS}>Condition (Optional)</label>
                                        <textarea
                                            value={customCondition}
                                            onChange={e => setCustomCondition(e.target.value)}
                                            placeholder="e.g., close > sma(20)"
                                            rows={3}
                                            className="block w-full rounded-sm border border-border bg-surface-secondary px-2 py-1.5 font-mono text-xs text-text outline-none placeholder:text-muted focus:border-primary"
                                        />
                                        <p className="mt-1 text-[10px] text-muted">Pine Script condition for reference</p>
                                    </div>
                                </div>
                            </section>

                            <section className="flex min-w-0 flex-col bg-surface lg:min-h-0">
                                <header className={PANEL_HEADER_CLASS}>
                                    <h3 className={PANEL_TITLE_CLASS}>Generated Code</h3>
                                </header>

                                <div className="lg:min-h-0 lg:flex-1 lg:overflow-auto">
                                    <div className="border-b border-border px-3 pb-2 pt-1">
                                        <div className="flex items-center justify-between">
                                            <span className={FIELD_TITLE_CLASS}>Alert Message JSON</span>
                                            <button
                                                onClick={() => copyToClipboard(generateCustomJSON(true))}
                                                className={ICON_BUTTON_CLASS}
                                            >
                                                {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                                            </button>
                                        </div>
                                        <pre className={`${CODE_BLOCK_CLASS} overflow-x-auto text-text`}>
                                            {generateCustomJSON()}
                                        </pre>
                                    </div>

                                    <div className="border-b border-border px-3 pb-2 pt-1">
                                        <div className="flex items-center justify-between">
                                            <span className={FIELD_TITLE_CLASS}>Webhook URL</span>
                                            <button
                                                onClick={() => copyToClipboard(webhookUrl)}
                                                className={ICON_BUTTON_CLASS}
                                            >
                                                {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                                            </button>
                                        </div>
                                        <code className={`${CODE_BLOCK_CLASS} block break-all text-primary`}>
                                            {webhookUrl}
                                        </code>
                                    </div>

                                    {customCondition && (
                                        <div className="border-b border-border px-3 py-2">
                                            <p className={`${FIELD_TITLE_CLASS} mb-1`}>Pine Script Reference</p>
                                            <code className={`${CODE_BLOCK_CLASS} block whitespace-pre-wrap break-words text-secondary`}>
                                                {customCondition}
                                            </code>
                                        </div>
                                    )}
                                </div>
                            </section>
                        </div>
                    )}

                    {/* Manual Test Tab */}
                    {activeTab === 'manual' && (
                        <form onSubmit={handleInject} className="flex flex-1 flex-col bg-surface lg:min-h-0 lg:overflow-auto">
                            <div className="flex items-start gap-2 border-b border-border bg-warning-soft px-3 py-2">
                                <AlertTriangle className="mt-0.5 shrink-0 text-warning" size={14} />
                                <div>
                                    <h4 className="text-xs font-semibold text-warning">Canlı Ortam</h4>
                                    <p className="mt-0.5 text-[11px] text-secondary">Buradan eklenen sinyaller veritabanına kaydedilir ve tüm kullanıcılara anında yayınlanır. "Bağlantıyı Test Et" ise kayıt oluşturmadan yalnızca webhook adresini ve gizli anahtarı doğrular.</p>
                                </div>
                            </div>

                            <div className="grid max-w-2xl grid-cols-2 gap-3 p-3">
                                <div>
                                    <label className={LABEL_CLASS}>Symbol</label>
                                    <input
                                        type="text"
                                        value={manualSymbol}
                                        onChange={e => setManualSymbol(e.target.value)}
                                        placeholder="BTCUSDT"
                                        className={`${INPUT_CLASS} w-full uppercase`}
                                    />
                                </div>
                                <div>
                                    <label className={LABEL_CLASS}>Price</label>
                                    <input
                                        type="number"
                                        value={manualPrice}
                                        onChange={e => setManualPrice(e.target.value)}
                                        placeholder="65000"
                                        className={`${INPUT_CLASS} w-full font-mono`}
                                    />
                                </div>
                                <div>
                                    <label className={LABEL_CLASS}>Side</label>
                                    <select
                                        value={manualSide}
                                        onChange={e => setManualSide(e.target.value as Side)}
                                        className={`${INPUT_CLASS} w-full`}
                                    >
                                        <option value="BUY">BUY</option>
                                        <option value="SELL">SELL</option>
                                        <option value="LONG">LONG</option>
                                        <option value="SHORT">SHORT</option>
                                    </select>
                                </div>
                                <div>
                                    <label className={LABEL_CLASS}>Strategy</label>
                                    <input
                                        type="text"
                                        value={manualStrategy}
                                        onChange={e => setManualStrategy(e.target.value)}
                                        className={`${INPUT_CLASS} w-full`}
                                    />
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
                                <button
                                    onClick={testWebhook}
                                    type="button"
                                    disabled={testing || serverStatus === 'OFFLINE'}
                                    className={`${DEFAULT_BUTTON_CLASS} inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50`}
                                >
                                    {testing ? (
                                        <>
                                            <Loader2 size={14} className="animate-spin" />
                                            Test ediliyor...
                                        </>
                                    ) : (
                                        <>
                                            <Send size={14} />
                                            Bağlantıyı Test Et
                                        </>
                                    )}
                                </button>

                                <button
                                    type="submit"
                                    disabled={injecting}
                                    className="inline-flex h-7 items-center gap-1.5 rounded-sm bg-primary px-2.5 text-xs font-medium text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {injecting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                                    Inject Signal
                                </button>
                            </div>
                        </form>
                    )}
                </div>

                {/* Recent Webhook Signals */}
                <section className="flex min-w-0 flex-col bg-surface lg:min-h-0">
                    <header className={PANEL_HEADER_CLASS}>
                        <h3 className={`${PANEL_TITLE_CLASS} flex items-center gap-1.5`}>
                            <Radio size={12} />
                            Recent Webhook Signals
                        </h3>
                        <span className="shrink-0 text-[10px] text-muted">Last 5 signals</span>
                    </header>

                    <div className="lg:min-h-0 lg:flex-1 lg:overflow-auto">
                        {recentWebhookSignals.length === 0 ? (
                            <div className="flex min-h-[96px] flex-col items-center justify-center gap-1 px-3 py-6 text-center lg:h-full">
                                <p className="flex items-center gap-2 text-xs text-muted">
                                    <Zap size={14} className="shrink-0" />
                                    No webhook signals received yet
                                </p>
                                <p className="text-[11px] text-muted">Test the connection or send a signal from TradingView</p>
                            </div>
                        ) : (
                            <div role="table">
                                <div role="row" className="sticky top-0 z-10 grid h-7 items-center gap-x-2 border-b border-border bg-surface px-3 text-[10px] font-medium uppercase tracking-wider text-muted" style={{ gridTemplateColumns: RECENT_COLS }}>
                                    <div role="columnheader">Symbol</div>
                                    <div role="columnheader">Side</div>
                                    <div role="columnheader">Strategy</div>
                                    <div role="columnheader" className="text-right">Price</div>
                                    <div role="columnheader" className="flex items-center justify-end gap-1">
                                        <Clock size={10} />
                                        Time
                                    </div>
                                </div>
                                {recentWebhookSignals.map((signal) => (
                                    <div
                                        key={signal.id}
                                        role="row"
                                        className="grid h-7 items-center gap-x-2 border-b border-border px-3 text-xs hover:bg-surface-secondary"
                                        style={{ gridTemplateColumns: RECENT_COLS }}
                                    >
                                        <div role="cell" className="truncate font-medium text-text">{signal.symbol.replace('USDT', '')}</div>
                                        <div role="cell">
                                            <span className={`rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase ${signal.side === 'NEUTRAL'
                                                ? 'bg-surface-secondary text-secondary'
                                                : signal.side === 'BUY' || signal.side === 'LONG'
                                                    ? 'bg-success-soft text-success'
                                                    : 'bg-danger-soft text-danger'
                                                }`}>
                                                {signal.side === 'NEUTRAL' ? 'Yönsüz' : signal.side}
                                            </span>
                                        </div>
                                        <div role="cell" className="truncate text-[11px] text-secondary" title={getStrategyLabel(signal.strategy)}>{getStrategyLabel(signal.strategy)}</div>
                                        <div role="cell" className="truncate text-right font-mono text-text">${signal.price.toFixed(2)}</div>
                                        <div role="cell" className="text-right font-mono text-[11px] text-secondary">
                                            {new Date(signal.time).toLocaleTimeString([], {
                                                hour: '2-digit',
                                                minute: '2-digit',
                                                second: '2-digit'
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Info */}
                    <div className="-mt-px flex shrink-0 items-start gap-2 border-t border-border px-3 py-2">
                        <Activity size={12} className="mt-0.5 shrink-0 text-info" />
                        <div>
                            <p className="text-[11px] font-semibold text-text">Live Monitoring Active</p>
                            <p className="text-[11px] text-secondary">
                                Webhook signals appear here instantly and trigger audio alerts.
                                Check the <strong className="font-semibold text-text">Big Move Radar</strong> on the dashboard to see all signals.
                            </p>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
};
