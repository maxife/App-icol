export const VCARD_30_STANDARD = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'N:Garnier;Julien;;;',
  'FN:Julien Garnier',
  'TEL;TYPE=CELL:+33 6 12 34 56 78',
  'NOTE:Client fidèle miel de printemps - Relais Mairie',
  'END:VCARD',
  '',
].join('\r\n');

export const VCARD_30_EXPECTED = {
  fullName: 'Julien Garnier',
  normalizedPhone: '06 12 34 56 78',
} as const;

// Android Contacts vCard 2.1 with mid-multibyte Quoted-Printable soft line break
// (=C3=\r\n=A9 -> UTF-8 0xC3 0xA9 = 'é') and WORK/HOME landlines listed before CELL;PREF
export const VCARD_21_ANDROID_QP_FOLDED = [
  'BEGIN:VCARD',
  'VERSION:2.1',
  'N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:B=C3=A9nard;=C3=89lodie;;;',
  'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=C3=89lodie=20B=C3=\r\n=A9nard',
  'TEL;WORK;VOICE:01 42 68 55 00',
  'TEL;HOME:04 72 11 22 33',
  'TEL;CELL;PREF:+33687654321',
  'END:VCARD',
  '',
].join('\r\n');

export const VCARD_21_EXPECTED = {
  fullName: 'Élodie Bénard',
  normalizedPhone: '06 87 65 43 21',
} as const;

// vCard 4.0 missing FN (reconstructed from N:Martin;Jean;;;) + tel: URI + Unicode bidi markers
export const VCARD_40_URI_MISSING_FN = [
  'BEGIN:VCARD',
  'VERSION:4.0',
  'N:Martin;Jean;;;',
  'TEL;VALUE=uri;PREF=1:tel:\u202A+33-6-98-76-54-32\u202C',
  'END:VCARD',
  '',
].join('\r\n');

export const VCARD_40_MISSING_FN_EXPECTED = {
  fullName: 'Jean Martin',
  normalizedPhone: '06 98 76 54 32',
} as const;

// vCard 4.0 RFC 6350 §3.2 CRLF + single-space mid-word folded FN + tel: URI + bidi markers
export const VCARD_40_FOLDED_FN = [
  'BEGIN:VCARD',
  'VERSION:4.0',
  'N:Martin;Jean-Baptiste;;;',
  'FN:Jean-Bap\r\n tiste Martin',
  'TEL;VALUE=uri;TYPE="cell,voice";PREF=1:tel:\u202A+33-6-98-76-54-32\u202C',
  'END:VCARD',
  '',
].join('\r\n');

export const VCARD_40_FOLDED_URI = VCARD_40_FOLDED_FN;

export const VCARD_40_FOLDED_EXPECTED = {
  fullName: 'Jean-Baptiste Martin',
  normalizedPhone: '06 98 76 54 32',
} as const;

export const VCARD_SWISS_INTL = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'N:Keller;Lukas;;;',
  'FN:Lukas Keller',
  'TEL;TYPE=CELL:+41 79 123 45 67',
  'NOTE:Client frontalier Genève',
  'END:VCARD',
  '',
].join('\r\n');

export const VCARD_SWISS_EXPECTED = {
  fullName: 'Lukas Keller',
  normalizedPhone: '+41 79 123 45 67',
} as const;

export const VCARD_CORRUPT_INVALID =
  'NOT_A_VCARD_HEADER\r\n{"corrupt":true,"bytes":[0,255,128]}\r\nRANDOM_GARBAGE';

export const VCARD_EMPTY_PAYLOAD = '';
