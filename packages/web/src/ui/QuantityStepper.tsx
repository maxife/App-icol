import React, { useId } from 'react';
import styles from './QuantityStepper.module.css';
import { cx, toDomId } from './cx';

export interface QuantityStepperProps {
  code: string;
  label: string;
  sublabel?: string;
  value: number;
  onChange: (nextValue: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  decrementTestId?: string;
  quantityTestId?: string;
  incrementTestId?: string;
  id?: string;
  testId?: string;
  'data-testid'?: string;
  className?: string;
}

export function QuantityStepper({
  code,
  label,
  sublabel,
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  disabled = false,
  decrementTestId,
  quantityTestId,
  incrementTestId,
  id,
  testId,
  className,
  ...rest
}: QuantityStepperProps): React.JSX.Element {
  const reactId = useId();
  const resolvedTestId = rest['data-testid'] ?? testId;
  const decTestId = decrementTestId ?? `stepper-dec-${code}`;
  const qtyTestId = quantityTestId ?? `stepper-qty-${code}`;
  const incTestId = incrementTestId ?? `stepper-inc-${code}`;
  const groupId = id ?? (resolvedTestId ? `id-${toDomId(resolvedTestId)}` : reactId);

  const handleDecrement = (): void => {
    if (disabled || value <= min) return;
    onChange(Math.max(min, value - step));
  };

  const handleIncrement = (): void => {
    if (disabled || value >= max) return;
    onChange(Math.min(max, value + step));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (disabled) return;
    if (e.key === 'ArrowUp' || e.key === '+') {
      e.preventDefault();
      handleIncrement();
    } else if (e.key === 'ArrowDown' || e.key === '-') {
      e.preventDefault();
      handleDecrement();
    }
  };

  return (
    <div
      id={groupId}
      role="group"
      aria-label={label}
      data-testid={resolvedTestId}
      onKeyDown={handleKeyDown}
      className={cx(
        styles.stepperRow,
        value > 0 && styles.stepperActive,
        className,
      )}
    >
      <div className={styles.meta}>
        <span className={styles.label}>{label}</span>
        {sublabel && <span className={styles.sublabel}>{sublabel}</span>}
      </div>
      <div className={styles.controls}>
        <button
          type="button"
          id={`id-${toDomId(decTestId)}`}
          data-testid={decTestId}
          aria-label={`Retirer ${label}`}
          disabled={disabled || value <= min}
          onClick={handleDecrement}
          className={styles.stepBtn}
        >
          −
        </button>
        <output
          id={`id-${toDomId(qtyTestId)}`}
          data-testid={qtyTestId}
          aria-live="polite"
          className={cx(styles.quantityOutput, 'tabular-nums')}
        >
          {value}
        </output>
        <button
          type="button"
          id={`id-${toDomId(incTestId)}`}
          data-testid={incTestId}
          aria-label={`Ajouter ${label}`}
          disabled={disabled || value >= max}
          onClick={handleIncrement}
          className={cx(styles.stepBtn, styles.stepBtnInc)}
        >
          +
        </button>
      </div>
    </div>
  );
}
