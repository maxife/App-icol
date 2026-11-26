import { RepositoryError } from '../types/api';
import {
  ACCOUNTING_CATEGORIES,
  ACCOUNTING_CATEGORIES_BY_TYPE,
  type AccountingCategory,
  type AccountingEntry,
  type AccountingEntryType,
  type AnnualAccountingSummary,
  type CategoryBreakdownItem,
  type CustomerDirectoryEntry,
  type Harvest,
  type HarvestDashboardMetrics,
  type JarEquivalentCount,
  type JarFormat,
  type OrderLineItem,
  type PaymentStatus,
  type SaleOrder,
  type TransferStatus,
  type UserSession,
} from '../types/domain';
import type { OrderLineItemInput } from '../types/repository';
import {
  fromCents,
  fromGrams,
  normalizeHarvestLabel,
  normalizePhoneNumber,
  normalizeSearchText,
  roundCurrencyEur,
  roundWeightKg,
  toCents,
  toGrams,
  toPhoneSearchDigits,
} from './normalizers';

export interface ComputedOrderTotals {
  items: OrderLineItem[];
  totalJarsCount: number;
  computedWeightKg: number;
  computedAmountEur: number;
  manualAmountOverrideEur: number | null;
  effectiveAmountEur: number;
}

export function computeOrderTotals(
  items: readonly OrderLineItemInput[],
  harvest: Pick<Harvest, 'unitPricesEur'> | null | undefined,
  formats: readonly JarFormat[],
  paymentStatus: PaymentStatus,
  manualOverrideEur: number | null | undefined = null,
): ComputedOrderTotals {
  if (
    manualOverrideEur !== null &&
    manualOverrideEur !== undefined &&
    (!Number.isFinite(manualOverrideEur) || manualOverrideEur < 0)
  ) {
    throw new RepositoryError(
      'VALIDATION_ERROR',
      'Le tarif manuel doit être un montant positif ou nul.',
    );
  }

  const formatMap = new Map<string, JarFormat>(formats.map((f) => [f.code, f]));
  const resolvedItems: OrderLineItem[] = [];
  let totalJarsCount = 0;
  let totalGrams = 0;
  let totalCents = 0;

  for (const rawItem of items) {
    if (
      !Number.isFinite(rawItem.quantity) ||
      rawItem.quantity < 0 ||
      !Number.isInteger(rawItem.quantity)
    ) {
      throw new RepositoryError(
        'VALIDATION_ERROR',
        `Quantité invalide pour le format ${rawItem.formatCode}.`,
      );
    }
    if (rawItem.quantity === 0) {
      continue;
    }

    const format = formatMap.get(rawItem.formatCode);
    const unitWeightKg =
      typeof rawItem.unitWeightKg === 'number' &&
      Number.isFinite(rawItem.unitWeightKg) &&
      rawItem.unitWeightKg >= 0
        ? roundWeightKg(rawItem.unitWeightKg)
        : roundWeightKg(format?.weightKg ?? 0);

    const catalogPrice = harvest?.unitPricesEur?.[rawItem.formatCode];
    const unitPriceEur =
      typeof rawItem.unitPriceEur === 'number' &&
      Number.isFinite(rawItem.unitPriceEur) &&
      rawItem.unitPriceEur >= 0
        ? roundCurrencyEur(rawItem.unitPriceEur)
        : roundCurrencyEur(
            typeof catalogPrice === 'number' && Number.isFinite(catalogPrice) ? catalogPrice : 0,
          );

    resolvedItems.push({
      formatCode: rawItem.formatCode,
      quantity: rawItem.quantity,
      unitWeightKg,
      unitPriceEur,
    });

    totalJarsCount += rawItem.quantity;
    totalGrams += rawItem.quantity * toGrams(unitWeightKg);
    totalCents += rawItem.quantity * toCents(unitPriceEur);
  }

  const computedWeightKg = fromGrams(totalGrams);
  const computedAmountEur = fromCents(totalCents);
  const normalizedOverride =
    manualOverrideEur !== null && manualOverrideEur !== undefined
      ? roundCurrencyEur(manualOverrideEur)
      : null;

  // Rule #2: 'Donné' strictly forces effectiveAmountEur = 0 € (even with manualAmountOverrideEur)
  const effectiveAmountEur =
    paymentStatus === 'Donné' ? 0 : (normalizedOverride ?? computedAmountEur);

  return {
    items: resolvedItems,
    totalJarsCount,
    computedWeightKg,
    computedAmountEur,
    manualAmountOverrideEur: normalizedOverride,
    effectiveAmountEur,
  };
}

export interface NormalizedOrderTransferState {
  collectedByThirdParty: boolean;
  collectorName: string;
  transferStatus: TransferStatus;
}

export function normalizeOrderTransferState(
  paymentStatus: PaymentStatus,
  collectedByThirdParty: boolean | undefined,
  collectorName: string | undefined,
  transferStatus: TransferStatus | undefined,
  actorSession?: Pick<UserSession, 'role' | 'displayName'> | null,
): NormalizedOrderTransferState {
  // Rule #2 & Rule #4 (EC-04, EC-07): Unpaid or Gifted orders have 0 € collected -> never pending transfer
  if (paymentStatus !== 'Payé') {
    return {
      collectedByThirdParty: false,
      collectorName: '',
      transferStatus: 'Non concerné',
    };
  }

  const trimmedCollector = (collectorName ?? '').trim();
  const isContributorActor = actorSession?.role === 'contributor';

  // Auto-activate for contributor on Payé creation/transition (EC-07, EC-08, D-03),
  // or infer on Sheet hydration when collector/transfer is set.
  const effectiveThirdParty = isContributorActor
    ? true
    : collectedByThirdParty !== undefined
      ? collectedByThirdParty
      : Boolean(trimmedCollector) ||
        transferStatus === 'À reverser' ||
        transferStatus === 'Reversé';

  if (!effectiveThirdParty) {
    return {
      collectedByThirdParty: false,
      collectorName: '',
      transferStatus: 'Non concerné',
    };
  }

  const resolvedCollector =
    trimmedCollector || (actorSession?.displayName?.trim() ?? '');
  const resolvedTransferStatus: TransferStatus =
    transferStatus === 'Reversé' ? 'Reversé' : 'À reverser';

  return {
    collectedByThirdParty: true,
    collectorName: resolvedCollector,
    transferStatus: resolvedTransferStatus,
  };
}

export function computeHarvestDashboardMetrics(
  harvestOrNullForAll: Harvest | 'ALL' | string | null | undefined,
  orders: readonly SaleOrder[],
  allHarvests: readonly Harvest[],
  formats: readonly JarFormat[],
): HarvestDashboardMetrics {
  const isAll =
    harvestOrNullForAll === null ||
    harvestOrNullForAll === undefined ||
    harvestOrNullForAll === '' ||
    harvestOrNullForAll === 'ALL';

  let scopedHarvests: readonly Harvest[];
  let scopeHarvestLabel: string | null;
  let scopedOrders: readonly SaleOrder[];

  if (isAll) {
    scopedHarvests = allHarvests;
    scopeHarvestLabel = null;
    scopedOrders = orders;
  } else if (typeof harvestOrNullForAll === 'string') {
    const normTarget = normalizeHarvestLabel(harvestOrNullForAll);
    const matched = allHarvests.find(
      (h) => normalizeHarvestLabel(h.label) === normTarget || h.id === harvestOrNullForAll,
    );
    scopeHarvestLabel = matched ? normalizeHarvestLabel(matched.label) : normTarget;
    scopedHarvests = matched ? [matched] : [];
    scopedOrders = orders.filter(
      (o) => normalizeHarvestLabel(o.harvestLabel) === scopeHarvestLabel,
    );
  } else {
    scopeHarvestLabel = normalizeHarvestLabel(harvestOrNullForAll.label);
    scopedHarvests = [harvestOrNullForAll];
    scopedOrders = orders.filter(
      (o) => normalizeHarvestLabel(o.harvestLabel) === scopeHarvestLabel,
    );
  }

  const forecastGrams = scopedHarvests.reduce(
    (sum, h) => sum + toGrams(h.forecastWeightKg),
    0,
  );
  // EC-05: realizedWeightKg === 0 is actual 0 kg (NOT forecast fallback); only null triggers fallback
  const usesForecastFallback = scopedHarvests.some((h) => h.realizedWeightKg === null);
  const realizedWeightKg =
    scopedHarvests.length > 0 && !usesForecastFallback
      ? fromGrams(
          scopedHarvests.reduce((sum, h) => sum + toGrams(h.realizedWeightKg ?? 0), 0),
        )
      : null;

  const refGrams = scopedHarvests.reduce(
    (sum, h) =>
      sum + toGrams(h.realizedWeightKg !== null ? h.realizedWeightKg : h.forecastWeightKg),
    0,
  );

  // Rule #1 & Rule #2: ALL orders (Réservé + Distribué, Payé + Non-payé + Donné) consume stock
  let committedGrams = 0;
  let paidCents = 0;
  let unpaidCents = 0;
  let donatedOrdersCount = 0;
  let donatedJarsCount = 0;
  let donatedGrams = 0;
  let pendingTransferOrdersCount = 0;
  let pendingTransferCents = 0;
  let pendingDeliveryOrdersCount = 0;
  let distributedOrdersCount = 0;

  for (const order of scopedOrders) {
    const orderGrams = toGrams(order.computedWeightKg);
    committedGrams += orderGrams;

    if (order.orderStatus === 'Réservé') {
      pendingDeliveryOrdersCount += 1;
    } else if (order.orderStatus === 'Distribué') {
      distributedOrdersCount += 1;
    }

    if (order.paymentStatus === 'Donné') {
      donatedOrdersCount += 1;
      donatedGrams += orderGrams;
      for (const item of order.items) {
        donatedJarsCount += item.quantity;
      }
    } else if (order.paymentStatus === 'Payé') {
      const effectiveCents = toCents(order.effectiveAmountEur);
      paidCents += effectiveCents;
      if (order.transferStatus === 'À reverser') {
        pendingTransferOrdersCount += 1;
        pendingTransferCents += effectiveCents;
      }
    } else if (order.paymentStatus === 'Non-payé') {
      unpaidCents += toCents(order.effectiveAmountEur);
    }
  }

  const availableGrams = refGrams - committedGrams;
  const stockUsageRatio =
    refGrams > 0 ? committedGrams / refGrams : committedGrams > 0 ? 1 : 0;
  const gaugePercent = Math.min(
    100,
    Math.max(0, Math.round(stockUsageRatio * 1000) / 10),
  );

  const jarEquivalents: JarEquivalentCount[] = formats
    .filter((f) => f.active && toGrams(f.weightKg) > 0)
    .map((f) => {
      const formatGrams = toGrams(f.weightKg);
      return {
        formatCode: f.code,
        label: f.label,
        weightKg: roundWeightKg(f.weightKg),
        availableJarsCount:
          availableGrams <= 0 ? 0 : Math.floor(availableGrams / formatGrams),
      };
    });

  return {
    scopeHarvestLabel,
    forecastWeightKg: fromGrams(forecastGrams),
    realizedWeightKg,
    harvestedOrForecastKg: fromGrams(refGrams),
    usesForecastFallback,
    committedWeightKg: fromGrams(committedGrams),
    availableWeightKg: fromGrams(availableGrams),
    isOverbooked: availableGrams < 0,
    stockUsageRatio,
    gaugePercent,
    jarEquivalents,
    paidAmountEur: fromCents(paidCents),
    unpaidAmountEur: fromCents(unpaidCents),
    donatedOrdersCount,
    donatedJarsCount,
    donatedWeightKg: fromGrams(donatedGrams),
    pendingTransferOrdersCount,
    pendingTransferAmountEur: fromCents(pendingTransferCents),
    totalOrdersCount: scopedOrders.length,
    pendingDeliveryOrdersCount,
    distributedOrdersCount,
  };
}

export function extractIsoCalendarYear(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();
  const isoMatch = /^(\d{4})-\d{2}-\d{2}/.exec(trimmed);
  if (isoMatch) return Number(isoMatch[1]);
  const frMatch = /^\d{2}\/\d{2}\/(\d{4})$/.exec(trimmed);
  if (frMatch) return Number(frMatch[1]);
  return null;
}

export function computeAnnualAccountingSummary(
  year: number,
  entries: readonly AccountingEntry[],
  orders: readonly SaleOrder[],
  options: { includePaidOrdersRevenue: boolean } = { includePaidOrdersRevenue: true },
): AnnualAccountingSummary {
  const { includePaidOrdersRevenue } = options;

  // EC-21: Attribute Payé orders by order.date calendar year; strictly exclude Donné & Non-payé
  let paidOrdersCount = 0;
  let paidOrdersHoneyCents = 0;
  for (const order of orders) {
    if (order.paymentStatus === 'Payé' && extractIsoCalendarYear(order.date) === year) {
      paidOrdersCount += 1;
      paidOrdersHoneyCents += toCents(order.effectiveAmountEur);
    }
  }

  const manualCentsByCategory = new Map<AccountingCategory, number>();
  const manualCountByCategory = new Map<AccountingCategory, number>();
  for (const cat of ACCOUNTING_CATEGORIES) {
    manualCentsByCategory.set(cat, 0);
    manualCountByCategory.set(cat, 0);
  }

  let totalManualRevenuesCents = 0;
  let totalExpensesCents = 0;

  for (const entry of entries) {
    const entryYear = Number.isFinite(entry.year)
      ? entry.year
      : extractIsoCalendarYear(entry.date);
    if (entryYear !== year) continue;

    const cents = toCents(entry.amountEur);
    manualCentsByCategory.set(
      entry.category,
      (manualCentsByCategory.get(entry.category) ?? 0) + cents,
    );
    manualCountByCategory.set(
      entry.category,
      (manualCountByCategory.get(entry.category) ?? 0) + 1,
    );

    if (entry.type === 'Recette') {
      totalManualRevenuesCents += cents;
    } else {
      totalExpensesCents += cents;
    }
  }

  const manualHoneyCents = manualCentsByCategory.get('Ventes de miel') ?? 0;
  const manualHoneyEntriesCount = manualCountByCategory.get('Ventes de miel') ?? 0;
  const autoIncludedCents = includePaidOrdersRevenue ? paidOrdersHoneyCents : 0;
  const totalRevenuesCents = totalManualRevenuesCents + autoIncludedCents;
  const netBalanceCents = totalRevenuesCents - totalExpensesCents;

  const hasHoneyDoubleCountWarning =
    includePaidOrdersRevenue && paidOrdersHoneyCents > 0 && manualHoneyCents > 0;

  const categoryBreakdown: CategoryBreakdownItem[] = ACCOUNTING_CATEGORIES.map(
    (category) => {
      const type: AccountingEntryType = ACCOUNTING_CATEGORIES_BY_TYPE.Recette.includes(
        category,
      )
        ? 'Recette'
        : 'Dépense';
      const manualCents = manualCentsByCategory.get(category) ?? 0;
      const autoCents = category === 'Ventes de miel' ? autoIncludedCents : 0;
      const combinedCents = manualCents + autoCents;
      const manualCount = manualCountByCategory.get(category) ?? 0;
      const entriesCount =
        category === 'Ventes de miel' && includePaidOrdersRevenue
          ? manualCount + paidOrdersCount
          : manualCount;
      const denominatorCents =
        type === 'Recette' ? totalRevenuesCents : totalExpensesCents;
      const sharePercent =
        denominatorCents > 0
          ? Math.round((combinedCents / denominatorCents) * 1000) / 10
          : 0;

      return {
        category,
        type,
        amountEur: fromCents(combinedCents),
        manualAmountEur: fromCents(manualCents),
        autoSalesAmountEur: fromCents(autoCents),
        entriesCount,
        sharePercent,
      };
    },
  );

  return {
    year,
    includePaidOrdersRevenue,
    paidOrdersCount,
    paidOrdersHoneyRevenueEur: fromCents(paidOrdersHoneyCents),
    manualHoneyEntriesCount,
    manualHoneyRevenueEntriesEur: fromCents(manualHoneyCents),
    hasHoneyDoubleCountWarning,
    manualOtherRevenuesEur: fromCents(totalManualRevenuesCents - manualHoneyCents),
    totalRevenuesEur: fromCents(totalRevenuesCents),
    totalExpensesEur: fromCents(totalExpensesCents),
    netBalanceEur: fromCents(netBalanceCents),
    categoryBreakdown,
  };
}

export function extractCustomerDirectory(
  orders: readonly SaleOrder[],
): CustomerDirectoryEntry[] {
  // Sort ascending by (date, updatedAt) so later orders overwrite display name / phone / relay with latest non-empty values
  const sorted = [...orders].sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date);
    return dateCmp !== 0 ? dateCmp : a.updatedAt.localeCompare(b.updatedAt);
  });

  const byKey = new Map<string, CustomerDirectoryEntry>();

  for (const order of sorted) {
    const trimmedName = order.customerName.trim();
    if (!trimmedName) continue;
    const key = normalizeSearchText(trimmedName);
    if (!key) continue;

    const normalizedPhone = normalizePhoneNumber(order.phone);
    const trimmedRelay = order.contextOrRelay.trim();
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, {
        customerName: trimmedName,
        phone: normalizedPhone,
        lastContextOrRelay: trimmedRelay,
        ordersCount: 1,
        lastOrderDate: order.date,
      });
    } else {
      existing.customerName = trimmedName;
      if (normalizedPhone) existing.phone = normalizedPhone;
      if (trimmedRelay) existing.lastContextOrRelay = trimmedRelay;
      existing.ordersCount += 1;
      if (order.date >= existing.lastOrderDate) {
        existing.lastOrderDate = order.date;
      }
    }
  }

  return Array.from(byKey.values()).sort((a, b) => {
    const dateCmp = b.lastOrderDate.localeCompare(a.lastOrderDate);
    return dateCmp !== 0
      ? dateCmp
      : a.customerName.localeCompare(b.customerName, 'fr');
  });
}

/** Alias preserving compatibility with consumers importing extractCustomerSuggestions (D-05). */
export const extractCustomerSuggestions = extractCustomerDirectory;

export function extractRelaySuggestions(orders: readonly SaleOrder[]): string[] {
  const map = new Map<string, { display: string; count: number }>();
  for (const order of orders) {
    const trimmed = order.contextOrRelay.trim();
    if (!trimmed) continue;
    const key = normalizeSearchText(trimmed);
    if (!key) continue;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { display: trimmed, count: 1 });
    } else {
      prev.display = trimmed;
      prev.count += 1;
    }
  }

  return Array.from(map.values())
    .sort((a, b) =>
      b.count !== a.count ? b.count - a.count : a.display.localeCompare(b.display, 'fr'),
    )
    .map((entry) => entry.display);
}

/**
 * Shared search matcher for OrdersPage (M5) & CustomerPicker (M3) supporting
 * accent-insensitive name/relay search AND de-formatted/+33 phone search (EC-10, EC-11).
 */
export function matchesOrderSearch(
  target: Pick<SaleOrder, 'customerName' | 'phone'> & { contextOrRelay?: string },
  rawQuery: string,
): boolean {
  const trimmed = rawQuery.trim();
  if (!trimmed) return true;

  const textQuery = normalizeSearchText(trimmed);
  if (textQuery) {
    if (normalizeSearchText(target.customerName).includes(textQuery)) return true;
    if (target.contextOrRelay && normalizeSearchText(target.contextOrRelay).includes(textQuery)) {
      return true;
    }
  }

  const queryDigits = toPhoneSearchDigits(trimmed);
  // Only match by phone digits if user typed at least one digit (avoids matching empty "" against everything)
  if (queryDigits.length > 0 && /\d/.test(trimmed)) {
    const targetDigits = toPhoneSearchDigits(target.phone);
    if (targetDigits.includes(queryDigits)) return true;
  }

  return false;
}

export * from './normalizers';
