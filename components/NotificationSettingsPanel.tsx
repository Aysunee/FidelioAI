import React from 'react';
import { Bell, BellOff, Volume2, VolumeX, AlertTriangle, Info } from 'lucide-react';
import { useSignals } from '../context/SignalContext';
import { useUser } from '../context/UserContext';
import { translations } from '../utils/translations';

export const NotificationSettingsPanel: React.FC = () => {
    const { notificationSettings, updateNotificationSettings, requestNotificationPermission } = useSignals();
    const { language } = useUser();
    const t = translations[language];

    const handleEnableBrowserNotifications = async () => {
        if (!notificationSettings.browserNotificationsEnabled) {
            await requestNotificationPermission();
        } else {
            updateNotificationSettings({ browserNotificationsEnabled: false });
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
                <Bell size={18} className="text-purple-400" />
                <h3 className="font-bold text-lg">{t.notificationSettings}</h3>
            </div>

            {/* Sound Toggle */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
                <div className="flex items-center gap-3">
                    {notificationSettings.soundEnabled ? (
                        <Volume2 size={18} className="text-emerald-400" />
                    ) : (
                        <VolumeX size={18} className="text-gray-500" />
                    )}
                    <div>
                        <div className="font-medium text-sm">{t.soundAlerts}</div>
                        <div className="text-xs text-gray-500">{t.soundDesc}</div>
                    </div>
                </div>
                <button
                    onClick={() => updateNotificationSettings({ soundEnabled: !notificationSettings.soundEnabled })}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${notificationSettings.soundEnabled ? 'bg-emerald-500' : 'bg-gray-600'
                        }`}
                >
                    <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${notificationSettings.soundEnabled ? 'translate-x-6' : 'translate-x-1'
                            }`}
                    />
                </button>
            </div>

            {/* Browser Notifications Toggle */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
                <div className="flex items-center gap-3">
                    {notificationSettings.browserNotificationsEnabled ? (
                        <Bell size={18} className="text-purple-400" />
                    ) : (
                        <BellOff size={18} className="text-gray-500" />
                    )}
                    <div>
                        <div className="font-medium text-sm">{t.browserNotifications}</div>
                        <div className="text-xs text-gray-500">{t.browserDesc}</div>
                    </div>
                </div>
                <button
                    onClick={handleEnableBrowserNotifications}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${notificationSettings.browserNotificationsEnabled ? 'bg-purple-500' : 'bg-gray-600'
                        }`}
                >
                    <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${notificationSettings.browserNotificationsEnabled ? 'translate-x-6' : 'translate-x-1'
                            }`}
                    />
                </button>
            </div>

            {/* Notify on Big Moves */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
                <div className="flex items-center gap-3">
                    <AlertTriangle size={18} className="text-amber-400" />
                    <div>
                        <div className="font-medium text-sm">{t.bigMoveAlerts}</div>
                        <div className="text-xs text-gray-500">{t.bigMoveDesc}</div>
                    </div>
                </div>
                <button
                    onClick={() => updateNotificationSettings({ notifyOnBigMoves: !notificationSettings.notifyOnBigMoves })}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${notificationSettings.notifyOnBigMoves ? 'bg-amber-500' : 'bg-gray-600'
                        }`}
                >
                    <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${notificationSettings.notifyOnBigMoves ? 'translate-x-6' : 'translate-x-1'
                            }`}
                    />
                </button>
            </div>

            {/* Notify on Signals */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
                <div className="flex items-center gap-3">
                    <Info size={18} className="text-cyan-400" />
                    <div>
                        <div className="font-medium text-sm">{t.signalAlerts}</div>
                        <div className="text-xs text-gray-500">{t.signalDesc}</div>
                    </div>
                </div>
                <button
                    onClick={() => updateNotificationSettings({ notifyOnSignals: !notificationSettings.notifyOnSignals })}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${notificationSettings.notifyOnSignals ? 'bg-cyan-500' : 'bg-gray-600'
                        }`}
                >
                    <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${notificationSettings.notifyOnSignals ? 'translate-x-6' : 'translate-x-1'
                            }`}
                    />
                </button>
            </div>

            {/* Priority Level */}
            <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                <div className="font-medium text-sm mb-3">{t.minPriority}</div>
                <div className="flex gap-2">
                    {(['LOW', 'MEDIUM', 'HIGH'] as const).map((level) => (
                        <button
                            key={level}
                            onClick={() => updateNotificationSettings({ minPriorityLevel: level })}
                            className={`flex-1 py-2 px-3 rounded-md text-xs font-bold transition-all ${notificationSettings.minPriorityLevel === level
                                ? level === 'HIGH'
                                    ? 'bg-rose-500 text-white'
                                    : level === 'MEDIUM'
                                        ? 'bg-amber-500 text-white'
                                        : 'bg-emerald-500 text-white'
                                : 'bg-white/5 text-gray-500 hover:bg-white/10'
                                }`}
                        >
                            {level}
                        </button>
                    ))}
                </div>
                <div className="text-xs text-gray-500 mt-2">
                    {t.priorityDesc}
                </div>
            </div>

            {/* Telegram Alerts */}
            <div className="p-3 rounded-lg bg-white/5 border border-white/10 animate-in slide-in-from-right-4">
                <div className="flex items-center gap-2 mb-3">
                    <div className="p-1.5 bg-sky-500/20 rounded">
                        <svg className="w-4 h-4 text-sky-400" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.48-1.05-2.23-1.55-1.09-.73-.39-1.13.24-1.79.16-.17 2.94-2.7 2.99-2.94 0-.03.01-.13-.05-.18-.06-.05-.15-.07-.33-.03-.23.04-3.92 2.48-4.08 2.59-.72.33-1.37.35-2.02.17-.67-.21-1.34-.44-1.34-.44s.99-.41 1.63-.61c3.96-1.2 6.79-2 7.79-2.34.42-.14 1.12.3 2.8 1.45z" />
                        </svg>
                    </div>
                    <div>
                        <div className="font-bold text-sm text-sky-400">{t.telegramAlerts}</div>
                        <div className="text-[10px] text-gray-400">{t.telegramDesc}</div>
                    </div>
                </div>

                <div className="space-y-3">
                    <div>
                        <label className="text-[10px] text-gray-500 uppercase font-bold">{t.botToken}</label>
                        <input
                            type="password"
                            placeholder="123456789:ABCdef..."
                            value={notificationSettings.telegramBotToken || ''}
                            onChange={(e) => updateNotificationSettings({ telegramBotToken: e.target.value })}
                            className="w-full bg-black/20 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-300 focus:border-sky-500/50 outline-none transition-all"
                        />
                    </div>
                    <div>
                        <label className="text-[10px] text-gray-500 uppercase font-bold">{t.chatId}</label>
                        <input
                            type="text"
                            placeholder="-100123456..."
                            value={notificationSettings.telegramChatId || ''}
                            onChange={(e) => updateNotificationSettings({ telegramChatId: e.target.value })}
                            className="w-full bg-black/20 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-300 focus:border-sky-500/50 outline-none transition-all"
                        />
                    </div>

                    <button
                        onClick={async () => {
                            if (!notificationSettings.telegramBotToken || !notificationSettings.telegramChatId) {
                                alert(language === 'tr' ? 'Lütfen Bot Token ve Chat ID girin.' : 'Please enter Bot Token and Chat ID.');
                                return;
                            }

                            try {
                                const response = await fetch('http://localhost:3001/api/forward', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        url: `https://api.telegram.org/bot${notificationSettings.telegramBotToken}/sendMessage`,
                                        method: 'POST',
                                        body: {
                                            chat_id: notificationSettings.telegramChatId,
                                            text: language === 'tr' ? "🚀 FidelioAI: Test Mesajı Başarılı!" : "🚀 FidelioAI: Test Message Successful!",
                                            parse_mode: 'Markdown'
                                        }
                                    })
                                });
                                if (response.ok) alert(language === 'tr' ? 'Test Mesajı Gönderildi!' : 'Test Message Sent!');
                                else alert(language === 'tr' ? 'Test mesajı gönderilemedi.' : 'Failed to send test message.');
                            } catch (e) {
                                alert(language === 'tr' ? 'Proxy bağlantı hatası' : 'Error connection to Proxy');
                            }
                        }}
                        className={`w-full py-1.5 rounded textxs font-bold transition-all ${notificationSettings.telegramBotToken && notificationSettings.telegramChatId
                            ? 'bg-sky-600 hover:bg-sky-500 text-white shadow-lg shadow-sky-500/20'
                            : 'bg-white/5 text-gray-600 cursor-not-allowed'
                            }`}
                    >
                        {t.testConnection}
                    </button>

                    <div className="text-[9px] text-gray-500 leading-relaxed bg-black/20 p-3 rounded border border-white/5 space-y-2">
                        <div className="font-bold text-gray-400 border-b border-white/5 pb-1 mb-1">{t.howToConnect}</div>
                        <div>
                            <span className="text-sky-400 font-bold">1. Create Bot:</span> Open Telegram and search for <b className="text-white">@BotFather</b>. Send the message <code className="bg-white/10 px-1 rounded">/newbot</code>. Follow the steps to name your bot. It will give you a <b className="text-white">HTTP API Token</b>. Paste it above.
                        </div>
                        <div>
                            <span className="text-sky-400 font-bold">2. Get Chat ID:</span> Search for <b className="text-white">@userinfobot</b> and click Start. It will send you your <b className="text-white">Id</b>. Paste it above.
                        </div>
                        <div>
                            <span className="text-sky-400 font-bold">3. Start Your Bot:</span> Find your new bot in Telegram search and click <b>Start</b> so it can message you.
                        </div>
                    </div>
                </div>
            </div>

            {/* Info Box */}
            <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30">
                <div className="flex gap-2">
                    <Info size={16} className="text-blue-400 shrink-0 mt-0.5" />
                    <div className="text-xs text-gray-300">
                        <p className="font-medium mb-1">{t.soundPriorityLevels}:</p>
                        <ul className="space-y-1 text-gray-400">
                            <li>• <span className="text-rose-400">HIGH</span>: 3 beeps (1000Hz)</li>
                            <li>• <span className="text-amber-400">MEDIUM</span>: 2 beeps (800Hz)</li>
                            <li>• <span className="text-emerald-400">LOW</span>: 1 beep (600Hz)</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};
