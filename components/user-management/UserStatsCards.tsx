import React from 'react';
import { User, UserRole } from '../../types';

interface UserStatsCardsProps {
    users: User[];
}

const UserStatsCards: React.FC<UserStatsCardsProps> = ({ users }) => {
    const activeUsers = users.filter(u => u.status === 'active').length;
    const roleBreakdown = users.reduce((acc, user) => {
        acc[user.role] = (acc[user.role] || 0) + 1;
        return acc;
    }, {} as Record<UserRole, number>);

    const stats = [
        {
            label: 'Total Users',
            value: users.length,
            color: 'from-purple-500 to-blue-500',
            bgColor: 'bg-purple-500/10',
            borderColor: 'border-purple-500/20'
        },
        {
            label: 'Active Users',
            value: activeUsers,
            color: 'from-emerald-500 to-green-500',
            bgColor: 'bg-emerald-500/10',
            borderColor: 'border-emerald-500/20'
        },
        {
            label: 'Admins',
            value: roleBreakdown.admin || 0,
            color: 'from-amber-500 to-orange-500',
            bgColor: 'bg-amber-500/10',
            borderColor: 'border-amber-500/20'
        },
        {
            label: 'Traders',
            value: roleBreakdown.trader || 0,
            color: 'from-blue-500 to-cyan-500',
            bgColor: 'bg-blue-500/10',
            borderColor: 'border-blue-500/20'
        }
    ];

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {stats.map((stat, index) => (
                <div
                    key={index}
                    className={`${stat.bgColor} border ${stat.borderColor} rounded-xl p-4 backdrop-blur-sm`}
                >
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">
                                {stat.label}
                            </p>
                            <p className={`text-3xl font-black bg-gradient-to-r ${stat.color} bg-clip-text text-transparent`}>
                                {stat.value}
                            </p>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};

export default UserStatsCards;
