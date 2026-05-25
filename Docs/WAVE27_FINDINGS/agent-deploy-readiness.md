# Wave 27 — Agent DEPLOY — Deployment Readiness Certification

Date: 2026-04-20
Scope: pre-flight audit of every operational surface so a fresh k8s cluster
or docker-compose stack can boot BORJIE clean and pass readiness probes.
This is NOT feature work — it is a gap audit + one load-bearing fix.

## Summary verdict

Boot-path is **~90% ready**. The monorepo has comprehensive pre-existing
infrastructure: Dockerfiles (x5 variants), two docker-compose files, a
Helm chart + Kustomize overlays, CI workflows (x12), runbook docs,
backup scripts, load-test + smoke-test scripts, Prometheus middleware,
Grafana dashboards, and a deep-health cascade with upstream probes.

**One critical bug was fixed in this audit**: the Helm chart and k8s
overlays probe `/readyz` but the gateway only served `/healthz`. On a
fresh cluster, pods would never transition to Ready — the readiness
probe would 404 for every attempt. Fixed by adding a proper `/readyz`
handler wired to `isShuttingDown` + `serviceRegistry.isLive`
(`services/api-gateway/src/index.ts:324-368`).

Remaining blockers are documentation-gap or out-of-scope (Redis-backed
rate limit, per-service Dockerfiles for library packages, migration-job
k8s manifest). Listed ranked at the end.

---

## 16-item checklist — done / gap

### 1. Dockerfiles — **DONE (with documented architectural choice)**

No per-service Dockerfile; instead 5 shared multi-stage Dockerfiles live
in `docker/`. Each is multi-stage, uses `node:22-alpine`, non-root user
(`service`/`apigateway` uid 1001), pnpm `--frozen-lockfile`,
`HEALTHCHECK` instruction.

- `docker/Dockerfile.api` — api-gateway, port 4000, `/healthz` probe
  (`docker/Dockerfile.api:82-84`)
- `docker/Dockerfile.service` — generic service builder (currently
  payments-ledger), port 3000, parameterized by `SERVICE_NAME` +
  `PACKAGE_NAME` + `ENTRY_PATH`
  (`docker/Dockerfile.service:5-9`)
- `docker/Dockerfile.scheduler` — reports/cron worker
- `docker/Dockerfile.web` — Next.js (customer-app, estate-manager) and
  Vite (owner-portal, admin-portal) via `target:` selector
- `docker/Dockerfile.api.dev` + `docker/Dockerfile.web.dev` — dev
  variants

**Documented architectural choice** (`docker-compose.yml:98-117` +
`docker/Dockerfile.service:11-17`): `services/identity`,
`services/notifications`, `services/payments`,
`services/document-intelligence`, `services/webhooks`,
`services/domain-services`, `services/reports` are pure libraries — they
export modules and do not boot an HTTP server. Only api-gateway,
payments-ledger, and scheduler have real entrypoints. The
`infrastructure/k8s/services/notifications-deployment.yaml` references a
`borjie/notifications:latest` image that cannot be built today —
this is a drift (listed as blocker C below).

`.dockerignore` present at repo root and excludes `node_modules`, tests,
`.env*`, coverage, playwright reports.

### 2. docker-compose.prod.yml — **DONE**

File is 243 lines; real images pinned (postgres 15-alpine, redis
7-alpine, neo4j 5-community via override, nginx 1.27-alpine, fluent-bit
3.1). Secrets are required via `?` syntax — e.g.
`${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}` at
`docker-compose.prod.yml:27`. Every service has `deploy.resources.limits`
+ `reservations`. Redis healthcheck uses auth; nginx depends_on waits
for every app `service_healthy`. Fluent-bit log shipper wired with
pluggable `FLUENT_BIT_OUTPUT` (stdout/loki/cloudwatch/elastic).

Wave 25 Agent Y confirmed all 20+ previously-missing env vars are now
declared in `environment:` blocks. Dev `docker-compose.yml` uses
pgvector image (`docker-compose.yml:10`) for embedding tables.

### 3. k8s manifests / Helm chart — **DONE (two parallel systems)**

Two k8s systems coexist:
- `k8s/` — Helm chart (`Chart.yaml` + `values.yaml` + `templates/*`)
  with Deployment, Service, Ingress, ConfigMap, Secret, HPA,
  ServiceMonitor. Gateway has liveness on `/healthz` and readiness on
  `/readyz` (`k8s/values.yaml:33-45`). HPA enabled min 3 max 20 @ 70%
  CPU (`k8s/values.yaml:46-51`).
- `infrastructure/k8s/` — Kustomize-based with `base/` + `overlays/
  staging` + `overlays/production`. Services directory includes
  deployments for api-gateway, notifications, payments, reports. Apps
  directory has 4 frontend apps. HPA patches in
  `overlays/production/hpa-production.yaml`.

Secrets externalized via `envFromSecret: borjie-secrets`
(`k8s/values.yaml:55`) and `secretKeyRef` in individual deployments.
`infrastructure/k8s/base/secrets.yaml` + `configmap.yaml` exist.
`infrastructure/terraform/modules` contains the managed-cloud
counterpart (RDS, Redis, Secrets Manager).

**Resource requests/limits sane.** Gateway: 500m/2000m CPU, 512Mi/2Gi
RAM. Apps: 100m/1000m CPU, 256Mi/1Gi RAM. Postgres: 500m/2000m,
1Gi/4Gi.

### 4. Migrations on boot — **GAP (documented)**

`packages/database/src/run-migrations.ts` runs every `*.sql` in
lexical order, skips already-applied via `drizzle.__drizzle_migrations`,
rejects unsafe filenames
(`packages/database/src/run-migrations.ts:22,29-39`). Idempotent.
**But** the module is a CLI — it auto-invokes `runMigrations()` at
import time and calls `process.exit(0)` in the finally block
(`packages/database/src/run-migrations.ts:87`). It cannot be called
as a boot hook from api-gateway without refactoring.

Prod deploys run it via `scripts/migrate-prod.sh` /
`scripts/migrate-prod.ts` which is explicit — `Docs/RUNBOOK.md` covers
the workflow. `AUTO_MIGRATE_ON_BOOT` env flag does **not** exist.

**Verdict:** acceptable (explicit prod migrations are safer) but add a
Kubernetes Job manifest (see blocker D) so the same runner fires
pre-deploy.

### 5. Readiness + liveness endpoints — **FIXED IN THIS AUDIT**

Before: `/healthz` + `/health` served (`services/api-gateway/src/index.
ts:290-291`); `/api/v1/health/deep` admin-only cached upstream cascade
(`services/api-gateway/src/index.ts:426`); `/readyz` referenced in
`k8s/values.yaml:41`, `infrastructure/k8s/**/*`, and
`Docs/ENVIRONMENT.md:17` but **not implemented** — would 404 on every
probe.

After: added readiness handler at
`services/api-gateway/src/index.ts:324-368`, mounted at `/readyz`.
Returns 503 when `isShuttingDown === true` (drain phase) or
`serviceRegistry.isLive === false` (DB unreachable / DATABASE_URL
unset). 200 when both conditions hold. Placed AFTER `serviceRegistry`
construction so the handler closes over a fully-initialized binding.
Typecheck clean (`pnpm -F @borjie/api-gateway tsc --noEmit` passes).

### 6. Graceful shutdown — **DONE**

`services/api-gateway/src/index.ts:815-887` implements the standard
six-step drain: flip `isShuttingDown`, 10s force-kill timer, stop
outbox + heartbeat + background + intelligence-history + cases-SLA
supervisors, `server.close()` drain, close Postgres pool, `exit 0`. Both
`SIGTERM` and `SIGINT` bound
(`services/api-gateway/src/index.ts:1080-1081`). The new `/readyz`
handler immediately returns 503 once `isShuttingDown` is true, so load
balancers mark the replica NotReady on the first poll after SIGTERM.

### 7. Logging — **DONE**

Every service uses pino + pinoHttp.
- api-gateway: `services/api-gateway/src/index.ts:173` —
  `pino({ level: process.env.LOG_LEVEL || 'info' })`
- payments-ledger: `services/payments-ledger/src/server.ts:7,169`
- reports: pino wired (confirmed via grep)
- identity, domain-services: pass logger down from caller

No `console.log` in production paths. Grep found 11 matches across 4
files; all are CLI tools (`load-test.ts`, `openapi/export-cli.ts`,
`utils/logger.ts`) or doc comments (`identity/.../otp-service.ts:78`
is literally a comment saying "console.log is banned by project
policy"). Wave 25 Agent Y verified this project-wide.

`LOG_LEVEL` env documented in `Docs/ENVIRONMENT.md:16` — default `info`.

### 8. Metrics — **DONE**

`services/api-gateway/src/observability/metrics-registry.ts` + Hono
`/metrics` router at `services/api-gateway/src/routes/metrics.router.ts`
expose Prometheus scrape endpoint. Middleware
(`services/api-gateway/src/observability/metrics-middleware.ts`) wired
globally via `api.use('*', createMetricsMiddleware())` at
`services/api-gateway/src/index.ts:433`.

Grafana dashboards checked in at `infra/grafana/dashboards/`:
`overview.json`, `payments.json`, `ai.json`. Prometheus alert rules at
`infra/alerts/auth.yaml`, `payments.yaml`, `sla.yaml`.

Custom metrics surfaced per the Wave 12 work: HTTP requests by
route+status, AI cost by tenant, event-bus publish/subscribe, task-agent
runs. (Confirmed via file presence — not individually enumerated.)

### 9. Backups — **DONE**

`scripts/backup.sh` performs encrypted pg_dump + optional Redis
snapshot, AES-256-CBC via `BACKUP_ENCRYPTION_KEY`, uploads to
`s3://$BACKUP_BUCKET`, documented retention (30d daily + monthly
archive, `scripts/backup.sh:3-4`). `scripts/restore.sh` paired.

**Gap:** no `Docs/RUNBOOKS/backup-restore.md` — but backup procedure is
covered in `Docs/OPERATIONS.md` + `Docs/RUNBOOK.md` (both grep-hit for
"backup|restore"). Acceptable; could be extracted into a dedicated
runbook (blocker E).

### 10. Secrets + env-var discipline — **DONE**

`.env.example` = 709 lines with 24 sections (A–QQ). `Docs/ENVIRONMENT.
md` = 313 lines, canonical catalog of 175 env-vars with REQ-PROD /
REQ-FEAT / OPT / BUILD classification. Wave 25 Agent Y verified every
code reference exists in both files.

Prod guards throw on missing required secrets:
- `JWT_SECRET` — `validateEnv()` at `services/api-gateway/src/config/
  validate-env.ts` (called at
  `services/api-gateway/src/index.ts:181-193`)
- `ALLOWED_ORIGINS` — throws at
  `services/api-gateway/src/index.ts:213-217`
- `AGENT_CERT_SIGNING_SECRET` — Wave 25 Agent Y fix at
  `services/api-gateway/src/composition/service-registry.ts:593-608`
  (removes silent fallback to hardcoded dev secret)
- `API_KEY_REGISTRY` — `assertApiKeyConfig()` at
  `services/api-gateway/src/index.ts:295`
- `DATABASE_URL` — migration runner throws
  (`packages/database/src/run-migrations.ts:14-18`)
- Postgres/Redis/Neo4j passwords — compose `?required` syntax

### 11. CI — **DONE**

`.github/workflows/` has 12 files. Key:
- `ci.yml` — lint, typecheck, test, build, e2e (matrix)
- `ci-monorepo.yml` — parallel monorepo install + typecheck + test +
  build + lint
- `strict-ci.yml` — tighter gates
- `codeql.yml` — security scan
- `security-scan.yml` — dep audit
- `db-migrations-check.yml` — migration drift detection (= dry-run
  gate)
- `openapi-drift.yml` — OpenAPI spec drift
- `cd-production.yml` / `cd-staging.yml` / `deploy-production.yml` /
  `deploy-staging.yml` — CD pipelines with blue/green + rollback
- `release.yml` — tag + release publish
- `pr-check.yml` — PR title/body checks

Test DB spun up via service container in `ci.yml` (per workflow
convention — not individually verified).

### 12. Rollback safety — **DONE**

- `cd-production.yml:28-32` has explicit `rollback` workflow_dispatch
  input
- Migrations are forward-only but the runner is idempotent (applied
  migrations skipped) and the `_migrations` table records provenance
- Feature flags service exists (`services/api-gateway/src/routes/
  feature-flags.router.ts`, `featureFlagsRouter`) — available for
  per-tenant AI capability kills without redeploy

### 13. Rate limiting + abuse — **PARTIAL GAP**

`services/api-gateway/src/middleware/rate-limit.middleware.ts:1-4`
comment explicitly says: "Simple in-memory rate limiter … For
production with multiple instances, replace with Redis-backed limiter."

Globally mounted at `services/api-gateway/src/index.ts:258`
(`app.use(rateLimitMiddleware())`). Limits tuned via
`RATE_LIMIT_WINDOW_MS` (default 60000) and `RATE_LIMIT_MAX_REQUESTS`
(default 100).

**Gap:** with 3+ replicas, the counter is per-pod → effective limit is
Nx the configured value. Also no per-tenant bucketing on hot endpoints
(POST /ai/chat, /documents/upload, /ai/voice). Not a booting blocker
but is a **production** abuse vector (blocker A below).

No `Docs/RATE_LIMITS.md`; policy is implicit in the middleware.

### 14. Ops playbook — **DONE (consolidated doc instead of per-topic)**

`Docs/RUNBOOK.md` (389 lines) covers: local migrations, demo seed,
health endpoint inspection, incident triage steps. `Docs/OPERATIONS.md`
(257 lines) covers: deployments, backups, tenant onboarding flow, prod
migrations. `Docs/DEPLOYMENT.md` covers the full local→staging→prod
pipeline.

**Gap:** checklist called for `Docs/RUNBOOKS/incident-response.md`,
`tenant-onboarding.md`, `migration-production.md` as separate files.
They don't exist — content is folded into the two consolidated docs.
Acceptable for a small team, but extraction into topic-specific runbooks
would improve discoverability (blocker E below).

### 15. Load test baseline — **DONE**

`scripts/load-test-suite.mjs` — 10-scenario autocannon suite with named
P95 budgets, mints real JWTs via `JWT_SECRET`, writes JSON + HTML
reports to `./load-test-reports/`. Usage:
`GATEWAY_URL=http://127.0.0.1:4001 CONNECTIONS=20 DURATION=20 node
scripts/load-test-suite.mjs`. Exits non-zero on budget breach.

Baseline targets encoded in the scenarios (not enumerated here — live
in the script's scenario table).

Paired shell runner: `scripts/load-test-suite.sh`.
Legacy TS runner at `services/api-gateway/scripts/load-test.ts`.

### 16. Smoke test — **DONE**

`scripts/smoke-test.sh` (90 lines) waits up to 30s for `/health`,
asserts `/api/v1` returns a version payload, counts migrations against
`_migrations` / `drizzle.__drizzle_migrations`, confirms demo tenant
`tenant-001` is active, probes marketing page, runs
`scripts/uat-walkthrough.sh`. Exit 0 on pass, 1 on any fail.

---

## Dockerfile matrix — service × status

| Service / App        | Dockerfile                       | HTTP port | Healthcheck path     | Built-by-CI | Status  |
|---------------------|----------------------------------|-----------|----------------------|-------------|---------|
| api-gateway         | `docker/Dockerfile.api`          | 4000      | `/healthz`           | yes         | ready   |
| payments-ledger     | `docker/Dockerfile.service`      | 3000      | `/healthz`           | yes         | ready   |
| scheduler (cron)    | `docker/Dockerfile.scheduler`    | 8080      | `/healthz`           | yes         | ready   |
| customer-app        | `docker/Dockerfile.web` (nextjs) | 3000      | `/api/health`        | yes         | ready   |
| estate-manager      | `docker/Dockerfile.web` (nextjs) | 3000      | `/api/health`        | yes         | ready   |
| owner-portal        | `docker/Dockerfile.web` (vite)   | 80        | `/health`            | yes         | ready   |
| admin-portal        | `docker/Dockerfile.web` (vite)   | 80        | `/health`            | yes         | ready   |
| identity            | (library)                        | n/a       | n/a                  | n/a         | by-design pure library |
| notifications       | (library)                        | n/a       | n/a                  | n/a         | **drift** vs k8s manifest |
| payments            | (library)                        | n/a       | n/a                  | n/a         | by-design pure library |
| document-intel      | (library)                        | n/a       | n/a                  | n/a         | by-design pure library |
| webhooks            | (library)                        | n/a       | n/a                  | n/a         | by-design pure library |
| domain-services     | (library)                        | n/a       | n/a                  | n/a         | by-design pure library |
| reports (lib)       | (library, scheduler uses it)     | n/a       | n/a                  | n/a         | by-design pure library |

---

## Runbooks index

| Topic                     | Location                                   |
|---------------------------|--------------------------------------------|
| Deployment (local→prod)   | `Docs/DEPLOYMENT.md`                       |
| Operations (daily)        | `Docs/OPERATIONS.md`                       |
| Incident triage           | `Docs/RUNBOOK.md`                          |
| Operational SLA / KPIs    | `Docs/OPERATIONAL_SLA.md` + `Docs/KPIS_AND_SLOS.md` |
| Risk register             | `Docs/RISK_REGISTER.md`                    |
| Enterprise hardening      | `Docs/ENTERPRISE_HARDENING.md`             |
| Security posture          | `Docs/SECURITY.md`                         |
| Production readiness      | `Docs/PRODUCTION_READINESS.md`             |
| Environment variable ref  | `Docs/ENVIRONMENT.md` (175 vars, 24 sections) |
| Performance               | `Docs/PERFORMANCE.md`                      |
| Backup + restore          | `scripts/backup.sh` + `scripts/restore.sh` (procedure embedded in `OPERATIONS.md`) |

---

## CI workflow summary

| Workflow file                    | Trigger                     | Purpose                                       |
|----------------------------------|-----------------------------|-----------------------------------------------|
| `ci.yml`                         | push/PR main+develop        | matrix lint/typecheck/test/build/e2e          |
| `ci-monorepo.yml`                | push/PR main                | parallel monorepo scan (fast)                 |
| `strict-ci.yml`                  | push main                   | zero-tolerance gates                          |
| `codeql.yml`                     | schedule + push             | CodeQL static analysis                        |
| `security-scan.yml`              | push + schedule             | dep audit (trivy / npm audit)                 |
| `db-migrations-check.yml`        | PR touching migrations      | migration dry-run gate                        |
| `openapi-drift.yml`              | PR                          | OpenAPI spec vs live gateway drift            |
| `pr-check.yml`                   | PR                          | title/body/labels                             |
| `cd-staging.yml`                 | push develop                | staging CD                                    |
| `cd-production.yml`              | push main + release         | prod CD with rollback flag                    |
| `deploy-staging.yml`             | manual                      | manual staging deploy                         |
| `deploy-production.yml`          | release published           | prod deploy from release tag                  |
| `release.yml`                    | tag push                    | create release + artifacts                    |
| `dependabot.yml` (config)        | —                           | dep updates                                   |

---

## Smoke + load test baselines

- **Smoke:** `scripts/smoke-test.sh` — 6 checks, <60s total on a warm
  stack. `GATEWAY_URL` defaults to `http://127.0.0.1:4001`.
- **Load:** `scripts/load-test-suite.mjs` — 10 scenarios, defaults
  `CONNECTIONS=10 DURATION=20s/scenario`. Budgets encoded per-scenario.
  Reports written to `./load-test-reports/`.
- Baseline targets documented in-script; operator runs
  `node scripts/load-test-suite.mjs` against a locally-booted stack to
  regenerate on demand.

---

## Remaining blockers for 100% deployment readiness (ranked)

### A. HIGH — Redis-backed rate limiter for multi-replica deployments
`services/api-gateway/src/middleware/rate-limit.middleware.ts:13` uses a
process-local `Map`. With HPA scaling to 3–20 replicas
(`k8s/values.yaml:48-49`), the effective rate limit becomes
`maxRequests × replicas` — a 100 req/min cap becomes 2000 req/min at
peak. Additionally, no per-tenant bucketing on
POST `/ai/chat`, `/documents/upload`, `/ai/voice`. Swap in an ioredis
token-bucket implementation keyed on `tenantId + route`. Redis is
already a dependency.

### B. HIGH — `infrastructure/k8s/services/notifications-deployment.yaml` references an unbuildable image
The file mounts `borjie/notifications:latest` on port 3000 with a
`/health` probe. `services/notifications` has no Dockerfile and no HTTP
server — it's consumed in-process by api-gateway per
`docker-compose.yml:98-117`. Either: (a) build a thin HTTP wrapper for
notifications so the deployment is valid, or (b) delete the manifest.
Same applies latently to `payments-deployment.yaml` + `reports-
deployment.yaml` in the same directory — audit which are buildable.

### C. MEDIUM — Migration as a Kubernetes Job, not a boot hook
`AUTO_MIGRATE_ON_BOOT` is not wired. Prod uses `scripts/migrate-prod.
sh` before the rolling update (explicit, safer). Add a k8s `Job`
manifest at `k8s/templates/migration-job.yaml` or
`infrastructure/k8s/base/migration-job.yaml` that runs the migration
runner in a single pod and completes before the Deployment rolls out
(use `helm pre-upgrade` hook or Argo sync-wave). Document in
`Docs/OPERATIONS.md`.

### D. MEDIUM — Extract topic-specific runbooks
Content exists in `Docs/RUNBOOK.md` + `Docs/OPERATIONS.md` but the
checklist called for topic-split files:
- `Docs/RUNBOOKS/incident-response.md` (pager-duty trigger, first-15-min
  action matrix)
- `Docs/RUNBOOKS/tenant-onboarding.md` (country plugin, compliance
  plugin, per-tenant FF setup)
- `Docs/RUNBOOKS/migration-production.md` (safe prod migration cadence)
- `Docs/RUNBOOKS/backup-restore.md` (pg_dump cadence + restore drill)

Nice-to-have — not a booting blocker.

### E. LOW — `Docs/RATE_LIMITS.md` policy doc
Policy is implicit in middleware config. A single-page matrix of
route-class → limit → enforcement-layer would help on-call operators
reason about 429s quickly.

### F. LOW — Refactor `run-migrations.ts` to be importable + CLI-dual-mode
Currently auto-invokes + `process.exit(0)` at module top level — cannot
be imported as a function. Refactor into `export async function
runMigrations()` + a `if (import.meta.url === ...) runMigrations()`
guard so it can be called from a future boot-time migration hook
(`AUTO_MIGRATE_ON_BOOT=true` in dev). Not needed for prod k8s path.

### G. LOW — Migration-job image + runtime in deployment pipeline
Related to C: the k8s Job needs an image that contains
`packages/database/src/run-migrations.ts` compiled. Either build a
dedicated migration image or piggyback on api-gateway image with an
alternate `CMD`.

---

## Fix made in this audit

**File:** `services/api-gateway/src/index.ts:324-368`
**Change:** added `/readyz` handler registered AFTER `serviceRegistry`
construction. Returns 503 during drain phase (SIGTERM) or when the
registry is in degraded mode (no Postgres); 200 otherwise. Typecheck
clean. Unblocks k8s readiness probe — without this fix, pods on a fresh
cluster would never transition to `Ready` because the readiness probe
path (configured in `k8s/values.yaml:41` + every overlay) would always
404.

No other source code touched. No commits. No pushes.
