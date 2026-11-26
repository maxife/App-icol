import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getLocalTodayIsoDate,
  isOrderStatus,
  isPaymentStatus,
  isTransferStatus,
  type OrderStatus,
  type PaymentStatus,
  type SaleOrder,
  type TransferStatus,
} from '@app-icol/shared';

export const SALE_DRAFT_STORAGE_PREFIX = 'app-icol:draft:';

export type SaleDraftMode = 'create' | 'edit';

export interface SaleFormDraft {
  version: 1;
  mode: SaleDraftMode;
  orderId?: string;
  baseOrderUpdatedAt?: string;
  date: string;
  customerName: string;
  phone: string;
  contextOrRelay: string;
  harvestLabel: string;
  quantities: Record<string, number>;
  isManualPriceEnabled: boolean;
  manualPriceRaw: string;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  collectedByThirdParty: boolean;
  collectorName: string;
  transferStatus: TransferStatus;
  notes: string;
  hasExplicitUserChanges: boolean;
  clientRequestId: string;
  deleteClientRequestId: string;
  savedAt: string;
}

export interface UseSaleDraftPersistenceOptions {
  mode: SaleDraftMode;
  orderId?: string;
  existingOrder?: SaleOrder | null;
  resolvedDefaultHarvestLabel: string;
  explicitRouteHarvestLabel?: string;
  storage?: Storage;
}

export interface UseSaleDraftPersistenceResult {
  storageKey: string;
  draft: SaleFormDraft;
  wasRestoredFromStorage: boolean;
  isHydratedForEdit: boolean;
  updateDraft: (
    updater:
      | Partial<SaleFormDraft>
      | ((prev: SaleFormDraft) => SaleFormDraft),
    options?: { markExplicitChange?: boolean },
  ) => void;
  clearDraft: () => void;
}

export function generateClientRequestId(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildSaleDraftStorageKey(
  mode: SaleDraftMode,
  orderId?: string,
): string {
  if (mode === 'edit') {
    const cleanId = (orderId ?? '').trim() || 'unknown';
    return `${SALE_DRAFT_STORAGE_PREFIX}edit:${cleanId}`;
  }
  return `${SALE_DRAFT_STORAGE_PREFIX}create`;
}

export function formatOverrideAmountForInput(amountEur: number): string {
  const rounded = Math.round((amountEur + Number.EPSILON) * 100) / 100;
  if (Number.isInteger(rounded)) {
    return String(rounded);
  }
  return rounded.toFixed(2).replace('.', ',');
}

export function createInitialCreateDraft(
  defaultHarvestLabel: string,
  now: Date = new Date(),
): SaleFormDraft {
  return {
    version: 1,
    mode: 'create',
    date: getLocalTodayIsoDate(now),
    customerName: '',
    phone: '',
    contextOrRelay: '',
    harvestLabel: defaultHarvestLabel,
    quantities: {},
    isManualPriceEnabled: false,
    manualPriceRaw: '',
    orderStatus: 'Réservé',
    paymentStatus: 'Non-payé',
    collectedByThirdParty: false,
    collectorName: '',
    transferStatus: 'Non concerné',
    notes: '',
    hasExplicitUserChanges: false,
    clientRequestId: generateClientRequestId(),
    deleteClientRequestId: generateClientRequestId(),
    savedAt: now.toISOString(),
  };
}

export function createDraftFromSaleOrder(
  order: SaleOrder,
  now: Date = new Date(),
): SaleFormDraft {
  const quantities: Record<string, number> = {};
  for (const item of order.items) {
    if (Number.isInteger(item.quantity) && item.quantity > 0) {
      quantities[item.formatCode] =
        (quantities[item.formatCode] ?? 0) + item.quantity;
    }
  }

  const hasManualOverride =
    typeof order.manualAmountOverrideEur === 'number' &&
    Number.isFinite(order.manualAmountOverrideEur) &&
    order.manualAmountOverrideEur >= 0;

  return {
    version: 1,
    mode: 'edit',
    orderId: order.id,
    baseOrderUpdatedAt: order.updatedAt,
    date: order.date,
    customerName: order.customerName,
    phone: order.phone,
    contextOrRelay: order.contextOrRelay,
    harvestLabel: order.harvestLabel,
    quantities,
    isManualPriceEnabled: hasManualOverride,
    manualPriceRaw: hasManualOverride
      ? formatOverrideAmountForInput(order.manualAmountOverrideEur!)
      : '',
    orderStatus: order.orderStatus,
    paymentStatus: order.paymentStatus,
    collectedByThirdParty: order.collectedByThirdParty,
    collectorName: order.collectorName,
    transferStatus: order.transferStatus,
    notes: order.notes ?? '',
    hasExplicitUserChanges: false,
    clientRequestId: generateClientRequestId(),
    deleteClientRequestId: generateClientRequestId(),
    savedAt: now.toISOString(),
  };
}

export function isCreateDraftMeaningful(draft: SaleFormDraft): boolean {
  if (draft.customerName.trim().length > 0) return true;
  if (draft.phone.trim().length > 0) return true;
  if (draft.contextOrRelay.trim().length > 0) return true;
  if (draft.notes.trim().length > 0) return true;
  if (draft.isManualPriceEnabled || draft.manualPriceRaw.trim().length > 0) {
    return true;
  }
  if (
    Object.values(draft.quantities).some(
      (qty) => typeof qty === 'number' && Number.isFinite(qty) && qty > 0,
    )
  ) {
    return true;
  }
  if (draft.hasExplicitUserChanges) {
    return true;
  }
  return false;
}

function sanitizeStoredQuantities(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const clean: Record<string, number> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (
      typeof val === 'number' &&
      Number.isInteger(val) &&
      val >= 0 &&
      val <= 9999
    ) {
      if (val > 0) {
        clean[key] = val;
      }
    }
  }
  return clean;
}

export function readStoredSaleDraft(
  storageKey: string,
  expectedMode: SaleDraftMode,
  expectedOrderId?: string,
  storage?: Storage,
): SaleFormDraft | null {
  const targetStorage =
    storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
  if (!targetStorage) return null;

  try {
    const raw = targetStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SaleFormDraft>;
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) {
      return null;
    }
    if (parsed.mode !== expectedMode) {
      return null;
    }
    if (expectedMode === 'edit' && parsed.orderId !== expectedOrderId) {
      return null;
    }

    const date =
      typeof parsed.date === 'string' && parsed.date.trim()
        ? parsed.date.trim()
        : getLocalTodayIsoDate();
    const orderStatus: OrderStatus = isOrderStatus(parsed.orderStatus)
      ? parsed.orderStatus
      : 'Réservé';
    const paymentStatus: PaymentStatus = isPaymentStatus(parsed.paymentStatus)
      ? parsed.paymentStatus
      : 'Non-payé';
    const transferStatus: TransferStatus = isTransferStatus(parsed.transferStatus)
      ? parsed.transferStatus
      : 'Non concerné';

    const hydrated: SaleFormDraft = {
      version: 1,
      mode: expectedMode,
      ...(expectedOrderId ? { orderId: expectedOrderId } : {}),
      ...(typeof parsed.baseOrderUpdatedAt === 'string'
        ? { baseOrderUpdatedAt: parsed.baseOrderUpdatedAt }
        : {}),
      date,
      customerName:
        typeof parsed.customerName === 'string' ? parsed.customerName : '',
      phone: typeof parsed.phone === 'string' ? parsed.phone : '',
      contextOrRelay:
        typeof parsed.contextOrRelay === 'string' ? parsed.contextOrRelay : '',
      harvestLabel:
        typeof parsed.harvestLabel === 'string' ? parsed.harvestLabel : '',
      quantities: sanitizeStoredQuantities(parsed.quantities),
      isManualPriceEnabled: Boolean(parsed.isManualPriceEnabled),
      manualPriceRaw:
        typeof parsed.manualPriceRaw === 'string' ? parsed.manualPriceRaw : '',
      orderStatus,
      paymentStatus,
      collectedByThirdParty: Boolean(parsed.collectedByThirdParty),
      collectorName:
        typeof parsed.collectorName === 'string' ? parsed.collectorName : '',
      transferStatus,
      notes: typeof parsed.notes === 'string' ? parsed.notes : '',
      hasExplicitUserChanges: Boolean(parsed.hasExplicitUserChanges),
      clientRequestId:
        typeof parsed.clientRequestId === 'string' &&
        parsed.clientRequestId.trim().length > 0
          ? parsed.clientRequestId.trim()
          : generateClientRequestId(),
      deleteClientRequestId:
        typeof parsed.deleteClientRequestId === 'string' &&
        parsed.deleteClientRequestId.trim().length > 0
          ? parsed.deleteClientRequestId.trim()
          : generateClientRequestId(),
      savedAt:
        typeof parsed.savedAt === 'string'
          ? parsed.savedAt
          : new Date().toISOString(),
    };

    if (expectedMode === 'create' && !isCreateDraftMeaningful(hydrated)) {
      return null;
    }

    return hydrated;
  } catch {
    return null;
  }
}

export function useSaleDraftPersistence({
  mode,
  orderId,
  existingOrder,
  resolvedDefaultHarvestLabel,
  explicitRouteHarvestLabel,
  storage,
}: UseSaleDraftPersistenceOptions): UseSaleDraftPersistenceResult {
  const storageKey = useMemo(
    () => buildSaleDraftStorageKey(mode, orderId),
    [mode, orderId],
  );

  const targetStorage =
    storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);

  const skipPersistenceRef = useRef(false);
  const editedInCurrentMountRef = useRef(false);

  const initialBundle = useMemo(() => {
    const stored = readStoredSaleDraft(storageKey, mode, orderId, targetStorage);
    if (stored) {
      if (
        mode === 'edit' &&
        existingOrder &&
        stored.baseOrderUpdatedAt &&
        stored.baseOrderUpdatedAt !== existingOrder.updatedAt
      ) {
        try {
          targetStorage?.removeItem(storageKey);
        } catch {
          // Ignore storage errors
        }
        return {
          draft: createDraftFromSaleOrder(existingOrder),
          restored: false,
          hydratedEdit: true,
        };
      }

      // If navigating to #/sale/new?harvest=... with an empty-content draft, honor the explicit route harvest
      if (
        mode === 'create' &&
        explicitRouteHarvestLabel &&
        stored.customerName.trim() === '' &&
        Object.values(stored.quantities).every((q) => q === 0)
      ) {
        return {
          draft: {
            ...stored,
            harvestLabel: resolvedDefaultHarvestLabel || stored.harvestLabel,
          },
          restored: true,
          hydratedEdit: false,
        };
      }

      return {
        draft: stored,
        restored: true,
        hydratedEdit: mode === 'edit',
      };
    }

    if (mode === 'edit' && existingOrder) {
      return {
        draft: createDraftFromSaleOrder(existingOrder),
        restored: false,
        hydratedEdit: true,
      };
    }

    return {
      draft: {
        ...createInitialCreateDraft(resolvedDefaultHarvestLabel),
        mode,
        ...(orderId ? { orderId } : {}),
      },
      restored: false,
      hydratedEdit: false,
    };
    // Intentionally evaluated once per storageKey mount lifecycle; dynamic hydration handled in effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const [draft, setDraft] = useState<SaleFormDraft>(initialBundle.draft);
  const [wasRestoredFromStorage, setWasRestoredFromStorage] = useState<boolean>(
    initialBundle.restored,
  );
  const [isHydratedForEdit, setIsHydratedForEdit] = useState<boolean>(
    initialBundle.hydratedEdit,
  );

  // Sync if storageKey changes while component remains mounted
  const prevStorageKeyRef = useRef(storageKey);
  useEffect(() => {
    if (prevStorageKeyRef.current === storageKey) return;
    prevStorageKeyRef.current = storageKey;
    skipPersistenceRef.current = false;
    editedInCurrentMountRef.current = false;
    setDraft(initialBundle.draft);
    setWasRestoredFromStorage(initialBundle.restored);
    setIsHydratedForEdit(initialBundle.hydratedEdit);
  }, [storageKey, initialBundle]);

  // Hydrate default harvest in create mode once dataset harvests finish loading
  useEffect(() => {
    if (mode !== 'create') return;
    if (!resolvedDefaultHarvestLabel) return;

    setDraft((prev) => {
      if (!prev.harvestLabel.trim()) {
        return { ...prev, harvestLabel: resolvedDefaultHarvestLabel };
      }
      if (
        !wasRestoredFromStorage &&
        !prev.hasExplicitUserChanges &&
        prev.harvestLabel !== resolvedDefaultHarvestLabel
      ) {
        return { ...prev, harvestLabel: resolvedDefaultHarvestLabel };
      }
      return prev;
    });
  }, [mode, resolvedDefaultHarvestLabel, wasRestoredFromStorage]);

  // Hydrate edit mode once existingOrder finishes loading (or discard stale draft if order updated externally)
  useEffect(() => {
    if (mode !== 'edit' || !existingOrder) return;

    if (!isHydratedForEdit) {
      setDraft(createDraftFromSaleOrder(existingOrder));
      setIsHydratedForEdit(true);
      setWasRestoredFromStorage(false);
      return;
    }

    if (
      wasRestoredFromStorage &&
      !editedInCurrentMountRef.current &&
      draft.baseOrderUpdatedAt &&
      draft.baseOrderUpdatedAt !== existingOrder.updatedAt
    ) {
      try {
        targetStorage?.removeItem(storageKey);
      } catch {
        // Ignore storage errors
      }
      setDraft(createDraftFromSaleOrder(existingOrder));
      setWasRestoredFromStorage(false);
    }
  }, [
    mode,
    existingOrder,
    isHydratedForEdit,
    wasRestoredFromStorage,
    draft.baseOrderUpdatedAt,
    storageKey,
    targetStorage,
  ]);

  // Auto-persist to localStorage on draft state updates
  useEffect(() => {
    if (!targetStorage || skipPersistenceRef.current) return;

    try {
      if (mode === 'create') {
        if (isCreateDraftMeaningful(draft)) {
          const payload: SaleFormDraft = {
            ...draft,
            savedAt: new Date().toISOString(),
          };
          targetStorage.setItem(storageKey, JSON.stringify(payload));
        } else {
          targetStorage.removeItem(storageKey);
        }
        return;
      }

      // Edit mode: persist once user has made changes or if restored from storage
      if (draft.hasExplicitUserChanges || wasRestoredFromStorage) {
        const payload: SaleFormDraft = {
          ...draft,
          savedAt: new Date().toISOString(),
        };
        targetStorage.setItem(storageKey, JSON.stringify(payload));
      }
    } catch {
      // Ignore storage quota / private mode errors
    }
  }, [draft, mode, storageKey, targetStorage, wasRestoredFromStorage]);

  // Reset in-memory draft if QA 'app-icol:mock-reset' event fires while mounted
  useEffect(() => {
    const handleMockReset = (): void => {
      skipPersistenceRef.current = false;
      editedInCurrentMountRef.current = false;
      setWasRestoredFromStorage(false);
      if (mode === 'edit' && existingOrder) {
        setDraft(createDraftFromSaleOrder(existingOrder));
        setIsHydratedForEdit(true);
      } else {
        setDraft(createInitialCreateDraft(resolvedDefaultHarvestLabel));
        setIsHydratedForEdit(false);
      }
    };
    window.addEventListener('app-icol:mock-reset', handleMockReset);
    return () => {
      window.removeEventListener('app-icol:mock-reset', handleMockReset);
    };
  }, [mode, existingOrder, resolvedDefaultHarvestLabel]);

  const updateDraft = useCallback(
    (
      updater:
        | Partial<SaleFormDraft>
        | ((prev: SaleFormDraft) => SaleFormDraft),
      options?: { markExplicitChange?: boolean },
    ) => {
      skipPersistenceRef.current = false;
      editedInCurrentMountRef.current = true;
      const shouldMarkExplicit = options?.markExplicitChange ?? true;
      setDraft((prev) => {
        const next =
          typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };
        return {
          ...next,
          hasExplicitUserChanges:
            prev.hasExplicitUserChanges || shouldMarkExplicit,
        };
      });
    },
    [],
  );

  const clearDraft = useCallback(() => {
    skipPersistenceRef.current = true;
    editedInCurrentMountRef.current = false;
    try {
      targetStorage?.removeItem(storageKey);
    } catch {
      // Ignore storage errors
    }
    setWasRestoredFromStorage(false);
    if (mode === 'edit' && existingOrder) {
      setDraft(createDraftFromSaleOrder(existingOrder));
      setIsHydratedForEdit(true);
    } else {
      setDraft(createInitialCreateDraft(resolvedDefaultHarvestLabel));
      setIsHydratedForEdit(false);
    }
  }, [mode, existingOrder, storageKey, targetStorage, resolvedDefaultHarvestLabel]);

  return {
    storageKey,
    draft,
    wasRestoredFromStorage,
    isHydratedForEdit,
    updateDraft,
    clearDraft,
  };
}
