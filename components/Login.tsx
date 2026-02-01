import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Lock, ArrowRight, AlertCircle, User } from 'lucide-react';
import { useUser } from '../context/UserContext';

export const Login: React.FC = () => {
    const { login } = useUser();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [shake, setShake] = useState(0);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const result = await login(username, password);
            if (result.success) {
                // Success is handled by context state change redirecting in App.tsx
            } else {
                setError(result.error || 'Invalid username or password');
                setShake(prev => prev + 1);
            }
        } catch (err) {
            setError('An unexpected error occurred');
        } finally {
            setLoading(false);
        }
    };

    // Diagnostic State
    const [diagStatus, setDiagStatus] = useState<{ status: string; url: string }>({ status: 'Checking...', url: '' });

    React.useEffect(() => {
        const checkHealth = async () => {
            // Dynamically import to ensure we get the client-side resolved URL
            const { API_BASE_URL } = await import('../utils/config');
            const healthUrl = `${API_BASE_URL}/health`;
            setDiagStatus(prev => ({ ...prev, url: API_BASE_URL }));

            try {
                const res = await fetch(healthUrl);
                if (res.ok) {
                    setDiagStatus({ status: 'Connected ✅', url: API_BASE_URL });
                } else {
                    setDiagStatus({ status: `Error ${res.status} ❌`, url: API_BASE_URL });
                }
            } catch (e: any) {
                setDiagStatus({ status: `Unreachable (${e.message}) ❌`, url: API_BASE_URL });
            }
        };
        checkHealth();
    }, []);

    return (
        <div className="min-h-screen flex items-center justify-center bg-black relative overflow-hidden">
            {/* Ambient Background */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-purple-900/20 rounded-full blur-[120px] animate-pulse"></div>
            </div>

            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5 }}
                className="relative z-10 w-full max-w-md p-8"
            >
                <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-8 shadow-2xl shadow-purple-900/20">
                    <div className="text-center mb-8">
                        <div className="w-16 h-16 mx-auto bg-gradient-to-br from-purple-600 to-amber-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-purple-500/30">
                            <Lock className="text-white" size={32} />
                        </div>
                        <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-amber-400 bg-clip-text text-transparent mb-2">
                            Fidelio
                        </h1>
                        <p className="text-gray-400 text-sm">Restricted Access</p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <motion.div
                            animate={{ x: error ? [0, -10, 10, -10, 10, 0] : 0 }}
                            key={shake}
                            transition={{ duration: 0.4 }}
                            className="space-y-4"
                        >
                            <div className="relative">
                                <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                <input
                                    type="text"
                                    value={username}
                                    onChange={(e) => {
                                        setUsername(e.target.value);
                                        setError('');
                                    }}
                                    placeholder="Username"
                                    className={`w-full bg-black/40 border ${error ? 'border-red-500/50' : 'border-white/10'} rounded-xl pl-12 pr-4 py-3 text-white outline-none focus:border-purple-500/50 transition-all placeholder:text-gray-600`}
                                    autoFocus
                                    disabled={loading}
                                />
                            </div>
                            <div className="relative">
                                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => {
                                        setPassword(e.target.value);
                                        setError('');
                                    }}
                                    placeholder="Password"
                                    className={`w-full bg-black/40 border ${error ? 'border-red-500/50' : 'border-white/10'} rounded-xl pl-12 pr-4 py-3 text-white outline-none focus:border-purple-500/50 transition-all placeholder:text-gray-600`}
                                    disabled={loading}
                                />
                            </div>
                        </motion.div>

                        {error && (
                            <div className="flex items-center justify-center gap-2 text-red-400 text-xs text-center px-4">
                                <AlertCircle size={12} className="shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-white text-black font-bold py-3 rounded-xl hover:bg-gray-200 transition-colors flex items-center justify-center gap-2 group disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <span>{loading ? 'Authenticating...' : 'Enter System'}</span>
                            {!loading && <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />}
                        </button>
                    </form>

                    {/* Connection Diagnostics */}
                    <div className="mt-8 pt-4 border-t border-white/5 text-center">
                        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">System Status</p>
                        <div className={`text-xs font-mono font-medium ${diagStatus.status.includes('Connected') ? 'text-emerald-400' : 'text-rose-400'}`}>
                            Backend: {diagStatus.status}
                        </div>
                        <div className="text-[9px] text-gray-600 mt-1 font-mono break-all">
                            Target: {diagStatus.url}
                        </div>
                    </div>
                </div>
            </motion.div>
        </div>
    );
};
