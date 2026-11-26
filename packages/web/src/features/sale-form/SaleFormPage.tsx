import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  computeOrderTotals,
  extractIsoCalendarYear,
  formatEuro,
  formatWeightKg,
  normalizeHarvestLabel,
  normalizeOrderTransferState,
  normalizePhoneNumber,
  parseFrenchDecimal,
  roundCurrencyEur,
  roundWeightKg,
  type CreateSaleOrderInput,
  type JarFormat,
  type OrderLineItemInput,
  type OrderStatus,
  type PaymentStatus,
  type TransferStatus,
} from '@app-icol/shared';
import {
  CustomerPicker,
  type CustomerDraftFields,
} from '../contacts/public';
import { useAuth, useData, useToast } from '../../providers';
import { useAppNavigation } from '../../shell/navigation';
import {
  Button,
  QuantityStepper,
  SegmentedControl,
  StatusBadge,
  cx,
  type SegmentedOption,
} from '../../ui';
import styles from './SaleFormPage.module.css';
import { useSaleDraftPersistence } from './useSaleDraftPersistence';

const ORDER_STATUS_OPTIONS: ReadonlyArray<SegmentedOption<OrderStatus>> = [
  {
    value: 'Réservé',
    label: 'Réservé',
    sublabel: 'À livrer · stock déduit',
    tone: 'honey',
  },
  {
    value: 'Distribué',
    label: 'Distribué',
    sublabel: 'Pots remis',
    tone: 'success',
  },
];

const PAYMENT_STATUS_OPTIONS: ReadonlyArray<SegmentedOption<PaymentStatus>> = [
  {
    value: 'Non-payé',
    label: 'Non-payé',
    sublabel: 'À encaisser',
    tone: 'danger',
  },
  {
    value: 'Payé',
    label: 'Payé',
    sublabel: 'Encaissé',
    tone: 'success',
  },
  {
    value: 'Donné',
    label: 'Donné',
    sublabel: '0 € · Offert',
    tone: 'info',
  },
];

const TRANSFER_STATUS_OPTIONS: ReadonlyArray<
  SegmentedOption<'À reverser' | 'Reversé'>
> = [
  {
    value: 'À reverser',
    label: 'À reverser',
    sublabel: 'En attente de remise',
    tone: 'warning',
  },
  {
    value: 'Reversé',
    label: 'Reversé',
    sublabel: 'Transmis au rucher',
    tone: 'default',
  },
];

interface FormValidationErrors {
  date?: string;
  harvestLabel?: string;
  customerName?: string;
  jars?: string;
  manualPrice?: string;
}

export function SaleFormPage(): React.JSX.Element {
  const { route, goBack, navigateToOrders } = useAppNavigation();
  const { session, isManager, isContributor } = useAuth();
  const {
    formats,
    activeFormats,
    harvests,
    defaultActiveHarvest,
    orders,
    customerSuggestions,
    relaySuggestions,
    isLoading,
    createOrder,
    updateOrder,
    deleteOrder,
  } = useData();
  const toast = useToast();

  const isEditMode = route.id === 'sale-form' && route.mode === 'edit';
  const editOrderId = isEditMode ? route.orderId : undefined;
  const explicitRouteHarvestLabel =
    route.id === 'sale-form' && route.mode === 'create'
      ? route.defaultHarvestLabel
      : undefined;

  const existingOrder = useMemo(
    () =>
      editOrderId ? (orders.find((o) => o.id === editOrderId) ?? null) : null,
    [editOrderId, orders],
  );

  const resolvedDefaultHarvestLabel = useMemo(() => {
    if (explicitRouteHarvestLabel) {
      const normalizedExplicit = normalizeHarvestLabel(explicitRouteHarvestLabel);
      if (harvests.length > 0) {
        const matched = harvests.find(
          (h) =>
            normalizeHarvestLabel(h.label) === normalizedExplicit ||
            h.id === explicitRouteHarvestLabel,
        );
        if (matched) {
          return matched.label;
        }
      } else if (normalizedExplicit && normalizedExplicit !== 'ALL') {
        return normalizedExplicit;
      }
    }
    return defaultActiveHarvest?.label ?? harvests[0]?.label ?? '';
  }, [explicitRouteHarvestLabel, harvests, defaultActiveHarvest]);

  const {
    draft,
    wasRestoredFromStorage,
    updateDraft,
    clearDraft,
  } = useSaleDraftPersistence({
    mode: isEditMode ? 'edit' : 'create',
    orderId: editOrderId,
    existingOrder,
    resolvedDefaultHarvestLabel,
    explicitRouteHarvestLabel,
  });

  const [validationErrors, setValidationErrors] = useState<FormValidationErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const mutationLockRef = useRef(false);
  const isBusy = isSubmitting || isDeleting;

  // Rule #4: Contributor creating a Payé sale auto-activates third-party collection
  useEffect(() => {
    if (isEditMode || !isContributor || draft.paymentStatus !== 'Payé') {
      return;
    }
    if (!draft.collectedByThirdParty) {
      updateDraft(
        (prev) => ({
          ...prev,
          collectedByThirdParty: true,
          collectorName:
            prev.collectorName.trim() || (session?.displayName ?? ''),
          transferStatus:
            prev.transferStatus === 'Reversé' ? 'Reversé' : 'À reverser',
        }),
        { markExplicitChange: false },
      );
    }
  }, [
    isEditMode,
    isContributor,
    draft.paymentStatus,
    draft.collectedByThirdParty,
    session?.displayName,
    updateDraft,
  ]);

  const harvestSelectOptions = useMemo(() => {
    const options = harvests.map((h) => h.label);
    const currentLabel = normalizeHarvestLabel(draft.harvestLabel);
    if (
      currentLabel &&
      !options.some((lbl) => normalizeHarvestLabel(lbl) === currentLabel)
    ) {
      options.unshift(draft.harvestLabel);
    }
    return options;
  }, [harvests, draft.harvestLabel]);

  const selectedHarvest = useMemo(() => {
    const norm = normalizeHarvestLabel(draft.harvestLabel);
    if (!norm) return defaultActiveHarvest;
    return (
      harvests.find((h) => normalizeHarvestLabel(h.label) === norm) ?? null
    );
  }, [harvests, draft.harvestLabel, defaultActiveHarvest]);

  // Active formats + in edit mode any inactive/archived format with historical or draft quantity > 0
  const displayedFormats = useMemo<JarFormat[]>(() => {
    const result: JarFormat[] = [...activeFormats];
    const seen = new Set(result.map((f) => f.code));

    for (const fmt of formats) {
      if (seen.has(fmt.code)) continue;
      const hasDraftQty = (draft.quantities[fmt.code] ?? 0) > 0;
      const hasHistoricalQty = Boolean(
        isEditMode &&
          existingOrder?.items.some(
            (item) => item.formatCode === fmt.code && item.quantity > 0,
          ),
      );
      if (hasDraftQty || hasHistoricalQty) {
        result.push(fmt);
        seen.add(fmt.code);
      }
    }

    if (isEditMode && existingOrder) {
      for (const item of existingOrder.items) {
        if (!seen.has(item.formatCode) && item.quantity > 0) {
          result.push({
            code: item.formatCode,
            label: `Pot ${item.formatCode}`,
            weightKg: item.unitWeightKg,
            active: false,
          });
          seen.add(item.formatCode);
        }
      }
    }

    return result;
  }, [activeFormats, formats, draft.quantities, isEditMode, existingOrder]);

  // F-06 / EC-20: Preserve historical unitWeightKg & unitPriceEur snapshots while edited harvest is unchanged
  const isUnchangedEditedHarvest =
    isEditMode &&
    existingOrder !== null &&
    normalizeHarvestLabel(draft.harvestLabel) ===
      normalizeHarvestLabel(existingOrder.harvestLabel);

  const lineDescriptors = useMemo(() => {
    return displayedFormats.map((fmt) => {
      const historicalLine = isUnchangedEditedHarvest
        ? existingOrder.items.find((item) => item.formatCode === fmt.code)
        : undefined;
      const catalogUnitPrice = roundCurrencyEur(
        selectedHarvest?.unitPricesEur?.[fmt.code] ?? 0,
      );
      const effectiveUnitPriceEur = historicalLine
        ? roundCurrencyEur(historicalLine.unitPriceEur)
        : catalogUnitPrice;
      const effectiveUnitWeightKg = historicalLine
        ? roundWeightKg(historicalLine.unitWeightKg)
        : roundWeightKg(fmt.weightKg);
      const isHistoricalSnapshot = Boolean(
        historicalLine &&
          (Math.abs(effectiveUnitPriceEur - catalogUnitPrice) >= 0.005 ||
            Math.abs(effectiveUnitWeightKg - roundWeightKg(fmt.weightKg)) >= 0.001),
      );

      const quantity = draft.quantities[fmt.code] ?? 0;
      const itemInput: OrderLineItemInput = {
        formatCode: fmt.code,
        quantity,
        ...(historicalLine
          ? {
              unitWeightKg: historicalLine.unitWeightKg,
              unitPriceEur: historicalLine.unitPriceEur,
            }
          : {}),
      };

      return {
        format: fmt,
        quantity,
        effectiveUnitPriceEur,
        effectiveUnitWeightKg,
        isHistoricalSnapshot,
        itemInput,
      };
    });
  }, [
    displayedFormats,
    isUnchangedEditedHarvest,
    existingOrder,
    selectedHarvest,
    draft.quantities,
  ]);

  const hasRawManualInput =
    draft.isManualPriceEnabled && draft.manualPriceRaw.trim().length > 0;
  const parsedManualPrice = useMemo(
    () => (hasRawManualInput ? parseFrenchDecimal(draft.manualPriceRaw) : null),
    [hasRawManualInput, draft.manualPriceRaw],
  );
  const isManualPriceInvalid =
    hasRawManualInput && (parsedManualPrice === null || parsedManualPrice < 0);
  const effectiveManualOverrideEur =
    hasRawManualInput && !isManualPriceInvalid && parsedManualPrice !== null
      ? roundCurrencyEur(parsedManualPrice)
      : null;

  const liveTotals = useMemo(() => {
    return computeOrderTotals(
      lineDescriptors.map((d) => d.itemInput),
      selectedHarvest,
      displayedFormats,
      draft.paymentStatus,
      effectiveManualOverrideEur,
    );
  }, [
    lineDescriptors,
    selectedHarvest,
    displayedFormats,
    draft.paymentStatus,
    effectiveManualOverrideEur,
  ]);

  const isTransitionToPaidInEdit =
    isEditMode &&
    existingOrder !== null &&
    existingOrder.paymentStatus !== 'Payé' &&
    draft.paymentStatus === 'Payé';

  const effectiveTransfer = useMemo(() => {
    const transferActor =
      !isEditMode || isTransitionToPaidInEdit || draft.collectedByThirdParty
        ? session
        : null;
    return normalizeOrderTransferState(
      draft.paymentStatus,
      draft.collectedByThirdParty,
      draft.collectorName,
      draft.transferStatus,
      transferActor,
    );
  }, [
    isEditMode,
    isTransitionToPaidInEdit,
    draft.paymentStatus,
    draft.collectedByThirdParty,
    draft.collectorName,
    draft.transferStatus,
    session,
  ]);

  const isThirdPartyActive =
    draft.paymentStatus === 'Payé' && effectiveTransfer.collectedByThirdParty;

  const handleCustomerChange = (nextCustomer: CustomerDraftFields): void => {
    if (validationErrors.customerName && nextCustomer.customerName.trim()) {
      setValidationErrors((prev) => ({ ...prev, customerName: undefined }));
    }
    setSubmitError(null);
    updateDraft(
      {
        customerName: nextCustomer.customerName,
        phone: nextCustomer.phone,
        contextOrRelay: nextCustomer.contextOrRelay,
      },
      { markExplicitChange: isEditMode },
    );
  };

  const handleQuantityChange = (formatCode: string, nextQty: number): void => {
    const clamped = Math.max(0, Math.trunc(nextQty));
    if (validationErrors.jars && clamped > 0) {
      setValidationErrors((prev) => ({ ...prev, jars: undefined }));
    }
    setSubmitError(null);
    updateDraft(
      (prev) => {
        const nextQuantities = { ...prev.quantities };
        if (clamped <= 0) {
          delete nextQuantities[formatCode];
        } else {
          nextQuantities[formatCode] = clamped;
        }
        return {
          ...prev,
          quantities: nextQuantities,
        };
      },
      { markExplicitChange: isEditMode },
    );
  };

  const handlePaymentStatusChange = (nextPaymentStatus: PaymentStatus): void => {
    setSubmitError(null);
    updateDraft((prev) => {
      if (nextPaymentStatus !== 'Payé') {
        return {
          ...prev,
          paymentStatus: nextPaymentStatus,
          collectedByThirdParty: false,
          transferStatus: 'Non concerné',
        };
      }

      if (isContributor) {
        return {
          ...prev,
          paymentStatus: 'Payé',
          collectedByThirdParty: true,
          collectorName:
            prev.collectorName.trim() || (session?.displayName ?? ''),
          transferStatus:
            prev.transferStatus === 'Reversé' ? 'Reversé' : 'À reverser',
        };
      }

      return {
        ...prev,
        paymentStatus: 'Payé',
        transferStatus: prev.collectedByThirdParty
          ? prev.transferStatus === 'Reversé'
            ? 'Reversé'
            : 'À reverser'
          : 'Non concerné',
      };
    });
  };

  const handleThirdPartyToggle = (): void => {
    setSubmitError(null);
    updateDraft((prev) => {
      const currentlyActive =
        prev.paymentStatus === 'Payé' && prev.collectedByThirdParty;

      if (currentlyActive) {
        return {
          ...prev,
          collectedByThirdParty: false,
          transferStatus: 'Non concerné',
        };
      }

      return {
        ...prev,
        paymentStatus: 'Payé',
        collectedByThirdParty: true,
        collectorName:
          prev.collectorName.trim() ||
          (isContributor ? (session?.displayName ?? '') : ''),
        transferStatus:
          prev.transferStatus === 'Reversé' ? 'Reversé' : 'À reverser',
      };
    });
  };

  const handleManualPriceToggle = (): void => {
    setSubmitError(null);
    setValidationErrors((prev) => ({ ...prev, manualPrice: undefined }));
    updateDraft((prev) => {
      if (prev.isManualPriceEnabled) {
        return {
          ...prev,
          isManualPriceEnabled: false,
          manualPriceRaw: '',
        };
      }
      return {
        ...prev,
        isManualPriceEnabled: true,
      };
    });
  };

  const handleResetAutoPrice = (): void => {
    setSubmitError(null);
    setValidationErrors((prev) => ({ ...prev, manualPrice: undefined }));
    updateDraft({
      isManualPriceEnabled: false,
      manualPriceRaw: '',
    });
  };

  const validateForm = (): FormValidationErrors => {
    const errors: FormValidationErrors = {};
    if (extractIsoCalendarYear(draft.date) === null) {
      errors.date = 'Veuillez saisir une date de vente valide.';
    }
    if (!normalizeHarvestLabel(draft.harvestLabel)) {
      errors.harvestLabel = 'Veuillez sélectionner une récolte.';
    }
    if (!draft.customerName.trim()) {
      errors.customerName =
        'Veuillez indiquer le nom du client ou le contexte (ex. Vente directe marché).';
    }
    if (liveTotals.totalJarsCount < 1) {
      errors.jars = 'Veuillez sélectionner au moins 1 pot.';
    }
    if (draft.isManualPriceEnabled && draft.manualPriceRaw.trim().length > 0) {
      const parsed = parseFrenchDecimal(draft.manualPriceRaw);
      if (parsed === null || parsed < 0) {
        errors.manualPrice =
          'Montant personnalisé invalide (utilisez par ex. 18,50).';
      }
    }
    return errors;
  };

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    if (mutationLockRef.current) return;

    const errors = validateForm();
    setValidationErrors(errors);

    const firstError =
      errors.customerName ??
      errors.jars ??
      errors.manualPrice ??
      errors.harvestLabel ??
      errors.date;
    if (firstError) {
      toast.error('Formulaire incomplet', firstError);
      return;
    }

    const nonZeroItems: OrderLineItemInput[] = lineDescriptors
      .filter((d) => d.quantity > 0)
      .map((d) => d.itemInput);

    const payload: CreateSaleOrderInput = {
      date: draft.date.trim(),
      customerName: draft.customerName.trim(),
      phone: normalizePhoneNumber(draft.phone),
      contextOrRelay: draft.contextOrRelay.trim(),
      harvestLabel: normalizeHarvestLabel(draft.harvestLabel),
      items: nonZeroItems,
      manualAmountOverrideEur: effectiveManualOverrideEur,
      orderStatus: draft.orderStatus,
      paymentStatus: draft.paymentStatus,
      collectedByThirdParty: effectiveTransfer.collectedByThirdParty,
      collectorName: effectiveTransfer.collectorName || undefined,
      transferStatus: effectiveTransfer.transferStatus,
      notes: draft.notes.trim() ? draft.notes.trim() : undefined,
    };

    mutationLockRef.current = true;
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      if (isEditMode && editOrderId) {
        const updated = await updateOrder(editOrderId, payload, {
          clientRequestId: draft.clientRequestId,
        });
        clearDraft();
        toast.success(
          'Commande mise à jour',
          `${updated.customerName} · ${formatWeightKg(updated.computedWeightKg)}`,
        );
        goBack('orders');
      } else {
        const created = await createOrder(payload, {
          clientRequestId: draft.clientRequestId,
        });
        clearDraft();
        toast.success(
          'Vente enregistrée',
          `${created.customerName} · ${formatWeightKg(created.computedWeightKg)}`,
        );
        goBack('dashboard');
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Impossible d'enregistrer la commande. Vos saisies sont conservées.";
      setSubmitError(message);
      toast.error("Échec de l'enregistrement", message);
    } finally {
      mutationLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleConfirmDelete = async (): Promise<void> => {
    if (!isEditMode || !isManager || !existingOrder || mutationLockRef.current) {
      return;
    }

    mutationLockRef.current = true;
    setIsDeleting(true);
    setSubmitError(null);

    try {
      await deleteOrder(existingOrder.id, {
        clientRequestId: draft.deleteClientRequestId,
      });
      clearDraft();
      toast.success(
        'Commande supprimée',
        `La commande de ${existingOrder.customerName} a été supprimée.`,
      );
      goBack('orders');
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Impossible de supprimer la commande. Veuillez réessayer.';
      setSubmitError(message);
      toast.error('Échec de la suppression', message);
    } finally {
      mutationLockRef.current = false;
      setIsDeleting(false);
    }
  };

  // Edit mode: loading or order not found states (preserving single <h1> for AppShell contract)
  if (isEditMode && !existingOrder) {
    return (
      <section
        data-testid="sale-form-page"
        aria-labelledby="page-title-sale-form"
        className={styles.pageSection}
      >
        <div className={styles.pageHeader}>
          <h1 id="page-title-sale-form">Modifier la commande</h1>
          <p className={styles.subtitle}>
            Référence demandée : {editOrderId}
          </p>
        </div>

        <div className={styles.emptyStateCard} role="status">
          {isLoading ? (
            <>
              <div className={styles.emptyStateTitle}>
                Chargement de la commande…
              </div>
              <p className={styles.emptyStateText}>
                Récupération des lignes et tarifs enregistrés.
              </p>
            </>
          ) : (
            <>
              <div className={styles.emptyStateTitle}>Commande introuvable</div>
              <p className={styles.emptyStateText}>
                La commande « {editOrderId} » n&apos;existe pas ou a été supprimée.
              </p>
              <div>
                <Button
                  variant="secondary"
                  onClick={() => navigateToOrders()}
                >
                  Retour aux commandes
                </Button>
              </div>
            </>
          )}
        </div>
      </section>
    );
  }

  const isDonated = draft.paymentStatus === 'Donné';

  return (
    <section
      data-testid="sale-form-page"
      aria-labelledby="page-title-sale-form"
      className={styles.pageSection}
    >
      <div className={styles.pageHeader}>
        <div className={styles.headerTopRow}>
          <h1 id="page-title-sale-form">
            {isEditMode ? 'Modifier la commande' : 'Nouvelle vente / réservation'}
          </h1>
          {isEditMode && existingOrder && (
            <StatusBadge status={draft.orderStatus} size="md" />
          )}
        </div>
        <p className={styles.subtitle}>
          {isEditMode && existingOrder
            ? `Commande ${existingOrder.id} · ${existingOrder.customerName}`
            : 'Saisie terrain rapide — stock et montants calculés en direct.'}
        </p>

        {wasRestoredFromStorage && (
          <div className={styles.draftRestoredBanner} role="status">
            <span>Brouillon local restauré automatiquement.</span>
            <button
              type="button"
              onClick={clearDraft}
              disabled={isBusy}
              className={styles.draftDiscardBtn}
            >
              Réinitialiser
            </button>
          </div>
        )}
      </div>

      <form
        noValidate
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
        className={styles.formStack}
      >
        {/* 1. Date & Harvest */}
        <div className={styles.card}>
          <div className={styles.dateHarvestGrid}>
            <div className={styles.fieldGroup}>
              <label htmlFor="id-sale-date-input" className={styles.label}>
                Date de vente / réservation
              </label>
              <input
                id="id-sale-date-input"
                data-testid="sale-date-input"
                type="date"
                disabled={isBusy}
                value={draft.date}
                onChange={(e) => {
                  if (validationErrors.date) {
                    setValidationErrors((prev) => ({ ...prev, date: undefined }));
                  }
                  setSubmitError(null);
                  updateDraft({ date: e.target.value });
                }}
                className={cx(
                  styles.input,
                  validationErrors.date && styles.inputError,
                )}
              />
              {validationErrors.date && (
                <p className={styles.fieldError} role="alert">
                  {validationErrors.date}
                </p>
              )}
            </div>

            <div className={styles.fieldGroup}>
              <label htmlFor="id-sale-harvest-select" className={styles.label}>
                Récolte associée
              </label>
              <select
                id="id-sale-harvest-select"
                data-testid="sale-harvest-select"
                disabled={isBusy || harvestSelectOptions.length === 0}
                value={draft.harvestLabel}
                onChange={(e) => {
                  if (validationErrors.harvestLabel) {
                    setValidationErrors((prev) => ({
                      ...prev,
                      harvestLabel: undefined,
                    }));
                  }
                  setSubmitError(null);
                  updateDraft({ harvestLabel: e.target.value });
                }}
                className={cx(
                  styles.select,
                  validationErrors.harvestLabel && styles.inputError,
                )}
              >
                {harvestSelectOptions.length === 0 ? (
                  <option value="">Chargement des récoltes…</option>
                ) : (
                  harvestSelectOptions.map((label) => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))
                )}
              </select>
              {validationErrors.harvestLabel && (
                <p className={styles.fieldError} role="alert">
                  {validationErrors.harvestLabel}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* 2. Customer Picker (mounted strictly once — owns name, phone, relay, Contact Picker & .vcf) */}
        <CustomerPicker
          value={{
            customerName: draft.customerName,
            phone: draft.phone,
            contextOrRelay: draft.contextOrRelay,
          }}
          onChange={handleCustomerChange}
          suggestions={customerSuggestions}
          relaySuggestions={relaySuggestions}
          disabled={isBusy}
          errorMessage={validationErrors.customerName}
        />

        {/* 3. Jar Format Steppers + Sticky Real-Time Totals + Manual Price Override */}
        <div className={styles.card}>
          <div className={styles.sectionTitleRow}>
            <h2 className={styles.sectionTitle}>Pots &amp; tarifs</h2>
            <span className={styles.sectionHint}>
              {selectedHarvest
                ? `Tarif ${selectedHarvest.label}`
                : 'Tarif unitaire récolte'}
            </span>
          </div>

          <div className={styles.jarsStickyScope}>
            <div
              className={cx(
                styles.totalsBanner,
                isDonated && styles.totalsBannerDonated,
              )}
              aria-live="polite"
            >
              <div className={styles.totalsGrid}>
                <div className={styles.totalCell}>
                  <span className={styles.totalLabel}>Poids total</span>
                  <strong
                    data-testid="sale-total-weight"
                    className={cx(styles.totalValue, 'tabular-nums')}
                  >
                    {formatWeightKg(liveTotals.computedWeightKg)}
                  </strong>
                  <span className={cx(styles.totalMeta, 'tabular-nums')}>
                    {liveTotals.totalJarsCount}{' '}
                    {liveTotals.totalJarsCount > 1 ? 'pots' : 'pot'}
                  </span>
                </div>

                <div className={cx(styles.totalCell, styles.totalCellRight)}>
                  <span className={styles.totalLabel}>
                    {isDonated ? 'Montant à encaisser' : 'Montant total'}
                  </span>
                  <strong
                    data-testid="sale-total-amount"
                    className={cx(
                      styles.totalValue,
                      isDonated && styles.totalValueDonated,
                      'tabular-nums',
                    )}
                  >
                    {formatEuro(liveTotals.effectiveAmountEur)}
                  </strong>
                  <span className={cx(styles.totalMeta, 'tabular-nums')}>
                    {isDonated
                      ? 'Offert · 0,00 € hors CA'
                      : effectiveManualOverrideEur !== null
                        ? `Tarif auto : ${formatEuro(liveTotals.computedAmountEur)}`
                        : 'Calcul automatique'}
                  </span>
                </div>
              </div>

              {isDonated && (
                <div className={styles.donatedCalloutRow}>
                  <span>0,00 € à encaisser — Offert (Donné)</span>
                  <span className="tabular-nums">
                    Valeur indicative : {formatEuro(liveTotals.computedAmountEur)}
                  </span>
                </div>
              )}
            </div>

            <div className={styles.steppersList}>
              {lineDescriptors.map((desc) => {
                const sublabelParts = [
                  `${formatEuro(desc.effectiveUnitPriceEur)} / pot`,
                  formatWeightKg(desc.effectiveUnitWeightKg),
                ];
                if (desc.isHistoricalSnapshot) {
                  sublabelParts.push("Tarif d'origine conservé");
                } else if (!desc.format.active) {
                  sublabelParts.push('Format archivé');
                }

                return (
                  <QuantityStepper
                    key={desc.format.code}
                    code={desc.format.code}
                    label={desc.format.label}
                    sublabel={sublabelParts.join(' · ')}
                    value={desc.quantity}
                    disabled={isBusy}
                    onChange={(nextVal) =>
                      handleQuantityChange(desc.format.code, nextVal)
                    }
                  />
                );
              })}
            </div>
          </div>

          {validationErrors.jars && (
            <p className={styles.fieldError} role="alert">
              {validationErrors.jars}
            </p>
          )}

          {/* Manual Tariff Override */}
          <div className={styles.manualPriceZone}>
            <button
              type="button"
              id="id-sale-manual-price-toggle"
              data-testid="sale-manual-price-toggle"
              aria-pressed={draft.isManualPriceEnabled}
              disabled={isBusy}
              onClick={handleManualPriceToggle}
              className={cx(
                styles.toggleSwitchBtn,
                draft.isManualPriceEnabled && styles.toggleSwitchBtnActive,
              )}
            >
              <span>Tarif personnalisé (remise ou montant global)</span>
              <span
                className={cx(
                  styles.switchPill,
                  draft.isManualPriceEnabled && styles.switchPillActive,
                )}
              >
                {draft.isManualPriceEnabled ? 'Actif' : 'Auto'}
              </span>
            </button>

            {draft.isManualPriceEnabled && (
              <div className={styles.manualPriceEditor}>
                <label
                  htmlFor="id-sale-manual-price-input"
                  className={styles.label}
                >
                  Montant total personnalisé (€)
                </label>
                <div className={styles.manualPriceRow}>
                  <div className={styles.manualPriceInputWrap}>
                    <input
                      id="id-sale-manual-price-input"
                      data-testid="sale-manual-price-input"
                      type="text"
                      inputMode="decimal"
                      disabled={isBusy}
                      placeholder={formatEuro(liveTotals.computedAmountEur)}
                      value={draft.manualPriceRaw}
                      onChange={(e) => {
                        if (validationErrors.manualPrice) {
                          setValidationErrors((prev) => ({
                            ...prev,
                            manualPrice: undefined,
                          }));
                        }
                        setSubmitError(null);
                        updateDraft({
                          isManualPriceEnabled: true,
                          manualPriceRaw: e.target.value,
                        });
                      }}
                      className={cx(
                        styles.input,
                        'tabular-nums',
                        (isManualPriceInvalid || validationErrors.manualPrice) &&
                          styles.inputError,
                      )}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    disabled={isBusy}
                    data-testid="sale-reset-auto-price"
                    onClick={handleResetAutoPrice}
                  >
                    Revenir au tarif auto
                  </Button>
                </div>
                {(validationErrors.manualPrice || isManualPriceInvalid) && (
                  <p className={styles.fieldError} role="alert">
                    {validationErrors.manualPrice ??
                      'Montant personnalisé invalide (ex. 18,50).'}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 4. Order Status, Payment Status & Third-Party Transfer */}
        <div className={styles.card}>
          <h2 className={styles.sectionTitle}>Remise &amp; règlement</h2>

          <SegmentedControl<OrderStatus>
            label="Statut de la commande"
            options={ORDER_STATUS_OPTIONS}
            value={draft.orderStatus}
            disabled={isBusy}
            optionTestIdPrefix="order-status"
            onChange={(nextOrderStatus) => {
              setSubmitError(null);
              updateDraft({ orderStatus: nextOrderStatus });
            }}
          />

          <SegmentedControl<PaymentStatus>
            label="Statut du règlement"
            options={PAYMENT_STATUS_OPTIONS}
            value={draft.paymentStatus}
            disabled={isBusy}
            optionTestIdPrefix="payment-status"
            onChange={handlePaymentStatusChange}
          />

          <div className={styles.fieldGroup}>
            <button
              type="button"
              id="id-third-party-toggle"
              role="switch"
              aria-checked={isThirdPartyActive}
              data-testid="third-party-toggle"
              disabled={isBusy}
              onClick={handleThirdPartyToggle}
              className={cx(
                styles.toggleSwitchBtn,
                isThirdPartyActive && styles.toggleSwitchBtnActive,
              )}
            >
              <span>Encaissé par un tiers / co-vendeur</span>
              <span
                className={cx(
                  styles.switchPill,
                  isThirdPartyActive && styles.switchPillActive,
                )}
              >
                {isThirdPartyActive ? 'Oui' : 'Non'}
              </span>
            </button>

            {draft.paymentStatus !== 'Payé' && (
              <p className={styles.transferNormalizedHint}>
                Suivi de reversement inactif tant que le règlement est «{' '}
                {draft.paymentStatus} » (statut : Non concerné).
              </p>
            )}
          </div>

          {isThirdPartyActive && (
            <div className={styles.transferDetailsBox}>
              <div className={styles.fieldGroup}>
                <label
                  htmlFor="id-collector-name-input"
                  className={styles.label}
                >
                  Tiers ou co-vendeur ayant encaissé
                </label>
                <input
                  id="id-collector-name-input"
                  data-testid="collector-name-input"
                  type="text"
                  disabled={isBusy}
                  placeholder="Ex. Marie Laurent, Épicerie du Village"
                  value={draft.collectorName}
                  onChange={(e) => {
                    setSubmitError(null);
                    updateDraft({ collectorName: e.target.value });
                  }}
                  className={styles.input}
                />
              </div>

              <SegmentedControl<'À reverser' | 'Reversé'>
                label="Reversement au rucher"
                options={TRANSFER_STATUS_OPTIONS}
                value={
                  effectiveTransfer.transferStatus === 'Reversé'
                    ? 'Reversé'
                    : 'À reverser'
                }
                disabled={isBusy}
                optionTestIdPrefix="transfer-status"
                onChange={(nextTransferStatus) => {
                  setSubmitError(null);
                  updateDraft({ transferStatus: nextTransferStatus });
                }}
              />
            </div>
          )}
        </div>

        {/* 5. Notes */}
        <div className={styles.card}>
          <div className={styles.fieldGroup}>
            <label htmlFor="id-sale-notes-input" className={styles.label}>
              Notes complémentaires (optionnel)
            </label>
            <textarea
              id="id-sale-notes-input"
              data-testid="sale-notes-input"
              rows={2}
              disabled={isBusy}
              placeholder="Ex. Appeler avant passage, créneau de retrait, consigne..."
              value={draft.notes}
              onChange={(e) => {
                setSubmitError(null);
                updateDraft(
                  { notes: e.target.value },
                  { markExplicitChange: isEditMode },
                );
              }}
              className={styles.textarea}
            />
          </div>
        </div>

        {submitError && (
          <div className={styles.errorAlert} role="alert">
            {submitError}
          </div>
        )}

        {/* 6. Primary Submit & Cancel */}
        <div className={styles.submitActions}>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            fullWidth
            isLoading={isSubmitting}
            disabled={isBusy}
            data-testid="sale-submit-btn"
          >
            {isEditMode
              ? 'Enregistrer les modifications'
              : 'Enregistrer la vente'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="md"
            fullWidth
            disabled={isBusy}
            onClick={() => goBack(isEditMode ? 'orders' : 'dashboard')}
          >
            Annuler
          </Button>
        </div>

        {/* 7. Manager-only Order Deletion in Edit Mode */}
        {isEditMode && isManager && existingOrder && (
          <div className={styles.dangerZone}>
            <div className={styles.dangerZoneTitle}>Suppression de commande</div>
            <p className={styles.dangerZoneText}>
              En cas d&apos;erreur de saisie ou de doublon, supprimer cette
              commande restitue immédiatement son poids dans le stock disponible.
            </p>
            <Button
              type="button"
              variant="danger"
              size="md"
              fullWidth
              disabled={isBusy}
              data-testid="sale-delete-btn"
              onClick={() => setIsConfirmingDelete(true)}
            >
              Supprimer cette commande
            </Button>

            {isConfirmingDelete && (
              <div
                className={styles.confirmDeleteBox}
                role="region"
                aria-label="Confirmation de suppression"
              >
                <p className={styles.confirmDeletePrompt}>
                  Confirmer la suppression définitive de la commande de{' '}
                  {existingOrder.customerName} (
                  {formatWeightKg(existingOrder.computedWeightKg)}) ?
                </p>
                <div className={styles.confirmDeleteActions}>
                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    fullWidth
                    disabled={isBusy}
                    onClick={() => setIsConfirmingDelete(false)}
                  >
                    Conserver la commande
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="md"
                    fullWidth
                    isLoading={isDeleting}
                    disabled={isBusy}
                    data-testid="sale-confirm-delete-btn"
                    onClick={() => {
                      void handleConfirmDelete();
                    }}
                  >
                    Supprimer définitivement
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </form>
    </section>
  );
}

export default SaleFormPage;
