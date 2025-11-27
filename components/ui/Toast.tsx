import React, { useEffect } from 'react';
import { ToastMessage } from '../../types';
import { X, CheckCircle2, AlertTriangle, Info } from 'lucide-react';

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  return (
    <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 w-full max-w-[90vw] sm:max-w-md pointer-events-none">
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
        className="pointer-events-auto mx-auto bg-black/80 dark:bg-white/90 backdrop-blur-2xl text-white dark:text-black rounded-[28px] py-3 px-4 pl-3 shadow-2xl flex items-center gap-3 animate-enter max-w-sm w-full border border-white/10 dark:border-black/5"
        onClick={() => onDismiss(toast.id)}
    >
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${toast.type === 'success' ? 'bg-green-500' : toast.type === 'alert' ? 'bg-red-500' : 'bg-blue-500'} text-white`}>
        <Icon size={16} strokeWidth={3} />
      </div>
      
      <div className="flex-1 min-w-0">
        <h4 className="font-semibold text-sm leading-tight truncate">{toast.title}</h4>
        <p className="text-[13px] opacity-80 leading-tight truncate">{toast.description}</p>
      </div>
    </div>
  );
};