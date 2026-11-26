import React, { useId } from 'react';
import styles from './MetricCard.module.css';
import { cx, toDomId } from './cx';

export type MetricCardTone =
  | 'default'
  | 'honey'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info';

export interface MetricCardProps {
  label: string;
  value: React.ReactNode;
  valueTestId?: string;
  hint?: React.ReactNode;
  badge?: React.ReactNode;
  tone?: MetricCardTone;
  onClick?: () => void;
  actionLabel?: string;
  id?: string;
  testId?: string;
  'data-testid'?: string;
  className?: string;
  children?: React.ReactNode;
}

const TONE_CLASSES: Record<MetricCardTone, string> = {
  default: '',
  honey: styles.toneHoney ?? '',
  success: styles.toneSuccess ?? '',
  warning: styles.toneWarning ?? '',
  danger: styles.toneDanger ?? '',
  info: styles.toneInfo ?? '',
};

export function MetricCard({
  label,
  value,
  valueTestId,
  hint,
  badge,
  tone = 'default',
  onClick,
  actionLabel,
  id,
  testId,
  className,
  children,
  ...rest
}: MetricCardProps): React.JSX.Element {
  const reactId = useId();
  const resolvedTestId = rest['data-testid'] ?? testId;
  const resolvedId = id ?? (resolvedTestId ? `id-${toDomId(resolvedTestId)}` : reactId);

  const innerContent = (
    <>
      <div className={styles.headerRow}>
        <span className={styles.label}>{label}</span>
        {badge}
      </div>
      <div
        data-testid={valueTestId}
        className={cx(styles.value, 'tabular-nums')}
      >
        {value}
      </div>
      {hint && <div className={styles.hint}>{hint}</div>}
      {children}
      {actionLabel && <div className={styles.actionRow}>{actionLabel} →</div>}
    </>
  );

  const combinedClass = cx(
    styles.card,
    TONE_CLASSES[tone],
    Boolean(onClick) && styles.interactive,
    className,
  );

  if (onClick) {
    return (
      <button
        id={resolvedId}
        type="button"
        onClick={onClick}
        data-testid={resolvedTestId}
        className={combinedClass}
      >
        {innerContent}
      </button>
    );
  }

  return (
    <article id={resolvedId} data-testid={resolvedTestId} className={combinedClass}>
      {innerContent}
    </article>
  );
}
