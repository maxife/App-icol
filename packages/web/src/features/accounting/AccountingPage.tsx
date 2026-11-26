import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ACCOUNTING_CATEGORIES,
  ACCOUNTING_CATEGORIES_BY_TYPE,
  computeAnnualAccountingSummary,
  extractIsoCalendarYear,
  formatEuro,
  getLocalTodayIsoDate,
  isAccountingCategory,
  isCategoryValidForType,
  parseFrenchDecimal,
  roundCurrencyEur,
  type AccountingCategory,
  type AccountingEntry,
  type AccountingEntryType,
} from '@app-icol/shared';
import { useAuth, useData, useToast } from '../../providers';
import { useAppNavigation } from '../../shell/navigation';
import {
  Button,
  MetricCard,
  SegmentedControl,
  cx,
  type SegmentedOption,
} from '../../ui';
import styles from './AccountingPage.module.css';

type EntryEditorMode =
  | { kind: 'create' }
  | { kind: 'edit'; entryId: string }
  | null;

const ENTRY_TYPE_OPTIONS: ReadonlyArray<SegmentedOption<AccountingEntryType>> = [
  {
    value: 'Dépense',
    label: 'Dépense',
    tone: 'danger',
    testId: 'accounting-type-Dépense',
  },
  {
    value: 'Recette',
    label: 'Recette',
    tone: 'success',
    testId: 'accounting-type-Recette',
  },
];

function formatDecimalForInput(value: number): string {
  if (!Number.isFinite(value)) return '';
  return String(value).replace('.', ',');
}

function formatSignedNetBalance(netEur: number): string {
  if (netEur < 0) {
    return formatEuro(netEur); // Already prefixed with '-'
  }
  if (netEur > 0) {
    return `+${formatEuro(netEur)}`;
  }
  return formatEuro(0);
}

function buildDefaultDateForYear(targetYear: number): string {
  const todayIso = getLocalTodayIsoDate();
  const todayYear = extractIsoCalendarYear(todayIso);
  if (todayYear === targetYear) {
    return todayIso;
  }
  const monthDay = todayIso.slice(5);
  const safeMonthDay = monthDay === '02-29' ? '02-28' : monthDay;
  return `${String(targetYear).padStart(4, '0')}-${safeMonthDay}`;
}

function formatDisplayDate(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!m) return isoDate;
  return `${m[3]}/${m[2]}/${m[1]}`;
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

export function AccountingPage(): React.JSX.Element {
  const { isManager } = useAuth();
  const {
    harvests,
    defaultActiveHarvest,
    orders,
    accountingEntries,
    createAccountingEntry,
    updateAccountingEntry,
    deleteAccountingEntry,
  } = useData();
  const toast = useToast();
  const { route, navigateToDashboard, navigateToAccounting } =
    useAppNavigation();
  const formUid = useId();
  const editorFormRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (!isManager) {
      navigateToDashboard();
    }
  }, [isManager, navigateToDashboard]);

  const routeYear = route.id === 'accounting' ? route.year : undefined;

  const availableYears = useMemo(() => {
    const yearsSet = new Set<number>();
    const currentCalendarYear = new Date().getFullYear();
    yearsSet.add(currentCalendarYear);

    if (defaultActiveHarvest && Number.isInteger(defaultActiveHarvest.year)) {
      yearsSet.add(defaultActiveHarvest.year);
    }
    for (const h of harvests) {
      if (Number.isInteger(h.year) && h.year >= 1900 && h.year <= 2200) {
        yearsSet.add(h.year);
      }
    }
    for (const o of orders) {
      const yr = extractIsoCalendarYear(o.date);
      if (yr !== null && yr >= 1900 && yr <= 2200) {
        yearsSet.add(yr);
      }
    }
    for (const e of accountingEntries) {
      const yr = Number.isFinite(e.year)
        ? e.year
        : extractIsoCalendarYear(e.date);
      if (yr !== null && Number.isInteger(yr) && yr >= 1900 && yr <= 2200) {
        yearsSet.add(yr);
      }
    }
    if (routeYear !== undefined && routeYear >= 1900 && routeYear <= 2200) {
      yearsSet.add(routeYear);
    }

    return Array.from(yearsSet).sort((a, b) => b - a);
  }, [
    defaultActiveHarvest,
    harvests,
    orders,
    accountingEntries,
    routeYear,
  ]);

  const selectedYear = useMemo(() => {
    if (routeYear !== undefined) {
      return routeYear;
    }
    if (
      defaultActiveHarvest &&
      availableYears.includes(defaultActiveHarvest.year)
    ) {
      return defaultActiveHarvest.year;
    }
    return availableYears[0] ?? new Date().getFullYear();
  }, [routeYear, defaultActiveHarvest, availableYears]);

  // --- Anti-Double-Counting Toggle (enabled by default) ---
  const [includePaidOrdersRevenue, setIncludePaidOrdersRevenue] =
    useState<boolean>(true);

  // --- Historical Category Filter ---
  const [categoryFilter, setCategoryFilter] = useState<
    'ALL' | AccountingCategory
  >('ALL');

  // --- Entry Creation / Edition Form State ---
  const [editorMode, setEditorMode] = useState<EntryEditorMode>(null);
  const [typeDraft, setTypeDraft] = useState<AccountingEntryType>('Dépense');
  const [categoryDraft, setCategoryDraft] = useState<AccountingCategory>(
    ACCOUNTING_CATEGORIES_BY_TYPE.Dépense[0]!,
  );
  const [labelDraft, setLabelDraft] = useState<string>('');
  const [amountDraft, setAmountDraft] = useState<string>('');
  const [dateDraft, setDateDraft] = useState<string>(() =>
    getLocalTodayIsoDate(),
  );
  const [notesDraft, setNotesDraft] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSavingEntry, setIsSavingEntry] = useState<boolean>(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const entryRequestIdRef = useRef<string | null>(null);

  const summary = useMemo(
    () =>
      computeAnnualAccountingSummary(selectedYear, accountingEntries, orders, {
        includePaidOrdersRevenue,
      }),
    [selectedYear, accountingEntries, orders, includePaidOrdersRevenue],
  );

  const manualTotalRevenuesEur = useMemo(
    () =>
      roundCurrencyEur(
        summary.manualHoneyRevenueEntriesEur + summary.manualOtherRevenuesEur,
      ),
    [summary.manualHoneyRevenueEntriesEur, summary.manualOtherRevenuesEur],
  );

  const revenueBreakdownItems = useMemo(
    () => summary.categoryBreakdown.filter((item) => item.type === 'Recette'),
    [summary.categoryBreakdown],
  );

  const expenseBreakdownItems = useMemo(
    () => summary.categoryBreakdown.filter((item) => item.type === 'Dépense'),
    [summary.categoryBreakdown],
  );

  const yearEntries = useMemo(
    () =>
      accountingEntries
        .filter((e) => {
          const entryYear = Number.isFinite(e.year)
            ? e.year
            : extractIsoCalendarYear(e.date);
          return entryYear === selectedYear;
        })
        .sort((a, b) => {
          const dateCmp = b.date.localeCompare(a.date);
          return dateCmp !== 0 ? dateCmp : b.id.localeCompare(a.id);
        }),
    [accountingEntries, selectedYear],
  );

  const filteredYearEntries = useMemo(
    () =>
      categoryFilter === 'ALL'
        ? yearEntries
        : yearEntries.filter((e) => e.category === categoryFilter),
    [yearEntries, categoryFilter],
  );

  const expenseEntriesCount = useMemo(
    () => yearEntries.filter((e) => e.type === 'Dépense').length,
    [yearEntries],
  );

  const resetEntryRequestId = (): void => {
    entryRequestIdRef.current = null;
  };

  const handleYearChange = (
    event: React.ChangeEvent<HTMLSelectElement>,
  ): void => {
    const nextYear = Number.parseInt(event.target.value, 10);
    if (Number.isInteger(nextYear)) {
      setConfirmDeleteId(null);
      navigateToAccounting({ year: nextYear });
    }
  };

  const handleTypeChange = (nextType: AccountingEntryType): void => {
    resetEntryRequestId();
    setTypeDraft(nextType);
    if (!isCategoryValidForType(nextType, categoryDraft)) {
      const defaultCat = ACCOUNTING_CATEGORIES_BY_TYPE[nextType][0];
      if (defaultCat) {
        setCategoryDraft(defaultCat);
      }
    }
  };

  const openCreateEntryForm = (): void => {
    entryRequestIdRef.current = null;
    setFormError(null);
    toast.clearToasts();
    const initialType: AccountingEntryType = 'Dépense';
    const preferredCategory =
      categoryFilter !== 'ALL' &&
      isCategoryValidForType('Recette', categoryFilter)
        ? categoryFilter
        : categoryFilter !== 'ALL' &&
            isCategoryValidForType('Dépense', categoryFilter)
          ? categoryFilter
          : ACCOUNTING_CATEGORIES_BY_TYPE.Dépense[0]!;
    const resolvedType: AccountingEntryType = isCategoryValidForType(
      'Recette',
      preferredCategory,
    )
      ? 'Recette'
      : initialType;

    setTypeDraft(resolvedType);
    setCategoryDraft(preferredCategory);
    setLabelDraft('');
    setAmountDraft('');
    setDateDraft(buildDefaultDateForYear(selectedYear));
    setNotesDraft('');
    setEditorMode({ kind: 'create' });
  };

  const openEditEntryForm = (entry: AccountingEntry): void => {
    entryRequestIdRef.current = null;
    setFormError(null);
    setConfirmDeleteId(null);
    toast.clearToasts();
    setTypeDraft(entry.type);
    setCategoryDraft(entry.category);
    setLabelDraft(entry.label);
    setAmountDraft(formatDecimalForInput(entry.amountEur));
    setDateDraft(entry.date);
    setNotesDraft(entry.notes ?? '');
    setEditorMode({ kind: 'edit', entryId: entry.id });
    if (
      editorFormRef.current &&
      typeof editorFormRef.current.scrollIntoView === 'function'
    ) {
      editorFormRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  };

  const closeEntryEditor = (): void => {
    entryRequestIdRef.current = null;
    setFormError(null);
    setEditorMode(null);
  };

  const handleSaveEntry = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    if (!editorMode || isSavingEntry) return;

    const trimmedLabel = labelDraft.trim();
    if (!trimmedLabel) {
      const msg = "Veuillez saisir le libellé de l'écriture comptable.";
      setFormError(msg);
      toast.error('Saisie incomplète', msg);
      return;
    }

    const parsedAmount = parseFrenchDecimal(amountDraft);
    if (parsedAmount === null || parsedAmount <= 0) {
      const msg = 'Veuillez saisir un montant strictement supérieur à 0 €.';
      setFormError(msg);
      toast.error('Montant invalide', msg);
      return;
    }

    const trimmedDate = dateDraft.trim();
    const derivedYear = extractIsoCalendarYear(trimmedDate);
    if (derivedYear === null) {
      const msg = 'Veuillez saisir une date comptable valide (AAAA-MM-JJ).';
      setFormError(msg);
      toast.error('Date invalide', msg);
      return;
    }

    if (!isCategoryValidForType(typeDraft, categoryDraft)) {
      const msg =
        'La catégorie sélectionnée ne correspond pas au type choisi.';
      setFormError(msg);
      toast.error('Catégorie incompatible', msg);
      return;
    }

    if (!entryRequestIdRef.current) {
      entryRequestIdRef.current = createClientRequestId('accounting-save');
    }
    const clientRequestId = entryRequestIdRef.current;

    toast.clearToasts();
    setIsSavingEntry(true);
    setFormError(null);

    try {
      if (editorMode.kind === 'create') {
        const created = await createAccountingEntry(
          {
            date: trimmedDate,
            year: derivedYear,
            type: typeDraft,
            category: categoryDraft,
            label: trimmedLabel,
            amountEur: roundCurrencyEur(parsedAmount),
            notes: notesDraft.trim() ? notesDraft.trim() : undefined,
          },
          { clientRequestId },
        );
        entryRequestIdRef.current = null;
        setEditorMode(null);
        toast.success(
          'Écriture enregistrée',
          `${created.type} « ${created.label} » (${formatEuro(created.amountEur)}) ajoutée.`,
        );
      } else {
        const updated = await updateAccountingEntry(
          editorMode.entryId,
          {
            date: trimmedDate,
            year: derivedYear,
            type: typeDraft,
            category: categoryDraft,
            label: trimmedLabel,
            amountEur: roundCurrencyEur(parsedAmount),
            notes: notesDraft.trim(),
          },
          { clientRequestId },
        );
        entryRequestIdRef.current = null;
        setEditorMode(null);
        toast.success(
          'Écriture mise à jour',
          `« ${updated.label} » (${formatEuro(updated.amountEur)}) a été modifiée.`,
        );
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Impossible d'enregistrer l'écriture comptable. Vos saisies sont conservées.";
      setFormError(message);
      toast.error("Échec de l'enregistrement", message);
    } finally {
      setIsSavingEntry(false);
    }
  };

  const handleConfirmDelete = async (entry: AccountingEntry): Promise<void> => {
    if (deletingId !== null) return;
    setDeletingId(entry.id);
    try {
      await deleteAccountingEntry(entry.id, {
        clientRequestId: createClientRequestId('accounting-delete'),
      });
      setConfirmDeleteId(null);
      if (editorMode?.kind === 'edit' && editorMode.entryId === entry.id) {
        setEditorMode(null);
      }
      toast.success(
        'Écriture supprimée',
        `« ${entry.label} » a été retirée de la comptabilité.`,
      );
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Impossible de supprimer l'écriture comptable.";
      toast.error('Échec de la suppression', message);
    } finally {
      setDeletingId(null);
    }
  };

  if (!isManager) {
    return (
      <section role="alert" className={styles.guardCard}>
        <h1 className={styles.guardTitle}>Accès restreint</h1>
        <p className={styles.guardText}>
          La comptabilité du rucher et le bilan fiscal annuel sont réservés au
          gestionnaire.
        </p>
        <Button variant="secondary" onClick={() => navigateToDashboard()}>
          Retour au tableau de bord
        </Button>
      </section>
    );
  }

  const availableCategoriesForForm = ACCOUNTING_CATEGORIES_BY_TYPE[typeDraft];

  return (
    <section
      data-testid="accounting-page"
      aria-labelledby="page-title-accounting"
      className={styles.pageSection}
    >
      <div className={styles.pageHeader}>
        <div className={styles.titleGroup}>
          <h1 id="page-title-accounting">Comptabilité du rucher</h1>
          <p className={styles.subtitle}>
            Bilan annuel consolidé entre les encaissements{' '}
            <strong>Ventes Miel</strong> et le journal{' '}
            <strong>Comptabilité rucher</strong>.
          </p>
        </div>

        <Button
          variant="primary"
          data-testid="accounting-add-btn"
          onClick={openCreateEntryForm}
        >
          + Nouvelle écriture
        </Button>
      </div>

      <div className={styles.controlsCard}>
        <div className={styles.controlsGrid}>
          <div className={styles.fieldGroup}>
            <label
              htmlFor={`${formUid}-year-select`}
              className={styles.fieldLabel}
            >
              Année fiscale
            </label>
            <select
              id={`${formUid}-year-select`}
              data-testid="accounting-year-select"
              value={String(selectedYear)}
              onChange={handleYearChange}
              className={cx(styles.selectInput, 'tabular-nums')}
            >
              {availableYears.map((yr) => (
                <option key={yr} value={String(yr)}>
                  Exercice {yr}
                </option>
              ))}
            </select>
          </div>

          <label
            className={cx(
              styles.toggleLabel,
              includePaidOrdersRevenue && styles.toggleLabelActive,
            )}
          >
            <input
              type="checkbox"
              data-testid="accounting-include-sales-toggle"
              checked={includePaidOrdersRevenue}
              onChange={(e) => setIncludePaidOrdersRevenue(e.target.checked)}
              className={styles.checkboxInput}
            />
            <span className={styles.toggleTextWrap}>
              <span className={styles.toggleTitle}>
                Inclure les ventes de miel encaissées (Ventes Miel)
              </span>
              <span className={cx(styles.toggleDescription, 'tabular-nums')}>
                Comptabilise automatiquement les commandes{' '}
                <strong>Payé</strong> datées en {selectedYear} (
                {formatEuro(summary.paidOrdersHoneyRevenueEur)} sur{' '}
                {summary.paidOrdersCount} vente(s) — <em>Non-payé</em> et{' '}
                <em>Donné</em> exclus). Décochez pour éviter un double comptage
                si vous saisissez vos ventes manuellement.
              </span>
            </span>
          </label>
        </div>

        {summary.hasHoneyDoubleCountWarning && (
          <p role="status" className={cx(styles.doubleCountWarning, 'tabular-nums')}>
            Vigilance double comptage ({selectedYear}) :{' '}
            {formatEuro(summary.paidOrdersHoneyRevenueEur)} proviennent
            automatiquement de <strong>Ventes Miel (Payé)</strong> en plus de{' '}
            {formatEuro(summary.manualHoneyRevenueEntriesEur)} d&apos;écriture(s)
            manuelle(s) « Ventes de miel » ({summary.manualHoneyEntriesCount}{' '}
            ligne(s)). Vérifiez qu&apos;il s&apos;agit bien de ventes distinctes
            (ex. caisse libre-service).
          </p>
        )}
      </div>

      <div className={styles.kpiGrid}>
        <MetricCard
          testId="accounting-total-revenues"
          label="Recettes annuelles"
          value={<>{' '}{formatEuro(summary.totalRevenuesEur)}</>}
          tone="success"
        >
          <div className={cx(styles.revenueSplitList, 'tabular-nums')}>
            <div className={styles.revenueSplitRow}>
              <span>Ventes Miel (Payé, hors Non-payé &amp; Donné)</span>
              <strong>
                {includePaidOrdersRevenue
                  ? formatEuro(summary.paidOrdersHoneyRevenueEur)
                  : '0,00 € (exclu)'}
              </strong>
            </div>
            <div className={styles.revenueSplitRow}>
              <span>Écritures manuelles</span>
              <strong>{formatEuro(manualTotalRevenuesEur)}</strong>
            </div>
          </div>
        </MetricCard>

        <MetricCard
          testId="accounting-total-expenses"
          label="Dépenses annuelles"
          value={<>{' '}{formatEuro(summary.totalExpensesEur)}</>}
          tone="warning"
          hint={
            <span className="tabular-nums">
              {expenseEntriesCount} dépense(s) enregistrée(s) en {selectedYear}
            </span>
          }
        />

        <MetricCard
          testId="accounting-net-balance"
          label="Résultat net"
          value={<>{' '}{formatSignedNetBalance(summary.netBalanceEur)}</>}
          tone={
            summary.netBalanceEur < 0
              ? 'danger'
              : summary.netBalanceEur > 0
                ? 'honey'
                : 'default'
          }
          hint={
            summary.netBalanceEur < 0
              ? `Déficit sur l'exercice ${selectedYear}`
              : summary.netBalanceEur > 0
                ? `Excédent sur l'exercice ${selectedYear}`
                : `Exercice ${selectedYear} à l'équilibre`
          }
        />
      </div>

      {editorMode !== null && (
        <form
          ref={editorFormRef}
          onSubmit={(e) => void handleSaveEntry(e)}
          className={styles.editorForm}
          noValidate
          aria-labelledby={`${formUid}-entry-form-title`}
        >
          <div className={styles.formHeaderRow}>
            <h2 id={`${formUid}-entry-form-title`} className={styles.formTitle}>
              {editorMode.kind === 'create'
                ? 'Nouvelle écriture comptable'
                : "Modifier l'écriture comptable"}
            </h2>
            <Button variant="ghost" size="compact" onClick={closeEntryEditor}>
              Fermer
            </Button>
          </div>

          {formError && (
            <p role="alert" className={styles.errorAlert}>
              {formError}
            </p>
          )}

          <SegmentedControl<AccountingEntryType>
            label="Nature de l'écriture"
            options={ENTRY_TYPE_OPTIONS}
            value={typeDraft}
            onChange={handleTypeChange}
          />

          <div className={styles.formGrid}>
            <div className={styles.fieldGroup}>
              <label
                htmlFor={`${formUid}-entry-category`}
                className={styles.fieldLabel}
              >
                Catégorie comptable
              </label>
              <select
                id={`${formUid}-entry-category`}
                data-testid="accounting-category-select"
                value={categoryDraft}
                onChange={(e) => {
                  resetEntryRequestId();
                  const val = e.target.value;
                  if (isAccountingCategory(val)) {
                    setCategoryDraft(val);
                  }
                }}
                className={styles.selectInput}
              >
                {availableCategoriesForForm.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.fieldGroup}>
              <label
                htmlFor={`${formUid}-entry-date`}
                className={styles.fieldLabel}
              >
                Date de l&apos;opération
              </label>
              <input
                id={`${formUid}-entry-date`}
                data-testid="accounting-date-input"
                type="date"
                required
                value={dateDraft}
                onChange={(e) => {
                  resetEntryRequestId();
                  setDateDraft(e.target.value);
                }}
                className={cx(styles.textInput, 'tabular-nums')}
              />
            </div>

            <div className={styles.fieldGroup}>
              <label
                htmlFor={`${formUid}-entry-label`}
                className={styles.fieldLabel}
              >
                Libellé / justificatif
              </label>
              <input
                id={`${formUid}-entry-label`}
                data-testid="accounting-label-input"
                type="text"
                required
                placeholder="ex. Achat pots verre 500 g ou Vente essaim"
                value={labelDraft}
                onChange={(e) => {
                  resetEntryRequestId();
                  setLabelDraft(e.target.value);
                }}
                className={styles.textInput}
              />
            </div>

            <div className={styles.fieldGroup}>
              <label
                htmlFor={`${formUid}-entry-amount`}
                className={styles.fieldLabel}
              >
                Montant TTC (€)
              </label>
              <div className={styles.amountInputWrap}>
                <input
                  id={`${formUid}-entry-amount`}
                  data-testid="accounting-amount-input"
                  type="text"
                  inputMode="decimal"
                  required
                  placeholder="ex. 84,50"
                  value={amountDraft}
                  onChange={(e) => {
                    resetEntryRequestId();
                    setAmountDraft(e.target.value);
                  }}
                  className={cx(
                    styles.textInput,
                    styles.amountInput,
                    'tabular-nums',
                  )}
                />
                <span className={styles.currencySuffix} aria-hidden="true">
                  €
                </span>
              </div>
            </div>
          </div>

          <div className={styles.fieldGroup}>
            <label
              htmlFor={`${formUid}-entry-notes`}
              className={styles.fieldLabel}
            >
              Notes complémentaires (optionnel)
            </label>
            <input
              id={`${formUid}-entry-notes`}
              type="text"
              placeholder="ex. Facture n°2026-14, règlement chèque..."
              value={notesDraft}
              onChange={(e) => {
                resetEntryRequestId();
                setNotesDraft(e.target.value);
              }}
              className={styles.textInput}
            />
          </div>

          <div className={styles.formActions}>
            <Button
              variant="secondary"
              onClick={closeEntryEditor}
              disabled={isSavingEntry}
            >
              Annuler
            </Button>
            <Button
              type="submit"
              variant="primary"
              data-testid="accounting-save-btn"
              isLoading={isSavingEntry}
            >
              {editorMode.kind === 'create'
                ? "Ajouter l'écriture"
                : 'Enregistrer les modifications'}
            </Button>
          </div>
        </form>
      )}

      <div className={styles.sectionCard}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>
            Ventilation par catégorie ({selectedYear})
          </h2>
          <p className={styles.sectionDescription}>
            Répartition sur les 7 catégories fermées du plan comptable apicole.
          </p>
        </div>

        <div className={styles.breakdownColumns}>
          <div className={styles.breakdownGroup}>
            <span className={styles.breakdownGroupTitle}>
              Recettes (3 catégories)
            </span>
            <ul className={styles.breakdownList}>
              {revenueBreakdownItems.map((item) => (
                <li key={item.category} className={styles.breakdownItem}>
                  <div className={styles.breakdownTopRow}>
                    <span className={styles.breakdownCategoryName}>
                      {item.category}
                    </span>
                    <span className={cx(styles.breakdownAmount, 'tabular-nums')}>
                      {formatEuro(item.amountEur)}
                    </span>
                  </div>
                  <div className={styles.barTrack} aria-hidden="true">
                    <div
                      className={styles.barFillRevenue}
                      style={{ width: `${item.sharePercent}%` }}
                    />
                  </div>
                  <div className={cx(styles.breakdownMetaRow, 'tabular-nums')}>
                    <span>
                      {item.category === 'Ventes de miel' &&
                      includePaidOrdersRevenue
                        ? `Auto Ventes Miel : ${formatEuro(item.autoSalesAmountEur)} · Manuel : ${formatEuro(item.manualAmountEur)}`
                        : `${item.entriesCount} opération(s)`}
                    </span>
                    <span>
                      {item.sharePercent.toFixed(1).replace('.', ',')} % des
                      recettes
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className={styles.breakdownGroup}>
            <span className={styles.breakdownGroupTitle}>
              Dépenses (4 catégories)
            </span>
            <ul className={styles.breakdownList}>
              {expenseBreakdownItems.map((item) => (
                <li key={item.category} className={styles.breakdownItem}>
                  <div className={styles.breakdownTopRow}>
                    <span className={styles.breakdownCategoryName}>
                      {item.category}
                    </span>
                    <span className={cx(styles.breakdownAmount, 'tabular-nums')}>
                      {formatEuro(item.amountEur)}
                    </span>
                  </div>
                  <div className={styles.barTrack} aria-hidden="true">
                    <div
                      className={styles.barFillExpense}
                      style={{ width: `${item.sharePercent}%` }}
                    />
                  </div>
                  <div className={cx(styles.breakdownMetaRow, 'tabular-nums')}>
                    <span>{item.entriesCount} écriture(s)</span>
                    <span>
                      {item.sharePercent.toFixed(1).replace('.', ',')} % des
                      dépenses
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className={styles.sectionCard}>
        <div className={styles.historyHeaderRow}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>
              Journal des écritures manuelles ({selectedYear})
            </h2>
            <p className={styles.sectionDescription}>
              {filteredYearEntries.length} écriture(s) affichée(s) sur{' '}
              {yearEntries.length} dans <strong>Comptabilité rucher</strong>.
            </p>
          </div>

          <div className={styles.filterWrap}>
            <label
              htmlFor={`${formUid}-category-filter`}
              className={styles.fieldLabel}
            >
              Filtrer par catégorie
            </label>
            <select
              id={`${formUid}-category-filter`}
              data-testid="accounting-category-filter"
              value={categoryFilter}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === 'ALL') {
                  setCategoryFilter('ALL');
                } else if (isAccountingCategory(raw)) {
                  setCategoryFilter(raw);
                }
              }}
              className={styles.selectInput}
            >
              <option value="ALL">Toutes les catégories</option>
              {ACCOUNTING_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
        </div>

        {filteredYearEntries.length === 0 ? (
          <div className={styles.emptyState}>
            Aucune écriture manuelle pour cet exercice et ce filtre.
          </div>
        ) : (
          <div className={styles.entriesList}>
            {filteredYearEntries.map((entry) => {
              const isRevenue = entry.type === 'Recette';
              const isConfirmingDelete = confirmDeleteId === entry.id;

              return (
                <article
                  key={entry.id}
                  data-entry-id={entry.id}
                  className={styles.entryCard}
                >
                  <div className={styles.entryInfo}>
                    <div className={styles.entryTopLine}>
                      <span className={styles.entryLabel}>{entry.label}</span>
                      <span
                        className={cx(
                          styles.entryAmount,
                          isRevenue
                            ? styles.entryAmountRevenue
                            : styles.entryAmountExpense,
                          'tabular-nums',
                        )}
                      >
                        {isRevenue ? '+' : '-'}
                        {formatEuro(entry.amountEur)}
                      </span>
                    </div>

                    <div className={styles.entryMetaRow}>
                      <span
                        className={cx(
                          styles.typePill,
                          isRevenue
                            ? styles.typePillRevenue
                            : styles.typePillExpense,
                        )}
                      >
                        {entry.type}
                      </span>
                      <span className={styles.categoryTag}>
                        {entry.category}
                      </span>
                      <span className="tabular-nums">
                        {formatDisplayDate(entry.date)}
                      </span>
                    </div>

                    {entry.notes && (
                      <p className={styles.entryNotes}>{entry.notes}</p>
                    )}
                  </div>

                  <div className={styles.entryActions}>
                    {isConfirmingDelete ? (
                      <>
                        <Button
                          variant="danger"
                          size="compact"
                          isLoading={deletingId === entry.id}
                          onClick={() => void handleConfirmDelete(entry)}
                        >
                          Confirmer
                        </Button>
                        <Button
                          variant="ghost"
                          size="compact"
                          disabled={deletingId === entry.id}
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          Annuler
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          variant="secondary"
                          size="compact"
                          onClick={() => openEditEntryForm(entry)}
                        >
                          Modifier
                        </Button>
                        <Button
                          variant="ghost"
                          size="compact"
                          onClick={() => setConfirmDeleteId(entry.id)}
                        >
                          Supprimer
                        </Button>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

export default AccountingPage;
