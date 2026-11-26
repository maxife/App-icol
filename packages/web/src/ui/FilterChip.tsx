import React, { useId } from 'react';
import styles from './FilterChip.module.css';
import { cx, toDomId } from './cx';

export interface FilterChipProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: string;
  active: boolean;
  count?: number;
  testId?: string;
  'data-testid'?: string;
}

export function FilterChip({
  label,
  active,
  count,
  type = 'button',
  id,
  testId,
  className,
  ...rest
}: FilterChipProps): React.JSX.Element {
  const reactId = useId();
  const resolvedTestId = rest['data-testid'] ?? testId;
  const resolvedId = id ?? (resolvedTestId ? `id-${toDomId(resolvedTestId)}` : reactId);

  return (
    <button
      {...rest}
      id={resolvedId}
      type={type}
      aria-pressed={active}
      data-testid={resolvedTestId}
      className={cx(styles.chip, active && styles.active, className)}
    >
      <span>{label}</span>
      {count !== undefined && (
        <span className={cx(styles.countPill, 'tabular-nums')}>{count}</span>
      )}
    </button>
  );
}
