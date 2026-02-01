import { User, UserActivity } from '../types';
import { API_BASE_URL } from '../utils/config';

const API_BASE = API_BASE_URL;

export const userService = {
    // Fetch all users
    async fetchUsers(): Promise<User[]> {
        try {
            const response = await fetch(`${API_BASE}/api/users`);
            if (!response.ok) throw new Error('Failed to fetch users');
            return await response.json();
        } catch (error) {
            console.error('Error fetching users:', error);
            throw error;
        }
    },

    // Fetch single user
    async fetchUser(id: string): Promise<User> {
        try {
            const response = await fetch(`${API_BASE}/api/users/${id}`);
            if (!response.ok) throw new Error('Failed to fetch user');
            return await response.json();
        } catch (error) {
            console.error('Error fetching user:', error);
            throw error;
        }
    },

    // Create new user
    async createUser(userData: Partial<User>): Promise<User> {
        try {
            const response = await fetch(`${API_BASE}/api/users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(userData)
            });
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to create user');
            }
            return await response.json();
        } catch (error) {
            console.error('Error creating user:', error);
            throw error;
        }
    },

    // Update user
    async updateUser(id: string, updates: Partial<User>): Promise<User> {
        try {
            const response = await fetch(`${API_BASE}/api/users/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to update user');
            }
            return await response.json();
        } catch (error) {
            console.error('Error updating user:', error);
            throw error;
        }
    },

    // Delete user
    async deleteUser(id: string): Promise<void> {
        try {
            const response = await fetch(`${API_BASE}/api/users/${id}`, {
                method: 'DELETE'
            });
            if (!response.ok) throw new Error('Failed to delete user');
        } catch (error) {
            console.error('Error deleting user:', error);
            throw error;
        }
    },

    // Fetch user activity
    async fetchUserActivity(id: string): Promise<UserActivity[]> {
        try {
            const response = await fetch(`${API_BASE}/api/users/${id}/activity`);
            if (!response.ok) throw new Error('Failed to fetch user activity');
            return await response.json();
        } catch (error) {
            console.error('Error fetching user activity:', error);
            throw error;
        }
    }
};
