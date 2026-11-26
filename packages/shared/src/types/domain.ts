// ============================================================================
// Closed Referentials (Business Rule #4) + Runtime Readonly Arrays & Guards
// ============================================================================

export const USER_ROLES = ['manager', 'contributor'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}

export const ORDER_STATUSES = ['Réservé', 'Distribué'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value);
}

export const PAYMENT_STATUSES = ['Non-payé', 'Payé', 'Donné'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return typeof value === 'string' && (PAYMENT_STATUSES as readonly string[]).includes(value);
}

export const TRANSFER_STATUSES = ['Non concerné', 'À reverser', 'Reversé'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export function isTransferStatus(value: unknown): value is TransferStatus {
  return typeof value === 'string' && (TRANSFER_STATUSES as readonly string[]).includes(value);
}

export const ACCOUNTING_ENTRY_TYPES = ['Recette', 'Dépense'] as const;
export type AccountingEntryType = (typeof ACCOUNTING_ENTRY_TYPES)[number];

export function isAccountingEntryType(value: unknown): value is AccountingEntryType {
  return (
    typeof value === 'string' &&
    (ACCOUNTING_ENTRY_TYPES as readonly string[]).includes(value)
  );
}

export const REVENUE_ACCOUNTING_CATEGORIES = [
  'Ventes de miel',
  "Ventes d'essaims",
  'Autres recettes',
] as const;

export const EXPENSE_ACCOUNTING_CATEGORIES = [
  'Investissements matériel / reines',
  'Consommables (sirop, sucre, traitements)',
  'Conditionnement (pots, étiquettes)',
  'Charges et cotisations',
] as const;

export const ACCOUNTING_CATEGORIES = [
  ...REVENUE_ACCOUNTING_CATEGORIES,
  ...EXPENSE_ACCOUNTING_CATEGORIES,
] as const;

export type AccountingCategory = (typeof ACCOUNTING_CATEGORIES)[number];

export const ACCOUNTING_CATEGORIES_BY_TYPE: Readonly<
  Record<AccountingEntryType, readonly AccountingCategory[]>
> = {
  Recette: REVENUE_ACCOUNTING_CATEGORIES,
  Dépense: EXPENSE_ACCOUNTING_CATEGORIES,
};

export function isAccountingCategory(value: unknown): value is AccountingCategory {
  return (
    typeof value === 'string' &&
    (ACCOUNTING_CATEGORIES as readonly string[]).includes(value)
  );
}

export function isCategoryValidForType(
  type: AccountingEntryType,
  category: AccountingCategory,
): boolean {
  return ACCOUNTING_CATEGORIES_BY_TYPE[type].includes(category);
}

// ============================================================================
// Core Domain Entities
// ============================================================================

export interface UserSession {
  email: string;
  displayName: string;
  role: UserRole;
  idToken?: string;
}

export interface JarFormat {
  code: string;     // e.g. '1kg', '500g', '250g'
  label: string;    // e.g. 'Pot 1 kg', 'Pot 500 g', 'Pot 250 g'
  weightKg: number; // e.g. 1, 0.5, 0.25 (> 0)
  active: boolean;
}

export interface Harvest {
  id: string;                            // slug key, e.g. 'printemps-2026'
  label: string;                         // normalized label, e.g. 'Printemps 2026'
  year: number;                          // 4-digit vintage year, e.g. 2026
  forecastWeightKg: number;              // >= 0
  realizedWeightKg: number | null;       // null = not yet harvested (uses forecast); 0 = harvested 0 kg
  unitPricesEur: Record<string, number>; // formatCode -> unit price in € (from PUan)
  isDefaultActive: boolean;
}

export interface OrderLineItem {
  formatCode: string;
  quantity: number;     // positive integer on persisted orders
  unitWeightKg: number; // snapshotted format weight at order creation/recalculation
  unitPriceEur: number; // snapshotted PUan unit price at order creation/recalculation
}

export interface SaleOrder {
  id: string;
  sheetRowNumber?: number;
  date: string;                           // ISO YYYY-MM-DD (local calendar date)
  customerName: string;
  phone: string;                          // normalized ('06 12 34 56 78', '+41 ...', or '')
  contextOrRelay: string;                 // delivery location or relay person ('' if none)
  harvestLabel: string;                   // normalized harvest label
  items: OrderLineItem[];
  computedWeightKg: number;               // gram-exact total weight
  computedAmountEur: number;              // cent-exact catalog total
  manualAmountOverrideEur: number | null; // custom total override, or null for auto tariff
  effectiveAmountEur: number;             // 0 when paymentStatus === 'Donné', else manualAmountOverrideEur ?? computedAmountEur
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  collectedByThirdParty: boolean;
  collectorName: string;
  transferStatus: TransferStatus;
  notes?: string;
  updatedAt: string;                      // ISO-8601 timestamp
}

export interface AccountingEntry {
  id: string;
  sheetRowNumber?: number;
  date: string;                  // ISO YYYY-MM-DD
  year: number;                  // fiscal/calendar year (e.g. 2026)
  type: AccountingEntryType;
  category: AccountingCategory;
  label: string;
  amountEur: number;             // > 0, cent-exact
  notes?: string;
  updatedAt?: string;
}

export interface AppDataset {
  formats: JarFormat[];
  harvests: Harvest[];
  orders: SaleOrder[];
  accountingEntries: AccountingEntry[]; // empty [] when loaded by a 'contributor'
  serverTimestamp: string;
  session?: UserSession;
}

// ============================================================================
// Derived Directory, Dashboard, Accounting & Sheet Audit Read Models
// ============================================================================

export interface CustomerDirectoryEntry {
  customerName: string;
  phone: string;
  lastContextOrRelay: string;
  ordersCount: number;
  lastOrderDate: string; // ISO YYYY-MM-DD
}

/** Alias preserving exact compatibility with M1 DataProvider & M3 contacts-ui.ts */
export type CustomerSuggestion = CustomerDirectoryEntry;

export interface JarEquivalentCount {
  formatCode: string;
  label: string;
  weightKg: number;
  availableJarsCount: number; // Math.floor(Math.max(0, availableGrams) / formatGrams)
}

export interface HarvestDashboardMetrics {
  scopeHarvestLabel: string | null;     // null when aggregating "ALL" harvests
  forecastWeightKg: number;
  realizedWeightKg: number | null;      // null when forecast fallback is active
  harvestedOrForecastKg: number;        // reference stock weight (realized ?? forecast)
  usesForecastFallback: boolean;        // true when realizedWeightKg === null (for single or any in ALL)
  committedWeightKg: number;            // Réservé + Distribué (including Payé, Non-payé, Donné)
  availableWeightKg: number;            // signed: harvestedOrForecastKg - committedWeightKg (< 0 if overbooked)
  isOverbooked: boolean;                // availableWeightKg < 0
  stockUsageRatio: number;              // unclamped committed / reference ratio
  gaugePercent: number;                 // clamped [0, 100] visual bar width
  jarEquivalents: JarEquivalentCount[]; // active formats only
  paidAmountEur: number;                // sum of effectiveAmountEur where paymentStatus === 'Payé'
  unpaidAmountEur: number;              // sum of effectiveAmountEur where paymentStatus === 'Non-payé'
  donatedOrdersCount: number;           // count where paymentStatus === 'Donné'
  donatedJarsCount: number;             // total jars where paymentStatus === 'Donné'
  donatedWeightKg: number;              // total kg where paymentStatus === 'Donné'
  pendingTransferOrdersCount: number;   // count where paymentStatus === 'Payé' && transferStatus === 'À reverser'
  pendingTransferAmountEur: number;     // € sum where paymentStatus === 'Payé' && transferStatus === 'À reverser'
  totalOrdersCount: number;
  pendingDeliveryOrdersCount: number;   // count where orderStatus === 'Réservé'
  distributedOrdersCount: number;       // count where orderStatus === 'Distribué'
}

export interface CategoryBreakdownItem {
  category: AccountingCategory;
  type: AccountingEntryType;
  amountEur: number;          // manualAmountEur + autoSalesAmountEur
  manualAmountEur: number;    // from Comptabilité rucher entries
  autoSalesAmountEur: number; // > 0 only for 'Ventes de miel' when includePaidOrdersRevenue === true
  entriesCount: number;       // manual entries count (+ paidOrdersCount when auto-sales included on 'Ventes de miel')
  sharePercent: number;       // [0..100] share of totalRevenuesEur (Recette) or totalExpensesEur (Dépense), 1 decimal
}

export interface AnnualAccountingSummary {
  year: number;
  includePaidOrdersRevenue: boolean;
  paidOrdersCount: number;
  paidOrdersHoneyRevenueEur: number;      // sum of Payé orders whose order.date is in `year` (Donné & Non-payé = 0)
  manualHoneyEntriesCount: number;
  manualHoneyRevenueEntriesEur: number;   // manual 'Ventes de miel' rows in Comptabilité rucher for `year`
  hasHoneyDoubleCountWarning: boolean;    // true if includePaidOrdersRevenue && paidOrdersHoneyRevenueEur > 0 && manualHoneyRevenueEntriesEur > 0
  manualOtherRevenuesEur: number;         // manual 'Ventes d'essaims' + 'Autres recettes'
  totalRevenuesEur: number;               // manualRevenues + (includePaidOrdersRevenue ? paidOrdersHoneyRevenueEur : 0)
  totalExpensesEur: number;               // sum of Dépense entries in `year`
  netBalanceEur: number;                  // totalRevenuesEur - totalExpensesEur
  categoryBreakdown: CategoryBreakdownItem[]; // all 7 closed categories in canonical order
}

export type SalesItemsLayout = 'columns_per_format' | 'row_per_item';
export type UnitPriceTabLayout = 'matrix_by_format' | 'row_per_format';

export interface SheetTabInspection {
  sheetName: string;
  exists: boolean;
  rowCount: number;
  headers: string[];
  resolvedFieldMap: Record<string, number>; // fieldKey -> 1-based column index
  formulaColumns: string[];                 // Row 2+ R1C1 formula headers
  isFormulaDrivenSummary: boolean;          // QUERY / SUMIFS summary sheet indicator
  missingRequiredFields?: string[];         // Optional for M1 skeleton compatibility (D-01)
  arrayFormulaColumns?: string[];           // Optional for M1 skeleton compatibility (D-01)
}

export interface SheetInspectionReport {
  spreadsheetId: string;
  spreadsheetName?: string;
  inspectedAt: string;
  detectedItemsLayout: SalesItemsLayout;
  detectedUnitPriceLayout?: UnitPriceTabLayout; // Optional for M1 skeleton compatibility (D-01)
  activeSheets: SheetTabInspection[];
  forbiddenSheetsPresent: string[];             // Tab names ONLY — cells NEVER read
  unlistedSheetsPresent?: string[];             // Optional for M1 skeleton compatibility (D-01)
  warnings?: string[];                          // Optional for M1 skeleton compatibility (D-01)
}
