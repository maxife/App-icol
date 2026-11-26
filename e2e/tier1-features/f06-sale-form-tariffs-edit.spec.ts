import { expect, test } from '@playwright/test';
import {
  assertTestIdHidden,
  bootstrapCleanApp,
  getBrowserLocalTodayIso,
  navigateViaTab,
  visibleByTestId,
} from '../helpers/app';
import {
  createHarvestViaUi,
  createSaleViaUi,
  discoverFormatCodes,
  enableManualPriceOverride,
  measureFormatUnitWeights,
  readSelectedOptionText,
  readSelectedOptionValue,
  readStepperQty,
  selectOptionByLabelOrValue,
  setSegmentedControlOrButton,
  setStepperQty,
  upsertJarFormatViaUi,
} from '../helpers/forms';
import { readDashboardSnapshot, readKpiNumber, round2, round3 } from '../helpers/metrics';

test.describe('F-06 — Rapid Sale/Reservation Entry, Tariffs, Manual Override & Edit Mode', () => {
  test('F06-T1: initializes sale-date-input to local calendar today YYYY-MM-DD and pre-selects default active harvest', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');

    const defaultHarvestLabel = await readSelectedOptionText(
      visibleByTestId(page, 'dashboard-harvest-select'),
    );
    const expectedTodayIso = await getBrowserLocalTodayIso(page);

    await navigateViaTab(page, 'new-sale');
    const dateInput = visibleByTestId(page, 'sale-date-input');
    await expect(dateInput).toHaveValue(expectedTodayIso);
    expect(
      await readSelectedOptionText(visibleByTestId(page, 'sale-harvest-select')),
    ).toBe(defaultHarvestLabel);
    expect(await readKpiNumber(page, 'sale-total-weight')).toBe(0);
    expect(await readKpiNumber(page, 'sale-total-amount')).toBe(0);

    await dateInput.fill('2026-07-14');
    await expect(dateInput).toHaveValue('2026-07-14');
  });

  test('F06-T2: computes live weight and PUan catalog totals across multiple jar steppers and harvest changes', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');
    await navigateViaTab(page, 'new-sale');

    let unitWeights = await measureFormatUnitWeights(page);
    let codes = Object.keys(unitWeights);
    if (codes.length < 2) {
      await upsertJarFormatViaUi(page, {
        code: '250g',
        label: 'Pot 250 g',
        weightKg: 0.25,
      });
      await navigateViaTab(page, 'new-sale');
      unitWeights = await measureFormatUnitWeights(page);
      codes = Object.keys(unitWeights);
    }
    expect(codes.length).toBeGreaterThanOrEqual(2);
    const [fmtA, fmtB] = codes;
    const wA = unitWeights[fmtA];
    const wB = unitWeights[fmtB];

    await createHarvestViaUi(page, {
      label: 'Fleurs Tarif A 2027',
      year: 2027,
      forecastKg: 60,
      unitPrices: { [fmtA]: 14, [fmtB]: 8 },
      defaultUnitPrice: 5,
    });
    await createHarvestViaUi(page, {
      label: 'Forêt Tarif B 2027',
      year: 2027,
      forecastKg: 60,
      unitPrices: { [fmtA]: 18, [fmtB]: 10 },
      defaultUnitPrice: 6,
    });

    await navigateViaTab(page, 'new-sale');
    await selectOptionByLabelOrValue(
      visibleByTestId(page, 'sale-harvest-select'),
      'Fleurs Tarif A 2027',
    );

    await setStepperQty(page, fmtA, 3);
    await setStepperQty(page, fmtB, 2);
    expect(await readStepperQty(page, fmtA)).toBe(3);
    expect(await readStepperQty(page, fmtB)).toBe(2);
    expect(await readKpiNumber(page, 'sale-total-weight')).toBeCloseTo(
      round3(3 * wA + 2 * wB),
      3,
    );
    expect(await readKpiNumber(page, 'sale-total-amount')).toBeCloseTo(58, 2);

    await visibleByTestId(page, `stepper-dec-${fmtA}`).click();
    expect(await readStepperQty(page, fmtA)).toBe(2);
    expect(await readKpiNumber(page, 'sale-total-weight')).toBeCloseTo(
      round3(2 * wA + 2 * wB),
      3,
    );
    expect(await readKpiNumber(page, 'sale-total-amount')).toBeCloseTo(44, 2);

    await selectOptionByLabelOrValue(
      visibleByTestId(page, 'sale-harvest-select'),
      'Forêt Tarif B 2027',
    );
    expect(await readKpiNumber(page, 'sale-total-weight')).toBeCloseTo(
      round3(2 * wA + 2 * wB),
      3,
    );
    expect(await readKpiNumber(page, 'sale-total-amount')).toBeCloseTo(56, 2);
  });

  test('F06-T3: overrides total price with French decimal input and resets back to auto PUan tariff', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');

    const harvestSelect = visibleByTestId(page, 'dashboard-harvest-select');
    const baselineHarvestValue = await readSelectedOptionValue(harvestSelect);
    const paid0 = await readKpiNumber(page, 'kpi-paid-eur');

    await navigateViaTab(page, 'new-sale');
    const codes = await discoverFormatCodes(page);
    await setStepperQty(page, codes[0], 2);

    const catalogEur = await readKpiNumber(page, 'sale-total-amount');
    expect(catalogEur).toBeGreaterThan(0);

    const useAltOverride = Math.abs(catalogEur - 22.5) < 0.01;
    const rawOverride = useAltOverride ? '24,50' : '22,50';
    const overrideEur = useAltOverride ? 24.5 : 22.5;

    await enableManualPriceOverride(page, rawOverride);
    expect(await readKpiNumber(page, 'sale-total-amount')).toBeCloseTo(overrideEur, 2);

    await visibleByTestId(page, 'sale-reset-auto-price').click();
    expect(await readKpiNumber(page, 'sale-total-amount')).toBeCloseTo(catalogEur, 2);

    await enableManualPriceOverride(page, rawOverride);
    expect(await readKpiNumber(page, 'sale-total-amount')).toBeCloseTo(overrideEur, 2);

    await visibleByTestId(page, 'customer-name-input').fill('Client Tarif Ami');
    await setSegmentedControlOrButton(page, 'payment-status-Payé');
    await visibleByTestId(page, 'sale-submit-btn').click();
    await expect(visibleByTestId(page, 'toast-success')).toBeVisible();

    await navigateViaTab(page, 'dashboard');
    await visibleByTestId(page, 'dashboard-harvest-select').selectOption(baselineHarvestValue);
    expect(await readKpiNumber(page, 'kpi-paid-eur')).toBeCloseTo(
      round2(paid0 + overrideEur),
      2,
    );
  });

  test('F06-T4: submits a complete reservation with notes and reflects order across Orders list and Dashboard', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');

    const baselineHarvestValue = await readSelectedOptionValue(
      visibleByTestId(page, 'dashboard-harvest-select'),
    );
    const before = await readDashboardSnapshot(page);

    await navigateViaTab(page, 'new-sale');
    const codes = await discoverFormatCodes(page);
    const created = await createSaleViaUi(page, {
      alreadyOnSaleForm: true,
      customerName: 'Pauline Mercier',
      phone: '06 14 25 36 47',
      relay: 'Marché Bio Dimanche',
      quantities: { [codes[0]]: 2 },
      orderStatus: 'Réservé',
      paymentStatus: 'Non-payé',
      notes: 'Appeler avant passage',
    });

    await navigateViaTab(page, 'orders');
    await visibleByTestId(page, 'orders-search-input').fill('Pauline Mercier');
    const card = page.getByTestId('order-card').filter({ hasText: 'Pauline Mercier' }).first();
    await expect(card).toBeVisible();
    await expect(card).toContainText('Marché Bio Dimanche');
    await expect(card.getByTestId('order-tel-link')).toHaveAttribute('href', /^tel:/i);

    await navigateViaTab(page, 'dashboard');
    await visibleByTestId(page, 'dashboard-harvest-select').selectOption(baselineHarvestValue);
    expect(await readKpiNumber(page, 'kpi-committed-kg')).toBeCloseTo(
      round2(before.committedKg + created.totalWeightKg),
      2,
    );
    expect(await readKpiNumber(page, 'kpi-unpaid-eur')).toBeCloseTo(
      round2(before.unpaidEur + created.totalAmountEur),
      2,
    );
    expect(await readKpiNumber(page, 'kpi-pending-deliveries')).toBe(
      before.pendingDeliveriesCount + 1,
    );
  });

  test('F06-T5: opens an existing order in Edit Mode (#/sale/edit/:orderId), pre-fills fields, and saves updated quantities and statuses', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');

    const baselineHarvestValue = await readSelectedOptionValue(
      visibleByTestId(page, 'dashboard-harvest-select'),
    );
    const before = await readDashboardSnapshot(page);

    await navigateViaTab(page, 'new-sale');
    const codes = await discoverFormatCodes(page);
    const fmtA = codes[0];
    await createSaleViaUi(page, {
      alreadyOnSaleForm: true,
      customerName: 'Vincent Carpentier',
      phone: '06 91 82 73 64',
      relay: 'Relais Gare',
      quantities: { [fmtA]: 1 },
      orderStatus: 'Réservé',
      paymentStatus: 'Non-payé',
      notes: '1 pot initial',
    });

    await navigateViaTab(page, 'orders');
    await visibleByTestId(page, 'orders-search-input').fill('Vincent Carpentier');
    const card = page
      .getByTestId('order-card')
      .filter({ hasText: 'Vincent Carpentier' })
      .first();
    await expect(card).toBeVisible();
    const orderId = await card.getAttribute('data-order-id');
    expect(orderId).toBeTruthy();

    await card.getByTestId('action-edit-order').click();
    await expect(visibleByTestId(page, 'sale-form-page')).toBeVisible();
    expect(decodeURIComponent(new URL(page.url()).hash)).toContain(`/sale/edit/${orderId}`);

    await expect(visibleByTestId(page, 'customer-name-input')).toHaveValue('Vincent Carpentier');
    await expect(visibleByTestId(page, 'customer-phone-input')).toHaveValue('06 91 82 73 64');
    await expect(visibleByTestId(page, 'customer-relay-input')).toHaveValue('Relais Gare');
    expect(await readStepperQty(page, fmtA)).toBe(1);
    await expect(visibleByTestId(page, 'sale-notes-input')).toHaveValue('1 pot initial');

    await setStepperQty(page, fmtA, 3);
    const updatedKg = await readKpiNumber(page, 'sale-total-weight');
    const updatedEur = await readKpiNumber(page, 'sale-total-amount');
    await setSegmentedControlOrButton(page, 'order-status-Distribué');
    await setSegmentedControlOrButton(page, 'payment-status-Payé');
    await visibleByTestId(page, 'sale-notes-input').fill('3 pots livrés et payés');
    await visibleByTestId(page, 'sale-submit-btn').click();
    await expect(visibleByTestId(page, 'toast-success')).toBeVisible();

    await navigateViaTab(page, 'orders');
    await visibleByTestId(page, 'orders-search-input').fill('Vincent Carpentier');
    const updatedCards = page
      .getByTestId('order-card')
      .filter({ hasText: 'Vincent Carpentier' });
    await expect(updatedCards).toHaveCount(1);
    expect(await updatedCards.first().getAttribute('data-order-id')).toBe(orderId);

    await navigateViaTab(page, 'dashboard');
    await visibleByTestId(page, 'dashboard-harvest-select').selectOption(baselineHarvestValue);
    expect(await readKpiNumber(page, 'kpi-committed-kg')).toBeCloseTo(
      round2(before.committedKg + updatedKg),
      2,
    );
    expect(await readKpiNumber(page, 'kpi-unpaid-eur')).toBeCloseTo(before.unpaidEur, 2);
    expect(await readKpiNumber(page, 'kpi-paid-eur')).toBeCloseTo(
      round2(before.paidEur + updatedEur),
      2,
    );
  });

  test('F06-T6: allows manager to delete an order with two-step confirmation and restores dashboard stock and KPIs', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');

    const baselineHarvestValue = await readSelectedOptionValue(
      visibleByTestId(page, 'dashboard-harvest-select'),
    );
    const before = await readDashboardSnapshot(page);

    await navigateViaTab(page, 'new-sale');
    const codes = await discoverFormatCodes(page);
    await createSaleViaUi(page, {
      alreadyOnSaleForm: true,
      customerName: 'Commande Doublon À Supprimer',
      quantities: { [codes[0]]: 2 },
      orderStatus: 'Réservé',
      paymentStatus: 'Non-payé',
    });

    await navigateViaTab(page, 'orders');
    await visibleByTestId(page, 'orders-search-input').fill('Commande Doublon À Supprimer');
    const card = page
      .getByTestId('order-card')
      .filter({ hasText: 'Commande Doublon À Supprimer' })
      .first();
    await expect(card).toBeVisible();
    await card.getByTestId('action-edit-order').click();

    await expect(visibleByTestId(page, 'sale-form-page')).toBeVisible();
    const deleteBtn = visibleByTestId(page, 'sale-delete-btn');
    await expect(deleteBtn).toBeVisible();
    await assertTestIdHidden(page, 'sale-confirm-delete-btn');

    await deleteBtn.click();
    const confirmDeleteBtn = visibleByTestId(page, 'sale-confirm-delete-btn');
    await expect(confirmDeleteBtn).toBeVisible();
    await confirmDeleteBtn.click();

    await expect
      .poll(async () => {
        const toastVisible = await visibleByTestId(page, 'toast-success')
          .isVisible()
          .catch(() => false);
        const leftEditRoute = !new URL(page.url()).hash.startsWith('#/sale/edit/');
        return toastVisible || leftEditRoute;
      })
      .toBe(true);

    await navigateViaTab(page, 'orders');
    await visibleByTestId(page, 'orders-search-input').fill('Commande Doublon À Supprimer');
    await expect(
      page.getByTestId('order-card').filter({ hasText: 'Commande Doublon À Supprimer' }),
    ).toHaveCount(0);

    await navigateViaTab(page, 'dashboard');
    await visibleByTestId(page, 'dashboard-harvest-select').selectOption(baselineHarvestValue);
    expect(await readKpiNumber(page, 'kpi-committed-kg')).toBeCloseTo(before.committedKg, 2);
    expect(await readKpiNumber(page, 'kpi-paid-eur')).toBeCloseTo(before.paidEur, 2);
    expect(await readKpiNumber(page, 'kpi-unpaid-eur')).toBeCloseTo(before.unpaidEur, 2);
    expect(await readKpiNumber(page, 'kpi-pending-deliveries')).toBe(
      before.pendingDeliveriesCount,
    );
  });
});
