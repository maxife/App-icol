import {
  DEFAULT_SCHEMA_CONFIG,
  RepositoryError,
  buildFormatColumnAliases,
  detectSalesItemsLayout,
  detectUnitPriceTabLayout,
  normalizeHeaderKey,
  resolveSheetHeaders,
  type AllowedSheetName,
  type JarFormat,
  type SalesItemsLayout,
  type SchemaConfig,
  type SheetFieldDefinition,
  type SheetTabSchema,
  type UnitPriceTabLayout,
} from '@app-icol/shared';
import { assertAllowedSheet } from './SheetGuard';

export type StructuredTabName = keyof SchemaConfig['tabs'];

export function isStructuredTabName(name: AllowedSheetName): name is StructuredTabName {
  return name in DEFAULT_SCHEMA_CONFIG.tabs;
}

export interface ResolvedSheetHeaderInfo {
  sheetName: AllowedSheetName;
  headers: string[];
  fieldMap: Record<string, number>; // fieldKey -> 1-based column index
  missingRequiredFields: string[];
}

export interface ResolvedFormatColumns {
  /** formatCode -> 1-based column index */
  formatColMap: Record<string, number>;
  /** 1-based column index -> formatCode */
  colToFormatMap: Record<number, string>;
}

interface RawSchemaOverrides {
  defaultSalesItemsLayout?: SalesItemsLayout;
  defaultUnitPriceLayout?: UnitPriceTabLayout;
  formatColumnAliases?: Record<string, readonly string[]>;
  tabs?: Record<
    string,
    | { fields?: ReadonlyArray<Partial<SheetFieldDefinition> & { key: string }> }
    | Record<string, readonly string[] | Partial<SheetFieldDefinition>>
  >;
}

function mergeTabFields(
  baseFields: readonly SheetFieldDefinition[],
  rawTabOverride: unknown,
): readonly SheetFieldDefinition[] {
  if (!rawTabOverride || typeof rawTabOverride !== 'object') {
    return baseFields;
  }

  const asObj = rawTabOverride as Record<string, unknown>;
  if (Array.isArray(asObj.fields)) {
    const overridesByKey = new Map<string, Partial<SheetFieldDefinition>>();
    for (const item of asObj.fields) {
      if (item && typeof item === 'object' && typeof (item as { key?: unknown }).key === 'string') {
        overridesByKey.set(
          (item as { key: string }).key,
          item as Partial<SheetFieldDefinition>,
        );
      }
    }
    return baseFields.map((field) => {
      const patch = overridesByKey.get(field.key);
      if (!patch) return field;
      return {
        ...field,
        ...patch,
        aliases: patch.aliases
          ? Array.from(new Set([...patch.aliases, ...field.aliases]))
          : field.aliases,
      };
    });
  }

  return baseFields.map((field) => {
    const entry = asObj[field.key];
    if (!entry) return field;
    if (Array.isArray(entry)) {
      const extraAliases = entry.filter((v): v is string => typeof v === 'string');
      return {
        ...field,
        aliases: Array.from(new Set([...extraAliases, ...field.aliases])),
      };
    }
    if (typeof entry === 'object') {
      const patch = entry as Partial<SheetFieldDefinition>;
      return {
        ...field,
        ...patch,
        aliases: patch.aliases
          ? Array.from(new Set([...patch.aliases, ...field.aliases]))
          : field.aliases,
      };
    }
    return field;
  });
}

/**
 * Loads the effective SchemaConfig, optionally merging SCHEMA_OVERRIDES_JSON from ScriptProperties.
 */
export function loadSchemaConfig(rawOverridesJson?: string | null): SchemaConfig {
  const trimmed = rawOverridesJson?.trim();
  if (!trimmed) {
    return DEFAULT_SCHEMA_CONFIG;
  }

  let parsed: RawSchemaOverrides;
  try {
    parsed = JSON.parse(trimmed) as RawSchemaOverrides;
  } catch (err) {
    throw new RepositoryError(
      'SERVER_MISCONFIGURED',
      'Propriété SCHEMA_OVERRIDES_JSON invalide (JSON malformé).',
      err instanceof Error ? err.message : String(err),
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new RepositoryError(
      'SERVER_MISCONFIGURED',
      'Propriété SCHEMA_OVERRIDES_JSON invalide (objet JSON attendu).',
    );
  }

  const mergedFormatAliases: Record<string, readonly string[]> = {
    ...DEFAULT_SCHEMA_CONFIG.formatColumnAliases,
  };
  if (parsed.formatColumnAliases && typeof parsed.formatColumnAliases === 'object') {
    for (const [code, aliases] of Object.entries(parsed.formatColumnAliases)) {
      if (Array.isArray(aliases)) {
        const cleanAliases = aliases.filter((a): a is string => typeof a === 'string');
        const prev = mergedFormatAliases[code] ?? [];
        mergedFormatAliases[code] = Array.from(new Set([...cleanAliases, ...prev]));
      }
    }
  }

  const nextTabs = { ...DEFAULT_SCHEMA_CONFIG.tabs } as Record<
    StructuredTabName,
    SheetTabSchema
  >;
  if (parsed.tabs && typeof parsed.tabs === 'object') {
    for (const tabKey of Object.keys(DEFAULT_SCHEMA_CONFIG.tabs) as StructuredTabName[]) {
      const override = parsed.tabs[tabKey];
      if (override) {
        nextTabs[tabKey] = {
          sheetName: tabKey,
          fields: mergeTabFields(DEFAULT_SCHEMA_CONFIG.tabs[tabKey].fields, override),
        };
      }
    }
  }

  return {
    defaultSalesItemsLayout:
      parsed.defaultSalesItemsLayout === 'columns_per_format' ||
      parsed.defaultSalesItemsLayout === 'row_per_item'
        ? parsed.defaultSalesItemsLayout
        : DEFAULT_SCHEMA_CONFIG.defaultSalesItemsLayout,
    defaultUnitPriceLayout:
      parsed.defaultUnitPriceLayout === 'matrix_by_format' ||
      parsed.defaultUnitPriceLayout === 'row_per_format'
        ? parsed.defaultUnitPriceLayout
        : DEFAULT_SCHEMA_CONFIG.defaultUnitPriceLayout,
    formatColumnAliases: mergedFormatAliases,
    salesRowPerItemFields: DEFAULT_SCHEMA_CONFIG.salesRowPerItemFields,
    unitPriceRowPerFormatFields: DEFAULT_SCHEMA_CONFIG.unitPriceRowPerFormatFields,
    tabs: nextTabs,
  };
}

/**
 * Reads Row 1 header cells dynamically without any fixed column count assumptions.
 */
export function readRow1Headers(sheet: GoogleAppsScript.Spreadsheet.Sheet): string[] {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) {
    return [];
  }
  const range = sheet.getRange(1, 1, 1, lastCol);
  const rawRow =
    typeof range.getDisplayValues === 'function'
      ? range.getDisplayValues()[0]
      : range.getValues()[0];
  if (!rawRow) return [];
  return rawRow.map((cell) => String(cell ?? '').trim());
}

/**
 * Resolves field keys to 1-based column indices from Row 1 headers using schema aliases.
 */
export function resolveTabHeadersFromRow(
  sheetName: AllowedSheetName,
  row1Headers: readonly string[],
  schemaConfig: SchemaConfig = DEFAULT_SCHEMA_CONFIG,
  options: {
    salesLayout?: SalesItemsLayout;
    unitPriceLayout?: UnitPriceTabLayout;
  } = {},
): ResolvedSheetHeaderInfo {
  assertAllowedSheet(sheetName);

  if (!isStructuredTabName(sheetName)) {
    const fallbackMap: Record<string, number> = {};
    row1Headers.forEach((hdr, idx) => {
      const norm = normalizeHeaderKey(hdr);
      if (norm && fallbackMap[norm] === undefined) {
        fallbackMap[norm] = idx + 1;
      }
    });
    return {
      sheetName,
      headers: [...row1Headers],
      fieldMap: fallbackMap,
      missingRequiredFields: [],
    };
  }

  let fields: readonly SheetFieldDefinition[] = schemaConfig.tabs[sheetName].fields;

  if (sheetName === 'Ventes Miel' && options.salesLayout === 'row_per_item') {
    fields = [...fields, ...schemaConfig.salesRowPerItemFields];
  } else if (sheetName === 'PUan' && options.unitPriceLayout === 'row_per_format') {
    fields = schemaConfig.unitPriceRowPerFormatFields;
  }

  const { fieldMap, missingRequiredFields } = resolveSheetHeaders(row1Headers, fields);
  return {
    sheetName,
    headers: [...row1Headers],
    fieldMap,
    missingRequiredFields,
  };
}

/**
 * Reads Row 1 of a sheet, resolves required/optional columns, and throws SCHEMA_MISMATCH
 * if any required column cannot be resolved.
 */
export function requireTabHeaders(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  sheetName: AllowedSheetName,
  schemaConfig: SchemaConfig = DEFAULT_SCHEMA_CONFIG,
  options: {
    salesLayout?: SalesItemsLayout;
    unitPriceLayout?: UnitPriceTabLayout;
  } = {},
): ResolvedSheetHeaderInfo {
  const row1Headers = readRow1Headers(sheet);
  const resolved = resolveTabHeadersFromRow(sheetName, row1Headers, schemaConfig, options);
  if (resolved.missingRequiredFields.length > 0) {
    throw new RepositoryError(
      'SCHEMA_MISMATCH',
      `Colonnes obligatoires introuvables dans l'onglet "${sheetName}" : ${resolved.missingRequiredFields.join(', ')}.`,
      {
        sheetName,
        missingRequiredFields: resolved.missingRequiredFields,
        headers: row1Headers,
      },
    );
  }
  return resolved;
}

function buildEffectiveFormatAliases(
  format: Pick<JarFormat, 'code' | 'label' | 'weightKg'>,
  schemaConfig: SchemaConfig,
): string[] {
  const customAliases = schemaConfig.formatColumnAliases[format.code] ?? [];
  const baseAliases = buildFormatColumnAliases(format);
  return Array.from(new Set([...customAliases.map(normalizeHeaderKey), ...baseAliases]));
}

/**
 * Dynamically maps JarFormat codes to 1-based column indices in Row 1 (for Ventes Miel & PUan).
 */
export function resolveFormatColumns(
  row1Headers: readonly string[],
  formats: readonly JarFormat[],
  schemaConfig: SchemaConfig = DEFAULT_SCHEMA_CONFIG,
  reservedColumns: ReadonlySet<number> = new Set(),
): ResolvedFormatColumns {
  const normalizedHeaders = row1Headers.map(normalizeHeaderKey);
  const usedCols = new Set<number>(reservedColumns);
  const formatColMap: Record<string, number> = {};
  const colToFormatMap: Record<number, string> = {};

  for (const format of formats) {
    const candidateAliases = buildEffectiveFormatAliases(format, schemaConfig);
    let matchedCol = -1;
    for (const alias of candidateAliases) {
      const idx = normalizedHeaders.findIndex(
        (hdr, colIdx) => hdr === alias && !usedCols.has(colIdx + 1),
      );
      if (idx !== -1) {
        matchedCol = idx + 1;
        break;
      }
    }
    if (matchedCol !== -1) {
      formatColMap[format.code] = matchedCol;
      colToFormatMap[matchedCol] = format.code;
      usedCols.add(matchedCol);
    }
  }

  return { formatColMap, colToFormatMap };
}

/**
 * Ensures a JarFormat column exists in Row 1 (appending at lastCol + 1 if missing)
 * when a manager creates a new format (e.g. 125g, 3kg) and writes unit prices or orders.
 */
export function ensureFormatColumn(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  format: JarFormat,
  schemaConfig: SchemaConfig = DEFAULT_SCHEMA_CONFIG,
  reservedColumns: ReadonlySet<number> = new Set(),
): number {
  const headers = readRow1Headers(sheet);
  const existing = resolveFormatColumns(headers, [format], schemaConfig, reservedColumns);
  const foundCol = existing.formatColMap[format.code];
  if (foundCol !== undefined) {
    return foundCol;
  }

  const nextCol = headers.length + 1;
  const headerText = format.label.trim() || `Pot ${format.code}`;
  sheet.getRange(1, nextCol, 1, 1).setValue(headerText);
  return nextCol;
}

export function detectSalesLayout(
  row1Headers: readonly string[],
  formats: readonly JarFormat[],
  schemaConfig: SchemaConfig = DEFAULT_SCHEMA_CONFIG,
): SalesItemsLayout {
  const rowRes = resolveSheetHeaders(row1Headers, schemaConfig.salesRowPerItemFields);
  const formatRes = resolveFormatColumns(row1Headers, formats, schemaConfig);
  const hasFormatCols = Object.keys(formatRes.formatColMap).length > 0;
  const hasRowPerItemCols = rowRes.missingRequiredFields.length === 0;

  if (hasRowPerItemCols && !hasFormatCols) {
    return 'row_per_item';
  }
  if (hasFormatCols && !hasRowPerItemCols) {
    return 'columns_per_format';
  }
  if (hasFormatCols && hasRowPerItemCols) {
    return schemaConfig.defaultSalesItemsLayout;
  }
  const detected = detectSalesItemsLayout(row1Headers, formats);
  return detected || schemaConfig.defaultSalesItemsLayout;
}

export function detectUnitPriceLayout(
  row1Headers: readonly string[],
  formats: readonly JarFormat[],
  schemaConfig: SchemaConfig = DEFAULT_SCHEMA_CONFIG,
): UnitPriceTabLayout {
  const rowRes = resolveSheetHeaders(row1Headers, schemaConfig.unitPriceRowPerFormatFields);
  const harvestColRes = resolveSheetHeaders(row1Headers, schemaConfig.tabs.PUan.fields);
  const reserved = new Set<number>(Object.values(harvestColRes.fieldMap));
  const formatRes = resolveFormatColumns(row1Headers, formats, schemaConfig, reserved);
  const hasFormatCols = Object.keys(formatRes.formatColMap).length > 0;
  const hasRowPerFormatCols = rowRes.missingRequiredFields.length === 0;

  if (hasRowPerFormatCols && !hasFormatCols) {
    return 'row_per_format';
  }
  if (hasFormatCols && !hasRowPerFormatCols) {
    return 'matrix_by_format';
  }
  if (hasFormatCols && hasRowPerFormatCols) {
    return schemaConfig.defaultUnitPriceLayout;
  }
  const detected = detectUnitPriceTabLayout(row1Headers, formats);
  return detected || schemaConfig.defaultUnitPriceLayout;
}
