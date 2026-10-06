// Notification utility for FidelioAI
// Handles browser notifications and sound alerts

export type NotificationPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

interface NotificationOptions {
    title: string;
    body: string;
    priority?: NotificationPriority;
    icon?: string;
    playSound?: boolean;
    tag?: string;
}

const isNotificationApiAvailable = (): boolean =>
    typeof window !== 'undefined' && 'Notification' in window;

const hasNotificationPermission = (): boolean => {
    if (!isNotificationApiAvailable()) return false;
    try {
        return Notification.permission === 'granted';
    } catch {
        return false;
    }
};

class NotificationManager {
    private audioContext: AudioContext | null = null;
    // Both default to off; SignalContext syncs them from the user's saved notification settings.
    private soundEnabled: boolean = false;
    private browserEnabled: boolean = false;

    // The permission prompt is only shown from requestPermission(), i.e. after a user click.
    constructor() { }

    async resumeAudioContext(): Promise<void> {
        const ctx = await this.getAudioContext();
        if (ctx && ctx.state === 'suspended') {
            try {
                await ctx.resume();
            } catch (e) {
                console.warn('Failed to resume AudioContext:', e);
            }
        }
    }

    private async getAudioContext(): Promise<AudioContext | null> {
        if (typeof window === 'undefined') return null;

        if (!this.audioContext) {
            try {
                const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
                if (AudioContextClass) {
                    this.audioContext = new AudioContextClass();
                }
            } catch (e) {
                console.warn('AudioContext not supported:', e);
                return null;
            }
        }

        if (this.audioContext && this.audioContext.state === 'suspended') {
            try {
                await this.audioContext.resume();
            } catch (e) {
                console.warn('Failed to resume AudioContext:', e);
            }
        }

        return this.audioContext;
    }

    // Must be called from a user gesture (button click).
    async requestPermission(): Promise<boolean> {
        if (!isNotificationApiAvailable()) return false;
        try {
            const permission = await Notification.requestPermission();
            // Also try to initialize audio on user interaction
            await this.getAudioContext();
            return permission === 'granted';
        } catch (e) {
            console.warn('Permission request failed:', e);
            return false;
        }
    }

    private async playBeep(frequency: number, duration: number, volume: number = 0.3) {
        if (!this.soundEnabled) return;

        const ctx = await this.getAudioContext();
        if (!ctx) return;

        try {
            const oscillator = ctx.createOscillator();
            const gainNode = ctx.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(ctx.destination);

            oscillator.frequency.value = frequency;
            oscillator.type = 'sine';

            gainNode.gain.setValueAtTime(volume, ctx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

            oscillator.start(ctx.currentTime);
            oscillator.stop(ctx.currentTime + duration);
        } catch (e) {
            console.warn('Failed to play sound:', e);
        }
    }

    private getSoundForPriority(priority: NotificationPriority) {
        switch (priority) {
            case 'CRITICAL':
                return { frequency: 1000, duration: 0.3, count: 3 };
            case 'HIGH':
                return { frequency: 800, duration: 0.2, count: 2 };
            case 'MEDIUM':
                return { frequency: 600, duration: 0.15, count: 1 };
            case 'LOW':
            default:
                return { frequency: 400, duration: 0.1, count: 1 };
        }
    }

    private async playPrioritySound(priority: NotificationPriority) {
        if (!this.soundEnabled) return;
        const sound = this.getSoundForPriority(priority);

        for (let i = 0; i < sound.count; i++) {
            this.playBeep(sound.frequency, sound.duration);
            if (i < sound.count - 1) {
                await new Promise(resolve => setTimeout(resolve, sound.duration * 1000 + 100));
            }
        }
    }

    async notify(options: NotificationOptions) {
        const priority = options.priority || 'MEDIUM';

        // Play sound (only when the user enabled sound alerts)
        if (options.playSound !== false) {
            await this.playPrioritySound(priority);
        }

        // Show browser notification only when the user enabled it AND the browser granted permission
        if (this.browserEnabled && hasNotificationPermission()) {
            try {
                const notification = new Notification(options.title, {
                    body: options.body,
                    icon: options.icon || '/fidelio-icon.png',
                    tag: options.tag || `fidelio-${Date.now()}`,
                    badge: '/fidelio-icon.png',
                    requireInteraction: priority === 'CRITICAL',
                });

                // Auto-close after delay based on priority
                if (priority !== 'CRITICAL') {
                    const closeDelay = priority === 'HIGH' ? 8000 : priority === 'MEDIUM' ? 5000 : 3000;
                    setTimeout(() => notification.close(), closeDelay);
                }

                return notification;
            } catch (e) {
                console.error('Failed to show notification:', e);
            }
        }

        return null;
    }

    setSoundEnabled(enabled: boolean) {
        this.soundEnabled = enabled;
        if (typeof window === 'undefined') return;
        try {
            localStorage.setItem('fidelio_sound_enabled', enabled.toString());
        } catch { /* storage unavailable */ }
    }

    setBrowserEnabled(enabled: boolean) {
        this.browserEnabled = enabled;
    }

    getSoundEnabled(): boolean {
        if (typeof window !== 'undefined') {
            try {
                const saved = localStorage.getItem('fidelio_sound_enabled');
                if (saved !== null) return saved === 'true';
            } catch { /* storage unavailable */ }
        }
        return this.soundEnabled;
    }

    getNotificationsEnabled(): boolean {
        return this.browserEnabled && hasNotificationPermission();
    }
}

// Singleton instance
export const notificationManager = new NotificationManager();

const baseAsset = (symbol: string) => symbol.replace('USDT', '');

const formatNotificationPrice = (price: number) => {
    if (!Number.isFinite(price)) return '—';
    if (Math.abs(price) >= 1) return price.toLocaleString('tr-TR', { maximumFractionDigits: 2 });
    return price.toPrecision(4);
};

// Accepts 'LOW' | 'MEDIUM' | 'HIGH' (and the legacy 'MID').
export const notifySignal = (symbol: string, type: string, level: string, price: number) => {
    const priority: NotificationPriority =
        level === 'HIGH' ? 'HIGH' : (level === 'MID' || level === 'MEDIUM') ? 'MEDIUM' : 'LOW';

    notificationManager.notify({
        title: `🎯 ${baseAsset(symbol)} sinyali`,
        body: `${type} · $${formatNotificationPrice(price)}`,
        priority,
        tag: `signal-${symbol}`,
    });
};

const BIG_MOVE_TYPE_LABELS: Record<string, string> = {
    RISE: 'Yükseliş',
    FALL: 'Düşüş',
    HIGH: '24s zirve',
    LOW: '24s dip',
    PULLBACK: 'Geri çekilme',
    RALLY: 'Toparlanma'
};

export const notifyBigMove = (symbol: string, type: string, changePercent: number, level: string) => {
    const priority: NotificationPriority = level === 'HIGH' ? 'CRITICAL' : level === 'MID' ? 'HIGH' : 'MEDIUM';
    const emoji = type === 'RISE' ? '🚀' : type === 'FALL' ? '📉' : '⚡';
    const label = BIG_MOVE_TYPE_LABELS[type] || type;
    const change = Math.abs(changePercent);

    notificationManager.notify({
        title: `${emoji} ${baseAsset(symbol)} sert hareket`,
        body: change > 0 ? `${label} %${change.toFixed(2)} · ${level} seviye` : `${label} · ${level} seviye`,
        priority,
        tag: `bigmove-${symbol}`,
    });
};

export const notifyPriceAlert = (symbol: string, targetPrice: number, currentPrice: number) => {
    notificationManager.notify({
        title: `🎯 Fiyat alarmı: ${baseAsset(symbol)}`,
        body: `Hedef $${formatNotificationPrice(targetPrice)} gerçekleşti. Güncel: $${formatNotificationPrice(currentPrice)}`,
        priority: 'HIGH',
        tag: `alert-${symbol}`,
    });
};
