import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuthProvider, DataProvider, ToastProvider } from '../providers';
import { AppShell } from './AppShell';
import { buildRouteHash, parseHashRoute } from './navigation';

function renderShell() {
  return render(
    <ToastProvider>
      <AuthProvider>
        <DataProvider initialSimulation={{ latencyMs: 0 }}>
          <AppShell />
        </DataProvider>
      </AuthProvider>
    </ToastProvider>,
  );
}

describe('AppShell & navigation', () => {
  it('parses and builds all documented hash routes cleanly', () => {
    expect(parseHashRoute('')).toEqual({ id: 'dashboard' });
    expect(parseHashRoute('#/dashboard?harvest=Printemps%202026')).toEqual({
      id: 'dashboard',
      harvestLabel: 'Printemps 2026',
    });
    expect(
      parseHashRoute(
        '#/orders?harvest=%C3%89t%C3%A9%202025&orderStatus=R%C3%A9serv%C3%A9&paymentStatus=Non-pay%C3%A9&transferStatus=%C3%80%20reverser&relay=AMAP&q=elodie',
      ),
    ).toEqual({
      id: 'orders',
      filters: {
        harvestLabel: 'Été 2025',
        orderStatus: 'Réservé',
        paymentStatus: 'Non-payé',
        transferStatus: 'À reverser',
        relay: 'AMAP',
        searchQuery: 'elodie',
      },
    });
    expect(parseHashRoute('#/sale/edit/ord-012?returnTo=orders')).toEqual({
      id: 'sale-form',
      mode: 'edit',
      orderId: 'ord-012',
      returnTo: 'orders',
    });
    expect(parseHashRoute('#/accounting?year=2026')).toEqual({
      id: 'accounting',
      year: 2026,
    });

    expect(
      buildRouteHash({
        id: 'sale-form',
        mode: 'create',
        defaultHarvestLabel: 'Printemps 2026',
        returnTo: 'dashboard',
      }),
    ).toBe('#/sale/new?harvest=Printemps+2026&returnTo=dashboard');
  });

  it('renders a single <header>, single <nav>, and strictly single <h1> across all 6 routes', async () => {
    window.location.hash = '#/dashboard';
    const { container } = renderShell();

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
    });

    expect(container.querySelectorAll('header')).toHaveLength(1);
    expect(container.querySelectorAll('nav')).toHaveLength(1);
    expect(screen.getAllByTestId('nav-orders')).toHaveLength(1);
    expect(container.querySelectorAll('h1')).toHaveLength(1);

    // Navigate through orders, new sale, edit sale, harvests, and accounting
    fireEvent.click(screen.getByTestId('nav-orders'));
    expect(screen.getByTestId('orders-page')).toBeInTheDocument();
    expect(container.querySelectorAll('h1')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('nav-new-sale'));
    expect(screen.getByTestId('sale-form-page')).toBeInTheDocument();
    expect(container.querySelectorAll('h1')).toHaveLength(1);

    act(() => {
      window.location.hash = '#/sale/edit/ord-001';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByTestId('sale-form-page')).toHaveTextContent(
      'Modifier la commande',
    );
    expect(container.querySelectorAll('h1')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('nav-harvests'));
    expect(screen.getByTestId('harvests-page')).toBeInTheDocument();
    expect(container.querySelectorAll('h1')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('nav-accounting'));
    expect(screen.getByTestId('accounting-page')).toBeInTheDocument();
    expect(container.querySelectorAll('h1')).toHaveLength(1);
  });

  it('enforces contributor 3-tab cloisonnement and redirects #/harvests & #/accounting to #/dashboard', async () => {
    window.location.hash = '#/harvests';
    renderShell();

    expect(screen.getByTestId('harvests-page')).toBeInTheDocument();
    expect(screen.getByTestId('current-user-role')).toHaveAttribute(
      'data-role',
      'manager',
    );
    expect(screen.getByTestId('nav-harvests')).toBeInTheDocument();
    expect(screen.getByTestId('nav-accounting')).toBeInTheDocument();

    // Switch to contributor while on #/harvests -> synchronously redirects to #/dashboard and hides 2 tabs
    fireEvent.click(screen.getByTestId('role-switch-contributor'));

    expect(screen.getByTestId('current-user-role')).toHaveTextContent(
      'contributor',
    );
    expect(screen.getByTestId('current-user-role')).toHaveAttribute(
      'data-role',
      'contributor',
    );
    expect(screen.queryByTestId('nav-harvests')).toBeNull();
    expect(screen.queryByTestId('nav-accounting')).toBeNull();
    expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/dashboard');

    // Direct URL hash tamper to #/accounting as contributor also redirects to #/dashboard
    act(() => {
      window.location.hash = '#/accounting';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/dashboard');
  });

  it('renders gis-login-screen on signOut without duplicate QA testIds and toggles network-status-banner', async () => {
    window.location.hash = '#/dashboard';
    const { container } = renderShell();

    expect(screen.queryByTestId('network-status-banner')).toBeNull();

    fireEvent.click(screen.getByTestId('simulate-offline-toggle'));
    expect(screen.getByTestId('network-status-banner')).toHaveAttribute(
      'data-network-state',
      'offline',
    );
    fireEvent.click(screen.getByTestId('simulate-offline-toggle'));
    expect(screen.queryByTestId('network-status-banner')).toBeNull();

    fireEvent.click(screen.getByTestId('fail-next-write-toggle'));
    expect(screen.getByTestId('network-status-banner')).toHaveAttribute(
      'data-network-state',
      'fail-next-write',
    );

    // Sign out -> renders gis-login-screen with sole <h1> and zero duplicate QA controls
    fireEvent.click(screen.getByTestId('role-switch-signout'));
    expect(screen.getByTestId('gis-login-screen')).toBeInTheDocument();
    expect(screen.getByTestId('current-user-role')).toHaveTextContent(
      'unauthenticated',
    );
    expect(screen.getAllByTestId('role-switch-manager')).toHaveLength(1);
    expect(screen.getAllByTestId('role-switch-contributor')).toHaveLength(1);
    expect(container.querySelectorAll('h1')).toHaveLength(1);

    // Recover session via role-switch-manager
    fireEvent.click(screen.getByTestId('role-switch-manager'));
    expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
  });
});
