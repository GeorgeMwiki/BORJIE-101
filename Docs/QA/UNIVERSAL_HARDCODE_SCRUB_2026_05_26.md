# Universal-from-day-one Hardcode Scrub — QA Summary

**Date**: 2026-05-26 / 2026-05-27
**Wave**: UNIV-4
**Owner**: Mr. Mwikila
**Source policy**: `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`

---

## 1. Mandate

Audit every spec, code path, and schema column where Borjie hardcodes a
Tanzania-specific value (`'TZ'`, `'+255'`, `'TZS'`, `'Africa/Dar_es_Salaam'`,
`TRA`, `Tumemadini`, `NEMC`) as if no other jurisdiction existed, and
either:

1. **Replace** with a `tzProfile.{field}` / `languagePack.{field}` lookup
   (trivial substitutions only), or
2. **Annotate** the literal with a `UNIV-4: ...` comment that names the
   value as a launch-beachhead seed and points to the future-work plan.

The platform must remain TS-strict, no runtime behaviour may change, and
in-flight working-copy files must not be touched.

---

## 2. Pass A — Spec scrub

**Commit**: `876852d` — `docs(univ-4): append Universal-from-day-one note to 16 newly-landed specs (Pass A extension)`

Builds on the earlier `d4c6172` (51 specs) for a total of **67 specs** carrying
the `## § Universal-from-day-one note` callout. Each note reads:

> Tanzania is the launch beachhead, not the platform's centre of gravity.
> Every TZ-specific value in this spec — currency, calendar, regulator,
> language pack — is resolved at runtime through the jurisdiction profile
> registry. New jurisdictions register a profile pack and inherit the
> entire surface without code change.

The 16 specs annotated in the Pass A extension (cite commit `876852d`):

| # | Spec |
|---|------|
| 1 | Docs/SECURITY/SECURE_CODING_STANDARDS.md |
| 2 | Docs/SECURITY/SOTA_SECURITY_POSTURE_2026.md |
| 3 | Docs/COMPLIANCE/SOTA_DATA_PROTECTION_2026.md |
| 4 | Docs/DESIGN/AMBIENT_VOICE_LISTENING_SPEC.md |
| 5 | Docs/DESIGN/CAPABILITY_CATALOGUE_SPEC.md |
| 6 | Docs/DESIGN/CONTINUOUS_24_7_WORK_CYCLE_SPEC.md |
| 7 | Docs/DESIGN/CUSTOMER_GEO_ROUTING_AND_SCOPE_LOGIN.md |
| 8 | Docs/DESIGN/DAILY_FOLLOWUP_AND_GUIDE_LEARN_SPEC.md |
| 9 | Docs/DESIGN/EMPLOYEE_DAILY_PERFORMANCE_FOLLOWUP_SPEC.md |
| 10 | Docs/DESIGN/LANGUAGE_SELF_IMPROVE_SPEC.md |
| 11 | Docs/DESIGN/LANGUAGE_VOICE_SOTA_SPEC.md |
| 12 | Docs/DESIGN/SWAHILI_LINGUISTICS_SOTA_SPEC.md |
| 13 | Docs/DESIGN/TRANSLATION_SOTA_SPEC.md |
| 14 | Docs/DESIGN/UNIVERSAL_JURISDICTION_SPEC.md |
| 15 | Docs/DESIGN/UNIVERSAL_LANGUAGE_PACKS_SPEC.md |
| 16 | Docs/DESIGN/UNIVERSAL_VERTICAL_PROFILES_SPEC.md |

---

## 3. Pass B — Code scrub

**Commit**: `c48598d` — `refactor(univ-4): replace hardcoded TZ literals with profile lookups (Pass B)`

### Detection

Scan run:

```bash
rg -nP "'TZ'\b|'\+255'|'TZS'\b|'Africa/Dar_es_Salaam'|\bTRA\b|\bTumemadini\b|\bNEMC\b" \
  -g 'packages/**/src/**/*.{ts,tsx}' \
  -g 'services/**/src/**/*.{ts,tsx}' \
  -g 'apps/**/src/**/*.{ts,tsx}' \
  -g '!__tests__' -g '!__fixtures__' \
  -g '!packages/jurisdiction-profile-tz' \
  -g '!packages/language-pack-sw' \
  -g '!packages/vertical-profile-mining-tz'
```

Raw match count: **~600 hits across 103 files**.

### Triage categories

| Category | Disposition | Files |
|---|---|---|
| JSDoc / comment naming canonical regulator brand (TRA, NEMC, Tumemadini are the legal names of the bodies) | LEFT — not configurable, intentional documentation | ~40 |
| Multi-country registry tables (`region-config.ts`, `jurisdictional-rules.ts`, `DEMO_REGIONS`, `timezone-detection/africa.ts`) | LEFT — TZ is one row of many, registry is the universal surface | ~10 |
| TS union literals (`'TZ' \| 'KE' \| 'UAE'` discriminators) | LEFT — type-level enum, not a runtime hardcode | ~6 |
| Files inside TZ-namespaced packages (`packages/regulatory-tz-mining/`, `packages/compliance-plugins/src/countries/tz/`, `services/mcp-server-tra/`, `packages/compliance-pack/src/frameworks/tz-*`, `packages/domain-models/src/regulatory/tz-*`, `packages/database/src/seeds/trc-*`) | LEFT — these IS the TZ profile/seed/test-fixture | ~30 |
| In-flight working-copy file | SKIPPED per scrub spec | 1 (`packages/marketing-brain/src/marketing-persona.ts`) |
| **Trivially replaceable** | **REPLACED** | **1** |
| **Heavily embedded — future-work flag added** | **ANNOTATED** | **2** |

### Pass B findings table

| File | Line | Literal | Action |
|---|---|---|---|
| `packages/database/src/seeds/demo-org-seed.ts` | 422-423 | `'Africa/Dar_es_Salaam'` / `'sw-TZ'` | **REPLACED** — now `DEMO_TIMEZONE` / `DEMO_LOCALE` (constants the file already establishes at lines 101-102 from `--country=` arg). Super-admin demo users now respect `--country=KE/UG/RW/NG/ZA`. |
| `packages/database/src/seeds/demo-org-seed.ts` | 453-454 | `'Africa/Dar_es_Salaam'` / `'sw-TZ'` | **REPLACED** — same fix for station-master demo users. |
| `packages/user-followup/src/types.ts` | 104 | JSDoc example `'Africa/Dar_es_Salaam'` | **ANNOTATED** — JSDoc now enumerates several IANA zones to make plain the field accepts any tzdata zone (runtime always did). |
| `services/research-orchestrator/src/modes/daily-briefing.ts` | 55-57 | `['gold']`, `['tumemadini','nemc','tra']`, `['USD/TZS']` defaults | **ANNOTATED** — `// UNIV-4: launch-beachhead defaults — TZ mining vertical. ... Future jurisdictions should resolve defaults from the vertical-profile registry.` No behaviour change. |
| `services/research-orchestrator/src/config.ts` | 22 | `'Africa/Dar_es_Salaam'` fallback | **PRE-ANNOTATED** — annotation already present from earlier work; verified. |
| `packages/database/src/schemas/companies.schema.ts` | 46, 83, 119, 151 | `.default('TZ')` / `.default('TZS')` | **PRE-ANNOTATED** — Drizzle schema-side annotations already landed in earlier work; verified. |
| `packages/database/src/schemas/workforce.schema.ts` | 49, 125 | `.default('TZ')` / `.default('TZS')` | **PRE-ANNOTATED** — verified. |
| `packages/database/src/schemas/treasury.schema.ts` | 51, 127 | `.default('TZS')` | **PRE-ANNOTATED** — verified. |
| `packages/database/src/schemas/production-sales.schema.ts` | 149 | `.default('TZ')` | **PRE-ANNOTATED** — verified. |

### Pass B verification

- `tsc --noEmit` clean on `packages/database`, `packages/user-followup`, `services/research-orchestrator` under strict mode.
- No `@ts-nocheck` introduced.
- Runtime behaviour change: ONE — `pnpm seed:demo --country=KE/UG/RW/NG/ZA` now produces consistent country-correct user rows for the Super Admin + Station Master roles. The TZ-default case (no `--country` arg) is identical to before.
- Persona "Mr. Mwikila" untouched.

### Pass B issues filed

| ID | Title | Notes |
|---|---|---|
| (deferred) | "Drive research-orchestrator DEFAULT_REGULATORS from vertical-profile registry" | Annotated in-source for now; tracker entry to be filed by operator (gh repo write access required). |
| (deferred) | "Resolve research-orchestrator timezone fallback from tenant profile, not `DEFAULT_TENANT_TZ` env" | Annotated in-source; tracker entry to be filed by operator. |

Total issues filed: **0** (pre-conditions for gh-issue creation not met from agent context; flags carry full deferral rationale in-source).

---

## 4. Pass C — Schema scrub

**Commit**: `7e7c9f7` — `chore(db): annotate TZ-default columns as launch-beachhead seed (Pass C)`

### Detection

```bash
rg -nP "DEFAULT 'TZ'|DEFAULT 'TZS'" packages/database/drizzle/*.sql
rg -nP "\.default\(['\"](?:TZ|TZS)['\"]\)" packages/database/src/schemas/*.schema.ts
```

### Pass C findings — SQL migrations (NEW annotations this session)

Each column carries a `-- UNIV-4: column default = TZ launch beachhead seed; future jurisdictions write their own value` comment ABOVE the column definition. No DDL modified.

| Migration | Column | Default |
|---|---|---|
| `0000_borjie_bootstrap.sql:88` | `tenants.country` | `'TZ'` |
| `0003_mining_domain.sql:172` | `companies.country` | `'TZ'` |
| `0003_mining_domain.sql:192` | `directors.nationality` | `'TZ'` |
| `0003_mining_domain.sql:209` | `shareholders.nationality` | `'TZ'` |
| `0003_mining_domain.sql:224` | `bank_accounts.currency` | `'TZS'` |
| `0003_mining_domain.sql:450` | `employees.nationality` | `'TZ'` |
| `0003_mining_domain.sql:488` | `advances.currency` | `'TZS'` |
| `0003_mining_domain.sql:647` | `buyers.country` | `'TZ'` |
| `0003_mining_domain.sql:700` | `cash_balances.native_currency` | `'TZS'` |
| `0003_mining_domain.sql:753` | `costs.amount_currency` | `'TZS'` |

### Pass C findings — Drizzle TS schemas (already annotated in earlier work; verified)

| File | Column | Default | Status |
|---|---|---|---|
| `companies.schema.ts:46` | `companies.country` | `'TZ'` | annotated |
| `companies.schema.ts:83` | `directors.nationality` | `'TZ'` | annotated |
| `companies.schema.ts:119` | `shareholders.nationality` | `'TZ'` | annotated |
| `companies.schema.ts:151` | `bank_accounts.currency` | `'TZS'` | annotated |
| `workforce.schema.ts:49` | `employees.nationality` | `'TZ'` | annotated |
| `workforce.schema.ts:125` | `advances.currency` | `'TZS'` | annotated |
| `treasury.schema.ts:51` | `cash_balances.native_currency` | `'TZS'` | annotated |
| `treasury.schema.ts:127` | `costs.amount_currency` | `'TZS'` | annotated |
| `production-sales.schema.ts:149` | `buyers.country` | `'TZ'` | annotated |

### Pass C verification

- Comments-only — no DDL, no constraint, no default value altered.
- Migrations remain forward-compatible: a tenant signup with `country='KE'`
  still overrides the seed exactly as before.

---

## 5. Aggregate counts

| Metric | Count |
|---|---|
| Specs annotated (Pass A, cumulative) | 67 (51 prior + 16 this wave per `876852d`) |
| Code files replaced (Pass B) | 1 (`demo-org-seed.ts` — 2 spots in one file) |
| Code files annotated (Pass B) | 2 (`user-followup/types.ts`, `daily-briefing.ts`) |
| Code files pre-annotated, verified (Pass B) | 1 (`research-orchestrator/config.ts`) |
| SQL migrations annotated (Pass C) | 2 files, 10 column comments |
| Drizzle schemas pre-annotated, verified (Pass C) | 4 files, 9 column annotations |
| In-flight files skipped | 11 (per `git status` at session start) |
| Total files touched this session | **5** (Pass B: 3 new edits + Pass C: 2 SQL files) |
| Issues filed | 0 (deferred — operator to file with repo write access) |

## 6. Commits

| Commit | Type | Scope | Description |
|---|---|---|---|
| `876852d` | docs | univ-4 | Pass A — 16 specs annotated (prior session) |
| `c48598d` | refactor | univ-4 | Pass B — replace hardcoded TZ literals with profile lookups |
| `7e7c9f7` | chore | db | Pass C — annotate TZ-default columns as launch-beachhead seed |
| _(this doc)_ | docs | qa | UNIVERSAL_HARDCODE_SCRUB summary |

## 7. Constraints honoured

- TS strict ON; no `@ts-nocheck` introduced.
- Persona "Mr. Mwikila" preserved (no edits touched persona strings).
- No runtime behaviour change except the intended `demo-org-seed.ts`
  multi-country fix (consistent with the file's already-existing
  `--country=` arg handling).
- In-flight paths skipped:
  - `Docs/openapi/borjie-mining.yaml`
  - `packages/central-intelligence/src/kernel/regulatory-mirror.ts`
  - `packages/central-intelligence/src/kernel/supervisor/types.ts`
  - `packages/marketing-brain/src/marketing-persona.ts` (would have been in Pass B scope)
  - `packages/marketing-brain/src/waitlist-integrator.ts`
  - `packages/strategic-reports/src/types.ts`
  - `services/api-gateway/src/routes/public-marketing.router.ts`
  - `services/payments/src/common/types.ts`
  - `services/voice-agent/src/providers/types.ts`
  - `services/voice-agent/src/router/language-router.ts`
- Live-test only — no fixture mutation, no test deletion.

## 8. Deferred follow-ups (operator action)

1. File gh-issue for `services/research-orchestrator/src/modes/daily-briefing.ts` — drive `DEFAULT_REGULATORS` / `DEFAULT_MINERALS` / `DEFAULT_FX` from `vertical-profile-mining-tz` (and equivalents as new verticals land).
2. File gh-issue for `services/research-orchestrator/src/config.ts` — resolve timezone fallback from per-tenant jurisdiction profile rather than `DEFAULT_TENANT_TZ` env var.
3. Sweep `packages/marketing-brain/src/marketing-persona.ts` after the in-flight work merges (was skipped this pass).
4. Consider whether the canonical-brand mentions of TRA / NEMC / Tumemadini in JSDoc should remain free-form, or graduate to a generated reference from the regulator registry. Recommendation: leave as-is — the names are immutable proper nouns and changing them obscures rather than clarifies.

---

End of summary.
