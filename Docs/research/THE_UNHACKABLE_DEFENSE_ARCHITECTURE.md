# THE UNHACKABLE DEFENSE ARCHITECTURE

**Date:** 2026-06-09
**Branch:** `integration/parity-final`
**Author:** security-reviewer synthesis (repo-grounded; every file:line re-verified against live tree)
**Scope:** Borjie + BossNyumba (same posture, same fixes, both repos)
**Synthesises:**
- `Docs/research/unhackable-posture-sota.md` (2026 SOTA survey)
- `Docs/research/our-posture-audit.md` (adversarial repo audit)
- `Docs/research/ip-leak-audit.md` (client-facing leak audit, L1–L8)
- `Docs/research/MASTER_GAP_REGISTER.md` (Unhackable posture L718–737; INV-H/D L583–621; SEC-G1 L120)

> **Thesis.** "Unhackable" is a **posture**, not a wall: defense-in-depth + assume-breach +
> continuous red-team, where (a) the client holds **zero** inspectable secrets/prompts/IP, (b) the
> brain is **structurally** jailbreak/injection-resistant because the rail and the IP live OUTSIDE
> the LLM, and (c) every guarantee is **continuously proven** by an adversary in CI. The 2026
> frontier consensus is blunt: prompt injection cannot be solved inside the model — the win is
> *containment by architecture* + *continuous proof*. This doc is the **buildable** version of that
> bar: every control mapped to a file, every hole to a `file:line` + fix, every fix to a wave.

> **Verdict (re-verified today).** Core is STRONG and real: secrets, RLS FORCE + WITH CHECK,
> non-reflective CORS, Supabase-JWT + Redis revocation, isolated-vm sandbox, CodeQL/Semgrep/redteam
> CI. The exploitable class is **defense-built-but-dark**: the IP-egress firewall, the immune
> screener, the tool-use validator, and the tool-result boundary all **exist in code but are wired
> into nothing**, and an **unauthenticated `/api/public/chat` route ships the full IP system prompt
> to a raw LLM call with zero rails**. That is the launch BLOCKER set.

---

## 1. THE DEFENSE-IN-DEPTH STACK — layer-by-layer, exact control, status

Every layer assumes the layer above it failed. Status: **PRESENT** (real + wired), **PARTIAL**
(built but advisory/narrow/unverified), **ABSENT** (control named in the bar does not run).

| # | Layer | The exact control | File of record | Status |
|---|-------|-------------------|----------------|--------|
| L0 | **CLIENT** | No secret/prompt/IP in bundle; no prod source-maps; presentation-only | `apps/owner-web/next.config.js`, `apps/admin-web/next.config.js` | **PARTIAL** — no client secret leak (verified clean), but no `productionBrowserSourceMaps:false` / `poweredByHeader:false` directive present, and the SSE envelope ships IP (L1–L8 of ip-leak-audit) |
| L0m | **CLIENT (mobile)** | RASP, root/jailbreak detect, anti-tamper, dynamic TLS pinning | `apps/buyer-mobile/`, `apps/workforce-mobile/` | **ABSENT** — grep `freeRASP\|SSLPinning\|rootDetection` = 0 |
| L1 | **NETWORK / edge** | WAF, default-deny, non-reflective CORS allowlist, rate-limit | CORS: `services/api-gateway/src/index.ts:975-981`; rate-limit: `index.ts:1010-1071` + `middleware/rate-limiter.ts` | **PARTIAL** — CORS allowlist PRESENT; WAF out-of-repo (cloud); rate-limit Redis-backed in prod, process-local Map in dev |
| L1e | **EGRESS** | Default-deny outbound allowlist + TLS-inspecting JWT-auth egress proxy | (none) | **ABSENT** — no egress-allowlist/proxy module exists (grep = sourcemap noise only) |
| L2 | **AUTH** | Supabase JWT canonical + cross-replica revocation | `brain.hono.ts:145-149`; blocklist `index.ts:1135` | **PRESENT** |
| L3 | **API / input** | zod validation on every route; BFF token-handler discipline | `zValidator` on all `*.hono.ts`; Hono BFF | **PRESENT** (zod); token-handler-cookie specifics unverified |
| L4 | **DATA** | RLS FORCE + WITH CHECK; KMS field-encryption; PII tokenization | RLS: 90 migrations `FORCE ROW LEVEL SECURITY`, 125 `WITH CHECK`; KMS+PII: `packages/data-protection/src/{encrypt,pii}` | **PRESENT** |
| L5 | **AGENT — input screen** | Per-surface prompt-injection / system-prompt-extraction screener | `packages/central-intelligence/src/kernel/immune.ts` | **ABSENT at runtime** — module full, **invoked nowhere**; only marketing gets `checkPublicInviolable` via `kernel.ts:1018` |
| L5t | **AGENT — tool-use validator** | Validate every tool dispatch + args before execution | guard: `packages/agent-security-guard/src/sandbox/tool-use-validator.ts`; dispatch: `kernel/orchestrator/tool-dispatcher.ts:114` (`registry.runTool`, **no check**) | **ABSENT at dispatch** (SEC-G1) |
| L5r | **AGENT — tool-result boundary** | Wrap untrusted tool/DB/webhook output as opaque data (indirect-injection) | `kernel/security/tool-result-boundary.ts` (orphaned); detector `agent-security-guard/src/detect/indirect-injection-detector.ts` | **ABSENT at runtime** — no live importer |
| L5s | **AGENT — sandbox** | isolated-vm (V8 isolate) for agent code | `kernel/sandbox/js-sandbox.ts` + `sandbox-policy.ts` | **PRESENT** (V8-level); kernel-level (gVisor/Kata) ABSENT |
| L5g | **AGENT — Session→Governor→Executor** | Intent gate: chat emits intents, never reaches executor on mismatch | `kernel/intent-verification.ts`; wiring `composition/lp30-kernel-ports-wiring.ts:303-348` | **PARTIAL** — advisory, **fails OPEN**; `BORJIE_INTENT_VERIFY_STRICT=` empty (`.env.example:273`) |
| L6 | **OUTPUT — IP-egress firewall** | Every byte of agent output transits a fail-closed firewall (canary, system-prompt-leak, PII, cross-tenant, exfil) | `packages/agent-security-guard/src/filter/output-filter.ts` → `createOutputFilter(deps)` | **ABSENT at runtime** — module full + hash-chained, **wired into nothing** (grep `createOutputFilter` in gateway+kernel = 0) |
| L6c | **OUTPUT — canary tokens** | Unguessable token in system prompt; any echo = exfil signal | `packages/ai-copilot/src/security/canary-tokens.ts` | **PRESENT + WIRED** (5 composition files) |
| L6e | **OUTPUT — envelope discipline** | SSE/JSON carries only status + output + evidence; never mechanics | `brain.hono.ts`, `brain-teach.hono.ts`, `public-chat.hono.ts` | **PARTIAL** — L1–L8 leaks ship model names, tool/junior names, handoff graph, provider ladder |
| L7 | **GOVERNANCE rail (always-on)** | Inviolable meta-rail; HIGH-risk literal policy; money/licence/deletion HITL dual-control | `kernel/inviolable.ts`, `policy-gate.ts` | **PRESENT** |
| L8 | **SUPPLY-CHAIN / proof** | CodeQL, Semgrep, gitleaks, AI-BOM Sigstore, red-team/defection/sycophancy CI | `.github/workflows/borjie-{codeql,semgrep,security,redteam}.yml`, `ai-bom-attest.yml` | **PRESENT** — but red-team targets `/brain/turn` only, **blind to `/api/public/chat`** |

**The single structural truth:** the brain's defense-in-depth is **mostly built and mostly dark.**
L5, L5t, L5r, L6 are real modules wired into nothing. Closing the gap is overwhelmingly *wiring +
fail-closed*, not new invention — which is why it is achievable before launch.

---

## 2. CLIENT INSPECTION RESISTANCE — kill every client leak

The impossibility theorem holds: anything shipped to a browser/phone can be captured. The only
durable defense is to **ship nothing secret**. Borjie is **clean on client *secret* leak** (verified
no service-role / LLM key / system prompt in any `apps/*/src` bundle; the `decision-trace` and
`SignupWizard` surfaces were deliberately de-keyed) — but it is **not clean on the SSE envelope**,
which ships internal mechanics as first-class fields.

**Plan:**

1. **No prod source-maps (BFF/bundle discipline).** Add to BOTH web next.configs:
   `productionBrowserSourceMaps: false`, `poweredByHeader: false` (and confirm `serverSourceMaps`
   off). Upload source-maps to Sentry via authenticated CLI only — never the public bundle.
   *Files:* `apps/owner-web/next.config.js`, `apps/admin-web/next.config.js` (BN: same two files).
2. **Status-only SSE/JSON frame contract** (the big one — fixes ip-leak-audit L1/L2/L3/L6).
   The client envelope carries exactly three **typed** frame families: `status`
   (`{phase}` / progress / ETA), `output` (text chunks + artifacts + proposed actions), `evidence`
   (citation/evidence ids + auditor verdict). Anything answering **HOW** is dropped at the gateway
   boundary. Make it a typed union so an internal field cannot be added by accident.
   - **L1 CRITICAL** — `brain-teach.hono.ts:895-918` `debate_metadata` ships `winner.provider`,
     `winner.model`, `scores`, `trace.judgeProvider`, `winnerReason`. Replace with a **trust-only**
     frame `{ verified: boolean, contenders: number }`. Strip the FE tooltip
     (`apps/owner-web/src/components/home-chat/HomeChatTeach.tsx:1151-1155`,
     `teach-sse-normalisers.ts:88-100`).
   - **L2 HIGH** — `brain.hono.ts:317-325, 1553-1568, 1436-1438, 1468-1470` ship `toolCalls`,
     `handoffs`, `advisorConsulted`, `tool:`/`handoff:from->to`. Collapse into one
     `status {phase:'working'}` frame; delete/neutralise `ToolCallSidebar.tsx` + `AskBubble.tsx`
     tool-chip block (or gate to admin-web only).
   - **L3 HIGH** — `public-chat.hono.ts:2098-2109` `done` frame + `all_providers_failed` error
     (`:1998-2007`) leak `winningProvider` + `attempts[]` to the **anonymous** visitor. Strip
     `provider`/`model`/`depth`/`attempts` from every client `done`/`error`; keep `{at, latencyMs,
     retryable}`. Provider detail → pino log only.
   - **L6 MEDIUM** — `brain.hono.ts:1434-1470, 344-353` ship `finalPersonaId`/`advisorConsulted`.
     Send one fixed public identity (`"Mr. Mwikila"`), never the internal routing result.
3. **Generic-error-in-prod** — route every client error through the existing
   `services/api-gateway/src/utils/safe-error.ts` (`safeInternalError`/`scrubMessage`). Retrofit the
   hand-rolled 503s that leak provider + env-var + function names:
   `brain-vision.hono.ts:388-390, 411, 496-503` and the no-provider message `brain.hono.ts:489`
   (ip-leak-audit L5).
4. **Audience-gate cognition surfaces** — drop `UserRole.TENANT_ADMIN` from CoT reads
   (`cot-query.router.ts:99`); restrict `thoughtText` to platform `SUPER_ADMIN`/`ADMIN`; tenant DSAR
   gets existence-only counts, never the CoT body (ip-leak-audit L4).
5. **Mobile RASP + dynamic cert-pinning** — add a RASP SDK (freeRASP / RASP+ class) with
   root/jailbreak detection, anti-tamper, repackaging detection, and **remotely-rotatable** TLS
   pinning to `apps/buyer-mobile` + `apps/workforce-mobile` **before** they touch money/KYC.
6. **"Prove-the-client-is-empty" CI gate** — build the prod bundle, run a secret-scanner + a
   headless decompile-and-grep over emitted JS/source-maps, and **fail the build** if any
   high-entropy string, persona-prompt fragment, proprietary scoring constant, or the per-release
   canary string appears. Converts "client holds no IP" from a promise into a test.

---

## 3. JAILBREAK / INJECTION RESISTANCE — put the rail OUTSIDE the model

Consensus: you cannot prompt your way out of prompt injection (OWASP LLM01). Defense is
architectural containment + a fail-closed output firewall + continuous proof.

### 3.1 INPUT guard — the immune screener, per-surface (closes our-posture-audit 2a/2b)

- **THE BLOCKER (2a, CRITICAL):** `services/api-gateway/src/routes/public-chat.hono.ts:1780`
  (`app.post('/chat', …)`, mounted `index.ts:2278` at `/api/public/chat`) calls `streamSSE`
  (`:1791`) with the full IP marketing prompt (`BORJIE_MARKETING_SYSTEM_PROMPT_EN/SW`, `:325/:469`,
  selected `:1873-1874`) **directly to the LLM providers** — it never calls `kernel.think()`, so it
  gets `checkPublicInviolable`, `immune`, intent-verifier, and the output firewall **none of them.**
  The only defense is in-prompt soft text. **Fix:** route public chat through the kernel marketing
  path (or a hardened mini-kernel) so it inherits `checkPublicInviolable` + immune + the L6 firewall.
  **Same in BN:** `public-marketing.hono.ts:146-244` (`runMarketingLLM` → `streamSSE`).
- **2b HIGH:** `packages/central-intelligence/src/kernel/immune.ts` (categories: `prompt-injection`,
  `system-prompt-extraction`, `admin-impersonation`, `malicious-payload`) is **invoked nowhere**.
  Wire it at the kernel pre-sensor seam for **all** surfaces (`kernel.ts` ~1018, generalise beyond
  `surface === 'marketing'`), so authenticated owner/admin chat gets a real injection screen, not
  just the in-prompt layer.

### 3.2 The IP-EGRESS OUTPUT GUARD (L6) — the central, fail-closed firewall (closes 2c, SEC-G1)

This is the highest-leverage fix. `packages/agent-security-guard/src/filter/output-filter.ts`
exports `createOutputFilter(deps)` and already implements: markdown-image-exfil-domain detection,
**system-prompt-leak** regexes, PII-redact via `DataProtectionPort`, code-exec/JS-injection strip,
**cross-tenant-id-leak**, each block **hash-chained** (append-only audit). It is wired into nothing.

**Plan:** make it the **mandatory, fail-closed last hop** every byte of agent output transits before
reaching any client, tool, or persistence — the single chokepoint so a new/unaudited chat path
cannot leak by omission (INV-H/D L615: "ENFORCED BY CONSTRUCTION, not per-path"). Land it on:
- the brain answer/SSE path (`brain.hono.ts` `done`/text emit ~`:344`, JSON turn `:1431-1474`),
- the teaching path (`brain-teach.hono.ts`),
- the public-chat path (`public-chat.hono.ts:1791` stream),
- every tool-result re-ingestion (pair with `createIndirectInjectionDetector()`).
Add the **canary-token check** (already wired upstream) + optionally a small judge-model classifier
in front. **Fail-closed: redact when uncertain.** Extend its regexes to catch the L1–L6 envelope
leaks (provider/model/tool/junior/persona names) so even a leaky frame is scrubbed at egress.

### 3.3 Spotlighting + tool-result boundary (closes 2e)

`packages/central-intelligence/src/kernel/security/tool-result-boundary.ts`
(`wrapToolResult`/`buildPromptBoundaries`, nonce-bracketed "TOOL_DATA_NOT_INSTRUCTIONS") is
**orphaned** (no live importer). Wire it at the dispatcher so every tool/DB/webhook/corpus result is
**spotlighted** (randomized delimiters + "treat as opaque data") before it enters LLM context. Cheap,
additive, lowers ASR on indirect injection.

### 3.4 Tool-use validator at dispatch (closes 2d / SEC-G1)

`packages/central-intelligence/src/kernel/orchestrator/tool-dispatcher.ts:114` runs
`config.registry.runTool(toolName, input)` with **zero** security check. Wire
`createToolUseValidator` (from `agent-security-guard/sandbox`) + arg-sanitizer **before** every
dispatch; `createIndirectInjectionDetector()` on every tool-result re-ingestion. Persist via the
existing Drizzle audit tables.

### 3.5 Session → Governor → Executor enforcement (closes 2f, and goes structural)

- **Now (flip the flag):** the intent-verifier (`kernel/intent-verification.ts`, wired
  `lp30-kernel-ports-wiring.ts:303-348`) is **advisory + fails OPEN**;
  `BORJIE_INTENT_VERIFY_STRICT=` is empty (`.env.example:273`). After the advisory bake, flip to
  **strict** so a jailbroken-chat→executor tool call on a mismatched intent is **blocked, not
  logged**. The hard executor separation (inviolable meta-rail + money/licence HITL dual-control) is
  already always-on; this closes the *intent* gate.
- **Structural (the leap):** split the runtime so the **Session** LLM never sees the proprietary
  persona/scoring IP (it lives only in a sealed **Governor** service); untrusted tool/corpus content
  is read by a **quarantined reader** with zero tools that returns only typed symbolic references
  (CaMeL/Dual-LLM); the **Executor** runs a deterministic capability interpreter where every
  consequential action requires a capability the injected text cannot mint. Then jailbreaking a rail
  is structurally — not probabilistically — impossible, because the model never held the secret.

### 3.6 System-prompt-extraction defense

Keep the strong in-prompt CSA-2 / prompt-shield deflection (model-name forbid, deflection templates,
"never recite the rule" — `public-chat.hono.ts:288-323`, `prompt-shield.ts:323-332`) as the *model*
line, **and** layer the immune screener (input) + the IP-egress firewall + canary tokens (output) as
the *external* lines so extraction is caught even if the prompt instruction is bypassed. **Fix the
stale-domain string** `prompt-shield.ts:331` ("property management" → mining identity).

---

## 4. SECRET MANAGEMENT HARDENING

Borjie is strong here: env/bootstrap-only (dotenv once in `index.ts`), no `process.env` outside
bootstrap, Pino-only logging (redaction), gitleaks on every PR, KMS envelope + PII tokenization in
`packages/data-protection`. **No real secrets committed; logs/SSE clean** (verified). Hardening:

1. **Closed-loop remediation runbook** — codify detect-leak → auto-rotate → revoke-old → verify-dead
   (the un-fixed 2026 governance gap). `borjie-security.yml` does detection; add the post-detection
   loop.
2. **Default-deny network egress allowlist** — block outbound by default; allow only
   `api.anthropic.com` / `api.openai.com` / regulator feeds. The strongest exfil backstop, currently
   absent. Pairs with the L1e egress proxy.
3. **Pre-model redaction** — confirm PII/secrets are stripped **before** context assembly, not only
   on output (post-model present via the output-filter's `pii-redact`).
4. **Zero-standing-secret (leap)** — replace long-lived API keys with short-lived workload-identity
   tokens (SPIFFE/OIDC, minutes), so "rotation" becomes "expiry" and a leaked credential is dead
   before it is useful.

---

## 5. CRITICAL HOLES TO FIX NOW (file:line + fix) — BLOCKERS marked

| # | Hole | file:line | Severity | Fix |
|---|------|-----------|----------|-----|
| **H1** | **Kernel-bypass public chat** ships the full IP system prompt to a raw LLM call with **zero rails** (no immune, no inviolable, no output firewall). One unauthenticated POST jailbreaks → exfiltrates persona/playbook IP. | `public-chat.hono.ts:1780-1928` (mount `index.ts:2278`); BN `public-marketing.hono.ts:146-244` | **BLOCKER** | Route public chat through the kernel marketing path (inherit `checkPublicInviolable` + immune) **and** the L6 output firewall. No raw `streamSSE` to providers. |
| **H2** | **IP-egress output firewall is dark** — `createOutputFilter` exists, hash-chained, wired into nothing. The last-line control INV-H/D requires, and H1 relies on, never runs. | `agent-security-guard/src/filter/output-filter.ts` (0 callers in gateway+kernel) | **BLOCKER** | Wire `createOutputFilter` as the mandatory fail-closed last hop on every answer/SSE/tool/persist path; canary + cross-tenant + system-prompt-leak checks ON; redact-when-uncertain. |
| **H3** | **Immune input screener is dark** on authenticated surfaces — injection/system-prompt-extraction screener invoked nowhere; only marketing gets `checkPublicInviolable`. | `kernel/immune.ts` (0 callers); `kernel.ts:1018` (marketing-only) | **BLOCKER** | Wire `immune.ts` per-surface at the kernel pre-sensor seam for all surfaces. |
| **H4** | **Tool-use validator unwired at dispatch** — `runTool` runs with no security check (SEC-G1). | `kernel/orchestrator/tool-dispatcher.ts:114` | **HIGH** | Wire `createToolUseValidator` + arg-sanitizer before dispatch; `createIndirectInjectionDetector()` on re-ingestion. |
| **H5** | **Tool-result boundary orphaned** — untrusted tool/DB/webhook output spliced unwrapped into context = indirect injection. | `kernel/security/tool-result-boundary.ts` (0 live importers) | **HIGH** | Wire `wrapToolResult` at the dispatcher; spotlight all tool results before context. |
| **H6** | **Intent verifier advisory / fails OPEN in prod** — Session→Executor mismatch gate logs but does not block. | `.env.example:273` (`BORJIE_INTENT_VERIFY_STRICT=` empty); `lp30-kernel-ports-wiring.ts:303-348` | **HIGH** | After advisory bake, set `BORJIE_INTENT_VERIFY_STRICT=1`; make fail-closed. |
| **H7** | **SSE envelope leaks IP** — model names + scores + judge reason (L1 CRITICAL), tool/junior names + handoff graph (L2), provider ladder to anonymous visitor (L3), persona routing (L6). | `brain-teach.hono.ts:895-918`; `brain.hono.ts:317-325,1436-1470`; `public-chat.hono.ts:2098-2109` | **HIGH (L1 = CRITICAL)** | Status-only typed frame contract (§2.2); trust-only debate frame; strip provider/model/tool/persona; FE renderers deleted/admin-gated. |
| **H8** | **Operator diagnostics leak onto client errors** — provider + env-var + function names in 503s. | `brain-vision.hono.ts:388-390,411,496-503`; `brain.hono.ts:489` | **MEDIUM** | Route through `utils/safe-error.ts`; generic copy + stable code; detail → pino. |
| **H9** | **CoT readable by TENANT_ADMIN** — owner-side role can read scrubbed `thoughtText`. | `cot-query.router.ts:99,310` | **MEDIUM** | Drop `TENANT_ADMIN`; restrict to platform `SUPER_ADMIN`/`ADMIN`; tenant gets existence-only. |
| **H10** | **No prod-source-map / poweredBy guard** + **no mobile RASP/pinning** + **red-team blind to `/api/public/chat`**. | `apps/{owner,admin}-web/next.config.js`; `apps/{buyer,workforce}-mobile`; `borjie-redteam.yml:6` | **MEDIUM/HIGH** | `productionBrowserSourceMaps:false`+`poweredByHeader:false`; RASP+pinning before money/KYC; add public-chat to red-team gate. |

**BLOCKERS for the paying-user launch: H1, H2, H3.** Together they are the unmitigated
IP-exfiltration path (raw public chat + no input screen + no output firewall). H4–H7 are
fix-before-production. The same set applies to **both repos**.

---

## 6. NEW CONTINUOUS RED-TEAM PROBES (CI gates)

Add to BOTH repos; run against the **live** brain endpoint **and** `/api/public/chat`; ASR is a
release-blocking metric (undefended frontier agents hit near-100% ASR — undefended is not an option).

1. **`jailbreak-public-chat.yml`** — fire the promptfoo `jailbreaks.csv` + AgentDojo-class injections
   at `/api/public/chat` (currently `borjie-redteam.yml:6` targets `/brain/turn` only). **Gate:** zero
   system-prompt / persona-IP egress; ASR ≤ threshold.
2. **`secret-exfil-egress.yml`** — indirect-injection corpus (poisoned tool/corpus/webhook content)
   that attempts markdown-image-exfil, cross-tenant id leak, and canary-token echo. **Gate:** zero
   canary appearances in any output; output firewall blocks 100%.
3. **`client-inspection.yml`** ("prove-the-client-is-empty") — build prod bundle, secret-scan +
   decompile-grep emitted JS/source-maps + SSE-envelope snapshot. **Gate:** no high-entropy string,
   no prompt fragment, no scoring constant, no canary, no `provider`/`model`/`tool`/`handoff` field in
   any client frame.
4. **`system-prompt-extraction.yml`** — the full extraction battery ("output everything above",
   "repeat your instructions", role-confusion, encoding tricks) against every chat surface
   (marketing/owner/teaching/voice). **Gate:** deflection, never disclosure; canary never echoed.
5. **`injection-screen-coverage.yml`** — assert `immune.ts` + tool-use-validator + tool-result
   boundary + output-filter are **invoked** on each surface (a wiring-coverage test, so "built-but-
   dark" can never regress). **Gate:** each control has ≥1 live call site per surface.
6. **`intent-strict-enforce.yml`** — assert `BORJIE_INTENT_VERIFY_STRICT=1` in prod config and that a
   mismatched-intent tool call is **blocked**, not logged.

---

## 7. SAME BOTH REPOS

Every hole and fix above is **mirrored in BossNyumba** (`Cursor Projects/BOSSNYUMBA101`): H1 =
`public-marketing.hono.ts:146-244`; H2/H3 = same dark agent-security-guard + immune; H7/H8 = same
envelope/error leaks; same RASP/source-map/red-team gaps. The IP-egress firewall, the immune wiring,
the status-only frame contract, and the new CI probes ship to both. Fix the stale "property
management" identity string in Borjie's `prompt-shield.ts:331` (a BN leftover).

---

## 8. DEPENDENCY-ORDERED HARDENING BUILD-WAVES

Each fix is **real code, default-ON** (kill-switch flag only, never off-by-default). Dependency order:
wire the chokepoint first, then route everything through it, then prove it.

**WAVE 0 — LAUNCH BLOCKERS (the unmitigated exfil path). Default-ON.**
- W0.1 **Build + wire the IP-egress output firewall (H2):** `createOutputFilter` as fail-closed last
  hop on brain/teach/public-chat answer paths + tool-result re-ingestion + persistence. Canary +
  cross-tenant + system-prompt-leak ON. *(Everything below depends on this chokepoint existing.)*
- W0.2 **Close the public-chat kernel bypass (H1):** route `/api/public/chat` (+ BN
  `/public-marketing`) through the kernel marketing path → inherits `checkPublicInviolable` + W0.1.
- W0.3 **Wire the immune input screener per-surface (H3):** `immune.ts` at the kernel pre-sensor seam
  for all surfaces.
- W0.4 **Red-team the public surface (probe #1):** `jailbreak-public-chat.yml` + `secret-exfil-egress.yml`
  as release-blocking gates against live `/api/public/chat`.

**WAVE 1 — agent-path injection containment (depends on W0.1 firewall).**
- W1.1 Tool-use validator + arg-sanitizer at dispatch (H4) — `tool-dispatcher.ts:114`.
- W1.2 Wire + spotlight the tool-result boundary (H5) — `wrapToolResult` on every result.
- W1.3 Flip intent-verifier to strict, fail-closed (H6) — `BORJIE_INTENT_VERIFY_STRICT=1` +
  `intent-strict-enforce.yml` + `injection-screen-coverage.yml`.

**WAVE 2 — client-envelope IP discipline (depends on W0.1 to also scrub at egress).**
- W2.1 Status-only typed frame contract; redact L1(CRITICAL)/L2/L3/L6 (H7); delete/admin-gate FE
  renderers.
- W2.2 Route client errors through `safe-error.ts` (H8, L5).
- W2.3 Drop `TENANT_ADMIN` from CoT reads (H9, L4); fix `prompt-shield.ts:331` identity string.
- W2.4 `next.config` source-maps off + `poweredByHeader:false` (H10) + `client-inspection.yml` +
  `system-prompt-extraction.yml` gates.

**WAVE 3 — perimeter + secret + supply-chain hardening.**
- W3.1 Mobile RASP + dynamic cert-pinning (H10) before money/KYC.
- W3.2 Default-deny egress allowlist + TLS-inspecting JWT-auth egress proxy (§4.2, L1e).
- W3.3 Closed-loop secret remediation runbook (§4.1); pre-model redaction confirm (§4.3).
- W3.4 Shared Redis token-bucket rate-limit (global cap); SLSA-L3 app provenance + Sigstore.

**WAVE 4 — structural moat (the leap; post-launch hardening).**
- W4.1 Session→Governor→Executor split + quarantined reader + capability interpreter (CaMeL) (§3.5).
- W4.2 Kernel-level runtime isolation (`RuntimeClass: gvisor`/Kata) for sandbox workloads.
- W4.3 Zero-standing-secret (SPIFFE/OIDC short-lived tokens) (§4.4).
- W4.4 Dedicated guardrail model (Llama-Guard/Granite-Guardian class) as independent input+output
  classifier alongside the regex firewall.

---

## 9. THE SCORECARD (one glance)

| Control | Status |
|---|---|
| No client secret leak | **PRESENT** (verified clean) |
| No prod source-maps / poweredBy off | **ABSENT** (one-liner each, both web apps) |
| Mobile RASP / cert-pinning | **ABSENT** (both mobile apps) |
| Non-reflective CORS allowlist | **PRESENT** |
| CSP + security headers | **PRESENT** |
| Supabase JWT + revocation | **PRESENT** |
| RLS FORCE + WITH CHECK; KMS + PII | **PRESENT** |
| zod input validation | **PRESENT** |
| Immune input screener (auth surfaces) | **ABSENT at runtime** → H3 BLOCKER |
| Public-chat kernel rails | **ABSENT** → H1 BLOCKER |
| IP-egress output firewall (wired) | **ABSENT at runtime** → H2 BLOCKER |
| Canary tokens | **PRESENT + WIRED** |
| Tool-use validator at dispatch | **ABSENT** → H4 |
| Tool-result boundary (wired) | **ABSENT** → H5 |
| Intent verifier (Session→Executor, strict) | **PARTIAL / fails-open** → H6 |
| SSE envelope IP discipline | **PARTIAL** (L1–L8) → H7 |
| isolated-vm sandbox | **PRESENT** |
| Kernel-level isolation (gVisor/Kata) | **ABSENT** → W4.2 |
| Default-deny egress allowlist | **ABSENT** → W3.2 |
| Inviolable meta-rail + HITL dual-control | **PRESENT** |
| CodeQL/Semgrep/gitleaks/AI-BOM-Sigstore | **PRESENT** |
| Red-team covers `/api/public/chat` | **ABSENT** → probe #1 |

---

*"Unhackable" here = the SOTA posture engineered to the bar — no client-inspectable secret, no raw
jailbreak path, no IP/secret egress — continuously red-teamed. Not a claim of literal invincibility;
the discipline of continuous proof is what keeps it unhackable. Same both repos.*
