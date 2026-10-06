import React, { useState } from 'react';
import { NotificationRule, Side } from '../types';
import { Trash, AlertTriangle } from 'lucide-react';
import { Switch } from './ui/Switch';

// iOS Safari (non-PWA tab) and some in-app WebViews do not define the Notification global at all.
const isNotificationSupported = () =>
  typeof window !== 'undefined' && 'Notification' in window;

const getNotificationPermission = (): NotificationPermission | 'unsupported' => {
  if (!isNotificationSupported()) return 'unsupported';
  try {
    return window.Notification.permission;
  } catch {
    return 'unsupported';
  }
};

interface NotificationSettingsProps {
  rules: NotificationRule[];
  setRules: React.Dispatch<React.SetStateAction<NotificationRule[]>>;
}

export const NotificationSettings: React.FC<NotificationSettingsProps> = ({ rules, setRules }) => {
  const [symbol, setSymbol] = useState('');
  const [side, setSide] = useState<Side | 'ANY'>('ANY');
  const [inApp, setInApp] = useState(true);
  const [browser, setBrowser] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(getNotificationPermission);
  const notificationsSupported = permission !== 'unsupported';

  const requestPermission = async () => {
    if (!isNotificationSupported()) {
      setPermission('unsupported');
      return;
    }
    try {
      // Older Safari versions use the callback form and resolve to undefined.
      const perm = (await window.Notification.requestPermission()) ?? window.Notification.permission;
      setPermission(perm);
      if (perm === 'granted') setBrowser(true);
    } catch {
      setPermission(getNotificationPermission());
    }
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

  // Flat settings section: sub-header rows and full-width rows separated by 1px lines.
  const subHeader = 'flex h-7 items-center border-b border-border bg-surface-secondary px-3 text-[10px] font-semibold uppercase tracking-wider text-muted';
  const field = 'h-7 w-full rounded-sm border border-border bg-surface-secondary px-2 text-xs text-text outline-none placeholder:text-muted focus:border-primary';

  return (
    <div>

      {!notificationsSupported && (
        <div className="flex items-start gap-2 border-b border-border bg-warning-soft px-3 py-2">
          <AlertTriangle className="mt-0.5 shrink-0 text-warning" size={14} />
          <div className="min-w-0">
            <h4 className="text-xs font-medium text-text">Tarayıcı bildirimleri desteklenmiyor</h4>
            <p className="mt-0.5 text-[11px] text-secondary">Bu tarayıcı bildirim API'sini desteklemiyor. iPhone'da bildirim almak için uygulamayı Safari'de "Ana Ekrana Ekle" ile yükleyin. Uygulama içi uyarılar çalışmaya devam eder.</p>
          </div>
        </div>
      )}

      {notificationsSupported && permission !== 'granted' && (
        <div className="flex items-center gap-2 border-b border-border bg-warning-soft px-3 py-2">
          <AlertTriangle className="shrink-0 text-warning" size={14} />
          <div className="min-w-0 flex-1">
            <h4 className="text-xs font-medium text-text">Enable Notifications</h4>
            <p className="text-[11px] text-secondary">Allow browser alerts for background updates.</p>
          </div>
          <button
            type="button"
            onClick={requestPermission}
            className="h-7 shrink-0 rounded-sm border border-border bg-surface-secondary px-2.5 text-xs font-medium text-text transition-colors hover:bg-surface-highlight focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
          >
            Allow Access
          </button>
        </div>
      )}

      <h3 className={subHeader}>New Rule</h3>
      <div className="grid grid-cols-2 gap-2 border-b border-border p-3">
        <input
          type="text"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="Symbol (Optional)"
          className={field}
        />
        <select
          value={side}
          onChange={(e) => setSide(e.target.value as Side | 'ANY')}
          className={field}
        >
          <option value="ANY">Any Side</option>
          <option value="BUY">Buy</option>
          <option value="SELL">Sell</option>
        </select>
      </div>

      <div className="flex h-8 items-center justify-between gap-3 border-b border-border px-3">
        <div className="text-xs text-text">Show In-App</div>
        <Switch checked={inApp} onChange={setInApp} label="Show In-App" />
      </div>
      {notificationsSupported && (
        <div className="flex h-8 items-center justify-between gap-3 border-b border-border px-3">
          <div className="text-xs text-text">Browser Alert</div>
          <Switch
            checked={browser}
            onChange={async (checked) => {
              if (checked && permission !== 'granted') {
                await requestPermission();
              } else {
                setBrowser(checked);
              }
            }}
            disabled={permission === 'denied'}
            label="Browser Alert"
          />
        </div>
      )}

      <div className="flex justify-end border-b border-border px-3 py-2">
        <button
          type="button"
          onClick={handleAddRule}
          className="h-7 rounded-sm bg-primary px-2.5 text-xs font-medium text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
        >
          Add Rule
        </button>
      </div>

      <h3 className={subHeader}>Active Rules</h3>
      {rules.length === 0 && (
        <div className="px-3 py-4 text-center text-xs text-muted">
          No rules active. Add a rule above.
        </div>
      )}
      {rules.map(rule => (
        <div key={rule.id} className="flex h-8 items-center justify-between gap-2 border-b border-border pl-3 pr-1 last:border-b-0 hover:bg-surface-secondary">
          <div className="min-w-0 truncate text-xs text-text">{rule.name}</div>
          <button
            type="button"
            onClick={() => handleDeleteRule(rule.id)}
            aria-label={`Delete ${rule.name}`}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-sm text-secondary transition-colors hover:bg-danger-soft hover:text-danger focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
          >
            <Trash size={14} />
          </button>
        </div>
      ))}
    </div>
  );
};
