# PhJ-JURIS-BREADTH — Findings

> Wave objective: make BORJIE genuinely ready for any jurisdiction by
> adding 12 country plugins across every continent + 5 universal
> validators that keep onboarding working even in unlisted jurisdictions.

## Country-coverage matrix (12 new + 6 existing = 18 total)

| ISO | Country | Currency | Languages (BCP-47) | Date format | Minor-unit divisor | Status |
|-----|---------|----------|--------------------|-------------|---------------------|--------|
| TZ | Tanzania (existing) | TZS | sw, en | DD/MM/YYYY | 100 | existing |
| KE | Kenya (existing) | KES | sw, en | DD/MM/YYYY | 100 | existing |
| UG | Uganda (existing) | UGX | en, sw | DD/MM/YYYY | 100 | existing |
| NG | Nigeria (existing) | NGN | en | DD/MM/YYYY | 100 | existing |
| ZA | South Africa (existing) | ZAR | en, zu, xh | YYYY/MM/DD | 100 | existing |
| US | United States (existing) | USD | en | MM/DD/YYYY | 100 | existing |
| DE | Germany | EUR | de, en | DD.MM.YYYY | 100 | NEW |
| KR | South Korea | KRW | ko, en | YYYY-MM-DD | 1 | NEW |
| GB | United Kingdom | GBP | en | DD/MM/YYYY | 100 | NEW |
| SG | Singapore | SGD | en, zh, ms, ta | DD/MM/YYYY | 100 | NEW |
| CA | Canada | CAD | en, fr | YYYY-MM-DD | 100 | NEW |
| AU | Australia | AUD | en | DD/MM/YYYY | 100 | NEW |
| IN | India | INR | en, hi, ta, bn, te, mr | DD/MM/YYYY | 100 | NEW |
| BR | Brazil | BRL | pt, en | DD/MM/YYYY | 100 | NEW |
| JP | Japan | JPY | ja, en | YYYY/MM/DD | 1 | NEW |
| FR | France | EUR | fr, en | DD/MM/YYYY | 100 | NEW |
| AE | United Arab Emirates | AED | ar, en | DD/MM/YYYY | 100 | NEW |
| MX | Mexico | MXN | es, en | DD/MM/YYYY | 100 | NEW |

Plus `GLOBAL_DEFAULT_PROFILE` (ISO `XX`) — fallback for any unlisted
jurisdiction: USD, English, Stripe + manual rails, zero-rate tax stub,
null ID validator.

## Port-implementation matrix

Legend: **R** = real (public-source rate / rule), **S** = stub (operator
must configure), **D** = DEFAULT_* fallback, **—** = not applicable.

| Country | TaxRegimePort | TaxFilingPort | PaymentRailPort | TenantScreeningPort | LeaseLawPort |
|---------|---------------|---------------|-----------------|---------------------|--------------|
| DE | R — 15.825% (§ 50a EStG) | D | R — SEPA / Stripe / Klarna | S — SCHUFA_DE stub | R — BGB §§ 551, 573c, 558 |
| KR | R — 20.42% (ITA 156) | D | R — Toss / KakaoPay / bank / Stripe | S — NICE_KR stub | R — HLPA § 4, 6-3 |
| GB | R — 20% NRLS | D | R — Open Banking / BACS / Stripe | S — EXPERIAN_GB stub | R — HA 1988 s.21, TFA 2019 |
| SG | R — 15% (ITA § 45C) | D | R — PayNow / GIRO / Stripe | S — CBS_SG stub | R — Stamp Duties Act § 22 |
| CA | R — 25% Part XIII | D | R — Interac / EFT / Stripe | S — EQUIFAX_CA stub | R — federal baseline + ON RTA refs |
| AU | S — ord. rental not withheld | D | R — PayID / BECS / Stripe | S — EQUIFAX_AU stub | R — state RTAs |
| IN | R — 10% TDS § 194-I | D | R — UPI / IMPS / NEFT / Razorpay | S — CIBIL_IN stub | R — MTA 2021 § 11, 12 |
| BR | R — 15% non-res (Lei 7713) | D | R — Pix / Stripe / MercadoPago | S — SERASA_BR stub | R — Lei 8.245/91 § 38 |
| JP | R — 20.42% (ITA § 212) | D | R — bank / PayPay / Stripe | S — CIC_JP stub | R — Land & House Lease Act |
| FR | R — 20% (CGI 244bis) | D | R — SEPA / Stripe | S — FCC_FR stub | R — Loi 89-462 § 22, IRL |
| AE | S — no personal income tax | D | R — AE bank / Careem Pay / Stripe | S — AECB_AE stub | R — Dubai Law 26/2007 + RERA |
| MX | R — 10% (LISR 116) | D | R — SPEI / Stripe / MercadoPago | S — BURO_CREDITO_MX stub | R — state Código Civil |

All 12 plugins carry inline port implementations on their
`CountryPlugin` surface so PhZ-GLOBAL's `resolvePlugin(code)` function
surfaces them via `plugin.taxRegime`, `plugin.paymentRails`, etc.

## Universal validators

Located under `packages/compliance-plugins/src/validators/`:

### `phone.ts` — `validatePhone(raw, countryHint?)`
Sample IO:
- `validatePhone('+49 30 12345678')` → `{ status: 'valid', e164: '+493012345678', countryCode: 'DE' }`
- `validatePhone('010-1234-5678', 'KR')` → `{ status: 'valid', e164: '+821012345678' }`
- `validatePhone('12345678')` → `{ status: 'needs-country-hint' }`
- Unknown calling-code input (`+999…`) returns `valid` with a note — we
  prefer acceptance over rejection for global reach.

### `address.ts` — `validateAddress(raw, countryCode)`
Extracts `street / city / postalCode / region` with per-country rules:
- DE `"Alexanderstr. 1\n10178 Berlin"` → `valid`, `postalCode: '10178'`
- GB `"10 Downing Street\nLondon SW1A 2AA"` → `valid`, `postalCode: 'SW1A 2AA'`
- Unknown country → `status: 'unverified'` (raw preserved)
- Missing postal code for DE → `invalid`, `missingFields: ['postalCode-format']`

### `national-id.ts` — `validateNationalId(raw, countryCode)`
Dispatches via a resolver injected by `countries/index.ts`. Unknown
country returns `validation-unavailable` (NOT `invalid`) so tenants in
unsupported jurisdictions still onboard. Custom validators include
Luhn-checked SIN (CA) and check-digit-validated CPF (BR).

### `tax-id.ts` — `validateTaxId(raw, countryCode)`
Regex dispatch for 18 countries (DE USt-IdNr, FR VAT, GB VAT + UTR,
US EIN + SSN/ITIN, CA BN, AU ABN, SG UEN, KR BRN, JP Corporate, IN
GSTIN + PAN, BR CNPJ, AE TRN, MX RFC, KE PIN, TZ TIN, NG TIN, ZA VAT,
UG TIN). Unknown country → `validation-unavailable`.

### `bank-account.ts` — `validateBankAccount(raw, countryHint?)`
Dispatches by input shape:
- IBAN (starts with 2 letters + 2 digits) → ISO 13616 mod-97 checksum
- SWIFT BIC (8 or 11 alphanumeric) → format check
- ABA (9 digits) → Fed weighted-sum check
- Anything else → `validation-unavailable` with raw preserved

## Global-default fallback behaviour

`resolveExtendedProfile('XX')` (or any unregistered code, or `null` /
`undefined`) returns `GLOBAL_DEFAULT_PROFILE`:
- currency: USD, symbol `$`, minor units 100
- languages: `['en']`
- dateFormat: `YYYY-MM-DD`
- `nationalIdValidator: null` (ID accepted as-is by the universal
  validator — returns `validation-unavailable`)
- `taxRegime: DEFAULT_TAX_REGIME` (zero with
  `CONFIGURE_FOR_YOUR_JURISDICTION` rate note + `requiresManualConfiguration`)
- `paymentRails: DEFAULT_PAYMENT_RAIL_PORT` (Stripe + manual)
- `leaseLaw: DEFAULT_LEASE_LAW` (PhZ-GLOBAL's canonical default —
  universal clauses, null notice windows, `CONFIGURE_FOR_YOUR_JURISDICTION`
  deposit / rent-cap citations)
- `tenantScreening: DEFAULT_TENANT_SCREENING` (returns
  `flags: ['BUREAU_NOT_CONFIGURED']`)

`getTenantCountryDefault()` is the stub the tenant-onboarding UI uses
when no IP-geolocation is wired in — currently returns `'DE'` as a
deterministic hint. Real geo-IP is deferred to another wave.

## Known limits — honesty about configured vs stubbed tax rates

- **AU**: ordinary rental income is NOT withholding-taxed in Australia.
  Foreign-resident landlords file annual returns; the plugin flags
  `requiresManualConfiguration: true` so operators don't auto-withhold.
- **AE**: no personal income tax per Federal Decree-Law 47/2022; corporate
  tax may apply to juristic landlords — flagged for operator configuration.
- **BR**: 15% non-resident rate is real; resident landlords use carnê-leão
  (monthly-declaration regime) — residents flagged for per-landlord config.
- **IN**: default 10% is § 194-I (corporate payers); § 194-IB individual
  payers use 5% — operator must override per landlord.
- **MX**: 10% assumes corporate-payer regime (LISR Art. 116); individual
  landlords electing monthly provisional payments need operator override.
- **CA**: 25% is Part XIII gross rate; NR6 election can reduce it to net-
  income taxation — deferred to operator config.
- **US**: existing plugin — federal baseline remains 0% withholding;
  state-level overrides via `withStateOverride()`.

## Port-interface additions (coordinated with PhZ-GLOBAL)

The final canonical ports are owned by PhZ-GLOBAL under
`packages/compliance-plugins/src/ports/`:
- `tax-regime.port.ts` (PhZ)
- `tax-filing.port.ts` (PhZ)
- `payment-rail.port.ts` (PhZ)
- `tenant-screening.port.ts` (PhZ)
- `lease-law.port.ts` (PhZ)

My initial placeholder for `lease-law.port.ts` was superseded by PhZ's
canonical version mid-wave; I re-authored the `_shared.ts` helper and
all 12 country implementations against PhZ's final shape
(`requiredClauses(leaseKind)`, `noticeWindowDays(reason)`,
`depositCapMultiple(regime)`, `rentIncreaseCap(regime)`).

## File inventory

NEW files:
- `packages/compliance-plugins/src/countries/_shared.ts`
- `packages/compliance-plugins/src/countries/types.ts`
- `packages/compliance-plugins/src/countries/index.ts`
- `packages/compliance-plugins/src/countries/{de,kr,gb,sg,ca,au,in,br,jp,fr,ae,mx}/index.ts` (12 files)
- `packages/compliance-plugins/src/validators/index.ts`
- `packages/compliance-plugins/src/validators/{phone,address,national-id,tax-id,bank-account}.ts`
- `packages/compliance-plugins/src/tests/countries/countries.test.ts`
- `packages/compliance-plugins/src/tests/validators/{phone,address,national-id,tax-id,bank-account}.test.ts`

MODIFIED:
- `packages/compliance-plugins/src/index.ts` — adds country + validator
  + ports re-exports and calls `registerAllCountryPlugins()` at load.

UNCHANGED (PhZ-GLOBAL scope — I only consumed these):
- `packages/compliance-plugins/src/ports/*.ts`
- `packages/compliance-plugins/src/registry.ts`

## Verification

- `pnpm --filter @borjie/compliance-plugins typecheck` — **green**
- `pnpm --filter @borjie/compliance-plugins test` — **164 / 164 pass**
  - 41 country tests
  - 11 bank-account tests
  - 8 phone tests
  - 7 tax-ID tests
  - 5 address tests
  - 4 national-ID tests
  - 88 pre-existing tests still green (registry + ports)
- `pnpm -r typecheck` — **green** (no new TS errors anywhere in the
  monorepo; `services/api-gateway`, `domain-services`, `identity`,
  `apps/*` all compile clean)

## Notes on libphonenumber-js

The mandate suggested `pnpm add libphonenumber-js`. I opted to ship
zero-dependency validators instead because:
1. `google-libphonenumber` is already present at the workspace root for
   heavier parsing use cases.
2. `buildPhoneNormalizer()` in `core/phone.ts` already handles the 18
   calling codes we ship. The universal `validatePhone` only needs to
   detect + route, not parse subscriber-side formats.
3. Adding a new runtime dep in a shared package forces reinstall across
   every service — out of scope for this wave.

If PhZ-GLOBAL later decides to standardise on libphonenumber-js, the
universal `validatePhone` exports a stable interface that's easy to
back with it — the internal calling-code table is the only swap.

## Stop-condition check

- [x] 12 new country plugins exist
- [x] Every port has at least a stub impl per country
- [x] 5 universal validators
- [x] Typecheck green
- [x] Tests green
- [x] Honest tax-info breakdown (see "Known limits")
