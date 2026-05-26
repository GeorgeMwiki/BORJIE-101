# FOUNDER LOCKED DECISIONS — 2026-05-26 Addendum: Universal from Day One

Supplements `FOUNDER_LOCKED_DECISIONS_2026_05_26.md`. Locks an architectural invariant that overrides any prior spec language that named Tanzania as the boundary instead of the launch beachhead.

---

## §1. The Locked Invariant

**Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary.**

Every spec, package, schema, and decision that references "Tanzania", "TZ", "Swahili", "TRA", "Tumemadini", "TZS", "+255", or any other country-specific or language-specific identifier must do so through a **pluggable abstraction layer**, not as a hardcoded path. The launch tenant runs on the `tz` jurisdiction profile + `sw` + `en` language packs + `mining-tz` vertical profile. Subsequent tenants slot in `ke`, `ng`, `za`, `gb`, `us-ca`, `de`, `br`, `sg`, etc. by adding profile rows, not by changing core code.

Intelligence is universal. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, ε-budgets, capability catalogue — all language-agnostic and jurisdiction-agnostic. The thin layer above the core that maps regulators, currencies, languages, holidays, formats, retention windows, tax rates, etc. — that layer is **data**, not code branches.

---

## §2. The 4 universal abstractions (all pluggable)

### Abstraction 1 — Jurisdiction Profile

Each jurisdiction = one row in `jurisdiction_profiles` carrying:
- **Data protection law(s) applicable** — GDPR / Tanzania DPA 2022 / Kenya DPA 2019 / NDPR 2019 (Nigeria) / POPIA (South Africa) / CCPA + CPRA / LGPD (Brazil) / PIPL (China) / PDPA Singapore / DPDP Act India / PIPEDA (Canada) / APPI Japan / KVKK (Türkiye) / LFPDPPP (Mexico) — extensible list.
- **Data residency requirement** — strict-in-country, regional-bloc (EU-EEA, EAC), or unrestricted.
- **Breach notification deadline** — hours from detection. GDPR/Tanzania = 72h; some jurisdictions = 24h or 48h.
- **Right-to-be-forgotten standard** — applicable laws + cascade scope.
- **Regulators + filing windows** — array of `{ regulator_id, filing_kinds[], due_pattern }`. TZ seed has TRA + Tumemadini + NEMC + BoT; UK seed has HMRC + Companies House + ICO; etc.
- **Currency code + format** — ISO 4217 + locale format string.
- **Phone number format** — E.164 country code + national prefix rules.
- **Address format** — country-specific structure (UK has counties, US has states, TZ has regions+districts+wards).
- **Holiday calendar** — public holidays per year (sourced from a maintained library e.g. `date-holidays` npm).
- **Working week** — locale-default working days (some MENA jurisdictions = Sun-Thu; most = Mon-Fri).
- **Quiet hours culture default** — overrides the universal 18:00–06:00 with finer-grained local defaults (e.g. Ramadan windows, Iftar timing).
- **Tax + duty matrices** — VAT / GST / royalty rates by category.
- **Language packs** — array of installed language codes for this jurisdiction (TZ = [`sw`, `en`]; KE = [`sw`, `en`]; NG = [`en`, `ha`, `yo`, `ig`]; DE = [`de`, `en`]; etc.).
- **Provenance** — citation URL+title+date for every rule (so when the law changes we can re-audit).

### Abstraction 2 — Language Pack

Each language = one package `@borjie/language-pack-{code}` carrying:
- ISO 639-1 / 639-2 / 639-3 code
- BCP-47 region variants supported (`sw`, `sw-TZ`, `sw-KE`, `en`, `en-GB`, `en-US`, `en-TZ`)
- Locale resources: date / number / currency / collation rules
- Linguistic resources: phoneme inventory, morphology rules, dialect signals, stop-words, register tags (formal / colloquial / regional slang)
- Voice profile defaults — preferred TTS provider + voice id + prosody profile
- Domain glossaries (mining, agri, oil-gas, etc.)

Initial packs: `en`, `sw` (with TZ + KE variants). Reserved slots for `fr`, `ar`, `pt`, `es`, `zh-CN`, `ru`, `hi`, `id`, `tr`, `vi`, `de`, `it`, `ja`, `ko`, `pl`, `uk`, `nl`, `tl`, `ha`, `yo`, `ig`, `am`, `so`, `om`, `rw`, `lg`, `zu`, `xh`, `af`. Adding a pack = adding a package, not editing core.

### Abstraction 3 — Vertical Profile

Each vertical+region = one package `@borjie/vertical-profile-{vertical}-{region}` carrying:
- Domain entities (mine site / farm / port terminal / oil platform / factory floor)
- Domain workflows (royalty filing / harvest reporting / customs clearance / safety audit)
- Domain glossary (technical terms in this vertical, multilingual)
- Regulator binding (which `jurisdiction_profiles.regulator` rows apply to this vertical)
- Capability registry seeds (which atomic + meta capabilities are relevant)

Initial pack: `mining-tz`. Reserved: `mining-{ke,ng,za,au,cl,pe,ca}`, `agri-{tz,ke,ng,et,br,in,id}`, `oilgas-{ng,ao,ao,uk,no,us-tx}`, `fisheries-{is,no,id,vn,th,cl,pe}`, `forestry-{cd,br,id,fi,ca,ru}`, `manufacturing-{tz,vn,bd,mx,cz,pl}`, `tourism-{tz,ke,za,id,th,vn,gr,it,es}`, `realestate-{tz,ke,ng,ae,sg,gb}`. Same pattern: new market = new pack.

### Abstraction 4 — Compliance Framework Registry

Each compliance framework = one row in `compliance_frameworks` carrying:
- ID (`gdpr`, `tz_dpa_2022`, `ccpa`, `lgpd`, `pipl`, etc.)
- Geographic scope (which jurisdictions trigger it)
- Article / clause registry (which controls map to which articles)
- Implementation pointers (which Borjie packages implement which articles)
- Audit + certification status (which we're certified against, which we self-attest)

This becomes the canonical map between **legal article** ↔ **implemented control**. When a regulator audits us we point them at this table.

---

## §3. Concrete refactors to land

### Refactor #1 — Spec language scrub

Every spec doc under `Docs/DESIGN/` and `Docs/COMPLIANCE/` and `Docs/SECURITY/` must reference TZ-DPA / Swahili / TRA / Tumemadini only through a jurisdiction-profile or language-pack lens. No spec hardcodes TZ-only behaviour in a non-TZ-named primitive.

Affected (already-landed) specs that need a follow-up reconciliation pass:
- `Docs/DESIGN/CUSTOMER_GEO_ROUTING_AND_SCOPE_LOGIN.md` (Wave 18Z)
- `Docs/DESIGN/ORG_LEGIBILITY_SPEC.md` (Wave M5-6)
- `Docs/DESIGN/CONTINUOUS_24_7_WORK_CYCLE_SPEC.md` (Wave M1)
- `Docs/DESIGN/DAILY_FOLLOWUP_AND_GUIDE_LEARN_SPEC.md` (Wave M2)
- `Docs/DESIGN/CAPABILITY_CATALOGUE_SPEC.md` (Wave CAPABILITY)
- `Docs/DESIGN/STRATEGIC_DIRECTION_LAYER_SPEC.md` (Wave M10-12)
- `Docs/DESIGN/RLVR_POST_TRAINING_SPEC.md` (Wave 19C)
- `Docs/DESIGN/VOICE_GEMINI_LIVE_SWAHILI_SPEC.md` (Wave 19F)
- `Docs/DESIGN/AMBIENT_VOICE_LISTENING_SPEC.md` (Wave 19J in flight)
- `Docs/DESIGN/LANGUAGE_VOICE_SOTA_SPEC.md` (Wave 19G in flight)
- `Docs/DESIGN/SWAHILI_LINGUISTICS_SOTA_SPEC.md` (Wave 19H in flight)
- `Docs/DESIGN/TRANSLATION_SOTA_SPEC.md` (Wave 19I in flight)
- `Docs/DESIGN/LANGUAGE_SELF_IMPROVE_SPEC.md` (Wave 19K in flight)
- `Docs/COMPLIANCE/SOTA_DATA_PROTECTION_2026.md` (Wave SEC-3 in flight)
- `Docs/SECURITY/SOTA_SECURITY_POSTURE_2026.md` (Wave SEC-2 in flight)

Reconciliation pass adds: *"§ Universal-from-day-one — the {affected primitive} respects the jurisdiction profile of the requesting tenant. The TZ-specific defaults shown here are the launch beachhead, sourced from `@borjie/jurisdiction-profile-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec."*

### Refactor #2 — Code scrub

Every hardcoded `'TZ'`, `'+255'`, `'TZS'`, `'sw'`, `'TRA'`, `'Tumemadini'`, `'NEMC'`, `'BoT'`, `'Africa/Dar_es_Salaam'`, `'Swahili'` literal in `src/` (outside language-pack-sw, jurisdiction-profile-tz, vertical-profile-mining-tz, and `__tests__`/`__fixtures__`) must move into a profile lookup. Tests can stay literal because they exercise the TZ launch tenant explicitly.

### Refactor #3 — Schema scrub

Any column with a TZ-specific default (e.g. `default 'TZS'` on a currency column) must instead either (a) read tenant default at write time or (b) remain non-defaulted with the application setting the value from the tenant's jurisdiction profile.

### Refactor #4 — Migration scrub

Migrations that seed regulators / currencies / phone formats etc. for TZ must move those seeds into the `jurisdiction-profile-tz` package's seed file, NOT bake them into the migration. The migration creates the table; the seed package fills it.

---

## §4. Provenance

- Founder directive 2026-05-26: *"borji will start in tanzania but its build for the entire world so lets not be hard coded in compliance etc intelligence couldbe universal"*
- This doc is the immutable record; subsequent changes to this invariant require a new dated lock-doc.
- Cross-reference: original `FOUNDER_LOCKED_DECISIONS_2026_05_26.md` (5 product decisions + 3 SOTA findings).
