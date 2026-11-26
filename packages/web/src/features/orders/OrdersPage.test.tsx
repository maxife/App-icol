import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  AuthProvider,
  DataProvider,
  ToastProvider,
  useAuth,
  useData,
  useToast,
  type NetworkSimulationConfig,
} from '../../providers';
import { ToastViewport } from '../../ui';
import { OrdersPage } from './OrdersPage';

function TestHarness({
  initialSimulation,
}: {
  initialSimulation?: Partial<NetworkSimulationConfig>;
}): React.JSX.Element {
  const { switchMockProfile, roleStatusLabel } = useAuth();
  const { setNetworkSimulation } = useData();
  const { toasts, dismissToast } = useToast();

  return (
    <div>
      <div data-testid="test-qa-controls">
        <span data-testid="active-role">{roleStatusLabel}</span>
        <button
          type="button"
          data-testid="switch-manager"
          onClick={() => switchMockProfile('manager')}
        >
          Manager
        </button>
        <button
          type="button"
          data-testid="switch-contributor"
          onClick={() => switchMockProfile('contributor')}
        >
          Contributor
        </button>
        <button
          type="button"
          data-testid="enable-fail-next-write"
          onClick={() => setNetworkSimulation({ failNextWrite: true })}
        >
          Fail Next Write
        </button>
        <button
          type="button"
          data-testid="enable-offline"
          onClick={() => setNetworkSimulation({ offlineMode: true })}
        >
          Offline
        </button>
        <button
          type="button"
          data-testid="disable-offline"
          onClick={() =>
            setNetworkSimulation({ offlineMode: false, failNextWrite: false })
          }
        >
          Online
        </button>
      </div>
      <OrdersPage />
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

function renderOrdersPage(options?: {
  initialHash?: string;
  initialSimulation?: Partial<NetworkSimulationConfig>;
}) {
  window.location.hash = options?.initialHash ?? '#/orders';
  return render(
    <ToastProvider>
      <AuthProvider>
        <DataProvider
          initialSimulation={{
            latencyMs: 0,
            ...options?.initialSimulation,
          }}
        >
          <TestHarness initialSimulation={options?.initialSimulation} />
        </DataProvider>
      </AuthProvider>
    </ToastProvider>,
  );
}

function getCardByOrderId(orderId: string): HTMLElement {
  const cards = screen.getAllByTestId('order-card');
  const match = cards.find(
    (card) => card.getAttribute('data-order-id') === orderId,
  );
  if (!match) {
    throw new Error(`Order card "${orderId}" not found among ${cards.length} rendered cards.`);
  }
  return match;
}

describe('OrdersPage (M5b — F-08)', () => {
  it('renders seed orders sorted newest-first with tel: links, Donné callouts, collector names, vCard export, and edit navigation', async () => {
    const { container } = renderOrdersPage();

    await waitFor(() => {
      expect(screen.getAllByTestId('order-card')).toHaveLength(25);
    });

    // Strictly single <h1> and zero <header>/<nav> inside page component (AppShell contract)
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.querySelectorAll('header')).toHaveLength(0);
    expect(container.querySelectorAll('nav')).toHaveLength(0);

    const cards = screen.getAllByTestId('order-card');
    // Newest seed order is 2026-05-11 (ord-025), oldest is 2025-05-10 (ord-001)
    expect(cards[0]).toHaveAttribute('data-order-id', 'ord-025');
    expect(cards[cards.length - 1]).toHaveAttribute('data-order-id', 'ord-001');

    // Anonymous direct sale without phone omits order-tel-link
    const directSaleCard = getCardByOrderId('ord-025');
    expect(
      within(directSaleCard).queryByTestId('order-tel-link'),
    ).not.toBeInTheDocument();
    expect(within(directSaleCard).getByTestId('export-vcf-btn')).toBeInTheDocument();

    // French domestic phone renders valid tel:06... link
    const domesticCard = getCardByOrderId('ord-001');
    const domesticTel = within(domesticCard).getByTestId('order-tel-link');
    expect(domesticTel).toHaveAttribute('href', 'tel:0612345678');
    expect(domesticTel).toHaveTextContent('06 12 34 56 78');

    // International +41 phone preserves +41 in tel: link
    const intlCard = getCardByOrderId('ord-015');
    const intlTel = within(intlCard).getByTestId('order-tel-link');
    expect(intlTel).toHaveAttribute('href', 'tel:+41791234567');
    expect(within(intlCard).getByText(/2 × Pot 1 kg/)).toBeInTheDocument();
    expect(within(intlCard).getByText(/4 × Pot 250 g/)).toBeInTheDocument();
    expect(within(intlCard).getByText('3 kg')).toBeInTheDocument();

    // Donné order displays 0,00 € + Offert / Donné tag and hides action-mark-paid (Rule #2)
    const donatedCard = getCardByOrderId('ord-021');
    expect(donatedCard).toHaveTextContent('0,00 €');
    expect(donatedCard).toHaveTextContent('Offert / Donné');
    expect(donatedCard).toHaveTextContent('Donné');
    expect(
      within(donatedCard).queryByTestId('action-mark-paid'),
    ).not.toBeInTheDocument();
    expect(
      within(donatedCard).getByTestId('action-mark-distributed'),
    ).toBeInTheDocument();

    // Co-seller order displays collector name and transfer badge
    const coSellerCard = getCardByOrderId('ord-017');
    expect(coSellerCard).toHaveTextContent('Marie Laurent');
    expect(coSellerCard).toHaveTextContent('À reverser');

    // Clicking Modifier navigates to #/sale/edit/:orderId?returnTo=orders
    fireEvent.click(within(intlCard).getByTestId('action-edit-order'));
    expect(window.location.hash).toBe('#/sale/edit/ord-015?returnTo=orders');
  });

  it('searches instantaneously by accent-insensitive name/relay and de-formatted or international phone digits', async () => {
    renderOrdersPage();

    await waitFor(() => {
      expect(screen.getAllByTestId('order-card')).toHaveLength(25);
    });

    const searchInput = screen.getByTestId('orders-search-input');

    // Accent- and case-insensitive customer name search
    fireEvent.change(searchInput, { target: { value: 'elodie benard' } });
    const elodieCards = screen.getAllByTestId('order-card');
    expect(elodieCards).toHaveLength(3);
    for (const card of elodieCards) {
      expect(card).toHaveTextContent('Élodie Bénard');
    }
    expect(decodeURIComponent(window.location.hash)).toContain('q=elodie+benard');

    // Preserves live trailing space while typing multi-word queries
    fireEvent.change(searchInput, { target: { value: 'Jean-Pierre ' } });
    expect(searchInput).toHaveValue('Jean-Pierre ');
    expect(screen.getAllByTestId('order-card')).toHaveLength(2);

    // Accent-insensitive relay/context search ("marche d'epinal" -> "Marché d'Épinal")
    fireEvent.change(searchInput, { target: { value: "marche d'epinal" } });
    expect(screen.getAllByTestId('order-card').length).toBeGreaterThanOrEqual(4);

    // De-formatted domestic phone digits ("06123456")
    fireEvent.change(searchInput, { target: { value: '06123456' } });
    expect(screen.getAllByTestId('order-card')).toHaveLength(3);

    // French +33 prefix phone query ("+33612345678") matches "06 12 34 56 78"
    fireEvent.change(searchInput, { target: { value: '+33612345678' } });
    expect(screen.getAllByTestId('order-card')).toHaveLength(3);

    // French 0033 prefix query ("0033 7 45 23") matches "07 45 23 89 10" (Sophie Moreau)
    fireEvent.change(searchInput, { target: { value: '0033 7 45 23' } });
    const sophieCards = screen.getAllByTestId('order-card');
    expect(sophieCards).toHaveLength(2);
    expect(sophieCards[0]).toHaveTextContent('Sophie Moreau');

    // International +41 / 0041 query matches "+41 79 123 45 67" (Camille Lefèvre)
    fireEvent.change(searchInput, { target: { value: '004179123' } });
    const camilleCards = screen.getAllByTestId('order-card');
    expect(camilleCards).toHaveLength(2);
    expect(camilleCards[0]).toHaveTextContent('Camille Lefèvre');
  });

  it('combines filter chips, harvest select, and relay select with bidirectional URL hash sync and resets via filter-clear-all', async () => {
    // Mount with pre-filtered URL hash (simulating Dashboard KPI deep link)
    renderOrdersPage({
      initialHash:
        '#/orders?harvest=Printemps+2026&orderStatus=R%C3%A9serv%C3%A9',
    });

    await waitFor(() => {
      expect(screen.getAllByTestId('order-card')).toHaveLength(6);
    });

    const harvestSelect = screen.getByTestId(
      'filter-harvest-select',
    ) as HTMLSelectElement;
    const relaySelect = screen.getByTestId(
      'filter-relay-select',
    ) as HTMLSelectElement;
    const reservedChip = screen.getByTestId('filter-reserved');
    const unpaidChip = screen.getByTestId('filter-unpaid');
    const pendingTransferChip = screen.getByTestId('filter-pending-transfer');

    expect(harvestSelect.value).toBe('Printemps 2026');
    expect(reservedChip).toHaveAttribute('aria-pressed', 'true');
    expect(unpaidChip).toHaveAttribute('aria-pressed', 'false');
    // Out of the 6 Réservé orders in Printemps 2026, 2 are Non-payé (ord-015, ord-022)
    expect(unpaidChip).toHaveTextContent('2');

    // Combine with À encaisser (Non-payé) -> 2 orders
    fireEvent.click(unpaidChip);
    expect(unpaidChip).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByTestId('order-card')).toHaveLength(2);
    expect(decodeURIComponent(window.location.hash)).toContain(
      'paymentStatus=Non-payé',
    );

    // Combine with Lieu / Relais = "Rucher principal" -> 1 order (Camille Lefèvre, ord-015)
    fireEvent.change(relaySelect, { target: { value: 'Rucher principal' } });
    const singleMatch = screen.getAllByTestId('order-card');
    expect(singleMatch).toHaveLength(1);
    expect(singleMatch[0]).toHaveAttribute('data-order-id', 'ord-015');
    expect(decodeURIComponent(window.location.hash)).toContain(
      'relay=Rucher+principal',
    );

    // Simulate external hash navigation (e.g. Dashboard pending transfers deep link)
    act(() => {
      window.location.hash = '#/orders?transferStatus=%C3%80+reverser';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    await waitFor(() => {
      expect(pendingTransferChip).toHaveAttribute('aria-pressed', 'true');
    });
    expect(reservedChip).toHaveAttribute('aria-pressed', 'false');
    expect(harvestSelect.value).toBe('');
    expect(relaySelect.value).toBe('');
    expect(screen.getAllByTestId('order-card')).toHaveLength(3);

    // Reset all filters & search via filter-clear-all
    fireEvent.change(screen.getByTestId('orders-search-input'), {
      target: { value: 'Julie' },
    });
    expect(screen.getAllByTestId('order-card')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('filter-clear-all'));
    expect(window.location.hash).toBe('#/orders');
    expect(screen.getByTestId('orders-search-input')).toHaveValue('');
    expect(pendingTransferChip).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getAllByTestId('order-card')).toHaveLength(25);
  });

  it('executes 1-click status transitions for manager and enforces Rule #4 auto-transfer when contributor marks an order Payé', async () => {
    renderOrdersPage();

    await waitFor(() => {
      expect(screen.getAllByTestId('order-card')).toHaveLength(25);
    });

    // 1. Manager marks Réservé order (ord-015) as Distribué + Payé
    const card015 = getCardByOrderId('ord-015');
    expect(
      within(card015).getByTestId('action-mark-distributed'),
    ).toBeInTheDocument();
    fireEvent.click(within(card015).getByTestId('action-mark-distributed'));

    await waitFor(() => {
      expect(screen.getByTestId('toast-success')).toHaveTextContent(
        /Commande distribuée/i,
      );
    });
    expect(
      within(getCardByOrderId('ord-015')).queryByTestId(
        'action-mark-distributed',
      ),
    ).not.toBeInTheDocument();
    expect(getCardByOrderId('ord-015')).toHaveTextContent('Distribué');

    // Manager marks ord-015 as Payé -> direct collection (NOT third-party transfer)
    fireEvent.click(
      within(getCardByOrderId('ord-015')).getByTestId('action-mark-paid'),
    );
    await waitFor(() => {
      expect(
        within(getCardByOrderId('ord-015')).queryByTestId('action-mark-paid'),
      ).not.toBeInTheDocument();
    });
    expect(getCardByOrderId('ord-015')).toHaveTextContent('Payé');
    expect(getCardByOrderId('ord-015')).not.toHaveTextContent('À reverser');

    // 2. Switch to Contributor ("Marie Laurent") -> marking ord-022 Payé auto-activates À reverser (Rule #4)
    fireEvent.click(screen.getByTestId('switch-contributor'));
    await waitFor(() => {
      expect(screen.getByTestId('active-role')).toHaveTextContent('contributor');
    });

    const card022Before = getCardByOrderId('ord-022');
    expect(card022Before).toHaveTextContent('Non-payé');
    fireEvent.click(within(card022Before).getByTestId('action-mark-paid'));

    await waitFor(() => {
      expect(
        within(getCardByOrderId('ord-022')).queryByTestId('action-mark-paid'),
      ).not.toBeInTheDocument();
    });

    const card022After = getCardByOrderId('ord-022');
    expect(card022After).toHaveTextContent('Payé');
    expect(card022After).toHaveTextContent('À reverser');
    expect(card022After).toHaveTextContent('Marie Laurent');
    expect(
      within(card022After).getByTestId('action-mark-transferred'),
    ).toBeInTheDocument();

    // 3. Contributor (or Manager) can settle À reverser -> Reversé via action-mark-transferred
    fireEvent.click(
      within(card022After).getByTestId('action-mark-transferred'),
    );
    await waitFor(() => {
      expect(
        within(getCardByOrderId('ord-022')).queryByTestId(
          'action-mark-transferred',
        ),
      ).not.toBeInTheDocument();
    });
    expect(getCardByOrderId('ord-022')).toHaveTextContent('Reversé');
    expect(getCardByOrderId('ord-022')).toHaveTextContent('Marie Laurent');
  });

  it('shows loading state during slow mutations and rolls back optimistically with error toast on failNextWrite or offlineMode (Rule #5)', async () => {
    renderOrdersPage({
      initialSimulation: { latencyMs: 60 },
    });

    await waitFor(() => {
      expect(screen.getAllByTestId('order-card')).toHaveLength(25);
    });

    // Enable failNextWrite and trigger 1-click Passer à Distribué on ord-024 (Réservé)
    fireEvent.click(screen.getByTestId('enable-fail-next-write'));

    const distBtn = within(getCardByOrderId('ord-024')).getByTestId(
      'action-mark-distributed',
    );
    fireEvent.click(distBtn);

    // While in flight (60ms), button shows busy/disabled state
    expect(
      within(getCardByOrderId('ord-024')).getByTestId(
        'action-mark-distributed',
      ),
    ).toBeDisabled();
    expect(
      within(getCardByOrderId('ord-024')).getByTestId(
        'action-mark-distributed',
      ),
    ).toHaveAttribute('aria-busy', 'true');

    // Once rejected, rolls back to Réservé, re-enables button, and displays toast-error
    await waitFor(() => {
      expect(screen.getByTestId('toast-error')).toBeInTheDocument();
    });
    const restoredCard = getCardByOrderId('ord-024');
    expect(restoredCard).toHaveTextContent('Réservé');
    const restoredBtn = within(restoredCard).getByTestId(
      'action-mark-distributed',
    );
    expect(restoredBtn).toBeEnabled();

    // Retry immediately (failNextWrite was consumed once) -> succeeds!
    fireEvent.click(restoredBtn);
    await waitFor(() => {
      expect(
        within(getCardByOrderId('ord-024')).queryByTestId(
          'action-mark-distributed',
        ),
      ).not.toBeInTheDocument();
    });
    expect(getCardByOrderId('ord-024')).toHaveTextContent('Distribué');

    // Offline mode also rolls back cleanly on Passer à Payé (ord-023)
    fireEvent.click(screen.getByTestId('enable-offline'));
    fireEvent.click(
      within(getCardByOrderId('ord-023')).getByTestId('action-mark-paid'),
    );

    await waitFor(() => {
      expect(
        within(getCardByOrderId('ord-023')).getByTestId('action-mark-paid'),
      ).toBeEnabled();
    });
    expect(getCardByOrderId('ord-023')).toHaveTextContent('Non-payé');
    expect(screen.getByTestId('toast-error')).toBeInTheDocument();
  });
});
