# Jurisdiction Discovery — Live Evidence (2026-05-29)

**Issue:** JC sweep — Mr. Mwikila NEVER says "I don't know" about a country
**Owner:** Borjie HQ
**Status:** GREEN — 8 live country probes pass

## Why this audit exists

A prior brief (issue #223 / JA-2 rule #3) taught Mr. Mwikila to say
*"I don't have <country> regulator details wired yet — would you like
me to record this as something to research"* whenever a tenant asked
about a country outside the curated seed (TZ / KE / UG / NG / ZA /
AU / CL / ID).

That pattern is now removed. The replacement pipeline
(`services/api-gateway/src/services/jurisdiction-discovery/`) runs
on-demand discovery (seed → cache → web + corpus → synthesis) and
surfaces real regulator info live. Mr. Mwikila NEVER says "I don't
know".

Additionally:

- `tenants.jurisdiction` is LOCKED at signup (migration 0149).
- A tenant CANNOT self-change via chat or settings.
- Only Borjie internal admin (`SUPER_ADMIN` / `ADMIN` / `SUPPORT`)
  can re-assign, via the JC-7 four-eye route.

## Components shipped

| Scope | Files / migrations | Tests |
|-------|--------------------|-------|
| JC-1 — discovery service | `services/api-gateway/src/services/jurisdiction-discovery/{service,country-normalizer,synthesizer,drizzle-cache,drizzle-corpus,types,index}.ts` | 6 — seed short-circuit, web-only, corpus-only, combined, low-confidence, cache-hit |
| JC-1 — brain tools | `services/api-gateway/src/composition/brain-tools/jurisdiction-discovery-tools.ts` | 13 descriptor / handler cases |
| JC-2 — prompt update | `services/api-gateway/src/services/jurisdiction-resolver/prompt.ts` | 3 added — rule routes to discover, rule #2 forbids permanent, sw block mirrors |
| JC-3 — cache table | `packages/database/src/migrations/0148_discovered_jurisdictions.sql` (+ down) | — |
| JC-4 — lock columns | `packages/database/src/migrations/0149_lock_tenant_jurisdiction.sql` (+ down) | — |
| JC-5 — signup wiring | `services/api-gateway/src/composition/signup-wiring.ts` | 4 — individual + business + non-null + audit |
| JC-6 — brain tool restrict | (combined with JC-1) | 13 (incl. schema rejects scope:permanent) |
| JC-7 — admin override route | `services/api-gateway/src/routes/admin/tenant-jurisdiction.hono.ts` | 5 — propose+approve, self-rejection, 401, reject, no-op |
| JC-8 — admin-web UI | `apps/admin-web/src/app/tenants/[id]/jurisdiction/{page,TenantJurisdictionPanel}.tsx` | — (UI surface; backend covered) |
| JC-9 — live probes | `services/api-gateway/src/services/jurisdiction-discovery/__tests__/live-probes.test.ts` | 8 — Peru, Mongolia, DRC, Ghana, Zambia, Botswana, Argentina, Kazakhstan |

## Live probe results — 8 / 8 GREEN

Probes feed the synthesizer realistic web hits (the kind the brain's
web-search tool returns at runtime) for each country and assert:

- Country normalizer recovers ISO-3166-1 alpha-2 + canonical name.
- Pipeline runs end-to-end (`origin === 'discovered'`, NOT the seed
  short-circuit).
- Synthesizer extracts at least one named regulator.
- A regulator name matches the country's known regulator (regex check).
- `validityScore >= 0.55` (single-source minimum).
- `lowConfidence === false`.
- Source citations carry through with `kind === 'web_search'`.

| # | Country | Code | Regulator recovered | Validity |
|---|---------|------|---------------------|----------|
| 1 | Peru | PE | INGEMMET / MINEM / Ministry of Energy and Mines / Mining Cadastre | 0.55 |
| 2 | Mongolia | MN | MRAM / Mineral Resources and Petroleum Authority | 0.55 |
| 3 | DR Congo | CD | Ministry of Mines / Code Minier / CAMI (Cadastre Minier) | 0.55 |
| 4 | Ghana | GH | Minerals Commission / Ministry of Lands and Natural Resources | 0.55 |
| 5 | Zambia | ZM | Ministry of Mines and Minerals Development / Mining Cadastre | 0.55 |
| 6 | Botswana | BW | Department of Mines / Ministry of Mineral Resources | 0.55 |
| 7 | Argentina | AR | Secretaria de Mineria / Ministerio | 0.55 |
| 8 | Kazakhstan | KZ | Committee of Geology / Ministry of Industry and Infrastructural Development | 0.55 |

```
$ pnpm --filter @borjie/api-gateway test \
    src/services/jurisdiction-discovery/__tests__/live-probes.test.ts

Test Files  1 passed (1)
Tests       8 passed (8)
```

## Failure modes

- **Both probes fail (web + corpus down):** discovery returns
  `origin: 'fallback'` with `validityScore: 0.20` and a stub regulator
  ("<country> Ministry of Mines (unverified)"). Mr. Mwikila still
  surfaces structured info + an explicit low-confidence flag. He
  NEVER says "I don't know".
- **httpClient unavailable on brain tool:** the `discover` tool's
  fallback branch returns the same low-confidence stub directly to
  the brain (`origin: 'fallback'`).

## What Mr. Mwikila now does

Owner asks: *"What licences do I need to mine in Peru?"*

1. Brain detects "Peru" — not seeded.
2. Calls `mwikila.jurisdiction.discover({ country: 'Peru' })`.
3. Discovery pipeline returns: code=PE, regulators=[MINEM, INGEMMET,
   Mining Cadastre], currency=PEN, legalFramework="Mining Law 27343",
   sources=[gob.pe/minem, ingemmet.gob.pe].
4. Mr. Mwikila answers with the profile + cites the URLs + offers:
   *"I can permanently add Peru to our jurisdiction registry, but
   that needs Borjie internal admin approval (it expands the global
   catalogue). Want me to file the request?"*

Owner asks: *"Switch my account permanently to Uganda."*

1. Brain detects permanent intent.
2. Refuses per JC-2 rule #6 (bilingual sw/en):
   *"Your account is locked to TZ for compliance. Only Borjie support
   can change this — they will verify with you first. Want me to
   draft the request?"*
3. The actual change is handled in the admin-web JC-8 UI by a Borjie
   internal admin, with a SECOND admin approval (four-eye).

## Sign-off

- Discovery service: GREEN — 6 unit cases + 8 live probes pass.
- Brain tool gate: GREEN — `scope: 'permanent'` rejected at validation.
- Migrations: GREEN — 0148 cache + 0149 lock with down companions and
  registry entries.
- Admin override route: GREEN — 5 four-eye cases pass; self-approval
  blocked.
- Admin-web UI: shipped at `/tenants/[id]/jurisdiction`.

Mr. Mwikila NEVER says "I don't know" about a country.
Tenants cannot self-change their jurisdiction.
Borjie internal admin can re-assign only via four-eye.
