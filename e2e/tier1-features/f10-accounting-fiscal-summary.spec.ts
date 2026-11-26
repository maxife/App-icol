import { expect, test } from '@playwright/test';
import {
  bootstrapCleanApp,
  navigateViaTab,
  setBooleanControlState,
  visibleByTestId,
} from '../helpers/app';
import {
  createAccountingEntryViaUi,
  createSaleViaUi,
  deleteAccountingEntryViaUi,
  discoverFormatCodes,
  editAccountingEntryViaUi,
  readSelectedOptionValue,
  selectOptionByLabelOrValue,
} from '../helpers/forms';
import { readKpiNumber, round2 } from '../helpers/metrics';

test.describe('F-10 — Apiary Accounting & Fiscal Year Summary', () => {
  test('F10-T1: displays annual revenues, expenses, and net balance obeying net = revenues - expenses', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');
    await navigateViaTab(page, 'accounting');
    await expect(visibleByTestId(page, 'accounting-page')).toBeVisible();

    const yearSelect = visibleByTestId(page, 'accounting-year-select');
    await expect(yearSelect).toBeVisible();
    const selectedYear = await readSelectedOptionValue(yearSelect);
    expect(selectedYear).toMatch(/\b20\d{2}\b/);

    const rev = await readKpiNumber(page, 'accounting-total-revenues');
    const exp = await readKpiNumber(page, 'accounting-total-expenses');
    const net = await readKpiNumber(page, 'accounting-net-balance');

    expect(rev).toBeGreaterThanOrEqual(0);
    expect(exp).toBeGreaterThanOrEqual(0);
    expect(net).toBeCloseTo(round2(rev - exp), 2);
  });

  test('F10-T2: scopes annual accounting summary strictly to the selected fiscal year in accounting-year-select', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/accounting');

    const yearSelect = visibleByTestId(page, 'accounting-year-select');
    const initialOptions = await yearSelect.evaluate((el) =>
      Array.from((el as HTMLSelectElement).options)
        .map((o) => o.value)
        .filter((v) => /^\d{4}$/.test(v)),
    );

    let yearA = '2029';
    let yearB = '2030';
    if (initialOptions.length >= 2) {
      [yearA, yearB] = initialOptions.slice(0, 2);
    }

    let revA0 = 0;
    let expA0 = 0;
    if (initialOptions.includes(yearA)) {
      await yearSelect.selectOption(yearA);
      revA0 = await readKpiNumber(page, 'accounting-total-revenues');
      expA0 = await readKpiNumber(page, 'accounting-total-expenses');
    }

    let revB0 = 0;
    let expB0 = 0;
    if (initialOptions.includes(yearB)) {
      await yearSelect.selectOption(yearB);
      revB0 = await readKpiNumber(page, 'accounting-total-revenues');
      expB0 = await readKpiNumber(page, 'accounting-total-expenses');
    }

    await createAccountingEntryViaUi(page, {
      type: 'Recette',
      category: "Ventes d'essaims",
      label: `Essaims ${yearA}`,
      amount: '240,00',
      date: `${yearA}-05-10`,
    });

    await createAccountingEntryViaUi(page, {
      type: 'Dépense',
      category: 'Charges et cotisations',
      label: `Cotisation GDS ${yearB}`,
      amount: '65,50',
      date: `${yearB}-03-15`,
    });

    await selectOptionByLabelOrValue(yearSelect, yearA);
    expect(await readKpiNumber(page, 'accounting-total-revenues')).toBeCloseTo(
      round2(revA0 + 240),
      2,
    );
    expect(await readKpiNumber(page, 'accounting-total-expenses')).toBeCloseTo(expA0, 2);
    expect(await readKpiNumber(page, 'accounting-net-balance')).toBeCloseTo(
      round2(revA0 + 240 - expA0),
      2,
    );

    await selectOptionByLabelOrValue(yearSelect, yearB);
    expect(await readKpiNumber(page, 'accounting-total-revenues')).toBeCloseTo(revB0, 2);
    expect(await readKpiNumber(page, 'accounting-total-expenses')).toBeCloseTo(
      round2(expB0 + 65.5),
      2,
    );
    expect(await readKpiNumber(page, 'accounting-net-balance')).toBeCloseTo(
      round2(revB0 - (expB0 + 65.5)),
      2,
    );
  });

  test('F10-T3: toggles accounting-include-sales-toggle idempotently to include or exclude paid Ventes Miel revenue while excluding Non-payé and Donné', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/accounting');

    const yearSelect = visibleByTestId(page, 'accounting-year-select');
    const selectedRaw = await readSelectedOptionValue(yearSelect);
    const yearMatch = /\b(20\d{2})\b/.exec(selectedRaw);
    const targetYear = yearMatch ? yearMatch[1] : '2026';

    const includeSalesToggle = page.getByTestId('accounting-include-sales-toggle').first();
    await expect(includeSalesToggle).toBeAttached();

    await setBooleanControlState(includeSalesToggle, false);
    const revManualOnly0 = await readKpiNumber(page, 'accounting-total-revenues');

    await setBooleanControlState(includeSalesToggle, true);
    const revWithSales0 = await readKpiNumber(page, 'accounting-total-revenues');
    expect(revWithSales0).toBeGreaterThanOrEqual(revManualOnly0);

    await navigateViaTab(page, 'new-sale');
    const codes = await discoverFormatCodes(page);
    const fmt0 = codes[0];

    const paidSale = await createSaleViaUi(page, {
      alreadyOnSaleForm: true,
      date: `${targetYear}-07-14`,
      customerName: 'Client Compta Payé',
      quantities: { [fmt0]: 2 },
      orderStatus: 'Distribué',
      paymentStatus: 'Payé',
    });
    expect(paidSale.totalAmountEur).toBeGreaterThan(0);

    await createSaleViaUi(page, {
      date: `${targetYear}-07-14`,
      customerName: 'Client Compta Impayé',
      quantities: { [fmt0]: 2 },
      orderStatus: 'Réservé',
      paymentStatus: 'Non-payé',
    });

    await createSaleViaUi(page, {
      date: `${targetYear}-07-14`,
      customerName: 'Client Compta Donné',
      quantities: { [fmt0]: 2 },
      orderStatus: 'Distribué',
      paymentStatus: 'Donné',
    });

    await navigateViaTab(page, 'accounting');
    await selectOptionByLabelOrValue(
      visibleByTestId(page, 'accounting-year-select'),
      targetYear,
    );

    const toggleAfter = page.getByTestId('accounting-include-sales-toggle').first();
    await setBooleanControlState(toggleAfter, true);
    const revIncluded = await readKpiNumber(page, 'accounting-total-revenues');
    const expIncluded = await readKpiNumber(page, 'accounting-total-expenses');
    const netIncluded = await readKpiNumber(page, 'accounting-net-balance');
    expect(revIncluded).toBeCloseTo(round2(revWithSales0 + paidSale.totalAmountEur), 2);
    expect(netIncluded).toBeCloseTo(round2(revIncluded - expIncluded), 2);

    await setBooleanControlState(toggleAfter, false);
    const revExcluded = await readKpiNumber(page, 'accounting-total-revenues');
    const expExcluded = await readKpiNumber(page, 'accounting-total-expenses');
    const netExcluded = await readKpiNumber(page, 'accounting-net-balance');
    expect(revExcluded).toBeCloseTo(revManualOnly0, 2);
    expect(netExcluded).toBeCloseTo(round2(revExcluded - expExcluded), 2);
  });

  test('F10-T4: records manual Recette and Dépense entries across closed categories and updates annual totals and category breakdown', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/accounting');

    const yearSelect = visibleByTestId(page, 'accounting-year-select');
    const selectedRaw = await readSelectedOptionValue(yearSelect);
    const yearMatch = /\b(20\d{2})\b/.exec(selectedRaw);
    const year = yearMatch ? yearMatch[1] : '2026';

    const rev0 = await readKpiNumber(page, 'accounting-total-revenues');
    const exp0 = await readKpiNumber(page, 'accounting-total-expenses');
    const net0 = await readKpiNumber(page, 'accounting-net-balance');

    await createAccountingEntryViaUi(page, {
      type: 'Recette',
      category: "Ventes d'essaims",
      label: 'Vente 2 essaims Buckfast',
      amount: '180,00',
      date: `${year}-05-20`,
    });

    await createAccountingEntryViaUi(page, {
      type: 'Dépense',
      category: 'Consommables (sirop, sucre, traitements)',
      label: 'Sirop nourrissement automne',
      amount: '74,50',
      date: `${year}-09-05`,
    });

    expect(await readKpiNumber(page, 'accounting-total-revenues')).toBeCloseTo(
      round2(rev0 + 180),
      2,
    );
    expect(await readKpiNumber(page, 'accounting-total-expenses')).toBeCloseTo(
      round2(exp0 + 74.5),
      2,
    );
    expect(await readKpiNumber(page, 'accounting-net-balance')).toBeCloseTo(
      round2(net0 + 180 - 74.5),
      2,
    );

    const accountingPage = visibleByTestId(page, 'accounting-page');
    await expect(accountingPage).toContainText("Ventes d'essaims");
    await expect(accountingPage).toContainText('Consommables (sirop, sucre, traitements)');
  });

  test('F10-T5: filters accounting entries via accounting-category-filter and supports editing and deleting a manual entry', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/accounting');

    const yearSelect = visibleByTestId(page, 'accounting-year-select');
    const selectedRaw = await readSelectedOptionValue(yearSelect);
    const yearMatch = /\b(20\d{2})\b/.exec(selectedRaw);
    const year = yearMatch ? yearMatch[1] : '2026';

    const exp0 = await readKpiNumber(page, 'accounting-total-expenses');
    const net0 = await readKpiNumber(page, 'accounting-net-balance');

    await createAccountingEntryViaUi(page, {
      type: 'Dépense',
      category: 'Conditionnement (pots, étiquettes)',
      label: 'Cartons Pots Verre UniqueF10',
      amount: '50,00',
      date: `${year}-04-12`,
    });
    await createAccountingEntryViaUi(page, {
      type: 'Dépense',
      category: 'Investissements matériel / reines',
      label: 'Extracteur Radiaire UniqueF10',
      amount: '120,00',
      date: `${year}-04-18`,
    });

    expect(await readKpiNumber(page, 'accounting-total-expenses')).toBeCloseTo(
      round2(exp0 + 170),
      2,
    );

    const categoryFilter = visibleByTestId(page, 'accounting-category-filter');
    await selectOptionByLabelOrValue(categoryFilter, 'Conditionnement (pots, étiquettes)');
    const accountingPage = visibleByTestId(page, 'accounting-page');
    await expect(accountingPage).toContainText('Cartons Pots Verre UniqueF10');
    await expect(accountingPage).not.toContainText('Extracteur Radiaire UniqueF10');

    await categoryFilter.selectOption({ index: 0 });
    await expect(accountingPage).toContainText('Cartons Pots Verre UniqueF10');
    await expect(accountingPage).toContainText('Extracteur Radiaire UniqueF10');

    await editAccountingEntryViaUi(page, 'Cartons Pots Verre UniqueF10', {
      label: 'Cartons Pots Verre ModifiéF10',
      amount: '80,00',
    });
    await expect(accountingPage).toContainText('Cartons Pots Verre ModifiéF10');
    expect(await readKpiNumber(page, 'accounting-total-expenses')).toBeCloseTo(
      round2(exp0 + 200),
      2,
    );

    await deleteAccountingEntryViaUi(page, 'Cartons Pots Verre ModifiéF10');
    expect(await readKpiNumber(page, 'accounting-total-expenses')).toBeCloseTo(
      round2(exp0 + 120),
      2,
    );
    expect(await readKpiNumber(page, 'accounting-net-balance')).toBeCloseTo(
      round2(net0 - 120),
      2,
    );
  });
});
