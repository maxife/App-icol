import { expect, test } from '@playwright/test';
import { CANONICAL_JAR_FORMAT_VECTORS } from '../fixtures/testData';
import {
  assertTestIdHidden,
  bootstrapCleanApp,
  navigateViaTab,
  readBooleanControlState,
  setBooleanControlState,
  visibleByTestId,
} from '../helpers/app';
import {
  createHarvestViaUi,
  createSaleViaUi,
  discoverFormatCodes,
  openHarvestForEditViaUi,
  readSelectedOptionText,
  selectOptionByLabelOrValue,
  setStepperQty,
  upsertJarFormatViaUi,
} from '../helpers/forms';
import { isForecastFallbackIndicated, readKpiNumber, round2 } from '../helpers/metrics';

test.describe('F-09 — Harvest Tracking, PUan Tariffs & ParArticles Formats', () => {
  test('F09-T1: manager creates a new harvest with forecast weight and per-format PUan unit prices', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/harvests');
    await expect(visibleByTestId(page, 'harvests-page')).toBeVisible();

    await createHarvestViaUi(page, {
      label: 'Sapin Vosges 2027',
      year: 2027,
      forecastKg: 120,
      realizedKg: null,
      defaultUnitPrice: '16,50',
    });

    await expect(visibleByTestId(page, 'harvests-page')).toContainText('Sapin Vosges 2027');

    await navigateViaTab(page, 'dashboard');
    await selectOptionByLabelOrValue(
      visibleByTestId(page, 'dashboard-harvest-select'),
      'Sapin Vosges 2027',
    );
    expect(await readKpiNumber(page, 'kpi-harvested-kg')).toBe(120);
    expect(await isForecastFallbackIndicated(page)).toBe(true);
  });

  test('F09-T2: setting harvest-default-checkbox makes the harvest the pre-selected default active harvest on #/dashboard', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');
    const initialDefault = await readSelectedOptionText(
      visibleByTestId(page, 'dashboard-harvest-select'),
    );

    await createHarvestViaUi(page, {
      label: 'Tilleul Actif 2028',
      year: 2028,
      forecastKg: 95,
      realizedKg: 92,
      defaultUnitPrice: 15,
      isDefault: true,
    });

    await page.goto('/#/dashboard');
    await page.reload();
    await expect(visibleByTestId(page, 'dashboard-page')).toBeVisible();

    const updatedDefault = await readSelectedOptionText(
      visibleByTestId(page, 'dashboard-harvest-select'),
    );
    expect(updatedDefault).not.toBe(initialDefault);
    expect(updatedDefault).toContain('Tilleul Actif 2028');
    expect(await readKpiNumber(page, 'kpi-harvested-kg')).toBe(92);
  });

  test('F09-T3: updating harvest-realized-input transitions harvest from forecast fallback to realized weight and updates available stock', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/harvests');

    await createHarvestViaUi(page, {
      label: 'Fleurs Été Extraction 2027',
      year: 2027,
      forecastKg: 80,
      realizedKg: null,
      defaultUnitPrice: 14,
    });

    await navigateViaTab(page, 'dashboard');
    await selectOptionByLabelOrValue(
      visibleByTestId(page, 'dashboard-harvest-select'),
      'Fleurs Été Extraction 2027',
    );
    await visibleByTestId(page, 'dashboard-new-sale-cta').click();
    const codes = await discoverFormatCodes(page);
    const sale = await createSaleViaUi(page, {
      alreadyOnSaleForm: true,
      customerName: 'Acheteur Avant Extraction',
      quantities: { [codes[0]]: 2 },
    });

    await navigateViaTab(page, 'dashboard');
    await selectOptionByLabelOrValue(
      visibleByTestId(page, 'dashboard-harvest-select'),
      'Fleurs Été Extraction 2027',
    );
    expect(await readKpiNumber(page, 'kpi-harvested-kg')).toBe(80);
    expect(await isForecastFallbackIndicated(page)).toBe(true);
    expect(await readKpiNumber(page, 'kpi-available-kg')).toBeCloseTo(
      round2(80 - sale.totalWeightKg),
      2,
    );

    await openHarvestForEditViaUi(page, 'Fleurs Été Extraction 2027');
    await visibleByTestId(page, 'harvest-realized-input').fill('105');
    await visibleByTestId(page, 'harvest-save-btn').click();
    await expect(visibleByTestId(page, 'toast-success')).toBeVisible();
    await expect(visibleByTestId(page, 'harvests-page')).toContainText('105');

    await navigateViaTab(page, 'dashboard');
    await selectOptionByLabelOrValue(
      visibleByTestId(page, 'dashboard-harvest-select'),
      'Fleurs Été Extraction 2027',
    );
    expect(await readKpiNumber(page, 'kpi-harvested-kg')).toBe(105);
    expect(await isForecastFallbackIndicated(page)).toBe(false);
    expect(await readKpiNumber(page, 'kpi-available-kg')).toBeCloseTo(
      round2(105 - sale.totalWeightKg),
      2,
    );
  });

  test('F09-T4: editing per-format PUan tariff on #/harvests updates live unit price calculation for new sales on #/sale/new', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');
    await navigateViaTab(page, 'new-sale');
    const codes = await discoverFormatCodes(page);
    const targetFormatCode = codes[0];

    await createHarvestViaUi(page, {
      label: 'Acacia Tarif 2027',
      year: 2027,
      forecastKg: 60,
      unitPrices: { [targetFormatCode]: '14,00' },
      defaultUnitPrice: '8,00',
    });

    await navigateViaTab(page, 'new-sale');
    await selectOptionByLabelOrValue(
      visibleByTestId(page, 'sale-harvest-select'),
      'Acacia Tarif 2027',
    );
    await setStepperQty(page, targetFormatCode, 2);
    expect(await readKpiNumber(page, 'sale-total-amount')).toBeCloseTo(28, 2);

    await openHarvestForEditViaUi(page, 'Acacia Tarif 2027');
    await visibleByTestId(page, `harvest-price-input-${targetFormatCode}`).fill('17,50');
    await visibleByTestId(page, 'harvest-save-btn').click();
    await expect(visibleByTestId(page, 'toast-success')).toBeVisible();

    await navigateViaTab(page, 'new-sale');
    await selectOptionByLabelOrValue(
      visibleByTestId(page, 'sale-harvest-select'),
      'Acacia Tarif 2027',
    );
    await setStepperQty(page, targetFormatCode, 2);
    expect(await readKpiNumber(page, 'sale-total-amount')).toBeCloseTo(35, 2);
  });

  test('F09-T5: creates a new jar format in ParArticles and toggles format-toggle-${code} to control active steppers on #/sale/new', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/harvests');

    await upsertJarFormatViaUi(page, {
      code: CANONICAL_JAR_FORMAT_VECTORS.tasting125g.code,
      label: CANONICAL_JAR_FORMAT_VECTORS.tasting125g.label,
      weightKg: '0,125',
    });

    const formatToggle125g = page.getByTestId('format-toggle-125g').first();
    await expect(formatToggle125g).toBeAttached();
    expect(await readBooleanControlState(formatToggle125g)).toBe(true);

    await createHarvestViaUi(page, {
      label: 'Coffret Découverte 2027',
      year: 2027,
      forecastKg: 25,
      unitPrices: { '125g': '4,50' },
      defaultUnitPrice: 12,
    });

    await navigateViaTab(page, 'new-sale');
    await selectOptionByLabelOrValue(
      visibleByTestId(page, 'sale-harvest-select'),
      'Coffret Découverte 2027',
    );
    await expect(visibleByTestId(page, 'stepper-inc-125g')).toBeVisible();
    await setStepperQty(page, '125g', 2);
    expect(await readKpiNumber(page, 'sale-total-weight')).toBeCloseTo(0.25, 3);
    expect(await readKpiNumber(page, 'sale-total-amount')).toBeCloseTo(9, 2);
    await setStepperQty(page, '125g', 0);

    await navigateViaTab(page, 'harvests');
    const toggleOnPage = page.getByTestId('format-toggle-125g').first();
    await setBooleanControlState(toggleOnPage, false);

    await navigateViaTab(page, 'new-sale');
    await assertTestIdHidden(page, 'stepper-inc-125g');
  });
});
