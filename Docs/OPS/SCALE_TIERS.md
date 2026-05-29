# Borjie scale tiers — one product, every mining size

**Audience:** founder, ops, sales, support, LLM coding assistants.
**Status:** SC-1..SC-7 (wave SCALE-AWARE) shipped. Tier is the single
column `tenants.scale_tier` added by migration 0145.

## The promise (plain English)

> "Borjie is one product. It serves a 1-worker artisanal pit in Singida
> exactly as well as it serves a 5,000-worker industrial group with
> sites in TZ, KE, UG and DRC. The owner does not pick a 'small' or
> 'big' product. The product reads the size and adapts the cockpit,
> the brain register, and the workflow depth accordingly."

## The five tiers

| Tier | Slug | Workers | Sites | Cross-border | Cockpit tabs |
| --- | --- | ---:| ---:| --- | ---:|
| T1 | `t1_artisanal` | 1-5 | 1 | no | 4 |
| T2 | `t2_cooperative` | 5-50 | 1-4 | no | 7 |
| T3 | `t3_midtier` | 50-500 | 2-8 | no | 11 |
| T4 | `t4_industrial` | 500-5000 | 4-20 | no | 16 |
| T5 | `t5_multi_country` | any | any | yes | 20 |

### What each tier sees

- **T1 Artisanal.** Today's task, last sale, cash position, owner-chat.
  Mr. Mwikila talks plainly, leads with safety + cash, never assumes a
  back-office team will action a recommendation.

- **T2 Cooperative.** + workforce roster, cooperative settlement,
  weekly KPI. Mr. Mwikila is cooperative-aware and frames the rhythm
  around weekly settlement.

- **T3 Mid-tier.** + manager dispatch, compliance calendar, multi-site
  map, payroll. Mr. Mwikila speaks managerial register and frames work
  in dispatches, compliance windows, and monthly cadence.

- **T4 Industrial.** + finance suite, HR pipeline, regulator inbox,
  safety board, forecast. Mr. Mwikila briefs like a Chief of Staff and
  never recommends actions the CEO should do personally.

- **T5 Multi-country group.** + group KPI, currency consolidation,
  cross-border settlement, multi-regulator view. Mr. Mwikila rolls
  KPIs up per jurisdiction and reads regulator-set per country before
  generalising.

## Auto-detect on signup (SC-1)

The owner sign-up wizard captures four signals:

```
{ workerCount, siteCount, mineralCount, crossBorder }
```

The API calls `autoDetectScaleTier(signals)` from
`@borjie/owner-os-tabs` and persists the result into
`tenants.scale_tier`. The raw signals are kept in
`tenants.scale_signals` (jsonb) so a recomputer can upgrade the tier
later without re-prompting the owner.

Decision rules (top-down — first match wins):

1. `crossBorder` → T5 multi-country
2. `workers > 500` → T4 industrial
3. `workers > 50` OR `sites > 4` → T3 mid-tier
4. `workers > 5` OR `sites > 1` → T2 cooperative
5. else → T1 artisanal

Existing tenants without signals fall back to **T1 artisanal** —
nothing breaks for any account created before migration 0145.

## Default tab sets (SC-2)

The tab ladder is **additive**. Each tier inherits everything below
it. The exact id sequence per tier lives in
`packages/owner-os-tabs/src/scale-defaults.ts` and is verified by the
unit test ladder in
`packages/owner-os-tabs/src/__tests__/scale-defaults.test.ts`.

## Scale-aware persona (SC-3)

The brain-teach route reads `tenants.scale_tier` per turn and prepends
a `## SCALE_REGISTER` bilingual section to the base teaching prompt.
See `services/api-gateway/src/services/brain/scale-persona.ts`.

The base prompt is unchanged. The scale section is short (3-6 bullet
lines) and intentionally focuses on register / depth, not capabilities.

## Scale-aware orchestration (SC-4)

The Top-5 flows (`top-flows.ts`) all encode the enterprise shape. The
selector layer in
`services/api-gateway/src/services/orchestration/scale-flows.ts`
projects them down for the lighter tiers:

| Flow | T1/T2 (lite) | T3 (canonical) | T4/T5 (extended) |
| --- | --- | --- | --- |
| LOI draft + send | compose → send (2 steps) | compose → lock → share → send (4 steps) | canonical |
| RFB dispatch | dispatch + journal | dispatch + journal | dispatch + journal |
| Coop settlement | canonical | canonical | canonical |
| Incident → buyer | report only | report → escalate → notify | canonical |
| Licence renewal | start → submit (2 steps) | start → upload → submit (3 steps) | canonical |

## Billing-tier hints (SC-5 — marketing copy)

Each scale tier maps to a marketing **billing hint** the public site
surfaces alongside the tier name. These are NOT billing logic — billing
is a separate concern — they're just the suggested plan label.

| Tier | Marketing label | Billing hint |
| --- | --- | --- |
| T1 | Artisanal | `free_pilot` |
| T2 | Cooperative | `starter` |
| T3 | Mid-tier | `growth` |
| T4 | Industrial | `enterprise` |
| T5 | Multi-country group | `multi_region` |

The hint surfaces via `scaleTierLabel(tier).billingHint` in
`@borjie/owner-os-tabs`.

## Performance budgets per tier (SC-7)

Expected steady-state data volumes per tier — surfaced in
`/health/deep` so the gateway can warn when a tenant exceeds its
declared tier capacity (the operator follow-up is to suggest a tier
upgrade, never to hard-cap the tenant).

| Table | T1 | T2 | T3 | T4 | T5 |
| --- | ---:| ---:| ---:| ---:| ---:|
| `shift_reports` | ≤ 30 / mo | ≤ 200 / mo | ≤ 2,500 / mo | ≤ 30,000 / mo | ≤ 200,000 / mo |
| `workers` | ≤ 5 | ≤ 50 | ≤ 500 | ≤ 5,000 | ≤ 50,000 |
| `sales` | ≤ 10 / mo | ≤ 80 / mo | ≤ 800 / mo | ≤ 8,000 / mo | ≤ 60,000 / mo |
| `sites` | 1 | ≤ 4 | ≤ 8 | ≤ 20 | ≤ 80 |
| `regulator_filings` | ≤ 12 / yr | ≤ 50 / yr | ≤ 500 / yr | ≤ 4,000 / yr | ≤ 25,000 / yr |
| Brain context-window budget | 64 KB | 96 KB | 128 KB | 192 KB | 256 KB |

When a tenant exceeds 2× its tier's row budget for any single table
the gateway logs a `tier_capacity_exceeded` warning with the table
name, tenant id, current count, and recommended next tier. The
operator surfaces the recommendation in admin-web.

## Fixtures (SC-6)

Test fixtures for each tier live in
`packages/database/src/seeds/scale-fixtures/` and are exported via
the package barrel.

```
t1-artisanal.ts    1 worker, 1 pit, single mineral
t2-coop.ts         22 workers, 3 pits, weekly settlement
t3-midtier.ts      180 workers, 5 sites, 2 minerals
t4-industrial.ts   1,200 workers, 8 sites, multi-region
t5-group.ts        3,400 workers, 4 jurisdictions, crossBorder=true
```

Each fixture, when fed back through `autoDetectScaleTier`, classifies
to its declared tier. The fixture suite is verified by
`packages/database/src/seeds/__tests__/scale-fixtures.test.ts`.

## Hard rules

- **Never delete a tier.** The ladder is append-only. Adding a new
  tier means a new migration + new entry in `SCALE_TIERS` (zod enum)
  + new entry in `defaultTabsFor()` + new persona copy + new fixture.
- **Never hard-cap by tier.** Performance budgets surface as
  recommendations, never as 403 / 429 blocks. Per the kill-switch
  rule, fail-closed only on policy violations — not on capacity.
- **Bilingual everywhere.** Every persona section, marketing copy,
  and KPI label MUST land in both `sw` and `en`.
- **One product.** No "Borjie Mini" SKU, no "Borjie Enterprise" SKU,
  no parallel codebases. One product, one schema, one tier column.

## Cross-references

- `packages/database/src/migrations/0145_tenants_scale_tier.sql`
- `packages/database/src/schemas/tenant.schema.ts` (scaleTier column)
- `packages/owner-os-tabs/src/scale-defaults.ts` (tab ladder + auto-detect)
- `services/api-gateway/src/services/brain/scale-persona.ts` (persona)
- `services/api-gateway/src/services/brain/tenant-scale-lookup.ts` (DB lookup)
- `services/api-gateway/src/services/orchestration/scale-flows.ts` (flow selectors)
- `packages/database/src/seeds/scale-fixtures/` (5 tier fixtures)
