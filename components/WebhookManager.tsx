import React, { useState, useEffect } from 'react';
import { Side } from '../types';
import { Card } from './ui/Card';
import { Terminal, Copy, Check, Play, Settings, ShieldAlert, AlertTriangle, Zap, Activity, CheckCircle2, XCircle, Loader2, Send, Sparkles, Code, QrCode, TrendingUp, TrendingDown, BarChart3, Layers, Clock, Radio } from 'lucide-react';
import { useSignals } from '../context/SignalContext';
import { API_BASE_URL, WEBHOOK_API_URL } from '../utils/config';

// Component is self-contained — reads WEBHOOK_API_URL from config, manages
// its own secret via localStorage, POSTs directly to the webhook backend.

// Preset Templates
const WEBHOOK_TEMPLATES = [
    {
        id: 'breakout',
        name: 'Price Breakout',
        icon: TrendingUp,
        description: 'Trigger when price breaks resistance',
        color: 'from-emerald-600 to-green-600',
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
        color: 'from-rose-600 to-red-600',
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
        color: 'from-cyan-600 to-blue-600',
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
        color: 'from-purple-600 to-violet-600',
        condition: 'rsi(14) < 30',
        message: {
            symbol: '{{ticker}}',
            side: 'LONG',
            price: '{{close}}',
            strategy: 'RSI_Oversold'
        }
    }
];

export const WebhookManager: React.FC = () => {
    const { signals } = useSignals();
    const [activeTab, setActiveTab] = useState<'templates' | 'custom' | 'manual'>('templates');
    const [copied, setCopied] = useState(false);
    const [serverStatus, setServerStatus] = useState<'CHECKING' | 'ONLINE' | 'OFFLINE'>('CHECKING');
    const [testing, setTesting] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
    const [showQR, setShowQR] = useState(false);

    // Filter only webhook signals
    const recentWebhookSignals = signals.filter(s => s.source === 'WEBHOOK').slice(0, 5);

    // Webhook URL — points at the separate webhook backend (Windows Docker),
    // NOT the MySQL backend. See utils/config.ts for the two URL constants.
    const webhookUrl = `${WEBHOOK_API_URL}/api/webhook`;
    // Secret is user-managed via localStorage (see spec §5.5). User pastes
    // the value from .env.webhook → WEBHOOK_SECRET into the input UI below.
    const [secret, setSecret] = useState<string>(() => {
        return localStorage.getItem('webhook_secret') || '';
    });

    const handleSecretChange = (newSecret: string) => {
        setSecret(newSecret);
        if (newSecret) {
            localStorage.setItem('webhook_secret', newSecret);
        } else {
            localStorage.removeItem('webhook_secret');
        }
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
        checkServerStatus();
        const interval = setInterval(checkServerStatus, 10000);
        return () => clearInterval(interval);
    }, []);

    const checkServerStatus = async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/health`, {
                method: 'GET',
                signal: AbortSignal.timeout(2000)
            });
            setServerStatus(response.ok ? 'ONLINE' : 'OFFLINE');
        } catch (e) {
            setServerStatus('OFFLINE');
        }
    };

    const testWebhook = async () => {
        if (!secret) {
            alert('Secret gerekli. Yukarıdaki input\'a backend .env.webhook\'taki WEBHOOK_SECRET değerini yapıştır.');
            return;
        }
        setTesting(true);
        try {
            const testPayload = {
                secret,
                symbol: 'BTCUSDT',
                side: 'BUY',
                price: 65000,
                strategy: 'Webhook_Test',
                time: new Date().toISOString()
            };

            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(testPayload)
            });

            if (response.ok) {
                alert('Test başarılı — sinyal webhook backend\'e gönderildi.');
                setServerStatus('ONLINE');
            } else if (response.status === 401) {
                alert('Secret yanlış — backend .env.webhook\'taki WEBHOOK_SECRET ile eşleşmiyor.');
            } else {
                alert(`Sunucu hata döndü: ${response.status}`);
            }
        } catch (e) {
            alert('Bağlantı hatası — backend çalışıyor mu?');
            setServerStatus('OFFLINE');
        } finally {
            setTesting(false);
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleInject = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!manualSymbol || !manualPrice) return;
        if (!secret) {
            alert('Secret gerekli. Yukarıdaki input\'a backend .env.webhook\'taki WEBHOOK_SECRET değerini yapıştır.');
            return;
        }

        const payload = {
            secret,
            id: `man_${Date.now()}`,
            strategy: manualStrategy,
            symbol: manualSymbol.toUpperCase().includes('USDT')
                ? manualSymbol.toUpperCase()
                : `${manualSymbol.toUpperCase()}USDT`,
            side: manualSide,
            price: parseFloat(manualPrice),
            time: new Date().toISOString(),
            note: 'Manually injected via Signal Hub',
            source: 'WEBHOOK',
            confidence: 0.99
        };

        try {
            const res = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                setManualSymbol('');
                setManualPrice('');
                // Signal is persisted server-side; no local state push needed.
                // Real-time socket.io echo for webhook backend will be added in
                // a later task (currently "Recent Webhook Signals" section
                // only shows signals from the existing MySQL backend via
                // useSignals() — acceptable for the first MVP iteration).
            } else if (res.status === 401) {
                alert('Secret yanlış — backend .env.webhook\'taki WEBHOOK_SECRET ile eşleşmiyor.');
            } else {
                alert(`Hata: ${res.status}`);
            }
        } catch (err) {
            alert('Bağlantı hatası — backend çalışıyor mu?');
        }
    };

    const generateTemplateJSON = (templateId: string) => {
        const template = WEBHOOK_TEMPLATES.find(t => t.id === templateId);
        if (!template) return '';

        return JSON.stringify({
            secret: secret,
            ...template.message,
            time: '{{time}}'
        }, null, 2);
    };

    const generateCustomJSON = () => {
        return JSON.stringify({
            secret: secret,
            symbol: customSymbol,
            side: customSide,
            price: '{{close}}',
            strategy: customStrategy,
            time: '{{time}}'
        }, null, 2);
    };

    const generateQRCode = (data: string) => {
        return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data)}`;
    };

    const StatusBadge = () => {
        if (serverStatus === 'CHECKING') {
            return (
                <div className="flex items-center gap-2 text-gray-500">
                    <Loader2 size={12} className="animate-spin" />
                    <span className="text-xs font-medium">Checking...</span>
                </div>
            );
        }
        if (serverStatus === 'ONLINE') {
            return (
                <div className="flex items-center gap-2 text-emerald-400">
                    <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                    </span>
                    <span className="text-xs font-bold">ONLINE</span>
                </div>
            );
        }
        return (
            <div className="flex items-center gap-2 text-rose-400">
                <XCircle size={12} />
                <span className="text-xs font-bold">OFFLINE</span>
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-black p-6">
            {/* Ambient Background */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-purple-600/10 rounded-full blur-[120px]"></div>
                <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-amber-600/10 rounded-full blur-[120px]"></div>
            </div>

            {/* Header */}
            <div className="max-w-7xl mx-auto mb-6 relative z-10">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-xl font-bold bg-gradient-to-r from-purple-400 via-violet-300 to-amber-400 bg-clip-text text-transparent flex items-center gap-2 mb-1">
                            <div className="p-2 bg-gradient-to-br from-purple-600 via-violet-500 to-amber-500 rounded-lg shadow-[0_0_30px_rgba(168,85,247,0.4)]">
                                <Sparkles size={20} className="text-white" />
                            </div>
                            Webhook Creator Studio
                        </h1>
                        <p className="text-xs text-gray-500">Build, test, and deploy custom trading alerts</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 shadow-[0_0_20px_rgba(168,85,247,0.15)]">
                            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Server Status</div>
                            <StatusBadge />
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto relative z-10">
                {/* Secret Input — spec §5.5 */}
                <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-lg p-4 mb-6">
                    <label className="text-xs text-gray-400 flex items-center gap-2 font-medium mb-2">
                        <ShieldAlert size={12} />
                        Webhook Secret — backend .env.webhook → WEBHOOK_SECRET
                    </label>
                    <input
                        type="password"
                        value={secret}
                        onChange={e => handleSecretChange(e.target.value)}
                        placeholder="Paste the WEBHOOK_SECRET from .env.webhook"
                        autoComplete="off"
                        className="w-full bg-black/30 border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 font-mono focus:border-purple-500/50 focus:outline-none"
                    />
                    {!secret && (
                        <p className="text-xs text-amber-400 mt-2">
                            Enter the secret to enable Test Connection, Manual Inject, and template generation.
                        </p>
                    )}
                </div>

                {/* Tabs */}
                <div className="flex space-x-2 backdrop-blur-xl bg-white/5 p-1.5 rounded-lg w-fit border border-white/10 mb-6">
                    <button
                        onClick={() => setActiveTab('templates')}
                        className={`px-5 py-2 rounded-md text-sm font-bold transition-all ${activeTab === 'templates'
                            ? 'bg-gradient-to-r from-purple-600 to-violet-600 text-white shadow-[0_0_20px_rgba(168,85,247,0.4)]'
                            : 'text-gray-500 hover:text-gray-300'
                            }`}
                    >
                        <Layers size={14} className="inline mr-2" />
                        Templates
                    </button>
                    <button
                        onClick={() => setActiveTab('custom')}
                        className={`px-5 py-2 rounded-md text-sm font-bold transition-all ${activeTab === 'custom'
                            ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-[0_0_20px_rgba(34,211,238,0.4)]'
                            : 'text-gray-500 hover:text-gray-300'
                            }`}
                    >
                        <Code size={14} className="inline mr-2" />
                        Custom Builder
                    </button>
                    <button
                        onClick={() => setActiveTab('manual')}
                        className={`px-5 py-2 rounded-md text-sm font-bold transition-all ${activeTab === 'manual'
                            ? 'bg-gradient-to-r from-amber-600 to-orange-600 text-white shadow-[0_0_20px_rgba(251,191,36,0.4)]'
                            : 'text-gray-500 hover:text-gray-300'
                            }`}
                    >
                        <Play size={14} className="inline mr-2" />
                        Manual Test
                    </button>
                </div>

                {/* Templates Tab */}
                {activeTab === 'templates' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-in fade-in">
                        {/* Template Cards */}
                        <div className="space-y-4">
                            <h3 className="text-base font-bold text-gray-200 mb-4">Preset Templates</h3>
                            {WEBHOOK_TEMPLATES.map(template => {
                                const Icon = template.icon;
                                const isSelected = selectedTemplate === template.id;
                                return (
                                    <div
                                        key={template.id}
                                        onClick={() => setSelectedTemplate(template.id)}
                                        className={`p-4 rounded-lg border cursor-pointer transition-all ${isSelected
                                            ? 'backdrop-blur-xl bg-white/10 border-purple-500/50 shadow-[0_0_30px_rgba(168,85,247,0.2)]'
                                            : 'backdrop-blur-xl bg-white/5 border-white/10 hover:border-purple-500/30'
                                            }`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className={`p-2 rounded-md bg-gradient-to-br ${template.color} shadow-[0_0_15px_rgba(168,85,247,0.3)]`}>
                                                <Icon size={18} className="text-white" />
                                            </div>
                                            <div className="flex-1">
                                                <h4 className="font-bold text-gray-200 text-sm mb-1">{template.name}</h4>
                                                <p className="text-xs text-gray-500 mb-2">{template.description}</p>
                                                <code className="text-[10px] bg-black/30 px-2 py-1 rounded text-purple-400">
                                                    {template.condition}
                                                </code>
                                            </div>
                                            {isSelected && (
                                                <CheckCircle2 size={18} className="text-purple-400" />
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Generated Code */}
                        <div className="space-y-4">
                            <h3 className="text-base font-bold text-gray-200 mb-4">Generated Alert Code</h3>
                            {selectedTemplate ? (
                                <div className="space-y-4">
                                    <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-lg p-4">
                                        <div className="flex items-center justify-between mb-3">
                                            <span className="text-xs font-bold text-gray-400 uppercase">TradingView Message</span>
                                            <button
                                                onClick={() => copyToClipboard(generateTemplateJSON(selectedTemplate))}
                                                className="p-1.5 hover:bg-white/5 rounded-md transition-colors"
                                            >
                                                {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} className="text-gray-500" />}
                                            </button>
                                        </div>
                                        <pre className="bg-black/40 p-3 rounded-lg text-xs font-mono text-gray-400 overflow-x-auto">
                                            {generateTemplateJSON(selectedTemplate)}
                                        </pre>
                                    </div>

                                    <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-lg p-4">
                                        {/* Webhook URL Display */}
                                        <div className="bg-white/5 p-4 rounded-lg border border-white/10 mb-6">
                                            <div className="text-xs text-gray-500 mb-1">Your Webhook URL</div>
                                            <div className="flex items-center gap-2">
                                                <code className="text-sm text-purple-400 bg-black/30 px-2 py-1 rounded flex-1">
                                                    {webhookUrl}
                                                </code>
                                                <button className="p-1.5 hover:bg-white/10 rounded-md transition-colors" title="Copy">
                                                    <Copy size={14} className="text-gray-400" />
                                                </button>
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between mb-3">
                                            <span className="text-xs font-bold text-gray-400 uppercase">Webhook URL</span>
                                            <button
                                                onClick={() => copyToClipboard(webhookUrl)}
                                                className="p-1.5 hover:bg-white/5 rounded-md transition-colors"
                                            >
                                                {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} className="text-gray-500" />}
                                            </button>
                                        </div>
                                        <code className="bg-black/40 p-3 rounded-lg text-xs font-mono text-gray-300 block">
                                            {webhookUrl}
                                        </code>
                                    </div>

                                    <button
                                        onClick={() => setShowQR(!showQR)}
                                        className="w-full py-3 bg-gradient-to-r from-purple-600 to-violet-600 hover:from-purple-700 hover:to-violet-700 text-white rounded-lg font-bold flex items-center justify-center gap-2 transition-all shadow-[0_0_20px_rgba(168,85,247,0.3)]"
                                    >
                                        <QrCode size={16} />
                                        {showQR ? 'Hide QR Code' : 'Show QR Code'}
                                    </button>

                                    {showQR && (
                                        <div className="bg-white p-4 rounded-lg flex justify-center animate-in fade-in">
                                            <img
                                                src={generateQRCode(webhookUrl)}
                                                alt="QR Code"
                                                className="w-48 h-48"
                                            />
                                        </div>
                                    )}

                                    <div className="backdrop-blur-xl bg-cyan-500/10 border border-cyan-500/30 p-4 rounded-lg">
                                        <p className="text-xs text-cyan-400">
                                            <strong>Quick Setup:</strong> Copy the JSON message and webhook URL, then paste them into your TradingView alert settings.
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <div className="backdrop-blur-xl bg-white/5 border border-dashed border-white/10 rounded-lg p-12 text-center">
                                    <Sparkles size={40} className="mx-auto mb-3 text-gray-700 opacity-30" />
                                    <p className="text-gray-600 text-sm">Select a template to generate alert code</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Custom Builder Tab */}
                {activeTab === 'custom' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-in fade-in">
                        <div className="space-y-4">
                            <h3 className="text-base font-bold text-gray-200 mb-4">Custom Alert Builder</h3>

                            <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-lg p-5 space-y-4">
                                <div>
                                    <label className="text-xs text-gray-400 block mb-2 font-medium">Symbol (TradingView Variable)</label>
                                    <input
                                        type="text"
                                        value={customSymbol}
                                        onChange={e => setCustomSymbol(e.target.value)}
                                        placeholder="{{ticker}}"
                                        className="w-full bg-black/30 border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-cyan-500/50 focus:outline-none transition-colors"
                                    />
                                    <p className="text-[10px] text-gray-600 mt-1">Use {'{{ticker}}'} for dynamic symbol</p>
                                </div>

                                <div>
                                    <label className="text-xs text-gray-400 block mb-2 font-medium">Side</label>
                                    <select
                                        value={customSide}
                                        onChange={e => setCustomSide(e.target.value as any)}
                                        className="w-full bg-black/30 border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-cyan-500/50 focus:outline-none transition-colors"
                                    >
                                        <option value="BUY">BUY</option>
                                        <option value="SELL">SELL</option>
                                        <option value="LONG">LONG</option>
                                        <option value="SHORT">SHORT</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="text-xs text-gray-400 block mb-2 font-medium">Strategy Name</label>
                                    <input
                                        type="text"
                                        value={customStrategy}
                                        onChange={e => setCustomStrategy(e.target.value)}
                                        placeholder="My_Custom_Strategy"
                                        className="w-full bg-black/30 border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-cyan-500/50 focus:outline-none transition-colors"
                                    />
                                </div>

                                <div>
                                    <label className="text-xs text-gray-400 block mb-2 font-medium">Condition (Optional)</label>
                                    <textarea
                                        value={customCondition}
                                        onChange={e => setCustomCondition(e.target.value)}
                                        placeholder="e.g., close > sma(20)"
                                        rows={3}
                                        className="w-full bg-black/30 border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-cyan-500/50 focus:outline-none font-mono transition-colors"
                                    />
                                    <p className="text-[10px] text-gray-600 mt-1">Pine Script condition for reference</p>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h3 className="text-base font-bold text-gray-200 mb-4">Generated Code</h3>

                            <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-lg p-4">
                                <div className="flex items-center justify-between mb-3">
                                    <span className="text-xs font-bold text-gray-400 uppercase">Alert Message JSON</span>
                                    <button
                                        onClick={() => copyToClipboard(generateCustomJSON())}
                                        className="p-1.5 hover:bg-white/5 rounded-md transition-colors"
                                    >
                                        {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} className="text-gray-500" />}
                                    </button>
                                </div>
                                <pre className="bg-black/40 p-3 rounded-lg text-xs font-mono text-gray-400 overflow-x-auto">
                                    {generateCustomJSON()}
                                </pre>
                            </div>

                            <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-lg p-4">
                                <div className="flex items-center justify-between mb-3">
                                    <span className="text-xs font-bold text-gray-400 uppercase">Webhook URL</span>
                                    <button
                                        onClick={() => copyToClipboard(webhookUrl)}
                                        className="p-1.5 hover:bg-white/5 rounded-md transition-colors"
                                    >
                                        {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} className="text-gray-500" />}
                                    </button>
                                </div>
                                <code className="bg-black/40 p-3 rounded-lg text-xs font-mono text-gray-300 block">
                                    {webhookUrl}
                                </code>
                            </div>

                            {customCondition && (
                                <div className="backdrop-blur-xl bg-purple-500/10 border border-purple-500/30 p-4 rounded-lg">
                                    <p className="text-xs font-bold text-purple-400 mb-2">Pine Script Reference</p>
                                    <code className="text-xs text-gray-400 font-mono">
                                        {customCondition}
                                    </code>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Manual Test Tab */}
                {activeTab === 'manual' && (
                    <div className="max-w-2xl mx-auto animate-in fade-in">
                        <form onSubmit={handleInject} className="space-y-6">
                            <div className="backdrop-blur-xl bg-amber-500/10 border border-amber-500/30 p-4 rounded-lg flex gap-3">
                                <AlertTriangle className="text-amber-400 shrink-0" size={18} />
                                <div>
                                    <h4 className="text-sm font-bold text-amber-400">Test Environment</h4>
                                    <p className="text-xs text-gray-500 mt-1">Manually inject signals to test the dashboard integration.</p>
                                </div>
                            </div>

                            <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-lg p-5 space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs text-gray-400 block mb-2 font-medium">Symbol</label>
                                        <input
                                            type="text"
                                            value={manualSymbol}
                                            onChange={e => setManualSymbol(e.target.value)}
                                            placeholder="BTCUSDT"
                                            className="w-full bg-black/30 border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-amber-500/50 focus:outline-none uppercase transition-colors"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs text-gray-400 block mb-2 font-medium">Price</label>
                                        <input
                                            type="number"
                                            value={manualPrice}
                                            onChange={e => setManualPrice(e.target.value)}
                                            placeholder="65000"
                                            className="w-full bg-black/30 border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-amber-500/50 focus:outline-none transition-colors"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs text-gray-400 block mb-2 font-medium">Side</label>
                                        <select
                                            value={manualSide}
                                            onChange={e => setManualSide(e.target.value as Side)}
                                            className="w-full bg-black/30 border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-amber-500/50 focus:outline-none transition-colors"
                                        >
                                            <option value="BUY">BUY</option>
                                            <option value="SELL">SELL</option>
                                            <option value="LONG">LONG</option>
                                            <option value="SHORT">SHORT</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-xs text-gray-400 block mb-2 font-medium">Strategy</label>
                                        <input
                                            type="text"
                                            value={manualStrategy}
                                            onChange={e => setManualStrategy(e.target.value)}
                                            className="w-full bg-black/30 border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-amber-500/50 focus:outline-none transition-colors"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <button
                                    onClick={testWebhook}
                                    type="button"
                                    disabled={testing || serverStatus === 'OFFLINE'}
                                    className="py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 disabled:from-gray-700 disabled:to-gray-800 text-white rounded-lg font-bold flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(34,211,238,0.3)] transition-all disabled:cursor-not-allowed"
                                >
                                    {testing ? (
                                        <>
                                            <Loader2 size={16} className="animate-spin" />
                                            Testing...
                                        </>
                                    ) : (
                                        <>
                                            <Send size={16} />
                                            Test Connection
                                        </>
                                    )}
                                </button>

                                <button
                                    type="submit"
                                    className="py-3 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white rounded-lg font-bold flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(251,191,36,0.3)] transition-all"
                                >
                                    <Play size={16} />
                                    Inject Signal
                                </button>
                            </div>
                        </form>
                    </div>
                )}

                {/* Recent Webhook Signals */}
                <div className="mt-8">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <div className="relative">
                                <div className="absolute inset-0 bg-amber-500/30 rounded-full animate-ping"></div>
                                <Radio size={18} className="text-amber-400 relative z-10" />
                            </div>
                            <h3 className="text-base font-bold text-gray-200">Recent Webhook Signals</h3>
                        </div>
                        <span className="text-xs text-gray-500">Last 5 signals</span>
                    </div>

                    {recentWebhookSignals.length === 0 ? (
                        <div className="backdrop-blur-xl bg-white/5 border border-dashed border-white/10 rounded-lg p-12 text-center">
                            <Zap size={40} className="mx-auto mb-3 text-gray-700 opacity-30" />
                            <p className="text-gray-600 text-sm">No webhook signals received yet</p>
                            <p className="text-gray-700 text-xs mt-1">Test the connection or send a signal from TradingView</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {recentWebhookSignals.map((signal) => (
                                <div
                                    key={signal.id}
                                    className="backdrop-blur-xl bg-gradient-to-br from-amber-600/20 to-orange-600/20 border border-amber-500/30 rounded-lg p-4 shadow-[0_0_20px_rgba(251,191,36,0.2)] hover:shadow-[0_0_30px_rgba(251,191,36,0.3)] transition-all relative overflow-hidden group"
                                >
                                    {/* Pulse indicator */}
                                    <div className="absolute top-2 right-2">
                                        <span className="relative flex h-2 w-2">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                                        </span>
                                    </div>

                                    <div className="flex items-start justify-between mb-3">
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="font-bold text-amber-400 text-lg">{signal.symbol.replace('USDT', '')}</span>
                                                <span className={`text-xs font-bold px-2 py-0.5 rounded ${signal.side === 'BUY' || signal.side === 'LONG'
                                                    ? 'bg-emerald-500/20 text-emerald-400'
                                                    : 'bg-rose-500/20 text-rose-400'
                                                    }`}>
                                                    {signal.side}
                                                </span>
                                            </div>
                                            <p className="text-xs text-gray-500">{signal.strategy}</p>
                                        </div>
                                    </div>

                                    <div className="flex items-end justify-between">
                                        <div>
                                            <div className="text-xs text-gray-500 mb-1">Price</div>
                                            <div className="text-lg font-bold text-gray-200 font-mono">${signal.price.toFixed(2)}</div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-xs text-gray-500 mb-1 flex items-center gap-1 justify-end">
                                                <Clock size={10} />
                                                Time
                                            </div>
                                            <div className="text-xs text-gray-400 font-mono">
                                                {new Date(signal.time).toLocaleTimeString([], {
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                    second: '2-digit'
                                                })}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Gradient overlay on hover */}
                                    <div className="absolute inset-0 bg-gradient-to-r from-amber-500/0 via-amber-500/5 to-amber-500/0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Info Box */}
                    <div className="mt-4 backdrop-blur-xl bg-cyan-500/10 border border-cyan-500/30 p-4 rounded-lg">
                        <div className="flex gap-3">
                            <Activity size={18} className="text-cyan-400 shrink-0 mt-0.5" />
                            <div>
                                <p className="text-xs font-bold text-cyan-400 mb-1">Live Monitoring Active</p>
                                <p className="text-xs text-gray-500">
                                    Webhook signals appear here instantly and trigger audio alerts.
                                    Check the <strong className="text-gray-400">Big Move Radar</strong> on the dashboard to see all signals.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};