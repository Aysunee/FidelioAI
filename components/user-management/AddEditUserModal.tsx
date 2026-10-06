import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { User, UserRole, Permission } from '../../types';
import { describeUserApiError, UserUpdatePayload } from '../../services/userService';

export type UserSavePayload = UserUpdatePayload;

interface AddEditUserModalProps {
    user?: User | null;
    // True when the admin is editing their own account (password change then needs the current password).
    isSelf?: boolean;
    onClose: () => void;
    onSave: (userData: UserSavePayload) => Promise<void>;
}

const ROLE_OPTIONS: UserRole[] = ['admin', 'trader', 'analyst', 'viewer'];
const PERMISSION_OPTIONS: Permission[] = [
    'view_dashboard',
    'manage_trades',
    'manage_users',
    'view_analytics',
    'manage_settings'
];

const INPUT_CLASS = 'h-7 w-full rounded-sm border border-border bg-surface-secondary px-2 text-xs text-text placeholder:text-muted outline-none focus:border-primary';
const LABEL_CLASS = 'mb-1 block text-[11px] text-secondary';

const AddEditUserModal: React.FC<AddEditUserModalProps> = ({ user, isSelf = false, onClose, onSave }) => {
    const [formData, setFormData] = useState({
        name: user?.name || '',
        username: user?.username || '',
        email: user?.email || '',
        password: '',
        currentPassword: '',
        role: user?.role || 'viewer' as UserRole,
        status: user?.status || 'active' as 'active' | 'inactive',
        permissions: user?.permissions || [] as Permission[]
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const dialogRef = useRef<HTMLDivElement>(null);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    // Escape closes the dialog; focus moves into it on open and back to the opener on close.
    // Runs once per mount (onClose is read through a ref, so an inline callback does not re-run it).
    useEffect(() => {
        if (typeof document === 'undefined') return;
        const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialogRef.current?.focus();
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCloseRef.current();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
        };
    }, []);

    const needsCurrentPassword = !!user && isSelf && formData.password.length > 0;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (needsCurrentPassword && !formData.currentPassword) {
            setError('Kendi şifrenizi değiştirmek için mevcut şifrenizi girin.');
            return;
        }

        const payload: UserSavePayload = {
            name: formData.name,
            username: formData.username,
            email: formData.email,
            role: formData.role,
            status: formData.status,
            permissions: formData.permissions
        };
        // An empty password on edit means "keep the current one".
        if (formData.password) payload.password = formData.password;
        if (needsCurrentPassword) payload.currentPassword = formData.currentPassword;

        setLoading(true);
        try {
            await onSave(payload);
            onClose();
        } catch (err) {
            setError(describeUserApiError(err, 'Kullanıcı kaydedilemedi.'));
        } finally {
            setLoading(false);
        }
    };

    const togglePermission = (permission: Permission) => {
        setFormData(prev => ({
            ...prev,
            permissions: prev.permissions.includes(permission)
                ? prev.permissions.filter(p => p !== permission)
                : [...prev.permissions, permission]
        }));
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="user-modal-title"
                tabIndex={-1}
                className="flex max-h-[85vh] w-full max-w-xl animate-overlay-in flex-col overflow-hidden rounded-sm border border-border-strong bg-surface shadow-overlay outline-none"
            >
                <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border pl-3 pr-1">
                    <h2 id="user-modal-title" className="min-w-0 truncate text-xs font-semibold text-text">
                        {user ? 'Edit User' : 'Add New User'}
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Kapat"
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-sm text-secondary transition-colors hover:bg-surface-secondary hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                    >
                        <X size={14} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
                    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                        {error && (
                            <div role="alert" className="rounded-sm bg-danger-soft px-2 py-1.5 text-[11px] text-danger">
                                {error}
                            </div>
                        )}

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div>
                                <label htmlFor="user-name" className={LABEL_CLASS}>
                                    Name *
                                </label>
                                <input
                                    id="user-name"
                                    type="text"
                                    required
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    className={INPUT_CLASS}
                                    placeholder="John Doe"
                                />
                            </div>

                            <div>
                                <label htmlFor="user-username" className={LABEL_CLASS}>
                                    Username *
                                </label>
                                <input
                                    id="user-username"
                                    type="text"
                                    required
                                    value={formData.username}
                                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                                    className={INPUT_CLASS}
                                    placeholder="johndoe"
                                />
                            </div>

                            <div>
                                <label htmlFor="user-email" className={LABEL_CLASS}>
                                    Email *
                                </label>
                                <input
                                    id="user-email"
                                    type="email"
                                    required
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    className={INPUT_CLASS}
                                    placeholder="john@example.com"
                                />
                            </div>

                            <div>
                                <label htmlFor="user-password" className={LABEL_CLASS}>
                                    Password {!user && '*'}
                                </label>
                                <input
                                    id="user-password"
                                    type="password"
                                    required={!user}
                                    value={formData.password}
                                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                    className={INPUT_CLASS}
                                    autoComplete="new-password"
                                    placeholder={user ? "Leave blank to keep current" : "Enter password"}
                                />
                            </div>

                            {needsCurrentPassword && (
                                <div className="sm:col-span-2">
                                    <label htmlFor="user-current-password" className={LABEL_CLASS}>
                                        Mevcut şifre *
                                    </label>
                                    <input
                                        id="user-current-password"
                                        type="password"
                                        required
                                        autoComplete="current-password"
                                        value={formData.currentPassword}
                                        onChange={(e) => setFormData({ ...formData, currentPassword: e.target.value })}
                                        className={INPUT_CLASS}
                                        placeholder="Kendi şifrenizi değiştirmek için gerekli"
                                        aria-describedby="user-current-password-hint"
                                    />
                                    <p id="user-current-password-hint" className="mt-1 text-[11px] text-warning">
                                        Şifreniz değiştiğinde güvenliğiniz için oturumunuz kapatılır; kaydettikten sonra yeni şifrenizle tekrar giriş yapmanız gerekir.
                                    </p>
                                </div>
                            )}

                            <div>
                                <label htmlFor="user-role" className={LABEL_CLASS}>
                                    Role *
                                </label>
                                <select
                                    id="user-role"
                                    value={formData.role}
                                    onChange={(e) => setFormData({ ...formData, role: e.target.value as UserRole })}
                                    className={INPUT_CLASS}
                                >
                                    {ROLE_OPTIONS.map(role => (
                                        <option key={role} value={role} className="bg-surface text-text">
                                            {role.charAt(0).toUpperCase() + role.slice(1)}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <span id="user-status-label" className={LABEL_CLASS}>
                                    Status
                                </span>
                                <div className="flex h-7 rounded-sm border border-border p-0.5" role="group" aria-labelledby="user-status-label">
                                    <button
                                        type="button"
                                        aria-pressed={formData.status === 'active'}
                                        onClick={() => setFormData({ ...formData, status: 'active' })}
                                        className={`flex-1 rounded-sm px-2 text-[11px] font-medium transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary ${formData.status === 'active'
                                            ? 'bg-success-soft text-success'
                                            : 'text-secondary hover:text-text'
                                            }`}
                                    >
                                        Active
                                    </button>
                                    <button
                                        type="button"
                                        aria-pressed={formData.status === 'inactive'}
                                        onClick={() => setFormData({ ...formData, status: 'inactive' })}
                                        className={`flex-1 rounded-sm px-2 text-[11px] font-medium transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary ${formData.status === 'inactive'
                                            ? 'bg-surface-highlight text-text'
                                            : 'text-secondary hover:text-text'
                                            }`}
                                    >
                                        Inactive
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="border-t border-border pt-3">
                            <span id="user-permissions-label" className={LABEL_CLASS}>
                                Permissions
                            </span>
                            <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2" role="group" aria-labelledby="user-permissions-label">
                                {PERMISSION_OPTIONS.map(permission => (
                                    <label
                                        key={permission}
                                        className="flex h-7 cursor-pointer items-center gap-2 rounded-sm px-1 transition-colors hover:bg-surface-secondary"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={formData.permissions.includes(permission)}
                                            onChange={() => togglePermission(permission)}
                                            className="h-3.5 w-3.5 accent-primary"
                                        />
                                        <span className="text-xs text-text">
                                            {permission.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-3 py-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="h-7 rounded-sm border border-border bg-surface-secondary px-2.5 text-xs font-medium text-text transition-colors hover:bg-surface-highlight focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="h-7 rounded-sm bg-primary px-2.5 text-xs font-medium text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {loading ? 'Saving...' : user ? 'Update User' : 'Create User'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AddEditUserModal;
