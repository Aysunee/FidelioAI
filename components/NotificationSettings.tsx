import React, { useState } from 'react';
import { NotificationRule, Side } from '../types';
import { Plus, Trash, Bell, AlertTriangle } from 'lucide-react';

interface NotificationSettingsProps {
  rules: NotificationRule[];
  setRules: React.Dispatch<React.SetStateAction<NotificationRule[]>>;
}

export const NotificationSettings: React.FC<NotificationSettingsProps> = ({ rules, setRules }) => {
  const [symbol, setSymbol] = useState('');
  const [side, setSide] = useState<Side | 'ANY'>('ANY');
  const [inApp, setInApp] = useState(true);
  const [browser, setBrowser] = useState(false);
  const [permission, setPermission] = useState(Notification.permission);

  const requestPermission = async () => {
    const perm = await Notification.requestPermission();
    setPermission(perm);
    if (perm === 'granted') setBrowser(true);
  };

  const handleAddRule = () => {
    const newRule: NotificationRule = {
      id: Math.random().toString(36).substring(7),
      name: `${side === 'ANY' ? 'Any Side' : side} ${symbol ? `on ${symbol}` : 'on Any Symbol'}`,
      condition: {
        symbol: symbol.toUpperCase(),
        side: side,
      },
      channels: {
        inApp,
        browser: browser && permission === 'granted',
      },
    };
    setRules([...rules, newRule]);
    setSymbol('');
    setSide('ANY');
  };

  const handleDeleteRule = (id: string) => {
    setRules(rules.filter(r => r.id !== id));
  };

  const ToggleSwitch = ({ checked, onChange, disabled = false }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${checked ? 'bg-success' : 'bg-surface-secondary'} ${disabled ? 'opacity-50' : ''}`}
    >
      <span
        className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${checked ? 'translate-x-5' : 'translate-x-0'}`}
      />
    </button>
  );

  return (
    <div className="space-y-6">
      
      {permission !== 'granted' && (
        <div className="bg-warning/10 p-4 rounded-xl flex items-start gap-3">
          <AlertTriangle className="text-warning shrink-0" size={18} />
          <div>
            <h4 className="text-sm font-bold text-warning">Enable Notifications</h4>
            <p className="text-xs text-text/80 mt-1 mb-2">Allow browser alerts for background updates.</p>
            <button 
              onClick={requestPermission}
              className="text-xs font-semibold text-warning underline hover:no-underline"
            >
              Allow Access
            </button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-secondary uppercase tracking-wide ml-1">New Rule</h3>
        <div className="bg-surface-secondary/50 p-4 rounded-2xl space-y-4">
            <div className="grid grid-cols-2 gap-4">
                <input 
                    type="text" 
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value)}
                    placeholder="Symbol (Optional)"
                    className="bg-surface border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                />
                <select 
                    value={side}
                    onChange={(e) => setSide(e.target.value as Side | 'ANY')}
                    className="bg-surface border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                >
                    <option value="ANY">Any Side</option>
                    <option value="BUY">Buy</option>
                    <option value="SELL">Sell</option>
                </select>
            </div>
            
            <div className="flex items-center justify-between py-2 px-1">
                <div className="text-sm font-medium">Show In-App</div>
                <ToggleSwitch checked={inApp} onChange={setInApp} />
            </div>
            <div className="flex items-center justify-between py-2 px-1 border-t border-border/50">
                <div className="text-sm font-medium">Browser Alert</div>
                <ToggleSwitch checked={browser} onChange={setBrowser} disabled={permission === 'denied'} />
            </div>

            <button 
                onClick={handleAddRule}
                className="w-full bg-text text-surface font-semibold py-3 rounded-xl text-sm transition-transform active:scale-[0.98]"
            >
                Add Rule
            </button>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-secondary uppercase tracking-wide ml-1">Active Rules</h3>
        {rules.map(rule => (
            <div key={rule.id} className="flex items-center justify-between p-4 bg-surface border border-border rounded-xl">
                <div className="font-medium text-text text-sm">{rule.name}</div>
                <button 
                    onClick={() => handleDeleteRule(rule.id)}
                    className="text-danger hover:bg-danger/10 p-2 rounded-full transition-colors"
                >
                    <Trash size={16} />
                </button>
            </div>
        ))}
      </div>
    </div>
  );
};