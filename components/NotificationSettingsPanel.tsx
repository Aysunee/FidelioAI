import React, { useState } from 'react';
import { Bell, BellOff, Volume2, VolumeX, AlertTriangle, Info } from 'lucide-react';
import { useSignals } from '../context/SignalContext';
import { useUser } from '../context/UserContext';
import { translations } from '../utils/translations';
import { apiJson, ApiError } from '../utils/config';
import { Switch } from './ui/Switch';

// iOS Safari (non-PWA tab) and some in-app WebViews do not expose the Notification API.
const isBrowserNotificationSupported = () =>
    typeof window !== 'undefined' && 'Notification' in window;

export const NotificationSettingsPanel: React.FC = () => {
    const { notificationSettings, updateNotificationSettings, requestNotificationPermission } = useSignals();
    const { language } = useUser();
    const t = translations[language];
    const isTr = language === 'tr';
    const [telegramTesting, setTelegramTesting] = useState(false);
    const browserNotificationsSupported = isBrowserNotificationSupported();
    const canTestTelegram = !!(notificationSettings.telegramBotToken && notificationSettings.telegramChatId) && !telegramTesting;

    const handleTelegramTest = async () => {
        const botToken = notificationSettings.telegramBotToken?.trim();
        const chatId = notificationSettings.telegramChatId?.trim();
        if (!botToken || !chatId) {
            alert(isTr ? 'Lütfen Bot Token ve Chat ID girin.' : 'Please enter Bot Token and Chat ID.');
            return;
        }

        setTelegramTesting(true);
        try {
            await apiJson('/api/notify/telegram', {
                method: 'POST',
                body: JSON.stringify({
                    botToken,
                    chatId,
                    text: isTr ? '🚀 FidelioAI: Test mesajı başarılı!' : '🚀 FidelioAI: Test Message Successful!'
                })
            });
            alert(isTr ? 'Test mesajı gönderildi!' : 'Test Message Sent!');
        } catch (e) {
            const detail = e instanceof ApiError ? e.message : (isTr ? 'Sunucuya ulaşılamadı.' : 'Could not reach the server.');
            alert(`${isTr ? 'Test mesajı gönderilemedi' : 'Failed to send test message'}: ${detail}`);
        } finally {
            setTelegramTesting(false);
        }
    };

    const handleEnableBrowserNotifications = async () => {
        if (!notificationSettings.browserNotificationsEnabled) {
            await requestNotificationPermission();
        } else {
            updateNotificationSettings({ browserNotificationsEnabled: false });
        }
    };

    const priorityActiveClass = (level: 'LOW' | 'MEDIUM' | 'HIGH') =>
        level === 'HIGH' ? 'bg-danger-soft text-danger' : level === 'MEDIUM' ? 'bg-warning-soft text-warning' : 'bg-success-soft text-success';

    // Flat settings section: a sub-header row followed by full-width rows separated by 1px lines.
    const subHeader = 'flex h-7 items-center gap-1.5 border-b border-border bg-surface-secondary px-3 text-[10px] font-semibold uppercase tracking-wider text-muted';
    const row = 'flex items-center justify-between gap-3 border-b border-border px-3 py-2';
    const rowTitle = 'text-xs font-medium text-text';
    const rowDesc = 'text-[11px] text-muted';
    const fieldLabel = 'mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted';
    const field = 'h-7 w-full rounded-sm border border-border bg-surface-secondary px-2 font-mono text-xs text-text outline-none placeholder:text-muted focus:border-primary';

    return (
        <div>
            <h3 lang={language} className={subHeader}>
                <Bell size={12} />
                {t.notificationSettings}
            </h3>

            {/* Sound Toggle */}
            <div className={row}>
                <div className="flex min-w-0 items-center gap-2">
                    {notificationSettings.soundEnabled ? (
                        <Volume2 size={14} className="shrink-0 text-secondary" />
                    ) : (
                        <VolumeX size={14} className="shrink-0 text-muted" />
                    )}
                    <div className="min-w-0">
                        <div className={rowTitle}>{t.soundAlerts}</div>
                        <div className={rowDesc}>{t.soundDesc}</div>
                    </div>
                </div>
                <Switch
                    checked={notificationSettings.soundEnabled}
                    onChange={() => updateNotificationSettings({ soundEnabled: !notificationSettings.soundEnabled })}
                    label={t.soundAlerts}
                />
            </div>

            {/* Browser Notifications Toggle */}
            <div className={row}>
                <div className="flex min-w-0 items-center gap-2">
                    {notificationSettings.browserNotificationsEnabled ? (
                        <Bell size={14} className="shrink-0 text-secondary" />
                    ) : (
                        <BellOff size={14} className="shrink-0 text-muted" />
                    )}
                    <div className="min-w-0">
                        <div className={rowTitle}>{t.browserNotifications}</div>
                        <div className={rowDesc}>
                            {browserNotificationsSupported
                                ? t.browserDesc
                                : (isTr ? 'Bu tarayıcı bildirimleri desteklemiyor (iPhone: Ana Ekrana Ekle ile yükleyin).' : 'This browser does not support notifications (iPhone: install via Add to Home Screen).')}
                        </div>
                    </div>
                </div>
                <Switch
                    checked={notificationSettings.browserNotificationsEnabled && browserNotificationsSupported}
                    onChange={() => { void handleEnableBrowserNotifications(); }}
                    disabled={!browserNotificationsSupported}
                    label={t.browserNotifications}
                />
            </div>

            {/* Notify on Big Moves */}
            <div className={row}>
                <div className="flex min-w-0 items-center gap-2">
                    <AlertTriangle size={14} className="shrink-0 text-secondary" />
                    <div className="min-w-0">
                        <div className={rowTitle}>{t.bigMoveAlerts}</div>
                        <div className={rowDesc}>{t.bigMoveDesc}</div>
                    </div>
                </div>
                <Switch
                    checked={notificationSettings.notifyOnBigMoves}
                    onChange={() => updateNotificationSettings({ notifyOnBigMoves: !notificationSettings.notifyOnBigMoves })}
                    label={t.bigMoveAlerts}
                />
            </div>

            {/* Notify on Signals */}
            <div className={row}>
                <div className="flex min-w-0 items-center gap-2">
                    <Info size={14} className="shrink-0 text-secondary" />
                    <div className="min-w-0">
                        <div className={rowTitle}>{t.signalAlerts}</div>
                        <div className={rowDesc}>{t.signalDesc}</div>
                    </div>
                </div>
                <Switch
                    checked={notificationSettings.notifyOnSignals}
                    onChange={() => updateNotificationSettings({ notifyOnSignals: !notificationSettings.notifyOnSignals })}
                    label={t.signalAlerts}
                />
            </div>

            {/* Priority Level */}
            <div className={row}>
                <div className="min-w-0">
                    <div className={rowTitle}>{t.minPriority}</div>
                    <div className={rowDesc}>{t.priorityDesc}</div>
                </div>
                <div className="inline-flex shrink-0 rounded-sm border border-border p-0.5">
                    {(['LOW', 'MEDIUM', 'HIGH'] as const).map((level) => (
                        <button
                            key={level}
                            type="button"
                            onClick={() => updateNotificationSettings({ minPriorityLevel: level })}
                            aria-pressed={notificationSettings.minPriorityLevel === level}
                            className={`h-6 rounded-sm px-2 text-[11px] font-medium transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary ${notificationSettings.minPriorityLevel === level
                                ? priorityActiveClass(level)
                                : 'text-secondary hover:text-text'
                                }`}
                        >
                            {level}
                        </button>
                    ))}
                </div>
            </div>

            {/* Sound priority legend */}
            <div className="flex items-start gap-2 border-b border-border px-3 py-2 text-[11px] text-muted">
                <Info size={12} className="mt-0.5 shrink-0" />
                <div>
                    <p className="font-medium text-secondary">{t.soundPriorityLevels}:</p>
                    <ul className="mt-0.5 space-y-0.5 font-mono">
                        <li>• <span className="text-danger">HIGH</span>: 3 beeps (1000Hz)</li>
                        <li>• <span className="text-warning">MEDIUM</span>: 2 beeps (800Hz)</li>
                        <li>• <span className="text-success">LOW</span>: 1 beep (600Hz)</li>
                    </ul>
                </div>
            </div>

            {/* Telegram Alerts */}
            <h3 lang={language} className={`${subHeader} justify-between`}>
                <span className="flex min-w-0 items-center gap-1.5">
                    <svg className="h-3 w-3 shrink-0 text-info" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.48-1.05-2.23-1.55-1.09-.73-.39-1.13.24-1.79.16-.17 2.94-2.7 2.99-2.94 0-.03.01-.13-.05-.18-.06-.05-.15-.07-.33-.03-.23.04-3.92 2.48-4.08 2.59-.72.33-1.37.35-2.02.17-.67-.21-1.34-.44-1.34-.44s.99-.41 1.63-.61c3.96-1.2 6.79-2 7.79-2.34.42-.14 1.12.3 2.8 1.45z" />
                    </svg>
                    <span className="truncate">{t.telegramAlerts}</span>
                </span>
                <span className="truncate font-normal normal-case tracking-normal">{t.telegramDesc}</span>
            </h3>

            <div className="grid grid-cols-1 gap-2 border-b border-border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                <div>
                    <label lang={language} className={fieldLabel}>{t.botToken}</label>
                    <input
                        type="password"
                        placeholder="123456789:ABCdef..."
                        value={notificationSettings.telegramBotToken || ''}
                        onChange={(e) => updateNotificationSettings({ telegramBotToken: e.target.value })}
                        className={field}
                    />
                </div>
                <div>
                    <label lang={language} className={fieldLabel}>{t.chatId}</label>
                    <input
                        type="text"
                        placeholder="-100123456..."
                        value={notificationSettings.telegramChatId || ''}
                        onChange={(e) => updateNotificationSettings({ telegramChatId: e.target.value })}
                        className={field}
                    />
                </div>

                <button
                    type="button"
                    onClick={handleTelegramTest}
                    disabled={!canTestTelegram}
                    className={`h-7 whitespace-nowrap rounded-sm px-2.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary ${canTestTelegram
                        ? 'bg-primary text-primary-contrast hover:opacity-90'
                        : 'cursor-not-allowed border border-border bg-surface-secondary text-muted'
                        }`}
                >
                    {telegramTesting ? (isTr ? 'Gönderiliyor...' : 'Sending...') : t.testConnection}
                </button>
            </div>

            <div className="space-y-1 border-b border-border px-3 py-2 text-[11px] leading-relaxed text-muted">
                <div className="font-medium text-secondary">{t.howToConnect}</div>
                {isTr ? (
                    <>
                        <div>
                            <span className="font-medium text-secondary">1. Bot oluşturun:</span> Telegram'da <b className="font-medium text-text">@BotFather</b> hesabını aratın ve <code className="rounded-sm bg-surface-secondary px-1 font-mono">/newbot</code> mesajını gönderin. Adımları izleyerek botunuza isim verin. Size verilen <b className="font-medium text-text">HTTP API Token</b> değerini yukarıya yapıştırın.
                        </div>
                        <div>
                            <span className="font-medium text-secondary">2. Chat ID alın:</span> <b className="font-medium text-text">@userinfobot</b> hesabını aratıp Başlat'a dokunun. Size gönderilen <b className="font-medium text-text">Id</b> değerini yukarıya yapıştırın.
                        </div>
                        <div>
                            <span className="font-medium text-secondary">3. Botunuzu başlatın:</span> Yeni botunuzu Telegram'da bulup <b className="font-medium">Başlat</b>'a dokunun; böylece bot size mesaj gönderebilir.
                        </div>
                    </>
                ) : (
                    <>
                        <div>
                            <span className="font-medium text-secondary">1. Create Bot:</span> Open Telegram and search for <b className="font-medium text-text">@BotFather</b>. Send the message <code className="rounded-sm bg-surface-secondary px-1 font-mono">/newbot</code>. Follow the steps to name your bot. It will give you a <b className="font-medium text-text">HTTP API Token</b>. Paste it above.
                        </div>
                        <div>
                            <span className="font-medium text-secondary">2. Get Chat ID:</span> Search for <b className="font-medium text-text">@userinfobot</b> and click Start. It will send you your <b className="font-medium text-text">Id</b>. Paste it above.
                        </div>
                        <div>
                            <span className="font-medium text-secondary">3. Start Your Bot:</span> Find your new bot in Telegram search and click <b className="font-medium">Start</b> so it can message you.
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};
