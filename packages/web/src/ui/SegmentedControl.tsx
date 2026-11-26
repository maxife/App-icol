import React, { useId, useRef } from 'react';
import styles from './SegmentedControl.module.css';
import { cx, toDomId } from './cx';

export type SegmentedTone =
  | 'default'
  | 'honey'
  | 'success'
  | 'danger'
  | 'info'
  | 'warning';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  sublabel?: string;
  tone?: SegmentedTone;
  disabled?: boolean;
  testId?: string;
}

export interface SegmentedControlProps<T extends string> {
  label: string;
  hideLabel?: boolean;
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (nextValue: T) => void;
  disabled?: boolean;
  optionTestIdPrefix?: string;
  id?: string;
  testId?: string;
  'data-testid'?: string;
  className?: string;
}

const TONE_CLASSES: Record<SegmentedTone, string> = {
  default: '',
  honey: styles.toneHoney ?? '',
  success: styles.toneSuccess ?? '',
  danger: styles.toneDanger ?? '',
  info: styles.toneInfo ?? '',
  warning: styles.toneWarning ?? '',
};

export function SegmentedControl<T extends string>({
  label,
  hideLabel = false,
  options,
  value,
  onChange,
  disabled = false,
  optionTestIdPrefix,
  id,
  testId,
  className,
  ...rest
}: SegmentedControlProps<T>): React.JSX.Element {
  const reactId = useId();
  const resolvedTestId = rest['data-testid'] ?? testId;
  const groupId = id ?? (resolvedTestId ? `id-${toDomId(resolvedTestId)}` : reactId);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const enabledIndices = options
    .map((opt, idx) => (disabled || opt.disabled ? -1 : idx))
    .filter((idx) => idx !== -1);

  const selectIndex = (targetIdx: number): void => {
    const opt = options[targetIdx];
    if (!opt || disabled || opt.disabled) return;
    optionRefs.current[targetIdx]?.focus();
    onChange(opt.value);
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    currentIdx: number,
  ): void => {
    if (enabledIndices.length === 0) return;
    const pos = enabledIndices.indexOf(currentIdx);
    if (pos === -1) return;

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIdx = enabledIndices[(pos + 1) % enabledIndices.length]!;
      selectIndex(nextIdx);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIdx =
        enabledIndices[(pos - 1 + enabledIndices.length) % enabledIndices.length]!;
      selectIndex(prevIdx);
    } else if (e.key === 'Home') {
      e.preventDefault();
      selectIndex(enabledIndices[0]!);
    } else if (e.key === 'End') {
      e.preventDefault();
      selectIndex(enabledIndices[enabledIndices.length - 1]!);
    }
  };

  return (
    <div className={cx(styles.wrapper, className)}>
      <span
        id={`${groupId}-label`}
        className={cx(styles.groupLabel, hideLabel && 'sr-only')}
      >
        {label}
      </span>
      <div
        id={groupId}
        role="radiogroup"
        aria-label={label}
        data-testid={resolvedTestId}
        className={styles.track}
      >
        {options.map((opt, idx) => {
          const isSelected = opt.value === value;
          const isDisabled = Boolean(disabled || opt.disabled);
          const optTestId =
            opt.testId ??
            (optionTestIdPrefix ? `${optionTestIdPrefix}-${opt.value}` : undefined);
          const optId = optTestId
            ? `id-${toDomId(optTestId)}`
            : `${groupId}-opt-${toDomId(opt.value)}`;

          return (
            <button
              key={opt.value}
              ref={(el) => {
                optionRefs.current[idx] = el;
              }}
              id={optId}
              type="button"
              role="radio"
              aria-checked={isSelected}
              tabIndex={isSelected ? 0 : -1}
              disabled={isDisabled}
              data-testid={optTestId}
              onClick={() => {
                if (!isDisabled) {
                  onChange(opt.value);
                }
              }}
              onKeyDown={(e) => handleKeyDown(e, idx)}
              className={cx(
                styles.option,
                TONE_CLASSES[opt.tone ?? 'default'],
                isSelected && styles.selected,
              )}
            >
              <span>{opt.label}</span>
              {opt.sublabel && <span className={styles.sublabel}>{opt.sublabel}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
