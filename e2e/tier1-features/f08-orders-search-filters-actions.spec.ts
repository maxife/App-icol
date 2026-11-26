import { expect, test } from '@playwright/test';
import {
  bootstrapCleanApp,
  navigateViaTab,
  switchRole,
  visibleByTestId,
} from '../helpers/app';
import {
  createHarvestViaUi,
  createSaleViaUi,
  discoverFormatCodes,
  readSelectedOptionValue,
  selectOptionByLabelOrValue,
} from '../helpers/forms';
import { readDashboardSnapshot, readKpiNumber, round2 } from '../helpers/metrics';

test.describe('F-08 — Orders List, Search, Combinable Filters & 1-Click Actions', () => {
  test('F08-T1: filters orders instantaneously by accent-insensitive customer name and de-formatted phone digits', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');
    await createSaleViaUi(page, {
      customerName: 'Éléonore Béranger',
      phone: '+33 6 74 85 96 12',
      relay: 'Dépôt Épinal',
    });

    await navigateViaTab(page, 'orders');
    const searchInput = visibleByTestId(page, 'orders-search-input');

    await searchInput.fill('eleonore beranger');
    const visibleAfterName = page.locator('[data-testid="order-card"]:visible');
    await expect(visibleAfterName).toHaveCount(1);
    await expect(visibleAfterName.first()).toContainText('Éléonore Béranger');

    await searchInput.fill('06748596');
    await expect(
      page.getByTestId('order-card').filter({ hasText: 'Éléonore Béranger' }).first(),
    ).toBeVisible();

    await searchInput.fill('+33674859612');
    await expect(
      page.getByTestId('order-card').filter({ hasText: 'Éléonore Béranger' }).first(),
    ).toBeVisible();
  });

  test('F08-T2: combines status quick-filter chips, harvest selector, and relay selector with AND logic and resets via filter-clear-all', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/harvests');

    await createHarvestViaUi(page, {
      label: 'Lavande Filtres 2027',
      year: 2027,
      forecastKg: 50,
      realizedKg: 50,
      defaultUnitPrice: 15,
    });

    await createSaleViaUi(page, {
      harvestLabel: 'Lavande Filtres 2027',
      customerName: 'Alice Filtre',
      relay: 'Relais Gare Nord',
      orderStatus: 'Réservé',
      paymentStatus: 'Non-payé',
    });
    await createSaleViaUi(page, {
      harvestLabel: 'Lavande Filtres 2027',
      customerName: 'Bastien Filtre',
      relay: 'Relais Gare Nord',
      orderStatus: 'Réservé',
      paymentStatus: 'Payé',
    });
    await createSaleViaUi(page, {
      harvestLabel: 'Lavande Filtres 2027',
      customerName: 'Chloé Filtre',
      relay: 'Relais Mairie Sud',
      orderStatus: 'Distribué',
      paymentStatus: 'Payé',
    });

    await navigateViaTab(page, 'orders');
    const visibleCards = page.locator('[data-testid="order-card"]:visible');
    const totalCards = await visibleCards.count();
    expect(totalCards).toBeGreaterThanOrEqual(3);

    await selectOptionByLabelOrValue(
      visibleByTestId(page, 'filter-harvest-select'),
      'Lavande Filtres 2027',
    );
    await expect(visibleCards).toHaveCount(3);

    await selectOptionByLabelOrValue(
      visibleByTestId(page, 'filter-relay-select'),
      'Relais Gare Nord',
    );
    await expect(visibleCards).toHaveCount(2);

    await visibleByTestId(page, 'filter-reserved').click();
    await expect(visibleCards).toHaveCount(2);

    await visibleByTestId(page, 'filter-unpaid').click();
    await expect(visibleCards).toHaveCount(1);
    await expect(visibleCards.first()).toContainText('Alice Filtre');

    await visibleByTestId(page, 'filter-clear-all').click();
    await expect(visibleCards).toHaveCount(totalCards);
  });

  test('F08-T3: renders compact order cards with a clickable tel: call link and status badges', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');
    await navigateViaTab(page, 'new-sale');
    const codes = await discoverFormatCodes(page);

    await createSaleViaUi(page, {
      alreadyOnSaleForm: true,
      customerName: 'Damien Appel Direct',
      phone: '+33 6 42 43 44 45',
      relay: 'Marché Bio',
      quantities: { [codes[0]]: 2 },
      orderStatus: 'Réservé',
      paymentStatus: 'Non-payé',
    });

    await navigateViaTab(page, 'orders');
    await visibleByTestId(page, 'orders-search-input').fill('Damien Appel Direct');

    const card = page
      .getByTestId('order-card')
      .filter({ hasText: 'Damien Appel Direct' })
      .first();
    await expect(card).toBeVisible();

    const orderId = await card.getAttribute('data-order-id');
    expect(orderId && orderId.trim().length > 0).toBe(true);

    await expect(card).toContainText('Damien Appel Direct');
    await expect(card).toContainText('Marché Bio');
    await expect(card).toContainText('Réservé');
    await expect(card).toContainText('Non-payé');

    const telLink = card.getByTestId('order-tel-link');
    await expect(telLink).toBeVisible();
    const href = (await telLink.getAttribute('href')) ?? '';
    expect(href.toLowerCase().startsWith('tel:')).toBe(true);
    const hrefDigits = href.replace(/\D/g, '');
    expect(hrefDigits.endsWith('642434445')).toBe(true);
  });

  test('F08-T4: transitions Réservé order to Distribué in 1 click via action-mark-distributed with toast confirmation', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');
    const baselineHarvestValue = await readSelectedOptionValue(
      visibleByTestId(page, 'dashboard-harvest-select'),
    );

    await visibleByTestId(page, 'dashboard-new-sale-cta').click();
    await createSaleViaUi(page, {
      alreadyOnSaleForm: true,
      customerName: 'Estelle Livraison 1Clic',
      orderStatus: 'Réservé',
      paymentStatus: 'Payé',
    });

    await navigateViaTab(page, 'dashboard');
    await visibleByTestId(page, 'dashboard-harvest-select').selectOption(baselineHarvestValue);
    const snapBefore = await readDashboardSnapshot(page);

    await navigateViaTab(page, 'orders');
    await visibleByTestId(page, 'orders-search-input').fill('Estelle Livraison 1Clic');
    const card = page
      .getByTestId('order-card')
      .filter({ hasText: 'Estelle Livraison 1Clic' })
      .first();
    await expect(card).toBeVisible();
    await expect(card.getByTestId('action-mark-distributed')).toBeVisible();

    await card.getByTestId('action-mark-distributed').click();
    await expect(visibleByTestId(page, 'toast-success')).toBeVisible();
    await expect(card).toContainText('Distribué');
    await expect(card.locator('[data-testid="action-mark-distributed"]:visible')).toHaveCount(0);

    await navigateViaTab(page, 'dashboard');
    await visibleByTestId(page, 'dashboard-harvest-select').selectOption(baselineHarvestValue);
    expect(await readKpiNumber(page, 'kpi-pending-deliveries')).toBe(
      snapBefore.pendingDeliveriesCount - 1,
    );
    expect(await readKpiNumber(page, 'kpi-committed-kg')).toBeCloseTo(
      snapBefore.committedKg,
      2,
    );
  });

  test('F08-T5: transitions Non-payé order to Payé in 1 click via action-mark-paid and updates collected revenue', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');
    const baselineHarvestValue = await readSelectedOptionValue(
      visibleByTestId(page, 'dashboard-harvest-select'),
    );

    await visibleByTestId(page, 'dashboard-new-sale-cta').click();
    const codes = await discoverFormatCodes(page);
    const created = await createSaleViaUi(page, {
      alreadyOnSaleForm: true,
      customerName: 'Fabien Paiement 1Clic',
      quantities: { [codes[0]]: 2 },
      orderStatus: 'Distribué',
      paymentStatus: 'Non-payé',
    });
    expect(created.totalAmountEur).toBeGreaterThan(0);

    await navigateViaTab(page, 'dashboard');
    await visibleByTestId(page, 'dashboard-harvest-select').selectOption(baselineHarvestValue);
    const snapBefore = await readDashboardSnapshot(page);

    await navigateViaTab(page, 'orders');
    await visibleByTestId(page, 'orders-search-input').fill('Fabien Paiement 1Clic');
    const card = page
      .getByTestId('order-card')
      .filter({ hasText: 'Fabien Paiement 1Clic' })
      .first();
    await expect(card).toBeVisible();
    await card.getByTestId('action-mark-paid').click();

    await expect(visibleByTestId(page, 'toast-success')).toBeVisible();
    await expect(card).toContainText('Payé');
    await expect(card.locator('[data-testid="action-mark-paid"]:visible')).toHaveCount(0);

    await navigateViaTab(page, 'dashboard');
    await visibleByTestId(page, 'dashboard-harvest-select').selectOption(baselineHarvestValue);
    expect(await readKpiNumber(page, 'kpi-paid-eur')).toBeCloseTo(
      round2(snapBefore.paidEur + created.totalAmountEur),
      2,
    );
    expect(await readKpiNumber(page, 'kpi-unpaid-eur')).toBeCloseTo(
      round2(snapBefore.unpaidEur - created.totalAmountEur),
      2,
    );
  });

  test('F08-T6: settles co-seller À reverser order in 1 click via action-mark-transferred and clears pending transfer filter', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');
    await switchRole(page, 'contributor');

    await createSaleViaUi(page, {
      customerName: 'Gaëlle Reversement 1Clic',
      orderStatus: 'Distribué',
      paymentStatus: 'Payé',
    });

    await switchRole(page, 'manager');
    await navigateViaTab(page, 'orders');
    await visibleByTestId(page, 'filter-pending-transfer').click();
    await visibleByTestId(page, 'orders-search-input').fill('Gaëlle Reversement 1Clic');

    const matchingCards = page
      .locator('[data-testid="order-card"]:visible')
      .filter({ hasText: 'Gaëlle Reversement 1Clic' });
    await expect(matchingCards).toHaveCount(1);
    await expect(matchingCards.first().getByTestId('action-mark-transferred')).toBeVisible();

    await matchingCards.first().getByTestId('action-mark-transferred').click();
    await expect(visibleByTestId(page, 'toast-success')).toBeVisible();
    await expect(matchingCards).toHaveCount(0);

    await visibleByTestId(page, 'filter-pending-transfer').click();
    const settledCard = page
      .locator('[data-testid="order-card"]:visible')
      .filter({ hasText: 'Gaëlle Reversement 1Clic' })
      .first();
    await expect(settledCard).toBeVisible();
    await expect(settledCard).toContainText('Reversé');
    await expect(settledCard.locator('[data-testid="action-mark-transferred"]:visible')).toHaveCount(
      0,
    );
  });
});
