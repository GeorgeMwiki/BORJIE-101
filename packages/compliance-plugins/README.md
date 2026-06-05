# @borjie/compliance-plugins

Country compliance plugin registry for Borjie's AI-native mining estate OS. Every country Borjie supports plugs in here — currency, phone format, KYC providers, payment gateways, and mining-regulatory rules (royalty/withholding, mining law, offtake/supply terms) are all data, not code branches.

## Why a plugin architecture?

Previously, Tanzania-specific logic (GePG, NIDA, CRB, TRA, BRELA, TZS, `+255` phone rules) was interleaved across routers, services, and domain models. Adding a new country meant hunting down every `if country === 'TZ'` branch. This package inverts the problem: services resolve a `CountryPlugin` by ISO-3166-1 code and call its pure methods.

Tanzania is still a first-class, fully-specified plugin (Mining Act 2010, 6% royalty + 1% clearing fee, TRA). It was not deleted — just moved into a clean cell.

## Public API

```ts
import {
  getCountryPlugin,
  availableCountries,
  DEFAULT_COUNTRY_ID,
} from '@borjie/compliance-plugins';

const tz = getCountryPlugin('TZ');
tz.normalizePhone('0712345678');   // '+255712345678'
tz.currencyCode;                    // 'TZS'
tz.compliance.noticePeriodDays;     // 90

availableCountries(); // ['TZ', 'KE', 'UG', 'NG', 'ZA', 'US', ...]
```

`DEFAULT_COUNTRY_ID = 'TZ'` is a last-resort fallback. Relying on it in a request path is a bug — every real call site must pass the tenant's country. The fallback logs an explicit warning once per process.

## Interfaces

| Interface | Purpose |
|---|---|
| `CountryPlugin` | The full per-country bundle: currency, phone normalizer, KYC providers, payment gateways, compliance rules, document templates. |
| `CompliancePolicy` | Numeric regulatory rules: min/max performance-bond months, notice period, minimum offtake/supply term, sub-supply consent model, late-fee cap, bond return deadline. |
| `KycProvider` | National-ID / credit-bureau / business-registry / tax-authority identity provider. Env-var prefix only — credentials live in the environment. |
| `PaymentGateway` | Mobile-money / bank-rail / card / government-portal integration descriptor. |
| `DocumentTemplate` | Offtake agreement, notice of licence suspension, etc. Path is relative to the consuming CMS. |
| `MiningLawPort` | Jurisdiction mining law: required offtake clauses, notice windows by reason, performance-bond caps, royalty-escalation caps. |
| `TaxRegimePort` | Mineral-royalty / sales withholding calculator (minor-unit integer math). |
| `CounterpartyScreeningPort` | External credit-bureau adapter to screen a buyer / off-taker / sub-supply operator (env-gated, consent-required). |
| `CountryPluginRegistry` | Singleton that stores deep-frozen plugins and resolves by code (case-insensitive). |

## Runtime load path

Plugins are registered at module load (see `src/index.ts`). Consumers import the registry singleton and resolve at request time:

```ts
import { getCountryPlugin } from '@borjie/compliance-plugins';

export async function onboardOperator(input) {
  const plugin = getCountryPlugin(input.country);
  const e164 = plugin.normalizePhone(input.phone);
  const currency = plugin.currencyCode;
  // ...
}
```

Plugins are **deep-frozen** before storage so services can share the same `CountryPlugin` reference across all requests without worrying about accidental mutation.

## Adding a new country

1. Create `src/plugins/<country>.ts` (under 300 lines).
2. Export a `CountryPlugin` with the six required fields: `countryCode`, `countryName`, `currencyCode`, `phoneCountryCode`, `normalizePhone`, plus `kycProviders`, `paymentGateways`, `compliance`, `documentTemplates`.
3. Build the phone normalizer with `buildPhoneNormalizer({ dialingCode, trunkPrefix })` — don't re-implement stripping logic.
4. Register the plugin in `src/index.ts`.
5. Add round-trip tests in `src/__tests__/registry.test.ts` for phone normalization + currency lookup + compliance defaults.

## US state overrides

Mining law is state-level in the US (plus federal BLM hardrock claims). Use `withStateOverride` to compose a state-specific plugin without mutating the federal baseline:

```ts
import { withStateOverride } from '@borjie/compliance-plugins';

const nevada = withStateOverride('NV', {
  maxBondMonths: 3,
  lateFeeCapRate: 0.06,
});
```

## Existing country-specific logic — DO NOT MOVE YET

These references already implement pieces of what this package abstracts. They are **not moved** by this package — wiring is a separate task.

- `services/identity/src/phone-normalize.ts` — minimal E.164 phone normalizer (no `+`) with inline region table. To migrate: swap calls for `plugin.normalizePhone`.
- `packages/domain-models/src/common/region-config.ts` — the previous generation of this registry (VAT rates, tax authority, mobile-money providers). To migrate: fold its fields into `CountryPlugin` variants or expose via a secondary plugin surface.
- `services/payments/src/providers/mpesa/*` — M-Pesa adapter. Env prefix `MPESA` matches `tanzaniaPlugin.paymentGateways[...].envPrefix`.
- `services/notifications/src/sms/africas-talking.ts` — SMS gateway using phone format expectations.
- `packages/domain-models/src/identity/tenant-identity.ts` — per-country taxpayer / KYC schemas.

Open a follow-up task to consolidate these call sites behind `getCountryPlugin(...)`.

## Development

```
cd packages/compliance-plugins
pnpm install
pnpm test
pnpm typecheck
pnpm build
```
