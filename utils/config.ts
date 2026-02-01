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
