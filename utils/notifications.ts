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

class NotificationManager {
    private audioContext: AudioContext | null = null;
    private soundEnabled: boolean = true;
    private notificationsEnabled: boolean = false;

    constructor() {
        this.checkNotificationPermission();
        // AudioContext is initialized lazily on first user interaction/sound play
    }

    async resumeAudioContext(): Promise<void> {
        const ctx = await this.getAudioContext();
        if (ctx && ctx.state === 'suspended') {
            try {
                await ctx.resume();
                console.log('🔊 AudioContext resumed via user gesture');
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

    private async checkNotificationPermission() {
        if (typeof window !== 'undefined' && 'Notification' in window) {
            if (Notification.permission === 'granted') {
                this.notificationsEnabled = true;
            } else if (Notification.permission !== 'denied') {
                try {
                    const permission = await Notification.requestPermission();
                    this.notificationsEnabled = permission === 'granted';
                } catch (e) {
                    console.warn('Notification permission request failed:', e);
                }
            }
        }
    }

    async requestPermission(): Promise<boolean> {
        if (typeof window !== 'undefined' && 'Notification' in window) {
            try {
                const permission = await Notification.requestPermission();
                this.notificationsEnabled = permission === 'granted';

                // Also try to initialize audio on user interaction
                await this.getAudioContext();

                return this.notificationsEnabled;
            } catch (e) {
                console.warn('Permission request failed:', e);
                return false;
            }
        }
        return false;
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
                return { frequency: 400, duration: 0.1, count: 1 };
        }
    }

    private async playPrioritySound(priority: NotificationPriority) {
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

        // Play sound
        if (options.playSound !== false) {
            await this.playPrioritySound(priority);
        }

        // Show browser notification
        if (this.notificationsEnabled && 'Notification' in window) {
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
        localStorage.setItem('fidelio_sound_enabled', enabled.toString());
    }

    getSoundEnabled(): boolean {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('fidelio_sound_enabled');
            return saved !== null ? saved === 'true' : true;
        }
        return this.soundEnabled;
    }

    getNotificationsEnabled(): boolean {
        return this.notificationsEnabled;
    }
}

// Singleton instance
export const notificationManager = new NotificationManager();

// Helper functions
export const notifySignal = (symbol: string, type: string, level: string, price: number) => {
    const priority: NotificationPriority = level === 'HIGH' ? 'HIGH' : level === 'MID' ? 'MEDIUM' : 'LOW';

    notificationManager.notify({
        title: `🎯 ${symbol.replace('USDT', '')} Signal`,
        body: `${type} - ${level} level at $${price.toFixed(2)}`,
        priority,
        tag: `signal-${symbol}`,
    });
};

export const notifyBigMove = (symbol: string, type: string, changePercent: number, level: string) => {
    const priority: NotificationPriority = level === 'HIGH' ? 'CRITICAL' : level === 'MID' ? 'HIGH' : 'MEDIUM';
    const emoji = type === 'RISE' ? '🚀' : type === 'FALL' ? '📉' : '⚡';

    notificationManager.notify({
        title: `${emoji} ${symbol.replace('USDT', '')} Big Move!`,
        body: `${type} ${Math.abs(changePercent).toFixed(2)}% - ${level} level`,
        priority,
        tag: `bigmove-${symbol}`,
    });
};

export const notifyPriceAlert = (symbol: string, targetPrice: number, currentPrice: number) => {
    notificationManager.notify({
        title: `🎯 Price Alert: ${symbol.replace('USDT', '')}`,
        body: `Target $${targetPrice} reached! Current: $${currentPrice}`,
        priority: 'HIGH',
        tag: `alert-${symbol}`,
    });
};
