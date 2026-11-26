import {
  normalizePhoneNumber,
  normalizeSearchText,
  stripInvisibleChars,
} from '@app-icol/shared';

export class VCardParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VCardParseError';
  }
}

export interface ParsedVCard {
  fullName: string;
  phone: string;
  note: string;
  contextOrRelay: string;
}

export interface VCardContactInput {
  fullName: string;
  phone: string;
  contextOrRelay?: string;
  notes?: string;
}

export type VCardExportMethod = 'share' | 'download' | 'aborted';

export interface VCardExportResult {
  method: VCardExportMethod;
  fileName: string;
  vcfContent: string;
}

interface ParsedPropertyLine {
  name: string;
  encoding: string;
  charset: string;
  types: string[];
  isPref: boolean;
  prefRank: number;
  rawValue: string;
}

function findUnquotedCharIndex(input: string, targetChar: string): number {
  let inQuotes = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === targetChar && !inQuotes) {
      return i;
    }
  }
  return -1;
}

function splitUnquoted(input: string, delimiter: string): string[] {
  const parts: string[] = [];
  let inQuotes = false;
  let start = 0;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === delimiter && !inQuotes) {
      parts.push(input.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(input.slice(start));
  return parts;
}

function splitUnescaped(input: string, delimiter: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let escaped = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    if (escaped) {
      cur += `\\${ch}`;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === delimiter) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (escaped) {
    cur += '\\';
  }
  parts.push(cur);
  return parts;
}

function hasQuotedPrintableHeader(line: string): boolean {
  const colonIdx = findUnquotedCharIndex(line, ':');
  if (colonIdx === -1) return false;
  const header = line.slice(0, colonIdx);
  return /(?:^|;)[^:]*QUOTED-PRINTABLE/i.test(header);
}

/**
 * Unfolds logical lines according to both:
 * - vCard 2.1 Quoted-Printable soft line breaks (`=\r\n` / `=\n`, including mid-UTF-8 multibyte sequences)
 * - RFC 2426 / RFC 6350 §3.2 line folding (CRLF/LF followed by a single SPACE or HTAB)
 */
export function unfoldVCardLines(rawBlock: string): string[] {
  const physicalLines = rawBlock.split(/\r\n|\r|\n/);
  const logicalLines: string[] = [];

  for (const rawLine of physicalLines) {
    if (logicalLines.length > 0) {
      const prev = logicalLines[logicalLines.length - 1]!;
      if (hasQuotedPrintableHeader(prev) && prev.endsWith('=')) {
        const withoutSoftEq = prev.slice(0, -1);
        const continuation = /^[ \t]=[0-9A-Fa-f]{2}/.test(rawLine)
          ? rawLine.slice(1)
          : rawLine;
        logicalLines[logicalLines.length - 1] = withoutSoftEq + continuation;
        continue;
      }

      if (rawLine.startsWith(' ') || rawLine.startsWith('\t')) {
        logicalLines[logicalLines.length - 1] = prev + rawLine.slice(1);
        continue;
      }
    }

    logicalLines.push(rawLine);
  }

  return logicalLines;
}

/**
 * Decodes RFC 2045 Quoted-Printable text into a UTF-8 (or declared charset) JS string.
 */
export function decodeQuotedPrintable(raw: string, charset: string = 'utf-8'): string {
  const strippedSoftBreaks = raw.replace(/=(?:\r\n|\r|\n)/g, '');
  const encoder = new TextEncoder();
  const bytes: number[] = [];

  let i = 0;
  while (i < strippedSoftBreaks.length) {
    const ch = strippedSoftBreaks[i]!;
    if (ch === '=' && i + 2 < strippedSoftBreaks.length) {
      const hex = strippedSoftBreaks.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(Number.parseInt(hex, 16));
        i += 3;
        continue;
      }
    }
    const encodedChar = encoder.encode(ch);
    for (const b of encodedChar) {
      bytes.push(b);
    }
    i += 1;
  }

  const normalizedCharset = charset.trim().toLowerCase() || 'utf-8';
  try {
    return new TextDecoder(normalizedCharset, { fatal: false }).decode(
      new Uint8Array(bytes),
    );
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
  }
}

export function unescapeVCardText(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]!;
    if (ch === '\\' && i + 1 < raw.length) {
      const next = raw[i + 1]!;
      if (next === 'n' || next === 'N') {
        out += '\n';
        i += 1;
        continue;
      }
      if (next === ',' || next === ';' || next === '\\' || next === ':') {
        out += next;
        i += 1;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

export function escapeVCardValue(raw: string): string {
  return raw
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function stripSurroundingQuotes(val: string): string {
  if (val.length >= 2 && val.startsWith('"') && val.endsWith('"')) {
    return val.slice(1, -1);
  }
  return val;
}

function parsePropertyLine(line: string): ParsedPropertyLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const colonIdx = findUnquotedCharIndex(line, ':');
  if (colonIdx <= 0) return null;

  const rawHeader = line.slice(0, colonIdx);
  const rawValue = line.slice(colonIdx + 1);
  const headerSegments = splitUnquoted(rawHeader, ';');
  const rawPropToken = (headerSegments[0] ?? '').trim();
  if (!rawPropToken) return null;

  // Strip optional vCard group prefix such as "item1.TEL" (iOS Contacts)
  const dotIdx = rawPropToken.lastIndexOf('.');
  const name = (dotIdx >= 0 ? rawPropToken.slice(dotIdx + 1) : rawPropToken)
    .trim()
    .toUpperCase();
  if (!name) return null;

  let encoding = '';
  let charset = 'utf-8';
  const types: string[] = [];
  let isPref = false;
  let prefRank = 999;

  for (let i = 1; i < headerSegments.length; i += 1) {
    const seg = headerSegments[i]?.trim();
    if (!seg) continue;

    const eqIdx = seg.indexOf('=');
    if (eqIdx === -1) {
      const bareUpper = stripSurroundingQuotes(seg).trim().toUpperCase();
      if (
        bareUpper === 'QUOTED-PRINTABLE' ||
        bareUpper === 'BASE64' ||
        bareUpper === 'B' ||
        bareUpper === '8BIT' ||
        bareUpper === '7BIT'
      ) {
        encoding = bareUpper;
      } else if (bareUpper === 'UTF-8' || bareUpper.startsWith('ISO-8859')) {
        charset = bareUpper;
      } else if (bareUpper) {
        for (const sub of bareUpper.split(',')) {
          const token = sub.trim();
          if (!token) continue;
          types.push(token);
          if (token === 'PREF') {
            isPref = true;
            prefRank = Math.min(prefRank, 1);
          }
        }
      }
      continue;
    }

    const paramName = seg.slice(0, eqIdx).trim().toUpperCase();
    const paramValue = stripSurroundingQuotes(seg.slice(eqIdx + 1).trim());

    if (paramName === 'ENCODING') {
      encoding = paramValue.toUpperCase();
    } else if (paramName === 'CHARSET') {
      charset = paramValue || 'utf-8';
    } else if (paramName === 'PREF') {
      isPref = true;
      const parsedPref = Number.parseInt(paramValue, 10);
      prefRank = Number.isFinite(parsedPref) && parsedPref > 0 ? parsedPref : 1;
    } else if (paramName === 'TYPE') {
      for (const sub of paramValue.split(',')) {
        const token = stripSurroundingQuotes(sub).trim().toUpperCase();
        if (!token) continue;
        types.push(token);
        if (token === 'PREF') {
          isPref = true;
          prefRank = Math.min(prefRank, 1);
        }
      }
    }
  }

  return {
    name,
    encoding,
    charset,
    types,
    isPref,
    prefRank,
    rawValue,
  };
}

function decodePropertySegment(
  rawSegment: string,
  encoding: string,
  charset: string,
): string {
  const decoded =
    encoding === 'QUOTED-PRINTABLE'
      ? decodeQuotedPrintable(rawSegment, charset)
      : rawSegment;
  return stripInvisibleChars(unescapeVCardText(decoded));
}

function normalizeSingleLineName(raw: string): string {
  return stripInvisibleChars(raw)
    .replace(/[\r\n\t\u00A0\u202F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanVCardTelValue(rawTel: string): string {
  let cleaned = stripInvisibleChars(rawTel).trim();
  if (!cleaned) return '';

  if (/^tel:/i.test(cleaned)) {
    cleaned = cleaned.replace(/^tel:\s*/i, '');
    if (cleaned.includes('%')) {
      try {
        cleaned = decodeURIComponent(cleaned);
      } catch {
        // Keep raw string if malformed percent sequence
      }
    }
    // Strip RFC 3966 URI parameters such as ";ext=123" or ";phone-context=+33"
    const semiIdx = cleaned.indexOf(';');
    if (semiIdx >= 0) {
      cleaned = cleaned.slice(0, semiIdx);
    }
    cleaned = stripInvisibleChars(cleaned).trim();
  }

  return normalizePhoneNumber(cleaned);
}

function extractRelayFromNote(noteText: string): string {
  if (!noteText) return '';
  const firstLine = noteText.split(/\r?\n/)[0]?.trim() ?? '';
  const match =
    /^(?:lieu(?:\s*\/\s*relais|\s+de\s+remise)?|relais)\s*:\s*([^—|]+?)(?:\s+[—|]\s+.*)?$/i.exec(
      firstLine,
    );
  return match?.[1]?.trim() ?? '';
}

function extractFirstVCardBlock(rawText: string): string {
  const cleaned = rawText.replace(/^\uFEFF/, '');
  if (!cleaned.trim()) {
    throw new VCardParseError('Le fichier vCard (.vcf) est vide.');
  }

  const beginMatch = /(?:^|\r\n|\r|\n)[ \t]*BEGIN[ \t]*:[ \t]*VCARD[ \t]*(?=\r\n|\r|\n|$)/i.exec(
    cleaned,
  );
  if (!beginMatch) {
    throw new VCardParseError(
      'Format vCard (.vcf) invalide : balise BEGIN:VCARD introuvable.',
    );
  }

  const afterBeginIdx = beginMatch.index + beginMatch[0].length;
  const remainder = cleaned.slice(afterBeginIdx);
  const endMatch = /(?:^|\r\n|\r|\n)[ \t]*END[ \t]*:[ \t]*VCARD[ \t]*(?=\r\n|\r|\n|$)/i.exec(
    remainder,
  );
  if (!endMatch) {
    throw new VCardParseError(
      'Format vCard (.vcf) invalide : balise END:VCARD introuvable.',
    );
  }

  return remainder.slice(0, endMatch.index);
}

/**
 * Parses a vCard 2.1 / 3.0 / 4.0 (.vcf) string into normalized App-icol contact fields.
 * Throws `VCardParseError` if the envelope is invalid or neither name nor phone is usable.
 */
export function parseVCard(rawText: string): ParsedVCard {
  if (typeof rawText !== 'string') {
    throw new VCardParseError('Contenu vCard (.vcf) invalide.');
  }

  const bodyBlock = extractFirstVCardBlock(rawText);
  const unfoldedLines = unfoldVCardLines(bodyBlock);

  let fnValue = '';
  let reconstructedN = '';
  let orgFallback = '';
  let noteValue = '';

  interface TelCandidate {
    phone: string;
    tier: number;
    prefRank: number;
    order: number;
  }
  const telCandidates: TelCandidate[] = [];

  for (let idx = 0; idx < unfoldedLines.length; idx += 1) {
    const parsed = parsePropertyLine(unfoldedLines[idx]!);
    if (!parsed) continue;

    switch (parsed.name) {
      case 'FN': {
        if (!fnValue) {
          const decoded = decodePropertySegment(
            parsed.rawValue,
            parsed.encoding,
            parsed.charset,
          );
          const candidate = normalizeSingleLineName(decoded);
          if (candidate) {
            fnValue = candidate;
          }
        }
        break;
      }

      case 'N': {
        if (!reconstructedN) {
          // N:Family;Given;Additional;HonorificPrefixes;HonorificSuffixes
          const rawComponents = splitUnescaped(parsed.rawValue, ';');
          const decodedParts = rawComponents.map((comp) => {
            const subValues = splitUnescaped(comp, ',').map((sub) =>
              normalizeSingleLineName(
                decodePropertySegment(sub, parsed.encoding, parsed.charset),
              ),
            );
            return subValues.filter(Boolean).join(' ');
          });

          const family = decodedParts[0] ?? '';
          const given = decodedParts[1] ?? '';
          const additional = decodedParts[2] ?? '';
          const prefix = decodedParts[3] ?? '';
          const suffix = decodedParts[4] ?? '';

          const assembled = normalizeSingleLineName(
            [prefix, given, additional, family, suffix].filter(Boolean).join(' '),
          );
          if (assembled) {
            reconstructedN = assembled;
          }
        }
        break;
      }

      case 'ORG': {
        if (!orgFallback) {
          const rawOrgParts = splitUnescaped(parsed.rawValue, ';');
          const primaryOrg = normalizeSingleLineName(
            decodePropertySegment(
              rawOrgParts[0] ?? parsed.rawValue,
              parsed.encoding,
              parsed.charset,
            ),
          );
          if (primaryOrg) {
            orgFallback = primaryOrg;
          }
        }
        break;
      }

      case 'TEL': {
        const decodedTel = decodePropertySegment(
          parsed.rawValue,
          parsed.encoding,
          parsed.charset,
        );
        const normalizedPhone = cleanVCardTelValue(decodedTel);
        if (normalizedPhone) {
          const isMobile = parsed.types.some(
            (t) => t === 'CELL' || t === 'MOBILE' || t === 'IPHONE',
          );
          const tier =
            isMobile && parsed.isPref
              ? 3
              : isMobile
                ? 2
                : parsed.isPref
                  ? 1
                  : 0;
          telCandidates.push({
            phone: normalizedPhone,
            tier,
            prefRank: parsed.prefRank,
            order: idx,
          });
        }
        break;
      }

      case 'NOTE': {
        if (!noteValue) {
          const decodedNote = decodePropertySegment(
            parsed.rawValue,
            parsed.encoding,
            parsed.charset,
          )
            .replace(/[\u00A0\u202F]+/g, ' ')
            .trim();
          if (decodedNote) {
            noteValue = decodedNote;
          }
        }
        break;
      }

      default:
        break;
    }
  }

  telCandidates.sort((a, b) => {
    if (b.tier !== a.tier) return b.tier - a.tier;
    if (a.prefRank !== b.prefRank) return a.prefRank - b.prefRank;
    return a.order - b.order;
  });

  const fullName = fnValue || reconstructedN || orgFallback;
  const phone = telCandidates[0]?.phone ?? '';
  const contextOrRelay = extractRelayFromNote(noteValue);

  if (!fullName && !phone) {
    throw new VCardParseError(
      'La fiche vCard (.vcf) ne contient aucun nom ni numéro de téléphone exploitable.',
    );
  }

  return {
    fullName,
    phone,
    note: noteValue,
    contextOrRelay,
  };
}

function splitFullNameForStructuredN(fullName: string): {
  family: string;
  given: string;
  additional: string;
} {
  const tokens = fullName.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return { family: '', given: '', additional: '' };
  }
  if (tokens.length === 1) {
    return { family: tokens[0]!, given: '', additional: '' };
  }
  const given = tokens[0]!;
  const family = tokens[tokens.length - 1]!;
  const additional = tokens.slice(1, -1).join(' ');
  return { family, given, additional };
}

export function buildVCardFilename(fullName: string, phone: string = ''): string {
  const base = normalizeSearchText(fullName) || normalizeSearchText(phone);
  const slug = base.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'contact';
  return `${slug}.vcf`;
}

/**
 * Generates a standards-compliant UTF-8 vCard 3.0 string (`CRLF` line endings).
 */
export function serializeVCard(contact: VCardContactInput): string {
  const fullName = normalizeSingleLineName(contact.fullName ?? '');
  const phone = normalizePhoneNumber(contact.phone ?? '');
  const relay = normalizeSingleLineName(contact.contextOrRelay ?? '');
  const notes = stripInvisibleChars(contact.notes ?? '')
    .replace(/[\u00A0\u202F]+/g, ' ')
    .trim();

  if (!fullName && !phone) {
    throw new VCardParseError(
      "Impossible d'exporter une fiche contact sans nom ni numéro de téléphone.",
    );
  }

  const displayFullName = fullName || phone;
  const { family, given, additional } = splitFullNameForStructuredN(displayFullName);

  const lines: string[] = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${escapeVCardValue(displayFullName)}`,
    `N:${escapeVCardValue(family)};${escapeVCardValue(given)};${escapeVCardValue(additional)};;`,
  ];

  if (phone) {
    lines.push(`TEL;TYPE=CELL:${phone}`);
  }

  const noteSummary =
    relay && notes
      ? `Lieu / Relais : ${relay} — ${notes}`
      : relay
        ? `Lieu / Relais : ${relay}`
        : notes;

  if (noteSummary) {
    lines.push(`NOTE:${escapeVCardValue(noteSummary)}`);
  }

  lines.push('END:VCARD', '');
  return lines.join('\r\n');
}

function isUserAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  return (err as { name?: unknown }).name === 'AbortError';
}

function triggerBrowserVcfDownload(vcfContent: string, fileName: string): void {
  const blob = new Blob([vcfContent], { type: 'text/vcard;charset=utf-8' });
  const hasCreateObjectUrl =
    typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
  const href = hasCreateObjectUrl
    ? URL.createObjectURL(blob)
    : `data:text/vcard;charset=utf-8,${encodeURIComponent(vcfContent)}`;

  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  if (hasCreateObjectUrl && typeof URL.revokeObjectURL === 'function') {
    setTimeout(() => {
      try {
        URL.revokeObjectURL(href);
      } catch {
        // Ignore cleanup errors in torn-down test environments
      }
    }, 1000);
  }
}

/**
 * Exports a contact as UTF-8 `.vcf`:
 * 1. Uses mobile Web Share API (`navigator.share({ files: [file], title })`) when supported.
 * 2. Respects user cancellation (`AbortError`) without forcing an unwanted download.
 * 3. Automatically falls back to `<a download="<slug>.vcf">` when Web Share is unavailable or rejects file sharing.
 */
export async function shareOrDownloadVCard(
  contact: VCardContactInput,
): Promise<VCardExportResult> {
  const vcfContent = serializeVCard(contact);
  const fileName = buildVCardFilename(contact.fullName, contact.phone);
  const title = normalizeSingleLineName(contact.fullName) || 'Contact App-icol';

  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (nav && typeof nav.share === 'function' && typeof File === 'function') {
    const file = new File([vcfContent], fileName, { type: 'text/vcard' });
    let canShareFile = true;

    if (typeof nav.canShare === 'function') {
      try {
        canShareFile = nav.canShare({ files: [file] });
      } catch {
        canShareFile = false;
      }
    }

    if (canShareFile) {
      try {
        await nav.share({
          files: [file],
          title,
        });
        return { method: 'share', fileName, vcfContent };
      } catch (err) {
        if (isUserAbortError(err)) {
          return { method: 'aborted', fileName, vcfContent };
        }
        // Other errors (NotAllowedError, DataError, TypeError) fall back to direct .vcf download
      }
    }
  }

  triggerBrowserVcfDownload(vcfContent, fileName);
  return { method: 'download', fileName, vcfContent };
}
