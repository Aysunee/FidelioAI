import React from 'react';
import { User, UserRole } from '../../types';

interface UserStatsCardsProps {
    users: User[];
}

// KPI strip: one row of cells separated by 1px lines (2x2 on narrow screens).
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
            color: 'text-text'
        },
        {
            label: 'Active Users',
            value: activeUsers,
            color: 'text-success'
        },
        {
            label: 'Admins',
            value: roleBreakdown.admin || 0,
            color: 'text-primary'
        },
        {
            label: 'Traders',
            value: roleBreakdown.trader || 0,
            color: 'text-info'
        }
    ];

    return (
        <div className="grid shrink-0 grid-cols-2 gap-px border-b border-border bg-border lg:grid-cols-4">
            {stats.map((stat, index) => (
                <div key={index} className="min-w-0 bg-surface px-3 py-2">
                    <p className="truncate text-[10px] uppercase tracking-wider text-muted">
                        {stat.label}
                    </p>
                    <p className={`font-mono text-base font-semibold ${stat.color}`}>
                        {stat.value}
                    </p>
                </div>
            ))}
        </div>
    );
};

export default UserStatsCards;
