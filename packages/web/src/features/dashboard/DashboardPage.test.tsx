import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  RepositoryError,
  SEED_EXPECTED_KPIS,
  SEED_JAR_FORMATS,
  SEED_MOCK_USERS,
  computeOrderTotals,
  type AppDataset,
  type DataRepository,
  type Harvest,
  type SaleOrder,
} from '@app-icol/shared';
import {
  AuthProvider,
  DataProvider,
  MOCK_DATASET_STORAGE_KEY,
  MockSheetsRepository,
  ToastProvider,
  useAuth,
  useData,
} from '../../providers';
import { parseHashRoute } from '../../shell/navigation';
import { DashboardPage } from './DashboardPage';

function createSeededMockRepo(initialDataset: AppDataset): DataRepository {
  window.localStorage.setItem(
    MOCK_DATASET_STORAGE_KEY,
    JSON.stringify(initialDataset),
  );
  return new MockSheetsRepository({
    getActorSession: () => ({ ...SEED_MOCK_USERS.manager }),
    initialSimulation: { latencyMs: 0 },
  });
}

function renderDashboard(options?: {
  initialHash?: string;
  repositoryOverride?: DataRepository;
}) {
  if (options?.initialHash !== undefined) {
    window.location.hash = options.initialHash;
  } else {
    window.location.hash = '#/dashboard';
  }

  return render(
    <ToastProvider>
      <AuthProvider>
        <DataProvider
          initialSimulation={{ latencyMs: 0 }}
          repositoryOverride={options?.repositoryOverride}
        >
          <DashboardPage />
        </DataProvider>
      </AuthProvider>
    </ToastProvider>,
  );
}

function buildTestOrder(params: {
  id: string;
  harvest: Harvest;
  jars: Record<string, number>;
  orderStatus: SaleOrder['orderStatus'];
  paymentStatus: SaleOrder['paymentStatus'];
  manualOverrideEur?: number | null;
  collectedByThirdParty?: boolean;
  collectorName?: string;
  transferStatus?: SaleOrder['transferStatus'];
}): SaleOrder {
  const itemsInput = Object.entries(params.jars).map(([formatCode, quantity]) => ({
    formatCode,
    quantity,
  }));
  const totals = computeOrderTotals(
    itemsInput,
    params.harvest,
    SEED_JAR_FORMATS,
    params.paymentStatus,
    params.manualOverrideEur ?? null,
  );

  return {
    id: params.id,
    date: '2026-05-15',
    customerName: `Client ${params.id}`,
    phone: '06 12 34 56 78',
    contextOrRelay: 'Rucher',
    harvestLabel: params.harvest.label,
    items: totals.items,
    computedWeightKg: totals.computedWeightKg,
    computedAmountEur: totals.computedAmountEur,
    manualAmountOverrideEur: totals.manualAmountOverrideEur,
    effectiveAmountEur: totals.effectiveAmountEur,
    orderStatus: params.orderStatus,
    paymentStatus: params.paymentStatus,
    collectedByThirdParty: params.collectedByThirdParty ?? false,
    collectorName: params.collectorName ?? '',
    transferStatus: params.transferStatus ?? 'Non concerné',
    updatedAt: '2026-05-15T10:00:00.000Z',
  };
}

describe('DashboardPage (M4 — Tableau de bord saison)', () => {
  it('defaults to defaultActiveHarvest (Printemps 2026), renders a single <h1>, and displays exact seed KPIs & jar equivalents', async () => {
    const { container } = renderDashboard();

    const select = (await screen.findByTestId(
      'dashboard-harvest-select',
    )) as HTMLSelectElement;

    await waitFor(() => {
      expect(select.value).toBe('Printemps 2026');
    });

    expect(container.querySelectorAll('h1')).toHaveLength(1);

    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual([
      'ALL',
      'Printemps 2025',
      'Été 2025',
      'Printemps 2026',
    ]);

    const expected = SEED_EXPECTED_KPIS.dashboard['Printemps 2026'];
    expect(screen.getByTestId('kpi-harvested-kg')).toHaveTextContent('90 kg');
    expect(screen.getByTestId('kpi-forecast-badge')).toBeVisible();
    expect(screen.getByTestId('kpi-committed-kg')).toHaveTextContent('25,5 kg');
    expect(screen.getByTestId('kpi-available-kg')).toHaveTextContent('64,5 kg');

    const pageText = screen.getByTestId('dashboard-page').textContent ?? '';
    expect(pageText).toContain(`${expected.jarEquivalents['1kg']} × Pot 1 kg`);
    expect(pageText).toContain(`${expected.jarEquivalents['500g']} × Pot 500 g`);
    expect(pageText).toContain(`${expected.jarEquivalents['250g']} × Pot 250 g`);

    expect(screen.getByTestId('kpi-paid-eur')).toHaveTextContent('259,50 €');
    expect(screen.getByTestId('kpi-unpaid-eur')).toHaveTextContent('116,00 €');

    const donatedText = screen.getByTestId('kpi-donated-summary').textContent ?? '';
    expect(donatedText).toContain('6 pots offerts');
    expect(donatedText).toContain('2,5 kg');
    expect(donatedText).toContain('0,00 €');

    const transfersText =
      screen.getByTestId('kpi-pending-transfers').textContent ?? '';
    expect(transfersText).toContain('58,50 €');
    expect(transfersText).toContain('2 ventes encaissées');

    const deliveriesText =
      screen.getByTestId('kpi-pending-deliveries').textContent ?? '';
    expect(deliveriesText).not.toMatch(/€|\bkg\b/i);
    const firstNumberMatch = /\d+/.exec(deliveriesText);
    expect(firstNumberMatch?.[0]).toBe(String(expected.pendingDeliveryOrdersCount));
  });

  it('switches cleanly between realized harvests and "ALL" ("Toutes les récoltes") while syncing the route hash', async () => {
    renderDashboard();

    const select = (await screen.findByTestId(
      'dashboard-harvest-select',
    )) as HTMLSelectElement;
    await waitFor(() => {
      expect(select.value).toBe('Printemps 2026');
    });

    // Select realized harvest 'Printemps 2025' -> forecast badge disappears
    fireEvent.change(select, { target: { value: 'Printemps 2025' } });
    expect(window.location.hash).toBe('#/dashboard?harvest=Printemps+2025');
    expect(select.value).toBe('Printemps 2025');
    expect(screen.queryByTestId('kpi-forecast-badge')).toBeNull();
    expect(screen.getByTestId('kpi-harvested-kg')).toHaveTextContent('60 kg');
    expect(screen.getByTestId('kpi-committed-kg')).toHaveTextContent('15,5 kg');
    expect(screen.getByTestId('kpi-available-kg')).toHaveTextContent('44,5 kg');
    expect(screen.getByTestId('kpi-paid-eur')).toHaveTextContent('222,00 €');
    expect(screen.getByTestId('kpi-unpaid-eur')).toHaveTextContent('0,00 €');
    expect(screen.getByTestId('kpi-donated-summary')).toHaveTextContent(
      '1 pot offert',
    );
    expect(screen.getByTestId('kpi-pending-transfers')).toHaveTextContent('0,00 €');

    // Select 'ALL' -> consolidates all 3 harvests and shows forecast badge because Printemps 2026 is on forecast
    fireEvent.change(select, { target: { value: 'ALL' } });
    expect(window.location.hash).toBe('#/dashboard?harvest=ALL');
    expect(select.value).toBe('ALL');
    expect(screen.getByTestId('kpi-forecast-badge')).toHaveTextContent(
      /prévisionnel/i,
    );
    expect(screen.getByTestId('kpi-harvested-kg')).toHaveTextContent('235 kg');
    expect(screen.getByTestId('kpi-committed-kg')).toHaveTextContent('55 kg');
    expect(screen.getByTestId('kpi-available-kg')).toHaveTextContent('180 kg');
    expect(screen.getByTestId('kpi-paid-eur')).toHaveTextContent('661,00 €');
    expect(screen.getByTestId('kpi-unpaid-eur')).toHaveTextContent('149,00 €');
    expect(screen.getByTestId('kpi-donated-summary')).toHaveTextContent(
      '9 pots offerts',
    );
    expect(screen.getByTestId('kpi-donated-summary')).toHaveTextContent('4,5 kg');
    expect(screen.getByTestId('kpi-pending-transfers')).toHaveTextContent('99,00 €');
  });

  it('distinguishes realizedWeightKg === 0 (realized 0 kg, no forecast badge) from realizedWeightKg === null (forecast fallback)', async () => {
    const zeroRealizedHarvest: Harvest = {
      id: 'gel-2026',
      label: 'Gel Printemps 2026',
      year: 2026,
      forecastWeightKg: 50,
      realizedWeightKg: 0,
      unitPricesEur: { '1kg': 16, '500g': 8.5, '250g': 5 },
      isDefaultActive: true,
    };
    const nullRealizedHarvest: Harvest = {
      id: 'acacia-2026',
      label: 'Acacia 2026',
      year: 2026,
      forecastWeightKg: 65,
      realizedWeightKg: null,
      unitPricesEur: { '1kg': 17, '500g': 9, '250g': 5 },
      isDefaultActive: false,
    };

    const repo = createSeededMockRepo({
      formats: [...SEED_JAR_FORMATS],
      harvests: [zeroRealizedHarvest, nullRealizedHarvest],
      orders: [],
      accountingEntries: [],
      serverTimestamp: '2026-05-15T10:00:00.000Z',
    });

    renderDashboard({ repositoryOverride: repo });

    const select = (await screen.findByTestId(
      'dashboard-harvest-select',
    )) as HTMLSelectElement;
    await waitFor(() => {
      expect(select.value).toBe('Gel Printemps 2026');
    });

    // realizedWeightKg === 0 -> 0 kg realized, NO forecast badge
    expect(screen.getByTestId('kpi-harvested-kg')).toHaveTextContent('0 kg');
    expect(screen.getByTestId('kpi-available-kg')).toHaveTextContent('0 kg');
    expect(screen.queryByTestId('kpi-forecast-badge')).toBeNull();

    // Switch to realizedWeightKg === null -> 65 kg forecast WITH forecast badge
    fireEvent.change(select, { target: { value: 'Acacia 2026' } });
    expect(screen.getByTestId('kpi-harvested-kg')).toHaveTextContent('65 kg');
    expect(screen.getByTestId('kpi-available-kg')).toHaveTextContent('65 kg');
    expect(screen.getByTestId('kpi-forecast-badge')).toBeVisible();
  });

  it('displays signed negative available stock, overbooking alert, clamped 100% gauge, and 0 jar equivalents when overbooked', async () => {
    const smallHarvest: Harvest = {
      id: 'montagne-2026',
      label: 'Montagne 2026',
      year: 2026,
      forecastWeightKg: 12,
      realizedWeightKg: 10,
      unitPricesEur: { '1kg': 18, '500g': 9.5, '250g': 5.5 },
      isDefaultActive: true,
    };

    const orders: SaleOrder[] = [
      buildTestOrder({
        id: 'o-1',
        harvest: smallHarvest,
        jars: { '1kg': 8 },
        orderStatus: 'Distribué',
        paymentStatus: 'Payé',
      }),
      buildTestOrder({
        id: 'o-2',
        harvest: smallHarvest,
        jars: { '1kg': 5, '500g': 3 }, // 6.5 kg -> total 14.5 kg on 10 kg harvest = -4.5 kg
        orderStatus: 'Réservé',
        paymentStatus: 'Non-payé',
      }),
    ];

    const repo = createSeededMockRepo({
      formats: [...SEED_JAR_FORMATS],
      harvests: [smallHarvest],
      orders,
      accountingEntries: [],
      serverTimestamp: '2026-05-15T10:00:00.000Z',
    });

    renderDashboard({ repositoryOverride: repo });

    await waitFor(() => {
      expect(screen.getByTestId('kpi-available-kg')).toHaveTextContent('-4,5 kg');
    });

    expect(screen.getByTestId('kpi-harvested-kg')).toHaveTextContent('10 kg');
    expect(screen.getByTestId('kpi-committed-kg')).toHaveTextContent('14,5 kg');
    expect(screen.getByTestId('kpi-overbooked-alert')).toHaveTextContent('4,5 kg');

    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-valuenow', '100');

    const pageText = screen.getByTestId('dashboard-page').textContent ?? '';
    expect(pageText).toContain('0 × Pot 1 kg');
    expect(pageText).toContain('0 × Pot 500 g');
    expect(pageText).toContain('0 × Pot 250 g');
  });

  it('enforces Rule #1 (Réservé -> Distribué never double-deducts stock) and Rule #2 (Donné consumes stock, 0 € in CA & unpaid)', async () => {
    const harvest: Harvest = {
      id: 'foret-2026',
      label: 'Forêt 2026',
      year: 2026,
      forecastWeightKg: 30,
      realizedWeightKg: 30,
      unitPricesEur: { '1kg': 16, '500g': 8.5, '250g': 5 },
      isDefaultActive: true,
    };

    const orders: SaleOrder[] = [
      buildTestOrder({
        id: 'ord-res',
        harvest,
        jars: { '1kg': 2 }, // 2 kg, 32 €
        orderStatus: 'Réservé',
        paymentStatus: 'Non-payé',
      }),
      buildTestOrder({
        id: 'ord-paid',
        harvest,
        jars: { '1kg': 1 }, // 1 kg, 16 €
        orderStatus: 'Distribué',
        paymentStatus: 'Payé',
      }),
      buildTestOrder({
        id: 'ord-gift',
        harvest,
        jars: { '500g': 3 }, // 1.5 kg, Donné even with manualOverrideEur = 25 -> 0 €
        manualOverrideEur: 25,
        orderStatus: 'Distribué',
        paymentStatus: 'Donné',
      }),
    ];

    const repo = createSeededMockRepo({
      formats: [...SEED_JAR_FORMATS],
      harvests: [harvest],
      orders,
      accountingEntries: [],
      serverTimestamp: '2026-05-15T10:00:00.000Z',
    });

    function TriggerDistributeButton(): React.JSX.Element {
      const { patchOrderStatuses } = useData();
      return (
        <button
          type="button"
          data-testid="test-mark-distributed"
          onClick={() => {
            void patchOrderStatuses('ord-res', { orderStatus: 'Distribué' });
          }}
        >
          Remettre
        </button>
      );
    }

    window.location.hash = '#/dashboard';
    render(
      <ToastProvider>
        <AuthProvider>
          <DataProvider
            initialSimulation={{ latencyMs: 0 }}
            repositoryOverride={repo}
          >
            <DashboardPage />
            <TriggerDistributeButton />
          </DataProvider>
        </AuthProvider>
      </ToastProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('kpi-committed-kg')).toHaveTextContent('4,5 kg');
    });

    expect(screen.getByTestId('kpi-available-kg')).toHaveTextContent('25,5 kg');
    expect(screen.getByTestId('kpi-paid-eur')).toHaveTextContent('16,00 €');
    expect(screen.getByTestId('kpi-unpaid-eur')).toHaveTextContent('32,00 €');
    expect(screen.getByTestId('kpi-donated-summary')).toHaveTextContent(
      '3 pots offerts',
    );
    expect(screen.getByTestId('kpi-donated-summary')).toHaveTextContent('1,5 kg');
    expect(
      /\d+/.exec(screen.getByTestId('kpi-pending-deliveries').textContent ?? '')?.[0],
    ).toBe('1');

    // Transition ord-res from Réservé -> Distribué: pending deliveries drops to 0, committed & available stay 4,5 kg / 25,5 kg
    await act(async () => {
      fireEvent.click(screen.getByTestId('test-mark-distributed'));
    });

    await waitFor(() => {
      expect(
        /\d+/.exec(screen.getByTestId('kpi-pending-deliveries').textContent ?? '')?.[0],
      ).toBe('0');
    });
    expect(screen.getByTestId('kpi-committed-kg')).toHaveTextContent('4,5 kg');
    expect(screen.getByTestId('kpi-available-kg')).toHaveTextContent('25,5 kg');
  });

  it('navigates with pre-filled harvest or unfiltered "ALL" to Orders (À reverser / Réservé) and New Sale', async () => {
    renderDashboard({ initialHash: '#/dashboard?harvest=%C3%89t%C3%A9+2025' });

    const select = (await screen.findByTestId(
      'dashboard-harvest-select',
    )) as HTMLSelectElement;
    await waitFor(() => {
      expect(select.value).toBe('Été 2025');
    });

    // 1. Scoped to 'Été 2025'
    fireEvent.click(screen.getByTestId('kpi-pending-transfers'));
    expect(parseHashRoute(window.location.hash)).toEqual({
      id: 'orders',
      filters: {
        harvestLabel: 'Été 2025',
        transferStatus: 'À reverser',
      },
    });

    act(() => {
      window.location.hash = '#/dashboard?harvest=%C3%89t%C3%A9+2025';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    fireEvent.click(screen.getByTestId('kpi-pending-deliveries'));
    expect(parseHashRoute(window.location.hash)).toEqual({
      id: 'orders',
      filters: {
        harvestLabel: 'Été 2025',
        orderStatus: 'Réservé',
      },
    });

    act(() => {
      window.location.hash = '#/dashboard?harvest=%C3%89t%C3%A9+2025';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    fireEvent.click(screen.getByTestId('dashboard-new-sale-cta'));
    expect(parseHashRoute(window.location.hash)).toEqual({
      id: 'sale-form',
      mode: 'create',
      defaultHarvestLabel: 'Été 2025',
      returnTo: 'dashboard',
    });

    // 2. Scoped to 'ALL' -> omits harvestLabel / defaultHarvestLabel
    act(() => {
      window.location.hash = '#/dashboard?harvest=ALL';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(select.value).toBe('ALL');

    fireEvent.click(screen.getByTestId('kpi-pending-transfers'));
    expect(parseHashRoute(window.location.hash)).toEqual({
      id: 'orders',
      filters: {
        transferStatus: 'À reverser',
      },
    });

    act(() => {
      window.location.hash = '#/dashboard?harvest=ALL';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    fireEvent.click(screen.getByTestId('kpi-pending-deliveries'));
    expect(parseHashRoute(window.location.hash)).toEqual({
      id: 'orders',
      filters: {
        orderStatus: 'Réservé',
      },
    });

    act(() => {
      window.location.hash = '#/dashboard?harvest=ALL';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    fireEvent.click(screen.getByTestId('dashboard-new-sale-cta'));
    expect(parseHashRoute(window.location.hash)).toEqual({
      id: 'sale-form',
      mode: 'create',
      returnTo: 'dashboard',
    });
  });

  it('handles empty datasets, contributor role, and recoverable load errors cleanly', async () => {
    let failFirstGet = true;
    const baseRepo = createSeededMockRepo({
      formats: [],
      harvests: [],
      orders: [],
      accountingEntries: [],
      serverTimestamp: '2026-05-15T10:00:00.000Z',
    });

    const flakyRepo: DataRepository = {
      getDataset: async (meta) => {
        if (failFirstGet) {
          failFirstGet = false;
          throw new RepositoryError('NETWORK_ERROR', 'Connexion Sheets indisponible');
        }
        return baseRepo.getDataset(meta);
      },
      listFormats: (meta) => baseRepo.listFormats(meta),
      listHarvests: (meta) => baseRepo.listHarvests(meta),
      listOrders: (meta) => baseRepo.listOrders(meta),
      getOrderById: (id, meta) => baseRepo.getOrderById(id, meta),
      listAccountingEntries: (year, meta) =>
        baseRepo.listAccountingEntries(year, meta),
      createOrder: (input, meta) => baseRepo.createOrder(input, meta),
      updateOrder: (id, input, meta) => baseRepo.updateOrder(id, input, meta),
      patchOrderStatuses: (id, patch, meta) =>
        baseRepo.patchOrderStatuses(id, patch, meta),
      deleteOrder: (id, meta) => baseRepo.deleteOrder(id, meta),
      createHarvest: (input, meta) => baseRepo.createHarvest(input, meta),
      updateHarvest: (id, input, meta) => baseRepo.updateHarvest(id, input, meta),
      setDefaultActiveHarvest: (id, meta) =>
        baseRepo.setDefaultActiveHarvest(id, meta),
      upsertJarFormat: (input, meta) => baseRepo.upsertJarFormat(input, meta),
      createAccountingEntry: (input, meta) =>
        baseRepo.createAccountingEntry(input, meta),
      updateAccountingEntry: (id, input, meta) =>
        baseRepo.updateAccountingEntry(id, input, meta),
      deleteAccountingEntry: (id, meta) =>
        baseRepo.deleteAccountingEntry(id, meta),
      verifySession: (idToken) => baseRepo.verifySession(idToken),
      inspectSheetStructure: (meta) => baseRepo.inspectSheetStructure(meta),
    };

    function RoleSwitchTrigger(): React.JSX.Element {
      const { switchMockProfile } = useAuth();
      return (
        <button
          type="button"
          data-testid="test-switch-contributor"
          onClick={() => switchMockProfile('contributor')}
        >
          Contributor
        </button>
      );
    }

    window.location.hash = '#/dashboard';
    render(
      <ToastProvider>
        <AuthProvider>
          <DataProvider
            initialSimulation={{ latencyMs: 0 }}
            repositoryOverride={flakyRepo}
          >
            <DashboardPage />
            <RoleSwitchTrigger />
          </DataProvider>
        </AuthProvider>
      </ToastProvider>,
    );

    // First load fails -> shows recoverable error alert
    await waitFor(() => {
      expect(screen.getByText('Connexion Sheets indisponible')).toBeVisible();
    });

    // Click 'Réessayer' -> succeeds and renders empty dataset safely with 'ALL' selected
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    await waitFor(() => {
      expect(
        screen.queryByText('Connexion Sheets indisponible'),
      ).not.toBeInTheDocument();
    });

    const select = screen.getByTestId(
      'dashboard-harvest-select',
    ) as HTMLSelectElement;
    expect(select.value).toBe('ALL');
    expect(screen.getByTestId('kpi-harvested-kg')).toHaveTextContent('0 kg');
    expect(screen.getByTestId('kpi-available-kg')).toHaveTextContent('0 kg');
    expect(screen.queryByTestId('kpi-forecast-badge')).toBeNull();

    // Switching to contributor role keeps Dashboard functional
    fireEvent.click(screen.getByTestId('test-switch-contributor'));
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeVisible();
    });
  });
});
