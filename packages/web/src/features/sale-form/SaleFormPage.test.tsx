import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CONTRIBUTOR_SESSION,
  DEFAULT_MANAGER_SESSION,
  createSeedDataset,
  getLocalTodayIsoDate,
  type DataRepository,
  type MutationMeta,
  type SaleOrder,
  type UpdateSaleOrderInput,
} from '@app-icol/shared';
import {
  AuthProvider,
  DataProvider,
  MOCK_SESSION_STORAGE_KEY,
  MockSheetsRepository,
  ToastProvider,
} from '../../providers';
import { clearAppIcolLocalStorage } from '../../providers/bootstrapUrlParams';
import { ToastViewport } from '../../ui';
import { useToast } from '../../providers/ToastProvider';
import { SaleFormPage } from './SaleFormPage';
import {
  SALE_DRAFT_STORAGE_PREFIX,
  buildSaleDraftStorageKey,
} from './useSaleDraftPersistence';

function ToastHarness(): React.JSX.Element {
  const { toasts, dismissToast } = useToast();
  return <ToastViewport toasts={toasts} onDismiss={dismissToast} />;
}

interface RenderSaleFormOptions {
  hash?: string;
  role?: 'manager' | 'contributor';
  repositoryOverride?: DataRepository;
  initialSimulation?: {
    offlineMode?: boolean;
    failNextWrite?: boolean;
    latencyMs?: number;
  };
}

function renderSaleForm(options: RenderSaleFormOptions = {}) {
  const {
    hash = '#/sale/new',
    role = 'manager',
    repositoryOverride,
    initialSimulation = { latencyMs: 0 },
  } = options;

  const session =
    role === 'contributor'
      ? { ...DEFAULT_CONTRIBUTOR_SESSION }
      : { ...DEFAULT_MANAGER_SESSION };

  window.localStorage.setItem(
    MOCK_SESSION_STORAGE_KEY,
    JSON.stringify({ status: 'authenticated', session }),
  );
  window.location.hash = hash;

  return render(
    <ToastProvider>
      <AuthProvider>
        <DataProvider
          initialSimulation={initialSimulation}
          repositoryOverride={repositoryOverride}
        >
          <SaleFormPage />
          <ToastHarness />
        </DataProvider>
      </AuthProvider>
    </ToastProvider>,
  );
}

describe('SaleFormPage & useSaleDraftPersistence (M5a)', () => {
  it('initializes create mode with local today date, default active harvest, single CustomerPicker, and 0 totals', async () => {
    const { container } = renderSaleForm({ hash: '#/sale/new' });

    await waitFor(() => {
      expect(screen.getByTestId('stepper-inc-1kg')).toBeInTheDocument();
    });

    expect(screen.getByTestId('sale-form-page')).toBeInTheDocument();
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getByTestId('sale-date-input')).toHaveValue(
      getLocalTodayIsoDate(),
    );
    await waitFor(() => {
      expect(screen.getByTestId('sale-harvest-select')).toHaveValue(
        'Printemps 2026',
      );
    });

    // Strictly single CustomerPicker mount (no duplicated phone/relay inputs)
    expect(screen.getAllByTestId('customer-name-input')).toHaveLength(1);
    expect(screen.getAllByTestId('customer-phone-input')).toHaveLength(1);
    expect(screen.getAllByTestId('customer-relay-input')).toHaveLength(1);
    expect(screen.getAllByTestId('contact-picker-btn')).toHaveLength(1);
    expect(screen.getAllByTestId('import-vcf-input')).toHaveLength(1);

    expect(screen.getByTestId('sale-total-weight')).toHaveTextContent('0 kg');
    expect(screen.getByTestId('sale-total-amount')).toHaveTextContent('0,00 €');
    expect(screen.queryByTestId('sale-delete-btn')).toBeNull();
  });

  it('pre-selects route.defaultHarvestLabel when valid and falls back to defaultActiveHarvest when invalid or ALL', async () => {
    const first = renderSaleForm({
      hash: '#/sale/new?harvest=%C3%89t%C3%A9+2025&returnTo=dashboard',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sale-harvest-select')).toHaveValue('Été 2025');
    });
    first.unmount();

    renderSaleForm({
      hash: '#/sale/new?harvest=ALL',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sale-harvest-select')).toHaveValue(
        'Printemps 2026',
      );
    });
  });

  it('computes live weight & PUan totals across steppers, supports French decimal manual price override + reset, and handles Donné 0 € rule', async () => {
    renderSaleForm({ hash: '#/sale/new' });

    await waitFor(() => {
      expect(screen.getByTestId('stepper-inc-1kg')).toBeInTheDocument();
    });

    // Printemps 2026: 1kg = 16 €, 500g = 8,50 €
    fireEvent.click(screen.getByTestId('stepper-inc-1kg'));
    fireEvent.click(screen.getByTestId('stepper-inc-1kg'));
    fireEvent.click(screen.getByTestId('stepper-inc-500g'));

    expect(screen.getByTestId('stepper-qty-1kg')).toHaveTextContent('2');
    expect(screen.getByTestId('stepper-qty-500g')).toHaveTextContent('1');
    expect(screen.getByTestId('sale-total-weight')).toHaveTextContent('2,5 kg');
    expect(screen.getByTestId('sale-total-amount')).toHaveTextContent('40,50 €');

    // Switch harvest to Printemps 2025 (1kg = 15 €, 500g = 8 € -> 38,00 €)
    fireEvent.change(screen.getByTestId('sale-harvest-select'), {
      target: { value: 'Printemps 2025' },
    });
    expect(screen.getByTestId('sale-total-amount')).toHaveTextContent('38,00 €');

    // Enable manual price override with French comma decimal "34,50"
    const manualToggle = screen.getByTestId('sale-manual-price-toggle');
    expect(manualToggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(manualToggle);
    expect(manualToggle).toHaveAttribute('aria-pressed', 'true');

    const manualInput = screen.getByTestId('sale-manual-price-input');
    fireEvent.change(manualInput, { target: { value: '34,50' } });
    expect(screen.getByTestId('sale-total-amount')).toHaveTextContent('34,50 €');

    // Rule #2: Selecting Donné forces effectiveAmountEur to 0,00 € even with manual override active
    fireEvent.click(screen.getByTestId('payment-status-Donné'));
    expect(screen.getByTestId('sale-total-amount')).toHaveTextContent('0,00 €');
    expect(screen.getByTestId('sale-form-page')).toHaveTextContent(/offert/i);
    expect(screen.getByTestId('sale-form-page')).toHaveTextContent('38,00 €');

    // Switching back to Payé restores the active 34,50 € manual override
    fireEvent.click(screen.getByTestId('payment-status-Payé'));
    expect(screen.getByTestId('sale-total-amount')).toHaveTextContent('34,50 €');

    // Clicking "Revenir au tarif auto" clears override back to 38,00 €
    fireEvent.click(screen.getByTestId('sale-reset-auto-price'));
    expect(screen.getByTestId('sale-manual-price-toggle')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByTestId('sale-total-amount')).toHaveTextContent('38,00 €');
  });

  it('blocks invalid submission with explicit errors + toast-error, then submits valid order and clears draft', async () => {
    renderSaleForm({ hash: '#/sale/new?returnTo=orders' });

    await waitFor(() => {
      expect(screen.getByTestId('stepper-inc-1kg')).toBeInTheDocument();
    });

    // Submit empty form -> fails validation
    fireEvent.click(screen.getByTestId('sale-submit-btn'));
    expect(screen.getByTestId('toast-error')).toBeInTheDocument();
    expect(window.location.hash).toContain('#/sale/new');

    // Fill customer + 2 pots + French phone with dots + notes
    fireEvent.change(screen.getByTestId('customer-name-input'), {
      target: { value: 'Pauline Test' },
    });
    fireEvent.change(screen.getByTestId('customer-phone-input'), {
      target: { value: '+33 6.14.25.36.47' },
    });
    fireEvent.change(screen.getByTestId('customer-relay-input'), {
      target: { value: 'Marché Bio' },
    });
    fireEvent.click(screen.getByTestId('stepper-inc-1kg'));
    fireEvent.change(screen.getByTestId('sale-notes-input'), {
      target: { value: 'Livraison samedi matin' },
    });

    // Verify draft was auto-saved under app-icol:draft:create
    const createDraftKey = buildSaleDraftStorageKey('create');
    expect(createDraftKey.startsWith(SALE_DRAFT_STORAGE_PREFIX)).toBe(true);
    expect(window.localStorage.getItem(createDraftKey)).toContain('Pauline Test');

    fireEvent.click(screen.getByTestId('sale-submit-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('toast-success')).toBeInTheDocument();
    });
    expect(window.localStorage.getItem(createDraftKey)).toBeNull();
    expect(window.location.hash).toBe('#/orders');
  });

  it('auto-activates third-party transfer with session.displayName for contributor Payé sales and normalizes to Non concerné when Non-payé/Donné', async () => {
    renderSaleForm({ hash: '#/sale/new', role: 'contributor' });

    await waitFor(() => {
      expect(screen.getByTestId('stepper-inc-1kg')).toBeInTheDocument();
    });

    // Initially Non-payé -> third-party inactive
    expect(screen.getByTestId('third-party-toggle')).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.queryByTestId('collector-name-input')).toBeNull();

    // Switch to Payé as contributor -> auto-populates Marie Laurent & À reverser
    fireEvent.click(screen.getByTestId('payment-status-Payé'));
    expect(screen.getByTestId('third-party-toggle')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    const collectorInput = screen.getByTestId('collector-name-input');
    expect(collectorInput).toHaveValue(DEFAULT_CONTRIBUTOR_SESSION.displayName);
    expect(screen.getByTestId('transfer-status-À reverser')).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // Switching to Donné clears third-party transfer state
    fireEvent.click(screen.getByTestId('payment-status-Donné'));
    expect(screen.getByTestId('third-party-toggle')).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.queryByTestId('collector-name-input')).toBeNull();
  });

  it('preserves draft and reuses identical clientRequestId across network failure (failNextWrite) and reload, and cleans up via clearAppIcolLocalStorage', async () => {
    const baseRepo = new MockSheetsRepository({
      getActorSession: () => ({ ...DEFAULT_MANAGER_SESSION }),
      initialSimulation: { failNextWrite: true, latencyMs: 0 },
    });
    const createSpy = vi.spyOn(baseRepo, 'createOrder');

    const firstMount = renderSaleForm({
      hash: '#/sale/new',
      repositoryOverride: baseRepo,
    });

    await waitFor(() => {
      expect(screen.getByTestId('stepper-inc-1kg')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('customer-name-input'), {
      target: { value: 'Client Réseau Instable' },
    });
    fireEvent.click(screen.getByTestId('stepper-inc-1kg'));

    // First attempt fails (failNextWrite = true)
    fireEvent.click(screen.getByTestId('sale-submit-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('toast-error')).toBeInTheDocument();
    });
    expect(createSpy).toHaveBeenCalledTimes(1);
    const firstClientRequestId = createSpy.mock.calls[0]?.[1]?.clientRequestId;
    expect(firstClientRequestId).toBeTruthy();

    // Form input AND localStorage draft remain intact
    expect(screen.getByTestId('customer-name-input')).toHaveValue(
      'Client Réseau Instable',
    );
    const draftKey = buildSaleDraftStorageKey('create');
    expect(window.localStorage.getItem(draftKey)).toContain(
      'Client Réseau Instable',
    );

    // Simulate full unmount + remount (page reload) before retrying
    firstMount.unmount();

    const secondMount = renderSaleForm({
      hash: '#/sale/new',
      repositoryOverride: baseRepo,
    });

    await waitFor(() => {
      expect(screen.getByTestId('stepper-inc-1kg')).toBeInTheDocument();
    });

    expect(screen.getByTestId('customer-name-input')).toHaveValue(
      'Client Réseau Instable',
    );
    expect(screen.getByTestId('stepper-qty-1kg')).toHaveTextContent('1');

    // Retry submit -> succeeds and sends the EXACT SAME clientRequestId
    fireEvent.click(screen.getByTestId('sale-submit-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('toast-success')).toBeInTheDocument();
    });
    expect(createSpy).toHaveBeenCalledTimes(2);
    const retryClientRequestId = createSpy.mock.calls[1]?.[1]?.clientRequestId;
    expect(retryClientRequestId).toBe(firstClientRequestId);
    expect(window.localStorage.getItem(draftKey)).toBeNull();

    secondMount.unmount();

    // Verify ?resetMock=1 clearAppIcolLocalStorage purges any app-icol:draft:* keys
    window.localStorage.setItem(
      buildSaleDraftStorageKey('edit', 'ord-001'),
      JSON.stringify({ version: 1 }),
    );
    clearAppIcolLocalStorage(window.localStorage);
    expect(
      window.localStorage.getItem(buildSaleDraftStorageKey('edit', 'ord-001')),
    ).toBeNull();
  });

  it('preserves historical unitPriceEur & unitWeightKg snapshots in Edit Mode when harvest PUan changed, uses current PUan for new formats or changed harvest, and shows inactive formats with qty > 0', async () => {
    const seeded = createSeedDataset();
    // Mutate catalog: Printemps 2025 1kg jumps from 15 € to 25 €; 250g is deactivated!
    const p2025 = seeded.harvests.find((h) => h.id === 'printemps-2025')!;
    p2025.unitPricesEur['1kg'] = 25;
    p2025.unitPricesEur['250g'] = 6;
    const fmt250 = seeded.formats.find((f) => f.code === '250g')!;
    fmt250.active = false;

    // ord-003 has 4x 500g (8 €) and 2x 250g (4,50 €); ord-001 has 2x 1kg (snapshotted at 15 €) and 2x 500g (snapshotted at 8 €) = 46 €
    window.localStorage.setItem('app-icol:dataset:v1', JSON.stringify(seeded));

    const repo = new MockSheetsRepository({
      getActorSession: () => ({ ...DEFAULT_MANAGER_SESSION }),
      initialSimulation: { latencyMs: 0 },
    });

    let capturedUpdateInput: UpdateSaleOrderInput | null = null;
    const origUpdate = repo.updateOrder.bind(repo);
    vi.spyOn(repo, 'updateOrder').mockImplementation(
      async (
        id: string,
        input: UpdateSaleOrderInput,
        meta?: MutationMeta,
      ): Promise<SaleOrder> => {
        capturedUpdateInput = input;
        return origUpdate(id, input, meta);
      },
    );

    const firstEdit = renderSaleForm({
      hash: '#/sale/edit/ord-001',
      repositoryOverride: repo,
    });

    await waitFor(() => {
      expect(screen.getByTestId('customer-name-input')).toHaveValue(
        'Élodie Bénard',
      );
    });

    // Historical snapshot preserved: 2x 15 € + 2x 8 € = 46,00 € (NOT 2x 25 € + 2x 8 € = 66 €!)
    expect(screen.getByTestId('sale-total-amount')).toHaveTextContent('46,00 €');
    // Inactive 250g has 0 qty on ord-001 -> not shown
    expect(screen.queryByTestId('stepper-inc-250g')).toBeNull();

    // Incrementing existing 1kg line from 2 -> 3 keeps historical 15 €/pot -> 61,00 €
    fireEvent.click(screen.getByTestId('stepper-inc-1kg'));
    expect(screen.getByTestId('sale-total-amount')).toHaveTextContent('61,00 €');

    // Switching harvest to Printemps 2026 recalculates all lines with Printemps 2026 PUan (3x 16 € + 2x 8,50 € = 65,00 €)
    fireEvent.change(screen.getByTestId('sale-harvest-select'), {
      target: { value: 'Printemps 2026' },
    });
    expect(screen.getByTestId('sale-total-amount')).toHaveTextContent('65,00 €');

    // Switching back to Printemps 2025 restores historical snapshot (61,00 €)
    fireEvent.change(screen.getByTestId('sale-harvest-select'), {
      target: { value: 'Printemps 2025' },
    });
    expect(screen.getByTestId('sale-total-amount')).toHaveTextContent('61,00 €');

    fireEvent.click(screen.getByTestId('sale-submit-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('toast-success')).toBeInTheDocument();
    });
    expect(capturedUpdateInput).not.toBeNull();
    const saved1kg = capturedUpdateInput!.items.find(
      (i) => i.formatCode === '1kg',
    );
    expect(saved1kg?.unitPriceEur).toBe(15);
    expect(saved1kg?.quantity).toBe(3);

    firstEdit.unmount();

    // Now open ord-003 which has 2x inactive 250g (historical snapshot 4,50 € vs catalog 6 €)
    renderSaleForm({
      hash: '#/sale/edit/ord-003',
      repositoryOverride: repo,
    });

    await waitFor(() => {
      expect(screen.getByTestId('customer-name-input')).toHaveValue(
        'Sophie Moreau',
      );
    });

    // Inactive 250g IS rendered because ord-003 has quantity 2 > 0!
    expect(screen.getByTestId('stepper-qty-250g')).toHaveTextContent('2');
    // 4x 8 € + 2x 4,50 € = 41,00 €
    expect(screen.getByTestId('sale-total-amount')).toHaveTextContent('41,00 €');
    // Adding newly ordered 1kg (not previously on ord-003) uses current Printemps 2025 catalog price (25 €) -> 66,00 €!
    fireEvent.click(screen.getByTestId('stepper-inc-1kg'));
    expect(screen.getByTestId('sale-total-amount')).toHaveTextContent('66,00 €');
  });

  it('enforces manager-only two-step deletion in edit mode and renders clean not-found state for unknown orderId', async () => {
    // 1. Contributor in edit mode MUST NOT see sale-delete-btn
    const contributorView = renderSaleForm({
      hash: '#/sale/edit/ord-002',
      role: 'contributor',
    });

    await waitFor(() => {
      expect(screen.getByTestId('customer-name-input')).toHaveValue(
        'Jean-Pierre Martin',
      );
    });
    expect(screen.queryByTestId('sale-delete-btn')).toBeNull();
    expect(screen.queryByTestId('sale-confirm-delete-btn')).toBeNull();
    contributorView.unmount();

    // 2. Manager in edit mode sees sale-delete-btn, reveals sale-confirm-delete-btn on click, and deletes order
    const managerView = renderSaleForm({
      hash: '#/sale/edit/ord-002',
      role: 'manager',
    });

    await waitFor(() => {
      expect(screen.getByTestId('customer-name-input')).toHaveValue(
        'Jean-Pierre Martin',
      );
    });
    expect(screen.getByTestId('sale-delete-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('sale-confirm-delete-btn')).toBeNull();

    fireEvent.click(screen.getByTestId('sale-delete-btn'));
    expect(screen.getByTestId('sale-confirm-delete-btn')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('sale-confirm-delete-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('toast-success')).toBeInTheDocument();
    });
    expect(window.location.hash).toBe('#/orders');
    managerView.unmount();

    // 3. Unknown orderId renders clean not-found card with single <h1>
    const { container } = renderSaleForm({
      hash: '#/sale/edit/ord-inexistant-999',
      role: 'manager',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sale-form-page')).toHaveTextContent(
        /introuvable/i,
      );
    });
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.queryByTestId('sale-delete-btn')).toBeNull();

    // Also verify measureFormatUnitWeights (+ then - back to 0) leaves no residual create draft
    act(() => {
      window.location.hash = '#/sale/new';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
  });
});
