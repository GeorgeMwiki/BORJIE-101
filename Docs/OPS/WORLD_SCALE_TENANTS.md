# World-scale tenants (issue #207)

**Last updated:** 2026-05-29.
**Owner:** Platform / Brain wave.
**Status:** WS-1..WS-7 LANDED on `main`. WS-8 (geo zones) tracks the
next sprint.
**Companion docs:**
- [`Docs/SECURITY/DATA_RESIDENCY_PHASE_1.md`](../SECURITY/DATA_RESIDENCY_PHASE_1.md) §8 (multi-region addendum)
- [`packages/database/src/migrations/0143_regulator_jurisdictions.sql`](../../packages/database/src/migrations/0143_regulator_jurisdictions.sql)
- [`packages/database/src/seeds/regulator-jurisdictions.seed.ts`](../../packages/database/src/seeds/regulator-jurisdictions.seed.ts)
- [`services/api-gateway/src/services/tenant-config/`](../../services/api-gateway/src/services/tenant-config/)

---

## 1. Why this exists

Borjie is mining estate-OS — built first for Tanzania but
**global from day one**. Tanzania is the GTM beachhead. It is
**not** a hardcode anywhere in the product.

Every TZ-locked default (TZS currency, sw language, +255 phone
prefix, PCCB/NEMC/EITI/TMAA regulator set, Tanzanian mineral list,
Africa/Dar_es_Salaam timezone, EAC data-residency) MUST be sourced
from a tenant-config lookup. Adding Kenya / Nigeria / Australia /
Chile / Indonesia / South Africa / Uganda is a **config row**, not
a code change.

---

## 2. What landed in this work-package

### WS-1 — Currency

Migration 0143 widens `tenants_primary_currency_chk` to admit ZAR,
AUD, CLP, IDR alongside the existing TZS / USD / KES / UGX / NGN /
EUR. TZS remains the default; existing tenants are binary-identical.

Production code reads `TenantConfig.defaultCurrency` from
`services/api-gateway/src/services/tenant-config/`, never hard-codes
'TZS'. The `formatCurrency(amount, currency)` helper from
`@borjie/genui` is fed the resolved value.

### WS-2 — Language

Migration 0143 widens `tenants_default_language_chk` to admit
`fr`, `pt`, `sw-KE`, `es`, `id` alongside `sw` / `en`. `sw` remains
the default (CLAUDE.md "Swahili-first").

`LANGUAGE_CATALOGUE` (in `services/api-gateway/src/services/
tenant-config/language.ts`) maps every supported code to its BCP-47
tag (sw-TZ, sw-KE, en-US, fr-FR, pt-BR, es-CL, id-ID) and English
fallback chain. `bilingualForTenant(cfg, copy)` is the only place
the rest of the app picks between primary + fallback copy.

### WS-3 — Regulator catalogue

Migration 0143 creates the tenant-AGNOSTIC `regulator_jurisdictions`
table (same model as `regulatory_zones`, `intelligence_corpus_chunks`).
The seed `regulator-jurisdictions.seed.ts` upserts authorities for
**9 sets** (8 jurisdictions + 1 generic fallback):

| Set       | Authorities |
| --------- | ----------- |
| TZ-set    | PCCB, NEMC, EITI Tanzania, TMAA |
| KE-set    | State Dept of Mining, NEMA, EITI Kenya |
| UG-set    | DGSM, NEMA-UG, EITI Uganda |
| NG-set    | MMSD, NESREA, NEITI |
| ZA-set    | DMRE, DFFE (DEAT successor) |
| AU-set    | Geoscience Australia, EPA Victoria, DJPR |
| CL-set    | SERNAGEOMIN, COCHILCO |
| ID-set    | ESDM, MEMR |
| generic   | generic mining auth + generic environment auth (fallback) |

Each row carries `country_code`, `name_en`, `name_local` (in the
authority's native language), `mandate`, `contact_url`,
`dsr_endpoint`, and `licence_renewal_endpoint`. The `RegulatorLookup`
service (regulators.ts) joins `tenants.regulator_set` to the
catalogue with active-window filtering.

### WS-4 — Phone (E.164)

`services/identity/src/phone-normalize.ts` `REGION_TABLE` now covers
TZ / KE / UG / RW / NG / ZA / AU / ID / CL / US / GB.
`dialingCodeForTenant(cfg)` in `tenant-config/phone.ts` is the
production helper — country → regulator-set → TZ fallback chain so
nothing ever crashes for an under-configured tenant.

### WS-5 — Mineral kinds

`MINERAL_CATALOGUE` in `tenant-config/minerals.ts` is the global
registry (32 entries — gold, silver, platinum, palladium, tanzanite,
ruby, sapphire, diamond, gemstone, copper, iron-ore, coal, nickel,
lithium, graphite, manganese, chrome, cobalt, molybdenum, tungsten,
tin, lead-zinc, columbite, bitumen, bauxite, rare-earths, titanium-
bearing-sands, gypsum, limestone, fluorspar, phosphate, zinc).

Each entry carries the canonical slug, English + Swahili labels,
local labels for non-TZ tenants (es / pt / fr / id), HS-2017
commodity code prefix, and industry group. The per-tenant gate
`isMineralAllowedForTenant(cfg, slug)` reads `tenant.allowed_minerals`
(migration 0143 default — TZ-set 12 minerals) and is the **only**
place application code may ask "may this tenant transact in this
mineral?".

### WS-6 — Storage region (planning)

Documented in `Docs/SECURITY/DATA_RESIDENCY_PHASE_1.md` §8. Adds the
af-south-1 (TZ/KE/UG/NG/ZA) + ap-southeast-2 (AU) + sa-east-1 (CL) +
ap-southeast-3 (ID) + eu-west-1 (generic) routing table. Tenant
rows already carry `tenants.region`; the tenant-config service
extends this with `tenants.country_code` so the routing layer reads
`(region, country_code, regulator_set)` at signup.

### WS-7 — Locale / date / time

The tenant-config service exposes `JURISDICTION_DEFAULTS[].timezone`
(IANA strings: Africa/Dar_es_Salaam, Africa/Nairobi, Africa/Lagos,
Africa/Johannesburg, Australia/Perth, America/Santiago, Asia/Jakarta,
Africa/Kampala). Production code feeds this into the daily-brief
cron, date pickers, and any other Intl-aware helper.

### WS-8 — Geo regulatory zones (next)

Migration 0144 (`tenant_regulatory_zones`) tracks the multi-region
polygon library. Seed beyond the existing TZ PCCB zones (issue #189)
follows the same pattern — KE / UG / NG / ZA polygons feed the
geofencing service.

---

## 3. The tenant-config service contract

```
import {
  createDrizzleTenantConfigService,
  bcp47ForTenant,
  bilingualForTenant,
  dialingCodeForTenant,
  isMineralAllowedForTenant,
  labelForMineral,
} from '@borjie/api-gateway/services/tenant-config';

const cfg = await tenantConfigService.get(tenantId);
// cfg.defaultCurrency / cfg.defaultLanguage / cfg.regulatorSet /
// cfg.countryCode / cfg.allowedMinerals — all readonly.

formatCurrency(amount, cfg.defaultCurrency);
const intl = new Intl.NumberFormat(bcp47ForTenant(cfg));
const { primary, fallback } = bilingualForTenant(cfg, {
  sw: 'Habari', en: 'Hello',
});
const dial = dialingCodeForTenant(cfg);  // '255' | '254' | …

if (!isMineralAllowedForTenant(cfg, 'lithium')) {
  // 403 — tenant licence does not cover lithium
}
```

The service is **immutable**: every return value is `Object.freeze`-ed.
No caching layer — single-row indexed SELECT is fast enough. If
profiling ever shows a hotspot, the read path swaps to Redis without
changing the public contract.

---

## 4. Adding a new jurisdiction

1. Append a row to `JURISDICTION_DEFAULTS` in
   `services/api-gateway/src/services/tenant-config/jurisdictions.ts`
   with the regulator-set, country code, currency, language,
   phone prefix, timezone, mineral allowlist.
2. Append rows to `REGULATOR_ROWS` in
   `packages/database/src/seeds/regulator-jurisdictions.seed.ts` for
   each authority in the new set.
3. If the currency / language is new, append a CHECK-widening
   migration (numbered after 0143). NEVER edit 0143.
4. If the country uses unusual dialing rules, append a row to
   `services/identity/src/phone-normalize.ts` `REGION_TABLE`.
5. Add an entry to the §8.1 routing table in
   `Docs/SECURITY/DATA_RESIDENCY_PHASE_1.md`.
6. Add the residency target (Supabase region + KMS key) to the
   data-residency table.
7. Run the seed against a sandbox tenant + verify the lookups.

That's it. No production code path changes — the catalogue + tenant
column is the only surface that needs to know.

---

## 5. Hard rules (re-stated for emphasis)

- NEVER hard-code `'TZS'`, `'sw'`, `'+255'`, `'TZ'`, or `PCCB`.
- Currency display goes through `formatCurrency(amount,
  cfg.defaultCurrency)`.
- Language picks go through `bilingualForTenant(cfg, copy)`.
- Phone normalize goes through
  `normalizePhoneForCountry(phone, cfg.countryCode)`.
- Mineral gate goes through `isMineralAllowedForTenant(cfg, slug)`.
- All hard rules from `CLAUDE.md` keep holding — Swahili-first stays
  the platform DEFAULT, just no longer a global hardcode.

End of WORLD_SCALE_TENANTS.md.
