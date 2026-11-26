import { expect, type Dialog, type Locator, type Page } from '@playwright/test';
import {
  clickOrCheckToggle,
  navigateViaTab,
  readToggleState,
  setToggleState,
  visibleByTestId,
} from './app';
import { readKpiNumber, round3 } from './metrics';

function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export async function selectOptionByLabelOrValue(
  selectLocator: Locator,
  target: string,
): Promise<string> {
  const select = selectLocator.first();
  await expect(select).toBeVisible();

  const normalizedTarget = collapseSpaces(target);
  const lowerTarget = normalizedTarget.toLowerCase();

  const options = await select.evaluate((el) => {
    const sel = el as HTMLSelectElement;
    return Array.from(sel.options).map((opt) => ({
      value: opt.value,
      text: (opt.textContent ?? '').replace(/\s+/g, ' ').trim(),
    }));
  });

  const match =
    options.find((o) => o.value === target) ??
    options.find((o) => o.text === normalizedTarget) ??
    options.find((o) => o.text.toLowerCase() === lowerTarget) ??
    options.find((o) => o.text.includes(normalizedTarget)) ??
    options.find((o) => o.text.toLowerCase().includes(lowerTarget));

  if (!match) {
    const available = options.map((o) => `${o.value} ("${o.text}")`).join(', ');
    throw new Error(
      `Option "${target}" not found in <select>. Available options: [${available}]`,
    );
  }

  await select.selectOption(match.value);
  return match.value;
}

export async function readSelectedOptionText(selectLocator: Locator): Promise<string> {
  const select = selectLocator.first();
  await expect(select).toBeVisible();
  return select.evaluate((el) => {
    const sel = el as HTMLSelectElement;
    return (sel.selectedOptions[0]?.textContent ?? '').replace(/\s+/g, ' ').trim();
  });
}

export async function readSelectedOptionValue(selectLocator: Locator): Promise<string> {
  const select = selectLocator.first();
  await expect(select).toBeVisible();
  return select.evaluate((el) => (el as HTMLSelectElement).value);
}

export async function discoverFormatCodes(page: Page): Promise<string[]> {
  if (!(await visibleByTestId(page, 'sale-form-page').isVisible().catch(() => false))) {
    await navigateViaTab(page, 'new-sale');
  }
  const steppers = page.locator('[data-testid^="stepper-inc-"]:visible');
  await expect(steppers.first()).toBeVisible();

  const count = await steppers.count();
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const testId = await steppers.nth(i).getAttribute('data-testid');
    if (testId && testId.startsWith('stepper-inc-') && !codes.includes(testId.slice(12))) {
      codes.push(testId.slice('stepper-inc-'.length));
    }
  }
  return codes;
}

export async function readStepperQty(page: Page, formatCode: string): Promise<number> {
  const qtyEl = visibleByTestId(page, `stepper-qty-${formatCode}`);
  await expect(qtyEl).toBeVisible();
  const raw = await qtyEl.evaluate((el) =>
    el instanceof HTMLInputElement ? el.value : (el.textContent ?? ''),
  );
  const parsed = Number.parseInt(raw.trim(), 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Unable to parse integer stepper quantity for "${formatCode}" from "${raw}"`);
  }
  return parsed;
}

export async function setStepperQty(
  page: Page,
  formatCode: string,
  targetQty: number,
): Promise<void> {
  if (!Number.isInteger(targetQty) || targetQty < 0) {
    throw new Error(`setStepperQty requires non-negative integer, got ${targetQty}`);
  }
  const current = await readStepperQty(page, formatCode);
  if (current < targetQty) {
    const incBtn = visibleByTestId(page, `stepper-inc-${formatCode}`);
    for (let i = current; i < targetQty; i += 1) {
      await incBtn.click();
    }
  } else if (current > targetQty) {
    const decBtn = visibleByTestId(page, `stepper-dec-${formatCode}`);
    for (let i = current; i > targetQty; i -= 1) {
      await decBtn.click();
    }
  }
  await expect.poll(() => readStepperQty(page, formatCode)).toBe(targetQty);
}

export async function measureFormatUnitWeights(page: Page): Promise<Record<string, number>> {
  const codes = await discoverFormatCodes(page);
  const weights: Record<string, number> = {};
  const baseWeight = await readKpiNumber(page, 'sale-total-weight');

  for (const code of codes) {
    const beforeQty = await readStepperQty(page, code);
    await visibleByTestId(page, `stepper-inc-${code}`).click();
    await expect.poll(() => readStepperQty(page, code)).toBe(beforeQty + 1);
    const incrementedWeight = await readKpiNumber(page, 'sale-total-weight');
    weights[code] = round3(incrementedWeight - baseWeight);

    await visibleByTestId(page, `stepper-dec-${code}`).click();
    await expect.poll(() => readStepperQty(page, code)).toBe(beforeQty);
  }
  return weights;
}

export async function setSegmentedControlOrButton(
  page: Page,
  testId: string,
): Promise<void> {
  const visibleMatch = page.locator(`[data-testid="${testId}"]:visible`).first();
  if ((await page.locator(`[data-testid="${testId}"]:visible`).count()) > 0) {
    const isRadio = await visibleMatch.evaluate(
      (el) => el instanceof HTMLInputElement && el.type === 'radio',
    );
    if (isRadio) {
      await visibleMatch.check({ force: true });
      return;
    }
    await visibleMatch.click();
    return;
  }

  const attached = page.getByTestId(testId).first();
  await expect(attached).toBeAttached();

  const radioMeta = await attached.evaluate((el) => {
    if (el instanceof HTMLInputElement && el.type === 'radio') {
      const hasLabel = Boolean(el.labels && el.labels.length > 0) || Boolean(el.closest('label'));
      return { isRadio: true, hasLabel };
    }
    return { isRadio: false, hasLabel: false };
  });

  if (radioMeta.isRadio) {
    if (radioMeta.hasLabel) {
      await attached.evaluate((el) => {
        const input = el as HTMLInputElement;
        const label = input.labels?.[0] ?? input.closest('label');
        label?.click();
      });
    } else {
      await attached.check({ force: true });
    }
    return;
  }

  await attached.click({ force: true });
}

export const clickSegmentedOption = setSegmentedControlOrButton;

export async function enableManualPriceOverride(
  page: Page,
  rawPrice: string,
): Promise<void> {
  const manualInput = page.getByTestId('sale-manual-price-input').first();
  const toggle = page.getByTestId('sale-manual-price-toggle').first();

  const isInputReady = async (): Promise<boolean> => {
    const visible = await manualInput.isVisible().catch(() => false);
    if (!visible) return false;
    return manualInput.isEnabled().catch(() => false);
  };

  if (!(await isInputReady())) {
    await expect(toggle).toBeAttached();
    const toggleState = await readToggleState(toggle);
    if (toggleState !== true) {
      const isDetails = await toggle.evaluate(
        (el) => el.tagName === 'DETAILS' || el.closest('details') !== null,
      );
      if (isDetails) {
        await toggle.evaluate((el) => {
          const det =
            el.tagName === 'DETAILS'
              ? (el as HTMLDetailsElement)
              : el.closest('details');
          if (det) det.open = true;
        });
      }
      if (!(await isInputReady())) {
        await clickOrCheckToggle(toggle, true);
      }
    }
  }

  await expect(manualInput).toBeVisible();
  await expect(manualInput).toBeEnabled();
  await manualInput.fill(rawPrice);
  await manualInput.blur();
}

export async function verifyRelaySuggestionAvailable(
  page: Page,
  expectedRelay: string,
): Promise<void> {
  const relayInput = visibleByTestId(page, 'customer-relay-input');
  await expect(relayInput).toBeVisible();

  const datalistOptions = await relayInput.evaluate((el) => {
    const input = el as HTMLInputElement;
    const listId = input.getAttribute('list');
    if (!listId) return null;
    const listEl = document.getElementById(listId);
    if (!listEl) return null;
    return Array.from(listEl.querySelectorAll('option')).map(
      (opt) => (opt.value || opt.textContent || '').trim(),
    );
  });

  if (datalistOptions && datalistOptions.length > 0) {
    expect(datalistOptions).toContain(expectedRelay);
    return;
  }

  await relayInput.click();
  const prefix = expectedRelay.slice(0, 4);
  await relayInput.fill(prefix);
  await expect(visibleByTestId(page, 'sale-form-page')).toContainText(expectedRelay);
  await relayInput.fill('');
  await relayInput.press('Escape').catch(() => {});
}

export interface CreateSaleUiOptions {
  alreadyOnSaleForm?: boolean;
  date?: string;
  customerName: string;
  phone?: string;
  relay?: string;
  harvestLabel?: string;
  quantities?: Record<string, number>;
  manualPriceInput?: string;
  orderStatus?: 'Réservé' | 'Distribué';
  paymentStatus?: 'Non-payé' | 'Payé' | 'Donné';
  thirdParty?: {
    enabled: boolean;
    collectorName?: string;
    transferStatus?: 'À reverser' | 'Reversé';
  };
  notes?: string;
  expectSuccessToast?: boolean;
}

export interface CreatedSaleSummary {
  totalWeightKg: number;
  totalAmountEur: number;
}

export async function createSaleViaUi(
  page: Page,
  opts: CreateSaleUiOptions,
): Promise<CreatedSaleSummary> {
  if (
    !opts.alreadyOnSaleForm ||
    !(await visibleByTestId(page, 'sale-form-page').isVisible().catch(() => false))
  ) {
    await navigateViaTab(page, 'new-sale');
  }
  await expect(visibleByTestId(page, 'sale-form-page')).toBeVisible();

  if (opts.date !== undefined) {
    await visibleByTestId(page, 'sale-date-input').fill(opts.date);
  }

  if (opts.harvestLabel !== undefined) {
    await selectOptionByLabelOrValue(
      visibleByTestId(page, 'sale-harvest-select'),
      opts.harvestLabel,
    );
  }

  const nameInput = visibleByTestId(page, 'customer-name-input');
  await nameInput.fill(opts.customerName);
  if (await visibleByTestId(page, 'customer-autocomplete-list').isVisible().catch(() => false)) {
    await nameInput.press('Escape').catch(() => {});
  }

  if (opts.phone !== undefined) {
    await visibleByTestId(page, 'customer-phone-input').fill(opts.phone);
  }

  if (opts.relay !== undefined) {
    const relayInput = visibleByTestId(page, 'customer-relay-input');
    await relayInput.fill(opts.relay);
    await relayInput.press('Escape').catch(() => {});
  }

  if (opts.quantities) {
    for (const [formatCode, qty] of Object.entries(opts.quantities)) {
      await setStepperQty(page, formatCode, qty);
    }
  } else {
    const codes = await discoverFormatCodes(page);
    if (codes.length === 0) {
      throw new Error('No active jar format steppers discovered on sale-form-page');
    }
    await setStepperQty(page, codes[0], 1);
  }

  if (opts.orderStatus !== undefined) {
    await setSegmentedControlOrButton(page, `order-status-${opts.orderStatus}`);
  }

  if (opts.paymentStatus !== undefined) {
    await setSegmentedControlOrButton(page, `payment-status-${opts.paymentStatus}`);
  }

  if (opts.manualPriceInput !== undefined) {
    await enableManualPriceOverride(page, opts.manualPriceInput);
  }

  if (opts.thirdParty !== undefined) {
    const thirdPartyToggle = page.getByTestId('third-party-toggle').first();
    await expect(thirdPartyToggle).toBeAttached();
    await setToggleState(thirdPartyToggle, opts.thirdParty.enabled);

    if (opts.thirdParty.enabled) {
      if (opts.thirdParty.collectorName !== undefined) {
        const collectorInput = visibleByTestId(page, 'collector-name-input');
        await expect(collectorInput).toBeVisible();
        await collectorInput.fill(opts.thirdParty.collectorName);
      }
      if (opts.thirdParty.transferStatus !== undefined) {
        await setSegmentedControlOrButton(
          page,
          `transfer-status-${opts.thirdParty.transferStatus}`,
        );
      }
    }
  }

  if (opts.notes !== undefined) {
    await visibleByTestId(page, 'sale-notes-input').fill(opts.notes);
  }

  const totalWeightKg = await readKpiNumber(page, 'sale-total-weight');
  const totalAmountEur = await readKpiNumber(page, 'sale-total-amount');

  await visibleByTestId(page, 'sale-submit-btn').click();

  if (opts.expectSuccessToast !== false) {
    await expect(visibleByTestId(page, 'toast-success')).toBeVisible();
  }

  return { totalWeightKg, totalAmountEur };
}

export interface CreateHarvestUiOptions {
  label: string;
  year: number | string;
  forecastKg: number | string;
  realizedKg?: number | string | null;
  unitPrices?: Record<string, number | string>;
  defaultUnitPrice?: number | string;
  isDefault?: boolean;
  expectSuccessToast?: boolean;
}

export async function createHarvestViaUi(
  page: Page,
  opts: CreateHarvestUiOptions,
): Promise<void> {
  if (!(await visibleByTestId(page, 'harvests-page').isVisible().catch(() => false))) {
    await navigateViaTab(page, 'harvests');
  }
  await expect(visibleByTestId(page, 'harvests-page')).toBeVisible();

  const createBtn = visibleByTestId(page, 'harvest-create-btn');
  if (await createBtn.isVisible().catch(() => false)) {
    await createBtn.click();
  }

  const labelInput = visibleByTestId(page, 'harvest-label-input');
  await expect(labelInput).toBeVisible();
  await labelInput.fill(opts.label);
  await visibleByTestId(page, 'harvest-year-input').fill(String(opts.year));
  await visibleByTestId(page, 'harvest-forecast-input').fill(String(opts.forecastKg));

  const realizedInput = visibleByTestId(page, 'harvest-realized-input');
  if (opts.realizedKg === null || opts.realizedKg === undefined || opts.realizedKg === '') {
    await realizedInput.fill('');
  } else {
    await realizedInput.fill(String(opts.realizedKg));
  }

  const priceInputs = page.locator('[data-testid^="harvest-price-input-"]:visible');
  const priceCount = await priceInputs.count();
  const fallbackPrice = opts.defaultUnitPrice ?? 15;
  for (let i = 0; i < priceCount; i += 1) {
    const input = priceInputs.nth(i);
    const testId = (await input.getAttribute('data-testid')) ?? '';
    const code = testId.slice('harvest-price-input-'.length);
    const priceValue = opts.unitPrices?.[code] ?? fallbackPrice;
    await input.fill(String(priceValue));
  }

  if (opts.isDefault !== undefined) {
    const defaultCheckbox = page.getByTestId('harvest-default-checkbox').first();
    await expect(defaultCheckbox).toBeAttached();
    await setToggleState(defaultCheckbox, opts.isDefault);
  }

  await visibleByTestId(page, 'harvest-save-btn').click();

  if (opts.expectSuccessToast !== false) {
    await expect(visibleByTestId(page, 'toast-success')).toBeVisible();
  }
}

export async function openHarvestForEditViaUi(
  page: Page,
  harvestLabel: string,
): Promise<void> {
  if (!(await visibleByTestId(page, 'harvests-page').isVisible().catch(() => false))) {
    await navigateViaTab(page, 'harvests');
  }
  const harvestsPage = visibleByTestId(page, 'harvests-page');
  await expect(harvestsPage).toContainText(harvestLabel);

  const scopedContainers = harvestsPage
    .locator('article, section, tr, li, div')
    .filter({ hasText: harvestLabel });

  const inlineRealized = scopedContainers
    .locator('[data-testid="harvest-realized-input"]:visible')
    .first();
  if ((await scopedContainers.locator('[data-testid="harvest-realized-input"]:visible').count()) > 0) {
    await expect(inlineRealized).toBeVisible();
    return;
  }

  const totalMatches = await scopedContainers.count();
  for (let i = totalMatches - 1; i >= 0; i -= 1) {
    const container = scopedContainers.nth(i);
    const editBtn = container
      .getByRole('button', { name: /modifier|éditer|editer|edit|tarif|mettre à jour/i })
      .first();
    if (await editBtn.isVisible().catch(() => false)) {
      await editBtn.click();
      break;
    }
  }

  await expect(visibleByTestId(page, 'harvest-realized-input')).toBeVisible();
}

export async function revealFormatCreationForm(page: Page): Promise<void> {
  if (!(await visibleByTestId(page, 'harvests-page').isVisible().catch(() => false))) {
    await navigateViaTab(page, 'harvests');
  }
  const codeInput = page.getByTestId('format-code-input');
  if (await visibleByTestId(page, 'format-code-input').isVisible().catch(() => false)) {
    return;
  }

  if ((await codeInput.count()) > 0) {
    await codeInput
      .first()
      .evaluate((el) => {
        let cur: HTMLElement | null = el as HTMLElement;
        while (cur) {
          if (cur.tagName === 'DETAILS') {
            (cur as HTMLDetailsElement).open = true;
          }
          cur = cur.parentElement;
        }
      })
      .catch(() => {});
  }

  if (!(await visibleByTestId(page, 'format-code-input').isVisible().catch(() => false))) {
    const harvestsPage = visibleByTestId(page, 'harvests-page');
    const addFormatTrigger = harvestsPage
      .locator('button, summary')
      .filter({ hasText: /format|article|pot|nouveau|ajouter/i })
      .first();
    if (await addFormatTrigger.isVisible().catch(() => false)) {
      await addFormatTrigger.click();
    }
  }

  await expect(visibleByTestId(page, 'format-code-input')).toBeVisible();
}

export interface UpsertJarFormatUiOptions {
  code: string;
  label: string;
  weightKg: number | string;
  expectSuccessToast?: boolean;
}

export async function upsertJarFormatViaUi(
  page: Page,
  opts: UpsertJarFormatUiOptions,
): Promise<void> {
  await revealFormatCreationForm(page);
  await visibleByTestId(page, 'format-code-input').fill(opts.code);
  await visibleByTestId(page, 'format-label-input').fill(opts.label);
  await visibleByTestId(page, 'format-weight-input').fill(String(opts.weightKg));
  await visibleByTestId(page, 'format-save-btn').click();

  if (opts.expectSuccessToast !== false) {
    await expect(visibleByTestId(page, 'toast-success')).toBeVisible();
  }
}

export interface CreateAccountingEntryUiOptions {
  type: 'Recette' | 'Dépense';
  category: string;
  label: string;
  amount: number | string;
  date?: string;
  expectSuccessToast?: boolean;
}

export async function createAccountingEntryViaUi(
  page: Page,
  opts: CreateAccountingEntryUiOptions,
): Promise<void> {
  if (!(await visibleByTestId(page, 'accounting-page').isVisible().catch(() => false))) {
    await navigateViaTab(page, 'accounting');
  }
  await expect(visibleByTestId(page, 'accounting-page')).toBeVisible();

  if (!(await visibleByTestId(page, 'accounting-label-input').isVisible().catch(() => false))) {
    const addBtn = visibleByTestId(page, 'accounting-add-btn');
    if (await addBtn.isVisible().catch(() => false)) {
      await addBtn.click();
    }
  }

  const labelInput = visibleByTestId(page, 'accounting-label-input');
  await expect(labelInput).toBeVisible();

  await setSegmentedControlOrButton(page, `accounting-type-${opts.type}`);
  await selectOptionByLabelOrValue(
    visibleByTestId(page, 'accounting-category-select'),
    opts.category,
  );
  await labelInput.fill(opts.label);
  await visibleByTestId(page, 'accounting-amount-input').fill(String(opts.amount));

  if (opts.date !== undefined) {
    await visibleByTestId(page, 'accounting-date-input').fill(opts.date);
  }

  await visibleByTestId(page, 'accounting-save-btn').click();

  if (opts.expectSuccessToast !== false) {
    await expect(visibleByTestId(page, 'toast-success')).toBeVisible();
  }
}

async function findInnermostRowWithButtons(
  root: Locator,
  entryLabel: string,
): Promise<Locator> {
  const candidates = root
    .locator('tr, li, article, [role="row"], [role="listitem"], div')
    .filter({ hasText: entryLabel });

  const count = await candidates.count();
  for (let i = count - 1; i >= 0; i -= 1) {
    const item = candidates.nth(i);
    if ((await item.locator('button:visible').count()) > 0) {
      return item;
    }
  }
  throw new Error(`Unable to find accounting entry row with action buttons for "${entryLabel}"`);
}

export async function editAccountingEntryViaUi(
  page: Page,
  currentLabel: string,
  updates: { label?: string; amount?: number | string; category?: string; date?: string },
): Promise<void> {
  const accountingPage = visibleByTestId(page, 'accounting-page');
  const row = await findInnermostRowWithButtons(accountingPage, currentLabel);

  const editByRole = row.getByRole('button', { name: /modifier|éditer|editer|edit/i }).first();
  if (await editByRole.isVisible().catch(() => false)) {
    await editByRole.click();
  } else {
    const editByAttr = row
      .locator('button[aria-label*="modif" i], button[title*="modif" i]')
      .first();
    await editByAttr.click();
  }

  const labelInput = visibleByTestId(page, 'accounting-label-input');
  await expect(labelInput).toBeVisible();

  if (updates.category !== undefined) {
    await selectOptionByLabelOrValue(
      visibleByTestId(page, 'accounting-category-select'),
      updates.category,
    );
  }
  if (updates.label !== undefined) {
    await labelInput.fill(updates.label);
  }
  if (updates.amount !== undefined) {
    await visibleByTestId(page, 'accounting-amount-input').fill(String(updates.amount));
  }
  if (updates.date !== undefined) {
    await visibleByTestId(page, 'accounting-date-input').fill(updates.date);
  }

  await visibleByTestId(page, 'accounting-save-btn').click();
  await expect(visibleByTestId(page, 'toast-success')).toBeVisible();
}

export async function deleteAccountingEntryViaUi(
  page: Page,
  targetLabel: string,
): Promise<void> {
  const accountingPage = visibleByTestId(page, 'accounting-page');
  const row = await findInnermostRowWithButtons(accountingPage, targetLabel);

  const onDialog = (dialog: Dialog) => {
    void dialog.accept();
  };
  page.on('dialog', onDialog);
  try {
    const delByRole = row
      .getByRole('button', { name: /supprimer|effacer|retirer|delete/i })
      .first();
    if (await delByRole.isVisible().catch(() => false)) {
      await delByRole.click();
    } else {
      const delByAttr = row
        .locator('button[aria-label*="suppr" i], button[title*="suppr" i]')
        .first();
      await delByAttr.click();
    }

    // Support optional two-step in-DOM confirmation button
    const stillPresent = await accountingPage
      .getByText(targetLabel)
      .first()
      .isVisible()
      .catch(() => false);
    if (stillPresent) {
      const confirmBtn = page
        .getByRole('button', { name: /confirmer|oui|supprimer définitivement/i })
        .first();
      if (await confirmBtn.isVisible().catch(() => false)) {
        await confirmBtn.click();
      }
    }

    await expect(accountingPage).not.toContainText(targetLabel);
  } finally {
    page.off('dialog', onDialog);
  }
}

export async function clickKpiDeepLink(page: Page, testId: string): Promise<void> {
  const card = visibleByTestId(page, testId);
  await expect(card).toBeVisible();

  const isDirectlyInteractive = await card.evaluate((el) => {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role');
    return tag === 'a' || tag === 'button' || role === 'button' || role === 'link';
  });

  if (isDirectlyInteractive) {
    await card.click();
  } else {
    const nested = card.locator('a:visible, button:visible, [role="button"]:visible, [role="link"]:visible').first();
    if (await nested.isVisible().catch(() => false)) {
      await nested.click();
    } else {
      await card.click();
    }
  }

  await expect(visibleByTestId(page, 'orders-page')).toBeVisible();
}
