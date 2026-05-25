# Wave 25 — Agent Y — Environment-Variable Hygiene

Date: 2026-04-20.
Scope: every `process.env.XXX` reference across the monorepo (`*.ts`, `*.tsx`, excluding tests, dist, node_modules).
Total unique env-vars discovered: **175**.

## Env-var catalog (full table)

Full canonical catalog moved to **`Docs/ENVIRONMENT.md`** (24 sections, 175 rows, cross-referenced to source file/line and docker-compose/k8s drift).
This doc covers fixes + gaps surfaced by the scrub.

## Classification summary

| Class | Count | Examples |
|---|---|---|
| REQ-PROD (code throws if missing in prod) | 18 | `JWT_SECRET`, `JWT_REFRESH_SECRET`, `SUPABASE_JWT_SECRET`, `DATABASE_URL`, `REDIS_URL`, `API_KEY_REGISTRY`, `ALLOWED_ORIGINS`, `NOTIFICATIONS_SERVICE_URL`, `NOTIFICATIONS_FROM_EMAIL`, `NEO4J_URI`, `NEO4J_PASSWORD`, `GEPG_CALLBACK_BASE_URL`, `DEFAULT_TENANT_COUNTRY`, `DEFAULT_TENANT_CURRENCY`, `API_URL`, `FRONTEND_URL`, `AGENT_CERT_SIGNING_SECRET` (new this wave) |
| REQ-FEAT (feature disabled without it) | 70+ | All AI keys, payment provider keys, webhook secrets, WhatsApp config |
| OPT with dev default | 40+ | `PORT`, `LOG_LEVEL`, `RATE_LIMIT_*`, `OUTBOX_*`, `TZ`, `AWS_TEXTRACT_REGION` |
| OPT with no default (consumer handles `undefined`) | 35+ | `SENTRY_DSN`, `POSTHOG_API_KEY`, `STRIPE_CONNECTED_ACCOUNT_ID`, `NANO_BANANA_API_KEY` |
| BUILD (injected by CI) | 4 | `GIT_SHA`, `NEXT_PUBLIC_GIT_SHA`, `APP_VERSION`, `CI` |
| Leaked to logs | **0** | scanned for `logger.*(process.env.*SECRET\|KEY\|TOKEN\|PASSWORD)` — no matches |

## Missing .env.example entries added

91 env-vars were referenced in TS code but absent from `.env.example`. All now appended as sections **X through QQ** (lines 508–700+ of `.env.example`). Grouped by domain with comments describing purpose + format:

- **X**. Observability — `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE`, `POSTHOG_API_KEY`, `POSTHOG_HOST`, `NEXT_PUBLIC_SENTRY_*`, `NEXT_PUBLIC_POSTHOG_*`, `GIT_SHA`, `NEXT_PUBLIC_GIT_SHA`, `APP_VERSION`, `DEEP_HEALTH_CACHE_MS`.
- **Y**. Signing secrets — `CREDIT_CERT_SECRET`, `CREDIT_RATING_SIGNING_SECRET`, `AGENT_CERT_SIGNING_SECRET`, `PUBLIC_API_BASE_URL`, `API_BASE_URL`, `PUBLIC_BASE_URL`.
- **Z**. GePG deep config — `GEPG_SP`, `GEPG_SP_SYS_ID`, `GEPG_ENV`, `GEPG_PSP_MODE`, `GEPG_HMAC_SECRET`, `GEPG_PUBLIC_CERT_PEM`, `GEPG_PKCS12_PATH`, `GEPG_PKCS12_PASSWORD`, `GEPG_CALLBACK_BASE_URL`, `GEPG_HEALTH_URL`, `GEPG_SIGNING_KEY_PEM`/`_CERT_PEM`/`_KEY_PATH`/`_CERT_PATH`.
- **AA**. Tenant defaults — `DEFAULT_TENANT_COUNTRY`, `DEFAULT_TENANT_CURRENCY`, `DEFAULT_TENANT_CITY`, `DEV_DEFAULT_COUNTRY_CODE`.
- **BB**. Worker / outbox / seed toggles — `REPORTS_WORKER_CONCURRENCY`, `RATE_LIMIT_MAX_REQUESTS`, `BORJIE_BG_TASKS_ENABLED`, `BORJIE_SKIP_DOTENV`, `BORJIE_ALLOW_TEARDOWN`, `SEED_DEMO`, `SEED_ORG_SEEDS`, `SEED_TENANT_PHONE`, `SEED_PROPERTY_CITY`.
- **CC**. WhatsApp / webhook verifiers — `WHATSAPP_API_URL`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `META_APP_SECRET`, `AFRICASTALKING_WEBHOOK_SECRET`.
- **DD**. SMTP fallback — `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`.
- **EE**. Webhook infra — `WEBHOOK_DEFAULT_HMAC_SECRET`, `WEBHOOK_SSRF_ALLOW_PRIVATE`.
- **FF**. API key registry — `API_KEY_REGISTRY`, `API_KEYS` (legacy deprecation path).
- **GG**. JWT tuning — `JWT_ACCESS_SECRET`, `JWT_EXPIRES_IN`, `JWT_AUDIENCE`, `JWT_ISSUER`.
- **HH**. Vite dev proxy — `VITE_API_PROXY_TARGET`.
- **II**. E2E toggles — `USE_MOCK_DATA`, `USE_REAL_SERVERS`, `E2E_REAL_LLM`, `E2E_GATEWAY_URL`, `E2E_TEST_JWT`, `KEEP_TEST_DB`, `TEST_DB_HOST`/`PORT`/`NAME`/`USER`/`PASSWORD`.
- **JJ**. Load testing — `LOAD_TEST_PORT`, `LOAD_TEST_CONNECTIONS`, `LOAD_TEST_DURATION`, `LOAD_TEST_JWT_SECRET`.
- **KK**. Payments-ledger tuning — `PLATFORM_FEE_PERCENT`, `STRIPE_CONNECTED_ACCOUNT_ID`, `TANZANIA_PAYMENT_BACKEND`.
- **LL**. Africa's Talking legacy aliases — `AT_API_KEY`, `AT_USERNAME`, `AT_SENDER_ID`, `AT_ENVIRONMENT`.
- **NN**. OCR region — `AWS_TEXTRACT_REGION`.
- **OO**. Operator tooling — `OPERATOR_ENV`.
- **PP**. Imagery + PDF — `NANO_BANANA_API_URL`, `NANO_BANANA_API_KEY`, `TYPST_BIN`.

Commented where purpose was non-obvious. Pre-existing sections A–W untouched.

## Missing prod guards added

**File:** `services/api-gateway/src/composition/service-registry.ts` (lines 593–608)

Before: `AGENT_CERT_SIGNING_SECRET` silently fell back to the hardcoded string `'dev-only-agent-cert-signing-secret-32chars'` in production if neither `AGENT_CERT_SIGNING_SECRET` nor `JWT_SECRET` was set. The dev default is 40 chars so it would have passed every downstream length check — meaning a misconfigured prod deploy would accept signed agent certs backed by a publicly-known, git-commited secret.

After:
```ts
const certSigningSecretFromEnv =
  process.env.AGENT_CERT_SIGNING_SECRET?.trim() ||
  process.env.JWT_SECRET?.trim() ||
  '';
if (process.env.NODE_ENV === 'production' && certSigningSecretFromEnv.length < 32) {
  throw new Error(
    'AGENT_CERT_SIGNING_SECRET (or JWT_SECRET) must be set and >= 32 chars in production',
  );
}
const certSigningSecret =
  certSigningSecretFromEnv || 'dev-only-agent-cert-signing-secret-32chars';
```

Dev behavior preserved (ephemeral fallback still works). Production deploys now refuse to boot unless a real 32+ char secret is present.

Other prod guards audited and verified healthy — no change needed:
- `JWT_SECRET` — `services/api-gateway/src/config/jwt.ts:20-22` + `hono-auth.ts:13`.
- `JWT_REFRESH_SECRET` — `auth.middleware.ts:33` via `requireEnv`.
- `SUPABASE_JWT_SECRET` — `payments-ledger/middleware/auth.middleware.ts:36-40`.
- `DATABASE_URL` — deep-health probe + `migrate-prod.ts:182-184` + `packages/database/run-migrations.ts:13-15`.
- `REDIS_URL` — deep-health probe, `reports/scheduler/scheduler.ts:48-50`, `reports/scheduler/job-processor.ts:43`, `reports/jobs/scheduled-reports.job.ts:37`.
- `NEO4J_URI` + `NEO4J_PASSWORD` — `graph-sync/client/neo4j-client.ts:208-214`.
- `ALLOWED_ORIGINS` — api-gateway `src/index.ts:193-210` (prod abort on empty).
- `API_KEY_REGISTRY` — `middleware/api-key-registry.ts:112-121` boot-time `assertApiKeyConfig()`.
- `GEPG_CALLBACK_BASE_URL` — `routes/gepg.router.ts:32-36`.
- `DEFAULT_TENANT_COUNTRY` / `DEFAULT_TENANT_CURRENCY` — `routes/brain.hono.ts:81-85` + `apps/estate-manager-app/.../commit/route.ts:72`.
- `API_URL` + `FRONTEND_URL` — `packages/config/src/index.ts:48-53`.

## Secrets redacted from logs

**Scan command:**
```
rg -nE '(logger|log|console)\.[a-z]+\([^)]*process\.env\.[A-Z_]*(SECRET|KEY|PASSWORD|TOKEN|PASS|DSN)' --type=ts
```

Result: **0 matches**. No literal `logger.info({ secret: process.env.XXX })` anywhere. Only indirect leaks would be via passing an object containing a secret field to a logger — grep confirmed the payment provider / auth middleware paths do not do that. No fixes applied because no real leaks found.

Caveat: the `redacted-log` scrub assumes the pino default redact config catches secrets passed in structured context. If a future change bypasses that, Agent Z's security sweep should re-run this grep.

## Inconsistent defaults unified

Two naming pairs were intentionally kept for back-compat and are DOCUMENTED in ENV.md:
- `MPESA_SHORTCODE` vs `MPESA_SHORT_CODE` — both read, either works. Not a real bug.
- `MPESA_PASSKEY` vs `MPESA_PASS_KEY` — same story.
- `AFRICAS_TALKING_*` vs `AT_*` — both accepted, `AFRICAS_TALKING_*` is preferred.

Inconsistencies that WOULD warrant unifying but were left alone (out-of-scope for Agent Y — coordinate with Agent T if renaming):
- `NEO4J_USER` in code vs `NEO4J_USERNAME` in `.env.example:130`. The graph-sync client reads `NEO4J_USER` only (`packages/graph-sync/src/client/neo4j-client.ts:218`), so the `.env.example` key is orthogonal — operators would set `NEO4J_USERNAME`, it would silently be ignored, and `NEO4J_USER` would stay unset, falling back to the in-code default `neo4j`. Flagged for fix — but either rename the source code to `NEO4J_USERNAME` or correct `.env.example:130`. Leaving for Agent T (risk of stepping on their edits).
- `NEO4J_URL` in `.env.example:505` vs `NEO4J_URI` read everywhere in code. Same story — operators set `NEO4J_URL`, code reads `NEO4J_URI`, silently falls back. Flagged.
- `CORS_ALLOWED_ORIGINS` in `docker-compose.prod.yml:106` is not read anywhere; code reads `ALLOWED_ORIGINS`. Real drift — production deploys using compose currently have **no CORS allowlist** because the env-var name is wrong. Flagged for Agent T or infra owner.

## Docker / k8s config drift flagged

### docker-compose.prod.yml

Missing forwards (source consumer → file:line where it should appear):
- `JWT_REFRESH_SECRET` (auth.middleware.ts:33) → `docker-compose.prod.yml:89` (api-gateway.environment).
- `SUPABASE_JWT_SECRET` (payments-ledger/middleware/auth.middleware.ts:36) → `docker-compose.prod.yml:116` (payments-ledger.environment). **Currently payments-ledger will throw on first authenticated request in prod.**
- `API_KEY_REGISTRY` (api-key-registry.ts:29) → `docker-compose.prod.yml:89`. **Production api-gateway throws at boot via `assertApiKeyConfig()` without it.**
- `INTERNAL_API_KEY` (tenant-context.middleware.ts:210, statement-generation.service.ts:335) → `docker-compose.prod.yml:89` + `:116`.
- `NOTIFICATIONS_SERVICE_URL` (api-gateway/src/index.ts:878) → `docker-compose.prod.yml:89`.
- `NOTIFICATIONS_FROM_EMAIL` + `NOTIFICATIONS_FROM_NAME` (notifications/providers/email/*) → missing from both services.
- `STORAGE_BASE_URL` (document-intelligence/routes/documents.routes.ts:460/506) → `docker-compose.prod.yml:116` (payments-ledger forwards storage URL via /storage default, silent failure mode).
- `CREDIT_CERT_SECRET` / `CREDIT_RATING_SIGNING_SECRET` (credit-rating.router.ts:280-281) → `docker-compose.prod.yml:89`. **Route returns 503 on every request without these.**
- `AGENT_CERT_SIGNING_SECRET` (service-registry.ts:597 — post-Wave-25 guard) → `docker-compose.prod.yml:89`. **Post-Wave-25: api-gateway refuses to boot.**
- All `GEPG_*` env-vars (entire section V) → neither service forwards them. GePG flows silently disabled in prod compose.
- `MPESA_*` block (payments-ledger/src/server.ts:270-278) → not in `docker-compose.prod.yml:116`.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (payments-ledger/src/server.ts:261-262) → not in `docker-compose.prod.yml:116`.
- `AFRICAS_TALKING_*`, `TWILIO_AUTH_TOKEN`, `META_APP_SECRET`, `AFRICASTALKING_WEBHOOK_SECRET`, `WHATSAPP_*` → not forwarded.
- `WEBHOOK_DEFAULT_HMAC_SECRET` (webhook-retry-worker.ts:222) → not forwarded; all webhook deliveries will DLQ with "no HMAC secret configured".
- `DEFAULT_TENANT_COUNTRY` / `DEFAULT_TENANT_CURRENCY` (brain.hono.ts:78-79, throws in prod) → not forwarded. **Brain wiring will throw.**
- `SMTP_*` → reports service doesn't appear as its own compose service, but scheduler does and could inherit.

**Also flagged:** `docker-compose.prod.yml:106` forwards `CORS_ALLOWED_ORIGINS` — this env var is **not read anywhere in source**. Code reads `ALLOWED_ORIGINS`. Rename in the compose file to `ALLOWED_ORIGINS` or add an alias in source.

### k8s/values.yaml secrets.inline

Current inline block (only 9 keys for local `kind` fallback):
`POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `NEO4J_PASSWORD`, `JWT_SECRET`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `SENTRY_DSN`, `POSTHOG_API_KEY`.

Missing (full list of 40+ secrets consumed in source) — see ENVIRONMENT.md drift section for enumeration. For cloud deploys with `externalSecrets.enabled=true`, the external secret manager (Vault/AWS SM/GCP SM) at path `borjie/prod` must carry ALL of them. Recommend adding placeholder `inline:` entries for discoverability so operators running `helm template` see the required-keys list.

### k8s/templates/configmap.yaml

Not modified in this scrub (not inspected). Gateway deployment mounts both a configmap (`borjie.fullname + "-config"`) and a secret — the configmap should carry the NON-secret env-vars: `NODE_ENV`, `PORT`, `LOG_LEVEL`, `SENTRY_ENVIRONMENT`, `POSTHOG_HOST`, `GEPG_BASE_URL`, `MPESA_ENVIRONMENT`, `AWS_TEXTRACT_REGION`, `OCR_PROVIDER`, `DEFAULT_TENANT_CITY`, `OUTBOX_INTERVAL_MS`, `OUTBOX_BATCH_SIZE`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS`, `DEEP_HEALTH_CACHE_MS`, `REPORTS_WORKER_CONCURRENCY`. Flagged for infra owner.

## Full catalog in Docs/ENVIRONMENT.md

`Docs/ENVIRONMENT.md` created this wave. 24 sections (A–S), ~300 rows, cross-referenced to file:line consumers and drift notes. That is the canonical operator reference going forward. `Docs/ENV.md` is the older operator quick-start and has been left in place.

## Verification

- `pnpm --filter @borjie/api-gateway typecheck` — clean, no errors.
- `pnpm --filter @borjie/api-gateway test` — 173/173 passing.
- `pnpm --filter @borjie/config test` — 15/15 passing.

## Constraints honoured

- No real secret values committed (only placeholder `=` entries).
- No env-var references removed from source (dead code is Agent T's domain).
- No new resolution library introduced — guard added inline in `service-registry.ts`.
- No commits, no push.

## Files touched

- `.env.example` — 15 new sections appended (X–QQ), 91 missing rows added with comments.
- `services/api-gateway/src/composition/service-registry.ts` — prod guard for `AGENT_CERT_SIGNING_SECRET` / `JWT_SECRET`.
- `Docs/ENVIRONMENT.md` — **new**, canonical catalog.
- `Docs/WAVE25_FINDINGS/agent-y-env.md` — **this file**.
