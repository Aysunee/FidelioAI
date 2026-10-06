import React from 'react';
import { X, Activity as ActivityIcon } from 'lucide-react';
import { UserActivity } from '../../types';

interface UserActivityModalProps {
    userId: string;
    userName: string;
    activities: UserActivity[];
    onClose: () => void;
}

const UserActivityModal: React.FC<UserActivityModalProps> = ({ userId, userName, activities, onClose }) => {
    const formatDate = (timestamp: number) => {
        return new Date(timestamp).toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="flex max-h-[85vh] w-full max-w-2xl animate-overlay-in flex-col overflow-hidden rounded-sm border border-border-strong bg-surface shadow-overlay">
                <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-border pl-3 pr-1">
                    <div className="flex min-w-0 items-baseline gap-2">
                        <h2 className="shrink-0 text-xs font-semibold text-text">User Activity</h2>
                        <p className="truncate text-[11px] text-secondary">{userName}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-sm text-secondary transition-colors hover:bg-surface-secondary hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                    >
                        <X size={14} />
                    </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto">
                    {activities.length === 0 ? (
                        <div className="flex items-center justify-center gap-2 px-3 py-8 text-xs text-muted">
                            <ActivityIcon size={14} className="shrink-0" />
                            <p>No activity recorded yet</p>
                        </div>
                    ) : (
                        <div>
                            {activities.map((activity) => (
                                <div
                                    key={activity.id}
                                    className="flex items-start justify-between gap-4 border-b border-border px-3 py-1.5 hover:bg-surface-secondary"
                                >
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs font-medium text-text">{activity.action}</p>
                                        {activity.details && (
                                            <p className="text-[11px] text-secondary">{activity.details}</p>
                                        )}
                                    </div>
                                    <span className="whitespace-nowrap font-mono text-[11px] text-muted">
                                        {formatDate(activity.timestamp)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default UserActivityModal;
