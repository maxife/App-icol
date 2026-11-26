import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  isOrderStatus,
  isPaymentStatus,
  isTransferStatus,
  type OrderStatus,
  type PaymentStatus,
  type TransferStatus,
} from '@app-icol/shared';
import { useAuth } from '../providers';

export interface OrdersRouteFilter {
  harvestLabel?: string;
  orderStatus?: OrderStatus;
  paymentStatus?: PaymentStatus;
  transferStatus?: TransferStatus;
  relay?: string;
  searchQuery?: string;
}

export type SaleFormReturnTarget = 'dashboard' | 'orders';

export type AppRoute =
  | { id: 'dashboard'; harvestLabel?: string }
  | { id: 'orders'; filters: OrdersRouteFilter }
  | {
      id: 'sale-form';
      mode: 'create';
      defaultHarvestLabel?: string;
      returnTo?: SaleFormReturnTarget;
    }
  | {
      id: 'sale-form';
      mode: 'edit';
      orderId: string;
      returnTo?: SaleFormReturnTarget;
    }
  | { id: 'harvests' }
  | { id: 'accounting'; year?: number };

export interface AppNavigation {
  route: AppRoute;
  navigateToDashboard: (params?: { harvestLabel?: string }) => void;
  navigateToOrders: (filters?: OrdersRouteFilter) => void;
  navigateToNewSale: (params?: {
    defaultHarvestLabel?: string;
    returnTo?: SaleFormReturnTarget;
  }) => void;
  navigateToEditSale: (
    orderId: string,
    params?: { returnTo?: SaleFormReturnTarget },
  ) => void;
  navigateToHarvests: () => void;
  navigateToAccounting: (params?: { year?: number }) => void;
  goBack: (fallback?: SaleFormReturnTarget) => void;
}

function parseReturnTo(raw: string | null): SaleFormReturnTarget | undefined {
  if (raw === 'dashboard' || raw === 'orders') {
    return raw;
  }
  return undefined;
}

export function parseHashRoute(rawHash: string): AppRoute {
  const withoutPound = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash;
  const qIdx = withoutPound.indexOf('?');
  const rawPath = qIdx === -1 ? withoutPound : withoutPound.slice(0, qIdx);
  const rawQuery = qIdx === -1 ? '' : withoutPound.slice(qIdx + 1);
  const normalizedPath = rawPath.replace(/^\/+|\/+$/g, '');
  const params = new URLSearchParams(rawQuery);

  if (!normalizedPath || normalizedPath === 'dashboard') {
    const harvest = params.get('harvest') ?? params.get('harvestLabel');
    return harvest?.trim()
      ? { id: 'dashboard', harvestLabel: harvest.trim() }
      : { id: 'dashboard' };
  }

  if (normalizedPath === 'orders') {
    const filters: OrdersRouteFilter = {};
    const harvest = params.get('harvest') ?? params.get('harvestLabel');
    if (harvest?.trim()) {
      filters.harvestLabel = harvest.trim();
    }
    const orderStatus = params.get('orderStatus');
    if (isOrderStatus(orderStatus)) {
      filters.orderStatus = orderStatus;
    }
    const paymentStatus = params.get('paymentStatus');
    if (isPaymentStatus(paymentStatus)) {
      filters.paymentStatus = paymentStatus;
    }
    const transferStatus = params.get('transferStatus');
    if (isTransferStatus(transferStatus)) {
      filters.transferStatus = transferStatus;
    }
    const relay = params.get('relay');
    if (relay?.trim()) {
      filters.relay = relay.trim();
    }
    const q = params.get('q') ?? params.get('searchQuery');
    if (q?.trim()) {
      filters.searchQuery = q.trim();
    }
    return { id: 'orders', filters };
  }

  if (normalizedPath === 'sale/new') {
    const harvest = params.get('harvest') ?? params.get('harvestLabel');
    const returnTo = parseReturnTo(params.get('returnTo'));
    return {
      id: 'sale-form',
      mode: 'create',
      ...(harvest?.trim() ? { defaultHarvestLabel: harvest.trim() } : {}),
      ...(returnTo ? { returnTo } : {}),
    };
  }

  if (normalizedPath.startsWith('sale/edit/')) {
    const rawId = normalizedPath.slice('sale/edit/'.length);
    let decodedId = rawId;
    try {
      decodedId = decodeURIComponent(rawId);
    } catch {
      decodedId = rawId;
    }
    const orderId = decodedId.trim();
    if (orderId) {
      const returnTo = parseReturnTo(params.get('returnTo'));
      return {
        id: 'sale-form',
        mode: 'edit',
        orderId,
        ...(returnTo ? { returnTo } : {}),
      };
    }
  }

  if (normalizedPath === 'harvests') {
    return { id: 'harvests' };
  }

  if (normalizedPath === 'accounting') {
    const rawYear = params.get('year');
    const parsedYear = rawYear ? Number(rawYear) : Number.NaN;
    return Number.isInteger(parsedYear) && parsedYear >= 1900 && parsedYear <= 2200
      ? { id: 'accounting', year: parsedYear }
      : { id: 'accounting' };
  }

  return { id: 'dashboard' };
}

export function buildRouteHash(route: AppRoute): string {
  switch (route.id) {
    case 'dashboard': {
      if (!route.harvestLabel?.trim()) return '#/dashboard';
      const p = new URLSearchParams({ harvest: route.harvestLabel.trim() });
      return `#/dashboard?${p.toString()}`;
    }
    case 'orders': {
      const p = new URLSearchParams();
      if (route.filters.harvestLabel?.trim()) {
        p.set('harvest', route.filters.harvestLabel.trim());
      }
      if (route.filters.orderStatus) {
        p.set('orderStatus', route.filters.orderStatus);
      }
      if (route.filters.paymentStatus) {
        p.set('paymentStatus', route.filters.paymentStatus);
      }
      if (route.filters.transferStatus) {
        p.set('transferStatus', route.filters.transferStatus);
      }
      if (route.filters.relay?.trim()) {
        p.set('relay', route.filters.relay.trim());
      }
      if (route.filters.searchQuery?.trim()) {
        p.set('q', route.filters.searchQuery.trim());
      }
      const qs = p.toString();
      return qs ? `#/orders?${qs}` : '#/orders';
    }
    case 'sale-form': {
      const p = new URLSearchParams();
      if (route.mode === 'create') {
        if (route.defaultHarvestLabel?.trim()) {
          p.set('harvest', route.defaultHarvestLabel.trim());
        }
        if (route.returnTo) {
          p.set('returnTo', route.returnTo);
        }
        const qs = p.toString();
        return qs ? `#/sale/new?${qs}` : '#/sale/new';
      }
      if (route.returnTo) {
        p.set('returnTo', route.returnTo);
      }
      const qs = p.toString();
      const encodedId = encodeURIComponent(route.orderId);
      return qs ? `#/sale/edit/${encodedId}?${qs}` : `#/sale/edit/${encodedId}`;
    }
    case 'harvests':
      return '#/harvests';
    case 'accounting': {
      if (route.year === undefined) return '#/accounting';
      const p = new URLSearchParams({ year: String(route.year) });
      return `#/accounting?${p.toString()}`;
    }
  }
}

const hashListeners = new Set<() => void>();

function notifyHashStore(): void {
  for (const listener of hashListeners) {
    listener();
  }
}

function subscribeToHash(onStoreChange: () => void): () => void {
  hashListeners.add(onStoreChange);
  const onNativeHashChange = (): void => {
    onStoreChange();
  };
  window.addEventListener('hashchange', onNativeHashChange);
  window.addEventListener('popstate', onNativeHashChange);
  return () => {
    hashListeners.delete(onStoreChange);
    window.removeEventListener('hashchange', onNativeHashChange);
    window.removeEventListener('popstate', onNativeHashChange);
  };
}

function getHashSnapshot(): string {
  return typeof window !== 'undefined' ? window.location.hash : '#/dashboard';
}

function pushRouteHash(targetHash: string): void {
  if (window.location.hash === targetHash) {
    notifyHashStore();
    return;
  }
  window.location.hash = targetHash;
  notifyHashStore();
}

function replaceRouteHash(targetHash: string): void {
  const nextUrl = `${window.location.pathname}${window.location.search}${targetHash}`;
  window.history.replaceState(window.history.state, '', nextUrl);
  notifyHashStore();
}

export function getRouteDocumentTitle(
  route: AppRoute,
  isAuthenticated: boolean,
): string {
  if (!isAuthenticated) {
    return 'Connexion — App-icol';
  }
  switch (route.id) {
    case 'dashboard':
      return 'Tableau de bord saison — App-icol';
    case 'orders':
      return 'Commandes & réservations — App-icol';
    case 'sale-form':
      return route.mode === 'edit'
        ? 'Modifier la commande — App-icol'
        : 'Nouvelle vente / réservation — App-icol';
    case 'harvests':
      return 'Suivi des récoltes & tarifs — App-icol';
    case 'accounting':
      return 'Comptabilité du rucher — App-icol';
  }
}

export function useAppNavigation(): AppNavigation {
  const { isAuthenticated, isContributor } = useAuth();
  const rawHash = useSyncExternalStore(
    subscribeToHash,
    getHashSnapshot,
    () => '#/dashboard',
  );

  const rawRoute = useMemo(() => parseHashRoute(rawHash), [rawHash]);
  const isForbiddenContributorRoute =
    isAuthenticated &&
    isContributor &&
    (rawRoute.id === 'harvests' || rawRoute.id === 'accounting');

  // Synchronous render guard so contributor never renders HarvestsPage or AccountingPage even for 1 frame
  const effectiveRoute: AppRoute = useMemo(
    () => (isForbiddenContributorRoute ? { id: 'dashboard' } : rawRoute),
    [isForbiddenContributorRoute, rawRoute],
  );

  useEffect(() => {
    if (isForbiddenContributorRoute) {
      replaceRouteHash('#/dashboard');
    }
  }, [isForbiddenContributorRoute]);

  useEffect(() => {
    document.title = getRouteDocumentTitle(effectiveRoute, isAuthenticated);
  }, [effectiveRoute, isAuthenticated]);

  const navigateToDashboard = useCallback(
    (params?: { harvestLabel?: string }) => {
      pushRouteHash(
        buildRouteHash({
          id: 'dashboard',
          harvestLabel: params?.harvestLabel,
        }),
      );
    },
    [],
  );

  const navigateToOrders = useCallback((filters: OrdersRouteFilter = {}) => {
    pushRouteHash(buildRouteHash({ id: 'orders', filters }));
  }, []);

  const navigateToNewSale = useCallback(
    (params?: {
      defaultHarvestLabel?: string;
      returnTo?: SaleFormReturnTarget;
    }) => {
      pushRouteHash(
        buildRouteHash({
          id: 'sale-form',
          mode: 'create',
          defaultHarvestLabel: params?.defaultHarvestLabel,
          returnTo: params?.returnTo,
        }),
      );
    },
    [],
  );

  const navigateToEditSale = useCallback(
    (orderId: string, params?: { returnTo?: SaleFormReturnTarget }) => {
      pushRouteHash(
        buildRouteHash({
          id: 'sale-form',
          mode: 'edit',
          orderId,
          returnTo: params?.returnTo,
        }),
      );
    },
    [],
  );

  const navigateToHarvests = useCallback(() => {
    if (isContributor) {
      pushRouteHash('#/dashboard');
      return;
    }
    pushRouteHash('#/harvests');
  }, [isContributor]);

  const navigateToAccounting = useCallback(
    (params?: { year?: number }) => {
      if (isContributor) {
        pushRouteHash('#/dashboard');
        return;
      }
      pushRouteHash(buildRouteHash({ id: 'accounting', year: params?.year }));
    },
    [isContributor],
  );

  const goBack = useCallback(
    (fallback: SaleFormReturnTarget = 'dashboard') => {
      if (effectiveRoute.id === 'sale-form' && effectiveRoute.returnTo) {
        pushRouteHash(
          effectiveRoute.returnTo === 'orders' ? '#/orders' : '#/dashboard',
        );
        return;
      }
      pushRouteHash(fallback === 'orders' ? '#/orders' : '#/dashboard');
    },
    [effectiveRoute],
  );

  return useMemo<AppNavigation>(
    () => ({
      route: effectiveRoute,
      navigateToDashboard,
      navigateToOrders,
      navigateToNewSale,
      navigateToEditSale,
      navigateToHarvests,
      navigateToAccounting,
      goBack,
    }),
    [
      effectiveRoute,
      navigateToDashboard,
      navigateToOrders,
      navigateToNewSale,
      navigateToEditSale,
      navigateToHarvests,
      navigateToAccounting,
      goBack,
    ],
  );
}
