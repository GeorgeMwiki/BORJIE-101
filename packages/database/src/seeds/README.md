# Organization Seeds

Per-organization seed data that provisions a tenant, geo-hierarchy, users,
approval policies, and sample properties/leases/payments/maintenance so the
whole stack can be exercised end-to-end without manual setup.

Each seed is **idempotent** — re-running it is safe. All rows use
deterministic natural-key ids (`<org>-*-NNN`) plus `ON CONFLICT DO NOTHING`.

> Distinct from `packages/database/src/seed.ts`. That file is the
> generic demo seed (runs via `pnpm db:seed:demo`) and creates a single
> Kenya-based tenant from `SEED_*` env vars. The org seeds here are
> opinionated per-org fixture bundles.

## Running

Org seeds are gated behind an explicit acknowledgement env var so they
cannot accidentally run in production.

```bash
# Seed the demo organization only
SEED_ORG_SEEDS=true DATABASE_URL=postgres://... pnpm db:seed --org=demo

# Seed every registered org
SEED_ORG_SEEDS=true DATABASE_URL=postgres://... pnpm db:seed --org=all
```

If `DATABASE_URL` or `SEED_ORG_SEEDS` is missing the runner refuses to start.

Each org seed runs inside its own database transaction. A partial failure
rolls back cleanly — you can rerun after fixing the cause.

## What's in each seed

### `demo` — Demo Estate Corporation

Generic fixture modeling a large multi-district public-sector estate client.
Intentionally anonymous so Borjie customers of any size/region see a
recognizable shape when exploring the product.

| Area              | Count / detail                                                              |
| ----------------- | --------------------------------------------------------------------------- |
| Tenant            | `demo-tenant` — country=TZ, currency=TZS, tier=enterprise                    |
| Organization      | `demo-org` — "Demo Head Office"                                              |
| Roles             | `demo_admin`, `demo_estate_manager`, `demo_station_master`                   |
| Users             | Director General (OWNER), 2 Super Admins, 5 Station Masters                  |
| Geo Label Types   | depth=0 District, depth=1 Region, depth=2 Station                            |
| Geo Nodes         | 4 Districts + ~20 Regions + ~50 Stations (plus closure-table rows)           |
| Geo Assignments   | 5 Station Masters bound to their home station                                |
| District polygons | Simplified bounding shapes from `demo-districts.json`                        |
| Approval policies | `maintenance_cost`, `lease_exception`, `payment_flexibility` with 100k/500k TZS thresholds |
| Invite codes      | `DEMO-ONBOARD-001`, `DEMO-ONBOARD-002`, `DEMO-STATION-MASTER` (on `tenants.settings`) |
| Properties        | 10 warehouses + 5 barelands + 5 godowns (each with 1 unit)                   |
| Sample customers  | 20 Tanzanian identities (TZ `+255` phones, `@example.com` emails)            |
| Sample leases     | 15 active fixed-term leases, varied rent amounts in TZS                      |
| Sample payments   | 50 ledger entries — mix of on-time and late (0 - 120 days)                   |
| Maintenance cases | 5 open requests spanning structural/electrical/plumbing/general              |

The 4 demo districts follow the inverted hierarchy (Districts > Regions),
using real Tanzanian geography so coordinate-based features (maps, routing,
polygon overlays) render with plausible shapes:

- **Dar es Salaam District** — Dar es Salaam + Pwani + 50% Morogoro
- **Dodoma District** — 50% Morogoro + Dodoma + Singida + 50% Tabora
- **Tabora District** — 50% Tabora + Rukwa + Kigoma + Shinyanga + Simiyu + Mwanza
- **Tanga District** — North Pwani + Tanga + Moshi + Arusha + Mara

Polygon coordinates in `demo-districts.json` are simplified bounding shapes
(not survey-grade boundaries). Replace with the customer's authoritative
shapefiles before any production rollout.

## Adding a new org seed

1. Create `packages/database/src/seeds/<org>-seed.ts` exporting
   `async function seed<Org>(db: DatabaseClient): Promise<void>`.
2. Wrap the whole body in `db.transaction(async (tx) => { ... })`.
3. Use deterministic ids (`<org>-*-NNN`) and `.onConflictDoNothing()` on
   every insert to keep the seed idempotent.
4. If the org needs static data (polygons, lookups), add a sibling JSON
   file imported with `assert { type: 'json' }`.
5. Register the seed in `run-seed.ts` by adding it to the `ORG_SEEDS`
   map:

   ```ts
   const ORG_SEEDS: Record<string, OrgSeedRunner> = {
     demo: seedDemoOrg,
     <org>: seed<Org>,
   };
   ```

6. Document the new seed in the "What's in each seed" section above.

## File layout

```
packages/database/src/seeds/
├── README.md             # this file
├── run-seed.ts           # CLI dispatcher (pnpm db:seed)
├── sample-tenants.ts     # shared sample identities/leases/payments
├── demo-districts.json   # simplified demo-org district polygons
└── demo-org-seed.ts      # demo organization seed
```
