import React, { useState } from 'react';
import { Lock, ArrowRight, AlertCircle, Info, User } from 'lucide-react';
import { useUser } from '../context/UserContext';
import { apiUrl } from '../utils/config';

export const Login: React.FC = () => {
    const { login, sessionNotice } = useUser();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [shake, setShake] = useState(0);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (loading) return;
        setError('');

        if (!username.trim() || !password) {
            setError('Kullanıcı adı ve şifre gereklidir.');
            setShake(prev => prev + 1);
            return;
        }

        setLoading(true);
        try {
            const result = await login(username.trim(), password);
            if (!result.success) {
                // Success is handled by the context state change (App.tsx renders the dashboard).
                setError(result.error || 'Kullanıcı adı veya şifre hatalı.');
                setShake(prev => prev + 1);
            }
        } catch {
            setError('Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.');
        } finally {
            setLoading(false);
        }
    };

    // Connection status is a development aid only: it is never shown in production builds
    // and never reveals the backend address.
    const showDiagnostics = import.meta.env.DEV;
    const [backendStatus, setBackendStatus] = useState<'checking' | 'ok' | 'error'>('checking');

    React.useEffect(() => {
        if (!showDiagnostics) return;
        let cancelled = false;
        fetch(apiUrl('/health'))
            .then(res => { if (!cancelled) setBackendStatus(res.ok ? 'ok' : 'error'); })
            .catch(() => { if (!cancelled) setBackendStatus('error'); });
        return () => { cancelled = true; };
    }, [showDiagnostics]);

    const inputClass = (hasError: boolean) =>
        `h-8 w-full rounded-sm border bg-surface-secondary pl-8 pr-2 text-xs text-text outline-none transition-colors placeholder:text-muted focus:border-primary disabled:opacity-60 ${hasError ? 'border-danger' : 'border-border'}`;

    return (
        // A centred 320px flat panel on the app background (tokens follow the saved theme).
        <div className="flex min-h-dvh items-center justify-center bg-background p-4 text-text">
            <div className="w-full max-w-[320px] border border-border bg-surface">
                <div className="flex h-10 items-center justify-between gap-2 border-b border-border px-3">
                    <h1 className="text-gradient-violet text-sm font-bold uppercase tracking-wide">
                        Fidelio
                    </h1>
                    <p lang="tr" className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted">
                        <Lock size={12} aria-hidden="true" />
                        Yetkili Erişim
                    </p>
                </div>

                {/* Why the previous session ended (e.g. own password changed); cleared on the next successful login */}
                {sessionNotice && (
                    <div role="status" className="flex items-start gap-2 border-b border-border bg-warning-soft px-3 py-2 text-[11px] leading-snug text-warning">
                        <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                        <span>{sessionNotice}</span>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-2 p-3" noValidate>
                    {/* Re-keyed on every failed attempt so the username field takes the focus again. */}
                    <div key={shake} className="space-y-2">
                        <div className="relative">
                            <label htmlFor="login-username" className="sr-only">Kullanıcı adı</label>
                            <User className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" size={14} aria-hidden="true" />
                            <input
                                id="login-username"
                                name="username"
                                type="text"
                                autoComplete="username"
                                autoCapitalize="none"
                                autoCorrect="off"
                                spellCheck={false}
                                aria-invalid={!!error}
                                aria-describedby={error ? 'login-error' : undefined}
                                value={username}
                                onChange={(e) => {
                                    setUsername(e.target.value);
                                    setError('');
                                }}
                                placeholder="Kullanıcı adı"
                                className={inputClass(!!error)}
                                autoFocus
                                disabled={loading}
                            />
                        </div>
                        <div className="relative">
                            <label htmlFor="login-password" className="sr-only">Şifre</label>
                            <Lock className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" size={14} aria-hidden="true" />
                            <input
                                id="login-password"
                                name="password"
                                type="password"
                                autoComplete="current-password"
                                aria-invalid={!!error}
                                aria-describedby={error ? 'login-error' : undefined}
                                value={password}
                                onChange={(e) => {
                                    setPassword(e.target.value);
                                    setError('');
                                }}
                                placeholder="Şifre"
                                className={inputClass(!!error)}
                                disabled={loading}
                            />
                        </div>
                    </div>

                    {error && (
                        <div id="login-error" role="alert" className="flex items-start gap-1.5 text-[11px] leading-snug text-danger">
                            <AlertCircle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                            <span>{error}</span>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="flex h-8 w-full items-center justify-center gap-1.5 rounded-sm bg-primary text-xs font-medium text-primary-contrast transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-primary"
                    >
                        <span>{loading ? 'Giriş yapılıyor…' : 'Sisteme Giriş Yap'}</span>
                        {!loading && <ArrowRight size={14} />}
                    </button>
                </form>

                {/* Connection status (development builds only) */}
                {showDiagnostics && (
                    <div className="flex h-7 items-center justify-between gap-2 border-t border-border px-3 text-[10px]">
                        <p lang="tr" className="uppercase tracking-wider text-muted">Sistem Durumu (geliştirme)</p>
                        <div className={`flex items-center gap-1.5 font-mono ${backendStatus === 'ok' ? 'text-success' : backendStatus === 'error' ? 'text-danger' : 'text-secondary'}`}>
                            <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                            Sunucu: {backendStatus === 'ok' ? 'Bağlı' : backendStatus === 'error' ? 'Bağlanılamadı' : 'Kontrol ediliyor…'}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
