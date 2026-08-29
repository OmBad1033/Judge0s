import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

export type ToastKind = 'info' | 'success' | 'error' | 'warning';

interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  push: (kind: ToastKind, message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

const KIND_CLASSES: Record<ToastKind, string> = {
  info: 'border-info bg-[#eff6ff] text-info',
  success: 'border-primary bg-primary-dim text-primary',
  error: 'border-danger bg-[#fef2f2] text-danger',
  warning: 'border-warning bg-[#fef3c7] text-warning',
};

const KIND_ICONS: Record<ToastKind, string> = {
  info: 'info',
  success: 'check_circle',
  error: 'error',
  warning: 'warning',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const push = useCallback((kind: ToastKind, message: string) => {
    counter.current += 1;
    const id = `t_${counter.current}_${Date.now()}`;
    setToasts((prev) => [...prev, { id, kind, message }]);
    // Auto-dismiss after 4s.
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const api = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-full max-w-sm pointer-events-none"
        role="region"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`term-card pointer-events-auto px-3 py-2.5 flex items-start gap-2 border-l-4 ${KIND_CLASSES[t.kind]}`}
          >
            <span className="material-symbols-outlined text-[18px] mt-0.5 shrink-0">
              {KIND_ICONS[t.kind]}
            </span>
            <p className="font-mono text-label uppercase tracking-[0.1em] leading-snug">{t.message}</p>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}