import React from 'react';
import styles from './NetworkStatusBanner.module.css';
import { cx } from './cx';

export interface NetworkStatusBannerProps {
  isBrowserOffline: boolean;
  offlineMode: boolean;
  failNextWrite: boolean;
  dataMode: 'mock' | 'gas';
  onDisableSimulation?: () => void;
}

export function NetworkStatusBanner({
  isBrowserOffline,
  offlineMode,
  failNextWrite,
  dataMode,
  onDisableSimulation,
}: NetworkStatusBannerProps): React.JSX.Element | null {
  if (!isBrowserOffline && !offlineMode && !failNextWrite) {
    return null;
  }

  const isOffline = isBrowserOffline || offlineMode;
  const message = isOffline
    ? 'Mode hors-ligne actif — Vos saisies en cours restent protégées localement sur cet appareil.'
    : 'Simulation QA active : le prochain enregistrement échouera avec une erreur réseau.';

  return (
    <div
      id="network-status-banner"
      role="status"
      aria-live="polite"
      data-testid="network-status-banner"
      data-network-state={isOffline ? 'offline' : 'fail-next-write'}
      className={cx(
        styles.banner,
        isOffline ? styles.stateOffline : styles.stateFailNext,
      )}
    >
      <span className={styles.message}>{message}</span>
      {dataMode === 'mock' &&
        (offlineMode || failNextWrite) &&
        onDisableSimulation && (
          <button
            type="button"
            id="btn-restore-network-simulation"
            onClick={onDisableSimulation}
            className={styles.restoreBtn}
          >
            Rétablir le réseau
          </button>
        )}
    </div>
  );
}
