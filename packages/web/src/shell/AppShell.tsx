import React, { useEffect, useMemo, useRef } from 'react';
import { AccountingPage } from '../features/accounting/AccountingPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { HarvestsPage } from '../features/harvests/HarvestsPage';
import { OrdersPage } from '../features/orders/OrdersPage';
import { SaleFormPage } from '../features/sale-form/SaleFormPage';
import { useAuth, useData, useToast } from '../providers';
import { NetworkStatusBanner, ToastViewport, cx } from '../ui';
import styles from './AppShell.module.css';
import { useAppNavigation } from './navigation';

function HomeHiveIcon(): React.JSX.Element {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2 4 6.5v11L12 22l8-4.5v-11L12 2Z" />
      <path d="M12 12 4 7.5" />
      <path d="m12 12 8-4.5" />
      <path d="M12 12v10" />
    </svg>
  );
}

function OrdersJarIcon(): React.JSX.Element {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3h8" />
      <path d="M7 6h10l1.5 3.5V19a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V9.5L7 6Z" />
      <path d="M9.5 13h5" />
    </svg>
  );
}

function PlusHoneyIcon(): React.JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function HarvestSunIcon(): React.JSX.Element {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2v2.5M12 19.5V22M4.93 4.93l1.77 1.77M17.3 17.3l1.77 1.77M2 12h2.5M19.5 12H22M4.93 19.07l1.77-1.77M17.3 6.7l1.77-1.77" />
    </svg>
  );
}

function AccountingLedgerIcon(): React.JSX.Element {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M7 9h4M7 13h3M15 9v6M13 12h4" />
    </svg>
  );
}

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

  const qaDetailsRef = useRef<HTMLDetailsElement | null>(null);
  const showMockControls = authMode === 'mock' || dataMode === 'mock';
  const hasActiveSim =
    networkSimulation.offlineMode || networkSimulation.failNextWrite;

  // Keep menu open on signed-out login gate so demo profiles are immediately accessible; close when signing in
  useEffect(() => {
    if (!qaDetailsRef.current) return;
    if (!isAuthenticated && showMockControls) {
      qaDetailsRef.current.open = true;
    } else if (isAuthenticated) {
      qaDetailsRef.current.open = false;
    }
  }, [isAuthenticated, showMockControls]);

  // Close popover on outside click or Escape key
  useEffect(() => {
    const onDocPointerDown = (e: MouseEvent) => {
      const el = qaDetailsRef.current;
      if (!el || !el.open || !isAuthenticated) return;
      if (e.target instanceof Node && !el.contains(e.target)) {
        el.open = false;
      }
    };
    const onDocKeyDown = (e: KeyboardEvent) => {
      const el = qaDetailsRef.current;
      if (e.key === 'Escape' && el?.open && isAuthenticated) {
        el.open = false;
      }
    };
    document.addEventListener('mousedown', onDocPointerDown);
    document.addEventListener('keydown', onDocKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocPointerDown);
      document.removeEventListener('keydown', onDocKeyDown);
    };
  }, [isAuthenticated]);

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
        <div className={styles.headerInner}>
          <div className={styles.brandIdentity}>
            <span className={styles.logoJewel} aria-hidden="true">
              <img src="./favicon.svg" alt="" width="22" height="22" />
            </span>
            <div className={styles.brandCopy}>
              <span className={styles.brandTitle}>App-icol</span>
              <span className={styles.brandTagline}>Rucher &amp; Récoltes</span>
            </div>
          </div>

          <details
            ref={qaDetailsRef}
            className={styles.profileDetails}
          >
            <summary
              className={cx(
                styles.sessionSummary,
                hasActiveSim && styles.sessionSummaryWarn,
              )}
              aria-label="Profil et outils de simulation démo"
            >
              <span
                className={cx(
                  styles.statusDot,
                  hasActiveSim
                    ? styles.statusDotWarn
                    : isAuthenticated
                      ? styles.statusDotOnline
                      : styles.statusDotOffline,
                )}
                aria-hidden="true"
              />
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
              <svg
                className={styles.summaryChevron}
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </summary>

            <div
              className={styles.qaPopover}
              role="toolbar"
              aria-label="Contrôles de profil et simulation réseau"
            >
              {showMockControls && (
                <div className={styles.qaGroup}>
                  <span className={styles.qaGroupTitle}>Profil actif</span>
                  <div className={styles.qaGrid}>
                    <button
                      type="button"
                      id="btn-role-manager"
                      data-testid="role-switch-manager"
                      aria-pressed={isManager}
                      onClick={() => {
                        switchMockProfile('manager');
                        if (qaDetailsRef.current) qaDetailsRef.current.open = false;
                      }}
                      className={cx(
                        styles.qaBtn,
                        isManager && styles.qaBtnActive,
                      )}
                    >
                      Gestionnaire
                    </button>
                    <button
                      type="button"
                      id="btn-role-contributor"
                      data-testid="role-switch-contributor"
                      aria-pressed={isContributor}
                      onClick={() => {
                        switchMockProfile('contributor');
                        if (qaDetailsRef.current) qaDetailsRef.current.open = false;
                      }}
                      className={cx(
                        styles.qaBtn,
                        isContributor && styles.qaBtnActive,
                      )}
                    >
                      Co-vendeur
                    </button>
                  </div>
                </div>
              )}

              {dataMode === 'mock' && (
                <div className={styles.qaGroup}>
                  <span className={styles.qaGroupTitle}>Simulation terrain (QA)</span>
                  <div className={styles.qaGridThree}>
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
                        if (qaDetailsRef.current) qaDetailsRef.current.open = false;
                      }}
                      className={styles.qaBtn}
                    >
                      Reset démo
                    </button>
                  </div>
                </div>
              )}

              {isAuthenticated && (
                <div className={styles.qaFooterRow}>
                  <button
                    type="button"
                    id="btn-role-signout"
                    data-testid="role-switch-signout"
                    onClick={() => {
                      signOut();
                    }}
                    className={cx(styles.qaBtn, styles.qaBtnSignout)}
                  >
                    Fermer la session
                  </button>
                </div>
              )}
            </div>
          </details>
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
            <div className={styles.loginIconEmblem} aria-hidden="true">
              <img src="./favicon.svg" alt="" width="36" height="36" />
            </div>
            <h1 id="page-title-login">Connexion à App-icol</h1>
            <p className={styles.loginDescription}>
              Espace privé réservé au gestionnaire du rucher et aux co-vendeurs
              autorisés.
            </p>
            {authError && <p className={styles.loginError}>{authError}</p>}
            <div id="gis-button-slot" className={styles.gisSlot} />
            {showMockControls && (
              <p className={styles.loginHint}>
                Mode démonstration actif : choisissez{' '}
                <strong>Gestionnaire</strong> ou <strong>Co-vendeur</strong>{' '}
                dans le menu de profil ouvert ci-dessus.
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
              <span className={styles.navIconWrap}>
                <HomeHiveIcon />
              </span>
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
              <span className={styles.navIconWrap}>
                <OrdersJarIcon />
                {pendingDeliveriesCount > 0 && (
                  <span className={cx(styles.navBadge, 'tabular-nums')}>
                    {pendingDeliveriesCount}
                  </span>
                )}
              </span>
              <span className={styles.navLabelRow}>
                <span>Commandes</span>
              </span>
            </button>

            <button
              type="button"
              id="id-nav-new-sale"
              data-testid="nav-new-sale"
              aria-current={route.id === 'sale-form' ? 'page' : undefined}
              onClick={() => navigateToNewSale()}
              className={cx(
                styles.navBtn,
                styles.navBtnCta,
                route.id === 'sale-form' && styles.navBtnCtaActive,
              )}
            >
              <span className={styles.navCtaOrb}>
                <PlusHoneyIcon />
              </span>
              <span>Vente</span>
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
                <span className={styles.navIconWrap}>
                  <HarvestSunIcon />
                </span>
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
                <span className={styles.navIconWrap}>
                  <AccountingLedgerIcon />
                </span>
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
