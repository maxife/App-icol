import { expect, type Dialog, type Locator, type Page } from '@playwright/test';

export type AppTab = 'dashboard' | 'orders' | 'new-sale' | 'harvests' | 'accounting';
export type AppUserRole = 'manager' | 'contributor' | 'unauthenticated';
export type SwitchableRole = 'manager' | 'contributor' | 'signout';

export const TAB_TO_PAGE_TEST_ID: Record<AppTab, string> = {
  dashboard: 'dashboard-page',
  orders: 'orders-page',
  'new-sale': 'sale-form-page',
  harvests: 'harvests-page',
  accounting: 'accounting-page',
};

export const TAB_TO_HASH_PREFIX: Record<AppTab, string> = {
  dashboard: '#/dashboard',
  orders: '#/orders',
  'new-sale': '#/sale/new',
  harvests: '#/harvests',
  accounting: '#/accounting',
};

export function resolveExpectedPageTestIdForHash(hash: string): string {
  const clean = hash.split('?')[0] ?? '';
  if (clean.startsWith('#/orders')) return 'orders-page';
  if (clean.startsWith('#/sale/new') || clean.startsWith('#/sale/edit/')) return 'sale-form-page';
  if (clean.startsWith('#/harvests')) return 'harvests-page';
  if (clean.startsWith('#/accounting')) return 'accounting-page';
  return 'dashboard-page';
}

export function normalizeHashRoute(initialHash: string): string {
  if (!initialHash) return '#/dashboard';
  if (initialHash.startsWith('#/')) return initialHash;
  if (initialHash.startsWith('#')) return `#/${initialHash.slice(1)}`;
  if (initialHash.startsWith('/')) return `#${initialHash}`;
  return `#/${initialHash}`;
}

export function visibleByTestId(page: Page, testId: string): Locator {
  return page.locator(`[data-testid="${testId}"]:visible`).first();
}

export async function assertTestIdHidden(page: Page, testId: string): Promise<void> {
  await expect(page.locator(`[data-testid="${testId}"]:visible`)).toHaveCount(0);
}

export async function bootstrapCleanApp(
  page: Page,
  initialHash: string = '#/dashboard',
): Promise<void> {
  const normalizedHash = normalizeHashRoute(initialHash);
  const expectedPageTestId = resolveExpectedPageTestIdForHash(normalizedHash);

  await page.goto(`/?resetMock=1${normalizedHash}`);
  await expect(visibleByTestId(page, expectedPageTestId)).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.has('resetMock'))
    .toBe(false);
}

export async function navigateViaTab(page: Page, tab: AppTab): Promise<void> {
  const navControl = visibleByTestId(page, `nav-${tab}`);
  await expect(navControl).toBeVisible();
  await navControl.click();
  await expect
    .poll(() => new URL(page.url()).hash.startsWith(TAB_TO_HASH_PREFIX[tab]))
    .toBe(true);
  await expect(visibleByTestId(page, TAB_TO_PAGE_TEST_ID[tab])).toBeVisible();
}

async function findFirstVisibleMatch(candidates: Locator): Promise<Locator | null> {
  const count = await candidates.count();
  for (let i = 0; i < count; i += 1) {
    const item = candidates.nth(i);
    if (await item.isVisible().catch(() => false)) {
      return item;
    }
  }
  return null;
}

export async function revealQaControl(page: Page, testId: string): Promise<Locator> {
  const candidates = page.getByTestId(testId);

  const immediate = await findFirstVisibleMatch(candidates);
  if (immediate) return immediate;

  if ((await candidates.count()) > 0) {
    await candidates
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

    const afterDetails = await findFirstVisibleMatch(candidates);
    if (afterDetails) return afterDetails;
  }

  const drawerTriggers = page
    .locator('summary, button[aria-expanded="false"]')
    .filter({ hasText: /qa|dev|test|mock|outil|debug|profil|rôle|role|simulat/i });

  if ((await drawerTriggers.count()) > 0) {
    const firstTrigger = await findFirstVisibleMatch(drawerTriggers);
    if (firstTrigger) {
      await firstTrigger.click();
    }
  }

  await expect
    .poll(async () => (await findFirstVisibleMatch(candidates)) !== null)
    .toBe(true);

  const revealed = await findFirstVisibleMatch(candidates);
  if (!revealed) {
    throw new Error(`Unable to reveal QA control with data-testid="${testId}"`);
  }
  return revealed;
}

export function normalizeRoleLabel(raw: string): AppUserRole | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === 'manager' || lower === 'contributor' || lower === 'unauthenticated') {
    return lower;
  }
  if (
    /unauthenticated|déconnecté|deconnecte|non\s*connect|signed[\s-]*out|invité|anonyme/i.test(
      trimmed,
    )
  ) {
    return 'unauthenticated';
  }
  if (/contributor|co-vendeur|covendeur|contributeur/i.test(trimmed)) {
    return 'contributor';
  }
  if (/manager|gestionnaire|apiculteur/i.test(trimmed)) {
    return 'manager';
  }
  return null;
}

export async function readCurrentUserRole(page: Page): Promise<AppUserRole> {
  const badges = page.getByTestId('current-user-role');
  const visibleBadge = await findFirstVisibleMatch(badges);

  if (visibleBadge) {
    const dataRole = await visibleBadge.getAttribute('data-role');
    if (dataRole) {
      const parsedAttr = normalizeRoleLabel(dataRole);
      if (parsedAttr) return parsedAttr;
    }
    const text = (await visibleBadge.textContent()) ?? '';
    const parsedText = normalizeRoleLabel(text);
    if (parsedText) return parsedText;
  }

  if (await visibleByTestId(page, 'gis-login-screen').isVisible().catch(() => false)) {
    return 'unauthenticated';
  }

  if ((await badges.count()) > 0) {
    const first = badges.first();
    const dataRole = await first.getAttribute('data-role');
    if (dataRole) {
      const parsedAttr = normalizeRoleLabel(dataRole);
      if (parsedAttr) return parsedAttr;
    }
    const text = (await first.textContent()) ?? '';
    const parsedText = normalizeRoleLabel(text);
    if (parsedText) return parsedText;
  }

  throw new Error('Unable to resolve current user role from current-user-role or gis-login-screen');
}

export async function switchRole(page: Page, role: SwitchableRole): Promise<void> {
  const control = await revealQaControl(page, `role-switch-${role}`);
  await control.click();

  if (role === 'signout') {
    await expect(visibleByTestId(page, 'gis-login-screen')).toBeVisible();
    await expect.poll(() => readCurrentUserRole(page)).toBe('unauthenticated');
    return;
  }

  await assertTestIdHidden(page, 'gis-login-screen');
  await expect.poll(() => readCurrentUserRole(page)).toBe(role);
}

export async function readToggleState(control: Locator): Promise<boolean | null> {
  return control.evaluate((el) => {
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
      return el.checked;
    }
    if (el instanceof HTMLLabelElement && el.control instanceof HTMLInputElement) {
      return el.control.checked;
    }
    const nestedCheckbox = el.querySelector('input[type="checkbox"], input[type="radio"]');
    if (nestedCheckbox instanceof HTMLInputElement) {
      return nestedCheckbox.checked;
    }
    const ariaChecked = el.getAttribute('aria-checked');
    if (ariaChecked === 'true') return true;
    if (ariaChecked === 'false') return false;

    const ariaPressed = el.getAttribute('aria-pressed');
    if (ariaPressed === 'true') return true;
    if (ariaPressed === 'false') return false;

    const dataActive = el.getAttribute('data-active') ?? el.getAttribute('data-enabled');
    if (dataActive === 'true' || dataActive === '1') return true;
    if (dataActive === 'false' || dataActive === '0') return false;

    const dataState = el.getAttribute('data-state');
    if (dataState === 'checked' || dataState === 'on' || dataState === 'active') return true;
    if (dataState === 'unchecked' || dataState === 'off' || dataState === 'inactive') return false;

    if (/\b(is-active|active|checked|selected|enabled)\b/i.test(el.className)) return true;
    return null;
  });
}

export const readBooleanControlState = readToggleState;

export async function clickOrCheckToggle(control: Locator, targetState?: boolean): Promise<void> {
  const inputMeta = await control.evaluate((el) => {
    if (el instanceof HTMLInputElement && el.type === 'checkbox') {
      const hasVisibleLabel = Boolean(
        el.labels &&
          Array.from(el.labels).some((lbl) => {
            const rect = lbl.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }),
      );
      return { isCheckbox: true, hasVisibleLabel };
    }
    return { isCheckbox: false, hasVisibleLabel: false };
  });

  if (inputMeta.isCheckbox) {
    if (targetState !== undefined) {
      const current = await control.isChecked();
      if (current === targetState) return;
    }
    if (inputMeta.hasVisibleLabel) {
      await control.evaluate((el) => {
        const input = el as HTMLInputElement;
        const visibleLabel = Array.from(input.labels ?? []).find((lbl) => {
          const rect = lbl.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        visibleLabel?.click();
      });
      if (targetState !== undefined && (await control.isChecked()) !== targetState) {
        await control.setChecked(targetState, { force: true });
      }
      return;
    }
    if (targetState !== undefined) {
      await control.setChecked(targetState, { force: true });
      return;
    }
  }

  await control.click();
}

export async function setToggleState(control: Locator, enabled: boolean): Promise<void> {
  const current = await readToggleState(control);
  if (current === enabled) return;
  await clickOrCheckToggle(control, enabled);
  await expect
    .poll(async () => (await readToggleState(control)) ?? enabled)
    .toBe(enabled);
}

export const setBooleanControlState = setToggleState;

export async function setOfflineSimulation(page: Page, enabled: boolean): Promise<void> {
  const toggle = await revealQaControl(page, 'simulate-offline-toggle');
  const current = await readToggleState(toggle);
  if (current !== enabled) {
    await clickOrCheckToggle(toggle, enabled);
  }
  if (enabled) {
    await expect(visibleByTestId(page, 'network-status-banner')).toBeVisible();
  } else {
    await expect
      .poll(async () => {
        const state = await readToggleState(toggle);
        if (state !== null) return state === false;
        return !(await visibleByTestId(page, 'network-status-banner')
          .isVisible()
          .catch(() => false));
      })
      .toBe(true);
  }
}

export async function triggerFailNextWrite(page: Page, enabled: boolean = true): Promise<void> {
  const toggle = await revealQaControl(page, 'fail-next-write-toggle');
  const current = await readToggleState(toggle);
  if (current === null) {
    if (enabled) {
      await toggle.click();
    }
    return;
  }
  if (current !== enabled) {
    await clickOrCheckToggle(toggle, enabled);
  }
}

export async function resetMockViaButton(page: Page): Promise<void> {
  const btn = await revealQaControl(page, 'reset-mock-data');
  const onDialog = (dialog: Dialog) => {
    void dialog.accept();
  };
  page.on('dialog', onDialog);
  try {
    await btn.click();
    await expect.poll(() => readCurrentUserRole(page)).toBe('manager');
  } finally {
    page.off('dialog', onDialog);
  }
}

export async function waitForToast(
  page: Page,
  kind: 'success' | 'error',
): Promise<Locator> {
  const toast = visibleByTestId(page, `toast-${kind}`);
  await expect(toast).toBeVisible();
  return toast;
}

export async function getBrowserLocalTodayIso(page: Page): Promise<string> {
  return page.evaluate(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  });
}
