import React from 'react';
import { motion } from 'framer-motion';
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-gray-900 border border-white/10 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
            >
                <div className="bg-gray-900 border-b border-white/10 p-6 flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-bold text-white">User Activity</h2>
                        <p className="text-sm text-gray-400 mt-1">{userName}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-white/10 rounded-lg transition-colors text-gray-400 hover:text-white"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    {activities.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            <ActivityIcon size={48} className="mx-auto mb-3 opacity-20" />
                            <p className="text-sm">No activity recorded yet</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {activities.map((activity) => (
                                <div
                                    key={activity.id}
                                    className="bg-white/5 border border-white/10 rounded-lg p-4 hover:bg-white/10 transition-colors"
                                >
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex-1">
                                            <p className="text-white font-medium">{activity.action}</p>
                                            {activity.details && (
                                                <p className="text-sm text-gray-400 mt-1">{activity.details}</p>
                                            )}
                                        </div>
                                        <span className="text-xs text-gray-500 whitespace-nowrap">
                                            {formatDate(activity.timestamp)}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </motion.div>
        </div>
    );
};

export default UserActivityModal;
