import { describe, expect, it } from 'vitest';
import { SEED_JAR_FORMATS } from '../fixtures/seedData';
import {
  GAS_ACTION_POLICIES,
  GAS_ERROR_CODES,
  GAS_RPC_ACTIONS,
  RepositoryError,
  isGasErrorCode,
  isGasRpcAction,
  isRepositoryError,
} from '../types/api';
import {
  ALLOWED_SHEETS,
  DEFAULT_SCHEMA_CONFIG,
  FORBIDDEN_SHEETS,
  assertAllowedSheet,
  classifySheetAccess,
  detectSalesItemsLayout,
  detectUnitPriceTabLayout,
  resolveSheetHeaders,
} from './schema.config';

describe('schema.config & api contracts (Rule #6 — SheetGuard & HeaderResolver)', () => {
  it('allows all 8 exact ALLOWED_SHEETS and marks ParRecoltes/ParCommandes/ParPaiement read-only summaries', () => {
    expect(ALLOWED_SHEETS).toHaveLength(8);
    expect(ALLOWED_SHEETS).toContain('Gestion recoltes');
    expect(ALLOWED_SHEETS).toContain('Comptabilité rucher');

    for (const sheet of ALLOWED_SHEETS) {
      expect(assertAllowedSheet(sheet)).toBe(sheet);
      const classified = classifySheetAccess(sheet);
      expect(classified.allowed).toBe(true);
      if (classified.allowed) {
        expect(classified.isAlwaysReadOnlySummary).toBe(
          sheet === 'ParRecoltes' || sheet === 'ParCommandes' || sheet === 'ParPaiement',
        );
      }
    }
  });

  it('hard-blocks all 4 FORBIDDEN_SHEETS including escaped Markdown and Unicode dash/case variants', () => {
    expect(FORBIDDEN_SHEETS).toHaveLength(4);
    const forbiddenInputs = [
      ...FORBIDDEN_SHEETS,
      'TEST \\- NE PAS TOUCHER',
      'TEST – NE PAS TOUCHER',
      'TEST — NE PAS TOUCHER',
      '  app: logins ',
      'PARNBPOTS',
    ];

    for (const name of forbiddenInputs) {
      let caught: unknown;
      try {
        assertAllowedSheet(name);
      } catch (err) {
        caught = err;
      }
      expect(isRepositoryError(caught)).toBe(true);
      if (isRepositoryError(caught)) {
        expect(caught.code).toBe('FORBIDDEN_SHEET');
      }
    }
  });

  it('rejects unlisted tabs with UNLISTED_SHEET and provides near-match hints on accent drift', () => {
    const accentedGestion = classifySheetAccess('Gestion récoltes');
    expect(accentedGestion).toEqual({
      allowed: false,
      status: 'UNLISTED',
      errorCode: 'UNLISTED_SHEET',
      nearMatchAllowedSheet: 'Gestion recoltes',
    });

    expect(() => assertAllowedSheet('Feuille 2')).toThrowError(RepositoryError);
    try {
      assertAllowedSheet('Feuille 2');
    } catch (err) {
      expect(isRepositoryError(err)).toBe(true);
      if (isRepositoryError(err)) {
        expect(err.code).toBe('UNLISTED_SHEET');
      }
    }
  });

  it('verifies all 19 GAS_RPC_ACTIONS, 13 GAS_ERROR_CODES, and RBAC policies', () => {
    expect(GAS_RPC_ACTIONS).toHaveLength(19);
    expect(GAS_RPC_ACTIONS).toContain('orders.delete');
    expect(isGasRpcAction('orders.delete')).toBe(true);
    expect(isGasRpcAction('orders.unknown')).toBe(false);

    expect(GAS_ERROR_CODES).toHaveLength(13);
    expect(isGasErrorCode('FORBIDDEN_SHEET')).toBe(true);
    expect(isGasErrorCode('UNKNOWN_ERR')).toBe(false);

    expect(GAS_ACTION_POLICIES['orders.create'].allowedRoles).toEqual([
      'manager',
      'contributor',
    ]);
    expect(GAS_ACTION_POLICIES['orders.delete'].allowedRoles).toEqual(['manager']);
    expect(GAS_ACTION_POLICIES['harvests.create'].allowedRoles).toEqual(['manager']);
    expect(GAS_ACTION_POLICIES['formats.upsert'].allowedRoles).toEqual(['manager']);
    expect(GAS_ACTION_POLICIES['accounting.list'].allowedRoles).toEqual(['manager']);
    expect(GAS_ACTION_POLICIES['admin.inspectSheetStructure'].allowedRoles).toEqual([
      'manager',
    ]);

    const mutatingCount = Object.values(GAS_ACTION_POLICIES).filter((p) => p.isMutation).length;
    expect(mutatingCount).toBe(11);
  });

  it('resolves Row 1 headers dynamically via aliases and detects columns_per_format vs row_per_item layouts', () => {
    const salesHeaders = [
      '🔒 Row ID',
      'Date commande',
      'Acheteur',
      'Portable',
      'Personne relais',
      'Récolte',
      'Pot 1 kg',
      'Pot 500 g',
      'Poids (Kg)',
      'Prix',
      'Statut commande',
      'Statut règlement',
    ];
    const resolved = resolveSheetHeaders(
      salesHeaders,
      DEFAULT_SCHEMA_CONFIG.tabs['Ventes Miel'].fields,
    );
    expect(resolved.missingRequiredFields).toEqual([]);
    expect(resolved.fieldMap.id).toBe(1);
    expect(resolved.fieldMap.customerName).toBe(3);
    expect(resolved.fieldMap.phone).toBe(4);
    expect(resolved.fieldMap.computedWeightKg).toBe(9);
    expect(resolved.fieldMap.amountEur).toBe(10);

    expect(detectSalesItemsLayout(salesHeaders, SEED_JAR_FORMATS)).toBe('columns_per_format');
    expect(
      detectSalesItemsLayout(
        ['Date', 'Client', 'Article', 'Quantité', 'Prix unitaire'],
        SEED_JAR_FORMATS,
      ),
    ).toBe('row_per_item');

    expect(
      detectUnitPriceTabLayout(['Récolte', 'Pot 1 kg', 'Pot 500 g'], SEED_JAR_FORMATS),
    ).toBe('matrix_by_format');
    expect(
      detectUnitPriceTabLayout(['Récolte', 'Article', 'Prix unitaire'], SEED_JAR_FORMATS),
    ).toBe('row_per_format');

    const incomplete = resolveSheetHeaders(
      ['Date', 'Téléphone'],
      DEFAULT_SCHEMA_CONFIG.tabs['Ventes Miel'].fields,
    );
    expect(incomplete.missingRequiredFields).toContain('customerName');
    expect(incomplete.missingRequiredFields).toContain('harvestLabel');
  });
});
