export type ClassValue = string | false | null | undefined;

export function cx(...parts: ClassValue[]): string {
  const out: string[] = [];
  for (const part of parts) {
    if (typeof part === 'string' && part.length > 0) {
      out.push(part);
    }
  }
  return out.join(' ');
}

export function toDomId(raw: string): string {
  return raw.replace(/\s+/g, '-');
}
