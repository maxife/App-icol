# App-icol — Architecture, Domain Invariants & Module Boundaries

> Living project specification and milestone/testid contracts live in [`PROJECT.md`](./PROJECT.md).

## 1. Monorepo Topology (Option A)

| Workspace | Package Name | Responsibility |
| :--- | :--- | :--- |
| `packages/shared` | `@app-icol/shared` | Strict domain types, pure stock/revenue/accounting calculators, phone/text/French-decimal normalizers, dynamic Sheets schema/alias config (`ALLOWED_SHEETS` / `FORBIDDEN_SHEETS`), GAS RPC contracts, `seedData`. |
| `packages/gas-api` | `@app-icol/gas-api` | Google Apps Script V8 backend (`doPost` CORS-safe `text/plain;charset=utf-8` JSON RPC, GIS `idToken` `AuthVerifier`, `LockService` + `CacheService` idempotency, `SheetGuard`, `HeaderResolver`, `FormulaPreserver`, `inspectSheetStructure`, bundled via `esbuild` -> `dist/Code.gs`). |
| `packages/web` | `@app-icol/web` | Mobile-First PWA (`Vite 8 + React 19 + TypeScript 5.9 + Modular Vanilla CSS` — **NO Tailwind**), *Ambre Solaire & Ardoise Chaude* design system (`>=48px` touch targets, `tabular-nums`), `DataProvider` (`MockSheetsRepository` + `GasApiClient`), `AuthProvider`, `ToastProvider`, `AppShell` hash router, and isolated feature modules. |
| `e2e/` | *(Root Playwright)* | Requirement-driven mobile (`390x844`) Playwright `1.65.1` E2E test suites across Tiers 1–5. |

## 2. Five Immutable Domain Rules

1. **`Réservé` Consumes Stock Immediately**: `committedWeightKg` sums `computedWeightKg` across ALL orders (`Réservé` + `Distribué`, including `Payé`, `Non-payé`, and `Donné`). Transitioning `Réservé -> Distribué` decrements `pendingDeliveryOrdersCount` (`-1`) and never double-deducts stock.
2. **`Donné` Consumes Stock, Never Enters Revenue or Unpaid Balance**: When `paymentStatus === 'Donné'`, `effectiveAmountEur` is strictly `0 €` (even if `manualAmountOverrideEur` is set; `computedAmountEur` stays informative), `paidAmountEur` and `unpaidAmountEur` exclude it, `transferStatus` normalizes to `'Non concerné'`, and donated volume is surfaced separately (`donatedJarsCount`, `donatedWeightKg`).
3. **Systematic Input Hygiene**: Strip invisible Unicode bidi markers and normalize French numbers (`+33`, `0033`, `06.xx`, 9-digit integers) to `06 XX XX XX XX` while preserving international `+CC` numbers (`normalizePhoneNumber`). Collapse/trim harvest whitespace (`normalizeHarvestLabel`) and parse French decimals/currency (`parseFrenchDecimal`).
4. **Closed Referentials**:
   - `OrderStatus`: `'Réservé' | 'Distribué'` (no `'Annulé'`; manager-only `deleteOrder` with confirmation).
   - `PaymentStatus`: `'Non-payé' | 'Payé' | 'Donné'`.
   - `TransferStatus`: `'Non concerné' | 'À reverser' | 'Reversé'` (valid `'À reverser' | 'Reversé'` iff `paymentStatus === 'Payé'` and `collectedByThirdParty === true`; auto-prefilled for `contributor` paid sales).
   - `AccountingCategory`: 7 closed literal categories in `@app-icol/shared`.
5. **Flaky Mobile Network Resilience**: Explicit loading + Toast confirmation on every mutation, `localStorage` draft preservation (`useSaleDraftPersistence`) on failure, optimistic 1-click status rollback on error, and `clientRequestId` deduplication.

## 3. Google Sheets Safety Rules (`« Vente et reservations Miel »`)

- **8 `ALLOWED_SHEETS` (exact spellings)**: `'Ventes Miel'`, `'ParRecoltes'`, `'ParCommandes'`, `'ParPaiement'`, `'ParArticles'`, `'PUan'`, `'Gestion recoltes'` *(no accent)*, `'Comptabilité rucher'` *(accented)*.
- **4 `FORBIDDEN_SHEETS` (hard-blocked prior to any read/write)**: `'App: Logins'`, `'App: Metadata'`, `'ParNbPots'`, `'TEST - NE PAS TOUCHER'` (including escaped/unicode dash variants).
- **Dynamic Header Resolution**: Resolve columns strictly from Row 1 headers via `HeaderResolver` (`schema.config.ts`) — never fixed column indices.
- **Formula & Format Preservation**: Preserve `ARRAYFORMULA` and `R1C1` formulas on `Poids (Kg)` and `Prix` (restoring `R1C1` when reverting manual price override), enforce `'@'` text format on phone cells before writing so leading `0`s survive, and block writes to formula-driven `Par*` summary tabs.

## 4. Parallel Module Ownership & Tooling Guardrails

- **Feature Isolation**: Wave 1 feature modules write exclusively inside their assigned directory (`packages/gas-api/**` or `packages/web/src/features/<module>/**`, keeping `features/contacts/public.tsx`, `packages/shared/**`, `providers/**`, `shell/**`, and `ui/**` locked after M1). Co-locate `*.test.{ts,tsx}` and `*.module.css` inside each module.
- **Scratch `TMPDIR` Discipline**: Never write to `/tmp`. Always execute tests and builds via `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e` (which automatically wrap processes in `scripts/with-scratch-tmp.mjs` using `/home/antigravity/.gemini/jetski/scratch/teamwork_tmp/r-<pid>`).
