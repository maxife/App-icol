import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_MANAGER_SESSION } from '@app-icol/shared';
import {
  AuthProvider,
  DataProvider,
  MOCK_SESSION_STORAGE_KEY,
  ToastProvider,
  clearAppIcolLocalStorage,
  useToast,
  type NetworkSimulationConfig,
} from '../../providers';
import { ToastViewport } from '../../ui';
import { AccountingPage } from './AccountingPage';

function ToastMirror(): React.JSX.Element {
  const { toasts, dismissToast } = useToast();
  return <ToastViewport toasts={toasts} onDismiss={dismissToast} />;
}

function renderAccounting(
  hash = '#/accounting?year=2026',
  initialSimulation?: Partial<NetworkSimulationConfig>,
) {
  clearAppIcolLocalStorage();
  window.localStorage.setItem(
    MOCK_SESSION_STORAGE_KEY,
    JSON.stringify({ status: 'authenticated', session: DEFAULT_MANAGER_SESSION }),
  );
  window.location.hash = hash;

  return render(
    <ToastProvider>
      <AuthProvider>
        <DataProvider initialSimulation={initialSimulation}>
          <AccountingPage />
          <ToastMirror />
        </DataProvider>
      </AuthProvider>
    </ToastProvider>,
  );
}

describe('AccountingPage (M6 — F-10)', () => {
  beforeEach(() => {
    clearAppIcolLocalStorage();
  });

  it('computes annual fiscal summary, toggles paid honey sales inclusion, and creates/filters accounting entries', async () => {
    renderAccounting('#/accounting?year=2026');

    await screen.findByTestId('accounting-page');
    expect(screen.getByTestId('accounting-year-select')).toHaveValue('2026');

    const revenuesEl = screen.getByTestId('accounting-total-revenues');
    const withSalesText = revenuesEl.textContent ?? '';

    // Toggle anti-double-counting switch
    fireEvent.click(screen.getByTestId('accounting-include-sales-toggle'));
    await waitFor(() => {
      expect(revenuesEl.textContent).not.toBe(withSalesText);
    });

    // Add a new expense entry
    fireEvent.click(screen.getByTestId('accounting-add-btn'));
    fireEvent.click(screen.getByTestId('accounting-type-Dépense'));
    fireEvent.change(screen.getByTestId('accounting-category-select'), {
      target: { value: 'Conditionnement (pots, étiquettes)' },
    });
    fireEvent.change(screen.getByTestId('accounting-label-input'), {
      target: { value: 'Lot cartons 500g' },
    });
    fireEvent.change(screen.getByTestId('accounting-amount-input'), {
      target: { value: '48,90' },
    });
    fireEvent.change(screen.getByTestId('accounting-date-input'), {
      target: { value: '2026-06-15' },
    });

    fireEvent.click(screen.getByTestId('accounting-save-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('toast-success')).toBeInTheDocument();
      expect(screen.getByText('Lot cartons 500g')).toBeInTheDocument();
    });

    // Filter history by category
    fireEvent.change(screen.getByTestId('accounting-category-filter'), {
      target: { value: 'Conditionnement (pots, étiquettes)' },
    });
    expect(screen.getByText('Lot cartons 500g')).toBeInTheDocument();
  });

  it('preserves accounting form inputs and shows toast-error when network write fails', async () => {
    renderAccounting('#/accounting?year=2026', { failNextWrite: true });

    await screen.findByTestId('accounting-page');
    fireEvent.click(screen.getByTestId('accounting-add-btn'));

    const labelInput = screen.getByTestId('accounting-label-input');
    fireEvent.change(labelInput, { target: { value: 'Reines Buckfast' } });
    fireEvent.change(screen.getByTestId('accounting-amount-input'), {
      target: { value: '120' },
    });

    fireEvent.click(screen.getByTestId('accounting-save-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('toast-error')).toBeInTheDocument();
    });
    expect(labelInput).toHaveValue('Reines Buckfast');
  });
});
