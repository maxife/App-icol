import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  RepositoryError,
  SEED_MOCK_USERS,
  computeOrderTotals,
  extractCustomerDirectory,
  extractRelaySuggestions,
  normalizeHarvestLabel,
  normalizeOrderTransferState,
  type AccountingEntry,
  type CreateAccountingEntryInput,
  type CreateHarvestInput,
  type CreateSaleOrderInput,
  type CustomerSuggestion,
  type DataRepository,
  type Harvest,
  type JarFormat,
  type OrderStatusPatch,
  type RequestMeta,
  type SaleOrder,
  type SheetInspectionReport,
  type UpdateAccountingEntryInput,
  type UpdateHarvestInput,
  type UpdateSaleOrderInput,
  type UpsertJarFormatInput,
  type UserSession,
} from '@app-icol/shared';
import { useAuth } from './AuthProvider';
import { GasApiClient } from './GasApiClient';
import {
  MockSheetsRepository,
  type NetworkSimulationConfig,
} from './MockSheetsRepository';
import { useToast } from './ToastProvider';
import {
  clearAppIcolLocalStorage,
  stripResetMockFromHash,
} from './bootstrapUrlParams';

export type { NetworkSimulationConfig };

export interface DataContextValue {
  formats: JarFormat[];
  activeFormats: JarFormat[];
  harvests: Harvest[];
  defaultActiveHarvest: Harvest | null;
  orders: SaleOrder[];
  accountingEntries: AccountingEntry[];
  customerSuggestions: CustomerSuggestion[];
  relaySuggestions: string[];
  isLoading: boolean;
  isRefreshing: boolean;
  loadError: string | null;
  dataMode: 'mock' | 'gas';
  isBrowserOffline: boolean;

  refreshDataset: () => Promise<void>;
  createOrder: (
    input: CreateSaleOrderInput,
    meta?: RequestMeta,
  ) => Promise<SaleOrder>;
  updateOrder: (
    id: string,
    input: UpdateSaleOrderInput,
    meta?: RequestMeta,
  ) => Promise<SaleOrder>;
  patchOrderStatuses: (
    id: string,
    patch: OrderStatusPatch,
    meta?: RequestMeta,
  ) => Promise<SaleOrder>;
  deleteOrder: (
    id: string,
    meta?: RequestMeta,
  ) => Promise<{ deletedId: string }>;
  createHarvest: (
    input: CreateHarvestInput,
    meta?: RequestMeta,
  ) => Promise<Harvest>;
  updateHarvest: (
    id: string,
    input: UpdateHarvestInput,
    meta?: RequestMeta,
  ) => Promise<Harvest>;
  setDefaultActiveHarvest: (
    id: string,
    meta?: RequestMeta,
  ) => Promise<Harvest[]>;
  upsertJarFormat: (
    input: UpsertJarFormatInput,
    meta?: RequestMeta,
  ) => Promise<JarFormat>;
  createAccountingEntry: (
    input: CreateAccountingEntryInput,
    meta?: RequestMeta,
  ) => Promise<AccountingEntry>;
  updateAccountingEntry: (
    id: string,
    input: UpdateAccountingEntryInput,
    meta?: RequestMeta,
  ) => Promise<AccountingEntry>;
  deleteAccountingEntry: (
    id: string,
    meta?: RequestMeta,
  ) => Promise<{ deletedId: string }>;
  inspectSheetStructure: (meta?: RequestMeta) => Promise<SheetInspectionReport>;

  networkSimulation: NetworkSimulationConfig;
  setNetworkSimulation: (patch: Partial<NetworkSimulationConfig>) => void;
  resetMockData: () => Promise<void>;
}

const DataContext = createContext<DataContextValue | null>(null);

function resolveDefaultDataMode(): 'mock' | 'gas' {
  const envMode = import.meta.env.VITE_DATA_MODE;
  if (envMode === 'gas') return 'gas';
  return 'mock';
}

function sortOrdersNewestFirst(orders: readonly SaleOrder[]): SaleOrder[] {
  return [...orders].sort((a, b) => {
    const dateCmp = b.date.localeCompare(a.date);
    if (dateCmp !== 0) return dateCmp;
    const updCmp = b.updatedAt.localeCompare(a.updatedAt);
    return updCmp !== 0 ? updCmp : b.id.localeCompare(a.id);
  });
}

export interface DataProviderProps {
  children: React.ReactNode;
  dataModeOverride?: 'mock' | 'gas';
  gasEndpointOverride?: string;
  initialSimulation?: Partial<NetworkSimulationConfig>;
  repositoryOverride?: DataRepository;
}

export function DataProvider({
  children,
  dataModeOverride,
  gasEndpointOverride,
  initialSimulation,
  repositoryOverride,
}: DataProviderProps): React.JSX.Element {
  const dataMode = dataModeOverride ?? resolveDefaultDataMode();
  const { session } = useAuth();
  const toast = useToast();

  const sessionRef = useRef<UserSession | null>(session);
  sessionRef.current = session;

  const [networkSimulation, setNetworkSimulationState] =
    useState<NetworkSimulationConfig>(() => ({
      offlineMode: initialSimulation?.offlineMode ?? false,
      failNextWrite: initialSimulation?.failNextWrite ?? false,
      latencyMs: initialSimulation?.latencyMs ?? 40,
    }));

  const mockRepoRef = useRef<MockSheetsRepository | null>(null);
  if (!mockRepoRef.current && dataMode === 'mock' && !repositoryOverride) {
    mockRepoRef.current = new MockSheetsRepository({
      getActorSession: () => sessionRef.current,
      initialSimulation,
      onSimulationChange: (next) => {
        setNetworkSimulationState(next);
      },
    });
  }

  const repository = useMemo<DataRepository>(() => {
    if (repositoryOverride) return repositoryOverride;
    if (dataMode === 'gas') {
      return new GasApiClient({
        endpointUrl:
          gasEndpointOverride ?? import.meta.env.VITE_GAS_WEBAPP_URL ?? '',
        getIdToken: () => sessionRef.current?.idToken,
      });
    }
    return mockRepoRef.current!;
  }, [repositoryOverride, dataMode, gasEndpointOverride]);

  const [formats, setFormats] = useState<JarFormat[]>([]);
  const [harvests, setHarvests] = useState<Harvest[]>([]);
  const [orders, setOrders] = useState<SaleOrder[]>([]);
  const [accountingEntries, setAccountingEntries] = useState<AccountingEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isBrowserOffline, setIsBrowserOffline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine === false : false,
  );
  const hasHydratedOnceRef = useRef(false);

  useEffect(() => {
    const onOnline = (): void => setIsBrowserOffline(false);
    const onOffline = (): void => setIsBrowserOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const loadDatasetForActor = useCallback(
    async (actorOverride?: UserSession | null) => {
      const targetSession =
        actorOverride !== undefined ? actorOverride : sessionRef.current;
      if (!targetSession) {
        setIsLoading(false);
        setAccountingEntries([]);
        return;
      }

      if (!hasHydratedOnceRef.current) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }
      setLoadError(null);

      try {
        const ds = await repository.getDataset({ actor: targetSession });
        setFormats(ds.formats);
        setHarvests(ds.harvests);
        setOrders(sortOrdersNewestFirst(ds.orders));
        setAccountingEntries(ds.accountingEntries);
        hasHydratedOnceRef.current = true;
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Impossible de charger les données du rucher.';
        setLoadError(message);
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [repository],
  );

  useEffect(() => {
    void loadDatasetForActor(session);
  }, [session, loadDatasetForActor]);

  const setNetworkSimulation = useCallback(
    (patch: Partial<NetworkSimulationConfig>) => {
      if (mockRepoRef.current) {
        mockRepoRef.current.setNetworkSimulation(patch);
      } else {
        setNetworkSimulationState((prev) => ({ ...prev, ...patch }));
      }
    },
    [],
  );

  const resetMockData = useCallback(async () => {
    clearAppIcolLocalStorage(window.localStorage);
    if (mockRepoRef.current) {
      mockRepoRef.current.setNetworkSimulation({
        offlineMode: false,
        failNextWrite: false,
        latencyMs: initialSimulation?.latencyMs ?? 40,
      });
      const fresh = mockRepoRef.current.resetToSeedDataset();
      setFormats(fresh.formats);
      setHarvests(fresh.harvests);
      setOrders(sortOrdersNewestFirst(fresh.orders));
      setAccountingEntries(fresh.accountingEntries);
      setLoadError(null);
      hasHydratedOnceRef.current = true;
    }
    sessionRef.current = { ...SEED_MOCK_USERS.manager };
    window.dispatchEvent(new CustomEvent('app-icol:mock-reset'));
    toast.info('Données démo réinitialisées');
  }, [initialSimulation?.latencyMs, toast]);

  // Support in-SPA hash navigation containing ?resetMock=1
  useEffect(() => {
    const onHashChange = (): void => {
      const { didStrip, cleanHash } = stripResetMockFromHash(window.location.hash);
      if (didStrip) {
        const nextUrl = `${window.location.pathname}${window.location.search}${cleanHash}`;
        window.history.replaceState(window.history.state, '', nextUrl);
        void resetMockData();
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
    };
  }, [resetMockData]);

  const refreshDataset = useCallback(async () => {
    await loadDatasetForActor();
  }, [loadDatasetForActor]);

  const createOrder = useCallback(
    async (input: CreateSaleOrderInput, meta?: RequestMeta) => {
      const created = await repository.createOrder(input, {
        ...meta,
        actor: meta?.actor !== undefined ? meta.actor : sessionRef.current,
      });
      setOrders((prev) => sortOrdersNewestFirst([created, ...prev]));
      return created;
    },
    [repository],
  );

  const updateOrder = useCallback(
    async (id: string, input: UpdateSaleOrderInput, meta?: RequestMeta) => {
      const updated = await repository.updateOrder(id, input, {
        ...meta,
        actor: meta?.actor !== undefined ? meta.actor : sessionRef.current,
      });
      setOrders((prev) =>
        sortOrdersNewestFirst(prev.map((o) => (o.id === id ? updated : o))),
      );
      return updated;
    },
    [repository],
  );

  const patchOrderStatuses = useCallback(
    async (id: string, patch: OrderStatusPatch, meta?: RequestMeta) => {
      const previousOrder = orders.find((o) => o.id === id);
      if (!previousOrder) {
        throw new RepositoryError('NOT_FOUND', `Commande "${id}" introuvable.`);
      }

      const activeActor =
        meta?.actor !== undefined ? meta.actor : sessionRef.current;
      const nextOrderStatus = patch.orderStatus ?? previousOrder.orderStatus;
      const nextPaymentStatus = patch.paymentStatus ?? previousOrder.paymentStatus;
      const harvest = harvests.find(
        (h) =>
          normalizeHarvestLabel(h.label) ===
          normalizeHarvestLabel(previousOrder.harvestLabel),
      );
      const totals = computeOrderTotals(
        previousOrder.items,
        harvest,
        formats,
        nextPaymentStatus,
        previousOrder.manualAmountOverrideEur,
      );

      // D-03: Transition-scoped co-seller transfer protection
      const isTransitionToPaid =
        patch.paymentStatus === 'Payé' && previousOrder.paymentStatus !== 'Payé';
      const transferActor =
        isTransitionToPaid || patch.collectedByThirdParty === true
          ? activeActor
          : null;

      const transfer = normalizeOrderTransferState(
        nextPaymentStatus,
        patch.collectedByThirdParty !== undefined
          ? patch.collectedByThirdParty
          : previousOrder.collectedByThirdParty,
        patch.collectorName !== undefined
          ? patch.collectorName
          : previousOrder.collectorName,
        patch.transferStatus !== undefined
          ? patch.transferStatus
          : previousOrder.transferStatus,
        transferActor,
      );

      const optimisticOrder: SaleOrder = {
        ...previousOrder,
        orderStatus: nextOrderStatus,
        paymentStatus: nextPaymentStatus,
        effectiveAmountEur: totals.effectiveAmountEur,
        collectedByThirdParty: transfer.collectedByThirdParty,
        collectorName: transfer.collectorName,
        transferStatus: transfer.transferStatus,
        updatedAt: new Date().toISOString(),
      };

      setOrders((prev) =>
        prev.map((o) => (o.id === id ? optimisticOrder : o)),
      );

      try {
        const saved = await repository.patchOrderStatuses(id, patch, {
          ...meta,
          actor: activeActor,
        });
        setOrders((prev) => prev.map((o) => (o.id === id ? saved : o)));
        return saved;
      } catch (err) {
        // Automatic rollback to previous state + error Toast
        setOrders((prev) =>
          prev.map((o) => (o.id === id ? previousOrder : o)),
        );
        toast.error(
          'Échec de la mise à jour',
          err instanceof Error ? err.message : 'Erreur réseau',
        );
        throw err;
      }
    },
    [orders, harvests, formats, repository, toast],
  );

  const deleteOrder = useCallback(
    async (id: string, meta?: RequestMeta) => {
      const res = await repository.deleteOrder(id, {
        ...meta,
        actor: meta?.actor !== undefined ? meta.actor : sessionRef.current,
      });
      setOrders((prev) => prev.filter((o) => o.id !== id));
      return res;
    },
    [repository],
  );

  const createHarvest = useCallback(
    async (input: CreateHarvestInput, meta?: RequestMeta) => {
      const created = await repository.createHarvest(input, {
        ...meta,
        actor: meta?.actor !== undefined ? meta.actor : sessionRef.current,
      });
      setHarvests((prev) => {
        const base = created.isDefaultActive
          ? prev.map((h) => ({ ...h, isDefaultActive: false }))
          : prev;
        return [...base, created];
      });
      return created;
    },
    [repository],
  );

  const updateHarvest = useCallback(
    async (id: string, input: UpdateHarvestInput, meta?: RequestMeta) => {
      const existing = harvests.find((h) => h.id === id);
      const updated = await repository.updateHarvest(id, input, {
        ...meta,
        actor: meta?.actor !== undefined ? meta.actor : sessionRef.current,
      });
      setHarvests((prev) =>
        prev.map((h) => {
          if (h.id === id) return updated;
          if (updated.isDefaultActive) return { ...h, isDefaultActive: false };
          return h;
        }),
      );
      if (
        existing &&
        normalizeHarvestLabel(existing.label) !==
          normalizeHarvestLabel(updated.label)
      ) {
        const oldNorm = normalizeHarvestLabel(existing.label);
        setOrders((prev) =>
          prev.map((o) =>
            normalizeHarvestLabel(o.harvestLabel) === oldNorm
              ? { ...o, harvestLabel: updated.label }
              : o,
          ),
        );
      }
      return updated;
    },
    [harvests, repository],
  );

  const setDefaultActiveHarvest = useCallback(
    async (id: string, meta?: RequestMeta) => {
      const updatedList = await repository.setDefaultActiveHarvest(id, {
        ...meta,
        actor: meta?.actor !== undefined ? meta.actor : sessionRef.current,
      });
      setHarvests(updatedList);
      return updatedList;
    },
    [repository],
  );

  const upsertJarFormat = useCallback(
    async (input: UpsertJarFormatInput, meta?: RequestMeta) => {
      const saved = await repository.upsertJarFormat(input, {
        ...meta,
        actor: meta?.actor !== undefined ? meta.actor : sessionRef.current,
      });
      setFormats((prev) => {
        const idx = prev.findIndex(
          (f) => f.code.toLowerCase() === saved.code.toLowerCase(),
        );
        if (idx === -1) return [...prev, saved];
        return prev.map((f, i) => (i === idx ? saved : f));
      });
      return saved;
    },
    [repository],
  );

  const createAccountingEntry = useCallback(
    async (input: CreateAccountingEntryInput, meta?: RequestMeta) => {
      const created = await repository.createAccountingEntry(input, {
        ...meta,
        actor: meta?.actor !== undefined ? meta.actor : sessionRef.current,
      });
      setAccountingEntries((prev) => [created, ...prev]);
      return created;
    },
    [repository],
  );

  const updateAccountingEntry = useCallback(
    async (
      id: string,
      input: UpdateAccountingEntryInput,
      meta?: RequestMeta,
    ) => {
      const updated = await repository.updateAccountingEntry(id, input, {
        ...meta,
        actor: meta?.actor !== undefined ? meta.actor : sessionRef.current,
      });
      setAccountingEntries((prev) =>
        prev.map((e) => (e.id === id ? updated : e)),
      );
      return updated;
    },
    [repository],
  );

  const deleteAccountingEntry = useCallback(
    async (id: string, meta?: RequestMeta) => {
      const res = await repository.deleteAccountingEntry(id, {
        ...meta,
        actor: meta?.actor !== undefined ? meta.actor : sessionRef.current,
      });
      setAccountingEntries((prev) => prev.filter((e) => e.id !== id));
      return res;
    },
    [repository],
  );

  const inspectSheetStructure = useCallback(
    async (meta?: RequestMeta) => {
      return repository.inspectSheetStructure({
        ...meta,
        actor: meta?.actor !== undefined ? meta.actor : sessionRef.current,
      });
    },
    [repository],
  );

  const activeFormats = useMemo(
    () => formats.filter((f) => f.active),
    [formats],
  );

  const defaultActiveHarvest = useMemo(
    () => harvests.find((h) => h.isDefaultActive) ?? harvests[0] ?? null,
    [harvests],
  );

  const customerSuggestions = useMemo(
    () => extractCustomerDirectory(orders),
    [orders],
  );

  const relaySuggestions = useMemo(
    () => extractRelaySuggestions(orders),
    [orders],
  );

  const value = useMemo<DataContextValue>(
    () => ({
      formats,
      activeFormats,
      harvests,
      defaultActiveHarvest,
      orders,
      accountingEntries,
      customerSuggestions,
      relaySuggestions,
      isLoading,
      isRefreshing,
      loadError,
      dataMode,
      isBrowserOffline,
      refreshDataset,
      createOrder,
      updateOrder,
      patchOrderStatuses,
      deleteOrder,
      createHarvest,
      updateHarvest,
      setDefaultActiveHarvest,
      upsertJarFormat,
      createAccountingEntry,
      updateAccountingEntry,
      deleteAccountingEntry,
      inspectSheetStructure,
      networkSimulation,
      setNetworkSimulation,
      resetMockData,
    }),
    [
      formats,
      activeFormats,
      harvests,
      defaultActiveHarvest,
      orders,
      accountingEntries,
      customerSuggestions,
      relaySuggestions,
      isLoading,
      isRefreshing,
      loadError,
      dataMode,
      isBrowserOffline,
      refreshDataset,
      createOrder,
      updateOrder,
      patchOrderStatuses,
      deleteOrder,
      createHarvest,
      updateHarvest,
      setDefaultActiveHarvest,
      upsertJarFormat,
      createAccountingEntry,
      updateAccountingEntry,
      deleteAccountingEntry,
      inspectSheetStructure,
      networkSimulation,
      setNetworkSimulation,
      resetMockData,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) {
    throw new Error('useData must be used within a DataProvider.');
  }
  return ctx;
}
