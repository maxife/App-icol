import { expect, test } from '@playwright/test';
import { CANONICAL_BUYERS } from '../fixtures/testData';
import { bootstrapCleanApp, navigateViaTab, visibleByTestId } from '../helpers/app';
import {
  createSaleViaUi,
  discoverFormatCodes,
  setSegmentedControlOrButton,
  setStepperQty,
  verifyRelaySuggestionAvailable,
} from '../helpers/forms';
import { installMockContactPicker, readContactPickerCalls } from '../helpers/vcard';

test.describe('F-04 — Customer Directory, Mobile Contact Picker & Relay Memory', () => {
  test('F04-T1: autocompletes historical buyers by name and pre-fills customer name, normalized phone, and usual relay', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');
    await createSaleViaUi(page, {
      customerName: CANONICAL_BUYERS.repeatCustomer.customerName,
      phone: CANONICAL_BUYERS.repeatCustomer.rawPhone,
      relay: CANONICAL_BUYERS.repeatCustomer.relay,
    });

    await navigateViaTab(page, 'dashboard');
    await navigateViaTab(page, 'new-sale');

    const nameInput = visibleByTestId(page, 'customer-name-input');
    await expect(nameInput).toHaveValue('');

    await nameInput.click();
    await nameInput.fill('nadine chev');

    const list = visibleByTestId(page, 'customer-autocomplete-list');
    await expect(list).toBeVisible();

    const suggestion = page
      .getByTestId('customer-suggestion-item')
      .filter({ hasText: /Nadine Chevalier/i })
      .first();
    await expect(suggestion).toBeVisible();
    await suggestion.click();

    await expect(visibleByTestId(page, 'customer-name-input')).toHaveValue(
      CANONICAL_BUYERS.repeatCustomer.customerName,
    );
    await expect(visibleByTestId(page, 'customer-phone-input')).toHaveValue(
      CANONICAL_BUYERS.repeatCustomer.normalizedPhone,
    );
    await expect(visibleByTestId(page, 'customer-relay-input')).toHaveValue(
      CANONICAL_BUYERS.repeatCustomer.relay,
    );
  });

  test('F04-T2: matches historical buyers by phone digits inside customer autocomplete', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');
    await createSaleViaUi(page, {
      customerName: 'Thierry Delacroix',
      phone: '06 77 88 99 11',
      relay: 'Marché des Producteurs',
    });

    await navigateViaTab(page, 'dashboard');
    await navigateViaTab(page, 'new-sale');

    const nameInput = visibleByTestId(page, 'customer-name-input');
    await expect(nameInput).toHaveValue('');

    await nameInput.click();
    await nameInput.fill('067788');

    const matchedOnName = await page
      .getByTestId('customer-suggestion-item')
      .filter({ hasText: 'Thierry Delacroix' })
      .first()
      .isVisible({ timeout: 1_000 })
      .catch(() => false);

    if (!matchedOnName) {
      await nameInput.fill('');
      const phoneInput = visibleByTestId(page, 'customer-phone-input');
      await phoneInput.click();
      await phoneInput.fill('067788');
    }

    await expect(visibleByTestId(page, 'customer-autocomplete-list')).toBeVisible();
    const suggestion = page
      .getByTestId('customer-suggestion-item')
      .filter({ hasText: 'Thierry Delacroix' })
      .first();
    await expect(suggestion).toBeVisible();
    await suggestion.click();

    await expect(visibleByTestId(page, 'customer-name-input')).toHaveValue('Thierry Delacroix');
    await expect(visibleByTestId(page, 'customer-phone-input')).toHaveValue('06 77 88 99 11');
    await expect(visibleByTestId(page, 'customer-relay-input')).toHaveValue(
      'Marché des Producteurs',
    );
  });

  test('F04-T3: imports contact name and normalizes French phone via Mobile Contact Picker API (contact-picker-btn)', async ({
    page,
  }) => {
    await installMockContactPicker(page, [
      { name: ['Hélène Gauthier'], tel: ['+33 6.18.29.40.51'] },
    ]);

    await bootstrapCleanApp(page, '#/dashboard');
    await navigateViaTab(page, 'new-sale');

    const pickerBtn = visibleByTestId(page, 'contact-picker-btn');
    await expect(pickerBtn).toBeVisible();
    await pickerBtn.click();

    await expect.poll(async () => (await readContactPickerCalls(page)).length).toBe(1);
    const calls = await readContactPickerCalls(page);
    expect(calls[0].props).toContain('name');
    expect(calls[0].props).toContain('tel');

    await expect(visibleByTestId(page, 'customer-name-input')).toHaveValue('Hélène Gauthier');
    await expect(visibleByTestId(page, 'customer-phone-input')).toHaveValue('06 18 29 40 51');

    const codes = await discoverFormatCodes(page);
    await setStepperQty(page, codes[0], 1);
    await visibleByTestId(page, 'sale-submit-btn').click();
    await expect(visibleByTestId(page, 'toast-success')).toBeVisible();

    await navigateViaTab(page, 'orders');
    await visibleByTestId(page, 'orders-search-input').fill('Hélène Gauthier');
    const card = page.getByTestId('order-card').filter({ hasText: 'Hélène Gauthier' }).first();
    await expect(card).toBeVisible();
    await expect(card).toContainText('06 18 29 40 51');
    await expect(card.getByTestId('order-tel-link')).toHaveAttribute('href', /^tel:/i);
  });

  test('F04-T4: allows free-text anonymous direct sale entry without requiring phone or relay', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');
    await navigateViaTab(page, 'new-sale');

    await visibleByTestId(page, 'customer-name-input').fill(
      CANONICAL_BUYERS.anonymousDirect.customerName,
    );
    await visibleByTestId(page, 'customer-phone-input').fill('');
    await visibleByTestId(page, 'customer-relay-input').fill('');

    const codes = await discoverFormatCodes(page);
    await setStepperQty(page, codes[0], 1);
    await setSegmentedControlOrButton(page, 'order-status-Distribué');
    await setSegmentedControlOrButton(page, 'payment-status-Payé');
    await visibleByTestId(page, 'sale-submit-btn').click();

    await expect(visibleByTestId(page, 'toast-success')).toBeVisible();

    await navigateViaTab(page, 'orders');
    await visibleByTestId(page, 'orders-search-input').fill(
      CANONICAL_BUYERS.anonymousDirect.customerName,
    );
    await expect(
      page
        .getByTestId('order-card')
        .filter({ hasText: CANONICAL_BUYERS.anonymousDirect.customerName }),
    ).toHaveCount(1);
  });

  test('F04-T5: memorizes buyer most recent non-empty relay and exposes relay suggestions from past sales', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');

    await createSaleViaUi(page, {
      date: '2026-04-10',
      customerName: 'Bruno Marchand',
      phone: '06 51 52 53 54',
      relay: 'AMAP des Lilas',
    });

    await navigateViaTab(page, 'dashboard');
    await createSaleViaUi(page, {
      date: '2026-06-20',
      customerName: 'Bruno Marchand',
      phone: '06 51 52 53 54',
      relay: 'Biocoop Centre',
    });

    await navigateViaTab(page, 'dashboard');
    await navigateViaTab(page, 'new-sale');

    await verifyRelaySuggestionAvailable(page, 'AMAP des Lilas');
    await verifyRelaySuggestionAvailable(page, 'Biocoop Centre');

    const nameInput = visibleByTestId(page, 'customer-name-input');
    await nameInput.click();
    await nameInput.fill('Bruno March');
    const suggestion = page
      .getByTestId('customer-suggestion-item')
      .filter({ hasText: /Bruno Marchand/i })
      .first();
    await expect(suggestion).toBeVisible();
    await suggestion.click();

    await expect(visibleByTestId(page, 'customer-relay-input')).toHaveValue('Biocoop Centre');

    await navigateViaTab(page, 'orders');
    const relayOptions = await visibleByTestId(page, 'filter-relay-select').evaluate((el) =>
      Array.from((el as HTMLSelectElement).options).map((o) => (o.textContent ?? '').trim()),
    );
    expect(relayOptions.some((txt) => txt.includes('AMAP des Lilas'))).toBe(true);
    expect(relayOptions.some((txt) => txt.includes('Biocoop Centre'))).toBe(true);
  });
});
