import React from 'react';
import styles from './ToastViewport.module.css';
import { cx, toDomId } from './cx';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
  durationMs: number;
}

export interface ToastViewportProps {
  toasts: ReadonlyArray<ToastItem>;
  onDismiss: (id: string) => void;
}

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  success: styles.variantSuccess ?? '',
  error: styles.variantError ?? '',
  info: styles.variantInfo ?? '',
};

export function ToastViewport({
  toasts,
  onDismiss,
}: ToastViewportProps): React.JSX.Element {
  return (
    <div
      id="toast-viewport"
      data-testid="toast-viewport"
      aria-live="polite"
      aria-relevant="additions text"
      className={styles.viewport}
    >
      {toasts.map((item) => (
        <div
          key={item.id}
          id={`toast-item-${toDomId(item.id)}`}
          data-testid={`toast-${item.variant}`}
          role={item.variant === 'error' ? 'alert' : 'status'}
          className={cx(styles.toast, VARIANT_CLASSES[item.variant])}
        >
          <div className={styles.body}>
            <span className={styles.title}>{item.title}</span>
            {item.description && (
              <span className={styles.description}>{item.description}</span>
            )}
          </div>
          <button
            type="button"
            id={`btn-dismiss-toast-${toDomId(item.id)}`}
            aria-label="Fermer la notification"
            onClick={() => onDismiss(item.id)}
            className={styles.dismissBtn}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
