import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, X } from "lucide-react";

type Toast = {
  id: number;
  message: string;
};

type ToastContextValue = {
  showSuccess: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);
let nextToastId = 0;

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("Toast context is unavailable");
  return context;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);
  const showSuccess = useCallback((message: string) => {
    const toast = { id: ++nextToastId, message };
    setToasts((current) => [...current, toast].slice(-3));
  }, []);
  const value = useMemo(() => ({ showSuccess }), [showSuccess]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" aria-label="操作提示">
        {toasts.map((toast) => <SuccessToast key={toast.id} toast={toast} onDismiss={dismiss} />)}
      </div>
    </ToastContext.Provider>
  );
}

function SuccessToast({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timeout = window.setTimeout(() => onDismiss(toast.id), 3_500);
    return () => window.clearTimeout(timeout);
  }, [onDismiss, toast.id]);

  return (
    <div className="success-toast" role="status" aria-live="polite" aria-atomic="true">
      <CheckCircle2 aria-hidden="true" />
      <span>{toast.message}</span>
      <button type="button" aria-label="关闭提示" onClick={() => onDismiss(toast.id)}><X /></button>
    </div>
  );
}
