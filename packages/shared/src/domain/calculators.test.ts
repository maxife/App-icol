import { describe, expect, it } from 'vitest';
import { RepositoryError } from '../types/api';
import type { AccountingEntry, Harvest, JarFormat, SaleOrder } from '../types/domain';
import {
  computeAnnualAccountingSummary,
  computeHarvestDashboardMetrics,
  computeOrderTotals,
  extractCustomerDirectory,
  extractCustomerSuggestions,
  extractRelaySuggestions,
  matchesOrderSearch,
  normalizeOrderTransferState,
} from './calculators';

const FORMATS: readonly JarFormat[] = [
  { code: '1kg', label: 'Pot 1 kg', weightKg: 1, active: true },
  { code: '500g', label: 'Pot 500 g', weightKg: 0.5, active: true },
  { code: '250g', label: 'Pot 250 g', weightKg: 0.25, active: true },
];

const HARVEST_2026: Harvest = {
  id: 'printemps-2026',
  label: 'Printemps 2026',
  year: 2026,
  forecastWeightKg: 80,
  realizedWeightKg: null,
  unitPricesEur: { '1kg': 16, '500g': 8.5, '250g': 5 },
  isDefaultActive: true,
};

function makeOrder(partial: Partial<SaleOrder> & Pick<SaleOrder, 'id'>): SaleOrder {
  return {
    id: partial.id,
    date: partial.date ?? '2026-05-10',
    customerName: partial.customerName ?? 'Client Test',
    phone: partial.phone ?? '06 12 34 56 78',
    contextOrRelay: partial.contextOrRelay ?? 'Rucher principal',
    harvestLabel: partial.harvestLabel ?? 'Printemps 2026',
    items: partial.items ?? [
      { formatCode: '1kg', quantity: 2, unitWeightKg: 1, unitPriceEur: 16 },
    ],
    computedWeightKg: partial.computedWeightKg ?? 2,
    computedAmountEur: partial.computedAmountEur ?? 32,
    manualAmountOverrideEur: partial.manualAmountOverrideEur ?? null,
    effectiveAmountEur: partial.effectiveAmountEur ?? 32,
    orderStatus: partial.orderStatus ?? 'Réservé',
    paymentStatus: partial.paymentStatus ?? 'Non-payé',
    collectedByThirdParty: partial.collectedByThirdParty ?? false,
    collectorName: partial.collectorName ?? '',
    transferStatus: partial.transferStatus ?? 'Non concerné',
    updatedAt: partial.updatedAt ?? '2026-05-10T10:00:00.000Z',
  };
}

describe('calculators (Rules #1, #2, #4 & EC-01..EC-21)', () => {
  it('Rule #1 (EC-01, EC-02): Réservé consumes stock immediately and transitioning to Distribué never double-deducts', () => {
    const reservedOrder = makeOrder({
      id: 'o-1',
      orderStatus: 'Réservé',
      paymentStatus: 'Non-payé',
      computedWeightKg: 2,
      effectiveAmountEur: 32,
    });

    const before = computeHarvestDashboardMetrics(HARVEST_2026, [], [HARVEST_2026], FORMATS);
    const afterReserved = computeHarvestDashboardMetrics(
      HARVEST_2026,
      [reservedOrder],
      [HARVEST_2026],
      FORMATS,
    );

    expect(afterReserved.committedWeightKg - before.committedWeightKg).toBe(2);
    expect(afterReserved.availableWeightKg - before.availableWeightKg).toBe(-2);
    expect(afterReserved.pendingDeliveryOrdersCount).toBe(1);
    expect(afterReserved.unpaidAmountEur).toBe(32);
    expect(afterReserved.paidAmountEur).toBe(0);

    const distributedOrder: SaleOrder = { ...reservedOrder, orderStatus: 'Distribué' };
    const afterDistributed = computeHarvestDashboardMetrics(
      HARVEST_2026,
      [distributedOrder],
      [HARVEST_2026],
      FORMATS,
    );

    expect(afterDistributed.committedWeightKg).toBe(afterReserved.committedWeightKg);
    expect(afterDistributed.availableWeightKg).toBe(afterReserved.availableWeightKg);
    expect(afterDistributed.pendingDeliveryOrdersCount).toBe(0);
    expect(afterDistributed.distributedOrdersCount).toBe(1);
  });

  it('Rule #2 (EC-03, EC-04, S2-EC-09): Donné consumes stock, forces 0 € effective amount even with override, and never enters paid/unpaid CA', () => {
    const totals = computeOrderTotals(
      [{ formatCode: '500g', quantity: 2 }],
      HARVEST_2026,
      FORMATS,
      'Donné',
      20,
    );
    expect(totals.computedWeightKg).toBe(1);
    expect(totals.computedAmountEur).toBe(17);
    expect(totals.manualAmountOverrideEur).toBe(20);
    expect(totals.effectiveAmountEur).toBe(0);

    // Even if a legacy Sheet row has non-zero effectiveAmountEur on a Donné order, dashboard excludes it from CA
    const legacyDonatedOrder = makeOrder({
      id: 'o-don',
      orderStatus: 'Distribué',
      paymentStatus: 'Donné',
      items: [{ formatCode: '500g', quantity: 2, unitWeightKg: 0.5, unitPriceEur: 8.5 }],
      computedWeightKg: 1,
      computedAmountEur: 17,
      effectiveAmountEur: 15,
    });

    const metrics = computeHarvestDashboardMetrics(
      HARVEST_2026,
      [legacyDonatedOrder],
      [HARVEST_2026],
      FORMATS,
    );
    expect(metrics.committedWeightKg).toBe(1);
    expect(metrics.paidAmountEur).toBe(0);
    expect(metrics.unpaidAmountEur).toBe(0);
    expect(metrics.donatedOrdersCount).toBe(1);
    expect(metrics.donatedJarsCount).toBe(2);
    expect(metrics.donatedWeightKg).toBe(1);
  });

  it('EC-05 & EC-06 (S2-EC-10): distinguishes null vs 0 realized weight, handles overbooking, and computes float-safe jar equivalents', () => {
    const zeroHarvest: Harvest = {
      ...HARVEST_2026,
      id: 'zero-2026',
      label: 'Zéro 2026',
      forecastWeightKg: 50,
      realizedWeightKg: 0,
    };
    const zeroMetrics = computeHarvestDashboardMetrics(
      zeroHarvest,
      [],
      [zeroHarvest],
      FORMATS,
    );
    expect(zeroMetrics.usesForecastFallback).toBe(false);
    expect(zeroMetrics.harvestedOrForecastKg).toBe(0);

    const overbookedHarvest: Harvest = {
      ...HARVEST_2026,
      realizedWeightKg: 50,
    };
    const overOrder = makeOrder({
      id: 'o-over',
      computedWeightKg: 53.5,
    });
    const overMetrics = computeHarvestDashboardMetrics(
      overbookedHarvest,
      [overOrder],
      [overbookedHarvest],
      FORMATS,
    );
    expect(overMetrics.availableWeightKg).toBe(-3.5);
    expect(overMetrics.isOverbooked).toBe(true);
    expect(overMetrics.gaugePercent).toBe(100);
    expect(overMetrics.jarEquivalents.every((j) => j.availableJarsCount === 0)).toBe(true);

    // Float-safe 0.3 kg / 0.1 kg === 3 jars
    const smallHarvest: Harvest = { ...HARVEST_2026, realizedWeightKg: 0.3 };
    const tenthFormat: JarFormat[] = [
      { code: '100g', label: 'Pot 100 g', weightKg: 0.1, active: true },
    ];
    const smallMetrics = computeHarvestDashboardMetrics(
      smallHarvest,
      [],
      [smallHarvest],
      tenthFormat,
    );
    expect(smallMetrics.jarEquivalents[0]?.availableJarsCount).toBe(3);
  });

  it('Rule #4 & D-03 (EC-07, EC-08): normalizes co-seller transfer state across statuses and contributor transitions', () => {
    const contributor = { role: 'contributor' as const, displayName: 'Marie Laurent' };

    expect(
      normalizeOrderTransferState('Non-payé', true, 'Marie Laurent', 'À reverser', contributor),
    ).toEqual({
      collectedByThirdParty: false,
      collectorName: '',
      transferStatus: 'Non concerné',
    });

    expect(
      normalizeOrderTransferState('Donné', true, 'Marie Laurent', 'À reverser', contributor),
    ).toEqual({
      collectedByThirdParty: false,
      collectorName: '',
      transferStatus: 'Non concerné',
    });

    expect(
      normalizeOrderTransferState('Payé', false, '', 'Non concerné', contributor),
    ).toEqual({
      collectedByThirdParty: true,
      collectorName: 'Marie Laurent',
      transferStatus: 'À reverser',
    });

    expect(
      normalizeOrderTransferState('Payé', true, 'Marie Laurent', 'Reversé', contributor),
    ).toEqual({
      collectedByThirdParty: true,
      collectorName: 'Marie Laurent',
      transferStatus: 'Reversé',
    });

    // D-03: non-payment patch (actorSession = null) preserves manager-collected order state
    expect(
      normalizeOrderTransferState('Payé', false, '', 'Non concerné', null),
    ).toEqual({
      collectedByThirdParty: false,
      collectorName: '',
      transferStatus: 'Non concerné',
    });
  });

  it('EC-20: preserves snapshotted unitWeightKg and unitPriceEur on existing OrderLineItem and validates negative inputs', () => {
    const updatedHarvest: Harvest = {
      ...HARVEST_2026,
      unitPricesEur: { '1kg': 22, '500g': 12, '250g': 7 },
    };
    const deactivatedFormats: JarFormat[] = FORMATS.map((f) =>
      f.code === '1kg' ? { ...f, active: false, weightKg: 1.2 } : f,
    );

    const totals = computeOrderTotals(
      [{ formatCode: '1kg', quantity: 2, unitWeightKg: 1, unitPriceEur: 15 }],
      updatedHarvest,
      deactivatedFormats,
      'Payé',
      null,
    );
    expect(totals.computedWeightKg).toBe(2);
    expect(totals.computedAmountEur).toBe(30);
    expect(totals.effectiveAmountEur).toBe(30);

    expect(() =>
      computeOrderTotals([{ formatCode: '1kg', quantity: -1 }], HARVEST_2026, FORMATS, 'Payé'),
    ).toThrow(RepositoryError);

    expect(() =>
      computeOrderTotals([{ formatCode: '1kg', quantity: 1 }], HARVEST_2026, FORMATS, 'Payé', -5),
    ).toThrow(RepositoryError);
  });

  it('EC-21 (S2-EC-11): attributes Payé orders by order.date year, excludes Donné/Non-payé, and warns on double counting', () => {
    const orders: SaleOrder[] = [
      // Harvest Été 2025 but sold in Jan 2026 -> counts in 2026!
      makeOrder({
        id: 'o-2026-jan',
        date: '2026-01-18',
        harvestLabel: 'Été 2025',
        paymentStatus: 'Payé',
        effectiveAmountEur: 40.5,
      }),
      makeOrder({
        id: 'o-2025-paid',
        date: '2025-08-10',
        harvestLabel: 'Été 2025',
        paymentStatus: 'Payé',
        effectiveAmountEur: 100,
      }),
      makeOrder({
        id: 'o-2025-unpaid',
        date: '2025-09-10',
        paymentStatus: 'Non-payé',
        effectiveAmountEur: 50,
      }),
      makeOrder({
        id: 'o-2025-donated',
        date: '2025-09-12',
        paymentStatus: 'Donné',
        effectiveAmountEur: 0,
      }),
    ];

    const entries: AccountingEntry[] = [
      {
        id: 'a-1',
        date: '2025-09-20',
        year: 2025,
        type: 'Recette',
        category: 'Ventes de miel',
        label: 'Foire locale',
        amountEur: 75,
      },
      {
        id: 'a-2',
        date: '2025-05-01',
        year: 2025,
        type: 'Dépense',
        category: 'Conditionnement (pots, étiquettes)',
        label: 'Pots',
        amountEur: 50,
      },
    ];

    const summary2025With = computeAnnualAccountingSummary(2025, entries, orders, {
      includePaidOrdersRevenue: true,
    });
    expect(summary2025With.paidOrdersHoneyRevenueEur).toBe(100);
    expect(summary2025With.manualHoneyRevenueEntriesEur).toBe(75);
    expect(summary2025With.hasHoneyDoubleCountWarning).toBe(true);
    expect(summary2025With.totalRevenuesEur).toBe(175);
    expect(summary2025With.totalExpensesEur).toBe(50);
    expect(summary2025With.netBalanceEur).toBe(125);
    expect(summary2025With.categoryBreakdown).toHaveLength(7);

    const summary2025Without = computeAnnualAccountingSummary(2025, entries, orders, {
      includePaidOrdersRevenue: false,
    });
    expect(summary2025Without.hasHoneyDoubleCountWarning).toBe(false);
    expect(summary2025Without.totalRevenuesEur).toBe(75);
    expect(summary2025Without.netBalanceEur).toBe(25);

    const summary2026 = computeAnnualAccountingSummary(2026, entries, orders, {
      includePaidOrdersRevenue: true,
    });
    expect(summary2026.paidOrdersHoneyRevenueEur).toBe(40.5);
  });

  it('EC-10 & EC-11: extracts customer directory, relay suggestions, and matches accent/phone search', () => {
    const orders: SaleOrder[] = [
      makeOrder({
        id: 'o-a',
        date: '2025-05-10',
        customerName: 'Elodie Benard',
        phone: '',
        contextOrRelay: "Marché d'Épinal",
      }),
      makeOrder({
        id: 'o-b',
        date: '2026-04-20',
        customerName: 'Élodie Bénard',
        phone: '06 12 34 56 78',
        contextOrRelay: '',
      }),
      makeOrder({
        id: 'o-c',
        date: '2026-04-21',
        customerName: 'Vente directe',
        phone: '',
        contextOrRelay: "Marché d'Épinal",
      }),
    ];

    const directory = extractCustomerDirectory(orders);
    expect(extractCustomerSuggestions).toBe(extractCustomerDirectory);
    expect(directory).toHaveLength(2);
    const elodie = directory.find((c) => c.customerName === 'Élodie Bénard');
    expect(elodie).toEqual({
      customerName: 'Élodie Bénard',
      phone: '06 12 34 56 78',
      lastContextOrRelay: "Marché d'Épinal",
      ordersCount: 2,
      lastOrderDate: '2026-04-20',
    });

    const relays = extractRelaySuggestions(orders);
    expect(relays).toEqual(["Marché d'Épinal"]);

    expect(matchesOrderSearch(orders[1]!, 'elodie')).toBe(true);
    expect(matchesOrderSearch(orders[1]!, '+3361234')).toBe(true);
    expect(matchesOrderSearch(orders[2]!, '06')).toBe(false);
  });
});
