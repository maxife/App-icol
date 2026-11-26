import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ALLOWED_SHEETS, FORBIDDEN_SHEETS } from '@app-icol/shared';
import { authenticateAndAuthorizeRpc } from '../auth/AuthVerifier';
import { handleDoPost, inspectSheetStructureImpl } from '../main';
import {
  MockSheet,
  createSeededMockSpreadsheet,
  installMockGasEnvironment,
  type InstalledMockGasEnvironment,
} from '../testing/MockSpreadsheetApp';
import { assertSheetWritable } from './FormulaPreserver';
import { assertAllowedSheet, requireAllowedSheet } from './SheetGuard';

function encodeBase64UrlAscii(str: string): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    bytes.push(str.charCodeAt(i) & 0xff);
  }
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += chars[b0 >> 2];
    out += chars[((b0 & 3) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) out += chars[((b1 & 15) << 2) | (b2 >> 6)];
    if (i + 2 < bytes.length) out += chars[b2 & 63];
  }
  return out;
}

function buildMockJwt(email: string, aud = 'app-icol-e2e-client.apps.googleusercontent.com', expOffsetSec = 3600): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = encodeBase64UrlAscii(
    JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'app-icol-mock-kid' }),
  );
  const payload = encodeBase64UrlAscii(
    JSON.stringify({
      iss: 'https://accounts.google.com',
      aud,
      sub: `sub-${email}`,
      email,
      email_verified: true,
      name: email.split('@')[0],
      iat: nowSec - 10,
      exp: nowSec + expOffsetSec,
    }),
  );
  return `${header}.${payload}.mocksig`;
}

function callDoPost(body: Record<string, unknown>) {
  const out = handleDoPost({
    postData: { contents: JSON.stringify(body) },
  } as unknown as GoogleAppsScript.Events.DoPost);
  return JSON.parse(out.getContent()) as {
    ok: boolean;
    data?: unknown;
    deduplicated?: boolean;
    error?: { code: string; message: string };
  };
}

describe('GAS Backend: SheetGuard, FormulaPreserver, AuthVerifier & RPC Router (M2)', () => {
  let env: InstalledMockGasEnvironment;
  const managerToken = buildMockJwt('gestionnaire@app-icol.test');
  const contributorToken = buildMockJwt('covendeur@app-icol.test');

  beforeEach(() => {
    env = installMockGasEnvironment();
  });

  afterEach(() => {
    env.uninstall();
  });

  it('hard-blocks all 4 FORBIDDEN_SHEETS (including dash/escape variants) and unlisted tabs while never touching forbidden cells', () => {
    for (const forbidden of FORBIDDEN_SHEETS) {
      expect(() => assertAllowedSheet(forbidden)).toThrowError(/interdit/i);
      expect(() => requireAllowedSheet(env.spreadsheet as unknown as GoogleAppsScript.Spreadsheet.Spreadsheet, forbidden)).toThrow();
    }
    expect(() => assertAllowedSheet('TEST \\- NE PAS TOUCHER')).toThrow();
    expect(() => assertAllowedSheet('TEST – NE PAS TOUCHER')).toThrow();
    expect(() => assertAllowedSheet('Onglet Inconnu')).toThrow();

    const report = inspectSheetStructureImpl();
    expect(report.activeSheets.map((s) => s.sheetName)).toEqual([...ALLOWED_SHEETS]);
    expect(report.forbiddenSheetsPresent).toEqual([...FORBIDDEN_SHEETS]);

    for (const forbidden of FORBIDDEN_SHEETS) {
      const sheet = env.spreadsheet.getMockSheet(forbidden)!;
      expect(sheet.cellAccessCount).toBe(0);
    }
  });

  it('blocks writes to formula-driven Par* summary sheets with READ_ONLY_SUMMARY_SHEET', () => {
    for (const summaryName of ['ParRecoltes', 'ParCommandes', 'ParPaiement'] as const) {
      const sheet = env.spreadsheet.getSheetByName(summaryName)!;
      expect(() => assertSheetWritable(sheet, summaryName)).toThrow();
    }

    // Dynamic ParArticles check when populated by summary formulas
    const wb = createSeededMockSpreadsheet('summary-articles');
    const summaryArticles = new MockSheet('ParArticles', [
      ['Code', 'Article', 'Poids (Kg)'],
      ['=UNIQUE(\'Ventes Miel\'!G2:G)', 'Pot 1 kg', 1],
    ]);
    wb.getMockSheet('ParArticles')!.seedCellMeta(2, 1, {
      formulaA1: '=UNIQUE(\'Ventes Miel\'!G2:G)',
      formulaR1C1: '=UNIQUE(\'Ventes Miel\'!G2:G)',
      value: '',
    });
    expect(() =>
      assertSheetWritable(wb.getSheetByName('ParArticles')!, 'ParArticles'),
    ).toThrow();
    expect(summaryArticles.getName()).toBe('ParArticles');
  });

  it('enforces GIS idToken verification and RBAC policies (contributor blocked on manager-only RPCs)', () => {
    const managerSession = authenticateAndAuthorizeRpc(managerToken, 'harvests.create');
    expect(managerSession.role).toBe('manager');

    expect(() =>
      authenticateAndAuthorizeRpc(contributorToken, 'harvests.create'),
    ).toThrow();
    expect(() =>
      authenticateAndAuthorizeRpc(contributorToken, 'accounting.list'),
    ).toThrow();
    expect(() =>
      authenticateAndAuthorizeRpc(contributorToken, 'orders.delete'),
    ).toThrow();

    const forbiddenRes = callDoPost({
      action: 'accounting.create',
      idToken: contributorToken,
      clientRequestId: 'req-forbidden-1',
      payload: {},
    });
    expect(forbiddenRes.ok).toBe(false);
    expect(forbiddenRes.error?.code).toBe('FORBIDDEN_ROLE');
  });

  it('preserves R1C1 formulas, restores R1C1 when manual override resets to null, enforces "@" phone format, and deduplicates clientRequestId', () => {
    const createPayload = {
      order: {
        date: '2026-07-10',
        customerName: 'Pauline Test R1C1',
        phone: '+33 6 09 08 07 06',
        contextOrRelay: 'Rucher Sud',
        harvestLabel: '  Printemps   2026 ',
        items: [{ formatCode: '1kg', quantity: 2 }],
        manualAmountOverrideEur: null,
        orderStatus: 'Réservé',
        paymentStatus: 'Non-payé',
        collectedByThirdParty: false,
      },
    };

    const res1 = callDoPost({
      action: 'orders.create',
      idToken: managerToken,
      clientRequestId: 'idem-order-1',
      payload: createPayload,
    });
    expect(res1.ok).toBe(true);
    const createdOrder = res1.data as { id: string; sheetRowNumber: number; phone: string };
    expect(createdOrder.phone).toBe('06 09 08 07 06');

    // Replay same clientRequestId -> deduplicated without creating second row
    const res2 = callDoPost({
      action: 'orders.create',
      idToken: managerToken,
      clientRequestId: 'idem-order-1',
      payload: createPayload,
    });
    expect(res2.ok).toBe(true);
    expect(res2.deduplicated).toBe(true);
    expect((res2.data as { id: string }).id).toBe(createdOrder.id);

    const salesSheet = env.spreadsheet.getMockSheet('Ventes Miel')!;
    const phoneCell = salesSheet.inspectCellMeta(createdOrder.sheetRowNumber, 4);
    expect(phoneCell.numberFormat).toBe('@');
    expect(phoneCell.value).toBe('06 09 08 07 06');

    const priceCellAuto = salesSheet.inspectCellMeta(createdOrder.sheetRowNumber, 11);
    expect(priceCellAuto.formulaR1C1.startsWith('=')).toBe(true);

    // Apply manual override -> static price written; then reset to null -> R1C1 formula restored
    const overrideRes = callDoPost({
      action: 'orders.update',
      idToken: managerToken,
      clientRequestId: 'idem-order-2',
      payload: {
        id: createdOrder.id,
        order: {
          ...createPayload.order,
          manualAmountOverrideEur: 29,
        },
      },
    });
    expect(overrideRes.ok).toBe(true);
    const priceCellOverridden = salesSheet.inspectCellMeta(
      createdOrder.sheetRowNumber,
      11,
    );
    expect(priceCellOverridden.formulaR1C1).toBe('');
    expect(priceCellOverridden.value).toBe(29);

    const resetRes = callDoPost({
      action: 'orders.update',
      idToken: managerToken,
      clientRequestId: 'idem-order-3',
      payload: {
        id: createdOrder.id,
        order: {
          ...createPayload.order,
          manualAmountOverrideEur: null,
        },
      },
    });
    expect(resetRes.ok).toBe(true);
    const priceCellRestored = salesSheet.inspectCellMeta(
      createdOrder.sheetRowNumber,
      11,
    );
    expect(priceCellRestored.formulaR1C1.startsWith('=')).toBe(true);
  });

  it('returns LOCK_TIMEOUT when LockService cannot acquire the script lock', () => {
    env.uninstall();
    env = installMockGasEnvironment({ lockShouldFail: true });

    const lockRes = callDoPost({
      action: 'orders.delete',
      idToken: managerToken,
      clientRequestId: 'req-lock-fail',
      payload: { id: 'ord-001' },
    });
    expect(lockRes.ok).toBe(false);
    expect(lockRes.error?.code).toBe('LOCK_TIMEOUT');
  });
});
