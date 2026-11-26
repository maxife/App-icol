const INVISIBLE_CHARS_RE = /[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;

export function toCents(eur: number): number {
  if (eur === 0 || !Number.isFinite(eur)) return 0;
  const rounded = Math.sign(eur) * Math.round((Math.abs(eur) + Number.EPSILON) * 100);
  return rounded === 0 ? 0 : rounded;
}

export function fromCents(cents: number): number {
  if (cents === 0 || !Number.isFinite(cents)) return 0;
  const val = cents / 100;
  return val === 0 ? 0 : val;
}

export function roundCurrencyEur(eur: number): number {
  return fromCents(toCents(eur));
}

export function toGrams(kg: number): number {
  if (kg === 0 || !Number.isFinite(kg)) return 0;
  const rounded = Math.sign(kg) * Math.round((Math.abs(kg) + Number.EPSILON) * 1000);
  return rounded === 0 ? 0 : rounded;
}

export function fromGrams(grams: number): number {
  if (grams === 0 || !Number.isFinite(grams)) return 0;
  const val = grams / 1000;
  return val === 0 ? 0 : val;
}

export function roundWeightKg(kg: number): number {
  return fromGrams(toGrams(kg));
}

export function stripInvisibleChars(raw: string): string {
  return raw.replace(INVISIBLE_CHARS_RE, '');
}

function formatFrench10Digits(tenDigits: string): string {
  return `${tenDigits.slice(0, 2)} ${tenDigits.slice(2, 4)} ${tenDigits.slice(4, 6)} ${tenDigits.slice(6, 8)} ${tenDigits.slice(8, 10)}`;
}

export function normalizePhoneNumber(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  const str = stripInvisibleChars(String(raw))
    .replace(/[\u00A0\u202F]/g, ' ')
    .replace(/^\s*tel:\s*/i, '')
    .trim();

  if (!str) return '';

  // Preserve free-text notes like "Poste 42" without mangling
  if (/[a-zA-ZÀ-ÿ]/.test(str)) {
    return str.replace(/\s+/g, ' ');
  }

  // Collapse French trunk "(0)" after +33 or 0033 -> e.g. "+33 (0)6 12..."
  const normalizedTrunk = str.replace(/^(\+33|00\s*33)\s*\(0\)\s*/, '$1');
  const compact = normalizedTrunk.replace(/[\s.\-()/]/g, '');

  // French +33 or 0033 prefix
  const frIntlMatch = /^(?:\+33|0033)0?([1-9]\d{8})$/.exec(compact);
  if (frIntlMatch) {
    return formatFrench10Digits(`0${frIntlMatch[1]}`);
  }

  // Domestic French 10-digit 0X XX XX XX XX
  if (/^0[1-9]\d{8}$/.test(compact)) {
    return formatFrench10Digits(compact);
  }

  // Google Sheets integer-stripped 9-digit French number (e.g. 612345678)
  if (
    !normalizedTrunk.startsWith('+') &&
    !normalizedTrunk.startsWith('00') &&
    /^[1-9]\d{8}$/.test(compact)
  ) {
    return formatFrench10Digits(`0${compact}`);
  }

  // International 00CC -> +CC preservation (e.g. 0041 79 123 45 67 -> +41 79 123 45 67)
  if (/^00[1-9]/.test(compact)) {
    const withPlus = normalizedTrunk.replace(/^00\s*/, '+');
    return withPlus.replace(/[\s.\-/]+/g, ' ').replace(/\+\s+/, '+').trim();
  }

  // International +CC preservation (e.g. +41-79-123-45-67 -> +41 79 123 45 67)
  if (normalizedTrunk.startsWith('+')) {
    return normalizedTrunk.replace(/[\s.\-/]+/g, ' ').replace(/\+\s+/, '+').trim();
  }

  return str.replace(/\s+/g, ' ');
}

export function toPhoneSearchDigits(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  const cleaned = stripInvisibleChars(String(raw))
    .replace(/[\u00A0\u202F]/g, '')
    .replace(/^\s*tel:\s*/i, '')
    .trim();
  if (!cleaned) return '';

  const normalizedTrunk = cleaned.replace(/^(\+33|00\s*33)\s*\(0\)\s*/, '$1');
  const compact = normalizedTrunk.replace(/[\s.\-()/]/g, '');

  // Canonicalize full or partial +33 / 0033 query ("+33612" -> "0612")
  const frPrefixMatch = /^(?:\+33|0033)0?([1-9]\d*)$/.exec(compact);
  if (frPrefixMatch) {
    return `0${frPrefixMatch[1]}`;
  }

  // Exact 9-digit Sheet-stripped French phone -> prepend '0'
  if (!normalizedTrunk.startsWith('+') && /^[1-9]\d{8}$/.test(compact)) {
    return `0${compact}`;
  }

  return compact.replace(/\D/g, '');
}

export function normalizeSearchText(raw: string | null | undefined): string {
  if (!raw) return '';
  return stripInvisibleChars(raw)
    .replace(/[\u00A0\u202F]/g, ' ')
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/Æ/g, 'ae')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019`]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeHarvestLabel(raw: string | null | undefined): string {
  if (!raw) return '';
  return stripInvisibleChars(raw)
    .replace(/[\s\u00A0\u202F]+/g, ' ')
    .trim();
}

export function slugifyHarvestId(label: string): string {
  const normalized = normalizeSearchText(normalizeHarvestLabel(label));
  return (
    normalized
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'recolte'
  );
}

export function parseFrenchDecimal(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    return raw === 0 ? 0 : raw;
  }

  let cleaned = stripInvisibleChars(raw)
    .replace(/[\s\u00A0\u202F]/g, '')
    .replace(/^(?:€|eur|euros?)/i, '')
    .replace(/(?:€|eur|euros?|kg)$/i, '');

  if (!cleaned) return null;

  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');

  if (hasComma && hasDot) {
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    if (lastComma > lastDot) {
      // European "1.234,50"
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      // Anglo "1,234.50"
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (hasComma) {
    const commaCount = cleaned.split(',').length - 1;
    if (commaCount > 1) return null;
    cleaned = cleaned.replace(',', '.');
  } else if (hasDot) {
    const dotCount = cleaned.split('.').length - 1;
    if (dotCount > 1) return null;
  }

  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(cleaned)) {
    return null;
  }

  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return parsed === 0 ? 0 : parsed;
}

function addAsciiThousandsSeparators(intDigits: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function formatEuro(amountEur: number): string {
  const cents = toCents(amountEur);
  const sign = cents < 0 ? '-' : '';
  const absCents = Math.abs(cents);
  const eurosInt = Math.floor(absCents / 100);
  const remCents = String(absCents % 100).padStart(2, '0');
  return `${sign}${addAsciiThousandsSeparators(String(eurosInt))},${remCents} €`;
}

export function formatWeightKg(weightKg: number): string {
  const grams = toGrams(weightKg);
  const sign = grams < 0 ? '-' : '';
  const absGrams = Math.abs(grams);
  const intKg = Math.floor(absGrams / 1000);
  const remGrams = absGrams % 1000;
  const formattedInt = addAsciiThousandsSeparators(String(intKg));
  if (remGrams === 0) {
    return `${sign}${formattedInt} kg`;
  }
  const fracStr = String(remGrams).padStart(3, '0').replace(/0+$/, '');
  return `${sign}${formattedInt},${fracStr} kg`;
}

export function getLocalTodayIsoDate(now: Date = new Date()): string {
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
