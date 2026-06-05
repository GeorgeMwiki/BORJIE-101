# Deploy Sequence — `rls-connection-pinning` → main → staging → canary → prod

**Audience:** platform operator.
**Scope:** the full, ordered path from merging the wiring branch to a flag-gated
production rollout of the LP-30 composition-root activation.
**Companion files:** [`boot-smoke.ts`](./boot-smoke.ts),
[`activate-ledger-roles.sh`](./activate-ledger-roles.sh),
[`enable-flags.sh`](./enable-flags.sh), [`CANARY_RUNBOOK.md`](./CANARY_RUNBOOK.md).

> **Operator-run.** Every step below is a deliberate command the operator
> issues. Nothing in this directory mutates a live environment on its own.
> Run from the repo root unless noted.

---

## 0. Pre-merge — CI must be green

The wiring lands on branch `rls-connection-pinning`. Merge to `main` ONLY when
CI is green. The source of truth for CI orchestration is `borjie-ci.yml`
(lint, typecheck, unit tests, build) plus the migration / security / audit
gates. Locally you can mirror the core gates:

```sh
make lint
make typecheck
make test
make build
```

Migration forward-only lint runs in CI via `borjie-db-migrations-check.yml`. To
dry-run the migrations against an ephemeral Postgres locally (Supabase-accurate
image with postgis + pgvector), use the apply-check harness:

```sh
node scripts/migration-apply-check.mjs --db-url="$DATABASE_URL"
```

Optional repo-level gate before you cut the merge:

```sh
node scripts/deploy-preflight.mjs        # human report
node scripts/deploy-preflight.mjs --json # machine-readable
```

**Gate:** `borjie-ci.yml` green on the PR; migration-check green; preflight
clean.

---

## 1. Merge `rls-connection-pinning` → `main`

Fast-forward / squash-merge the PR once CI is green (operator action via the
PR UI or `gh pr merge`). Confirm `main`'s post-merge CI run is also green before
proceeding — that is the artifact you will deploy.

---

## 2. Apply migrations

Migrations **0274** (`litfin_belief_learning`), **0275** (`ledger_roles`), and
**0276** (`brain_sleep_runs`) are **additive + safe** (forward-only; 0275 is
idempotent privilege plumbing guarded by `to_regclass` + duplicate-object
swallows; it creates NOLOGIN group roles only — no login users, no data
rewrite).

Apply against the target environment's database:

```sh
make db-migrate
# == pnpm --filter @borjie/database run db:migrate
```

**Gate (verify before continuing):**
- Migrations 0274 / 0275 / 0276 report applied.
- 0275 group roles present + grants correct:
  ```
  \du borjie_ledger_writer        -- exists, NOLOGIN
  \du borjie_ledger_reader        -- exists, NOLOGIN
  \dp public.ledger_entries       -- writer: INSERT,SELECT  (NO update/delete)
  ```

> Migration 0275 only **defines** the privilege sets. It does **not** create the
> login users — that is Step 6 (a separate, secret-bearing activation step),
> deliberately split out per the migration's own "DEPLOY STEP … OUTSIDE this
> migration" header and the CLAUDE.md "migrations are immutable" rule.

---

## 3. Deploy to STAGING

Deploy the green `main` artifact to staging with **every `BORJIE_*` canary flag
set to `0`** (lights-off — see the flag inventory in
[`CANARY_RUNBOOK.md`](./CANARY_RUNBOOK.md)).

```sh
make deploy-staging
# (tf-init/plan/apply + k8s-apply for K8S_ENV=staging)
```

---

## 4. Boot-smoke the deployed code

Run the local boot proof against the same commit you deployed. It constructs
the five composition seams (semantic cache, intent verifier, channel gateway,
privacy router, cognitive composer) with degraded in-memory adapters and flags
off, and asserts they build without throwing — proving the boot path is sound
**before** real traffic.

```sh
../../node_modules/.bin/tsx scripts/deploy/boot-smoke.ts
# or:  npx tsx scripts/deploy/boot-smoke.ts
```

**Gate:** prints `RESULT: PASS`, exits 0. Staging `/health` green; error rate +
p95 latency flat. (A non-zero exit means the boot path is unsound — do **not**
advance.)

---

## 5. Canary the flags (staging, then prod) — in order

Bring the seams up **one at a time** with a verification gate between each.
[`enable-flags.sh`](./enable-flags.sh) prints the order + per-step checks;
[`CANARY_RUNBOOK.md`](./CANARY_RUNBOOK.md) has the full watch-this-metric
checklist and rollback per step.

```sh
sh scripts/deploy/enable-flags.sh            # print the ordered plan
sh scripts/deploy/enable-flags.sh step 1     # details for step N
sh scripts/deploy/enable-flags.sh env 3      # cumulative export lines up to step N
```

Order (least blast-radius first):

1. `BORJIE_SEMANTIC_CACHE_ENABLED=1` — watch hit-rate + latency.
2. `BORJIE_INTENT_VERIFIER_ENABLED=1` (advisory) — watch WOULD-block log volume.
3. `BORJIE_COGNITIVE_COMPOSER_ENABLED=1` — watch cost + latency.
4. `BORJIE_INTENT_VERIFY_STRICT=1` (enforce) — **last**; watch blocked-call rate.

**Rollback (any step):** unset the flag (or `=0`) and roll the pods — **no
redeploy**. Every seam is fail-safe with its flag off.

**Gate:** each step's metrics healthy for a representative window before
advancing. Run the same sequence on staging first; only then on production.

---

## 6. Activate ledger-engine roles (after 0275 verified applied)

This is the migration-0275 **activation** step: create the env-secret login
users and grant them the group roles, then repoint the payments-ledger
connection strings. **Run ONLY after Step 2's gate confirmed 0275 applied +
grants present.** Passwords are read from the environment — never hardcoded.

```sh
LEDGER_ENGINE_PASSWORD='<engine-secret>' \
LEDGER_READ_PASSWORD='<read-secret>' \
DATABASE_URL='postgres://<admin-role>@<host>:5432/<db>' \
  sh scripts/deploy/activate-ledger-roles.sh
```

Use `DRY_RUN=1` first to print the exact SQL (passwords are bound psql
variables, never echoed):

```sh
LEDGER_ENGINE_PASSWORD='x' LEDGER_READ_PASSWORD='y' \
DATABASE_URL='postgres://admin@host/db' DRY_RUN=1 \
  sh scripts/deploy/activate-ledger-roles.sh
```

Then perform the connection-string repoint the script prints (operator / IaC
action — the script does not mutate service config):
- payments-ledger **engine** `DATABASE_URL` → `ledger_engine_app` (INSERT-only
  money path; no DELETE/TRUNCATE — append-only enforced at the DB).
- ledger **read** path → `ledger_read_app` (SELECT-only).

**Gate:** payments-ledger engine boots + posts a test entry as
`ledger_engine_app`; an attempted `UPDATE`/`DELETE` on `ledger_entries` is
rejected by the grant set; read path serves SELECTs as `ledger_read_app`. FORCE
RLS (0160) still applies to both.

---

## 7. Deploy to PRODUCTION

With staging fully canaried (Steps 4–6 green on staging) and the production
canary plan rehearsed, deploy the same artifact to production:

```sh
make deploy-production        # prompts for confirmation
```

Then repeat **Step 4** (boot-smoke), **Step 5** (flag canary in order), and
**Step 6** (ledger-role activation, with production secrets) against
production. Hold each gate before advancing.

---

## Quick reference

| Phase | Command |
|-------|---------|
| CI gates | `make lint && make typecheck && make test && make build` |
| Migration dry-run | `node scripts/migration-apply-check.mjs --db-url="$DATABASE_URL"` |
| Preflight | `node scripts/deploy-preflight.mjs` |
| Apply migrations | `make db-migrate` |
| Deploy staging | `make deploy-staging` |
| Boot proof | `../../node_modules/.bin/tsx scripts/deploy/boot-smoke.ts` |
| Canary plan | `sh scripts/deploy/enable-flags.sh` |
| Ledger roles | `… sh scripts/deploy/activate-ledger-roles.sh` |
| Deploy production | `make deploy-production` |

**Invariant reminders (CLAUDE.md):** money path goes through
`LedgerService.post()`; RLS is FORCE-enabled and unaffected by the role split;
migrations are immutable (0274/0275/0276 are append-only and must not be
edited).
