import React, { useState } from 'react';
import { NotificationRule, Side } from '../types';
import { Trash, AlertTriangle } from 'lucide-react';
import { useThemeClasses } from '../theme/utils';

interface NotificationSettingsProps {
  rules: NotificationRule[];
  setRules: React.Dispatch<React.SetStateAction<NotificationRule[]>>;
}

export const NotificationSettings: React.FC<NotificationSettingsProps> = ({ rules, setRules }) => {
  const theme = useThemeClasses();
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
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${checked ? 'bg-emerald-500' : 'bg-gray-600'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${checked ? 'translate-x-5' : 'translate-x-0'}`}
      />
    </button>
  );

  return (
    <div className="space-y-6">

      {permission !== 'granted' && (
        <div className={`p-4 rounded-xl flex items-start gap-3 ${theme.bg.secondary} border ${theme.border.subtle}`}>
          <AlertTriangle className="text-amber-500 shrink-0" size={18} />
          <div>
            <h4 className={`text-sm font-bold ${theme.text.primary}`}>Enable Notifications</h4>
            <p className={`text-xs ${theme.text.secondary} mt-1 mb-2`}>Allow browser alerts for background updates.</p>
            <button
              onClick={requestPermission}
              className="text-xs font-semibold text-amber-500 underline hover:no-underline"
            >
              Allow Access
            </button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <h3 className={`text-xs font-bold uppercase tracking-wider ml-1 ${theme.text.tertiary}`}>New Rule</h3>
        <div className={`p-4 rounded-2xl space-y-4 ${theme.bg.secondary} border ${theme.border.subtle}`}>
          <div className="grid grid-cols-2 gap-4">
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="Symbol (Optional)"
              className={`rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-violet-500/20 outline-none w-full ${theme.input.base} border-none`}
            />
            <select
              value={side}
              onChange={(e) => setSide(e.target.value as Side | 'ANY')}
              className={`rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-violet-500/20 outline-none w-full ${theme.input.base} border-none appearance-none`}
            >
              <option value="ANY">Any Side</option>
              <option value="BUY">Buy</option>
              <option value="SELL">Sell</option>
            </select>
          </div>

          <div className="flex items-center justify-between py-2 px-1">
            <div className={`text-sm font-medium ${theme.text.primary}`}>Show In-App</div>
            <ToggleSwitch checked={inApp} onChange={setInApp} />
          </div>
          <div className={`flex items-center justify-between py-2 px-1 border-t ${theme.border.subtle}`}>
            <div className={`text-sm font-medium ${theme.text.primary}`}>Browser Alert</div>
            <ToggleSwitch
              checked={browser}
              onChange={async (checked) => {
                if (checked && permission !== 'granted') {
                  const perm = await Notification.requestPermission();
                  setPermission(perm);
                  if (perm === 'granted') setBrowser(true);
                } else {
                  setBrowser(checked);
                }
              }}
              disabled={permission === 'denied'}
            />
          </div>

          <button
            onClick={handleAddRule}
            className={`w-full font-bold py-3 rounded-xl text-sm transition-transform active:scale-[0.98] ${theme.button.primary}`}
          >
            Add Rule
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className={`text-xs font-bold uppercase tracking-wider ml-1 ${theme.text.tertiary}`}>Active Rules</h3>
        {rules.length === 0 && (
          <div className={`text-center py-6 ${theme.text.tertiary} text-xs italic`}>
            No rules active. Add a rule above.
          </div>
        )}
        {rules.map(rule => (
          <div key={rule.id} className={`flex items-center justify-between p-4 rounded-xl border ${theme.bg.primary} ${theme.border.default}`}>
            <div className={`font-medium text-sm ${theme.text.primary}`}>{rule.name}</div>
            <button
              onClick={() => handleDeleteRule(rule.id)}
              className="text-red-400 hover:bg-red-500/10 p-2 rounded-lg transition-colors"
            >
              <Trash size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};