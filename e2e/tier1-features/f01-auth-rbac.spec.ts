import { expect, test } from '@playwright/test';
import {
  assertTestIdHidden,
  bootstrapCleanApp,
  navigateViaTab,
  readCurrentUserRole,
  switchRole,
  visibleByTestId,
} from '../helpers/app';

test.describe('F-01 — Authentication & Role-Based Access Control', () => {
  test('F01-T1: boots into an authenticated manager session by default after clean mock reset', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');

    await expect(visibleByTestId(page, 'dashboard-page')).toBeVisible();
    await assertTestIdHidden(page, 'gis-login-screen');

    await expect
      .poll(() => new URL(page.url()).searchParams.has('resetMock'))
      .toBe(false);
    expect(new URL(page.url()).hash).toBe('#/dashboard');

    await expect(visibleByTestId(page, 'current-user-role')).toBeVisible();
    expect(await readCurrentUserRole(page)).toBe('manager');
  });

  test('F01-T2: exposes all 5 navigation tabs and grants manager access to harvests and accounting views', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');

    for (const tabId of [
      'nav-dashboard',
      'nav-orders',
      'nav-new-sale',
      'nav-harvests',
      'nav-accounting',
    ]) {
      await expect(visibleByTestId(page, tabId)).toBeVisible();
    }

    await navigateViaTab(page, 'harvests');
    expect(new URL(page.url()).hash).toContain('#/harvests');
    await expect(visibleByTestId(page, 'harvests-page')).toBeVisible();

    await navigateViaTab(page, 'accounting');
    expect(new URL(page.url()).hash).toContain('#/accounting');
    await expect(visibleByTestId(page, 'accounting-page')).toBeVisible();

    await navigateViaTab(page, 'orders');
    await expect(visibleByTestId(page, 'orders-page')).toBeVisible();

    await navigateViaTab(page, 'new-sale');
    await expect(visibleByTestId(page, 'sale-form-page')).toBeVisible();

    await navigateViaTab(page, 'dashboard');
    await expect(visibleByTestId(page, 'dashboard-page')).toBeVisible();
  });

  test('F01-T3: switches to contributor role showing 3 operational tabs while hiding harvests and accounting tabs', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');
    await switchRole(page, 'contributor');

    expect(await readCurrentUserRole(page)).toBe('contributor');

    await expect(visibleByTestId(page, 'nav-dashboard')).toBeVisible();
    await expect(visibleByTestId(page, 'nav-orders')).toBeVisible();
    await expect(visibleByTestId(page, 'nav-new-sale')).toBeVisible();

    await assertTestIdHidden(page, 'nav-harvests');
    await assertTestIdHidden(page, 'nav-accounting');

    await navigateViaTab(page, 'orders');
    await expect(visibleByTestId(page, 'orders-page')).toBeVisible();

    await navigateViaTab(page, 'new-sale');
    await expect(visibleByTestId(page, 'sale-form-page')).toBeVisible();

    await navigateViaTab(page, 'dashboard');
    await expect(visibleByTestId(page, 'dashboard-page')).toBeVisible();
  });

  test('F01-T4: signs out via role-switch-signout to display private GIS login gate and hide protected pages', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');
    await switchRole(page, 'signout');

    await expect(visibleByTestId(page, 'gis-login-screen')).toBeVisible();

    for (const protectedPage of [
      'dashboard-page',
      'orders-page',
      'sale-form-page',
      'harvests-page',
      'accounting-page',
    ]) {
      await assertTestIdHidden(page, protectedPage);
    }

    if ((await page.locator('[data-testid="current-user-role"]:visible').count()) > 0) {
      expect(await readCurrentUserRole(page)).toBe('unauthenticated');
    }
  });

  test('F01-T5: transitions cleanly from signed-out to contributor and back to 5-tab manager across reload', async ({
    page,
  }) => {
    await bootstrapCleanApp(page, '#/dashboard');

    await switchRole(page, 'signout');
    await expect(visibleByTestId(page, 'gis-login-screen')).toBeVisible();

    await switchRole(page, 'contributor');
    await assertTestIdHidden(page, 'gis-login-screen');
    expect(await readCurrentUserRole(page)).toBe('contributor');
    await expect(visibleByTestId(page, 'nav-dashboard')).toBeVisible();
    await expect(visibleByTestId(page, 'nav-orders')).toBeVisible();
    await expect(visibleByTestId(page, 'nav-new-sale')).toBeVisible();
    await assertTestIdHidden(page, 'nav-harvests');
    await assertTestIdHidden(page, 'nav-accounting');

    await switchRole(page, 'manager');
    expect(await readCurrentUserRole(page)).toBe('manager');
    for (const tabId of [
      'nav-dashboard',
      'nav-orders',
      'nav-new-sale',
      'nav-harvests',
      'nav-accounting',
    ]) {
      await expect(visibleByTestId(page, tabId)).toBeVisible();
    }

    await page.reload();
    expect(await readCurrentUserRole(page)).toBe('manager');
    await navigateViaTab(page, 'harvests');
    await expect(visibleByTestId(page, 'harvests-page')).toBeVisible();
  });
});
