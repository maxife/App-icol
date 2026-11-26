import {
  ALLOWED_SHEETS,
  ALWAYS_READ_ONLY_SUMMARY_SHEETS,
  DEFAULT_SCHEMA_CONFIG,
  FORBIDDEN_SHEETS,
  GAS_ACTION_POLICIES,
  RepositoryError,
  SEED_MOCK_USERS,
  computeOrderTotals,
  createSeedDataset,
  extractIsoCalendarYear,
  isAccountingCategory,
  isAccountingEntryType,
  isCategoryValidForType,
  isOrderStatus,
  isPaymentStatus,
  normalizeHarvestLabel,
  normalizeOrderTransferState,
  normalizePhoneNumber,
  roundCurrencyEur,
  roundWeightKg,
  slugifyHarvestId,
  type AbortSignalLike,
  type AccountingEntry,
  type AppDataset,
  type CreateAccountingEntryInput,
  type CreateHarvestInput,
  type CreateSaleOrderInput,
  type DataRepository,
  type GasRpcAction,
  type Harvest,
  type JarFormat,
  type MutationMeta,
  type OrderLineItemInput,
  type OrderStatusPatch,
  type SaleOrder,
  type SheetInspectionReport,
  type UpdateAccountingEntryInput,
  type UpdateHarvestInput,
  type UpdateSaleOrderInput,
  type UpsertJarFormatInput,
  type UserSession,
} from '@app-icol/shared';

export const MOCK_DATASET_STORAGE_KEY = 'app-icol:dataset:v1';
export const MOCK_IDEMPOTENCY_STORAGE_KEY = 'app-icol:idempotency:v1';
const MAX_IDEMPOTENCY_ENTRIES = 200;

export interface NetworkSimulationConfig {
  offlineMode: boolean;
  failNextWrite: boolean;
  latencyMs: number;
}

export interface MockSheetsRepositoryOptions {
  storage?: Storage;
  getActorSession: () => UserSession | null;
  initialSimulation?: Partial<NetworkSimulationConfig>;
  onSimulationChange?: (next: NetworkSimulationConfig) => void;
}

interface IdempotencyEntry {
  value: unknown;
  createdAt: number;
}

function sortOrdersNewestFirst(orders: readonly SaleOrder[]): SaleOrder[] {
  return [...orders].sort((a, b) => {
    const dateCmp = b.date.localeCompare(a.date);
    if (dateCmp !== 0) return dateCmp;
    const updCmp = b.updatedAt.localeCompare(a.updatedAt);
    return updCmp !== 0 ? updCmp : b.id.localeCompare(a.id);
  });
}

function sortAccountingNewestFirst(
  entries: readonly AccountingEntry[],
): AccountingEntry[] {
  return [...entries].sort((a, b) => {
    const dateCmp = b.date.localeCompare(a.date);
    return dateCmp !== 0 ? dateCmp : b.id.localeCompare(a.id);
  });
}

function waitWithSignal(ms: number, signal?: AbortSignalLike): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(
      new RepositoryError('NETWORK_ERROR', 'Requête annulée.'),
    );
  }
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort(): void {
      clearTimeout(timer);
      reject(new RepositoryError('NETWORK_ERROR', 'Requête annulée.'));
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class MockSheetsRepository implements DataRepository {
  private readonly storage: Storage;
  private readonly getActorSession: () => UserSession | null;
  private readonly onSimulationChange?: (next: NetworkSimulationConfig) => void;
  private simulation: NetworkSimulationConfig;
  private idempotencyCache = new Map<string, IdempotencyEntry>();

  constructor(options: MockSheetsRepositoryOptions) {
    this.storage = options.storage ?? window.localStorage;
    this.getActorSession = options.getActorSession;
    this.onSimulationChange = options.onSimulationChange;
    this.simulation = {
      offlineMode: options.initialSimulation?.offlineMode ?? false,
      failNextWrite: options.initialSimulation?.failNextWrite ?? false,
      latencyMs: options.initialSimulation?.latencyMs ?? 40,
    };
    this.loadIdempotencyFromStorage();
    // Ensure seed dataset is persisted on first instantiation if absent
    this.readStoredDataset();
  }

  public getNetworkSimulation(): NetworkSimulationConfig {
    return { ...this.simulation };
  }

  public setNetworkSimulation(patch: Partial<NetworkSimulationConfig>): NetworkSimulationConfig {
    this.simulation = {
      ...this.simulation,
      ...patch,
    };
    this.onSimulationChange?.({ ...this.simulation });
    return { ...this.simulation };
  }

  public resetToSeedDataset(): AppDataset {
    this.idempotencyCache.clear();
    this.storage.removeItem(MOCK_IDEMPOTENCY_STORAGE_KEY);
    const fresh = createSeedDataset(new Date().toISOString());
    this.writeStoredDataset(fresh);
    return structuredClone(fresh);
  }

  private loadIdempotencyFromStorage(): void {
    try {
      const raw = this.storage.getItem(MOCK_IDEMPOTENCY_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Array<[string, IdempotencyEntry]>;
      if (Array.isArray(parsed)) {
        this.idempotencyCache = new Map(parsed);
      }
    } catch {
      this.idempotencyCache.clear();
    }
  }

  private persistIdempotencyToStorage(): void {
    try {
      const entries = Array.from(this.idempotencyCache.entries()).slice(
        -MAX_IDEMPOTENCY_ENTRIES,
      );
      this.idempotencyCache = new Map(entries);
      this.storage.setItem(MOCK_IDEMPOTENCY_STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // Ignore storage quota errors on idempotency cache
    }
  }

  private readStoredDataset(): AppDataset {
    try {
      const raw = this.storage.getItem(MOCK_DATASET_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AppDataset;
        if (
          parsed &&
          Array.isArray(parsed.formats) &&
          Array.isArray(parsed.harvests) &&
          Array.isArray(parsed.orders) &&
          Array.isArray(parsed.accountingEntries)
        ) {
          return parsed;
        }
      }
    } catch {
      // Fall through to seed hydration if JSON was corrupted
    }
    const seeded = createSeedDataset();
    this.writeStoredDataset(seeded);
    return seeded;
  }

  private writeStoredDataset(dataset: AppDataset): void {
    const next: AppDataset = {
      ...dataset,
      serverTimestamp: new Date().toISOString(),
    };
    this.storage.setItem(MOCK_DATASET_STORAGE_KEY, JSON.stringify(next));
  }

  private isOffline(): boolean {
    return (
      this.simulation.offlineMode ||
      (typeof navigator !== 'undefined' && navigator.onLine === false)
    );
  }

  private assertAuthorizedActor(
    action: GasRpcAction,
    meta?: MutationMeta,
  ): UserSession {
    const actor = meta?.actor !== undefined ? meta.actor : this.getActorSession();
    if (!actor) {
      throw new RepositoryError(
        'UNAUTHENTICATED',
        'Connexion requise pour accéder aux données du rucher.',
      );
    }
    const policy = GAS_ACTION_POLICIES[action];
    if (!policy.allowedRoles.includes(actor.role)) {
      throw new RepositoryError(
        'FORBIDDEN_ROLE',
        'Action réservée au gestionnaire du rucher.',
      );
    }
    return actor;
  }

  private async executeRead<T>(
    action: GasRpcAction,
    meta: MutationMeta | undefined,
    fn: (actor: UserSession, dataset: AppDataset) => T,
  ): Promise<T> {
    await waitWithSignal(this.simulation.latencyMs, meta?.signal);
    if (this.isOffline()) {
      throw new RepositoryError(
        'NETWORK_ERROR',
        'Mode hors-ligne : impossible de joindre le serveur. Vos saisies sont conservées.',
      );
    }
    const actor = this.assertAuthorizedActor(action, meta);
    const dataset = this.readStoredDataset();
    return structuredClone(fn(actor, dataset));
  }

  private async executeMutation<T>(
    action: GasRpcAction,
    meta: MutationMeta | undefined,
    fn: (actor: UserSession, dataset: AppDataset) => T,
  ): Promise<T> {
    await waitWithSignal(this.simulation.latencyMs, meta?.signal);

    if (this.isOffline()) {
      throw new RepositoryError(
        'NETWORK_ERROR',
        'Mode hors-ligne : impossible de joindre le serveur. Vos saisies sont conservées.',
      );
    }

    if (this.simulation.failNextWrite) {
      this.simulation = {
        ...this.simulation,
        failNextWrite: false,
      };
      this.onSimulationChange?.({ ...this.simulation });
      // Strictly DO NOT cache clientRequestId on simulated failure so immediate retry succeeds!
      throw new RepositoryError(
        'NETWORK_ERROR',
        "Échec réseau simulé lors de l'enregistrement. Vos données sont conservées, veuillez réessayer.",
      );
    }

    const actor = this.assertAuthorizedActor(action, meta);

    const reqId = meta?.clientRequestId?.trim();
    if (reqId && this.idempotencyCache.has(reqId)) {
      return structuredClone(this.idempotencyCache.get(reqId)!.value as T);
    }

    const dataset = this.readStoredDataset();
    const result = fn(actor, dataset);
    this.writeStoredDataset(dataset);

    if (reqId) {
      this.idempotencyCache.set(reqId, {
        value: structuredClone(result),
        createdAt: Date.now(),
      });
      this.persistIdempotencyToStorage();
    }

    return structuredClone(result);
  }

  private generateNextId(prefix: string, existingIds: readonly string[]): string {
    let maxNum = 0;
    const re = new RegExp(`^${prefix}-(\\d+)$`);
    for (const id of existingIds) {
      const m = re.exec(id);
      if (m) {
        const n = Number(m[1]);
        if (n > maxNum) maxNum = n;
      }
    }
    return `${prefix}-${String(maxNum + 1).padStart(3, '0')}`;
  }

  // ==========================================================================
  // 1–6: Reads
  // ==========================================================================

  public async getDataset(meta?: MutationMeta): Promise<AppDataset> {
    return this.executeRead('dataset.get', meta, (actor, dataset) => ({
      formats: dataset.formats,
      harvests: dataset.harvests,
      orders: sortOrdersNewestFirst(dataset.orders),
      accountingEntries:
        actor.role === 'manager'
          ? sortAccountingNewestFirst(dataset.accountingEntries)
          : [],
      serverTimestamp: new Date().toISOString(),
      session: actor,
    }));
  }

  public async listFormats(meta?: MutationMeta): Promise<JarFormat[]> {
    return this.executeRead('formats.list', meta, (_actor, dataset) => dataset.formats);
  }

  public async listHarvests(meta?: MutationMeta): Promise<Harvest[]> {
    return this.executeRead('harvests.list', meta, (_actor, dataset) => dataset.harvests);
  }

  public async listOrders(meta?: MutationMeta): Promise<SaleOrder[]> {
    return this.executeRead('orders.list', meta, (_actor, dataset) =>
      sortOrdersNewestFirst(dataset.orders),
    );
  }

  public async getOrderById(
    id: string,
    meta?: MutationMeta,
  ): Promise<SaleOrder | null> {
    return this.executeRead(
      'orders.getById',
      meta,
      (_actor, dataset) => dataset.orders.find((o) => o.id === id) ?? null,
    );
  }

  public async listAccountingEntries(
    year?: number,
    meta?: MutationMeta,
  ): Promise<AccountingEntry[]> {
    return this.executeRead('accounting.list', meta, (_actor, dataset) => {
      const filtered =
        year !== undefined
          ? dataset.accountingEntries.filter((e) => e.year === year)
          : dataset.accountingEntries;
      return sortAccountingNewestFirst(filtered);
    });
  }

  // ==========================================================================
  // 7–10: Sales / Orders Mutations
  // ==========================================================================

  public async createOrder(
    input: CreateSaleOrderInput,
    meta?: MutationMeta,
  ): Promise<SaleOrder> {
    return this.executeMutation('orders.create', meta, (actor, dataset) => {
      const customerName = input.customerName.trim();
      if (!customerName) {
        throw new RepositoryError(
          'VALIDATION_ERROR',
          'Le nom du client ou le contexte de vente est obligatoire.',
        );
      }
      if (extractIsoCalendarYear(input.date) === null) {
        throw new RepositoryError('VALIDATION_ERROR', 'Date de commande invalide.');
      }
      if (!isOrderStatus(input.orderStatus) || !isPaymentStatus(input.paymentStatus)) {
        throw new RepositoryError('VALIDATION_ERROR', 'Statut de commande invalide.');
      }

      const harvestLabel = normalizeHarvestLabel(input.harvestLabel);
      const harvest = dataset.harvests.find(
        (h) => normalizeHarvestLabel(h.label) === harvestLabel,
      );
      if (!harvest) {
        throw new RepositoryError(
          'VALIDATION_ERROR',
          `Récolte "${harvestLabel}" introuvable.`,
        );
      }

      const totals = computeOrderTotals(
        input.items,
        harvest,
        dataset.formats,
        input.paymentStatus,
        input.manualAmountOverrideEur ?? null,
      );
      if (totals.totalJarsCount < 1) {
        throw new RepositoryError(
          'VALIDATION_ERROR',
          'Veuillez sélectionner au moins un pot.',
        );
      }

      const transfer = normalizeOrderTransferState(
        input.paymentStatus,
        input.collectedByThirdParty,
        input.collectorName,
        input.transferStatus,
        actor,
      );

      const newId = this.generateNextId(
        'ord',
        dataset.orders.map((o) => o.id),
      );
      const maxRow = dataset.orders.reduce(
        (m, o) => Math.max(m, o.sheetRowNumber ?? 1),
        1,
      );

      const created: SaleOrder = {
        id: newId,
        sheetRowNumber: maxRow + 1,
        date: input.date.trim(),
        customerName,
        phone: normalizePhoneNumber(input.phone),
        contextOrRelay: input.contextOrRelay.trim(),
        harvestLabel: harvest.label,
        items: totals.items,
        computedWeightKg: totals.computedWeightKg,
        computedAmountEur: totals.computedAmountEur,
        manualAmountOverrideEur: totals.manualAmountOverrideEur,
        effectiveAmountEur: totals.effectiveAmountEur,
        orderStatus: input.orderStatus,
        paymentStatus: input.paymentStatus,
        collectedByThirdParty: transfer.collectedByThirdParty,
        collectorName: transfer.collectorName,
        transferStatus: transfer.transferStatus,
        notes: input.notes?.trim() ? input.notes.trim() : undefined,
        updatedAt: new Date().toISOString(),
      };

      dataset.orders.push(created);
      return created;
    });
  }

  public async updateOrder(
    id: string,
    input: UpdateSaleOrderInput,
    meta?: MutationMeta,
  ): Promise<SaleOrder> {
    return this.executeMutation('orders.update', meta, (actor, dataset) => {
      const idx = dataset.orders.findIndex((o) => o.id === id);
      if (idx === -1) {
        throw new RepositoryError('NOT_FOUND', `Commande "${id}" introuvable.`);
      }
      const existing = dataset.orders[idx]!;

      const customerName = input.customerName.trim();
      if (!customerName) {
        throw new RepositoryError(
          'VALIDATION_ERROR',
          'Le nom du client ou le contexte de vente est obligatoire.',
        );
      }
      if (extractIsoCalendarYear(input.date) === null) {
        throw new RepositoryError('VALIDATION_ERROR', 'Date de commande invalide.');
      }
      if (!isOrderStatus(input.orderStatus) || !isPaymentStatus(input.paymentStatus)) {
        throw new RepositoryError('VALIDATION_ERROR', 'Statut de commande invalide.');
      }

      const harvestLabel = normalizeHarvestLabel(input.harvestLabel);
      const harvest = dataset.harvests.find(
        (h) => normalizeHarvestLabel(h.label) === harvestLabel,
      );
      if (!harvest) {
        throw new RepositoryError(
          'VALIDATION_ERROR',
          `Récolte "${harvestLabel}" introuvable.`,
        );
      }

      // EC-20: Preserve historical unitWeightKg & unitPriceEur snapshots on unchanged harvest lines
      const isSameHarvest =
        normalizeHarvestLabel(existing.harvestLabel) === harvestLabel;
      const mergedItems: OrderLineItemInput[] = input.items.map((item) => {
        if (!isSameHarvest) return item;
        const prevLine = existing.items.find(
          (prev) => prev.formatCode === item.formatCode,
        );
        if (!prevLine) return item;
        return {
          formatCode: item.formatCode,
          quantity: item.quantity,
          unitWeightKg: item.unitWeightKg ?? prevLine.unitWeightKg,
          unitPriceEur: item.unitPriceEur ?? prevLine.unitPriceEur,
        };
      });

      const totals = computeOrderTotals(
        mergedItems,
        harvest,
        dataset.formats,
        input.paymentStatus,
        input.manualAmountOverrideEur ?? null,
      );
      if (totals.totalJarsCount < 1) {
        throw new RepositoryError(
          'VALIDATION_ERROR',
          'Veuillez sélectionner au moins un pot.',
        );
      }

      // D-03: Only auto-activate co-seller transfer on transition into Payé or explicit third-party toggle
      const isTransitionToPaid =
        existing.paymentStatus !== 'Payé' && input.paymentStatus === 'Payé';
      const transferActor =
        isTransitionToPaid || input.collectedByThirdParty ? actor : null;

      const transfer = normalizeOrderTransferState(
        input.paymentStatus,
        input.collectedByThirdParty,
        input.collectorName,
        input.transferStatus,
        transferActor,
      );

      const updated: SaleOrder = {
        ...existing,
        date: input.date.trim(),
        customerName,
        phone: normalizePhoneNumber(input.phone),
        contextOrRelay: input.contextOrRelay.trim(),
        harvestLabel: harvest.label,
        items: totals.items,
        computedWeightKg: totals.computedWeightKg,
        computedAmountEur: totals.computedAmountEur,
        manualAmountOverrideEur: totals.manualAmountOverrideEur,
        effectiveAmountEur: totals.effectiveAmountEur,
        orderStatus: input.orderStatus,
        paymentStatus: input.paymentStatus,
        collectedByThirdParty: transfer.collectedByThirdParty,
        collectorName: transfer.collectorName,
        transferStatus: transfer.transferStatus,
        notes: input.notes?.trim() ? input.notes.trim() : undefined,
        updatedAt: new Date().toISOString(),
      };

      dataset.orders[idx] = updated;
      return updated;
    });
  }

  public async patchOrderStatuses(
    id: string,
    patch: OrderStatusPatch,
    meta?: MutationMeta,
  ): Promise<SaleOrder> {
    return this.executeMutation('orders.patchStatuses', meta, (actor, dataset) => {
      const idx = dataset.orders.findIndex((o) => o.id === id);
      if (idx === -1) {
        throw new RepositoryError('NOT_FOUND', `Commande "${id}" introuvable.`);
      }
      const existing = dataset.orders[idx]!;

      const nextOrderStatus = patch.orderStatus ?? existing.orderStatus;
      const nextPaymentStatus = patch.paymentStatus ?? existing.paymentStatus;
      if (!isOrderStatus(nextOrderStatus) || !isPaymentStatus(nextPaymentStatus)) {
        throw new RepositoryError('VALIDATION_ERROR', 'Statut de commande invalide.');
      }

      const harvest = dataset.harvests.find(
        (h) =>
          normalizeHarvestLabel(h.label) ===
          normalizeHarvestLabel(existing.harvestLabel),
      );

      const totals = computeOrderTotals(
        existing.items,
        harvest,
        dataset.formats,
        nextPaymentStatus,
        existing.manualAmountOverrideEur,
      );

      // D-03: Pass actorSession ONLY on transition into Payé (or explicit collectedByThirdParty = true)
      const isTransitionToPaid =
        patch.paymentStatus === 'Payé' && existing.paymentStatus !== 'Payé';
      const transferActor =
        isTransitionToPaid || patch.collectedByThirdParty === true ? actor : null;

      const transfer = normalizeOrderTransferState(
        nextPaymentStatus,
        patch.collectedByThirdParty !== undefined
          ? patch.collectedByThirdParty
          : existing.collectedByThirdParty,
        patch.collectorName !== undefined
          ? patch.collectorName
          : existing.collectorName,
        patch.transferStatus !== undefined
          ? patch.transferStatus
          : existing.transferStatus,
        transferActor,
      );

      const updated: SaleOrder = {
        ...existing,
        orderStatus: nextOrderStatus,
        paymentStatus: nextPaymentStatus,
        effectiveAmountEur: totals.effectiveAmountEur,
        collectedByThirdParty: transfer.collectedByThirdParty,
        collectorName: transfer.collectorName,
        transferStatus: transfer.transferStatus,
        updatedAt: new Date().toISOString(),
      };

      dataset.orders[idx] = updated;
      return updated;
    });
  }

  public async deleteOrder(
    id: string,
    meta?: MutationMeta,
  ): Promise<{ deletedId: string }> {
    return this.executeMutation('orders.delete', meta, (_actor, dataset) => {
      const idx = dataset.orders.findIndex((o) => o.id === id);
      if (idx === -1) {
        throw new RepositoryError('NOT_FOUND', `Commande "${id}" introuvable.`);
      }
      dataset.orders.splice(idx, 1);
      return { deletedId: id };
    });
  }

  // ==========================================================================
  // 11–14: Harvests & Formats Mutations (manager-only)
  // ==========================================================================

  public async createHarvest(
    input: CreateHarvestInput,
    meta?: MutationMeta,
  ): Promise<Harvest> {
    return this.executeMutation('harvests.create', meta, (_actor, dataset) => {
      const label = normalizeHarvestLabel(input.label);
      if (!label) {
        throw new RepositoryError(
          'VALIDATION_ERROR',
          'Le nom de la récolte est obligatoire.',
        );
      }
      const duplicate = dataset.harvests.some(
        (h) => normalizeHarvestLabel(h.label).toLowerCase() === label.toLowerCase(),
      );
      if (duplicate) {
        throw new RepositoryError(
          'VALIDATION_ERROR',
          `Une récolte nommée "${label}" existe déjà.`,
        );
      }
      if (!Number.isFinite(input.forecastWeightKg) || input.forecastWeightKg < 0) {
        throw new RepositoryError(
          'VALIDATION_ERROR',
          'Le poids prévisionnel doit être positif ou nul.',
        );
      }
      if (
        input.realizedWeightKg !== null &&
        (!Number.isFinite(input.realizedWeightKg) || input.realizedWeightKg < 0)
      ) {
        throw new RepositoryError(
          'VALIDATION_ERROR',
          'Le poids réalisé doit être positif, nul ou vide.',
        );
      }

      let id = slugifyHarvestId(label);
      if (dataset.harvests.some((h) => h.id === id)) {
        id = `${id}-${Date.now()}`;
      }

      if (input.isDefaultActive) {
        for (const h of dataset.harvests) {
          h.isDefaultActive = false;
        }
      }

      const unitPricesEur: Record<string, number> = {};
      for (const [code, price] of Object.entries(input.unitPricesEur)) {
        if (!Number.isFinite(price) || price < 0) {
          throw new RepositoryError(
            'VALIDATION_ERROR',
            `Tarif invalide pour le format ${code}.`,
          );
        }
        unitPricesEur[code] = roundCurrencyEur(price);
      }

      const created: Harvest = {
        id,
        label,
        year: Math.trunc(input.year),
        forecastWeightKg: roundWeightKg(input.forecastWeightKg),
        realizedWeightKg:
          input.realizedWeightKg === null
            ? null
            : roundWeightKg(input.realizedWeightKg),
        unitPricesEur,
        isDefaultActive: Boolean(input.isDefaultActive),
      };

      dataset.harvests.push(created);
      return created;
    });
  }

  public async updateHarvest(
    id: string,
    input: UpdateHarvestInput,
    meta?: MutationMeta,
  ): Promise<Harvest> {
    return this.executeMutation('harvests.update', meta, (_actor, dataset) => {
      const idx = dataset.harvests.findIndex((h) => h.id === id);
      if (idx === -1) {
        throw new RepositoryError('NOT_FOUND', `Récolte "${id}" introuvable.`);
      }
      const existing = dataset.harvests[idx]!;

      const nextLabel =
        input.label !== undefined
          ? normalizeHarvestLabel(input.label)
          : existing.label;
      if (!nextLabel) {
        throw new RepositoryError(
          'VALIDATION_ERROR',
          'Le nom de la récolte est obligatoire.',
        );
      }
      const duplicate = dataset.harvests.some(
        (h) =>
          h.id !== id &&
          normalizeHarvestLabel(h.label).toLowerCase() === nextLabel.toLowerCase(),
      );
      if (duplicate) {
        throw new RepositoryError(
          'VALIDATION_ERROR',
          `Une récolte nommée "${nextLabel}" existe déjà.`,
        );
      }

      const nextForecast =
        input.forecastWeightKg !== undefined
          ? input.forecastWeightKg
          : existing.forecastWeightKg;
      if (!Number.isFinite(nextForecast) || nextForecast < 0) {
        throw new RepositoryError(
          'VALIDATION_ERROR',
          'Le poids prévisionnel doit être positif ou nul.',
        );
      }

      const nextRealized =
        input.realizedWeightKg !== undefined
          ? input.realizedWeightKg
          : existing.realizedWeightKg;
      if (
        nextRealized !== null &&
        (!Number.isFinite(nextRealized) || nextRealized < 0)
      ) {
        throw new RepositoryError(
          'VALIDATION_ERROR',
          'Le poids réalisé doit être positif, nul ou vide.',
        );
      }

      const nextUnitPrices: Record<string, number> = {
        ...existing.unitPricesEur,
      };
      if (input.unitPricesEur) {
        for (const [code, price] of Object.entries(input.unitPricesEur)) {
          if (!Number.isFinite(price) || price < 0) {
            throw new RepositoryError(
              'VALIDATION_ERROR',
              `Tarif invalide pour le format ${code}.`,
            );
          }
          nextUnitPrices[code] = roundCurrencyEur(price);
        }
      }

      if (input.isDefaultActive === true) {
        for (const h of dataset.harvests) {
          h.isDefaultActive = false;
        }
      }

      const oldNormLabel = normalizeHarvestLabel(existing.label);
      if (oldNormLabel !== nextLabel) {
        for (const order of dataset.orders) {
          if (normalizeHarvestLabel(order.harvestLabel) === oldNormLabel) {
            order.harvestLabel = nextLabel;
          }
        }
      }

      const updated: Harvest = {
        ...existing,
        label: nextLabel,
        year: input.year !== undefined ? Math.trunc(input.year) : existing.year,
        forecastWeightKg: roundWeightKg(nextForecast),
        realizedWeightKg:
          nextRealized === null ? null : roundWeightKg(nextRealized),
        unitPricesEur: nextUnitPrices,
        isDefaultActive:
          input.isDefaultActive !== undefined
            ? Boolean(input.isDefaultActive)
            : existing.isDefaultActive,
      };

      dataset.harvests[idx] = updated;
      return updated;
    });
  }

  public async setDefaultActiveHarvest(
    id: string,
    meta?: MutationMeta,
  ): Promise<Harvest[]> {
    return this.executeMutation(
      'harvests.setDefaultActive',
      meta,
      (_actor, dataset) => {
        const exists = dataset.harvests.some((h) => h.id === id);
        if (!exists) {
          throw new RepositoryError('NOT_FOUND', `Récolte "${id}" introuvable.`);
        }
        for (const h of dataset.harvests) {
          h.isDefaultActive = h.id === id;
        }
        return dataset.harvests;
      },
    );
  }

  public async upsertJarFormat(
    input: UpsertJarFormatInput,
    meta?: MutationMeta,
  ): Promise<JarFormat> {
    return this.executeMutation('formats.upsert', meta, (_actor, dataset) => {
      const code = input.code.trim();
      const label = input.label.trim();
      if (!code || !label) {
        throw new RepositoryError(
          'VALIDATION_ERROR',
          'Le code et le libellé du format sont obligatoires.',
        );
      }
      if (!Number.isFinite(input.weightKg) || input.weightKg <= 0) {
        throw new RepositoryError(
          'VALIDATION_ERROR',
          'Le poids unitaire du pot doit être strictement supérieur à 0 kg.',
        );
      }

      const normalized: JarFormat = {
        code,
        label,
        weightKg: roundWeightKg(input.weightKg),
        active: Boolean(input.active),
      };

      const existingIdx = dataset.formats.findIndex(
        (f) => f.code.toLowerCase() === code.toLowerCase(),
      );
      if (existingIdx !== -1) {
        normalized.code = dataset.formats[existingIdx]!.code;
        dataset.formats[existingIdx] = normalized;
      } else {
        dataset.formats.push(normalized);
      }
      return normalized;
    });
  }

  // ==========================================================================
  // 15–17: Accounting Mutations (manager-only)
  // ==========================================================================

  public async createAccountingEntry(
    input: CreateAccountingEntryInput,
    meta?: MutationMeta,
  ): Promise<AccountingEntry> {
    return this.executeMutation('accounting.create', meta, (_actor, dataset) => {
      const derivedYear = input.year ?? extractIsoCalendarYear(input.date);
      if (derivedYear === null || !Number.isFinite(derivedYear)) {
        throw new RepositoryError('VALIDATION_ERROR', 'Date comptable invalide.');
      }
      if (
        !isAccountingEntryType(input.type) ||
        !isAccountingCategory(input.category) ||
        !isCategoryValidForType(input.type, input.category)
      ) {
        throw new RepositoryError(
          'VALIDATION_ERROR',
          'Catégorie comptable incompatible avec le type sélectionné.',
        );
      }
      const label = input.label.trim();
      if (!label) {
        throw new RepositoryError(
          'VALIDATION_ERROR',
          "Le libellé de l'écriture est obligatoire.",
        );
      }
      if (!Number.isFinite(input.amountEur) || input.amountEur <= 0) {
        throw new RepositoryError(
          'VALIDATION_ERROR',
          'Le montant comptable doit être strictement positif.',
        );
      }

      const id = this.generateNextId(
        'acc',
        dataset.accountingEntries.map((e) => e.id),
      );
      const maxRow = dataset.accountingEntries.reduce(
        (m, e) => Math.max(m, e.sheetRowNumber ?? 1),
        1,
      );

      const created: AccountingEntry = {
        id,
        sheetRowNumber: maxRow + 1,
        date: input.date.trim(),
        year: Math.trunc(derivedYear),
        type: input.type,
        category: input.category,
        label,
        amountEur: roundCurrencyEur(input.amountEur),
        notes: input.notes?.trim() ? input.notes.trim() : undefined,
        updatedAt: new Date().toISOString(),
      };

      dataset.accountingEntries.push(created);
      return created;
    });
  }

  public async updateAccountingEntry(
    id: string,
    input: UpdateAccountingEntryInput,
    meta?: MutationMeta,
  ): Promise<AccountingEntry> {
    return this.executeMutation('accounting.update', meta, (_actor, dataset) => {
      const idx = dataset.accountingEntries.findIndex((e) => e.id === id);
      if (idx === -1) {
        throw new RepositoryError(
          'NOT_FOUND',
          `Écriture comptable "${id}" introuvable.`,
        );
      }
      const existing = dataset.accountingEntries[idx]!;

      const nextDate = input.date !== undefined ? input.date.trim() : existing.date;
      const nextYear =
        input.year !== undefined
          ? input.year
          : input.date !== undefined
            ? extractIsoCalendarYear(nextDate)
            : existing.year;
      if (nextYear === null || !Number.isFinite(nextYear)) {
        throw new RepositoryError('VALIDATION_ERROR', 'Date comptable invalide.');
      }

      const nextType = input.type ?? existing.type;
      const nextCategory = input.category ?? existing.category;
      if (
        !isAccountingEntryType(nextType) ||
        !isAccountingCategory(nextCategory) ||
        !isCategoryValidForType(nextType, nextCategory)
      ) {
        throw new RepositoryError(
          'VALIDATION_ERROR',
          'Catégorie comptable incompatible avec le type sélectionné.',
        );
      }

      const nextLabel =
        input.label !== undefined ? input.label.trim() : existing.label;
      if (!nextLabel) {
        throw new RepositoryError(
          'VALIDATION_ERROR',
          "Le libellé de l'écriture est obligatoire.",
        );
      }

      const nextAmount =
        input.amountEur !== undefined ? input.amountEur : existing.amountEur;
      if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
        throw new RepositoryError(
          'VALIDATION_ERROR',
          'Le montant comptable doit être strictement positif.',
        );
      }

      const updated: AccountingEntry = {
        ...existing,
        date: nextDate,
        year: Math.trunc(nextYear),
        type: nextType,
        category: nextCategory,
        label: nextLabel,
        amountEur: roundCurrencyEur(nextAmount),
        notes:
          input.notes !== undefined
            ? input.notes.trim() || undefined
            : existing.notes,
        updatedAt: new Date().toISOString(),
      };

      dataset.accountingEntries[idx] = updated;
      return updated;
    });
  }

  public async deleteAccountingEntry(
    id: string,
    meta?: MutationMeta,
  ): Promise<{ deletedId: string }> {
    return this.executeMutation('accounting.delete', meta, (_actor, dataset) => {
      const idx = dataset.accountingEntries.findIndex((e) => e.id === id);
      if (idx === -1) {
        throw new RepositoryError(
          'NOT_FOUND',
          `Écriture comptable "${id}" introuvable.`,
        );
      }
      dataset.accountingEntries.splice(idx, 1);
      return { deletedId: id };
    });
  }

  // ==========================================================================
  // 18–19: Auth & Admin
  // ==========================================================================

  public async verifySession(
    idToken: string,
    meta?: MutationMeta,
  ): Promise<UserSession> {
    await waitWithSignal(this.simulation.latencyMs, meta?.signal);
    if (this.isOffline()) {
      throw new RepositoryError(
        'NETWORK_ERROR',
        'Mode hors-ligne : impossible de vérifier la session.',
      );
    }
    const trimmed = idToken.trim();
    if (!trimmed) {
      throw new RepositoryError('UNAUTHENTICATED', 'Jeton Google manquant.');
    }
    if (trimmed.toLowerCase().includes('contributor')) {
      return { ...SEED_MOCK_USERS.contributor, idToken: trimmed };
    }
    const active = this.getActorSession();
    if (active) {
      return { ...active, idToken: trimmed };
    }
    return { ...SEED_MOCK_USERS.manager, idToken: trimmed };
  }

  public async inspectSheetStructure(
    meta?: MutationMeta,
  ): Promise<SheetInspectionReport> {
    return this.executeRead(
      'admin.inspectSheetStructure',
      meta,
      (_actor, dataset) => ({
        spreadsheetId: 'mock-spreadsheet-app-icol',
        spreadsheetName: 'Vente et reservations Miel (Mock)',
        inspectedAt: new Date().toISOString(),
        detectedItemsLayout: 'columns_per_format',
        detectedUnitPriceLayout: 'matrix_by_format',
        activeSheets: ALLOWED_SHEETS.map((sheetName) => {
          const isAlwaysReadOnly = (
            ALWAYS_READ_ONLY_SUMMARY_SHEETS as readonly string[]
          ).includes(sheetName);
          const tabSchema =
            sheetName in DEFAULT_SCHEMA_CONFIG.tabs
              ? DEFAULT_SCHEMA_CONFIG.tabs[
                  sheetName as keyof typeof DEFAULT_SCHEMA_CONFIG.tabs
                ]
              : undefined;
          const headers = tabSchema
            ? tabSchema.fields.map((f) => f.canonicalHeader)
            : ['Récolte', 'Total'];
          const resolvedFieldMap: Record<string, number> = {};
          if (tabSchema) {
            tabSchema.fields.forEach((f, i) => {
              resolvedFieldMap[f.key] = i + 1;
            });
          }
          const rowCount =
            sheetName === 'Ventes Miel'
              ? dataset.orders.length + 1
              : sheetName === 'Gestion recoltes' || sheetName === 'PUan'
                ? dataset.harvests.length + 1
                : sheetName === 'ParArticles'
                  ? dataset.formats.length + 1
                  : sheetName === 'Comptabilité rucher'
                    ? dataset.accountingEntries.length + 1
                    : 4;

          return {
            sheetName,
            exists: true,
            rowCount,
            headers,
            resolvedFieldMap,
            missingRequiredFields: [],
            formulaColumns:
              sheetName === 'Ventes Miel' ? ['Poids (Kg)', 'Prix'] : [],
            arrayFormulaColumns: [],
            isFormulaDrivenSummary: isAlwaysReadOnly,
          };
        }),
        forbiddenSheetsPresent: [...FORBIDDEN_SHEETS],
        unlistedSheetsPresent: [],
        warnings: [],
      }),
    );
  }
}
