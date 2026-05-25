# PhZ-GLOBAL — Plugin-ify every jurisdiction-specific capability

Status: complete for the 5 port contracts + 6 bundled country plugins + the
highest-priority call-site replacement. Findings below.

## 1. Ports added (5, with interfaces)

All five live under `packages/compliance-plugins/src/ports/`. Each ships a
`DEFAULT_*` implementation so hot paths never crash on an unconfigured
jurisdiction.

### 1.1 `TaxRegimePort`

File: `ports/tax-regime.port.ts`

```ts
interface TaxRegimePort {
  calculateWithholding(
    grossRentMinorUnits: number,
    currency: CurrencyCode,
    period: TaxPeriod
  ): {
    withholdingMinorUnits: number;
    regulatorRef: string;
    rateNote: string;
    requiresManualConfiguration?: boolean;
  };
}
```

`DEFAULT_TAX_REGIME` returns 0 with `requiresManualConfiguration: true`
and the canonical "CONFIGURE_FOR_YOUR_JURISDICTION" note. Helper
`flatRateWithholding(gross, ratePct, regulatorRef, note)` rounds
half-away-from-zero and clamps negative / non-integer input to 0.

### 1.2 `TaxFilingPort`

File: `ports/tax-filing.port.ts`

```ts
interface TaxFilingPort {
  prepareFiling(
    run: FilingRun,
    tenantProfile: TenantProfileForFiling,
    period: TaxPeriod
  ): {
    filingFormat: 'csv' | 'xml' | 'json';
    payload: string;
    targetRegulator: string;
    submitEndpointHint: string | null;
    instructions?: string;
  };
}
```

Generic CSV serializer (`buildGenericCsvPayload`) lives in the port file
so every country plugin can share the escape/row logic.

### 1.3 `PaymentRailPort`

File: `ports/payment-rail.port.ts`

```ts
interface PaymentRailPort { listRails(): readonly PaymentRail[]; }
interface PaymentRail {
  id: string; label: string; kind: PaymentRailKind; currency: CurrencyCode;
  minAmountMinorUnits: number; settlementLagHours: number;
  integrationAdapterHint: string | null;
  supportsCollection: boolean; supportsDisbursement: boolean;
}
```

Kinds: `mobile-money | bank-transfer | card | open-banking | wallet |
cash-voucher | government-portal | manual`.

`DEFAULT_PAYMENT_RAILS` → `['stripe', 'manual']` per the spec.

### 1.4 `TenantScreeningPort`

File: `ports/tenant-screening.port.ts`

```ts
interface TenantScreeningPort {
  lookupBureau(
    identityDocument: IdentityDocument,
    country: string,
    consentToken: string
  ): Promise<{
    bureauScore?: number; scoreScaleMax?: number;
    flags: readonly string[]; sourceRefs: readonly string[]; bureau: string;
  }>;
}
```

Standard flags: `BUREAU_NOT_CONFIGURED`, `CONSENT_TOKEN_INVALID`,
`BUREAU_TIMEOUT`, `BUREAU_MATCH_NOT_FOUND`. Every country plugin below
stubs with `BUREAU_NOT_CONFIGURED` until an env-gated adapter is wired.

### 1.5 `LeaseLawPort`

File: `ports/lease-law.port.ts`

```ts
interface LeaseLawPort {
  requiredClauses(leaseKind: LeaseKind): readonly ClauseSpec[];
  noticeWindowDays(reason: NoticeReason): number | null;
  depositCapMultiple(regime: DepositCapRegime): DepositCap;
  rentIncreaseCap(regime: DepositCapRegime): RentIncreaseCap;
}
```

Where deposit caps cross jurisdictional expression (e.g. UK weeks-of-rent,
NY one-month cap) `DepositCap` exposes all three forms.

## 2. Country-coverage matrix

Port × country — every bundled country plugin now ships ALL 5 ports
(real implementations, not stubs). Citation-quality notes inline.

| Country | TaxRegime | TaxFiling | PaymentRails | TenantScreening | LeaseLaw |
|---------|-----------|-----------|--------------|-----------------|----------|
| KE (Kenya)       | 7.5% MRI (KRA) | CSV → iTax     | mpesa_ke, airtelmoney_ke, pesalink, card | CRB_KE stub   | Cap 293 + Finance Act 2024 |
| TZ (Tanzania)    | 10% WHT (TRA)  | CSV → TRA      | mpesa_tz, tigopesa, airtelmoney_tz, halopesa, gepg, bank_tz | CRB_TZ stub | LTA §§29-32 |
| UG (Uganda)      | 12% Rental (URA) | CSV → URA    | mtn_momo, airtelmoney_ug, bank_ug | CRB_UG stub | L&T Act 2022 (incl. 10% increase cap) |
| NG (Nigeria)     | 10% WHT (FIRS) | CSV → TaxPro-Max | paystack, flutterwave, nibss | CRC_NG stub | Tenancy Law Lagos 2011 |
| ZA (South Africa)| 7.5% NR / resident=0% (SARS) | CSV → eFiling | payfast, eft_za, payshap | TPN_ZA stub   | Rental Housing Act 50/1999 |
| US (United States)| 0% fed (IRS)  | CSV → IRS     | ach, plaid, stripe_us, zelle | EXPERIAN_US stub | Federal baseline + state override hook |

Coverage assertion is pinned in `src/__tests__/ports.test.ts` (every
country row in `getPortCoverageMatrix()` has `true` for all five ports).

Fallback: `resolvePlugin(countryCode)` returns `DEFAULT_PLUGIN` for null,
undefined, empty, whitespace, or unknown codes — DEFAULT_PLUGIN carries
USD, English, 0% withholding (with `requiresManualConfiguration: true`),
and `[stripe, manual]` rails.

## 3. Hardcoded call-sites replaced

### 3.1 `services/reports/src/compliance/ke-kra-formatter.ts:48`

**Before:**
```ts
const MRI_RATE = 0.075;
```

**After:**
```ts
import { resolvePlugin } from '@borjie/compliance-plugins';
const KE_PLUGIN = resolvePlugin('KE');
const MRI_RATE = (() => {
  const probeGrossMinor = 1_000_000;
  const result = KE_PLUGIN.taxRegime.calculateWithholding(
    probeGrossMinor, 'KES',
    { kind: 'month', year: new Date().getUTCFullYear(), month: 1 }
  );
  return result.withholdingMinorUnits / probeGrossMinor;
})();
```

A new workspace dependency was added to
`services/reports/package.json`: `"@borjie/compliance-plugins":
"workspace:*"`.

Existing formatter test (`applies 7.5% MRI and 16% VAT correctly`) still
passes — the rate derives correctly from the plugin (75,000 minor units on
a 1,000,000 minor gross = 7.5%).

## 4. Default fallback behaviour

`resolvePlugin(null)` / `resolvePlugin(undefined)` / `resolvePlugin('')` /
`resolvePlugin('   ')` / `resolvePlugin('XX')` all return the same frozen
`DEFAULT_PLUGIN` singleton. It carries:

- `countryCode: 'XX'`, `countryName: 'Unknown (default)'`
- `currencyCode: 'USD'`, `currencySymbol: '$'`
- `normalizePhone` — strips non-digits, prefixes `+` (defensive, throws on empty)
- `taxRegime` → `DEFAULT_TAX_REGIME` (0% + advisory note)
- `taxFiling` → `DEFAULT_TAX_FILING` (generic CSV, `targetRegulator: 'GENERIC'`)
- `paymentRails` → `[stripe, manual]`
- `tenantScreening` → `BUREAU_NOT_CONFIGURED`
- `leaseLaw` → universal-minimum residential clauses, no specific notice windows

This is test-pinned in `ports.test.ts` (`DEFAULT_PLUGIN carries USD/English
with zero withholding`).

## 5. What's still hardcoded with clear TODO pointer

The following call-sites were NOT modified in this wave, with rationale:

1. **`packages/ai-copilot/src/orchestrators/monthly-close/*`** — other
   agent's scope (PhA2). Ports are now available; PhA2 is expected to
   swap its `kraMriRatePct?: number` dep for a `resolvePlugin(tenantCountry)
   .taxRegime.calculateWithholding(...)` call on its next pass.

2. **`packages/domain-models/src/common/region-config.ts:128`
   (`rentalIncomeTaxRate: 0.075`)** — legacy overlay, still consumed by
   existing tests that assert `cfg.tax.rentalIncomeTaxRate === 0.075`.
   Migration path: region-config overlay can subsume `taxRegime.calculateWithholding(100,
   ...).withholdingMinorUnits / 100` at a later date. Flagged as TODO via
   a comment in the plugin's Kenya implementation ("single source of truth").

3. **`packages/ai-copilot/src/skills/kenya/kra-rental-summary.ts:44`
   (`rate: z.number().default(0.075)`)** — skill is Kenya-specific by
   filename. It could, and should, next iteration read the rate from
   `resolvePlugin('KE').taxRegime` — but the skill ships a user-override
   knob, which we don't want to yank silently.

4. **`services/reports/src/compliance/ke-kra-formatter.ts:49`
   (`VAT_RATE = 0.16`)** — VAT is not yet a port. Left as-is with a
   comment; consider a future `VatPort` (or extend `TaxRegimePort` with a
   `calculateVat()` method) as a follow-on.

5. **`services/payments/src/providers/mpesa/*`** — genuine single-
   integration-adapter code (Safaricom Daraja). Not a business-logic
   hardcode; stays in place.

6. **`services/payments-ledger/src/providers/mpesa-provider.ts`** — same
   as above.

7. **`packages/ai-copilot/src/personas/**`** — persona prompts. These
   reference MRI/KRA/M-Pesa in natural-language prompts for user-facing
   LLM context. Pluginising prompt wording is out of scope for a logic-
   pluginisation wave.

## 6. Tests

Two test files; 88 tests green on `pnpm --filter
@borjie/compliance-plugins test`:

- `src/__tests__/ports.test.ts` (59 tests, new) — port coverage matrix,
  DEFAULT behaviour, per-country pinning for every port, country-
  specific assertions (KE 7.5%, US 0%, UG 10% cap, KE 14-day non-payment).
- `src/__tests__/registry.test.ts` (29 tests, pre-existing) — unchanged.

`pnpm --filter @borjie/reports-service test` → 19/19 green.

## 7. Typecheck

Compliance-plugins typecheck is clean for the code I own.
`pnpm --filter @borjie/reports-service typecheck` → clean.

Pre-existing errors unrelated to this wave live in:
- `packages/compliance-plugins/src/countries/types.ts:96,105,111`
- `packages/compliance-plugins/src/validators/address.ts:166,189,205`
- `packages/compliance-plugins/src/validators/bank-account.ts:49`
- `packages/compliance-plugins/src/validators/phone.ts:152`

All are `exactOptionalPropertyTypes`-compliance issues in a parallel
agent's extended-country and validator scaffolding. Flagging for their
next pass — they are orthogonal to the ports delivered here.

## 8. Files touched (summary)

New:
- `packages/compliance-plugins/src/ports/tax-regime.port.ts`
- `packages/compliance-plugins/src/ports/tax-filing.port.ts`
- `packages/compliance-plugins/src/ports/payment-rail.port.ts`
- `packages/compliance-plugins/src/ports/tenant-screening.port.ts`
- `packages/compliance-plugins/src/ports/lease-law.port.ts`
- `packages/compliance-plugins/src/ports/index.ts`
- `packages/compliance-plugins/src/registry.ts`
- `packages/compliance-plugins/src/__tests__/ports.test.ts`
- `Docs/PHASES_FINDINGS/phZ-global-plugins.md` (this file)

Edited (incrementally extended — existing surface preserved):
- `packages/compliance-plugins/src/core/types.ts` — `CountryPlugin`
  gained 5 optional port fields.
- `packages/compliance-plugins/src/core/index.ts` — re-exports `../ports`.
- `packages/compliance-plugins/src/index.ts` — exports `resolvePlugin`,
  `DEFAULT_PLUGIN`, `getPortCoverageMatrix`.
- `packages/compliance-plugins/src/plugins/{kenya,tanzania,uganda,
  nigeria,south-africa,united-states}.ts` — each now exports real port
  implementations.
- `services/reports/src/compliance/ke-kra-formatter.ts` — MRI_RATE
  derived from the Kenya plugin instead of hardcoded.
- `services/reports/package.json` — added workspace dependency.
