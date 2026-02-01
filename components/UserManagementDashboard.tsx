import React, { useState, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { User, UserActivity } from '../types';
import { userService } from '../services/userService';
import UserStatsCards from './user-management/UserStatsCards';
import UserTable from './user-management/UserTable';
import AddEditUserModal from './user-management/AddEditUserModal';
import UserActivityModal from './user-management/UserActivityModal';
import { UserPlus, Search, RefreshCw } from 'lucide-react';

export const UserManagementDashboard: React.FC = () => {
    const [users, setUsers] = useState<User[]>([]);
    const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [isAddEditModalOpen, setIsAddEditModalOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const [activityModalUser, setActivityModalUser] = useState<{ id: string; name: string } | null>(null);
    const [userActivities, setUserActivities] = useState<UserActivity[]>([]);

    // Load users on mount
    useEffect(() => {
        loadUsers();
    }, []);

    // Filter users based on search query
    useEffect(() => {
        if (searchQuery.trim() === '') {
            setFilteredUsers(users);
        } else {
            const query = searchQuery.toLowerCase();
            setFilteredUsers(
                users.filter(
                    (user) =>
                        user.name.toLowerCase().includes(query) ||
                        user.email.toLowerCase().includes(query) ||
                        user.role.toLowerCase().includes(query)
                )
            );
        }
    }, [searchQuery, users]);

    const loadUsers = async () => {
        setLoading(true);
        try {
            const data = await userService.fetchUsers();
            setUsers(data);
        } catch (error) {
            console.error('Failed to load users:', error);
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

    const handleSaveUser = async (userData: Partial<User>) => {
        if (selectedUser) {
            // Update existing user
            await userService.updateUser(selectedUser.id, userData);
        } else {
            // Create new user
            await userService.createUser(userData);
        }
        await loadUsers();
    };

    const handleDeleteUser = async (userId: string) => {
        if (confirm('Are you sure you want to delete this user?')) {
            try {
                await userService.deleteUser(userId);
                await loadUsers();
            } catch (error) {
                console.error('Failed to delete user:', error);
            }
        }
    };

    const handleViewActivity = async (userId: string) => {
        const user = users.find((u) => u.id === userId);
        if (!user) return;

        try {
            const activities = await userService.fetchUserActivity(userId);
            setUserActivities(activities);
            setActivityModalUser({ id: userId, name: user.name });
        } catch (error) {
            console.error('Failed to load user activity:', error);
        }
    };

    return (
        <div className="flex flex-col gap-6 h-full">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
                        User Management
                    </h1>
                    <p className="text-sm text-gray-400 mt-1">Manage users, roles, and permissions</p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={loadUsers}
                        className="p-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors text-gray-400 hover:text-white"
                        title="Refresh"
                    >
                        <RefreshCw size={18} />
                    </button>
                    <button
                        onClick={handleAddUser}
                        className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 rounded-lg font-medium text-white transition-all"
                    >
                        <UserPlus size={18} />
                        Add User
                    </button>
                </div>
            </div>

            {/* Stats Cards */}
            <UserStatsCards users={users} />

            {/* Search Bar */}
            <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                    type="text"
                    placeholder="Search users by name, email, or role..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg pl-12 pr-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
            </div>

            {/* User Table */}
            <div className="flex-1 bg-white/5 border border-white/10 rounded-xl overflow-hidden backdrop-blur-sm">
                {loading ? (
                    <div className="flex items-center justify-center h-64">
                        <RefreshCw className="animate-spin text-purple-400" size={32} />
                    </div>
                ) : (
                    <UserTable
                        users={filteredUsers}
                        onEdit={handleEditUser}
                        onDelete={handleDeleteUser}
                        onViewActivity={handleViewActivity}
                    />
                )}
            </div>

            {/* Modals */}
            <AnimatePresence>
                {isAddEditModalOpen && (
                    <AddEditUserModal
                        user={selectedUser}
                        onClose={() => setIsAddEditModalOpen(false)}
                        onSave={handleSaveUser}
                    />
                )}

                {activityModalUser && (
                    <UserActivityModal
                        userId={activityModalUser.id}
                        userName={activityModalUser.name}
                        activities={userActivities}
                        onClose={() => setActivityModalUser(null)}
                    />
                )}
            </AnimatePresence>
        </div>
    );
};
