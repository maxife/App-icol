import React, { useMemo } from 'react';
import {
  computeHarvestDashboardMetrics,
  formatEuro,
  formatWeightKg,
  normalizeHarvestLabel,
} from '@app-icol/shared';
import { useData } from '../../providers';
import { useAppNavigation } from '../../shell/navigation';
import { Button, MetricCard, StatusBadge, cx } from '../../ui';
import styles from './DashboardPage.module.css';

export function DashboardPage(): React.JSX.Element {
  const {
    defaultActiveHarvest,
    harvests,
    orders,
    formats,
    loadError,
    refreshDataset,
  } = useData();
  const {
    route,
    navigateToDashboard,
    navigateToOrders,
    navigateToNewSale,
  } = useAppNavigation();

  const selectedHarvestLabel = useMemo<string>(() => {
    const rawRouteHarvest =
      route.id === 'dashboard' ? route.harvestLabel?.trim() : undefined;

    if (rawRouteHarvest) {
      if (rawRouteHarvest.toUpperCase() === 'ALL') {
        return 'ALL';
      }
      const normalizedTarget = normalizeHarvestLabel(rawRouteHarvest);
      const matched = harvests.find(
        (h) =>
          normalizeHarvestLabel(h.label) === normalizedTarget ||
          h.id === rawRouteHarvest,
      );
      if (matched) {
        return matched.label;
      }
    }

    return defaultActiveHarvest?.label ?? 'ALL';
  }, [route, harvests, defaultActiveHarvest]);

  const isAllHarvests = selectedHarvestLabel === 'ALL';

  const selectedHarvest = useMemo(
    () =>
      isAllHarvests
        ? null
        : (harvests.find(
            (h) =>
              normalizeHarvestLabel(h.label) ===
              normalizeHarvestLabel(selectedHarvestLabel),
          ) ?? null),
    [isAllHarvests, harvests, selectedHarvestLabel],
  );

  const metrics = useMemo(
    () =>
      computeHarvestDashboardMetrics(
        isAllHarvests ? 'ALL' : (selectedHarvest ?? selectedHarvestLabel),
        orders,
        harvests,
        formats,
      ),
    [isAllHarvests, selectedHarvest, selectedHarvestLabel, orders, harvests, formats],
  );

  const handleHarvestSelectChange = (
    event: React.ChangeEvent<HTMLSelectElement>,
  ): void => {
    navigateToDashboard({ harvestLabel: event.target.value });
  };

  const handleNewSaleClick = (): void => {
    navigateToNewSale({
      ...(!isAllHarvests ? { defaultHarvestLabel: selectedHarvestLabel } : {}),
      returnTo: 'dashboard',
    });
  };

  const handlePendingTransfersClick = (): void => {
    navigateToOrders({
      transferStatus: 'À reverser',
      ...(!isAllHarvests ? { harvestLabel: selectedHarvestLabel } : {}),
    });
  };

  const handlePendingDeliveriesClick = (): void => {
    navigateToOrders({
      orderStatus: 'Réservé',
      ...(!isAllHarvests ? { harvestLabel: selectedHarvestLabel } : {}),
    });
  };

  const hasPendingTransfers =
    metrics.pendingTransferOrdersCount > 0 ||
    metrics.pendingTransferAmountEur > 0;
  const hasPendingDeliveries = metrics.pendingDeliveryOrdersCount > 0;
  const isFullyCommitted =
    !metrics.isOverbooked &&
    metrics.harvestedOrForecastKg > 0 &&
    metrics.availableWeightKg === 0;

  const scopeSubtitle = isAllHarvests
    ? `Vue consolidée (${harvests.length} ${harvests.length > 1 ? 'récoltes' : 'récolte'}) · ${metrics.totalOrdersCount} ${metrics.totalOrdersCount > 1 ? 'commandes' : 'commande'}`
    : `${selectedHarvest?.isDefaultActive ? 'Récolte active par défaut' : `Millésime ${selectedHarvest?.year ?? ''}`.trim()} · ${metrics.totalOrdersCount} ${metrics.totalOrdersCount > 1 ? 'commandes' : 'commande'}`;

  return (
    <section
      id="section-dashboard-page"
      data-testid="dashboard-page"
      aria-labelledby="page-title-dashboard"
      className={styles.pageSection}
    >
      <div className={styles.heroHeader}>
        <div className={styles.titleRow}>
          <div>
            <h1 id="page-title-dashboard">Tableau de bord saison</h1>
            <p className={styles.subtitle}>{scopeSubtitle}</p>
          </div>
        </div>

        <div className={styles.controlsBar}>
          <div className={styles.selectorField}>
            <label
              htmlFor="dashboard-harvest-select"
              className={styles.selectorLabel}
            >
              Récolte affichée
            </label>
            <div className={styles.selectWrapper}>
              <select
                id="dashboard-harvest-select"
                data-testid="dashboard-harvest-select"
                value={selectedHarvestLabel}
                onChange={handleHarvestSelectChange}
                className={styles.harvestSelect}
              >
                <option value="ALL">Toutes les récoltes</option>
                {harvests.map((harvest) => (
                  <option key={harvest.id} value={harvest.label}>
                    {harvest.label}
                  </option>
                ))}
              </select>
              <svg
                className={styles.selectChevron}
                viewBox="0 0 20 20"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M5 7.5L10 12.5L15 7.5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>

          <Button
            id="btn-dashboard-new-sale-cta"
            variant="primary"
            size="lg"
            data-testid="dashboard-new-sale-cta"
            onClick={handleNewSaleClick}
            className={styles.ctaButton}
          >
            + Nouvelle vente
          </Button>
        </div>
      </div>

      {loadError && (
        <div role="alert" className={styles.errorBanner}>
          <span>{loadError}</span>
          <Button
            id="btn-dashboard-retry-load"
            variant="secondary"
            size="md"
            onClick={() => {
              void refreshDataset();
            }}
          >
            Réessayer
          </Button>
        </div>
      )}

      {/* === Volume & Stock Section === */}
      <section
        aria-labelledby="section-stock-title"
        className={styles.sectionBlock}
      >
        <div className={styles.sectionHeader}>
          <h2 id="section-stock-title" className={styles.sectionTitle}>
            Stock &amp; volume de miel
          </h2>
          {metrics.usesForecastFallback ? (
            <StatusBadge
              status="Prévisionnel"
              label={isAllHarvests ? 'Inclut prévisionnel' : 'Prévisionnel'}
              data-testid="kpi-forecast-badge"
            />
          ) : (
            <StatusBadge status="Réalisé" label="Récolte réalisée" />
          )}
        </div>

        <div
          className={cx(
            styles.stockPanel,
            metrics.isOverbooked && styles.stockPanelOverbooked,
          )}
        >
          <div className={styles.availableHeroRow}>
            <div className={styles.availableBlock}>
              <span className={styles.metricLabel}>
                Stock disponible estimé
              </span>
              <div
                id="val-kpi-available-kg"
                data-testid="kpi-available-kg"
                className={cx(
                  styles.availableValue,
                  'tabular-nums',
                  metrics.isOverbooked && styles.availableValueNegative,
                )}
              >
                {formatWeightKg(metrics.availableWeightKg)}
              </div>
            </div>
          </div>

          {metrics.isOverbooked && (
            <div
              role="alert"
              data-testid="kpi-overbooked-alert"
              className={styles.overbookedAlert}
            >
              Sur-réservation de{' '}
              <strong className="tabular-nums">
                {formatWeightKg(Math.abs(metrics.availableWeightKg))}
              </strong>{' '}
              : le volume engagé dépasse le poids{' '}
              {metrics.usesForecastFallback ? 'prévisionnel' : 'réalisé'} de la
              récolte.
            </div>
          )}

          <div className={styles.gaugeContainer}>
            <div
              role="progressbar"
              aria-label="Progression du stock engagé"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(metrics.gaugePercent)}
              className={styles.gaugeTrack}
            >
              <div
                className={cx(
                  styles.gaugeFill,
                  isFullyCommitted && styles.gaugeFillComplete,
                  metrics.isOverbooked && styles.gaugeFillOverbooked,
                )}
                style={{ width: `${metrics.gaugePercent}%` }}
              />
            </div>

            <div className={styles.volumeBreakdownGrid}>
              <div className={styles.volumeStatBox}>
                <span className={styles.volumeStatLabel}>Poids engagé</span>
                <div
                  id="val-kpi-committed-kg"
                  data-testid="kpi-committed-kg"
                  className={cx(styles.volumeStatValue, 'tabular-nums')}
                >
                  {formatWeightKg(metrics.committedWeightKg)}
                </div>
                <span className={styles.volumeStatMeta}>
                  Réservé + Distribué (dons inclus)
                </span>
              </div>

              <div className={styles.volumeStatBox}>
                <span className={styles.volumeStatLabel}>
                  {metrics.usesForecastFallback
                    ? 'Poids de référence (prévision)'
                    : 'Poids récolté (réalisé)'}
                </span>
                <div
                  id="val-kpi-harvested-kg"
                  data-testid="kpi-harvested-kg"
                  className={cx(styles.volumeStatValue, 'tabular-nums')}
                >
                  {formatWeightKg(metrics.harvestedOrForecastKg)}
                </div>
                <span className={styles.volumeStatMeta}>
                  {metrics.usesForecastFallback
                    ? 'Basé sur estimation avant récolte'
                    : 'Extraction pesée définitive'}
                </span>
              </div>
            </div>
          </div>

          {metrics.jarEquivalents.length > 0 && (
            <div className={styles.jarEquivalentsBox}>
              <span className={styles.jarEquivalentsTitle}>
                Équivalent disponible en pots
              </span>
              <ul
                className={styles.jarPillList}
                aria-label="Équivalents en pots disponibles"
              >
                {metrics.jarEquivalents.map((eq) => (
                  <li
                    key={eq.formatCode}
                    className={cx(
                      styles.jarPill,
                      eq.availableJarsCount === 0 && styles.jarPillEmpty,
                    )}
                  >
                    <strong className={cx(styles.jarPillCount, 'tabular-nums')}>
                      {eq.availableJarsCount}
                    </strong>{' '}
                    <span className={styles.jarPillLabel}>× {eq.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {/* === Financial Section === */}
      <section
        aria-labelledby="section-finance-title"
        className={styles.sectionBlock}
      >
        <div className={styles.sectionHeader}>
          <h2 id="section-finance-title" className={styles.sectionTitle}>
            Suivi financier
          </h2>
        </div>

        <div className={styles.financialGrid}>
          <MetricCard
            id="card-kpi-paid-eur"
            label="Encaissé (Payé)"
            value={formatEuro(metrics.paidAmountEur)}
            valueTestId="kpi-paid-eur"
            tone="success"
            badge={<StatusBadge status="Payé" />}
            hint="Chiffre d'affaires réglé"
          />

          <MetricCard
            id="card-kpi-unpaid-eur"
            label="Reste à encaisser"
            value={formatEuro(metrics.unpaidAmountEur)}
            valueTestId="kpi-unpaid-eur"
            tone={metrics.unpaidAmountEur > 0 ? 'danger' : 'default'}
            badge={<StatusBadge status="Non-payé" />}
            hint={
              metrics.unpaidAmountEur > 0
                ? 'Commandes en attente de règlement'
                : 'Aucun impayé en cours'
            }
          />
        </div>

        <aside
          id="callout-kpi-donated-summary"
          data-testid="kpi-donated-summary"
          aria-label="Synthèse des pots offerts hors chiffre d'affaires"
          className={styles.donatedCallout}
        >
          <div className={styles.donatedHeader}>
            <span className={styles.donatedTitle}>
              Dons &amp; dégustations (hors CA)
            </span>{' '}
            <StatusBadge status="Donné" label="0,00 € hors CA" />
          </div>
          <div className={cx(styles.donatedValues, 'tabular-nums')}>
            <span>
              {metrics.donatedJarsCount}{' '}
              {metrics.donatedJarsCount > 1 ? 'pots offerts' : 'pot offert'}
            </span>{' '}
            <span className={styles.donatedSeparator} aria-hidden="true">
              ·
            </span>{' '}
            <span>{formatWeightKg(metrics.donatedWeightKg)}</span>
          </div>
          <p className={styles.donatedHint}>
            Valorisé à 0,00 € — déduit du stock engagé, exclu du chiffre
            d&apos;affaires et du reste à payer.
          </p>
        </aside>

        <button
          id="btn-kpi-pending-transfers"
          type="button"
          data-testid="kpi-pending-transfers"
          onClick={handlePendingTransfersClick}
          className={cx(
            styles.actionKpiButton,
            hasPendingTransfers && styles.actionKpiTransferAlert,
          )}
        >
          <div className={styles.actionKpiHeader}>
            <span className={styles.actionKpiLabel}>
              Règlements tiers à reverser
            </span>{' '}
            <StatusBadge
              status={hasPendingTransfers ? 'À reverser' : 'Reversé'}
              label={hasPendingTransfers ? 'À reverser' : 'À jour'}
            />
          </div>
          <div className={styles.actionKpiMainRow}>
            <span className={cx(styles.actionKpiValue, 'tabular-nums')}>
              {formatEuro(metrics.pendingTransferAmountEur)}
            </span>
          </div>
          <div className={styles.actionKpiFooter}>
            <span className={styles.actionKpiHint}>
              {hasPendingTransfers
                ? `${metrics.pendingTransferOrdersCount} ${metrics.pendingTransferOrdersCount > 1 ? 'ventes encaissées' : 'vente encaissée'} par un co-vendeur`
                : 'Aucun reversement co-vendeur en attente'}
            </span>{' '}
            <span className={styles.actionKpiCta}>
              Voir les reversements →
            </span>
          </div>
        </button>
      </section>

      {/* === Logistics Section === */}
      <section
        aria-labelledby="section-logistics-title"
        className={styles.sectionBlock}
      >
        <div className={styles.sectionHeader}>
          <h2 id="section-logistics-title" className={styles.sectionTitle}>
            Logistique &amp; remises
          </h2>
        </div>

        <button
          id="btn-kpi-pending-deliveries"
          type="button"
          data-testid="kpi-pending-deliveries"
          onClick={handlePendingDeliveriesClick}
          className={cx(
            styles.actionKpiButton,
            hasPendingDeliveries && styles.actionKpiLogisticsActive,
          )}
        >
          <div className={styles.actionKpiHeader}>
            <span className={styles.actionKpiLabel}>
              Commandes en attente de remise
            </span>{' '}
            <StatusBadge
              status={hasPendingDeliveries ? 'Réservé' : 'Distribué'}
              label={hasPendingDeliveries ? 'Réservé' : 'Tout remis'}
            />
          </div>
          <div className={styles.actionKpiMainRow}>
            <span className={cx(styles.actionKpiValue, 'tabular-nums')}>
              {' '}
              {metrics.pendingDeliveryOrdersCount}{' '}
            </span>
            <span className={styles.actionKpiUnit}>
              {metrics.pendingDeliveryOrdersCount > 1
                ? 'commandes à livrer'
                : 'commande à livrer'}
            </span>
          </div>
          <div className={styles.actionKpiFooter}>
            <span className={styles.actionKpiHint}>
              {hasPendingDeliveries
                ? `Pots déjà déduits du stock (${metrics.distributedOrdersCount} ${metrics.distributedOrdersCount > 1 ? 'remises effectuées' : 'remise effectuée'})`
                : `Aucune remise en attente (${metrics.distributedOrdersCount} ${metrics.distributedOrdersCount > 1 ? 'remises effectuées' : 'remise effectuée'})`}
            </span>{' '}
            <span className={styles.actionKpiCta}>
              Ouvrir les réservations →
            </span>
          </div>
        </button>
      </section>
    </section>
  );
}

export default DashboardPage;
