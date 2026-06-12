# Production Go-Live — the irreducible human checklist

**Everything that is code, config, tooling, and documentation is DONE.** What
remains below is only what genuinely requires a human: pasting a secret VALUE,
choosing a maintenance hour, and clicking the live cutover. Each step is one
action, backed by a tool that does the rest. This list IS the measure of how
much was covered — it is intentionally short.

Status going in: merged to `main`, CD green (staging + production pipelines
pass), all gates green. The platform boots, stays up, and its money/tenant/
audit invariants are the best-proven in this repo's history.

---

## 1. Secrets / keys — *paste the values*
The required set, the fail-loud preflight, and the GitHub-secret setter are all
built. Your job is the values.
1. Put the production secret VALUES into `.env.local` (or your secret store) for the 8 required keys:
   `DATABASE_URL`, `JWT_SECRET`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `ANTHROPIC_API_KEY`, `SESSION_HASH_SECRET`.
   ( the `[SELF-GEN]` ones: `pnpm gen-secrets --write` mints them. )
2. `pnpm preflight --env .env.local` → confirm **READY** (it names anything missing).
3. `pnpm set-gh-secrets --env .env.local --repo <owner/repo> --env-name production` → pushes only the present secrets to GitHub Actions (never echoes a value).

*Done for you:* the production-required set is asserted at boot (NODE_ENV=production fails loud listing every missing key), the preflight CLI, the secret-setter, and the parity test that keeps the schema + CLI in sync.

## 2. Live-Supabase migration delta — *pick the window, run the printed command*
The drift between the live DB and the repo is analyzed for you; you choose when.
1. `export DATABASE_URL=<live Supabase URL or a prod clone>` (the tool is strictly read-only — it only SELECTs the migration ledger).
2. `pnpm db:dryrun` → review the PENDING delta and the **SAFE / NEEDS-WINDOW / DANGER** classification. Note `0305` = ~377 non-CONCURRENT index builds → **NEEDS-WINDOW**.
3. Choose a maintenance window sized to the NEEDS-WINDOW + DANGER phases; confirm a fresh backup exists before any DANGER (destructive) migration.
4. In the window, run the exact command the plan prints: `DATABASE_URL=<live> pnpm -C packages/database db:migrate`. Then `pnpm db:dryrun` again to confirm **PENDING = 0**.

*Done for you:* the read-only drift dry-run, the lock-hazard static scanner, the maintenance-window-ordered apply plan, the index-storm flag, the full chain proven on fresh PG17.

## 3. Cron-fleet posture — *one knob (or nothing)*
Production is **safe by default** (leader-election ON; a loud boot-warning if the session URL is absent). Pick ONE:
- **(recommended)** Paste the Supabase **session/direct** Postgres URL value into your secret store under `DATABASE_SESSION_URL` — the ~28 in-process crons then run exactly once cluster-wide across replicas; **or**
- **(simplest)** Pin api-gateway to 1 replica: `services.apiGateway.autoscaling.enabled=false`, `replicaCount.apiGateway=1`.

*Done for you:* leader-election wired + reconciled across both Helm value files, the degrade-safe boot warning, the documented scale knob.

## 4. Rollback — *decide WHEN (the HOW is scripted)*
The only human call is the decision to roll back. See `Docs/ROLLBACK_RUNBOOK.md` for the decision tree across the three layers:
- **App/deploy** → blue/green re-point (cd-production).
- **Migration** → `node scripts/rollback-migration.mjs` (dry-run by default; reverses over the down-registry; refuses a `dataLoss` reversal unless you deliberately pass `--force`).
- **Data** → the weekly-drilled encrypted backup-restore.

*Done for you:* the scripted reversal, the dataLoss guard, the consolidated 3-layer runbook, the recent-migration down-file audit.

---

## 5. The cutover — *click it*
With 1–4 in place: promote the production deploy (CD is green and waiting). Watch the post-deploy health, then you're live.

> Everything above the "*Done for you*" lines is the entire human surface. If
> any of it could have been automated without entering a credential, creating
> an account, or making a judgment call, it would already be done.
