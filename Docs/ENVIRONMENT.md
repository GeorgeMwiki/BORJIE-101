# BORJIE Environment Variable Catalog

Canonical reference for every `process.env.XXX` read by the monorepo. Maintained by Wave 25 Agent Y. When adding a new env-var reference in TS code, also add a row here and an entry in `.env.example`.

Status legend: **REQ-PROD** = app refuses to boot without it in production. **REQ-FEAT** = a specific feature is disabled without it. **OPT** = graceful default. **BUILD** = set by CI / build pipeline, not operator.

Last scrubbed: 2026-05-21.

## A. Core infrastructure

| Name | Status | Default | Consumed by | Notes |
|---|---|---|---|---|
| `NODE_ENV` | REQ-PROD | `development` | everywhere | `production` flips prod guards + Sentry + pino transport |
| `PORT` | OPT | service-specific (4000/3000/8080) | api-gateway, payments-ledger, scheduler, reports | |
| `TZ` | OPT | `UTC` | `services/reports/src/scheduler/scheduler-runner.ts` | affects cron schedule timezone |
| `LOG_LEVEL` | OPT | `info` | api-gateway, payments-ledger, document-intelligence, payments, reports | pino log level |
| `APP_VERSION` | OPT | `dev` | api-gateway `/healthz`, `/readyz`, `/openapi.json`; observability package | |
| `GIT_SHA` | BUILD | — | Sentry release tag (api-gateway) | set by CI |
| `NEXT_PUBLIC_GIT_SHA` | BUILD | — | Next.js apps Sentry release tag | |
| `DEEP_HEALTH_CACHE_MS` | OPT | `15000` | api-gateway `/readyz` | |
| `BORJIE_SKIP_DOTENV` | OPT | unset | api-gateway bootstrap | `true` skips dotenv (container-injected env) |
| `BORJIE_BG_TASKS_ENABLED` | OPT | unset | api-gateway background-wiring | `false` disables outbox + workers |
| `OUTBOX_WORKER_DISABLED` | OPT | unset | api-gateway | `true` disables in-process drainer |
| `OUTBOX_INTERVAL_MS` | OPT | `5000` | api-gateway | |
| `OUTBOX_BATCH_SIZE` | OPT | `50` | api-gateway | |

## B. Database + cache

| Name | Status | Default | Consumed by | Notes |
|---|---|---|---|---|
| `DATABASE_URL` | REQ-PROD | dev: `postgresql://localhost:5432/borjie` | api-gateway, payments-ledger, scripts/*, packages/database | prod: no fallback; migrate-prod.ts throws |
| `REDIS_URL` | REQ-PROD | dev: `redis://localhost:6379` | api-gateway, notifications, reports, identity (OTP), scheduler | prod: scheduler throws without it |
| `REDIS_HOST` | OPT | `localhost` | reports | only if `REDIS_URL` unparsed |
| `REDIS_PORT` | OPT | `6379` | reports | |
| `REDIS_PASSWORD` | OPT | — | reports | |
| `NEO4J_URI` | REQ-FEAT | `bolt://localhost:7687` | graph-sync, api-gateway brain router | prod: throws if Brain is wired and uri missing |
| `NEO4J_USER` | REQ-FEAT | `neo4j` | graph-sync | |
| `NEO4J_PASSWORD` | REQ-FEAT | — | graph-sync | prod: throws if Brain is wired |
| `NEO4J_DATABASE` | OPT | `neo4j` | graph-sync | |

## C. Auth + JWT

| Name | Status | Default | Consumed by | Notes |
|---|---|---|---|---|
| `JWT_SECRET` | REQ-PROD | dev: ephemeral 48-byte random | api-gateway auth middleware, mcp wiring, service-registry, hono-auth, test helpers | prod: throws via `getJwtSecret()` and `hono-auth.ts`; min 32 chars |
| `JWT_ACCESS_SECRET` | OPT | — | authz-policy, auth.middleware | RS256 private key alt to JWT_SECRET |
| `JWT_REFRESH_SECRET` | REQ-PROD | — | authz-policy, auth.middleware | prod: throws via `requireEnv('JWT_REFRESH_SECRET')` |
| `JWT_EXPIRES_IN` | OPT | schema-default | `@borjie/config` | |
| `JWT_AUDIENCE` | OPT | `borjie-api` | auth middleware | |
| `JWT_ISSUER` | OPT | `borjie` | auth middleware | |
| `NEXT_PUBLIC_SUPABASE_URL` | REQ-PROD | — | customer-app, estate-manager-app, owner-portal, admin-portal Supabase client | browser-safe project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | REQ-PROD | — | all Next.js apps Supabase client | browser-safe anon key; RLS-gated |
| `SUPABASE_SERVICE_ROLE_KEY` | REQ-PROD | — | api-gateway admin operations, services/identity, scripts/seed | **SERVER ONLY** — bypasses RLS; never expose to client |
| `SUPABASE_JWT_SECRET` | REQ-PROD | — | api-gateway `brain.hono.ts`, `ai-chat.router.ts`; customer-app `/api/brain/turn`; estate-manager-app brain-server; payments-ledger `auth-middleware` | throws on first request if missing or < 10 chars |
| `CLERK_SECRET_KEY` | REMOVED | — | — | Clerk removed in favor of Supabase Auth — ADR-0004 |
| `INTERNAL_API_KEY` | REQ-FEAT | dev-cli fallback in openapi cli | api-gateway (notifications dispatch, tenant-context fetch), payments-ledger statement dispatch | no guard — empty string silently passes as empty header |
| `API_KEY_REGISTRY` | REQ-PROD | — | api-key-registry middleware | prod: `assertApiKeyConfig()` throws if neither this nor legacy is set |
| `API_KEYS` | DEPRECATED | — | api-key-registry middleware | legacy exact-match; emits CRITICAL warning in prod |
| `ALLOWED_ORIGINS` | REQ-PROD | dev: `http://localhost:3000` | api-gateway CORS | prod: empty triggers abort |

## D. Observability

| Name | Status | Default | Consumed by | Notes |
|---|---|---|---|---|
| `SENTRY_DSN` | REQ-FEAT | — | api-gateway | Sentry disabled if unset |
| `SENTRY_ENVIRONMENT` | OPT | `NODE_ENV` | api-gateway | |
| `SENTRY_TRACES_SAMPLE_RATE` | OPT | `0.1` | api-gateway | |
| `POSTHOG_API_KEY` | REQ-FEAT | — | api-gateway | analytics disabled if unset |
| `POSTHOG_HOST` | OPT | `https://eu.posthog.com` | api-gateway | |
| `NEXT_PUBLIC_SENTRY_DSN` | REQ-FEAT | — | customer-app, estate-manager-app | browser Sentry |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | OPT | `production` | Next.js apps | |
| `NEXT_PUBLIC_POSTHOG_KEY` | REQ-FEAT | — | Next.js apps | |
| `NEXT_PUBLIC_POSTHOG_HOST` | OPT | — | Next.js apps | |

## E. AI providers

| Name | Status | Default | Consumed by | Notes |
|---|---|---|---|---|
| `AI_PROVIDER` | OPT | `anthropic` | config package | routing preference |
| `ANTHROPIC_API_KEY` | REQ-FEAT | — | ai-copilot (many), ai-mediator, router, health probe | no key = mediator returns generic response |
| `OPENAI_API_KEY` | REQ-FEAT | — | ai-copilot (many), router, voice, health probe | |
| `DEEPSEEK_API_KEY` | OPT | — | router | cost-optimized fallback |
| `ELEVENLABS_API_KEY` | REQ-FEAT | — | service-registry voice router, health probe, e2e | no key = no ElevenLabs provider |
| `ELEVENLABS_DEFAULT_VOICE_ID` | OPT | `rachel` | service-registry | |
| `NANO_BANANA_API_KEY` | REQ-FEAT | — | nano-banana imagery renderer | no key = falls back to default renderer |
| `NANO_BANANA_API_URL` | OPT | renderer default | imagery renderer | |
| `TYPST_BIN` | OPT | `typst` | typst-renderer | PDF compile binary path |

## F. Payments — Stripe

| Name | Status | Default | Consumed by | Notes |
|---|---|---|---|---|
| `STRIPE_SECRET_KEY` | REQ-FEAT | — | payments-ledger server | no key = Stripe provider not registered |
| `STRIPE_WEBHOOK_SECRET` | REQ-FEAT | `''` | payments-ledger | webhook sig verification fails without it |
| `STRIPE_CONNECTED_ACCOUNT_ID` | OPT | undefined | payments-ledger tenant aggregate | Connect flows |
| `PLATFORM_FEE_PERCENT` | OPT | `5.0` | payments-ledger | |
| `FLUTTERWAVE_SECRET_KEY` | OPT | — | `@borjie/config` | |

## G. Payments — M-Pesa + Tanzania

| Name | Status | Default | Consumed by | Notes |
|---|---|---|---|---|
| `MPESA_CONSUMER_KEY` | REQ-FEAT | — | payments-ledger, payments/stk-push | gates provider registration |
| `MPESA_CONSUMER_SECRET` | REQ-FEAT | `''` | payments-ledger | |
| `MPESA_SHORT_CODE` / `MPESA_SHORTCODE` | REQ-FEAT | `''` | payments-ledger, payments | either naming supported |
| `MPESA_PASS_KEY` / `MPESA_PASSKEY` | REQ-FEAT | `''` | payments-ledger, payments | either naming supported |
| `MPESA_ENVIRONMENT` | OPT | `sandbox` | payments-ledger, payments | `sandbox \| production` |
| `MPESA_CALLBACK_URL` | REQ-FEAT | `''` | payments-ledger, payments | public-facing callback |
| `MPESA_ALLOWED_IPS` | OPT | Safaricom 14-IP list | mpesa-webhook.middleware | comma-separated |
| `MPESA_DISABLE_IP_ALLOWLIST` | OPT | unset | mpesa-webhook.middleware | `true` = bypass in dev only |
| `MPESA_INITIATOR_PASSWORD` | REQ-FEAT | — | payments-ledger B2C provider, payments/mpesa/b2c | plaintext; RSA-encrypted per request |
| `MPESA_SANDBOX_CERT` | REQ-FEAT | — | payments/mpesa/security-credential | PEM inline |
| `MPESA_PRODUCTION_CERT` | REQ-FEAT | — | payments/mpesa/security-credential | PEM inline |
| `MPESA_CERT_PATH` | OPT | — | payments-ledger + payments | path alt to PEM inline |
| `TANZANIA_PAYMENT_BACKEND` | OPT | factory-selected | payments/tanzania-payment-factory | |

## H. Payments — GePG

| Name | Status | Default | Consumed by | Notes |
|---|---|---|---|---|
| `GEPG_BASE_URL` | OPT | `https://sandbox.gepg.tz` | gepg.router | |
| `GEPG_ENV` | OPT | `sandbox` | gepg.router | |
| `GEPG_PSP_MODE` | OPT | `true` | gepg.router | `false` switches to direct RSA-gepg mode |
| `GEPG_SP` | OPT | `SANDBOX_SP` | gepg.router | |
| `GEPG_SP_SYS_ID` | OPT | `SANDBOX_SYSID` | gepg.router | |
| `GEPG_PKCS12_PATH` | REQ-FEAT (direct mode) | — | gepg.router | |
| `GEPG_PKCS12_PASSWORD` | REQ-FEAT (direct mode) | — | gepg.router | |
| `GEPG_HMAC_SECRET` | REQ-FEAT (PSP mode) | — | gepg.router | callback HMAC verification |
| `GEPG_PUBLIC_CERT_PEM` | REQ-FEAT (direct mode) | — | gepg.router | RSA-SHA256 sig verify |
| `GEPG_CALLBACK_BASE_URL` | REQ-PROD | dev: `http://localhost:3000` | gepg.router | `loadConfig()` throws in prod if missing |
| `GEPG_HEALTH_URL` | OPT | — | api-gateway readiness | |
| `GEPG_SIGNING_KEY_PEM` | REQ-FEAT | — | payments/gepg/key-loader | alt to `*_PATH` |
| `GEPG_SIGNING_CERT_PEM` | REQ-FEAT | — | payments/gepg/key-loader | |
| `GEPG_SIGNING_KEY_PATH` | REQ-FEAT | — | payments/gepg/key-loader | |
| `GEPG_SIGNING_CERT_PATH` | REQ-FEAT | — | payments/gepg/key-loader | |

## I. Notifications

| Name | Status | Default | Consumed by | Notes |
|---|---|---|---|---|
| `NOTIFICATIONS_SERVICE_URL` | REQ-PROD | unset | api-gateway, statement-generation | prod: subscribers log-and-no-op without it |
| `NOTIFICATIONS_FROM_EMAIL` | REQ-PROD | — | email providers (SES, SMTP, SendGrid) | refuse to send without owned-domain from |
| `NOTIFICATIONS_FROM_NAME` | OPT | `BORJIE` | email providers | |
| `RESEND_FROM_EMAIL` | OPT | — | SES fallback provider | |
| `SMTP_HOST` | REQ-FEAT | `localhost` | reports email delivery | |
| `SMTP_PORT` | OPT | `587` | reports | |
| `SMTP_SECURE` | OPT | `false` | reports | |
| `SMTP_USER` | OPT | — | reports | enables auth block |
| `SMTP_PASS` | OPT | — | reports | |
| `AFRICAS_TALKING_API_KEY` / `AT_API_KEY` | REQ-FEAT | — | notifications SMS | |
| `AFRICAS_TALKING_USERNAME` / `AT_USERNAME` | OPT | `sandbox` | notifications SMS | |
| `AFRICAS_TALKING_SENDER_ID` / `AT_SENDER_ID` | OPT | — | notifications SMS | |
| `AFRICAS_TALKING_ENVIRONMENT` / `AT_ENVIRONMENT` | OPT | `sandbox` | notifications SMS | |
| `AFRICASTALKING_WEBHOOK_SECRET` | REQ-FEAT | — | notification-webhooks.router | HMAC verify delivery reports |
| `TWILIO_AUTH_TOKEN` | REQ-FEAT | — | notification-webhooks.router (Twilio sig verify) | |
| `META_APP_SECRET` | REQ-FEAT | — | notification-webhooks.router (WhatsApp sig verify) | |
| `SENDGRID_API_KEY` | OPT | — | `@borjie/config` | |
| `WHATSAPP_API_URL` | OPT | `https://graph.facebook.com/v18.0` | notifications/whatsapp | |
| `WHATSAPP_ACCESS_TOKEN` | REQ-FEAT | `''` | notifications/whatsapp | |
| `WHATSAPP_PHONE_NUMBER_ID` | REQ-FEAT | `''` | notifications/whatsapp | |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | OPT | — | notifications/whatsapp | |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | REQ-FEAT | — | notifications/whatsapp | handshake token |

## J. Webhook infrastructure

| Name | Status | Default | Consumed by | Notes |
|---|---|---|---|---|
| `WEBHOOK_DEFAULT_HMAC_SECRET` | REQ-FEAT | — | webhook-retry-worker | per-attempt fallback; otherwise DLQ with "no HMAC secret configured" |
| `WEBHOOK_SSRF_ALLOW_PRIVATE` | OPT | unset | services/webhooks/src/delivery.ts | `true` = allow private IPs (dev only) |

## K. Signing + certificate secrets

| Name | Status | Default | Consumed by | Notes |
|---|---|---|---|---|
| `CREDIT_CERT_SECRET` | REQ-FEAT | — | credit-rating.router | first-preference signing secret |
| `CREDIT_RATING_SIGNING_SECRET` | REQ-FEAT | — | credit-rating.router | second-preference; route returns 503 if neither set |
| `AGENT_CERT_SIGNING_SECRET` | REQ-PROD | dev fallback `'dev-only-agent-cert-signing-secret-32chars'` | service-registry agent certification | **Wave 25**: production now throws if neither this nor JWT_SECRET is >= 32 chars |

## L. URLs + public-facing

| Name | Status | Default | Consumed by | Notes |
|---|---|---|---|---|
| `API_URL` | REQ-PROD | dev: `http://localhost:4000` | config package, customer-app | |
| `FRONTEND_URL` | REQ-PROD | dev: `http://localhost:3000` | config package | |
| `NEXT_PUBLIC_API_URL` | REQ-FEAT | — | customer-app, estate-manager-app | |
| `API_BASE_URL` | OPT | `https://api.borjie.com` | credit-rating router | verification URL baked into PDF certs |
| `PUBLIC_API_BASE_URL` | OPT | fallback to `API_BASE_URL` | credit-rating router | |
| `PUBLIC_BASE_URL` | OPT | dev: `http://localhost:3000` | mcp.router agent-card | |
| `STORAGE_BASE_URL` | REQ-FEAT | `/storage` | document-intelligence routes | used in evidence-pack URLs |
| `TENANT_SERVICE_URL` | OPT | `API_URL` fallback | api-gateway tenant-context | |
| `BASE_URL` | OPT (e2e) | `http://localhost:3003` | playwright.config | |
| `CUSTOMER_APP_URL` | OPT (e2e) | `http://localhost:3002` | playwright, fixtures | |
| `OWNER_PORTAL_URL` | OPT (e2e) | `http://localhost:3000` | playwright, fixtures | |
| `ADMIN_PORTAL_URL` | OPT (e2e) | `http://localhost:3001` | playwright, fixtures | |
| `ESTATE_MANAGER_URL` | OPT (e2e) | `http://localhost:3003` | playwright, fixtures | |

## M. Storage + cloud

| Name | Status | Default | Consumed by | Notes |
|---|---|---|---|---|
| `AWS_ACCESS_KEY_ID` | REQ-FEAT | — | textract provider, config | |
| `AWS_SECRET_ACCESS_KEY` | REQ-FEAT | — | textract provider, config | |
| `AWS_S3_BUCKET` | OPT | — | `@borjie/config` | |
| `AWS_TEXTRACT_REGION` | OPT | `eu-west-1` | scans.router, textract | |
| `GOOGLE_APPLICATION_CREDENTIALS` | REQ-FEAT | — | scans.router (when `OCR_PROVIDER=google`) | path to service-account JSON |
| `OCR_PROVIDER` | OPT | `mock` | scans.router, document-intelligence | `textract \| google \| mock` |
| `FIREBASE_PROJECT_ID` | OPT | — | `@borjie/config` | |

## N. Tenant defaults + seeds

| Name | Status | Default | Consumed by | Notes |
|---|---|---|---|---|
| `DEFAULT_TENANT_COUNTRY` | REQ-PROD (if bootstrap used) | — | brain.hono, estate-manager migrate | throws in prod when missing |
| `DEFAULT_TENANT_CURRENCY` | REQ-PROD (if bootstrap used) | — | brain.hono | same guard |
| `DEFAULT_TENANT_CITY` | OPT | undefined | brain.hono | |
| `DEV_DEFAULT_COUNTRY_CODE` | OPT | — | tenant-context middleware | dev-only fallback for country |
| `SEED_DEMO` | OPT | unset | packages/database/seed | `true` runs demo seed |
| `SEED_ORG_SEEDS` | OPT | unset | packages/database/run-seed | `true` includes org-specific seeds |
| `SEED_TENANT_PHONE` | OPT | — | seed | |
| `SEED_PROPERTY_CITY` | OPT | `Nairobi` | seed | |
| `BORJIE_ALLOW_TEARDOWN` | OPT | unset | scripts/teardown-tenant | `true` required to allow destructive teardown |

## O. Rate limiting

| Name | Status | Default | Consumed by | Notes |
|---|---|---|---|---|
| `RATE_LIMIT_WINDOW_MS` | OPT | `60000` | rate-limit.middleware | |
| `RATE_LIMIT_MAX_REQUESTS` | OPT | `100` | rate-limit.middleware | |

## P. Reports worker tuning

| Name | Status | Default | Consumed by | Notes |
|---|---|---|---|---|
| `REPORTS_WORKER_CONCURRENCY` | OPT | `4` | reports jobs | |

## Q. Test + dev toggles

| Name | Status | Default | Consumed by | Notes |
|---|---|---|---|---|
| `USE_MOCK_DATA` | OPT | false | database middleware | `true` = fixture responses |
| `USE_REAL_SERVERS` | OPT (e2e) | unset | playwright.config | `true` skips webServer auto-start |
| `E2E_REAL_LLM` | OPT (e2e) | unset | e2e/tests/real-llm | `true` runs real-LLM suite |
| `E2E_GATEWAY_URL` | OPT (e2e) | `http://localhost:4000` | e2e/tests/real-llm | |
| `E2E_TEST_JWT` | OPT (e2e) | — | e2e/tests/real-llm | pre-minted JWT |
| `KEEP_TEST_DB` | OPT | unset | integration global-setup | `1` = keep DB |
| `TEST_DB_HOST` | OPT | `localhost` | integration helpers | |
| `TEST_DB_PORT` | OPT | `5432` | integration helpers | |
| `TEST_DB_NAME` | OPT | `borjie_test` | integration helpers | |
| `TEST_DB_USER` | OPT | `$USER` → `postgres` | integration helpers | |
| `TEST_DB_PASSWORD` | OPT | `''` | integration helpers | |
| `USER` | OPT | OS-provided | integration helpers | DB username fallback |
| `VITE_API_PROXY_TARGET` | OPT | `http://localhost:4000` | owner-portal, admin-portal vite.config | |
| `CI` | OPT | unset | playwright.config | toggles retries/reporters |

## R. Load testing

| Name | Status | Default | Consumed by | Notes |
|---|---|---|---|---|
| `LOAD_TEST_PORT` | OPT | `4001` | load-test.ts | |
| `LOAD_TEST_CONNECTIONS` | OPT | `10` | load-test.ts | |
| `LOAD_TEST_DURATION` | OPT | `30` | load-test.ts | seconds |
| `LOAD_TEST_JWT_SECRET` | OPT | — | load-test.ts | pinned secret for load runs |

## S. Operator tooling

| Name | Status | Default | Consumed by | Notes |
|---|---|---|---|---|
| `OPERATOR_ENV` | OPT | `NODE_ENV` | scripts/migrate-prod | override env for destructive scripts |

---

## Drift flags (infra vs source)

### `.env.example` gaps closed

All 91 env-vars referenced in TS but missing from `.env.example` were appended in sections X–QQ. See the diff at `.env.example` lines 508–700+.

### `docker-compose.prod.yml` missing env forwards

These env-vars are consumed by `api-gateway` in source but NOT forwarded in `docker-compose.prod.yml` under `services.api-gateway.environment`. They currently rely on being present in the root `.env` (which docker-compose picks up) — but operators promoting to a managed runtime (ECS, Fargate) won't have that fallback:

- `JWT_REFRESH_SECRET` (docker-compose.prod.yml:89 — REQ-PROD)
- `SUPABASE_JWT_SECRET` (payments-ledger:116 — REQ-PROD)
- `INTERNAL_API_KEY` (api-gateway:89 — REQ-FEAT)
- `API_KEY_REGISTRY` (api-gateway:89 — REQ-PROD)
- `ALLOWED_ORIGINS` (api-gateway:89 — REQ-PROD, currently overloaded as `CORS_ALLOWED_ORIGINS`)
- `NOTIFICATIONS_SERVICE_URL` (api-gateway:89 — REQ-PROD)
- `NOTIFICATIONS_FROM_EMAIL`, `NOTIFICATIONS_FROM_NAME` (api-gateway:89 — REQ-PROD)
- `STORAGE_BASE_URL` (api-gateway:89 — REQ-FEAT)
- `CREDIT_CERT_SECRET` / `CREDIT_RATING_SIGNING_SECRET` (api-gateway:89 — REQ-FEAT)
- `AGENT_CERT_SIGNING_SECRET` (api-gateway:89 — REQ-PROD post-Wave-25)
- `GEPG_*` block (entire section, payments-ledger — REQ-FEAT)
- `MPESA_*` block (payments-ledger:116 — REQ-FEAT)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (payments-ledger:116 — REQ-FEAT)
- `AFRICAS_TALKING_*`, `TWILIO_AUTH_TOKEN`, `META_APP_SECRET`, `AFRICASTALKING_WEBHOOK_SECRET` (api-gateway — REQ-FEAT)
- `WHATSAPP_*` (api-gateway — REQ-FEAT)
- `WEBHOOK_DEFAULT_HMAC_SECRET` (api-gateway — REQ-FEAT)
- `DEFAULT_TENANT_COUNTRY` / `DEFAULT_TENANT_CURRENCY` (api-gateway — REQ-PROD if brain used)
- `SMTP_*` (reports — REQ-FEAT)
- `NEO4J_PASSWORD` on payments-ledger (only api-gateway forwards it; payments-ledger doesn't need it currently)

### `k8s/values.yaml secrets.inline` gaps

Only 9 of the 60+ REQ-PROD / REQ-FEAT secrets are present in `k8s/values.yaml`. Missing (when `externalSecrets.enabled=false`, i.e. local `kind` deploys):

`DATABASE_URL`, `REDIS_URL`, `NEO4J_URI`, `SUPABASE_JWT_SECRET`, `INTERNAL_API_KEY`, `API_KEY_REGISTRY`, `JWT_REFRESH_SECRET`, `CREDIT_CERT_SECRET`, `AGENT_CERT_SIGNING_SECRET`, `GEPG_HMAC_SECRET`, `GEPG_CALLBACK_BASE_URL`, `GEPG_SIGNING_*`, `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_PASS_KEY`, `MPESA_SHORT_CODE`, `MPESA_CALLBACK_URL`, `MPESA_INITIATOR_PASSWORD`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `AFRICAS_TALKING_API_KEY`, `AFRICAS_TALKING_USERNAME`, `TWILIO_AUTH_TOKEN`, `META_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WEBHOOK_DEFAULT_HMAC_SECRET`, `NOTIFICATIONS_FROM_EMAIL`, `NOTIFICATIONS_SERVICE_URL`, `STORAGE_BASE_URL`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `ALLOWED_ORIGINS`, `DEFAULT_TENANT_COUNTRY`, `DEFAULT_TENANT_CURRENCY`.

For prod deploys with `externalSecrets.enabled=true`, the external secret manager (AWS SM / Vault) must carry **all** of these at key path `borjie/prod`. Recommend adding them as `stringData` placeholders under `secrets.inline` for discoverability so operators see the full list.

### Configmap gaps

`k8s/templates/configmap.yaml` is referenced from `deployment.yaml:39` but not inspected here — it should at minimum publish: `NODE_ENV=production`, `PORT`, `LOG_LEVEL`, `SENTRY_ENVIRONMENT`, `POSTHOG_HOST`, `GEPG_BASE_URL`, `MPESA_ENVIRONMENT`, `AWS_TEXTRACT_REGION`, `OCR_PROVIDER`, `DEFAULT_TENANT_CITY`, `OUTBOX_INTERVAL_MS`, `OUTBOX_BATCH_SIZE`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS`, `DEEP_HEALTH_CACHE_MS`, `REPORTS_WORKER_CONCURRENCY` (deferred — coordinate with infra owner before editing).

---

Generated by Wave 25 Agent Y. For the operator quick-reference, see `Docs/ENV.md` (older, now superseded).
