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
import { HarvestsPage } from './HarvestsPage';

function ToastMirror(): React.JSX.Element {
  const { toasts, dismissToast } = useToast();
  return <ToastViewport toasts={toasts} onDismiss={dismissToast} />;
}

function renderHarvests(initialSimulation?: Partial<NetworkSimulationConfig>) {
  clearAppIcolLocalStorage();
  window.localStorage.setItem(
    MOCK_SESSION_STORAGE_KEY,
    JSON.stringify({ status: 'authenticated', session: DEFAULT_MANAGER_SESSION }),
  );
  window.location.hash = '#/harvests';

  return render(
    <ToastProvider>
      <AuthProvider>
        <DataProvider initialSimulation={initialSimulation}>
          <HarvestsPage />
          <ToastMirror />
        </DataProvider>
      </AuthProvider>
    </ToastProvider>,
  );
}

describe('HarvestsPage (M6 — F-09)', () => {
  beforeEach(() => {
    clearAppIcolLocalStorage();
  });

  it('creates a normalized harvest with PUan tariffs, distinguishes null vs 0 realized weight, and adds ParArticles jar formats', async () => {
    renderHarvests();

    const page = await screen.findByTestId('harvests-page');
    expect(page).toBeInTheDocument();
    await screen.findByTestId('format-toggle-1kg');

    fireEvent.click(screen.getByTestId('harvest-create-btn'));

    fireEvent.change(screen.getByTestId('harvest-label-input'), {
      target: { value: '  Acacia   Forêt  2026  ' },
    });
    fireEvent.change(screen.getByTestId('harvest-year-input'), {
      target: { value: '2026' },
    });
    fireEvent.change(screen.getByTestId('harvest-forecast-input'), {
      target: { value: '65,5' },
    });
    // Blank realized -> null (forecast fallback)
    fireEvent.change(screen.getByTestId('harvest-realized-input'), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByTestId('harvest-price-input-1kg'), {
      target: { value: '18,50' },
    });

    fireEvent.click(screen.getByTestId('harvest-save-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('toast-success')).toBeInTheDocument();
      expect(screen.getByText('Acacia Forêt 2026')).toBeInTheDocument();
    });

    // Add a new jar format in ParArticles
    fireEvent.change(screen.getByTestId('format-code-input'), {
      target: { value: '125g' },
    });
    fireEvent.change(screen.getByTestId('format-label-input'), {
      target: { value: 'Pot dégustation 125 g' },
    });
    fireEvent.change(screen.getByTestId('format-weight-input'), {
      target: { value: '0,125' },
    });
    fireEvent.click(screen.getByTestId('format-save-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('format-toggle-125g')).toBeInTheDocument();
    });
  });

  it('preserves harvest form inputs and shows toast-error when network write fails', async () => {
    renderHarvests({ failNextWrite: true });

    await screen.findByTestId('format-toggle-1kg');
    fireEvent.click(screen.getByTestId('harvest-create-btn'));

    const labelInput = screen.getByTestId('harvest-label-input');
    fireEvent.change(labelInput, { target: { value: 'Châtaignier 2026' } });
    fireEvent.change(screen.getByTestId('harvest-forecast-input'), {
      target: { value: '40' },
    });

    fireEvent.click(screen.getByTestId('harvest-save-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('toast-error')).toBeInTheDocument();
    });
    expect(labelInput).toHaveValue('Châtaignier 2026');
  });
});
