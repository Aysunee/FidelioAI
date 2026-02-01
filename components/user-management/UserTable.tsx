import React from 'react';
import { User, UserRole } from '../../types';
import { Edit2, Trash2, Activity, Mail, Shield } from 'lucide-react';

interface UserTableProps {
    users: User[];
    onEdit: (user: User) => void;
    onDelete: (userId: string) => void;
    onViewActivity: (userId: string) => void;
}

const UserTable: React.FC<UserTableProps> = ({ users, onEdit, onDelete, onViewActivity }) => {
    const getRoleBadgeColor = (role: UserRole) => {
        switch (role) {
            case 'admin': return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
            case 'trader': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
            case 'analyst': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
            case 'viewer': return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
            default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
        }
    };

    const formatDate = (timestamp: number) => {
        return new Date(timestamp).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return (
        <div className="overflow-x-auto">
            <table className="w-full">
                <thead>
                    <tr className="border-b border-white/10">
                        <th className="text-left py-3 px-4 text-xs font-bold text-gray-400 uppercase tracking-wider">User</th>
                        <th className="text-left py-3 px-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Email</th>
                        <th className="text-left py-3 px-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Role</th>
                        <th className="text-left py-3 px-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Status</th>
                        <th className="text-left py-3 px-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Last Login</th>
                        <th className="text-right py-3 px-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {users.map((user) => (
                        <tr key={user.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                            <td className="py-3 px-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-bold text-sm">
                                        {user.name.charAt(0).toUpperCase()}
                                    </div>
                                    <span className="font-medium text-white">{user.name}</span>
                                </div>
                            </td>
                            <td className="py-3 px-4">
                                <div className="flex items-center gap-2 text-gray-400">
                                    <Mail size={14} />
                                    <span className="text-sm">{user.email}</span>
                                </div>
                            </td>
                            <td className="py-3 px-4">
                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold border ${getRoleBadgeColor(user.role)}`}>
                                    <Shield size={12} />
                                    {user.role.toUpperCase()}
                                </span>
                            </td>
                            <td className="py-3 px-4">
                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold ${user.status === 'active'
                                        ? 'bg-emerald-500/20 text-emerald-400'
                                        : 'bg-gray-500/20 text-gray-400'
                                    }`}>
                                    <div className={`w-1.5 h-1.5 rounded-full ${user.status === 'active' ? 'bg-emerald-400' : 'bg-gray-400'}`} />
                                    {user.status.toUpperCase()}
                                </span>
                            </td>
                            <td className="py-3 px-4 text-sm text-gray-400">
                                {user.lastLogin ? formatDate(user.lastLogin) : 'Never'}
                            </td>
                            <td className="py-3 px-4">
                                <div className="flex items-center justify-end gap-2">
                                    <button
                                        onClick={() => onViewActivity(user.id)}
                                        className="p-2 hover:bg-white/10 rounded-lg transition-colors text-blue-400 hover:text-blue-300"
                                        title="View Activity"
                                    >
                                        <Activity size={16} />
                                    </button>
                                    <button
                                        onClick={() => onEdit(user)}
                                        className="p-2 hover:bg-white/10 rounded-lg transition-colors text-amber-400 hover:text-amber-300"
                                        title="Edit User"
                                    >
                                        <Edit2 size={16} />
                                    </button>
                                    <button
                                        onClick={() => onDelete(user.id)}
                                        className="p-2 hover:bg-white/10 rounded-lg transition-colors text-red-400 hover:text-red-300"
                                        title="Delete User"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {users.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                    <Shield size={48} className="mx-auto mb-3 opacity-20" />
                    <p className="text-sm">No users found</p>
                </div>
            )}
        </div>
    );
};

export default UserTable;
