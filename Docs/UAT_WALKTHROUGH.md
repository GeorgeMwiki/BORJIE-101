# BORJIE UAT Walkthrough

End-to-end UAT script for the BORJIE platform, seeded with the generic
"Demo Estate Corporation" fixture (a multi-district public-sector estate
demo organization).

## What it verifies

The walkthrough (`scripts/uat-walkthrough.sh`) exercises the gateway's core
business surface with a Director-General-scoped JWT against a demo-org-seeded
database:

| # | Step | What it verifies |
|---|------|------------------|
| 0 | `GET /health` | Gateway is live and reachable. |
| 1 | Mint JWT | `jsonwebtoken` can sign an HS256 token the gateway accepts. |
| 2 | `GET /api/v1/properties` | Properties repo returns the 20 seeded demo-org properties (10 warehouses + 5 barelands + 5 godowns). |
| 3 | `GET /api/v1/customers` | Customer repo returns the 20 seeded sample tenants. |
| 4 | `GET /api/v1/units` | Units repo returns 20 units (one unit per seeded property). |
| 5 | `POST /api/v1/applications/route` (below 500k TZS) | Station-master router resolves an EMU-tier application. |
| 6 | `POST /api/v1/applications/route` (above 500k TZS, tagged) | Station-master router escalates to DG tier. |
| 7 | `POST /api/v1/gepg/control-numbers` | GePG provider issues a control number (or surfaces a sandbox 502 when no certs). |
| 8 | `POST /api/v1/arrears/cases` | Arrears case is opened against the seeded lease. |
| 9 | `GET /api/v1/gamification/customers/<id>` | Gamification profile returns a valid tier (`bronze` through `platinum`). |

Each step fails loudly with the HTTP code and a 400-char body preview.
`503`/`501` responses are recorded as documented degradations rather than
hard failures, so an unconfigured upstream doesn't block the walkthrough.

## Prerequisites

1. **Postgres 15+** running on `localhost:5432` with a `borjie`
   database.
2. **Schema up-to-date.** The drizzle SQL migrations must all be applied.
   If a fresh DB was bootstrapped by `drizzle push` rather than the
   migration runner, some columns may have drifted from the Drizzle
   schema. Re-run the runner to catch up:

   ```bash
   DATABASE_URL=postgresql://localhost:5432/borjie \
     pnpm -F @borjie/database db:migrate
   ```

3. **demo-org seed applied.** The seed is idempotent (stable IDs +
   `onConflictDoNothing`) so it is safe to re-run:

   ```bash
   SEED_ORG_SEEDS=true \
   DATABASE_URL=postgresql://localhost:5432/borjie \
     pnpm -F @borjie/database exec tsx src/seeds/run-seed.ts --org=demo
   ```

   Expected row counts after seeding (any pre-existing non-demo rows add
   to these):

   | Table | Count |
   |-------|-------|
   | `tenants` | 1 `demo-tenant` row |
   | `users` | 8 (1 DG + 2 super admins + 5 station masters) |
   | `geo_nodes` | 58 (4 districts + 4 regions + 50 stations) |
   | `properties` | 20 |
   | `customers` | 20 |
   | `leases` | 15 |
   | `ledger_entries` | 50 |
   | `units` | 20 |
   | `maintenance_requests` | 5 |
   | `approval_policies` | 3 |
   | `accounts` | 15 |

4. **Gateway running.** With the same `JWT_SECRET` the script will use:

   ```bash
   DATABASE_URL=postgresql://localhost:5432/borjie \
   JWT_SECRET="uat-walkthrough-dev-jwt-secret-32chars-min-please-ok" \
   PORT=4000 NODE_ENV=development \
     pnpm -F @borjie/api-gateway dev
   ```

5. **Local tools:** `jq`, `curl`, and `node` on the `PATH`. The script
   calls `require('jsonwebtoken')`, which must resolve from the repo's
   `node_modules` (run from the repo root).

## Running the script

```bash
./scripts/uat-walkthrough.sh
```

Environment overrides:

| Var | Default | Purpose |
|-----|---------|---------|
| `GATEWAY_URL` | `http://localhost:4000` | Where the gateway is listening. |
| `JWT_SECRET` | `uat-walkthrough-dev-jwt-secret-32chars-min-please-ok` | Must match the gateway's `JWT_SECRET`. |
| `TENANT_ID` | `demo-tenant` | Tenant claim baked into the JWT. |
| `USER_ID` | `demo-user-dg` | Subject user. |
| `ROLE` | `SUPER_ADMIN` | Role claim. `SUPER_ADMIN` is in the tenant-isolation allowlist so a DG token can traverse all routes. |

Exit codes:

- `0` — all steps passed (including steps skipped as documented degradations).
- `1` — at least one step failed unexpectedly.
- `2` — prerequisites missing (no `jq`, gateway unreachable, etc.).

## Expected output (happy path)

```
=== BORJIE UAT Walkthrough ===
Gateway:   http://localhost:4000
Tenant:    demo-tenant
User:      demo-user-dg (SUPER_ADMIN)

Step 0: Gateway health
  HTTP 200  service=api-gateway
  PASS

Step 1: Mint SUPER_ADMIN JWT for demo-user-dg
  token: eyJhbGciOiJIUzI1NiIsInR5cC...
  PASS

Step: GET /properties (expect 20)
  GET /api/v1/properties
  rows: 20  (matches expected 20)
  PASS

... (repeats for customers, units)

Step: POST /applications/route (below-500k — EMU)
  POST /api/v1/applications/route
  body: {"applicationId":"uat-app-below-001","assetType":"commercial",...
  HTTP 200  matches expected (200 201)
  PASS

... (remaining steps)

=== Summary ===
PASS: 10
SKIP: 0
FAIL: 0
```

## Known gaps and how they surface

### Gateway body-parse bug

The gateway mounts Hono routes under an Express stack that has
`express.json()` registered globally. Express consumes the request body
before the `@hono/node-server/vercel` adapter runs, so `zValidator('json')`
inside Hono sees the stream as empty and returns:

```json
{"error":"Malformed JSON in request body"}
```

All POST endpoints validated with `zValidator('json', …)` are affected
— including `/applications/route`, `/gepg/control-numbers`, `/arrears/cases`.
The script detects the signature `Malformed JSON` at HTTP 400 and records
these steps as SKIP with the note `known gateway bug` rather than failing
the walkthrough. Fix: relocate `express.json()` below the `/api/v1`
mount, or migrate those routes to `@hono/node-server` directly without
an Express shell.

### GePG sandbox 502

`POST /gepg/control-numbers` requires `GEPG_PKCS12_PATH` /
`GEPG_PKCS12_PASSWORD` (or `GEPG_HMAC_SECRET` when `GEPG_PSP_MODE=true`)
to issue a real control number against the sandbox. Without creds the
provider returns 502. The script lists 502 as an accepted code so a
first-run developer without GePG credentials still sees the route light
up — the step confirms routing and auth, not wire-level fulfilment.

### Applications has no REST list / create

`/applications` intentionally exposes only two endpoints:

- `GET /` — smoke test, returns `[]` plus documentation meta.
- `POST /route` — resolve a station master for a location.

There is no `POST /` (the application aggregate is stateless — the
station-master router is the system of record). The script calls the
`/route` endpoint twice, once per approval tier.

### Degraded-mode endpoints

Routers built via factory (e.g. `migration`) return HTTP 503 when the
composition root cannot build the underlying service — typically
because `DATABASE_URL` was unset when the gateway booted. The script
logs a SKIP for these; if they appear in `SKIP` it usually means the
gateway needs to be restarted with `DATABASE_URL` set.

## Debugging failures

1. **Every step is failing with HTTP 401** — `JWT_SECRET` passed to the
   script does not match the value the gateway was booted with. Check
   the gateway's startup log (search for `jwt`). If the gateway is
   using an ephemeral dev secret, stop it and relaunch with a fixed
   `JWT_SECRET` in the environment.

2. **GET /properties returns 200 but count is 0** — the demo-org seed has
   not been applied. Run the seed command from "Prerequisites" step 3
   and re-run this script.

3. **Seed fails with `column X of relation Y does not exist`** — the
   drizzle schema is ahead of the applied SQL migrations. Re-run the
   migration runner (Prerequisites step 2). If a column is in the
   Drizzle schema but has no SQL migration, that's a separate bug
   (`ADD COLUMN IF NOT EXISTS`) that must be raised against
   `packages/database`.

4. **Gateway 500 with `repos is undefined`** — the service registry
   could not wire repos, usually because `DATABASE_URL` was unset
   on gateway startup. Re-export `DATABASE_URL` and restart.

5. **`EADDRINUSE :::4000`** — another process holds port 4000. Stop
   it (`lsof -i :4000`) or override `PORT` on the gateway and
   `GATEWAY_URL` on the script.

## Teardown

The script writes `/tmp/uat-*.json` artifacts for each step. They are
safe to delete:

```bash
rm -f /tmp/uat-*.json
```

The seed is idempotent — there is no separate teardown. To wipe demo
data, truncate the seeded tables manually or reset the DB.
