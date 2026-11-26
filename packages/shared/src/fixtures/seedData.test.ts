import { describe, expect, it } from 'vitest';
import {
  computeAnnualAccountingSummary,
  computeHarvestDashboardMetrics,
  extractCustomerDirectory,
  extractRelaySuggestions,
} from '../domain/calculators';
import {
  isAccountingCategory,
  isAccountingEntryType,
  isCategoryValidForType,
  isOrderStatus,
  isPaymentStatus,
  isTransferStatus,
} from '../types/domain';
import {
  SEED_ACCOUNTING_ENTRIES,
  SEED_EXPECTED_KPIS,
  SEED_HARVESTS,
  SEED_JAR_FORMATS,
  SEED_ORDERS,
  createInitialSeedDataset,
  createSeedDataset,
} from './seedData';

describe('seedData deterministic fixtures & KPI verification', () => {
  it('returns deep-cloned independent datasets from createSeedDataset and createInitialSeedDataset', () => {
    expect(createInitialSeedDataset).toBe(createSeedDataset);

    const ds1 = createSeedDataset();
    const ds2 = createSeedDataset();

    ds1.formats[0]!.label = 'Mutated';
    ds1.harvests[0]!.unitPricesEur['1kg'] = 999;
    ds1.orders[0]!.customerName = 'Mutated';
    ds1.orders[0]!.items[0]!.quantity = 999;
    ds1.accountingEntries[0]!.amountEur = 9999;

    expect(ds2.formats[0]!.label).toBe('Pot 1 kg');
    expect(ds2.harvests[0]!.unitPricesEur['1kg']).toBe(15);
    expect(ds2.orders[0]!.customerName).toBe('Élodie Bénard');
    expect(ds2.orders[0]!.items[0]!.quantity).toBe(2);
    expect(ds2.accountingEntries[0]!.amountEur).toBe(340);
    expect(SEED_ORDERS[0]!.items[0]!.quantity).toBe(2);
  });

  it('matches every pre-computed dashboard KPI in SEED_EXPECTED_KPIS across all 3 harvests and ALL', () => {
    const scopes = ['Printemps 2025', 'Été 2025', 'Printemps 2026', 'ALL'] as const;

    for (const scope of scopes) {
      const expected = SEED_EXPECTED_KPIS.dashboard[scope];
      const actual = computeHarvestDashboardMetrics(
        scope,
        SEED_ORDERS,
        SEED_HARVESTS,
        SEED_JAR_FORMATS,
      );

      expect(actual.totalOrdersCount).toBe(expected.totalOrdersCount);
      expect(actual.harvestedOrForecastKg).toBe(expected.harvestedOrForecastKg);
      expect(actual.usesForecastFallback).toBe(expected.usesForecastFallback);
      expect(actual.committedWeightKg).toBe(expected.committedWeightKg);
      expect(actual.availableWeightKg).toBe(expected.availableWeightKg);
      expect(actual.paidAmountEur).toBe(expected.paidAmountEur);
      expect(actual.unpaidAmountEur).toBe(expected.unpaidAmountEur);
      expect(actual.donatedOrdersCount).toBe(expected.donatedOrdersCount);
      expect(actual.donatedJarsCount).toBe(expected.donatedJarsCount);
      expect(actual.donatedWeightKg).toBe(expected.donatedWeightKg);
      expect(actual.pendingTransferOrdersCount).toBe(expected.pendingTransferOrdersCount);
      expect(actual.pendingTransferAmountEur).toBe(expected.pendingTransferAmountEur);
      expect(actual.pendingDeliveryOrdersCount).toBe(expected.pendingDeliveryOrdersCount);

      const jarMap = Object.fromEntries(
        actual.jarEquivalents.map((j) => [j.formatCode, j.availableJarsCount]),
      );
      expect(jarMap).toEqual(expected.jarEquivalents);
    }
  });

  it('matches every pre-computed annual accounting KPI for 2025 and 2026 with and without sales toggle', () => {
    for (const year of [2025, 2026] as const) {
      const withSales = computeAnnualAccountingSummary(
        year,
        SEED_ACCOUNTING_ENTRIES,
        SEED_ORDERS,
        { includePaidOrdersRevenue: true },
      );
      expect(withSales.paidOrdersHoneyRevenueEur).toBe(
        SEED_EXPECTED_KPIS.accounting[year].withSales.paidOrdersHoneyRevenueEur,
      );
      expect(withSales.manualHoneyRevenueEntriesEur).toBe(
        SEED_EXPECTED_KPIS.accounting[year].withSales.manualHoneyRevenueEntriesEur,
      );
      expect(withSales.hasHoneyDoubleCountWarning).toBe(
        SEED_EXPECTED_KPIS.accounting[year].withSales.hasHoneyDoubleCountWarning,
      );
      expect(withSales.totalRevenuesEur).toBe(
        SEED_EXPECTED_KPIS.accounting[year].withSales.totalRevenuesEur,
      );
      expect(withSales.totalExpensesEur).toBe(
        SEED_EXPECTED_KPIS.accounting[year].withSales.totalExpensesEur,
      );
      expect(withSales.netBalanceEur).toBe(
        SEED_EXPECTED_KPIS.accounting[year].withSales.netBalanceEur,
      );

      const withoutSales = computeAnnualAccountingSummary(
        year,
        SEED_ACCOUNTING_ENTRIES,
        SEED_ORDERS,
        { includePaidOrdersRevenue: false },
      );
      expect(withoutSales.hasHoneyDoubleCountWarning).toBe(
        SEED_EXPECTED_KPIS.accounting[year].withoutSales.hasHoneyDoubleCountWarning,
      );
      expect(withoutSales.totalRevenuesEur).toBe(
        SEED_EXPECTED_KPIS.accounting[year].withoutSales.totalRevenuesEur,
      );
      expect(withoutSales.netBalanceEur).toBe(
        SEED_EXPECTED_KPIS.accounting[year].withoutSales.netBalanceEur,
      );
    }
  });

  it('validates customer directory count, relays, and closed referential compliance across all seed rows', () => {
    expect(SEED_ORDERS).toHaveLength(25);
    expect(SEED_ACCOUNTING_ENTRIES).toHaveLength(14);
    expect(extractCustomerDirectory(SEED_ORDERS)).toHaveLength(
      SEED_EXPECTED_KPIS.customerDirectoryCount,
    );
    expect(extractRelaySuggestions(SEED_ORDERS)).toEqual([...SEED_EXPECTED_KPIS.relays]);

    for (const order of SEED_ORDERS) {
      expect(isOrderStatus(order.orderStatus)).toBe(true);
      expect(isPaymentStatus(order.paymentStatus)).toBe(true);
      expect(isTransferStatus(order.transferStatus)).toBe(true);
      if (order.paymentStatus === 'Donné') {
        expect(order.effectiveAmountEur).toBe(0);
      }
    }

    for (const entry of SEED_ACCOUNTING_ENTRIES) {
      expect(isAccountingEntryType(entry.type)).toBe(true);
      expect(isAccountingCategory(entry.category)).toBe(true);
      expect(isCategoryValidForType(entry.type, entry.category)).toBe(true);
    }
  });
});
