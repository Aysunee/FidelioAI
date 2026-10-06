import React, { useEffect } from 'react';
import { ToastMessage } from '../../types';
import { X, CheckCircle2, AlertTriangle, Info } from 'lucide-react';

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  return (
    <div className="fixed top-12 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-1 w-full max-w-[90vw] sm:max-w-md pointer-events-none">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
};

interface ToastItemProps {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
}

const ToastItem: React.FC<ToastItemProps> = ({ toast, onDismiss }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, 4000);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const Icon = toast.type === 'success' ? CheckCircle2 : toast.type === 'alert' ? AlertTriangle : Info;
  const colorClass = toast.type === 'success' ? 'text-success' : toast.type === 'alert' ? 'text-danger' : 'text-primary';
  
  return (
    <div 
        className="pointer-events-auto mx-auto bg-surface text-text rounded-sm py-2 px-3 shadow-overlay flex items-center gap-2.5 animate-overlay-in max-w-sm w-full border border-border-strong"
        onClick={() => onDismiss(toast.id)}
    >
      <Icon size={14} className={`shrink-0 ${colorClass}`} />
      
      <div className="flex-1 min-w-0">
        <h4 className="font-semibold text-xs leading-tight truncate">{toast.title}</h4>
        <p className="text-[11px] text-secondary leading-tight truncate">{toast.description}</p>
      </div>
    </div>
  );
};