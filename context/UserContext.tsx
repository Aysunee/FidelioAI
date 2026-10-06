import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { DEFAULT_WATCHLIST } from '../constants';
import { Language } from '../utils/translations';
import { apiUrl, TOKEN_KEY, USER_KEY } from '../utils/config';
import { readScoped, writeScoped } from '../utils/userStorage';

type Theme = 'light' | 'dark' | 'corporate' | 'labs';
export type ViewMode = 'dashboard' | 'funding' | 'signals-manager' | 'lab' | 'spot-scanner' | 'portfolio' | 'fidelio-ai' | 'radar' | 'journal' | 'database' | 'nexus' | 'user-management' | 'webhook' | 'terminal';
type VisualMode = 'vibrant' | 'minimal';
type UserRole = 'admin' | 'trader' | 'viewer' | 'analyst';

// Views that only admins may open. The server enforces the same rule on the endpoints behind them.
export const ADMIN_ONLY_VIEWS: readonly ViewMode[] = ['user-management', 'database', 'lab', 'webhook'];
export const isAdminOnlyView = (mode: ViewMode) => ADMIN_ONLY_VIEWS.includes(mode);

interface User {
    id: string;
    email: string;
    name: string;
    username: string;
    role: UserRole;
    status: 'active' | 'inactive';
    permissions: string[];
    createdAt?: number;
    updatedAt?: number;
    lastLogin?: number;
}

export type SessionUser = User;

// Why a session was ended by the app itself (shown on the login screen).
export type SessionEndReason = 'password-changed';
export type RefreshUserResult = 'ok' | 'invalid' | 'unavailable';

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
    isAuthChecking: boolean;
    isAdmin: boolean;
    user: User | null;
    token: string | null;
    login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
    logout: () => void;
    // Ends the session and shows the reason on the login screen (also survives a page reload).
    endSession: (reason: SessionEndReason) => void;
    sessionNotice: string | null;
    refreshUser: () => Promise<RefreshUserResult>;
    language: Language;
    setLanguage: (lang: Language) => void;
    getAuthHeaders: () => Record<string, string>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

// ---- Safe storage helpers (storage can be blocked, full or hold corrupt values) ----
const safeGet = (key: string): string | null => {
    if (typeof window === 'undefined') return null;
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
};

const safeSet = (key: string, value: string) => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(key, value);
    } catch { /* storage unavailable or full */ }
};

const safeRemove = (key: string) => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.removeItem(key);
    } catch { /* storage unavailable */ }
};

const clearStoredSession = () => {
    safeRemove(TOKEN_KEY);
    safeRemove(USER_KEY);
};

// ---- Session-end notice (sessionStorage, so it survives the reload done by apiRequest on 401) ----
const SESSION_NOTICE_KEY = 'fidelio_session_notice';
const SESSION_NOTICE_MESSAGES: Record<SessionEndReason, string> = {
    'password-changed': 'Şifreniz değiştirildi. Güvenliğiniz için oturumunuz kapatıldı; lütfen yeni şifrenizle tekrar giriş yapın.'
};

const readSessionNotice = (): string | null => {
    if (typeof window === 'undefined') return null;
    try {
        const reason = window.sessionStorage.getItem(SESSION_NOTICE_KEY);
        return reason && Object.prototype.hasOwnProperty.call(SESSION_NOTICE_MESSAGES, reason)
            ? SESSION_NOTICE_MESSAGES[reason as SessionEndReason]
            : null;
    } catch {
        return null;
    }
};

const writeSessionNotice = (reason: SessionEndReason | null) => {
    if (typeof window === 'undefined') return;
    try {
        if (reason) window.sessionStorage.setItem(SESSION_NOTICE_KEY, reason);
        else window.sessionStorage.removeItem(SESSION_NOTICE_KEY);
    } catch { /* storage unavailable */ }
};

// ---- User normalisation (accepts camelCase contract and legacy snake_case payloads) ----
const VALID_ROLES: UserRole[] = ['admin', 'trader', 'viewer', 'analyst'];

const toTimestamp = (value: unknown): number | undefined => {
    if (value === null || value === undefined || value === '') return undefined;
    const asNumber = Number(value);
    if (Number.isFinite(asNumber) && asNumber > 0) return asNumber;
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : undefined;
};

const normalizeSessionUser = (raw: unknown): User | null => {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, any>;
    if (r.id === undefined || r.id === null || r.id === '') return null;

    const username = typeof r.username === 'string' ? r.username : '';
    const name = [r.name, r.fullName, r.full_name, username].find(v => typeof v === 'string' && v.length > 0) || '';

    let permissions: unknown = r.permissions;
    if (typeof permissions === 'string') {
        try {
            permissions = JSON.parse(permissions);
        } catch {
            permissions = [];
        }
    }

    return {
        id: String(r.id),
        email: typeof r.email === 'string' ? r.email : '',
        name,
        username,
        // Unknown roles fall back to the least privileged one.
        role: VALID_ROLES.includes(r.role) ? r.role : 'viewer',
        status: r.status === 'inactive' ? 'inactive' : 'active',
        permissions: Array.isArray(permissions) ? permissions.filter((p): p is string => typeof p === 'string') : [],
        createdAt: toTimestamp(r.createdAt ?? r.created_at),
        updatedAt: toTimestamp(r.updatedAt ?? r.updated_at),
        lastLogin: toTimestamp(r.lastLogin ?? r.last_login)
    };
};

// The cached profile in localStorage can be edited by anyone with DevTools. Until the server has
// confirmed it (login response or a successful /api/auth/me) it only identifies the user and never
// grants privileges: role drops to the least privileged one and permissions are emptied.
const toUnverifiedUser = (cached: User): User => ({ ...cached, role: 'viewer', permissions: [] });

const readStoredSession = (): { token: string | null; user: User | null } => {
    const token = safeGet(TOKEN_KEY) || null;
    let user: User | null = null;
    const rawUser = safeGet(USER_KEY);
    if (rawUser) {
        try {
            user = normalizeSessionUser(JSON.parse(rawUser));
        } catch {
            user = null;
        }
        if (!user) safeRemove(USER_KEY);
    }
    return { token, user };
};

// ---- Per-user watchlist ----
const WATCHLIST_KEY = 'fidelio_watchlist';

const loadWatchlist = (userId: string | null): string[] => {
    if (!userId) return DEFAULT_WATCHLIST;
    const saved = readScoped<unknown>(WATCHLIST_KEY, userId, null);
    return Array.isArray(saved) ? saved.filter((s): s is string => typeof s === 'string') : DEFAULT_WATCHLIST;
};

// ---- Session validation against the server ----
const AUTH_CHECK_TIMEOUT_MS = 8000;
// While the role is unverified (server was unreachable at startup) /api/auth/me is retried in the background.
const ROLE_RETRY_INTERVAL_MS = 20000;

type CurrentUserResult =
    | { kind: 'ok'; user: User | null }
    | { kind: 'invalid' }       // token rejected -> session must be cleared
    | { kind: 'unavailable' };  // network error / timeout / 5xx -> keep the cached session

const fetchCurrentUser = async (authToken: string, signal?: AbortSignal): Promise<CurrentUserResult> => {
    try {
        const response = await fetch(apiUrl('/api/auth/me'), {
            headers: { Authorization: `Bearer ${authToken}` },
            signal
        });
        // 401 = missing/invalid/revoked token. Older servers answer 403/404 for an expired token or deleted user.
        if (response.status === 401 || response.status === 403 || response.status === 404) {
            return { kind: 'invalid' };
        }
        if (!response.ok) return { kind: 'unavailable' };
        const body = await response.json().catch(() => null);
        return { kind: 'ok', user: normalizeSessionUser(body && body.user ? body.user : body) };
    } catch {
        return { kind: 'unavailable' };
    }
};

// Same as fetchCurrentUser but gives up after AUTH_CHECK_TIMEOUT_MS (or when `outerSignal` aborts).
const fetchCurrentUserWithTimeout = async (authToken: string, outerSignal?: AbortSignal): Promise<CurrentUserResult> => {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const onOuterAbort = () => controller?.abort();
    outerSignal?.addEventListener('abort', onOuterAbort);
    const timer = setTimeout(() => controller?.abort(), AUTH_CHECK_TIMEOUT_MS);
    try {
        return await fetchCurrentUser(authToken, controller?.signal);
    } finally {
        clearTimeout(timer);
        outerSignal?.removeEventListener('abort', onOuterAbort);
    }
};

const loginErrorMessage = (status: number, body: any): string => {
    const serverMessage = body && typeof body.error === 'string' ? body.error : '';
    if (status === 400) return 'Kullanıcı adı ve şifre gereklidir.';
    if (status === 401) return 'Kullanıcı adı veya şifre hatalı.';
    if (status === 403) return 'Bu hesapla giriş yapılamıyor. Hesabınız devre dışı olabilir.';
    if (status === 429) return serverMessage || 'Çok fazla deneme yapıldı. Lütfen biraz bekleyip tekrar deneyin.';
    if (status >= 500) return 'Sunucu hatası. Lütfen daha sonra tekrar deneyin.';
    return serverMessage || 'Giriş yapılamadı. Lütfen tekrar deneyin.';
};

const AuthCheckingScreen: React.FC = () => (
    <div className="min-h-screen flex items-center justify-center bg-black" role="status" aria-live="polite">
        <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 rounded-full border-2 border-purple-500/30 border-t-purple-400 animate-spin" />
            <p className="text-sm text-gray-400">Oturum doğrulanıyor…</p>
        </div>
    </div>
);

export const UserProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    // Read the persisted session once (corrupt values are discarded instead of crashing the app).
    const [initialSession] = useState(readStoredSession);

    // Theme State
    const [theme, setTheme] = useState<Theme>(() => (safeGet('fidelio_theme') as Theme) || 'dark');

    // Visual Mode State
    const [visualMode, setVisualMode] = useState<VisualMode>(() => (safeGet('fidelio_visual_mode') as VisualMode) || 'vibrant');

    // View Mode State
    const [viewMode, setViewModeState] = useState<ViewMode>('dashboard');

    // Auth State with JWT
    const [token, setToken] = useState<string | null>(initialSession.token);
    // The cached profile is never trusted for privileges (see toUnverifiedUser).
    const [user, setUser] = useState<User | null>(() => initialSession.user ? toUnverifiedUser(initialSession.user) : null);
    // True only after the role came from the server (login response or a successful /api/auth/me).
    const [isRoleVerified, setIsRoleVerified] = useState(false);
    // While a stored token is being validated with /api/auth/me the app shows a loading screen.
    const [isAuthChecking, setIsAuthChecking] = useState<boolean>(() => !!initialSession.token);
    // Why the previous session was ended by the app (e.g. own password changed), shown on the login screen.
    const [sessionNotice, setSessionNotice] = useState<string | null>(readSessionNotice);

    // Watchlist State (scoped per user id)
    const [watchlistState, setWatchlistState] = useState<{ owner: string | null; items: string[] }>(() => {
        const owner = initialSession.user?.id ?? null;
        return { owner, items: loadWatchlist(owner) };
    });

    // Settings Modal State
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    // Language State
    const [language, setLanguage] = useState<Language>(() => (safeGet('fidelio_language') as Language) || 'tr');

    const userId = user?.id ?? null;
    const isAdmin = isRoleVerified && user?.role === 'admin';
    const isAuthenticated = !!token && !!user && !isAuthChecking;

    // Validate the stored token once on startup.
    useEffect(() => {
        const storedToken = initialSession.token;
        if (!storedToken) {
            setIsAuthChecking(false);
            return;
        }

        let cancelled = false;
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;

        fetchCurrentUserWithTimeout(storedToken, controller?.signal).then(result => {
            if (cancelled) return;
            if (result.kind === 'invalid') {
                clearStoredSession();
                setToken(null);
                setUser(null);
            } else if (result.kind === 'ok' && result.user) {
                // Role and profile come from the server, never from the cached copy.
                safeSet(USER_KEY, JSON.stringify(result.user));
                setUser(result.user);
                setIsRoleVerified(true);
            } else if (!initialSession.user) {
                // Server unreachable and no usable cached profile: the session cannot be restored.
                clearStoredSession();
                setToken(null);
            }
            // Otherwise (network error / timeout / 5xx) keep the cached session, but with the
            // unverified least-privileged role; the role is re-checked in the background below.
            setIsAuthChecking(false);
        });

        return () => {
            cancelled = true;
            controller?.abort();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Persistence Effects
    useEffect(() => {
        if (typeof document !== 'undefined') {
            const root = document.documentElement;
            root.classList.remove('light', 'dark', 'corporate', 'labs');
            root.classList.add(theme);
        }
        safeSet('fidelio_theme', theme);
    }, [theme]);

    // Load the logged-in user's own watchlist whenever the user changes.
    useEffect(() => {
        setWatchlistState(prev => prev.owner === userId ? prev : { owner: userId, items: loadWatchlist(userId) });
    }, [userId]);

    // Persist the watchlist under its owner's key only (nothing is written while logged out).
    useEffect(() => {
        if (watchlistState.owner) {
            writeScoped(WATCHLIST_KEY, watchlistState.owner, watchlistState.items);
        }
    }, [watchlistState]);

    useEffect(() => {
        safeSet('fidelio_visual_mode', visualMode);
    }, [visualMode]);

    useEffect(() => {
        safeSet('fidelio_language', language);
    }, [language]);

    // Non-admins can never stay on an admin-only view (e.g. after logout/login as another user).
    useEffect(() => {
        if (!isAdmin && isAdminOnlyView(viewMode)) {
            setViewModeState('dashboard');
        }
    }, [isAdmin, viewMode]);

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

    const setViewMode = useCallback((mode: ViewMode) => {
        if (isAdminOnlyView(mode) && !isAdmin) return;
        setViewModeState(mode);
    }, [isAdmin]);

    const addToWatchlist = (symbol: string) => {
        const formatted = symbol.toUpperCase();
        setWatchlistState(prev => prev.items.includes(formatted) ? prev : { ...prev, items: [formatted, ...prev.items] });
    };

    const removeFromWatchlist = (symbol: string) => {
        setWatchlistState(prev => ({ ...prev, items: prev.items.filter(s => s !== symbol) }));
    };

    // Get auth headers for API requests
    const getAuthHeaders = (): Record<string, string> => {
        if (token) {
            return { 'Authorization': `Bearer ${token}` };
        }
        return {};
    };

    const login = async (username: string, password: string) => {
        let response: Response;
        try {
            response = await fetch(apiUrl('/api/auth/login'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
        } catch {
            return { success: false, error: 'Sunucuya bağlanılamadı. Lütfen daha sonra tekrar deneyin.' };
        }

        const data = await response.json().catch(() => null);
        if (!response.ok) {
            return { success: false, error: loginErrorMessage(response.status, data) };
        }

        const newToken = data && typeof data.token === 'string' && data.token ? data.token : null;
        const newUser = normalizeSessionUser(data?.user);
        if (!newToken || !newUser) {
            return { success: false, error: 'Sunucudan geçersiz yanıt alındı. Lütfen tekrar deneyin.' };
        }

        // Persist synchronously so requests fired by freshly mounted views already carry the token.
        safeSet(TOKEN_KEY, newToken);
        safeSet(USER_KEY, JSON.stringify(newUser));
        writeSessionNotice(null);
        setSessionNotice(null);
        setViewModeState('dashboard');
        setToken(newToken);
        setUser(newUser);
        setIsRoleVerified(true);
        return { success: true };
    };

    // Logout only ends the session; per-user data stays stored under that user's id.
    const logout = useCallback(() => {
        clearStoredSession();
        setToken(null);
        setUser(null);
        setIsRoleVerified(false);
        setViewModeState('dashboard');
    }, []);

    // Ends the session for a reason the user must be told about on the login screen.
    const endSession = useCallback((reason: SessionEndReason) => {
        writeSessionNotice(reason);
        setSessionNotice(SESSION_NOTICE_MESSAGES[reason]);
        logout();
    }, [logout]);

    // Re-load the current user's profile/role from the server (e.g. after editing your own account).
    // 'invalid' means the session was ended (logout already done).
    const refreshUser = useCallback(async (): Promise<RefreshUserResult> => {
        const currentToken = token || safeGet(TOKEN_KEY);
        if (!currentToken) return 'invalid';
        const result = await fetchCurrentUserWithTimeout(currentToken);
        if (result.kind === 'invalid') {
            logout();
            return 'invalid';
        }
        if (result.kind === 'ok' && result.user) {
            safeSet(USER_KEY, JSON.stringify(result.user));
            setUser(result.user);
            setIsRoleVerified(true);
            return 'ok';
        }
        return 'unavailable';
    }, [token, logout]);

    // Session kept from the cache because the server was unreachable at startup: keep asking the
    // server until the real role is known (or the token turns out to be invalid).
    useEffect(() => {
        if (isAuthChecking || isRoleVerified || !token || !userId) return;

        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;

        const attempt = async () => {
            const result = await fetchCurrentUserWithTimeout(token, controller?.signal);
            if (cancelled) return;
            if (result.kind === 'invalid') {
                logout();
            } else if (result.kind === 'ok' && result.user) {
                safeSet(USER_KEY, JSON.stringify(result.user));
                setUser(result.user);
                setIsRoleVerified(true);
            } else {
                timer = setTimeout(attempt, ROLE_RETRY_INTERVAL_MS);
            }
        };
        timer = setTimeout(attempt, ROLE_RETRY_INTERVAL_MS);

        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
            controller?.abort();
        };
    }, [isAuthChecking, isRoleVerified, token, userId, logout]);

    return (
        <UserContext.Provider value={{
            theme, setTheme: handleSetTheme, toggleTheme,
            viewMode, setViewMode,
            watchlist: watchlistState.items, addToWatchlist, removeFromWatchlist,
            isSettingsOpen, setIsSettingsOpen,
            visualMode, toggleVisualMode,
            isAuthenticated, isAuthChecking, isAdmin,
            user, token, login, logout, endSession, sessionNotice, refreshUser,
            language, setLanguage,
            getAuthHeaders
        }}>
            {isAuthChecking ? <AuthCheckingScreen /> : children}
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
