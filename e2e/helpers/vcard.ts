import { Buffer } from 'node:buffer';
import { expect, type Download, type Page } from '@playwright/test';

export interface VcardUploadPayload {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

export function toVcardUploadPayload(
  vcfContent: string | Buffer,
  fileName: string = 'contact.vcf',
  mimeType: string = 'text/vcard',
): VcardUploadPayload {
  const buffer = Buffer.isBuffer(vcfContent) ? vcfContent : Buffer.from(vcfContent, 'utf8');
  return {
    name: fileName,
    mimeType,
    buffer,
  };
}

export async function uploadVcardInMemory(
  page: Page,
  vcfContent: string | Buffer,
  fileName: string = 'contact.vcf',
): Promise<void> {
  const vcfInput = page.getByTestId('import-vcf-input').first();
  await expect(vcfInput).toBeAttached();
  const payload = toVcardUploadPayload(vcfContent, fileName);
  await vcfInput.setInputFiles(payload);
}

export async function readDownloadBuffer(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  if (!stream) {
    throw new Error('Playwright download.createReadStream() returned null');
  }
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

export async function readDownloadText(download: Download): Promise<string> {
  const buf = await readDownloadBuffer(download);
  return buf.toString('utf8');
}

export interface MockContactRecord {
  name?: string[];
  tel?: string[];
  email?: string[];
}

export interface ContactPickerCallRecord {
  props: string[];
  opts?: { multiple?: boolean };
}

export type ContactPickerMockBehavior =
  | MockContactRecord[]
  | {
      errorName: 'AbortError' | 'SecurityError' | 'InvalidStateError';
      message?: string;
    };

export interface SharedVcfFileRecord {
  name: string;
  type: string;
  size: number;
  text: string;
}

export interface SharedVcfCallRecord {
  title?: string;
  text?: string;
  files: SharedVcfFileRecord[];
}

declare global {
  interface Window {
    __contactPickerCalls?: ContactPickerCallRecord[];
    __sharedVcfPayloads?: SharedVcfCallRecord[];
    ContactsManager?: unknown;
  }
}

export async function installMockContactPicker(
  page: Page,
  contactsOrError: ContactPickerMockBehavior,
): Promise<void> {
  const serialized = Array.isArray(contactsOrError)
    ? { kind: 'success' as const, contacts: contactsOrError }
    : {
        kind: 'error' as const,
        errorName: contactsOrError.errorName,
        message: contactsOrError.message ?? 'User cancelled contact picker',
      };

  await page.addInitScript((config) => {
    window.__contactPickerCalls = [];
    class MockContactsManager {}
    window.ContactsManager = MockContactsManager;

    const contactsApi = {
      getProperties: async () => ['name', 'tel'],
      select: async (props: string[], opts?: { multiple?: boolean }) => {
        window.__contactPickerCalls?.push({ props, opts });
        if (config.kind === 'error') {
          throw new DOMException(config.message, config.errorName);
        }
        return config.contacts;
      },
    };

    Object.defineProperty(navigator, 'contacts', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: contactsApi,
    });
  }, serialized);
}

export async function readContactPickerCalls(page: Page): Promise<ContactPickerCallRecord[]> {
  return page.evaluate(() => window.__contactPickerCalls ?? []);
}

export async function installDisableContactPicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      delete (navigator as unknown as Record<string, unknown>).contacts;
    } catch {
      // ignore non-configurable property
    }
    try {
      delete (Navigator.prototype as unknown as Record<string, unknown>).contacts;
    } catch {
      // ignore non-configurable property
    }
    try {
      delete (window as unknown as Record<string, unknown>).ContactsManager;
    } catch {
      // ignore non-configurable property
    }
  });
}

export interface WebShareMockOptions {
  errorName?: 'AbortError' | 'NotAllowedError' | 'DataError';
  message?: string;
}

export async function installMockWebShare(
  page: Page,
  behavior: WebShareMockOptions = {},
): Promise<void> {
  await page.addInitScript((opts) => {
    window.__sharedVcfPayloads = [];

    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: (data?: ShareData) => {
        if (!data) return false;
        if (Array.isArray(data.files)) return data.files.length > 0;
        return Boolean(data.title || data.text || data.url);
      },
    });

    Object.defineProperty(navigator, 'share', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: async (data?: ShareData) => {
        if (opts.errorName) {
          throw new DOMException(
            opts.message ?? 'Web Share aborted by user',
            opts.errorName,
          );
        }
        const rawFiles = Array.isArray(data?.files) ? data.files : [];
        const files = await Promise.all(
          rawFiles.map(async (f) => ({
            name: f.name,
            type: f.type,
            size: f.size,
            text: await f.text(),
          })),
        );
        window.__sharedVcfPayloads?.push({
          title: data?.title,
          text: data?.text,
          files,
        });
      },
    });
  }, behavior);
}

export async function readSharedVcfPayloads(page: Page): Promise<SharedVcfCallRecord[]> {
  return page.evaluate(() => window.__sharedVcfPayloads ?? []);
}

export async function installDisableWebShare(page: Page): Promise<void> {
  await page.addInitScript(() => {
    for (const prop of ['share', 'canShare']) {
      try {
        delete (navigator as unknown as Record<string, unknown>)[prop];
      } catch {
        // ignore non-configurable property
      }
      try {
        delete (Navigator.prototype as unknown as Record<string, unknown>)[prop];
      } catch {
        // ignore non-configurable property
      }
    }
  });
}
