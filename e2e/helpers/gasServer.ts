import { Buffer } from 'node:buffer';
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export const REPO_ROOT = '/home/antigravity';
export const SCRATCH_TMP_ROOT = '/home/antigravity/.gemini/jetski/scratch/teamwork_tmp';
export const GAS_LOCAL_SERVER_SCRIPT = path.join(
  REPO_ROOT,
  'packages/gas-api/scripts/serve-local-gas.mjs',
);

export const DEFAULT_GAS_AUTH_CONFIG = {
  googleClientId: 'app-icol-e2e-client.apps.googleusercontent.com',
  managerEmails: ['gestionnaire@app-icol.test', 'apiculteur@app-icol.test'],
  contributorEmails: ['covendeur@app-icol.test'],
  unauthorizedEmail: 'visiteur-externe@non-autorise.test',
  spreadsheetId: 'mock-vente-et-reservations-miel-e2e',
} as const;

export const GAS_RPC_ACTIONS = {
  verifySession: 'auth.verifySession',
  getDataset: 'dataset.get',
  listFormats: 'formats.list',
  upsertFormat: 'formats.upsert',
  listHarvests: 'harvests.list',
  createHarvest: 'harvests.create',
  updateHarvest: 'harvests.update',
  setDefaultActiveHarvest: 'harvests.setDefaultActive',
  listOrders: 'orders.list',
  getOrderById: 'orders.getById',
  createOrder: 'orders.create',
  updateOrder: 'orders.update',
  patchOrderStatuses: 'orders.patchStatuses',
  deleteOrder: 'orders.delete',
  listAccountingEntries: 'accounting.list',
  createAccountingEntry: 'accounting.create',
  updateAccountingEntry: 'accounting.update',
  deleteAccountingEntry: 'accounting.delete',
  inspectSheetStructure: 'admin.inspectSheetStructure',
} as const;

export type GasRpcAction =
  | (typeof GAS_RPC_ACTIONS)[keyof typeof GAS_RPC_ACTIONS]
  | (string & {});

export type GasErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN_ROLE'
  | 'FORBIDDEN_SHEET'
  | 'UNLISTED_SHEET'
  | 'READ_ONLY_SUMMARY_SHEET'
  | 'SCHEMA_MISMATCH'
  | 'CONCURRENT_MODIFICATION'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'LOCK_TIMEOUT'
  | 'NETWORK_ERROR'
  | 'SERVER_MISCONFIGURED'
  | 'INTERNAL_ERROR'
  | (string & {});

export interface GasSessionDto {
  email: string;
  displayName: string;
  role: 'manager' | 'contributor';
  idToken?: string;
}

export interface GasJarFormatDto {
  code: string;
  label: string;
  weightKg: number;
  active: boolean;
}

export interface GasHarvestDto {
  id: string;
  label: string;
  year: number;
  forecastWeightKg: number;
  realizedWeightKg: number | null;
  unitPricesEur: Record<string, number>;
  isDefaultActive: boolean;
}

export interface GasOrderLineItemDto {
  formatCode: string;
  quantity: number;
  unitWeightKg: number;
  unitPriceEur: number;
}

export interface GasSaleOrderDto {
  id: string;
  sheetRowNumber?: number;
  date: string;
  customerName: string;
  phone: string;
  contextOrRelay: string;
  harvestLabel: string;
  items: GasOrderLineItemDto[];
  computedWeightKg: number;
  computedAmountEur: number;
  manualAmountOverrideEur: number | null;
  effectiveAmountEur: number;
  orderStatus: 'Réservé' | 'Distribué';
  paymentStatus: 'Non-payé' | 'Payé' | 'Donné';
  collectedByThirdParty: boolean;
  collectorName: string;
  transferStatus: 'Non concerné' | 'À reverser' | 'Reversé';
  notes?: string;
  updatedAt: string;
}

export interface GasAccountingEntryDto {
  id: string;
  sheetRowNumber?: number;
  date: string;
  year: number;
  type: 'Recette' | 'Dépense';
  category: string;
  label: string;
  amountEur: number;
  notes?: string;
  updatedAt?: string;
}

export interface GasDatasetDto {
  formats: GasJarFormatDto[];
  harvests: GasHarvestDto[];
  orders: GasSaleOrderDto[];
  accountingEntries: GasAccountingEntryDto[];
  serverTimestamp: string;
  session?: GasSessionDto;
}

export interface GasSheetTabInspectionDto {
  sheetName: string;
  exists: boolean;
  rowCount: number;
  headers: string[];
  resolvedFieldMap: Record<string, number>;
  formulaColumns: string[];
  isFormulaDrivenSummary: boolean;
  missingRequiredFields?: string[];
  arrayFormulaColumns?: string[];
}

export interface GasSheetInspectionReportDto {
  spreadsheetId: string;
  spreadsheetName?: string;
  inspectedAt: string;
  detectedItemsLayout: 'columns_per_format' | 'row_per_item';
  detectedUnitPriceLayout?: 'matrix_by_format' | 'row_per_format';
  activeSheets: GasSheetTabInspectionDto[];
  forbiddenSheetsPresent: string[];
  unlistedSheetsPresent?: string[];
  warnings?: string[];
}

export interface GasCreateOrderInputDto {
  date: string;
  customerName: string;
  phone: string;
  contextOrRelay: string;
  harvestLabel: string;
  items: Array<{
    formatCode: string;
    quantity: number;
    unitWeightKg?: number;
    unitPriceEur?: number;
  }>;
  manualAmountOverrideEur?: number | null;
  orderStatus: 'Réservé' | 'Distribué';
  paymentStatus: 'Non-payé' | 'Payé' | 'Donné';
  collectedByThirdParty: boolean;
  collectorName?: string;
  transferStatus?: 'Non concerné' | 'À reverser' | 'Reversé';
  notes?: string;
}

export interface GasCreateHarvestInputDto {
  label: string;
  year: number;
  forecastWeightKg: number;
  realizedWeightKg: number | null;
  unitPricesEur: Record<string, number>;
  isDefaultActive: boolean;
}

export interface GasCreateAccountingEntryInputDto {
  date: string;
  year?: number;
  type: 'Recette' | 'Dépense';
  category: string;
  label: string;
  amountEur: number;
  notes?: string;
}

export interface GasRpcSuccessResponse<TData = unknown> {
  ok: true;
  data: TData;
  deduplicated?: boolean;
  fromCache?: boolean;
  serverTimestamp: string;
}

export interface GasRpcErrorResponse {
  ok: false;
  error: {
    code: GasErrorCode;
    message: string;
    details?: unknown;
  };
}

export type GasRpcResponse<TData = unknown> =
  | GasRpcSuccessResponse<TData>
  | GasRpcErrorResponse;

export function isDeduplicatedRpcResponse<TData>(
  response: GasRpcResponse<TData>,
): boolean {
  return response.ok === true && Boolean(response.deduplicated || response.fromCache);
}

export interface MockGisTokenOptions {
  email: string;
  displayName?: string;
  aud?: string;
  iss?: string;
  emailVerified?: boolean;
  expiresInSeconds?: number;
}

function toBase64UrlJson(obj: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

export function createMockGisIdToken(opts: MockGisTokenOptions): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + (opts.expiresInSeconds ?? 3600);
  const header = { alg: 'RS256', typ: 'JWT', kid: 'app-icol-mock-kid' };
  const payload = {
    iss: opts.iss ?? 'https://accounts.google.com',
    aud: opts.aud ?? DEFAULT_GAS_AUTH_CONFIG.googleClientId,
    sub: `google-sub-${opts.email.toLowerCase()}`,
    email: opts.email,
    email_verified: opts.emailVerified ?? true,
    name: opts.displayName ?? opts.email.split('@')[0],
    iat: nowSec - 30,
    exp: expSec,
  };
  const sig = Buffer.from(`mock-sig:${opts.email}:${expSec}`, 'utf8').toString('base64url');
  return `${toBase64UrlJson(header)}.${toBase64UrlJson(payload)}.${sig}`;
}

export function allocateFreeLocalPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      if (!address || typeof address === 'string') {
        srv.close(() => reject(new Error('Failed to bind ephemeral 127.0.0.1 TCP port')));
        return;
      }
      const { port } = address;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

export interface GasRpcCallOptions<TPayload = Record<string, unknown>> {
  action: GasRpcAction;
  idToken?: string;
  clientRequestId?: string;
  payload?: TPayload;
  contentType?: string;
  timeoutMs?: number;
}

export async function postGasRpc<TData = unknown, TPayload = Record<string, unknown>>(
  baseUrl: string,
  options: GasRpcCallOptions<TPayload>,
): Promise<GasRpcResponse<TData>> {
  const bodyObj: Record<string, unknown> = {
    action: options.action,
    clientRequestId: options.clientRequestId ?? crypto.randomUUID(),
    payload: options.payload ?? {},
  };
  if (options.idToken !== undefined) {
    bodyObj.idToken = options.idToken;
  }

  const res = await fetch(`${baseUrl}/exec`, {
    method: 'POST',
    headers: {
      'Content-Type': options.contentType ?? 'text/plain;charset=utf-8',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    body: JSON.stringify(bodyObj),
  });

  const rawText = await res.text();
  try {
    return JSON.parse(rawText) as GasRpcResponse<TData>;
  } catch (err) {
    throw new Error(
      `Expected JSON envelope from ${baseUrl}/exec (HTTP ${res.status}), received: ${rawText.slice(0, 300)} (${String(err)})`,
    );
  }
}

export async function postRawGasBody(
  baseUrl: string,
  rawBody: string,
  contentType: string = 'text/plain;charset=utf-8',
): Promise<{ status: number; headers: Headers; json: GasRpcResponse<unknown> }> {
  const res = await fetch(`${baseUrl}/exec`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    redirect: 'follow',
    signal: AbortSignal.timeout(10_000),
    body: rawBody,
  });
  const text = await res.text();
  const json = JSON.parse(text) as GasRpcResponse<unknown>;
  return { status: res.status, headers: res.headers, json };
}

export interface StartLocalGasServerOptions {
  googleClientId?: string;
  managerEmails?: readonly string[];
  contributorEmails?: readonly string[];
  spreadsheetId?: string;
  schemaOverridesJson?: string;
  extraEnv?: Record<string, string>;
  startupTimeoutMs?: number;
}

export interface LocalGasServerTokens {
  manager: string;
  contributor: string;
  unauthorizedEmail: string;
  wrongAudience: string;
  expired: string;
}

export interface LocalGasServerHandle {
  port: number;
  baseUrl: string;
  execUrl: string;
  scratchDir: string;
  tokens: LocalGasServerTokens;
  rpc: <TData = unknown, TPayload = Record<string, unknown>>(
    options: GasRpcCallOptions<TPayload>,
  ) => Promise<GasRpcResponse<TData>>;
  stop: () => Promise<void>;
}

export async function startLocalGasServer(
  options: StartLocalGasServerOptions = {},
): Promise<LocalGasServerHandle> {
  if (!fs.existsSync(GAS_LOCAL_SERVER_SCRIPT)) {
    throw new Error(`GAS local runner script not found at ${GAS_LOCAL_SERVER_SCRIPT}`);
  }

  const port = await allocateFreeLocalPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const execUrl = `${baseUrl}/exec`;

  fs.mkdirSync(SCRATCH_TMP_ROOT, { recursive: true, mode: 0o700 });
  const randSuffix = crypto.randomBytes(4).toString('hex');
  const scratchDir = path.join(SCRATCH_TMP_ROOT, `gas-${process.pid}-${randSuffix}`);
  fs.mkdirSync(scratchDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(scratchDir, 0o700);

  const googleClientId = options.googleClientId ?? DEFAULT_GAS_AUTH_CONFIG.googleClientId;
  const managerEmails = options.managerEmails ?? DEFAULT_GAS_AUTH_CONFIG.managerEmails;
  const contributorEmails = options.contributorEmails ?? DEFAULT_GAS_AUTH_CONFIG.contributorEmails;

  const tokens: LocalGasServerTokens = {
    manager: createMockGisIdToken({
      email: managerEmails[0] ?? 'gestionnaire@app-icol.test',
      displayName: 'Apiculteur Principal Test',
      aud: googleClientId,
    }),
    contributor: createMockGisIdToken({
      email: contributorEmails[0] ?? 'covendeur@app-icol.test',
      displayName: 'Co-vendeur Relais Test',
      aud: googleClientId,
    }),
    unauthorizedEmail: createMockGisIdToken({
      email: DEFAULT_GAS_AUTH_CONFIG.unauthorizedEmail,
      displayName: 'Visiteur Non Autorisé',
      aud: googleClientId,
    }),
    wrongAudience: createMockGisIdToken({
      email: managerEmails[0] ?? 'gestionnaire@app-icol.test',
      displayName: 'Wrong Audience Client',
      aud: 'wrong-client-id.apps.googleusercontent.com',
    }),
    expired: createMockGisIdToken({
      email: managerEmails[0] ?? 'gestionnaire@app-icol.test',
      displayName: 'Session Expirée',
      aud: googleClientId,
      expiresInSeconds: -3600,
    }),
  };

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TMPDIR: scratchDir,
    TMP: scratchDir,
    TEMP: scratchDir,
    HOST: '127.0.0.1',
    PORT: String(port),
    GOOGLE_CLIENT_ID: googleClientId,
    MANAGER_EMAILS: managerEmails.join(','),
    CONTRIBUTOR_EMAILS: contributorEmails.join(','),
    SPREADSHEET_ID: options.spreadsheetId ?? DEFAULT_GAS_AUTH_CONFIG.spreadsheetId,
    ...(options.schemaOverridesJson !== undefined
      ? { SCHEMA_OVERRIDES_JSON: options.schemaOverridesJson }
      : {}),
    ...(options.extraEnv ?? {}),
  };

  const child: ChildProcess = spawn(
    process.execPath,
    [GAS_LOCAL_SERVER_SCRIPT, '--port', String(port)],
    {
      cwd: REPO_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let stdoutLog = '';
  let stderrLog = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdoutLog += chunk.toString('utf8').slice(-4096);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrLog += chunk.toString('utf8').slice(-4096);
  });

  let stopped = false;

  const cleanupSync = () => {
    if (child.exitCode === null && !child.killed) {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore child termination race
      }
    }
    try {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    } catch {
      // ignore scratch directory cleanup race
    }
  };

  process.once('exit', cleanupSync);

  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    process.off('exit', cleanupSync);

    if (child.exitCode === null && !child.killed) {
      await new Promise<void>((resolve) => {
        const killTimer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore kill race
          }
          resolve();
        }, 2_000);

        child.once('exit', () => {
          clearTimeout(killTimer);
          resolve();
        });

        try {
          child.kill('SIGTERM');
        } catch {
          clearTimeout(killTimer);
          resolve();
        }
      });
    }

    try {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    } catch {
      // ignore directory removal race
    }
  };

  const deadline = Date.now() + (options.startupTimeoutMs ?? 10_000);
  let lastProbeError = 'no response yet';

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      await stop();
      throw new Error(
        `serve-local-gas.mjs exited prematurely with code ${child.exitCode}.\nSTDOUT: ${stdoutLog}\nSTDERR: ${stderrLog}`,
      );
    }

    try {
      const probe = await postGasRpc(baseUrl, {
        action: GAS_RPC_ACTIONS.verifySession,
        idToken: tokens.manager,
        clientRequestId: `readiness-${randSuffix}`,
        payload: {},
        timeoutMs: 1_500,
      });
      if (typeof probe.ok === 'boolean') {
        return {
          port,
          baseUrl,
          execUrl,
          scratchDir,
          tokens,
          rpc: (callOpts) => postGasRpc(baseUrl, callOpts),
          stop,
        };
      }
    } catch (err) {
      lastProbeError = String(err);
    }

    await new Promise((r) => setTimeout(r, 100));
  }

  await stop();
  throw new Error(
    `Timed out waiting for local GAS server at ${execUrl} (${lastProbeError}).\nSTDOUT: ${stdoutLog}\nSTDERR: ${stderrLog}`,
  );
}
