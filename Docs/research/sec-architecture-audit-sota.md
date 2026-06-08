# Security Architecture — SOTA Audit & Gap Closure Dossier

**Area:** Security Architecture (authn/authz, multi-tenant isolation, agent/LLM security, API security, secrets, supply-chain)
**Repos audited:** Borjie (`/Users/georgesmackbookair/.../Borjie`) + BOSSNYUMBA101 (BN, the ancestor port)
**Date:** 2026-06-08
**Verdict:** **Current level 3.7 / 5 vs SOTA.** The primitives are real, frontier-grade, and largely correct (V8-isolate sandbox, RLS connection-pinning, fail-closed inviolable rail, JWKS Supabase verification, Sigstore-signed AI-BOM). The deltas are (a) one comprehensive AI-security package built but **never wired into the runtime**, (b) the **more-hardened JWT verifier is the dead one** while the live verifier skips `iss`/`aud` validation, (c) **token revocation is process-local** and breaks under HPA, (d) **SAST custom-rule gate is broken/advisory**, and (e) the **kernel-level sandbox isolation (gVisor/Kata RuntimeClass)** that 2026 SOTA now expects for LLM-emitted code is absent. Plus property→mining migration residuals leaking into security-critical copy and the kill-switch operation set.

---

## 1. SOTA reference frame (verified sources)

| Framework / source | What it requires | URL |
|---|---|---|
| OWASP Top 10 for LLM Apps 2025 | LLM01 prompt injection, LLM02 sensitive-info disclosure, LLM03 supply chain, LLM04 data/model poisoning, LLM05 improper output handling, LLM06 excessive agency, LLM07 system-prompt leakage, LLM08 vector/embedding, LLM09 misinformation, LLM10 unbounded consumption | https://genai.owasp.org/resource/owasp-top-10-for-llm-applications-2025/ |
| OWASP Top 10 for Agentic Applications (ASI, Dec 2025) | ASI01 goal hijack, ASI03 identity/privilege abuse, tool misuse, memory poisoning, ASI09 human-agent trust exploitation, ASI10 rogue agents | https://genai.owasp.org/2025/12/09/owasp-top-10-for-agentic-applications-the-benchmark-for-agentic-security-in-the-age-of-autonomous-ai/ |
| NIST SP 800-53 control overlays for AI (COSAiS) + IR 8596 (draft, Dec 2025) | AC/IA/AU/SR control overlays for single- and multi-agent systems; runtime integrity, identity, provenance | https://csrc.nist.gov/projects/cosais |
| Postgres RLS multi-tenancy SOTA | `SET LOCAL`/`set_config(...,true)` per-txn; transaction-mode pooler state-leak hazard; no `BYPASSRLS` on app role; fail-closed (no context ⇒ zero rows); composite `tenant_id`-leading indexes | https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security/ · https://ricofritzsche.me/mastering-postgresql-row-level-security-rls-for-rock-solid-multi-tenancy/ |
| Supabase JWT verification | Validate signature via JWKS **and** `iss` + `aud` (`aud="authenticated"`); trust only `app_metadata` (server-managed); cache JWKS ≤10 min | https://supabase.com/docs/guides/auth/jwts · https://supabase.com/docs/guides/auth/jwt-fields |
| Untrusted-code sandboxing 2026 | V8 isolates = good per-request boundary, but multi-tenant untrusted code is converging on microVM (Firecracker) / gVisor / Kata; "your container is not a sandbox" | https://emirb.github.io/blog/microvm-2026/ · https://northflank.com/blog/how-to-sandbox-ai-agents |
| Supply chain (SBOM/AI-BOM, SLSA, Sigstore) | CycloneDX SBOM + AI-BOM, PURL identifiers, Sigstore/cosign signing, SLSA L1→L4 provenance | https://sbomify.com/compliance/nist-800-53/ · https://docs.sigstore.dev/ |

---

## 2. What Borjie already does at or near SOTA (evidence-backed)

These are NOT gaps — they are the strong base the score rests on.

1. **V8-isolate JS sandbox (LLM-emitted code).** `packages/central-intelligence/src/kernel/sandbox/js-sandbox.ts` runs snippets in `isolated-vm` with own heap, hard V8 memory cap, true wall-clock interrupt timeout, frozen prototypes (`Object.freeze(Object.prototype/...)` before user code), `ExternalCopy` one-way structured-clone boundary, depth/key/array result caps, and a `node:vm`+Worker fallback that **announces reduced isolation on every audit event** (`backend:'node-vm-fallback'`) and a boot-time `probeSandboxBackend()`. Correctly cites that `node:vm` is "not a security mechanism." This is genuinely frontier work for the in-process tier.
2. **RLS connection-pinning (the subtle SOTA hazard, handled).** `services/api-gateway/src/middleware/database.ts:303-394` reserves ONE pooled connection per request, binds `app.current_tenant_id` on it, and runs every statement on that exact connection — explicitly defeating the postgres.js per-statement-connection GUC-leak that the AWS/RLS literature warns about. GUC-bind failure ⇒ 500 `RLS_CONTEXT_FAILED` (fail-closed). Streaming routes use `databaseMiddlewareNoPin` + per-op `set_config(...,true)` to avoid holding a connection across LLM round-trips. This is exactly the 2025 SOTA pattern.
3. **Fail-closed inviolable / meta-rail.** `packages/central-intelligence/src/kernel/inviolable.ts:451,485,605-611` — any throw, malformed field, or ambiguity resolves to `forbid`; explicit denial of "disable/bypass/route-around rail/policy-gate/kill-switch/RLS/money-path." Matches the hard rule "kill-switch fail-closed."
4. **Supabase JWKS verification on the live path.** `hono-auth.ts:157-178` verifies ES256/RS256 via `createRemoteJWKSet`, pins the algorithm per branch (no `alg=none`/confusion), and reads `tenant_id` from `app_metadata` only. HS256 retained solely for self-minted service tokens with algorithm pinning.
5. **Prompt-injection + output-guard, actually wired.** `packages/ai-copilot/src/security/prompt-shield.ts` (40+ patterns, structural analysis, zero-width/null-byte scrub, crypto-nonce prompt boundaries) is invoked per-message in `base-copilot.ts:31,178-203` and `ai-mediator.ts:16-42`, with `output-guard.ts` scanning every LLM emission. Covers LLM01/LLM02/LLM05/LLM07.
6. **SSRF egress boundary.** `packages/enterprise-hardening/src/http/safe-http-fetch.ts` — loopback/link-local/RFC1918/RFC6598/IPv6 denylist + optional allowlist + hard timeout, wired into webhook-delivery, connectors, geo-platform, brain-llm-router fetchers. Plus `tenant-context.middleware.ts:244-312` hardens X-Tenant-ID / Host-header SSRF with regex + `new URL`+`encodeURIComponent`.
7. **Secrets at rest + delivery.** KMS envelope encryption (`packages/database/src/security/encryption/kms-adapter.ts`, region-aware), external-secrets operator with AWS/GCP/kubeseal stores (`k8s/external-secrets/`), gitleaks secret-scan gate failing the build (`borjie-security.yml`).
8. **Supply chain.** CodeQL `security-extended` (`borjie-codeql.yml`), Semgrep registry SARIF, dependabot, **Sigstore/cosign-signed AI-BOM** with keyless OIDC identity regex (`ai-bom-attest.yml:53-66`) — SLSA-provenance-aligned.
9. **K8s pod hardening.** `runAsNonRoot`, `readOnlyRootFilesystem`, `seccompProfile: RuntimeDefault`, `capabilities.drop:[ALL]`, `allowPrivilegeEscalation:false` across helm templates (`k8s/helm/borjie/values.yaml:322-325`, postgres/redis statefulsets).
10. **API hardening.** `helmet()`, default `Cache-Control: private`, env-driven CORS allowlist that is **fatal-if-absent in production** (`index.ts:876-925`), Redis-backed cluster-wide rate-limit + per-tenant budget, idempotency + webhook-idempotency middleware, anomaly detector + step-up MFA + TOTP + WebAuthn wired via `service-registry.ts` / `public-auth-wiring.ts`.

---

## 3. Gaps vs SOTA (every gap, with file:line evidence + buildable closure lane)

### SEC-G1 — `@borjie/agent-security-guard` is built but NEVER wired into runtime  · BLOCKER
- **Evidence:** the package ships a complete OWASP-LLM defense matrix — `packages/agent-security-guard/src/detect/prompt-injection-detector.ts`, `filter/output-filter.ts`, `sandbox/tool-use-validator.ts` (tier-gating, depth=4/width=6 recursion bounds, confirmation gate for T2/destructive), `jailbreak/jailbreak-detector.ts`, `redteam/` (30+ scenarios), `audit/hash-chain.ts`. But the only references to `@borjie/agent-security-guard` anywhere outside the package are **two docstrings** in `packages/database/src/schemas/agent-security.schema.ts:19` and `packages/database/src/schemas/index.ts:1335`. Zero imports in `services/` or any runtime path. The backing tables (`prompt_injection_attempts`, `tool_use_violations`, `output_filter_blocks`, `red_team_runs`, `agent_security_signals`) exist in schema but nothing writes them.
- **Current state:** dark code. The tool-use-validator (the LLM06 "excessive agency" control: authority-tier checks, recursion/fan-out caps, T2 confirmation) does not run in the brain's actual tool-dispatch path (`packages/central-intelligence/src/kernel/orchestrator/tool-dispatcher.ts` has no security check — only a monotonic counter).
- **SOTA target:** OWASP Agentic ASI03 (identity/privilege abuse) + LLM06 demand an enforced tool-authority + recursion bound at dispatch; OWASP LLM01 indirect-injection scanning on tool RESULTS before re-ingestion.
- **Closure lane:** Wire `createToolUseValidator` into `tool-dispatcher.ts` before every dispatch (reject/require-confirmation), wire `createIndirectInjectionDetector` onto tool-result re-ingestion, persist violations via the existing Drizzle tables through `repositories/`. OR formally delete the package if `ai-copilot/src/security` is the canonical stack (decide one — having two parallel injection stacks is itself a maintenance/coverage risk). Effort **L**.

### SEC-G2 — Live JWT verifier (`hono-auth.ts`) does not validate `iss`/`aud`; the hardened verifier is dead  · HIGH
- **Evidence:** all **248** mining route files import `authMiddleware` from `middleware/hono-auth`; **0** import `auth.middleware.ts`. The live `hono-auth.ts:161-163` calls `jwtVerify(token, SUPABASE_JWKS, { algorithms:['ES256','RS256'] })` with **no `issuer` and no `audience`** option. Meanwhile `auth.middleware.ts:252-338` (the dead path) does the correct thing: `looksLikeSupabaseToken`, `iss` checks, `aud`, and explicit **rejection of `user_metadata.tenant_id`** (only trusts `app_metadata`, F6 hardening).
- **Current state:** a signature-valid Supabase JWT from a *different Supabase project / audience* would pass on the live path (signature is the only gate; `app_metadata.tenant_id` is then trusted). Supabase docs require `iss` + `aud="authenticated"` validation.
- **SOTA target:** validate signature **and** `iss` (your project) **and** `aud`; trust only `app_metadata`.
- **Closure lane:** add `issuer: <SUPABASE_URL>/auth/v1`, `audience: 'authenticated'` to the `jwtVerify` options in `hono-auth.ts`; port the `app_metadata`-only/`user_metadata`-reject guard from `auth.middleware.ts:313-338`; then delete or redirect the dead `auth.middleware.ts` so there is one verifier. Effort **M**.

### SEC-G3 — Token revocation blocklist is process-local; breaks under HPA  · HIGH
- **Evidence:** `services/api-gateway/src/middleware/token-blocklist.ts:21` `InProcessTokenBlocklist` uses a per-process `Map`. Comment itself: "For multi-replica deployments this should be swapped for a Redis-backed blocklist." The gateway HPA scales 3-20 replicas (per `database.ts` comment + helm).
- **Current state:** `/auth/logout`, refresh-rotation, and role-change revocation only invalidate the jti on the *one* replica that served the logout. The same token keeps working on the other 2-19 replicas until natural `exp`. This is a real authn-bypass-after-logout.
- **SOTA target:** shared revocation store (Redis) consulted on every verify, or short-lived access tokens + server-side refresh revocation.
- **Closure lane:** implement `RedisTokenBlocklist` behind the existing tiny interface (REDIS_URL is already wired for rate-limit), single-hop `EXISTS jti` lookup in `verifyJwt`/`authMiddleware`; keep in-memory as dev fallback. Effort **M**.

### SEC-G4 — Semgrep custom-rule SAST gate is broken (advisory) — tenant-scoped-repository enforcement never runs  · HIGH
- **Evidence:** `.github/workflows/borjie-semgrep.yml:53-70` — the custom-rule step is wrapped in `|| echo "::warning ... skipped"` because `.semgrep/borjie-rules.yml` is "rejected as invalid by the semgrep CLI." So the rule that enforces tenant-scoped repository access (the codebase's own cross-tenant guardrail) has **never gated a merge**. Registry-rule SARIF is upload-only (non-blocking).
- **Current state:** the bespoke multi-tenant SAST invariant is decorative. Combined with CodeQL also being explicitly non-blocking (`borjie-codeql.yml` header: "Non-build-blocking by default"), there is no hard SAST merge gate.
- **SOTA target:** at least ERROR-severity custom rules block merge; CodeQL `security-extended` results gate via branch protection.
- **Closure lane:** repair `.semgrep/borjie-rules.yml` schema (validate with `semgrep --validate`), drop the `|| echo` fallthrough so ERROR findings exit non-zero; mark CodeQL code-scanning "required" in branch protection. Effort **S**.

### SEC-G5 — No kernel-level isolation (gVisor/Kata RuntimeClass) for V8-sandbox workloads  · MED
- **Evidence:** `grep runtimeClassName|gvisor|kata k8s/**/*.yaml` ⇒ empty. Pods are hardened (seccomp RuntimeDefault, non-root, RO-rootfs, drop ALL) but share the host kernel. The brain executes LLM-emitted JS via `isolated-vm`.
- **Current state:** if an `isolated-vm` (or worse, the `node-vm-fallback`) escape or a native-binding 0-day fires, the blast radius is the host kernel, not a microVM. 2026 SOTA ("your container is not a sandbox") puts untrusted multi-tenant code behind hardware virtualization (Firecracker) or a userspace kernel (gVisor).
- **SOTA target:** run sandbox-executing pods under `runtimeClassName: gvisor` (or Kata/Firecracker) RuntimeClass; isolate the code-exec tier on its own node pool.
- **Closure lane:** add a `RuntimeClass` (gVisor via containerd `runsc`) to the node pool that runs the brain/sandbox; set `runtimeClassName` on those deployments only; load-test under the existing `sandbox-load-test.yml`. Effort **L** (infra).

### SEC-G6 — Property→mining migration residuals leaking into the live security path  · MED
- **Evidence (security-relevant, not cosmetic):**
  - `packages/ai-copilot/src/security/prompt-shield.ts:331` — the runtime `INJECTION_RESISTANCE_INSTRUCTION` injected into the live LLM context still says *"I am here to help with **property management**."* This is the model's anti-injection refusal copy on the active path.
  - `services/api-gateway/src/middleware/kill-switch.middleware.ts:74-99` — the kill-switch operation enum + flag keys are still property-domain: `eviction`, `sublease-cancel`, `monthly-close-reverse`, route comments reference `/leases/:id/terminate`, `/move-out/:leaseId/finalize`. Borjie's irreversible mining ops (licence-suspension, royalty-reversal, offtake-settlement reversal, ore-parcel deletion) are NOT in the guarded set.
  - `auth-core.ts:25`, `hono-auth.ts:62-68`, `tenant-context.middleware.ts` carry `propertyAccess: string[]` (vestigial property scoping).
- **Current state:** (a) the brain tells injection attackers it is a property-management assistant; (b) Borjie's actual high-risk irreversible mutations have **no kill-switch blast-radius cap** — the load-bearing safety lever guards operations the product no longer performs.
- **SOTA target:** kill-switch must guard the real irreversible domain operations; anti-injection persona copy must match the deployed persona.
- **Closure lane:** rewrite `KillSwitchOperation`/`KILL_SWITCH_FLAG_KEYS` to mining ops + apply `killSwitchGuard` to those routes + seed the feature_flags migration; fix `INJECTION_RESISTANCE_INSTRUCTION` to mining domain. Effort **M**.

### SEC-G7 — App-layer `TenantIsolationEnforcer` exists but RLS is the only real gate; no defense-in-depth on read paths  · MED
- **Evidence:** `packages/authz-policy/src/engine/tenant-isolation.ts` provides `assertTenantMatch`, `filterTenantEntities`, `wrapDataAccess`, AsyncLocalStorage context — but it is a library; the live gateway relies on the DB GUC + RLS alone (`databaseMiddleware`). The cross-tenant denial recorder in `tenant-context.middleware.ts:722-785` only fires on `auth.tenantId !== tenant.id` header mismatch, not on a row that slipped RLS.
- **Current state:** single line of defense (RLS). The literature's recommended defense-in-depth (app-layer re-assert + integration tests proving tenant-A cannot read tenant-B) is partially present (`cross-tenant-isolation.test.ts` exists) but the enforcer isn't applied on read repositories.
- **SOTA target:** belt-and-suspenders — RLS + app-layer `assertTenantMatch` on returned rows on high-value reads (ledger, KYC, bids).
- **Closure lane:** wrap the high-value repository reads (payments-ledger, buyers-kyc, bids) with `wrapArrayDataAccess`/`wrapDataAccess` bound to the request `runWithTenantContext`. Effort **M**.

### SEC-G8 — `helmet()` uses framework defaults; CSP/HSTS not explicitly tuned  · LOW
- **Evidence:** `services/api-gateway/src/index.ts:867` `app.use(helmet())` with no options. Default helmet sets a baseline CSP + HSTS, but for a money/AI gateway the CSP should be explicit and report-only-then-enforced; web apps' CSP (Next.js) not audited here.
- **Current state:** acceptable baseline, not tuned for the surface.
- **SOTA target:** explicit CSP (nonce-based for the Next apps), HSTS preload, `frame-ancestors 'none'` for API.
- **Closure lane:** pass an explicit helmet config; add per-app CSP middleware in admin/owner Next configs with nonce. Effort **S**.

### SEC-G9 — Red-team / sycophancy / defection probes run nightly but are not all hard PR gates  · LOW
- **Evidence:** `borjie-redteam.yml` exits 1 on missing config/output and FAILS the PR on threshold breach (good), but `defection-probe.yml`, `sycophancy-probe.yml`, `reflexion-sleep-canary.yml` are nightly/canary — drift can land and only surface next morning.
- **Current state:** detection lag for agentic-behavior regressions (ASI01 goal-hijack / ASI09 trust-exploitation classes).
- **SOTA target:** at least a fast subset of the agentic red-team gates on PR.
- **Closure lane:** add a fast (≤2 min, stub-sensor) agentic red-team smoke to `pr-check.yml`. Effort **S**.

---

## 4. Borjie vs BOSSNYUMBA101 (BN) delta

- BN is the ancestor; Borjie **added** `packages/agent-security-guard` (BN has none) — but added it dark (SEC-G1). Both share the **actually-wired** `ai-copilot/src/security/` stack (prompt-shield, output-guard, owasp-agentic-compliance, canary-tokens, cost-circuit-breaker, pii-scrubber).
- BN ships `packages/litfin-port-security-extra` (signed-event, webhook-signatures, constitutional-rules, anti-fraud-heuristics, gdpr-equivalents) and `packages/security-audit` (tenant-isolation regression harness) that are **not surfaced in Borjie** — porting `security-audit`'s tenant-isolation regression harness would directly help SEC-G7. (Lane: port `security-audit/src/regression/tenant-isolation.ts` from BN.)
- Both carry the same divergent-auth-middleware shape (`hono-auth` live, `auth.middleware` richer-but-dead) — SEC-G2 applies to BN too.

---

## 5. Score rationale

| Dimension | Score /5 | Note |
|---|---|---|
| Multi-tenant isolation + RLS | 4.3 | Connection-pinning is SOTA; single-gate read paths + dead enforcer cap it (G7). |
| Authn/authz | 3.5 | JWKS good; live verifier skips iss/aud (G2); revocation broken at scale (G3). |
| Agent/LLM security | 3.3 | Wired prompt-shield/output-guard real; the comprehensive guard + tool-validator is dark (G1); persona residual (G6). |
| API security | 4.0 | CORS fatal-if-absent, SSRF guard, rate-limit, idempotency strong; helmet untuned (G8). |
| Secrets management | 4.2 | KMS envelope + external-secrets + gitleaks gate. |
| Supply chain | 4.0 | CodeQL/Semgrep/dependabot/Sigstore-AIBOM present; SAST gate broken/non-blocking (G4). |
| Sandbox / code-exec isolation | 3.5 | Best-in-class in-process (V8 isolate); no kernel-level RuntimeClass (G5). |
| **Weighted overall** | **3.7** | Strong primitives; wiring + gating + scale + residuals are the closable delta. |

**Path to 4.5+:** close SEC-G1, G2, G3, G4 (the BLOCKER+HIGHs) — all buildable now with existing infra (Redis, Drizzle tables, dead-but-correct reference code).
