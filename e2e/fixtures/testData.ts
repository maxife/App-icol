export const ORDER_STATUSES = ['Réservé', 'Distribué'] as const;
export type OrderStatusLiteral = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = ['Non-payé', 'Payé', 'Donné'] as const;
export type PaymentStatusLiteral = (typeof PAYMENT_STATUSES)[number];

export const TRANSFER_STATUSES = ['Non concerné', 'À reverser', 'Reversé'] as const;
export type TransferStatusLiteral = (typeof TRANSFER_STATUSES)[number];

export const ACCOUNTING_TYPES = ['Recette', 'Dépense'] as const;
export type AccountingTypeLiteral = (typeof ACCOUNTING_TYPES)[number];

export const ACCOUNTING_REVENUE_CATEGORIES = [
  'Ventes de miel',
  "Ventes d'essaims",
  'Autres recettes',
] as const;

export const ACCOUNTING_EXPENSE_CATEGORIES = [
  'Investissements matériel / reines',
  'Consommables (sirop, sucre, traitements)',
  'Conditionnement (pots, étiquettes)',
  'Charges et cotisations',
] as const;

export const ACCOUNTING_CATEGORIES = [
  ...ACCOUNTING_REVENUE_CATEGORIES,
  ...ACCOUNTING_EXPENSE_CATEGORIES,
] as const;

export type AccountingCategoryLiteral = (typeof ACCOUNTING_CATEGORIES)[number];

export const ALLOWED_SHEETS = [
  'Ventes Miel',
  'ParRecoltes',
  'ParCommandes',
  'ParPaiement',
  'ParArticles',
  'PUan',
  'Gestion recoltes',
  'Comptabilité rucher',
] as const;

export const FORBIDDEN_SHEETS = [
  'App: Logins',
  'App: Metadata',
  'ParNbPots',
  'TEST - NE PAS TOUCHER',
] as const;

export const FORBIDDEN_SHEET_VARIANTS = [
  'App: Logins',
  'App: Metadata',
  'ParNbPots',
  'TEST - NE PAS TOUCHER',
  'TEST \\- NE PAS TOUCHER',
  'TEST – NE PAS TOUCHER',
  'TEST — NE PAS TOUCHER',
] as const;

export const READ_ONLY_SUMMARY_SHEETS = [
  'ParRecoltes',
  'ParCommandes',
  'ParPaiement',
] as const;

export const FRENCH_PHONE_NORMALIZATION_VECTORS = [
  {
    label: 'E.164 +33 with spaces',
    raw: '+33 6 12 34 56 78',
    expected: '06 12 34 56 78',
  },
  {
    label: '0033 international prefix compact',
    raw: '0033612345678',
    expected: '06 12 34 56 78',
  },
  {
    label: 'dot-separated French mobile',
    raw: '06.12.34.56.78',
    expected: '06 12 34 56 78',
  },
  {
    label: 'hyphen-separated French mobile',
    raw: '06-12-34-56-78',
    expected: '06 12 34 56 78',
  },
  {
    label: '9-digit Sheets leading-zero stripped integer',
    raw: '612345678',
    expected: '06 12 34 56 78',
  },
  {
    label: 'Unicode bidi LRM/LRE/PDF markers',
    raw: '\u200E\u202A+33 6 12 34 56 78\u202C',
    expected: '06 12 34 56 78',
  },
  {
    label: 'Unicode FSI/PDI and NBSP characters',
    raw: '\u206606\u00A012\u00A034\u00A056\u00A078\u2069',
    expected: '06 12 34 56 78',
  },
] as const;

export const INTERNATIONAL_PHONE_VECTORS = [
  {
    label: 'Swiss +41 mobile',
    raw: '+41 79 123 45 67',
    expectedPrefix: '+41',
    expectedDigits: '41791234567',
  },
  {
    label: 'Swiss 0041 international prefix',
    raw: '0041 79 123 45 67',
    expectedPrefix: '+41',
    expectedDigits: '41791234567',
  },
] as const;

export const DEFORMATTED_PHONE_SEARCH_QUERIES = [
  '06 12',
  '0612',
  '06.12',
  '+33612',
] as const;

export const CANONICAL_BUYERS = {
  repeatCustomer: {
    customerName: 'Nadine Chevalier',
    rawPhone: '+33 6 44 55 66 77',
    normalizedPhone: '06 44 55 66 77',
    relay: 'Relais Boulangerie Centrale',
  },
  accentedCustomer: {
    customerName: 'Élodie Bénard',
    asciiQuery: 'elodie',
    rawPhone: '06 87 65 43 21',
    normalizedPhone: '06 87 65 43 21',
    relay: "Marché d'Épinal",
    relayAsciiQuery: 'epinal',
  },
  anonymousDirect: {
    customerName: 'Vente directe Marché Samedi',
    phone: '',
    relay: '',
  },
  giftedRecipient: {
    customerName: 'Association Locale des Écoles',
    phone: '06 33 44 55 66',
    relay: 'Mairie du Village',
  },
} as const;

export const CANONICAL_HARVEST_VECTORS = {
  isolatedRealized: {
    label: 'Acacia Isolé 2027',
    year: 2027,
    forecastKg: 60,
    realizedKg: 60,
    defaultUnitPrice: 15,
  },
  isolatedForecastOnly: {
    label: 'Tilleul Prévision 2027',
    year: 2027,
    forecastKg: 80,
    realizedKg: null,
    defaultUnitPrice: 16,
  },
  zeroRealizedCropFailure: {
    label: 'Gel Printemps 2027',
    year: 2027,
    forecastKg: 50,
    realizedKg: 0,
    defaultUnitPrice: 15,
  },
  whitespaceNormalization: {
    rawLabel: '  Printemps   2028  ',
    normalizedLabel: 'Printemps 2028',
    year: 2028,
    forecastKg: 45,
    realizedKg: 45,
    defaultUnitPrice: 15,
  },
} as const;

export const CANONICAL_JAR_FORMAT_VECTORS = {
  tasting125g: {
    code: '125g',
    label: 'Pot dégustation 125 g',
    weightKg: 0.125,
  },
  familyBucket3kg: {
    code: '3kg',
    label: 'Seau familial 3 kg',
    weightKg: 3,
  },
} as const;

export const CANONICAL_ACCOUNTING_VECTORS = {
  swarmRevenue: {
    type: 'Recette' as const,
    category: "Ventes d'essaims" as const,
    label: 'Cession 3 essaims hivernés',
    amount: 240,
    date: '2027-04-18',
  },
  otherRevenue: {
    type: 'Recette' as const,
    category: 'Autres recettes' as const,
    label: 'Pollinisation verger communal',
    amount: 150,
    date: '2027-05-10',
  },
  manualHoneyRevenue: {
    type: 'Recette' as const,
    category: 'Ventes de miel' as const,
    label: 'Caisse foire annuelle hors suivi',
    amount: 95,
    date: '2027-07-12',
  },
  consumablesExpense: {
    type: 'Dépense' as const,
    category: 'Consommables (sirop, sucre, traitements)' as const,
    label: 'Nourrissement automne et traitement varroa',
    amount: 84.5,
    date: '2027-09-05',
  },
  packagingExpense: {
    type: 'Dépense' as const,
    category: 'Conditionnement (pots, étiquettes)' as const,
    label: 'Palette verrerie 500 g et capsules',
    amount: 132.4,
    date: '2027-05-22',
  },
  equipmentExpense: {
    type: 'Dépense' as const,
    category: 'Investissements matériel / reines' as const,
    label: '2 hausses Dadant et 4 reines Buckfast',
    amount: 210,
    date: '2027-03-14',
  },
  chargesExpense: {
    type: 'Dépense' as const,
    category: 'Charges et cotisations' as const,
    label: 'Assurance rucher et cotisation GDSA',
    amount: 65,
    date: '2027-01-20',
  },
} as const;
