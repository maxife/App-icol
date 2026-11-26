import { RepositoryError, type GasErrorCode } from '../types/api';
import type { JarFormat, SalesItemsLayout, UnitPriceTabLayout } from '../types/domain';
import { normalizeSearchText, stripInvisibleChars } from '../domain/normalizers';

export const ALLOWED_SHEETS = [
  'Ventes Miel',
  'ParRecoltes',         // NO accent on 'e' (spec §5.1 line 86)
  'ParCommandes',
  'ParPaiement',
  'ParArticles',
  'PUan',
  'Gestion recoltes',    // NO accent on 'e' (spec §5.1 line 86)
  'Comptabilité rucher', // WITH 'é' (spec §5.1 line 86)
] as const;

export type AllowedSheetName = (typeof ALLOWED_SHEETS)[number];

export const FORBIDDEN_SHEETS = [
  'App: Logins',
  'App: Metadata',
  'ParNbPots',
  'TEST - NE PAS TOUCHER',
] as const;

export type ForbiddenSheetName = (typeof FORBIDDEN_SHEETS)[number];

export const ALWAYS_READ_ONLY_SUMMARY_SHEETS = [
  'ParRecoltes',
  'ParCommandes',
  'ParPaiement',
] as const satisfies readonly AllowedSheetName[];

export const CONDITIONAL_SUMMARY_SHEETS = [
  'ParArticles',
] as const satisfies readonly AllowedSheetName[];

/**
 * Normalizes escaped Markdown punctuation (`\-`), Unicode dashes (`–`, `—`, `−`),
 * accents, case, and whitespace around `:` and `-` for forbidden/near-match checks.
 */
export function normalizeSheetComparisonKey(raw: string): string {
  return stripInvisibleChars(raw)
    .replace(/\\([\-_:()])/g, '$1')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u00A0\u202F]/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s*:\s*/g, ': ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type SheetAccessClassification =
  | {
      allowed: true;
      status: 'ALLOWED';
      sheetName: AllowedSheetName;
      isAlwaysReadOnlySummary: boolean;
    }
  | {
      allowed: false;
      status: 'FORBIDDEN';
      errorCode: Extract<GasErrorCode, 'FORBIDDEN_SHEET'>;
      matchedForbiddenSheet: ForbiddenSheetName;
    }
  | {
      allowed: false;
      status: 'UNLISTED';
      errorCode: Extract<GasErrorCode, 'UNLISTED_SHEET'>;
      nearMatchAllowedSheet?: AllowedSheetName;
    };

export function classifySheetAccess(rawSheetName: string): SheetAccessClassification {
  const compKey = normalizeSheetComparisonKey(rawSheetName);

  // 1. Hard-block FORBIDDEN_SHEETS first (catches 'TEST \- NE PAS TOUCHER', 'TEST – NE PAS TOUCHER', ' app: logins ')
  for (const forbidden of FORBIDDEN_SHEETS) {
    if (rawSheetName === forbidden || compKey === normalizeSheetComparisonKey(forbidden)) {
      return {
        allowed: false,
        status: 'FORBIDDEN',
        errorCode: 'FORBIDDEN_SHEET',
        matchedForbiddenSheet: forbidden,
      };
    }
  }

  // 2. Exact character-for-character match required for ALLOWED_SHEETS
  if ((ALLOWED_SHEETS as readonly string[]).includes(rawSheetName)) {
    const sheetName = rawSheetName as AllowedSheetName;
    const isAlwaysReadOnlySummary = (
      ALWAYS_READ_ONLY_SUMMARY_SHEETS as readonly string[]
    ).includes(sheetName);
    return {
      allowed: true,
      status: 'ALLOWED',
      sheetName,
      isAlwaysReadOnlySummary,
    };
  }

  // 3. Reject unlisted sheet, attaching near-match hint if only accents/case/spaces differed
  const nearMatchAllowedSheet = ALLOWED_SHEETS.find(
    (allowed) => normalizeSheetComparisonKey(allowed) === compKey,
  );

  return {
    allowed: false,
    status: 'UNLISTED',
    errorCode: 'UNLISTED_SHEET',
    nearMatchAllowedSheet,
  };
}

export function assertAllowedSheet(rawSheetName: string): AllowedSheetName {
  const res = classifySheetAccess(rawSheetName);
  if (!res.allowed) {
    if (res.status === 'FORBIDDEN') {
      throw new RepositoryError(
        'FORBIDDEN_SHEET',
        `Accès strictement interdit à l'onglet protégé "${res.matchedForbiddenSheet}".`,
        { requestedSheet: rawSheetName, matchedForbiddenSheet: res.matchedForbiddenSheet },
      );
    }
    const hint = res.nearMatchAllowedSheet
      ? ` (onglet proche autorisé : "${res.nearMatchAllowedSheet}")`
      : '';
    throw new RepositoryError(
      'UNLISTED_SHEET',
      `Onglet "${rawSheetName}" non autorisé dans le schéma App-icol${hint}.`,
      { requestedSheet: rawSheetName, nearMatchAllowedSheet: res.nearMatchAllowedSheet },
    );
  }
  return res.sheetName;
}

export function normalizeHeaderKey(rawHeader: string): string {
  return normalizeSearchText(
    stripInvisibleChars(rawHeader).replace(/🔒/g, ' '),
  );
}

export interface SheetFieldDefinition {
  key: string;
  canonicalHeader: string;
  required: boolean;
  aliases: readonly string[];
  mayContainFormula?: boolean;
  forceTextFormat?: boolean;
}

export interface SheetTabSchema {
  sheetName: AllowedSheetName;
  fields: readonly SheetFieldDefinition[];
}

export interface SchemaConfig {
  defaultSalesItemsLayout: SalesItemsLayout;
  defaultUnitPriceLayout: UnitPriceTabLayout;
  formatColumnAliases: Readonly<Record<string, readonly string[]>>;
  salesRowPerItemFields: readonly SheetFieldDefinition[];
  unitPriceRowPerFormatFields: readonly SheetFieldDefinition[];
  tabs: Readonly<
    Record<
      'Ventes Miel' | 'PUan' | 'ParArticles' | 'Gestion recoltes' | 'Comptabilité rucher',
      SheetTabSchema
    >
  >;
}

export const DEFAULT_SCHEMA_CONFIG: SchemaConfig = {
  defaultSalesItemsLayout: 'columns_per_format',
  defaultUnitPriceLayout: 'matrix_by_format',
  formatColumnAliases: {
    '1kg': ['Pot 1 kg', 'Pot 1kg', '1 kg', '1kg', 'Pots 1kg', 'Nb 1kg', 'PU 1kg'],
    '500g': [
      'Pot 500 g',
      'Pot 500g',
      '500 g',
      '500g',
      '0,5 kg',
      '0.5 kg',
      'Pots 500g',
      'Nb 500g',
      'PU 500g',
    ],
    '250g': [
      'Pot 250 g',
      'Pot 250g',
      '250 g',
      '250g',
      '0,25 kg',
      '0.25 kg',
      'Pots 250g',
      'Nb 250g',
      'PU 250g',
    ],
  },
  salesRowPerItemFields: [
    {
      key: 'orderGroupId',
      canonicalHeader: 'N° commande',
      required: false,
      aliases: ['n° commande', 'numero commande', 'commande id', 'order id'],
    },
    {
      key: 'itemFormat',
      canonicalHeader: 'Article',
      required: true,
      aliases: ['article', 'format', 'pot', 'designation'],
    },
    {
      key: 'itemQuantity',
      canonicalHeader: 'Quantité',
      required: true,
      aliases: ['quantite', 'qte', 'nb pots', 'nombre'],
    },
    {
      key: 'itemUnitPriceEur',
      canonicalHeader: 'Prix unitaire',
      required: false,
      aliases: ['prix unitaire', 'pu', 'tarif unitaire'],
    },
  ],
  unitPriceRowPerFormatFields: [
    {
      key: 'harvestLabel',
      canonicalHeader: 'Récolte',
      required: true,
      aliases: ['recolte', 'nom recolte', 'saison', 'millesime', 'annee', 'puan'],
    },
    {
      key: 'formatCode',
      canonicalHeader: 'Article',
      required: true,
      aliases: ['article', 'format', 'pot', 'code'],
    },
    {
      key: 'unitPriceEur',
      canonicalHeader: 'Prix unitaire',
      required: true,
      aliases: ['pu', 'prix unitaire', 'tarif', 'prix'],
    },
  ],
  tabs: {
    'Ventes Miel': {
      sheetName: 'Ventes Miel',
      fields: [
        {
          key: 'id',
          canonicalHeader: 'ID',
          required: false,
          aliases: ['id', 'row id', '🔒 row id', 'app_id', 'uid'],
        },
        {
          key: 'date',
          canonicalHeader: 'Date',
          required: true,
          aliases: ['date', 'date commande', 'date vente', 'jour'],
        },
        {
          key: 'customerName',
          canonicalHeader: 'Client',
          required: true,
          aliases: ['client', 'nom', 'destinataire', 'acheteur', 'nom client', 'personne'],
        },
        {
          key: 'phone',
          canonicalHeader: 'Téléphone',
          required: false,
          forceTextFormat: true,
          aliases: ['telephone', 'tel', 'mobile', 'contact', 'portable', 'numero'],
        },
        {
          key: 'contextOrRelay',
          canonicalHeader: 'Lieu / Relais',
          required: false,
          aliases: [
            'lieu / relais',
            'lieu',
            'relais',
            'contexte',
            'personne relais',
            'lieu de remise',
            'precision',
            'commentaire',
            'remarque',
          ],
        },
        {
          key: 'harvestLabel',
          canonicalHeader: 'Récolte',
          required: true,
          aliases: ['recolte', 'miel', 'millesime', 'type miel', 'saison'],
        },
        {
          key: 'computedWeightKg',
          canonicalHeader: 'Poids (Kg)',
          required: false,
          mayContainFormula: true,
          aliases: ['poids (kg)', 'poids kg', 'poids', 'total kg', 'poids total', 'kg'],
        },
        {
          key: 'amountEur',
          canonicalHeader: 'Prix',
          required: false,
          mayContainFormula: true,
          aliases: ['prix', 'montant', 'total', 'prix (€)', 'montant total', 'total €'],
        },
        {
          key: 'manualAmountOverrideEur',
          canonicalHeader: 'Tarif particulier',
          required: false,
          aliases: ['tarif particulier', 'prix force', 'montant manuel', 'override prix'],
        },
        {
          key: 'orderStatus',
          canonicalHeader: 'Statut commande',
          required: true,
          aliases: [
            'statut commande',
            'statut',
            'commande',
            'livraison',
            'etat commande',
            'remise',
          ],
        },
        {
          key: 'paymentStatus',
          canonicalHeader: 'Statut règlement',
          required: true,
          aliases: [
            'statut reglement',
            'statut paiement',
            'paiement',
            'reglement',
            'etat paiement',
          ],
        },
        {
          key: 'collectedByThirdParty',
          canonicalHeader: 'Encaissé par tiers',
          required: false,
          aliases: ['encaisse par tiers', 'tiers', 'par tiers'],
        },
        {
          key: 'collectorName',
          canonicalHeader: 'Encaissé par',
          required: false,
          aliases: ['encaisse par', 'collecteur', 'co-vendeur', 'vendeur'],
        },
        {
          key: 'transferStatus',
          canonicalHeader: 'Statut transfert',
          required: false,
          aliases: ['statut transfert', 'transfert', 'reversement', 'a reverser'],
        },
        {
          key: 'notes',
          canonicalHeader: 'Notes',
          required: false,
          aliases: ['notes', 'note', 'observations'],
        },
        {
          key: 'updatedAt',
          canonicalHeader: 'Mis à jour le',
          required: false,
          aliases: ['mis a jour le', 'updated_at', 'maj', 'derniere modif'],
        },
      ],
    },
    PUan: {
      sheetName: 'PUan',
      fields: [
        {
          key: 'harvestLabel',
          canonicalHeader: 'Récolte',
          required: true,
          aliases: ['recolte', 'nom recolte', 'saison', 'millesime', 'annee', 'puan'],
        },
      ],
    },
    ParArticles: {
      sheetName: 'ParArticles',
      fields: [
        {
          key: 'code',
          canonicalHeader: 'Code',
          required: false,
          aliases: ['code', 'id', 'code format'],
        },
        {
          key: 'label',
          canonicalHeader: 'Article',
          required: true,
          aliases: ['article', 'format', 'pot', 'libelle', 'designation'],
        },
        {
          key: 'weightKg',
          canonicalHeader: 'Poids (Kg)',
          required: true,
          aliases: ['poids (kg)', 'poids kg', 'poids', 'poids unitaire', 'kg'],
        },
        {
          key: 'active',
          canonicalHeader: 'Actif',
          required: false,
          aliases: ['actif', 'active', 'disponible'],
        },
      ],
    },
    'Gestion recoltes': {
      sheetName: 'Gestion recoltes',
      fields: [
        {
          key: 'id',
          canonicalHeader: 'ID',
          required: false,
          aliases: ['id', 'code', 'slug'],
        },
        {
          key: 'label',
          canonicalHeader: 'Récolte',
          required: true,
          aliases: ['recolte', 'nom recolte', 'libelle', 'saison', 'millesime'],
        },
        {
          key: 'year',
          canonicalHeader: 'Année',
          required: false,
          aliases: ['annee', 'millesime', 'exercice'],
        },
        {
          key: 'forecastWeightKg',
          canonicalHeader: 'Poids prévisionnel (Kg)',
          required: false,
          aliases: [
            'poids previsionnel (kg)',
            'poids previsionnel',
            'previsionnel (kg)',
            'previsionnel',
            'estime',
            'objectif kg',
          ],
        },
        {
          key: 'realizedWeightKg',
          canonicalHeader: 'Poids réalisé (Kg)',
          required: false,
          aliases: [
            'poids realise (kg)',
            'poids realise',
            'realise (kg)',
            'realise',
            'recolte (kg)',
            'poids recolte',
            'reel',
          ],
        },
        {
          key: 'isDefaultActive',
          canonicalHeader: 'Récolte active',
          required: false,
          aliases: ['recolte active', 'active', 'actif', 'par defaut', 'en cours'],
        },
      ],
    },
    'Comptabilité rucher': {
      sheetName: 'Comptabilité rucher',
      fields: [
        {
          key: 'id',
          canonicalHeader: 'ID',
          required: false,
          aliases: ['id', 'row id', 'uid'],
        },
        {
          key: 'date',
          canonicalHeader: 'Date',
          required: true,
          aliases: ['date', 'date operation', 'jour'],
        },
        {
          key: 'year',
          canonicalHeader: 'Année',
          required: false,
          mayContainFormula: true,
          aliases: ['annee', 'exercice'],
        },
        {
          key: 'type',
          canonicalHeader: 'Type',
          required: true,
          aliases: ['type', 'sens', 'nature'],
        },
        {
          key: 'category',
          canonicalHeader: 'Catégorie',
          required: true,
          aliases: ['categorie', 'poste', 'rubrique'],
        },
        {
          key: 'label',
          canonicalHeader: 'Libellé',
          required: true,
          aliases: ['libelle', 'description', 'objet', 'intitule', 'motif'],
        },
        {
          key: 'amountEur',
          canonicalHeader: 'Montant (€)',
          required: true,
          aliases: ['montant (€)', 'montant', 'montant eur', 'somme', 'prix'],
        },
        {
          key: 'notes',
          canonicalHeader: 'Notes',
          required: false,
          aliases: ['notes', 'note', 'observations', 'justificatif'],
        },
      ],
    },
  },
};

export function buildFormatColumnAliases(
  format: Pick<JarFormat, 'code' | 'label' | 'weightKg'>,
): string[] {
  const staticAliases = DEFAULT_SCHEMA_CONFIG.formatColumnAliases[format.code] ?? [];
  const grams = Math.round(format.weightKg * 1000);
  const dynamic = [
    format.label,
    format.code,
    `Pot ${format.code}`,
    `Pots ${format.code}`,
    `Nb ${format.code}`,
    `PU ${format.code}`,
    grams >= 1000 && grams % 1000 === 0 ? `Pot ${grams / 1000} kg` : `Pot ${grams} g`,
  ];
  return Array.from(new Set([...staticAliases, ...dynamic].map(normalizeHeaderKey)));
}

export function resolveSheetHeaders(
  row1Headers: readonly string[],
  fields: readonly SheetFieldDefinition[],
): { fieldMap: Record<string, number>; missingRequiredFields: string[] } {
  const normalizedHeaders = row1Headers.map(normalizeHeaderKey);
  const fieldMap: Record<string, number> = {};
  const usedCols = new Set<number>();

  for (const field of fields) {
    const candidateKeys = Array.from(
      new Set([field.canonicalHeader, ...field.aliases].map(normalizeHeaderKey)),
    );
    let matchedCol = -1;
    for (const candidate of candidateKeys) {
      const idx = normalizedHeaders.findIndex(
        (hdr, colIdx) => hdr === candidate && !usedCols.has(colIdx + 1),
      );
      if (idx !== -1) {
        matchedCol = idx + 1; // 1-based column index
        break;
      }
    }
    if (matchedCol !== -1) {
      fieldMap[field.key] = matchedCol;
      usedCols.add(matchedCol);
    }
  }

  const missingRequiredFields = fields
    .filter((f) => f.required && fieldMap[f.key] === undefined)
    .map((f) => f.key);

  return { fieldMap, missingRequiredFields };
}

export function detectSalesItemsLayout(
  row1Headers: readonly string[],
  formats: readonly JarFormat[],
): SalesItemsLayout {
  const normalizedHeaders = new Set(row1Headers.map(normalizeHeaderKey));
  for (const fmt of formats) {
    const aliases = buildFormatColumnAliases(fmt);
    if (aliases.some((a) => normalizedHeaders.has(a))) {
      return 'columns_per_format';
    }
  }
  const rowRes = resolveSheetHeaders(
    row1Headers,
    DEFAULT_SCHEMA_CONFIG.salesRowPerItemFields,
  );
  if (rowRes.missingRequiredFields.length === 0) {
    return 'row_per_item';
  }
  return DEFAULT_SCHEMA_CONFIG.defaultSalesItemsLayout;
}

export function detectUnitPriceTabLayout(
  row1Headers: readonly string[],
  formats: readonly JarFormat[],
): UnitPriceTabLayout {
  const normalizedHeaders = new Set(row1Headers.map(normalizeHeaderKey));
  for (const fmt of formats) {
    const aliases = buildFormatColumnAliases(fmt);
    if (aliases.some((a) => normalizedHeaders.has(a))) {
      return 'matrix_by_format';
    }
  }
  const rowRes = resolveSheetHeaders(
    row1Headers,
    DEFAULT_SCHEMA_CONFIG.unitPriceRowPerFormatFields,
  );
  if (rowRes.missingRequiredFields.length === 0) {
    return 'row_per_format';
  }
  return DEFAULT_SCHEMA_CONFIG.defaultUnitPriceLayout;
}
