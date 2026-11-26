import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  Button,
  FilterChip,
  MetricCard,
  NetworkStatusBanner,
  QuantityStepper,
  SearchBar,
  SegmentedControl,
  StatusBadge,
  ToastViewport,
} from './index';

describe('packages/web UI primitives', () => {
  it('Button defaults to type="button", generates unique id, and disables with aria-busy when loading', () => {
    render(
      <>
        <Button data-testid="btn-save">Enregistrer</Button>
        <Button data-testid="btn-loading" isLoading>
          Envoi...
        </Button>
      </>,
    );

    const saveBtn = screen.getByTestId('btn-save');
    expect(saveBtn).toHaveAttribute('type', 'button');
    expect(saveBtn.id).toBe('id-btn-save');
    expect(saveBtn).not.toBeDisabled();

    const loadingBtn = screen.getByTestId('btn-loading');
    expect(loadingBtn).toBeDisabled();
    expect(loadingBtn).toHaveAttribute('aria-busy', 'true');
  });

  it('QuantityStepper renders stepper-dec/qty/inc testIds, clamps min/max, and responds to ArrowUp/ArrowDown', () => {
    function Harness() {
      const [qty, setQty] = useState(0);
      return (
        <QuantityStepper
          code="1kg"
          label="Pot 1 kg"
          sublabel="16,00 €"
          value={qty}
          min={0}
          max={3}
          onChange={setQty}
        />
      );
    }

    render(<Harness />);
    const dec = screen.getByTestId('stepper-dec-1kg');
    const out = screen.getByTestId('stepper-qty-1kg');
    const inc = screen.getByTestId('stepper-inc-1kg');

    expect(dec).toBeDisabled();
    expect(out).toHaveTextContent('0');

    fireEvent.click(inc);
    fireEvent.click(inc);
    expect(out).toHaveTextContent('2');
    expect(dec).not.toBeDisabled();

    const group = screen.getByRole('group', { name: 'Pot 1 kg' });
    fireEvent.keyDown(group, { key: 'ArrowUp' });
    expect(out).toHaveTextContent('3');
    expect(inc).toBeDisabled();

    fireEvent.keyDown(group, { key: 'ArrowDown' });
    expect(out).toHaveTextContent('2');
  });

  it('SegmentedControl emits accented optionTestIdPrefix testIds and supports roving arrow keys', () => {
    function Harness() {
      const [val, setVal] = useState<'Non-payé' | 'Payé' | 'Donné'>('Non-payé');
      return (
        <SegmentedControl
          label="Statut règlement"
          optionTestIdPrefix="payment-status"
          value={val}
          onChange={setVal}
          options={[
            { value: 'Non-payé', label: 'Non-payé', tone: 'danger' },
            { value: 'Payé', label: 'Payé', tone: 'success' },
            { value: 'Donné', label: 'Donné', sublabel: '0 € hors CA', tone: 'info' },
          ]}
        />
      );
    }

    render(<Harness />);
    const unpaid = screen.getByTestId('payment-status-Non-payé');
    const paid = screen.getByTestId('payment-status-Payé');
    const donated = screen.getByTestId('payment-status-Donné');

    expect(unpaid).toHaveAttribute('aria-checked', 'true');
    expect(paid).toHaveAttribute('aria-checked', 'false');

    fireEvent.keyDown(unpaid, { key: 'ArrowRight' });
    expect(paid).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(donated);
    expect(donated).toHaveAttribute('aria-checked', 'true');
  });

  it('StatusBadge renders all 7 statuses and hides neutral when hideIfNeutral is set', () => {
    const { rerender } = render(
      <StatusBadge status="Non concerné" hideIfNeutral data-testid="badge-transfer" />,
    );
    expect(screen.queryByTestId('badge-transfer')).toBeNull();

    rerender(<StatusBadge status="À reverser" hideIfNeutral data-testid="badge-transfer" />);
    expect(screen.getByTestId('badge-transfer')).toHaveTextContent('À reverser');
  });

  it('MetricCard renders article when static and button when interactive', () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <MetricCard label="Payé" value="259,50 €" data-testid="kpi-paid-eur" />,
    );
    expect(screen.getByTestId('kpi-paid-eur').tagName).toBe('ARTICLE');

    rerender(
      <MetricCard
        label="À livrer"
        value="6"
        onClick={onClick}
        data-testid="kpi-pending-deliveries"
      />,
    );
    const btn = screen.getByTestId('kpi-pending-deliveries');
    expect(btn.tagName).toBe('BUTTON');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('SearchBar attaches data-testid directly onto <input type="search"> and clears on button click', () => {
    function Harness() {
      const [q, setQ] = useState('dupont');
      return <SearchBar value={q} onChange={setQ} data-testid="orders-search-input" />;
    }

    render(<Harness />);
    const input = screen.getByTestId('orders-search-input');
    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAttribute('type', 'search');

    const clearBtn = screen.getByRole('button', { name: 'Effacer la recherche' });
    fireEvent.click(clearBtn);
    expect(input).toHaveValue('');
  });

  it('FilterChip, ToastViewport, and NetworkStatusBanner render exact contracts and aria states', () => {
    const onDismiss = vi.fn();
    const onRestore = vi.fn();

    render(
      <>
        <FilterChip
          label="À livrer (Réservé)"
          active
          count={6}
          data-testid="filter-reserved"
        />
        <ToastViewport
          toasts={[
            { id: 't1', variant: 'success', title: 'Vente enregistrée', durationMs: 4000 },
            { id: 't2', variant: 'error', title: 'Erreur réseau', durationMs: 6000 },
          ]}
          onDismiss={onDismiss}
        />
        <NetworkStatusBanner
          isBrowserOffline={false}
          offlineMode
          failNextWrite={false}
          dataMode="mock"
          onDisableSimulation={onRestore}
        />
      </>,
    );

    const chip = screen.getByTestId('filter-reserved');
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(chip).toHaveTextContent('6');

    expect(screen.getByTestId('toast-viewport')).toBeInTheDocument();
    expect(screen.getByTestId('toast-success')).toHaveTextContent('Vente enregistrée');
    expect(screen.getByTestId('toast-error')).toHaveAttribute('role', 'alert');

    const banner = screen.getByTestId('network-status-banner');
    expect(banner).toHaveAttribute('data-network-state', 'offline');
    fireEvent.click(screen.getByRole('button', { name: 'Rétablir le réseau' }));
    expect(onRestore).toHaveBeenCalledTimes(1);
  });
});
