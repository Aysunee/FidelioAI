import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
    /** Root-level boundary: render a full-screen fallback that does not depend on any context. */
    fullScreen?: boolean;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

const reloadPage = () => {
    if (typeof window !== 'undefined') window.location.reload();
};

class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        // Details go to the console only; the user sees a generic Turkish message.
        console.error('[ErrorBoundary] Yakalanmamış hata:', error, errorInfo?.componentStack);
    }

    private handleReset = () => {
        this.setState({ hasError: false, error: null });
    };

    public render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            const isDev = Boolean(import.meta.env.DEV);
            const fullScreen = Boolean(this.props.fullScreen);
            // Theme tokens only (they are defined on :root, so the full-screen fallback works without any context).
            const buttonClass = 'flex h-7 items-center justify-center gap-1.5 rounded-sm px-2.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary';

            return (
                <div
                    role="alert"
                    lang="tr"
                    className={`${fullScreen ? 'min-h-dvh bg-background' : 'h-full min-h-[240px] w-full flex-1 bg-surface'} flex items-center justify-center p-3 text-text`}
                >
                    <div className={`w-full max-w-sm ${fullScreen ? 'border border-border bg-surface' : ''}`}>
                        <div className={`flex items-start gap-2 ${fullScreen ? 'border-b border-border p-3' : 'justify-center pb-3'}`}>
                            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-danger" />
                            <div className="min-w-0">
                                <h2 className="text-xs font-semibold text-text">
                                    Bir şeyler ters gitti
                                </h2>
                                <p className="mt-0.5 text-[11px] text-secondary">
                                    {fullScreen
                                        ? 'Uygulama beklenmeyen bir hatayla karşılaştı.'
                                        : 'Bu bölüm yüklenirken beklenmeyen bir hata oluştu.'}
                                </p>
                            </div>
                        </div>

                        {isDev && this.state.error && (
                            <p className={`max-h-32 overflow-auto border-b border-border bg-surface-secondary px-3 py-2 font-mono text-[11px] text-danger ${fullScreen ? '' : 'mb-3 border-t'}`}>
                                {this.state.error.toString()}
                            </p>
                        )}

                        <div className={`flex gap-2 ${fullScreen ? 'justify-end p-3' : 'justify-center'}`}>
                            {!fullScreen && (
                                <button
                                    type="button"
                                    onClick={this.handleReset}
                                    className={`${buttonClass} border border-border bg-surface-secondary text-text hover:bg-surface-highlight`}
                                >
                                    <RotateCcw size={12} />
                                    Tekrar Dene
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={reloadPage}
                                className={`${buttonClass} bg-danger-soft text-danger hover:opacity-80`}
                            >
                                <RefreshCw size={12} />
                                Sayfayı Yenile
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
