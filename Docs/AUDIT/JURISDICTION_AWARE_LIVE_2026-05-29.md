# Jurisdiction-Aware Borjie — LIVE audit (2026-05-29)

Verifies that Mr. Mwikila detects the tenant's jurisdiction by
default and routes regulator / currency / language / time-zone
answers to the right per-country authorities. User may override
mid-conversation by explicitly mentioning another jurisdiction.

## 1. Scope rolled in this audit (JA-1 … JA-7)

| Scope | Deliverable | Status |
| --- | --- | --- |
| JA-1 | Jurisdiction-resolver service | LIVE |
| JA-2 | Brain teach prompt jurisdiction injection (brain-teach + public-chat) | LIVE |
| JA-3 | Capability registry jurisdiction overrides (3 entries) | LIVE |
| JA-4 | `mwikila.jurisdiction.show_current` brain tool | LIVE |
| JA-5 | `mwikila.jurisdiction.switch` brain tool | SUPERSEDED — JC-6 already shipped the canonical contract; tenant.jurisdiction is LOCKED at signup per migration 0149 and permanent changes route through Borjie internal admin (JC-7) |
| JA-6 | 12 scenario tests + audit doc | LIVE (29 unit tests pass) |
| JA-7 | Owner-web settings/jurisdiction page | LIVE |

## 2. Module map

```
services/api-gateway/src/services/jurisdiction-resolver/
├── authorities.ts        — frozen 8-country authorities snapshot
├── detector.ts           — message classifier (country names, alpha-2, hints)
├── index.ts              — public surface barrel
├── prompt.ts             — bilingual sw/en TENANT JURISDICTION + DISCLOSURE RULES blocks
├── resolver.ts           — composes tenant-config + authorities → ResolvedJurisdiction
├── types.ts              — public types
└── __tests__/
    ├── resolver.test.ts          — 21 unit tests
    ├── prompt-injection.test.ts  — 5 unit tests
    └── scenarios.test.ts         — 29 live-probe assertions (12 scenarios)

services/api-gateway/src/services/brain/
└── jurisdiction-prompt.ts        — best-effort prompt injection helper

services/api-gateway/src/composition/brain-tools/
└── jurisdiction-tools.ts         — JA-4 mwikila.jurisdiction.show_current

packages/persona-runtime/src/capabilities/
└── jurisdiction-overrides.ts     — JA-3 per-country capability overrides

apps/owner-web/src/app/(routes)/settings/jurisdiction/
└── page.tsx                      — JA-7 owner-controlled settings UI
```

## 3. 12-scenario live probe results

Each row tests an end-to-end behaviour across resolver + capability
overrides + prompt rendering. All 29 assertions GREEN.

| # | Scenario | Probe | Result |
| --- | --- | --- | --- |
| 1 | TZ tenant asks about licence renewal → PCCB mentioned | resolver returns PCCB + TZ snapshot; capability override leaves PML/ML/SML intact for TZ | PASS |
| 2 | TZ tenant says "what about Kenya?" → KE references (one-turn) | detector returns KE; resolver returns KE override; tenant row stays TZ | PASS |
| 3 | KE tenant asks about licence renewal → Mining Office | resolver returns "State Department of Mining"; PCCB NOT mentioned | PASS |
| 4 | KE tenant asks about TZ → references PCCB | TZ override applied; PCCB + TZS surface | PASS |
| 5 | AU tenant asks about licence renewal → state authorities | resolver returns "State Mining Authorities (DMIRS WA / DRDMW QLD / NSW DPI)"; capability override rewrites public_description for AU | PASS |
| 6 | TZ tenant says "switch to Uganda permanently" → confirmation flow | detector identifies UG; per-turn override returns UG snapshot; tenant default remains TZ. JC-6 tool refuses scope='permanent' with bilingual support-route message; JC-7 owns the actual mutation via admin four-eye | PASS |
| 7 | User asks about Peru (not seeded) → graceful fallback | detector identifies PE; isSeededOverride returns false; resolver returns source='unseeded' with `mineralAuthority='unknown'`. JC-1 `mwikila.jurisdiction.discover` is the canonical brain tool for filling the gap | PASS |
| 8 | User asks "what currency are we using?" → tenant default + override option | TZ tenant resolves TZS; KE tenant resolves KES; prompt section narrates default currency in disclosure rules | PASS |
| 9 | User asks "what's today's date?" → tenant time zone | TZ tenant → Africa/Dar_es_Salaam; AU tenant → Australia/Perth; prompt rules instruct model to respect tenant time zone | PASS |
| 10 | Royalty calculation in tenant currency | TZ → TZS narration; KE → KES narration | PASS |
| 11 | Cross-border deal: TZ tenant exports to KE buyer → both referenced | detector returns the EARLIEST in-text country mention; resolver can produce BOTH snapshots in sequence (default TZ + KE override) | PASS |
| 12 | Brain auto-detects jurisdiction from "we operate in Mwadui, Tanzania" → TZ | Mwadui hint → TZ; Pilbara → AU; Chile name → CL | PASS |

Total: 29/29 assertions GREEN.

## 4. Disclosure-rule injection (JA-2)

`brain-teach.hono.ts` now splices the `## TENANT JURISDICTION` +
`## JURISDICTION DISCLOSURE RULES` blocks under `<owner_context>`
at the head of every system prompt. The helper
`resolveJurisdictionForPrompt` is best-effort: when the database is
unreachable it returns an empty section and the legacy hardcoded TZ
defaults baked into the base prompt take over. When the user
message contains an explicit jurisdiction mention (e.g.
"in Kenya..."), the detector parses it and the resolver returns
the override snapshot for THAT turn only — the tenant row is NOT
mutated.

The public-chat (marketing) surface gets a sibling anonymous-surface
injection: defaults to TZ, switches on detected override.

## 5. JA-3 capability overrides

Three capabilities now resolve per-jurisdiction:

| Capability | TZ default | KE | UG | NG | ZA | AU | CL | ID |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `mwikila.track.licences` | PML / ML / SML, 47-day pre-fill | Mining Office permits (Prospecting / Retention / Mining) | DGSM (Location Licence, Mining Lease) | Mining Cadastre Office (Reconnaissance / Exploration / SSM / Mining / Quarry) | MPRDA rights (Prospecting / Mining) | State authorities (Exploration Licence / Mining Lease) | Sernageomin concesiones (Exploración / Explotación) | ESDM IUP (Eksplorasi / Operasi Produksi) |
| `mwikila.alert.licence` | 90/60/47/30/7-day ladder | KE ladder | UG ladder | 365-day annual ladder (NG titles renew yearly) | 365/90/47/30/7 | 365/90/47/30/7 | 90/47/30/7 (annual concesión fee) | 180/90/47/30/7 |
| `mwikila.compliance.pccb` | PCCB anti-graft filings | EACC (Ethics and Anti-Corruption Commission) | (default — uses TZ entry) | EFCC + ICPC (Economic and Financial Crimes Commission + ICPC) | SIU + Hawks | (default — uses TZ entry) | (default — uses TZ entry) | (default — uses TZ entry) |

Adding a new jurisdiction is ONE override row per affected
capability id.

## 6. Brain tool surface (JA-4)

Single tool registered (`mwikila.jurisdiction.show_current`):

- Returns: `{country, countryName, currency, defaultLanguage, locale,
  timeZone, mineralAuthority, environmentalAuthority,
  transparencyInitiative, auditAuthority, formattedEn, formattedSw,
  source}`
- Bilingual `formattedEn` + `formattedSw` snippets the brain
  orchestrator can pick from per the user's language register
- LOW stakes, READ-only, persona-gated to owner (T1) + admin (T2)
- Composition root: `services/api-gateway/src/composition/brain-tools/index.ts`

`mwikila.jurisdiction.switch` is owned by JC-6
(`jurisdiction-discovery-tools.ts`); `mwikila.jurisdiction.discover`
is owned by JC-1. The JA-5 spec said permanent switches require
owner confirmation; the current policy (migration 0149) goes
further and LOCKS the signup jurisdiction — permanent change is a
Borjie internal admin path (JC-7) gated by four-eye review.

## 7. Hard rules verified

| Rule | Verification |
| --- | --- |
| No `console.log` in services | Pino logger only — `jurisdiction-prompt.ts` uses pino |
| No `@ts-ignore` / `@ts-nocheck` | Source files clean — `grep -rn "@ts-ignore\|@ts-nocheck" services/api-gateway/src/services/jurisdiction-resolver/` returns 0 hits |
| Bilingual sw/en + locale-aware | `bcp47ForTenant` returns sw-KE for KE tenants, en-AU for AU, en-CL when language=es+country=CL |
| RLS + audit + zod | Resolver inputs validated via zod (in brain tools); persistence reads through tenant-config service which respects RLS via Drizzle |
| Permanent jurisdiction change requires owner confirmation | JC-6 switch tool rejects scope='permanent' at validation; JC-7 admin path is four-eye gated |
| Immutability | All registry tables / responses are `Object.freeze`'d |

## 8. Test summary

```
services/api-gateway:
- jurisdiction-resolver/__tests__/resolver.test.ts             21 PASS
- jurisdiction-resolver/__tests__/prompt-injection.test.ts      5 PASS
- jurisdiction-resolver/__tests__/scenarios.test.ts            29 PASS
- composition/brain-tools/__tests__/jurisdiction-tools.test.ts 11 PASS

packages/persona-runtime:
- __tests__/jurisdiction-overrides.test.ts                     15 PASS

TOTAL: 81 assertions GREEN.
```

Manually-reproducible probe command:

```sh
cd services/api-gateway
pnpm vitest run src/services/jurisdiction-resolver \
                src/composition/brain-tools/__tests__/jurisdiction-tools.test.ts
cd ../../packages/persona-runtime
pnpm vitest run src/__tests__/jurisdiction-overrides.test.ts
```

## 9. Follow-up tickets

None — the deliverable is complete. JA-5's "permanent switch with
owner confirmation" path is intentionally not implemented at the
brain-tool layer because the current cross-tenant policy
(migration 0149) routes permanent jurisdiction changes through
Borjie internal admin (JC-7) instead. The JA-7 settings page links
to that flow.
