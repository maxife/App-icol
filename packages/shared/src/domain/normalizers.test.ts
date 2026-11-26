import { describe, expect, it } from 'vitest';
import {
  formatEuro,
  formatWeightKg,
  fromCents,
  fromGrams,
  getLocalTodayIsoDate,
  normalizeHarvestLabel,
  normalizePhoneNumber,
  normalizeSearchText,
  parseFrenchDecimal,
  roundCurrencyEur,
  roundWeightKg,
  slugifyHarvestId,
  toCents,
  toGrams,
  toPhoneSearchDigits,
} from './normalizers';

describe('normalizers (Rule #3 — Systematic Input Hygiene & Precision)', () => {
  describe('normalizePhoneNumber (EC-09, S2-EC-06)', () => {
    it('normalizes all French mobile/landline variants and Sheets 9-digit integers to 0X XX XX XX XX', () => {
      const inputs: Array<string | number> = [
        '+33 6 12 34 56 78',
        '+33 (0)6 12 34 56 78',
        '0033612345678',
        '00 33 (0)6.12.34.56.78',
        '06.12.34.56.78',
        '06-12-34-56-78',
        '\u200E\u202A06 12 34 56 78\u202C',
        'tel:+33-6-12-34-56-78',
        '612345678',
        612345678,
      ];

      for (const raw of inputs) {
        expect(normalizePhoneNumber(raw)).toBe('06 12 34 56 78');
      }
    });

    it('preserves international non-French +CC and 00CC phone numbers without mangling', () => {
      expect(normalizePhoneNumber('+41 79 123 45 67')).toBe('+41 79 123 45 67');
      expect(normalizePhoneNumber('+41-79-123-45-67')).toBe('+41 79 123 45 67');
      expect(normalizePhoneNumber('0041 79 123 45 67')).toBe('+41 79 123 45 67');
      expect(normalizePhoneNumber('+32 470 12 34 56')).toBe('+32 470 12 34 56');
    });

    it('handles empty inputs and preserves alphabetic contact notes', () => {
      expect(normalizePhoneNumber(null)).toBe('');
      expect(normalizePhoneNumber(undefined)).toBe('');
      expect(normalizePhoneNumber('')).toBe('');
      expect(normalizePhoneNumber('   \u200B  ')).toBe('');
      expect(normalizePhoneNumber('  Poste   42 ')).toBe('Poste 42');
    });
  });

  describe('toPhoneSearchDigits (EC-10)', () => {
    it('canonicalizes full and partial +33 / 0033 queries and 9-digit integers', () => {
      expect(toPhoneSearchDigits('+33612')).toBe('0612');
      expect(toPhoneSearchDigits('0033 6 12')).toBe('0612');
      expect(toPhoneSearchDigits('06.12.34.56.78')).toBe('0612345678');
      expect(toPhoneSearchDigits(612345678)).toBe('0612345678');
      expect(toPhoneSearchDigits('+41 79 123')).toBe('4179123');
      expect(toPhoneSearchDigits('')).toBe('');
    });
  });

  describe('normalizeSearchText (EC-11)', () => {
    it('strips accents, expands French ligatures, normalizes apostrophes, and collapses spaces', () => {
      expect(normalizeSearchText('Élodie Bénard')).toBe('elodie benard');
      expect(normalizeSearchText('Marché d’Épinal')).toBe("marche d'epinal");
      expect(normalizeSearchText('Sœur Lætitia')).toBe('soeur laetitia');
      expect(normalizeSearchText('  Œuvre   d\u00A0Ægir ')).toBe('oeuvre d aegir');
      expect(normalizeSearchText(null)).toBe('');
    });
  });

  describe('normalizeHarvestLabel & slugifyHarvestId (EC-19, S2-EC-08)', () => {
    it('collapses Unicode/ASCII whitespace and builds deterministic kebab-case slugs', () => {
      expect(normalizeHarvestLabel('  Printemps \u00A0\u202F 2026  ')).toBe('Printemps 2026');
      expect(slugifyHarvestId('  Été   2025 ')).toBe('ete-2025');
      expect(slugifyHarvestId('   ')).toBe('recolte');
    });
  });

  describe('parseFrenchDecimal, cent/gram rounding & formatters (EC-15, S2-EC-07)', () => {
    it('parses French, European, and Anglo decimals with currency/weight units and rejects malformed strings', () => {
      expect(parseFrenchDecimal('12,50 €')).toBe(12.5);
      expect(parseFrenchDecimal('1\u202F234,50 kg')).toBe(1234.5);
      expect(parseFrenchDecimal('1\u00A0234,5')).toBe(1234.5);
      expect(parseFrenchDecimal('1.234,50 €')).toBe(1234.5);
      expect(parseFrenchDecimal('1,234.50')).toBe(1234.5);
      expect(parseFrenchDecimal('€ 8,40')).toBe(8.4);
      expect(parseFrenchDecimal(-0)).toBe(0);
      expect(Object.is(parseFrenchDecimal('-0'), 0)).toBe(true);

      expect(parseFrenchDecimal('')).toBeNull();
      expect(parseFrenchDecimal('   ')).toBeNull();
      expect(parseFrenchDecimal('12,,5')).toBeNull();
      expect(parseFrenchDecimal('12..5')).toBeNull();
      expect(parseFrenchDecimal('12abc')).toBeNull();
      expect(parseFrenchDecimal(Number.NaN)).toBeNull();
      expect(parseFrenchDecimal(Number.POSITIVE_INFINITY)).toBeNull();
    });

    it('eliminates IEEE-754 drift in cents/grams and formats deterministically', () => {
      expect(toCents(0.1 + 0.2)).toBe(30);
      expect(fromCents(30)).toBe(0.3);
      expect(roundCurrencyEur(0.1 + 0.2)).toBe(0.3);
      expect(roundCurrencyEur(7 * 8.4)).toBe(58.8);
      expect(Object.is(roundCurrencyEur(-0), 0)).toBe(true);

      expect(toGrams(0.1 + 0.2)).toBe(300);
      expect(fromGrams(300)).toBe(0.3);
      expect(roundWeightKg(0.1 + 0.2)).toBe(0.3);

      expect(formatEuro(0)).toBe('0,00 €');
      expect(formatEuro(1234.5)).toBe('1 234,50 €');
      expect(formatEuro(-30)).toBe('-30,00 €');

      expect(formatWeightKg(0)).toBe('0 kg');
      expect(formatWeightKg(60)).toBe('60 kg');
      expect(formatWeightKg(0.5)).toBe('0,5 kg');
      expect(formatWeightKg(0.25)).toBe('0,25 kg');
      expect(formatWeightKg(1234.5)).toBe('1 234,5 kg');
      expect(formatWeightKg(-3.5)).toBe('-3,5 kg');
    });
  });

  describe('getLocalTodayIsoDate (EC-18)', () => {
    it('formats local calendar date without UTC toISOString day-shift', () => {
      const localEarlyMorning = new Date(2026, 4, 15, 0, 30, 0);
      expect(getLocalTodayIsoDate(localEarlyMorning)).toBe('2026-05-15');
    });
  });
});
