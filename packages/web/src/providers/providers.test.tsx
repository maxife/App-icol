import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  RepositoryError as SharedRepositoryError,
  SEED_EXPECTED_KPIS,
  SEED_MOCK_USERS,
} from '@app-icol/shared';
import { ToastViewport } from '../ui';
import {
  AuthProvider,
  DataProvider,
  GasApiClient,
  MockSheetsRepository,
  RepositoryError,
  ToastProvider,
  processBootstrapUrlReset,
  useAuth,
  useData,
  useToast,
} from './index';

describe('providers, bootstrapUrlParams, MockSheetsRepository & GasApiClient', () => {
  it('re-exports the exact nominal RepositoryError class from @app-icol/shared (D-01/D-02)', () => {
    expect(RepositoryError).toBe(SharedRepositoryError);
    const err = new RepositoryError('FORBIDDEN_ROLE', 'Interdit');
    expect(err instanceof SharedRepositoryError).toBe(true);
  });

  it('processBootstrapUrlReset clears app-icol:* keys, preserves unrelated keys, and strips ?resetMock=1 cleanly', () => {
    window.localStorage.setItem('app-icol:dataset:v1', '{"dirty":true}');
    window.localStorage.setItem('app-icol:sale-draft:new', '{"draft":true}');
    window.localStorage.setItem('other-app:key', 'keep-me');
    window.history.replaceState(null, '', '/?resetMock=1&foo=bar#/dashboard');

    const didReset = processBootstrapUrlReset(window);
    expect(didReset).toBe(true);
    expect(window.localStorage.getItem('app-icol:dataset:v1')).toBeNull();
    expect(window.localStorage.getItem('app-icol:sale-draft:new')).toBeNull();
    expect(window.localStorage.getItem('other-app:key')).toBe('keep-me');
    expect(window.location.search).toBe('?foo=bar');
    expect(window.location.hash).toBe('#/dashboard');

    // Hash-embedded ?resetMock=1 form
    window.localStorage.setItem('app-icol:dataset:v1', '{"dirty":true}');
    window.history.replaceState(
      null,
      '',
      '/#/orders?orderStatus=R%C3%A9serv%C3%A9&resetMock=1',
    );
    expect(processBootstrapUrlReset(window)).toBe(true);
    expect(window.localStorage.getItem('app-icol:dataset:v1')).toBeNull();
    expect(window.location.hash).toBe('#/orders?orderStatus=R%C3%A9serv%C3%A9');
  });

  it('MockSheetsRepository enforces RBAC, preserves snapshots (EC-20), and handles failNextWrite + idempotent retry', async () => {
    let activeActor = { ...SEED_MOCK_USERS.manager };
    let latestSim = { offlineMode: false, failNextWrite: false, latencyMs: 0 };

    const repo = new MockSheetsRepository({
      getActorSession: () => activeActor,
      initialSimulation: { latencyMs: 0 },
      onSimulationChange: (next) => {
        latestSim = next;
      },
    });

    const ds = await repo.getDataset();
    expect(ds.orders).toHaveLength(25);
    expect(ds.accountingEntries).toHaveLength(14);

    // Inspect structure as manager
    const report = await repo.inspectSheetStructure();
    expect(report.activeSheets).toHaveLength(8);
    expect(report.forbiddenSheetsPresent).toHaveLength(4);

    // EC-20: Update PUan price on Printemps 2025, then edit ord-001 -> historical unitPriceEur (15 €) preserved
    await repo.updateHarvest('printemps-2025', {
      unitPricesEur: { '1kg': 22, '500g': 11, '250g': 6 },
    });
    const ord001 = await repo.getOrderById('ord-001');
    expect(ord001).not.toBeNull();
    const updatedOrd001 = await repo.updateOrder('ord-001', {
      date: ord001!.date,
      customerName: ord001!.customerName,
      phone: ord001!.phone,
      contextOrRelay: 'Nouveau relais',
      harvestLabel: ord001!.harvestLabel,
      items: [
        { formatCode: '1kg', quantity: 2 },
        { formatCode: '500g', quantity: 2 },
      ],
      manualAmountOverrideEur: null,
      orderStatus: ord001!.orderStatus,
      paymentStatus: ord001!.paymentStatus,
      collectedByThirdParty: false,
    });
    expect(updatedOrd001.computedAmountEur).toBe(46);

    // Switch to contributor: RBAC blocks manager-only actions, auto-activates transfer on Payé
    activeActor = { ...SEED_MOCK_USERS.contributor };
    const contribDs = await repo.getDataset();
    expect(contribDs.accountingEntries).toEqual([]);

    await expect(repo.deleteOrder('ord-001')).rejects.toMatchObject({
      code: 'FORBIDDEN_ROLE',
    });
    await expect(repo.listAccountingEntries()).rejects.toMatchObject({
      code: 'FORBIDDEN_ROLE',
    });
    await expect(repo.inspectSheetStructure()).rejects.toMatchObject({
      code: 'FORBIDDEN_ROLE',
    });

    // Arm failNextWrite: first createOrder with req-retry-1 fails AND auto-disarms without caching req-retry-1
    repo.setNetworkSimulation({ failNextWrite: true });
    expect(latestSim.failNextWrite).toBe(true);

    const createPayload = {
      date: '2026-05-15',
      customerName: 'Client CoVendeur',
      phone: '+33 6 99 88 77 66',
      contextOrRelay: 'Bureau (Marie)',
      harvestLabel: 'Printemps 2026',
      items: [{ formatCode: '1kg', quantity: 1 }],
      orderStatus: 'Distribué' as const,
      paymentStatus: 'Payé' as const,
      collectedByThirdParty: false,
    };

    await expect(
      repo.createOrder(createPayload, { clientRequestId: 'req-retry-1' }),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(latestSim.failNextWrite).toBe(false);

    // Immediate retry with the EXACT SAME clientRequestId succeeds and auto-sets Marie Laurent transfer
    const created = await repo.createOrder(createPayload, {
      clientRequestId: 'req-retry-1',
    });
    expect(created.phone).toBe('06 99 88 77 66');
    expect(created.collectedByThirdParty).toBe(true);
    expect(created.collectorName).toBe('Marie Laurent');
    expect(created.transferStatus).toBe('À reverser');

    // Duplicate retry with same clientRequestId is deduplicated
    const deduplicated = await repo.createOrder(createPayload, {
      clientRequestId: 'req-retry-1',
    });
    expect(deduplicated.id).toBe(created.id);
    expect(await repo.listOrders()).toHaveLength(26);
  });

  it('GasApiClient uses POST text/plain;charset=utf-8 with redirect: follow and maps errors to RepositoryError', async () => {
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          data: { deletedId: 'ord-099' },
          serverTimestamp: '2026-05-12T10:00:00.000Z',
        }),
        { status: 200 },
      ),
    );

    const client = new GasApiClient({
      endpointUrl: 'http://127.0.0.1:4999/exec',
      getIdToken: () => 'gis-token-123',
      fetchImpl: fetchSpy,
    });

    const res = await client.deleteOrder('ord-099', { clientRequestId: 'cid-1' });
    expect(res).toEqual({ deletedId: 'ord-099' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchSpy.mock.calls[0]!;
    expect(calledUrl).toBe('http://127.0.0.1:4999/exec');
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('follow');
    expect(init?.headers).toEqual({
      'Content-Type': 'text/plain;charset=utf-8',
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      action: 'orders.delete',
      idToken: 'gis-token-123',
      clientRequestId: 'cid-1',
      payload: { id: 'ord-099' },
    });

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: false,
          error: { code: 'FORBIDDEN_SHEET', message: 'Accès interdit' },
        }),
        { status: 200 },
      ),
    );
    await expect(client.getDataset()).rejects.toThrow(SharedRepositoryError);
  });

  it('AuthProvider & DataProvider roll back failed optimistic patchOrderStatuses and protect D-03 transfers', async () => {
    function Consumer() {
      const { roleStatusLabel, switchMockProfile } = useAuth();
      const {
        orders,
        customerSuggestions,
        isLoading,
        patchOrderStatuses,
        setNetworkSimulation,
        resetMockData,
      } = useData();
      const { toasts, dismissToast } = useToast();

      const ord015 = orders.find((o) => o.id === 'ord-015');
      const ord024 = orders.find((o) => o.id === 'ord-024');

      return (
        <div>
          <span data-testid="loading">{String(isLoading)}</span>
          <span data-testid="role">{roleStatusLabel}</span>
          <span data-testid="dir-count">{customerSuggestions.length}</span>
          <span data-testid="ord015-status">{ord015?.orderStatus ?? ''}</span>
          <span data-testid="ord024-transfer">{ord024?.transferStatus ?? ''}</span>
          <button
            type="button"
            data-testid="switch-contrib"
            onClick={() => switchMockProfile('contributor')}
          >
            Contrib
          </button>
          <button
            type="button"
            data-testid="arm-fail"
            onClick={() => setNetworkSimulation({ failNextWrite: true })}
          >
            Fail1x
          </button>
          <button
            type="button"
            data-testid="patch-015"
            onClick={() => {
              void patchOrderStatuses('ord-015', {
                orderStatus: 'Distribué',
              }).catch(() => {});
            }}
          >
            Distribute015
          </button>
          <button
            type="button"
            data-testid="patch-024-distribute"
            onClick={() => {
              void patchOrderStatuses('ord-024', {
                orderStatus: 'Distribué',
              });
            }}
          >
            Distribute024
          </button>
          <button
            type="button"
            data-testid="do-reset"
            onClick={() => {
              void resetMockData();
            }}
          >
            Reset
          </button>
          <ToastViewport toasts={toasts} onDismiss={dismissToast} />
        </div>
      );
    }

    render(
      <ToastProvider>
        <AuthProvider>
          <DataProvider initialSimulation={{ latencyMs: 10 }}>
            <Consumer />
          </DataProvider>
        </AuthProvider>
      </ToastProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });
    expect(screen.getByTestId('role')).toHaveTextContent('manager');
    expect(screen.getByTestId('dir-count')).toHaveTextContent(
      String(SEED_EXPECTED_KPIS.customerDirectoryCount),
    );
    expect(document.getElementById('app-icol-gis-script')).toBeNull();

    // Arm failNextWrite and trigger optimistic patch on ord-015 -> rolls back to Réservé + shows toast-error
    fireEvent.click(screen.getByTestId('arm-fail'));
    fireEvent.click(screen.getByTestId('patch-015'));

    await waitFor(() => {
      expect(screen.getByTestId('toast-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ord015-status')).toHaveTextContent('Réservé');

    // D-03: Switch to contributor and click Passer à Distribué on ord-024 (already Payé to manager) -> stays Non concerné!
    fireEvent.click(screen.getByTestId('switch-contrib'));
    await waitFor(() => {
      expect(screen.getByTestId('role')).toHaveTextContent('contributor');
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('patch-024-distribute'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('ord024-transfer')).toHaveTextContent('Non concerné');
    });

    // Reset mock data restores manager role
    fireEvent.click(screen.getByTestId('do-reset'));
    await waitFor(() => {
      expect(screen.getByTestId('role')).toHaveTextContent('manager');
    });
  });
});
