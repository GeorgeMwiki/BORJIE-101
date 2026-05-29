# Borjie live-test runbook

**Last updated:** 2026-05-29
**Audience:** human tester sitting at a laptop, walking through Mr.
Mwikila end-to-end as each of the 5 seeded test accounts.
**Goal:** prove every power responds, no broken surfaces.

This runbook is the source of truth for *interactive* live testing.
For the *synthetic* equivalent (curl-style, no browser) see
`scripts/live-test/happy-path.ts`.

---

## 0. Pre-flight check

Before touching the runbook, confirm:

| Item | How to verify | Fix if missing |
|------|---------------|----------------|
| Node ≥ 20, pnpm 8.15 | `node --version`, `pnpm --version` | `nvm use 20 && corepack enable` |
| Dev DB reachable | `psql "$DATABASE_URL" -c '\dt'` | Boot Supabase / restart pooler |
| `.env.local` exists | `ls .env.local` | `cp .env.example .env.local`, then `pnpm setup-env` |
| `SUPABASE_JWT_SECRET` populated in `.env.local` | `grep SUPABASE_JWT_SECRET .env.local` | See "JWT secret choice" below |
| `JWT_SECRET` ≥ 32 chars | `grep JWT_SECRET .env.local` | `openssl rand -base64 48 > /tmp/s.txt` and paste in |
| Free ports 3010 / 3020 / 3002 / 4001 | `lsof -iTCP:3010 -sTCP:LISTEN` | Surgical kill: `lsof -tiTCP:3010 | xargs kill` (NEVER `killall -9 node`) |

### JWT secret choice

The api-gateway's brain routes verify bearer tokens against
`SUPABASE_JWT_SECRET` (HS256 path). Pick ONE:

| Use-case | Set `SUPABASE_JWT_SECRET` to | Why |
|----------|------------------------------|-----|
| Synthetic happy-path script (`scripts/live-test/happy-path.ts`) | A local dev value, e.g. `openssl rand -base64 48` (already populated in `.env.local`) | The script mints HS256 test tokens with the same value. Self-contained. |
| Interactive browser sign-in against the real Supabase project | The project's legacy HS256 secret: Supabase Dashboard → Settings → API → JWT Settings → JWT Secret | Supabase signs user tokens with that key; the gateway must use the same to verify. |
| Modern ES256-only Supabase projects | Leave empty AND ensure `NEXT_PUBLIC_SUPABASE_URL` resolves a public JWKS URL | `services/api-gateway/src/middleware/hono-auth.ts` will use the JWKS path. (Brain routes still need it however; see Known Limitations.) |

NEVER commit a real value of `SUPABASE_JWT_SECRET`. `.env.local` is
gitignored.

---

## 1. Setup

From the repo root:

```bash
# Install workspaces if you haven't.
pnpm install

# Apply migrations to the live dev DB.
pnpm migrate

# Seed the demo tenant + 5 test users + mining operational data.
pnpm tsx scripts/live-test/seed-demo.ts

# Boot the api-gateway in a dedicated tmux pane (port 4001).
pnpm --filter @borjie/api-gateway dev

# In another pane: owner cockpit (port 3010).
pnpm --filter @borjie/owner-web dev

# In another pane: admin console (port 3020).
pnpm --filter @borjie/admin-web dev

# In another pane: marketing site (port 3002).
pnpm --filter @borjie/marketing dev
```

The seeder prints a summary that ends with `Seed complete in N.Ns`.

### Confirm wiring with the synthetic runner

Before booting browsers, run the curl-style happy-path. It exercises
every step Mr. Mwikila would touch:

```bash
pnpm tsx scripts/live-test/happy-path.ts
```

Expected output (current state, 2026-05-29):
`Tally: 9 PASS · 1 FAIL · 0 SKIP`. The 1 FAIL is **Step 3** (`Brain
/turn`) which fails with HTTP 500 due to a brain-orchestrator bug
unrelated to auth (see §6 Known limitations). Steps 0-2 + 4-9 must
all PASS.

**Important:** if you changed `SUPABASE_JWT_SECRET` in `.env.local`
after the gateway was already running, both Brain steps (2 + 3) will
FAIL with `BRAIN_NOT_CONFIGURED` (HTTP 503) until you restart the
gateway. The gateway's own dotenv loader reads `.env` first with
`override: true`, so values must be set in BOTH `.env` AND `.env.local`
to win. `tsx watch` reloads on source changes but NOT on env-file
changes. Restart with:

```bash
# Surgical PID kill (NEVER `killall -9 node`).
lsof -tiTCP:4001 -sTCP:LISTEN | xargs kill
# Or: touch any file inside services/api-gateway/src to make tsx watch
# pick up env changes via reboot.
pnpm --filter @borjie/api-gateway dev
```

Any other FAIL → root cause and fix BEFORE moving on. Do not ship a
broken runbook.

---

## 2. Test-user matrix

| Role | Email | Password env-var | Browser app | Port |
|------|-------|------------------|-------------|------|
| Borjie internal admin | `admin@borjie.test` | `SEED_TEST_BORJIE_ADMIN_PASSWORD` | admin-web | 3020 |
| Mining owner | `owner@borjie.test` | `SEED_TEST_OWNER_PASSWORD` | owner-web | 3010 |
| Site manager | `manager@borjie.test` | `SEED_TEST_MANAGER_PASSWORD` | owner-web (manager view) | 3010 |
| Field worker | `worker@borjie.test` | `SEED_TEST_EMPLOYEE_PASSWORD` | workforce-mobile (Expo) | per Expo |
| Mineral buyer | `buyer@borjie.test` | `SEED_TEST_BUYER_PASSWORD` | buyer-mobile (Expo) | per Expo |

All five tenants share the demo tenant `00000000-0000-0000-0000-000000000001`
("Demo Mining Estate Ltd"). Passwords are in `.env.local` — print them
with:

```bash
grep SEED_TEST_ .env.local
```

---

## 3. Per-user happy paths

Each script is the human equivalent of one slice of the synthetic
happy-path runner. Tick every box.

### 3.1 Owner (Mr. Mwikila core flow)

1. Browse to `http://localhost:3010/sign-in`.
2. Sign in as `owner@borjie.test` with the matching password.
3. Confirm the dashboard renders the demo brief (3 sites,
   open licence reminder, dormancy risk on Kabanga).
4. Open the chat panel (cmd-K or the bottom-right Mr. Mwikila chip).
5. Send: `Mr. Mwikila, help me draft an LOI to ABC Off-takers for 2 tonnes of gold concentrate`.
6. Confirm the SSE stream returns a draft preview (tokens flow, no
   `error` frame).
7. Send: `Customize the price field to USD 95 per gram`.
8. Confirm a `draft_edit` block appears with the new price.
9. Send: `Save and lock`.
10. Confirm the response confirms a locked revision (look for
    `lockedAt: <iso>` and a green lock chip in the UI).
11. Send: `Share this LOI with finance@abctakers.example`.
12. Confirm a share link is generated (the UI shows a copy-to-clipboard
    chip and the share-link list refreshes).

If any step fails, copy the gateway log line (`pino` line with the
`turn_id`) and the network response body before reporting.

### 3.2 Borjie admin

1. Browse to `http://localhost:3020/sign-in`.
2. Sign in as `admin@borjie.test`.
3. Confirm the admin dashboard renders all tenants (just the demo
   tenant in this env).
4. Walk: Tenants → demo tenant → Users → confirm all 5 seeded users
   appear with their mining_role.
5. Walk: Audit Trail → confirm the synthetic happy-path runs appear
   (action filter: `brain.create`, `drafter.compose`).
6. Walk: Kill-switch → confirm the toggle UI is reachable (DO NOT
   flip it).

### 3.3 Site manager

1. Browse to `http://localhost:3010/sign-in`.
2. Sign in as `manager@borjie.test`.
3. Confirm the dashboard renders the manager view (3 sites + 12
   employees + 4 mining tasks).
4. Walk: Tasks → confirm the 4 demo mining tasks (drilling, sorting,
   transport, payroll) appear with their bilingual titles.
5. Walk: Workforce → confirm 12 employees show under the 3 sites.

### 3.4 Field worker

1. Boot `apps/workforce-mobile` in Expo Go: `pnpm --filter @borjie/workforce-mobile start`.
2. Open the Expo URL in a phone simulator.
3. Sign in as `worker@borjie.test`.
4. Confirm the worker home screen renders today's task queue.
5. Walk: Clock-in → confirm the geo-fence prompt appears.
6. Walk: Toolbox-talk → confirm the daily briefing is reachable.

### 3.5 Mineral buyer

1. Boot `apps/buyer-mobile` in Expo Go: `pnpm --filter @borjie/buyer-mobile start`.
2. Sign in as `buyer@borjie.test`.
3. Confirm the marketplace renders the demo Mererani parcel.
4. Walk: KYC status → confirm verified.

---

## 4. Troubleshooting

### `401 INVALID_TOKEN` on brain routes

- The gateway's `SUPABASE_JWT_SECRET` does not match the one the
  browser-session token is signed with.
- For synthetic testing: rerun the happy-path script after restarting
  the gateway so it reloads `.env.local`.
- For interactive testing: paste the real Supabase project HS256
  secret into `.env.local` and restart the gateway.

### `503 BRAIN_NOT_CONFIGURED`

- `loadBrainEnv` could not parse a required var (typically
  `ANTHROPIC_API_KEY` or `SUPABASE_JWT_SECRET`).
- Check the gateway boot log — pino emits a `BrainConfigError` with
  the specific path/issue.

### Seed step fails on `users.tenant_id` FK

- The borjie-test-users seed inserts public.users rows BEFORE the
  mining-demo seed wires them to operational rows. Re-run
  `pnpm tsx scripts/live-test/seed-demo.ts` end-to-end; the wrapper
  enforces order.

### `column "provenance" does not exist`

- Migration 0101 has not been applied. Run `pnpm migrate` first.

### Port already in use

- `lsof -tiTCP:<port>` → grab the PID, then `kill <PID>` (NOT
  `kill -9` and NEVER `killall -9 node` — see CLAUDE.md hard rules).

### Gateway: `Postgres-probe slow (>1500ms)`

- The supabase pooler is cold or rate-limited. Hit `/health/deep`
  twice — second call warms the cache.

---

## 5. Reset between runs

```bash
# Drop demo rows but keep the tenant + auth users (cheap reset).
psql "$DATABASE_URL" <<'SQL'
DELETE FROM document_drafts WHERE tenant_id = '00000000-0000-0000-0000-000000000001';
DELETE FROM reminders WHERE tenant_id = '00000000-0000-0000-0000-000000000001';
DELETE FROM mining_tasks WHERE tenant_id::text = '00000000-0000-0000-0000-000000000001';
DELETE FROM sales WHERE tenant_id = '00000000-0000-0000-0000-000000000001';
DELETE FROM ore_parcels WHERE tenant_id = '00000000-0000-0000-0000-000000000001';
DELETE FROM mineral_chain_of_custody WHERE tenant_id = '00000000-0000-0000-0000-000000000001';
DELETE FROM cooperative_settlement_periods WHERE tenant_id::text = '00000000-0000-0000-0000-000000000001';
DELETE FROM risks WHERE tenant_id = '00000000-0000-0000-0000-000000000001';
DELETE FROM tasks WHERE tenant_id = '00000000-0000-0000-0000-000000000001';
DELETE FROM employees WHERE tenant_id = '00000000-0000-0000-0000-000000000001';
DELETE FROM sites WHERE tenant_id = '00000000-0000-0000-0000-000000000001';
DELETE FROM licences WHERE tenant_id = '00000000-0000-0000-0000-000000000001';
DELETE FROM buyers WHERE tenant_id = '00000000-0000-0000-0000-000000000001';
DELETE FROM companies WHERE tenant_id = '00000000-0000-0000-0000-000000000001';
SQL

# Re-seed.
pnpm tsx scripts/live-test/seed-demo.ts
```

Full nuke (drops Supabase auth users too):

```bash
# DANGER: deletes the 5 test users from Supabase Auth too.
# Only do this if you want a fresh sign-up flow next run.
pnpm --filter @borjie/database tsx src/seeds/borjie-test-users.delete.ts
```

(The delete script does NOT yet exist — file an issue if you need it
without rotating the whole project.)

---

## 6. Known limitations (2026-05-29)

- The brain.hono.ts route handler still uses only the HS256
  `SUPABASE_JWT_SECRET` path. Modern Supabase ES256 / JWKS verification
  is in scope for #167 (Hono upgrades). Until then, browser sessions
  signed by an ES256-only Supabase project will 401 on `/api/v1/brain/*`.
- The brain orchestrator's `threads` insert currently rejects with a
  Postgres `invalid input syntax for type uuid` when `team_ids` is
  empty (project default for fresh users). Step 3 of the happy-path
  script (`POST /api/v1/brain/turn`) fails with HTTP 500 until the
  orchestrator falls back to `NULL` for empty team/employee columns.
  Tracked under #167 (Hono). Auth + persona dispatch (estate-manager
  selected) are confirmed working — only the DB write fails.
- The cooperative-settlement seeder writes a `draft` row but does not
  yet exercise the four-eye distribution flow. Cooperative payout
  testing is gated on #168 (compliance).
- `apps/workforce-mobile` and `apps/buyer-mobile` happy paths are
  scoped under #171 (mobile). Treat sections 3.4 + 3.5 as smoke probes
  until that lands.

---

## 7. After the run

1. Stop services (Ctrl-C in each tmux pane — the gateway pino handler
   prints `shutting down`).
2. Capture the gateway log line for any failure to `Docs/AUDIT/`.
3. Update `Docs/AUDIT/LAUNCH_READINESS_GREEN.md` with the date + tally.
4. Commit any new audit artefacts under `Docs/AUDIT/`.
