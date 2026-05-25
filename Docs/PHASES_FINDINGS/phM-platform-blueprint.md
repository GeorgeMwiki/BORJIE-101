# BORJIE Platform Amplification Blueprint
Agent PhM-PLATFORM-AUDIT — generated 2026-04-20
Scope: entire monorepo under repo root.
Purpose: map every "Nairobi-first" assumption that blocks London / Seoul / Berlin / Sao Paulo operators, and every "human-limit" workflow that an AI-native system could do at 10–100× throughput. Output is a strategic artifact for Waves 27–60 to execute against.

---

## Executive summary

BORJIE has already done the architectural heavy lifting: a pluggable `CountryPlugin` system (`packages/compliance-plugins/src/core/types.ts:103`), a `RegionConfig` adapter with plugin-backed currency/phone/KYC/payment rails (`packages/domain-models/src/common/region-config.ts`), a persona-per-facet Brain (`packages/ai-copilot/src/personas/persona.ts`), a typed autonomy policy (`packages/ai-copilot/src/autonomy/types.ts`), a pluggable negotiation engine (`services/domain-services/src/negotiation/types.ts`), an AI-native capability layer (`packages/ai-copilot/src/ai-native/`), and a GDPR/DPA-2019-aware compliance surface. The bones of a global, AI-native property-management operating system are in place.

The gap is not bones, it is flesh. Every layer of the product still whispers "we built this in Nairobi." Currency enum is frozen to 7 codes (`packages/domain-models/src/common/money.ts:11`) — no JPY, KRW, BRL, INR, AED. App-locale list is frozen to `['en', 'sw']` (`apps/estate-manager-app/src/i18n.ts:4`). Persona preamble hardcodes "East Africa, Kenya DPA 2019, KRA, M-Pesa, Swahili" into every LLM turn (`packages/ai-copilot/src/personas/system-prompts.ts:16-40`). Default persona displayName is `"Borjie Estate Manager"` with no per-tenant rename surface. Payment-method enum hardcodes `'mpesa'` as a first-class citizen (`packages/database/src/schemas/payment.schema.ts:59`). Properties table still ships `country TEXT DEFAULT 'KE'` (`packages/database/src/schemas/property.schema.ts:96`). Compliance plugins exist for TZ/KE/UG/NG/ZA/US — but nine of the ten largest addressable markets outside East Africa have no plugin at all. These are all *flesh-layer* hardcodes a London operator hits in the first ninety minutes.

The *second* pillar — AI-limits not human-limits — is further behind than globalisation. Heartbeat is housekeeping only (5 duties, zero proactive reasoning — `packages/ai-copilot/src/heartbeat/heartbeat-engine.ts:1-170`). Rent is static until a human edits it; the rent-repricing advisor exists (`packages/ai-copilot/src/skills/estate/rent-repricing-advisor.ts`) but never fires autonomously. Credit rating is recomputed on a schedule, not from every signal. Dashboards describe, rarely prescribe. Translation is static JSON, not on-demand LLM. Legal-drafter, dynamic-pricing, and voice-agent directories exist but are empty (`packages/ai-copilot/src/ai-native/{legal-drafter,dynamic-pricing,voice-agent}`). Customer service is email/WhatsApp/SMS but no voice IVR, no phone-call answering. Autonomy policy covers 5 domains (finance/leasing/maintenance/compliance/communications) — missing marketing, HR, procurement, insurance-claims, disposals, legal-proceedings, acquisitions. Every one of these is a 10–100× moat when an AI operates at the cadence of signals rather than the cadence of human attention.

Priority for Waves 27–60: (1) strip every East-African hardcode from the persona + i18n + schema surfaces so the system is *neutral* by default; (2) ship seven new compliance plugins to unlock 70% of global addressable market; (3) turn the heartbeat into a genuinely proactive "always-on operator" that ticks through continuous repricing, continuous risk recomputation, continuous nudges; (4) expand autonomy-policy to the five missing domains; (5) wire voice + IVR + any-language polyglot into customer service; (6) replace static i18n JSON with an on-demand LLM translation cache. These six tracks unlock the "AI limits not human limits, Kenya or Korea" thesis.

---

## Part A: Global-Readiness Audit

### A.1 Data layer gaps

| # | Schema:line | Hardcode / assumption | Proposed fix |
|---|---|---|---|
| A1 | `packages/database/src/schemas/property.schema.ts:96` | `country: text().default('KE')` — silent default to Kenya | Drop default in migration; make non-null from region-config at insert time |
| A2 | `packages/database/src/schemas/payment.schema.ts:59-66` | `paymentMethodEnum` hardcodes `mpesa, bank_transfer, card, cash, cheque, other` — M-Pesa privileged over PayNow, Pix, SEPA, ACH, iDEAL, Alipay, WeChat Pay, UPI | Replace enum with `text` + `paymentRailId` FK into a `payment_rails` lookup table seeded from plugin registry |
| A3 | `packages/domain-models/src/common/money.ts:11` | `MoneySchema currency: z.enum(['KES','TZS','UGX','RWF','USD','EUR','GBP'])` — 7-currency cap | Replace with `z.string().length(3).regex(/^[A-Z]{3}$/)` validated against `CURRENCY_DECIMALS` populated from plugins |
| A4 | `packages/domain-models/src/common/money.ts:92-100` | `CURRENCY_DECIMALS` record has only 7 entries | Extend to full ISO-4217 decimals table (BIF=0, JPY=0, KRW=0, BHD=3, etc.) or derive via `Intl.NumberFormat.resolvedOptions()` |
| A5 | `packages/database/src/schemas/customer.schema.ts:62-64` | `email` + `phone` both `NOT NULL` — many markets have tenants with only one | Make phone optional; enforce at-least-one-of at domain layer |
| A6 | `packages/database/src/schemas/customer.schema.ts:32-40` | `idDocumentTypeEnum` fixed to `national_id, passport, driving_license, military_id, voter_id, work_permit, other` — misses Aadhaar, Social Security Number, MyNumber (JP), NRIC (SG), Personennummer (DE), CPF (BR), tax_id_only | Add `residence_permit, tax_id, ssn, aadhaar, my_number, nric, other_id` or move to open string + validator from plugin |
| A7 | `packages/database/src/schemas/customer.schema.ts:96-101` | Current-address schema has single line1/line2/city/state/postalCode — misses UK prefix/suffix postcodes, Japan's cho/chome, apartment-block-flat-wing used in KR/SG | Add `addressJsonb` free-form + structured canonical city/country; render via locale-aware formatter |
| A8 | `packages/database/src/schemas/payment.schema.ts:198-200` | `payerPhone/payerAccount` free text — no country-prefix normalization at write | Normalize at write via `normalizePhoneForCountry` |
| A9 | `packages/database/src/schemas/lease.schema.ts:56-67` | `terminationReasonEnum` has KE-flavoured `eviction, non_payment` but missing jurisdiction-specific reasons (e.g. UK Section 21, DE Eigenbedarfskündigung, JP fixed-term non-renewal) | Make `terminationReasonCode` plugin-driven |
| A10 | `packages/database/src/schemas/lease.schema.ts:47-54` | `rentFrequencyEnum` misses `fortnightly` (AU), `semi_monthly` (parts of US), `custom` | Extend + allow custom schedule via `installmentSchedule` jsonb |
| A11 | `packages/database/src/schemas/payment.schema.ts:115-117` | `taxType text` with common values "VAT, withholding" — misses GST (AU/SG/IN), consumption-tax (JP), sales-tax (US varies by state) | Move tax_type to plugin-driven string |
| A12 | `packages/database/src/schemas/payment.schema.ts:425-431` | `ledgerAccountTypeEnum` uses GAAP/IFRS 5-category model — fine globally, but every row lacks `fiscalCalendarId` — calendars differ (IN fiscal April-March, JP fiscal April-March, US calendar year) | Add `fiscal_calendar_id` FK to a `fiscal_calendars` plugin lookup |
| A13 | `packages/database/src/schemas/tenant.schema.ts:101` | Tenants.country nullable with comment about dropped 'KE' default — but no enforcement that `country ∈ supported_countries` | Add CHECK constraint or FK to `country_plugins` table |
| A14 | 69 schema files total | No schema captures `tenant.legalLanguage` (BCP-47) — locale for generated docs | Add `primary_locale TEXT NOT NULL`, drives letters/contracts/receipts locale |
| A15 | `packages/database/src/schemas/gepg.schema.ts` | Tanzania-specific (Gov Electronic Payment Gateway) schema exists as top-level — mixes jurisdiction-specific data into core | Move to a `jurisdiction_extensions` schema namespace; promote only via plugin contract |
| A16 | `packages/database/src/schemas/credit-rating.schema.ts` | Credit rating scoring-model presumes KES/KE-style payment-history weights | Already parameterised via GradingWeights (good) but `CreditBand` strings ('excellent','good','fair','poor','very_poor') are English — localise at render not storage (fine) |
| A17 | `packages/database/src/schemas/property.schema.ts:44-59` | `unitTypeEnum` uses US/UK-centric labels like `studio, one_bedroom` — JP's 1K/1DK/1LDK, KR's officetel, DE's Wohnung-sqm-only are not captured | Add `one_room_asian` + `local_label text` for display; keep canonical coarse bucketing |
| A18 | `packages/database/src/schemas/property.schema.ts:97-98` | Lat/Lng stored as decimal — good; no `plus_code` or `h3_index` for Africa/Asia addressing without postal codes | Add `plus_code text`, `h3_index text` in a later migration |
| A19 | `packages/database/src/schemas/geo.schema.ts` (geo.schema) | Org-defined geo hierarchy exists — good architectural prior art (`Docs/… geo-node`) | Keep; drive region-first search off it |
| A20 | `packages/database/src/schemas/compliance.schema.ts` | No `jurisdictional_rule_snapshot` table — when a compliance rule changes, past decisions aren't pinned to the rule-version that governed them | Add `rule_version_snapshot jsonb` on every compliance decision row |

### A.2 Domain layer hardcodes (with file:line)

| # | File:line | Hardcode | Replacement |
|---|---|---|---|
| B1 | `packages/ai-copilot/src/personas/system-prompts.ts:16-40` | `BRAIN_PREAMBLE` embeds "East Africa, Kenya Data Protection Act 2019, landlord-tenant law, KRA rental income tax, M-Pesa conventions, Swahili/Sheng as first-class" | Replace with `{{jurisdiction_clause}}` template var resolved from `regionConfig.compliance.*` at bind-time |
| B2 | `packages/ai-copilot/src/personas/system-prompts.ts:155-167` | `JUNIOR_FINANCE` prompt lists "M-Pesa paybill/till statements", "KRA rental income obligations", "service-charge reconciliations (sinking fund, levies)" | Parameterise by `regionConfig.mobileMoneyProviders[].name`, `regionConfig.compliance.taxAuthority`, local service-charge vocabulary |
| B3 | `packages/ai-copilot/src/personas/system-prompts.ts:187-201` | `JUNIOR_COMMUNICATIONS` hardcodes "Swahili + English, code-switched" | Replace with `{{supported_locales_for_tenant}}` — let polyglot-support decide |
| B4 | `packages/ai-copilot/src/personas/sub-personas/finance-persona.ts:21-29` | Hardcodes NCBA, KCB, Equity, Co-op banks, "Nairobi mid-market" | Replace with `{{country.major_banks}}` + local benchmark hints from market-intelligence |
| B5 | `packages/ai-copilot/src/personas/sub-personas/compliance-persona.ts:16-37` | Kenya DPA 2019, Rent Restriction Act, Tanzania Land Act explicit | Generate from `regionConfig.compliance.taxAuthority` + plugin-provided "primary statutes" list (new plugin field) |
| B6 | `packages/ai-copilot/src/personas/sub-personas/communications-persona.ts:26-30` | "Natural Tanzanian or Kenyan Swahili", example "Habari, your rent for this month is KSh 25,000" | Move example templates into plugin-scoped content bundle; the persona says "respect local register" |
| B7 | `packages/ai-copilot/src/personas/sub-personas/leasing-persona.ts:14-30` | "KRA PIN verification", "Kenya landlord-tenant act, Tanzania rent restriction act" | Derive via `regionConfig.compliance.taxpayerIdLabel` + plugin lease-law reference |
| B8 | `packages/ai-copilot/src/personas/personas.catalog.ts:39-43` | Skill ids namespaced `skill.kenya.mpesa_reconcile`, `skill.kenya.kra_rental_summary`, `skill.kenya.service_charge_reconcile`, `skill.kenya.swahili_draft` | Rename to `skill.payment.mobile_money_reconcile`, `skill.tax.rental_income_summary`, etc. — jurisdiction-neutral dispatched via plugin |
| B9 | `packages/ai-copilot/src/skills/kenya/mpesa-reconcile.ts:25-36` | `MpesaRowSchema` has hardcoded fields `channel: 'paybill' | 'till' | 'c2b'`, `amountKes: number` | Generalise to `MobileMoneyRowSchema` with `channel: string`, `amount: number, currency: CurrencyCode`, `providerId: string` |
| B10 | `packages/ai-copilot/src/skills/kenya/swahili-draft.ts:22-35` | `LocaleSchema = z.enum(['en','sw','sheng'])` | Generalise to `LocaleSchema = z.string().regex(BCP47_REGEX)`; templates become plugin content |
| B11 | `packages/ai-copilot/src/skills/kenya/kra-rental-summary.ts` | Kenya-only | Replace with generic `skill.tax.rental_income_summary` dispatching via `regionConfig.tax.rentalIncomeTaxName/Rate` |
| B12 | `services/payments/src/providers/mpesa/*`, `gepg/`, `clickpesa/`, `tigopesa/`, `airtel-money/` | African-only gateway set | Add Stripe+ACH+Plaid are in plugins, but service/providers dir must add `stripe/`, `adyen/`, `razorpay/` (IN), `pagseguro/` (BR), `gocardless/` (EU), `sepa-direct-debit/` |
| B13 | `services/payments/src/providers/tanzania-payment-factory.ts` | Factory is TZ-scoped | Replace with generic `PaymentProviderFactory` keyed on `countryCode` |
| B14 | `services/notifications/src/sms/africas-talking.ts` | Africa's Talking is default SMS — KE/TZ/UG/RW/MW | `providers/sms/twilio.ts` exists — wire a `SmsProviderFactory` by `countryCode`, with Twilio-global, AT-Africa, MessageBird-EU, Infobip-global, AWS SNS |
| B15 | `services/notifications/src/whatsapp/templates.ts` | ~25 hardcoded en+sw template bodies | Replace with plugin-provided bundles + polyglot on-demand |
| B16 | `services/notifications/src/whatsapp/reminder-engine.ts:625-629` | `const locale = language === 'sw' ? 'sw' : 'en'` | Replace with `regionConfig.defaultLocale` or `tenant.primaryLocale` |
| B17 | `packages/ai-copilot/src/personas/sub-personas/consultant-persona.ts` | Contains "Nairobi apartments", "KSh" references (found via grep) | Strip; consult via structured data not prose |
| B18 | `packages/ai-copilot/src/personas/sub-personas/professor-persona.ts` | References "East Africa real estate tradition" | Generalise to "your operator's home market" |
| B19 | `packages/ai-copilot/src/knowledge/case-studies/*` | 11 case studies, some titled "Muthaiga Portfolio Acquisition" (`01-muthaiga-portfolio-acquisition.ts`) | Keep as KE corpus; add `packages/ai-copilot/src/knowledge/case-studies/{country}/*` structure; inject by tenant country |
| B20 | `packages/ai-copilot/src/classroom/concepts-catalog.ts` | References East African real estate concepts | Tag concepts with `applicabilityCountries: CountryCode[]`; gate presentation by tenant |
| B21 | `packages/ai-copilot/src/credit-rating/scoring-model.ts` | Scoring uses 0.1 late-fee cap (KE-flavoured) as a signal | Inject `regionConfig.tax.maxLateFeeRate` at scoring time |
| B22 | `services/domain-services/src/onboarding/procedure-library.ts` | Procedure-library hardcodes KE/TZ-specific onboarding steps (grepped 3 hits for mpesa/swahili) | Make procedures plugin-scoped |
| B23 | `packages/database/src/seeds/demo-org-seed.ts` | Seed data is Nairobi / East Africa flavoured — fine for demo KE but we need seeds per supported plugin | Add `packages/database/src/seeds/<country>/` seed bundles |
| B24 | `services/domain-services/src/negotiation/__tests__/*` | KES-specific fixtures | Parameterise by currency |
| B25 | `services/domain-services/src/scheduling/types.ts` | Mentions mpesa in 1 hit | Audit: should be jurisdiction-neutral scheduling types |
| B26 | `services/reports/src/compliance/ke-kra-formatter.ts` | KE-specific KRA export formatter | Good to isolate; add UK HMRC, US IRS, DE Finanzamt, IN GST, JP NTA formatters in parallel files |
| B27 | `services/payments-ledger/src/providers/mpesa-provider.ts:51 occurrences` | Core ledger provider is M-Pesa-specific | Is parallel to `stripe-provider.ts` — need Adyen, Razorpay, Pix, iDEAL, SEPA DD, PayNow providers |

### A.3 AI brain / persona gaps

| # | Finding | File:line | Impact |
|---|---|---|---|
| C1 | `displayName: 'Borjie Estate Manager'` hardcoded in persona template — no per-tenant rename to "Professor Kim", "Signor Rossi", "Mr. Smith" | `packages/ai-copilot/src/personas/personas.catalog.ts:67` | A London operator introducing this to their team cannot rebrand; feels off |
| C2 | `"Mr. Mwikila"` literal references in 55 places across 30 files (including `defaults.ts:7`, `exception-inbox.ts`, `strategic-advisor.ts`, `onboarding-flow.ts:53,59`, `types.ts`, `autonomous-action-audit.ts`) | Many files | Persona identity leaks into code comments, user-visible onboarding prompts, audit surfaces. Needs `persona.displayName` substitution everywhere user-facing |
| C3 | `BRAIN_PREAMBLE` hardcodes East-African values + Kenya DPA 2019 + KRA + M-Pesa + Swahili/Sheng in the SHARED system prompt that every persona inherits | `packages/ai-copilot/src/personas/system-prompts.ts:16-40` | A Seoul operator's AI brain will cite Kenya DPA 2019 in every turn |
| C4 | Sub-persona prompt layers (finance, compliance, communications, leasing, maintenance) embed country-specific facts as first-class content | `packages/ai-copilot/src/personas/sub-personas/*.ts` | Cannot be overridden at tenant level — requires code change |
| C5 | Persona greeting conventions (formal/informal, Bwana/Bi, first-name) hardcoded in communications persona | `packages/ai-copilot/src/personas/sub-personas/communications-persona.ts:29` | Japanese formality (-san, -sama, keigo) + German Sie/Du + Spanish tú/usted not represented |
| C6 | Sub-persona teaching-style, pedagogy-standards reference East-African context (grepped) | `packages/ai-copilot/src/personas/sub-personas/{teaching-style.ts,pedagogy-standards.ts,PEDAGOGY_STANDARDS.md}` | Classroom/training content presumes KE market |
| C7 | Eval scenarios + golden scenarios are KE-framed — 20 occurrences each | `packages/ai-copilot/src/eval/{golden-scenarios.ts,scenarios-extended.ts}` | Eval harness won't catch regressions on German/Korean flows because none exist |
| C8 | `orchestrator/intent-router.ts` has KE-flavoured intent patterns (grepped 2 hits) | Same file | Intent classification may misroute KR/DE tenant queries |
| C9 | No persona-tenant override channel — tenants cannot fork the persona's tone, allowed-tools, greeting style without schema changes | Architecture gap | "Personalization knobs" are missing as a first-class customer-facing surface |
| C10 | Voice agent directory exists but is empty (`ai-native/voice-agent/`) | Capability gap | No persona-voice configuration (voice id, pitch, accent) — required for voice-IVR to feel local |
| C11 | Legal drafter directory exists but is empty (`ai-native/legal-drafter/`) | Capability gap | PhL is building this; integration point: persona emits a `draft-legal` intent that calls the drafter with jurisdiction + fact pattern |
| C12 | Dynamic pricing directory exists but is empty (`ai-native/dynamic-pricing/`) | Capability gap | Rent repricing advisor in `skills/estate/rent-repricing-advisor.ts` exists but is one-shot; needs continuous daily cadence + tenant-level opt-in |

### A.4 App layer gaps per app

**estate-manager-app** (`apps/estate-manager-app`)
- i18n locales frozen at `['en','sw']`, default 'en', swahili matched only if accept-language contains "sw" (`apps/estate-manager-app/src/i18n.ts:4-14`). A Berlin user with `de-DE` locale silently gets English.
- `apps/estate-manager-app/src/components/MoneyDisplay.tsx:2` — hardcodes KES-related formatting; 2 hits.
- `apps/estate-manager-app/src/lib/brain-client.ts:3` — KE/mpesa references.
- Tabler-icons + lucide are locale-neutral — good.
- No phone-input component with country-picker (searched — nothing imports `react-phone-number-input` or equivalent).
- No address-form component that switches fields by country (one monolithic form assumed).
- No date-formatter wrapped — Intl.DateTimeFormat used correctly in some places but many raw `toLocaleDateString` calls without `locale` arg.
- `app/coworker/page.tsx:2` — Mwikila literal.

**customer-app** (`apps/customer-app`)
- Same locale freeze (en/sw only).
- `src/components/marketing/LiveArrearsDemo.tsx` and `LiveAffordabilityDemo.tsx` use formatMoney but no guarantee tenant currency is threaded through.
- `src/app/api/brain/migrate/commit/route.ts:1` — Mwikila literal.

**owner-portal** (`apps/owner-portal`)
- Vite-based; `messages/en.json` + `messages/sw.json` only.
- `src/pages/PortfolioGrade.tsx:4` — KES/Nairobi hits.
- `src/pages/SettingsPage.tsx:1` — KE hit.
- Many chart components (`ArrearsAgingChart`, `NOIChart`, `MaintenanceCostTrends`) call formatMoney with `undefined` locale ⇒ browser fallback.

**admin-portal** (`apps/admin-portal`)
- Vite-based; en/sw only.
- Platform subscription page + overview call formatMoney directly; no currency plumbed from platform admin's home country.

**borjie_app** — mobile shell, same i18n freeze.

Common app gaps:
- No country-switch at login (defaults to cookie or accept-language).
- No tenant-settings UI to change `primary_locale` or `primary_currency` without a dev migration.
- No RTL support for Arabic (when AE/SA plugin ships) — Tailwind `dir` attribute not thread through.
- No FormatsContext (dates, money, numbers, phones) — each component does its own thing.
- No region-config provider — `getRegionConfig()` is server-side; the browser has no sibling.

### A.5 Integration adapters needed

| # | Category | Existing | Missing | Rationale |
|---|---|---|---|---|
| E1 | Card rails | Stripe (via plugin) | Adyen, Braintree, Worldpay, Rapyd | Required for EU/UK large-landlord deals |
| E2 | Bank rails | ACH (via plugin), M-Pesa B2C | SEPA DD, UK Faster Payments, iDEAL (NL), BACS, Pix (BR), UPI (IN), PayNow (SG), FedNow (US) | All nontrivial — hard to do without compliance plugins |
| E3 | Wallet/mobile-money | M-Pesa, Airtel Money, Tigo Pesa, ClickPesa | MTN Momo, Orange Money, GCash (PH), Alipay, WeChat Pay, KakaoPay (KR), Paytm (IN), MPESA Global | Defines "local-first payment" |
| E4 | SMS | Africa's Talking, Twilio (stub file exists) | MessageBird (EU), Infobip (global), AWS SNS (global), Sinch (APAC), Plivo | Twilio stub is skeletal per grep |
| E5 | WhatsApp | Meta direct (client.ts), Twilio WhatsApp (stub) | 360Dialog, MessageBird WA — different pricing regions | Enterprise WhatsApp buyers often on 360Dialog |
| E6 | Email | SendGrid, SES, SMTP (all in `providers/email/`) | Mailgun, Postmark, Mailjet (EU DPR) | Data-residency for EU tenants |
| E7 | Voice/IVR | None (voice-agent dir empty) | Twilio Voice, Vonage, Plivo, Africa's Talking Voice, Bandwidth (US) | Zero coverage — major gap |
| E8 | KYC / ID-verify | SSN (US), NIDA (TZ), Huduma (KE — inferred) | Onfido, Jumio, Persona, Stripe Identity, Sumsub, Aadhaar eKYC (IN), MyInfo (SG), My Number (JP), BankID (EU Nordic) | Large market — EU BankID alone opens DE/SE/NO |
| E9 | Credit bureau | CRB (KE) | Experian, Equifax, TransUnion, Schufa (DE), CIC (IT), BIK (PL), CRIF (EU), CIBIL (IN) | Needed for tenant scoring at global scale |
| E10 | Document e-sign | Internal (docs/E-sign is stubbed per WAVE26 findings) | DocuSign, Adobe Sign, HelloSign (Dropbox), signNow, Yousign (EU) | Every lease signing today depends on this |
| E11 | Tax filing | KRA (via region-config overlay) | HMRC (UK), IRS (US), Finanzamt (DE), NTA (JP), GST/DGFT (IN) | Same architectural surface; plug-per-country |
| E12 | Gov reporting | GePG (TZ) | No others | Usually e-filing XMLs — one-per-jurisdiction adapter |
| E13 | Geo / maps | Lat/Lng stored, no provider | Google Maps / Mapbox / HERE / OSRM for address-autocomplete, "last-mile"-for-delivery | Address entry UX |
| E14 | Open-banking | None | Plaid (via plugin), TrueLayer (UK), Tink (EU), Yodlee | For tenant financial-profile verification |
| E15 | Accounting | None wired | QuickBooks, Xero, Sage, Datev (DE), Zoho, Odoo export | Property managers rarely ditch their accounting — need bidirectional sync |

### A.6 Jurisdiction backlog (ranked by addressable market)

Criteria: rental-stock × addressable-operators × willingness-to-pay-for-SaaS × data-residency-friction × legal-system-translatability.

Current coverage: KE, TZ, UG, NG, ZA, US, RW (synthetic). Roughly 200M+ rental units covered at population-share, but commercial ARPU is low outside US.

Priority tier 1 (ship in Waves 27–32 — together ≈ 60% of global PropTech TAM):

1. **Germany (DE)** — Rental stock ≈ 22M, high legal complexity (Mietpreisbremse, Kündigungsschutz, Nebenkosten), multi-year leases, Schufa for credit. Strong WTP. ~€1.5B PropTech market.
2. **United Kingdom (GB)** — ≈ 4.5M private rentals, strict deposit protection (DPS/TDS/mydeposits), HMO licensing, Section 21 reform, Right-to-Rent checks. Legal templates mature — fast to ship.
3. **France (FR)** — ≈ 7M rentals, Loi ALUR complexity, strict eviction-moratorium seasons, CAF housing benefit integration.
4. **Japan (JP)** — ≈ 19M private rentals, very formal lease protocols, reikin/shikikin deposit structure, guarantor-company integration, fixed-term leases.
5. **Australia (AU)** — ≈ 3M rentals, state-level variance (NSW/VIC/QLD), RTA bond-board integrations, fortnightly rent cadence.
6. **India (IN)** — ≈ 40M+ rental stock, RERA compliance, state-by-state stamp duty, Aadhaar eKYC, UPI rails.
7. **Canada (CA)** — ≈ 5M rentals, provincial variance, Landlord and Tenant Board (ON) process, Quebec language requirements.

Priority tier 2 (Waves 33–40):

8. **Singapore (SG)** — high ARPU, MyInfo KYC, stamp duty filing, SingPass integration.
9. **Netherlands (NL)** — rent-point system (WWS), strict tenancy protection, iDEAL rails.
10. **Spain (ES)** — LAU 1994 framework, fianza deposit registry, autonomous-community variance.
11. **Italy (IT)** — cedolare secca tax regime, registered-lease requirement, CIC credit bureau.
12. **South Korea (KR)** — jeonse + wolse hybrid deposit model, KakaoPay/Toss rails, National Tax Service reporting.
13. **Brazil (BR)** — Lei do Inquilinato, IGP-M inflation-indexing, Pix rails.
14. **Mexico (MX)** — ISR rental tax, state-level variance.
15. **United Arab Emirates (AE)** — Ejari lease registration, RERA Dubai, USD/AED dual-currency.
16. **Switzerland (CH)** — very strict tenant protection, 3-month notice, trilingual (DE/FR/IT).
17. **Ireland (IE)** — RTB registration, rent-pressure-zones.

Priority tier 3 (Waves 41–50): Netherlands, Sweden, Norway, Denmark, Finland, Belgium, Portugal, Austria, Poland, Czechia, Thailand, Vietnam, Indonesia, Philippines, Turkey, Saudi Arabia, Egypt, Morocco, Ghana, Ethiopia.

---

## Part B: AI-Limits Audit

### B.1 Workflows that should be autonomous but aren't

Every `POST /:id/approve` is a candidate. Located in 11 routers (`services/api-gateway/src/routes/{approvals,monthly-close,conditional-surveys,sublease,arrears,letters,migration,workflows}.router.ts` + `bff/{owner-portal,estate-manager-app}.ts`).

| # | Human-gate endpoint | Why human today | Why AI-native tomorrow |
|---|---|---|---|
| F1 | `POST /approvals/:id/approve` | Catch-all queue | Most items have deterministic decision rules; auto-resolve those, surface only the 5% genuine judgment calls |
| F2 | `POST /arrears/.../approve` writeoff | Money moves | Writeoffs below `autoApproveWaiversMinorUnits` already allowed by `AutonomyPolicy.finance`; wire the path end-to-end |
| F3 | `POST /monthly-close/approve` | Accounting sign-off | AI can do the close checklist; human signs the final gate only |
| F4 | `POST /sublease/approve` | Consent decision | `sublease-consent` model is plugin-provided; auto-approve where the plugin says "notice-only" |
| F5 | `POST /letters/approve` | Tenant-facing legal | Templates already versioned; AI drafts, compliance persona reviews, auto-send below-threshold |
| F6 | `POST /migration/approve` | Data load | Migration-wizard exists; gated because extraction confidence varies — auto-commit at >0.95 confidence |
| F7 | `POST /workflows/:runId/advance` with `approve: bool` | Generic workflow | Many workflow states are deterministic — Wave 27 can auto-advance on policy match |
| F8 | `POST /conditional-surveys/approve` | Survey variance | Should auto-score + publish; human only on flagged items |
| F9 | Rent repricing is manually triggered | Nobody clicks the recompute button daily | Turn on continuous cron (B.5) |
| F10 | Property grading recompute | Manually triggered via `/property-grading/:id/recompute` | Event-driven: any inspection, lease, payment change triggers |
| F11 | Credit rating recompute | `scheduled-recompute.ts` exists but is weekly | Event-driven at every payment + case update |

Manual-trigger endpoints suitable for autonomous cron: property grading, credit rating, rent repricing, NBA queue refresh, renewal-optimizer, churn-predictor, vendor-scorecard, property-valuation. Each has `services/*` or `skills/estate/*` implementation ready — just needs a cron-task orchestrator wired into heartbeat (B.8).

### B.2 Data enrichment opportunities

Today we accept raw input → store raw input. AI-native would enrich.

| Input surface | Today | AI-native |
|---|---|---|
| Maintenance photo upload (`maintenance.schema.ts` media col) | Attached, nothing extracted | `multimodal-inspection` capability stub exists — auto-extract: defect type, severity (1-5), affected system (plumbing/HVAC/electrical), recommended trade, rough cost band, before/after comparison |
| Voice note (tenant) | Not accepted | Transcribe via voice port → sentiment score → intent classify → auto-route to right persona |
| Free-text complaint | Stored verbatim | Classify into `complaintCategoryEnum`, extract entities (unit, time, person), sentiment, urgency tier |
| Lease PDF upload | OCR'd, text extracted | Already extract rent/dates — but not: guarantor clauses, escalation formulas, termination triggers, unusual clauses flagged |
| Bank statement CSV | Reconciled against invoices | Auto-detect payer clusters, flag suspicious recurring payments, detect personal-mixed-with-business |
| KYC document | Store + status | Cross-verify facial liveness (via KYC provider), check against sanctions lists, synthesize identity-confidence score |
| Inspection survey | Stored | Auto-derive property-grade deltas, auto-create maintenance work-orders for any <3 score |
| Tenant chat transcript | Stored | Mine for early-warning signals: eviction-risk lexicon, churn-intent phrases, payment-distress cues |
| Unit floorplan | Stored | Extract room-count, square-footage, layout-efficiency, comparable-units by shape |
| Street-view imagery of property | Not captured | Feed into Vision LLM — compute curb-appeal score, identify external damage, estimate neighborhood tier |
| Vendor invoice (PDF) | Human-uploaded, human-categorised | Auto-extract line items, GL-categorise, flag markups above market |
| Aerial photo / drone scan | Not captured | Roof-condition assessment, solar-potential, parking-compliance |

### B.3 Prescriptive vs descriptive surfaces

Most dashboards describe past performance. AI-native dashboards prescribe next actions.

| Current descriptive surface | File | Prescriptive upgrade |
|---|---|---|
| `apps/owner-portal/src/components/PortfolioAtAGlance.tsx` | 5 KPI tiles | "Do these 3 things this week: renew L-4421 at +7% (tenant stable, market +9%); replace vendor V-12 (SLA 44% vs cohort 82%); chase arrears at P-9 block B (₦ 2.4M exposure)" — each with a one-click action |
| `owner-portal/src/pages/FinancialPage.tsx` | Revenue chart | Add "3 revenue levers: late-fee policy bump (+0.4% cap = +$18k/yr); renewal auto-offer cadence (+2.1% adoption = +$45k); unit-type rebalance — convert 3× 1BR to 2BR at property X" |
| `apps/estate-manager-app/src/screens/DashboardPage.tsx` | "My day" widget | Today: "12 tasks queued — I can handle 9 of them; 3 need your decision: $800 refund, new vendor for emergency, policy exception" |
| `apps/admin-portal/src/pages/DashboardPage.tsx` | Platform metrics | Tenant-health watch: "3 tenants at retention risk — proposed outreach attached" |
| `owner-portal/src/pages/MaintenancePage.tsx` | Backlog table | "If you approve these 5 reassignments, SLA-breach risk drops from 18% to 4%" |
| `apps/estate-manager-app/src/app/coworker/page.tsx` | Coworker chat | Pre-seed top 3 nudges based on user's recent queries + open tasks |
| Portfolio-grade page | Score per property | "To move Property X from B+ to A-: invest $Y in preventive maintenance in 90 days; current occupancy gap closes +2.1%" |
| Vendor scorecards | Descriptive 0-100 | "Swap vendor V-12 for V-47 on HVAC — expected cost delta −14%, SLA delta +23 points" |
| Renewal optimizer | One-shot recommendation | "Watch-list: 23 leases moving out of optimal renewal window in 7 days — 8 are high-retention-value" |
| Tenant credit rating | Score | "Three tenants just crossed into higher risk band — consider proactive outreach" |

Every descriptive surface gets a companion "Action strip" powered by NBA queue (`packages/ai-copilot/src/services/nba-manager-queue.ts` already exists, 6 KE hits) — need to unmount KE-specific content and wire into every dashboard.

### B.4 Dynamic translation architecture

Current state: static `messages/{en,sw}.json` + `formatMoney(m, locale)` + some TODO markers (found 2 TODO(KI-005) comments noting locale should come from recipient, not be hardcoded).

AI-native state:

```
┌─────────────────────────────────────────────┐
│ TranslationCacheService                      │
│  key: (stringId, targetLocale, contextHash)  │
│  ↓ miss: call polyglot-support LLM           │
│  ↓ persist: doc_embeddings + TTL            │
│  ↓ hit: return cached + freshness flag       │
└─────────────────────────────────────────────┘
```

Implementation outline:
- Replace hardcoded `SUPPORTED_LOCALES = ['en','sw']` (`apps/*/src/i18n.ts:4`) with open set derived from `tenant.enabledLocales` (new column).
- Every call to `useTranslations(namespace)` flows through a middleware that asks `TranslationCache.get(key, locale)`; on miss, calls `PolyglotSupport.translate(en-source, locale, brand-context)`.
- Brand context: tenant's system-prompt + terminology glossary (e.g. "rent" → "loyer" (FR), "Miete" (DE), "家賃" (JP)).
- TTL strategy: source English changes → invalidate all non-EN caches for that key.
- Fallback: always have EN source; if target locale fails, render EN + log cache-miss.
- Cost controls: translation pre-fetched at tenant onboarding for top-500 keys; lazy for long-tail.
- Privacy: tenant-specific strings (tenant names, amounts) NOT sent to LLM — pre-redacted and re-hydrated.
- This makes *any* locale a first-class toggle: `ja-JP`, `ko-KR`, `de-DE`, `ar-AE`, `pt-BR` — all served from same cache.

Schema: `packages/database/src/schemas/` needs `translation_cache` table: `(source_string_hash, locale, context_hash, translated_text, model_version, translated_at, invalidated_at)`.

Architectural prior art: `packages/ai-copilot/src/ai-native/polyglot-support/index.ts` already does any-language detect+respond for conversational channels — extend from "chat" to "UI strings."

### B.5 Dynamic pricing + negotiation architecture

Current state: `skills/estate/rent-repricing-advisor.ts` is a pure function taking market-rent & vacancy-risk as input. Never fires autonomously. Negotiation service (`services/domain-services/src/negotiation/`) is fully wired end-to-end.

AI-native state — **Continuous Unit Repricing**:
- Every unit has a `live_market_rent` + `recommended_base_rent` + `confidence` updated nightly from (a) market-intelligence package signals; (b) comp-unit transaction velocity; (c) tenant churn predictions; (d) seasonal demand.
- UI change: everywhere `unit.base_rent_amount` is rendered, add adjacent "AI recommends $X.XXX (+3.1%)" with "Apply / Schedule for renewal / Dismiss" actions.
- Schema: `units` gets `ai_recommended_rent INTEGER`, `ai_recommendation_generated_at TIMESTAMPTZ`, `ai_recommendation_rationale TEXT`, `ai_recommendation_confidence NUMERIC(3,2)`.

AI-native state — **Autonomous Negotiation**:
- NegotiationPolicy already defines floor, ceiling, acceptable concessions, tone (`services/domain-services/src/negotiation/types.ts:56-76`).
- Today: humans initiate a negotiation. Tomorrow: when a qualified lead lands with score ≥ `autoApproveApplicationScoreMin` (already in autonomy policy), the AI auto-opens a negotiation thread, sends the opening offer in the tenant's preferred language, accepts concession packages within policy, escalates to human at floor approach.
- Wire: `negotiations.router.ts` adds `POST /autonomous-start` called from renewal-optimizer and applicant-scoring workflows.
- Bound: NEVER cross `floorPrice`. Already enforced at `services/domain-services/src/negotiation/policy-enforcement.ts`.
- Advisor escalation: negotiation advisor (Opus) consulted when within 5% of floor or concession budget.
- Legal drafter (empty dir) becomes the "close the deal" step — drafts the lease from the agreed-upon terms.

### B.6 Continuous vs one-shot risk scoring

Today (one-shot or schedule):
- Tenant credit rating: `scheduled-recompute.ts` — monthly/weekly batch (`packages/ai-copilot/src/credit-rating/scheduled-recompute.ts`, 4 KE occurrences).
- Property grade: on demand.
- Vendor scorecard: on demand.
- Employee performance: manual review cycles.
- Churn predictor: on demand.

Tomorrow (continuous / event-driven):
- Every payment event → recompute credit rating in <60s.
- Every inspection survey → recompute property grade.
- Every work-order closure → recompute vendor scorecard.
- Every tenant-chat message → recompute sentiment; if drops below policy threshold → raise alert.
- Every completed task → update employee performance delta.
- Every renewal conversation → recompute churn risk.
- Every market-intelligence data point → recompute live rent & property value.

Architecture:
- Event bus: outbox/communications schemas exist (`outbox.schema.ts`, `communications.schema.ts`), `common/events.ts` in domain-services modified per git status.
- Subscriber pattern: each scoring service subscribes to relevant events, enqueues recompute, writes snapshot with `triggered_by_event_id`.
- SLA: p95 < 60s for rating deltas, < 5s for UI updates.
- Cost: Haiku for score deltas (tenants already pay for Claude — unit-economic-fine), Opus-advisor only when dimension flips a band.

Schema: every scoring snapshot table already has `computed_at` + `triggered_by` pattern — just needs wiring.

### B.7 Customer-service channel coverage

Inventory:

| Channel | Inbound? | Outbound? | AI-native? |
|---|---|---|---|
| Email (`services/notifications/src/providers/email/{sendgrid,ses,smtp}.ts`) | No (read-only outbound) | Yes | Partial — no reply-in |
| SMS (`services/notifications/src/providers/sms/{africas-talking,twilio}.ts`) | Inbound webhook exists (`webhook-router.ts`) | Yes | Partial |
| WhatsApp (`services/notifications/src/whatsapp/*`) | Yes — conversation-orchestrator wired | Yes | Strong — emergency-handler, reminder-engine, feedback-collector all route |
| In-app chat (chat-ui package) | Yes | Yes | Strong |
| Voice / Phone / IVR | No | No | **Zero** — `ai-native/voice-agent/` empty |
| Push notifications (`providers/push/`) | No (one-way) | Yes | Minimal |
| Social (FB Messenger, Instagram DM) | No | No | **Missing** |
| Post / letter | Partly (letter-render-jobs schema) | Yes (generate PDF) | Partial — no mail-merge-to-print-and-ship adapter (Lob.com, stamps.com) |

Gap that matters most: **voice**. A London or Seoul tenant calls their landlord at 8pm with a broken boiler — today the call routes to a human. Wire voice-agent using existing OpenAI realtime API or ElevenLabs + Twilio Voice. ~2-engineer-week to MVP.

Missing: native iOS/Android push notifications (Firebase/APNs) are in providers/push — verify they're wired and not a scaffold.

### B.8 Heartbeat duty expansion

Today (5 duties — `packages/ai-copilot/src/heartbeat/heartbeat-engine.ts:1-170`):
1. Put idle junior sessions to sleep.
2. Probe LLM health.
3. Roll cost ledger.
4. Emit telemetry.
5. Sweep memory decay.

Missing — duties an AI-native brain should be running continuously:

| New duty | Cadence | What it does |
|---|---|---|
| H1 Arrears proactive scan | Daily | Find tenants crossing day-5/10/20 buckets; draft-queue reminder sends |
| H2 Renewal window sweep | Daily | Find leases entering 60/30/15-day windows; open renewal conversation |
| H3 Rent repricing scan | Nightly | Re-run rent-repricing-advisor on every unit; enqueue rent-change proposals |
| H4 Property-grade recompute | On event OR nightly fallback | Rerun grading snapshots; alert on grade-flips |
| H5 Credit-rating recompute | On event | Subscribe to payments/cases/invoices events |
| H6 Vacancy pipeline nudge | Every 6h | Prospect-list stale > 48h → nudge to follow up |
| H7 Vendor SLA watchdog | Every 15m | Work orders open > SLA → reassign or escalate |
| H8 Churn risk sweep | Daily | Recompute tenant churn scores; surface top-10 |
| H9 Compliance licence expiry | Daily | Parcel-compliance sweep at 90/60/30-day thresholds |
| H10 Market intelligence refresh | Hourly | Pull comps for every active market; update market_rent_observations |
| H11 Owner briefing generator | Weekly | Generate portfolio briefings (already exists — briefing-generator.ts); schedule delivery |
| H12 Maintenance preventive cron | Daily | Run preventive-prediction on asset_components; enqueue PM work orders |
| H13 Anomaly detector | Every tick | Watch ledger for abnormal transactions; pattern-mining capability |
| H14 Proactive tenant outreach | Daily | Sentiment-monitor finds low-sentiment tenants; draft outreach |
| H15 Policy simulator | On-demand + weekly | Run "what-if" scenarios: +5% rent, +10% maintenance cap — show impact |
| H16 Legal deadline tracker | Daily | Court dates, notice deadlines, statutory cure periods |
| H17 Dispute-early-warning | Daily | Tenant messages + complaints clustering — surface brewing disputes |
| H18 Insurance-claim readiness | On damage-event | Assemble evidence pack, notify broker, open claim case |
| H19 Utility-reading anomaly | Daily | Compare meter reads to baseline; detect leaks, solar failures |
| H20 Budget-vs-actual tracking | Weekly | Alert on category overspend > 20% |

Tick modes:
- Fast tick (30s): health, sessions, urgent escalations.
- Medium tick (5-15m): SLAs, vendor watchdog, short-window nudges.
- Slow tick (hourly/daily): scans, briefings, recomputes.

Architecture: heartbeat-engine should delegate each duty to an injected `HeartbeatDuty` with its own cadence and idempotency key. Currently monolithic.

### B.9 Autonomy-policy domain expansion

Today covers 5 domains (`packages/ai-copilot/src/autonomy/types.ts:17-29`): finance, leasing, maintenance, compliance, communications.

Missing domains with justification:

| New domain | Example autonomous actions | Safety gates |
|---|---|---|
| Marketing | Auto-publish vacancy listings, campaign budget caps, audience selection | Cap daily spend, disallow prohibited copy |
| HR / workforce | Auto-schedule shifts, overtime approval, timesheet reconciliation | Disallow contract changes, PII-sensitive |
| Procurement | Purchase-order auto-issue for trusted vendors, RFQ auto-circulation | Dollar caps + vendor-trust score gates |
| Insurance claims | Open claim on eligible incidents, assemble evidence | Human-review before settlement acceptance |
| Disposals / acquisitions | Monitor portfolio for disposal opportunities, forward to broker | Always human-final — big money |
| Legal proceedings | Auto-file routine responses, serve notices, calendar compliance | Always advisor + human; auto-draft yes, auto-file within narrow rails only |
| Tenant care / wellness | Birthday/anniversary outreach, welfare checks for elderly | No auto-action beyond friendly comms |
| Sustainability | Auto-schedule energy audits, nudge owners on ESG reporting | No policy changes without human |
| Acquisitions | Screen off-market deals, rank by fit | Human-only for commitments |
| Partner / vendor onboarding | KYC/AML cycle, contract issuance below threshold | Cap at $X and low-risk trades |
| Guest/short-let | Dynamic pricing, guest-screening, channel-manager comms | Usually full-autonomous — money-at-risk per booking is small |
| Insurance renewal | Annual policy comparison, quote-collection, renewal approval | Autonomous below $Y premium delta |
| Neighbour / community | Auto-respond to neighbour complaints, schedule remediation | Polite-always, factual-when-required |
| Regulator / authority | Auto-acknowledge receipts, file statutory returns | Legal gate always |
| Tenancy welfare | Mediation scheduling, payment-plan offers, hardship-leniency | Policy-bounded |

Each domain gets its own `XxxPolicy` interface mirroring existing 5. The `AUTONOMY_DOMAINS` constant grows; the delegation matrix UI dimensions expand.

---

## Part C: Prioritized amplification roadmap (Waves 27–60)

Wave = ~2-engineer-week chunk. Scope + deps + effort + product impact.

### Globalisation track (A)

**Wave 27 — Currency + Money unchaining** (A3, A4)
Scope: Remove `MoneySchema` enum; derive decimals from `Intl.NumberFormat`; extend `CURRENCY_DECIMALS` to full ISO-4217. Add currency UI picker to onboarding.
Deps: none. Effort: S. Impact: CRITICAL — unblocks every non-AF currency instantly.

**Wave 28 — Locale unchaining** (B10, A.4 common)
Scope: Replace `['en','sw']` freeze in every app's `i18n.ts` with tenant-driven list. Wire `tenant.enabledLocales` column. Accept-language now just defaults, never caps.
Deps: Wave 27 (schema changes). Effort: S. Impact: HIGH — opens multi-lingual markets.

**Wave 29 — Persona preamble sanitisation** (B1, B2, B3, C3, C4, C5)
Scope: Replace hardcoded East-African context in `BRAIN_PREAMBLE` + all sub-personas with `{{tenant.jurisdiction_context}}` resolved at bind-time. `displayName` becomes per-tenant.
Deps: none. Effort: M. Impact: CRITICAL — LLM no longer mentions KE in a DE turn.

**Wave 30 — Schema regionalisation pass** (A1, A2, A5–A19)
Scope: Drop `country DEFAULT 'KE'`; replace `paymentMethodEnum` with rail-id FK; address form jsonb; plus remaining A-row fixes.
Deps: Wave 27. Effort: L. Impact: HIGH.

**Wave 31 — Compliance plugin: DE, GB, FR**
Scope: Ship three new country plugins with full CompliancePolicy, KYC, payment rails, document templates in local languages. Schufa, TDS/DPS, Loi ALUR.
Deps: Wave 29. Effort: L. Impact: CRITICAL — unlocks EU-3 (20% of global TAM).

**Wave 32 — Compliance plugin: JP, AU, IN, CA**
Scope: Four more plugins. Aadhaar eKYC, RERA, Bond Board, provincial variance.
Deps: Wave 31 (pattern established). Effort: L. Impact: HIGH.

**Wave 33 — Payment-rail adapters: SEPA/BACS/iDEAL/UPI/Pix**
Scope: Add `services/payments/src/providers/{sepa-dd,bacs,ideal,upi,pix,pagseguro,razorpay}`.
Deps: Wave 31/32 (plugins define the rails). Effort: L. Impact: CRITICAL.

**Wave 34 — Identity/KYC providers: Onfido, Jumio, BankID, MyInfo**
Scope: Add `services/identity/` adapters beyond SSN/NIDA/Huduma.
Deps: Wave 31. Effort: M. Impact: HIGH.

**Wave 35 — Credit-bureau adapters: Schufa, Experian, CIC, CIBIL**
Scope: Add `services/identity/credit-bureau/` with generic port + per-bureau adapters.
Deps: Wave 34. Effort: M. Impact: HIGH.

**Wave 36 — Address + phone UX refactor**
Scope: All 4 apps get country-aware phone input (react-phone-number-input or similar), jurisdiction-aware address form, Intl.DateTimeFormat everywhere.
Deps: Wave 28. Effort: M. Impact: MEDIUM (trust signal for non-African ops).

**Wave 37 — Tax-filing adapters: HMRC, IRS, Finanzamt, NTA**
Scope: Per-jurisdiction export formatters mirroring `services/reports/src/compliance/ke-kra-formatter.ts`.
Deps: Wave 31/32. Effort: M. Impact: MEDIUM-HIGH.

**Wave 38 — Jurisdiction backlog tier 2 plugins: SG, NL, ES, IT, KR, BR, MX, AE, CH, IE**
Scope: 10 plugins. Parallelisable (2 per sub-wave).
Deps: Wave 31. Effort: XL (split 38a/38b/38c). Impact: HIGH — reach 80% of global TAM.

**Wave 39 — Translation cache** (B4)
Scope: `TranslationCacheService` + `translation_cache` table + polyglot-LLM wiring. Replace static i18n JSON with on-demand LLM + caching.
Deps: Wave 28. Effort: M. Impact: HIGH.

**Wave 40 — Seeds + case-studies per country** (B19, B20, B23)
Scope: Country-scoped demo seeds and knowledge corpora.
Deps: Wave 31. Effort: M. Impact: MEDIUM (sales-enablement).

### AI-limits track (B)

**Wave 41 — Continuous rent repricing** (B.5)
Scope: Nightly cron, live-rent column, UI chrome everywhere rent is shown.
Deps: Wave 30. Effort: M. Impact: CRITICAL.

**Wave 42 — Autonomous negotiation** (B.5)
Scope: Wire negotiation auto-open for qualified leads + renewals; respect policy floor; escalate cleanly.
Deps: Wave 41. Effort: M. Impact: CRITICAL — table-stakes vs AppFolio/Entrata in 24-36 months.

**Wave 43 — Event-driven risk recomputation** (B.6)
Scope: Credit-rating, property-grade, vendor-scorecard subscribe to outbox events. p95 < 60s.
Deps: Wave 30. Effort: L. Impact: HIGH.

**Wave 44 — Heartbeat duty expansion** (B.8)
Scope: Register duties H1–H20. Refactor heartbeat-engine for per-duty cadence + idempotency.
Deps: Wave 43. Effort: L. Impact: CRITICAL — this is where "AI not human limits" manifests.

**Wave 45 — Voice-agent wiring** (A.E7, B.7)
Scope: Twilio Voice + OpenAI realtime / ElevenLabs. Populate `ai-native/voice-agent/`. Phone-IVR for tenant inbound calls.
Deps: Wave 29 (persona config). Effort: M. Impact: HIGH.

**Wave 46 — Legal-drafter AI-native** (C11)
Scope: Populate `ai-native/legal-drafter/`. Bespoke per-tenant-jurisdiction-fact-pattern lease drafts, notices.
Deps: Waves 31–32 (jurisdictions). Effort: L. Impact: HIGH.

**Wave 47 — Multimodal inspection enrichment** (B.2)
Scope: Photo → defect classification pipeline. Stub exists at `ai-native/multimodal-inspection/index.ts`.
Deps: none. Effort: M. Impact: MEDIUM-HIGH.

**Wave 48 — Prescriptive dashboards** (B.3)
Scope: Every major dashboard gets an "Action strip" powered by NBA queue; one-click handlers.
Deps: Wave 44 (heartbeat drives freshness). Effort: M. Impact: CRITICAL — users feel the AI.

**Wave 49 — Autonomy-policy domain expansion** (B.9)
Scope: Add marketing, HR, procurement, insurance-claims, legal-proceedings, tenancy-welfare as first-class domains.
Deps: none. Effort: M. Impact: HIGH.

**Wave 50 — Autonomous workflow advancement** (B.1)
Scope: Rewire each `POST /…/approve` endpoint so "trivially approvable" cases auto-resolve. Queue only genuine judgment calls.
Deps: Wave 44 (nudges). Effort: L. Impact: CRITICAL — this is the dashboard-velocity win.

**Wave 51 — Sentiment-driven proactive intervention**
Scope: Populate `ai-native/sentiment-monitor/` full pipeline. Chat/call/email → score → threshold → proactive outreach.
Deps: Wave 45 (voice) for completeness. Effort: M. Impact: HIGH.

**Wave 52 — Pattern-mining privacy-safe insights**
Scope: Populate `ai-native/pattern-mining/`. Cross-tenant anonymised patterns at ≥ 5 tenants (threshold already in shared.ts:175).
Deps: Wave 38 (multi-tenant scale). Effort: L. Impact: MEDIUM-HIGH — moat over 24 months.

**Wave 53 — Policy-simulator**
Scope: Populate `ai-native/policy-simulator/`. "What if rent +5%?" runs full portfolio simulation.
Deps: Wave 41. Effort: M. Impact: MEDIUM-HIGH.

**Wave 54 — Natural-language query**
Scope: Populate `ai-native/natural-language-query/`. "Show me all leases expiring in Q3 where the tenant is below credit band B" — generate SQL/graph-query + render.
Deps: none. Effort: M. Impact: HIGH.

**Wave 55 — Vendor procurement autonomy**
Scope: Auto-RFQ, auto-select below threshold, integrate with accounting.
Deps: Wave 49. Effort: M. Impact: MEDIUM.

**Wave 56 — Tenant-lifecycle full autonomy**
Scope: Lead → screen → negotiate → contract → onboard → live-in → renew/move-out all AI-driven with human on-demand.
Deps: Waves 42, 46, 50. Effort: XL. Impact: CRITICAL — the pitch.

**Wave 57 — Accounting integrations**
Scope: QuickBooks, Xero, Sage, Datev bidirectional sync.
Deps: none. Effort: M. Impact: HIGH (sales-enablement).

**Wave 58 — Open banking wiring**
Scope: Plaid / TrueLayer / Tink — tenant income verification, bank-feed reconciliation.
Deps: Wave 33. Effort: M. Impact: MEDIUM-HIGH.

**Wave 59 — Voice-driven operator mode**
Scope: Operator talks to Mr. Mwikila / Professor Kim / Mr. Smith via voice on mobile. Same brain, hands-free.
Deps: Wave 45. Effort: M. Impact: MEDIUM — UX novelty with high stickiness.

**Wave 60 — Cross-tenant benchmarking**
Scope: "Your portfolio collects 2.3 days slower than top-quartile peers — here's why" — depends on pattern-mining.
Deps: Wave 52. Effort: M. Impact: HIGH.

---

## Part D: Competitive positioning

### D.1 Unique moats

1. **Mr. Mwikila-style persona brain** — no major PropTech ships a unified-persona AI operating system; they ship point tools (Entrata Intelligence, AppFolio AI, Yardi Intuit). BORJIE's persona catalogue + handoff-packet + visibility-budget architecture is ahead.
2. **Compliance-plugin architecture** — pluggable country rules at the core. Entrata is US-centric; AppFolio is US/CA; Yardi is US/UK/IN but bolt-on. BORJIE's `CountryPlugin` is a structural win if the plugin backlog ships.
3. **Canonical Property Graph + evidence-cited outputs** — every AI claim pinned to a graph entity. Competitors mostly ship summary chat with citation quality no better than GPT-4.
4. **Double-entry ledger native** — many PropTech ship on stitched-together accounting. BORJIE ships it native with service-charge reconciliation, KRA-style withholding, fiscal periods.
5. **Autonomy policy + human-in-loop governance** — the explicit policy-per-domain with delegation matrix is ahead of market. Competitors have "automation rules" that are brittle.
6. **Negotiation engine with policy floors + AI advisors** — again, unique. AppFolio Lead2Lease is a notification system; BORJIE would close the loop.

### D.2 Table-stakes we must match

1. Listing syndication (Zillow/Zoopla/SUUMO/LeBonCoin/Homes.co.jp) — not in repo today.
2. Tenant portal with resident services (pay, request, chat, insurance upsell, guest passes) — partial via customer-app; polish needed.
3. Maintenance vendor marketplace — partial (`packages/marketing-brain`, `services/domain-services/src/vendor*`); need network effects.
4. Accounting + bank-feed integrations — Wave 57/58.
5. Multi-channel tenant comms — Wave 45 (voice) closes the last gap.
6. Resident insurance / utility / amenity add-ons — not in scope today but expected.
7. E-sign — Wave partially covered; Wave 50 finishes.
8. Mobile apps (iOS/Android native) — borjie_app exists; push notifications + offline mode need review.
9. Market-rent data — partial via market-intelligence package; needs provider wires (Rentometer, Apartment List, locally equivalents per country).
10. Background checks — Wave 34 closes.

### D.3 What's 1-2 years ahead if we execute

If Waves 27–60 ship as planned:
- **Any operator in any country spins up in <60 minutes** with localised persona, correct rails, native language. Entrata/AppFolio/Yardi cannot.
- **The AI operates at signal-cadence** (seconds) not meeting-cadence (weeks). That is the 10–100× thesis.
- **Tenants self-serve in their own language**, voice or text, 24/7, with legal correctness.
- **Owners see prescriptive portfolios** — AI says "do X, Y, Z this week — here's the expected ₩ delta" rather than charts.
- **Negotiation autonomy** means unit-rents are optimal-without-human-labour — worth ~1-3% of gross rent alone.
- **Cross-tenant pattern-mining** (privacy-safe) gives benchmarks no single-portfolio competitor can match.

---

## Part E: Architectural invariants to preserve

What NOT to refactor — the good bones worth building on:

1. **`CountryPlugin` contract** (`packages/compliance-plugins/src/core/types.ts:103`) — pure-data, pure-function, frozen snapshots. Keep the shape; add fields (fiscal calendars, primary statutes) as nullable.
2. **`RegionConfig` adapter + overlays** (`packages/domain-models/src/common/region-config.ts`) — the legacy shape is stable; the plugin-adapter pattern hides complexity.
3. **Minor-units integer storage for money** — correct, currency-decimal-aware. Do not refactor to float.
4. **Persona template → binding → execution split** (`packages/ai-copilot/src/personas/persona.ts:105-174`) — the `bindPersona` factory is the right extension point.
5. **Visibility-scope budget on personas** — prevents accidental tenant-PII leakage; auditor-friendly.
6. **Hard-gate enumeration on advisor categories** (`advisorHardCategories`) — explicit review-always list is safer than thresholds-only.
7. **AutonomyPolicy per-domain rule block** — every new domain extends the same pattern; do not collapse into a flat config.
8. **NegotiationPolicy floor/ceiling + policy-enforcement guard** — the floor check is enforced in a pure function; preserve.
9. **`AI-native/shared.ts` contracts** (`packages/ai-copilot/src/ai-native/shared.ts`) — budget-guard, prompt-hash, classify-port, vision-port, degraded-mode-version, MIN_TENANTS_FOR_AGGREGATION. Keep every one — they are load-bearing.
10. **Double-entry ledger schema with journal/posting/reversal/fiscal-period** (`packages/database/src/schemas/payment.schema.ts:740-804`) — correctly models accounting. Build reports on top; do not simplify.
11. **CPG (Canonical Property Graph) tool surface** (`GRAPH_TOOLS` in `personas.catalog.ts:26-36`) — consistent tool-naming enables persona-agnostic skill reuse.
12. **Heartbeat engine clock-injected pure tick** — the `now()` injection makes testing trivial; extend duties inside the same pattern.
13. **Outbox pattern + events** (`outbox.schema.ts`, `common/events.ts`) — load-bearing for event-driven risk recomputation; do not remove.
14. **Thread-store per-tenant facade** — isolation property is non-negotiable; BrainRegistry.invalidate is the right tenant-reload hook.
15. **Per-tenant BrainRegistry caching** — gives each tenant its own governance counters + memory surface without global state.
16. **Skills registered on orchestrator via ToolDispatcher + typed ToolHandler** — the right pattern; every new capability should register here, not directly on the executor.
17. **HANDOFF_PACKET + visibility constraints honour** — system-prompt-level safety rule. Reinforce with runtime checks; do not weaken.
18. **"No mock fallback in production" Brain constructor** (`brain.ts:94-98`) — correct production stance; do not loosen.
19. **Review service + governance service shared across personas** — central audit trail. Do not fragment per-persona.
20. **Negotiation repository + turn repository with atomic status-update + turn-append** — correctness invariant; do not introduce two-phase write.

---

## Appendix: Raw counts for sizing

- Schemas: 69 files in `packages/database/src/schemas/`
- API routes: 81 files in `services/api-gateway/src/routes/`
- Personas templates: 10 primary, 6+ sub-personas
- `Mr. Mwikila` / `Mwikila` literal occurrences: 55 across 30 files
- KE/mpesa/KES/Nairobi/KRA/CRB/Swahili hits: 1081 across ≥200 files (grep with capped paging)
- AI-native capability dirs: 12 total, 3 empty (legal-drafter, dynamic-pricing, voice-agent)
- Compliance plugins shipped: 6 (KE/TZ/UG/NG/ZA/US) + 1 synthetic (RW)
- Currencies supported by Money: 7 (KES/TZS/UGX/RWF/USD/EUR/GBP)
- Locales supported by apps: 2 (en/sw)
- Payment providers wired: 6 (Stripe, M-Pesa, Airtel, Tigopesa, ClickPesa, GePG)
- Autonomy-policy domains: 5 (finance/leasing/maintenance/compliance/communications)
- Heartbeat duties: 5 housekeeping
- Approval endpoints: 11 routers × multiple endpoints

## Appendix: Key citations in one place

- Currency enum freeze: `packages/domain-models/src/common/money.ts:11`
- Money decimals hardcoded: `packages/domain-models/src/common/money.ts:92-100`
- Locale freeze per app: `apps/estate-manager-app/src/i18n.ts:4` + `apps/customer-app/src/i18n.ts` + `apps/owner-portal/src/i18n.ts` + `apps/admin-portal/src/i18n.ts`
- `country DEFAULT 'KE'`: `packages/database/src/schemas/property.schema.ts:96`
- Payment method enum: `packages/database/src/schemas/payment.schema.ts:59-66`
- Brain preamble hardcodes EA: `packages/ai-copilot/src/personas/system-prompts.ts:15-40`
- Junior Finance hardcodes KRA/M-Pesa: `packages/ai-copilot/src/personas/system-prompts.ts:152-168`
- Sub-persona content EA-framed: `packages/ai-copilot/src/personas/sub-personas/*.ts`
- Skill ids namespaced `.kenya.`: `packages/ai-copilot/src/personas/personas.catalog.ts:39-43`
- Autonomy policy 5-domain cap: `packages/ai-copilot/src/autonomy/types.ts:17-29`
- Heartbeat 5 duties only: `packages/ai-copilot/src/heartbeat/heartbeat-engine.ts:1-170`
- Ambient brain types + intervention (good prior art): `packages/ai-copilot/src/ambient-brain/*`
- NBA queue (good prior art): `packages/ai-copilot/src/services/nba-manager-queue.ts`
- Polyglot support (good prior art): `packages/ai-copilot/src/ai-native/polyglot-support/index.ts`
- CountryPlugin contract: `packages/compliance-plugins/src/core/types.ts:103`
- RegionConfig adapter: `packages/domain-models/src/common/region-config.ts`
- Negotiation service: `services/domain-services/src/negotiation/`
- Autonomous-action audit: `packages/ai-copilot/src/autonomy/autonomous-action-audit.ts`

End of blueprint. Waves 27-60 execute against this document.
