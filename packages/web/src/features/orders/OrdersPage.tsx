import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  formatEuro,
  formatWeightKg,
  fromCents,
  fromGrams,
  matchesOrderSearch,
  normalizeHarvestLabel,
  normalizePhoneNumber,
  normalizeSearchText,
  stripInvisibleChars,
  toCents,
  toGrams,
  toPhoneSearchDigits,
  type JarFormat,
  type OrderStatusPatch,
  type SaleOrder,
} from '@app-icol/shared';
import { useAuth, useData, useToast } from '../../providers';
import {
  useAppNavigation,
  type OrdersRouteFilter,
} from '../../shell/navigation';
import {
  Button,
  FilterChip,
  SearchBar,
  StatusBadge,
  cx,
  toDomId,
} from '../../ui';
import { ExportVcfButton } from '../contacts/public';
import styles from './OrdersPage.module.css';

type PendingCardAction = 'distributed' | 'paid' | 'transferred';

const EMPTY_FILTERS: OrdersRouteFilter = {};

function formatOrderDateFr(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) return isoDate;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function buildTelHref(rawPhone: string): string | null {
  const cleaned = stripInvisibleChars(rawPhone).trim();
  if (!cleaned || !/\d/.test(cleaned)) {
    return null;
  }
  const normalized = normalizePhoneNumber(cleaned);
  const source = normalized || cleaned;
  const hasLeadingPlus = source.startsWith('+');
  const digits = source.replace(/\D/g, '');
  if (!digits) {
    return null;
  }
  return `tel:${hasLeadingPlus ? '+' : ''}${digits}`;
}

function matchesOrderQuery(order: SaleOrder, rawQuery: string): boolean {
  const trimmed = rawQuery.trim();
  if (!trimmed) return true;
  if (matchesOrderSearch(order, trimmed)) return true;

  // Support international 00CC phone queries (e.g. "0041 79") against "+41 79..." numbers
  if (/^00[1-9]/.test(trimmed)) {
    const withPlus = trimmed.replace(/^00\s*/, '+');
    const queryDigits = toPhoneSearchDigits(withPlus);
    if (queryDigits.length > 0) {
      const targetDigits = toPhoneSearchDigits(order.phone);
      if (targetDigits.includes(queryDigits)) {
        return true;
      }
    }
  }

  return false;
}

function generateClientRequestId(prefix: string): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeHarvestFilterParam(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const normalized = normalizeHarvestLabel(raw);
  if (!normalized || normalized.toUpperCase() === 'ALL') {
    return undefined;
  }
  return normalized;
}

export function OrdersPage(): React.JSX.Element {
  const { session, isContributor } = useAuth();
  const {
    orders,
    harvests,
    formats,
    relaySuggestions,
    defaultActiveHarvest,
    isLoading,
    loadError,
    refreshDataset,
    patchOrderStatuses,
  } = useData();
  const toast = useToast();
  const {
    route,
    navigateToOrders,
    navigateToNewSale,
    navigateToEditSale,
  } = useAppNavigation();

  const routeFilters: OrdersRouteFilter =
    route.id === 'orders' ? route.filters : EMPTY_FILTERS;

  const activeHarvestFilter = normalizeHarvestFilterParam(
    routeFilters.harvestLabel,
  );
  const activeRelayFilter = routeFilters.relay?.trim() || undefined;
  const activeOrderStatus = routeFilters.orderStatus;
  const activePaymentStatus = routeFilters.paymentStatus;
  const activeTransferStatus = routeFilters.transferStatus;
  const routeSearch = routeFilters.searchQuery ?? '';

  // Local input state preserves live spaces while typing, synced bidirectionally with URL hash `q`
  const [searchInput, setSearchInput] = useState<string>(routeSearch);
  const lastPushedSearchRef = useRef<string>(routeSearch);

  useEffect(() => {
    if (routeSearch !== lastPushedSearchRef.current) {
      lastPushedSearchRef.current = routeSearch;
      setSearchInput(routeSearch);
    }
  }, [routeSearch]);

  const effectiveSearchInput =
    routeSearch !== lastPushedSearchRef.current ? routeSearch : searchInput;

  const [pendingByOrderId, setPendingByOrderId] = useState<
    Record<string, PendingCardAction>
  >({});
  const inFlightIdsRef = useRef<Set<string>>(new Set());
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const formatMap = useMemo<Map<string, JarFormat>>(
    () => new Map(formats.map((f) => [f.code, f])),
    [formats],
  );

  // Stable newest-first sort by calendar date (avoids jumping same-day cards on 1-click status updates)
  const sortedOrders = useMemo<SaleOrder[]>(
    () => [...orders].sort((a, b) => b.date.localeCompare(a.date)),
    [orders],
  );

  // Available harvest options (active default first, then descending year, plus any legacy order labels)
  const harvestOptions = useMemo<string[]>(() => {
    const orderedHarvests = [...harvests].sort((a, b) => {
      if (a.isDefaultActive !== b.isDefaultActive) {
        return a.isDefaultActive ? -1 : 1;
      }
      if (b.year !== a.year) {
        return b.year - a.year;
      }
      return a.label.localeCompare(b.label, 'fr');
    });

    const seen = new Set<string>();
    const labels: string[] = [];

    for (const h of orderedHarvests) {
      const clean = normalizeHarvestLabel(h.label);
      const key = normalizeSearchText(clean);
      if (clean && !seen.has(key)) {
        seen.add(key);
        labels.push(clean);
      }
    }

    for (const o of sortedOrders) {
      const clean = normalizeHarvestLabel(o.harvestLabel);
      const key = normalizeSearchText(clean);
      if (clean && !seen.has(key)) {
        seen.add(key);
        labels.push(clean);
      }
    }

    if (activeHarvestFilter) {
      const activeKey = normalizeSearchText(activeHarvestFilter);
      if (!seen.has(activeKey)) {
        labels.push(activeHarvestFilter);
      }
    }

    return labels;
  }, [harvests, sortedOrders, activeHarvestFilter]);

  const selectedHarvestValue = useMemo<string>(() => {
    if (!activeHarvestFilter) return '';
    const activeKey = normalizeSearchText(activeHarvestFilter);
    return (
      harvestOptions.find((opt) => normalizeSearchText(opt) === activeKey) ??
      activeHarvestFilter
    );
  }, [activeHarvestFilter, harvestOptions]);

  // Available relay options from DataProvider directory + active route filter fallback
  const relayOptions = useMemo<string[]>(() => {
    const list = [...relaySuggestions];
    if (activeRelayFilter) {
      const activeKey = normalizeSearchText(activeRelayFilter);
      const exists = list.some(
        (item) => normalizeSearchText(item) === activeKey,
      );
      if (!exists) {
        list.push(activeRelayFilter);
      }
    }
    return list;
  }, [relaySuggestions, activeRelayFilter]);

  const selectedRelayValue = useMemo<string>(() => {
    if (!activeRelayFilter) return '';
    const activeKey = normalizeSearchText(activeRelayFilter);
    return (
      relayOptions.find((opt) => normalizeSearchText(opt) === activeKey) ??
      activeRelayFilter
    );
  }, [activeRelayFilter, relayOptions]);

  // Base predicate for search + harvest + relay (shared across faceted chip counters and list)
  const matchesContextAndSearch = useCallback(
    (order: SaleOrder): boolean => {
      if (activeHarvestFilter) {
        if (
          normalizeSearchText(normalizeHarvestLabel(order.harvestLabel)) !==
          normalizeSearchText(activeHarvestFilter)
        ) {
          return false;
        }
      }
      if (activeRelayFilter) {
        if (
          normalizeSearchText(order.contextOrRelay) !==
          normalizeSearchText(activeRelayFilter)
        ) {
          return false;
        }
      }
      return matchesOrderQuery(order, effectiveSearchInput);
    },
    [activeHarvestFilter, activeRelayFilter, effectiveSearchInput],
  );

  // Faceted badge counts: each chip reflects matching orders given all OTHER active filters
  const chipCounts = useMemo(() => {
    let reserved = 0;
    let unpaid = 0;
    let pendingTransfer = 0;

    for (const order of sortedOrders) {
      if (!matchesContextAndSearch(order)) {
        continue;
      }

      const matchesPayment =
        !activePaymentStatus || order.paymentStatus === activePaymentStatus;
      const matchesTransfer =
        !activeTransferStatus || order.transferStatus === activeTransferStatus;
      const matchesOrder =
        !activeOrderStatus || order.orderStatus === activeOrderStatus;

      if (order.orderStatus === 'Réservé' && matchesPayment && matchesTransfer) {
        reserved += 1;
      }
      if (order.paymentStatus === 'Non-payé' && matchesOrder && matchesTransfer) {
        unpaid += 1;
      }
      if (
        order.transferStatus === 'À reverser' &&
        matchesOrder &&
        matchesPayment
      ) {
        pendingTransfer += 1;
      }
    }

    return { reserved, unpaid, pendingTransfer };
  }, [
    sortedOrders,
    matchesContextAndSearch,
    activeOrderStatus,
    activePaymentStatus,
    activeTransferStatus,
  ]);

  const filteredOrders = useMemo<SaleOrder[]>(() => {
    return sortedOrders.filter((order) => {
      // Keep an order visible while its 1-click mutation is in flight so spinner & rollback stay smooth
      if (pendingByOrderId[order.id]) {
        return matchesContextAndSearch(order);
      }
      if (!matchesContextAndSearch(order)) {
        return false;
      }
      if (activeOrderStatus && order.orderStatus !== activeOrderStatus) {
        return false;
      }
      if (activePaymentStatus && order.paymentStatus !== activePaymentStatus) {
        return false;
      }
      if (
        activeTransferStatus &&
        order.transferStatus !== activeTransferStatus
      ) {
        return false;
      }
      return true;
    });
  }, [
    sortedOrders,
    matchesContextAndSearch,
    activeOrderStatus,
    activePaymentStatus,
    activeTransferStatus,
    pendingByOrderId,
  ]);

  const filteredTotals = useMemo(() => {
    let grams = 0;
    let cents = 0;
    for (const order of filteredOrders) {
      grams += toGrams(order.computedWeightKg);
      cents += toCents(order.effectiveAmountEur);
    }
    return {
      weightKg: fromGrams(grams),
      amountEur: fromCents(cents),
    };
  }, [filteredOrders]);

  const hasActiveFilters = Boolean(
    effectiveSearchInput.trim() ||
      activeHarvestFilter ||
      activeRelayFilter ||
      activeOrderStatus ||
      activePaymentStatus ||
      activeTransferStatus,
  );

  const buildCurrentFilters = useCallback(
    (overrides: Partial<OrdersRouteFilter>): OrdersRouteFilter => {
      const merged: OrdersRouteFilter = {
        harvestLabel: activeHarvestFilter,
        relay: activeRelayFilter,
        orderStatus: activeOrderStatus,
        paymentStatus: activePaymentStatus,
        transferStatus: activeTransferStatus,
        searchQuery: effectiveSearchInput.trim() || undefined,
        ...overrides,
      };
      const cleaned: OrdersRouteFilter = {};
      if (merged.harvestLabel?.trim()) {
        cleaned.harvestLabel = merged.harvestLabel.trim();
      }
      if (merged.orderStatus) {
        cleaned.orderStatus = merged.orderStatus;
      }
      if (merged.paymentStatus) {
        cleaned.paymentStatus = merged.paymentStatus;
      }
      if (merged.transferStatus) {
        cleaned.transferStatus = merged.transferStatus;
      }
      if (merged.relay?.trim()) {
        cleaned.relay = merged.relay.trim();
      }
      if (merged.searchQuery?.trim()) {
        cleaned.searchQuery = merged.searchQuery.trim();
      }
      return cleaned;
    },
    [
      activeHarvestFilter,
      activeRelayFilter,
      activeOrderStatus,
      activePaymentStatus,
      activeTransferStatus,
      effectiveSearchInput,
    ],
  );

  const handleSearchChange = useCallback(
    (nextValue: string) => {
      const trimmed = nextValue.trim();
      lastPushedSearchRef.current = trimmed;
      setSearchInput(nextValue);
      navigateToOrders(
        buildCurrentFilters({ searchQuery: trimmed || undefined }),
      );
    },
    [buildCurrentFilters, navigateToOrders],
  );

  const handleToggleReserved = useCallback(() => {
    navigateToOrders(
      buildCurrentFilters({
        orderStatus: activeOrderStatus === 'Réservé' ? undefined : 'Réservé',
      }),
    );
  }, [activeOrderStatus, buildCurrentFilters, navigateToOrders]);

  const handleToggleUnpaid = useCallback(() => {
    navigateToOrders(
      buildCurrentFilters({
        paymentStatus:
          activePaymentStatus === 'Non-payé' ? undefined : 'Non-payé',
      }),
    );
  }, [activePaymentStatus, buildCurrentFilters, navigateToOrders]);

  const handleTogglePendingTransfer = useCallback(() => {
    navigateToOrders(
      buildCurrentFilters({
        transferStatus:
          activeTransferStatus === 'À reverser' ? undefined : 'À reverser',
      }),
    );
  }, [activeTransferStatus, buildCurrentFilters, navigateToOrders]);

  const handleHarvestSelectChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const raw = event.target.value;
      navigateToOrders(
        buildCurrentFilters({
          harvestLabel: normalizeHarvestFilterParam(raw),
        }),
      );
    },
    [buildCurrentFilters, navigateToOrders],
  );

  const handleRelaySelectChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const raw = event.target.value.trim();
      navigateToOrders(
        buildCurrentFilters({
          relay: raw || undefined,
        }),
      );
    },
    [buildCurrentFilters, navigateToOrders],
  );

  const handleClearAllFilters = useCallback(() => {
    lastPushedSearchRef.current = '';
    setSearchInput('');
    navigateToOrders({});
  }, [navigateToOrders]);

  const runQuickAction = useCallback(
    async (
      order: SaleOrder,
      actionKind: PendingCardAction,
      patch: OrderStatusPatch,
      buildSuccessMessage: (saved: SaleOrder) => {
        title: string;
        description: string;
      },
    ) => {
      if (inFlightIdsRef.current.has(order.id)) {
        return;
      }
      inFlightIdsRef.current.add(order.id);
      setPendingByOrderId((prev) => ({ ...prev, [order.id]: actionKind }));

      try {
        const saved = await patchOrderStatuses(order.id, patch, {
          clientRequestId: generateClientRequestId(`orders-${actionKind}`),
        });
        inFlightIdsRef.current.delete(order.id);
        if (isMountedRef.current) {
          setPendingByOrderId((prev) => {
            const next = { ...prev };
            delete next[order.id];
            return next;
          });
        }
        const msg = buildSuccessMessage(saved);
        toast.success(msg.title, msg.description);
      } catch (err) {
        inFlightIdsRef.current.delete(order.id);
        if (isMountedRef.current) {
          setPendingByOrderId((prev) => {
            const next = { ...prev };
            delete next[order.id];
            return next;
          });
        }
        toast.error(
          'Échec de la mise à jour',
          err instanceof Error
            ? err.message
            : 'Erreur réseau — le statut précédent a été restauré.',
        );
      }
    },
    [patchOrderStatuses, toast],
  );

  const handleMarkDistributed = useCallback(
    (order: SaleOrder) => {
      void runQuickAction(
        order,
        'distributed',
        { orderStatus: 'Distribué' },
        () => ({
          title: 'Commande distribuée',
          description: `${order.customerName} — remise au client enregistrée.`,
        }),
      );
    },
    [runQuickAction],
  );

  const handleMarkPaid = useCallback(
    (order: SaleOrder) => {
      // Rule #4: If active user is a contributor, third-party collection & 'À reverser' auto-activate
      const patch: OrderStatusPatch = isContributor
        ? {
            paymentStatus: 'Payé',
            collectedByThirdParty: true,
            collectorName:
              order.collectorName.trim() ||
              session?.displayName?.trim() ||
              'Co-vendeur',
            transferStatus: 'À reverser',
          }
        : {
            paymentStatus: 'Payé',
          };

      void runQuickAction(order, 'paid', patch, (saved) => ({
        title: 'Paiement enregistré',
        description:
          saved.transferStatus === 'À reverser'
            ? `${order.customerName} — ${formatEuro(saved.effectiveAmountEur)} encaissés (à reverser).`
            : `${order.customerName} — ${formatEuro(saved.effectiveAmountEur)} encaissés.`,
      }));
    },
    [isContributor, session?.displayName, runQuickAction],
  );

  const handleMarkTransferred = useCallback(
    (order: SaleOrder) => {
      void runQuickAction(
        order,
        'transferred',
        { transferStatus: 'Reversé' },
        (saved) => ({
          title: 'Reversement confirmé',
          description: `${order.customerName} — ${formatEuro(saved.effectiveAmountEur)} reversés au rucher.`,
        }),
      );
    },
    [runQuickAction],
  );

  return (
    <section
      data-testid="orders-page"
      aria-labelledby="page-title-orders"
      className={styles.pageSection}
    >
      <div className={styles.pageTopRow}>
        <div className={styles.titleGroup}>
          <h1 id="page-title-orders">Commandes &amp; réservations</h1>
          <p className={styles.pageSubtitle}>
            Suivi des retraits, encaissements et reversements co-vendeurs
          </p>
        </div>
        <Button
          variant="primary"
          size="compact"
          id="btn-orders-new-sale"
          onClick={() =>
            navigateToNewSale({
              defaultHarvestLabel:
                activeHarvestFilter ?? defaultActiveHarvest?.label,
              returnTo: 'orders',
            })
          }
        >
          + Nouvelle vente
        </Button>
      </div>

      <div
        className={styles.controlsPanel}
        role="search"
        aria-label="Recherche et filtres des commandes"
      >
        <SearchBar
          label="Rechercher une commande par client, lieu ou téléphone"
          placeholder="Client, lieu/relais ou n° tél (0612, +336...)"
          value={effectiveSearchInput}
          onChange={handleSearchChange}
          data-testid="orders-search-input"
        />

        <div
          className={styles.chipsRow}
          role="group"
          aria-label="Filtres rapides par statut"
        >
          <FilterChip
            label="À livrer (Réservé)"
            active={activeOrderStatus === 'Réservé'}
            count={chipCounts.reserved}
            onClick={handleToggleReserved}
            data-testid="filter-reserved"
            className={styles.chipItem}
          />
          <FilterChip
            label="À encaisser (Non-payé)"
            active={activePaymentStatus === 'Non-payé'}
            count={chipCounts.unpaid}
            onClick={handleToggleUnpaid}
            data-testid="filter-unpaid"
            className={styles.chipItem}
          />
          <FilterChip
            label="À reverser (Tiers)"
            active={activeTransferStatus === 'À reverser'}
            count={chipCounts.pendingTransfer}
            onClick={handleTogglePendingTransfer}
            data-testid="filter-pending-transfer"
            className={styles.chipItem}
          />
        </div>

        <div className={styles.selectsRow}>
          <div className={styles.selectField}>
            <label
              htmlFor="id-filter-harvest-select"
              className={styles.selectLabel}
            >
              Récolte
            </label>
            <select
              id="id-filter-harvest-select"
              data-testid="filter-harvest-select"
              value={selectedHarvestValue}
              onChange={handleHarvestSelectChange}
              className={cx(
                styles.selectControl,
                Boolean(selectedHarvestValue) && styles.selectControlActive,
              )}
            >
              <option value="">Toutes les récoltes</option>
              {harvestOptions.map((harvestLabel) => (
                <option key={harvestLabel} value={harvestLabel}>
                  {harvestLabel}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.selectField}>
            <label
              htmlFor="id-filter-relay-select"
              className={styles.selectLabel}
            >
              Lieu / Relais
            </label>
            <select
              id="id-filter-relay-select"
              data-testid="filter-relay-select"
              value={selectedRelayValue}
              onChange={handleRelaySelectChange}
              className={cx(
                styles.selectControl,
                Boolean(selectedRelayValue) && styles.selectControlActive,
              )}
            >
              <option value="">Tous les lieux / relais</option>
              {relayOptions.map((relay) => (
                <option key={relay} value={relay}>
                  {relay}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            id="id-filter-clear-all"
            data-testid="filter-clear-all"
            onClick={handleClearAllFilters}
            className={cx(
              styles.clearBtn,
              hasActiveFilters && styles.clearBtnActive,
            )}
          >
            Tout effacer
          </button>
        </div>
      </div>

      <div className={styles.resultsSummary} aria-live="polite">
        <span>
          <strong className={cx(styles.resultsCount, 'tabular-nums')}>
            {filteredOrders.length}
          </strong>{' '}
          {filteredOrders.length <= 1 ? 'commande' : 'commandes'}
          {hasActiveFilters && orders.length > 0 && (
            <>
              {' '}
              sur <span className="tabular-nums">{orders.length}</span>
            </>
          )}
        </span>
        {filteredOrders.length > 0 && (
          <span className={cx(styles.resultsTotals, 'tabular-nums')}>
            <span>{formatWeightKg(filteredTotals.weightKg)}</span>
            <span className={styles.totalsDot} aria-hidden="true">
              ·
            </span>
            <span>{formatEuro(filteredTotals.amountEur)}</span>
          </span>
        )}
      </div>

      {loadError && orders.length === 0 ? (
        <div
          className={cx(styles.stateCard, styles.errorStateCard)}
          role="alert"
        >
          <h2 className={styles.stateTitle}>Chargement indisponible</h2>
          <p className={styles.stateText}>{loadError}</p>
          <Button
            variant="secondary"
            size="compact"
            id="btn-orders-retry-load"
            onClick={() => {
              void refreshDataset();
            }}
          >
            Réessayer
          </Button>
        </div>
      ) : isLoading && orders.length === 0 ? (
        <div className={styles.stateCard} aria-busy="true">
          <p className={styles.stateText}>Chargement des commandes…</p>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className={styles.stateCard}>
          <h2 className={styles.stateTitle}>
            {orders.length === 0
              ? 'Aucune commande enregistrée'
              : 'Aucune commande correspondante'}
          </h2>
          <p className={styles.stateText}>
            {orders.length === 0
              ? 'Créez votre première vente ou réservation pour la retrouver ici.'
              : 'Modifiez votre recherche ou réinitialisez les filtres actifs.'}
          </p>
          {orders.length === 0 && (
            <Button
              variant="primary"
              size="compact"
              id="btn-orders-empty-create"
              onClick={() => navigateToNewSale({ returnTo: 'orders' })}
            >
              Saisir une vente
            </Button>
          )}
        </div>
      ) : (
        <div className={styles.ordersList}>
          {filteredOrders.map((order) => {
            const pendingAction = pendingByOrderId[order.id];
            const isCardMutating = Boolean(pendingAction);
            const safeOrderDomId = toDomId(order.id);
            const telHref = buildTelHref(order.phone);
            const displayPhone =
              normalizePhoneNumber(order.phone) || order.phone.trim();

            const isDonated = order.paymentStatus === 'Donné';
            const showMarkDistributed =
              order.orderStatus === 'Réservé' ||
              pendingAction === 'distributed';
            const showMarkPaid =
              order.paymentStatus === 'Non-payé' || pendingAction === 'paid';
            const showMarkTransferred =
              order.transferStatus === 'À reverser' ||
              pendingAction === 'transferred';

            const cardAccentClass =
              order.orderStatus === 'Réservé'
                ? styles.orderCardReserved
                : order.paymentStatus === 'Non-payé'
                  ? styles.orderCardUnpaid
                  : order.transferStatus === 'À reverser'
                    ? styles.orderCardPendingTransfer
                    : isDonated
                      ? styles.orderCardDonated
                      : styles.orderCardSettled;

            return (
              <article
                key={order.id}
                data-testid="order-card"
                data-order-id={order.id}
                aria-busy={isCardMutating ? 'true' : undefined}
                className={cx(
                  styles.orderCard,
                  cardAccentClass,
                  isCardMutating && styles.orderCardMutating,
                )}
              >
                <div className={styles.cardTopRow}>
                  <div className={styles.customerIdentity}>
                    <h2 className={styles.customerName}>
                      {order.customerName}
                    </h2>
                    <div className={styles.metaLine}>
                      <time
                        dateTime={order.date}
                        className={cx(styles.metaDate, 'tabular-nums')}
                      >
                        {formatOrderDateFr(order.date)}
                      </time>
                      <span className={styles.harvestPill}>
                        {order.harvestLabel}
                      </span>
                      {order.contextOrRelay.trim() && (
                        <span className={styles.relayPill}>
                          Lieu : {order.contextOrRelay.trim()}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className={styles.amountBlock}>
                    <span className={cx(styles.effectiveAmount, 'tabular-nums')}>
                      {formatEuro(order.effectiveAmountEur)}
                    </span>
                    {isDonated ? (
                      <span className={styles.donatedTag}>
                        Offert / Donné
                      </span>
                    ) : (
                      order.manualAmountOverrideEur !== null && (
                        <span className={styles.overrideHint}>
                          Tarif ajusté
                        </span>
                      )
                    )}
                    <span className={cx(styles.weightText, 'tabular-nums')}>
                      {formatWeightKg(order.computedWeightKg)}
                    </span>
                  </div>
                </div>

                <div className={styles.statusesRow}>
                  <StatusBadge status={order.orderStatus} />
                  <StatusBadge status={order.paymentStatus} />
                  <StatusBadge
                    status={order.transferStatus}
                    hideIfNeutral
                  />
                  {order.collectedByThirdParty &&
                    order.collectorName.trim() && (
                      <span className={styles.collectorBadge}>
                        Tiers : {order.collectorName.trim()}
                      </span>
                    )}
                </div>

                <div className={styles.detailsRow}>
                  <div className={styles.jarsList}>
                    {order.items.map((item) => {
                      const fmtLabel =
                        formatMap.get(item.formatCode)?.label ??
                        item.formatCode;
                      return (
                        <span
                          key={item.formatCode}
                          className={cx(styles.jarPill, 'tabular-nums')}
                        >
                          {item.quantity} × {fmtLabel}
                        </span>
                      );
                    })}
                  </div>

                  {telHref ? (
                    <a
                      href={telHref}
                      data-testid="order-tel-link"
                      aria-label={`Appeler ${order.customerName} au ${displayPhone}`}
                      className={cx(styles.telLink, 'tabular-nums')}
                    >
                      <span aria-hidden="true">📞</span>
                      <span>{displayPhone}</span>
                    </a>
                  ) : (
                    displayPhone && (
                      <span className={styles.phonePlainText}>
                        {displayPhone}
                      </span>
                    )
                  )}
                </div>

                {order.notes?.trim() && (
                  <p className={styles.notesLine}>{order.notes.trim()}</p>
                )}

                <div className={styles.actionsBar}>
                  <div className={styles.quickTransitions}>
                    {showMarkDistributed && (
                      <Button
                        variant="primary"
                        size="compact"
                        id={`btn-dist-${safeOrderDomId}`}
                        data-testid="action-mark-distributed"
                        isLoading={pendingAction === 'distributed'}
                        disabled={isCardMutating}
                        onClick={() => handleMarkDistributed(order)}
                      >
                        Passer à Distribué
                      </Button>
                    )}

                    {showMarkPaid && (
                      <Button
                        variant="success"
                        size="compact"
                        id={`btn-paid-${safeOrderDomId}`}
                        data-testid="action-mark-paid"
                        isLoading={pendingAction === 'paid'}
                        disabled={isCardMutating}
                        onClick={() => handleMarkPaid(order)}
                      >
                        Passer à Payé
                      </Button>
                    )}

                    {showMarkTransferred && (
                      <Button
                        variant="secondary"
                        size="compact"
                        id={`btn-trans-${safeOrderDomId}`}
                        data-testid="action-mark-transferred"
                        isLoading={pendingAction === 'transferred'}
                        disabled={isCardMutating}
                        onClick={() => handleMarkTransferred(order)}
                      >
                        Marquer Reversé
                      </Button>
                    )}
                  </div>

                  <div className={styles.utilityActions}>
                    <ExportVcfButton
                      contact={{
                        fullName: order.customerName,
                        phone: order.phone,
                        contextOrRelay:
                          order.contextOrRelay.trim() || undefined,
                        notes: order.notes,
                      }}
                      variant="compact"
                      disabled={isCardMutating}
                      data-testid="export-vcf-btn"
                    />
                    <Button
                      variant="secondary"
                      size="compact"
                      id={`btn-edit-${safeOrderDomId}`}
                      data-testid="action-edit-order"
                      disabled={isCardMutating}
                      onClick={() =>
                        navigateToEditSale(order.id, { returnTo: 'orders' })
                      }
                    >
                      Modifier
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default OrdersPage;
