# SPEC — Lane `security-data-p0` (Wave A.3)

**Date:** 2026-06-08
**Branch:** `integration/parity-final`
**Author:** security-data-p0 subagent (file-level design spec; NO code written)
**Scope:** Activate the two dark security/privacy packages in the live runtime and harden the auth + key layers.
**Gaps closed:** SEC-G1 (agent-security-guard dark → wire at dispatch), SEC-G2 (JWT iss/aud), SEC-G3 (token revocation under HPA), SEC-G4 (SAST gate), DP-01 (data-protection dark → breach/RTBF cron), DP-03 (regex-only PII → NER), DP-04 (property residue in data-classification), DP-06 (per-tenant residency KMS).
**Source dossiers:** `Docs/research/sec-architecture-audit-sota.md`, `Docs/research/sec-data-protection-audit-sota.md`, `Docs/research/MASTER_GAP_REGISTER.md` §A.3.

---

## 0. State-of-play corrections (verified against the repo this session)

These change the lane's work from the register's wording. Read first.

1. **DP-02 is ALREADY CLOSED.** Migration `packages/database/src/migrations/0310_corpus_ratings_with_check.sql` (already on disk, BEGIN/COMMIT, idempotent) split `tenant_or_global` on `intelligence_corpus_chunks` + `ratings` into `*_read_tenant_or_global` (SELECT USING) + `*_insert_own_tenant` / `*_update_own_tenant` (WITH CHECK `tenant_id IS NOT NULL AND tenant_id = GUC`) + a `*_service_role_bypass`. The cross-tenant ground-truth poisoning hole is sealed. **No DP-02 work in this lane.** (If unapplied to live, that is a migration-apply task, not a code task.)
2. **The agent-security backing tables already exist.** `packages/database/drizzle/0054_agent_security.sql` creates `tool_use_violations`, `prompt_injection_attempts`, `output_filter_blocks`, `red_team_runs`, `agent_security_signals`; the Drizzle models live in `packages/database/src/schemas/agent-security.schema.ts` and are barrel-exported from `schemas/index.ts`. **SEC-G1 needs NO new migration** — only a Drizzle repository + wiring.
3. **The residency plumbing already exists.** `packages/database/src/security/encryption/index.ts:252 selectEncryptionPortForTenant(...)` and `packages/database/src/security/encryption/get-tenant-region.ts:53 getTenantRegion(...)` are real exports. DP-06 is a **scope lift** (process-singleton → request scope), not new crypto.
4. **The dark-package claims are confirmed.** `grep '@borjie/agent-security-guard'` across `services/`+`apps/` = 0 runtime imports (only 2 docstrings in `database/src/schemas/`). `grep '@borjie/data-protection'` across `services/`+`apps/` = 0. Both packages are built + unit-tested but unreachable.
5. **The DSAR router already fails honestly.** `services/api-gateway/src/routes/dsar.router.ts:381-412` returns `503 RTBF_EXECUTOR_UNAVAILABLE` when `dsarRtbfExecutor` is null — no false guarantee to remove, just an executor to wire (DP-01/DP-08 follow-on).

Highest existing migration on the apply path: **`0312_memory_v2_durable_stores.sql`**. New migrations in this lane start at **`0313`** (append-only; never edit a shipped file — CLAUDE.md hard rule).

---

## 1. SOTA reference frame (verified this session, 2026)

| Control | 2026 SOTA requirement | Source |
|---|---|---|
| Agent tool-use (ASI02 "Tool Misuse", least-agency) | Runtime control problem: least-privilege tool scoping + descriptor sanitisation + **cross-tool composition (recursion/fan-out) bounds** + invocation logging; "only grant the minimum autonomy required" | OWASP Top 10 for Agentic Applications 2026 — https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/ ; ASI02 guide — https://adversa.ai/blog/owasp-asi02-tool-misuse-and-exploitation-the-definitive-security-guide/ |
| Indirect prompt injection (ASI/LLM01) | Scan **tool RESULTS / retrieved content** before re-ingestion; strip payloads | OWASP Agentic 2026 (above); Greshake 2023 |
| Supabase JWT | Verify signature via JWKS **and** `iss` (your project `…/auth/v1`) **and** `aud="authenticated"`; trust only server-managed `app_metadata`; cache JWKS ≤10 min; asymmetric (ES256/RS256) over HS256 | https://supabase.com/docs/guides/auth/jwts ; https://supabase.com/docs/guides/auth/jwt-fields |
| Token revocation at scale | Shared revocation store consulted on every verify (per-process Map breaks under HPA) | OWASP ASI03; Supabase signing-keys (rotate/revoke without redeploy) — https://supabase.com/docs/guides/auth/signing-keys |
| PII detection | Hybrid **regex + NER (ML) + context-aware confidence** (Presidio model); regex alone misses free-text PII; placeholder-substitution before LLM egress | Microsoft Presidio analyzer — https://microsoft.github.io/presidio/analyzer/ ; https://oneuptime.com/blog/post/2026-01-30-llmops-pii-detection/view |
| Field-level encryption / residency | Per-region CMK; KMS is single-Region-isolated by design — residency compliance favors a **region-bound CMK per tenant** over a multi-Region key (which moves key material across borders) | AWS KMS multi-Region security considerations — https://docs.aws.amazon.com/kms/latest/developerguide/mrk-when-to-use.html ; data residency — https://docs.aws.amazon.com/kms/latest/developerguide/data-protection.html |
| Envelope encryption | Long-lived KEK in HSM/KMS wrapping short-lived per-row DEK; AAD binds (tenant, table, column) | NIST SP 800-57 Pt1 Rev5 — https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final ; OWASP Crypto Storage CS |
| SAST gate | ERROR-severity custom rules **must exit non-zero** (block merge); CodeQL `security-extended` required in branch protection | OWASP / GitHub code-scanning guidance |

---

## 2. SEC-G1 — Activate `@borjie/agent-security-guard` in the agent execution path · BLOCKER

### Current state (file-level)
- The brain main-loop dispatches tools through `packages/central-intelligence/src/kernel/orchestrator/tool-dispatcher.ts → createToolDispatcher(...)`. The only pre-dispatch guard today is the orchestrator's **9-hook PreToolUse chain** assembled in `services/api-gateway/src/composition/orchestrator-bindings.ts:683 buildProductionHookChain(...)` — it has `createPermissionHook({scopes})` (a flat scope-map), a denylist hook, rate-limit, cost-circuit, `createSandboxDivertHook`, audit, ledger-seal. It does **not** enforce: authority-tier rank (T0<T1<T2), per-branch recursion depth / sibling-fan-out caps, a T2/destructive **confirmation gate**, nor any scan of tool RESULTS.
- `tool-dispatcher.ts:87` calls `config.registry.runTool(toolName, input)` with **no security check** — only a try/catch mapping outcomes.
- `packages/agent-security-guard/src/sandbox/tool-use-validator.ts:81 createToolUseValidator(...)` already implements exactly the missing matrix (unknown_tool / authority_escalation / schema_violation / missing_confirmation / recursion_limit → `allow` | `reject` | `require-confirmation` with a hash-chained `ToolUseViolation`). `createIndirectInjectionDetector()` (`detect/indirect-injection-detector.ts:46`) already strips injection payloads from retrieved text and returns `redactedInput`.
- Backing tables exist (`0054_agent_security.sql`); repository **ports** are declared (`agent-security-guard/src/repositories/types.ts`) but only **in-memory** impls ship.

### Target (file-level closure)
Wire the validator as a **PreToolUse gate inside the dispatcher**, and the indirect detector as a **PostToolUse scan on tool RESULTS**, persisting violations through a new Drizzle repository. Keep it additive — it runs **before** `runTool` and can only narrow (reject / require-confirmation), never widen, so it composes with the existing 9-hook chain.

1. **New file `packages/central-intelligence/src/kernel/orchestrator/security-guard-port.ts`** — a thin port interface the dispatcher accepts (so `central-intelligence` does NOT take a hard dependency on `@borjie/agent-security-guard`; same duck-typing discipline used for `spawnHandler`):
   ```
   export interface DispatchSecurityGuard {
     readonly validateToolCall: (a: {
       toolName: string; input: unknown; callerTier: 'T0'|'T1'|'T2';
       confirmed: boolean; callDepth: number; siblingsAtThisDepth: number;
       tenantId: string; agentKind: string;
     }) => { decision: 'allow'|'reject'|'require-confirmation'; rationale: string };
     readonly scanToolResult: (a: { source: string; text: string }) =>
       { detected: boolean; redactedInput: string; highestSeverity: string|null };
   }
   ```
2. **Edit `tool-dispatcher.ts`** — add optional `securityGuard?: DispatchSecurityGuard` + the dispatch's `callDepth`/`siblings` (already threaded on `HookContext`; read from `ctx`) to `ToolDispatcherConfig`. In `dispatchToolCall` (line 81), BEFORE `runTool`:
   - call `securityGuard.validateToolCall(...)`. On `reject` → return `tool_error` with the rationale (fail-closed). On `require-confirmation` when the decision wasn't pre-confirmed → return a new `DispatchResult` variant `{kind:'tool_blocked', callId, reason, requiresConfirmation:true}` (add to `decision.ts` `DispatchResult` union; the main-loop already re-plans on non-ok results). On `allow` → proceed.
   - AFTER `runTool` returns `ok`, if the tool output carries free text (e.g. retrieval / browser / corpus tools), call `securityGuard.scanToolResult(...)` and substitute `redactedInput` into `outcome.output` before returning `tool_ok` (LLM01 indirect-injection on re-ingestion). Gate this by a tool-name allowlist of "content-returning" tools to avoid scanning structured payloads.
3. **New Drizzle repository `packages/database/src/repositories/tool-use-violation.repository.ts`** implementing `ToolUseViolationRepository` from the guard package against the existing `toolUseViolations` table (insert-only, append the `auditHash` already computed by `makeViolation`). RLS-respecting: writes ride the request connection (`app.current_tenant_id` GUC bound by `database.ts`), `tenant_id` taken from the validated attempt. Mirror for `prompt_injection_attempts` if the result-scan finds a hit.
4. **New composition file `services/api-gateway/src/composition/agent-security-guard-wiring.ts`** — `createAgentSecurityGuardWiring(db)`:
   - builds the guard package's `createToolUseValidator({ registry: <adapter over the kernel BrainToolRegistry → ToolRegistry shape>, maxDepth:4, maxWidth:6 })` and `createIndirectInjectionDetector()`;
   - adapts the kernel `BrainToolRegistry` to the guard's `ToolRegistry` port (name → `{requiredTier, argsSchema, requiresConfirmation}`); derive `requiredTier`/`requiresConfirmation` from the existing tool-scope map + a small static "destructive tool" set (licence-suspension, royalty-reversal, offtake-settlement-reversal, ore-parcel-delete — the same irreversible mining ops named in SEC-G6);
   - returns a `DispatchSecurityGuard` whose `validateToolCall` maps the guard's `ToolDecisionResult` and **persists** every non-allow `violation` via the new repository (fire-and-forget with a Pino `warn` on sink failure — never block the gate on the audit write, but never swallow silently);
   - returns `null` when `db` is absent (degraded/test) so the dispatcher runs unguarded only in dev, exactly like the other wirings.
5. **Edit `services/api-gateway/src/composition/brain-kernel-wiring.ts:948`** (`buildOrchestratorComposeBlock`) — thread the guard into the `orchestrator.createToolDispatcher({ registry, spawnHandler, securityGuard, logger })` call; build the guard once at compose time from the same `args.db` the memory tool uses. The **child sub-MD** dispatcher inherits it too (the spawn handler reuses `args.toolRegistry` + the same hook chain), so recursion caps apply across the parent/child tree.

### Decision (the audit asks for one)
Keep **`ai-copilot/src/security`** (prompt-shield/output-guard) as the canonical **input/output** stack (it is already wired per `base-copilot.ts`), and adopt **`agent-security-guard`** as the canonical **tool-dispatch** stack (the layer ai-copilot does not cover). They are complementary, not duplicative — do NOT delete either. Document this split in `Docs/SECURITY/AI_AGENT_SECURITY_SOTA_2026.md`.

### Tests
- `packages/central-intelligence/src/kernel/orchestrator/__tests__/tool-dispatcher-security.test.ts`: T1 caller invoking a T2 tool → `tool_error` (authority_escalation); depth=5 → reject (recursion_limit); destructive tool without `confirmed` → `tool_blocked`; an `allow` path unchanged vs the pre-guard golden.
- `…/agent-security-guard-wiring.test.ts`: violation persisted to `tool_use_violations` with correct `tenant_id` + `auditHash`; sink failure does not throw.
- `…/indirect-injection-result-scan.test.ts`: a corpus tool returning a `[system] ignore previous instructions` payload → `tool_ok.output` contains `[REDACTED:INDIRECT-INJECTION]`.

### Reversibility / rollout
Pure additive + null-safe. Add env `BORJIE_AGENT_SECURITY_GUARD` (default `on` in prod, `off` allowed for incident rollback) read in the wiring; when `off`, pass `securityGuard:undefined` to the dispatcher (identical to today). No migration; ships behind the same default-on/env-kill pattern as the orchestrator main-loop.

---

## 3. SEC-G2 — JWT `iss`/`aud` validation on the live verifier · HIGH

### Current state
- All mining routes use `services/api-gateway/src/middleware/hono-auth.ts → authMiddleware`. At line 161 it calls `jwtVerify(token, SUPABASE_JWKS, { algorithms:['ES256','RS256'] })` with **no `issuer`, no `audience`** option. A signature-valid Supabase JWT from a *different project/audience* passes; `app_metadata.tenant_id` is then trusted (line 169).
- The hardened, correct verifier `services/api-gateway/src/middleware/auth.middleware.ts:292 verifyAndProjectSupabaseToken(...)` already does `iss` + `app_metadata`-only + `user_metadata`-reject (lines 313-338) but is imported by **0** route files (dead path).

### Target
1. **Edit `hono-auth.ts`** — derive the issuer once at module load next to `SUPABASE_BASE_URL` (line 18): `const SUPABASE_ISSUER = SUPABASE_BASE_URL ? \`${SUPABASE_BASE_URL.replace(/\/+$/,'')}/auth/v1\` : ''`. Add to the `jwtVerify` options (line 161): `issuer: SUPABASE_ISSUER || undefined, audience: 'authenticated'`. (jose throws `JWTClaimValidationFailed` on mismatch → caught by the existing `catch` → 401 `INVALID_TOKEN`, no new branch needed.)
2. **Port the `app_metadata`-only / `user_metadata`-reject guard** from `auth.middleware.ts:313-338` into the ES256/RS256 branch (after line 169): reject (`throw new Error('tenant_id must come from app_metadata')`) when `sp.app_metadata?.tenant_id` is absent but a `user_metadata.tenant_id` is present. The branch already reads only `app_metadata` — make the rejection explicit so a token carrying only `user_metadata.tenant_id` cannot silently flow as `tenantId:''`.
3. **Collapse the dead verifier.** Either delete `auth.middleware.ts` or re-export `authMiddleware` from `hono-auth` under its name; keep ONE verifier of record. Update the 0 importers (none) and remove its test if it only covered the dead path; otherwise retarget the iss/aud assertions onto `hono-auth`.
4. **Configuration:** issuer must come from `SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_URL` (already read at line 19). No new env. Document in `Docs/CODEMAPS/api-gateway.md` that `SUPABASE_URL` is now load-bearing for `iss` validation (boot still succeeds without it; ES256 tokens are then rejected — fail-closed, which is correct).

### Tests
`services/api-gateway/src/middleware/__tests__/hono-auth-iss-aud.test.ts`: valid token from the configured issuer with `aud:authenticated` → 200; same signature with `iss` of another project → 401; `aud:'anon'` → 401; token with only `user_metadata.tenant_id` → 401; legacy HS256 service token path unchanged.

### Reversibility / rollout
Tightening — could 401 tokens that were silently accepted before. Roll out by first asserting in staging that all live Supabase tokens carry `iss = <SUPABASE_URL>/auth/v1` and `aud='authenticated'` (they do per Supabase spec). No env flag needed; revert is a one-line option removal.

---

## 4. SEC-G3 — Redis-backed token revocation (HPA-safe) · HIGH

### Current state
`services/api-gateway/src/middleware/token-blocklist.ts:20 InProcessTokenBlocklist` is a per-process `Map` (its own comment admits it must become Redis-backed). The gateway HPA scales 3-20 replicas, so `/auth/logout` only revokes on the replica that served the logout — authn-bypass-after-logout on the other replicas until natural `exp`. `hono-auth.ts:192` consults `tokenBlocklist.isRevoked(jti)` synchronously.

### Target
1. **New file `services/api-gateway/src/middleware/redis-token-blocklist.ts`** — `class RedisTokenBlocklist` behind the same tiny interface (`revoke(jti, exp)` / `isRevoked(jti)` plus an async `isRevokedAsync(jti)`). `revoke` → `SET blk:<jti> 1 PXAT <exp*1000>` (Redis auto-expires at the token's own exp — no reaper needed). `isRevokedAsync` → `EXISTS blk:<jti>` single hop. Reuse the SAME ioredis client construction pattern already in `rate-limit-redis.middleware.ts` (degrade-on-error with a one-shot Pino `warn` + Sentry hook; status flag for `/health/deep`).
2. **Make the verify-time check async.** `hono-auth.ts:192` becomes `if (decoded.jti && await tokenBlocklist.isRevokedAsync(decoded.jti))`. The middleware is already `async`, so this is a one-line change. **Fail-closed posture:** on a Redis error during the check, log + treat as **not revoked is NOT acceptable for a security gate** — instead, when Redis is unreachable, fall back to the in-process Map (which still catches same-replica logouts) AND surface the degraded state on `/health/deep` so ops can page; do not 500 every request (availability), but record the gap. (Documented trade-off; matches the rate-limiter's degrade philosophy.)
3. **Composition:** construct the blocklist in `services/api-gateway/src/index.ts` boot where the ioredis client is already created (it is, for rate-limit), and inject it; keep the module-singleton `tokenBlocklist` export as a façade that delegates to the Redis impl when wired, the Map otherwise (dev). Every existing `tokenBlocklist.revoke(...)` call site (logout, refresh-rotation, role-change) is unchanged.
4. **No migration** (Redis only). Requires the HA Redis from RSS-09 to be a hard dependency in prod — note the cross-lane dependency.

### Tests
`__tests__/redis-token-blocklist.test.ts` (ioredis-mock): revoke then `isRevokedAsync` true; PXAT past exp → false; two simulated "replicas" sharing one Redis both see the revocation; Redis-down → degrades to Map + flips the health flag.

### Reversibility / rollout
Façade keeps the export name; revert = stop injecting the Redis impl. Behind `REDIS_URL` presence (already required in prod).

---

## 5. SEC-G4 — Repair the Semgrep custom-rule SAST gate · HIGH (effort S)

### Current state
`.github/workflows/borjie-semgrep.yml:53-70` wraps the custom-rule step in `|| echo "::warning … skipped"` because `.semgrep/borjie-rules.yml` is rejected by `semgrep --validate`. The tenant-scoped-repository rule has never gated a merge. CodeQL is also explicitly non-blocking.

### Target
1. **Fix `.semgrep/borjie-rules.yml`** so `semgrep --validate --config .semgrep/borjie-rules.yml` exits 0 (correct rule schema: `rules[].id/severity/languages/message/pattern(s)`; severity `ERROR` for the tenant-scope rule). Read the validator error first, fix the offending key(s).
2. **Edit `borjie-semgrep.yml`** — drop the `|| echo … skipped` fallthrough on the custom-rule step so an `ERROR` finding exits non-zero and **fails the PR**. Keep registry-rule SARIF upload as advisory.
3. **Branch protection:** mark CodeQL `security-extended` code-scanning **required** for `main`/`integration/parity-final` (repo setting, documented in `CLAUDE.md` CI inventory — already lists `borjie-semgrep.yml`/`borjie-codeql.yml`).
4. No app code, no migration.

### Tests
A deliberate fixture file under `.semgrep/__fixtures__/` containing an unscoped tenant query → CI run shows the job FAILS (the gate fires). A correctly-scoped sibling → passes.

### Reversibility
Revert the YAML two-line change; un-require the check. Low blast radius (CI only).

---

## 6. DP-01 — Wire `@borjie/data-protection` (breach detection + RTBF crypto-shred) · HIGH

### Current state
`@borjie/data-protection` (RTBF orchestrator, retention runner, `breach/breach-detector.ts:101 detectBreaches(...)`, `breach/breach-notifier.ts`, `encrypt/envelope.ts cryptoShred()`, `lineage/provenance-tracker.ts`) is invoked by **zero** runtime code (`grep` in `services/`+`apps/` = 0). The `breach_events` table exists (drizzle/0053). The DSAR router (`dsar.router.ts`) wires the *ai-copilot* `DsarRtbfExecutor` and returns honest 503 when null.

### Target
1. **New composition file `services/api-gateway/src/composition/data-protection-wiring.ts`** — `createDataProtectionWiring(db)`:
   - constructs an adapter that reads recent `audit_events` (the hash-chained access log) and maps each into the guard's `AccessEvent` shape (`actorId, tenantId, resource, classes, rowCount, geo, at, directDb`) — `classes` derived from the table+column via the DP-04 mining classification registry (§8);
   - exposes `runBreachSweep()` calling `detectBreaches({events, knownGeosByActor, config: DEFAULT_DETECTOR_CONFIG})`, **persisting** each `BreachFinding` into `breach_events` (new Drizzle repo `breach-event.repository.ts`) and driving `breach-notifier` to start the **72h PDPA s.30 / GDPR Art.33 clock**.
2. **New cron registration** in the gateway cron block (`services/api-gateway/src/index.ts` cron section, wrapped in `withClusterLock('data-protection-breach-sweep')` per RSS-06 so it runs on ONE replica): every 5 min sweep the last window of `audit_events`.
3. **DP-08 follow-on (same wiring):** make the DSAR RTBF executor delegate **encrypted-PII erasure** to `cryptoShred()` (key-shred the per-subject DEK) + the data-protection RTBF orchestrator state machine, which **pseudonymises** (never mutates) the hash-chained `audit_events`. Inject the data-protection executor into `dsar.router.ts:196 resolveRtbfExecutor` so the 503 path becomes a real erasure. Preserve the audit hash-chain invariant (CLAUDE.md: append-only, no mutation).
4. **Migration:** `breach_events` already exists; only add a forward migration `0313_breach_events_72h_clock.sql` IF the notifier needs a `notification_due_at timestamptz` / `notified_at` column not already present (verify against drizzle/0053 first; if present, no migration). Any new table is RLS+FORCE, `tenant_id`-scoped, canonical `app.current_tenant_id` GUC, with a `*_service_role_bypass` policy mirroring 0310's shape.

### Tests
`__tests__/data-protection-wiring.test.ts`: a synthetic bulk-export `audit_event` (rowCount>500) → one `breach_events` row + notifier scheduled with `due_at = detectedAt + 72h`; RTBF delegates to `cryptoShred` and the audit row is pseudonymised not deleted (hash-chain `verifyChain` still passes).

### Reversibility / rollout
Cron behind `withClusterLock` + an env kill (`BORJIE_BREACH_SWEEP=on`). RTBF executor injection is additive (replaces a 503 with a real path); revert = stop injecting.

---

## 7. DP-03 — Hybrid regex + NER PII detection behind `PiiDetectorPort` · HIGH

### Current state
Every detector is substring/regex: `data-protection/classify/auto-tagger.ts` (field-name substrings), `ocsf-emitter/redaction.ts`, `observability/pii-redactor.ts` (key-name match — blind to PII in free-text VALUES), and the privacy-router's `PiiStripperPort` impl. Free-text PII (names in `kyc_notes`, transcripts, `extracted_text`) routed to cloud LLMs can leak. The privacy-router ALREADY accepts an injected `PiiStripperPort` (`packages/privacy-router/src/types.ts:86`) and `containsPii`/`stripPii` are the swap points (`router.ts:123,145,180`).

### Target — hybrid (regex first-pass kept, NER added), per the Presidio model
1. **New package `packages/pii-ner`** (small leaf): a `PiiDetectorPort` with `detect(text): Span[]` + `strip(text, knownNames): StripResult`. Implementation tiers:
   - **Tier 1 (default, no native deps):** keep the existing high-precision regex/Luhn/E.164/NIDA/TIN patterns as the first pass (port from auto-tagger) — fast, deterministic, no false-negatives on structured IDs.
   - **Tier 2 (NER):** call a **Presidio-compatible sidecar** over HTTP (a `PiiAnalyzerPort` injected; the privacy-router already enforces fail-closed DENY when the local endpoint is down, so an unreachable NER sidecar degrades to Tier-1 regex + classification, never to plaintext egress). The sidecar runs Presidio (spaCy `en_core_web_trf` / HF transformer NER) for PERSON/LOCATION/ORG in free text. Reversible token-substitution mappings preserved for response restoration (the router's `StripResult.mappings` already supports this).
2. **Swap the impl, not the interface.** `services/api-gateway/src/composition/privacy-router-wiring.ts` constructs the `PiiStripperPort` — replace the regex-only stripper with the new hybrid `pii-ner` stripper (regex ∪ NER). No change to `router.ts`. Wire the same hybrid detector into `data-protection/classify/auto-tagger.ts` consumers for value-level (not just key-name) tagging.
3. **Residency-safe:** the NER sidecar is on-prem (RESTRICTED data never leaves) — consistent with the privacy-router's `RESTRICTED → local-only` rule. The sidecar URL is a new env (`PII_NER_URL`), read once at composition (NOT in the leaf package — CLAUDE.md no-process.env-outside-bootstrap).
4. No migration.

### Tests
`packages/pii-ner/__tests__/`: a sentence "Call John Mwangi at +255712345678, NIDA 19900101-12345-00001-23" → regex catches phone+NIDA, NER catches PERSON; sidecar-down → Tier-1 only (phone+NIDA still stripped, PERSON missed) but classification still forces RESTRICTED → DENY for cloud. Privacy-router integration test: a CONFIDENTIAL task carrying a free-text name → `strippedFields` includes the NER span.

### Reversibility / rollout
Behind `PII_NER_URL` presence (absent → pure regex, today's behaviour). Additive; revert = unset the env.

---

## 8. DP-04 — Rewrite `data-classification.ts` for the mining schema · HIGH

### Current state
`packages/database/src/security/data-classification.ts` `ENTRIES` (lines 58-512) classify **property-management** tables: `customers`, `leases`, `payments`, `gepg_transactions`, `marketplace_listings.lister_phone`, `voice_turns`, `tenant_predictions`. This registry **drives `encryptRow`** (`drizzle-encryption-middleware.ts:208 classificationsForTable(table).filter(encryptAtRest)`) and **`maskValue`** (consumed by `classification-scrubber.ts`, `error-envelope.ts`, `portal-genui-wiring.ts`, etc.). Mining PII tables (`licences`, `persons`, buyer/workforce KYC) are **absent** → unregistered → INTERNAL fallthrough → `encryptRow`/`maskValue` silently **no-op** on real mining PII. The encryption middleware is wired but pointed at a dead table list.

### Target
1. **Edit `data-classification.ts`** — replace the property `ENTRIES` with mining-schema entries, sourced from the real schemas (`packages/database/src/schemas/{licences,persons,buyer-extensions,mining-workforce-extensions,workforce,workforce-certifications,workforce-invitations}.schema.ts`). At minimum classify:
   - **licence holder PII:** licence-holder NIDA/TIN, beneficial-owner identity (RESTRICTED, encryptAtRest, mask `id`);
   - **buyer KYC:** buyer NIDA/passport, KYC document URLs, sanctions-screening notes (RESTRICTED);
   - **workforce employee PII:** employee NIDA, phone, next-of-kin, certifications, biometric/photo URLs (RESTRICTED/CONFIDENTIAL);
   - **persons** free-text + contact columns;
   - **assay / geo coordinates** where re-identifying a deposit location is sensitive (CONFIDENTIAL — business-sensitive, not PII, but flag).
   Keep the immutable frozen-tuple pattern, the `RetentionWindow`/`MaskType` enums, and the `audit_events.actor_email` permanent/pseudonymise-on-RTBF row. **Delete the property rows.**
2. **Update the module docstring** (lines 1-20) from "property-management + TZ/KE PII / lease tenancy" to the mining estate domain.
3. **No migration** — this is a code registry, not a DB schema. But: the data is now *actually* encrypted where it was plaintext before, so a **backfill** consideration arises — see rollout.

### Tests
`__tests__/data-classification-mining.test.ts`: `classify('licences','holder_nida').level === 'RESTRICTED' && encryptAtRest`; no property table names remain (`listClassifications().every(e => !['leases','payments','customers'].includes(e.table))`); `classificationsForTable('persons')` non-empty.

### Reversibility / rollout
**Backfill caution (the real risk):** flipping a column to `encryptAtRest:true` means NEW writes get `enc:v1:` ciphertext while OLD rows are plaintext. The middleware already does legacy-plaintext pass-through on read (`drizzle-encryption-middleware.ts` idempotent `enc:v1:` prefix), so reads stay correct; schedule a one-time `re-encrypt` backfill (reuse the DP-05 `re-encrypt-field-deks` job shape) AFTER this lands. Revert = restore the prior ENTRIES (kept in git history). Pairs with DP-06 so the encryption uses the right regional CMK.

---

## 9. DP-06 — Per-tenant data-residency KMS (request-scope encryption port) · HIGH

### Current state
`services/api-gateway/src/middleware/database.ts:170 buildEncryption(...)` constructs the encryption port as a **module-load singleton** bound to `env.AWS_REGION` (documented gh-#42 in the 35-line comment at lines 133-168). ZA/NG/KE tenants are encrypted under the platform-default region's CMK, not their residency-region CMK. `selectEncryptionPortForTenant(env, {tenantId, regionResolver, logger})` (`security/encryption/index.ts:252`) + `getTenantRegion(db, tenantId)` (`get-tenant-region.ts:53`) already exist; referenced only in the comment.

### Target — lift the port from process scope to request scope
1. **Edit `database.ts`** — in the per-request database middleware (the same place the `app.current_tenant_id` GUC is bound on the reserved connection), after the tenant is known, construct/resolve a **request-scoped** encryption port via `selectEncryptionPortForTenant(process.env, { tenantId: auth.tenantId, regionResolver: (id) => getTenantRegion(db, id), logger })`. Memoise per-region (a small `Map<region, EncryptionPort>` at module scope — the PORT is region-keyed, safe to share; only the *selection* is per-request) so we are not re-instantiating a KMS client per request.
2. **Thread the port to repositories per-request.** Two options; pick **(b)**:
   - (a) construct every repo per-request (touches >15 repo classes) — heavy;
   - (b) **pass the port as a per-call argument** into the encrypt/decrypt entry points the repos already call (`encryptRow(row, {port})` / `decryptRow`). The repos hold a *default* port (today's singleton, kept for service/cron paths with no tenant) and accept an override. The request middleware sets `c.set('encPort', regionPort)`; tenant-scoped repos read it. This is the smaller diff and matches the OCR factory precedent the comment cites (`document-intelligence/src/providers/ocr-factory.ts`).
3. **`getTenantRegion`** reads the tenant's residency region (new column if absent — verify `tenants` schema; if no `data_residency_region`, add migration `0313_tenants_residency_region.sql`: `ALTER TABLE tenants ADD COLUMN data_residency_region text` default the platform region, backfilled; RLS unchanged — `tenants` is already tenant-scoped). **Use a single-Region CMK per region** (NOT a multi-Region key — per AWS guidance a multi-Region key moves material across borders, defeating residency). The KMS adapter is already region-aware (`kms-adapter.ts` EncryptionContext binds tenant/table/column as AAD).
4. **TZ PDPA §31 posture:** domestic RESTRICTED data for a TZ tenant stays under the `af-*`/eu-default CMK chosen for TZ; the privacy-router already enforces RESTRICTED→local-only for inference. This closes the *key-residency* leg the YAML policy documented but never enforced.

### Tests
`__tests__/database-residency-kms.test.ts`: a request for a tenant with `data_residency_region='af-south-1'` resolves a port whose KMS client targets `af-south-1`; a tenant with no region falls back to the platform default; the per-region port Map is reused (no second client construction for the same region).

### Reversibility / rollout
**Crypto-migration caution:** existing ciphertext was minted under the default-region DEK; the DEK is wrapped by the default CMK. Switching a tenant to a new regional CMK affects only NEW DEKs — old DEKs still decrypt under the old CMK (the wrapped-DEK packs its key id). So this is forward-safe with NO re-encrypt required for correctness; an optional residency-compliance re-encrypt (DP-05 job) migrates historical rows region-by-region. Behind `getTenantRegion` returning non-default; default region = today's behaviour. Revert = keep the singleton path (the per-call port arg defaults to it).

---

## 10. Cross-lane dependencies & ordering

| This gap | Depends on | Note |
|---|---|---|
| SEC-G3 (Redis blocklist) | RSS-09 HA Redis | shares the ioredis client; hard prod dep |
| DP-01 breach cron | RSS-06 `withClusterLock` | one-replica execution |
| DP-04 → DP-06 | order: DP-04 first | classify mining cols, THEN encrypt them under the right regional CMK |
| DP-06 → DP-05 | DP-05 re-encrypt job | optional historical residency migration |
| SEC-G1 child caps | brain sub-MD spawn | recursion bound spans parent/child tree |

**Suggested build order within the lane:** SEC-G4 (S, CI-only, unblocks the SAST gate for everything else) → SEC-G2 (M, one-file tightening) → SEC-G3 (M) → DP-04 (M) → DP-06 (M) → SEC-G1 (L) → DP-01/DP-03 (L).

---

## 11. Hard-rail compliance checklist (every item honoured)

- **RLS never weakened.** SEC-G1 violation writes ride the request GUC connection; DP-01/DP-04/DP-06 add no RLS bypass; any new table is ENABLE+FORCE RLS, canonical `app.current_tenant_id`, with a `*_service_role_bypass` mirroring 0310.
- **Supabase-JWT canonical.** SEC-G2 hardens (iss/aud/app_metadata) — no Clerk, no new auth provider.
- **Append-only migrations.** New files start at `0313`; no shipped file edited; each idempotent (guarded CREATE, IF EXISTS DROP).
- **Kill-switch / gate fail-closed.** SEC-G1 rejects on guard error; SEC-G2 401s on claim mismatch; the agent can never touch the meta-rail.
- **Money path untouched.** No `LedgerService.post` change; DP-08 RTBF pseudonymises (never mutates) the hash-chained audit.
- **No `console.*` in services.** All new wirings take a Pino logger; degrade paths `logger.warn`.
- **`formatCurrency` multi-currency.** No money render added; no TZS/USD hard-code.
- **EN/SW absolute toggle.** No user-facing copy added except 401/refusal error CODES (locale-resolved by the existing envelope); no mixed-language strings.
- **Evidence-required AI output / audit chain.** SEC-G1 persists hash-chained `ToolUseViolation`; DP-01 preserves `audit_events` hash-chain.
- **No reflective CORS / raw HTML.** Untouched.

---

## 12. Files to change (authoritative list)

**New:**
- `packages/central-intelligence/src/kernel/orchestrator/security-guard-port.ts`
- `packages/database/src/repositories/tool-use-violation.repository.ts`
- `services/api-gateway/src/composition/agent-security-guard-wiring.ts`
- `services/api-gateway/src/middleware/redis-token-blocklist.ts`
- `services/api-gateway/src/composition/data-protection-wiring.ts`
- `packages/database/src/repositories/breach-event.repository.ts`
- `packages/pii-ner/` (new leaf package)
- `packages/database/src/migrations/0313_*.sql` (only if `tenants.data_residency_region` and/or breach 72h columns are absent — verify first)
- tests as named per section

**Edited:**
- `packages/central-intelligence/src/kernel/orchestrator/tool-dispatcher.ts` (+ `decision.ts` `DispatchResult` union)
- `services/api-gateway/src/composition/brain-kernel-wiring.ts` (`buildOrchestratorComposeBlock` dispatcher call)
- `services/api-gateway/src/middleware/hono-auth.ts` (iss/aud + app_metadata reject + async blocklist check)
- `services/api-gateway/src/middleware/auth.middleware.ts` (delete/collapse to one verifier)
- `services/api-gateway/src/middleware/token-blocklist.ts` (façade delegating to Redis impl)
- `services/api-gateway/src/middleware/database.ts` (request-scope encryption port)
- `packages/database/src/security/data-classification.ts` (mining ENTRIES)
- `services/api-gateway/src/composition/privacy-router-wiring.ts` (hybrid PII stripper)
- `services/api-gateway/src/index.ts` (breach-sweep cron + Redis blocklist injection)
- `services/api-gateway/src/routes/dsar.router.ts` (inject data-protection RTBF executor)
- `.github/workflows/borjie-semgrep.yml` + `.semgrep/borjie-rules.yml`
- `Docs/SECURITY/AI_AGENT_SECURITY_SOTA_2026.md` + `Docs/CODEMAPS/api-gateway.md` (doc the two-stack split + SUPABASE_URL load-bearing)
