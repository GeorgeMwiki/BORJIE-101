# Jurisdictional Rules — The Country Contract

`jurisdictional-rules.ts` is the **single source of truth** for every
place the BORJIE platform needs to vary behaviour by country
(currency, locale, phone format, tax authority + VAT rate, ID document,
payment rails, lease law, data-protection statute, working week, public
holidays, e-signature regime, currency minor-units, address format,
KYC tiers, rent-control regime, VAT-registration threshold, payment-due
adjustment, phone-plan length).

A growing constellation of `if (country === 'TZ')` branches is the
classic anti-pattern this contract eliminates: adding a country becomes
a **single object edit** rather than a code grep + cross-file refactor.

## How to read the registry

```ts
import { getJurisdictionalRules } from '@borjie/domain-models';

const rules = getJurisdictionalRules(tenant.country);
// rules.taxAuthority.vatRatePct
// rules.workingWeek.start
// rules.publicHolidays(2026)
// rules.kycTier.thresholdsUsdCents
```

`getJurisdictionalRules` is **case-insensitive** and throws a descriptive
error (with a pointer to this file) when the country has no entry yet.
The companion `listSupportedJurisdictions()` returns the ISO-3166-1
alpha-2 codes in registry order.

## The 23 fields

### Original (13 — ProdFix-5)

| Field | Type | Notes |
|---|---|---|
| `countryCode` | `string` | ISO-3166-1 alpha-2 |
| `countryName` | `string` | Display name |
| `defaultCurrency` | `CurrencyCode` | ISO-4217 |
| `defaultLocale` | `string` | BCP-47 |
| `defaultTimezone` | `string` | IANA TZDB |
| `awsRegionDefault` | `string` | Nearest GA region |
| `e164CountryCode` | `string` | `+255`, `+254`, etc. |
| `phoneRegex` | `RegExp` | E.164 + national formats |
| `identityDocType` | object | NIDA / Huduma / NIN / etc. |
| `taxAuthority` | object | TRA / KRA / SARS / etc. |
| `landRegistry` | object | eArdhi / Ardhisasa / etc. |
| `mobileMoney` | array | M-Pesa / Airtel / etc. |
| `bankRailProvider` | object | GePG / PesaLink / etc. |
| `leaseRules` | object | Notice days, deposit cap |
| `dataProtection` | object | Statute + regulator |

### Phase E.0 expansion (+10)

| Field | Type | Notes |
|---|---|---|
| `workingWeek` | `{ start, end }` | Mon-Fri vs. Sun-Thu |
| `publicHolidays` | `(year) => holidays[]` | Recurrence-driven |
| `eSignatureRegime` | object | eIDAS / TZ-ETA / KE-KICA |
| `currencyMinorUnits` | `number` | TZS=0, KES=2, BHD=3 |
| `addressFormat` | object | Postal-code regex + schema |
| `kycTier` | object | USD-cents threshold ladder |
| `rentControlRegime` | object | Active flag + max annual % |
| `vatRegistrationThresholdUsdCents` | `number` | Annual turnover trigger |
| `paymentDueAdjustment` | enum | Weekend/holiday roll rule |
| `phoneNumberPlanLength` | `{ min, max }` | Subscriber-number digits |

## Supported countries

Three jurisdictions ship in-tree (Phase E.5.4):

| Code | Country | Statute / regulator basis |
|------|---------|---------------------------|
| `TZ` | Tanzania | TRA + NIDA + eArdhi + Electronic Transactions Act 2015 + PDPA 2022 |
| `KE` | Kenya | KRA + Huduma + Ardhisasa + KICA Cap. 411A + DPA 2019 |
| `NG` | Nigeria | FIRS/NRS + NIMC (NIN) + NGGIS + Evidence Act 2011 §84 + NDPA 2023 |

The NG entry shipped in Phase E.5.4 as the **country-#3 onboarding
proof**: it required exactly one edit to this module + four new
`mcp-server-*` scaffolds (no `if (country === …)` branches added
elsewhere). See `services/mcp-server-{nin,firs,nggis,opay}/` for the
scaffold pattern.

## Adding a new country

1. Append a frozen `JurisdictionalRules` object to `RULES_BY_COUNTRY`
   in `jurisdictional-rules.ts`.
2. Cite the source-of-truth for every value (statute reference, IANA
   TZDB entry, BCP-47 locale code, etc.) in inline comments.
3. Extend the "every supported jurisdiction" test in
   `__tests__/jurisdictional-rules.test.ts` to assert basic shape.
4. Run `pnpm audit:jurisdictional` — every literal flagged in
   `.audit/jurisdictional-rebind-targets.md` for the new country should
   already be reading from the registry; if not, that file is the
   worklist.

## Companion enforcement

### Lint rule

`borjie/no-jurisdictional-literal` (in `eslint-rules/`) fires a
warning whenever a hard-coded jurisdictional value appears outside the
allowed file paths:

- `packages/connectors/src/adapters/<country>-<connector>.ts`
- `packages/domain-models/src/common/jurisdictional-rules.ts`
- `packages/domain-models/src/common/region-config.ts`
- `packages/database/src/seeds/**`
- `**/__tests__/**`, `**/__fixtures__/**`, `**/fixtures/**`
- `**/*.md`

Default severity is `warn`. Once the Phase E.0.4 rebind pass clears the
existing 700+ violations the severity will flip to `error`.

### Audit script

```bash
pnpm audit:jurisdictional
```

Writes `.audit/jurisdictional-rebind-targets.md` — the worklist for the
rebind pass. Output is grouped by violation class (NIDA refs / KRA refs
/ phone prefixes / timezones / AWS regions / hardcoded VAT / 3-currency
enums) with file:line precision.

## Why not just put this in `region-config.ts`?

`region-config.ts` is the **legacy** RegionConfig shape (founder-era
East-African defaults + a Zod schema for phone/taxpayer-id). It is
battle-tested and woven into the rest of the platform.

The new `jurisdictional-rules.ts` contract is **purpose-built for
parametric jurisdictions** — every business rule that used to be hard-
coded behind `if (country === 'TZ')` can now read its parameter from
`getJurisdictionalRules(country)`. The two modules overlap intentionally
and `region-config.ts` is slated to migrate to read from this table in
Phase E.0.4.

## Related work

- ProdFix-5 — initial 13-field contract + TZ/KE entries
- Phase E.0 (this) — +10 fields + lint rule + audit script
- Phase E.0.4 — rebind pass (replace literals with registry lookups)
- Phase E follow-up — country #3 onboarding proof; Hijri/Easter computus
  for movable public holidays
