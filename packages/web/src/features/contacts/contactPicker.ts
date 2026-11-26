import { normalizePhoneNumber, stripInvisibleChars } from '@app-icol/shared';

export interface NativeContactRecord {
  name?: string[];
  tel?: string[];
  email?: string[];
}

export interface ContactsManagerLike {
  getProperties?: () => Promise<string[]>;
  select: (
    properties: Array<'name' | 'tel' | 'email'>,
    options?: { multiple?: boolean },
  ) => Promise<NativeContactRecord[]>;
}

interface NavigatorWithContacts {
  contacts?: ContactsManagerLike;
}

export interface PickedContact {
  fullName: string;
  phone: string;
}

export type ContactPickerResult =
  | { status: 'selected'; contact: PickedContact }
  | { status: 'unsupported-fallback'; message: string }
  | { status: 'cancelled' }
  | { status: 'empty'; message: string }
  | { status: 'error'; message: string };

export interface PickDeviceContactOptions {
  onOpenVcfFallback?: () => void;
}

/**
 * Dynamic runtime detection for the W3C Contact Picker API
 * (supported on Chrome/Edge Android; unavailable on iOS Safari & Desktop browsers).
 */
export function isContactPickerSupported(): boolean {
  if (typeof navigator === 'undefined' || !navigator) return false;
  const nav = navigator as unknown as NavigatorWithContacts;
  return (
    'contacts' in navigator &&
    Boolean(nav.contacts) &&
    typeof nav.contacts?.select === 'function'
  );
}

function normalizeContactName(candidates: readonly string[] | undefined): string {
  if (!Array.isArray(candidates)) return '';
  for (const raw of candidates) {
    if (typeof raw !== 'string') continue;
    const cleaned = stripInvisibleChars(raw)
      .replace(/[\r\n\t\u00A0\u202F]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned) return cleaned;
  }
  return '';
}

function normalizeContactTel(candidates: readonly string[] | undefined): string {
  if (!Array.isArray(candidates)) return '';
  for (const raw of candidates) {
    if (typeof raw !== 'string') continue;
    const normalized = normalizePhoneNumber(raw);
    if (normalized) return normalized;
  }
  return '';
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  return (err as { name?: unknown }).name === 'AbortError';
}

/**
 * Opens the native mobile Contact Picker (`navigator.contacts.select(['name', 'tel'], { multiple: false })`)
 * when supported, or triggers the `.vcf` file-picker fallback with clear guidance on iOS Safari / Desktop.
 */
export async function pickDeviceContact(
  options?: PickDeviceContactOptions,
): Promise<ContactPickerResult> {
  if (!isContactPickerSupported()) {
    options?.onOpenVcfFallback?.();
    return {
      status: 'unsupported-fallback',
      message:
        'Sélecteur direct indisponible sur cet appareil (iOS / ordinateur) : choisissez une fiche contact .vcf exportée depuis vos Contacts.',
    };
  }

  const nav = navigator as unknown as NavigatorWithContacts;
  try {
    const records = await nav.contacts!.select(['name', 'tel'], {
      multiple: false,
    });

    if (!Array.isArray(records) || records.length === 0) {
      return { status: 'cancelled' };
    }

    const first = records[0];
    if (!first) {
      return { status: 'cancelled' };
    }

    const fullName = normalizeContactName(first.name);
    const phone = normalizeContactTel(first.tel);

    if (!fullName && !phone) {
      return {
        status: 'empty',
        message: 'Aucun nom ni numéro de téléphone exploitable sur ce contact.',
      };
    }

    return {
      status: 'selected',
      contact: { fullName, phone },
    };
  } catch (err) {
    if (isAbortError(err)) {
      return { status: 'cancelled' };
    }
    const detail =
      err instanceof Error && err.message
        ? err.message
        : "Impossible d'ouvrir le carnet de contacts.";
    return {
      status: 'error',
      message: `${detail} Vous pouvez importer un fichier .vcf en secours.`,
    };
  }
}
