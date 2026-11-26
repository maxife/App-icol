import {
  DEFAULT_SCHEMA_CONFIG,
  RepositoryError,
  SEED_JAR_FORMATS,
  computeOrderTotals,
  extractIsoCalendarYear,
  isAccountingCategory,
  isAccountingEntryType,
  isCategoryValidForType,
  isOrderStatus,
  isPaymentStatus,
  isTransferStatus,
  normalizeHarvestLabel,
  normalizeHeaderKey,
  normalizeOrderTransferState,
  normalizePhoneNumber,
  normalizeSearchText,
  parseFrenchDecimal,
  roundCurrencyEur,
  roundWeightKg,
  slugifyHarvestId,
  type AccountingCategory,
  type AccountingEntry,
  type AccountingEntryType,
  type AppDataset,
  type CreateAccountingEntryInput,
  type CreateHarvestInput,
  type CreateSaleOrderInput,
  type Harvest,
  type JarFormat,
  type OrderLineItemInput,
  type OrderStatus,
  type OrderStatusPatch,
  type PaymentStatus,
  type SaleOrder,
  type SchemaConfig,
  type SheetInspectionReport,
  type TransferStatus,
  type UpdateAccountingEntryInput,
  type UpdateHarvestInput,
  type UpdateSaleOrderInput,
  type UpsertJarFormatInput,
  type UserSession,
} from '@app-icol/shared';
import {
  assertSheetWritable,
  buildSalesFallbackR1C1Templates,
  inspectSheetFormulas,
  inspectWorkbookStructure,
  writeRowPreservingFormulas,
} from './FormulaPreserver';
import {
  detectSalesLayout,
  detectUnitPriceLayout,
  ensureFormatColumn,
  loadSchemaConfig,
  readRow1Headers,
  requireTabHeaders,
  resolveFormatColumns,
} from './HeaderResolver';
import { getAllowedSheet, requireAllowedSheet } from './SheetGuard';

export interface SheetsRepositoryOptions {
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet;
  spreadsheetId: string;
  schemaConfig?: SchemaConfig;
}

interface ParsedOrderRecord {
  order: SaleOrder;
  rowNumbers: number[];
}

interface ParsedHarvestRecord {
  harvest: Harvest;
  rowNumber: number;
}

interface ParsedAccountingRecord {
  entry: AccountingEntry;
  rowNumber: number;
}

function isDateObject(val: unknown): val is Date {
  return (
    val instanceof Date || Object.prototype.toString.call(val) === '[object Date]'
  );
}

function formatLocalDateObject(d: Date): string {
  const y = String(d.getFullYear()).padStart(4, '0');
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function normalizeCellDateToIso(
  rawValue: unknown,
  displayValue?: string,
): string {
  if (isDateObject(rawValue) && !Number.isNaN(rawValue.getTime())) {
    return formatLocalDateObject(rawValue);
  }
  const str = String(displayValue || rawValue || '').trim();
  if (!str) return '';

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const frMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(str);
  if (frMatch) {
    return `${frMatch[3]}-${frMatch[2]}-${frMatch[1]}`;
  }

  return str;
}

export function parseCellBoolean(rawValue: unknown, defaultValue = false): boolean {
  if (rawValue === true) return true;
  if (rawValue === false) return false;
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return defaultValue;
  }
  const norm = normalizeSearchText(String(rawValue));
  if (!norm) return defaultValue;
  if (['true', 'vrai', 'oui', 'yes', '1', 'x', 'actif', 'active'].includes(norm)) {
    return true;
  }
  if (['false', 'faux', 'non', 'no', '0', 'inactif', 'inactive'].includes(norm)) {
    return false;
  }
  return defaultValue;
}

function parseCellOrderStatus(rawValue: unknown): OrderStatus {
  const str = String(rawValue ?? '').trim();
  if (isOrderStatus(str)) return str;
  const norm = normalizeSearchText(str);
  if (norm === 'distribue' || norm === 'livre') return 'Distribué';
  return 'Réservé';
}

function parseCellPaymentStatus(rawValue: unknown): PaymentStatus {
  const str = String(rawValue ?? '').trim();
  if (isPaymentStatus(str)) return str;
  const norm = normalizeSearchText(str);
  if (norm === 'paye' || norm === 'regle') return 'Payé';
  if (norm === 'donne' || norm === 'offert' || norm === 'don') return 'Donné';
  return 'Non-payé';
}

function parseCellTransferStatus(rawValue: unknown): TransferStatus {
  const str = String(rawValue ?? '').trim();
  if (isTransferStatus(str)) return str;
  const norm = normalizeSearchText(str);
  if (norm === 'reverse') return 'Reversé';
  if (norm === 'a reverser') return 'À reverser';
  return 'Non concerné';
}

function inferFormatCodeFromLabelAndWeight(label: string, weightKg: number): string {
  const compactLabel = normalizeSearchText(label).replace(/\s+/g, '');
  if (compactLabel.includes('1kg')) return '1kg';
  if (compactLabel.includes('500g')) return '500g';
  if (compactLabel.includes('250g')) return '250g';
  if (compactLabel.includes('125g')) return '125g';
  const grams = Math.round(weightKg * 1000);
  return grams >= 1000 && grams % 1000 === 0 ? `${grams / 1000}kg` : `${grams}g`;
}

function sortOrdersNewestFirst(orders: readonly SaleOrder[]): SaleOrder[] {
  return [...orders].sort((a, b) => {
    const dateCmp = b.date.localeCompare(a.date);
    if (dateCmp !== 0) return dateCmp;
    const updCmp = b.updatedAt.localeCompare(a.updatedAt);
    return updCmp !== 0 ? updCmp : b.id.localeCompare(a.id);
  });
}

function sortAccountingNewestFirst(
  entries: readonly AccountingEntry[],
): AccountingEntry[] {
  return [...entries].sort((a, b) => {
    const dateCmp = b.date.localeCompare(a.date);
    return dateCmp !== 0 ? dateCmp : b.id.localeCompare(a.id);
  });
}

function generateNextSequentialId(prefix: string, existingIds: readonly string[]): string {
  let maxNum = 0;
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  for (const id of existingIds) {
    const m = re.exec(id);
    if (m) {
      const n = Number(m[1]);
      if (n > maxNum) maxNum = n;
    }
  }
  return `${prefix}-${String(maxNum + 1).padStart(3, '0')}`;
}

export function openConfiguredSheetsRepository(): SheetsRepository {
  if (typeof PropertiesService === 'undefined' || !PropertiesService?.getScriptProperties) {
    throw new RepositoryError(
      'SERVER_MISCONFIGURED',
      'PropertiesService indisponible dans cet environnement Apps Script.',
    );
  }
  const scriptProps = PropertiesService.getScriptProperties();
  const spreadsheetId = (scriptProps.getProperty('SPREADSHEET_ID') ?? '').trim();
  if (!spreadsheetId) {
    throw new RepositoryError(
      'SERVER_MISCONFIGURED',
      'Propriété SPREADSHEET_ID manquante dans les Propriétés du script.',
    );
  }

  const schemaConfig = loadSchemaConfig(
    scriptProps.getProperty('SCHEMA_OVERRIDES_JSON'),
  );

  if (typeof SpreadsheetApp === 'undefined' || !SpreadsheetApp?.openById) {
    throw new RepositoryError(
      'SERVER_MISCONFIGURED',
      'SpreadsheetApp indisponible dans cet environnement Apps Script.',
    );
  }

  let spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet;
  try {
    spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  } catch (err) {
    throw new RepositoryError(
      'SERVER_MISCONFIGURED',
      `Impossible d'ouvrir le classeur Google Sheets (SPREADSHEET_ID="${spreadsheetId}").`,
      err instanceof Error ? err.message : String(err),
    );
  }

  return new SheetsRepository({
    spreadsheet,
    spreadsheetId,
    schemaConfig,
  });
}

export class SheetsRepository {
  private readonly spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet;
  private readonly spreadsheetId: string;
  private readonly schemaConfig: SchemaConfig;

  constructor(options: SheetsRepositoryOptions) {
    this.spreadsheet = options.spreadsheet;
    this.spreadsheetId = options.spreadsheetId;
    this.schemaConfig = options.schemaConfig ?? DEFAULT_SCHEMA_CONFIG;
  }

  // ==========================================================================
  // Admin Structure Inspection
  // ==========================================================================

  public inspectSheetStructure(): SheetInspectionReport {
    return inspectWorkbookStructure(
      this.spreadsheet,
      this.spreadsheetId,
      this.schemaConfig,
    );
  }

  // ==========================================================================
  // Formats (`ParArticles`)
  // ==========================================================================

  public listFormats(): JarFormat[] {
    const sheet = getAllowedSheet(this.spreadsheet, 'ParArticles');
    if (!sheet || sheet.getLastRow() < 2 || sheet.getLastColumn() < 1) {
      return SEED_JAR_FORMATS.map((f) => ({ ...f }));
    }

    const resolved = requireTabHeaders(sheet, 'ParArticles', this.schemaConfig);
    const totalCols = Math.max(resolved.headers.length, sheet.getLastColumn());
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, totalCols).getValues();

    const formats: JarFormat[] = [];
    for (const row of rows) {
      const label = String(row[resolved.fieldMap.label! - 1] ?? '').trim();
      const rawWeight = row[resolved.fieldMap.weightKg! - 1] as
        | string
        | number
        | null
        | undefined;
      const weightKg = parseFrenchDecimal(rawWeight);
      if (!label || weightKg === null || weightKg <= 0) {
        continue;
      }

      const rawCode = resolved.fieldMap.code
        ? String(row[resolved.fieldMap.code - 1] ?? '').trim()
        : '';
      const code = rawCode || inferFormatCodeFromLabelAndWeight(label, weightKg);
      const active = resolved.fieldMap.active
        ? parseCellBoolean(row[resolved.fieldMap.active - 1], true)
        : true;

      formats.push({
        code,
        label,
        weightKg: roundWeightKg(weightKg),
        active,
      });
    }

    return formats.length > 0 ? formats : SEED_JAR_FORMATS.map((f) => ({ ...f }));
  }

  public upsertJarFormat(input: UpsertJarFormatInput): JarFormat {
    const code = String(input?.code ?? '').trim();
    const label = String(input?.label ?? '').trim();
    if (!code || !label) {
      throw new RepositoryError(
        'VALIDATION_ERROR',
        'Le code et le libellé du format sont obligatoires.',
      );
    }
    if (!Number.isFinite(input.weightKg) || input.weightKg <= 0) {
      throw new RepositoryError(
        'VALIDATION_ERROR',
        'Le poids unitaire du pot doit être strictement supérieur à 0 kg.',
      );
    }

    const sheet = requireAllowedSheet(this.spreadsheet, 'ParArticles');
    // Dynamically checks whether ParArticles contains summary formulas -> READ_ONLY_SUMMARY_SHEET
    assertSheetWritable(sheet, 'ParArticles', this.schemaConfig);

    const resolved = requireTabHeaders(sheet, 'ParArticles', this.schemaConfig);
    const totalCols = Math.max(resolved.headers.length, sheet.getLastColumn());
    const formulaInspection = inspectSheetFormulas(sheet, resolved.headers);

    let targetRow = sheet.getLastRow() + 1;
    let resolvedCode = code;

    if (sheet.getLastRow() >= 2) {
      const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, totalCols).getValues();
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!;
        const rowLabel = String(row[resolved.fieldMap.label! - 1] ?? '').trim();
        const rowWeight =
          parseFrenchDecimal(
            row[resolved.fieldMap.weightKg! - 1] as string | number | null,
          ) ?? 0;
        const rowCode = resolved.fieldMap.code
          ? String(row[resolved.fieldMap.code - 1] ?? '').trim()
          : inferFormatCodeFromLabelAndWeight(rowLabel, rowWeight);

        if (rowCode && rowCode.toLowerCase() === code.toLowerCase()) {
          targetRow = i + 2;
          resolvedCode = rowCode;
          break;
        }
      }
    }

    const normalized: JarFormat = {
      code: resolvedCode,
      label,
      weightKg: roundWeightKg(input.weightKg),
      active: Boolean(input.active),
    };

    const valuesByCol = new Map<number, string | number | boolean>();
    if (resolved.fieldMap.code) {
      valuesByCol.set(resolved.fieldMap.code, normalized.code);
    }
    valuesByCol.set(resolved.fieldMap.label!, normalized.label);
    valuesByCol.set(resolved.fieldMap.weightKg!, normalized.weightKg);
    if (resolved.fieldMap.active) {
      valuesByCol.set(resolved.fieldMap.active, normalized.active);
    }

    writeRowPreservingFormulas({
      sheet,
      sheetName: 'ParArticles',
      rowNumber: targetRow,
      totalCols,
      valuesByCol,
      formulaInspection,
      schemaConfig: this.schemaConfig,
    });

    return normalized;
  }

  // ==========================================================================
  // Harvests (`Gestion recoltes` + `PUan`)
  // ==========================================================================

  private readUnitPricesByHarvest(
    formats: readonly JarFormat[],
  ): Map<string, Record<string, number>> {
    const result = new Map<string, Record<string, number>>();
    const sheet = getAllowedSheet(this.spreadsheet, 'PUan');
    if (!sheet || sheet.getLastRow() < 2 || sheet.getLastColumn() < 1) {
      return result;
    }

    const row1Headers = readRow1Headers(sheet);
    const layout = detectUnitPriceLayout(row1Headers, formats, this.schemaConfig);
    const resolved = requireTabHeaders(sheet, 'PUan', this.schemaConfig, {
      unitPriceLayout: layout,
    });
    const totalCols = Math.max(row1Headers.length, sheet.getLastColumn());
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, totalCols).getValues();

    if (layout === 'matrix_by_format') {
      const reserved = new Set<number>(Object.values(resolved.fieldMap));
      const { formatColMap } = resolveFormatColumns(
        row1Headers,
        formats,
        this.schemaConfig,
        reserved,
      );
      const harvestCol = resolved.fieldMap.harvestLabel!;

      for (const row of rows) {
        const harvestLabel = normalizeHarvestLabel(String(row[harvestCol - 1] ?? ''));
        if (!harvestLabel) continue;
        const key = harvestLabel.toLowerCase();
        const prices: Record<string, number> = result.get(key) ?? {};
        for (const [fmtCode, colIdx] of Object.entries(formatColMap)) {
          const parsedPrice = parseFrenchDecimal(
            row[colIdx - 1] as string | number | null,
          );
          if (parsedPrice !== null && parsedPrice >= 0) {
            prices[fmtCode] = roundCurrencyEur(parsedPrice);
          }
        }
        result.set(key, prices);
      }
    } else {
      // row_per_format layout
      const harvestCol = resolved.fieldMap.harvestLabel!;
      const formatCol = resolved.fieldMap.formatCode!;
      const priceCol = resolved.fieldMap.unitPriceEur!;

      for (const row of rows) {
        const harvestLabel = normalizeHarvestLabel(String(row[harvestCol - 1] ?? ''));
        const rawFmt = String(row[formatCol - 1] ?? '').trim();
        const parsedPrice = parseFrenchDecimal(
          row[priceCol - 1] as string | number | null,
        );
        if (!harvestLabel || !rawFmt || parsedPrice === null || parsedPrice < 0) {
          continue;
        }
        const matchedFmt = formats.find(
          (f) =>
            f.code.toLowerCase() === rawFmt.toLowerCase() ||
            normalizeHeaderKey(f.label) === normalizeHeaderKey(rawFmt),
        );
        const fmtCode = matchedFmt ? matchedFmt.code : rawFmt;
        const key = harvestLabel.toLowerCase();
        const prices = result.get(key) ?? {};
        prices[fmtCode] = roundCurrencyEur(parsedPrice);
        result.set(key, prices);
      }
    }

    return result;
  }

  private writeUnitPricesForHarvest(
    harvestLabel: string,
    unitPricesEur: Readonly<Record<string, number>>,
    formats: readonly JarFormat[],
    previousHarvestLabel?: string,
  ): void {
    const sheet = getAllowedSheet(this.spreadsheet, 'PUan');
    if (!sheet) return;

    assertSheetWritable(sheet, 'PUan', this.schemaConfig);
    let row1Headers = readRow1Headers(sheet);
    const layout = detectUnitPriceLayout(row1Headers, formats, this.schemaConfig);
    let resolved = requireTabHeaders(sheet, 'PUan', this.schemaConfig, {
      unitPriceLayout: layout,
    });

    const matchKeys = new Set<string>([harvestLabel.toLowerCase()]);
    if (previousHarvestLabel) {
      matchKeys.add(normalizeHarvestLabel(previousHarvestLabel).toLowerCase());
    }

    if (layout === 'matrix_by_format') {
      const reserved = new Set<number>(Object.values(resolved.fieldMap));
      // Ensure columns exist for every format with a configured price
      for (const code of Object.keys(unitPricesEur)) {
        const fmt = formats.find((f) => f.code === code) ?? {
          code,
          label: `Pot ${code}`,
          weightKg: 1,
          active: true,
        };
        ensureFormatColumn(sheet, fmt, this.schemaConfig, reserved);
      }

      row1Headers = readRow1Headers(sheet);
      resolved = requireTabHeaders(sheet, 'PUan', this.schemaConfig, {
        unitPriceLayout: layout,
      });
      const { formatColMap } = resolveFormatColumns(
        row1Headers,
        formats,
        this.schemaConfig,
        new Set<number>(Object.values(resolved.fieldMap)),
      );
      const totalCols = Math.max(row1Headers.length, sheet.getLastColumn());
      const formulaInspection = inspectSheetFormulas(sheet, row1Headers);
      const harvestCol = resolved.fieldMap.harvestLabel!;

      let targetRow = sheet.getLastRow() + 1;
      if (sheet.getLastRow() >= 2) {
        const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, totalCols).getValues();
        for (let i = 0; i < rows.length; i++) {
          const rowLabel = normalizeHarvestLabel(
            String(rows[i]![harvestCol - 1] ?? ''),
          ).toLowerCase();
          if (matchKeys.has(rowLabel)) {
            targetRow = i + 2;
            break;
          }
        }
      }

      const valuesByCol = new Map<number, string | number | boolean>();
      valuesByCol.set(harvestCol, harvestLabel);
      for (const [code, price] of Object.entries(unitPricesEur)) {
        const colIdx = formatColMap[code];
        if (colIdx !== undefined) {
          valuesByCol.set(colIdx, roundCurrencyEur(price));
        }
      }

      writeRowPreservingFormulas({
        sheet,
        sheetName: 'PUan',
        rowNumber: targetRow,
        totalCols,
        valuesByCol,
        formulaInspection,
        schemaConfig: this.schemaConfig,
      });
    } else {
      // row_per_format layout
      const totalCols = Math.max(row1Headers.length, sheet.getLastColumn());
      const formulaInspection = inspectSheetFormulas(sheet, row1Headers);
      const harvestCol = resolved.fieldMap.harvestLabel!;
      const formatCol = resolved.fieldMap.formatCode!;
      const priceCol = resolved.fieldMap.unitPriceEur!;

      const existingRowByFormat = new Map<string, number>();
      if (sheet.getLastRow() >= 2) {
        const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, totalCols).getValues();
        for (let i = 0; i < rows.length; i++) {
          const rLabel = normalizeHarvestLabel(
            String(rows[i]![harvestCol - 1] ?? ''),
          ).toLowerCase();
          if (!matchKeys.has(rLabel)) continue;

          if (previousHarvestLabel && rLabel !== harvestLabel.toLowerCase()) {
            sheet.getRange(i + 2, harvestCol, 1, 1).setValue(harvestLabel);
          }

          const rawFmt = String(rows[i]![formatCol - 1] ?? '').trim();
          const matchedFmt = formats.find(
            (f) =>
              f.code.toLowerCase() === rawFmt.toLowerCase() ||
              normalizeHeaderKey(f.label) === normalizeHeaderKey(rawFmt),
          );
          const fmtCode = matchedFmt ? matchedFmt.code : rawFmt;
          existingRowByFormat.set(fmtCode, i + 2);
        }
      }

      for (const [code, price] of Object.entries(unitPricesEur)) {
        const targetRow = existingRowByFormat.get(code) ?? sheet.getLastRow() + 1;
        const valuesByCol = new Map<number, string | number | boolean>([
          [harvestCol, harvestLabel],
          [formatCol, code],
          [priceCol, roundCurrencyEur(price)],
        ]);
        writeRowPreservingFormulas({
          sheet,
          sheetName: 'PUan',
          rowNumber: targetRow,
          totalCols,
          valuesByCol,
          formulaInspection,
          schemaConfig: this.schemaConfig,
        });
      }
    }
  }

  private readHarvestRecordsInternal(
    formats: readonly JarFormat[],
  ): ParsedHarvestRecord[] {
    const sheet = requireAllowedSheet(this.spreadsheet, 'Gestion recoltes');
    if (sheet.getLastRow() < 2 || sheet.getLastColumn() < 1) {
      return [];
    }

    const resolved = requireTabHeaders(sheet, 'Gestion recoltes', this.schemaConfig);
    const totalCols = Math.max(resolved.headers.length, sheet.getLastColumn());
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, totalCols).getValues();
    const unitPricesMap = this.readUnitPricesByHarvest(formats);

    const records: ParsedHarvestRecord[] = [];
    const seenIds = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const label = normalizeHarvestLabel(
        String(row[resolved.fieldMap.label! - 1] ?? ''),
      );
      if (!label) continue;

      const rawId = resolved.fieldMap.id
        ? String(row[resolved.fieldMap.id - 1] ?? '').trim()
        : '';
      let id = rawId || slugifyHarvestId(label);
      if (seenIds.has(id)) {
        id = `${id}-${i + 2}`;
      }
      seenIds.add(id);

      const rawYear = resolved.fieldMap.year
        ? parseFrenchDecimal(row[resolved.fieldMap.year - 1] as string | number | null)
        : null;
      const yearFromLabel = /\b(20\d{2})\b/.exec(label);
      const year =
        rawYear !== null && Number.isFinite(rawYear)
          ? Math.trunc(rawYear)
          : yearFromLabel
            ? Number(yearFromLabel[1])
            : new Date().getFullYear();

      const rawForecast = resolved.fieldMap.forecastWeightKg
        ? parseFrenchDecimal(
            row[resolved.fieldMap.forecastWeightKg - 1] as string | number | null,
          )
        : null;
      const forecastWeightKg =
        rawForecast !== null && rawForecast >= 0 ? roundWeightKg(rawForecast) : 0;

      // Preserve critical invariant: empty cell => null (forecast fallback); 0 => 0 kg (crop failure)
      let realizedWeightKg: number | null = null;
      if (resolved.fieldMap.realizedWeightKg) {
        const cellVal = row[resolved.fieldMap.realizedWeightKg - 1];
        if (cellVal !== null && cellVal !== undefined && String(cellVal).trim() !== '') {
          const parsedRealized = parseFrenchDecimal(cellVal as string | number);
          if (parsedRealized !== null && parsedRealized >= 0) {
            realizedWeightKg = roundWeightKg(parsedRealized);
          }
        }
      }

      const isDefaultActive = resolved.fieldMap.isDefaultActive
        ? parseCellBoolean(row[resolved.fieldMap.isDefaultActive - 1], false)
        : false;

      const unitPricesEur = { ...(unitPricesMap.get(label.toLowerCase()) ?? {}) };

      records.push({
        rowNumber: i + 2,
        harvest: {
          id,
          label,
          year,
          forecastWeightKg,
          realizedWeightKg,
          unitPricesEur,
          isDefaultActive,
        },
      });
    }

    return records;
  }

  public listHarvests(): Harvest[] {
    const formats = this.listFormats();
    return this.readHarvestRecordsInternal(formats).map((r) => r.harvest);
  }

  public createHarvest(input: CreateHarvestInput): Harvest {
    const label = normalizeHarvestLabel(input?.label);
    if (!label) {
      throw new RepositoryError(
        'VALIDATION_ERROR',
        'Le nom de la récolte est obligatoire.',
      );
    }
    if (!Number.isFinite(input.year) || input.year < 1900 || input.year > 2200) {
      throw new RepositoryError('VALIDATION_ERROR', 'Année de récolte invalide.');
    }
    if (!Number.isFinite(input.forecastWeightKg) || input.forecastWeightKg < 0) {
      throw new RepositoryError(
        'VALIDATION_ERROR',
        'Le poids prévisionnel doit être positif ou nul.',
      );
    }
    if (
      input.realizedWeightKg !== null &&
      input.realizedWeightKg !== undefined &&
      (!Number.isFinite(input.realizedWeightKg) || input.realizedWeightKg < 0)
    ) {
      throw new RepositoryError(
        'VALIDATION_ERROR',
        'Le poids réalisé doit être positif, nul ou vide.',
      );
    }

    const formats = this.listFormats();
    const existingRecords = this.readHarvestRecordsInternal(formats);
    const duplicate = existingRecords.some(
      (r) => r.harvest.label.toLowerCase() === label.toLowerCase(),
    );
    if (duplicate) {
      throw new RepositoryError(
        'VALIDATION_ERROR',
        `Une récolte nommée "${label}" existe déjà.`,
      );
    }

    const unitPricesEur: Record<string, number> = {};
    for (const [code, price] of Object.entries(input.unitPricesEur ?? {})) {
      if (!Number.isFinite(price) || price < 0) {
        throw new RepositoryError(
          'VALIDATION_ERROR',
          `Tarif invalide pour le format ${code}.`,
        );
      }
      unitPricesEur[code] = roundCurrencyEur(price);
    }

    let id = slugifyHarvestId(label);
    if (existingRecords.some((r) => r.harvest.id === id)) {
      id = `${id}-${Date.now()}`;
    }

    const sheet = requireAllowedSheet(this.spreadsheet, 'Gestion recoltes');
    assertSheetWritable(sheet, 'Gestion recoltes', this.schemaConfig);
    const resolved = requireTabHeaders(sheet, 'Gestion recoltes', this.schemaConfig);
    const totalCols = Math.max(resolved.headers.length, sheet.getLastColumn());
    const formulaInspection = inspectSheetFormulas(sheet, resolved.headers);

    if (input.isDefaultActive && resolved.fieldMap.isDefaultActive) {
      for (const rec of existingRecords) {
        if (rec.harvest.isDefaultActive) {
          sheet
            .getRange(rec.rowNumber, resolved.fieldMap.isDefaultActive, 1, 1)
            .setValue(false);
        }
      }
    }

    const created: Harvest = {
      id,
      label,
      year: Math.trunc(input.year),
      forecastWeightKg: roundWeightKg(input.forecastWeightKg),
      realizedWeightKg:
        input.realizedWeightKg === null || input.realizedWeightKg === undefined
          ? null
          : roundWeightKg(input.realizedWeightKg),
      unitPricesEur,
      isDefaultActive: Boolean(input.isDefaultActive),
    };

    const targetRow = sheet.getLastRow() + 1;
    const valuesByCol = new Map<number, string | number | boolean>();
    if (resolved.fieldMap.id) valuesByCol.set(resolved.fieldMap.id, created.id);
    valuesByCol.set(resolved.fieldMap.label!, created.label);
    if (resolved.fieldMap.year) valuesByCol.set(resolved.fieldMap.year, created.year);
    if (resolved.fieldMap.forecastWeightKg) {
      valuesByCol.set(resolved.fieldMap.forecastWeightKg, created.forecastWeightKg);
    }
    if (resolved.fieldMap.realizedWeightKg) {
      valuesByCol.set(
        resolved.fieldMap.realizedWeightKg,
        created.realizedWeightKg === null ? '' : created.realizedWeightKg,
      );
    }
    if (resolved.fieldMap.isDefaultActive) {
      valuesByCol.set(resolved.fieldMap.isDefaultActive, created.isDefaultActive);
    }

    writeRowPreservingFormulas({
      sheet,
      sheetName: 'Gestion recoltes',
      rowNumber: targetRow,
      totalCols,
      valuesByCol,
      formulaInspection,
      schemaConfig: this.schemaConfig,
    });

    this.writeUnitPricesForHarvest(created.label, created.unitPricesEur, formats);
    return created;
  }

  public updateHarvest(id: string, input: UpdateHarvestInput): Harvest {
    const formats = this.listFormats();
    const existingRecords = this.readHarvestRecordsInternal(formats);
    const target = existingRecords.find((r) => r.harvest.id === id);
    if (!target) {
      throw new RepositoryError('NOT_FOUND', `Récolte "${id}" introuvable.`);
    }

    const existing = target.harvest;
    const nextLabel =
      input.label !== undefined ? normalizeHarvestLabel(input.label) : existing.label;
    if (!nextLabel) {
      throw new RepositoryError(
        'VALIDATION_ERROR',
        'Le nom de la récolte est obligatoire.',
      );
    }

    const duplicate = existingRecords.some(
      (r) =>
        r.harvest.id !== id &&
        r.harvest.label.toLowerCase() === nextLabel.toLowerCase(),
    );
    if (duplicate) {
      throw new RepositoryError(
        'VALIDATION_ERROR',
        `Une récolte nommée "${nextLabel}" existe déjà.`,
      );
    }

    const nextYear =
      input.year !== undefined ? Math.trunc(input.year) : existing.year;
    if (!Number.isFinite(nextYear) || nextYear < 1900 || nextYear > 2200) {
      throw new RepositoryError('VALIDATION_ERROR', 'Année de récolte invalide.');
    }

    const nextForecast =
      input.forecastWeightKg !== undefined
        ? input.forecastWeightKg
        : existing.forecastWeightKg;
    if (!Number.isFinite(nextForecast) || nextForecast < 0) {
      throw new RepositoryError(
        'VALIDATION_ERROR',
        'Le poids prévisionnel doit être positif ou nul.',
      );
    }

    const nextRealized =
      input.realizedWeightKg !== undefined
        ? input.realizedWeightKg
        : existing.realizedWeightKg;
    if (
      nextRealized !== null &&
      (!Number.isFinite(nextRealized) || nextRealized < 0)
    ) {
      throw new RepositoryError(
        'VALIDATION_ERROR',
        'Le poids réalisé doit être positif, nul ou vide.',
      );
    }

    const nextUnitPrices: Record<string, number> = { ...existing.unitPricesEur };
    if (input.unitPricesEur) {
      for (const [code, price] of Object.entries(input.unitPricesEur)) {
        if (!Number.isFinite(price) || price < 0) {
          throw new RepositoryError(
            'VALIDATION_ERROR',
            `Tarif invalide pour le format ${code}.`,
          );
        }
        nextUnitPrices[code] = roundCurrencyEur(price);
      }
    }

    const nextDefault =
      input.isDefaultActive !== undefined
        ? Boolean(input.isDefaultActive)
        : existing.isDefaultActive;

    const sheet = requireAllowedSheet(this.spreadsheet, 'Gestion recoltes');
    assertSheetWritable(sheet, 'Gestion recoltes', this.schemaConfig);
    const resolved = requireTabHeaders(sheet, 'Gestion recoltes', this.schemaConfig);
    const totalCols = Math.max(resolved.headers.length, sheet.getLastColumn());
    const formulaInspection = inspectSheetFormulas(sheet, resolved.headers);

    if (input.isDefaultActive === true && resolved.fieldMap.isDefaultActive) {
      for (const rec of existingRecords) {
        if (rec.harvest.id !== id && rec.harvest.isDefaultActive) {
          sheet
            .getRange(rec.rowNumber, resolved.fieldMap.isDefaultActive, 1, 1)
            .setValue(false);
        }
      }
    }

    const updated: Harvest = {
      id: existing.id,
      label: nextLabel,
      year: nextYear,
      forecastWeightKg: roundWeightKg(nextForecast),
      realizedWeightKg: nextRealized === null ? null : roundWeightKg(nextRealized),
      unitPricesEur: nextUnitPrices,
      isDefaultActive: nextDefault,
    };

    const valuesByCol = new Map<number, string | number | boolean>();
    if (resolved.fieldMap.id) valuesByCol.set(resolved.fieldMap.id, updated.id);
    valuesByCol.set(resolved.fieldMap.label!, updated.label);
    if (resolved.fieldMap.year) valuesByCol.set(resolved.fieldMap.year, updated.year);
    if (resolved.fieldMap.forecastWeightKg) {
      valuesByCol.set(resolved.fieldMap.forecastWeightKg, updated.forecastWeightKg);
    }
    if (resolved.fieldMap.realizedWeightKg) {
      valuesByCol.set(
        resolved.fieldMap.realizedWeightKg,
        updated.realizedWeightKg === null ? '' : updated.realizedWeightKg,
      );
    }
    if (resolved.fieldMap.isDefaultActive) {
      valuesByCol.set(resolved.fieldMap.isDefaultActive, updated.isDefaultActive);
    }

    writeRowPreservingFormulas({
      sheet,
      sheetName: 'Gestion recoltes',
      rowNumber: target.rowNumber,
      totalCols,
      valuesByCol,
      formulaInspection,
      schemaConfig: this.schemaConfig,
    });

    this.writeUnitPricesForHarvest(
      updated.label,
      updated.unitPricesEur,
      formats,
      existing.label,
    );

    if (normalizeHarvestLabel(existing.label) !== updated.label) {
      this.renameHarvestInSalesSheet(existing.label, updated.label);
    }

    return updated;
  }

  private renameHarvestInSalesSheet(oldLabel: string, newLabel: string): void {
    const salesSheet = getAllowedSheet(this.spreadsheet, 'Ventes Miel');
    if (!salesSheet || salesSheet.getLastRow() < 2) return;

    const headers = readRow1Headers(salesSheet);
    const formats = this.listFormats();
    const salesLayout = detectSalesLayout(headers, formats, this.schemaConfig);
    const resolved = requireTabHeaders(salesSheet, 'Ventes Miel', this.schemaConfig, {
      salesLayout,
    });
    const harvestCol = resolved.fieldMap.harvestLabel;
    if (!harvestCol) return;

    const oldNorm = normalizeHarvestLabel(oldLabel);
    const values = salesSheet
      .getRange(2, harvestCol, salesSheet.getLastRow() - 1, 1)
      .getValues();
    for (let i = 0; i < values.length; i++) {
      if (normalizeHarvestLabel(String(values[i]![0] ?? '')) === oldNorm) {
        salesSheet.getRange(i + 2, harvestCol, 1, 1).setValue(newLabel);
      }
    }
  }

  public setDefaultActiveHarvest(id: string): Harvest[] {
    const formats = this.listFormats();
    const existingRecords = this.readHarvestRecordsInternal(formats);
    const target = existingRecords.find((r) => r.harvest.id === id);
    if (!target) {
      throw new RepositoryError('NOT_FOUND', `Récolte "${id}" introuvable.`);
    }

    const sheet = requireAllowedSheet(this.spreadsheet, 'Gestion recoltes');
    assertSheetWritable(sheet, 'Gestion recoltes', this.schemaConfig);
    const resolved = requireTabHeaders(sheet, 'Gestion recoltes', this.schemaConfig);
    const defaultCol = resolved.fieldMap.isDefaultActive;

    if (defaultCol) {
      for (const rec of existingRecords) {
        sheet.getRange(rec.rowNumber, defaultCol, 1, 1).setValue(rec.harvest.id === id);
      }
    }

    return existingRecords.map((r) => ({
      ...r.harvest,
      isDefaultActive: r.harvest.id === id,
    }));
  }

  // ==========================================================================
  // Orders (`Ventes Miel` — both `columns_per_format` and `row_per_item`)
  // ==========================================================================

  private readOrderRecordsInternal(
    formats: readonly JarFormat[],
    harvests: readonly Harvest[],
  ): ParsedOrderRecord[] {
    const sheet = requireAllowedSheet(this.spreadsheet, 'Ventes Miel');
    if (sheet.getLastRow() < 2 || sheet.getLastColumn() < 1) {
      return [];
    }

    const row1Headers = readRow1Headers(sheet);
    const salesLayout = detectSalesLayout(row1Headers, formats, this.schemaConfig);
    const resolved = requireTabHeaders(sheet, 'Ventes Miel', this.schemaConfig, {
      salesLayout,
    });
    const totalCols = Math.max(row1Headers.length, sheet.getLastColumn());
    const formulaInspection = inspectSheetFormulas(sheet, row1Headers);

    const dataRange = sheet.getRange(2, 1, sheet.getLastRow() - 1, totalCols);
    const values = dataRange.getValues();
    const displayValues =
      typeof dataRange.getDisplayValues === 'function'
        ? dataRange.getDisplayValues()
        : values.map((r) => r.map((c) => String(c ?? '')));
    const formulas = dataRange.getFormulas();

    const harvestByNormLabel = new Map<string, Harvest>();
    for (const h of harvests) {
      harvestByNormLabel.set(normalizeHarvestLabel(h.label).toLowerCase(), h);
    }

    const fm = resolved.fieldMap;

    if (salesLayout === 'columns_per_format') {
      const reserved = new Set<number>(Object.values(fm));
      const { formatColMap } = resolveFormatColumns(
        row1Headers,
        formats,
        this.schemaConfig,
        reserved,
      );

      const records: ParsedOrderRecord[] = [];
      for (let i = 0; i < values.length; i++) {
        const rowNumber = i + 2;
        const row = values[i]!;
        const disp = displayValues[i] ?? [];
        const fRow = formulas[i] ?? [];

        const customerName = String(row[fm.customerName! - 1] ?? '').trim();
        const date = normalizeCellDateToIso(
          row[fm.date! - 1],
          disp[fm.date! - 1],
        );

        const itemsInput: OrderLineItemInput[] = [];
        for (const fmt of formats) {
          const colIdx = formatColMap[fmt.code];
          if (colIdx === undefined) continue;
          const rawQty = parseFrenchDecimal(
            row[colIdx - 1] as string | number | null,
          );
          const qty = rawQty !== null ? Math.round(rawQty) : 0;
          if (qty > 0) {
            itemsInput.push({ formatCode: fmt.code, quantity: qty });
          }
        }

        if (!customerName && !date && itemsInput.length === 0) {
          continue;
        }

        const harvestLabel = normalizeHarvestLabel(
          String(row[fm.harvestLabel! - 1] ?? ''),
        );
        const harvest = harvestByNormLabel.get(harvestLabel.toLowerCase());
        const orderStatus = parseCellOrderStatus(row[fm.orderStatus! - 1]);
        const paymentStatus = parseCellPaymentStatus(row[fm.paymentStatus! - 1]);

        let manualOverride: number | null = null;
        if (fm.manualAmountOverrideEur) {
          const rawOverride = row[fm.manualAmountOverrideEur - 1];
          if (
            rawOverride !== null &&
            rawOverride !== undefined &&
            String(rawOverride).trim() !== ''
          ) {
            const parsed = parseFrenchDecimal(rawOverride as string | number);
            if (parsed !== null && parsed >= 0) {
              manualOverride = roundCurrencyEur(parsed);
            }
          }
        } else if (
          fm.amountEur &&
          formulaInspection.r1c1FormulaCols.has(fm.amountEur) &&
          !String(fRow[fm.amountEur - 1] ?? '').startsWith('=') &&
          paymentStatus !== 'Donné'
        ) {
          const rawAmount = row[fm.amountEur - 1];
          if (
            rawAmount !== null &&
            rawAmount !== undefined &&
            String(rawAmount).trim() !== ''
          ) {
            const parsed = parseFrenchDecimal(rawAmount as string | number);
            if (parsed !== null && parsed >= 0) {
              manualOverride = roundCurrencyEur(parsed);
            }
          }
        }

        const totals = computeOrderTotals(
          itemsInput,
          harvest,
          formats,
          paymentStatus,
          manualOverride,
        );

        const phone = fm.phone
          ? normalizePhoneNumber(disp[fm.phone - 1] || (row[fm.phone - 1] as string | number))
          : '';
        const contextOrRelay = fm.contextOrRelay
          ? String(row[fm.contextOrRelay - 1] ?? '').trim()
          : '';
        const rawThirdParty = fm.collectedByThirdParty
          ? parseCellBoolean(row[fm.collectedByThirdParty - 1], false)
          : undefined;
        const rawCollector = fm.collectorName
          ? String(row[fm.collectorName - 1] ?? '').trim()
          : undefined;
        const rawTransfer = fm.transferStatus
          ? parseCellTransferStatus(row[fm.transferStatus - 1])
          : undefined;

        const transfer = normalizeOrderTransferState(
          paymentStatus,
          rawThirdParty,
          rawCollector,
          rawTransfer,
          null,
        );

        const notes = fm.notes ? String(row[fm.notes - 1] ?? '').trim() : '';
        const rawUpdatedAt = fm.updatedAt
          ? String(row[fm.updatedAt - 1] ?? '').trim()
          : '';
        const rawId = fm.id ? String(row[fm.id - 1] ?? '').trim() : '';
        const id = rawId || `row-${rowNumber}`;

        records.push({
          rowNumbers: [rowNumber],
          order: {
            id,
            sheetRowNumber: rowNumber,
            date,
            customerName,
            phone,
            contextOrRelay,
            harvestLabel: harvest ? harvest.label : harvestLabel,
            items: totals.items,
            computedWeightKg: totals.computedWeightKg,
            computedAmountEur: totals.computedAmountEur,
            manualAmountOverrideEur: totals.manualAmountOverrideEur,
            effectiveAmountEur: totals.effectiveAmountEur,
            orderStatus,
            paymentStatus,
            collectedByThirdParty: transfer.collectedByThirdParty,
            collectorName: transfer.collectorName,
            transferStatus: transfer.transferStatus,
            notes: notes || undefined,
            updatedAt: rawUpdatedAt || `${date || '2026-01-01'}T10:00:00.000Z`,
          },
        });
      }
      return records;
    }

    // row_per_item layout
    interface GroupedRowAcc {
      id: string;
      rowNumbers: number[];
      date: string;
      customerName: string;
      phone: string;
      contextOrRelay: string;
      harvestLabel: string;
      itemsInput: OrderLineItemInput[];
      manualOverride: number | null;
      orderStatus: OrderStatus;
      paymentStatus: PaymentStatus;
      rawThirdParty?: boolean;
      rawCollector?: string;
      rawTransfer?: TransferStatus;
      notes: string;
      updatedAt: string;
    }

    const groups = new Map<string, GroupedRowAcc>();

    for (let i = 0; i < values.length; i++) {
      const rowNumber = i + 2;
      const row = values[i]!;
      const disp = displayValues[i] ?? [];

      const customerName = String(row[fm.customerName! - 1] ?? '').trim();
      const date = normalizeCellDateToIso(row[fm.date! - 1], disp[fm.date! - 1]);
      const rawFmt = String(row[fm.itemFormat! - 1] ?? '').trim();
      const rawQty = parseFrenchDecimal(
        row[fm.itemQuantity! - 1] as string | number | null,
      );
      const qty = rawQty !== null ? Math.round(rawQty) : 0;

      if (!customerName && !date && qty <= 0) {
        continue;
      }

      const rawId = fm.id ? String(row[fm.id - 1] ?? '').trim() : '';
      const rawGroupId = fm.orderGroupId
        ? String(row[fm.orderGroupId - 1] ?? '').trim()
        : '';
      const harvestLabel = normalizeHarvestLabel(
        String(row[fm.harvestLabel! - 1] ?? ''),
      );
      const groupKey = rawId || rawGroupId || `row-${rowNumber}`;

      const matchedFmt = formats.find(
        (f) =>
          f.code.toLowerCase() === rawFmt.toLowerCase() ||
          normalizeHeaderKey(f.label) === normalizeHeaderKey(rawFmt),
      );
      const formatCode = matchedFmt ? matchedFmt.code : rawFmt;
      const rawUnitPrice = fm.itemUnitPriceEur
        ? parseFrenchDecimal(row[fm.itemUnitPriceEur - 1] as string | number | null)
        : null;

      let acc = groups.get(groupKey);
      if (!acc) {
        let manualOverride: number | null = null;
        if (fm.manualAmountOverrideEur) {
          const rawOv = row[fm.manualAmountOverrideEur - 1];
          if (rawOv !== null && rawOv !== undefined && String(rawOv).trim() !== '') {
            const parsedOv = parseFrenchDecimal(rawOv as string | number);
            if (parsedOv !== null && parsedOv >= 0) {
              manualOverride = roundCurrencyEur(parsedOv);
            }
          }
        }
        acc = {
          id: groupKey,
          rowNumbers: [],
          date,
          customerName,
          phone: fm.phone
            ? normalizePhoneNumber(
                disp[fm.phone - 1] || (row[fm.phone - 1] as string | number),
              )
            : '',
          contextOrRelay: fm.contextOrRelay
            ? String(row[fm.contextOrRelay - 1] ?? '').trim()
            : '',
          harvestLabel,
          itemsInput: [],
          manualOverride,
          orderStatus: parseCellOrderStatus(row[fm.orderStatus! - 1]),
          paymentStatus: parseCellPaymentStatus(row[fm.paymentStatus! - 1]),
          rawThirdParty: fm.collectedByThirdParty
            ? parseCellBoolean(row[fm.collectedByThirdParty - 1], false)
            : undefined,
          rawCollector: fm.collectorName
            ? String(row[fm.collectorName - 1] ?? '').trim()
            : undefined,
          rawTransfer: fm.transferStatus
            ? parseCellTransferStatus(row[fm.transferStatus - 1])
            : undefined,
          notes: fm.notes ? String(row[fm.notes - 1] ?? '').trim() : '',
          updatedAt: fm.updatedAt ? String(row[fm.updatedAt - 1] ?? '').trim() : '',
        };
        groups.set(groupKey, acc);
      }

      acc.rowNumbers.push(rowNumber);
      if (qty > 0 && formatCode) {
        acc.itemsInput.push({
          formatCode,
          quantity: qty,
          ...(rawUnitPrice !== null && rawUnitPrice >= 0
            ? { unitPriceEur: roundCurrencyEur(rawUnitPrice) }
            : {}),
        });
      }
    }

    const records: ParsedOrderRecord[] = [];
    for (const acc of groups.values()) {
      const harvest = harvestByNormLabel.get(acc.harvestLabel.toLowerCase());
      const totals = computeOrderTotals(
        acc.itemsInput,
        harvest,
        formats,
        acc.paymentStatus,
        acc.manualOverride,
      );
      const transfer = normalizeOrderTransferState(
        acc.paymentStatus,
        acc.rawThirdParty,
        acc.rawCollector,
        acc.rawTransfer,
        null,
      );
      const firstRow = acc.rowNumbers[0] ?? 2;
      records.push({
        rowNumbers: acc.rowNumbers,
        order: {
          id: acc.id,
          sheetRowNumber: firstRow,
          date: acc.date,
          customerName: acc.customerName,
          phone: acc.phone,
          contextOrRelay: acc.contextOrRelay,
          harvestLabel: harvest ? harvest.label : acc.harvestLabel,
          items: totals.items,
          computedWeightKg: totals.computedWeightKg,
          computedAmountEur: totals.computedAmountEur,
          manualAmountOverrideEur: totals.manualAmountOverrideEur,
          effectiveAmountEur: totals.effectiveAmountEur,
          orderStatus: acc.orderStatus,
          paymentStatus: acc.paymentStatus,
          collectedByThirdParty: transfer.collectedByThirdParty,
          collectorName: transfer.collectorName,
          transferStatus: transfer.transferStatus,
          notes: acc.notes || undefined,
          updatedAt: acc.updatedAt || `${acc.date || '2026-01-01'}T10:00:00.000Z`,
        },
      });
    }

    return records;
  }

  private writeOrderRecordToSheet(
    order: SaleOrder,
    formats: readonly JarFormat[],
    existingRowNumbers?: readonly number[],
  ): number {
    const sheet = requireAllowedSheet(this.spreadsheet, 'Ventes Miel');
    assertSheetWritable(sheet, 'Ventes Miel', this.schemaConfig);

    let row1Headers = readRow1Headers(sheet);
    const salesLayout = detectSalesLayout(row1Headers, formats, this.schemaConfig);
    let resolved = requireTabHeaders(sheet, 'Ventes Miel', this.schemaConfig, {
      salesLayout,
    });

    if (salesLayout === 'columns_per_format') {
      const reserved = new Set<number>(Object.values(resolved.fieldMap));
      for (const item of order.items) {
        const fmt = formats.find((f) => f.code === item.formatCode) ?? {
          code: item.formatCode,
          label: `Pot ${item.formatCode}`,
          weightKg: item.unitWeightKg,
          active: true,
        };
        ensureFormatColumn(sheet, fmt, this.schemaConfig, reserved);
      }

      row1Headers = readRow1Headers(sheet);
      resolved = requireTabHeaders(sheet, 'Ventes Miel', this.schemaConfig, {
        salesLayout,
      });
      const fm = resolved.fieldMap;
      const { formatColMap } = resolveFormatColumns(
        row1Headers,
        formats,
        this.schemaConfig,
        new Set<number>(Object.values(fm)),
      );

      const totalCols = Math.max(row1Headers.length, sheet.getLastColumn());
      const formulaInspection = inspectSheetFormulas(sheet, row1Headers);
      const fallbackR1C1Templates = buildSalesFallbackR1C1Templates({
        fieldMap: fm,
        formatColMap,
        formats,
        salesLayout,
      });

      const targetRow =
        existingRowNumbers && existingRowNumbers.length > 0
          ? existingRowNumbers[0]!
          : sheet.getLastRow() + 1;

      const qtyByCode = new Map<string, number>();
      for (const item of order.items) {
        qtyByCode.set(item.formatCode, item.quantity);
      }

      const valuesByCol = new Map<number, string | number | boolean>();
      if (fm.id) valuesByCol.set(fm.id, order.id);
      valuesByCol.set(fm.date!, order.date);
      valuesByCol.set(fm.customerName!, order.customerName);
      if (fm.phone) valuesByCol.set(fm.phone, order.phone);
      if (fm.contextOrRelay) valuesByCol.set(fm.contextOrRelay, order.contextOrRelay);
      valuesByCol.set(fm.harvestLabel!, order.harvestLabel);

      for (const [fmtCode, colIdx] of Object.entries(formatColMap)) {
        const q = qtyByCode.get(fmtCode) ?? 0;
        valuesByCol.set(colIdx, q > 0 ? q : '');
      }

      if (fm.computedWeightKg) {
        valuesByCol.set(fm.computedWeightKg, order.computedWeightKg);
      }
      if (fm.amountEur) {
        valuesByCol.set(fm.amountEur, order.effectiveAmountEur);
      }
      if (fm.manualAmountOverrideEur) {
        valuesByCol.set(
          fm.manualAmountOverrideEur,
          order.manualAmountOverrideEur !== null ? order.manualAmountOverrideEur : '',
        );
      }

      valuesByCol.set(fm.orderStatus!, order.orderStatus);
      valuesByCol.set(fm.paymentStatus!, order.paymentStatus);
      if (fm.collectedByThirdParty) {
        valuesByCol.set(fm.collectedByThirdParty, order.collectedByThirdParty);
      }
      if (fm.collectorName) {
        valuesByCol.set(fm.collectorName, order.collectorName);
      }
      if (fm.transferStatus) {
        valuesByCol.set(fm.transferStatus, order.transferStatus);
      }
      if (fm.notes) {
        valuesByCol.set(fm.notes, order.notes ?? '');
      }
      if (fm.updatedAt) {
        valuesByCol.set(fm.updatedAt, order.updatedAt);
      }

      const phoneCols = new Set<number>();
      if (fm.phone) phoneCols.add(fm.phone);

      const manualFormulaOverrides = new Map<number, number | string | null>();
      if (fm.amountEur) {
        manualFormulaOverrides.set(
          fm.amountEur,
          order.manualAmountOverrideEur !== null ? order.effectiveAmountEur : null,
        );
      }

      writeRowPreservingFormulas({
        sheet,
        sheetName: 'Ventes Miel',
        rowNumber: targetRow,
        totalCols,
        valuesByCol,
        phoneCols,
        formulaInspection,
        manualFormulaOverrides,
        fallbackR1C1Templates,
        schemaConfig: this.schemaConfig,
      });

      return targetRow;
    }

    // row_per_item layout
    const fm = resolved.fieldMap;
    const totalCols = Math.max(row1Headers.length, sheet.getLastColumn());
    const formulaInspection = inspectSheetFormulas(sheet, row1Headers);
    const fallbackR1C1Templates = buildSalesFallbackR1C1Templates({
      fieldMap: fm,
      formatColMap: {},
      formats,
      salesLayout,
    });

    const prevRows = existingRowNumbers ? [...existingRowNumbers].sort((a, b) => a - b) : [];
    const targetRows: number[] = [];

    for (let idx = 0; idx < order.items.length; idx++) {
      if (idx < prevRows.length) {
        targetRows.push(prevRows[idx]!);
      } else {
        targetRows.push(sheet.getLastRow() + 1 + (idx - prevRows.length));
      }
    }

    const phoneCols = new Set<number>();
    if (fm.phone) phoneCols.add(fm.phone);

    for (let idx = 0; idx < order.items.length; idx++) {
      const item = order.items[idx]!;
      const targetRow = targetRows[idx]!;
      const lineWeight = roundWeightKg(item.quantity * item.unitWeightKg);
      const lineAmount =
        order.paymentStatus === 'Donné'
          ? 0
          : order.manualAmountOverrideEur !== null
            ? idx === 0
              ? order.effectiveAmountEur
              : 0
            : roundCurrencyEur(item.quantity * item.unitPriceEur);

      const valuesByCol = new Map<number, string | number | boolean>();
      if (fm.id) valuesByCol.set(fm.id, order.id);
      if (fm.orderGroupId) valuesByCol.set(fm.orderGroupId, order.id);
      valuesByCol.set(fm.date!, order.date);
      valuesByCol.set(fm.customerName!, order.customerName);
      if (fm.phone) valuesByCol.set(fm.phone, order.phone);
      if (fm.contextOrRelay) valuesByCol.set(fm.contextOrRelay, order.contextOrRelay);
      valuesByCol.set(fm.harvestLabel!, order.harvestLabel);
      valuesByCol.set(fm.itemFormat!, item.formatCode);
      valuesByCol.set(fm.itemQuantity!, item.quantity);
      if (fm.itemUnitPriceEur) {
        valuesByCol.set(fm.itemUnitPriceEur, item.unitPriceEur);
      }
      if (fm.computedWeightKg) {
        valuesByCol.set(fm.computedWeightKg, lineWeight);
      }
      if (fm.amountEur) {
        valuesByCol.set(fm.amountEur, lineAmount);
      }
      if (fm.manualAmountOverrideEur) {
        valuesByCol.set(
          fm.manualAmountOverrideEur,
          idx === 0 && order.manualAmountOverrideEur !== null
            ? order.manualAmountOverrideEur
            : '',
        );
      }
      valuesByCol.set(fm.orderStatus!, order.orderStatus);
      valuesByCol.set(fm.paymentStatus!, order.paymentStatus);
      if (fm.collectedByThirdParty) {
        valuesByCol.set(fm.collectedByThirdParty, order.collectedByThirdParty);
      }
      if (fm.collectorName) {
        valuesByCol.set(fm.collectorName, order.collectorName);
      }
      if (fm.transferStatus) {
        valuesByCol.set(fm.transferStatus, order.transferStatus);
      }
      if (fm.notes) {
        valuesByCol.set(fm.notes, order.notes ?? '');
      }
      if (fm.updatedAt) {
        valuesByCol.set(fm.updatedAt, order.updatedAt);
      }

      const manualFormulaOverrides = new Map<number, number | string | null>();
      if (fm.amountEur) {
        manualFormulaOverrides.set(
          fm.amountEur,
          order.manualAmountOverrideEur !== null ? lineAmount : null,
        );
      }

      writeRowPreservingFormulas({
        sheet,
        sheetName: 'Ventes Miel',
        rowNumber: targetRow,
        totalCols,
        valuesByCol,
        phoneCols,
        formulaInspection,
        manualFormulaOverrides,
        fallbackR1C1Templates,
        schemaConfig: this.schemaConfig,
      });
    }

    // Remove excess rows from bottom to top if order shrunk in row_per_item layout
    if (prevRows.length > order.items.length) {
      const excess = prevRows.slice(order.items.length).sort((a, b) => b - a);
      for (const rowToDelete of excess) {
        sheet.deleteRow(rowToDelete);
      }
    }

    return targetRows[0] ?? 2;
  }

  public listOrders(): SaleOrder[] {
    const formats = this.listFormats();
    const harvests = this.readHarvestRecordsInternal(formats).map((r) => r.harvest);
    const records = this.readOrderRecordsInternal(formats, harvests);
    return sortOrdersNewestFirst(records.map((r) => r.order));
  }

  public getOrderById(id: string): SaleOrder | null {
    const formats = this.listFormats();
    const harvests = this.readHarvestRecordsInternal(formats).map((r) => r.harvest);
    const records = this.readOrderRecordsInternal(formats, harvests);
    return records.find((r) => r.order.id === id)?.order ?? null;
  }

  public createOrder(input: CreateSaleOrderInput, actor: UserSession): SaleOrder {
    const customerName = String(input?.customerName ?? '').trim();
    if (!customerName) {
      throw new RepositoryError(
        'VALIDATION_ERROR',
        'Le nom du client ou le contexte de vente est obligatoire.',
      );
    }
    const dateStr = String(input?.date ?? '').trim();
    if (extractIsoCalendarYear(dateStr) === null) {
      throw new RepositoryError('VALIDATION_ERROR', 'Date de commande invalide.');
    }
    if (!isOrderStatus(input.orderStatus) || !isPaymentStatus(input.paymentStatus)) {
      throw new RepositoryError('VALIDATION_ERROR', 'Statut de commande invalide.');
    }

    const formats = this.listFormats();
    const harvests = this.readHarvestRecordsInternal(formats).map((r) => r.harvest);
    const harvestLabel = normalizeHarvestLabel(input.harvestLabel);
    const harvest = harvests.find(
      (h) => normalizeHarvestLabel(h.label).toLowerCase() === harvestLabel.toLowerCase(),
    );
    if (!harvest) {
      throw new RepositoryError(
        'VALIDATION_ERROR',
        `Récolte "${harvestLabel}" introuvable.`,
      );
    }

    const totals = computeOrderTotals(
      input.items ?? [],
      harvest,
      formats,
      input.paymentStatus,
      input.manualAmountOverrideEur ?? null,
    );
    if (totals.totalJarsCount < 1) {
      throw new RepositoryError(
        'VALIDATION_ERROR',
        'Veuillez sélectionner au moins un pot.',
      );
    }

    const transfer = normalizeOrderTransferState(
      input.paymentStatus,
      input.collectedByThirdParty,
      input.collectorName,
      input.transferStatus,
      actor,
    );

    const existingRecords = this.readOrderRecordsInternal(formats, harvests);
    const newId = generateNextSequentialId(
      'ord',
      existingRecords.map((r) => r.order.id),
    );
    const nowIso = new Date().toISOString();

    const created: SaleOrder = {
      id: newId,
      date: normalizeCellDateToIso(dateStr),
      customerName,
      phone: normalizePhoneNumber(input.phone),
      contextOrRelay: String(input.contextOrRelay ?? '').trim(),
      harvestLabel: harvest.label,
      items: totals.items,
      computedWeightKg: totals.computedWeightKg,
      computedAmountEur: totals.computedAmountEur,
      manualAmountOverrideEur: totals.manualAmountOverrideEur,
      effectiveAmountEur: totals.effectiveAmountEur,
      orderStatus: input.orderStatus,
      paymentStatus: input.paymentStatus,
      collectedByThirdParty: transfer.collectedByThirdParty,
      collectorName: transfer.collectorName,
      transferStatus: transfer.transferStatus,
      notes: input.notes?.trim() ? input.notes.trim() : undefined,
      updatedAt: nowIso,
    };

    const rowNumber = this.writeOrderRecordToSheet(created, formats);
    created.sheetRowNumber = rowNumber;
    return created;
  }

  public updateOrder(
    id: string,
    input: UpdateSaleOrderInput,
    actor: UserSession,
    expectedUpdatedAt?: string,
  ): SaleOrder {
    const formats = this.listFormats();
    const harvests = this.readHarvestRecordsInternal(formats).map((r) => r.harvest);
    const records = this.readOrderRecordsInternal(formats, harvests);
    const target = records.find((r) => r.order.id === id);
    if (!target) {
      throw new RepositoryError('NOT_FOUND', `Commande "${id}" introuvable.`);
    }
    const existing = target.order;

    if (
      expectedUpdatedAt !== undefined &&
      existing.updatedAt &&
      existing.updatedAt !== expectedUpdatedAt
    ) {
      throw new RepositoryError(
        'CONCURRENT_MODIFICATION',
        'Cette commande a été modifiée entre-temps par un autre utilisateur.',
        { id, expectedUpdatedAt, actualUpdatedAt: existing.updatedAt },
      );
    }

    const customerName = String(input?.customerName ?? '').trim();
    if (!customerName) {
      throw new RepositoryError(
        'VALIDATION_ERROR',
        'Le nom du client ou le contexte de vente est obligatoire.',
      );
    }
    const dateStr = String(input?.date ?? '').trim();
    if (extractIsoCalendarYear(dateStr) === null) {
      throw new RepositoryError('VALIDATION_ERROR', 'Date de commande invalide.');
    }
    if (!isOrderStatus(input.orderStatus) || !isPaymentStatus(input.paymentStatus)) {
      throw new RepositoryError('VALIDATION_ERROR', 'Statut de commande invalide.');
    }

    const harvestLabel = normalizeHarvestLabel(input.harvestLabel);
    const harvest = harvests.find(
      (h) => normalizeHarvestLabel(h.label).toLowerCase() === harvestLabel.toLowerCase(),
    );
    if (!harvest) {
      throw new RepositoryError(
        'VALIDATION_ERROR',
        `Récolte "${harvestLabel}" introuvable.`,
      );
    }

    // EC-20: Preserve historical unitWeightKg & unitPriceEur snapshots on unchanged harvest lines
    const isSameHarvest =
      normalizeHarvestLabel(existing.harvestLabel).toLowerCase() ===
      harvestLabel.toLowerCase();
    const mergedItems: OrderLineItemInput[] = (input.items ?? []).map((item) => {
      if (!isSameHarvest) return item;
      const prevLine = existing.items.find((p) => p.formatCode === item.formatCode);
      if (!prevLine) return item;
      return {
        formatCode: item.formatCode,
        quantity: item.quantity,
        unitWeightKg: item.unitWeightKg ?? prevLine.unitWeightKg,
        unitPriceEur: item.unitPriceEur ?? prevLine.unitPriceEur,
      };
    });

    const totals = computeOrderTotals(
      mergedItems,
      harvest,
      formats,
      input.paymentStatus,
      input.manualAmountOverrideEur ?? null,
    );
    if (totals.totalJarsCount < 1) {
      throw new RepositoryError(
        'VALIDATION_ERROR',
        'Veuillez sélectionner au moins un pot.',
      );
    }

    const isTransitionToPaid =
      existing.paymentStatus !== 'Payé' && input.paymentStatus === 'Payé';
    const transferActor =
      isTransitionToPaid || input.collectedByThirdParty ? actor : null;

    const transfer = normalizeOrderTransferState(
      input.paymentStatus,
      input.collectedByThirdParty,
      input.collectorName,
      input.transferStatus,
      transferActor,
    );

    const updated: SaleOrder = {
      ...existing,
      date: normalizeCellDateToIso(dateStr),
      customerName,
      phone: normalizePhoneNumber(input.phone),
      contextOrRelay: String(input.contextOrRelay ?? '').trim(),
      harvestLabel: harvest.label,
      items: totals.items,
      computedWeightKg: totals.computedWeightKg,
      computedAmountEur: totals.computedAmountEur,
      manualAmountOverrideEur: totals.manualAmountOverrideEur,
      effectiveAmountEur: totals.effectiveAmountEur,
      orderStatus: input.orderStatus,
      paymentStatus: input.paymentStatus,
      collectedByThirdParty: transfer.collectedByThirdParty,
      collectorName: transfer.collectorName,
      transferStatus: transfer.transferStatus,
      notes: input.notes?.trim() ? input.notes.trim() : undefined,
      updatedAt: new Date().toISOString(),
    };

    const rowNumber = this.writeOrderRecordToSheet(
      updated,
      formats,
      target.rowNumbers,
    );
    updated.sheetRowNumber = rowNumber;
    return updated;
  }

  public patchOrderStatuses(
    id: string,
    patch: OrderStatusPatch,
    actor: UserSession,
    expectedUpdatedAt?: string,
  ): SaleOrder {
    const formats = this.listFormats();
    const harvests = this.readHarvestRecordsInternal(formats).map((r) => r.harvest);
    const records = this.readOrderRecordsInternal(formats, harvests);
    const target = records.find((r) => r.order.id === id);
    if (!target) {
      throw new RepositoryError('NOT_FOUND', `Commande "${id}" introuvable.`);
    }
    const existing = target.order;

    if (
      expectedUpdatedAt !== undefined &&
      existing.updatedAt &&
      existing.updatedAt !== expectedUpdatedAt
    ) {
      throw new RepositoryError(
        'CONCURRENT_MODIFICATION',
        'Cette commande a été modifiée entre-temps par un autre utilisateur.',
        { id, expectedUpdatedAt, actualUpdatedAt: existing.updatedAt },
      );
    }

    const nextOrderStatus = patch.orderStatus ?? existing.orderStatus;
    const nextPaymentStatus = patch.paymentStatus ?? existing.paymentStatus;
    if (!isOrderStatus(nextOrderStatus) || !isPaymentStatus(nextPaymentStatus)) {
      throw new RepositoryError('VALIDATION_ERROR', 'Statut de commande invalide.');
    }
    if (
      patch.transferStatus !== undefined &&
      !isTransferStatus(patch.transferStatus)
    ) {
      throw new RepositoryError('VALIDATION_ERROR', 'Statut de transfert invalide.');
    }

    const harvest = harvests.find(
      (h) =>
        normalizeHarvestLabel(h.label).toLowerCase() ===
        normalizeHarvestLabel(existing.harvestLabel).toLowerCase(),
    );

    const totals = computeOrderTotals(
      existing.items,
      harvest,
      formats,
      nextPaymentStatus,
      existing.manualAmountOverrideEur,
    );

    // Rule #4 (D-03): Auto-activate co-seller transfer when contributor marks order as Payé
    const isTransitionToPaid =
      patch.paymentStatus === 'Payé' && existing.paymentStatus !== 'Payé';
    const transferActor =
      isTransitionToPaid || patch.collectedByThirdParty === true ? actor : null;

    const transfer = normalizeOrderTransferState(
      nextPaymentStatus,
      patch.collectedByThirdParty !== undefined
        ? patch.collectedByThirdParty
        : existing.collectedByThirdParty,
      patch.collectorName !== undefined ? patch.collectorName : existing.collectorName,
      patch.transferStatus !== undefined
        ? patch.transferStatus
        : existing.transferStatus,
      transferActor,
    );

    const updated: SaleOrder = {
      ...existing,
      orderStatus: nextOrderStatus,
      paymentStatus: nextPaymentStatus,
      effectiveAmountEur: totals.effectiveAmountEur,
      collectedByThirdParty: transfer.collectedByThirdParty,
      collectorName: transfer.collectorName,
      transferStatus: transfer.transferStatus,
      updatedAt: new Date().toISOString(),
    };

    const rowNumber = this.writeOrderRecordToSheet(
      updated,
      formats,
      target.rowNumbers,
    );
    updated.sheetRowNumber = rowNumber;
    return updated;
  }

  public deleteOrder(id: string): { deletedId: string } {
    const formats = this.listFormats();
    const harvests = this.readHarvestRecordsInternal(formats).map((r) => r.harvest);
    const records = this.readOrderRecordsInternal(formats, harvests);
    const target = records.find((r) => r.order.id === id);
    if (!target) {
      throw new RepositoryError('NOT_FOUND', `Commande "${id}" introuvable.`);
    }

    const sheet = requireAllowedSheet(this.spreadsheet, 'Ventes Miel');
    assertSheetWritable(sheet, 'Ventes Miel', this.schemaConfig);

    // Delete from bottom row to top row so multi-line row_per_item indices remain exact
    const sortedRowsDesc = [...target.rowNumbers].sort((a, b) => b - a);
    for (const rowNumber of sortedRowsDesc) {
      sheet.deleteRow(rowNumber);
    }

    return { deletedId: id };
  }

  // ==========================================================================
  // Accounting (`Comptabilité rucher`)
  // ==========================================================================

  private readAccountingRecordsInternal(): ParsedAccountingRecord[] {
    const sheet = getAllowedSheet(this.spreadsheet, 'Comptabilité rucher');
    if (!sheet || sheet.getLastRow() < 2 || sheet.getLastColumn() < 1) {
      return [];
    }

    const resolved = requireTabHeaders(
      sheet,
      'Comptabilité rucher',
      this.schemaConfig,
    );
    const fm = resolved.fieldMap;
    const totalCols = Math.max(resolved.headers.length, sheet.getLastColumn());
    const dataRange = sheet.getRange(2, 1, sheet.getLastRow() - 1, totalCols);
    const values = dataRange.getValues();
    const displayValues =
      typeof dataRange.getDisplayValues === 'function'
        ? dataRange.getDisplayValues()
        : values.map((r) => r.map((c) => String(c ?? '')));

    const records: ParsedAccountingRecord[] = [];
    for (let i = 0; i < values.length; i++) {
      const rowNumber = i + 2;
      const row = values[i]!;
      const disp = displayValues[i] ?? [];

      const label = String(row[fm.label! - 1] ?? '').trim();
      const date = normalizeCellDateToIso(row[fm.date! - 1], disp[fm.date! - 1]);
      const rawAmount = parseFrenchDecimal(
        row[fm.amountEur! - 1] as string | number | null,
      );

      if (!label && !date && rawAmount === null) {
        continue;
      }

      const rawType = String(row[fm.type! - 1] ?? '').trim();
      const type: AccountingEntryType = isAccountingEntryType(rawType)
        ? rawType
        : normalizeSearchText(rawType) === 'recette'
          ? 'Recette'
          : 'Dépense';

      const rawCategory = String(row[fm.category! - 1] ?? '').trim();
      const category: AccountingCategory = isAccountingCategory(rawCategory)
        ? rawCategory
        : type === 'Recette'
          ? 'Autres recettes'
          : 'Charges et cotisations';

      const rawYear = fm.year
        ? parseFrenchDecimal(row[fm.year - 1] as string | number | null)
        : null;
      const year =
        rawYear !== null && Number.isFinite(rawYear)
          ? Math.trunc(rawYear)
          : (extractIsoCalendarYear(date) ?? new Date().getFullYear());

      const rawId = fm.id ? String(row[fm.id - 1] ?? '').trim() : '';
      const id = rawId || `acc-row-${rowNumber}`;
      const notes = fm.notes ? String(row[fm.notes - 1] ?? '').trim() : '';

      records.push({
        rowNumber,
        entry: {
          id,
          sheetRowNumber: rowNumber,
          date,
          year,
          type,
          category,
          label,
          amountEur: rawAmount !== null && rawAmount > 0 ? roundCurrencyEur(rawAmount) : 0,
          notes: notes || undefined,
          updatedAt: `${date || '2026-01-01'}T09:00:00.000Z`,
        },
      });
    }

    return records;
  }

  public listAccountingEntries(year?: number): AccountingEntry[] {
    const entries = this.readAccountingRecordsInternal().map((r) => r.entry);
    const filtered =
      year !== undefined ? entries.filter((e) => e.year === year) : entries;
    return sortAccountingNewestFirst(filtered);
  }

  public createAccountingEntry(input: CreateAccountingEntryInput): AccountingEntry {
    const dateStr = String(input?.date ?? '').trim();
    const derivedYear = input.year ?? extractIsoCalendarYear(dateStr);
    if (derivedYear === null || !Number.isFinite(derivedYear)) {
      throw new RepositoryError('VALIDATION_ERROR', 'Date comptable invalide.');
    }
    if (
      !isAccountingEntryType(input.type) ||
      !isAccountingCategory(input.category) ||
      !isCategoryValidForType(input.type, input.category)
    ) {
      throw new RepositoryError(
        'VALIDATION_ERROR',
        'Catégorie comptable incompatible avec le type sélectionné.',
      );
    }
    const label = String(input?.label ?? '').trim();
    if (!label) {
      throw new RepositoryError(
        'VALIDATION_ERROR',
        "Le libellé de l'écriture est obligatoire.",
      );
    }
    if (!Number.isFinite(input.amountEur) || input.amountEur <= 0) {
      throw new RepositoryError(
        'VALIDATION_ERROR',
        'Le montant comptable doit être strictement positif.',
      );
    }

    const sheet = requireAllowedSheet(this.spreadsheet, 'Comptabilité rucher');
    assertSheetWritable(sheet, 'Comptabilité rucher', this.schemaConfig);
    const resolved = requireTabHeaders(
      sheet,
      'Comptabilité rucher',
      this.schemaConfig,
    );
    const fm = resolved.fieldMap;
    const totalCols = Math.max(resolved.headers.length, sheet.getLastColumn());
    const formulaInspection = inspectSheetFormulas(sheet, resolved.headers);

    const existing = this.readAccountingRecordsInternal();
    const id = generateNextSequentialId(
      'acc',
      existing.map((r) => r.entry.id),
    );
    const targetRow = sheet.getLastRow() + 1;

    const created: AccountingEntry = {
      id,
      sheetRowNumber: targetRow,
      date: normalizeCellDateToIso(dateStr),
      year: Math.trunc(derivedYear),
      type: input.type,
      category: input.category,
      label,
      amountEur: roundCurrencyEur(input.amountEur),
      notes: input.notes?.trim() ? input.notes.trim() : undefined,
      updatedAt: new Date().toISOString(),
    };

    const valuesByCol = new Map<number, string | number | boolean>();
    if (fm.id) valuesByCol.set(fm.id, created.id);
    valuesByCol.set(fm.date!, created.date);
    if (fm.year) valuesByCol.set(fm.year, created.year);
    valuesByCol.set(fm.type!, created.type);
    valuesByCol.set(fm.category!, created.category);
    valuesByCol.set(fm.label!, created.label);
    valuesByCol.set(fm.amountEur!, created.amountEur);
    if (fm.notes) valuesByCol.set(fm.notes, created.notes ?? '');

    writeRowPreservingFormulas({
      sheet,
      sheetName: 'Comptabilité rucher',
      rowNumber: targetRow,
      totalCols,
      valuesByCol,
      formulaInspection,
      schemaConfig: this.schemaConfig,
    });

    return created;
  }

  public updateAccountingEntry(
    id: string,
    input: UpdateAccountingEntryInput,
  ): AccountingEntry {
    const records = this.readAccountingRecordsInternal();
    const target = records.find((r) => r.entry.id === id);
    if (!target) {
      throw new RepositoryError(
        'NOT_FOUND',
        `Écriture comptable "${id}" introuvable.`,
      );
    }
    const existing = target.entry;

    const nextDate =
      input.date !== undefined
        ? normalizeCellDateToIso(input.date.trim())
        : existing.date;
    const nextYear =
      input.year !== undefined
        ? input.year
        : input.date !== undefined
          ? extractIsoCalendarYear(nextDate)
          : existing.year;
    if (nextYear === null || !Number.isFinite(nextYear)) {
      throw new RepositoryError('VALIDATION_ERROR', 'Date comptable invalide.');
    }

    const nextType = input.type ?? existing.type;
    const nextCategory = input.category ?? existing.category;
    if (
      !isAccountingEntryType(nextType) ||
      !isAccountingCategory(nextCategory) ||
      !isCategoryValidForType(nextType, nextCategory)
    ) {
      throw new RepositoryError(
        'VALIDATION_ERROR',
        'Catégorie comptable incompatible avec le type sélectionné.',
      );
    }

    const nextLabel =
      input.label !== undefined ? input.label.trim() : existing.label;
    if (!nextLabel) {
      throw new RepositoryError(
        'VALIDATION_ERROR',
        "Le libellé de l'écriture est obligatoire.",
      );
    }

    const nextAmount =
      input.amountEur !== undefined ? input.amountEur : existing.amountEur;
    if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
      throw new RepositoryError(
        'VALIDATION_ERROR',
        'Le montant comptable doit être strictement positif.',
      );
    }

    const sheet = requireAllowedSheet(this.spreadsheet, 'Comptabilité rucher');
    assertSheetWritable(sheet, 'Comptabilité rucher', this.schemaConfig);
    const resolved = requireTabHeaders(
      sheet,
      'Comptabilité rucher',
      this.schemaConfig,
    );
    const fm = resolved.fieldMap;
    const totalCols = Math.max(resolved.headers.length, sheet.getLastColumn());
    const formulaInspection = inspectSheetFormulas(sheet, resolved.headers);

    const updated: AccountingEntry = {
      ...existing,
      date: nextDate,
      year: Math.trunc(nextYear),
      type: nextType,
      category: nextCategory,
      label: nextLabel,
      amountEur: roundCurrencyEur(nextAmount),
      notes:
        input.notes !== undefined
          ? input.notes.trim() || undefined
          : existing.notes,
      updatedAt: new Date().toISOString(),
    };

    const valuesByCol = new Map<number, string | number | boolean>();
    if (fm.id) valuesByCol.set(fm.id, updated.id);
    valuesByCol.set(fm.date!, updated.date);
    if (fm.year) valuesByCol.set(fm.year, updated.year);
    valuesByCol.set(fm.type!, updated.type);
    valuesByCol.set(fm.category!, updated.category);
    valuesByCol.set(fm.label!, updated.label);
    valuesByCol.set(fm.amountEur!, updated.amountEur);
    if (fm.notes) valuesByCol.set(fm.notes, updated.notes ?? '');

    writeRowPreservingFormulas({
      sheet,
      sheetName: 'Comptabilité rucher',
      rowNumber: target.rowNumber,
      totalCols,
      valuesByCol,
      formulaInspection,
      schemaConfig: this.schemaConfig,
    });

    return updated;
  }

  public deleteAccountingEntry(id: string): { deletedId: string } {
    const records = this.readAccountingRecordsInternal();
    const target = records.find((r) => r.entry.id === id);
    if (!target) {
      throw new RepositoryError(
        'NOT_FOUND',
        `Écriture comptable "${id}" introuvable.`,
      );
    }

    const sheet = requireAllowedSheet(this.spreadsheet, 'Comptabilité rucher');
    assertSheetWritable(sheet, 'Comptabilité rucher', this.schemaConfig);
    sheet.deleteRow(target.rowNumber);
    return { deletedId: id };
  }

  // ==========================================================================
  // Complete Dataset Hydration (`dataset.get`)
  // ==========================================================================

  public getDataset(actor: UserSession): AppDataset {
    const formats = this.listFormats();
    const harvests = this.readHarvestRecordsInternal(formats).map((r) => r.harvest);
    const orders = sortOrdersNewestFirst(
      this.readOrderRecordsInternal(formats, harvests).map((r) => r.order),
    );
    const accountingEntries =
      actor.role === 'manager' ? this.listAccountingEntries() : [];

    return {
      formats,
      harvests,
      orders,
      accountingEntries,
      serverTimestamp: new Date().toISOString(),
      session: actor,
    };
  }
}
