import {
  RepositoryError,
  isGasErrorCode,
  type AccountingEntry,
  type AppDataset,
  type CreateAccountingEntryInput,
  type CreateHarvestInput,
  type CreateSaleOrderInput,
  type DataRepository,
  type GasRpcAction,
  type GasRpcPayloadMap,
  type GasRpcRequest,
  type GasRpcResponse,
  type GasRpcResultMap,
  type Harvest,
  type JarFormat,
  type OrderStatusPatch,
  type RequestMeta,
  type SaleOrder,
  type SheetInspectionReport,
  type UpdateAccountingEntryInput,
  type UpdateHarvestInput,
  type UpdateSaleOrderInput,
  type UpsertJarFormatInput,
  type UserSession,
} from '@app-icol/shared';

export interface GasApiClientOptions {
  endpointUrl: string;
  getIdToken: () => string | undefined;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class GasApiClient implements DataRepository {
  private readonly endpointUrl: string;
  private readonly getIdToken: () => string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GasApiClientOptions) {
    this.endpointUrl = options.endpointUrl;
    this.getIdToken = options.getIdToken;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private async rpc<TAction extends GasRpcAction>(
    action: TAction,
    payload: GasRpcPayloadMap[TAction],
    meta?: RequestMeta,
    overrideIdToken?: string,
  ): Promise<GasRpcResultMap[TAction]> {
    if (!this.endpointUrl) {
      throw new RepositoryError(
        'SERVER_MISCONFIGURED',
        "URL de l'API Google Apps Script non configurée (VITE_GAS_WEBAPP_URL).",
      );
    }

    const controller = new AbortController();
    let didTimeout = false;
    const timeoutId = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, this.timeoutMs);

    const onExternalAbort = (): void => {
      controller.abort();
    };
    if (meta?.signal) {
      if (meta.signal.aborted) {
        clearTimeout(timeoutId);
        throw new RepositoryError('NETWORK_ERROR', 'Requête annulée.');
      }
      meta.signal.addEventListener('abort', onExternalAbort, { once: true });
    }

    const requestEnvelope: GasRpcRequest<GasRpcPayloadMap[TAction], TAction> = {
      action,
      idToken: overrideIdToken ?? this.getIdToken(),
      clientRequestId: meta?.clientRequestId ?? crypto.randomUUID(),
      payload,
    };

    try {
      const response = await this.fetchImpl(this.endpointUrl, {
        method: 'POST',
        // CORS-safe simple request header for Google Apps Script /exec
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
        },
        redirect: 'follow',
        body: JSON.stringify(requestEnvelope),
        signal: controller.signal,
      });

      const rawText = await response.text();
      let parsed: GasRpcResponse<GasRpcResultMap[TAction]>;
      try {
        parsed = JSON.parse(rawText) as GasRpcResponse<GasRpcResultMap[TAction]>;
      } catch {
        throw new RepositoryError(
          'SERVER_MISCONFIGURED',
          'Réponse serveur invalide (redirection HTML détectée). Vérifiez le déploiement Web App Apps Script.',
          { status: response.status },
        );
      }

      if (!parsed || typeof parsed.ok !== 'boolean') {
        throw new RepositoryError(
          'SERVER_MISCONFIGURED',
          'Enveloppe JSON RPC Apps Script invalide.',
        );
      }

      if (!parsed.ok) {
        const code = isGasErrorCode(parsed.error?.code)
          ? parsed.error.code
          : 'INTERNAL_ERROR';
        throw new RepositoryError(
          code,
          parsed.error?.message || 'Erreur retournée par le serveur Apps Script.',
          parsed.error?.details,
        );
      }

      return parsed.data;
    } catch (err) {
      if (err instanceof RepositoryError) {
        throw err;
      }
      if (
        didTimeout ||
        (err instanceof Error && err.name === 'AbortError')
      ) {
        throw new RepositoryError(
          'NETWORK_ERROR',
          'Délai de connexion dépassé (15 s). Vérifiez votre réseau et réessayez.',
        );
      }
      throw new RepositoryError(
        'NETWORK_ERROR',
        'Impossible de contacter le serveur Google Apps Script. Vos données locales sont conservées.',
        err instanceof Error ? err.message : err,
      );
    } finally {
      clearTimeout(timeoutId);
      meta?.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  public getDataset(meta?: RequestMeta): Promise<AppDataset> {
    return this.rpc('dataset.get', {}, meta);
  }

  public listFormats(meta?: RequestMeta): Promise<JarFormat[]> {
    return this.rpc('formats.list', {}, meta);
  }

  public listHarvests(meta?: RequestMeta): Promise<Harvest[]> {
    return this.rpc('harvests.list', {}, meta);
  }

  public listOrders(meta?: RequestMeta): Promise<SaleOrder[]> {
    return this.rpc('orders.list', {}, meta);
  }

  public getOrderById(id: string, meta?: RequestMeta): Promise<SaleOrder | null> {
    return this.rpc('orders.getById', { id }, meta);
  }

  public listAccountingEntries(
    year?: number,
    meta?: RequestMeta,
  ): Promise<AccountingEntry[]> {
    return this.rpc('accounting.list', year !== undefined ? { year } : {}, meta);
  }

  public createOrder(
    input: CreateSaleOrderInput,
    meta?: RequestMeta,
  ): Promise<SaleOrder> {
    return this.rpc('orders.create', { order: input }, meta);
  }

  public updateOrder(
    id: string,
    input: UpdateSaleOrderInput,
    meta?: RequestMeta,
  ): Promise<SaleOrder> {
    return this.rpc('orders.update', { id, order: input }, meta);
  }

  public patchOrderStatuses(
    id: string,
    patch: OrderStatusPatch,
    meta?: RequestMeta,
  ): Promise<SaleOrder> {
    return this.rpc('orders.patchStatuses', { id, patch }, meta);
  }

  public deleteOrder(
    id: string,
    meta?: RequestMeta,
  ): Promise<{ deletedId: string }> {
    return this.rpc('orders.delete', { id }, meta);
  }

  public createHarvest(
    input: CreateHarvestInput,
    meta?: RequestMeta,
  ): Promise<Harvest> {
    return this.rpc('harvests.create', { harvest: input }, meta);
  }

  public updateHarvest(
    id: string,
    input: UpdateHarvestInput,
    meta?: RequestMeta,
  ): Promise<Harvest> {
    return this.rpc('harvests.update', { id, harvest: input }, meta);
  }

  public setDefaultActiveHarvest(
    id: string,
    meta?: RequestMeta,
  ): Promise<Harvest[]> {
    return this.rpc('harvests.setDefaultActive', { id }, meta);
  }

  public upsertJarFormat(
    input: UpsertJarFormatInput,
    meta?: RequestMeta,
  ): Promise<JarFormat> {
    return this.rpc('formats.upsert', { format: input }, meta);
  }

  public createAccountingEntry(
    input: CreateAccountingEntryInput,
    meta?: RequestMeta,
  ): Promise<AccountingEntry> {
    return this.rpc('accounting.create', { entry: input }, meta);
  }

  public updateAccountingEntry(
    id: string,
    input: UpdateAccountingEntryInput,
    meta?: RequestMeta,
  ): Promise<AccountingEntry> {
    return this.rpc('accounting.update', { id, entry: input }, meta);
  }

  public deleteAccountingEntry(
    id: string,
    meta?: RequestMeta,
  ): Promise<{ deletedId: string }> {
    return this.rpc('accounting.delete', { id }, meta);
  }

  public verifySession(idToken: string, meta?: RequestMeta): Promise<UserSession> {
    return this.rpc('auth.verifySession', {}, meta, idToken);
  }

  public inspectSheetStructure(meta?: RequestMeta): Promise<SheetInspectionReport> {
    return this.rpc('admin.inspectSheetStructure', {}, meta);
  }
}
