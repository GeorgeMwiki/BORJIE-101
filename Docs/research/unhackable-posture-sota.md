# UNHACKABLE POSTURE — 2026 SOTA dossier

**Lane:** `unhackable-posture-SOTA`
**Date:** 2026-06-09
**Branch:** `integration/parity-final`
**Author:** research subagent (web-survey + repo-grounded gap pass)
**Scope:** the 2026 state-of-the-art of building an **un-inspectable, un-jailbreakable, secret-tight** agent product, mapped against what Borjie HAS, with a beyond-today leap per finding.

> **Thesis.** "Unhackable" is not a wall, it is a **posture**: defense-in-depth + assume-breach + continuous red-team, where (a) the client holds **zero** inspectable secrets/prompts/IP, (b) the brain is **structurally** jailbreak/prompt-injection-resistant (the rail lives OUTSIDE the LLM, not inside the prompt), and (c) every guarantee is **continuously proven** by an adversary, not asserted once. The 2026 frontier consensus from Anthropic, Google DeepMind, OpenAI and OWASP is blunt: **prompt injection cannot be "solved" inside the model** — so the win condition is *containment by architecture* + *continuous proof*, not a smarter filter. ([Anthropic — How we contain Claude](https://www.anthropic.com/engineering/how-we-contain-claude), [VentureBeat — browser agent hijacked 31.5% before safeguards](https://venturebeat.com/security/anthropic-browser-agent-hijacked-31-percent-before-safeguards))

---

## 0. The five pillars (survey spine)

1. **CLIENT secret-protection** — BFF / token-handler so the SPA holds no secret; no prod source-maps; the impossibility of true client-side secrets; mobile RASP / app-shielding / anti-tamper / cert-pinning.
2. **JAILBREAK / PROMPT-INJECTION defense** — OWASP LLM Top-10 2025; spotlighting/delimiting; the dual-LLM / quarantine / CaMeL capability pattern; input + output classifiers (Llama-Guard / Prompt-Guard class); system-prompt-extraction defenses; indirect injection from tool content.
3. **SECRET management** — KMS envelope, rotation, least-priv, no-leak in logs/errors/responses; the IP-EGRESS / output firewall.
4. **NETWORK / API** — WAF, rate-limit, CORS allowlist, mTLS / SPIFFE, egress allowlist, runtime isolation (gVisor / microVM / Kata).
5. **SUPPLY-CHAIN + ASSUME-BREACH** — SBOM / AI-BOM, dep pinning, SLSA provenance, Sigstore signing; continuous red-team / purple-team for agents.

---

## 1. CLIENT secret-protection — the SPA must hold nothing worth stealing

### 1.1 The impossibility theorem (the load-bearing premise)
Anything shipped to a browser or a phone **can be captured and studied**; obfuscation/minification raise the cost of analysis but **do not make client code secret** — modern devtools reformat uglified JS in seconds and expose API calls and workflows. The only durable defense is to ship **nothing secret**: no long-lived tokens, no private keys, no system prompts, no proprietary scoring logic. ([PreEmptive — why JS obfuscation matters](https://www.preemptive.com/blog/why-javascript-obfuscation-matters-how-to-protect-client-side-code-from-attacks/), [HackerDNA — Secrets in Source 2 write-up](https://medium.com/@madaminovrahmatilloh1/hackerdna-secrets-in-source-2-write-up-client-side-obfuscation-and-hidden-secrets-198f6672bf1e))

### 1.2 BFF / Token-Handler pattern (2026 canonical for browser apps)
The SPA gets a **Secure, HttpOnly, SameSite=Strict** cookie carrying only an opaque `session_id`; the BFF/api-gateway is the **token handler** — it acquires/stores/renews Access/ID/Refresh tokens server-side, keyed by that session id. Tokens never touch client JS, so XSS cannot exfiltrate them, and third-party API keys live only on the server. ([GitGuardian — stop leaking API keys, the BFF pattern](https://blog.gitguardian.com/stop-leaking-api-keys-the-backend-for-frontend-bff-pattern-explained/), [Curity — the token handler pattern](https://curity.io/resources/learn/the-token-handler-pattern/), [Duende — securing SPAs with BFF](https://duendesoftware.com/blog/20210326-bff), [bff-patterns.com — api-token-handler](https://bff-patterns.com/patterns/api-token-handler))

### 1.3 No prod source-maps
Shipping `.map` files (or `productionBrowserSourceMaps:true`) hands the attacker your un-minified source. SOTA: emit source-maps only to the error tracker (Sentry) via authenticated upload, never to the public bundle; strip `X-Powered-By`; set strict CSP. (Borjie owner/admin web already ship a curated CSP + security-header block — see §1.6.)

### 1.4 Mobile: RASP + app-shielding + dynamic cert-pinning
For Expo/native apps the 2026 bar is a RASP SDK (e.g. Talsec freeRASP / RASP+ class) providing root/jailbreak detection, anti-tamper/anti-debug, repackaging/overlay detection, SDK obfuscation, and **dynamic TLS pinning** that can be rotated remotely **without an app release** — because static pins brick the app on cert rotation. ([Talsec review 2026 — RASP+ & freeRASP](https://appsecsanta.com/talsec))

### 1.5 What Borjie HAS
- api-gateway IS a Hono BFF; Supabase JWT canonical; CORS origin allowlist (non-reflective) is a hard rule.
- owner-web + admin-web ship a curated `Content-Security-Policy` + SOTA security-header block (`next.config.js` "S-4 pre-launch audit 2026-05-29").
- The hard rules already forbid reflective CORS and raw-HTML interpolation (DOMPurify required).

### 1.6 Gaps (CLIENT)
- **G-CLIENT-1 [HIGH]** No BFF **token-handler-with-opaque-session-cookie** statement of record. Confirm the owner/admin SPAs never hold the Supabase access/refresh token in JS-readable storage (localStorage / non-HttpOnly cookie); if they do, move to HttpOnly session cookie + server-side token store.
- **G-CLIENT-2 [MED]** No explicit `productionBrowserSourceMaps:false` / authenticated-Sentry-only source-map upload guarantee in `next.config.js`. One-line + a CI assert that no `.map` ships in the public bundle.
- **G-CLIENT-3 [HIGH]** **Zero mobile RASP / cert-pinning** in `apps/buyer-mobile` and `apps/workforce-mobile` (grep for `pinning|freeRASP|rootDetection|SSLPinning` = empty). Add a RASP SDK + dynamic pinning before the apps touch money/KYC flows.

**Beyond-today leap:** ship a **"prove-the-client-is-empty" CI gate** — a job that builds the production bundle, runs an automated secret-scanner + a headless "decompile-and-grep" pass over the emitted JS/source-maps, and **fails the build** if any high-entropy string, persona prompt fragment, or proprietary scoring constant is present. The unhackable claim becomes a *test*, not a promise. Pair it with a per-release **canary string** seeded into the system prompt (Borjie already has `canary-tokens`) — if that string is ever found in a shipped client artifact OR in a model output, the pipeline halts. This converts "we believe the client holds no IP" into a continuously-proven invariant.

---

## 2. JAILBREAK / PROMPT-INJECTION defense — put the rail OUTSIDE the model

### 2.1 The 2026 consensus: you cannot prompt your way out of prompt injection
Prompt injection is OWASP **LLM01 (2025)** for the second edition running, because LLMs process instructions and data on the same channel — "you can't patch your way out, it exploits LLM design itself." Defense is **defense-in-depth**: input validation + output filtering + privilege restriction + HITL for sensitive ops + segregating external content so untrusted data cannot become instructions. ([OWASP Top-10 LLM 2025 — Oligo](https://www.oligo.security/academy/owasp-top-10-llm-updated-2025-examples-and-mitigation-strategies), [Confident AI — OWASP 2025 risks & mitigations](https://www.confident-ai.com/blog/owasp-top-10-2025-for-llm-applications-risks-and-mitigation-techniques), [OWASP LLM Prompt Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html))

### 2.2 Architectural containment beats filtering — the six design patterns
The 2025/26 reference taxonomy ([Beurer-Kellner et al., *Design Patterns for Securing LLM Agents against Prompt Injections*, arXiv:2506.08837](https://arxiv.org/html/2506.08837v2)): **Action-Selector** (LLM = switch statement, untrusted data can trigger no consequential action), **Plan-Then-Execute** (lock the plan before reading untrusted data — control-flow integrity), **LLM Map-Reduce** (isolated per-document LLMs, an injection can only poison its own shard), **Dual-LLM** (privileged planner with tools + quarantined reader with no tools, returning symbolic references), **Code-Then-Execute** (LLM writes a constrained program), **Context-Minimization** (drop the prompt from context once it has acted). The paper's blunt conclusion: **general-purpose agents cannot get meaningful guarantees today — safety comes from intentionally constraining the agent to app-specific tasks.**

### 2.3 CaMeL — the frontier "by design" defense
[CaMeL — *Defeating Prompt Injection by Design*, arXiv:2503.18813](https://arxiv.org/pdf/2503.18813): a privileged LLM emits code into a **custom (capability-restricted) Python interpreter**; a quarantined LLM parses untrusted data; **capabilities + data-flow policies are enforced deterministically OUTSIDE the model**, so even a fully-injected quarantined LLM cannot reach a sensitive tool without an explicit capability. **CaMeL achieves provable security on 77% of AgentDojo tasks** via capability-based isolation. This is the template for "extracting the prompt or jailbreaking a rail is *structurally* impossible." ([Simon Willison — Dual LLM pattern origin](https://simonwillison.net/2023/Apr/25/dual-llm-pattern/), [Zylos — Indirect Prompt Injection 2026 SOTA](https://zylos.ai/research/2026-04-12-indirect-prompt-injection-defenses-agents-untrusted-content/))

### 2.4 Spotlighting / delimiting / datamarking (baseline hygiene, not a moat)
[Spotlighting, arXiv:2403.14720](https://arxiv.org/html/2403.14720v1) wraps untrusted content in **randomized markers** (delimiting), or transforms it (datamarking / encoding) so the model can tell data from instructions. It measurably lowers ASR with minimal task cost — but is **probabilistic and subvertible** if the attacker learns the delimiter. Treat as a baseline layer, never the only layer. ([CEUR Vol-3920 spotlighting paper](https://ceur-ws.org/Vol-3920/paper03.pdf))

### 2.5 Input + output classifiers (the Anthropic/Meta layer)
Anthropic's production containment runs **two layers**: an **input-layer prompt-injection probe** that scans tool outputs *before* they enter context (adds a warning when content looks like a hijack), and an **output-layer transcript classifier** that evaluates each action *before execution* — a fast single-token filter, then chain-of-thought if flagged. ([Anthropic — How we contain Claude](https://www.anthropic.com/engineering/how-we-contain-claude), [Anthropic — Claude Code auto mode](https://www.anthropic.com/engineering/claude-code-auto-mode)). Model-side, the open guardrail field of record is the **Llama-Guard** lineage (3-8B/1B, MLCommons taxonomy, beats GPT-4 on safety classification) plus **Qwen3-Guard** (119-lang) and **IBM Granite Guardian** (leads prompt-injection + hallucination categories). ([Llama Guard paper](https://arxiv.org/pdf/2312.06674), [Llama Guard 4 model card](https://www.llama.com/docs/model-cards-and-prompt-formats/llama-guard-4/), [LLM Guardrails 2026 reference](https://www.digitalapplied.com/blog/llm-guardrails-production-safety-layers-reference-2026))

### 2.6 Indirect injection from tool content (the agentic killer)
The dangerous vector in an MD/agent product is **indirect** injection: a poisoned corpus chunk, OCR'd document, regulator-feed page, or buyer message that the agent re-ingests as a tool result and obeys. 2026 SOTA layers (a) **provenance tracking** (trusted vs untrusted spans), (b) **tool-result parsing** that strips embedded imperatives ([arXiv:2601.04795](https://arxiv.org/html/2601.04795v1)), and (c) **egress constraint so exfiltration fails even when injection succeeds**. Note: AgentDojo shows red-teams reaching **near-100% ASR** against undefended frontier agents, and Anthropic's own browser agent was hijacked **31.5%** of the time before safeguards engaged — undefended is not an option. ([AgentDojo](https://agentdojo.spylab.ai/), [Security Challenges in AI Agent Deployment — large-scale competition, arXiv:2507.20526](https://arxiv.org/pdf/2507.20526))

### 2.7 What Borjie HAS (strong, and ahead of most)
- `packages/agent-security-guard/src/` is a **real** guard surface: `detect/{prompt-injection-detector, indirect-injection-detector, prompt-injection-patterns}`, `jailbreak/jailbreak-detector`, `filter/output-filter`, `sandbox/{tool-use-validator, argument-sanitizer, tool-registry}`, `redteam/{red-team-runner, builtin-scenarios}`, `audit/hash-chain`.
- The **output-filter** already implements the canonical exfil defenses: markdown-image-suspicious-domain (the Rehberger 2023 data-exfil attack), **system-prompt-leak** regexes, PII-redact via `DataProtectionPort`, code-exec/JS-injection strip, and **cross-tenant-id-leak** — each block is **hash-chained** (append-only audit). This is the IP-EGRESS / output-firewall (INV-H/D) in seed form.
- `packages/ai-copilot/src/security/canary-tokens.ts` seeds unguessable tokens into the system prompt; any appearance in output = definitive system-prompt-exfil signal → quarantine session. **Confirmed wired** into `api-gateway` (`brain-kernel-wiring`, `cognitive-composer-wiring`, `index.ts`).
- Kernel rail lives **outside the prompt**: `inviolable.ts` / `public-inviolable.ts` / `policy-gate.ts`, the meta-rail invariant ("the agent can never touch its own gate/audit/test machinery"), HIGH-risk policy prefixes that must hit literal rules (no reason-resolver generalisation), evidence-required output (Auditor rejects empty evidence chains), isolated-vm sandbox, and CI probes (`borjie-redteam`, `defection-probe`, `sycophancy-probe`).

### 2.8 Gaps (JAILBREAK / INJECTION)
- **G-PI-1 [BLOCKER]** The **output-filter is NOT wired into the brain answer path** — grep for `output-filter|createOutputFilter|runOutputFilter` across `services/api-gateway/src` + `packages/central-intelligence/src` returns **empty**. The IP-egress firewall exists but is dark on the live response path. (This matches `MASTER_GAP_REGISTER` SEC-G1: agent-security-guard built-but-not-wired.) Wire `createOutputFilter` as the **last hop** before any agent text reaches a user/tool/persistence, and `createIndirectInjectionDetector` on every tool-result re-ingestion.
- **G-PI-2 [HIGH]** No **CaMeL-style capability/data-flow gate** — the kernel rail is policy-rule-based, not a quarantined-reader + deterministic-capability-interpreter. The money/licence/deletion HITL gate is the strongest leg; the *read-untrusted-then-act* path still relies on classifiers, which are probabilistic.
- **G-PI-3 [MED]** No standing **spotlighting/delimiting** of tool/corpus content into the prompt (randomized markers + "treat as opaque data"). Cheap, additive, lowers ASR.
- **G-PI-4 [MED]** No **dedicated guardrail model** (Llama-Guard/Granite-Guardian class) as an independent input+output classifier alongside the regex output-filter — the current detectors are pattern/heuristic.

**Beyond-today leap:** make prompt/IP extraction **structurally impossible**, not merely detected. (1) Split the runtime into **Session → Governor → Executor**: the Session LLM never sees the proprietary persona/scoring IP (it lives only in the Governor, a sealed service); untrusted tool/corpus content is read by a **quarantined reader** with zero tools and returns only **typed symbolic references** (CaMeL-style); the Executor runs a **deterministic capability interpreter** where every consequential action requires an explicit capability the injected text cannot mint. (2) Promote the existing output-filter to a **mandatory, fail-closed IP-egress firewall** that every byte of agent output transits, with the canary-token check + a small **judge-model output classifier** in front of it — so even a perfectly-injected reader cannot exfiltrate the prompt, cross a tenant boundary, or open an exfil channel, because the firewall is outside the model and the model never held the secret to begin with. Continuously prove it with the `red-team-runner` + AgentDojo-style scenarios run nightly against the **live** brain endpoint (extend the existing `borjie-redteam.yml` gate), tracking ASR as a release-blocking metric.

---

## 3. SECRET management — KMS envelope, rotation, no-leak, IP-egress

### 3.1 SOTA pattern
KMS **envelope encryption** for any payload >4KB: KMS generates a data key, you encrypt locally, store the **encrypted** data key beside the ciphertext, plaintext data key lives only in memory and is never persisted; the master key never leaves the HSM. Enforce **least-privilege per-secret** (the most-ignored OWASP control), **automatic machine-credential rotation** (short validity windows), and — critically — **apply the same redaction/filter rules to logs and errors as to the final user response** (pipelines leak secrets through debug logging far more than through responses). ([OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html), [AWS KMS best practices 2026](https://tocconsulting.fr/best-practices/kms-security), [Secrets & key rotation 2026 reference](https://www.digitalapplied.com/blog/secrets-management-api-key-rotation-2026-engineering-reference))

### 3.2 The 2026 gap nobody fixes: non-remediation
Rotation *mechanics* are solved; **governance is not** — GitGuardian found **64% of credentials leaked-and-valid in 2022 were still active in Jan-2026** because teams lack a remediation process. "Unhackable" requires a closed-loop: detect-leak → auto-rotate → revoke-old → verify-dead. ([GitGuardian / Secrets 2026 reference](https://www.digitalapplied.com/blog/secrets-management-api-key-rotation-2026-engineering-reference))

### 3.3 LLM-specific egress control
Send least-necessary context; **redact/tokenize/mask PII + secrets both pre- and post-model**; treat **network egress as a first-class outcome** — domain allowlisting + redirect-chain analysis is "considerably more effective than prompt-level defenses." ([Kiteworks — prevent LLM data leakage](https://www.kiteworks.com/cybersecurity-risk-management/prevent-llm-data-leakage-controls/), [Doppler — advanced LLM security, secret leakage across agents](https://www.doppler.com/blog/advanced-llm-security), [Silent Egress, arXiv:2602.22450](https://arxiv.org/html/2602.22450v1))

### 3.4 What Borjie HAS
- Hard rule: secrets via env/bootstrap only (`dotenv` loads once in `index.ts`); no `process.env` outside bootstrap; **Pino-only** logging (handles redaction); no `console.log` in services.
- `packages/data-protection/src/` is a full module: `encrypt` (KMS port adapter + residency tagging — task #18 done), `pii` (context/NER-aware detector + tokenization/redaction — task #19 done), `classify`, `breach`, `residency`, `retention`, `rtbf`, `lineage`, `frameworks`.
- The output-filter's `pii-redact` rule delegates to `DataProtectionPort` (the post-model redaction leg — once §2.8 G-PI-1 wires it).

### 3.5 Gaps (SECRET)
- **G-SEC-1 [HIGH]** No **closed-loop remediation** runbook/automation (leak-detect → rotate → revoke → verify-dead). `borjie-security.yml` does secret-scan but the post-detection loop isn't codified.
- **G-SEC-2 [MED]** No explicit **network egress allowlist** for outbound model/API calls (block-by-default, allow `api.anthropic.com`/`api.openai.com`/regulator feeds only) — the strongest exfil backstop and currently implicit.
- **G-SEC-3 [MED]** Confirm **pre-model** redaction (not only post-model): PII/secrets stripped before context assembly, not only on output.

**Beyond-today leap:** **zero-standing-secret** posture — replace long-lived API keys with **short-lived, workload-identity-scoped tokens minted just-in-time** (SPIFFE/OIDC, validity in minutes), so a leaked credential is dead before it's useful and "rotation" becomes "expiry." Combine with a **transparent egress proxy** (TLS-inspecting, JWT-authenticated, default-deny — the same shape Anthropic's agent sandbox uses) so every outbound byte is allowlisted and logged; an injected agent literally has no route to exfiltrate.

---

## 4. NETWORK / API — WAF, rate-limit, CORS allowlist, mTLS, runtime isolation

### 4.1 SOTA
- **Zero-trust service-to-service:** mTLS for the channel + **SPIFFE-style workload identity** + explicit policy enforcing service/tenant/env/capability boundaries; service-mesh ambient mode (Istio) gives low-overhead pod-to-pod mTLS. ([Backend Developers — zero-trust S2S 2026: mTLS, SPIFFE](https://thebackenddevelopers.substack.com/p/zero-trust-service-to-service-auth), [OpenShift Service Mesh 3.2 ambient](https://www.redhat.com/en/blog/introducing-openshift-service-mesh-32-istios-ambient-mode))
- **API gateway zero-trust:** WAF + SWG + ZTNA on north-south; default-deny; rate-limit; CORS allowlist (never reflective). ([Jimber — API gateway security in zero trust 2026](https://jimber.io/blog/api-gateway-security-zero-trust-2026/))
- **Runtime isolation for agent code:** three tiers — **microVMs** (Firecracker/Kata, dedicated kernel, strongest), **gVisor** (user-space kernel, syscall interception), hardened containers (trusted code only). Anthropic runs **gVisor + a three-layer egress control** with all outbound traffic through a JWT-authenticated, TLS-inspecting egress proxy. ([Northflank — how to sandbox AI agents 2026](https://northflank.com/blog/how-to-sandbox-ai-agents), [Pluto Security — inside Claude managed agents](https://pluto.security/blog/inside-claude-managed-agents/))

### 4.2 What Borjie HAS
- CORS origin allowlist (non-reflective, hard rule); per-route rate-limiter middleware; webhook idempotency + signature verification; tenant-context middleware binding the RLS GUC; **isolated-vm (V8 isolate) sandbox** for agent code; hardened K8s. Memory note `borjie-agent-isolation-security` rates posture **STRONG**.

### 4.3 Gaps (NETWORK)
- **G-NET-1 [HIGH]** The one **structural** isolation gap (per `borjie-agent-isolation-security`): **no kernel-level runtime isolation** (gVisor/Kata RuntimeClass) — isolated-vm is V8-level, not kernel-level. Add a `RuntimeClass: gvisor` (or Kata) for the sandbox workloads.
- **G-NET-2 [MED]** Rate-limiter is **process-local Map** (per `MASTER_GAP_REGISTER` RSS-08) → cap = max×replicas; move to a shared Redis token-bucket so the limit is global (also a scale gap).
- **G-NET-3 [MED]** No explicit **mTLS / SPIFFE** statement for internal service-to-service (api-gateway ↔ workers ↔ payments-ledger). Adopt mesh mTLS or SPIFFE identities.

**Beyond-today leap:** treat the agent runtime as **assume-already-breached**: every agent action runs in a **gVisor/Kata microVM** with a **default-deny egress proxy** (allowlist + TLS-inspection + JWT-auth), so a fully-compromised agent has no kernel surface and no network route off the allowlist — the blast radius of a successful jailbreak is provably bounded to "do nothing useful for the attacker."

---

## 5. SUPPLY-CHAIN + ASSUME-BREACH — SBOM/AI-BOM, SLSA, Sigstore, continuous red-team

### 5.1 SOTA
- **SBOM** (SPDX or CycloneDX) per CI job, merged app+container layers; now mandated (US EO 14028, EU CRA, FDA). **SLSA** graduated build-integrity (provenance L1 → tamper-proof L3; SLSA 1.2 released); **Sigstore** keyless signing via short-lived OIDC certs (kills the key-management problem); **in-toto/DSSE** attestation envelope; **pin dependencies** + isolated build env. ([Nathan Berg — SBOM/SLSA/Sigstore in CI](https://nathanberg.io/posts/supply-chain-security-ci-sbom-slsa-sigstore/), [AquilaX — beyond SBOMs: Sigstore, SLSA, build provenance](https://aquilax.ai/blog/supply-chain-artifact-signing-slsa))
- **AI-BOM** extends SBOM to models/datasets/prompts; the un-solved frontier is *provenance of the model + the prompts themselves*.
- **Continuous agent red-team:** AgentDojo (97 tasks / 629+ security cases, 7000+ scenarios) is the field standard; the 2026 finding is **near-100% ASR against undefended frontier agents**, so red-team must be **continuous + release-blocking**, not a one-time audit. ([AgentDojo — Inspect evals](https://ukgovernmentbeis.github.io/inspect_evals/evals/safeguards/agentdojo/), [PISmith — RL red-teaming for PI defenses, arXiv:2603.13026](https://arxiv.org/pdf/2603.13026))

### 5.2 What Borjie HAS
- `ai-bom-attest.yml` (AI-BOM generate + **Sigstore-sign**, release/nightly); `borjie-codeql.yml`, `borjie-semgrep.yml`, `borjie-security.yml` (dep-audit + secret-scan); `borjie-redteam.yml` (Promptfoo adversarial gate, LP-13); `red-team.yml`, `defection-probe.yml`, `sycophancy-probe.yml`, `reflexion-sleep-canary.yml`; `sandbox-load-test.yml`. The **continuous-proof scaffolding already exists** — Borjie is unusually mature here.

### 5.3 Gaps (SUPPLY-CHAIN)
- **G-SC-1 [MED]** No explicit **SLSA provenance level** target / build-provenance attestation on the *application* artifacts (only AI-BOM is Sigstore-signed). Add SLSA L3 provenance + Sigstore signing to the app/container build.
- **G-SC-2 [MED]** The built-in red-team scenarios (`agent-security-guard/redteam/builtin-scenarios.ts` + `borjie-redteam.yml`) should be **extended with an AgentDojo-style indirect-injection corpus** and run against the **live** brain endpoint with **ASR as a release gate** (some probes run against a stub sensor today).
- **G-SC-3 [LOW]** Confirm **dependency pinning** (lockfile-only installs, no floating ranges in CI) — `pnpm-lock.yaml` exists; assert `--frozen-lockfile` in every CI install.

**Beyond-today leap:** a **continuously-attested unhackable posture** — every release ships with SLSA-L3 build provenance + AI-BOM (model + dataset + **prompt-hash**) + a **fresh adversarial report**: the CI runs the full AgentDojo-class red-team + the `red-team-runner` + the canary/egress checks, and the release is **blocked** unless ASR ≤ threshold AND zero canary/IP-egress violations. The "unhackable" claim becomes a **signed, machine-verifiable artifact attached to each deploy** — assume-breach made auditable.

---

## 6. Present / Absent — the scorecard

| Capability | Status in Borjie |
|---|---|
| BFF / api-gateway holds secrets, SPA gets cookie | **PRESENT** (Hono BFF + Supabase JWT); token-handler-cookie specifics unverified |
| Non-reflective CORS allowlist | **PRESENT** (hard rule) |
| CSP + security headers on web | **PRESENT** (owner/admin `next.config.js`) |
| No prod source-maps guarantee | **ABSENT** (no `productionBrowserSourceMaps:false` / CI assert) |
| Mobile RASP / cert-pinning | **ABSENT** (buyer + workforce mobile) |
| Output-filter / IP-egress firewall (code) | **PRESENT** (`agent-security-guard/filter/output-filter`, hash-chained) |
| Output-filter WIRED into live answer path | **ABSENT — BLOCKER** (grep = empty) |
| Indirect-injection detector (code) | **PRESENT**; live tool-result wiring unverified |
| Canary tokens (system-prompt-exfil signal) | **PRESENT + WIRED** |
| CaMeL-style capability/quarantine split | **ABSENT** (policy-rule rail, not capability interpreter) |
| Spotlighting/delimiting of untrusted content | **ABSENT** |
| Dedicated guardrail model (Llama-Guard class) | **ABSENT** (heuristic detectors only) |
| Kernel rail outside the prompt (inviolable/meta-rail) | **PRESENT** |
| HITL dual-control for money/licence/deletion | **PRESENT** (hard rule) |
| KMS envelope encryption + PII tokenization | **PRESENT** (`data-protection/encrypt`,`pii`) |
| Pre-model redaction | **PARTIAL/UNVERIFIED** (post-model present) |
| Secret leak closed-loop remediation | **ABSENT** (scan present, remediation loop not codified) |
| Network egress allowlist (default-deny) | **ABSENT/IMPLICIT** |
| mTLS / SPIFFE internal S2S | **ABSENT/UNVERIFIED** |
| isolated-vm sandbox | **PRESENT** |
| Kernel-level runtime isolation (gVisor/Kata) | **ABSENT** (the one structural infra gap) |
| Shared (Redis) rate-limit | **ABSENT** (process-local Map) |
| RLS FORCE + WITH CHECK + revocation | **PRESENT** |
| SBOM / AI-BOM + Sigstore signing | **PRESENT** (AI-BOM); SLSA app-provenance **ABSENT** |
| Continuous red-team / probe CI | **PRESENT** (`borjie-redteam`, defection, sycophancy, sandbox-load) |
| Red-team run against LIVE endpoint, ASR gate | **PARTIAL** (some on stub sensor) |

---

## 7. Critical holes (do-first, ranked)

1. **[BLOCKER] Wire the output-filter (IP-egress firewall) into the live brain answer path** + indirect-injection detector on tool-result re-ingestion. The single highest-leverage fix: the defense exists but is dark. (= SEC-G1.)
2. **[HIGH] Mobile RASP + dynamic cert-pinning** before buyer/workforce apps touch money/KYC.
3. **[HIGH] Closed-loop secret remediation** + **default-deny network egress allowlist** for outbound model/API calls.
4. **[HIGH] Kernel-level runtime isolation** (gVisor/Kata RuntimeClass) for agent sandbox workloads — the one structural infra gap.
5. **[HIGH] BFF token-handler hardening** — verify Supabase tokens are HttpOnly server-side, never JS-readable; add the "prove-the-client-is-empty" CI gate.
6. **[MED] CaMeL-style Session→Governor→Executor capability split** + spotlighting + a dedicated guardrail model, so jailbreaking a rail becomes structurally (not probabilistically) impossible.
7. **[MED] SLSA-L3 app provenance** + extend red-team to AgentDojo-class indirect-injection corpus run against the **live** endpoint with **ASR as a release gate**.
