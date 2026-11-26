import React, { useId } from 'react';
import styles from './SearchBar.module.css';
import { cx, toDomId } from './cx';

export interface SearchBarProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type'> {
  value: string;
  onChange: (nextValue: string) => void;
  onClear?: () => void;
  label?: string;
  containerTestId?: string;
  testId?: string;
  'data-testid'?: string;
}

export function SearchBar({
  value,
  onChange,
  onClear,
  label = 'Rechercher',
  containerTestId,
  id,
  testId,
  className,
  ...rest
}: SearchBarProps): React.JSX.Element {
  const reactId = useId();
  const resolvedTestId = rest['data-testid'] ?? testId;
  const resolvedId = id ?? (resolvedTestId ? `id-${toDomId(resolvedTestId)}` : reactId);

  const handleClear = (): void => {
    onChange('');
    onClear?.();
  };

  return (
    <div data-testid={containerTestId} className={cx(styles.container, className)}>
      <label htmlFor={resolvedId} className="sr-only">
        {label}
      </label>
      <svg
        className={styles.searchIcon}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2.2" />
        <path
          d="M20 20L16.4 16.4"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </svg>
      <input
        {...rest}
        id={resolvedId}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={resolvedTestId}
        className={styles.input}
      />
      {value.length > 0 && (
        <button
          type="button"
          id={`${resolvedId}-clear`}
          aria-label="Effacer la recherche"
          onClick={handleClear}
          className={styles.clearBtn}
        >
          ×
        </button>
      )}
    </div>
  );
}
