# BORJIE — Deployment Guide

Operational handbook for running BORJIE101 locally, in staging, and in production.

---

## 1. Local Development (docker-compose)

### Prerequisites

- Docker Desktop 4.26+ (or Colima on macOS) with Compose v2
- `pnpm` 8.15+ and Node.js 22
- `openssl` for generating secrets

### First-time setup

```bash
cp .env.example .env
cp docker-compose.override.yml.example docker-compose.override.yml
```

Populate at minimum:

- `JWT_SECRET` (32+ chars): `openssl rand -base64 48`
- `ANTHROPIC_API_KEY` (if you need AI surfaces)
- `OCR_PROVIDER=mock` (default is fine for local)
- `API_KEY_REGISTRY=` (empty is fine in dev; required in production)
- `TANZANIA_PAYMENT_BACKEND=clickpesa` (default PSP shortcut; `azampay`, `selcom`, and `gepg-direct` also supported)
- `NEXT_PUBLIC_TENANT_CURRENCY=TZS` / `NEXT_PUBLIC_TENANT_LOCALE=sw-TZ` / `NEXT_PUBLIC_TENANT_COUNTRY=TZ` for a Tanzania-first tenant (defaults are `USD` / `en`)

### Environment variable reference (wave-5 additions)

Beyond what `.env.example` already covers, wave-5 added the following
new variables. See `Docs/ENV.md` for the complete reference.

| Variable | Purpose | Default / required |
|----------|---------|--------------------|
| `API_KEY_REGISTRY` | Comma-separated `hash:tenantId:role:scopes:serviceName` entries. Replaces legacy `API_KEYS` (C-1 fix). | Required in production; empty in dev |
| `TANZANIA_PAYMENT_BACKEND` | Which GePG pathway to use: `clickpesa`, `azampay`, `selcom`, or `gepg-direct`. | `clickpesa` (recommended PSP shortcut) |
| `OCR_PROVIDER` | OCR backend: `textract`, `google`, or `mock`. | `mock` in dev |
| `NEXT_PUBLIC_TENANT_CURRENCY` | ISO 4217 code used for `Intl.NumberFormat` across customer/estate-manager apps. Replaces hardcoded `KES`. | `USD` |
| `NEXT_PUBLIC_TENANT_LOCALE` | BCP-47 locale used for `Intl.*` formatters. Replaces hardcoded `en-KE`. | `en` |
| `NEXT_PUBLIC_TENANT_COUNTRY` | ISO 3166-1 alpha-2 country code — drives telephony prefix and compliance export selection. | unset (must be provided per-tenant) |
| `NANO_BANANA_API_KEY` | Nano Banana image-generation provider (marketing imagery only, per RESEARCH_ANSWERS Q8). When unset the renderer returns a placeholder with `reason: 'NANO_BANANA_API_KEY unset'`. | Optional |
| `NANO_BANANA_API_URL` | Endpoint override. | Optional |
| `TYPST_BIN` | Absolute path to the `typst` CLI used by the PDF renderer. When unset the renderer tries `typst` on PATH; when absent entirely it falls back to a zero-dep PDF encoder so the code remains callable in CI. | Optional |
| `GEPG_PSP_MODE` | When `true`, GePG signature check is skipped (delegated to PSP). When `false`, both `GEPG_SIGNING_KEY_PEM` and `GEPG_SIGNING_CERT_PEM` must be set or the service refuses to boot (C-2 fix). | `true` in PSP mode |
| `GEPG_SIGNING_KEY_PEM` / `GEPG_SIGNING_CERT_PEM` | RSA key + cert for direct GePG signature verification. | Required when `GEPG_PSP_MODE=false` |
| `OUTBOX_INTERVAL_MS` / `OUTBOX_BATCH_SIZE` / `OUTBOX_WORKER_DISABLED` | Outbox drainer tuning. Ticks every `OUTBOX_INTERVAL_MS` ms (default 5000), drains up to `OUTBOX_BATCH_SIZE` events (default 50). | Defaults safe |
| `NOTIFICATIONS_SERVICE_URL` | Base URL for the notifications service; when unset, event subscribers log dispatches they would have sent instead of erroring. | Required in production |
| `INTERNAL_API_KEY` | `X-Internal-Key` header value for internal service-to-service calls. | Required in production |

### Bring the stack up

```bash
pnpm install
docker compose up --build
```

Services expose ports on localhost:

| Service               | Port  | Healthcheck              |
| --------------------- | ----- | ------------------------ |
| api-gateway           | 4000  | GET /health              |
| identity              | 4001  | GET /healthz             |
| reports               | 4002  | GET /healthz             |
| notifications         | 4003  | GET /healthz             |
| document-intelligence | 4004  | GET /healthz             |
| payments              | 4005  | GET /healthz             |
| payments-ledger       | 4006  | GET /healthz             |
| webhooks              | 4007  | GET /healthz             |
| domain-services       | 4008  | GET /healthz             |
| scheduler             | 4009  | GET /healthz             |
| Postgres (pgvector)   | 5432  | pg_isready               |
| Redis                 | 6379  | PING                     |
| Neo4j                 | 7687  | HTTP on :7474            |

### Database migrations

```bash
pnpm db:migrate
```

This runs all migrations in `packages/database/src/migrations/` in lexical order.
pgvector activation is a migration (`0001_enable_pgvector.sql`) — Postgres
must be on the `pgvector/pgvector:pg15` image or an RDS instance whose
parameter group has `vector` in `shared_preload_libraries`.

### Seeding a tenant org

```bash
pnpm db:seed --org=trc
```

The `--org` flag controls which tenant fixture loads. Supported fixtures
live in `packages/database/src/seeds/`.

---

## 2. Staging Deployment (GitHub Actions)

The `cd-staging.yml` workflow is the authoritative deploy path. Triggered on:

- `push` to `main` (auto-deploy)
- Manual `workflow_dispatch`

Flow:

1. `pr-check.yml` runs on every PR (lint, typecheck, unit tests).
2. On merge to `main`, `cd-staging.yml` builds each service image, pushes
   to ECR under the `staging` tag, and updates each ECS service via
   `aws ecs update-service --force-new-deployment`.
3. Terraform drift is caught by a weekly `infra/terraform plan` job (not
   yet wired — see tracking issue).

Rollback is done by re-deploying a prior image tag:

```bash
aws ecs update-service \
  --cluster borjie-staging \
  --service borjie-staging-api-gateway \
  --task-definition borjie-staging-api-gateway:<previous-revision>
```

---

## 3. Rotating Secrets

All runtime secrets live in AWS Secrets Manager under the prefix
`borjie/<env>/` (see `infra/terraform/secrets.tf`). To rotate a key:

```bash
aws secretsmanager put-secret-value \
  --secret-id borjie/staging/anthropic-api-key \
  --secret-string "sk-ant-..."

aws ecs update-service \
  --cluster borjie-staging \
  --service borjie-staging-api-gateway \
  --force-new-deployment
```

The task must restart to pick up the new secret — ECS reads Secrets Manager
values at task-launch time, not at runtime.

Rotation cadence:

- `gepg-signing-key` — quarterly (GePG policy)
- `jwt-secret` — annually or on incident
- `anthropic-api-key` — on key compromise only
- RDS master password — managed by RDS (`manage_master_user_password = true`)

---

## 4. Running Migrations in Staging / Production

Migrations run as a one-off ECS task before a deploy, not from developer
laptops. The `db-migrations-check.yml` workflow gates merges that touch
`packages/database/src/migrations/`.

```bash
aws ecs run-task \
  --cluster borjie-staging \
  --task-definition borjie-staging-db-migrate \
  --launch-type FARGATE \
  --network-configuration "<same as api-gateway>"
```

The task definition runs `pnpm db:migrate` against `$DATABASE_URL` from
Secrets Manager and exits 0 on success.

---

## 5. Adding a New Tenant Org

1. **Reserve the slug** — add a row to `tenants` via
   `POST /api/v1/tenants` (platform admin auth required).
2. **Seed baseline data** — run `pnpm db:seed --org=<slug>` against the
   target environment. The seeder is idempotent on primary keys.
3. **Provision DNS** — add a `CNAME` under the `*.borjie.io` zone
   pointing `<slug>.borjie.io` at the api-gateway ALB.
4. **Register notification senders** — every tenant needs its own
   `notifications_from_email` verified with Resend / Twilio. See
   `services/notifications/README.md` for the per-tenant override flow.
5. **Smoke test** — run the `e2e/tenant-onboarding.spec.ts` suite
   with `TENANT_SLUG=<slug>`.

---

## 6. Service Topology

```
                        ┌─────────────────┐
                        │   api-gateway   │
                        │   :4000 (BFF)   │
                        └────────┬────────┘
                                 │
          ┌──────────┬───────────┼───────────┬────────────┐
          ▼          ▼           ▼           ▼            ▼
     identity   notifications  reports   payments   domain-services
       :4001      :4003        :4002     :4005         :4008
                    │            │          │
                    │            │          ▼
                    │            │    payments-ledger
                    │            │         :4006
                    │            │
                    └────┬───────┘
                         ▼
                      scheduler
                       :4009
                  (node-cron workers)
```

Data stores:

- **Postgres (pgvector)** — operational DB, vector search for doc-chat
- **Redis** — BullMQ queues, idempotency keys, OTP store, rate limits
- **Neo4j** — knowledge graph (optional; falls back to demo mode)

---

## 7. Observability

- Structured JSON logs from every service → CloudWatch Logs per service
- `/healthz` returns `{status, version, upstreams, workers}` per service
- Scheduler `/healthz` includes per-worker `lastSuccessAt` and error counts
- CloudWatch alarms defined in `infra/terraform/alarms.tf` (follow-up wave)

---

## 8. Composition root degraded mode

The api-gateway constructs a single typed `ServiceRegistry` at boot
(`services/api-gateway/src/composition/service-registry.ts`). This
registry lazily instantiates the 10 Postgres-backed domain services
(marketplace, tenders, negotiations, waitlist, gamification, migration,
etc.). When required inputs are missing it **falls back to degraded
mode** instead of crashing.

### Boot-time signal

```
service-registry: live      → DATABASE_URL resolved, all LIVE services wired
service-registry: degraded  → DATABASE_URL unset, pure-DB endpoints will 503
```

### What degrades vs. what fails closed

| Missing env var | Behaviour | Why |
|-----------------|-----------|-----|
| `DATABASE_URL` | Registry returns skeleton of `null`s; pure-DB routers respond `503 Service Unavailable` with a clear reason. Auth, legacy routes, and external-creds routes still work. | Graceful — developers can run the gateway without booting Postgres. |
| `API_KEY_REGISTRY` **and** `API_KEYS` | In production (`NODE_ENV=production`) the gateway **refuses to boot** (`assertApiKeyConfig()`). | Prevents misconfigured deploys from silently accepting every request. |
| `ALLOWED_ORIGINS` | In production the gateway **refuses to boot**. | Wildcard CORS + cookie auth = CSRF risk. |
| `GEPG_PSP_MODE=false` without `GEPG_SIGNING_KEY_PEM`+`GEPG_SIGNING_CERT_PEM` | Payments service **refuses to boot**. | C-2 fix — no more stub signature verification. |
| `NOTIFICATIONS_SERVICE_URL` | Event subscribers log "`notification dispatch skipped`" and move on. | Graceful — keeps the outbox drainer healthy during partial outages. |
| `NANO_BANANA_API_KEY` | Imagery renderer emits a placeholder PNG with `reason: 'NANO_BANANA_API_KEY unset'` in metadata. | Graceful — caller's document pipeline never breaks. |
| `TYPST_BIN` | PDF renderer falls back to the zero-dep encoder (`react-pdf`). | Graceful — CI still renders valid PDFs. |
| `OCR_PROVIDER=mock` | `document-intelligence` processes with fixtures. | Graceful — safe for dev, NEVER in production. |

### Pilot-acceptable 503s

Some routers return 503 even when `DATABASE_URL` is set, because their
Postgres repos haven't landed yet. As of wave-5 these are:

- `/api/v1/occupancy-timeline/*` — awaiting `PostgresOccupancyTimelineRepository`
- `/api/v1/station-master-coverage/*` — awaiting `PostgresStationMasterCoverageRepository`

Everything else that is pure-DB (marketplace, waitlist, gamification,
migration, negotiations, tenders, risk reports, compliance exports,
arrears, applications, renewals, letters, doc-chat, document render,
scans) returns real data when `DATABASE_URL` is set.

See `Docs/analysis/DELTA_AND_ROADMAP.md` § "Production Readiness Matrix"
for the full per-feature matrix.

---

## 8. Production Deployment (canonical runbook)

After this section, launching borjie.com with real traffic is:
`docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`
plus a DNS flip. Every operational concern below is covered.

### 8.1 Bootstrap sequence

1. **Provision infrastructure**
   - Managed Postgres 15 (RDS/Cloud SQL) + pgvector extension
   - Managed Redis 7 (ElastiCache/MemoryStore)
   - Object storage bucket for docs (S3/GCS) — lifecycle: 365d retention
   - Kubernetes cluster (EKS/GKE) OR a VM running docker-compose
   - DNS zone: `borjie.com` (+ subdomains `api`, `admin`, `owners`, `manage`)

2. **Issue TLS certs**
   - `certbot certonly --dns-route53 -d borjie.com -d '*.borjie.com'`
   - Mount fullchain.pem + privkey.pem under `${TLS_CERT_DIR}/borjie.com/`

3. **Populate `.env.production`** from `Docs/ENV.md` + section 8.2 below

4. **Apply migrations + seed platform defaults**
   ```bash
   pnpm --filter @borjie/database migrate:deploy
   pnpm --filter @borjie/database seed:platform
   ```

5. **(Optional) Seed demo org**
   ```bash
   pnpm --filter @borjie/database seed:demo
   ```

6. **Boot gateway + apps**
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
   ```

7. **Flip DNS** A records for the 4 subdomains to the load-balancer IP

8. **Smoke-test** with `pnpm e2e:prod` (runs critical-flow specs against https://...)

### 8.2 Environment variables — REQUIRED vs OPTIONAL

| Var | Required | Service(s) | How to obtain | Cost indicator |
|---|---|---|---|---|
| `POSTGRES_PASSWORD` | REQUIRED | all | `openssl rand -base64 32` | - |
| `REDIS_PASSWORD` | REQUIRED | all | `openssl rand -base64 32` | - |
| `NEO4J_PASSWORD` | REQUIRED | gateway | `openssl rand -base64 32` | - |
| `JWT_SECRET` | REQUIRED | gateway | `openssl rand -base64 48` | - |
| `ANTHROPIC_API_KEY` | REQUIRED | gateway (chat, workflows) | console.anthropic.com | ~$15 / 1M input tokens (Sonnet 4.5); 1 turn ≈ 1.5K in + 500 out → ~$0.028/turn. Budget for 10K turns/day = ~$280/day |
| `OPENAI_API_KEY` | OPTIONAL | voice-in (Whisper transcription) | platform.openai.com | $0.006/min (Whisper); budget $18 per 50 hours of voice input/day |
| `ELEVENLABS_API_KEY` | OPTIONAL | voice-out (TTS) | elevenlabs.io | $0.18/1K chars (Turbo v2.5); 1 response ≈ 300 chars → $0.054/response. Budget for 3K voice responses/day = ~$162/day |
| `SENTRY_DSN` | OPTIONAL but strongly recommended | all | sentry.io | Free tier: 5K events/mo; Team $26/mo |
| `POSTHOG_API_KEY` | OPTIONAL | all | posthog.com (self-host free) | Free up to 1M events/mo; self-host: infra only |
| `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` | OPTIONAL | notifications | twilio.com | SMS TZ ~$0.06, KE ~$0.048, UG ~$0.070, NG ~$0.033, SA ~$0.058 per SMS |
| `GEPG_CLIENT_ID` + `GEPG_CLIENT_SECRET` | OPTIONAL (TZ only) | payments | Ministry of Finance TZ | ~0.5% of transaction value |
| `CLICKPESA_API_KEY` | OPTIONAL (TZ) | payments | clickpesa.com | ~1.5% + TZS 200/txn |
| `MPESA_CONSUMER_KEY` + `MPESA_CONSUMER_SECRET` | OPTIONAL (KE) | payments | daraja.safaricom.co.ke | 1.5% per M-Pesa txn |
| `FLUTTERWAVE_SECRET_KEY` | OPTIONAL (multi-country) | payments | flutterwave.com | 1.4% + NGN 50/txn |
| `SMTP_HOST` + `SMTP_USER` + `SMTP_PASS` | REQUIRED for email | notifications | SendGrid/Mailgun | SendGrid: 100 emails/day free, $19.95/mo for 50K |
| `WHATSAPP_BUSINESS_TOKEN` | OPTIONAL | notifications | business.facebook.com | $0.005–$0.08 per session depending on country |

Realistic **10-tenant / 5K units / ~1M events-per-day** monthly cost (USD):
- Anthropic: ~$8,400 (30K chat turns + 5K workflow turns daily)
- Voice (Whisper + ElevenLabs): ~$5,400
- Infra (k8s 3×m5.large + RDS + ElastiCache): ~$1,100
- SMS (country-dependent, assume TZ 50K/mo): ~$3,000
- Sentry + PostHog + monitoring: ~$200
- **Total: ~$18,100/mo** at this scale

### 8.3 Observability (wired in Wave 13)

- **Sentry** — set `SENTRY_DSN`. Client auto-initialised in api-gateway + all 4 apps. PII scrubbed via `packages/ai-copilot/src/security/pii-scrubber.ts` before events leave the process.
- **PostHog** — set `POSTHOG_API_KEY`. Canonical events: `chat.turn`, `chat.proposed_action_approved`, `workflow.completed`, `training.assigned`, `training.completed`, `mwikila.intervention_accepted`, `demo.played`.
- **Grafana dashboards** — JSON under `monitoring/grafana-dashboards/`, import via `grafana-cli admin import`.
- **Prometheus scrape target** — `/api/v1/metrics` (admin-auth). Enable ServiceMonitor via `helm upgrade --set monitoring.serviceMonitor.enabled=true`.
- **Log aggregation** — fluent-bit stub in `monitoring/fluent-bit/`. Set `FLUENT_BIT_OUTPUT=loki|cloudwatch|elastic` in `.env.production`.

### 8.4 Pilot client go-live checklist (template — no specific tenant)

- [ ] Tenant slug provisioned in admin portal (`POST /api/v1/tenants`)
- [ ] Tenant's country + currency + timezone set on tenant record
- [ ] Tenant admin user created + MFA enrolled
- [ ] Properties + units imported (CSV via `/api/v1/migration/import-csv`)
- [ ] Existing leases migrated (+ historical payments for arrears accuracy)
- [ ] Payment provider creds configured (GePG/M-Pesa/Flutterwave)
- [ ] SMS sender ID registered with MNO (TZ: TCRA, KE: CA)
- [ ] Training path auto-generated for tenant's team (`POST /api/v1/training/generate`)
- [ ] Mr. Mwikila persona smoke-tested (5 chat turns + 1 workflow)
- [ ] Backup schedule: Postgres pg_basebackup daily → S3 (7d RPO) + WAL archiving
- [ ] Rollback runbook reviewed (`Docs/RUNBOOK.md`)
- [ ] Production operations runbook reviewed (`Docs/OPERATIONS.md`) — incident response, known issues, capacity planning, data-deletion SLAs
- [ ] On-call rotation published
- [ ] Go-live announcement queued

### 8.5 Real-LLM E2E smoke tests

Opt-in by setting `E2E_REAL_LLM=true` before `pnpm e2e`. Required env for each spec:
- brain-turn-real, marketing-consultant, training-generate, sandbox-flow, arrears-explain, workflow-real, mwikila-intervention-real, prospect-onboard-real: `ANTHROPIC_API_KEY`
- voice-loop: also `ELEVENLABS_API_KEY` + `OPENAI_API_KEY`

CI defaults to skipping these (no keys); local + staging pipelines opt in.

## 9. Environment validation (boot-time)

The gateway now validates `process.env` on startup via
`services/api-gateway/src/config/validate-env.ts`. If any required variable is
missing or malformed, the gateway logs a structured `fatal` entry and exits
with code 1 **before** accepting any requests.

### Required (boot fails without these)

| Variable | Validation | Example |
|---|---|---|
| `DATABASE_URL` | must start with `postgres://` or `postgresql://`, min 10 chars | `postgres://app:pw@db:5432/bn` |
| `JWT_SECRET` | min 32 chars (64+ recommended in production) | output of `openssl rand -base64 48` |

### Defaults (no warning)

| Variable | Default |
|---|---|
| `NODE_ENV` | `development` |
| `PORT` | `4000` |
| `LOG_LEVEL` | `info` |
| `JWT_ISSUER` | `borjie` |
| `JWT_AUDIENCE` | `borjie-client` |
| `APP_VERSION` | `dev` |

### Optional — validated if set

Auth: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (min 32 chars each).
CORS: `ALLOWED_ORIGINS` (comma-separated list).
Transport: `REDIS_URL` (URL), `RATE_LIMIT_MAX_REQUESTS`, `RATE_LIMIT_WINDOW_MS`.
Workers: `OUTBOX_WORKER_DISABLED` (`true`/`false`), `OUTBOX_INTERVAL_MS`,
`OUTBOX_BATCH_SIZE`, `BORJIE_BG_TASKS_ENABLED`.
Observability: `SENTRY_DSN` (URL), `SENTRY_ENVIRONMENT`,
`SENTRY_TRACES_SAMPLE_RATE` (0..1), `POSTHOG_API_KEY`, `POSTHOG_HOST` (URL),
`GIT_SHA`.
AI: `ANTHROPIC_API_KEY` (must start with `sk-ant-`),
`OPENAI_API_KEY` (must start with `sk-`), `ELEVENLABS_API_KEY`,
`ELEVENLABS_DEFAULT_VOICE_ID`.
OCR: `OCR_PROVIDER` in {aws_textract, google_vision, tesseract, none},
`GOOGLE_APPLICATION_CREDENTIALS`, `AWS_TEXTRACT_REGION`.
Payments (TZ): `GEPG_ENV` in {sandbox, production}, `GEPG_BASE_URL`,
`GEPG_CALLBACK_BASE_URL`, `GEPG_HMAC_SECRET`, `GEPG_HEALTH_URL`, `GEPG_PKCS`,
`GEPG_PSP_MODE` in {client_cert, hmac}, `GEPG_PUBLIC_CERT_PEM`, `GEPG_SP`,
`GEPG_SP_SYS_ID`.
SMS: `AFRICASTALKING_WEBHOOK_SECRET`, `META_APP_SECRET`, `TWILIO_AUTH_TOKEN`.
Internal: `API_KEYS`, `API_KEY_REGISTRY`, `INTERNAL_API_KEY`,
`AGENT_CERT_SIGNING_SECRET`, `WEBHOOK_DEFAULT_HMAC_SECRET`.
Inter-service: `API_URL`, `NOTIFICATIONS_SERVICE_URL`, `TENANT_SERVICE_URL`.
Tenant defaults: `DEFAULT_TENANT_CITY`, `DEFAULT_TENANT_COUNTRY`,
`DEFAULT_TENANT_CURRENCY` (3-letter), `DEV_DEFAULT_COUNTRY_CODE` (2-letter).
Health: `DEEP_HEALTH_CACHE_MS`. Testing: `USE_MOCK_DATA` (`true`/`false`).

### Production-only warnings (logged, not fatal)

When `NODE_ENV=production`, the validator emits a warning for each of these
when not set: `SENTRY_DSN`, `REDIS_URL`, `ALLOWED_ORIGINS`, `APP_VERSION`,
`GIT_SHA`. It also warns if `JWT_SECRET` is under 64 characters in production.

### Development-mode nudge

If `NODE_ENV=development` and `DATABASE_URL` does not reference `localhost`,
the validator warns — a guard against accidentally pointing dev at a shared
Postgres.

### How to bypass at test time

Set `NODE_ENV=test` (the gateway skips env validation so vitest fixtures
don't need to fulfil every production var).

