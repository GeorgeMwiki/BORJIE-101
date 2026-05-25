# Live-Test Runbook (`pnpm live-test`)

> Operator runbook for the full BORJIE happy-path E2E suite at
> `e2e/live-test/`. Run before each Supabase project promotion (dev →
> staging → prod) and on every release-candidate cut.

This is the **only** E2E suite that exercises:

- a live Supabase project (Auth + Postgres + RLS),
- the api-gateway with real JWT verification,
- the payments-ledger end-to-end (synthetic Daraja callback),
- the Brain end-to-end with DecisionTrace + Wave 12 features
  (three-voice debate / LATS / reflexion),
- cross-tenant RLS denials on every customer-facing resource.

For an architectural overview, see
[`Docs/SUPABASE_LIVE_TEST.md`](../SUPABASE_LIVE_TEST.md).

---

## 1. Prerequisites

| Item | How to check |
|---|---|
| Supabase project bootstrapped | `psql "$DATABASE_URL" -c "select count(*) from drizzle.__drizzle_migrations"` matches `ls packages/database/src/migrations/*.sql \| wc -l` |
| RLS enabled on tenant tables | `psql "$DATABASE_URL" -tAc "select count(*) from pg_class where relkind='r' and relrowsecurity=true"` ≥ 38 |
| Two test users exist | Supabase dashboard → Authentication → Users; look for `LIVE_TEST_OWNER_EMAIL` and `LIVE_TEST_OTHER_EMAIL` |
| `app_metadata.tenant_id` set on both | dashboard → user → "Raw app metadata" |
| api-gateway running | `curl http://localhost:4000/healthz` returns 200 |
| pnpm + node ≥ 20 | `node -v && pnpm -v` |

## 2. Environment

Required block in `.env.local`:

```bash
# --- Supabase ---
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon public key>
SUPABASE_SERVICE_ROLE_KEY=<server-only — used by cleanup fallback>
SUPABASE_JWT_SECRET=<HS256 signing secret>
DATABASE_URL=postgresql://postgres:<pw>@<host>:6543/postgres

# --- api-gateway ---
API_GATEWAY_URL=http://localhost:4000

# --- Live-test users (created in Supabase Auth out-of-band) ---
LIVE_TEST_OWNER_EMAIL=live-test-owner@borjie.test
LIVE_TEST_OWNER_PASSWORD=<≥ 16 chars, set in Supabase>
LIVE_TEST_OTHER_EMAIL=live-test-other@borjie.test
LIVE_TEST_OTHER_PASSWORD=<≥ 16 chars, set in Supabase>

# --- Optional, payments path ---
# When unset, spec 06 uses a synthetic CheckoutRequestID — the webhook
# path still gets exercised. When set, the live STK push is also tested.
MPESA_ENVIRONMENT=sandbox
MPESA_CONSUMER_KEY=
MPESA_CONSUMER_SECRET=
MPESA_PASS_KEY=
```

## 3. The steps

### Local

```bash
# 1. Start the api-gateway (and any other services that mount routes
#    used by the suite — payments-ledger if separated, ai-copilot Brain).
pnpm --filter @borjie/api-gateway dev &

# 2. Wait for /healthz to be 200.
until curl -fs http://localhost:4000/healthz > /dev/null; do sleep 1; done

# 3. Run the full live-test.
pnpm live-test
```

The suite prints `[live-test] globalSetup: ok — tokens cached` on
success of step 1, then streams Playwright's list reporter. Total
runtime is roughly **3-5 minutes** depending on LLM latency.

### CI

The suite is wired to the manual `workflow_dispatch` workflow
[`.github/workflows/live-test.yml`](../../.github/workflows/live-test.yml).
Trigger it from the GitHub Actions UI; it spins up postgres + api-gateway
and runs against a **test-only Supabase project** whose creds are
stored as `LIVE_TEST_*` secrets.

## 4. Common failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| `live-test env missing: NEXT_PUBLIC_SUPABASE_URL, …` | `.env.local` not loaded | `set -a; source .env.local; set +a` before `pnpm live-test` |
| `globalSetup: api-gateway not reachable at … after 10s` | gateway not running | `pnpm --filter @borjie/api-gateway dev` |
| `Supabase signIn failed: 400 invalid_grant` | wrong password or user not created | Supabase dashboard → Users → reset password |
| `api-gateway /api/me rejected the owner JWT` | `SUPABASE_JWT_SECRET` mismatch | Copy from Supabase dashboard → Settings → API → JWT Secret |
| Spec 02: `the cross-tenant user CANNOT see the new tenant` fails with status 200 | `app.tenant_id` GUC not rebinding per request, or RLS missing on `tenants` table | `psql "$DATABASE_URL" -c "select relrowsecurity from pg_class where relname='tenants'"` should be `t` |
| Spec 06 webhook returns 404 on every path | payments-ledger service not mounted | check `services/payments-ledger` is running, or that `/webhooks/mpesa/stk` is mounted on the api-gateway |
| Spec 06: ledger entry never reaches `completed` | webhook idempotency rejecting duplicate, or worker not processing | check `pnpm --filter @borjie/payments-ledger logs` |
| Spec 08 returns 503 | no LLM credentials in this environment | acceptable in staging without LLM — suite auto-`fixme()`s those tests |
| Spec 09 finds a resource readable cross-tenant | RLS gap on that table | grep `0155_supabase_rls_policies.sql` and `0156_supabase_rls_phase2.sql` for the table — if missing, add a policy |
| Spec 10 cascade probe still finds resources | tenant delete is soft-delete only, or cascade FK constraints missing | check `tenants` delete returns 2xx; check migration `0167_*` for `ON DELETE CASCADE` |

## 5. What to look for in logs

The api-gateway logs (when running with `LOG_LEVEL=debug`) should
show, in order:

```
[gateway] auth: verified JWT for user=…, tenant=tnt_lt_…
[gateway] tenants.create: bound app.tenant_id=tnt_lt_… (spec 02)
[gateway] properties.create: tenant=tnt_lt_…, property=prp_… (spec 03)
[gateway] units.create: x4 (spec 03)
[gateway] users.invite: role=customer (spec 04)
[gateway] leases.create: customerId=usr_lt_…, unitId=unt_… (spec 05)
[gateway] payments.stk-push or payments.stub: external=ws_CO_… (spec 06)
[gateway] webhooks.mpesa: external=ws_CO_…, status=success (spec 06)
[gateway] payments.complete: lease=lse_…, amount=45000 (spec 06)
[gateway] maintenance.create + maintenance.patch (spec 07)
[brain  ] ask: tenant=tnt_lt_…, traceId=dt_…, debate.invocations=… (spec 08)
[gateway] tenants.delete: cascade triggered (spec 10)
```

If any of those phases is silent, the corresponding spec will fail —
correlate by spec number.

## 6. Cleanup

If a run aborts mid-suite (e.g. spec 06 fails), the `globalTeardown`
defensively deletes the tenant. If even that fails:

```bash
# Manual cleanup — find live-test tenants by slug pattern.
psql "$DATABASE_URL" -c "
  select id, name, created_at
    from tenants
    where slug like 'live-test-%'
    order by created_at desc
    limit 10;
"

# Delete the tenant (cascade FKs handle the rest).
psql "$DATABASE_URL" -c "delete from tenants where id = '<tenant-id>'"
```

Then delete the two test users from Supabase dashboard → Authentication
→ Users (or use `adminDeleteUser()` from `e2e/live-test/fixtures/cleanup.ts`).

## 7. Promotion gate

A green `pnpm live-test` against a Supabase project is the
**promotion gate** for that project to receive traffic. Run it:

- After every Drizzle migration apply,
- After every api-gateway deploy to a new environment,
- Before flipping DNS to a new Supabase project,
- Nightly against staging via the scheduled
  [`live-test.yml`](../../.github/workflows/live-test.yml) workflow.

A red run blocks promotion. Investigate using the troubleshooting
table above before re-running.
