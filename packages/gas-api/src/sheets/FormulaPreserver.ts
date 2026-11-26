import {
  ALLOWED_SHEETS,
  ALWAYS_READ_ONLY_SUMMARY_SHEETS,
  CONDITIONAL_SUMMARY_SHEETS,
   DEFAULT_SCHEMA_CONFIG,
  SEED_JAR_FORMATS,
  normalizeHeaderKey,
  normalizePhoneNumber,
  parseFrenchDecimal,
  type AllowedSheetName,
  type JarFormat,
  type SalesItemsLayout,
  type SchemaConfig,
  type SheetInspectionReport,
  type SheetTabInspection,
  type UnitPriceTabLayout,
} from '@app-icol/shared';
import {
  detectSalesLayout,
  detectUnitPriceLayout,
  readRow1Headers,
  resolveFormatColumns,
  resolveTabHeadersFromRow,
} from './HeaderResolver';
import {
  assertAllowedSheet,
  assertWritableAllowedSheet,
  auditWorkbookSheetNames,
  getAllowedSheet,
} from './SheetGuard';

const ARRAY_FORMULA_RE = /\bARRAYFORMULA\s*\(/i;
const SUMMARY_FORMULA_RE =
  /\b(?:QUERY|SUMIF|SUMIFS|COUNTIF|COUNTIFS|UNIQUE|FILTER|IMPORTRANGE|DSUM|PIVOT)\s*\(/i;

export interface ArrayFormulaColumnInfo {
  colIndex: number; // 1-based
  header: string;
  anchorRow: 1 | 2;
  formula: string;
}

export interface R1C1FormulaColumnInfo {
  colIndex: number; // 1-based
  header: string;
  templateR1C1: string;
}

export interface SheetFormulaInspection {
  arrayFormulaCols: Map<number, ArrayFormulaColumnInfo>;
  r1c1FormulaCols: Map<number, R1C1FormulaColumnInfo>;
  hasSummaryFormulas: boolean;
}

/**
 * Inspects Row 1 and sample data rows (2..50) to discover ARRAYFORMULA columns,
 * per-row R1C1 formula templates, and summary aggregation formulas.
 */
export function inspectSheetFormulas(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  row1Headers?: readonly string[],
): SheetFormulaInspection {
  const headers = row1Headers ? [...row1Headers] : readRow1Headers(sheet);
  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(headers.length, sheet.getLastColumn());

  const arrayFormulaCols = new Map<number, ArrayFormulaColumnInfo>();
  const r1c1FormulaCols = new Map<number, R1C1FormulaColumnInfo>();
  let hasSummaryFormulas = false;

  if (lastRow < 1 || lastCol < 1) {
    return { arrayFormulaCols, r1c1FormulaCols, hasSummaryFormulas };
  }

  const scanRows = Math.min(lastRow, 50);
  const scanRange = sheet.getRange(1, 1, scanRows, lastCol);
  const a1Formulas = scanRange.getFormulas();
  const r1c1Formulas =
    typeof scanRange.getFormulasR1C1 === 'function'
      ? scanRange.getFormulasR1C1()
      : a1Formulas;

  for (let r = 0; r < scanRows; r++) {
    const rowA1 = a1Formulas[r] ?? [];
    for (let c = 0; c < lastCol; c++) {
      const f = String(rowA1[c] ?? '').trim();
      if (!f.startsWith('=')) continue;
      if (SUMMARY_FORMULA_RE.test(f)) {
        hasSummaryFormulas = true;
      }
      if ((r === 0 || r === 1) && ARRAY_FORMULA_RE.test(f) && !arrayFormulaCols.has(c + 1)) {
        arrayFormulaCols.set(c + 1, {
          colIndex: c + 1,
          header: headers[c] ?? `Col_${c + 1}`,
          anchorRow: (r + 1) as 1 | 2,
          formula: f,
        });
      }
    }
  }

  // Scan rows 2..scanRows for per-row R1C1 formula templates (choosing most frequent template)
  if (scanRows >= 2) {
    for (let c = 0; c < lastCol; c++) {
      const colIndex = c + 1;
      if (arrayFormulaCols.has(colIndex)) continue;

      const counts = new Map<string, number>();
      for (let r = 1; r < scanRows; r++) {
        const fR1C1 = String(r1c1Formulas[r]?.[c] ?? '').trim();
        const fA1 = String(a1Formulas[r]?.[c] ?? '').trim();
        const candidate = fR1C1.startsWith('=')
          ? fR1C1
          : fA1.startsWith('=')
            ? fA1
            : '';
        if (!candidate || ARRAY_FORMULA_RE.test(candidate)) continue;
        counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
      }

      if (counts.size > 0) {
        let bestTemplate = '';
        let bestCount = -1;
        for (const [tpl, count] of counts.entries()) {
          if (count > bestCount) {
            bestTemplate = tpl;
            bestCount = count;
          }
        }
        if (bestTemplate) {
          r1c1FormulaCols.set(colIndex, {
            colIndex,
            header: headers[c] ?? `Col_${colIndex}`,
            templateR1C1: bestTemplate,
          });
        }
      }
    }
  }

  return {
    arrayFormulaCols,
    r1c1FormulaCols,
    hasSummaryFormulas,
  };
}

/**
 * Determines whether a sheet is a formula-driven summary tab that must block writes.
 * - ParRecoltes, ParCommandes, ParPaiement are ALWAYS read-only summary tabs.
 * - ParArticles is dynamically checked for summary/aggregation formulas or formula-populated key columns.
 */
export function isSheetFormulaDrivenSummary(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  rawSheetName: string,
  schemaConfig: SchemaConfig = DEFAULT_SCHEMA_CONFIG,
): boolean {
  const sheetName = assertAllowedSheet(rawSheetName);

  if ((ALWAYS_READ_ONLY_SUMMARY_SHEETS as readonly string[]).includes(sheetName)) {
    return true;
  }

  if ((CONDITIONAL_SUMMARY_SHEETS as readonly string[]).includes(sheetName)) {
    const headers = readRow1Headers(sheet);
    const inspection = inspectSheetFormulas(sheet, headers);
    if (inspection.hasSummaryFormulas) {
      return true;
    }
    const resolved = resolveTabHeadersFromRow(sheetName, headers, schemaConfig);
    const keyCols = [
      resolved.fieldMap.code,
      resolved.fieldMap.label,
      resolved.fieldMap.weightKg,
    ].filter((col): col is number => typeof col === 'number');

    for (const col of keyCols) {
      if (inspection.arrayFormulaCols.has(col) || inspection.r1c1FormulaCols.has(col)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Asserts that `sheetName` is an allowed writable sheet (throwing FORBIDDEN_SHEET,
 * UNLISTED_SHEET, or READ_ONLY_SUMMARY_SHEET before any mutation).
 */
export function assertSheetWritable(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  rawSheetName: string,
  schemaConfig: SchemaConfig = DEFAULT_SCHEMA_CONFIG,
): AllowedSheetName {
  const allowedName = assertAllowedSheet(rawSheetName);
  const isSummary = isSheetFormulaDrivenSummary(sheet, allowedName, schemaConfig);
  return assertWritableAllowedSheet(allowedName, { isFormulaDrivenSummary: isSummary });
}

/**
 * Forces Google Sheets text format '@' BEFORE writing normalized phone numbers so leading '0's
 * (e.g. '06 01 02 03 04' or '0612345678') and '+CC' prefixes are never stripped or parsed as formulas.
 */
export function writePhoneToCell(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  rowNumber: number,
  colNumber: number,
  rawPhone: string | number | null | undefined,
): string {
  const normalized = normalizePhoneNumber(rawPhone);
  const cell = sheet.getRange(rowNumber, colNumber, 1, 1);
  cell.setNumberFormat('@');
  cell.setValue(normalized);
  return normalized;
}

function formatR1C1Offset(offset: number): string {
  return offset === 0 ? 'RC' : `RC[${offset}]`;
}

/**
 * Synthesizes canonical R1C1 fallback templates for `Poids (Kg)` and `Prix` on `Ventes Miel`
 * in case every existing row in the sheet previously had a manual override.
 */
export function buildSalesFallbackR1C1Templates(options: {
  fieldMap: Record<string, number>;
  formatColMap: Record<string, number>;
  formats: readonly JarFormat[];
  salesLayout: SalesItemsLayout;
}): Map<number, string> {
  const { fieldMap, formatColMap, formats, salesLayout } = options;
  const templates = new Map<number, string>();

  const weightCol = fieldMap.computedWeightKg;
  const amountCol = fieldMap.amountEur;
  const paymentCol = fieldMap.paymentStatus;
  const harvestCol = fieldMap.harvestLabel;

  if (salesLayout === 'columns_per_format') {
    if (weightCol !== undefined) {
      const weightTerms: string[] = [];
      for (const fmt of formats) {
        const fmtCol = formatColMap[fmt.code];
        if (fmtCol !== undefined) {
          weightTerms.push(`${formatR1C1Offset(fmtCol - weightCol)}*${fmt.weightKg}`);
        }
      }
      if (weightTerms.length > 0) {
        templates.set(weightCol, `=${weightTerms.join('+')}`);
      }
    }

    if (amountCol !== undefined) {
      const priceTerms: string[] = [];
      let puanFormatIdx = 2;
      for (const fmt of formats) {
        const fmtCol = formatColMap[fmt.code];
        if (fmtCol !== undefined) {
          if (harvestCol !== undefined) {
            const harvestRef = formatR1C1Offset(harvestCol - amountCol);
            priceTerms.push(
              `${formatR1C1Offset(fmtCol - amountCol)}*IFERROR(INDEX(PUan!C${puanFormatIdx}:C${puanFormatIdx},MATCH(${harvestRef},PUan!C1:C1,0)),0)`,
            );
          }
          puanFormatIdx += 1;
        }
      }
      if (priceTerms.length > 0) {
        const sumExpr = priceTerms.join('+');
        if (paymentCol !== undefined) {
          templates.set(
            amountCol,
            `=IF(${formatR1C1Offset(paymentCol - amountCol)}="Donné",0,${sumExpr})`,
          );
        } else {
          templates.set(amountCol, `=${sumExpr}`);
        }
      }
    }
  } else {
    // row_per_item layout
    const qtyCol = fieldMap.itemQuantity;
    const itemFmtCol = fieldMap.itemFormat;
    const itemPuCol = fieldMap.itemUnitPriceEur;

    if (weightCol !== undefined && qtyCol !== undefined && itemFmtCol !== undefined) {
      templates.set(
        weightCol,
        `=${formatR1C1Offset(qtyCol - weightCol)}*IFERROR(INDEX(ParArticles!C3:C3,MATCH(${formatR1C1Offset(itemFmtCol - weightCol)},ParArticles!C2:C2,0)),0)`,
      );
    }

    if (amountCol !== undefined && qtyCol !== undefined && itemPuCol !== undefined) {
      const lineExpr = `${formatR1C1Offset(qtyCol - amountCol)}*${formatR1C1Offset(itemPuCol - amountCol)}`;
      if (paymentCol !== undefined) {
        templates.set(
          amountCol,
          `=IF(${formatR1C1Offset(paymentCol - amountCol)}="Donné",0,${lineExpr})`,
        );
      } else {
        templates.set(amountCol, `=${lineExpr}`);
      }
    }
  }

  return templates;
}

export interface WriteRowPreservingFormulasOptions {
  sheet: GoogleAppsScript.Spreadsheet.Sheet;
  sheetName: AllowedSheetName;
  rowNumber: number;
  totalCols: number;
  /** 1-based column -> value for plain/phone columns (and fallback if a column has no formula) */
  valuesByCol: ReadonlyMap<number, string | number | boolean>;
  /** 1-based columns requiring '@' text number format before writing */
  phoneCols?: ReadonlySet<number>;
  /** Result of inspectSheetFormulas(sheet) */
  formulaInspection: SheetFormulaInspection;
  /**
   * 1-based column -> manual override directive for formula columns (e.g. `Prix`):
   * - `number | string`: overwrite row cell with static value (manual override active)
   * - `null`: restore per-row R1C1 formula template (manual override reverted to auto)
   */
  manualFormulaOverrides?: ReadonlyMap<number, number | string | null>;
  /** Fallback R1C1 templates if all existing rows had manual overrides */
  fallbackR1C1Templates?: ReadonlyMap<number, string>;
  schemaConfig?: SchemaConfig;
}

/**
 * Writes or updates a single data row (`rowNumber >= 2`) while strictly preserving:
 * - Row 1 / Row 2 `ARRAYFORMULA` columns (never clobbering anchor or spill cells)
 * - Per-row `R1C1` formulas on `Poids (Kg)`, `Prix`, `Année`, etc. (restoring `R1C1` when manual override is `null`)
 * - `'@'` text number formatting on phone columns prior to `setValue`
 */
export function writeRowPreservingFormulas(
  options: WriteRowPreservingFormulasOptions,
): void {
  const {
    sheet,
    sheetName,
    rowNumber,
    totalCols,
    valuesByCol,
    phoneCols = new Set<number>(),
    formulaInspection,
    manualFormulaOverrides,
    fallbackR1C1Templates,
    schemaConfig = DEFAULT_SCHEMA_CONFIG,
  } = options;

  assertSheetWritable(sheet, sheetName, schemaConfig);

  for (let col = 1; col <= totalCols; col++) {
    // 1. Preserve ARRAYFORMULA columns
    const arrayFormulaInfo = formulaInspection.arrayFormulaCols.get(col);
    if (arrayFormulaInfo) {
      if (rowNumber === arrayFormulaInfo.anchorRow) {
        // Never overwrite the anchor row of an ARRAYFORMULA!
        continue;
      }
      // Ensure spill cell in row > anchorRow stays empty so ARRAYFORMULA does not #REF!
      const spillCell = sheet.getRange(rowNumber, col, 1, 1);
      const existingFormula = spillCell.getFormula();
      if (existingFormula) {
        spillCell.setValue('');
      }
      continue;
    }

    // 2. Enforce '@' text format on phone columns before writing
    if (phoneCols.has(col)) {
      const rawPhone = valuesByCol.get(col);
      writePhoneToCell(
        sheet,
        rowNumber,
        col,
        typeof rawPhone === 'boolean' ? '' : (rawPhone ?? ''),
      );
      continue;
    }

    // 3. Handle R1C1 formula columns (e.g. Poids (Kg), Prix, Année)
    const r1c1Template =
      formulaInspection.r1c1FormulaCols.get(col)?.templateR1C1 ??
      fallbackR1C1Templates?.get(col);

    if (r1c1Template) {
      const hasOverrideKey = manualFormulaOverrides?.has(col) ?? false;
      const overrideVal = manualFormulaOverrides?.get(col);

      if (hasOverrideKey && overrideVal !== null && overrideVal !== undefined) {
        // Manual override active on this row -> write static value
        sheet.getRange(rowNumber, col, 1, 1).setValue(overrideVal);
      } else {
        // Auto mode or override reverted to null -> apply/restore R1C1 formula
        sheet.getRange(rowNumber, col, 1, 1).setFormulaR1C1(r1c1Template);
      }
      continue;
    }

    // 4. Plain column: if manual override was explicitly passed on a non-formula sheet, honor it
    if (manualFormulaOverrides?.has(col)) {
      const overrideVal = manualFormulaOverrides.get(col);
      if (overrideVal !== null && overrideVal !== undefined) {
        sheet.getRange(rowNumber, col, 1, 1).setValue(overrideVal);
        continue;
      }
    }

    if (valuesByCol.has(col)) {
      sheet.getRange(rowNumber, col, 1, 1).setValue(valuesByCol.get(col)!);
    }
  }
}

function readPreviewFormatsForInspection(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
  schemaConfig: SchemaConfig,
): JarFormat[] {
  const sheet = getAllowedSheet(spreadsheet, 'ParArticles');
  if (!sheet || sheet.getLastRow() < 2 || sheet.getLastColumn() < 1) {
    return SEED_JAR_FORMATS.map((f) => ({ ...f }));
  }

  const headers = readRow1Headers(sheet);
  const resolved = resolveTabHeadersFromRow('ParArticles', headers, schemaConfig);
  if (resolved.missingRequiredFields.length > 0) {
    return SEED_JAR_FORMATS.map((f) => ({ ...f }));
  }

  const dataRows = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, Math.max(headers.length, sheet.getLastColumn()))
    .getValues();

  const formats: JarFormat[] = [];
  for (const row of dataRows) {
    const labelCol = resolved.fieldMap.label;
    const weightCol = resolved.fieldMap.weightKg;
    if (!labelCol || !weightCol) continue;

    const label = String(row[labelCol - 1] ?? '').trim();
    const weightKg = parseFrenchDecimal(row[weightCol - 1] as string | number | null);
    if (!label || weightKg === null || weightKg <= 0) continue;

    const codeCol = resolved.fieldMap.code;
    let code = codeCol ? String(row[codeCol - 1] ?? '').trim() : '';
    if (!code) {
      const grams = Math.round(weightKg * 1000);
      code = grams >= 1000 && grams % 1000 === 0 ? `${grams / 1000}kg` : `${grams}g`;
    }
    const activeCol = resolved.fieldMap.active;
    const rawActive = activeCol ? row[activeCol - 1] : true;
    const active =
      rawActive === '' || rawActive === null || rawActive === undefined
        ? true
        : !(
            rawActive === false ||
            String(rawActive).trim().toLowerCase() === 'false' ||
            String(rawActive).trim().toLowerCase() === 'faux' ||
            String(rawActive).trim().toLowerCase() === 'non' ||
            String(rawActive).trim() === '0'
          );

    formats.push({ code, label, weightKg, active });
  }

  return formats.length > 0 ? formats : SEED_JAR_FORMATS.map((f) => ({ ...f }));
}

/**
 * Full read-only workbook audit (`inspectSheetStructure()`) inspecting all 8 ALLOWED_SHEETS
 * while strictly skipping any cell access on the 4 FORBIDDEN_SHEETS and unlisted tabs.
 */
export function inspectWorkbookStructure(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
  spreadsheetId: string,
  schemaConfig: SchemaConfig = DEFAULT_SCHEMA_CONFIG,
): SheetInspectionReport {
  const tabAudit = auditWorkbookSheetNames(spreadsheet);
  const formats = readPreviewFormatsForInspection(spreadsheet, schemaConfig);

  let detectedItemsLayout: SalesItemsLayout = schemaConfig.defaultSalesItemsLayout;
  const salesSheet = getAllowedSheet(spreadsheet, 'Ventes Miel');
  if (salesSheet && salesSheet.getLastRow() >= 1) {
    detectedItemsLayout = detectSalesLayout(readRow1Headers(salesSheet), formats, schemaConfig);
  }

  let detectedUnitPriceLayout: UnitPriceTabLayout = schemaConfig.defaultUnitPriceLayout;
  const puanSheet = getAllowedSheet(spreadsheet, 'PUan');
  if (puanSheet && puanSheet.getLastRow() >= 1) {
    detectedUnitPriceLayout = detectUnitPriceLayout(
      readRow1Headers(puanSheet),
      formats,
      schemaConfig,
    );
  }

  const warnings: string[] = [];
  const activeSheets: SheetTabInspection[] = ALLOWED_SHEETS.map((sheetName) => {
    const sheet = getAllowedSheet(spreadsheet, sheetName);
    if (!sheet) {
      warnings.push(`Onglet autorisé "${sheetName}" absent du classeur.`);
      return {
        sheetName,
        exists: false,
        rowCount: 0,
        headers: [],
        resolvedFieldMap: {},
        missingRequiredFields: [],
        formulaColumns: [],
        arrayFormulaColumns: [],
        isFormulaDrivenSummary: (
          ALWAYS_READ_ONLY_SUMMARY_SHEETS as readonly string[]
        ).includes(sheetName),
      };
    }

    const headers = readRow1Headers(sheet);
    const resolved = resolveTabHeadersFromRow(sheetName, headers, schemaConfig, {
      salesLayout: detectedItemsLayout,
      unitPriceLayout: detectedUnitPriceLayout,
    });

    const combinedFieldMap: Record<string, number> = { ...resolved.fieldMap };
    if (
      (sheetName === 'Ventes Miel' && detectedItemsLayout === 'columns_per_format') ||
      (sheetName === 'PUan' && detectedUnitPriceLayout === 'matrix_by_format')
    ) {
      const reserved = new Set<number>(Object.values(resolved.fieldMap));
      const fmtCols = resolveFormatColumns(headers, formats, schemaConfig, reserved);
      for (const [code, col] of Object.entries(fmtCols.formatColMap)) {
        combinedFieldMap[`format:${code}`] = col;
      }
    }

    if (resolved.missingRequiredFields.length > 0) {
      warnings.push(
        `Onglet "${sheetName}" : colonnes requises non résolues (${resolved.missingRequiredFields.join(', ')}).`,
      );
    }

    const formulaInspection = inspectSheetFormulas(sheet, headers);
    const formulaColumns = Array.from(formulaInspection.r1c1FormulaCols.values()).map(
      (info) => info.header || normalizeHeaderKey(info.header),
    );
    const arrayFormulaColumns = Array.from(formulaInspection.arrayFormulaCols.values()).map(
      (info) => info.header || normalizeHeaderKey(info.header),
    );
    const isFormulaSummary = isSheetFormulaDrivenSummary(sheet, sheetName, schemaConfig);

    return {
      sheetName,
      exists: true,
      rowCount: sheet.getLastRow(),
      headers,
      resolvedFieldMap: combinedFieldMap,
      missingRequiredFields: resolved.missingRequiredFields,
      formulaColumns,
      arrayFormulaColumns,
      isFormulaDrivenSummary: isFormulaSummary,
    };
  });

  const spreadsheetName =
    typeof spreadsheet.getName === 'function' ? spreadsheet.getName() : undefined;

  return {
    spreadsheetId,
    spreadsheetName,
    inspectedAt: new Date().toISOString(),
    detectedItemsLayout,
    detectedUnitPriceLayout,
    activeSheets,
    forbiddenSheetsPresent: tabAudit.forbiddenSheetsPresent,
    unlistedSheetsPresent: tabAudit.unlistedSheetsPresent,
    warnings,
  };
}
