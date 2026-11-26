import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { ALLOWED_SHEETS, FORBIDDEN_SHEETS } from '../fixtures/testData';
import {
  DEFAULT_GAS_AUTH_CONFIG,
  GAS_RPC_ACTIONS,
  REPO_ROOT,
  isDeduplicatedRpcResponse,
  postGasRpc,
  startLocalGasServer,
  type GasAccountingEntryDto,
  type GasCreateAccountingEntryInputDto,
  type GasCreateHarvestInputDto,
  type GasCreateOrderInputDto,
  type GasDatasetDto,
  type GasHarvestDto,
  type GasSaleOrderDto,
  type GasSessionDto,
  type GasSheetInspectionReportDto,
  type LocalGasServerHandle,
} from '../helpers/gasServer';
import { round2, round3 } from '../helpers/metrics';

test.describe('F-11 — Google Apps Script API, SheetGuard, FormulaPreserver & DEPLOY.md', () => {
  test.describe('Local GAS /exec HTTP Wire Contract & Sheets Integrity', () => {
    let gasServer: LocalGasServerHandle | null = null;

    test.beforeAll(async () => {
      gasServer = await startLocalGasServer();
    });

    test.afterAll(async () => {
      if (gasServer) {
        await gasServer.stop();
        gasServer = null;
      }
    });

    function requireServer(): LocalGasServerHandle {
      if (!gasServer) {
        throw new Error('Local GAS server handle was not initialized in beforeAll');
      }
      return gasServer;
    }

    test('F11-T1: accepts CORS-safe text/plain POST /exec for auth.verifySession and dataset.get with authorized manager idToken', async () => {
      const srv = requireServer();

      const sessionRes = await postGasRpc<GasSessionDto>(srv.baseUrl, {
        action: GAS_RPC_ACTIONS.verifySession,
        idToken: srv.tokens.manager,
        clientRequestId: crypto.randomUUID(),
        payload: {},
        contentType: 'text/plain;charset=utf-8',
      });

      expect(sessionRes.ok).toBe(true);
      if (!sessionRes.ok) return;

      expect(sessionRes.data.role).toBe('manager');
      expect(sessionRes.data.email).toBe(DEFAULT_GAS_AUTH_CONFIG.managerEmails[0]);
      expect(Number.isNaN(Date.parse(sessionRes.serverTimestamp))).toBe(false);

      const datasetRes = await postGasRpc<GasDatasetDto>(srv.baseUrl, {
        action: GAS_RPC_ACTIONS.getDataset,
        idToken: srv.tokens.manager,
        clientRequestId: crypto.randomUUID(),
        payload: {},
        contentType: 'text/plain;charset=utf-8',
      });

      expect(datasetRes.ok).toBe(true);
      if (!datasetRes.ok) return;

      expect(Array.isArray(datasetRes.data.formats)).toBe(true);
      expect(datasetRes.data.formats.length).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(datasetRes.data.harvests)).toBe(true);
      expect(datasetRes.data.harvests.length).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(datasetRes.data.orders)).toBe(true);
      expect(Array.isArray(datasetRes.data.accountingEntries)).toBe(true);
    });

    test('F11-T2: admin.inspectSheetStructure audits the 8 ALLOWED_SHEETS with Row 1 headers and formulas while excluding all 4 FORBIDDEN_SHEETS', async () => {
      const srv = requireServer();

      const auditRes = await srv.rpc<GasSheetInspectionReportDto>({
        action: GAS_RPC_ACTIONS.inspectSheetStructure,
        idToken: srv.tokens.manager,
        payload: {},
      });

      expect(auditRes.ok).toBe(true);
      if (!auditRes.ok) return;

      const activeNames = auditRes.data.activeSheets.map((s) => s.sheetName);
      for (const allowedTab of ALLOWED_SHEETS) {
        expect(activeNames).toContain(allowedTab);
        const tabEntry = auditRes.data.activeSheets.find((s) => s.sheetName === allowedTab);
        expect(tabEntry).toBeDefined();
        expect(tabEntry!.exists).toBe(true);
        expect(tabEntry!.headers.length).toBeGreaterThanOrEqual(1);
      }

      for (const forbiddenTab of FORBIDDEN_SHEETS) {
        expect(activeNames).not.toContain(forbiddenTab);
      }

      const salesSheet = auditRes.data.activeSheets.find(
        (s) => s.sheetName === 'Ventes Miel',
      );
      expect(salesSheet).toBeDefined();
      expect(salesSheet!.headers.length).toBeGreaterThanOrEqual(5);
      const totalFormulaColumns =
        salesSheet!.formulaColumns.length + (salesSheet!.arrayFormulaColumns?.length ?? 0);
      expect(totalFormulaColumns).toBeGreaterThanOrEqual(1);
    });

    test('F11-T3: orders.create via POST /exec preserves R1C1 formulas on Poids (Kg) and Prix and keeps leading 0 on French phone via "@" format', async () => {
      const srv = requireServer();

      const datasetRes = await srv.rpc<GasDatasetDto>({
        action: GAS_RPC_ACTIONS.getDataset,
        idToken: srv.tokens.manager,
        payload: {},
      });
      expect(datasetRes.ok).toBe(true);
      if (!datasetRes.ok) return;

      const activeFormat =
        datasetRes.data.formats.find((f) => f.active) ?? datasetRes.data.formats[0];
      const harvest =
        datasetRes.data.harvests.find(
          (h) => (h.unitPricesEur[activeFormat.code] ?? 0) > 0,
        ) ?? datasetRes.data.harvests[0];
      const unitPriceEur = harvest.unitPricesEur[activeFormat.code];
      expect(unitPriceEur).toBeGreaterThan(0);

      const orderInput: GasCreateOrderInputDto = {
        date: '2026-07-15',
        customerName: 'Lucie Formule R1C1',
        phone: '+33 6 01 02 03 04',
        contextOrRelay: 'Relais Rucher',
        harvestLabel: `  ${harvest.label}  `,
        items: [{ formatCode: activeFormat.code, quantity: 3 }],
        manualAmountOverrideEur: null,
        orderStatus: 'Réservé',
        paymentStatus: 'Non-payé',
        collectedByThirdParty: false,
      };

      const createRes = await srv.rpc<GasSaleOrderDto, { order: GasCreateOrderInputDto }>({
        action: GAS_RPC_ACTIONS.createOrder,
        idToken: srv.tokens.manager,
        payload: { order: orderInput },
      });

      expect(createRes.ok).toBe(true);
      if (!createRes.ok) return;

      const expectedWeight = round3(3 * activeFormat.weightKg);
      const expectedAmount = round2(3 * unitPriceEur);

      expect(createRes.data.phone).toBe('06 01 02 03 04');
      expect(createRes.data.harvestLabel).toBe(harvest.label);
      expect(createRes.data.computedWeightKg).toBeCloseTo(expectedWeight, 3);
      expect(createRes.data.computedAmountEur).toBeCloseTo(expectedAmount, 2);
      expect(createRes.data.manualAmountOverrideEur).toBeNull();
      expect(createRes.data.effectiveAmountEur).toBeCloseTo(expectedAmount, 2);

      const listRes = await srv.rpc<GasSaleOrderDto[]>({
        action: GAS_RPC_ACTIONS.listOrders,
        idToken: srv.tokens.manager,
        payload: {},
      });
      expect(listRes.ok).toBe(true);
      if (!listRes.ok) return;

      const persisted = listRes.data.find((o) => o.id === createRes.data.id);
      expect(persisted).toBeDefined();
      expect(persisted!.phone).toBe('06 01 02 03 04');
      expect(persisted!.phone.startsWith('0')).toBe(true);
      expect(persisted!.computedWeightKg).toBeCloseTo(expectedWeight, 3);
      expect(persisted!.computedAmountEur).toBeCloseTo(expectedAmount, 2);

      const auditAfter = await srv.rpc<GasSheetInspectionReportDto>({
        action: GAS_RPC_ACTIONS.inspectSheetStructure,
        idToken: srv.tokens.manager,
        payload: {},
      });
      expect(auditAfter.ok).toBe(true);
      if (!auditAfter.ok) return;

      const salesSheetAfter = auditAfter.data.activeSheets.find(
        (s) => s.sheetName === 'Ventes Miel',
      );
      expect(salesSheetAfter).toBeDefined();
      const formulaColsAfter =
        salesSheetAfter!.formulaColumns.length +
        (salesSheetAfter!.arrayFormulaColumns?.length ?? 0);
      expect(formulaColsAfter).toBeGreaterThanOrEqual(1);
    });

    test('F11-T4: deduplicates retried POST /exec mutations carrying the same clientRequestId without creating duplicate rows', async () => {
      const srv = requireServer();

      const beforeDataset = await srv.rpc<GasDatasetDto>({
        action: GAS_RPC_ACTIONS.getDataset,
        idToken: srv.tokens.manager,
        payload: {},
      });
      expect(beforeDataset.ok).toBe(true);
      if (!beforeDataset.ok) return;

      const ordersBeforeCount = beforeDataset.data.orders.length;
      const fmt =
        beforeDataset.data.formats.find((f) => f.active) ?? beforeDataset.data.formats[0];
      const harvest = beforeDataset.data.harvests[0];

      const fixedRequestId = crypto.randomUUID();
      const retryOrder: GasCreateOrderInputDto = {
        date: '2026-08-01',
        customerName: 'Client Idempotent Retry',
        phone: '06 55 44 33 22',
        contextOrRelay: 'Marché Samedi',
        harvestLabel: harvest.label,
        items: [{ formatCode: fmt.code, quantity: 1 }],
        manualAmountOverrideEur: null,
        orderStatus: 'Distribué',
        paymentStatus: 'Payé',
        collectedByThirdParty: false,
      };

      const res1 = await srv.rpc<GasSaleOrderDto, { order: GasCreateOrderInputDto }>({
        action: GAS_RPC_ACTIONS.createOrder,
        idToken: srv.tokens.manager,
        clientRequestId: fixedRequestId,
        payload: { order: retryOrder },
      });
      expect(res1.ok).toBe(true);
      if (!res1.ok) return;

      const res2 = await srv.rpc<GasSaleOrderDto, { order: GasCreateOrderInputDto }>({
        action: GAS_RPC_ACTIONS.createOrder,
        idToken: srv.tokens.manager,
        clientRequestId: fixedRequestId,
        payload: { order: retryOrder },
      });
      expect(res2.ok).toBe(true);
      if (!res2.ok) return;

      expect(res2.data.id).toBe(res1.data.id);
      expect(isDeduplicatedRpcResponse(res2)).toBe(true);

      const listAfter = await srv.rpc<GasSaleOrderDto[]>({
        action: GAS_RPC_ACTIONS.listOrders,
        idToken: srv.tokens.manager,
        payload: {},
      });
      expect(listAfter.ok).toBe(true);
      if (!listAfter.ok) return;

      expect(listAfter.data.length).toBe(ordersBeforeCount + 1);
      const matching = listAfter.data.filter(
        (o) => o.customerName === 'Client Idempotent Retry',
      );
      expect(matching).toHaveLength(1);
    });

    test('F11-T5: persists manager harvests.create and accounting.create mutations and contributor co-seller orders.create across full /exec round-trip', async () => {
      const srv = requireServer();

      const baseRes = await srv.rpc<GasDatasetDto>({
        action: GAS_RPC_ACTIONS.getDataset,
        idToken: srv.tokens.manager,
        payload: {},
      });
      expect(baseRes.ok).toBe(true);
      if (!baseRes.ok) return;

      const unitPricesEur: Record<string, number> = {};
      for (const fmt of baseRes.data.formats) {
        unitPricesEur[fmt.code] = 16;
      }
      const fmt0 = baseRes.data.formats[0];

      const harvestRes = await srv.rpc<
        GasHarvestDto,
        { harvest: GasCreateHarvestInputDto }
      >({
        action: GAS_RPC_ACTIONS.createHarvest,
        idToken: srv.tokens.manager,
        payload: {
          harvest: {
            label: '  Lavande   GAS  2028  ',
            year: 2028,
            forecastWeightKg: 75,
            realizedWeightKg: 70,
            unitPricesEur,
            isDefaultActive: false,
          },
        },
      });
      expect(harvestRes.ok).toBe(true);
      if (!harvestRes.ok) return;
      expect(harvestRes.data.label).toBe('Lavande GAS 2028');

      const accountingRes = await srv.rpc<
        GasAccountingEntryDto,
        { entry: GasCreateAccountingEntryInputDto }
      >({
        action: GAS_RPC_ACTIONS.createAccountingEntry,
        idToken: srv.tokens.manager,
        payload: {
          entry: {
            date: '2028-02-10',
            year: 2028,
            type: 'Dépense',
            category: 'Charges et cotisations',
            label: 'Assurance Rucher GAS',
            amountEur: 95,
          },
        },
      });
      expect(accountingRes.ok).toBe(true);
      if (!accountingRes.ok) return;
      expect(accountingRes.data.amountEur).toBe(95);

      const contribSession = await srv.rpc<GasSessionDto>({
        action: GAS_RPC_ACTIONS.verifySession,
        idToken: srv.tokens.contributor,
        payload: {},
      });
      expect(contribSession.ok).toBe(true);
      if (!contribSession.ok) return;
      expect(contribSession.data.role).toBe('contributor');

      const contribOrderRes = await srv.rpc<
        GasSaleOrderDto,
        { order: GasCreateOrderInputDto }
      >({
        action: GAS_RPC_ACTIONS.createOrder,
        idToken: srv.tokens.contributor,
        payload: {
          order: {
            date: '2028-07-20',
            customerName: 'Acheteur CoVendeur GAS',
            phone: '06 71 72 73 74',
            contextOrRelay: 'Relais Co-vendeur',
            harvestLabel: 'Lavande GAS 2028',
            items: [{ formatCode: fmt0.code, quantity: 2 }],
            manualAmountOverrideEur: null,
            orderStatus: 'Distribué',
            paymentStatus: 'Payé',
            collectedByThirdParty: false,
          },
        },
      });
      expect(contribOrderRes.ok).toBe(true);
      if (!contribOrderRes.ok) return;
      expect(contribOrderRes.data.collectedByThirdParty).toBe(true);
      expect(contribOrderRes.data.collectorName.trim().length).toBeGreaterThan(0);
      expect(contribOrderRes.data.transferStatus).toBe('À reverser');

      const roundTripDataset = await srv.rpc<GasDatasetDto>({
        action: GAS_RPC_ACTIONS.getDataset,
        idToken: srv.tokens.manager,
        payload: {},
      });
      expect(roundTripDataset.ok).toBe(true);
      if (!roundTripDataset.ok) return;

      expect(
        roundTripDataset.data.harvests.some((h) => h.label === 'Lavande GAS 2028'),
      ).toBe(true);
      expect(
        roundTripDataset.data.accountingEntries.some(
          (e) => e.label === 'Assurance Rucher GAS' && e.amountEur === 95,
        ),
      ).toBe(true);
      expect(
        roundTripDataset.data.orders.some(
          (o) =>
            o.customerName === 'Acheteur CoVendeur GAS' &&
            o.transferStatus === 'À reverser',
        ),
      ).toBe(true);
    });
  });

  test.describe('Deployment Guide Deliverable (DEPLOY.md)', () => {
    test('F11-T6: provides a complete DEPLOY.md guide documenting clasp push, ScriptProperties, inspectSheetStructure, and Vite static hosting', async () => {
      const deployDocPath = path.join(REPO_ROOT, 'DEPLOY.md');
      const content = await fs.readFile(deployDocPath, 'utf8');

      expect(content.trim().length).toBeGreaterThanOrEqual(500);
      expect(content).toMatch(/clasp/i);
      expect(content).toMatch(/Code\.gs|appsscript\.json/i);
      expect(content).toMatch(/inspectSheetStructure/);
      expect(content).toContain('SPREADSHEET_ID');
      expect(content).toContain('GOOGLE_CLIENT_ID');
      expect(content).toContain('MANAGER_EMAILS');
      expect(content).toContain('CONTRIBUTOR_EMAILS');
      expect(content).toContain('VITE_GAS_WEBAPP_URL');
      expect(content).toMatch(/GitHub Pages|Vercel|Netlify|Cloudflare/i);
    });
  });
});
