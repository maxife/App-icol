import {
  ALLOWED_SHEETS,
  GAS_ACTION_POLICIES,
  RepositoryError,
  isGasRpcAction,
  isRepositoryError,
  type GasRpcAction,
  type GasRpcPayloadMap,
  type GasRpcRequest,
  type GasRpcResponse,
  type SheetInspectionReport,
  type UserSession,
} from '@app-icol/shared';
import { authenticateAndAuthorizeRpc } from './auth/AuthVerifier';
import {
  SheetsRepository,
  openConfiguredSheetsRepository,
} from './sheets/SheetsRepository';

const LOCK_WAIT_TIMEOUT_MS = 10_000;
const IDEMPOTENCY_TTL_SECONDS = 21_600; // 6 hours (Apps Script CacheService maximum)

function jsonTextOutput(payload: GasRpcResponse): GoogleAppsScript.Content.TextOutput {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function buildErrorResponse(err: unknown): GasRpcResponse<never> {
  if (isRepositoryError(err)) {
    return {
      ok: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    };
  }
  return {
    ok: false,
    error: {
      code: 'INTERNAL_ERROR',
      message:
        err instanceof Error && err.message
          ? err.message
          : 'Erreur interne inattendue sur le serveur Google Apps Script.',
    },
  };
}

function buildIdempotencyCacheKey(
  session: UserSession,
  action: GasRpcAction,
  clientRequestId: string,
): string {
  const emailKey = session.email.trim().toLowerCase();
  const safeReqId = clientRequestId.trim().slice(0, 120);
  return `app-icol:idem:${emailKey}:${action}:${safeReqId}`;
}

function readCachedMutationResponse(cacheKey: string): GasRpcResponse | null {
  if (typeof CacheService === 'undefined' || !CacheService?.getScriptCache) {
    return null;
  }
  try {
    const raw = CacheService.getScriptCache().get(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GasRpcResponse;
    if (parsed && parsed.ok === true) {
      return {
        ...parsed,
        deduplicated: true,
        serverTimestamp: new Date().toISOString(),
      };
    }
  } catch {
    // Ignore cache deserialization failure and execute normally
  }
  return null;
}

function writeCachedMutationResponse(
  cacheKey: string,
  envelope: GasRpcResponse,
): void {
  if (typeof CacheService === 'undefined' || !CacheService?.getScriptCache) {
    return;
  }
  if (!envelope.ok) return;
  try {
    CacheService.getScriptCache().put(
      cacheKey,
      JSON.stringify(envelope),
      IDEMPOTENCY_TTL_SECONDS,
    );
  } catch {
    // Ignore cache write errors
  }
}

function acquireScriptLockOrThrow(): GoogleAppsScript.Lock.Lock | null {
  if (typeof LockService === 'undefined' || !LockService?.getScriptLock) {
    return null;
  }
  const lock = LockService.getScriptLock();
  try {
    if (typeof lock.tryLock === 'function') {
      const acquired = lock.tryLock(LOCK_WAIT_TIMEOUT_MS);
      if (!acquired) {
        throw new RepositoryError(
          'LOCK_TIMEOUT',
          'Le classeur est temporairement occupé par un autre enregistrement. Veuillez réessayer dans quelques secondes.',
        );
      }
      return lock;
    }
    lock.waitLock(LOCK_WAIT_TIMEOUT_MS);
    return lock;
  } catch (err) {
    if (isRepositoryError(err)) {
      throw err;
    }
    throw new RepositoryError(
      'LOCK_TIMEOUT',
      'Impossible de verrouiller le classeur Google Sheets dans le délai imparti (10 s).',
      err instanceof Error ? err.message : String(err),
    );
  }
}

function requireObjectPayload(payload: unknown): Record<string, unknown> {
  if (payload === undefined || payload === null) {
    return {};
  }
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw new RepositoryError(
      'VALIDATION_ERROR',
      'Le champ "payload" de la requête RPC doit être un objet JSON.',
    );
  }
  return payload as Record<string, unknown>;
}

function requireStringField(
  obj: Record<string, unknown>,
  fieldName: string,
): string {
  const val = obj[fieldName];
  if (typeof val !== 'string' || !val.trim()) {
    throw new RepositoryError(
      'VALIDATION_ERROR',
      `Champ obligatoire "${fieldName}" manquant ou vide dans le payload.`,
    );
  }
  return val.trim();
}

function dispatchAction(
  action: GasRpcAction,
  rawPayload: unknown,
  session: UserSession,
  getRepo: () => SheetsRepository,
): unknown {
  const payload = requireObjectPayload(rawPayload);

  switch (action) {
    case 'auth.verifySession':
      return session;

    case 'dataset.get':
      return getRepo().getDataset(session);

    case 'formats.list':
      return getRepo().listFormats();

    case 'formats.upsert': {
      const p = payload as Partial<GasRpcPayloadMap['formats.upsert']>;
      if (!p.format || typeof p.format !== 'object') {
        throw new RepositoryError(
          'VALIDATION_ERROR',
          'Champ "format" requis pour formats.upsert.',
        );
      }
      return getRepo().upsertJarFormat(p.format);
    }

    case 'harvests.list':
      return getRepo().listHarvests();

    case 'harvests.create': {
      const p = payload as Partial<GasRpcPayloadMap['harvests.create']>;
      if (!p.harvest || typeof p.harvest !== 'object') {
        throw new RepositoryError(
          'VALIDATION_ERROR',
          'Champ "harvest" requis pour harvests.create.',
        );
      }
      return getRepo().createHarvest(p.harvest);
    }

    case 'harvests.update': {
      const id = requireStringField(payload, 'id');
      const p = payload as Partial<GasRpcPayloadMap['harvests.update']>;
      if (!p.harvest || typeof p.harvest !== 'object') {
        throw new RepositoryError(
          'VALIDATION_ERROR',
          'Champ "harvest" requis pour harvests.update.',
        );
      }
      return getRepo().updateHarvest(id, p.harvest);
    }

    case 'harvests.setDefaultActive': {
      const id = requireStringField(payload, 'id');
      return getRepo().setDefaultActiveHarvest(id);
    }

    case 'orders.list':
      return getRepo().listOrders();

    case 'orders.getById': {
      const id = requireStringField(payload, 'id');
      return getRepo().getOrderById(id);
    }

    case 'orders.create': {
      const p = payload as Partial<GasRpcPayloadMap['orders.create']>;
      if (!p.order || typeof p.order !== 'object') {
        throw new RepositoryError(
          'VALIDATION_ERROR',
          'Champ "order" requis pour orders.create.',
        );
      }
      return getRepo().createOrder(p.order, session);
    }

    case 'orders.update': {
      const id = requireStringField(payload, 'id');
      const p = payload as Partial<GasRpcPayloadMap['orders.update']> & {
        expectedUpdatedAt?: string;
      };
      if (!p.order || typeof p.order !== 'object') {
        throw new RepositoryError(
          'VALIDATION_ERROR',
          'Champ "order" requis pour orders.update.',
        );
      }
      return getRepo().updateOrder(
        id,
        p.order,
        session,
        typeof p.expectedUpdatedAt === 'string' ? p.expectedUpdatedAt : undefined,
      );
    }

    case 'orders.patchStatuses': {
      const id = requireStringField(payload, 'id');
      const p = payload as Partial<GasRpcPayloadMap['orders.patchStatuses']> & {
        expectedUpdatedAt?: string;
      };
      if (!p.patch || typeof p.patch !== 'object') {
        throw new RepositoryError(
          'VALIDATION_ERROR',
          'Champ "patch" requis pour orders.patchStatuses.',
        );
      }
      return getRepo().patchOrderStatuses(
        id,
        p.patch,
        session,
        typeof p.expectedUpdatedAt === 'string' ? p.expectedUpdatedAt : undefined,
      );
    }

    case 'orders.delete': {
      const id = requireStringField(payload, 'id');
      return getRepo().deleteOrder(id);
    }

    case 'accounting.list': {
      const p = payload as Partial<GasRpcPayloadMap['accounting.list']>;
      const year =
        typeof p.year === 'number' && Number.isFinite(p.year) ? p.year : undefined;
      return getRepo().listAccountingEntries(year);
    }

    case 'accounting.create': {
      const p = payload as Partial<GasRpcPayloadMap['accounting.create']>;
      if (!p.entry || typeof p.entry !== 'object') {
        throw new RepositoryError(
          'VALIDATION_ERROR',
          'Champ "entry" requis pour accounting.create.',
        );
      }
      return getRepo().createAccountingEntry(p.entry);
    }

    case 'accounting.update': {
      const id = requireStringField(payload, 'id');
      const p = payload as Partial<GasRpcPayloadMap['accounting.update']>;
      if (!p.entry || typeof p.entry !== 'object') {
        throw new RepositoryError(
          'VALIDATION_ERROR',
          'Champ "entry" requis pour accounting.update.',
        );
      }
      return getRepo().updateAccountingEntry(id, p.entry);
    }

    case 'accounting.delete': {
      const id = requireStringField(payload, 'id');
      return getRepo().deleteAccountingEntry(id);
    }

    case 'admin.inspectSheetStructure':
      return getRepo().inspectSheetStructure();
  }
}

/**
 * Google Apps Script `doGet(e)` health/metadata handler.
 */
export function handleDoGet(): GoogleAppsScript.Content.TextOutput {
  return jsonTextOutput({
    ok: true,
    data: {
      service: 'app-icol-gas-api',
      status: 'ready',
      allowedSheetsCount: ALLOWED_SHEETS.length,
    },
    serverTimestamp: new Date().toISOString(),
  });
}

/**
 * Google Apps Script `doPost(e)` CORS-safe (`text/plain;charset=utf-8`) JSON RPC router.
 */
export function handleDoPost(
  e: GoogleAppsScript.Events.DoPost | undefined,
): GoogleAppsScript.Content.TextOutput {
  const rawBody = e?.postData?.contents;
  if (!rawBody || typeof rawBody !== 'string' || !rawBody.trim()) {
    return jsonTextOutput({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Corps de requête JSON manquant (attendu: text/plain;charset=utf-8).',
      },
    });
  }

  let parsed: Partial<GasRpcRequest>;
  try {
    parsed = JSON.parse(rawBody) as Partial<GasRpcRequest>;
  } catch {
    return jsonTextOutput({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'JSON invalide dans le corps de la requête doPost.',
      },
    });
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return jsonTextOutput({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Requête RPC JSON invalide.',
      },
    });
  }

  if (typeof parsed.action !== 'string' || !isGasRpcAction(parsed.action)) {
    return jsonTextOutput({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Champ "action" manquant ou non reconnu dans la requête RPC.',
      },
    });
  }

  const action = parsed.action;
  const policy = GAS_ACTION_POLICIES[action];

  try {
    const session = authenticateAndAuthorizeRpc(parsed.idToken, action);

    if (!policy.isMutation) {
      const data = dispatchAction(
        action,
        parsed.payload,
        session,
        openConfiguredSheetsRepository,
      );
      return jsonTextOutput({
        ok: true,
        data,
        serverTimestamp: new Date().toISOString(),
      });
    }

    const clientRequestId =
      typeof parsed.clientRequestId === 'string'
        ? parsed.clientRequestId.trim()
        : '';
    if (!clientRequestId) {
      throw new RepositoryError(
        'VALIDATION_ERROR',
        'Champ "clientRequestId" obligatoire pour toute mutation idempotente.',
      );
    }

    const cacheKey = buildIdempotencyCacheKey(session, action, clientRequestId);
    const fastCached = readCachedMutationResponse(cacheKey);
    if (fastCached) {
      return jsonTextOutput(fastCached);
    }

    const lock = acquireScriptLockOrThrow();
    try {
      const lockedCached = readCachedMutationResponse(cacheKey);
      if (lockedCached) {
        return jsonTextOutput(lockedCached);
      }

      const data = dispatchAction(
        action,
        parsed.payload,
        session,
        openConfiguredSheetsRepository,
      );
      const successEnvelope: GasRpcResponse = {
        ok: true,
        data,
        serverTimestamp: new Date().toISOString(),
      };
      writeCachedMutationResponse(cacheKey, successEnvelope);
      return jsonTextOutput(successEnvelope);
    } finally {
      if (lock) {
        try {
          lock.releaseLock();
        } catch {
          // Ignore lock release failure
        }
      }
    }
  } catch (err) {
    return jsonTextOutput(buildErrorResponse(err));
  }
}

/**
 * Direct Apps Script editor helper (`inspectSheetStructure()`) for initial spreadsheet pairing.
 * Falls back cleanly to an unconfigured report when invoked in bare test environments without PropertiesService.
 */
export function inspectSheetStructureImpl(): SheetInspectionReport {
  if (
    typeof PropertiesService === 'undefined' ||
    !PropertiesService?.getScriptProperties ||
    typeof SpreadsheetApp === 'undefined' ||
    !SpreadsheetApp?.openById
  ) {
    return {
      spreadsheetId: 'UNCONFIGURED',
      inspectedAt: new Date().toISOString(),
      detectedItemsLayout: 'columns_per_format',
      detectedUnitPriceLayout: 'matrix_by_format',
      activeSheets: ALLOWED_SHEETS.map((sheetName) => ({
        sheetName,
        exists: false,
        rowCount: 0,
        headers: [],
        resolvedFieldMap: {},
        missingRequiredFields: [],
        formulaColumns: [],
        arrayFormulaColumns: [],
        isFormulaDrivenSummary:
          sheetName === 'ParRecoltes' ||
          sheetName === 'ParCommandes' ||
          sheetName === 'ParPaiement',
      })),
      forbiddenSheetsPresent: [],
      unlistedSheetsPresent: [],
      warnings: [
        'PropertiesService ou SpreadsheetApp non configuré : définissez SPREADSHEET_ID dans les Propriétés du script.',
      ],
    };
  }

  return openConfiguredSheetsRepository().inspectSheetStructure();
}
