import React, { useState, useEffect } from 'react';
import { User } from '../types';
import { userService, describeUserApiError } from '../services/userService';
import { useUser } from '../context/UserContext';
import UserStatsCards from './user-management/UserStatsCards';
import UserTable from './user-management/UserTable';
import AddEditUserModal, { UserSavePayload } from './user-management/AddEditUserModal';
import { UserPlus, Search, RefreshCw, AlertCircle, ShieldOff } from 'lucide-react';

export const UserManagementDashboard: React.FC = () => {
    const { user: currentUser, isAdmin, refreshUser, endSession } = useUser();
    const [users, setUsers] = useState<User[]>([]);
    const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [isAddEditModalOpen, setIsAddEditModalOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState<User | null>(null);

    // Load users on mount (admins only; the server rejects everyone else anyway)
    useEffect(() => {
        if (isAdmin) loadUsers();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAdmin]);

    // Filter users based on search query
    useEffect(() => {
        if (searchQuery.trim() === '') {
            setFilteredUsers(users);
        } else {
            const query = searchQuery.toLowerCase();
            setFilteredUsers(
                users.filter(
                    (user) =>
                        (user.name || '').toLowerCase().includes(query) ||
                        (user.username || '').toLowerCase().includes(query) ||
                        (user.email || '').toLowerCase().includes(query) ||
                        (user.role || '').toLowerCase().includes(query)
                )
            );
        }
    }, [searchQuery, users]);

    const loadUsers = async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const data = await userService.fetchUsers();
            setUsers(data);
        } catch (error) {
            console.error('Failed to load users:', error);
            setLoadError(describeUserApiError(error, 'Kullanıcı listesi yüklenemedi.'));
        } finally {
            setLoading(false);
        }
    };

    const handleAddUser = () => {
        setSelectedUser(null);
        setIsAddEditModalOpen(true);
    };

    const handleEditUser = (user: User) => {
        setSelectedUser(user);
        setIsAddEditModalOpen(true);
    };

    const handleSaveUser = async (userData: UserSavePayload) => {
        setActionError(null);
        if (selectedUser) {
            // Update existing user
            await userService.updateUser(selectedUser.id, userData);
            if (currentUser && selectedUser.id === currentUser.id) {
                // The server binds every token to the password hash, so changing your own password
                // ends this session: go to the login screen with an explanation instead of a silent 401.
                if (userData.password) {
                    endSession('password-changed');
                    return;
                }
                // Editing your own account may change your name or role: reload the session profile.
                if ((await refreshUser()) === 'invalid') return;
            }
        } else {
            // Create new user
            await userService.createUser(userData);
        }
        await loadUsers();
    };

    const handleDeleteUser = async (userId: string) => {
        const target = users.find((u) => u.id === userId);
        const label = target ? ` (${target.name || target.username})` : '';
        const confirmed = typeof window !== 'undefined'
            && window.confirm(`Bu kullanıcıyı${label} silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`);
        if (!confirmed) return;

        setActionError(null);
        try {
            await userService.deleteUser(userId);
            await loadUsers();
        } catch (error) {
            console.error('Failed to delete user:', error);
            setActionError(describeUserApiError(error, 'Kullanıcı silinemedi.'));
        }
    };

    if (!isAdmin) {
        return (
            <div className="flex h-full min-h-[120px] w-full flex-1 items-center justify-center gap-2 bg-surface px-3 text-center text-xs text-muted">
                <ShieldOff size={14} className="shrink-0" aria-hidden="true" />
                <p>Bu sayfayı yalnızca yöneticiler görüntüleyebilir.</p>
            </div>
        );
    }

    return (
        <section className="flex h-full min-h-0 w-full flex-1 flex-col bg-surface">
            {/* Header */}
            <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
                <div className="flex min-w-0 items-baseline gap-2">
                    <h1 className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-secondary">
                        User Management
                    </h1>
                    <p className="hidden truncate text-[11px] text-muted md:block">Manage users, roles, and permissions</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <button
                        onClick={loadUsers}
                        className="grid h-6 w-6 place-items-center rounded-sm text-secondary transition-colors hover:bg-surface-secondary hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                        title="Refresh"
                    >
                        <RefreshCw size={14} />
                    </button>
                    <button
                        onClick={handleAddUser}
                        className="flex h-6 items-center gap-1.5 rounded-sm bg-primary px-2 text-[11px] font-medium text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                    >
                        <UserPlus size={12} />
                        Add User
                    </button>
                </div>
            </header>

            {/* Stats */}
            <UserStatsCards users={users} />

            {/* Errors from delete actions or a failed refresh while data is already shown */}
            {(actionError || (loadError && users.length > 0)) && (
                <div role="alert" className="flex shrink-0 items-start gap-2 border-b border-border bg-danger-soft px-3 py-1.5 text-[11px] text-danger">
                    <AlertCircle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span>{actionError || loadError}</span>
                </div>
            )}

            {/* Search Bar */}
            <div className="flex shrink-0 items-center border-b border-border px-3 py-1">
                <div className="relative w-full sm:max-w-sm">
                    <Search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" size={12} />
                    <input
                        type="text"
                        placeholder="Search users by name, email, or role..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="h-7 w-full rounded-sm border border-border bg-surface-secondary pl-7 pr-2 text-xs text-text outline-none placeholder:text-muted focus:border-primary"
                    />
                </div>
            </div>

            {/* User Table */}
            <div className="min-h-0 flex-1 overflow-auto">
                {loading ? (
                    <div className="flex h-full min-h-[96px] items-center justify-center">
                        <RefreshCw className="animate-spin text-muted" size={14} />
                    </div>
                ) : loadError && users.length === 0 ? (
                    <div role="alert" className="flex h-full min-h-[96px] flex-col items-center justify-center gap-2 px-3 text-center">
                        <p className="flex items-center gap-2 text-xs text-danger">
                            <AlertCircle size={14} className="shrink-0" aria-hidden="true" />
                            {loadError}
                        </p>
                        <button
                            onClick={loadUsers}
                            className="h-7 rounded-sm border border-border bg-surface-secondary px-2.5 text-xs font-medium text-text transition-colors hover:bg-surface-highlight focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                        >
                            Tekrar dene
                        </button>
                    </div>
                ) : (
                    <UserTable
                        users={filteredUsers}
                        onEdit={handleEditUser}
                        onDelete={handleDeleteUser}
                    />
                )}
            </div>

            {/* Modals */}
            {isAddEditModalOpen && (
                <AddEditUserModal
                    user={selectedUser}
                    isSelf={!!currentUser && !!selectedUser && selectedUser.id === currentUser.id}
                    onClose={() => setIsAddEditModalOpen(false)}
                    onSave={handleSaveUser}
                />
            )}
        </section>
    );
};
