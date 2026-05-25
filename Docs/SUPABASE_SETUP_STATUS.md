# BORJIE — Supabase + Multi-Project Isolation Status

**Last updated:** 2026-05-22

## ✅ Created (zero-interference with LITFIN)

| Project | URL | Region | DB | Status |
|---|---|---|---|---|
| **LITFIN** | `kxprfmttceohuxafrbeu.supabase.co` | (separate) | (pre-existing) | Live |
| **BORJIE** | `nxgawnzsnzzwgapnfvrf.supabase.co` | London (eu-west-2) | PostgreSQL 17.6 | **Live, migrations applying** |

**Physical isolation:**
- Different `project_ref` → different Postgres cluster → physically separate database files
- Different API URLs → no shared endpoints
- Different anon + service-role keys → can't cross-auth
- Different RLS policies (each project applies its own migrations)
- Different `auth.users` tables → separate user pools
- Different storage buckets → no shared blob storage

## Service-by-service isolation policy

| Service | LITFIN | BORJIE | Separate? | Rationale |
|---|---|---|---|---|
| **Supabase** | `kxprfmttceohuxafrbeu` | `nxgawnzsnzzwgapnfvrf` | ✅ **YES** | Different DB schemas, RLS, user pools — critical for tenant isolation |
| **Anthropic Claude** | same dev key | same dev key | ❌ no | Key is account-level, rate-limited per key — fine for dev |
| **OpenAI** | same dev key | same dev key | ❌ no | Same logic — account-level key |
| **DeepSeek** | same dev key | same dev key | ❌ no | Same |
| **ElevenLabs** | same agent | same agent (for now) | ⚠️ dev: no, prod: yes | New voice persona recommended for prod BORJIE |
| **Twilio** | same sandbox SID | same sandbox SID | ⚠️ dev: no, prod: yes | Different production messaging SID per app |
| **Stripe** | same test keys | same test keys | ⚠️ dev: no, prod: yes | Different live accounts per product for clean ledgers |
| **Resend** | LITFIN `noreply@litfin.co.tz` | BORJIE `noreply@borjie.co.tz` | ⚠️ partial | Same API key, different sender domain |
| **Upstash Redis** | `allowed-cod-38480` | same dev instance | ⚠️ dev: no, prod: yes | Separate cache namespace per prod for rate-limit isolation |
| **Hume AI** | same | same | ❌ no | Voice emotion API key, account-level |
| **Azure Speech** | same | same | ❌ no | Account-level key |
| **Google APIs** | same | same | ❌ no | Project-level key, shared across apps |
| **Cloudflare** | same | same | ❌ no | Account token, account-level |
| **Sentry** | `litfin` project | (not configured yet) | ⚠️ prod TODO | Different DSN per app for clean error streams |
| **PostHog** | (not configured) | (not configured) | ⚠️ prod TODO | Different project keys per app for clean analytics |
| **Neo4j** | LITFIN-only | not used | n/a | BORJIE uses pgvector instead |
| **Encryption Master Key** | LITFIN-only | **fresh, BORJIE-only** | ✅ YES | Must never share — different secret per project |
| **App JWT secrets** (JWT_SECRET, REFRESH, SESSION) | LITFIN-only | **fresh, BORJIE-only** | ✅ YES | Same |
| **MCP API key** | LITFIN-only | **fresh, BORJIE-only** | ✅ YES | Same |
| **CRON_SECRET, INTERNAL_API_KEY** | LITFIN-only | **fresh, BORJIE-only** | ✅ YES | Same |

## Remaining TODOs (BORJIE-specific)

### Critical (live-test gates)

- [ ] **`SUPABASE_JWT_SECRET`** — fetch from
  https://supabase.com/dashboard/project/nxgawnzsnzzwgapnfvrf/settings/api
  → "JWT Secret" section. Paste into `.env.local`.
- [ ] **Verify migrations apply clean** — see in-progress run.
- [ ] **Bootstrap test users** — run `pnpm seed:bootstrap` after migrations
  complete.

### Important (production-readiness)

- [ ] **Sentry DSN** — create separate project at https://sentry.io/
- [ ] **PostHog API key** — create separate project at https://eu.posthog.com/
- [ ] **BORJIE Stripe account** — switch from LITFIN's dev keys for prod
- [ ] **BORJIE ElevenLabs voice agent** — create property-mgmt persona
- [ ] **BORJIE Twilio messaging SID** — for prod SMS reply rules
- [ ] **BORJIE Upstash Redis instance** — for prod cache isolation

### Optional (sandbox creds, wire when those flows go live)

- [ ] M-Pesa Daraja (KE) — https://developer.safaricom.co.ke/
- [ ] M-Pesa Vodacom (TZ) — https://openapiportal.m-pesa.com/
- [ ] Tigo Pesa, Airtel Money, HaloPesa — region-specific
- [ ] GePG — https://www.gepg.go.tz/
- [ ] Africa's Talking — SMS fallback
- [ ] WhatsApp Business — Meta Cloud API
- [ ] NIDA, KRA, TRA, BRELA — regulatory identity / tax

## What's wired right now (after the merge)

| Component | Status |
|---|---|
| Adaptive UI engine (UI-1) | ✅ Wired, `section_layouts` table on BORJIE Supabase |
| ProactiveHint (UI-2) | ✅ Wired |
| MasteryGate (UI-3) | ✅ Wired, `user_action_tracker` table on BORJIE Supabase |
| Multi-modal layout router (UI-4) | ✅ Wired |
| LearnedShortcutsPanel (UI-5) | ✅ Wired |
| Tree-of-Thoughts planner (P-6) | ✅ Wired via planner-dispatcher (low/medium stakes) |
| MMR rerank + drift detector (P-7) | ✅ Wired into hybrid retrieval |
| Haiku-first cascade (P-8) | ✅ Wired |
| Online judge + jailbreak corpus (P-9) | ✅ Wired, 100/100 refusal |
| Three-agent debate (P-10) | ✅ Wired at high+critical stakes |
| Tier-policy resolver (F2) | ✅ Wired at kernel step 3b |
| Sandbox primitive (F7) | ✅ Wired via power-tools/sandbox.ts |
| Brain power tools (F8) | ✅ Wired, 7 tools in registry |
| LATS tree-search (F9) | ✅ Wired via planner-dispatcher (high+critical stakes) |
| DecisionTrace (F10) | ✅ Wired at 3 sentinel sites (approvals + payouts-worker + tenant-context) |
| Reflexion + sleep (F11) | ✅ Wired, nightly orchestrator + system-prompt prepend |
