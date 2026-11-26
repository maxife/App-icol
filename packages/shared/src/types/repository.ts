import type {
  AccountingCategory,
  AccountingEntry,
  AccountingEntryType,
  AppDataset,
  Harvest,
  JarFormat,
  OrderStatus,
  PaymentStatus,
  SaleOrder,
  SheetInspectionReport,
  TransferStatus,
  UserSession,
} from './domain';

/**
 * Runtime-neutral AbortSignal contract so @app-icol/shared remains free of
 * DOM or @types/node globals while remaining 100% assignable from AbortSignal.
 */
export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(
    type: 'abort',
    listener: () => void,
    options?: { once?: boolean },
  ): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

export interface MutationMeta {
  /** Stable UUID per user submission attempt for retry deduplication (Rule #5). */
  clientRequestId?: string;
  /** Active caller session (used by MockSheetsRepository for RBAC & contributor transfer auto-fill). */
  actor?: UserSession | null;
  /** Optional AbortSignal for request cancellation/timeout. */
  signal?: AbortSignalLike;
}

/** Alias for read/write repository metadata compatibility. */
export type RequestMeta = MutationMeta;

export interface OrderLineItemInput {
  formatCode: string;
  quantity: number;
  /**
   * Optional historical snapshots preserved when editing an existing SaleOrder
   * so later PUan / ParArticles changes do not retroactively alter past invoices (EC-20).
   */
  unitWeightKg?: number;
  unitPriceEur?: number;
}

export interface CreateSaleOrderInput {
  date: string; // YYYY-MM-DD
  customerName: string;
  phone: string;
  contextOrRelay: string;
  harvestLabel: string;
  items: OrderLineItemInput[];
  manualAmountOverrideEur?: number | null;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  collectedByThirdParty: boolean;
  collectorName?: string;
  transferStatus?: TransferStatus;
  notes?: string;
}

export type UpdateSaleOrderInput = CreateSaleOrderInput;

export interface OrderStatusPatch {
  orderStatus?: OrderStatus;
  paymentStatus?: PaymentStatus;
  collectedByThirdParty?: boolean;
  collectorName?: string;
  transferStatus?: TransferStatus;
}

export interface CreateHarvestInput {
  label: string; // normalized via normalizeHarvestLabel()
  year: number;
  forecastWeightKg: number;
  realizedWeightKg: number | null;
  unitPricesEur: Record<string, number>;
  isDefaultActive: boolean;
}

export interface UpdateHarvestInput {
  label?: string;
  year?: number;
  forecastWeightKg?: number;
  realizedWeightKg?: number | null;
  unitPricesEur?: Record<string, number>;
  isDefaultActive?: boolean;
}

export interface UpsertJarFormatInput {
  code: string;
  label: string;
  weightKg: number;
  active: boolean;
}

export interface CreateAccountingEntryInput {
  date: string; // YYYY-MM-DD
  year?: number; // derived from date if omitted
  type: AccountingEntryType;
  category: AccountingCategory;
  label: string;
  amountEur: number;
  notes?: string;
}

export type UpdateAccountingEntryInput = Partial<CreateAccountingEntryInput>;

/**
 * Complete 19-method DataRepository contract (PROJECT.md § Interface Contracts §1),
 * implemented identically by MockSheetsRepository and GasApiClient.
 */
export interface DataRepository {
  // 1–6: Reads (manager + contributor; listAccountingEntries is manager-only)
  getDataset(meta?: MutationMeta): Promise<AppDataset>;
  listFormats(meta?: MutationMeta): Promise<JarFormat[]>;
  listHarvests(meta?: MutationMeta): Promise<Harvest[]>;
  listOrders(meta?: MutationMeta): Promise<SaleOrder[]>;
  getOrderById(id: string, meta?: MutationMeta): Promise<SaleOrder | null>;
  listAccountingEntries(year?: number, meta?: MutationMeta): Promise<AccountingEntry[]>;

  // 7–10: Sales / Orders Mutations (manager + contributor, EXCEPT deleteOrder which is manager-only)
  createOrder(input: CreateSaleOrderInput, meta?: MutationMeta): Promise<SaleOrder>;
  updateOrder(id: string, input: UpdateSaleOrderInput, meta?: MutationMeta): Promise<SaleOrder>;
  patchOrderStatuses(id: string, patch: OrderStatusPatch, meta?: MutationMeta): Promise<SaleOrder>;
  deleteOrder(id: string, meta?: MutationMeta): Promise<{ deletedId: string }>;

  // 11–14: Harvests & Formats Mutations (manager-only)
  createHarvest(input: CreateHarvestInput, meta?: MutationMeta): Promise<Harvest>;
  updateHarvest(id: string, input: UpdateHarvestInput, meta?: MutationMeta): Promise<Harvest>;
  setDefaultActiveHarvest(id: string, meta?: MutationMeta): Promise<Harvest[]>;
  upsertJarFormat(input: UpsertJarFormatInput, meta?: MutationMeta): Promise<JarFormat>;

  // 15–17: Accounting Mutations (manager-only)
  createAccountingEntry(input: CreateAccountingEntryInput, meta?: MutationMeta): Promise<AccountingEntry>;
  updateAccountingEntry(id: string, input: UpdateAccountingEntryInput, meta?: MutationMeta): Promise<AccountingEntry>;
  deleteAccountingEntry(id: string, meta?: MutationMeta): Promise<{ deletedId: string }>;

  // 18–19: Auth & Admin (inspectSheetStructure is manager-only)
  verifySession(idToken: string, meta?: MutationMeta): Promise<UserSession>;
  inspectSheetStructure(meta?: MutationMeta): Promise<SheetInspectionReport>;
}
