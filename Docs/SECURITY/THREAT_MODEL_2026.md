# BORJIE — Threat Model 2026 (STRIDE)

Persona: **Mr. Mwikila** (SEC-2)
Methodology: **STRIDE** (Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege) per Microsoft SDL, complemented with **LINDDUN** privacy threats where personal data is in scope.
Last reviewed: 2026-05-26. Reviewed quarterly.

> Each component below names: **(a) assets**, **(b) attackers**, **(c) attack surface**, **(d) STRIDE per asset**, **(e) mitigations**.
> A mitigation that is not exercised in CI or in a runtime probe is **aspirational** and must be marked `TODO`.

---

## Component 1 — `services/api-gateway`

### 1a. Assets

- JWT signing key (`JWT_SECRET`) — high integrity, high confidentiality
- Refresh-token store (Redis) — high integrity
- Tenant-scoped REST endpoints under `/api/v1/*`
- Auth endpoints `/auth/login`, `/auth/refresh`, `/auth/logout`
- WebSocket upgrade endpoints (realtime adapter)
- OpenAPI spec (`Docs/API_SPEC.yaml`) — public, integrity-sensitive

### 1b. Attackers

- **Anonymous external** — credential stuffing, scanner traffic, vuln-research
- **Authenticated but low-privilege** — looking for IDOR / broken object-level authz
- **Compromised tenant** — uses legitimate creds to attack other tenants
- **Compromised LLM prompt** — exfiltration via the agent calling the gateway with attacker-controlled args

### 1c. Attack surface

- Public-internet HTTPS:443 endpoint
- WebSocket upgrade endpoint
- OpenAPI spec (informational disclosure of all routes & shapes)
- Error envelopes (information disclosure if not redacted)

### 1d. STRIDE

| Threat | Vector | Mitigation |
|---|---|---|
| Spoofing | JWT forgery | `JWT_SECRET` ≥ 256-bit, rotated 90d; verify `iss`, `aud`, `exp`, `nbf`, `jti`; `kid` check before parse |
| Spoofing | Session-fixation | Refresh-token rotation; bind refresh to UA + IP class; invalidate on logout |
| Tampering | Body tampering | TLS 1.2+ enforced; HMAC on webhook bodies (`services/webhooks/src/verify.ts`) |
| Repudiation | "I never made that request" | Audit log with `actor_id`, `tenant_id`, `ts`, `ip`, `ua`, `route`, `status`, hash-chained per `packages/audit-hash-chain` |
| Information disclosure | Raw error envelope leaks stack | `eslint-rules/no-raw-error-envelope.js` + `borjie-semgrep` rule |
| Information disclosure | IDOR via path-param | `packages/authz-policy` checks `tenant_id` on every route; `scripts/audit-rls-coverage.mjs` proves DB enforcement |
| Information disclosure | Verbose 404 reveals route existence | Uniform 404 + 403 envelope |
| Denial of service | Bruteforce / scanner | Rate-limit middleware per route family (`scripts/audit-rate-limit-coverage.mjs`); WAF in front |
| Denial of service | Body bomb | `bodyLimit: 1mb` default; per-route override only with justification |
| Elevation of privilege | RBAC bypass | `packages/authz-policy` is canonical; every route has an explicit policy id; CI gate `borjie-security-route-coverage.yml` proves every route has a policy |

### 1e. Residual risk + watchpoints

- **Watch**: zero-day in JWT library. *Mitigation*: `pnpm audit` HIGH/CRITICAL block + SBOM diff alert.
- **Watch**: OpenAPI spec drift causing a missing-auth route. *Mitigation*: `borjie-openapi-drift.yml`.

---

## Component 2 — `services/voice-agent`

### 2a. Assets

- Voice transcripts (PII: name, address, phone, occasionally KRA PIN/NIDA)
- Raw audio (biometric — high sensitivity, 7-day retention max)
- LLM provider key (Anthropic)
- TTS / STT provider keys (e.g. ElevenLabs, Deepgram if used)

### 2b. Attackers

- **Voice-print impersonator** — synthesises a tenant's voice to extract data
- **Eavesdropper on transport** — MitM on the WebRTC SRTP path
- **Insider operator** — listens to recordings to extract PII
- **LLM prompt injector via voice** — embeds an attack ("ignore previous instructions") in the spoken text

### 2c. Attack surface

- WebRTC ingestion endpoint
- LLM completion API (outbound to provider)
- TTS API (outbound to provider)
- Audio storage (S3 / blob) — encrypted at rest, KMS-managed
- Transcript storage (Postgres) — RLS enforced

### 2d. STRIDE

| Threat | Vector | Mitigation |
|---|---|---|
| Spoofing | Voice-print impersonation | Out-of-band confirmation (SMS/email) for any high-stakes action; voice alone is never a sole factor |
| Tampering | Transcript edit | Hash-chained transcript records in audit log |
| Repudiation | "I didn't say that" | Audio + transcript retained 7d + 90d respectively; cryptographic timestamps in audit log |
| Information disclosure | Operator listens to raw audio | Raw audio access is gated by `super_admin` role with double-audit; access reason required |
| Information disclosure | LLM provider logs the prompt | Provider contract requires zero retention (Anthropic enterprise terms); PII scrubber runs **before** prompt is sent |
| Denial of service | Long-running audio session | Session timeout (30 min hard cap); per-tenant concurrent-session limit |
| Elevation of privilege | Prompt injection via voice | Output guard + tool-registry allowlist (same as Mr. Mwikila); proposed-action confirmation required for any write |

### 2e. Residual risk + watchpoints

- **Watch**: emerging voice-clone attack quality. *Mitigation*: anti-fraud overlay; never act on voice alone for monetary transactions.

---

## Component 3 — `services/research-orchestrator`

### 3a. Assets

- Research prompts (may contain tenant context)
- Outbound HTTP calls to third-party research APIs (Bing, Tavily, etc.)
- Returned web content (untrusted, potentially containing prompt-injection payloads)
- Synthesised research output (used by Mr. Mwikila + executive-brief-engine)

### 3b. Attackers

- **Malicious webpage author** — plants prompt-injection content in a page the orchestrator scrapes
- **DNS hijacker** — redirects a research API call to attacker-controlled host
- **Quota exhauster** — burns the research-API budget to deny service

### 3c. Attack surface

- Outbound HTTP to research APIs
- Inbound LLM-generated prompts (from the agent)
- Returned HTML/JSON (untrusted)

### 3d. STRIDE

| Threat | Vector | Mitigation |
|---|---|---|
| Spoofing | DNS hijack on outbound | Pinned CA bundle; outbound only via egress allowlist; SNI + hostname verification |
| Tampering | Returned web content has injected instructions | `stripIndirectInstructions` on every fetched body before re-feeding to LLM; sandboxed re-summarisation |
| Repudiation | Source page changed after the fact | We persist the SHA-256 hash + fetched-at timestamp of every source |
| Information disclosure | Prompt leakage to a third-party API | Tenant PII scrubbed before any outbound call |
| Denial of service | Quota burn | Per-tenant + per-day budget; circuit breaker on provider errors |
| Elevation of privilege | Prompt injection persists to executive brief | Same output guard as agent; any write to brief requires user confirmation |

### 3e. Residual risk + watchpoints

- **Watch**: model improvements that defeat current `stripIndirectInstructions`. *Mitigation*: red-team scenario coverage updated quarterly.

---

## Component 4 — `packages/agent-platform` + Mr. Mwikila

### 4a. Assets

- Agent system prompts (proprietary, integrity-sensitive)
- Tool registry (executable surface — every entry is privileged)
- Per-tenant context windows (PII)
- Audit hash chain (tamper-evident log)
- Kill switch (`agent.global_kill`, `agent.tool_kill.*`)

### 4b. Attackers

- **Prompt injector** — direct (in chat) or indirect (via tool output, search result, OCR'd document)
- **Excessive-agency exploiter** — convinces the agent to invoke high-impact tools without confirmation
- **Cross-tenant leak attempter** — crafts prompts to extract another tenant's data
- **Tool-registry poisoner** — supply-chain attack on a tool implementation

### 4c. Attack surface

- Chat ingress
- Tool registry (every tool is an attack-surface)
- Memory store (`packages/cognitive-memory`)
- LLM provider (outbound)

### 4d. STRIDE

| Threat | Vector | Mitigation |
|---|---|---|
| Spoofing | Tenant ID forgery in agent context | Tenant id comes from authenticated JWT, never from LLM output |
| Tampering | Audit-chain tamper | SHA-256 hash chain + nightly verifier (`scripts/audit-chain-verify.mjs`) raises Sev2 on mismatch |
| Repudiation | "The agent didn't do that" | Every tool call carries `actor_id` + `tenant_id` + `purpose` + `prompt_hash` |
| Information disclosure | Cross-tenant context bleed | Per-invocation context isolation: each call gets a fresh memory scoped to one tenant; tested by `red-team.yml § cross-tenant-leak` |
| Information disclosure | Prompt leakage in error message | Output guard sanitises errors before returning to user |
| Denial of service | Token-budget exhaustion | Per-tenant rate limit (50 req/min) + per-tenant token budget |
| Elevation of privilege | Agent calls a tool it shouldn't | Tool-registry allowlist by role; `purpose` field required and policy-checked |
| Elevation of privilege | Excessive agency on write | Mr. Mwikila *proposes*, human *confirms* — every write goes through the proposed-action queue |

### 4e. Residual risk + watchpoints

- **Watch**: novel prompt-injection technique (e.g. ASCII-art smuggling, language-switch attacks). *Mitigation*: monthly red-team scenario refresh.

---

## Component 5 — Connectors (every adapter under `services/connectors-*` + `packages/connectors`)

### 5a. Assets

- Outbound API credentials (OAuth tokens, API keys) — high confidentiality
- Inbound webhook bodies (untrusted)
- Outbound payloads carrying tenant PII

### 5b. Attackers

- **Webhook forger** — sends crafted payloads pretending to be from the third party
- **MitM on outbound** — captures credentials in flight
- **Compromised vendor** — vendor breach leaks our credentials
- **Replay attacker** — re-submits a captured webhook to cause duplicate side-effects

### 5c. Attack surface

- Outbound HTTPS to each vendor
- Inbound HTTPS from each vendor (webhooks)
- Vault entry for each credential

### 5d. STRIDE

| Threat | Vector | Mitigation |
|---|---|---|
| Spoofing | Forged webhook | HMAC signature verification per vendor (`services/webhooks/src/verify.ts`); reject on mismatch |
| Tampering | Body tamper | HMAC covers body bytes |
| Repudiation | Vendor denies sending | Persist raw body + headers (PII-scrubbed) + signature for 90d |
| Information disclosure | Credential leak in logs | `pii-scrubber` redacts `authorization`, `cookie`, `api_key`, `token`, `secret` keys in every log line |
| Information disclosure | Outbound leaks PII to wrong tenant | Adapter takes `tenant_id` as a typed arg; cannot be omitted |
| Denial of service | Vendor-side outage | Circuit breaker per vendor; queue + retry with jitter |
| Elevation of privilege | Adapter operates on the wrong scope | OAuth scopes minimised at consent time |
| **Replay** (not STRIDE but critical) | Resubmitting a captured webhook | Idempotency key required (`Idempotency-Key` header) + `(vendor, event_id)` uniqueness DB constraint |

### 5e. Residual risk + watchpoints

- **Watch**: vendor key compromise. *Mitigation*: rotate quarterly; CI alarm on stale-key age > 90 days.

---

## Component 6 — `services/payments-ledger` + `packages/payments-event-store`

### 6a. Assets

- Money. Real money. Tenant funds, rent, deposit, marketplace transactions.
- Ledger entries (immutable double-entry)
- Payment provider keys (Stripe, M-Pesa daraja)

### 6b. Attackers

- **Fraudster** — wants to cause an unauthorised transfer
- **Race-condition exploiter** — concurrent requests to double-withdraw
- **Webhook replay** — duplicate the payment
- **Insider** — operator with elevated access modifies a ledger entry

### 6c. Attack surface

- `/api/v1/payments/*` endpoints
- Outbound to Stripe / M-Pesa
- Inbound webhooks from Stripe / M-Pesa

### 6d. STRIDE

| Threat | Vector | Mitigation |
|---|---|---|
| Spoofing | Forged transfer-init | JWT + per-route MFA required for monetary action; CSRF token + Origin check |
| Tampering | Ledger entry edit | Append-only; `UPDATE`/`DELETE` denied at DB role level; hash-chained |
| Repudiation | "I didn't initiate the transfer" | Audit log + signed receipt + cryptographic timestamp |
| Information disclosure | Card data in logs | We do not store PAN; tokenised by provider; logs PII-scrubbed |
| Denial of service | Race condition on balance | DB transaction with `SELECT ... FOR UPDATE`; idempotency key required; balance check inside the transaction |
| Elevation of privilege | Operator edits ledger | DB role separation: app role has only INSERT on ledger; UPDATE/DELETE require `admin_dba` role with separate audit |
| Replay | Duplicate webhook | `(provider, event_id)` uniqueness constraint + idempotency key on init |

### 6e. Residual risk + watchpoints

- **Watch**: provider-side fraud (e.g. compromised M-Pesa account). *Mitigation*: anomaly detection on transaction velocity; manual review threshold.

---

## Component 7 — `apps/admin-web` + `apps/owner-web`

### 7a. Assets

- Admin/owner session cookies
- Privileged operations (cross-tenant view for super_admin, billing manage for tenant_admin)
- CSRF token

### 7b. Attackers

- **XSS payload author** — stored or reflected XSS to ride an admin's session
- **Phisher** — tricks an admin into clicking a forged link
- **Clickjacker** — iframes the admin page

### 7c. Attack surface

- HTML render path (React/Next.js)
- Form submission endpoints
- File upload (admin uploads CSVs)

### 7d. STRIDE

| Threat | Vector | Mitigation |
|---|---|---|
| Spoofing | Session hijack | HttpOnly + Secure + SameSite=strict cookies; short TTL; rebind on IP-class change |
| Tampering | CSRF on state change | Anti-CSRF token on every POST/PUT/PATCH/DELETE; enforced by `eslint-rules/csrf-required.js` + `csrf-eslint-rule.yml` |
| Repudiation | "I didn't approve that" | Action log per admin click |
| Information disclosure | XSS exfiltrates token | `next/script` with nonce; CSP `script-src 'self' 'nonce-...'`; React escapes by default; `dangerouslySetInnerHTML` gated by an ESLint deny rule |
| Denial of service | Admin endpoint flood | Rate limit + WAF |
| Elevation of privilege | UI hides a privileged route → user finds it | Authz enforced server-side; UI is a hint, not a gate |
| Clickjacking | iframe trick | `frame-ancestors 'none'` in CSP + `X-Frame-Options: DENY` |

### 7e. Residual risk + watchpoints

- **Watch**: React XSS via attacker-supplied `href="javascript:..."`. *Mitigation*: link-sanitiser on every href that comes from user input.

---

## Component 8 — `apps/buyer-mobile` + `apps/workforce-mobile`

### 8a. Assets

- On-device tokens (refresh + access)
- Local cache (recently viewed properties, sometimes ID images)
- App-signing certificate (controls update channel)

### 8b. Attackers

- **Rooted-device user** — extracts tokens from local storage
- **App-store impersonator** — publishes a clone
- **MitM proxy** — intercepts traffic via a user-installed root CA

### 8c. Attack surface

- Mobile OS storage
- Network egress
- Push-notification handler

### 8d. STRIDE

| Threat | Vector | Mitigation |
|---|---|---|
| Spoofing | Token theft on rooted device | Tokens in OS Keychain/Keystore with biometric unlock; jailbreak/root detection (heuristic, advisory) |
| Tampering | App tamper / re-pack | Play Integrity / App Attest at session start |
| Repudiation | "Not me using the app" | Device-binding + audit log |
| Information disclosure | MitM via user-installed root CA | Certificate pinning to BORJIE issuer |
| Denial of service | API abuse from mobile | Per-token + per-device rate limit |
| Elevation of privilege | Local privilege bug | Authz enforced server-side; mobile is a UI |

### 8e. Residual risk + watchpoints

- **Watch**: app-store sideloading of a clone. *Mitigation*: in-app self-check + signed update channel; user education in onboarding.

---

## Component 9 — `services/webhooks` (inbound)

### 9a. Assets

- Inbound webhooks from Stripe, M-Pesa, KYC providers, document providers
- Deduplication store

### 9b. Attackers

- **Forger** — without the shared secret
- **Replayer** — with a captured legit payload
- **Slow-loris** — opens a connection and trickles bytes

### 9c. Attack surface

- Public HTTPS endpoint per vendor
- Signature secret in vault

### 9d. STRIDE

| Threat | Vector | Mitigation |
|---|---|---|
| Spoofing | No HMAC | Per-vendor `verify.ts`; reject on mismatch |
| Tampering | Body tamper | HMAC over bytes |
| Replay | Captured body | `(vendor, event_id)` uniqueness + timestamp window |
| DoS | Slowloris | Reverse-proxy timeout; body-size limit |

---

## Component 10 — `packages/database` + Postgres

### 10a. Assets

- All tenant data
- Row-level security policies
- DB credentials

### 10b. Attackers

- **App-level SQL-injection attempter** — through any route that takes user input
- **Compromised app pod** — uses legit creds to bypass RLS
- **Backup thief** — steals a backup file

### 10c. Attack surface

- DB port (private subnet only)
- Backup storage (S3 / cloud blob)

### 10d. STRIDE

| Threat | Vector | Mitigation |
|---|---|---|
| Spoofing | App pretends to be another tenant | RLS uses `auth.jwt() -> tenant_id`; app passes JWT into DB session via `set_config('app.tenant_id', ...)` and policy reads from there |
| Tampering | SQL injection | Prisma / parameterised queries only; raw SQL banned by Semgrep rule |
| Repudiation | Schema-change without trace | Every migration is a git artefact; `migration-safety-check.yml` blocks destructive changes |
| Information disclosure | Backup theft | Backups encrypted with separate KMS key + restored quarterly |
| DoS | Heavy query | Statement timeout; `pg_stat_statements` monitored; index review per PR via `borjie-knip` |
| EoP | DB role escalation | App role has SELECT/INSERT only; UPDATE/DELETE restricted to specific tables + scoped through stored procs |

---

## Cross-cutting threats

### Supply-chain (SolarWinds, Codecov, npm typo-squat lineage)

| Threat | Mitigation |
|---|---|
| Compromised npm package | `pnpm-lock.yaml` frozen; `overrides` block on known-bad versions; SBOM diff alert per release |
| Build-system compromise | Ephemeral runners; signed provenance (cosign keyless → Rekor); admission policy rejects unsigned images |
| Compromised PyPI/CI Action | Pin actions by SHA, not by tag |

### Insider

| Threat | Mitigation |
|---|---|
| Engineer exfiltrates tenant data | Production DB access requires JIT approval (via on-call channel); all queries logged; PII columns require an audit reason |
| Engineer deploys malicious code | Two-reviewer protected `main`; signed commits; CI-only deploy path |

### Privacy (LINDDUN overlay)

| Threat (L/I/N/D/D/U/N) | Mitigation |
|---|---|
| Linkability (cross-session re-identification) | k-anonymity in analytics aggregates; pseudonymise user_id in analytics sink |
| Identifiability | PII scrubber on every log + analytics property |
| Non-repudiation (privacy-side: subject cannot deny) | Right-to-erasure runbook; consent revocation runbook |
| Detectability | Anomaly detection on access patterns |
| Disclosure | TLS + RLS + column encryption for high-PII |
| Unawareness | Consent UX + lawful basis register |
| Non-compliance | DPIA template + quarterly compliance review |

---

## Re-review cadence

- Per component, refreshed quarterly.
- New components MUST have a STRIDE section before they hit production. Enforced by review checklist in PR template (`Docs/CONTRIBUTING.md`).

— Mr. Mwikila
