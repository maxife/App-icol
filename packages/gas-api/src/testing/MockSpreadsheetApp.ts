import {
  FORBIDDEN_SHEETS,
  SEED_ACCOUNTING_ENTRIES,
  SEED_HARVESTS,
  SEED_JAR_FORMATS,
  SEED_ORDERS,
} from '@app-icol/shared';

export interface MockCellState {
  value: string | number | boolean;
  formulaA1: string;
  formulaR1C1: string;
  numberFormat: string;
}

function emptyCell(): MockCellState {
  return {
    value: '',
    formulaA1: '',
    formulaR1C1: '',
    numberFormat: 'General',
  };
}

function formatDisplayCellValue(cell: MockCellState): string {
  if (cell.value === null || cell.value === undefined || cell.value === '') {
    return '';
  }
  if (typeof cell.value === 'boolean') {
    return cell.value ? 'TRUE' : 'FALSE';
  }
  return String(cell.value);
}

/**
 * Simulates Google Sheets' automatic numeric coercion when a cell does NOT have '@' text format
 * (e.g. stripping leading '0' on '0601020304' -> 601020304 unless setNumberFormat('@') was set first).
 */
function coerceSpreadsheetValue(
  raw: unknown,
  numberFormat: string,
): string | number | boolean {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'boolean' || typeof raw === 'number') return raw;
  const str = String(raw);
  if (numberFormat === '@') {
    return str;
  }
  if (/^0\d+$/.test(str.trim())) {
    return Number(str.trim());
  }
  return str;
}

export class MockSheet {
  private name: string;
  private grid: MockCellState[][] = [];
  public cellAccessCount = 0;

  constructor(name: string, initialRows: Array<Array<string | number | boolean>> = []) {
    this.name = name;
    for (let r = 0; r < initialRows.length; r++) {
      const srcRow = initialRows[r]!;
      const rowCells: MockCellState[] = [];
      for (let c = 0; c < srcRow.length; c++) {
        const raw = srcRow[c]!;
        const cell = emptyCell();
        if (typeof raw === 'string' && raw.startsWith('=')) {
          cell.formulaA1 = raw;
          cell.formulaR1C1 = raw;
          cell.value = '';
        } else {
          cell.value = raw;
        }
        rowCells.push(cell);
      }
      this.grid.push(rowCells);
    }
  }

  public getName(): string {
    return this.name;
  }

  public setName(next: string): MockSheet {
    this.name = next;
    return this;
  }

  private ensureSize(targetRows: number, targetCols: number): void {
    while (this.grid.length < targetRows) {
      this.grid.push([]);
    }
    for (let r = 0; r < targetRows; r++) {
      const row = this.grid[r]!;
      while (row.length < targetCols) {
        row.push(emptyCell());
      }
    }
  }

  public getLastRow(): number {
    for (let r = this.grid.length - 1; r >= 0; r--) {
      const row = this.grid[r]!;
      if (
        row.some(
          (cell) =>
            cell.value !== '' ||
            cell.formulaA1 !== '' ||
            cell.formulaR1C1 !== '',
        )
      ) {
        return r + 1;
      }
    }
    return 0;
  }

  public getLastColumn(): number {
    let maxCol = 0;
    for (const row of this.grid) {
      for (let c = row.length - 1; c >= 0; c--) {
        const cell = row[c]!;
        if (
          cell.value !== '' ||
          cell.formulaA1 !== '' ||
          cell.formulaR1C1 !== ''
        ) {
          if (c + 1 > maxCol) maxCol = c + 1;
          break;
        }
      }
    }
    return maxCol;
  }

  public deleteRow(rowPosition: number): MockSheet {
    this.cellAccessCount += 1;
    if (rowPosition >= 1 && rowPosition <= this.grid.length) {
      this.grid.splice(rowPosition - 1, 1);
    }
    return this;
  }

  public seedCellMeta(
    row1Based: number,
    col1Based: number,
    meta: Partial<MockCellState>,
  ): void {
    this.ensureSize(row1Based, col1Based);
    const cell = this.grid[row1Based - 1]![col1Based - 1]!;
    if (meta.numberFormat !== undefined) cell.numberFormat = meta.numberFormat;
    if (meta.value !== undefined) cell.value = meta.value;
    if (meta.formulaA1 !== undefined) cell.formulaA1 = meta.formulaA1;
    if (meta.formulaR1C1 !== undefined) cell.formulaR1C1 = meta.formulaR1C1;
  }

  public inspectCellMeta(row1Based: number, col1Based: number): MockCellState {
    this.ensureSize(row1Based, col1Based);
    return { ...this.grid[row1Based - 1]![col1Based - 1]! };
  }

  public getRange(
    row: number,
    column: number,
    numRows = 1,
    numColumns = 1,
  ): GoogleAppsScript.Spreadsheet.Range {
    if (row < 1 || column < 1 || numRows < 1 || numColumns < 1) {
      throw new Error(
        `Invalid range coordinates (${row}, ${column}, ${numRows}, ${numColumns})`,
      );
    }
    this.cellAccessCount += 1;
    const sheet = this;

    const rangeObj = {
      getValues(): Array<Array<string | number | boolean>> {
        sheet.ensureSize(row + numRows - 1, column + numColumns - 1);
        const out: Array<Array<string | number | boolean>> = [];
        for (let r = 0; r < numRows; r++) {
          const outRow: Array<string | number | boolean> = [];
          for (let c = 0; c < numColumns; c++) {
            outRow.push(sheet.grid[row - 1 + r]![column - 1 + c]!.value);
          }
          out.push(outRow);
        }
        return out;
      },

      getDisplayValues(): string[][] {
        sheet.ensureSize(row + numRows - 1, column + numColumns - 1);
        const out: string[][] = [];
        for (let r = 0; r < numRows; r++) {
          const outRow: string[] = [];
          for (let c = 0; c < numColumns; c++) {
            outRow.push(
              formatDisplayCellValue(sheet.grid[row - 1 + r]![column - 1 + c]!),
            );
          }
          out.push(outRow);
        }
        return out;
      },

      getFormulas(): string[][] {
        sheet.ensureSize(row + numRows - 1, column + numColumns - 1);
        const out: string[][] = [];
        for (let r = 0; r < numRows; r++) {
          const outRow: string[] = [];
          for (let c = 0; c < numColumns; c++) {
            const cell = sheet.grid[row - 1 + r]![column - 1 + c]!;
            outRow.push(cell.formulaA1 || cell.formulaR1C1 || '');
          }
          out.push(outRow);
        }
        return out;
      },

      getFormulasR1C1(): string[][] {
        sheet.ensureSize(row + numRows - 1, column + numColumns - 1);
        const out: string[][] = [];
        for (let r = 0; r < numRows; r++) {
          const outRow: string[] = [];
          for (let c = 0; c < numColumns; c++) {
            const cell = sheet.grid[row - 1 + r]![column - 1 + c]!;
            outRow.push(cell.formulaR1C1 || cell.formulaA1 || '');
          }
          out.push(outRow);
        }
        return out;
      },

      getFormula(): string {
        sheet.ensureSize(row, column);
        const cell = sheet.grid[row - 1]![column - 1]!;
        return cell.formulaA1 || cell.formulaR1C1 || '';
      },

      getNumberFormat(): string {
        sheet.ensureSize(row, column);
        return sheet.grid[row - 1]![column - 1]!.numberFormat;
      },

      setNumberFormat(fmt: string) {
        sheet.ensureSize(row + numRows - 1, column + numColumns - 1);
        for (let r = 0; r < numRows; r++) {
          for (let c = 0; c < numColumns; c++) {
            sheet.grid[row - 1 + r]![column - 1 + c]!.numberFormat = fmt;
          }
        }
        return rangeObj as unknown as GoogleAppsScript.Spreadsheet.Range;
      },

      setValue(val: unknown) {
        sheet.ensureSize(row + numRows - 1, column + numColumns - 1);
        for (let r = 0; r < numRows; r++) {
          for (let c = 0; c < numColumns; c++) {
            const cell = sheet.grid[row - 1 + r]![column - 1 + c]!;
            cell.formulaA1 = '';
            cell.formulaR1C1 = '';
            cell.value = coerceSpreadsheetValue(val, cell.numberFormat);
          }
        }
        return rangeObj as unknown as GoogleAppsScript.Spreadsheet.Range;
      },

      setValues(values: unknown[][]) {
        sheet.ensureSize(row + numRows - 1, column + numColumns - 1);
        for (let r = 0; r < numRows; r++) {
          for (let c = 0; c < numColumns; c++) {
            const cell = sheet.grid[row - 1 + r]![column - 1 + c]!;
            cell.formulaA1 = '';
            cell.formulaR1C1 = '';
            cell.value = coerceSpreadsheetValue(
              values[r]?.[c],
              cell.numberFormat,
            );
          }
        }
        return rangeObj as unknown as GoogleAppsScript.Spreadsheet.Range;
      },

      setFormula(formula: string) {
        sheet.ensureSize(row + numRows - 1, column + numColumns - 1);
        for (let r = 0; r < numRows; r++) {
          for (let c = 0; c < numColumns; c++) {
            const cell = sheet.grid[row - 1 + r]![column - 1 + c]!;
            cell.formulaA1 = formula;
            cell.formulaR1C1 = formula;
            if (formula) cell.value = '';
          }
        }
        return rangeObj as unknown as GoogleAppsScript.Spreadsheet.Range;
      },

      setFormulaR1C1(formula: string) {
        sheet.ensureSize(row + numRows - 1, column + numColumns - 1);
        for (let r = 0; r < numRows; r++) {
          for (let c = 0; c < numColumns; c++) {
            const cell = sheet.grid[row - 1 + r]![column - 1 + c]!;
            cell.formulaR1C1 = formula;
            cell.formulaA1 = formula;
            if (formula) cell.value = '';
          }
        }
        return rangeObj as unknown as GoogleAppsScript.Spreadsheet.Range;
      },
    };

    return rangeObj as unknown as GoogleAppsScript.Spreadsheet.Range;
  }
}

export class MockSpreadsheet {
  private readonly id: string;
  private readonly name: string;
  private readonly sheets: MockSheet[] = [];

  constructor(id: string, name = 'Vente et reservations Miel (Mock)') {
    this.id = id;
    this.name = name;
  }

  public getId(): string {
    return this.id;
  }

  public getName(): string {
    return this.name;
  }

  public addMockSheet(sheet: MockSheet): MockSheet {
    this.sheets.push(sheet);
    return sheet;
  }

  public getMockSheet(name: string): MockSheet | null {
    return this.sheets.find((s) => s.getName() === name) ?? null;
  }

  public getSheets(): GoogleAppsScript.Spreadsheet.Sheet[] {
    return this.sheets as unknown as GoogleAppsScript.Spreadsheet.Sheet[];
  }

  public getSheetByName(name: string): GoogleAppsScript.Spreadsheet.Sheet | null {
    const found = this.getMockSheet(name);
    return (found as unknown as GoogleAppsScript.Spreadsheet.Sheet) ?? null;
  }
}

export function createSeededMockSpreadsheet(
  spreadsheetId = 'mock-vente-et-reservations-miel',
): MockSpreadsheet {
  const wb = new MockSpreadsheet(spreadsheetId, 'Vente et reservations Miel');

  // 1. ParArticles (Jar formats)
  const parArticlesRows: Array<Array<string | number | boolean>> = [
    ['Code', 'Article', 'Poids (Kg)', 'Actif'],
    ...SEED_JAR_FORMATS.map((f) => [f.code, f.label, f.weightKg, f.active]),
  ];
  wb.addMockSheet(new MockSheet('ParArticles', parArticlesRows));

  // 2. Gestion recoltes
  const gestionRecoltesRows: Array<Array<string | number | boolean>> = [
    [
      'ID',
      'Récolte',
      'Année',
      'Poids prévisionnel (Kg)',
      'Poids réalisé (Kg)',
      'Récolte active',
    ],
    ...SEED_HARVESTS.map((h) => [
      h.id,
      h.label,
      h.year,
      h.forecastWeightKg,
      h.realizedWeightKg === null ? '' : h.realizedWeightKg,
      h.isDefaultActive,
    ]),
  ];
  wb.addMockSheet(new MockSheet('Gestion recoltes', gestionRecoltesRows));

  // 3. PUan (matrix_by_format)
  const puanRows: Array<Array<string | number | boolean>> = [
    ['Récolte', 'Pot 1 kg', 'Pot 500 g', 'Pot 250 g'],
    ...SEED_HARVESTS.map((h) => [
      h.label,
      h.unitPricesEur['1kg'] ?? 0,
      h.unitPricesEur['500g'] ?? 0,
      h.unitPricesEur['250g'] ?? 0,
    ]),
  ];
  wb.addMockSheet(new MockSheet('PUan', puanRows));

  // 4. Ventes Miel (columns_per_format + R1C1 formulas on Poids (Kg) col 10 and Prix col 11 + '@' phone col 4)
  const ventesHeaders = [
    'ID',
    'Date',
    'Client',
    'Téléphone',
    'Lieu / Relais',
    'Récolte',
    'Pot 1 kg',
    'Pot 500 g',
    'Pot 250 g',
    'Poids (Kg)',
    'Prix',
    'Tarif particulier',
    'Statut commande',
    'Statut règlement',
    'Encaissé par tiers',
    'Encaissé par',
    'Statut transfert',
    'Notes',
    'Mis à jour le',
  ];
  const ventesSheet = new MockSheet('Ventes Miel', [ventesHeaders]);
  const weightFormulaR1C1 = '=RC[-3]*1+RC[-2]*0.5+RC[-1]*0.25';
  const priceFormulaR1C1 =
    '=IF(RC[3]="Donné",0,RC[-4]*IFERROR(INDEX(PUan!C2:C2,MATCH(RC[-5],PUan!C1:C1,0)),0)+RC[-3]*IFERROR(INDEX(PUan!C3:C3,MATCH(RC[-5],PUan!C1:C1,0)),0)+RC[-2]*IFERROR(INDEX(PUan!C4:C4,MATCH(RC[-5],PUan!C1:C1,0)),0))';

  SEED_ORDERS.forEach((order, idx) => {
    const r = idx + 2;
    const qtyByFmt = new Map(order.items.map((it) => [it.formatCode, it.quantity]));
    ventesSheet.seedCellMeta(r, 1, { value: order.id });
    ventesSheet.seedCellMeta(r, 2, { value: order.date });
    ventesSheet.seedCellMeta(r, 3, { value: order.customerName });
    ventesSheet.seedCellMeta(r, 4, {
      numberFormat: '@',
      value: order.phone,
    });
    ventesSheet.seedCellMeta(r, 5, { value: order.contextOrRelay });
    ventesSheet.seedCellMeta(r, 6, { value: order.harvestLabel });
    ventesSheet.seedCellMeta(r, 7, { value: qtyByFmt.get('1kg') ?? 0 });
    ventesSheet.seedCellMeta(r, 8, { value: qtyByFmt.get('500g') ?? 0 });
    ventesSheet.seedCellMeta(r, 9, { value: qtyByFmt.get('250g') ?? 0 });
    ventesSheet.seedCellMeta(r, 10, {
      value: order.computedWeightKg,
      formulaA1: weightFormulaR1C1,
      formulaR1C1: weightFormulaR1C1,
    });
    if (order.manualAmountOverrideEur !== null) {
      ventesSheet.seedCellMeta(r, 11, { value: order.effectiveAmountEur });
      ventesSheet.seedCellMeta(r, 12, { value: order.manualAmountOverrideEur });
    } else {
      ventesSheet.seedCellMeta(r, 11, {
        value: order.effectiveAmountEur,
        formulaA1: priceFormulaR1C1,
        formulaR1C1: priceFormulaR1C1,
      });
      ventesSheet.seedCellMeta(r, 12, { value: '' });
    }
    ventesSheet.seedCellMeta(r, 13, { value: order.orderStatus });
    ventesSheet.seedCellMeta(r, 14, { value: order.paymentStatus });
    ventesSheet.seedCellMeta(r, 15, { value: order.collectedByThirdParty });
    ventesSheet.seedCellMeta(r, 16, { value: order.collectorName });
    ventesSheet.seedCellMeta(r, 17, { value: order.transferStatus });
    ventesSheet.seedCellMeta(r, 18, { value: order.notes ?? '' });
    ventesSheet.seedCellMeta(r, 19, { value: order.updatedAt });
  });
  ventesSheet.cellAccessCount = 0;
  wb.addMockSheet(ventesSheet);

  // 5. Comptabilité rucher (with R1C1 formula on Année col 3)
  const comptaHeaders = [
    'ID',
    'Date',
    'Année',
    'Type',
    'Catégorie',
    'Libellé',
    'Montant (€)',
    'Notes',
  ];
  const comptaSheet = new MockSheet('Comptabilité rucher', [comptaHeaders]);
  SEED_ACCOUNTING_ENTRIES.forEach((entry, idx) => {
    const r = idx + 2;
    comptaSheet.seedCellMeta(r, 1, { value: entry.id });
    comptaSheet.seedCellMeta(r, 2, { value: entry.date });
    comptaSheet.seedCellMeta(r, 3, {
      value: entry.year,
      formulaA1: '=YEAR(RC[-1])',
      formulaR1C1: '=YEAR(RC[-1])',
    });
    comptaSheet.seedCellMeta(r, 4, { value: entry.type });
    comptaSheet.seedCellMeta(r, 5, { value: entry.category });
    comptaSheet.seedCellMeta(r, 6, { value: entry.label });
    comptaSheet.seedCellMeta(r, 7, { value: entry.amountEur });
    comptaSheet.seedCellMeta(r, 8, { value: entry.notes ?? '' });
  });
  comptaSheet.cellAccessCount = 0;
  wb.addMockSheet(comptaSheet);

  // 6, 7, 8. Formula-driven read-only summary tabs (ParRecoltes, ParCommandes, ParPaiement)
  wb.addMockSheet(
    new MockSheet('ParRecoltes', [
      ['Récolte', 'Poids Engagé (Kg)', 'CA Payé (€)'],
      ['=QUERY(\'Ventes Miel\'!A:S, "SELECT F, SUM(J), SUM(K) GROUP BY F")', '', ''],
    ]),
  );
  wb.addMockSheet(
    new MockSheet('ParCommandes', [
      ['Statut commande', 'Nombre'],
      ['Réservé', '=COUNTIF(\'Ventes Miel\'!M:M, "Réservé")'],
      ['Distribué', '=COUNTIF(\'Ventes Miel\'!M:M, "Distribué")'],
    ]),
  );
  wb.addMockSheet(
    new MockSheet('ParPaiement', [
      ['Statut règlement', 'Total (€)'],
      ['Payé', '=SUMIF(\'Ventes Miel\'!N:N, "Payé", \'Ventes Miel\'!K:K)'],
      ['Non-payé', '=SUMIF(\'Ventes Miel\'!N:N, "Non-payé", \'Ventes Miel\'!K:K)'],
      ['Donné', '=SUMIF(\'Ventes Miel\'!N:N, "Donné", \'Ventes Miel\'!J:J)'],
    ]),
  );

  // 9..12. The 4 FORBIDDEN legacy/protected tabs (cellAccessCount starts at 0)
  for (const forbiddenName of FORBIDDEN_SHEETS) {
    const fSheet = new MockSheet(forbiddenName, [
      ['PROTECTED_HEADER', 'DO_NOT_TOUCH'],
      ['LEGACY_GLIDE_DATA', 'SENSITIVE'],
    ]);
    fSheet.cellAccessCount = 0;
    wb.addMockSheet(fSheet);
  }

  return wb;
}

export interface InstallMockGasEnvironmentOptions {
  spreadsheetId?: string;
  spreadsheet?: MockSpreadsheet;
  scriptProperties?: Record<string, string>;
  lockShouldFail?: boolean;
}

export interface InstalledMockGasEnvironment {
  spreadsheet: MockSpreadsheet;
  propertiesStore: Map<string, string>;
  cacheStore: Map<string, { value: string; expiresAtMs: number }>;
  uninstall: () => void;
}

export function installMockGasEnvironment(
  options: InstallMockGasEnvironmentOptions = {},
): InstalledMockGasEnvironment {
  const spreadsheetId =
    options.spreadsheetId ??
    options.scriptProperties?.SPREADSHEET_ID ??
    'mock-vente-et-reservations-miel';
  const spreadsheet =
    options.spreadsheet ?? createSeededMockSpreadsheet(spreadsheetId);

  const propertiesStore = new Map<string, string>(
    Object.entries({
      SPREADSHEET_ID: spreadsheetId,
      GOOGLE_CLIENT_ID: 'app-icol-e2e-client.apps.googleusercontent.com',
      MANAGER_EMAILS: 'gestionnaire@app-icol.test,apiculteur@app-icol.test',
      CONTRIBUTOR_EMAILS: 'covendeur@app-icol.test',
      ALLOW_MOCK_GIS_TOKENS: 'true',
      ...(options.scriptProperties ?? {}),
    }),
  );

  const cacheStore = new Map<string, { value: string; expiresAtMs: number }>();

  const g = globalThis as Record<string, unknown>;

  g.SpreadsheetApp = {
    openById(id: string) {
      if (id !== spreadsheet.getId()) {
        throw new Error(`Spreadsheet "${id}" not found`);
      }
      return spreadsheet as unknown as GoogleAppsScript.Spreadsheet.Spreadsheet;
    },
    flush() {},
  };

  g.PropertiesService = {
    getScriptProperties() {
      return {
        getProperty(key: string): string | null {
          return propertiesStore.get(key) ?? null;
        },
        setProperty(key: string, value: string) {
          propertiesStore.set(key, value);
          return this;
        },
        deleteProperty(key: string) {
          propertiesStore.delete(key);
          return this;
        },
        getProperties(): Record<string, string> {
          return Object.fromEntries(propertiesStore.entries());
        },
      };
    },
  };

  g.CacheService = {
    getScriptCache() {
      return {
        get(key: string): string | null {
          const entry = cacheStore.get(key);
          if (!entry) return null;
          if (Date.now() >= entry.expiresAtMs) {
            cacheStore.delete(key);
            return null;
          }
          return entry.value;
        },
        put(key: string, value: string, expirationInSeconds = 600): void {
          cacheStore.set(key, {
            value: String(value),
            expiresAtMs: Date.now() + expirationInSeconds * 1000,
          });
        },
        remove(key: string): void {
          cacheStore.delete(key);
        },
      };
    },
  };

  let lockHeld = false;
  g.LockService = {
    getScriptLock() {
      return {
        tryLock(_timeoutMs: number): boolean {
          if (options.lockShouldFail || lockHeld) return false;
          lockHeld = true;
          return true;
        },
        waitLock(_timeoutMs: number): void {
          if (options.lockShouldFail || lockHeld) {
            throw new Error('Lock timeout');
          }
          lockHeld = true;
        },
        hasLock(): boolean {
          return lockHeld;
        },
        releaseLock(): void {
          lockHeld = false;
        },
      };
    },
  };

  g.ContentService = {
    MimeType: { JSON: 'JSON', TEXT: 'TEXT' },
    createTextOutput(content = '') {
      let text = content;
      return {
        getContent: () => text,
        setContent(next: string) {
          text = next;
          return this;
        },
        setMimeType() {
          return this;
        },
      };
    },
  };

  return {
    spreadsheet,
    propertiesStore,
    cacheStore,
    uninstall() {
      delete g.SpreadsheetApp;
      delete g.PropertiesService;
      delete g.CacheService;
      delete g.LockService;
      delete g.ContentService;
    },
  };
}
