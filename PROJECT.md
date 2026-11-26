# Project: App-icol — Application Web Mobile-First de Gestion des Ventes de Miel & du Rucher

## Architecture

### Overview (Option A — Validated User Architecture)
**App-icol** is a Mobile-First Progressive Web Application (PWA) monorepo coupled with a Google Apps Script Web App API (`clasp`) backed by the Google Sheets workbook **« Vente et reservations Miel »**, plus a complete offline-capable `MockSheetsRepository` and dynamic header-name schema adapter (`schema.config.ts`) for autonomous development and testing prior to connecting the production spreadsheet.

```
packages/
├── shared/     # @app-icol/shared — Strict domain types, pure calculators, vCard-ready phone/text normalizers,
│               #   dynamic Sheets schema/alias config (8 ALLOWED + 4 FORBIDDEN tabs), GAS RPC wire contracts, seedData
├── gas-api/    # @app-icol/gas-api — Google Apps Script V8 backend (doPost text/plain CORS-safe JSON RPC, GIS idToken
│               #   AuthVerifier, LockService + CacheService idempotency, SheetGuard, HeaderResolver, FormulaPreserver,
│               #   inspectSheetStructure, esbuild -> dist/Code.gs + local HTTP mock runner serve-local-gas.mjs)
└── web/        # @app-icol/web — Vite + React 19 + TypeScript + Modular Vanilla CSS (NO Tailwind) Mobile-First PWA
                #   (Design System "Ambre Solaire & Ardoise Chaude", UI primitives, DataProvider, AuthProvider,
                #   ToastProvider, AppShell + hash router, and isolated feature modules: contacts, dashboard,
                #   sale-form, orders, harvests, accounting)
```

### Core Immutable Domain & Technical Invariants
1. **Rule #1 — `Réservé` Consumes Stock Immediately**: `committedWeightKg` sums `computedWeightKg` across ALL orders (`Réservé` and `Distribué`, including `Payé`, `Non-payé`, and `Donné`). Moving an order from `Réservé` to `Distribué` decrements `pendingDeliveryOrdersCount` (`-1`) and NEVER double-deducts stock.
2. **Rule #2 — `Donné` Consumes Stock, Never Enters Revenue or Unpaid Balance**: When `paymentStatus === 'Donné'`, `effectiveAmountEur` is strictly `0 €` (even if `manualAmountOverrideEur` was set; `computedAmountEur` remains informative), `paidAmountEur` and `unpaidAmountEur` exclude it, `transferStatus` normalizes to `'Non concerné'`, and donated volume is surfaced separately (`donatedJarsCount`, `donatedWeightKg`).
3. **Rule #3 — Systematic Input Hygiene**: Phone numbers imported via Contact Picker or `.vcf` (or typed manually) strip Unicode bidi/invisible chars and normalize French numbers (`+33`, `0033`, `06.xx`, or 9-digit Sheets integers stripped of leading `0`) to `06 XX XX XX XX` while preserving international `+CC` numbers (`+41 ...`). Harvest labels always apply `normalizeHarvestLabel()` (trim + collapse internal whitespace). French decimals (`"12,50 €"`, `"1\u202F234,5 kg"`) parse cleanly via `parseFrenchDecimal()`.
4. **Rule #4 — Closed Referentials**:
   - `OrderStatus`: `'Réservé' | 'Distribué'` (no `'Annulé'` status; accidental orders are edited or removed via manager-only `deleteOrder` with confirmation).
   - `PaymentStatus`: `'Non-payé' | 'Payé' | 'Donné'`.
   - `TransferStatus`: `'Non concerné' | 'À reverser' | 'Reversé'` — `'À reverser'` or `'Reversé'` is valid ONLY when `paymentStatus === 'Payé'` AND `collectedByThirdParty === true` (otherwise normalized to `'Non concerné'`). When a `contributor` creates a `'Payé'` order OR triggers 1-click `Passer à Payé`, `collectedByThirdParty = true`, `collectorName = session.displayName`, and `transferStatus = 'À reverser'` auto-activate. Both `manager` and `contributor` may trigger `Marquer Reversé`.
   - `AccountingCategory` (7 closed categories): `'Ventes de miel' | "Ventes d'essaims" | 'Autres recettes' | 'Investissements matériel / reines' | 'Consommables (sirop, sucre, traitements)' | 'Conditionnement (pots, étiquettes)' | 'Charges et cotisations'`.
5. **Rule #5 — Flaky Mobile Network Resilience**: Every mutation displays explicit loading + success/error Toast feedback, preserves user form input locally (`useSaleDraftPersistence` in `localStorage`) on network failure, rolls back failed 1-click optimistic mutations, and sends a stable `clientRequestId` so retries are deduplicated.
6. **Google Sheets Integrity (`SheetGuard` + `HeaderResolver` + `FormulaPreserver`)**:
   - **8 `ALLOWED_SHEETS` (exact spellings)**: `'Ventes Miel'`, `'ParRecoltes'`, `'ParCommandes'`, `'ParPaiement'`, `'ParArticles'`, `'PUan'`, `'Gestion recoltes'` (no accent), `'Comptabilité rucher'` (accented).
   - **4 `FORBIDDEN_SHEETS` (hard-blocked prior to any read/write)**: `'App: Logins'`, `'App: Metadata'`, `'ParNbPots'`, `'TEST - NE PAS TOUCHER'` (plus Markdown-escaped/unicode dash variants).
   - Dynamic Row 1 header resolution (`HeaderResolver`) — never fixed column indices.
   - `FormulaPreserver`: preserves both column `ARRAYFORMULA` and per-row `R1C1` formulas on `Poids (Kg)` and `Prix` (restoring `R1C1` when manual price override reverts to auto), enforces `'@'` text number format on phone cells before writing so leading `0`s are preserved, blocks writes to formula-driven `Par*` summary sheets (and checks `ParArticles` dynamically before `formats.upsert`), and supports both `columns_per_format` and `row_per_item` layouts.
7. **Environment & Governance Guardrails**:
   - `/home/antigravity` is `$HOME`: `.gitignore` MUST exclude `/.agents/`, `/.gemini/`, `/.android/`, `/.gradle/`, `/.cache/`, `/.npm/`, `/.config/`, `/.local/`, dotfiles, and `.clasprc.json`.
   - NEVER create `AGENTS.md` or `GEMINI.md` anywhere, and NEVER write files or set `TMPDIR` under `/tmp` (all scripts use `/home/antigravity/.gemini/jetski/scratch/teamwork_tmp/r-<pid>`).
   - Pin `"@playwright/test": "1.65.1"` (exact) to bind to `/opt/ms-playwright/*-1255` with zero browser download (`headless: true`, `--no-sandbox`, never `channel: 'chrome'`).

---

## Feature Inventory

Every Survey feature (`survey_1`, `survey_2`, `survey_3`) is mapped below with zero unassigned items:

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F-01 | Authentication & Role-Based Access Control (§2) | Google Identity Services (`idToken`) + GAS `AuthVerifier` email allowlist (`MANAGER_EMAILS` / `CONTRIBUTOR_EMAILS`), mock persona switcher (`manager` / `contributor` / signed-out), 5-tab `manager` navigation vs 3-tab `contributor` navigation, backend `FORBIDDEN_ROLE` enforcement on harvests/formats/accounting/admin RPCs. | M1, M2 | survey_1 (F-01..03), survey_2 (#12) |
| F-02 | Season Dashboard: Stock & Harvest Gauges (§3.1) | Harvest selector defaulting to `isDefaultActive` + *"Toutes les récoltes"*, visual stock gauge (`realizedWeightKg` vs badged `forecastWeightKg` fallback, `committedWeightKg` = `Réservé + Distribué + Donné`, `availableWeightKg` with signed overbooking warning, and jar-format equivalents). | M1, M4 | survey_1 (F-04..05), survey_2 (#9) |
| F-03 | Season Dashboard: Financial KPIs, `Donné`, Transfers & Logistics (§3.1) | `Payé` collected revenue, `Non-payé` receivables, dedicated `Donné` callout (`X pots / Y kg — 0 € hors CA`), clickable `À reverser` co-seller transfer alert, clickable `Réservé` pending delivery counter opening pre-filtered Orders view, and quick *Nouvelle vente* CTA pre-filled with selected harvest. | M1, M4 | survey_1 (F-06..09), survey_2 (#9) |
| F-04 | Customer Directory, Mobile Contact Picker & Relay Memory (§3.2, §4) | Buyer autocomplete derived from `Ventes Miel` history (`extractCustomerDirectory`, pre-filling phone + usual relay), `navigator.contacts.select` Contact Picker with automatic iOS/Desktop `.vcf` fallback, free-text entry (*Vente directe*, *Marché*) + relay suggestions, and `normalizePhoneNumber` (FR `06 XX...`, `+CC`, strip invisible Unicode). | M1, M3 | survey_1 (F-10,11,14,15), survey_2 (#5,#10) |
| F-05 | vCard `.vcf` Import & Export Codec (§3.2, §3.4) | Standards-compliant vCard 2.1 / 3.0 / 4.0 parser (`parseVCard`: RFC 6350 line unfolding, `ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8`, `CELL`/`PREF` tel priority) and UTF-8 `.vcf` exporter (`serializeVCard` + `navigator.share({ files })` with automatic `.vcf` download fallback). | M3 | survey_1 (F-12..13), survey_2 (#10) |
| F-06 | Rapid Sale/Reservation Entry, Tariffs, Price Override & Edit Mode (§3.3) | <=10s mobile-first form, local-timezone today default, `<CustomerPicker />`, harvest selector, `52px` `-`/`+` jar steppers with `PUan` unit prices, sticky real-time weight (kg) & amount (€) banner, `parseFrenchDecimal` manual price override + *"Revenir au tarif auto"* reset, full Edit mode preserving historical `OrderLineItem` price/weight snapshots, and manager-only `deleteOrder` confirmation. | M1, M5 | survey_1 (F-16,17,20), survey_2 (#6,#9) |
| F-07 | Order/Payment/Transfer Statuses & Resilient Offline Drafts (§3.3, §4, §5.2) | Tactile `SegmentedControl` for `Réservé`\|`Distribué` and `Non-payé`\|`Payé`\|`Donné` (showing `0,00 € à encaisser — Offert` when `Donné`), third-party collector & `À reverser`\|`Reversé` controls (auto-prefilled for paid `contributor` sales, cleared if unpaid/donated), `useSaleDraftPersistence` (`localStorage` auto-save preserved across network failures), and idempotent `clientRequestId` submission. | M1, M5 | survey_1 (F-18,19,21), survey_2 (#13,#15) |
| F-08 | Orders List, Search, Combinable Filters & 1-Click Actions (§3.4) | Instant accent-insensitive name search (`normalizeSearchText`) & de-formatted/formatted phone search (`toPhoneSearchDigits`), combinable quick filter chips (`À livrer (Réservé)` with badge, `À encaisser (Non-payé)`, `À reverser (Tiers)`, `Récolte`, `Lieu / Relais`), compact order cards with `tel:` link, and 1-click mutations (`Passer à Distribué`, `Passer à Payé`, `Marquer Reversé`, `<ExportVcfButton />`, `Modifier`) with card spinner, Toast confirmation, and optimistic rollback on failure. | M5 | survey_1 (F-22..25), survey_3 (§4.3) |
| F-09 | Harvest Tracking, `PUan` Tariffs & `ParArticles` Formats (§3.5) | Manager-only Harvests view: create/edit harvests with `normalizeHarvestLabel`, set single `isDefaultActive` harvest, edit per-harvest unit prices per jar format (`PUan`), activate/add jar formats (`ParArticles`), and edit `forecastWeightKg` & `realizedWeightKg` (`null` vs `0`) with comparative committed-weight progress bar. | M6 | survey_1 (F-26..28), survey_2 (#5,#6) |
| F-10 | Apiary Accounting & Fiscal Year Summary (§3.6) | Manager-only Accounting view: fiscal year selector, annual summary separating `Ventes Miel` `Payé` honey revenue (attributed by `order.date` year; `Donné`/`Non-payé` excluded) from manual `Comptabilité rucher` entries with explicit `includePaidOrdersRevenue` toggle to prevent double-counting, visual breakdown across all 7 closed categories, and add/edit/delete/filter entries. | M1, M6 | survey_1 (F-29..30), survey_2 (EC-11) |
| F-11 | Google Apps Script API, `SheetGuard`, `FormulaPreserver` & `DEPLOY.md` (§5.1, Option A) | `SheetGuard` (8 allowed + 4 forbidden tabs), `HeaderResolver`, `FormulaPreserver` (`R1C1`/`ARRAYFORMULA`, `'@'` phone format, `Par*` summary write block, `columns_per_format`/`row_per_item` codec, `inspectSheetStructure()`), CORS-safe `doPost` (`text/plain;charset=utf-8`), `LockService` + `CacheService` idempotency + row fingerprint check, `esbuild` `dist/Code.gs` + `appsscript.json` + `.clasp.json.example`, local HTTP server `serve-local-gas.mjs`, and 5-minute `DEPLOY.md`. | M1, M2 | survey_1 (F-31), survey_2 (#1..8,#11..14) |
| F-12 | Mobile-First Vanilla CSS Design System, PWA Shell, Mock Data & E2E Hardening (§5.2) | *Ambre Solaire & Ardoise Chaude* Vanilla CSS (no Tailwind, `>=48px` touch targets, `tabular-nums`), UI component library, responsive `AppShell` + hash router (`base: './'`), PWA manifest & offline static asset service worker, `MockSheetsRepository` (`localStorage` + fixture reset + `offlineMode`/`failNextWrite` simulator), `$HOME`-safe scratch/Playwright harness, 100% Tiers 1–4 E2E pass, and Tier 5 white-box adversarial coverage hardening. | M1, M7 | survey_1 (F-32), survey_2 (#15,#16), survey_3 (§2,§4,§5) |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Monorepo Foundation, Shared Domain, Design System, PWA Shell & Mock Data (`Wave 0`) | `.gitignore` (`$HOME`-safe), root configs (`package.json`, `tsconfig*.json`, `vitest.config.ts`, `playwright.config.ts`), `scripts/{with-scratch-tmp.mjs,run-e2e.mjs}`, `packages/shared/**`, `packages/web` Design System + UI primitives + `DataProvider`/`AuthProvider`/`ToastProvider` + `AppShell`/`navigation.ts` + PWA manifest/SW + `contacts-ui.ts`/`public.tsx` + compile-clean stubs for Wave 1 pages & `packages/gas-api` package skeleton | none | IN_PROGRESS (`2b9c27e3fa00d79e1692f071bc00e1bf`) |
| M2 | Google Apps Script Backend, SheetGuard, FormulaPreserver & Deployment Guide | `packages/gas-api/**` (`SheetGuard`, `HeaderResolver`, `FormulaPreserver`, `AuthVerifier`, `doPost` RPC router, `LockService`+`CacheService` idempotency, `inspectSheetStructure`, `esbuild` -> `dist/Code.gs`, `appsscript.json`, `.clasp.json.example`, `MockSpreadsheetApp` unit tests, `scripts/serve-local-gas.mjs`) + `/home/antigravity/DEPLOY.md` | M1 | PLANNED |
| M3 | Customer Directory, Mobile Contact Picker & vCard `.vcf` Suite | `packages/web/src/features/contacts/**` (excluding locked `public.tsx`): `vcard.ts` (2.1/3.0/4.0 + Quoted-Printable UTF-8 import & share/download export), `contactPicker.ts` (with iOS/Desktop `.vcf` fallback), `CustomerPickerImpl.tsx`, `ExportVcfButtonImpl.tsx`, co-located tests & CSS modules | M1 | PLANNED |
| M4 | Season Dashboard (`features/dashboard`) | `packages/web/src/features/dashboard/**`: `DashboardPage.tsx` (harvest selector + *"Toutes les récoltes"*, realized/forecast stock gauge + jar equivalents, `Payé`/`Non-payé`/separate `Donné` financial KPIs, clickable `À reverser` alert, clickable `Réservé` logistics counter, quick *Nouvelle vente* CTA), co-located tests & CSS modules | M1 | PLANNED |
| M5 | Sales Entry/Edit & Orders Tracking (`features/sale-form` + `features/orders`) | `packages/web/src/features/sale-form/**` (`SaleFormPage.tsx`, `52px` steppers, real-time totals & manual price override, status/transfer controls, Edit + manager `deleteOrder`, `useSaleDraftPersistence`) AND `packages/web/src/features/orders/**` (`OrdersPage.tsx`, accent/phone search, combinable filter chips, compact cards, 1-click mutations with rollback) | M1 | PLANNED |
| M6 | Manager Back-Office: Harvests (`3.5`) & Apiary Accounting (`3.6`) | `packages/web/src/features/harvests/**` (`HarvestsPage.tsx`: CRUD harvests, `PUan` unit prices, `ParArticles` formats, forecast/realized/committed bar) AND `packages/web/src/features/accounting/**` (`AccountingPage.tsx`: fiscal year summary, anti-double-counting honey revenue toggle, 7-category breakdown, CRUD/filter entries) | M1 | PLANNED |
| M7 | Final Milestone — E2E Pass (Tiers 1–4) & Adversarial Coverage Hardening (Tier 5) | Phase 1: Pass 100% of E2E Testing Track suite (`TEST_READY.md` Tiers 1–4 across mobile PWA & local GAS HTTP backend), fixing any integration defects; Phase 2: White-box Tier 5 adversarial coverage hardening (`Challenger -> Worker -> Verifier Wave` until 0 gaps remain) | M1, M2, M3, M4, M5, M6 + `TEST_READY.md` | PLANNED |

*(Parallel Dual Track: **E2E Testing Orchestrator** [`5fa23592ad02933e4e13859b42e769d3`, `IN_PROGRESS`] owns `/home/antigravity/e2e/**`, `/home/antigravity/TEST_INFRA.md`, and `/home/antigravity/TEST_READY.md`, designing requirement-driven opaque-box tests across Tiers 1–4 in parallel with M1–M6.)*

---

## Interface Contracts

### 1. `@app-icol/shared` <-> `@app-icol/web` & `@app-icol/gas-api`
- **Domain Entities (`packages/shared/src/types/domain.ts`)**:
  - `UserRole = 'manager' | 'contributor'`, `OrderStatus = 'Réservé' | 'Distribué'`, `PaymentStatus = 'Non-payé' | 'Payé' | 'Donné'`, `TransferStatus = 'Non concerné' | 'À reverser' | 'Reversé'`, `AccountingEntryType = 'Recette' | 'Dépense'`, `AccountingCategory` (7 literal union members).
  - `UserSession`, `JarFormat`, `Harvest`, `OrderLineItem` (stores snapshotted `unitWeightKg` and `unitPriceEur`), `SaleOrder` (includes `computedWeightKg`, `computedAmountEur`, `manualAmountOverrideEur`, `effectiveAmountEur`, `collectedByThirdParty`, `collectorName`, `transferStatus`), `AccountingEntry`.
- **Repository & GAS Wire Protocol (`packages/shared/src/types/repository.ts` & `api.ts`)**:
  - `DataRepository` (17 methods implemented identically by `MockSheetsRepository` and `GasApiClient`):
    - Reads: `getDataset`, `listFormats`, `listHarvests`, `listOrders`, `getOrderById`, `listAccountingEntries`.
    - Sales/Orders (`manager` + `contributor`, except `deleteOrder` which is `manager`-only): `createOrder`, `updateOrder`, `patchOrderStatuses`, `deleteOrder`.
    - Harvests & Formats (`manager`-only): `createHarvest`, `updateHarvest`, `setDefaultActiveHarvest`, `upsertJarFormat`.
    - Accounting (`manager`-only): `createAccountingEntry`, `updateAccountingEntry`, `deleteAccountingEntry`.
    - Auth & Admin: `verifySession`, `inspectSheetStructure` (`manager`-only).
  - `GasRpcRequest`: HTTP `POST` with `Content-Type: text/plain;charset=utf-8` and `redirect: 'follow'`, JSON body `{ action: GasRpcAction, idToken?: string, clientRequestId: string, payload: TPayload }`.
  - `GasRpcResponse<TData>`: `{ ok: true, data: TData, deduplicated?: boolean, serverTimestamp: string } | { ok: false, error: { code: GasErrorCode, message: string, details?: unknown } }` where `GasErrorCode` covers `'UNAUTHENTICATED' | 'FORBIDDEN_ROLE' | 'FORBIDDEN_SHEET' | 'UNLISTED_SHEET' | 'READ_ONLY_SUMMARY_SHEET' | 'SCHEMA_MISMATCH' | 'CONCURRENT_MODIFICATION' | 'VALIDATION_ERROR' | 'NOT_FOUND' | 'LOCK_TIMEOUT' | 'NETWORK_ERROR' | 'SERVER_MISCONFIGURED' | 'INTERNAL_ERROR'`.
- **Pure Domain Calculators (`packages/shared/src/domain/calculators.ts`)**:
  - `computeOrderTotals(items, harvest, formats, paymentStatus, manualOverrideEur)`
  - `normalizeOrderTransferState(paymentStatus, collectedByThirdParty, collectorName, transferStatus, actorSession?)`
  - `computeHarvestDashboardMetrics(harvestOrNullForAll, orders, allHarvests, formats)`
  - `computeAnnualAccountingSummary(year, entries, orders, options: { includePaidOrdersRevenue: boolean })`
  - `extractCustomerDirectory(orders)` & `extractRelaySuggestions(orders)`
  - `normalizePhoneNumber(raw)`, `toPhoneSearchDigits(raw)`, `normalizeSearchText(raw)`, `normalizeHarvestLabel(raw)`, `parseFrenchDecimal(raw)`, `formatEuro(amount)`, `formatWeightKg(kg)`, `getLocalTodayIsoDate()`.

### 2. `@app-icol/web` Shell, Providers & Feature Contracts
- **`DataProvider` (`useData()`)**: Reactive `formats`, `activeFormats`, `harvests`, `defaultActiveHarvest`, `orders`, `accountingEntries`, `customerSuggestions`, `relaySuggestions`, `isLoading`, `loadError`, `dataMode` (`'mock' | 'gas'`), all repository mutation methods (with optimistic update + automatic rollback on `patchOrderStatuses`), plus `networkSimulation: { offlineMode, failNextWrite, latencyMs }`, `setNetworkSimulation`, and `resetMockData()`.
- **`AuthProvider` (`useAuth()`)**: `session`, `isAuthenticated`, `isManager`, `isContributor`, `authMode` (`'mock' | 'gis'`), `signInWithGoogleCredential(idToken)`, `switchMockProfile(role, customDisplayName?)`, `signOut()`. Defaults in `mock` mode to authenticated `manager` (`Apiculteur principal`), with header/shell role switcher (`data-testid="role-switch-manager"`, `data-testid="role-switch-contributor"`, `data-testid="role-switch-signout"`).
- **`ToastProvider` (`useToast()`)**: `showToast`, `success`, `error`, `info`, `dismissToast` rendered in `<ToastViewport />` inside `AppShell` so notifications persist across route transitions.
- **Hash Router (`packages/web/src/shell/navigation.ts` — `useAppNavigation()`)**:
  - Routes synced with `window.location.hash`:
    - `#/dashboard` (optional `?harvest=...`)
    - `#/orders` (optional `?harvest=...&orderStatus=...&paymentStatus=...&transferStatus=...&relay=...&q=...`)
    - `#/sale/new` (optional `?harvest=...&returnTo=...`)
    - `#/sale/edit/:orderId` (optional `?returnTo=...`)
    - `#/harvests` (`manager`-only; redirects/guards `contributor` to `#/dashboard`)
    - `#/accounting` (optional `?year=...`, `manager`-only; redirects/guards `contributor` to `#/dashboard`)
- **Contacts UI Contract (`packages/web/src/contracts/contacts-ui.ts` & `features/contacts/public.tsx`)**:
  - `<CustomerPicker value={CustomerDraftFields} onChange={...} />` owns and renders all 3 customer inputs (`customerName`, `phone`, `contextOrRelay`) + autocomplete dropdown + Contact Picker button + `.vcf` import file input. `SaleFormPage` mounts `<CustomerPicker />` once without duplicating Phone or Relay inputs.
  - `<ExportVcfButton contact={{ fullName, phone, contextOrRelay, notes }} variant="..." />` triggers `.vcf` share or file download.

### 3. Opaque-Box Entry Points (for E2E Testing Track & Verifiers)
- **CLI Commands (from `/home/antigravity`)**:
  - `npm run typecheck` — `tsc -b` across `packages/shared`, `packages/gas-api`, `packages/web`
  - `npm test` — `node scripts/with-scratch-tmp.mjs npx vitest run` (co-located unit & component tests)
  - `npm run build` — `node scripts/with-scratch-tmp.mjs npm run build:workspaces` (outputs `packages/web/dist/index.html` + PWA SW and `packages/gas-api/dist/Code.gs`)
  - `npm run test:e2e` — `node scripts/run-e2e.mjs` (allocates free `127.0.0.1` `E2E_PORT`, runs Playwright `1.65.1` on `390x844` mobile Chromium viewport with scratch `TMPDIR`)
- **Deterministic UI Test Hooks (`mock` mode)**:
  - URL query `?resetMock=1` (and shell button `data-testid="reset-mock-data"`) resets `localStorage` dataset + session to clean `seedData` fixtures.
  - Shell/banner Dev QA controls: `data-testid="role-switch-manager"`, `data-testid="role-switch-contributor"`, `data-testid="simulate-offline-toggle"`, `data-testid="fail-next-write-toggle"`.
  - Navigation tabs: `data-testid="nav-dashboard"`, `data-testid="nav-orders"`, `data-testid="nav-new-sale"`, `data-testid="nav-harvests"`, `data-testid="nav-accounting"`.
- **Local GAS HTTP Mock Server (`M2`)**:
  - `node packages/gas-api/scripts/serve-local-gas.mjs --port <PORT>` exposes `POST http://127.0.0.1:<PORT>/exec` (`Content-Type: text/plain;charset=utf-8`) running the real bundled `doPost(e)` router over an in-memory `MockSpreadsheetApp` seeded with the 8 allowed + 4 forbidden tabs and `R1C1` formulas.

### 4. Stable UI Entry Points & `data-testid` Contract (Shared by Implementation & E2E Tracks)
- **URL Bootstrap (`M1`)**: Navigating to `http://127.0.0.1:<PORT>/?resetMock=1#/dashboard` clears `app-icol:*` `localStorage` keys, reloads clean `seedData` + default `manager` session, and removes `?resetMock=1` via `history.replaceState` so subsequent navigations retain mutations.
- **Shell, Auth & Network QA Controls (`M1`)**:
  - Navigation: `data-testid="nav-dashboard"`, `data-testid="nav-orders"`, `data-testid="nav-new-sale"`, `data-testid="nav-harvests"`, `data-testid="nav-accounting"`.
  - Session/Role & Mock QA controls: `data-testid="current-user-role"` (`textContent` or `data-role`: `manager` | `contributor` | `unauthenticated`), `data-testid="role-switch-manager"`, `data-testid="role-switch-contributor"`, `data-testid="role-switch-signout"`, `data-testid="gis-login-screen"`, `data-testid="simulate-offline-toggle"`, `data-testid="fail-next-write-toggle"`, `data-testid="reset-mock-data"`.
  - Global feedback: `data-testid="toast-viewport"`, `data-testid="toast-success"`, `data-testid="toast-error"`, `data-testid="network-status-banner"`.
- **Dashboard (`M4` — `#/dashboard`)**: `data-testid="dashboard-page"`, `data-testid="dashboard-harvest-select"` (options: harvest labels + value `"ALL"` for *"Toutes les récoltes"*), `data-testid="kpi-harvested-kg"`, `data-testid="kpi-forecast-badge"`, `data-testid="kpi-committed-kg"`, `data-testid="kpi-available-kg"`, `data-testid="kpi-paid-eur"`, `data-testid="kpi-unpaid-eur"`, `data-testid="kpi-donated-summary"`, `data-testid="kpi-pending-transfers"`, `data-testid="kpi-pending-deliveries"`, `data-testid="dashboard-new-sale-cta"`.
- **Contacts & vCard (`M3`)**: `data-testid="customer-name-input"`, `data-testid="customer-autocomplete-list"`, `data-testid="customer-suggestion-item"`, `data-testid="customer-phone-input"`, `data-testid="customer-relay-input"`, `data-testid="contact-picker-btn"`, `data-testid="import-vcf-input"` (`<input type="file" accept=".vcf,text/vcard" />` always mounted in DOM), `data-testid="export-vcf-btn"`.
- **Sale Form (`M5` — `#/sale/new` & `#/sale/edit/:orderId`)**: `data-testid="sale-form-page"`, `data-testid="sale-date-input"`, `data-testid="sale-harvest-select"`, `data-testid="stepper-dec-${formatCode}"`, `data-testid="stepper-qty-${formatCode}"`, `data-testid="stepper-inc-${formatCode}"` (e.g. `1kg`, `500g`, `250g`), `data-testid="sale-total-weight"`, `data-testid="sale-total-amount"`, `data-testid="sale-manual-price-toggle"`, `data-testid="sale-manual-price-input"`, `data-testid="sale-reset-auto-price"`, `data-testid="order-status-Réservé"`, `data-testid="order-status-Distribué"`, `data-testid="payment-status-Non-payé"`, `data-testid="payment-status-Payé"`, `data-testid="payment-status-Donné"`, `data-testid="third-party-toggle"`, `data-testid="collector-name-input"`, `data-testid="transfer-status-À reverser"`, `data-testid="transfer-status-Reversé"`, `data-testid="sale-notes-input"`, `data-testid="sale-submit-btn"`, `data-testid="sale-delete-btn"`, `data-testid="sale-confirm-delete-btn"`.
- **Orders List (`M5` — `#/orders`)**: `data-testid="orders-page"`, `data-testid="orders-search-input"`, `data-testid="filter-reserved"`, `data-testid="filter-unpaid"`, `data-testid="filter-pending-transfer"`, `data-testid="filter-harvest-select"`, `data-testid="filter-relay-select"`, `data-testid="filter-clear-all"`, `data-testid="order-card"` (`data-order-id={order.id}`), `data-testid="order-tel-link"`, `data-testid="action-mark-distributed"`, `data-testid="action-mark-paid"`, `data-testid="action-mark-transferred"`, `data-testid="action-edit-order"`.
- **Harvests (`M6` — `#/harvests`, `manager`-only)**: `data-testid="harvests-page"`, `data-testid="harvest-create-btn"`, `data-testid="harvest-label-input"`, `data-testid="harvest-year-input"`, `data-testid="harvest-forecast-input"`, `data-testid="harvest-realized-input"`, `data-testid="harvest-price-input-${formatCode}"`, `data-testid="harvest-default-checkbox"`, `data-testid="harvest-save-btn"`, `data-testid="format-code-input"`, `data-testid="format-label-input"`, `data-testid="format-weight-input"`, `data-testid="format-save-btn"`, `data-testid="format-toggle-${formatCode}"`.
- **Accounting (`M6` — `#/accounting`, `manager`-only)**: `data-testid="accounting-page"`, `data-testid="accounting-year-select"`, `data-testid="accounting-include-sales-toggle"`, `data-testid="accounting-total-revenues"`, `data-testid="accounting-total-expenses"`, `data-testid="accounting-net-balance"`, `data-testid="accounting-add-btn"`, `data-testid="accounting-type-Recette"`, `data-testid="accounting-type-Dépense"`, `data-testid="accounting-category-select"`, `data-testid="accounting-label-input"`, `data-testid="accounting-amount-input"`, `data-testid="accounting-date-input"`, `data-testid="accounting-save-btn"`, `data-testid="accounting-category-filter"`.

---

## Code Layout

```
/home/antigravity/
├── .gitignore                          # [M1] MUST ignore /.agents/, /.gemini/, HOME dotfiles, node_modules, dist, .clasprc.json
├── PROJECT.md                          # [Orchestrator] Living source of truth (NEVER create AGENTS.md or GEMINI.md)
├── ARCHITECTURE.md                     # [M1] Concise developer & domain rules reference
├── DEPLOY.md                           # [M2] 5-minute clasp + ScriptProperties + Vite static hosting guide
├── package.json                        # [M1] npm workspaces: packages/shared, packages/gas-api, packages/web
├── tsconfig.base.json                  # [M1] Strict TS ~5.9.3 compiler options
├── tsconfig.json                       # [M1] Composite project references
├── vitest.config.ts                    # [M1] Matches packages/*/src/**/*.test.{ts,tsx}
├── playwright.config.ts                # [M1] @playwright/test@1.65.1, /opt/ms-playwright, 390x844 mobile viewport
├── scripts/
│   ├── with-scratch-tmp.mjs            # [M1] Sets TMPDIR=/home/antigravity/.gemini/jetski/scratch/teamwork_tmp/r-<pid> & cleans up
│   └── run-e2e.mjs                     # [M1] Allocates free 127.0.0.1 E2E_PORT & launches Playwright
├── packages/
│   ├── shared/                         # [M1 Exclusive Write]
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── types/{domain.ts,repository.ts,api.ts}
│   │       ├── domain/{calculators.ts,normalizers.ts,calculators.test.ts}
│   │       ├── schema/{schema.config.ts,schema.test.ts}
│   │       └── fixtures/seedData.ts
│   ├── gas-api/                        # [M2 Exclusive Write, after M1 skeleton]
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── appsscript.json
│   │   ├── .clasp.json.example
│   │   ├── scripts/{build-gas.mjs,serve-local-gas.mjs}
│   │   └── src/
│   │       ├── main.ts
│   │       ├── auth/{AuthVerifier.ts,AuthVerifier.test.ts}
│   │       ├── sheets/{SheetGuard.ts,HeaderResolver.ts,FormulaPreserver.ts,SheetsRepository.ts,*.test.ts}
│   │       └── testing/MockSpreadsheetApp.ts
│   └── web/
│       ├── package.json                # [M1]
│       ├── tsconfig.json               # [M1]
│       ├── vite.config.ts              # [M1] base: './' + PWA manifest/SW
│       ├── index.html                  # [M1] French lang, mobile viewport, PWA meta
│       ├── public/                     # [M1] PWA icons & manifest assets
│       └── src/
│           ├── main.tsx                # [M1]
│           ├── App.tsx                 # [M1]
│           ├── styles/{tokens.css,global.css}           # [M1] Vanilla CSS Design System (NO Tailwind)
│           ├── ui/**                                    # [M1] Atomic tactile UI components + tests
│           ├── contracts/contacts-ui.ts                 # [M1] Locked Contacts <-> SaleForm/Orders contract
│           ├── providers/{DataProvider.tsx,MockSheetsRepository.ts,GasApiClient.ts,AuthProvider.tsx,ToastProvider.tsx,*.test.ts} # [M1]
│           ├── shell/{AppShell.tsx,navigation.ts,*.test.tsx} # [M1]
│           └── features/
│               ├── contacts/
│               │   ├── public.tsx                       # [M1 Locked re-export]
│               │   └── {vcard.ts,contactPicker.ts,CustomerPickerImpl.tsx,ExportVcfButtonImpl.tsx,*.module.css,*.test.*} # [M3 Exclusive Write]
│               ├── dashboard/**                         # [M4 Exclusive Write]
│               ├── sale-form/**                         # [M5a Exclusive Write]
│               ├── orders/**                            # [M5b Exclusive Write]
│               ├── harvests/**                          # [M6a Exclusive Write]
│               └── accounting/**                        # [M6b Exclusive Write]
└── e2e/                                # [E2E Testing Track Exclusive Write]
    ├── helpers/**
    ├── fixtures/**
    └── {tier1-features,tier2-boundaries,tier3-combinations,tier4-scenarios,tier5-adversarial}/**/*.spec.ts
