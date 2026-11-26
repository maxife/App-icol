import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  computeHarvestDashboardMetrics,
  formatEuro,
  formatWeightKg,
  normalizeHarvestLabel,
  parseFrenchDecimal,
  roundCurrencyEur,
  roundWeightKg,
  type Harvest,
  type JarFormat,
} from '@app-icol/shared';
import { useAuth, useData, useToast } from '../../providers';
import { useAppNavigation } from '../../shell/navigation';
import { Button, StatusBadge, cx } from '../../ui';
import styles from './HarvestsPage.module.css';

type HarvestEditorMode =
  | { kind: 'create' }
  | { kind: 'edit'; harvestId: string }
  | null;

function formatDecimalForInput(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '';
  }
  return String(value).replace('.', ',');
}

function createClientRequestId(prefix: string): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function HarvestsPage(): React.JSX.Element {
  const { isManager } = useAuth();
  const {
    harvests,
    formats,
    defaultActiveHarvest,
    orders,
    createHarvest,
    updateHarvest,
    setDefaultActiveHarvest,
    upsertJarFormat,
  } = useData();
  const toast = useToast();
  const { navigateToDashboard } = useAppNavigation();
  const formUid = useId();
  const harvestFormRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (!isManager) {
      navigateToDashboard();
    }
  }, [isManager, navigateToDashboard]);

  // --- Harvest Creation / Edition Form State ---
  const [editorMode, setEditorMode] = useState<HarvestEditorMode>(null);
  const [labelDraft, setLabelDraft] = useState<string>('');
  const [yearDraft, setYearDraft] = useState<string>(() =>
    String(new Date().getFullYear()),
  );
  const [forecastDraft, setForecastDraft] = useState<string>('');
  const [realizedDraft, setRealizedDraft] = useState<string>('');
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [isDefaultDraft, setIsDefaultDraft] = useState<boolean>(false);
  const [harvestFormError, setHarvestFormError] = useState<string | null>(null);
  const [isSavingHarvest, setIsSavingHarvest] = useState<boolean>(false);
  const [settingDefaultHarvestId, setSettingDefaultHarvestId] = useState<
    string | null
  >(null);
  const harvestRequestIdRef = useRef<string | null>(null);

  // --- Jar Formats (ParArticles) Form State ---
  const [formatCodeDraft, setFormatCodeDraft] = useState<string>('');
  const [formatLabelDraft, setFormatLabelDraft] = useState<string>('');
  const [formatWeightDraft, setFormatWeightDraft] = useState<string>('');
  const [formatFormError, setFormatFormError] = useState<string | null>(null);
  const [isSavingFormat, setIsSavingFormat] = useState<boolean>(false);
  const [togglingFormatCode, setTogglingFormatCode] = useState<string | null>(
    null,
  );
  const formatRequestIdRef = useRef<string | null>(null);

  const sortedHarvests = useMemo(
    () => [...harvests].sort((a, b) => b.year - a.year),
    [harvests],
  );

  const metricsByHarvestId = useMemo(() => {
    const map = new Map<
      string,
      ReturnType<typeof computeHarvestDashboardMetrics>
    >();
    for (const harvest of harvests) {
      map.set(
        harvest.id,
        computeHarvestDashboardMetrics(harvest, orders, harvests, formats),
      );
    }
    return map;
  }, [harvests, orders, formats]);

  const resetHarvestRequestId = (): void => {
    harvestRequestIdRef.current = null;
  };

  const resetFormatRequestId = (): void => {
    formatRequestIdRef.current = null;
  };

  const openCreateHarvestForm = (): void => {
    const initialPrices: Record<string, string> = {};
    for (const fmt of formats) {
      const refPrice = defaultActiveHarvest?.unitPricesEur[fmt.code];
      initialPrices[fmt.code] =
        refPrice !== undefined ? formatDecimalForInput(refPrice) : '';
    }
    harvestRequestIdRef.current = null;
    setHarvestFormError(null);
    setLabelDraft('');
    setYearDraft(String(new Date().getFullYear()));
    setForecastDraft('');
    setRealizedDraft('');
    setPriceDrafts(initialPrices);
    setIsDefaultDraft(harvests.length === 0);
    setEditorMode({ kind: 'create' });
  };

  const openEditHarvestForm = (harvest: Harvest): void => {
    const initialPrices: Record<string, string> = {};
    for (const fmt of formats) {
      const existingPrice = harvest.unitPricesEur[fmt.code];
      initialPrices[fmt.code] =
        existingPrice !== undefined ? formatDecimalForInput(existingPrice) : '';
    }
    harvestRequestIdRef.current = null;
    setHarvestFormError(null);
    setLabelDraft(harvest.label);
    setYearDraft(String(harvest.year));
    setForecastDraft(formatDecimalForInput(harvest.forecastWeightKg));
    setRealizedDraft(
      harvest.realizedWeightKg === null
        ? ''
        : formatDecimalForInput(harvest.realizedWeightKg),
    );
    setPriceDrafts(initialPrices);
    setIsDefaultDraft(harvest.isDefaultActive);
    setEditorMode({ kind: 'edit', harvestId: harvest.id });
    if (
      harvestFormRef.current &&
      typeof harvestFormRef.current.scrollIntoView === 'function'
    ) {
      harvestFormRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  };

  const closeHarvestEditor = (): void => {
    harvestRequestIdRef.current = null;
    setHarvestFormError(null);
    setEditorMode(null);
  };

  const handleSaveHarvest = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    if (!editorMode || isSavingHarvest) return;

    const normalizedLabel = normalizeHarvestLabel(labelDraft);
    if (!normalizedLabel) {
      const msg = 'Veuillez saisir un libellé de récolte.';
      setHarvestFormError(msg);
      toast.error('Saisie incomplète', msg);
      return;
    }

    const trimmedYear = yearDraft.trim();
    const parsedYear = /^\d{4}$/.test(trimmedYear)
      ? Number.parseInt(trimmedYear, 10)
      : Number.NaN;
    if (
      !Number.isInteger(parsedYear) ||
      parsedYear < 1990 ||
      parsedYear > 2200
    ) {
      const msg = 'Veuillez saisir une année de millésime valide sur 4 chiffres.';
      setHarvestFormError(msg);
      toast.error('Année invalide', msg);
      return;
    }

    const parsedForecast = parseFrenchDecimal(forecastDraft);
    if (parsedForecast === null || parsedForecast < 0) {
      const msg =
        'Veuillez saisir un poids prévisionnel valide (positif ou nul, en kg).';
      setHarvestFormError(msg);
      toast.error('Poids prévisionnel invalide', msg);
      return;
    }

    let parsedRealized: number | null = null;
    const trimmedRealized = realizedDraft.trim();
    if (trimmedRealized !== '') {
      const numericRealized = parseFrenchDecimal(trimmedRealized);
      if (numericRealized === null || numericRealized < 0) {
        const msg =
          'Le poids réalisé doit être vide (non récolté), égal à 0 (récolte nulle) ou positif.';
        setHarvestFormError(msg);
        toast.error('Poids réalisé invalide', msg);
        return;
      }
      parsedRealized = roundWeightKg(numericRealized);
    }

    const unitPricesEur: Record<string, number> = {};
    for (const fmt of formats) {
      const rawPrice = (priceDrafts[fmt.code] ?? '').trim();
      if (rawPrice === '') {
        unitPricesEur[fmt.code] = 0;
        continue;
      }
      const numericPrice = parseFrenchDecimal(rawPrice);
      if (numericPrice === null || numericPrice < 0) {
        const msg = `Tarif unitaire invalide pour le format ${fmt.label} (${fmt.code}).`;
        setHarvestFormError(msg);
        toast.error('Tarif invalide', msg);
        return;
      }
      unitPricesEur[fmt.code] = roundCurrencyEur(numericPrice);
    }

    if (!harvestRequestIdRef.current) {
      harvestRequestIdRef.current = createClientRequestId('harvest-save');
    }
    const clientRequestId = harvestRequestIdRef.current;

    setIsSavingHarvest(true);
    setHarvestFormError(null);

    try {
      if (editorMode.kind === 'create') {
        const created = await createHarvest(
          {
            label: normalizedLabel,
            year: parsedYear,
            forecastWeightKg: roundWeightKg(parsedForecast),
            realizedWeightKg: parsedRealized,
            unitPricesEur,
            isDefaultActive: isDefaultDraft,
          },
          { clientRequestId },
        );
        harvestRequestIdRef.current = null;
        setEditorMode(null);
        toast.success(
          'Récolte enregistrée',
          `${created.label} a été ajoutée aux campagnes du rucher.`,
        );
      } else {
        const updated = await updateHarvest(
          editorMode.harvestId,
          {
            label: normalizedLabel,
            year: parsedYear,
            forecastWeightKg: roundWeightKg(parsedForecast),
            realizedWeightKg: parsedRealized,
            unitPricesEur,
            isDefaultActive: isDefaultDraft,
          },
          { clientRequestId },
        );
        harvestRequestIdRef.current = null;
        setEditorMode(null);
        toast.success(
          'Récolte mise à jour',
          `Les données et tarifs de ${updated.label} ont été enregistrés.`,
        );
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Impossible d'enregistrer la récolte. Vos saisies sont conservées.";
      setHarvestFormError(message);
      toast.error("Échec de l'enregistrement", message);
    } finally {
      setIsSavingHarvest(false);
    }
  };

  const handleSetDefaultHarvest = async (harvest: Harvest): Promise<void> => {
    if (harvest.isDefaultActive || settingDefaultHarvestId !== null) return;
    setSettingDefaultHarvestId(harvest.id);
    try {
      await setDefaultActiveHarvest(harvest.id, {
        clientRequestId: createClientRequestId('harvest-default'),
      });
      toast.success(
        'Récolte active par défaut',
        `${harvest.label} est désormais présélectionnée à l'ouverture.`,
      );
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Impossible de modifier la récolte par défaut.';
      toast.error('Échec de la mise à jour', message);
    } finally {
      setSettingDefaultHarvestId(null);
    }
  };

  const handleSaveFormat = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    if (isSavingFormat) return;

    const code = formatCodeDraft.trim();
    const label = formatLabelDraft.trim();
    if (!code || !label) {
      const msg = 'Veuillez renseigner le code et le libellé du format de pot.';
      setFormatFormError(msg);
      toast.error('Format incomplet', msg);
      return;
    }

    const parsedWeight = parseFrenchDecimal(formatWeightDraft);
    if (parsedWeight === null || parsedWeight <= 0) {
      const msg =
        'Le poids unitaire du pot doit être strictement supérieur à 0 kg.';
      setFormatFormError(msg);
      toast.error('Poids invalide', msg);
      return;
    }

    if (!formatRequestIdRef.current) {
      formatRequestIdRef.current = createClientRequestId('format-upsert');
    }
    const clientRequestId = formatRequestIdRef.current;

    setIsSavingFormat(true);
    setFormatFormError(null);

    try {
      const saved = await upsertJarFormat(
        {
          code,
          label,
          weightKg: roundWeightKg(parsedWeight),
          active: true,
        },
        { clientRequestId },
      );
      formatRequestIdRef.current = null;
      setFormatCodeDraft('');
      setFormatLabelDraft('');
      setFormatWeightDraft('');
      toast.success(
        'Format enregistré',
        `${saved.label} (${saved.code} — ${formatWeightKg(saved.weightKg)}) est actif.`,
      );
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Impossible d'enregistrer le format. Vos saisies sont conservées.";
      setFormatFormError(message);
      toast.error("Échec de l'enregistrement", message);
    } finally {
      setIsSavingFormat(false);
    }
  };

  const handleToggleFormat = async (format: JarFormat): Promise<void> => {
    if (togglingFormatCode !== null) return;
    setTogglingFormatCode(format.code);
    const nextActive = !format.active;
    try {
      const saved = await upsertJarFormat(
        {
          code: format.code,
          label: format.label,
          weightKg: format.weightKg,
          active: nextActive,
        },
        { clientRequestId: createClientRequestId('format-toggle') },
      );
      toast.success(
        saved.active ? 'Format activé' : 'Format désactivé',
        saved.active
          ? `${saved.label} apparaît dans le formulaire de vente.`
          : `${saved.label} est masqué des nouvelles ventes (historique conservé).`,
      );
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Impossible de modifier le statut du format.';
      toast.error('Échec de la mise à jour', message);
    } finally {
      setTogglingFormatCode(null);
    }
  };

  const prefillFormatEditor = (format: JarFormat): void => {
    resetFormatRequestId();
    setFormatFormError(null);
    setFormatCodeDraft(format.code);
    setFormatLabelDraft(format.label);
    setFormatWeightDraft(formatDecimalForInput(format.weightKg));
  };

  if (!isManager) {
    return (
      <section role="alert" className={styles.guardCard}>
        <h1 className={styles.guardTitle}>Accès restreint</h1>
        <p className={styles.guardText}>
          Le suivi des récoltes, des tarifs unitaires et des formats de pots est
          réservé au gestionnaire du rucher.
        </p>
        <Button variant="secondary" onClick={() => navigateToDashboard()}>
          Retour au tableau de bord
        </Button>
      </section>
    );
  }

  return (
    <section
      data-testid="harvests-page"
      aria-labelledby="page-title-harvests"
      className={styles.pageSection}
    >
      <div className={styles.pageHeader}>
        <div className={styles.titleGroup}>
          <h1 id="page-title-harvests">Suivi des récoltes &amp; tarifs</h1>
          <p className={styles.subtitle}>
            Pilotez vos campagnes mellifères, vos volumes prévisionnels ou
            réalisés, la grille tarifaire <strong>PUan</strong> et les formats{' '}
            <strong>ParArticles</strong>.
          </p>
        </div>

        <Button
          variant="primary"
          data-testid="harvest-create-btn"
          onClick={openCreateHarvestForm}
        >
          + Nouvelle récolte
        </Button>
      </div>

      {editorMode !== null && (
        <form
          ref={harvestFormRef}
          onSubmit={(e) => void handleSaveHarvest(e)}
          className={styles.editorForm}
          noValidate
          aria-labelledby={`${formUid}-editor-title`}
        >
          <div className={styles.formHeaderRow}>
            <h2 id={`${formUid}-editor-title`} className={styles.formTitle}>
              {editorMode.kind === 'create'
                ? 'Nouvelle campagne de récolte'
                : 'Modifier la récolte et ses tarifs'}
            </h2>
            <Button variant="ghost" size="compact" onClick={closeHarvestEditor}>
              Fermer
            </Button>
          </div>

          {harvestFormError && (
            <p role="alert" className={styles.errorAlert}>
              {harvestFormError}
            </p>
          )}

          <div className={styles.formGrid}>
            <div className={styles.fieldGroup}>
              <label
                htmlFor={`${formUid}-harvest-label`}
                className={styles.fieldLabel}
              >
                Nom de la récolte
              </label>
              <input
                id={`${formUid}-harvest-label`}
                data-testid="harvest-label-input"
                type="text"
                required
                placeholder="ex. Printemps 2027"
                value={labelDraft}
                onChange={(e) => {
                  resetHarvestRequestId();
                  setLabelDraft(e.target.value);
                }}
                onBlur={() => {
                  const clean = normalizeHarvestLabel(labelDraft);
                  if (clean !== labelDraft) {
                    setLabelDraft(clean);
                  }
                }}
                className={styles.textInput}
              />
              <p className={styles.fieldHint}>
                Espaces superflus nettoyés automatiquement.
              </p>
            </div>

            <div className={styles.fieldGroup}>
              <label
                htmlFor={`${formUid}-harvest-year`}
                className={styles.fieldLabel}
              >
                Millésime (année)
              </label>
              <input
                id={`${formUid}-harvest-year`}
                data-testid="harvest-year-input"
                type="number"
                inputMode="numeric"
                min={1990}
                max={2200}
                step={1}
                required
                value={yearDraft}
                onChange={(e) => {
                  resetHarvestRequestId();
                  setYearDraft(e.target.value);
                }}
                className={cx(styles.textInput, 'tabular-nums')}
              />
            </div>

            <div className={styles.fieldGroup}>
              <label
                htmlFor={`${formUid}-harvest-forecast`}
                className={styles.fieldLabel}
              >
                Poids prévisionnel (kg)
              </label>
              <input
                id={`${formUid}-harvest-forecast`}
                data-testid="harvest-forecast-input"
                type="text"
                inputMode="decimal"
                required
                placeholder="ex. 85 ou 85,5"
                value={forecastDraft}
                onChange={(e) => {
                  resetHarvestRequestId();
                  setForecastDraft(e.target.value);
                }}
                className={cx(styles.textInput, 'tabular-nums')}
              />
              <p className={styles.fieldHint}>
                Sert de stock de référence tant que la récolte n&apos;est pas
                extraite.
              </p>
            </div>

            <div className={styles.fieldGroup}>
              <label
                htmlFor={`${formUid}-harvest-realized`}
                className={styles.fieldLabel}
              >
                Poids réalisé extrait (kg)
              </label>
              <input
                id={`${formUid}-harvest-realized`}
                data-testid="harvest-realized-input"
                type="text"
                inputMode="decimal"
                placeholder="Vide si non récolté (0 = récolte nulle)"
                value={realizedDraft}
                onChange={(e) => {
                  resetHarvestRequestId();
                  setRealizedDraft(e.target.value);
                }}
                className={cx(styles.textInput, 'tabular-nums')}
              />
              <p className={styles.fieldHint}>
                Laisser vide avant extraction. Saisir <strong>0</strong> si la
                récolte est nulle (0 kg).
              </p>
            </div>
          </div>

          <fieldset className={styles.pricesFieldset}>
            <legend className={styles.pricesLegend}>
              Tarifs unitaires par format (PUan, en €)
            </legend>
            <div className={styles.pricesGrid}>
              {formats.map((fmt) => (
                <div key={fmt.code} className={styles.fieldGroup}>
                  <label
                    htmlFor={`${formUid}-price-${fmt.code}`}
                    className={styles.fieldLabel}
                  >
                    {fmt.label} ({fmt.code})
                    {!fmt.active ? ' · inactif' : ''}
                  </label>
                  <div className={styles.priceInputRow}>
                    <input
                      id={`${formUid}-price-${fmt.code}`}
                      data-testid={`harvest-price-input-${fmt.code}`}
                      type="text"
                      inputMode="decimal"
                      placeholder="ex. 15,00"
                      value={priceDrafts[fmt.code] ?? ''}
                      onChange={(e) => {
                        resetHarvestRequestId();
                        const nextVal = e.target.value;
                        setPriceDrafts((prev) => ({
                          ...prev,
                          [fmt.code]: nextVal,
                        }));
                      }}
                      className={cx(
                        styles.textInput,
                        styles.priceInput,
                        'tabular-nums',
                      )}
                    />
                    <span className={styles.unitSuffix} aria-hidden="true">
                      €
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </fieldset>

          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              data-testid="harvest-default-checkbox"
              checked={isDefaultDraft}
              onChange={(e) => {
                resetHarvestRequestId();
                setIsDefaultDraft(e.target.checked);
              }}
              className={styles.checkboxInput}
            />
            <span className={styles.checkboxText}>
              <span>Définir comme récolte active par défaut</span>
              <span className={styles.checkboxSubtext}>
                Présélectionnée sur le tableau de bord saison et les nouvelles
                ventes.
              </span>
            </span>
          </label>

          <div className={styles.formActions}>
            <Button
              variant="secondary"
              onClick={closeHarvestEditor}
              disabled={isSavingHarvest}
            >
              Annuler
            </Button>
            <Button
              type="submit"
              variant="primary"
              data-testid="harvest-save-btn"
              isLoading={isSavingHarvest}
            >
              {editorMode.kind === 'create'
                ? 'Créer la récolte'
                : 'Enregistrer les modifications'}
            </Button>
          </div>
        </form>
      )}

      {sortedHarvests.length === 0 ? (
        <div className={styles.emptyState}>
          Aucune récolte enregistrée pour le moment. Créez votre première
          campagne ci-dessus.
        </div>
      ) : (
        <div className={styles.harvestList}>
          {sortedHarvests.map((harvest) => {
            const metrics =
              metricsByHarvestId.get(harvest.id) ??
              computeHarvestDashboardMetrics(
                harvest,
                orders,
                harvests,
                formats,
              );
            const isZeroCropFailure = harvest.realizedWeightKg === 0;
            const usagePercentDisplay = Math.round(
              metrics.stockUsageRatio * 100,
            );

            return (
              <article
                key={harvest.id}
                data-harvest-id={harvest.id}
                className={cx(
                  styles.harvestCard,
                  harvest.isDefaultActive && styles.harvestCardDefault,
                )}
              >
                <div className={styles.cardHeaderRow}>
                  <div className={styles.harvestTitleWrap}>
                    <h2 className={styles.harvestTitle}>{harvest.label}</h2>
                    <div className={styles.badgeRow}>
                      <span className={cx(styles.yearPill, 'tabular-nums')}>
                        Millésime {harvest.year}
                      </span>
                      {harvest.isDefaultActive && (
                        <span className={styles.defaultPill}>
                          Active par défaut
                        </span>
                      )}
                      {harvest.realizedWeightKg === null ? (
                        <StatusBadge
                          status="Prévisionnel"
                          label="Prévisionnel actif"
                        />
                      ) : isZeroCropFailure ? (
                        <StatusBadge
                          status="Non-payé"
                          label="Récolte nulle (0 kg)"
                        />
                      ) : (
                        <StatusBadge status="Réalisé" label="Réalisé" />
                      )}
                    </div>
                  </div>

                  <div className={styles.cardActionGroup}>
                    {!harvest.isDefaultActive && (
                      <Button
                        variant="ghost"
                        size="compact"
                        isLoading={settingDefaultHarvestId === harvest.id}
                        onClick={() => void handleSetDefaultHarvest(harvest)}
                      >
                        Définir par défaut
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      size="compact"
                      onClick={() => openEditHarvestForm(harvest)}
                    >
                      Modifier
                    </Button>
                  </div>
                </div>

                <div className={styles.metricsGrid}>
                  <div className={styles.metricBox}>
                    <span className={styles.metricLabel}>Prévisionnel</span>
                    <span className={cx(styles.metricValue, 'tabular-nums')}>
                      {formatWeightKg(harvest.forecastWeightKg)}
                    </span>
                    <span className={styles.metricSub}>Estimation cible</span>
                  </div>

                  <div className={styles.metricBox}>
                    <span className={styles.metricLabel}>Réalisé extrait</span>
                    {harvest.realizedWeightKg === null ? (
                      <>
                        <span className={styles.metricValueMuted}>
                          Non encore réalisé
                        </span>
                        <span className={styles.metricSub}>
                          Bascule sur prévisionnel
                        </span>
                      </>
                    ) : (
                      <>
                        <span
                          className={cx(
                            styles.metricValue,
                            isZeroCropFailure && styles.metricValueDanger,
                            'tabular-nums',
                          )}
                        >
                          {formatWeightKg(harvest.realizedWeightKg)}
                        </span>
                        <span className={styles.metricSub}>
                          {isZeroCropFailure
                            ? 'Récolte nulle constatée'
                            : 'Poids extrait définitif'}
                        </span>
                      </>
                    )}
                  </div>

                  <div className={styles.metricBox}>
                    <span className={styles.metricLabel}>Poids engagé</span>
                    <span className={cx(styles.metricValue, 'tabular-nums')}>
                      {formatWeightKg(metrics.committedWeightKg)}
                    </span>
                    <span className={cx(styles.metricSub, 'tabular-nums')}>
                      {metrics.totalOrdersCount} commande(s)
                    </span>
                  </div>

                  <div
                    className={cx(
                      styles.metricBox,
                      metrics.isOverbooked && styles.metricBoxDanger,
                    )}
                  >
                    <span className={styles.metricLabel}>Stock disponible</span>
                    <span
                      className={cx(
                        styles.metricValue,
                        metrics.isOverbooked && styles.metricValueDanger,
                        'tabular-nums',
                      )}
                    >
                      {formatWeightKg(metrics.availableWeightKg)}
                    </span>
                    <span className={styles.metricSub}>
                      {metrics.isOverbooked
                        ? 'Dépassement de stock'
                        : `Sur ${formatWeightKg(metrics.harvestedOrForecastKg)}`}
                    </span>
                  </div>
                </div>

                <div className={styles.progressBlock}>
                  <div className={styles.progressHeader}>
                    <span className="tabular-nums">
                      Engagé :{' '}
                      <strong>
                        {formatWeightKg(metrics.committedWeightKg)}
                      </strong>{' '}
                      /{' '}
                      <strong>
                        {formatWeightKg(metrics.harvestedOrForecastKg)}
                      </strong>{' '}
                      {metrics.usesForecastFallback
                        ? '(réf. prévisionnelle)'
                        : '(réf. réalisée)'}
                    </span>
                    <strong className="tabular-nums">
                      {usagePercentDisplay} %
                    </strong>
                  </div>
                  <div
                    className={styles.progressTrack}
                    role="progressbar"
                    aria-label={`Progression du stock engagé pour ${harvest.label}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(metrics.gaugePercent)}
                  >
                    <div
                      className={cx(
                        styles.progressFill,
                        metrics.usesForecastFallback &&
                          styles.progressFillForecast,
                        metrics.isOverbooked && styles.progressFillDanger,
                      )}
                      style={{ width: `${metrics.gaugePercent}%` }}
                    />
                  </div>
                </div>

                <div className={styles.tariffsBlock}>
                  <span className={styles.tariffsHeading}>
                    Grille tarifaire unitaire (PUan)
                  </span>
                  <div className={styles.tariffChips}>
                    {formats.map((fmt) => {
                      const unitPrice = harvest.unitPricesEur[fmt.code];
                      return (
                        <span
                          key={fmt.code}
                          className={cx(
                            styles.tariffChip,
                            !fmt.active && styles.tariffChipInactive,
                          )}
                        >
                          <span className={styles.tariffCode}>{fmt.label}</span>
                          <span
                            className={cx(styles.tariffPrice, 'tabular-nums')}
                          >
                            {unitPrice !== undefined
                              ? formatEuro(unitPrice)
                              : '—'}
                          </span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className={styles.formatsSection}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>
            Formats de pots &amp; articles (ParArticles)
          </h2>
          <p className={styles.sectionDescription}>
            Activez ou désactivez les formats proposés dans le formulaire de
            vente sans altérer l&apos;historique des commandes existantes.
          </p>
        </div>

        <ul className={styles.formatsList}>
          {formats.map((fmt) => (
            <li
              key={fmt.code}
              className={cx(
                styles.formatItem,
                !fmt.active && styles.formatItemInactive,
              )}
            >
              <div className={styles.formatMeta}>
                <div className={styles.formatNameRow}>
                  <span className={styles.formatLabel}>{fmt.label}</span>
                  <span className={styles.formatCodeBadge}>{fmt.code}</span>
                </div>
                <span className={cx(styles.formatWeight, 'tabular-nums')}>
                  Poids net : {formatWeightKg(fmt.weightKg)}
                </span>
              </div>

              <div className={styles.formatControls}>
                <Button
                  variant="ghost"
                  size="compact"
                  onClick={() => prefillFormatEditor(fmt)}
                >
                  Charger
                </Button>
                <button
                  type="button"
                  role="switch"
                  aria-checked={fmt.active}
                  aria-label={`${fmt.active ? 'Désactiver' : 'Activer'} le format ${fmt.label}`}
                  data-testid={`format-toggle-${fmt.code}`}
                  disabled={togglingFormatCode === fmt.code}
                  onClick={() => void handleToggleFormat(fmt)}
                  className={cx(
                    styles.switchBtn,
                    fmt.active && styles.switchBtnActive,
                  )}
                >
                  <span className={styles.switchThumb} aria-hidden="true" />
                  <span>{fmt.active ? 'Actif' : 'Inactif'}</span>
                </button>
              </div>
            </li>
          ))}
        </ul>

        <form
          onSubmit={(e) => void handleSaveFormat(e)}
          className={styles.formatUpsertForm}
          noValidate
        >
          <h3 className={styles.formatFormTitle}>
            Ajouter ou mettre à jour un format de pot
          </h3>

          {formatFormError && (
            <p role="alert" className={styles.errorAlert}>
              {formatFormError}
            </p>
          )}

          <div className={styles.formatFormGrid}>
            <div className={styles.fieldGroup}>
              <label
                htmlFor={`${formUid}-format-code`}
                className={styles.fieldLabel}
              >
                Code court
              </label>
              <input
                id={`${formUid}-format-code`}
                data-testid="format-code-input"
                type="text"
                required
                placeholder="ex. 125g"
                value={formatCodeDraft}
                onChange={(e) => {
                  resetFormatRequestId();
                  setFormatCodeDraft(e.target.value);
                }}
                className={styles.textInput}
              />
            </div>

            <div className={styles.fieldGroup}>
              <label
                htmlFor={`${formUid}-format-label`}
                className={styles.fieldLabel}
              >
                Libellé affiché
              </label>
              <input
                id={`${formUid}-format-label`}
                data-testid="format-label-input"
                type="text"
                required
                placeholder="ex. Pot dégustation 125 g"
                value={formatLabelDraft}
                onChange={(e) => {
                  resetFormatRequestId();
                  setFormatLabelDraft(e.target.value);
                }}
                className={styles.textInput}
              />
            </div>

            <div className={styles.fieldGroup}>
              <label
                htmlFor={`${formUid}-format-weight`}
                className={styles.fieldLabel}
              >
                Poids unitaire (kg)
              </label>
              <input
                id={`${formUid}-format-weight`}
                data-testid="format-weight-input"
                type="text"
                inputMode="decimal"
                required
                placeholder="ex. 0,125"
                value={formatWeightDraft}
                onChange={(e) => {
                  resetFormatRequestId();
                  setFormatWeightDraft(e.target.value);
                }}
                className={cx(styles.textInput, 'tabular-nums')}
              />
            </div>
          </div>

          <div className={styles.formActions}>
            <Button
              type="submit"
              variant="secondary"
              data-testid="format-save-btn"
              isLoading={isSavingFormat}
            >
              Enregistrer le format
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}

export default HarvestsPage;
