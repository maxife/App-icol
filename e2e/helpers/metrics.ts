import { expect, type Locator, type Page } from '@playwright/test';
import { visibleByTestId } from './app';

export function round2(value: number): number {
  if (value === 0 || Object.is(value, -0)) return 0;
  const sign = value < 0 ? -1 : 1;
  const rounded = sign * (Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100);
  return rounded === 0 ? 0 : rounded;
}

export function round3(value: number): number {
  if (value === 0 || Object.is(value, -0)) return 0;
  const sign = value < 0 ? -1 : 1;
  const rounded = sign * (Math.round((Math.abs(value) + Number.EPSILON) * 1000) / 1000);
  return rounded === 0 ? 0 : rounded;
}

const HSPACE = '[ \\u00A0\\u202F\\u2007\\u2009]';
const DIGIT_BODY = `(?:\\d{1,3}(?:${HSPACE}\\d{3})+|\\d+)(?:[.,]\\d+)?`;
const SIGNED_NUMBER_SOURCE = `(?:\\u2212${HSPACE}*|(?:^|[\\n:=(\\[·•|/])${HSPACE}*[-\\u2013]${HSPACE}*|(?<![\\dA-Za-zÀ-ÿ])[-\\u2013]|\\+${HSPACE}*)?(${DIGIT_BODY})`;

function decodeMatchedToken(fullMatch: string, unsignedDigits: string): number {
  const cleanDigits = unsignedDigits
    .replace(/[ \u00A0\u202F\u2007\u2009]/g, '')
    .replace(',', '.');
  const magnitude = Number.parseFloat(cleanDigits);
  if (Number.isNaN(magnitude)) {
    throw new Error(`Invalid numeric magnitude "${unsignedDigits}" in "${fullMatch}"`);
  }
  const prefix = fullMatch.slice(0, fullMatch.length - unsignedDigits.length);
  const isNegative = /[\u2212\-\u2013]/.test(prefix);
  const signed = isNegative ? -magnitude : magnitude;
  return signed === 0 ? 0 : signed;
}

export function parseEuroFromText(rawText: string): number | null {
  const text = rawText.trim();
  if (!text) return null;

  const suffixRe = new RegExp(`${SIGNED_NUMBER_SOURCE}${HSPACE}*(?:€|eur\\b)`, 'i');
  const suffixMatch = suffixRe.exec(text);
  if (suffixMatch && suffixMatch[1]) {
    return decodeMatchedToken(suffixMatch[0], suffixMatch[1]);
  }

  const prefixRe = new RegExp(`(?:€|eur\\b)${HSPACE}*${SIGNED_NUMBER_SOURCE}`, 'i');
  const prefixMatch = prefixRe.exec(text);
  if (prefixMatch && prefixMatch[1]) {
    const signSlice = prefixMatch[0].replace(/^(?:€|eur\b)\s*/i, '');
    return decodeMatchedToken(signSlice, prefixMatch[1]);
  }

  return null;
}

export function parseWeightKgFromText(rawText: string): number | null {
  const text = rawText.trim();
  if (!text) return null;

  const kgRe = new RegExp(`${SIGNED_NUMBER_SOURCE}${HSPACE}*kg\\b`, 'i');
  const match = kgRe.exec(text);
  if (match && match[1]) {
    return decodeMatchedToken(match[0], match[1]);
  }
  return null;
}

export function parseFrenchNumberFromText(rawText: string): number {
  if (typeof rawText !== 'string') {
    throw new Error(`parseFrenchNumberFromText expected string, got ${typeof rawText}`);
  }
  const text = rawText.trim();
  if (!text) {
    throw new Error('parseFrenchNumberFromText received an empty string');
  }

  // Prefer unit-qualified value (€ or kg) when the card text includes currency or weight units
  const unitQualifiedRe = new RegExp(
    `${SIGNED_NUMBER_SOURCE}${HSPACE}*(?:€|eur\\b|kg\\b)`,
    'i',
  );
  const unitMatch = unitQualifiedRe.exec(text);
  if (unitMatch && unitMatch[1]) {
    return decodeMatchedToken(unitMatch[0], unitMatch[1]);
  }

  // Fallback to the first numeric token (e.g. plain counters like kpi-pending-deliveries)
  const genericRe = new RegExp(SIGNED_NUMBER_SOURCE);
  const genericMatch = genericRe.exec(text);
  if (genericMatch && genericMatch[1]) {
    return decodeMatchedToken(genericMatch[0], genericMatch[1]);
  }

  throw new Error(`parseFrenchNumberFromText: unable to parse number from "${rawText}"`);
}

export async function readNormalizedTextTokens(locator: Locator): Promise<string> {
  const target = locator.first();
  await expect(target).toBeVisible();
  return target.evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const parts: string[] = [];
    let current = walker.nextNode();
    while (current) {
      const normalized = (current.nodeValue ?? '')
        .replace(/[\u00A0\u202F\u2007\u2009]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (normalized) {
        parts.push(normalized);
      }
      current = walker.nextNode();
    }
    return parts.join(' ');
  });
}

export function containsStandaloneInteger(spaceJoinedText: string, targetInt: number): boolean {
  const escaped = String(targetInt);
  const re = new RegExp(`(?:^|[^\\d.,])${escaped}(?![\\d.,])`);
  return re.test(spaceJoinedText);
}

export async function readKpiNumber(page: Page, testId: string): Promise<number> {
  const locator = visibleByTestId(page, testId);
  await expect(locator).toBeVisible();
  const text = (await locator.textContent()) ?? '';
  return parseFrenchNumberFromText(text);
}

export async function isForecastFallbackIndicated(page: Page): Promise<boolean> {
  const badge = visibleByTestId(page, 'kpi-forecast-badge');
  const visible = await badge.isVisible().catch(() => false);
  if (!visible) return false;

  const text = ((await badge.textContent()) ?? '').trim();
  if (!text) return true;
  if (/prévision|prevision|estim/i.test(text)) return true;
  if (/réalisé|realise|réel|reel/i.test(text)) return false;
  return true;
}

export interface DashboardSnapshot {
  harvestedKg: number;
  committedKg: number;
  availableKg: number;
  paidEur: number;
  unpaidEur: number;
  donatedText: string;
  pendingTransfersText: string;
  pendingTransfersEur: number;
  pendingDeliveriesCount: number;
  hasForecastBadge: boolean;
  selectedHarvestText: string;
}

export async function readDashboardSnapshot(page: Page): Promise<DashboardSnapshot> {
  await expect(visibleByTestId(page, 'dashboard-page')).toBeVisible();

  const [
    harvestedKg,
    committedKg,
    availableKg,
    paidEur,
    unpaidEur,
    pendingDeliveriesCount,
    hasForecastBadge,
  ] = await Promise.all([
    readKpiNumber(page, 'kpi-harvested-kg'),
    readKpiNumber(page, 'kpi-committed-kg'),
    readKpiNumber(page, 'kpi-available-kg'),
    readKpiNumber(page, 'kpi-paid-eur'),
    readKpiNumber(page, 'kpi-unpaid-eur'),
    readKpiNumber(page, 'kpi-pending-deliveries'),
    isForecastFallbackIndicated(page),
  ]);

  const donatedEl = visibleByTestId(page, 'kpi-donated-summary');
  const donatedText = (await donatedEl.isVisible().catch(() => false))
    ? ((await donatedEl.textContent()) ?? '').trim()
    : '';

  const transfersEl = visibleByTestId(page, 'kpi-pending-transfers');
  let pendingTransfersText = '';
  let pendingTransfersEur = 0;
  if (await transfersEl.isVisible().catch(() => false)) {
    pendingTransfersText = ((await transfersEl.textContent()) ?? '').trim();
    const explicitEur = parseEuroFromText(pendingTransfersText);
    if (explicitEur !== null) {
      pendingTransfersEur = explicitEur;
    } else if (/\d/.test(pendingTransfersText)) {
      try {
        pendingTransfersEur = parseFrenchNumberFromText(pendingTransfersText);
      } catch {
        pendingTransfersEur = 0;
      }
    }
  }

  const harvestSelect = visibleByTestId(page, 'dashboard-harvest-select');
  const selectedHarvestText = (await harvestSelect.isVisible().catch(() => false))
    ? await harvestSelect.evaluate(
        (el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent?.trim() ?? '',
      )
    : '';

  return {
    harvestedKg,
    committedKg,
    availableKg,
    paidEur,
    unpaidEur,
    donatedText,
    pendingTransfersText,
    pendingTransfersEur,
    pendingDeliveriesCount,
    hasForecastBadge,
    selectedHarvestText,
  };
}
