import { beforeEach, describe, expect, it } from 'vitest';
import { ALLOWED_SHEETS } from '@app-icol/shared';
import { handleDoPost, inspectSheetStructureImpl } from './main';

interface MockTextOutput {
  getContent(): string;
  setMimeType(mimeType: GoogleAppsScript.Content.MimeType): GoogleAppsScript.Content.TextOutput;
}

beforeEach(() => {
  const mockContentService = {
    MimeType: { JSON: 'JSON' },
    createTextOutput(content = ''): MockTextOutput {
      return {
        getContent: () => content,
        setMimeType() {
          return this as unknown as GoogleAppsScript.Content.TextOutput;
        },
      };
    },
  };
  (globalThis as unknown as { ContentService: unknown }).ContentService = mockContentService;
});

describe('packages/gas-api M1 skeleton', () => {
  it('returns VALIDATION_ERROR when doPost body is missing or invalid JSON', () => {
    const emptyRes = JSON.parse(handleDoPost(undefined).getContent()) as {
      ok: boolean;
      error?: { code: string };
    };
    expect(emptyRes.ok).toBe(false);
    expect(emptyRes.error?.code).toBe('VALIDATION_ERROR');

    const invalidJsonEvent = {
      postData: { contents: '{not-json' },
    } as unknown as GoogleAppsScript.Events.DoPost;
    const badRes = JSON.parse(handleDoPost(invalidJsonEvent).getContent()) as {
      ok: boolean;
      error?: { code: string };
    };
    expect(badRes.ok).toBe(false);
    expect(badRes.error?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects unknown RPC actions with VALIDATION_ERROR and reports SERVER_MISCONFIGURED on valid M1 skeleton actions', () => {
    const unknownEvent = {
      postData: {
        contents: JSON.stringify({
          action: 'unknown.action',
          clientRequestId: 'req-1',
          payload: {},
        }),
      },
    } as unknown as GoogleAppsScript.Events.DoPost;
    const unknownRes = JSON.parse(handleDoPost(unknownEvent).getContent()) as {
      ok: boolean;
      error?: { code: string };
    };
    expect(unknownRes.ok).toBe(false);
    expect(unknownRes.error?.code).toBe('VALIDATION_ERROR');

    const knownEvent = {
      postData: {
        contents: JSON.stringify({
          action: 'dataset.get',
          clientRequestId: 'req-2',
          payload: {},
        }),
      },
    } as unknown as GoogleAppsScript.Events.DoPost;
    const knownRes = JSON.parse(handleDoPost(knownEvent).getContent()) as {
      ok: boolean;
      error?: { code: string };
    };
    expect(knownRes.ok).toBe(false);
    expect(knownRes.error?.code).toBe('SERVER_MISCONFIGURED');
  });

  it('returns all 8 ALLOWED_SHEETS and reads zero FORBIDDEN_SHEETS in inspectSheetStructureImpl()', () => {
    const report = inspectSheetStructureImpl();
    expect(report.activeSheets.map((s) => s.sheetName)).toEqual([...ALLOWED_SHEETS]);
    expect(report.forbiddenSheetsPresent).toEqual([]);
    expect(report.detectedItemsLayout).toBe('columns_per_format');
    expect(report.detectedUnitPriceLayout).toBe('matrix_by_format');
  });
});
