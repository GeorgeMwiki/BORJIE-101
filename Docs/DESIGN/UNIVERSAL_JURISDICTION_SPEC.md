# Universal Jurisdiction Profiles + Compliance Framework Registry — SPEC

**Wave**: UNIV-1 (Universal-from-Day-One Foundation)
**Author persona**: Mr. Mwikila
**Status**: Locked — implementation reference
**Companion locks**: `FOUNDER_LOCKED_DECISIONS_2026_05_26.md` + `FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`

---

## §0. Vision — universal from day one, not "TZ-first then internationalise later"

Borjie is built for the entire world. **Tanzania is the launch beachhead, not the architectural boundary.** Every spec, package, schema, and decision that references "TZ", "+255", "TZS", "Swahili", "TRA", "Tumemadini", "NEMC", "BoT", or `Africa/Dar_es_Salaam` must do so through a **pluggable abstraction layer** rather than as a hardcoded branch. The launch tenant runs on the `tz` jurisdiction profile + `sw` + `en` language packs + `mining-tz` vertical profile. Subsequent tenants slot in `ke`, `ng`, `za`, `gb-eng`, `us-ca`, `de`, `fr`, `br`, `sg`, `in`, `cn`, `mx`, `tr`, `ca`, `jp` and any other ISO 3166-1 alpha-2 (or alpha-2 + subdivision) by **adding a profile package** — never by editing core. The same applies to compliance: each named regulation (GDPR / TZ DPA / CCPA / LGPD / PIPL / KVKK / DPDP / POPIA / NDPA / PIPEDA / APPI / PDPA / LFPDPPP / KE DPA) is a row in `compliance_frameworks` with article-level mappings to the Borjie packages that satisfy each control. When a regulator audits us we point them at this table.

This spec is the **immutable contract** for the four universal abstractions: (1) jurisdiction profile, (2) language pack (covered separately under `LANGUAGE_VOICE_SOTA_SPEC.md`), (3) vertical profile (`mining-tz` is the launch instance), and (4) compliance framework registry. The two abstractions covered here are #1 and #4 plus the regulator catalogue that ties them together.

---

## §1. Profile shape — the full canonical schema

Each jurisdiction is exactly one row in `jurisdiction_profiles`. The PK `id` is the human-readable lookup key (`'tz'`, `'ke'`, `'gb-eng'`, `'us-ca'`, `'de'`, `'br-sp'`, etc.) — never a UUID, because the rest of the platform consults this table by short-code and the short-code is the API contract.

Fields:

| Field | Type | Semantics |
|---|---|---|
| `id` | `text PK` | Lookup key — ISO 3166-1 alpha-2 lowercase, optionally `-` + ISO 3166-2 subdivision lowercase (`'us-ca'`, `'gb-eng'`, `'ca-on'`). |
| `iso_country` | `text NOT NULL` | ISO 3166-1 alpha-2 uppercase (`'TZ'`, `'GB'`, `'US'`). |
| `iso_subdivision` | `text NULL` | ISO 3166-2 code without country prefix (`'CA'` for California, `'ENG'` for England). |
| `display_name` | `text NOT NULL` | Human-readable name (`'Tanzania'`, `'England'`, `'California'`). |
| `data_protection_laws` | `text[] NOT NULL` | Array of `compliance_frameworks.id` values that apply by force of law to data subjects in this jurisdiction. |
| `data_residency_kind` | `text NOT NULL CHECK in (strict-in-country, regional-bloc, unrestricted)` | Determines where storage MAY live for tenants pinned to this jurisdiction. |
| `regional_bloc` | `text NULL` | When `data_residency_kind = 'regional-bloc'`, names the bloc (`'eu-eea'`, `'eac'`, `'gcc'`). |
| `breach_deadline_hours` | `int NOT NULL` | Hours from detection before regulator must be notified. GDPR/UK/TZ/KE/NG/TR/IN = 72; PDPA-SG (post-assessment) = 72; LGPD (working days) = encoded as 72 with `working_days_only` flag in `tax_matrix`; PIPL = 24 (national-security); CCPA = 720 (30 days, individual notification); POPIA = 0 (as-soon-as-reasonably-possible, no fixed clock — encoded as `0` with semantics "no fixed deadline"); PIPEDA/LFPDPPP/APPI = 0 (same). |
| `rtbf_cascade_scope` | `text NOT NULL` | Right-to-be-forgotten cascade scope — `gdpr-broad` / `kenya-narrowed-to-false-misleading` / `ccpa-deletion-with-exceptions` / `tz-dpa-broad` / `pipl-restricted` / `not-applicable`. |
| `currency_code` | `text NOT NULL` | ISO 4217 three-letter code. |
| `phone_e164_cc` | `text NOT NULL` | E.164 country dialing code without the leading `+` (`'255'` for TZ, `'44'` for GB, `'1'` for US/CA). |
| `phone_e164_pattern` | `text NOT NULL` | Regex pattern for the national significant number (E.164 §5.5). |
| `address_format` | `jsonb NOT NULL` | Object describing line ordering + required fields (`'region+district+ward'` for TZ; `'county+postcode'` for GB; `'state+zip'` for US). |
| `holiday_calendar_key` | `text NOT NULL` | Lookup key into the `date-holidays` library (`'TZ'`, `'GB-ENG'`, `'US-CA'`). |
| `working_week` | `int[] NOT NULL` | ISO-day-of-week list of working days (`[1,2,3,4,5]` Mon-Fri; `[7,1,2,3,4]` Sun-Thu for MENA). |
| `timezone_default` | `text NOT NULL` | IANA TZ database identifier (`'Africa/Dar_es_Salaam'`, `'Europe/London'`, `'America/Los_Angeles'`). |
| `quiet_hours_default` | `jsonb NOT NULL` | `{ start: 'HH:MM', end: 'HH:MM' }` — overrides the platform 18:00–06:00 default per locale needs. |
| `tax_matrix` | `jsonb NOT NULL` | VAT/GST/sales-tax/royalty rates by category. Free-form per jurisdiction. |
| `language_pack_codes` | `text[] NOT NULL` | Installed language pack IDs (`['sw','en']` for TZ; `['en']` for GB; `['de','en']` for DE). |
| `vertical_profile_codes` | `text[] NOT NULL` | Installed vertical profile IDs (`['mining-tz']` for the launch tenant). |
| `profile_source_url` | `text NOT NULL` | Citation URL for the row's authoritative source. |
| `profile_source_title` | `text NOT NULL` | Citation title. |
| `profile_source_date` | `date NOT NULL` | Citation date — when this snapshot of law was captured. |
| `audit_hash` | `text NOT NULL` | Hash-chain link via `@borjie/audit-hash-chain`. |

The row is **global reference data** — every tenant reads it. No RLS. Comments in the migration call this out explicitly.

---

## §2. Compliance framework registry

Each named compliance regulation is one row in `compliance_frameworks`:

| Field | Type | Semantics |
|---|---|---|
| `id` | `text PK` | Lookup key (`'gdpr'`, `'tz_dpa_2022'`, `'ccpa'`, `'lgpd'`, `'pipl'`, `'pdpa_sg'`, `'dpdp_in'`, `'ke_dpa_2019'`, `'ndpa_2023'`, `'popia'`, `'kvkk'`, `'lfpdppp'`, `'pipeda'`, `'appi'`, `'uk_gdpr'`, `'cpra'`). |
| `display_name` | `text NOT NULL` | Human-readable name. |
| `jurisdictions` | `text[] NOT NULL` | Array of `jurisdiction_profiles.id` values where this framework applies. |
| `effective_date` | `date NOT NULL` | When the framework first took force. |
| `article_registry` | `jsonb NOT NULL` | `{ articles: [{ ref: 'Art. 33', title: 'Notification of personal data breach', topic: 'breach-notification' }, …] }` |
| `source_url` | `text NOT NULL` | Authoritative full-text citation URL. |
| `source_title` | `text NOT NULL` | Authoritative full-text citation title. |
| `source_date` | `date NOT NULL` | Citation date. |
| `audit_hash` | `text NOT NULL` | Hash-chain link. |

Companion table `framework_control_mappings` is the join from a legal article to the Borjie package that implements it:

| Field | Type | Semantics |
|---|---|---|
| `id` | `uuid PK` | Row id. |
| `framework_id` | `text FK` | `compliance_frameworks.id`. |
| `article_ref` | `text NOT NULL` | e.g. `'Art. 33'`, `'§ 1798.82'`, `'Art. 48'`. |
| `control_kind` | `text NOT NULL` | `breach-notification` / `rtbf` / `consent` / `data-residency` / `dpia` / `data-minimisation` / `encryption-at-rest` / `encryption-in-transit` / `access-log` / `audit-trail`. |
| `package_name` | `text NOT NULL` | Borjie package that satisfies the article (`'@borjie/audit-hash-chain'`, `'@borjie/breach-notification'`, `'@borjie/cognitive-memory'`, etc.). |
| `impl_pointer` | `text NOT NULL` | File-or-symbol pointer (`'packages/audit-hash-chain/src/chain.ts'`). |
| `audit_hash` | `text NOT NULL` | Hash-chain link. |
| — | UNIQUE | `(framework_id, article_ref, package_name)` — prevent duplicate mappings. |

### §2.1. The 14+ frameworks seeded at launch

The seed file `packages/jurisdiction-profiles/src/seed/seed-frameworks.ts` declares the following frameworks, each with at least one `framework_control_mappings` row:

1. **`gdpr`** — EU General Data Protection Regulation (Reg. 2016/679). Effective 2018-05-25. Art. 5 (minimisation), Art. 7 (consent), Art. 17 (RTBF), Art. 32 (security), Art. 33 (breach 72h), Art. 34 (subject notice). Source: <https://gdpr.eu/> + <https://gdpr-info.eu/art-33-gdpr/>.
2. **`uk_gdpr`** — UK GDPR + Data Protection Act 2018. Effective 2018-05-25 (re-domesticated 2021-01-01). Mirrors GDPR articles; ICO is the supervisory authority. Source: <https://ico.org.uk/for-organisations/report-a-breach/personal-data-breach/>.
3. **`tz_dpa_2022`** — Tanzania Personal Data Protection Act 2022. Effective 2023-05-01. Breach notification "without undue delay" (we encode as 72h matching GDPR alignment per Clyde & Co commentary). Source: <https://www.pdpc.go.tz/media/media/THE_PERSONAL_DATA_PROTECTION_ACT.pdf> + <https://www.clydeco.com/en/insights/2023/02/tanzania-personal-data-protection-act-of-2022>.
4. **`ke_dpa_2019`** — Kenya Data Protection Act No. 24 of 2019. Effective 2019-11-25. §43 breach notification 72h; processor → controller 48h; right-to-erasure narrowed to false/misleading data. Source: <https://www.kentrade.go.ke/wp-content/uploads/2022/09/Data-Protection-Act-1.pdf>.
5. **`ndpa_2023`** — Nigeria Data Protection Act 2023 (superseding NDPR 2019). Effective 2023-06-12. §40 breach notification 72h to NDPC. Source: <https://securiti.ai/overview-of-nigeria-data-protection-act/> + NDPC GAID 2025-03-20.
6. **`popia`** — South Africa Protection of Personal Information Act No. 4 of 2013. Effective 2021-07-01. §22 breach notification "as soon as reasonably possible" — no fixed clock. Source: <https://popia.co.za/>.
7. **`ccpa`** — California Consumer Privacy Act of 2018. Effective 2020-01-01. Cal. Civ. Code § 1798.82 breach notification. Source: <https://www.oag.ca.gov/privacy/ccpa>.
8. **`cpra`** — California Privacy Rights Act of 2020 (amending CCPA). Effective 2023-01-01; 2026 amendments include 30-day individual breach notice. Source: <https://oag.ca.gov/privacy/databreach/reporting>.
9. **`lgpd`** — Brazil Lei Geral de Proteção de Dados (Law 13.709/2018). Effective 2020-09-18. Art. 48 breach notification 3 working days (we encode 72h with `working-days` flag). ANPD Resolution CD/ANPD 15/2024 codifies the rules. Source: <https://iapp.org/news/a/anpd-s-regulation-on-security-incidents> + ANPD official text.
10. **`pdpa_sg`** — Singapore Personal Data Protection Act 2012 (amended 2020). Effective 2014-07-02 (breach notification obligation 2021-02-01). PDPA Reg 2021 §3: notification within 3 calendar days of assessment. Source: <https://www.pdpc.gov.sg/report-data-breach>.
11. **`dpdp_in`** — India Digital Personal Data Protection Act 2023 + Rules 2025. Effective phased; full enforcement mid-2027. §8(6) breach notification to Data Protection Board within 72 hours. Source: <https://www.pib.gov.in/PressReleasePage.aspx?PRID=2190655>.
12. **`pipl`** — China Personal Information Protection Law (effective 2021-11-01). Art. 57 breach notification "immediate" — no fixed deadline except 24h for national-security incidents. Cross-border transfer requires CAC assessment or certification. Source: <https://www.china-briefing.com/doing-business-guide/china/company-establishment/pipl-personal-information-protection-law>.
13. **`kvkk`** — Türkiye Kişisel Verileri Koruma Kanunu (Law No. 6698). Effective 2016-04-07. Art. 12(5) + Board Decision 2019/10: breach notification within 72h. Source: <https://www.kvkk.gov.tr/Icerik/6601/Obligations-Concerning-Data-Security->.
14. **`lfpdppp`** — Mexico Federal Law on Protection of Personal Data Held by Private Parties (republished 2025-03-20). Art. 64 breach notification "without undue delay" — no fixed clock. Source: <https://www.basham.com.mx/mailing/Federal%20LAW.pdf>.
15. **`pipeda`** — Canada Personal Information Protection and Electronic Documents Act (2000, breach amendment 2018-11-01). Notification "as soon as feasible" — no fixed clock. Source: <https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/>.
16. **`appi`** — Japan Act on the Protection of Personal Information (amended 2022-04-01). Preliminary report "promptly" (3–5 calendar days), final report 30 days (60 days for cyberattacks). Source: <https://www.japaneselawtranslation.go.jp/en/laws/view/4241/en>.

This list is **extensible**. Adding `'hipaa'`, `'ferpa'`, `'coppa'`, `'phipa'`, `'lpdp_ar'`, `'lpdp_co'`, `'pipa_kr'`, `'apprp_au'`, etc. = inserting a row + at least one control mapping. Never editing this spec.

---

## §3. Per-jurisdiction breach-notification deadline matrix

| Jurisdiction | Framework | Authority notice | Subject notice | Encoded hours |
|---|---|---|---|---|
| TZ | `tz_dpa_2022` | "without undue delay" → aligned 72h | as soon as practicable | 72 |
| KE | `ke_dpa_2019` | 72h | without undue delay if high risk | 72 |
| NG | `ndpa_2023` | 72h | immediately if risk to rights | 72 |
| ZA | `popia` | as soon as reasonably possible | as soon as reasonably possible | 0 (no fixed clock — sentinel) |
| GB-ENG | `uk_gdpr` | 72h | high-risk → without undue delay | 72 |
| DE / FR / EU | `gdpr` | 72h | high-risk → without undue delay | 72 |
| US-CA | `ccpa` + `cpra` | 15 days to AG if ≥500 residents | 30 days to individual | 720 (30 days) |
| BR | `lgpd` | 3 working days → 72 with `working-days` flag | 3 working days | 72 |
| SG | `pdpa_sg` | 3 calendar days post-assessment | as soon as practicable | 72 |
| IN | `dpdp_in` | 72h | without undue delay | 72 |
| CN | `pipl` | immediate; 24h for national-security | immediate | 24 |
| TR | `kvkk` | 72h | as soon as possible | 72 |
| MX | `lfpdppp` | without undue delay | without undue delay | 0 |
| CA | `pipeda` | as soon as feasible | as soon as feasible | 0 |
| JP | `appi` | 3–5 calendar days preliminary; 30 days final | promptly | 120 (5 days) |

The `0` sentinel means "no fixed deadline — escalate immediately per the breach-notification package's worst-case policy" (`@borjie/breach-notification` consults this row at runtime and routes to the SOTA escalation flow rather than a fixed-hours timer).

---

## §4. Per-jurisdiction RTBF cascade rules

| Jurisdiction | RTBF cascade scope | Notes |
|---|---|---|
| TZ | `tz-dpa-broad` | Mirrors GDPR Art. 17 — broad erasure when purpose served. |
| KE | `kenya-narrowed-to-false-misleading` | Narrowed to false/misleading data (DPA §40). |
| NG | `ndpa-broad` | NDPA 2023 §35 erasure right, broad. |
| ZA | `popia-broad` | §24 erasure. |
| GB-ENG / EU | `gdpr-broad` | Art. 17 GDPR full erasure. |
| US-CA | `ccpa-deletion-with-exceptions` | Cal. Civ. Code §1798.105 — broad with statutory exceptions (legal hold, transactional records). |
| BR | `lgpd-broad` | Art. 18(VI) erasure. |
| SG | `pdpa-no-formal-rtbf` | No formal RTBF — handled via access + correction. |
| IN | `dpdp-broad` | DPDP §12(3) erasure. |
| CN | `pipl-restricted` | Art. 47 — restricted erasure subject to state-security and public-interest exceptions. |
| TR | `kvkk-broad` | Art. 7 destruction obligation. |
| MX | `lfpdppp-broad` | Art. 32 ARCO rights (Access, Rectification, Cancellation, Opposition). |
| CA | `pipeda-narrowed` | Withdrawal-of-consent triggered; no explicit erasure right. |
| JP | `appi-narrowed` | Erasure on request only when unlawfully obtained or unnecessary. |

The `packages/cognitive-memory/` + `packages/dp-federation/` packages consult this field at request-time to determine which cascade variant to apply.

---

## §5. How a tenant resolves its profile (login → org_scope → jurisdiction_profile)

The resolution chain:

1. **Login** — User authenticates. JWT issued by `packages/customer-geo-routing/`'s session-scope builder (Wave 18Z).
2. **Org-scope resolution** — `packages/org-scope/` resolves the user's `UserScopeBinding` (Wave 18X) → produces `ResolvedScope` carrying `tenant_id` + `org_unit_id`.
3. **Tenant profile lookup** — `tenants.jurisdiction_profile_id` column (added by migration 0055) is read; this is the FK into `jurisdiction_profiles.id`.
4. **Profile resolution** — `@borjie/jurisdiction-profiles` `profileRegistry.find(id)` returns the full `JurisdictionProfile` object.
5. **Downstream consumers** — Every subsystem that needs locale-sensitive behaviour (currency formatter, phone formatter, holiday calendar, quiet hours, breach-notification scheduler, RTBF cascade router) consults the resolved profile rather than hardcoding TZ defaults.

Mid-session profile change is forbidden — switching jurisdictions requires re-binding the user (per Wave 18Z `scope-switcher-audit`).

---

## §6. The 6-step recipe for adding a new jurisdiction

Adding (for example) Germany follows exactly six mechanical steps. No core code is touched.

1. **Create the profile package** `packages/jurisdiction-profile-de/` mirroring the layout of `packages/jurisdiction-profile-tz/`. Export `deProfile: JurisdictionProfile` and `deRegulators: ReadonlyArray<RegulatorDefinition>`.
2. **Populate the profile** — Fill `data_protection_laws: ['gdpr']`, `regional_bloc: 'eu-eea'`, `currency_code: 'EUR'`, `phone_e164_cc: '49'`, `timezone_default: 'Europe/Berlin'`, `language_pack_codes: ['de', 'en']`, etc. Cite the BfDI URL+title+date in `profile_source_*`.
3. **Populate the regulators** — `deRegulators` includes BfDI (federal DPA), state DPAs (LDIs), BaFin (financial), Bundeskartellamt (competition) as applicable, with filing kinds + due patterns.
4. **Add language pack(s)** if missing — `@borjie/language-pack-de` follows the existing language-pack pattern (BCP-47 region variants, voice profile, glossaries).
5. **Add vertical profile(s)** if applicable — `@borjie/vertical-profile-{vertical}-de` per the vertical-profile pattern.
6. **Register the profile + frameworks** in any composition root that initialises the registries (typically `apps/api/src/bootstrap/jurisdictions.ts` — a 2-line edit per new jurisdiction calling `profileRegistry.register(deProfile)` + `regulatorRegistry.registerAll(deRegulators)`).

Six steps. Zero migrations. Zero core edits. The profile package is the only artefact that changes.

---

## §7. Regulator catalogue (TZ launch seed — others added via §6)

The `regulator_definitions` table is keyed by `id` (e.g. `'tz-tra'`, `'tz-tumemadini'`, `'tz-nemc'`, `'tz-bot'`, `'gb-hmrc'`, `'gb-companies-house'`, `'gb-ico'`). Each row carries:

| Field | Type | Semantics |
|---|---|---|
| `id` | `text PK` | Short code (jurisdiction prefix + regulator slug). |
| `jurisdiction_id` | `text FK` | `jurisdiction_profiles.id`. |
| `display_name` | `text` | Human-readable name. |
| `domain` | `text` | `tax` / `mining` / `environment` / `central-bank` / `data-protection` / `customs` / `securities`. |
| `filing_kinds` | `jsonb` | Array of `{ kind, cadence, due_day_of_month, late_penalty }`. |
| `due_pattern` | `jsonb` | Cron-like recurrence + dependency on working week. |
| `api_endpoint` | `text NULL` | Live regulator endpoint, when one exists (TRA has an e-filing endpoint; Tumemadini does not as of writing). |
| `audit_hash` | `text` | Hash-chain link. |

### TZ launch regulators

- **`tz-tra`** — Tanzania Revenue Authority. Domain `tax`. Filing kinds: `vat-return` (monthly, due 20th — per TRA VAT page <https://www.tra.go.tz/index.php/value-added-tax-vat/98-vat-returns>), `paye-return` (monthly, due 7th), `corporate-income-tax-return` (annual, due 6 months after year-end), `digital-services-tax` (monthly, due 20th).
- **`tz-tumemadini`** — Mining Commission. Domain `mining`. Filing kinds: `royalty-payment` (per-shipment, due before clearance — per Tumemadini Royalty and Inspection Fees page <https://www.tumemadini.go.tz/mineral-trade/mineral-royalties-and-inspection-fees-rates/>), `annual-mining-report` (annual, due Q1 of following year), `mineral-trading-licence-renewal` (annual).
- **`tz-nemc`** — National Environment Management Council. Domain `environment`. Filing kinds: `eia-certificate-application` (pre-project), `annual-environmental-audit` (annual, due 12 months from EIA issue), `non-compliance-notice-response` (event-driven, 14 days).
- **`tz-bot`** — Bank of Tanzania. Domain `central-bank`. Filing kinds: `forex-transaction-report` (per-transaction over threshold), `national-gold-gemstone-reserve-deposit` (event-driven — per Mining Act provision placing reserve under BoT control), `cross-border-payment-notification` (per-transaction).

---

## §8. Provenance

| Source | Title | Date |
|---|---|---|
| https://www.pdpc.go.tz/media/media/THE_PERSONAL_DATA_PROTECTION_ACT.pdf | The Personal Data Protection Act 2022 (Tanzania) | 2022-11-04 |
| https://www.clydeco.com/en/insights/2023/02/tanzania-personal-data-protection-act-of-2022 | Tanzania: The Personal Data Protection Act of 2022 — Clyde & Co | 2023-02 |
| https://www.kentrade.go.ke/wp-content/uploads/2022/09/Data-Protection-Act-1.pdf | Laws of Kenya Data Protection Act No. 24 of 2019 | 2019-11-25 |
| https://securiti.ai/overview-of-nigeria-data-protection-act/ | An Overview of Nigeria's Data Protection Act 2023 — Securiti | 2023-06-12 |
| https://popia.co.za/ | POPIA — Protection of Personal Information Act (RSA) | 2021-07-01 |
| https://gdpr.eu/ + https://gdpr-info.eu/art-33-gdpr/ | GDPR — General Data Protection Regulation (EU 2016/679) | 2018-05-25 |
| https://ico.org.uk/for-organisations/report-a-breach/personal-data-breach/ | ICO UK GDPR Personal Data Breach Reporting | 2018-05-25 |
| https://www.oag.ca.gov/privacy/ccpa | CCPA — California Consumer Privacy Act | 2020-01-01 |
| https://oag.ca.gov/privacy/databreach/reporting | California AG Data Security Breach Reporting | 2026-01-01 |
| https://iapp.org/news/a/anpd-s-regulation-on-security-incidents | ANPD Regulation 15/2024 — Brazil LGPD breach notification | 2024-04-24 |
| https://www.pdpc.gov.sg/report-data-breach | PDPC Singapore Data Breach Reporting Guide | 2021-02-01 |
| https://www.pib.gov.in/PressReleasePage.aspx?PRID=2190655 | DPDP Rules 2025 Notified — Ministry of Electronics and IT (India) | 2025-11-13 |
| https://www.china-briefing.com/doing-business-guide/china/company-establishment/pipl-personal-information-protection-law | PIPL Compliance Guide — China Briefing | 2021-11-01 |
| https://www.kvkk.gov.tr/Icerik/6601/Obligations-Concerning-Data-Security- | KVKK Obligations Concerning Data Security (Türkiye) | 2019-01-24 |
| https://www.basham.com.mx/mailing/Federal%20LAW.pdf | LFPDPPP — Federal Law on Protection of Personal Data (Mexico) | 2025-03-20 |
| https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/ | PIPEDA — Office of the Privacy Commissioner of Canada | 2018-11-01 |
| https://www.japaneselawtranslation.go.jp/en/laws/view/4241/en | APPI — Act on Protection of Personal Information (Japan) | 2022-04-01 |
| https://www.tra.go.tz/index.php/value-added-tax-vat/98-vat-returns | Tanzania Revenue Authority — VAT Returns and Tax Payment | 2025 |
| https://www.tumemadini.go.tz/mineral-trade/mineral-royalties-and-inspection-fees-rates/ | Tumemadini — Royalty and Inspection Fees Rates | 2025 |
| https://www.tumemadini.go.tz/media/uploads/publications/2025/06/29/The_Mining_Act.pdf | The Mining Act 2010 — Tumemadini | 2025-06-29 |
| https://en.wikipedia.org/wiki/ISO_4217 | ISO 4217 Currency Codes | 2026-05 |
| https://en.wikipedia.org/wiki/E.164 | E.164 International Telephone Numbering Plan | 2026-05 |
| https://en.wikipedia.org/wiki/IETF_language_tag | BCP-47 — IETF Language Tag | 2026-05 |
| https://www.iana.org/time-zones | IANA Time Zone Database | 2026-05 |
| https://www.npmjs.com/package/date-holidays | `date-holidays` npm Package | 2026-05 |

---

## §9. Locked invariants (carried forward to implementation)

1. **No hardcoded country literals in core.** Every reference to `'TZ'`, `'TZS'`, `'+255'`, `'Africa/Dar_es_Salaam'`, `'sw'`, `'TRA'`, `'Tumemadini'`, `'NEMC'`, `'BoT'` in `packages/*/src/` (outside the named launch packages and their tests/fixtures) is a violation. Tests can stay literal because they exercise the TZ launch tenant explicitly.
2. **No RLS on `jurisdiction_profiles`, `compliance_frameworks`, `framework_control_mappings`, `regulator_definitions`.** These are global reference data. Every tenant reads them. The migration encodes this with an explicit comment.
3. **Migration creates tables; the seed package fills them.** TZ regulators are not baked into migration 0055 — they live in `@borjie/jurisdiction-profile-tz` and are installed at composition-root bootstrap.
4. **Citations mandatory.** Every row in `jurisdiction_profiles` and `compliance_frameworks` carries `*_source_url`, `*_source_title`, `*_source_date`. When the law changes we re-audit by re-running the seed with updated citations.
5. **Adding a new jurisdiction is a new package, never a core edit.** The 6-step recipe in §6 is the only way to expand the platform geographically.

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.
