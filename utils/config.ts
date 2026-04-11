// Helper to get the API base URL
// Use the current window hostname to ensure it works on local network devices
export const getApiBaseUrl = () => {
    // In production, use the environment variable VITE_API_URL
    if (import.meta.env.PROD) {
        return import.meta.env.VITE_API_URL || '';
    }
    // In development, use relative path (handled by Vite proxy)
    return '';
};

export const API_BASE_URL = getApiBaseUrl();

// Webhook backend URL (separate from the main API_BASE_URL above).
//
// The webhook backend is a parallel, isolated system that handles ONLY
// TradingView webhook alerts + Postgres-backed signal history. It runs in
// Docker on a dedicated Windows PC, public at https://gumruc.com.
//
// - In production, VITE_WEBHOOK_URL is set to https://gumruc.com
// - In development, if VITE_WEBHOOK_URL is not set, falls back to
//   API_BASE_URL so a single-backend local dev still works
//
// Spec: docs/superpowers/specs/2026-04-11-webhook-connection-design-amendment-01.md §C.1
export const WEBHOOK_API_URL =
    (import.meta.env.VITE_WEBHOOK_URL as string | undefined) || API_BASE_URL;
