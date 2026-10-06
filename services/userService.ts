import { User, Permission } from '../types';
import { apiJson, ApiError } from '../utils/config';

// All user-management calls go through apiJson: it attaches the Bearer token,
// handles 401 (session cleared + reload) and throws ApiError(message, status) on non-2xx.

const toTimestamp = (value: unknown): number | undefined => {
    if (value === null || value === undefined || value === '') return undefined;
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : undefined;
    const asNumber = Number(value);
    if (Number.isFinite(asNumber) && asNumber > 0) return asNumber;
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : undefined;
};

const toPermissions = (value: unknown): Permission[] => {
    if (Array.isArray(value)) return value.filter((p): p is Permission => typeof p === 'string');
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed.filter((p): p is Permission => typeof p === 'string') : [];
        } catch {
            return [];
        }
    }
    return [];
};

// Accepts both the camelCase contract and legacy snake_case rows so the UI never shows
// "Never" just because of a field-name mismatch.
export const normalizeUser = (raw: any): User => {
    const username = typeof raw?.username === 'string' ? raw.username : '';
    const name = raw?.name ?? raw?.fullName ?? raw?.full_name ?? username;
    return {
        ...raw,
        id: String(raw?.id ?? ''),
        name: typeof name === 'string' && name ? name : username,
        username,
        email: typeof raw?.email === 'string' ? raw.email : '',
        role: raw?.role ?? 'viewer',
        status: raw?.status === 'active' ? 'active' : 'inactive',
        permissions: toPermissions(raw?.permissions),
        createdAt: toTimestamp(raw?.createdAt ?? raw?.created_at) ?? 0,
        updatedAt: toTimestamp(raw?.updatedAt ?? raw?.updated_at) ?? 0,
        lastLogin: toTimestamp(raw?.lastLogin ?? raw?.last_login)
    };
};

const unwrapUser = (body: any): User => normalizeUser(body && typeof body === 'object' && body.user ? body.user : body);

const unwrapUserList = (body: any): User[] => {
    const list = Array.isArray(body) ? body : Array.isArray(body?.users) ? body.users : [];
    return list.map(normalizeUser);
};

// Turkish, user-facing description of a failed user-management request.
export const describeUserApiError = (error: unknown, fallback: string): string => {
    if (error instanceof ApiError) {
        // apiJson falls back to "İstek başarısız (status)" when the server sent no message.
        const hasServerMessage = !!error.message && !error.message.startsWith('İstek başarısız');
        if (error.status === 403 && !hasServerMessage) {
            return 'Bu işlem için yetkiniz yok. Yalnızca yöneticiler kullanıcıları yönetebilir.';
        }
        return hasServerMessage ? error.message : fallback;
    }
    return 'Sunucuya bağlanılamadı. Lütfen bağlantınızı kontrol edip tekrar deneyin.';
};

// currentPassword is required by the server when a user changes their own password.
export type UserUpdatePayload = Partial<User> & { currentPassword?: string };

const userPath = (id: string) => `/api/users/${encodeURIComponent(id)}`;

export const userService = {
    // Fetch all users (admin only)
    async fetchUsers(): Promise<User[]> {
        return unwrapUserList(await apiJson('/api/users'));
    },

    // Fetch single user
    async fetchUser(id: string): Promise<User> {
        return unwrapUser(await apiJson(userPath(id)));
    },

    // Create new user
    async createUser(userData: Partial<User>): Promise<User> {
        const body = await apiJson('/api/users', {
            method: 'POST',
            body: JSON.stringify(userData)
        });
        return unwrapUser(body);
    },

    // Update user
    async updateUser(id: string, updates: UserUpdatePayload): Promise<User> {
        const body = await apiJson(userPath(id), {
            method: 'PUT',
            body: JSON.stringify(updates)
        });
        return unwrapUser(body);
    },

    // Delete user
    async deleteUser(id: string): Promise<void> {
        await apiJson(userPath(id), { method: 'DELETE' });
    }
};
