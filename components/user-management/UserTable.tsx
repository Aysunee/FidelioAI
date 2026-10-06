import React from 'react';
import { User, UserRole } from '../../types';
import { Edit2, Trash2, Shield } from 'lucide-react';

interface UserTableProps {
    users: User[];
    onEdit: (user: User) => void;
    onDelete: (userId: string) => void;
}

const TH_CLASS = 'sticky top-0 z-10 h-7 whitespace-nowrap border-b border-border bg-surface px-3 text-[10px] font-medium uppercase tracking-wider text-muted';
const TD_CLASS = 'h-7 whitespace-nowrap border-b border-border px-3';
const ROW_BUTTON_CLASS = 'grid h-6 w-6 place-items-center rounded-sm text-secondary transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary';

// Dense user table. The parent panel owns the scrolling (both axes), so the header row can stay sticky.
const UserTable: React.FC<UserTableProps> = ({ users, onEdit, onDelete }) => {
    const getRoleBadgeColor = (role: UserRole) => {
        switch (role) {
            case 'admin': return 'bg-primary-soft text-primary';
            case 'trader': return 'bg-info-soft text-info';
            case 'analyst': return 'bg-warning-soft text-warning';
            case 'viewer': return 'bg-surface-secondary text-secondary';
            default: return 'bg-surface-secondary text-secondary';
        }
    };

    const formatDate = (timestamp: number) => {
        return new Date(timestamp).toLocaleDateString('tr-TR', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return (
        <div className="min-w-full">
            <table className="w-full border-separate border-spacing-0 text-xs">
                <thead>
                    <tr>
                        <th className={`${TH_CLASS} text-left`}>User</th>
                        <th className={`${TH_CLASS} text-left`}>Email</th>
                        <th className={`${TH_CLASS} text-left`}>Role</th>
                        <th className={`${TH_CLASS} text-left`}>Status</th>
                        <th className={`${TH_CLASS} text-left`}>Last Login</th>
                        <th className={`${TH_CLASS} text-right`}>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {users.map((user) => (
                        <tr key={user.id} className="hover:bg-surface-secondary">
                            <td className={TD_CLASS}>
                                <div className="flex items-center gap-2">
                                    <div className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary-soft text-[10px] font-semibold text-primary">
                                        {(user.name || user.username || '?').charAt(0).toUpperCase()}
                                    </div>
                                    <span className="font-medium text-text">{user.name || user.username}</span>
                                </div>
                            </td>
                            <td className={`${TD_CLASS} text-secondary`}>
                                {user.email}
                            </td>
                            <td className={TD_CLASS}>
                                <span className={`rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase ${getRoleBadgeColor(user.role)}`}>
                                    {user.role.toUpperCase()}
                                </span>
                            </td>
                            <td className={TD_CLASS}>
                                <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase ${user.status === 'active'
                                    ? 'text-success'
                                    : 'text-secondary'
                                    }`}>
                                    <span className={`h-1.5 w-1.5 rounded-full ${user.status === 'active' ? 'bg-success' : 'bg-muted'}`} />
                                    {user.status.toUpperCase()}
                                </span>
                            </td>
                            <td className={`${TD_CLASS} font-mono text-[11px] text-secondary`}>
                                {user.lastLogin ? formatDate(user.lastLogin) : <span className="font-sans text-muted">Hiç giriş yapmadı</span>}
                            </td>
                            <td className={TD_CLASS}>
                                <div className="flex items-center justify-end gap-1">
                                    <button
                                        onClick={() => onEdit(user)}
                                        className={`${ROW_BUTTON_CLASS} hover:bg-surface-highlight hover:text-text`}
                                        title="Edit User"
                                    >
                                        <Edit2 size={12} />
                                    </button>
                                    <button
                                        onClick={() => onDelete(user.id)}
                                        className={`${ROW_BUTTON_CLASS} hover:bg-danger-soft hover:text-danger`}
                                        title="Delete User"
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {users.length === 0 && (
                <div className="flex items-center justify-center gap-2 px-3 py-8 text-xs text-muted">
                    <Shield size={14} className="shrink-0" />
                    <p>Kullanıcı bulunamadı</p>
                </div>
            )}
        </div>
    );
};

export default UserTable;
