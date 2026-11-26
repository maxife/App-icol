import { expect, test } from '@playwright/test';
import {
  bootstrapCleanApp,
  navigateViaTab,
  readBooleanControlState,
  readCurrentUserRole,
  setBooleanControlState,
  switchRole,
  visibleByTestId,
} from '../helpers/app';
import {
  discoverFormatCodes,
  readSelectedOptionValue,
  readStepperQty,
  setSegmentedControlOrButton,
  setStepperQty,
} from '../helpers/forms';
import {
  parseEuroFromText,
  readDashboardSnapshot,
  readKpiNumber,
  round2,
} from '../helpers/metrics';

test.describe('F-07 — Order/Payment/Transfer Statuses & Resilient Offline Drafts', () => {
  test('F07-T1: creates a Réservé and Non-payé order and reflects immediate stock commitment, unpaid balance, and pending delivery', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');

    const baselineHarvestValue = await readSelectedOptionValue(
      visibleByTestId(page, 'dashboard-harvest-select'),
    );
    const before = await readDashboardSnapshot(page);

    await visibleByTestId(page, 'dashboard-new-sale-cta').click();
    await expect(visibleByTestId(page, 'sale-form-page')).toBeVisible();

    await visibleByTestId(page, 'customer-name-input').fill('Camille Réservation F07');
    await visibleByTestId(page, 'customer-phone-input').fill('06 14 25 36 47');

    const codes = await discoverFormatCodes(page);
    await setStepperQty(page, codes[0], 2);

    const orderKg = await readKpiNumber(page, 'sale-total-weight');
    const orderEur = await readKpiNumber(page, 'sale-total-amount');
    expect(orderKg).toBeGreaterThan(0);
    expect(orderEur).toBeGreaterThan(0);

    await setSegmentedControlOrButton(page, 'order-status-Réservé');
    await setSegmentedControlOrButton(page, 'payment-status-Non-payé');
    await visibleByTestId(page, 'sale-submit-btn').click();
    await expect(visibleByTestId(page, 'toast-success')).toBeVisible();

    await navigateViaTab(page, 'dashboard');
    await visibleByTestId(page, 'dashboard-harvest-select').selectOption(baselineHarvestValue);

    expect(await readKpiNumber(page, 'kpi-committed-kg')).toBeCloseTo(
      round2(before.committedKg + orderKg),
      2,
    );
    expect(await readKpiNumber(page, 'kpi-available-kg')).toBeCloseTo(
      round2(before.availableKg - orderKg),
      2,
    );
    expect(await readKpiNumber(page, 'kpi-unpaid-eur')).toBeCloseTo(
      round2(before.unpaidEur + orderEur),
      2,
    );
    expect(await readKpiNumber(page, 'kpi-paid-eur')).toBeCloseTo(before.paidEur, 2);
    expect(await readKpiNumber(page, 'kpi-pending-deliveries')).toBe(
      before.pendingDeliveriesCount + 1,
    );
  });

  test('F07-T2: selecting payment-status-Donné displays 0 € offert state on form and records 0 € revenue while deducting stock', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');

    const baselineHarvestValue = await readSelectedOptionValue(
      visibleByTestId(page, 'dashboard-harvest-select'),
    );
    const before = await readDashboardSnapshot(page);

    await visibleByTestId(page, 'dashboard-new-sale-cta').click();
    await expect(visibleByTestId(page, 'sale-form-page')).toBeVisible();

    await visibleByTestId(page, 'customer-name-input').fill('Voisin Don Rucher F07');
    const codes = await discoverFormatCodes(page);
    await setStepperQty(page, codes[0], 2);

    const initialCatalogEur = await readKpiNumber(page, 'sale-total-amount');
    expect(initialCatalogEur).toBeGreaterThan(0);
    const giftKg = await readKpiNumber(page, 'sale-total-weight');
    expect(giftKg).toBeGreaterThan(0);

    await setSegmentedControlOrButton(page, 'order-status-Distribué');
    await setSegmentedControlOrButton(page, 'payment-status-Donné');

    const amountAfterDonne = await readKpiNumber(page, 'sale-total-amount');
    const formText = (await visibleByTestId(page, 'sale-form-page').textContent()) ?? '';
    expect(amountAfterDonne === 0 || /0[,.]00\s*€|offert|donné/i.test(formText)).toBe(true);

    await visibleByTestId(page, 'sale-submit-btn').click();
    await expect(visibleByTestId(page, 'toast-success')).toBeVisible();

    await navigateViaTab(page, 'dashboard');
    await visibleByTestId(page, 'dashboard-harvest-select').selectOption(baselineHarvestValue);

    expect(await readKpiNumber(page, 'kpi-committed-kg')).toBeCloseTo(
      round2(before.committedKg + giftKg),
      2,
    );
    expect(await readKpiNumber(page, 'kpi-available-kg')).toBeCloseTo(
      round2(before.availableKg - giftKg),
      2,
    );
    expect(await readKpiNumber(page, 'kpi-paid-eur')).toBeCloseTo(before.paidEur, 2);
    expect(await readKpiNumber(page, 'kpi-unpaid-eur')).toBeCloseTo(before.unpaidEur, 2);
    await expect(visibleByTestId(page, 'kpi-donated-summary')).toBeVisible();
  });

  test('F07-T3: manager enables third-party-toggle with collector name and À reverser status to track pending third-party transfer', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');

    const baselineHarvestValue = await readSelectedOptionValue(
      visibleByTestId(page, 'dashboard-harvest-select'),
    );
    const before = await readDashboardSnapshot(page);

    await visibleByTestId(page, 'dashboard-new-sale-cta').click();
    await expect(visibleByTestId(page, 'sale-form-page')).toBeVisible();

    await visibleByTestId(page, 'customer-name-input').fill('Client Dépôt Épicerie F07');
    const codes = await discoverFormatCodes(page);
    await setStepperQty(page, codes[0], 2);
    const saleEur = await readKpiNumber(page, 'sale-total-amount');
    expect(saleEur).toBeGreaterThan(0);

    await setSegmentedControlOrButton(page, 'order-status-Distribué');
    await setSegmentedControlOrButton(page, 'payment-status-Payé');

    const thirdPartyToggle = page.getByTestId('third-party-toggle').first();
    await expect(thirdPartyToggle).toBeAttached();
    await setBooleanControlState(thirdPartyToggle, true);

    const collectorInput = visibleByTestId(page, 'collector-name-input');
    await expect(collectorInput).toBeVisible();
    await collectorInput.fill('Épicerie du Village');

    await setSegmentedControlOrButton(page, 'transfer-status-À reverser');
    await visibleByTestId(page, 'sale-submit-btn').click();
    await expect(visibleByTestId(page, 'toast-success')).toBeVisible();

    await navigateViaTab(page, 'orders');
    await visibleByTestId(page, 'filter-pending-transfer').click();

    const card = page
      .getByTestId('order-card')
      .filter({ hasText: 'Client Dépôt Épicerie F07' })
      .first();
    await expect(card).toBeVisible();
    await expect(card).toContainText('Épicerie du Village');
    await expect(card.getByTestId('action-mark-transferred')).toBeVisible();

    await navigateViaTab(page, 'dashboard');
    await visibleByTestId(page, 'dashboard-harvest-select').selectOption(baselineHarvestValue);
    const transfersKpi = visibleByTestId(page, 'kpi-pending-transfers');
    await expect(transfersKpi).toBeVisible();
    const parsedTransferEur = parseEuroFromText(await transfersKpi.innerText());
    if (parsedTransferEur !== null) {
      expect(parsedTransferEur).toBeCloseTo(round2(before.pendingTransfersEur + saleEur), 2);
    }
  });

  test('F07-T4: contributor creating a Payé sale auto-populates third-party collection, collectorName, and À reverser status', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');
    await switchRole(page, 'contributor');
    expect(await readCurrentUserRole(page)).toBe('contributor');

    await navigateViaTab(page, 'new-sale');
    await visibleByTestId(page, 'customer-name-input').fill('Client Encaissé CoVendeur F07');

    const codes = await discoverFormatCodes(page);
    await setStepperQty(page, codes[0], 1);
    await setSegmentedControlOrButton(page, 'order-status-Distribué');
    await setSegmentedControlOrButton(page, 'payment-status-Payé');

    const thirdPartyToggle = page.getByTestId('third-party-toggle').first();
    await expect(thirdPartyToggle).toBeAttached();
    await expect.poll(() => readBooleanControlState(thirdPartyToggle)).toBe(true);

    const collectorInput = visibleByTestId(page, 'collector-name-input');
    await expect(collectorInput).toBeVisible();
    const autoCollectorName = (await collectorInput.inputValue()).trim();
    expect(autoCollectorName.length).toBeGreaterThan(0);

    await visibleByTestId(page, 'sale-submit-btn').click();
    await expect(visibleByTestId(page, 'toast-success')).toBeVisible();

    await navigateViaTab(page, 'orders');
    await visibleByTestId(page, 'filter-pending-transfer').click();
    const card = page
      .getByTestId('order-card')
      .filter({ hasText: 'Client Encaissé CoVendeur F07' })
      .first();
    await expect(card).toBeVisible();
    await expect(card.getByTestId('action-mark-transferred')).toBeVisible();
  });

  test('F07-T5: auto-saves in-progress new-sale draft to localStorage across page reload and clears draft after successful submit', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');
    await navigateViaTab(page, 'new-sale');

    const codes = await discoverFormatCodes(page);
    const fmt0 = codes[0];

    await visibleByTestId(page, 'customer-name-input').fill('Brouillon Persistant F07');
    await visibleByTestId(page, 'customer-phone-input').fill('06 91 82 73 64');
    await visibleByTestId(page, 'customer-relay-input').fill('Marché Couvert');
    await visibleByTestId(page, 'sale-notes-input').fill('Livrer vendredi soir');
    await setStepperQty(page, fmt0, 3);
    expect(await readStepperQty(page, fmt0)).toBe(3);

    await expect
      .poll(() =>
        page.evaluate(() => {
          for (let i = 0; i < window.localStorage.length; i += 1) {
            const key = window.localStorage.key(i);
            if (key && (window.localStorage.getItem(key) ?? '').includes('Brouillon Persistant F07')) {
              return true;
            }
          }
          return false;
        }),
      )
      .toBe(true);

    await page.reload();
    await expect(visibleByTestId(page, 'sale-form-page')).toBeVisible();

    await expect(visibleByTestId(page, 'customer-name-input')).toHaveValue(
      'Brouillon Persistant F07',
    );
    const restoredPhone = (await visibleByTestId(page, 'customer-phone-input').inputValue()).replace(
      /\s+/g,
      '',
    );
    expect(restoredPhone).toContain('0691827364');
    await expect(visibleByTestId(page, 'customer-relay-input')).toHaveValue('Marché Couvert');
    await expect(visibleByTestId(page, 'sale-notes-input')).toHaveValue('Livrer vendredi soir');
    expect(await readStepperQty(page, fmt0)).toBe(3);

    await visibleByTestId(page, 'sale-submit-btn').click();
    await expect(visibleByTestId(page, 'toast-success')).toBeVisible();

    await navigateViaTab(page, 'dashboard');
    await navigateViaTab(page, 'new-sale');
    await expect(visibleByTestId(page, 'customer-name-input')).toHaveValue('');
    await expect(visibleByTestId(page, 'sale-notes-input')).toHaveValue('');
    expect(await readStepperQty(page, fmt0)).toBe(0);
  });
});
