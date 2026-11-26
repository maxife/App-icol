import React from 'react';
import type { OrderStatus, PaymentStatus, TransferStatus } from '@app-icol/shared';
import styles from './StatusBadge.module.css';
import { cx } from './cx';

export type BadgeStatus =
  | OrderStatus
  | PaymentStatus
  | TransferStatus
  | 'Prévisionnel'
  | 'Réalisé';

export interface StatusBadgeProps {
  status: BadgeStatus;
  label?: string;
  size?: 'sm' | 'md';
  hideIfNeutral?: boolean;
  testId?: string;
  'data-testid'?: string;
  className?: string;
}

const STATUS_CLASS_MAP: Record<BadgeStatus, string> = {
  Réservé: styles.reserved ?? '',
  Distribué: styles.distributed ?? '',
  'Non-payé': styles.unpaid ?? '',
  Payé: styles.paid ?? '',
  Donné: styles.donated ?? '',
  'À reverser': styles.toTransfer ?? '',
  Reversé: styles.transferred ?? '',
  'Non concerné': styles.neutral ?? '',
  Prévisionnel: styles.reserved ?? '',
  Réalisé: styles.distributed ?? '',
};

export function StatusBadge({
  status,
  label,
  size = 'sm',
  hideIfNeutral = false,
  testId,
  className,
  ...rest
}: StatusBadgeProps): React.JSX.Element | null {
  if (hideIfNeutral && status === 'Non concerné') {
    return null;
  }

  const resolvedTestId = rest['data-testid'] ?? testId;

  return (
    <span
      data-testid={resolvedTestId}
      data-status={status}
      className={cx(
        styles.badge,
        size === 'md' ? styles.sizeMd : styles.sizeSm,
        STATUS_CLASS_MAP[status],
        className,
      )}
    >
      {label ?? status}
    </span>
  );
}
