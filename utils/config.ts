// Helper to get the API base URL
// Use the current window hostname to ensure it works on local network devices
export const getApiBaseUrl = () => {
    // In production, use the environment variable VITE_API_URL (empty = same origin)
    if (import.meta.env.PROD) {
        return import.meta.env.VITE_API_URL || '';
    }
    // In development, use the current hostname with port 3001
    if (typeof window !== 'undefined') {
        return `${window.location.protocol}//${window.location.hostname}:3001`;
    }
    return '';
};

export const API_BASE_URL = getApiBaseUrl();

// socket.io-client treats undefined as "same origin"
export const SOCKET_URL: string | undefined = API_BASE_URL || undefined;

export const TOKEN_KEY = 'fidelio_token';
export const USER_KEY = 'fidelio_user';

export const apiUrl = (endpoint: string) => `${API_BASE_URL}${endpoint}`;

export const getAuthToken = (): string | null => {
    if (typeof window === 'undefined') return null;
    try {
        return localStorage.getItem(TOKEN_KEY);
    } catch {
        return null;
    }
};

export const getAuthHeaders = (): Record<string, string> => {
    const token = getAuthToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
};

export class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
        super(message);
        this.status = status;
    }
}

// Helper to make authenticated API requests.
// 401 = token missing/expired/revoked -> clear session and reload to the login screen.
// 403 = authenticated but not allowed -> caller handles it (no logout).
export const apiRequest = async (endpoint: string, options: RequestInit = {}) => {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
        ...(options.headers as Record<string, string>)
    };

    const response = await fetch(apiUrl(endpoint), {
        ...options,
        headers
    });

    if (response.status === 401 && getAuthToken()) {
        try {
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem(USER_KEY);
        } catch { /* storage unavailable */ }
        if (typeof window !== 'undefined') window.location.reload();
        throw new ApiError('Oturum süresi doldu, lütfen tekrar giriş yapın.', 401);
    }

    return response;
};

// Convenience wrapper: parses JSON and throws ApiError with the server's message on non-2xx.
export const apiJson = async <T = any>(endpoint: string, options: RequestInit = {}): Promise<T> => {
    const response = await apiRequest(endpoint, options);
    let body: any = null;
    try {
        body = await response.json();
    } catch { /* empty body */ }
    if (!response.ok) {
        const message = (body && (body.error || body.message)) || `İstek başarısız (${response.status})`;
        throw new ApiError(message, response.status);
    }
    return body as T;
};
