import React, { useId } from 'react';
import styles from './Button.module.css';
import { cx, toDomId } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'md' | 'lg' | 'compact' | 'icon';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  fullWidth?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  testId?: string;
  'data-testid'?: string;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: styles.variantPrimary ?? '',
  secondary: styles.variantSecondary ?? '',
  ghost: styles.variantGhost ?? '',
  danger: styles.variantDanger ?? '',
  success: styles.variantSuccess ?? '',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: styles.sizeMd ?? '',
  lg: styles.sizeLg ?? '',
  compact: styles.sizeCompact ?? '',
  icon: styles.sizeIcon ?? '',
};

export function Button({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  fullWidth = false,
  leftIcon,
  rightIcon,
  type = 'button',
  disabled,
  id,
  testId,
  className,
  children,
  ...rest
}: ButtonProps): React.JSX.Element {
  const reactId = useId();
  const resolvedTestId = rest['data-testid'] ?? testId;
  const resolvedId = id ?? (resolvedTestId ? `id-${toDomId(resolvedTestId)}` : reactId);
  const isDisabled = Boolean(disabled || isLoading);

  return (
    <button
      {...rest}
      id={resolvedId}
      type={type}
      disabled={isDisabled}
      aria-busy={isLoading ? 'true' : undefined}
      data-testid={resolvedTestId}
      className={cx(
        styles.button,
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        fullWidth && styles.fullWidth,
        className,
      )}
    >
      {isLoading ? (
        <svg
          className={styles.spinner}
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle
            cx="12"
            cy="12"
            r="9"
            stroke="currentColor"
            strokeOpacity="0.28"
            strokeWidth="3"
          />
          <path
            d="M21 12a9 9 0 0 0-9-9"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        leftIcon && <span className={styles.iconSlot}>{leftIcon}</span>
      )}
      <span>{children}</span>
      {!isLoading && rightIcon && <span className={styles.iconSlot}>{rightIcon}</span>}
    </button>
  );
}
