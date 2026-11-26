import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  matchesOrderSearch,
  normalizePhoneNumber,
  normalizeSearchText,
  toPhoneSearchDigits,
} from '@app-icol/shared';
import type {
  CustomerPickerProps,
  CustomerSuggestion,
} from '../../contracts/contacts-ui';
import {
  useData,
  useToast,
  type ToastContextValue,
} from '../../providers';
import { Button, cx } from '../../ui';
import { pickDeviceContact } from './contactPicker';
import styles from './CustomerPicker.module.css';
import { parseVCard } from './vcard';

interface FallbackSuggestions {
  customerSuggestions: CustomerSuggestion[];
  relaySuggestions: string[];
}

function useOptionalDataSuggestions(): FallbackSuggestions {
  try {
    const data = useData();
    return {
      customerSuggestions: data.customerSuggestions,
      relaySuggestions: data.relaySuggestions,
    };
  } catch {
    return {
      customerSuggestions: [],
      relaySuggestions: [],
    };
  }
}

function useOptionalToast(): ToastContextValue | null {
  try {
    return useToast();
  } catch {
    return null;
  }
}

async function readFileAsUtf8Text(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text();
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.onerror = () => {
      reject(new Error('Impossible de lire le fichier sélectionné.'));
    };
    reader.readAsText(file, 'utf-8');
  });
}

function ContactBookIcon(): React.JSX.Element {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a2.5 2.5 0 0 1 0-5H20" />
      <circle cx="12" cy="9.5" r="2.5" />
      <path d="M8.5 15c.7-1.5 2-2.2 3.5-2.2s2.8.7 3.5 2.2" />
    </svg>
  );
}

function VcfImportIcon(): React.JSX.Element {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="18" x2="12" y2="12" />
      <polyline points="9 15 12 12 15 15" />
    </svg>
  );
}

interface ImportFeedback {
  tone: 'info' | 'error';
  text: string;
}

export function CustomerPickerImpl({
  value,
  onChange,
  suggestions,
  relaySuggestions,
  disabled = false,
  errorMessage,
}: CustomerPickerProps): React.JSX.Element {
  const uid = useId();
  const nameInputId = `customer-name-${uid}`;
  const phoneInputId = `customer-phone-${uid}`;
  const relayInputId = `customer-relay-${uid}`;
  const vcfInputId = `import-vcf-${uid}`;
  const listboxId = `customer-autocomplete-${uid}`;
  const relayDatalistId = `customer-relay-datalist-${uid}`;

  const dataSuggestions = useOptionalDataSuggestions();
  const toast = useOptionalToast();

  const resolvedSuggestions = suggestions ?? dataSuggestions.customerSuggestions;
  const resolvedRelays = relaySuggestions ?? dataSuggestions.relaySuggestions;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const vcfInputRef = useRef<HTMLInputElement | null>(null);

  const [activeField, setActiveField] = useState<'name' | 'phone' | null>(null);
  const [isAutocompleteOpen, setIsAutocompleteOpen] = useState<boolean>(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const [isRelayQuickOpen, setIsRelayQuickOpen] = useState<boolean>(false);
  const [isPickingContact, setIsPickingContact] = useState<boolean>(false);
  const [importFeedback, setImportFeedback] = useState<ImportFeedback | null>(null);

  useEffect(() => {
    const onPointerDownOutside = (event: MouseEvent | TouchEvent): void => {
      const target = event.target as Node | null;
      if (target && containerRef.current && !containerRef.current.contains(target)) {
        setIsAutocompleteOpen(false);
        setHighlightedIndex(-1);
        setIsRelayQuickOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDownOutside);
    document.addEventListener('touchstart', onPointerDownOutside, { passive: true });
    return () => {
      document.removeEventListener('mousedown', onPointerDownOutside);
      document.removeEventListener('touchstart', onPointerDownOutside);
    };
  }, []);

  const matchingSuggestions = useMemo<CustomerSuggestion[]>(() => {
    if (!isAutocompleteOpen || disabled || resolvedSuggestions.length === 0) {
      return [];
    }

    if (activeField === 'phone') {
      if (value.customerName.trim()) {
        return [];
      }
      const queryDigits = toPhoneSearchDigits(value.phone);
      if (queryDigits.length < 2 || !/\d/.test(value.phone)) {
        return [];
      }
      return resolvedSuggestions
        .filter((entry) => toPhoneSearchDigits(entry.phone).includes(queryDigits))
        .slice(0, 12);
    }

    if (activeField !== 'name') {
      return [];
    }

    const rawQuery = value.customerName.trim();
    if (!rawQuery) {
      return resolvedSuggestions.slice(0, 8);
    }

    const normQuery = normalizeSearchText(rawQuery);
    const filtered = resolvedSuggestions.filter((entry) =>
      matchesOrderSearch(
        {
          customerName: entry.customerName,
          phone: entry.phone,
          contextOrRelay: entry.lastContextOrRelay,
        },
        rawQuery,
      ),
    );

    filtered.sort((a, b) => {
      if (normQuery) {
        const aPrefix = normalizeSearchText(a.customerName).startsWith(normQuery);
        const bPrefix = normalizeSearchText(b.customerName).startsWith(normQuery);
        if (aPrefix !== bPrefix) return aPrefix ? -1 : 1;
      }
      return 0;
    });

    return filtered.slice(0, 12);
  }, [
    isAutocompleteOpen,
    disabled,
    resolvedSuggestions,
    activeField,
    value.customerName,
    value.phone,
  ]);

  const filteredRelayQuickOptions = useMemo<string[]>(() => {
    if (!isRelayQuickOpen || disabled || resolvedRelays.length === 0) {
      return [];
    }
    const normCurrent = normalizeSearchText(value.contextOrRelay);
    return resolvedRelays
      .filter((relay) => {
        const normRelay = normalizeSearchText(relay);
        if (!normCurrent) return true;
        return normRelay.includes(normCurrent) && normRelay !== normCurrent;
      })
      .slice(0, 6);
  }, [isRelayQuickOpen, disabled, resolvedRelays, value.contextOrRelay]);

  const handleSelectSuggestion = (entry: CustomerSuggestion): void => {
    setImportFeedback(null);
    setIsAutocompleteOpen(false);
    setHighlightedIndex(-1);
    onChange({
      customerName: entry.customerName,
      phone: normalizePhoneNumber(entry.phone),
      contextOrRelay: entry.lastContextOrRelay || value.contextOrRelay,
    });
  };

  const handleAutocompleteKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
  ): void => {
    if (e.key === 'Escape') {
      if (isAutocompleteOpen) {
        e.stopPropagation();
        setIsAutocompleteOpen(false);
        setHighlightedIndex(-1);
      }
      return;
    }

    if (!isAutocompleteOpen || matchingSuggestions.length === 0) {
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev < matchingSuggestions.length - 1 ? prev + 1 : 0,
      );
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev > 0 ? prev - 1 : matchingSuggestions.length - 1,
      );
      return;
    }

    if (
      e.key === 'Enter' &&
      highlightedIndex >= 0 &&
      highlightedIndex < matchingSuggestions.length
    ) {
      e.preventDefault();
      handleSelectSuggestion(matchingSuggestions[highlightedIndex]!);
    }
  };

  const handleContactPickerClick = async (): Promise<void> => {
    if (disabled || isPickingContact) return;
    setImportFeedback(null);
    setIsAutocompleteOpen(false);
    setIsPickingContact(true);

    try {
      const result = await pickDeviceContact({
        onOpenVcfFallback: () => {
          vcfInputRef.current?.click();
        },
      });

      if (result.status === 'selected') {
        const nextName = result.contact.fullName || value.customerName;
        const nextPhone = result.contact.phone || value.phone;
        onChange({
          customerName: nextName,
          phone: nextPhone,
          contextOrRelay: value.contextOrRelay,
        });
        toast?.success(
          'Contact sélectionné',
          result.contact.fullName || result.contact.phone,
        );
        return;
      }

      if (result.status === 'unsupported-fallback') {
        setImportFeedback({
          tone: 'info',
          text: result.message,
        });
        toast?.info('Import .vcf de secours', result.message);
        return;
      }

      if (result.status === 'empty' || result.status === 'error') {
        setImportFeedback({
          tone: 'error',
          text: result.message,
        });
        toast?.error('Import du contact impossible', result.message);
      }
    } finally {
      setIsPickingContact(false);
    }
  };

  const handleVcfFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || disabled) return;

    try {
      const rawText = await readFileAsUtf8Text(file);
      const parsed = parseVCard(rawText);
      setImportFeedback(null);
      setIsAutocompleteOpen(false);
      setHighlightedIndex(-1);

      onChange({
        customerName: parsed.fullName || value.customerName,
        phone: parsed.phone || value.phone,
        contextOrRelay: parsed.contextOrRelay || value.contextOrRelay,
      });
      toast?.success(
        'Fiche .vcf importée',
        parsed.fullName || parsed.phone,
      );
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Le fichier sélectionné ne correspond pas à une fiche vCard (.vcf) valide.';
      setImportFeedback({
        tone: 'error',
        text: message,
      });
      toast?.error('Fichier .vcf invalide', message);
    }
  };

  const handleContainerBlur = (e: React.FocusEvent<HTMLDivElement>): void => {
    const nextFocused = e.relatedTarget as Node | null;
    if (!nextFocused || !containerRef.current?.contains(nextFocused)) {
      setIsAutocompleteOpen(false);
      setHighlightedIndex(-1);
      setIsRelayQuickOpen(false);
    }
  };

  const showDropdown = isAutocompleteOpen && matchingSuggestions.length > 0;

  return (
    <div
      ref={containerRef}
      onBlur={handleContainerBlur}
      className={styles.pickerCard}
    >
      <div className={styles.headerRow}>
        <h2 className={styles.sectionTitle}>Acheteur &amp; remise</h2>
      </div>

      <div className={styles.actionsRow}>
        <Button
          variant="secondary"
          size="compact"
          disabled={disabled}
          isLoading={isPickingContact}
          leftIcon={<ContactBookIcon />}
          data-testid="contact-picker-btn"
          onClick={() => {
            void handleContactPickerClick();
          }}
          className={styles.actionBtn}
        >
          Choisir dans mes contacts
        </Button>

        <Button
          variant="ghost"
          size="compact"
          disabled={disabled}
          leftIcon={<VcfImportIcon />}
          onClick={() => {
            setImportFeedback(null);
            vcfInputRef.current?.click();
          }}
          className={styles.vcfBtn}
        >
          Importer .vcf
        </Button>

        <label htmlFor={vcfInputId} className="sr-only">
          Importer une fiche contact vCard (.vcf)
        </label>
        <input
          ref={vcfInputRef}
          id={vcfInputId}
          data-testid="import-vcf-input"
          type="file"
          accept=".vcf,text/vcard"
          disabled={disabled}
          onChange={(e) => {
            void handleVcfFileChange(e);
          }}
          className={styles.hiddenFileInput}
        />
      </div>

      {importFeedback && (
        <p
          role={importFeedback.tone === 'error' ? 'alert' : 'status'}
          className={cx(
            styles.feedbackBanner,
            importFeedback.tone === 'error'
              ? styles.feedbackError
              : styles.feedbackInfo,
          )}
        >
          {importFeedback.text}
        </p>
      )}

      <div className={styles.fieldGroup}>
        <label htmlFor={nameInputId} className={styles.label}>
          <span>Client ou vente directe</span>
          <span className={styles.optionalHint}>Nom ou n° tél.</span>
        </label>
        <input
          id={nameInputId}
          data-testid="customer-name-input"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showDropdown && activeField === 'name'}
          aria-controls={
            showDropdown && activeField === 'name' ? listboxId : undefined
          }
          autoComplete="off"
          disabled={disabled}
          value={value.customerName}
          placeholder="Ex. Élodie Bénard ou Vente directe marché"
          onFocus={() => {
            setActiveField('name');
            setIsAutocompleteOpen(true);
            setIsRelayQuickOpen(false);
            setHighlightedIndex(-1);
          }}
          onChange={(e) => {
            setImportFeedback(null);
            setActiveField('name');
            setIsAutocompleteOpen(true);
            setHighlightedIndex(-1);
            onChange({ ...value, customerName: e.target.value });
          }}
          onKeyDown={handleAutocompleteKeyDown}
          className={styles.input}
        />

        {showDropdown && activeField === 'name' && (
          <ul
            id={listboxId}
            role="listbox"
            aria-label="Clients connus"
            data-testid="customer-autocomplete-list"
            className={styles.autocompleteList}
          >
            {matchingSuggestions.map((entry, idx) => {
              const isHighlighted = idx === highlightedIndex;
              return (
                <li
                  key={`${entry.customerName}-${entry.phone}-${idx}`}
                  role="presentation"
                  className={styles.suggestionListItem}
                >
                  <button
                    type="button"
                    role="option"
                    aria-selected={isHighlighted}
                    data-testid="customer-suggestion-item"
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={() => handleSelectSuggestion(entry)}
                    className={cx(
                      styles.suggestionBtn,
                      isHighlighted && styles.suggestionBtnActive,
                    )}
                  >
                    <span className={styles.suggestionPrimaryRow}>
                      <span className={styles.suggestionName}>
                        {entry.customerName}
                      </span>
                      <span className={styles.suggestionOrdersCount}>
                        {entry.ordersCount}{' '}
                        {entry.ordersCount > 1 ? 'achats' : 'achat'}
                      </span>
                    </span>
                    {(entry.phone || entry.lastContextOrRelay) && (
                      <span className={styles.suggestionMetaRow}>
                        {entry.phone && (
                          <span className={styles.suggestionPhone}>
                            {entry.phone}
                          </span>
                        )}
                        {entry.lastContextOrRelay && (
                          <span className={styles.suggestionRelayBadge}>
                            {entry.lastContextOrRelay}
                          </span>
                        )}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className={styles.secondaryFieldsGrid}>
        <div className={styles.fieldGroup}>
          <label htmlFor={phoneInputId} className={styles.label}>
            <span>Téléphone</span>
            <span className={styles.optionalHint}>Optionnel</span>
          </label>
          <input
            id={phoneInputId}
            data-testid="customer-phone-input"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            disabled={disabled}
            value={value.phone}
            placeholder="06 12 34 56 78"
            onFocus={() => {
              setActiveField('phone');
              setIsRelayQuickOpen(false);
              setHighlightedIndex(-1);
              if (!value.customerName.trim() && value.phone.trim()) {
                setIsAutocompleteOpen(true);
              } else {
                setIsAutocompleteOpen(false);
              }
            }}
            onChange={(e) => {
              const nextPhone = e.target.value;
              setImportFeedback(null);
              setActiveField('phone');
              setHighlightedIndex(-1);
              if (!value.customerName.trim() && toPhoneSearchDigits(nextPhone).length >= 2) {
                setIsAutocompleteOpen(true);
              } else {
                setIsAutocompleteOpen(false);
              }
              onChange({ ...value, phone: nextPhone });
            }}
            onBlur={() => {
              const normalized = normalizePhoneNumber(value.phone);
              if (normalized !== value.phone) {
                onChange({ ...value, phone: normalized });
              }
            }}
            onKeyDown={handleAutocompleteKeyDown}
            className={cx(styles.input, styles.phoneInput)}
          />

          {showDropdown && activeField === 'phone' && (
            <ul
              id={listboxId}
              role="listbox"
              aria-label="Clients correspondants au téléphone"
              data-testid="customer-autocomplete-list"
              className={styles.autocompleteList}
            >
              {matchingSuggestions.map((entry, idx) => {
                const isHighlighted = idx === highlightedIndex;
                return (
                  <li
                    key={`${entry.customerName}-${entry.phone}-${idx}`}
                    role="presentation"
                    className={styles.suggestionListItem}
                  >
                    <button
                      type="button"
                      role="option"
                      aria-selected={isHighlighted}
                      data-testid="customer-suggestion-item"
                      onMouseDown={(ev) => ev.preventDefault()}
                      onClick={() => handleSelectSuggestion(entry)}
                      className={cx(
                        styles.suggestionBtn,
                        isHighlighted && styles.suggestionBtnActive,
                      )}
                    >
                      <span className={styles.suggestionPrimaryRow}>
                        <span className={styles.suggestionName}>
                          {entry.customerName}
                        </span>
                        <span className={styles.suggestionOrdersCount}>
                          {entry.ordersCount}{' '}
                          {entry.ordersCount > 1 ? 'achats' : 'achat'}
                        </span>
                      </span>
                      {(entry.phone || entry.lastContextOrRelay) && (
                        <span className={styles.suggestionMetaRow}>
                          {entry.phone && (
                            <span className={styles.suggestionPhone}>
                              {entry.phone}
                            </span>
                          )}
                          {entry.lastContextOrRelay && (
                            <span className={styles.suggestionRelayBadge}>
                              {entry.lastContextOrRelay}
                            </span>
                          )}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className={styles.fieldGroup}>
          <label htmlFor={relayInputId} className={styles.label}>
            <span>Lieu / Personne relais</span>
            <span className={styles.optionalHint}>Optionnel</span>
          </label>
          <input
            id={relayInputId}
            data-testid="customer-relay-input"
            type="text"
            list={resolvedRelays.length > 0 ? relayDatalistId : undefined}
            autoComplete="off"
            disabled={disabled}
            value={value.contextOrRelay}
            placeholder="Ex. Marché d'Épinal, AMAP, Bureau..."
            onFocus={() => {
              setIsAutocompleteOpen(false);
              setHighlightedIndex(-1);
              setIsRelayQuickOpen(true);
            }}
            onChange={(e) => {
              setImportFeedback(null);
              setIsRelayQuickOpen(true);
              onChange({ ...value, contextOrRelay: e.target.value });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && isRelayQuickOpen) {
                e.stopPropagation();
                setIsRelayQuickOpen(false);
              }
            }}
            className={styles.input}
          />
          {resolvedRelays.length > 0 && (
            <datalist id={relayDatalistId}>
              {resolvedRelays.map((relay) => (
                <option key={relay} value={relay} />
              ))}
            </datalist>
          )}

          {filteredRelayQuickOptions.length > 0 && (
            <div
              className={styles.relayQuickList}
              aria-label="Lieux et relais habituels"
            >
              {filteredRelayQuickOptions.map((relay) => (
                <button
                  key={relay}
                  type="button"
                  onMouseDown={(ev) => ev.preventDefault()}
                  onClick={() => {
                    setIsRelayQuickOpen(false);
                    onChange({ ...value, contextOrRelay: relay });
                  }}
                  className={styles.relayQuickBtn}
                >
                  {relay}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {errorMessage && (
        <p role="alert" className={styles.errorText}>
          {errorMessage}
        </p>
      )}
    </div>
  );
}
