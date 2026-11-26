import type {
  AccountingEntry,
  AppDataset,
  Harvest,
  JarFormat,
  SaleOrder,
  SheetInspectionReport,
  UserRole,
  UserSession,
} from './domain';
import type {
  CreateAccountingEntryInput,
  CreateHarvestInput,
  CreateSaleOrderInput,
  OrderStatusPatch,
  UpdateAccountingEntryInput,
  UpdateHarvestInput,
  UpdateSaleOrderInput,
  UpsertJarFormatInput,
} from './repository';

export const GAS_RPC_ACTIONS = [
  'auth.verifySession',
  'dataset.get',
  'formats.list',
  'formats.upsert',
  'harvests.list',
  'harvests.create',
  'harvests.update',
  'harvests.setDefaultActive',
  'orders.list',
  'orders.getById',
  'orders.create',
  'orders.update',
  'orders.patchStatuses',
  'orders.delete',
  'accounting.list',
  'accounting.create',
  'accounting.update',
  'accounting.delete',
  'admin.inspectSheetStructure',
] as const;

export type GasRpcAction = (typeof GAS_RPC_ACTIONS)[number];

export function isGasRpcAction(value: unknown): value is GasRpcAction {
  return typeof value === 'string' && (GAS_RPC_ACTIONS as readonly string[]).includes(value);
}

export const GAS_ERROR_CODES = [
  'UNAUTHENTICATED',
  'FORBIDDEN_ROLE',
  'FORBIDDEN_SHEET',
  'UNLISTED_SHEET',
  'READ_ONLY_SUMMARY_SHEET',
  'SCHEMA_MISMATCH',
  'CONCURRENT_MODIFICATION',
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'LOCK_TIMEOUT',
  'NETWORK_ERROR',
  'SERVER_MISCONFIGURED',
  'INTERNAL_ERROR',
] as const;

export type GasErrorCode = (typeof GAS_ERROR_CODES)[number];

export function isGasErrorCode(value: unknown): value is GasErrorCode {
  return typeof value === 'string' && (GAS_ERROR_CODES as readonly string[]).includes(value);
}

export interface GasRpcPayloadMap {
  'auth.verifySession': Record<string, never>;
  'dataset.get': Record<string, never>;
  'formats.list': Record<string, never>;
  'formats.upsert': { format: UpsertJarFormatInput };
  'harvests.list': Record<string, never>;
  'harvests.create': { harvest: CreateHarvestInput };
  'harvests.update': { id: string; harvest: UpdateHarvestInput };
  'harvests.setDefaultActive': { id: string };
  'orders.list': Record<string, never>;
  'orders.getById': { id: string };
  'orders.create': { order: CreateSaleOrderInput };
  'orders.update': { id: string; order: UpdateSaleOrderInput };
  'orders.patchStatuses': { id: string; patch: OrderStatusPatch };
  'orders.delete': { id: string };
  'accounting.list': { year?: number };
  'accounting.create': { entry: CreateAccountingEntryInput };
  'accounting.update': { id: string; entry: UpdateAccountingEntryInput };
  'accounting.delete': { id: string };
  'admin.inspectSheetStructure': Record<string, never>;
}

export interface GasRpcResultMap {
  'auth.verifySession': UserSession;
  'dataset.get': AppDataset;
  'formats.list': JarFormat[];
  'formats.upsert': JarFormat;
  'harvests.list': Harvest[];
  'harvests.create': Harvest;
  'harvests.update': Harvest;
  'harvests.setDefaultActive': Harvest[];
  'orders.list': SaleOrder[];
  'orders.getById': SaleOrder | null;
  'orders.create': SaleOrder;
  'orders.update': SaleOrder;
  'orders.patchStatuses': SaleOrder;
  'orders.delete': { deletedId: string };
  'accounting.list': AccountingEntry[];
  'accounting.create': AccountingEntry;
  'accounting.update': AccountingEntry;
  'accounting.delete': { deletedId: string };
  'admin.inspectSheetStructure': SheetInspectionReport;
}

export interface GasActionPolicy {
  allowedRoles: readonly UserRole[];
  isMutation: boolean;
}

/**
 * Shared RBAC & Lock/Idempotency policy table consumed identically by
 * MockSheetsRepository (M1) and GAS doPost/AuthVerifier (M2).
 */
export const GAS_ACTION_POLICIES: Readonly<Record<GasRpcAction, GasActionPolicy>> = {
  'auth.verifySession': { allowedRoles: ['manager', 'contributor'], isMutation: false },
  'dataset.get': { allowedRoles: ['manager', 'contributor'], isMutation: false },
  'formats.list': { allowedRoles: ['manager', 'contributor'], isMutation: false },
  'formats.upsert': { allowedRoles: ['manager'], isMutation: true },
  'harvests.list': { allowedRoles: ['manager', 'contributor'], isMutation: false },
  'harvests.create': { allowedRoles: ['manager'], isMutation: true },
  'harvests.update': { allowedRoles: ['manager'], isMutation: true },
  'harvests.setDefaultActive': { allowedRoles: ['manager'], isMutation: true },
  'orders.list': { allowedRoles: ['manager', 'contributor'], isMutation: false },
  'orders.getById': { allowedRoles: ['manager', 'contributor'], isMutation: false },
  'orders.create': { allowedRoles: ['manager', 'contributor'], isMutation: true },
  'orders.update': { allowedRoles: ['manager', 'contributor'], isMutation: true },
  'orders.patchStatuses': { allowedRoles: ['manager', 'contributor'], isMutation: true },
  'orders.delete': { allowedRoles: ['manager'], isMutation: true },
  'accounting.list': { allowedRoles: ['manager'], isMutation: false },
  'accounting.create': { allowedRoles: ['manager'], isMutation: true },
  'accounting.update': { allowedRoles: ['manager'], isMutation: true },
  'accounting.delete': { allowedRoles: ['manager'], isMutation: true },
  'admin.inspectSheetStructure': { allowedRoles: ['manager'], isMutation: false },
};

export interface GasRpcRequest<TPayload = unknown, TAction extends GasRpcAction = GasRpcAction> {
  action: TAction;
  idToken?: string;
  clientRequestId: string;
  payload: TPayload;
}

export type GasRpcRequestFor<TAction extends GasRpcAction> = GasRpcRequest<
  GasRpcPayloadMap[TAction],
  TAction
>;

export interface GasRpcErrorPayload {
  code: GasErrorCode;
  message: string;
  details?: unknown;
}

export type GasRpcResponse<TData = unknown> =
  | {
      ok: true;
      data: TData;
      deduplicated?: boolean;
      serverTimestamp: string;
    }
  | {
      ok: false;
      error: GasRpcErrorPayload;
    };

export class RepositoryError extends Error {
  public readonly code: GasErrorCode;
  public readonly details?: unknown;

  constructor(code: GasErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'RepositoryError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isRepositoryError(err: unknown): err is RepositoryError {
  return (
    err instanceof RepositoryError ||
    (typeof err === 'object' &&
      err !== null &&
      (err as { name?: unknown }).name === 'RepositoryError' &&
      typeof (err as { code?: unknown }).code === 'string')
  );
}
