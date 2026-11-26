import {
  ALLOWED_SHEETS,
  ALWAYS_READ_ONLY_SUMMARY_SHEETS,
  CONDITIONAL_SUMMARY_SHEETS,
  FORBIDDEN_SHEETS,
  RepositoryError,
  assertAllowedSheet,
  classifySheetAccess,
  type AllowedSheetName,
  type ForbiddenSheetName,
  type SheetAccessClassification,
} from '@app-icol/shared';

export {
  ALLOWED_SHEETS,
  ALWAYS_READ_ONLY_SUMMARY_SHEETS,
  CONDITIONAL_SUMMARY_SHEETS,
  FORBIDDEN_SHEETS,
  assertAllowedSheet,
  classifySheetAccess,
  type AllowedSheetName,
  type ForbiddenSheetName,
  type SheetAccessClassification,
};

export interface WorkbookSheetNameAudit {
  presentAllowedSheets: Set<AllowedSheetName>;
  forbiddenSheetsPresent: string[];
  unlistedSheetsPresent: string[];
}

/**
 * Safely retrieves one of the 8 ALLOWED_SHEETS after enforcing SheetGuard.
 * Hard-blocks all 4 FORBIDDEN_SHEETS (and dash/escape/case variants) with FORBIDDEN_SHEET
 * and any unknown tab with UNLISTED_SHEET BEFORE touching Spreadsheet.getSheetByName().
 */
export function getAllowedSheet(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
  rawSheetName: string,
): GoogleAppsScript.Spreadsheet.Sheet | null {
  const allowedName = assertAllowedSheet(rawSheetName);
  return spreadsheet.getSheetByName(allowedName);
}

/**
 * Safely retrieves a required allowed sheet, throwing SCHEMA_MISMATCH if absent from the workbook.
 */
export function requireAllowedSheet(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
  rawSheetName: string,
): GoogleAppsScript.Spreadsheet.Sheet {
  const allowedName = assertAllowedSheet(rawSheetName);
  const sheet = spreadsheet.getSheetByName(allowedName);
  if (!sheet) {
    throw new RepositoryError(
      'SCHEMA_MISMATCH',
      `L'onglet requis "${allowedName}" est introuvable dans le classeur Google Sheets.`,
      { sheetName: allowedName },
    );
  }
  return sheet;
}

/**
 * Enforces both SheetGuard (ALLOWED vs FORBIDDEN/UNLISTED) and summary-tab write protection
 * (ParRecoltes, ParCommandes, ParPaiement always blocked; ParArticles blocked when formula-driven).
 */
export function assertWritableAllowedSheet(
  rawSheetName: string,
  options: { isFormulaDrivenSummary?: boolean } = {},
): AllowedSheetName {
  const allowedName = assertAllowedSheet(rawSheetName);

  if ((ALWAYS_READ_ONLY_SUMMARY_SHEETS as readonly string[]).includes(allowedName)) {
    throw new RepositoryError(
      'READ_ONLY_SUMMARY_SHEET',
      `Écriture interdite sur l'onglet de synthèse piloté par formules "${allowedName}".`,
      { sheetName: allowedName },
    );
  }

  if (
    options.isFormulaDrivenSummary &&
    (CONDITIONAL_SUMMARY_SHEETS as readonly string[]).includes(allowedName)
  ) {
    throw new RepositoryError(
      'READ_ONLY_SUMMARY_SHEET',
      `Écriture interdite sur l'onglet "${allowedName}" car il contient des formules de synthèse.`,
      { sheetName: allowedName },
    );
  }

  return allowedName;
}

/**
 * Audits tab names in the workbook by calling ONLY sheet.getName().
 * Strictly NEVER reads cells, ranges, or formulas on forbidden or unlisted sheets.
 */
export function auditWorkbookSheetNames(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
): WorkbookSheetNameAudit {
  const presentAllowedSheets = new Set<AllowedSheetName>();
  const forbiddenSheetsPresent: string[] = [];
  const unlistedSheetsPresent: string[] = [];

  for (const sheet of spreadsheet.getSheets()) {
    const tabName = sheet.getName();
    const classification = classifySheetAccess(tabName);
    if (classification.allowed) {
      presentAllowedSheets.add(classification.sheetName);
    } else if (classification.status === 'FORBIDDEN') {
      forbiddenSheetsPresent.push(tabName);
    } else {
      unlistedSheetsPresent.push(tabName);
    }
  }

  return {
    presentAllowedSheets,
    forbiddenSheetsPresent,
    unlistedSheetsPresent,
  };
}
