import { expect, test } from '@playwright/test';
import { bootstrapCleanApp, navigateViaTab, visibleByTestId } from '../helpers/app';
import {
  createHarvestViaUi,
  createSaleViaUi,
  discoverFormatCodes,
  measureFormatUnitWeights,
  readSelectedOptionText,
  readSelectedOptionValue,
  selectOptionByLabelOrValue,
  upsertJarFormatViaUi,
} from '../helpers/forms';
import {
  containsStandaloneInteger,
  isForecastFallbackIndicated,
  readDashboardSnapshot,
  readKpiNumber,
  readNormalizedTextTokens,
  round2,
} from '../helpers/metrics';

test.describe('F-02 — Season Dashboard: Stock & Harvest Gauges', () => {
  test('F02-T1: pre-selects default active harvest on bootstrap and updates default when a new default harvest is saved', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');

    const harvestSelect = visibleByTestId(page, 'dashboard-harvest-select');
    const selectedInitialValue = await readSelectedOptionValue(harvestSelect);
    expect(selectedInitialValue.length).toBeGreaterThan(0);
    expect(selectedInitialValue).not.toBe('ALL');

    const optionValues = await harvestSelect.evaluate((el) =>
      Array.from((el as HTMLSelectElement).options).map((o) => o.value),
    );
    expect(optionValues).toContain('ALL');
    expect(optionValues.filter((v) => v !== 'ALL').length).toBeGreaterThanOrEqual(1);

    const initialSnap = await readDashboardSnapshot(page);
    expect(
      Math.abs(initialSnap.availableKg - (initialSnap.harvestedKg - initialSnap.committedKg)),
    ).toBeLessThan(0.01);

    await createHarvestViaUi(page, {
      label: 'Récolte Défaut 2027',
      year: 2027,
      forecastKg: 85,
      realizedKg: 85,
      defaultUnitPrice: 15,
      isDefault: true,
    });

    await page.goto('/#/dashboard');
    await page.reload();
    await expect(visibleByTestId(page, 'dashboard-page')).toBeVisible();

    const refreshedSelect = visibleByTestId(page, 'dashboard-harvest-select');
    expect(await readSelectedOptionText(refreshedSelect)).toContain('Récolte Défaut 2027');
    expect(await readKpiNumber(page, 'kpi-harvested-kg')).toBe(85);
    expect(await readKpiNumber(page, 'kpi-committed-kg')).toBe(0);
    expect(await readKpiNumber(page, 'kpi-available-kg')).toBe(85);
  });

  test('F02-T2: aggregates harvested, committed, and available weights across all harvests when ALL is selected', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');

    const harvestSelect = visibleByTestId(page, 'dashboard-harvest-select');
    const individualHarvestValues = await harvestSelect.evaluate((el) =>
      Array.from((el as HTMLSelectElement).options)
        .map((o) => o.value)
        .filter((v) => v && v !== 'ALL'),
    );
    expect(individualHarvestValues.length).toBeGreaterThanOrEqual(1);

    let sumHarvested = 0;
    let sumCommitted = 0;
    let sumAvailable = 0;

    for (const val of individualHarvestValues) {
      await harvestSelect.selectOption(val);
      const harvested = await readKpiNumber(page, 'kpi-harvested-kg');
      const committed = await readKpiNumber(page, 'kpi-committed-kg');
      const available = await readKpiNumber(page, 'kpi-available-kg');
      expect(Math.abs(available - (harvested - committed))).toBeLessThan(0.01);

      sumHarvested += harvested;
      sumCommitted += committed;
      sumAvailable += available;
    }

    await harvestSelect.selectOption('ALL');
    expect(await readKpiNumber(page, 'kpi-harvested-kg')).toBeCloseTo(round2(sumHarvested), 2);
    expect(await readKpiNumber(page, 'kpi-committed-kg')).toBeCloseTo(round2(sumCommitted), 2);
    expect(await readKpiNumber(page, 'kpi-available-kg')).toBeCloseTo(round2(sumAvailable), 2);
  });

  test('F02-T3: distinguishes pre-harvest forecast fallback badge from realized harvest weight on dashboard', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/harvests');

    await createHarvestViaUi(page, {
      label: 'Acacia Prévision 2027',
      year: 2027,
      forecastKg: 64,
      realizedKg: null,
      defaultUnitPrice: 15,
    });

    await createHarvestViaUi(page, {
      label: 'Chêne Réalisé 2027',
      year: 2027,
      forecastKg: 64,
      realizedKg: 73,
      defaultUnitPrice: 15,
    });

    await navigateViaTab(page, 'dashboard');
    const harvestSelect = visibleByTestId(page, 'dashboard-harvest-select');

    await selectOptionByLabelOrValue(harvestSelect, 'Acacia Prévision 2027');
    expect(await readKpiNumber(page, 'kpi-harvested-kg')).toBe(64);
    expect(await readKpiNumber(page, 'kpi-available-kg')).toBe(64);
    expect(await isForecastFallbackIndicated(page)).toBe(true);

    await selectOptionByLabelOrValue(harvestSelect, 'Chêne Réalisé 2027');
    expect(await readKpiNumber(page, 'kpi-harvested-kg')).toBe(73);
    expect(await readKpiNumber(page, 'kpi-available-kg')).toBe(73);
    expect(await isForecastFallbackIndicated(page)).toBe(false);
  });

  test('F02-T4: immediately consumes stock on Réservé unpaid order and never double-deducts when marked Distribué', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/harvests');

    await createHarvestViaUi(page, {
      label: 'Châtaignier Règle1 2027',
      year: 2027,
      forecastKg: 50,
      realizedKg: 50,
      defaultUnitPrice: 15,
    });

    await navigateViaTab(page, 'dashboard');
    const harvestSelect = visibleByTestId(page, 'dashboard-harvest-select');
    await selectOptionByLabelOrValue(harvestSelect, 'Châtaignier Règle1 2027');
    expect(await readKpiNumber(page, 'kpi-harvested-kg')).toBe(50);
    expect(await readKpiNumber(page, 'kpi-committed-kg')).toBe(0);
    expect(await readKpiNumber(page, 'kpi-available-kg')).toBe(50);

    await visibleByTestId(page, 'dashboard-new-sale-cta').click();
    await expect(visibleByTestId(page, 'sale-form-page')).toBeVisible();
    const codes = await discoverFormatCodes(page);
    const created = await createSaleViaUi(page, {
      alreadyOnSaleForm: true,
      customerName: 'Claire Réservation',
      quantities: { [codes[0]]: 2 },
      orderStatus: 'Réservé',
      paymentStatus: 'Non-payé',
    });
    expect(created.totalWeightKg).toBeGreaterThan(0);

    await navigateViaTab(page, 'dashboard');
    await selectOptionByLabelOrValue(
      visibleByTestId(page, 'dashboard-harvest-select'),
      'Châtaignier Règle1 2027',
    );
    expect(await readKpiNumber(page, 'kpi-committed-kg')).toBeCloseTo(created.totalWeightKg, 2);
    expect(await readKpiNumber(page, 'kpi-available-kg')).toBeCloseTo(
      round2(50 - created.totalWeightKg),
      2,
    );

    await navigateViaTab(page, 'orders');
    await visibleByTestId(page, 'orders-search-input').fill('Claire Réservation');
    const card = page.getByTestId('order-card').filter({ hasText: 'Claire Réservation' }).first();
    await expect(card).toBeVisible();
    await card.getByTestId('action-mark-distributed').click();
    await expect(visibleByTestId(page, 'toast-success')).toBeVisible();

    await navigateViaTab(page, 'dashboard');
    await selectOptionByLabelOrValue(
      visibleByTestId(page, 'dashboard-harvest-select'),
      'Châtaignier Règle1 2027',
    );
    expect(await readKpiNumber(page, 'kpi-committed-kg')).toBeCloseTo(created.totalWeightKg, 2);
    expect(await readKpiNumber(page, 'kpi-available-kg')).toBeCloseTo(
      round2(50 - created.totalWeightKg),
      2,
    );
  });

  test('F02-T5: counts gifted Donné jars inside committed weight and deducts them from available stock', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');

    const harvestSelect = visibleByTestId(page, 'dashboard-harvest-select');
    const baselineHarvestValue = await readSelectedOptionValue(harvestSelect);
    const before = await readDashboardSnapshot(page);

    await visibleByTestId(page, 'dashboard-new-sale-cta').click();
    await expect(visibleByTestId(page, 'sale-form-page')).toBeVisible();
    const codes = await discoverFormatCodes(page);
    const donated = await createSaleViaUi(page, {
      alreadyOnSaleForm: true,
      customerName: 'Cadeau Mairie',
      quantities: { [codes[0]]: 2 },
      orderStatus: 'Distribué',
      paymentStatus: 'Donné',
    });
    expect(donated.totalWeightKg).toBeGreaterThan(0);

    await navigateViaTab(page, 'dashboard');
    await visibleByTestId(page, 'dashboard-harvest-select').selectOption(baselineHarvestValue);
    const after = await readDashboardSnapshot(page);

    expect(after.harvestedKg).toBeCloseTo(before.harvestedKg, 2);
    expect(after.committedKg).toBeCloseTo(round2(before.committedKg + donated.totalWeightKg), 2);
    expect(after.availableKg).toBeCloseTo(round2(before.availableKg - donated.totalWeightKg), 2);
  });

  test('F02-T6: displays and updates available stock jar-format equivalents on the season dashboard', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');
    await navigateViaTab(page, 'new-sale');

    let unitWeights = await measureFormatUnitWeights(page);
    let subKgCode = Object.keys(unitWeights).find((c) => unitWeights[c] < 1);
    if (!subKgCode) {
      await upsertJarFormatViaUi(page, {
        code: '500g',
        label: 'Pot 500 g',
        weightKg: 0.5,
      });
      await navigateViaTab(page, 'new-sale');
      unitWeights = await measureFormatUnitWeights(page);
      subKgCode = Object.keys(unitWeights).find((c) => unitWeights[c] < 1);
    }
    expect(subKgCode).toBeDefined();

    await createHarvestViaUi(page, {
      label: 'Tilleul Pots 2027',
      year: 2027,
      forecastKg: 37,
      realizedKg: 37,
      defaultUnitPrice: 14,
    });

    await navigateViaTab(page, 'dashboard');
    await selectOptionByLabelOrValue(
      visibleByTestId(page, 'dashboard-harvest-select'),
      'Tilleul Pots 2027',
    );
    expect(await readKpiNumber(page, 'kpi-available-kg')).toBe(37);

    const textBefore = await readNormalizedTextTokens(visibleByTestId(page, 'dashboard-page'));
    for (const [, unitWeightKg] of Object.entries(unitWeights)) {
      const expectedBefore = Math.floor((37 + 1e-9) / unitWeightKg);
      expect(containsStandaloneInteger(textBefore, expectedBefore)).toBe(true);
    }
    const subKgWeight = unitWeights[subKgCode!];
    const expectedSubKgBefore = Math.floor((37 + 1e-9) / subKgWeight);

    const firstCode = Object.keys(unitWeights)[0];
    const firstUnitWeight = unitWeights[firstCode];
    const sellQty = Math.max(1, Math.ceil(2 / firstUnitWeight));

    await visibleByTestId(page, 'dashboard-new-sale-cta').click();
    const sale = await createSaleViaUi(page, {
      alreadyOnSaleForm: true,
      customerName: 'Client Pots',
      quantities: { [firstCode]: sellQty },
      orderStatus: 'Distribué',
      paymentStatus: 'Payé',
    });

    await navigateViaTab(page, 'dashboard');
    await selectOptionByLabelOrValue(
      visibleByTestId(page, 'dashboard-harvest-select'),
      'Tilleul Pots 2027',
    );
    const remainingKg = round2(37 - sale.totalWeightKg);
    expect(await readKpiNumber(page, 'kpi-available-kg')).toBeCloseTo(remainingKg, 2);

    const textAfter = await readNormalizedTextTokens(visibleByTestId(page, 'dashboard-page'));
    for (const [, unitWeightKg] of Object.entries(unitWeights)) {
      const expectedAfter = Math.floor((remainingKg + 1e-9) / unitWeightKg);
      expect(containsStandaloneInteger(textAfter, expectedAfter)).toBe(true);
    }
    expect(containsStandaloneInteger(textAfter, expectedSubKgBefore)).toBe(false);
  });
});
