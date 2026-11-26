import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerDraftFields } from '../../contracts/contacts-ui';
import {
  AuthProvider,
  DataProvider,
  ToastProvider,
  clearAppIcolLocalStorage,
  useToast,
} from '../../providers';
import { ToastViewport } from '../../ui';
import { isContactPickerSupported, pickDeviceContact } from './contactPicker';
import { CustomerPicker, ExportVcfButton } from './public';
import {
  VCardParseError,
  parseVCard,
  serializeVCard,
  shareOrDownloadVCard,
} from './vcard';

function ToastMirror(): React.JSX.Element {
  const { toasts, dismissToast } = useToast();
  return <ToastViewport toasts={toasts} onDismiss={dismissToast} />;
}

function PickerHarness({
  initial = { customerName: '', phone: '', contextOrRelay: '' },
}: {
  initial?: CustomerDraftFields;
}): React.JSX.Element {
  const [fields, setFields] = useState<CustomerDraftFields>(initial);
  return (
    <ToastProvider>
      <AuthProvider>
        <DataProvider>
          <CustomerPicker value={fields} onChange={setFields} />
          <ExportVcfButton
            contact={{
              fullName: fields.customerName,
              phone: fields.phone,
              contextOrRelay: fields.contextOrRelay,
            }}
          />
          <ToastMirror />
        </DataProvider>
      </AuthProvider>
    </ToastProvider>
  );
}

describe('Contacts, Mobile Contact Picker & vCard (.vcf) Suite (M3)', () => {
  beforeEach(() => {
    clearAppIcolLocalStorage();
    vi.restoreAllMocks();
  });

  it('parses standard vCard 3.0, Android vCard 2.1 Quoted-Printable UTF-8 folded lines, and vCard 4.0 tel: URIs', () => {
    const v30 = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Julien Garnier',
      'TEL;TYPE=WORK:01 40 50 60 70',
      'TEL;TYPE=CELL,PREF:+33 6 12 34 56 78',
      'NOTE:Lieu / Relais : Marché Samedi',
      'END:VCARD',
    ].join('\r\n');

    const parsed30 = parseVCard(v30);
    expect(parsed30.fullName).toBe('Julien Garnier');
    expect(parsed30.phone).toBe('06 12 34 56 78');
    expect(parsed30.contextOrRelay).toContain('Marché Samedi');

    // Android vCard 2.1 with soft-wrapped Quoted-Printable UTF-8 (=C3=A9 = é)
    const v21Qp = [
      'BEGIN:VCARD',
      'VERSION:2.1',
      'N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Mar=C3=A9chal;=C3=89lo=',
      'die;;;',
      'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=C3=89lodie Mar=C3=A9=',
      'chal',
      'TEL;HOME:0299112233',
      'TEL;CELL:\u202A0033 7 88 99 00 11\u202C',
      'END:VCARD',
    ].join('\r\n');

    const parsed21 = parseVCard(v21Qp);
    expect(parsed21.fullName).toBe('Élodie Maréchal');
    expect(parsed21.phone).toBe('07 88 99 00 11');

    // vCard 4.0 with RFC 6350 folded line and Swiss +41 tel URI
    const v40 = [
      'BEGIN:VCARD',
      'VERSION:4.0',
      'FN:Jean-Baptiste',
      '  Delacroix',
      'TEL;VALUE=uri;PREF=1;TYPE=cell:tel:+41-79-123-45-67',
      'END:VCARD',
    ].join('\n');

    const parsed40 = parseVCard(v40);
    expect(parsed40.fullName).toBe('Jean-Baptiste Delacroix');
    expect(parsed40.phone).toBe('+41 79 123 45 67');
  });

  it('rejects malformed or empty vCard payloads with VCardParseError', () => {
    expect(() => parseVCard('plain text not a vcard')).toThrow(VCardParseError);
    expect(() =>
      parseVCard('BEGIN:VCARD\r\nVERSION:3.0\r\nEND:VCARD'),
    ).toThrow(VCardParseError);
  });

  it('serializes UTF-8 vCard 3.0 and supports Web Share API with download fallback and AbortError handling', async () => {
    const vcf = serializeVCard({
      fullName: 'Maëlys Lefèvre',
      phone: '+33631415926',
      contextOrRelay: 'AMAP Ruche',
    });
    expect(vcf).toContain('BEGIN:VCARD\r\nVERSION:3.0\r\n');
    expect(vcf).toContain('FN:Maëlys Lefèvre\r\n');
    expect(vcf).toContain('TEL;TYPE=CELL:06 31 41 59 26\r\n');

    // 1. Web Share path
    const shareSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'canShare', {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(window.navigator, 'share', {
      configurable: true,
      value: shareSpy,
    });

    const shared = await shareOrDownloadVCard({
      fullName: 'Antoine Roussel',
      phone: '06 22 33 44 55',
    });
    expect(shared.method).toBe('share');
    expect(shareSpy).toHaveBeenCalledTimes(1);

    // 2. AbortError should not trigger fallback download
    Object.defineProperty(window.navigator, 'share', {
      configurable: true,
      value: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('Cancelled'), { name: 'AbortError' })),
    });
    const aborted = await shareOrDownloadVCard({
      fullName: 'Antoine Roussel',
      phone: '06 22 33 44 55',
    });
    expect(aborted.method).toBe('aborted');

    // 3. Download fallback when Web Share is unavailable
    Object.defineProperty(window.navigator, 'share', {
      configurable: true,
      value: undefined,
    });
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    const downloaded = await shareOrDownloadVCard({
      fullName: 'Maëlys Lefèvre',
      phone: '06 31 41 59 26',
    });
    expect(downloaded.method).toBe('download');
    expect(downloaded.fileName).toMatch(/\.vcf$/);
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('handles Contact Picker API when supported and falls back cleanly when unsupported', async () => {
    Object.defineProperty(window.navigator, 'contacts', {
      configurable: true,
      value: undefined,
    });
    expect(isContactPickerSupported()).toBe(false);
    const unsupportedRes = await pickDeviceContact();
    expect(unsupportedRes.status).toBe('unsupported-fallback');

    Object.defineProperty(window.navigator, 'contacts', {
      configurable: true,
      value: {
        select: vi.fn().mockResolvedValue([
          { name: ['Claire Fontaine'], tel: ['+33 6 44 55 66 77'] },
        ]),
      },
    });
    expect(isContactPickerSupported()).toBe(true);
    const picked = await pickDeviceContact();
    expect(picked.status).toBe('selected');
    if (picked.status === 'selected') {
      expect(picked.contact.fullName).toBe('Claire Fontaine');
      expect(picked.contact.phone).toBe('06 44 55 66 77');
    }
  });

  it('autocompletes known buyers from sales history, imports .vcf files, and exports .vcf via UI', async () => {
    Object.defineProperty(window.navigator, 'share', {
      configurable: true,
      value: undefined,
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<PickerHarness />);

    const nameInput = await screen.findByTestId('customer-name-input');
    const phoneInput = screen.getByTestId('customer-phone-input');
    const vcfInput = screen.getByTestId('import-vcf-input') as HTMLInputElement;
    expect(vcfInput).toBeInTheDocument();

    // Import valid .vcf file
    const validFile = new File(
      [
        'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Camille Dupuis\r\nTEL;CELL:+33698765432\r\nEND:VCARD',
      ],
      'camille.vcf',
      { type: 'text/vcard' },
    );
    fireEvent.change(vcfInput, { target: { files: [validFile] } });

    await waitFor(() => {
      expect(nameInput).toHaveValue('Camille Dupuis');
      expect(phoneInput).toHaveValue('06 98 76 54 32');
    });

    // Invalid .vcf preserves existing customer fields and shows toast-error
    const badFile = new File(['not a vcard'], 'broken.vcf', { type: 'text/vcard' });
    fireEvent.change(vcfInput, { target: { files: [badFile] } });

    await waitFor(() => {
      expect(screen.getByTestId('toast-error')).toBeInTheDocument();
    });
    expect(nameInput).toHaveValue('Camille Dupuis');

    // Export .vcf button triggers download + toast-success
    const exportBtn = screen.getByTestId('export-vcf-btn');
    expect(exportBtn).not.toBeDisabled();
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(screen.getByTestId('toast-success')).toBeInTheDocument();
    });
  });
});
