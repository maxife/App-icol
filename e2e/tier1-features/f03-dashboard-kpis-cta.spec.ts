import { expect, test } from '@playwright/test';
import {
  bootstrapCleanApp,
  navigateViaTab,
  switchRole,
  visibleByTestId,
} from '../helpers/app';
import {
  clickKpiDeepLink,
  createHarvestViaUi,
  createSaleViaUi,
  discoverFormatCodes,
  readSelectedOptionText,
  readSelectedOptionValue,
  selectOptionByLabelOrValue,
} from '../helpers/forms';
import {
  containsStandaloneInteger,
  parseEuroFromText,
  parseFrenchNumberFromText,
  parseWeightKgFromText,
  readKpiNumber,
  readNormalizedTextTokens,
  round2,
} from '../helpers/metrics';

test.describe('F-03 — Season Dashboard: Financial KPIs, Donné, Transfers & Quick CTA', () => {
  test('F03-T1: separates Payé collected revenue from Non-payé receivables in dashboard financial KPIs', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');

    const harvestSelect = visibleByTestId(page, 'dashboard-harvest-select');
    const baselineHarvestValue = await readSelectedOptionValue(harvestSelect);
    const paid0 = await readKpiNumber(page, 'kpi-paid-eur');
    const unpaid0 = await readKpiNumber(page, 'kpi-unpaid-eur');

    await visibleByTestId(page, 'dashboard-new-sale-cta').click();
    const codes = await discoverFormatCodes(page);
    const paidOrder = await createSaleViaUi(page, {
      alreadyOnSaleForm: true,
      customerName: 'Client Encaissé',
      quantities: { [codes[0]]: 2 },
      orderStatus: 'Distribué',
      paymentStatus: 'Payé',
    });
    expect(paidOrder.totalAmountEur).toBeGreaterThan(0);

    await navigateViaTab(page, 'dashboard');
    await visibleByTestId(page, 'dashboard-harvest-select').selectOption(baselineHarvestValue);
    expect(await readKpiNumber(page, 'kpi-paid-eur')).toBeCloseTo(
      round2(paid0 + paidOrder.totalAmountEur),
      2,
    );
    expect(await readKpiNumber(page, 'kpi-unpaid-eur')).toBeCloseTo(unpaid0, 2);

    await visibleByTestId(page, 'dashboard-new-sale-cta').click();
    const unpaidOrder = await createSaleViaUi(page, {
      alreadyOnSaleForm: true,
      customerName: 'Client À Relancer',
      quantities: { [codes[0]]: 1 },
      orderStatus: 'Réservé',
      paymentStatus: 'Non-payé',
    });
    expect(unpaidOrder.totalAmountEur).toBeGreaterThan(0);

    await navigateViaTab(page, 'dashboard');
    await visibleByTestId(page, 'dashboard-harvest-select').selectOption(baselineHarvestValue);
    expect(await readKpiNumber(page, 'kpi-paid-eur')).toBeCloseTo(
      round2(paid0 + paidOrder.totalAmountEur),
      2,
    );
    expect(await readKpiNumber(page, 'kpi-unpaid-eur')).toBeCloseTo(
      round2(unpaid0 + unpaidOrder.totalAmountEur),
      2,
    );
  });

  test('F03-T2: renders dedicated Donné summary with gifted jars/weight and strictly 0 € revenue or unpaid impact', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/harvests');

    await createHarvestViaUi(page, {
      label: 'Romarin Dons 2027',
      year: 2027,
      forecastKg: 40,
      realizedKg: 40,
      defaultUnitPrice: 16,
    });

    await navigateViaTab(page, 'dashboard');
    await selectOptionByLabelOrValue(
      visibleByTestId(page, 'dashboard-harvest-select'),
      'Romarin Dons 2027',
    );
    expect(await readKpiNumber(page, 'kpi-paid-eur')).toBe(0);
    expect(await readKpiNumber(page, 'kpi-unpaid-eur')).toBe(0);

    await visibleByTestId(page, 'dashboard-new-sale-cta').click();
    const codes = await discoverFormatCodes(page);
    const gifted = await createSaleViaUi(page, {
      alreadyOnSaleForm: true,
      customerName: 'Association Locale',
      quantities: { [codes[0]]: 3 },
      orderStatus: 'Distribué',
      paymentStatus: 'Donné',
    });

    await navigateViaTab(page, 'dashboard');
    await selectOptionByLabelOrValue(
      visibleByTestId(page, 'dashboard-harvest-select'),
      'Romarin Dons 2027',
    );

    expect(await readKpiNumber(page, 'kpi-paid-eur')).toBe(0);
    expect(await readKpiNumber(page, 'kpi-unpaid-eur')).toBe(0);

    const donatedEl = visibleByTestId(page, 'kpi-donated-summary');
    await expect(donatedEl).toBeVisible();
    const donatedTokens = await readNormalizedTextTokens(donatedEl);
    expect(containsStandaloneInteger(donatedTokens, 3)).toBe(true);

    const parsedDonatedKg = parseWeightKgFromText(donatedTokens);
    expect(parsedDonatedKg).not.toBeNull();
    expect(parsedDonatedKg!).toBeCloseTo(gifted.totalWeightKg, 2);

    const parentText = (await donatedEl.locator('xpath=..').textContent()) ?? '';
    expect(`${donatedTokens} ${parentText}`).toMatch(/0([.,]00?)?\s*€|hors\s*ca|offert|don/i);
  });

  test('F03-T3: surfaces co-seller À reverser alert in kpi-pending-transfers and navigates to pre-filtered orders on tap', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/harvests');

    await createHarvestViaUi(page, {
      label: 'Lavande CoVendeur 2027',
      year: 2027,
      forecastKg: 40,
      realizedKg: 40,
      defaultUnitPrice: 15,
    });

    await navigateViaTab(page, 'dashboard');
    await selectOptionByLabelOrValue(
      visibleByTestId(page, 'dashboard-harvest-select'),
      'Lavande CoVendeur 2027',
    );

    await visibleByTestId(page, 'dashboard-new-sale-cta').click();
    const codes = await discoverFormatCodes(page);
    await createSaleViaUi(page, {
      alreadyOnSaleForm: true,
      customerName: 'Acheteur Direct Apiculteur',
      quantities: { [codes[0]]: 1 },
      orderStatus: 'Distribué',
      paymentStatus: 'Payé',
    });

    await navigateViaTab(page, 'dashboard');
    await selectOptionByLabelOrValue(
      visibleByTestId(page, 'dashboard-harvest-select'),
      'Lavande CoVendeur 2027',
    );

    const transfersBefore = visibleByTestId(page, 'kpi-pending-transfers');
    if (await transfersBefore.isVisible().catch(() => false)) {
      const rawBefore = (await transfersBefore.innerText()).trim();
      const eurBefore = parseEuroFromText(rawBefore);
      if (eurBefore !== null) {
        expect(eurBefore).toBe(0);
      } else if (/\d/.test(rawBefore)) {
        expect(parseFrenchNumberFromText(rawBefore)).toBe(0);
      }
    }

    await switchRole(page, 'contributor');
    await selectOptionByLabelOrValue(
      visibleByTestId(page, 'dashboard-harvest-select'),
      'Lavande CoVendeur 2027',
    );
    await visibleByTestId(page, 'dashboard-new-sale-cta').click();
    const coSellerSale = await createSaleViaUi(page, {
      alreadyOnSaleForm: true,
      customerName: 'Acheteur CoVendeur',
      quantities: { [codes[0]]: 2 },
      orderStatus: 'Distribué',
      paymentStatus: 'Payé',
    });
    expect(coSellerSale.totalAmountEur).toBeGreaterThan(0);

    await navigateViaTab(page, 'dashboard');
    await selectOptionByLabelOrValue(
      visibleByTestId(page, 'dashboard-harvest-select'),
      'Lavande CoVendeur 2027',
    );

    const transfersAfter = visibleByTestId(page, 'kpi-pending-transfers');
    await expect(transfersAfter).toBeVisible();
    const rawTransferText = await transfersAfter.innerText();
    const extractedEur = parseEuroFromText(rawTransferText);
    if (extractedEur !== null) {
      expect(extractedEur).toBeCloseTo(coSellerSale.totalAmountEur, 2);
    } else {
      expect(parseFrenchNumberFromText(rawTransferText)).toBe(1);
    }

    await clickKpiDeepLink(page, 'kpi-pending-transfers');
    const coSellerCard = page
      .getByTestId('order-card')
      .filter({ hasText: 'Acheteur CoVendeur' })
      .first();
    await expect(coSellerCard).toBeVisible();
    await expect(coSellerCard.getByTestId('action-mark-transferred')).toBeVisible();

    await expect(
      page.getByTestId('order-card').filter({ hasText: 'Acheteur Direct Apiculteur' }),
    ).toHaveCount(0);

    const visibleCards = page.locator('[data-testid="order-card"]:visible');
    const cardCount = await visibleCards.count();
    expect(cardCount).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < cardCount; i += 1) {
      await expect(visibleCards.nth(i).getByTestId('action-mark-transferred')).toBeVisible();
    }
  });

  test('F03-T4: counts Réservé orders in kpi-pending-deliveries and navigates to Réservé-filtered orders on tap', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');

    const harvestSelect = visibleByTestId(page, 'dashboard-harvest-select');
    const baselineHarvestValue = await readSelectedOptionValue(harvestSelect);
    const pendingHarvest0 = await readKpiNumber(page, 'kpi-pending-deliveries');

    await harvestSelect.selectOption('ALL');
    const pendingAll0 = await readKpiNumber(page, 'kpi-pending-deliveries');
    await harvestSelect.selectOption(baselineHarvestValue);

    await visibleByTestId(page, 'dashboard-new-sale-cta').click();
    const codes = await discoverFormatCodes(page);
    await createSaleViaUi(page, {
      alreadyOnSaleForm: true,
      customerName: 'Client Remis Immédiat',
      quantities: { [codes[0]]: 1 },
      orderStatus: 'Distribué',
      paymentStatus: 'Payé',
    });

    await navigateViaTab(page, 'dashboard');
    await visibleByTestId(page, 'dashboard-harvest-select').selectOption(baselineHarvestValue);
    expect(await readKpiNumber(page, 'kpi-pending-deliveries')).toBe(pendingHarvest0);

    await visibleByTestId(page, 'dashboard-new-sale-cta').click();
    await createSaleViaUi(page, {
      alreadyOnSaleForm: true,
      customerName: 'Client En Attente Retrait',
      quantities: { [codes[0]]: 1 },
      orderStatus: 'Réservé',
      paymentStatus: 'Non-payé',
    });

    await navigateViaTab(page, 'dashboard');
    await visibleByTestId(page, 'dashboard-harvest-select').selectOption(baselineHarvestValue);
    expect(await readKpiNumber(page, 'kpi-pending-deliveries')).toBe(pendingHarvest0 + 1);

    await clickKpiDeepLink(page, 'kpi-pending-deliveries');
    const reservedCard = page
      .getByTestId('order-card')
      .filter({ hasText: 'Client En Attente Retrait' })
      .first();
    await expect(reservedCard).toBeVisible();
    await expect(reservedCard.getByTestId('action-mark-distributed')).toBeVisible();

    await expect(
      page.getByTestId('order-card').filter({ hasText: 'Client Remis Immédiat' }),
    ).toHaveCount(0);

    const visibleCards = page.locator('[data-testid="order-card"]:visible');
    const totalVisible = await visibleCards.count();
    expect([pendingHarvest0 + 1, pendingAll0 + 1]).toContain(totalVisible);
    for (let i = 0; i < totalVisible; i += 1) {
      await expect(visibleCards.nth(i).getByTestId('action-mark-distributed')).toBeVisible();
    }
  });

  test('F03-T5: opens #/sale/new pre-filled with the selected dashboard harvest when clicking dashboard-new-sale-cta', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/harvests');

    await createHarvestViaUi(page, {
      label: 'Bruyère Automne 2027',
      year: 2027,
      forecastKg: 30,
      defaultUnitPrice: 17,
      isDefault: false,
    });

    await navigateViaTab(page, 'dashboard');
    await selectOptionByLabelOrValue(
      visibleByTestId(page, 'dashboard-harvest-select'),
      'Bruyère Automne 2027',
    );

    await visibleByTestId(page, 'dashboard-new-sale-cta').click();
    await expect(visibleByTestId(page, 'sale-form-page')).toBeVisible();
    expect(new URL(page.url()).hash).toContain('#/sale/new');
    expect(
      await readSelectedOptionText(visibleByTestId(page, 'sale-harvest-select')),
    ).toContain('Bruyère Automne 2027');
  });

  test('F03-T6: scopes revenue, receivables, and pending delivery KPIs strictly to the selected harvest', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/harvests');

    await createHarvestViaUi(page, {
      label: 'Printemps Lot1 2027',
      year: 2027,
      forecastKg: 40,
      realizedKg: 40,
      defaultUnitPrice: 14,
    });
    await createHarvestViaUi(page, {
      label: 'Été Lot2 2027',
      year: 2027,
      forecastKg: 50,
      realizedKg: 50,
      defaultUnitPrice: 16,
    });

    await navigateViaTab(page, 'dashboard');
    await selectOptionByLabelOrValue(
      visibleByTestId(page, 'dashboard-harvest-select'),
      'Printemps Lot1 2027',
    );
    await visibleByTestId(page, 'dashboard-new-sale-cta').click();
    const codes = await discoverFormatCodes(page);
    const saleLot1 = await createSaleViaUi(page, {
      alreadyOnSaleForm: true,
      customerName: 'Acheteur Lot1',
      quantities: { [codes[0]]: 2 },
      orderStatus: 'Distribué',
      paymentStatus: 'Payé',
    });

    await navigateViaTab(page, 'dashboard');
    await selectOptionByLabelOrValue(
      visibleByTestId(page, 'dashboard-harvest-select'),
      'Été Lot2 2027',
    );
    await visibleByTestId(page, 'dashboard-new-sale-cta').click();
    const saleLot2 = await createSaleViaUi(page, {
      alreadyOnSaleForm: true,
      customerName: 'Acheteur Lot2',
      quantities: { [codes[0]]: 1 },
      orderStatus: 'Réservé',
      paymentStatus: 'Non-payé',
    });

    await navigateViaTab(page, 'dashboard');
    await selectOptionByLabelOrValue(
      visibleByTestId(page, 'dashboard-harvest-select'),
      'Printemps Lot1 2027',
    );
    expect(await readKpiNumber(page, 'kpi-paid-eur')).toBeCloseTo(saleLot1.totalAmountEur, 2);
    expect(await readKpiNumber(page, 'kpi-unpaid-eur')).toBe(0);
    expect(await readKpiNumber(page, 'kpi-pending-deliveries')).toBe(0);

    await selectOptionByLabelOrValue(
      visibleByTestId(page, 'dashboard-harvest-select'),
      'Été Lot2 2027',
    );
    expect(await readKpiNumber(page, 'kpi-paid-eur')).toBe(0);
    expect(await readKpiNumber(page, 'kpi-unpaid-eur')).toBeCloseTo(saleLot2.totalAmountEur, 2);
    expect(await readKpiNumber(page, 'kpi-pending-deliveries')).toBe(1);
  });
});
