import React, { useState } from 'react';
import { Signal, Side } from '../types';
import { Card } from './ui/Card';
import { Terminal, Copy, Check, Play, Settings, ShieldAlert, AlertTriangle } from 'lucide-react';

interface WebhookManagerProps {
  onManualSignal: (signal: Signal) => void;
}

export const WebhookManager: React.FC<WebhookManagerProps> = ({ onManualSignal }) => {
  const [activeTab, setActiveTab] = useState<'config' | 'manual'>('config');
  const [copied, setCopied] = useState(false);
  
  // Mock Webhook URL
  const webhookUrl = `https://api.fidelio.ai/v1/webhooks/wh_${Math.random().toString(36).substring(7)}`;
  const secret = `sk_live_${Math.random().toString(36).substring(2, 15)}`;

  // Manual Form State
  const [manualSymbol, setManualSymbol] = useState('');
  const [manualSide, setManualSide] = useState<Side>('BUY');
  const [manualPrice, setManualPrice] = useState('');
  const [manualStrategy, setManualStrategy] = useState('Manual_Override');

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleInject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualSymbol || !manualPrice) return;

    const signal: Signal = {
        id: `man_${Date.now()}`,
        strategy: manualStrategy,
        symbol: manualSymbol.toUpperCase().includes('USDT') ? manualSymbol.toUpperCase() : `${manualSymbol.toUpperCase()}USDT`,
        side: manualSide,
        price: parseFloat(manualPrice),
        time: new Date().toISOString(),
        note: 'Manually injected via Signal Hub',
        source: 'MANUAL',
        confidence: 0.99
    };

    onManualSignal(signal);
    
    // Reset minimal fields
    setManualSymbol('');
    setManualPrice('');
  };

  const tradingViewJson = `{
  "secret": "${secret}",
  "symbol": "{{ticker}}",
  "side": "{{strategy.order.action}}",
  "price": {{strategy.order.price}},
  "time": "{{time}}",
  "strategy": "TV_Alert_V1"
}`;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full">
        {/* Left Panel: Configuration */}
        <Card title="Signal Intelligence Hub" className="h-full">
            <div className="p-6 space-y-6">
                <div className="flex space-x-2 bg-surface-highlight p-1 rounded-lg w-fit">
                    <button 
                        onClick={() => setActiveTab('config')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'config' ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text'}`}
                    >
                        Webhook Configuration
                    </button>
                    <button 
                        onClick={() => setActiveTab('manual')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'manual' ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text'}`}
                    >
                        Manual Injection
                    </button>
                </div>

                {activeTab === 'config' ? (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                        <div className="bg-brand/5 border border-brand/20 p-4 rounded-xl">
                            <h4 className="text-sm font-bold text-brand mb-2 flex items-center gap-2">
                                <Terminal size={16} /> Endpoint Configuration
                            </h4>
                            <div className="space-y-4">
                                <div>
                                    <label className="text-xs text-muted block mb-1">Webhook URL</label>
                                    <div className="flex gap-2">
                                        <code className="flex-1 bg-surface border border-border p-2 rounded text-xs font-mono text-text block overflow-hidden text-ellipsis">
                                            {webhookUrl}
                                        </code>
                                        <button onClick={() => copyToClipboard(webhookUrl)} className="p-2 bg-surface hover:bg-surface-highlight border border-border rounded text-muted hover:text-text transition-colors">
                                            {copied ? <Check size={14} className="text-primary" /> : <Copy size={14} />}
                                        </button>
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs text-muted block mb-1">Secret Key</label>
                                    <code className="bg-surface border border-border p-2 rounded text-xs font-mono text-text block w-full">
                                        {secret}
                                    </code>
                                </div>
                            </div>
                        </div>

                        <div>
                            <h4 className="text-sm font-bold text-text mb-2">TradingView JSON Template</h4>
                            <p className="text-xs text-muted mb-3">Paste this into the "Message" field of your TradingView alert.</p>
                            <pre className="bg-surface-highlight p-4 rounded-xl border border-border text-xs font-mono text-muted overflow-x-auto whitespace-pre-wrap selection:bg-brand/20">
                                {tradingViewJson}
                            </pre>
                        </div>
                    </div>
                ) : (
                    <form onSubmit={handleInject} className="space-y-5 animate-in fade-in slide-in-from-bottom-2">
                         <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-xl flex gap-3">
                            <AlertTriangle className="text-amber-500 shrink-0" size={18} />
                            <div>
                                <h4 className="text-sm font-bold text-amber-600 dark:text-amber-400">Lab Environment</h4>
                                <p className="text-xs text-muted">Signals injected here bypass verification and directly affect your dashboard stream. Use for testing alerts.</p>
                            </div>
                         </div>

                         <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs text-muted block mb-1">Symbol</label>
                                <input 
                                    type="text" 
                                    value={manualSymbol}
                                    onChange={e => setManualSymbol(e.target.value)}
                                    placeholder="BTCUSDT"
                                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-brand focus:outline-none uppercase"
                                />
                            </div>
                            <div>
                                <label className="text-xs text-muted block mb-1">Price</label>
                                <input 
                                    type="number" 
                                    value={manualPrice}
                                    onChange={e => setManualPrice(e.target.value)}
                                    placeholder="65000"
                                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-brand focus:outline-none"
                                />
                            </div>
                         </div>

                         <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs text-muted block mb-1">Side</label>
                                <select 
                                    value={manualSide}
                                    onChange={e => setManualSide(e.target.value as Side)}
                                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-brand focus:outline-none"
                                >
                                    <option value="BUY">BUY</option>
                                    <option value="SELL">SELL</option>
                                    <option value="LONG">LONG</option>
                                    <option value="SHORT">SHORT</option>
                                </select>
                            </div>
                             <div>
                                <label className="text-xs text-muted block mb-1">Strategy Name</label>
                                <input 
                                    type="text" 
                                    value={manualStrategy}
                                    onChange={e => setManualStrategy(e.target.value)}
                                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-brand focus:outline-none"
                                />
                            </div>
                         </div>

                         <button 
                            type="submit"
                            className="w-full py-3 bg-brand hover:bg-brand/90 text-white rounded-lg font-bold flex items-center justify-center gap-2 shadow-lg shadow-brand/20 transition-all active:scale-[0.98]"
                         >
                            <Play size={16} /> Inject Signal
                         </button>
                    </form>
                )}
            </div>
        </Card>

        {/* Right Panel: Documentation / Status */}
        <div className="flex flex-col gap-6">
            <Card title="System Status" className="shrink-0">
                <div className="p-4 grid grid-cols-2 gap-4">
                    <div className="bg-surface-highlight p-3 rounded-xl border border-border">
                        <div className="text-xs text-muted uppercase tracking-wider mb-1">Webhook Status</div>
                        <div className="flex items-center gap-2 text-primary font-medium">
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                            </span>
                            Active
                        </div>
                    </div>
                     <div className="bg-surface-highlight p-3 rounded-xl border border-border">
                        <div className="text-xs text-muted uppercase tracking-wider mb-1">Uptime</div>
                        <div className="text-text font-mono">99.98%</div>
                    </div>
                </div>
            </Card>

            <Card title="Integration Guide" className="flex-1">
                <div className="p-6 prose prose-sm prose-invert max-w-none">
                    <div className="flex gap-4 items-start mb-6">
                        <div className="bg-brand/10 p-2 rounded-lg text-brand">
                            <Settings size={24} />
                        </div>
                        <div>
                            <h3 className="text-text font-bold m-0">Connecting TradingView</h3>
                            <p className="text-muted text-xs mt-1">Send alerts directly from your pine script strategies.</p>
                        </div>
                    </div>
                    
                    <ol className="space-y-4 text-sm text-muted list-decimal list-inside marker:text-brand">
                        <li>Open TradingView and go to your chart.</li>
                        <li>Create a new Alert (Alt+A).</li>
                        <li>In the <strong>Webhook URL</strong> field, paste the URL from the configuration panel.</li>
                        <li>In the <strong>Message</strong> field, paste the JSON template provided.</li>
                        <li>Ensure you replace <code className="text-brand">Strategy_Name</code> with your specific identifier.</li>
                    </ol>

                    <div className="mt-6 pt-6 border-t border-border">
                        <div className="flex gap-2 items-center text-xs text-amber-600 dark:text-amber-500 bg-amber-500/10 p-3 rounded-lg border border-amber-500/20">
                            <ShieldAlert size={16} />
                            <span>
                                <strong>Security Note:</strong> Do not share your Secret Key. Anyone with this key can inject fake signals into your dashboard.
                            </span>
                        </div>
                    </div>
                </div>
            </Card>
        </div>
    </div>
  );
};