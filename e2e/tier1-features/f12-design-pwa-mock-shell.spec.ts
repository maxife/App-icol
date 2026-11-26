import { expect, test } from '@playwright/test';
import {
  bootstrapCleanApp,
  navigateViaTab,
  resetMockViaButton,
  setOfflineSimulation,
  visibleByTestId,
   type AppTab,
} from '../helpers/app';
import {
  createSaleViaUi,
  discoverFormatCodes,
  readSelectedOptionValue,
} from '../helpers/forms';
import { readDashboardSnapshot, readKpiNumber } from '../helpers/metrics';

test.describe('F-12 — Mobile-First Vanilla CSS Design System, PWA Shell & Mock QA', () => {
  test('F12-T1: renders responsive 390x844 mobile shell with bottom navigation and zero horizontal overflow across views', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await bootstrapCleanApp(page, '#/dashboard');

    const htmlLang = await page.locator('html').getAttribute('lang');
    expect((htmlLang ?? '').toLowerCase().startsWith('fr')).toBe(true);

    const viewportContent = await page
      .locator('meta[name="viewport"]')
      .first()
      .getAttribute('content');
    expect(viewportContent ?? '').toContain('width=device-width');

    const tabs: AppTab[] = ['dashboard', 'orders', 'new-sale', 'harvests', 'accounting'];
    for (const tab of tabs) {
      await navigateViaTab(page, tab);

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);

      for (const navId of [
        'nav-dashboard',
        'nav-orders',
        'nav-new-sale',
        'nav-harvests',
        'nav-accounting',
      ]) {
        const box = await visibleByTestId(page, navId).boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(-0.5);
        expect(box!.x + box!.width).toBeLessThanOrEqual(390.5);
      }
    }
  });

  test('F12-T2: enforces tactile mobile touch targets (>= 44–48px) on navigation, jar steppers, and primary submit CTA', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await bootstrapCleanApp(page, '#/dashboard');

    const navDashboardBox = await visibleByTestId(page, 'nav-dashboard').boundingBox();
    const navNewSaleBox = await visibleByTestId(page, 'nav-new-sale').boundingBox();
    expect(navDashboardBox).not.toBeNull();
    expect(navNewSaleBox).not.toBeNull();
    expect(navDashboardBox!.height).toBeGreaterThanOrEqual(44);
    expect(navNewSaleBox!.height).toBeGreaterThanOrEqual(44);

    await navigateViaTab(page, 'new-sale');
    const codes = await discoverFormatCodes(page);
    const fmt0 = codes[0];

    const incBox = await visibleByTestId(page, `stepper-inc-${fmt0}`).boundingBox();
    const decBox = await visibleByTestId(page, `stepper-dec-${fmt0}`).boundingBox();
    expect(incBox).not.toBeNull();
    expect(decBox).not.toBeNull();
    expect(incBox!.width).toBeGreaterThanOrEqual(44);
    expect(incBox!.height).toBeGreaterThanOrEqual(44);
    expect(decBox!.width).toBeGreaterThanOrEqual(44);
    expect(decBox!.height).toBeGreaterThanOrEqual(44);

    const submitBtn = visibleByTestId(page, 'sale-submit-btn');
    await submitBtn.scrollIntoViewIfNeeded();
    const submitBox = await submitBtn.boundingBox();
    expect(submitBox).not.toBeNull();
    expect(submitBox!.height).toBeGreaterThanOrEqual(44);
    expect(submitBox!.width).toBeGreaterThanOrEqual(120);
  });

  test('F12-T3: applies Vanilla CSS custom properties and tabular-nums on financial KPIs with zero Tailwind dependencies', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');

    const cssAudit = await page.evaluate(() => {
      let customPropCount = 0;
      let twCustomPropCount = 0;

      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSStyleRule && rule.selectorText.includes(':root')) {
            for (let i = 0; i < rule.style.length; i += 1) {
              const prop = rule.style[i];
              if (prop.startsWith('--tw-')) {
                twCustomPropCount += 1;
              } else if (prop.startsWith('--')) {
                customPropCount += 1;
              }
            }
          }
        }
      }

      const tailwindAssetRefs = Array.from(
        document.querySelectorAll('link[href], script[src]'),
      ).filter((el) => {
        const url = el.getAttribute('href') ?? el.getAttribute('src') ?? '';
        return /tailwind/i.test(url);
      }).length;

      return { customPropCount, twCustomPropCount, tailwindAssetRefs };
    });

    expect(cssAudit.customPropCount).toBeGreaterThanOrEqual(5);
    expect(cssAudit.twCustomPropCount).toBe(0);
    expect(cssAudit.tailwindAssetRefs).toBe(0);

    const hasTabularNumsOnKpi = await visibleByTestId(page, 'kpi-paid-eur').evaluate((root) => {
      const nodes = [root, ...Array.from(root.querySelectorAll('*'))];
      return nodes.some((node) => {
        const style = window.getComputedStyle(node);
        return (
          style.fontVariantNumeric.includes('tabular-nums') ||
          style.fontFeatureSettings.includes('tnum')
        );
      });
    });
    expect(hasTabularNumsOnKpi).toBe(true);

    await navigateViaTab(page, 'new-sale');
    const hasTabularNumsOnTotal = await visibleByTestId(page, 'sale-total-amount').evaluate(
      (root) => {
        const nodes = [root, ...Array.from(root.querySelectorAll('*'))];
        return nodes.some((node) => {
          const style = window.getComputedStyle(node);
          return (
            style.fontVariantNumeric.includes('tabular-nums') ||
            style.fontFeatureSettings.includes('tnum')
          );
        });
      },
    );
    expect(hasTabularNumsOnTotal).toBe(true);
  });

  test('F12-T4: serves valid PWA manifest.webmanifest, icons, and offline static shell Service Worker asset', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');

    const manifestHref = await page
      .locator('link[rel="manifest"]')
      .first()
      .getAttribute('href');
    expect(manifestHref && manifestHref.trim().length > 0).toBe(true);

    const manifestUrl = new URL(manifestHref!, page.url()).toString();
    const manifestRes = await page.request.get(manifestUrl);
    expect(manifestRes.status()).toBe(200);

    const manifest = (await manifestRes.json()) as {
      name?: string;
      short_name?: string;
      display?: string;
      start_url?: string;
      icons?: Array<{ src: string; sizes?: string; type?: string }>;
    };

    expect(`${manifest.name ?? ''} ${manifest.short_name ?? ''}`).toMatch(/app-icol/i);
    expect(['standalone', 'minimal-ui']).toContain(manifest.display);
    expect(typeof manifest.start_url).toBe('string');
    expect(Array.isArray(manifest.icons) && manifest.icons.length >= 1).toBe(true);

    const firstIconUrl = new URL(manifest.icons![0].src, manifestUrl).toString();
    const iconRes = await page.request.get(firstIconUrl);
    expect(iconRes.status()).toBe(200);

    const registeredSwUrl = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return null;
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const reg of regs) {
        const scriptUrl =
          reg.active?.scriptURL ?? reg.waiting?.scriptURL ?? reg.installing?.scriptURL;
        if (scriptUrl) return scriptUrl;
      }
      return null;
    });

    const candidateUrls = registeredSwUrl
      ? [registeredSwUrl]
      : [
          new URL('./sw.js', page.url()).toString(),
          new URL('./service-worker.js', page.url()).toString(),
        ];

    let verifiedSw = false;
    for (const swUrl of candidateUrls) {
      const swRes = await page.request.get(swUrl);
      const contentType = swRes.headers()['content-type'] ?? '';
      const body = await swRes.text();
      if (
        swRes.status() === 200 &&
        /javascript|ecmascript/i.test(contentType) &&
        body.trim().length > 0
      ) {
        verifiedSw = true;
        break;
      }
    }
    expect(verifiedSw).toBe(true);
  });

  test('F12-T5: resets mutated orders and harvests cleanly back to seed state via both reset-mock-data button and ?resetMock=1 URL', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');

    const baselineHarvestValue = await readSelectedOptionValue(
      visibleByTestId(page, 'dashboard-harvest-select'),
    );
    const seedSnap = await readDashboardSnapshot(page);

    await visibleByTestId(page, 'dashboard-new-sale-cta').click();
    const codes = await discoverFormatCodes(page);
    await createSaleViaUi(page, {
      alreadyOnSaleForm: true,
      customerName: 'Mutation Éphémère Reset1',
      quantities: { [codes[0]]: 2 },
      orderStatus: 'Distribué',
      paymentStatus: 'Payé',
    });

    await navigateViaTab(page, 'dashboard');
    await visibleByTestId(page, 'dashboard-harvest-select').selectOption(baselineHarvestValue);
    expect(await readKpiNumber(page, 'kpi-committed-kg')).toBeGreaterThan(seedSnap.committedKg);
    expect(await readKpiNumber(page, 'kpi-paid-eur')).toBeGreaterThan(seedSnap.paidEur);

    await resetMockViaButton(page);
    await navigateViaTab(page, 'dashboard');
    await visibleByTestId(page, 'dashboard-harvest-select').selectOption(baselineHarvestValue);
    expect(await readKpiNumber(page, 'kpi-committed-kg')).toBeCloseTo(seedSnap.committedKg, 2);
    expect(await readKpiNumber(page, 'kpi-paid-eur')).toBeCloseTo(seedSnap.paidEur, 2);

    await navigateViaTab(page, 'orders');
    await visibleByTestId(page, 'orders-search-input').fill('Mutation Éphémère Reset1');
    await expect(
      page.getByTestId('order-card').filter({ hasText: 'Mutation Éphémère Reset1' }),
    ).toHaveCount(0);

    await createSaleViaUi(page, {
      customerName: 'Mutation Éphémère Reset2',
      orderStatus: 'Distribué',
      paymentStatus: 'Payé',
    });

    await page.goto('/?resetMock=1#/orders');
    await expect(visibleByTestId(page, 'orders-page')).toBeVisible();
    await expect
      .poll(() => new URL(page.url()).searchParams.has('resetMock'))
      .toBe(false);

    await visibleByTestId(page, 'orders-search-input').fill('Mutation Éphémère Reset2');
    await expect(
      page.getByTestId('order-card').filter({ hasText: 'Mutation Éphémère Reset2' }),
    ).toHaveCount(0);
  });

  test('F12-T6: toggling simulate-offline-toggle surfaces and dismisses network-status-banner immediately', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');

    const banner = visibleByTestId(page, 'network-status-banner');
    if (await banner.isVisible().catch(() => false)) {
      await expect(banner).not.toContainText(/hors[- ]ligne|offline/i);
    }

    await setOfflineSimulation(page, true);
    await expect(visibleByTestId(page, 'network-status-banner')).toBeVisible();
    await expect(visibleByTestId(page, 'network-status-banner')).toContainText(
      /hors[- ]ligne|connexion|réseau|offline/i,
    );

    await navigateViaTab(page, 'orders');
    await expect(visibleByTestId(page, 'orders-page')).toBeVisible();
    await expect(visibleByTestId(page, 'network-status-banner')).toBeVisible();

    await setOfflineSimulation(page, false);
    const stillVisible = await visibleByTestId(page, 'network-status-banner')
      .isVisible()
      .catch(() => false);
    if (stillVisible) {
      await expect(visibleByTestId(page, 'network-status-banner')).not.toContainText(
        /hors[- ]ligne|offline/i,
      );
    }
  });
});
