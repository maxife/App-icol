import React, { useMemo } from 'react';
import { AccountingPage } from '../features/accounting/AccountingPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { HarvestsPage } from '../features/harvests/HarvestsPage';
import { OrdersPage } from '../features/orders/OrdersPage';
import { SaleFormPage } from '../features/sale-form/SaleFormPage';
import { useAuth, useData, useToast } from '../providers';
import { NetworkStatusBanner, ToastViewport, cx } from '../ui';
import styles from './AppShell.module.css';
import { useAppNavigation } from './navigation';

export function AppShell(): React.JSX.Element {
  const {
    session,
    isAuthenticated,
    isManager,
    isContributor,
    authMode,
    authError,
    roleStatusLabel,
    switchMockProfile,
    signOut,
  } = useAuth();
  const {
    orders,
    dataMode,
    isBrowserOffline,
    networkSimulation,
    setNetworkSimulation,
    resetMockData,
  } = useData();
  const { toasts, dismissToast } = useToast();
  const {
    route,
    navigateToDashboard,
    navigateToOrders,
    navigateToNewSale,
    navigateToHarvests,
    navigateToAccounting,
  } = useAppNavigation();

  const showMockControls = authMode === 'mock' || dataMode === 'mock';

  const pendingDeliveriesCount = useMemo(
    () => orders.filter((o) => o.orderStatus === 'Réservé').length,
    [orders],
  );

  const saleFormInstanceKey =
    route.id === 'sale-form'
      ? route.mode === 'edit'
        ? `edit-${route.orderId}`
        : `create-${route.defaultHarvestLabel ?? 'default'}`
      : 'inactive';

  let activePageElement: React.JSX.Element;
  switch (route.id) {
    case 'dashboard':
      activePageElement = <DashboardPage />;
      break;
    case 'orders':
      activePageElement = <OrdersPage />;
      break;
    case 'sale-form':
      activePageElement = <SaleFormPage key={saleFormInstanceKey} />;
      break;
    case 'harvests':
      activePageElement = <HarvestsPage />;
      break;
    case 'accounting':
      activePageElement = <AccountingPage />;
      break;
  }

  return (
    <div className={styles.shellFrame}>
      <header className={styles.topHeader}>
        <div className={styles.brandBar}>
          <div className={styles.brandIdentity}>
            <img
              src="./favicon.svg"
              alt=""
              width="28"
              height="28"
              aria-hidden="true"
            />
            <span className={styles.brandTitle}>App-icol</span>
          </div>
          <div className={styles.sessionBadge}>
            <span className={styles.sessionName}>
              {session?.displayName ?? 'Hors connexion'}
            </span>
            <span
              id="status-current-user-role"
              data-testid="current-user-role"
              data-role={roleStatusLabel}
              className={styles.roleCodePill}
            >
              {roleStatusLabel}
            </span>
          </div>
        </div>

        <div
          className={styles.qaToolbar}
          role="toolbar"
          aria-label="Contrôles de profil et simulation réseau"
        >
          {showMockControls && (
            <>
              <button
                type="button"
                id="btn-role-manager"
                data-testid="role-switch-manager"
                aria-pressed={isManager}
                onClick={() => switchMockProfile('manager')}
                className={cx(styles.qaBtn, isManager && styles.qaBtnActive)}
              >
                Gestionnaire
              </button>
              <button
                type="button"
                id="btn-role-contributor"
                data-testid="role-switch-contributor"
                aria-pressed={isContributor}
                onClick={() => switchMockProfile('contributor')}
                className={cx(styles.qaBtn, isContributor && styles.qaBtnActive)}
              >
                Co-vendeur
              </button>
            </>
          )}

          {isAuthenticated && (
            <button
              type="button"
              id="btn-role-signout"
              data-testid="role-switch-signout"
              onClick={signOut}
              className={styles.qaBtn}
            >
              Quitter
            </button>
          )}

          {dataMode === 'mock' && (
            <>
              <button
                type="button"
                id="btn-sim-offline"
                data-testid="simulate-offline-toggle"
                aria-pressed={networkSimulation.offlineMode}
                onClick={() =>
                  setNetworkSimulation({
                    offlineMode: !networkSimulation.offlineMode,
                  })
                }
                className={cx(
                  styles.qaBtn,
                  networkSimulation.offlineMode && styles.qaBtnWarnActive,
                )}
              >
                Hors-ligne
              </button>
              <button
                type="button"
                id="btn-fail-next-write"
                data-testid="fail-next-write-toggle"
                aria-pressed={networkSimulation.failNextWrite}
                onClick={() =>
                  setNetworkSimulation({
                    failNextWrite: !networkSimulation.failNextWrite,
                  })
                }
                className={cx(
                  styles.qaBtn,
                  networkSimulation.failNextWrite && styles.qaBtnWarnActive,
                )}
              >
                Échec 1x
              </button>
              <button
                type="button"
                id="btn-reset-mock"
                data-testid="reset-mock-data"
                onClick={() => {
                  void resetMockData();
                }}
                className={styles.qaBtn}
              >
                Reset démo
              </button>
            </>
          )}
        </div>
      </header>

      <NetworkStatusBanner
        isBrowserOffline={isBrowserOffline}
        offlineMode={networkSimulation.offlineMode}
        failNextWrite={networkSimulation.failNextWrite}
        dataMode={dataMode}
        onDisableSimulation={() =>
          setNetworkSimulation({ offlineMode: false, failNextWrite: false })
        }
      />

      {!isAuthenticated ? (
        <main
          id="main-content"
          data-testid="gis-login-screen"
          className={styles.loginMain}
        >
          <section
            className={styles.loginCard}
            aria-labelledby="page-title-login"
          >
            <h1 id="page-title-login">Connexion à App-icol</h1>
            <p className={styles.loginDescription}>
              Accès privé réservé au gestionnaire du rucher et aux co-vendeurs
              autorisés.
            </p>
            {authError && <p className={styles.loginError}>{authError}</p>}
            <div id="gis-button-slot" className={styles.gisSlot} />
            {showMockControls && (
              <p className={styles.loginHint}>
                Mode démonstration actif : choisissez{' '}
                <strong>Gestionnaire</strong> ou <strong>Co-vendeur</strong>{' '}
                dans la barre supérieure pour ouvrir une session.
              </p>
            )}
          </section>
        </main>
      ) : (
        <div className={styles.workspaceBody}>
          <nav
            id="primary-navigation"
            aria-label="Navigation principale"
            className={styles.primaryNav}
          >
            <button
              type="button"
              id="id-nav-dashboard"
              data-testid="nav-dashboard"
              aria-current={route.id === 'dashboard' ? 'page' : undefined}
              onClick={() => navigateToDashboard()}
              className={cx(
                styles.navBtn,
                route.id === 'dashboard' && styles.navBtnActive,
              )}
            >
              <span>Accueil</span>
            </button>

            <button
              type="button"
              id="id-nav-orders"
              data-testid="nav-orders"
              aria-current={route.id === 'orders' ? 'page' : undefined}
              onClick={() => navigateToOrders()}
              className={cx(
                styles.navBtn,
                route.id === 'orders' && styles.navBtnActive,
              )}
            >
              <span className={styles.navLabelRow}>
                <span>Commandes</span>
                {pendingDeliveriesCount > 0 && (
                  <span className={cx(styles.navBadge, 'tabular-nums')}>
                    {pendingDeliveriesCount}
                  </span>
                )}
              </span>
            </button>

            <button
              type="button"
              id="id-nav-new-sale"
              data-testid="nav-new-sale"
              aria-current={route.id === 'sale-form' ? 'page' : undefined}
              onClick={() => navigateToNewSale()}
              className={cx(styles.navBtn, styles.navBtnCta)}
            >
              <span>+ Vente</span>
            </button>

            {isManager && (
              <button
                type="button"
                id="id-nav-harvests"
                data-testid="nav-harvests"
                aria-current={route.id === 'harvests' ? 'page' : undefined}
                onClick={() => navigateToHarvests()}
                className={cx(
                  styles.navBtn,
                  route.id === 'harvests' && styles.navBtnActive,
                )}
              >
                <span>Récoltes</span>
              </button>
            )}

            {isManager && (
              <button
                type="button"
                id="id-nav-accounting"
                data-testid="nav-accounting"
                aria-current={route.id === 'accounting' ? 'page' : undefined}
                onClick={() => navigateToAccounting()}
                className={cx(
                  styles.navBtn,
                  route.id === 'accounting' && styles.navBtnActive,
                )}
              >
                <span>Compta</span>
              </button>
            )}
          </nav>

          <main id="main-content" className={styles.pageMain}>
            {activePageElement}
          </main>
        </div>
      )}

      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
