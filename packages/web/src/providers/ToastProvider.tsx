import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ToastItem, ToastVariant } from '../ui/ToastViewport';

export interface ShowToastInput {
  variant: ToastVariant;
  title: string;
  description?: string;
  durationMs?: number;
}

export interface ToastContextValue {
  toasts: ReadonlyArray<ToastItem>;
  showToast: (toast: ShowToastInput) => string;
  success: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
  dismissToast: (id: string) => void;
  clearToasts: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const seqRef = useRef(0);

  const dismissToast = useCallback((id: string) => {
    const existingTimer = timersRef.current.get(id);
    if (existingTimer) {
      clearTimeout(existingTimer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearToasts = useCallback(() => {
    for (const timer of timersRef.current.values()) {
      clearTimeout(timer);
    }
    timersRef.current.clear();
    setToasts([]);
  }, []);

  const showToast = useCallback(
    (input: ShowToastInput): string => {
      seqRef.current += 1;
      const id = `toast-${seqRef.current}`;
      const durationMs =
        input.durationMs ?? (input.variant === 'error' ? 6000 : 4000);

      setToasts((prev) => {
        // Replace active toast of the same variant to avoid Playwright strict-mode duplicate testIds
        const removed = prev.filter((item) => item.variant === input.variant);
        for (const old of removed) {
          const t = timersRef.current.get(old.id);
          if (t) {
            clearTimeout(t);
            timersRef.current.delete(old.id);
          }
        }
        const remaining = prev.filter((item) => item.variant !== input.variant);
        return [
          ...remaining,
          {
            id,
            variant: input.variant,
            title: input.title,
            description: input.description,
            durationMs,
          },
        ];
      });

      if (durationMs > 0) {
        const timer = setTimeout(() => {
          timersRef.current.delete(id);
          setToasts((prev) => prev.filter((item) => item.id !== id));
        }, durationMs);
        timersRef.current.set(id, timer);
      }

      return id;
    },
    [],
  );

  const success = useCallback(
    (title: string, description?: string) =>
      showToast({ variant: 'success', title, description }),
    [showToast],
  );

  const error = useCallback(
    (title: string, description?: string) =>
      showToast({ variant: 'error', title, description }),
    [showToast],
  );

  const info = useCallback(
    (title: string, description?: string) =>
      showToast({ variant: 'info', title, description }),
    [showToast],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      toasts,
      showToast,
      success,
      error,
      info,
      dismissToast,
      clearToasts,
    }),
    [toasts, showToast, success, error, info, dismissToast, clearToasts],
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider.');
  }
  return ctx;
}
