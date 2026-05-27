# PROD ENV Readiness Audit — 2026-05-27

**Persona**: Mr. Mwikila
**Repo**: BORJIE-101 (branch `main`)
**Audit date**: 2026-05-27
**Auditor**: Mr. Mwikila
**Scope**: `.env.example` (public template) vs code references vs production-grade hygiene.
**Constraint**: `.env` itself was NEVER read (privacy). Only `.env.example`, `.env.production.example`, `.env.docker.example` and code references inspected.

---

## 1. Inventory

| Source | Count |
|---|---|
| Env vars referenced in source (`*.ts`, `*.tsx`, `*.js`, `*.mjs`, `*.cjs`) | **308 raw matches** (regex over `process.env.<NAME>`) |
| After dropping regex noise (`C`, `E`, `X`, `SD`, `NEO`, `AWS_S`, `DURATION`, `CONNECTIONS`, `BORJIE_MODEL_BASELINE_GPT_`) and OS-provided (`CI`, `TZ`, `USER`) and test-internal (`__OBS_ENV_TEST_*`) | **~292 real keys** |
| Documented in `.env.example` | **371** keys |
| Documented in `.env.production.example` (production overlay) | 38 keys |
| Documented in `.env.docker.example` | 15 keys |
| **Real code-referenced keys missing from `.env.example`** | **139** keys (curated) |

> `.env.example` is intentionally a *superset* of what's strictly needed today — many opt-in connectors are documented for future use. The 139 missing keys below are ones the code reads at runtime but the template silently omits, so a fresh operator has no signal they exist.

---

## 2. Missing from `.env.example` (curated, 139 keys)

Grouped by category. Each missing key gets a proposed safe placeholder + comment in the refactored template.

### 2.1 Database (5 keys)
| Key | Status today | Proposed placeholder |
|---|---|---|
| `DATABASE_URL` | commented out (line 43) | uncomment with Supabase pooler URL placeholder |
| `DATABASE_URL_READONLY` | missing | empty + comment "read-replica URL (optional)" |
| `SUPABASE_URL` | missing — only `NEXT_PUBLIC_SUPABASE_URL` exists | mirror `NEXT_PUBLIC_SUPABASE_URL` value (server-only consumers) |
| `SUPABASE_ACCESS_TOKEN` | missing (separate from `SUPABASE_ACCESS_TOKEN_KEY`) | `sbp_xxx` — supabase-cli token for operator scripts |
| `SUPABASE_ORG_ID` | missing | empty + comment |

### 2.2 LLM / AI router (24 keys)
- `GOOGLE_AI_API_KEY` — Gemini API key (referenced by brain-llm-router)
- `COHERE_API_KEY` — rerank provider
- `BENCH_ANTHROPIC_MODEL`, `BFCL_DATASET_DIR` — bench harness
- `BORJIE_AI_KILL_SWITCH` — **CRITICAL** master kill-switch
- 18 `BORJIE_MODEL_BASELINE_*` overrides (OPUS, SONNET, HAIKU, GPT_5, GPT_5_MINI, GPT_REALTIME, WHISPER, TTS, DALL_E, GEMINI_PRO, GEMINI_FLASH, COHERE_EMBED, COHERE_RERANK, ELEVEN_TTS, ELEVEN_STT, DEEPSEEK_CHAT, DEEPSEEK_CODER)
- `BORJIE_MODEL_CACHE_TTL_MS`

### 2.3 Auth / Security (5 keys)
- `AUTH_PROVIDER` — `supabase|legacy` router (defaults `legacy`)
- `USER_HASH_SALT` — **REQUIRED IN PRODUCTION** (PII hash salt; live test fails without it)
- `AUDIT_TRAIL_SIGNING_SECRET` — audit hash-chain HMAC root
- `WEBHOOK_REQUIRE_TIMESTAMP` — production should be `'true'`
- `WHATSAPP_ADMIN_SECRET` — webhook admin secret

### 2.4 Payments / M-Pesa (22 keys)
The Daraja/M-Pesa surface is the **largest single missing area** — 18 M-Pesa-related vars + 4 Daraja sandbox vars are read by `services/payments/src/mpesa/*` but only generic `MPESA_*` were documented.

- `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_PASSKEY`, `MPESA_PASS_KEY` (alias), `MPESA_SHORTCODE`, `MPESA_SHORT_CODE` (alias), `MPESA_BUSINESS_SHORT_CODE`, `MPESA_INITIATOR_PASSWORD`, `MPESA_CALLBACK_URL`, `MPESA_CERT_PATH`, `MPESA_ENVIRONMENT`, `MPESA_ALLOWED_IPS`, `MPESA_DISABLE_IP_ALLOWLIST`, `MPESA_PRODUCTION_CERT`, `MPESA_SANDBOX_CERT`, `MPESA_WEBHOOK_SECRET`, `MPESA_WEBHOOK_SECRET_REQUIRED`, `MPESA_SHORTCODE_TENANT_MAP`
- `DARAJA_SANDBOX_CONSUMER_KEY`, `DARAJA_SANDBOX_CONSUMER_SECRET`, `DARAJA_SANDBOX_PASSKEY`, `DARAJA_SANDBOX_SHORTCODE`

### 2.5 GePG (TZ signed-payment gateway, 5 keys)
`GEPG_HEALTH_URL`, `GEPG_SIGNING_CERT_PATH`, `GEPG_SIGNING_CERT_PEM`, `GEPG_SIGNING_KEY_PATH`, `GEPG_SIGNING_KEY_PEM` — required for live signed-payment flows.

### 2.6 Connectors / tenant routing (6 keys)
- `META_WABA_TENANT_MAP`, `META_MEDIA_ALLOWED_HOSTS`
- `AFRICASTALKING_USERNAME_TENANT_MAP`
- `TWILIO_PHONE_TENANT_MAP`, `TWILIO_WEBHOOK_URL`
- `SLACK_WEBHOOK` — ops alert webhook

### 2.7 Durable execution (3 keys)
`TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `DURABLE_EXEC_ENABLED` — `.env.example` says "Temporal config inherited from cluster-side config; no env vars here today" but code already reads them.

### 2.8 Observability / Audit (2 keys)
- `OCSF_LOG_PATH` — OCSF SIEM emitter path
- `SLEEP_PASS_PROD_ADAPTERS` — toggle prod adapters in sleep-pass orchestrator

### 2.9 Background tasks / cron (9 keys)
`BORJIE_ACTION_RUNNER_DISABLED`, `BORJIE_ACTION_RUNNER_INTERVAL_MS`, `EXECUTIVE_BRIEF_CRON_DISABLED`, `EXECUTIVE_BRIEF_CRON_INTERVAL_MS`, `LEASE_EXPIRY_ALERT_DISABLED`, `LEASE_EXPIRY_ALERT_INTERVAL_MS`, `HEARTBEAT_INTERVAL_MS`, `OUTBOX_PROCESSOR_BATCH_SIZE`, `OUTBOX_PROCESSOR_INTERVAL_MS` (last two are aliases).

### 2.10 Service wiring URLs (15 keys)
`API_GATEWAY_URL`, `BORJIE_API_GATEWAY_URL`, `GATEWAY_URL`, `IDENTITY_URL`, `TENANT_SERVICE_URL`, `PAYMENTS_LEDGER_URL`, `APOLLO_AGENT_URL`, `APOLLO_REPORT_SINK_URL`, `APOLLO_GAUNTLET_THRESHOLD`, `REALTIME_WS_URL`, `VOICE_WS_BASE_URL`, `EXPO_PUBLIC_API_GATEWAY_URL`, `FORECASTING_REPO_URL`, `KERNEL_USE_ORCHESTRATOR`, `MCP_PROCESS_INTEL_URL`, `MCP_TRA_STDIO`, `NOT_YET_WIRED_THRESHOLD`.

### 2.11 Document generation (14 keys)
`CARBONE_URL`, `CARBONE_PORT`, `CARBONE_API_TOKEN`, `CARBONE_FACTORY_COUNT`, `CARBONE_TIMEOUT_MS`, `HTML_PDF_TIMEOUT_MS`, `PUPPETEER_EXECUTABLE_PATH`, `PUPPETEER_HEADLESS`, `PUPPETEER_PORT`, `TYPST_BINARY` (alias of `TYPST_BIN`), `TYPST_PORT`, `TYPST_SERVER_URL`, `TYPST_TIMEOUT_MS`, `PYTHON_BIN`.

### 2.12 OpenAPI spec generation (4 keys)
`OPENAPI_DEV_SERVER_URL`, `OPENAPI_PROD_SERVER_URL`, `OPENAPI_OUT_PATH`, `OPENAPI_SPEC_PATH`.

### 2.13 Dev / debug / live-test (14 keys)
`BORJIE_DEBUG`, `BORJIE_DEV_TENANT_ID`, `BORJIE_DOCS_ROOT`, `BORJIE_BOOTSTRAP_PASSWORD`, `BORJIE_LEAK_SCAN_OUT`, `BORJIE_PII_EXTENDED`, `BORJIE_REPO_ROOT`, `DOCUMENT_INTELLIGENCE_INTERNAL_REQUIRED`, `DOCUMENT_INTELLIGENCE_INTERNAL_SECRET`, `TRC_TENANT_ID`, `SEED_PROPERTY_CITY`, `SMOKE_EMAIL`, `SMOKE_PASSWORD`, `LIVE_TEST_OWNER_EMAIL`, `LIVE_TEST_OWNER_PASSWORD`, `LIVE_TEST_OTHER_EMAIL`, `LIVE_TEST_OTHER_PASSWORD`, `REPORTS_AUDIO_BASE_URL`, `REPORTS_DIR`, `TEMPLATES_DIR`, `AWS_REGION_BY_TENANT_OVERRIDE`, `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`.

### 2.14 Runtime (2 keys)
`PORT`, `HOST` — platform-provided in most PaaS deployments but explicitly read by services.

### 2.15 Map tiles (2 keys)
`MAPLIBRE_STYLE_URL`, `MARTIN_URL` (martin tile server).

---

## 3. Production-readiness gaps (keys the prompt asks for but absent from BOTH `.env.example` AND code)

These are documented in the task brief as "expected production-grade keys". They are **NOT yet referenced anywhere in code** — flagged so the team can either wire them in or decommission them from the launch checklist.

| Key | Status | Action |
|---|---|---|
| `AUTH_COOKIE_SECRET` | Not in code | Either add to auth middleware or document as N/A (Supabase manages cookies). |
| `LELAPA_API_KEY` (Vulavula) | Not in code | Add stub adapter or remove from launch checklist. |
| `ASSEMBLYAI_API_KEY` | Not in code | Same as above. |
| `GEMINI_LIVE_API_KEY` | Not in code | Same as above. Currently routed via `GOOGLE_AI_API_KEY`. |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` | Not in code | Langfuse adapter exists but reads `LANGFUSE_HOST` only (host-only test fixture). Wire up keys in observability. |
| `OTLP_ENDPOINT` | Not in code (code uses `OTEL_EXPORTER_OTLP_ENDPOINT`) | Already present under canonical name. |
| `MINIO_*` (4 keys) | Not in code | Project uses S3 (`AWS_*`) + Supabase Storage. Decision: remove MinIO from launch checklist OR add MinIO adapter. |
| `NOTION_TOKEN`, `HUBSPOT_API_KEY`, `LINEAR_API_KEY`, `JIRA_API_TOKEN`, `MS_TEAMS_TOKEN`, `ZOOM_API_KEY` | Not in code | Enterprise connectors not yet wired. Flag for future waves. |
| `OUTLOOK_CLIENT_ID/SECRET`, `GOOGLE_CAL_CLIENT_ID`, `GOOGLE_DRIVE_*` | Not in code | Calendar/Drive connectors not yet wired. |
| `SLACK_APP_TOKEN`, `SLACK_BOT_TOKEN` | Not in code (only `SLACK_WEBHOOK`) | Slack OAuth not wired; only outbound webhook. |
| `WHATSAPP_BUSINESS_TOKEN` | Not in code (code uses `WHATSAPP_ACCESS_TOKEN`) | Naming mismatch — `.env.example` already documents `WHATSAPP_ACCESS_TOKEN` which is canonical. |
| `BORJIE_KEK_ID`, `BORJIE_LIVE_MODE`, `BORJIE_REDACT_SALT` | Not in code | KMS-backed envelope encryption + live-mode strict-gate not yet wired. **Recommend wiring before public launch**; meanwhile add to template as `# TODO_WAVE_<N>:` placeholders. |
| `DP_EPSILON_BUDGET_DEFAULT` | Not in code (code uses `PRIVACY_BUDGET_EPSILON`) | Already present under canonical name. |
| `TENANT_ISOLATION_GATE_STRICT` | Not in code | Recommend wiring tenant isolation gate before launch. |
| `SENTRY_ENABLED` | Not in code (Sentry init checks `SENTRY_DSN` truthiness) | Implicit toggle — document the pattern. |
| `DEFAULT_JURISDICTION_PROFILE`, `DEFAULT_VERTICAL_PROFILE` | Not in code | Recommend wiring jurisdiction/vertical profile loader. Today logic uses per-tenant config (good — but no env-default exists). |
| `AMBIENT_LISTENING_ENABLED` (FOUNDER_LOCKED #4) | Not in code | **MUST wire as opt-in gate before voice-agent ships**. |
| `QUIET_HOURS_START` / `QUIET_HOURS_END` (FOUNDER_LOCKED #1) | Not in code (hard-coded `18:00`/`06:00` in `packages/work-cycle/`) | **MUST wire as env override before TZ launch** to support per-tenant override. |
| `TWILIO_VOICE_SUBACCOUNT_SID` | Not in code | Twilio voice sub-accounts not yet wired. |
| `GH_TOKEN` | Not in code (CI uses `GITHUB_TOKEN` from workflow auto-env) | Already managed by GitHub Actions. |

---

## 4. Sanity-check matrix

| Key | Current `.env.example` default | Production-grade required | Verdict |
|---|---|---|---|
| `NODE_ENV` | `development` | `production` | OK — production overlay (`.env.production.example`) flips it |
| `LOG_LEVEL` | `info` | `info` (not debug) | OK |
| `DATABASE_URL` | commented out | Supabase pooler URL | **FAIL** — uncomment with placeholder in template |
| `SUPABASE_URL` | absent | required (server-only) | **FAIL** — add |
| `JWT_SECRET` | `TODO_BORJIE_GENERATE_openssl_rand_base64_48` | ≥32 chars random | OK (auto-gen via setup-env) |
| `SESSION_HASH_SECRET` | `TODO_BORJIE_GENERATE_openssl_rand_base64_48` | required | OK |
| `ENCRYPTION_MASTER_KEY` | `TODO_BORJIE_GENERATE_openssl_rand_base64_32` | required | OK |
| `USER_HASH_SALT` | absent in `.env.example`, present in `.env.production.example` | required in production | **FAIL** — add to `.env.example` |
| `BORJIE_AI_KILL_SWITCH` | absent | recommended | **FAIL** — add |
| `OCSF_LOG_PATH` | absent | recommended for SIEM | **FAIL** — add |
| `SENTRY_DSN` | empty | required for production | OK (template empty; ops sets) |
| `OTEL_ENABLED` | `false` | `true` in production | OK (template default; ops flips) |
| `AUTH_PROVIDER` | absent | required (`supabase` in production) | **FAIL** — add with `legacy` default |
| `BORJIE_LIVE_MODE` (strict gate) | not wired | required pre-launch | **GAP — code work needed** |
| `TENANT_ISOLATION_GATE_STRICT` | not wired | required pre-launch | **GAP — code work needed** |
| `QUIET_HOURS_START/END` | not wired (hard-coded) | env override per FOUNDER_LOCKED | **GAP — code work needed** |
| `AMBIENT_LISTENING_ENABLED` | not wired | opt-in gate per FOUNDER_LOCKED | **GAP — code work needed** |
| `DEFAULT_JURISDICTION_PROFILE` | not wired | `tz` for launch | **GAP — code work needed** |
| `DEFAULT_VERTICAL_PROFILE` | not wired | `mining-tz` for launch | **GAP — code work needed** |

---

## 5. Production-grade hygiene checklist

| Item | Current state | After refactor |
|---|---|---|
| Only placeholders, no real secrets | OK | OK |
| Every key has a one-line comment | Partial (~70 % documented) | OK (100 % after refactor) |
| Grouped into `# === SECTION ===` blocks | OK (existing structure good) | OK (preserved + new sections for new keys) |
| Production-only vs dev-only flags marked | Partial | OK |
| Secret-rotation cadence documented | Partial (a few keys mention rotation runbook) | OK (rotation cadence added per secret type) |
| Sorted within sections alphabetically | NO (currently logical-order) | **OK — refactored to alphabetical within each section** |

---

## 6. One-page upgrade plan

**Goal**: bring `.env.example` to 100 % parity with code references AND production-grade hygiene before the TZ live launch.

**Phase A — Template-only (this PR, ZERO code changes)**
1. Add the 139 curated missing keys to `.env.example` with safe placeholders + one-line comments + rotation cadence where relevant.
2. Reorder existing sections + new keys alphabetically within each `# === SECTION ===` block.
3. Mark production-only keys with `[PRODUCTION-ONLY]` suffix in the comment.
4. Mark dev-only keys with `[DEV-ONLY]` suffix.
5. Add an explicit `# === FOUNDER-LOCKED RUNTIME GATES (pending wiring) ===` section listing `BORJIE_LIVE_MODE`, `TENANT_ISOLATION_GATE_STRICT`, `QUIET_HOURS_START/END`, `AMBIENT_LISTENING_ENABLED`, `DEFAULT_JURISDICTION_PROFILE`, `DEFAULT_VERTICAL_PROFILE` with a `# TODO_PRELAUNCH:` marker so the wiring waves can find them.

**Phase B — Code wiring (separate PRs, per wave)**
1. Wire `BORJIE_LIVE_MODE`, `TENANT_ISOLATION_GATE_STRICT` gates into composition root (api-gateway).
2. Wire `QUIET_HOURS_START/END` env override into `packages/work-cycle/`.
3. Wire `AMBIENT_LISTENING_ENABLED` opt-in gate into voice-agent service.
4. Wire `DEFAULT_JURISDICTION_PROFILE`, `DEFAULT_VERTICAL_PROFILE` into tenant-bootstrap.
5. Wire `BORJIE_KEK_ID` (KMS reference) into encryption pipeline.

**Phase C — Operator hardening (ops PR)**
1. Document rotation runbook for every secret type (90-day default).
2. Add SOPS-encrypted vault for `.env.production` per K8s deployment.
3. Update `Docs/RUNBOOKS/supabase-bootstrap.md` to flag the new keys.

---

## 7. Commits

1. `docs(qa): PROD_ENV_READINESS_2026_05_27 — env audit + gaps`
2. `refactor(env): organize .env.example into sections + add 139 missing keys`

---

*Audit complete — Mr. Mwikila signing off, 2026-05-27.*
