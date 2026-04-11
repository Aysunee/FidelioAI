import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { DEFAULT_WATCHLIST } from '../constants';
import { Language } from '../utils/translations';

type Theme = 'light' | 'dark' | 'corporate' | 'labs';
type ViewMode = 'dashboard' | 'funding' | 'signals-manager' | 'lab' | 'spot-scanner' | 'portfolio' | 'fidelio-ai' | 'radar' | 'journal' | 'database' | 'nexus' | 'user-management' | 'webhook';
type VisualMode = 'vibrant' | 'minimal';

interface UserContextType {
    theme: Theme;
    setTheme: (theme: Theme) => void;
    toggleTheme: () => void;
    viewMode: ViewMode;
    setViewMode: (mode: ViewMode) => void;
    watchlist: string[];
    addToWatchlist: (symbol: string) => void;
    removeFromWatchlist: (symbol: string) => void;
    isSettingsOpen: boolean;
    setIsSettingsOpen: (isOpen: boolean) => void;
    visualMode: VisualMode;
    toggleVisualMode: () => void;
    isAuthenticated: boolean;
    login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
    logout: () => void;
    language: Language;
    setLanguage: (lang: Language) => void;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    // Theme State
    const [theme, setTheme] = useState<Theme>(() => {
        if (typeof window !== 'undefined') {
            return (localStorage.getItem('fidelio_theme') as Theme) || 'corporate'; // Default to Corporate
        }
        return 'corporate';
    });

    // Visual Mode State
    const [visualMode, setVisualMode] = useState<VisualMode>(() => {
        if (typeof window !== 'undefined') {
            return (localStorage.getItem('fidelio_visual_mode') as VisualMode) || 'vibrant';
        }
        return 'vibrant';
    });

    // Watchlist State
    const [watchlist, setWatchlist] = useState<string[]>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('fidelio_watchlist');
            return saved ? JSON.parse(saved) : DEFAULT_WATCHLIST;
        }
        return DEFAULT_WATCHLIST;
    });

    // View Mode State
    const [viewMode, setViewMode] = useState<ViewMode>('dashboard');

    // Auth State
    const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('fidelio_auth') === 'true';
        }
        return false;
    });

    // Settings Modal State
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    // Language State
    const [language, setLanguage] = useState<Language>(() => {
        if (typeof window !== 'undefined') {
            return (localStorage.getItem('fidelio_language') as Language) || 'tr';
        }
        return 'tr';
    });

    // Persistence Effects
    useEffect(() => {
        const root = window.document.documentElement;
        root.classList.remove('light', 'dark', 'corporate', 'labs');
        root.classList.add(theme);
        localStorage.setItem('fidelio_theme', theme);
    }, [theme]);

    useEffect(() => {
        localStorage.setItem('fidelio_watchlist', JSON.stringify(watchlist));
    }, [watchlist]);

    useEffect(() => {
        localStorage.setItem('fidelio_visual_mode', visualMode);
    }, [visualMode]);

    useEffect(() => {
        localStorage.setItem('fidelio_language', language);
    }, [language]);

    // Handlers
    const handleSetTheme = (newTheme: Theme) => {
        setTheme(newTheme);
    };

    const toggleTheme = () => {
        setTheme(prev => {
            if (prev === 'light') return 'dark';
            if (prev === 'dark') return 'corporate';
            if (prev === 'corporate') return 'labs';
            return 'light';
        });
    };

    const toggleVisualMode = () => {
        setVisualMode(prev => prev === 'vibrant' ? 'minimal' : 'vibrant');
    };

    const addToWatchlist = (symbol: string) => {
        const formatted = symbol.toUpperCase();
        if (!watchlist.includes(formatted)) {
            setWatchlist(prev => [formatted, ...prev]);
        }
    };

    const removeFromWatchlist = (symbol: string) => {
        setWatchlist(prev => prev.filter(s => s !== symbol));
    };

    const login = async (username: string, password: string) => {
        try {
            const { API_BASE_URL } = await import('../utils/config');
            const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                return { success: false, error: err.error || 'Server rejected login' };
            }

            const data = await response.json();
            if (data.success) {
                setIsAuthenticated(true);
                localStorage.setItem('fidelio_auth', 'true');
                localStorage.setItem('fidelio_user', JSON.stringify(data.user));
                return { success: true };
            }
            return { success: false, error: 'Unknown login error' };
        } catch (error: any) {
            console.error("Login Error Details:", error);
            // This specifically catches Network Errors which usually mean connection refused or timeout
            return { success: false, error: `Connection Error: ${error.message} (Try ${window.location.protocol}//${window.location.hostname}:3001/health)` };
        }
    };

    const logout = () => {
        setIsAuthenticated(false);
        localStorage.removeItem('fidelio_auth');
        localStorage.removeItem('fidelio_user');
    };

    return (
        <UserContext.Provider value={{
            theme, setTheme: handleSetTheme, toggleTheme,
            viewMode, setViewMode,
            watchlist, addToWatchlist, removeFromWatchlist,
            isSettingsOpen, setIsSettingsOpen,
            visualMode, toggleVisualMode,
            isAuthenticated, login, logout,
            language, setLanguage
        }}>
            {children}
        </UserContext.Provider>
    );
};

export const useUser = () => {
    const context = useContext(UserContext);
    if (!context) {
        throw new Error('useUser must be used within a UserProvider');
    }
    return context;
};
