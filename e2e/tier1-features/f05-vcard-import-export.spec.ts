import { expect, test } from '@playwright/test';
import {
  VCARD_21_ANDROID_QP_FOLDED,
  VCARD_21_EXPECTED,
  VCARD_30_EXPECTED,
  VCARD_30_STANDARD,
  VCARD_40_FOLDED_EXPECTED,
  VCARD_40_FOLDED_URI,
} from '../fixtures/vcards';
import { bootstrapCleanApp, navigateViaTab, visibleByTestId } from '../helpers/app';
import { createSaleViaUi, discoverFormatCodes, setStepperQty } from '../helpers/forms';
import {
  installDisableWebShare,
  installMockWebShare,
  readDownloadText,
  readSharedVcfPayloads,
  uploadVcardInMemory,
} from '../helpers/vcard';

test.describe('F-05 — vCard .vcf Import & Export Codec', () => {
  test('F05-T1: imports standard UTF-8 vCard 3.0 (.vcf) via import-vcf-input and populates customer fields', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');
    await navigateViaTab(page, 'new-sale');

    await uploadVcardInMemory(page, VCARD_30_STANDARD, 'julien-garnier.vcf');

    await expect(visibleByTestId(page, 'customer-name-input')).toHaveValue(
      VCARD_30_EXPECTED.fullName,
    );
    await expect(visibleByTestId(page, 'customer-phone-input')).toHaveValue(
      VCARD_30_EXPECTED.normalizedPhone,
    );

    const codes = await discoverFormatCodes(page);
    await setStepperQty(page, codes[0], 1);
    await visibleByTestId(page, 'sale-submit-btn').click();
    await expect(visibleByTestId(page, 'toast-success')).toBeVisible();
  });

  test('F05-T2: imports Android vCard 2.1 with Quoted-Printable UTF-8 folded lines and prioritizes CELL phone', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');
    await navigateViaTab(page, 'new-sale');

    await uploadVcardInMemory(page, VCARD_21_ANDROID_QP_FOLDED, 'elodie-android.vcf');

    await expect(visibleByTestId(page, 'customer-name-input')).toHaveValue(
      VCARD_21_EXPECTED.fullName,
    );
    await expect(visibleByTestId(page, 'customer-phone-input')).toHaveValue(
      VCARD_21_EXPECTED.normalizedPhone,
    );
  });

  test('F05-T3: imports vCard 4.0 with RFC 6350 folded lines and tel: URI phone formatting', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');
    await navigateViaTab(page, 'new-sale');

    await uploadVcardInMemory(page, VCARD_40_FOLDED_URI, 'jean-baptiste-v4.vcf');

    await expect(visibleByTestId(page, 'customer-name-input')).toHaveValue(
      VCARD_40_FOLDED_EXPECTED.fullName,
    );
    await expect(visibleByTestId(page, 'customer-phone-input')).toHaveValue(
      VCARD_40_FOLDED_EXPECTED.normalizedPhone,
    );
  });

  test('F05-T4: exports customer contact as UTF-8 vCard 3.0 (.vcf) download when Web Share API is unavailable', async ({
    page,
  }) => {
    await installDisableWebShare(page);

    await bootstrapCleanApp(page, '#/dashboard');
    await createSaleViaUi(page, {
      customerName: 'Maëlys Lefèvre',
      phone: '06 31 41 59 26',
      relay: "Relais Ruche d'Or",
    });

    await navigateViaTab(page, 'orders');
    await visibleByTestId(page, 'orders-search-input').fill('Maëlys Lefèvre');

    const card = page.getByTestId('order-card').filter({ hasText: 'Maëlys Lefèvre' }).first();
    await expect(card).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      card.getByTestId('export-vcf-btn').click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.vcf$/i);
    const vcfText = await readDownloadText(download);
    const unfolded = vcfText.replace(/\r?\n[ \t]/g, '');

    expect(unfolded).toContain('BEGIN:VCARD');
    expect(unfolded).toContain('VERSION:3.0');
    expect(unfolded).toContain('FN:Maëlys Lefèvre');
    expect(unfolded).toContain('END:VCARD');

    const telLine = unfolded
      .split(/\r?\n/)
      .find((line) => /^TEL(?:[;:].*)/i.test(line));
    expect(telLine).toBeDefined();
    const digitsOnly = (telLine ?? '').replace(/\D/g, '');
    expect(digitsOnly.endsWith('631415926')).toBe(true);
  });

  test('F05-T5: invokes mobile Web Share API with UTF-8 .vcf file when navigator.canShare supports file sharing', async ({
    page,
  }) => {
    await installMockWebShare(page);

    await bootstrapCleanApp(page, '#/dashboard');
    await createSaleViaUi(page, {
      customerName: 'Antoine Roussel',
      phone: '06 22 33 44 55',
    });

    await navigateViaTab(page, 'orders');
    await visibleByTestId(page, 'orders-search-input').fill('Antoine Roussel');

    const card = page.getByTestId('order-card').filter({ hasText: 'Antoine Roussel' }).first();
    await expect(card).toBeVisible();
    await card.getByTestId('export-vcf-btn').click();

    await expect.poll(async () => (await readSharedVcfPayloads(page)).length).toBe(1);
    const sharedCalls = await readSharedVcfPayloads(page);
    expect(sharedCalls[0].files.length).toBeGreaterThanOrEqual(1);

    const sharedFile = sharedCalls[0].files[0];
    expect(sharedFile.name).toMatch(/\.vcf$/i);
    expect(sharedFile.type).toMatch(/vcard/i);

    const unfolded = sharedFile.text.replace(/\r?\n[ \t]/g, '');
    expect(unfolded).toContain('BEGIN:VCARD');
    expect(unfolded).toContain('VERSION:3.0');
    expect(unfolded).toContain('FN:Antoine Roussel');
    expect(unfolded).toMatch(/^TEL(?:[;:].*)/m);
    expect(unfolded).toContain('END:VCARD');
  });
});
