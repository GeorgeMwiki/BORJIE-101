# LITFIN deep evaluation + gap-closure backlog — 2026-06-03

**Author:** Brain-layer engineering (Mr. Mwikila platform team)
**Scope:** Full architecture evaluation of the LITFIN project, identification of
interesting/SOTA engineering worth having in Borjie, and a complete,
prioritized gap-closure backlog — including gaps the prior 5 LITFIN port docs
never covered.
**Method:** 9 parallel read-only analysis agents (8 LITFIN domains + 1 Borjie
port/wiring verifier), then **direct code verification** of every load-bearing
claim (greps cited inline with ✓). Read-only; no source modified by this audit.
**Supersedes nothing** — extends `LITFIN_PARITY_AUDIT_DYNAMIC_LLM_LAZY_LOAD`,
`LITFIN_REMAINING_PORTS`, `LITFIN_PORT_WAVE_PO_14_19`, `AUDIO_LOGICS_LITFIN_RESEARCH`.

> **Relationship:** LITFIN (`Claude Projects/LITFIN PROJECT/`) is an AI-native
> *lending/fintech* platform for East Africa; Borjie is an AI-native *mining-estate*
> OS by the same author. Both descend from the BOSSNYUMBA lineage. Borjie was
> built largely by porting LITFIN's **horizontal** engineering (reasoning,
> routing, governance, memory, observability, UI, voice, data-infra). The
> *vertical* lending domain (credit scoring, Basel, KYC-bank, loan collection,
> CRB) is intentionally **not** ported.

---

## 0. Executive summary

Three things are true at once:

1. **The #1 gap is wiring debt, not missing features.** ~47% of distinctly
   ported packages are **orphans** (0 importers), and the entire May-2026
   `litfin-port-*-extra` wave (~31 modules, ~335 tests) is **100% dark**. Worse,
   the flagship **deep-reasoning composer is hard-wired to `null`** at the
   gateway — so LATS, Self-Discover, ToT, GoT, SoT and the Process-Reward-Model
   are imported, unit-tested, and **never run in production**. `semantic-cache`,
   `intent-verifier`, and the reflexion store are similarly built-but-dark.
   `KI-DEBT-001` declassified this as "not a bug," so it is **untracked and
   rotting**. Closing it is the highest-ROI work available and mostly needs
   *wiring*, not new code.

2. **LITFIN still has genuinely interesting engineering Borjie lacks.** The
   strongest net-new candidates: the **feature-phone ingress stack**
   (USSD + Africa's-Talking IVR→STT + unified channel gateway — Borjie's single
   biggest *capability* gap, and highly mining-relevant), the **epistemic belief
   layer + convince-loop + unifying signal-emitter** (Borjie has the pieces but
   not the loop), the **promptfoo red-team CI gate** (highest safety ROI), the
   **fail-*fixed* language rewriter** (Borjie's contamination guard fails *open*,
   violating the absolute zero-EN/SW-mix mandate), **sleep-pass durability**, the
   **ledger attestor** (neither sibling has it), and a set of LLM-serving
   primitives (prompt-budget trim, IP-protection prompt layers, Redis
   concurrency gate, cross-provider numeric-claim auditor).

3. **Borjie already leads LITFIN in several domains** — data platform, the
   gap-detection meta-tooling, GenUI catalog, RLVR verifiers, the reasoning
   *library* (ToT/GoT/SoT/PRM), and infra. We should **not** re-port those; in a
   few places LITFIN should learn from Borjie.

**Net recommendation:** run a **Wave 0 "turn the lights on"** (wire what's already
built) before any new porting. It converts ~70 already-written files and ~335
tests from latent to live for a fraction of the cost of the feature ports.

---

## 1. The dominant finding — wiring debt (all ✓ verified in code)

| # | Built-but-dark asset | Evidence (verified) | Impact |
|---|---|---|---|
| W1 | **Cognitive composer pinned `null`** — the 12-wire deep-reasoning pipeline (Self-Discover, Plan-and-Solve, LATS, ToT, GoT, SoT, PRM, calibration) never executes | `services/api-gateway/src/composition/cognitive-wiring.ts:206` (`readonly composition: null`) + `:406` (`composition: null`); `enrichBrainTurnWithCognitive` only does memory recall | The "SOTA brain" markets a depth it does not run. Import-grep audits mark these **WIRED** (they *are* imported) — functionally **UNWIRED**. |
| W2 | **7 orphan port packages** — all 6 `litfin-port-*-extra` + `memory-port-extensions` | `rg @borjie/<pkg> services apps packages` (excl self/tests) = **0** for every one | ~31 modules / ~335 tests of safety, observability, GenUI, memory-RAG, MCP/saga primitives are shipped and untouchable. |
| W3 | **`semantic-cache` unwired** | `packages/central-intelligence/src/kernel/semantic-cache/` exists; 0 importers in `services/`/`apps/` | Cache-hit cost savings unrealized; every call hits the model. |
| W4 | **`intent-verifier` unwired** | `packages/autonomy-governance/src/policy/intent-verifier.ts` exists; **no kernel reference** | Proposed tool-calls are not checked against the user ask pre-exec — a real safety seam is dark. |
| W5 | **Reflexion store orphaned** | `packages/memory-v2/src/reflective/` not fed by any learning signal | Self-improvement loop can't accumulate lessons. |

> Audit-hygiene corollary: `KI-DEBT-001` removed these from the bug register
> ("deliberate test-isolation seams"). That is defensible for *leaf* in-memory
> adapters, but it has masked **W1–W5**, which are genuine integration gaps, not
> test seams. Re-open them as tracked work (done — see §3 LP-01..LP-05).

---

## 2. LITFIN engineering worth having (by domain)

Status legend: **ABSENT** · **PARTIAL** · **PORTED** · **DARK** (ported-but-unwired).
Portability is to a *mining-estate* OS. Effort: S (<150 LOC) / M / L.

### 2.1 Brain reasoning & agentic pipeline
| Pattern | LITFIN | Borjie status | Port | Eff |
|---|---|---|---|---|
| LATS (MCTS over LLM rollouts, UCT, LM value-fn, auto-Reflexion) | `src/core/brain/tree-search.ts` | **DARK** (`packages/extended-reasoning/src/lats/`) | HIGH — licence-renewal/offtake/capex are branching decisions | S (wire) |
| Self-Discover scaffold (SELECT/ADAPT/IMPLEMENT) | `src/core/brain/self-discover-scaffold.ts` | **DARK** (`reasoning-substrate/src/self-discover/`) | HIGH | S (wire) |
| Megaprompt deterministic 15-fragment ordering (prompt-cache-stable) | `src/core/brain/megaprompt-assembler.ts` | **PARTIAL** (`kernel/compose.ts`, not order-asserted) | HIGH — direct Anthropic cache cost win | S |
| `runTurn` typed stage-bus (intent→megaprompt→plan→step→outcome→learning) | `src/core/brain/agentic-pipeline.ts` | **PARTIAL** (`kernel/orchestrator/main-loop.ts` has the loop, not the bus) | MED — single OTel/learning seam | M |
| isolated-vm V8 sandbox (16MB heap, true wall-clock interrupt) | `src/core/litfin-ai/sandbox/js-sandbox.ts` | **PORTED+WIRED** (Borjie adds tiered policy caps — *ahead*) | — | — |
| Self-RAG / counter-model / DecisionTrace / Reflexion / sub-MDs+VPs / defection-probe | various | **PORTED+WIRED** (re-skinned to mining) | — | — |

### 2.2 LLM routing / serving / prompting
The prior parity audit's 21 ports are mostly closed; **8 remain genuinely absent**.
| Pattern | LITFIN | Borjie status | Port | Eff |
|---|---|---|---|---|
| Prompt-budget trim cascade + `estimateTokens` + per-intent token limits + history-summarize | `src/core/litfin-ai/llm/{prompt-budget.ts:77-99,speed-config.ts}` | **ABSENT** (no token SLO/telemetry at all) | HIGH | M |
| IP-protection + security-boundary prompt-hardening layers | `src/core/litfin-ai/llm/prompt-assembler.ts:932,982` | **ABSENT** (no jailbreak/IP-leak system layer) | HIGH — corpus holds tenant-confidential data | S |
| Per-tenant concurrency gate **Redis/Upstash backend** | `src/core/ai/concurrency-gate-redis.ts` | **PARTIAL** — Borjie's is in-memory `Map` only ✓ (`concurrency-gate.ts:100`) — breaks across replicas | HIGH | M |
| Cross-provider numeric-claim auditor (5% sample, 100% for numeric/regulatory) | `src/core/truth-engine/cross-provider-auditor.ts` | **ABSENT** | HIGH — royalty/pricing claim integrity | M |
| Self-judge regenerate loop | `src/core/ai/claude-service.ts` | **ABSENT** (only consistency-vote + CoVe) | MED | M |
| Rolling-Brier per-provider quality routing | `src/core/litfin-ai/llm/soul-router.ts` | **ABSENT** (fallback is failure-only) | MED | M |
| Speculative decoding · KV-cache prefix registry · per-thread effort selector · consulting task taxonomy | `ai/{speculative-decoding,kv-cache}`, `chat/effort-resolver.ts` | **ABSENT** | LOW (experimental tail) | M |

### 2.3 Governance / security / privacy / regulator
| Pattern | LITFIN | Borjie status | Port | Eff |
|---|---|---|---|---|
| **promptfoo red-team CI gate** (inj./cross-tenant-leak/tier-bypass/killswitch-persuasion/fabrication, 98% gate) | `tests/redteam/promptfoo.config.yaml` | **ABSENT** ✓ (only a doc mentions it) | HIGH — highest safety ROI; probes exist but no adversarial suite | M |
| **sovereign-claim** HMAC + recent-MFA + scope-binding | `src/core/governance/tier-policy/sovereign-claim.ts` | **ABSENT** (stolen cookie/role-string can mint sovereign action) | HIGH | M |
| Privacy Router — sensitivity-tier→provider (RESTRICTED→local/deny) (**PO-17**) | `src/core/security/privacy-router.ts` + `.yaml` | **ABSENT** (egress scrub exists; routing layer doesn't) | MED — data-residency lever for BOT/PDPA | M |
| Regulator-sim audit-replay (**PO-20**) + Blind-review M5 (**PO-22**) | `src/core/security/{regulator-sim,blind-review}/` | **ABSENT** | MED — maps onto TZ mining regulator | M |
| Reason-based tier-policy, Constitution+verifyCitations (**PO-13**), OCSF, hash-chain, cross-org-denials, CoT-reservoir, k-anon/DP, SSRF safeHttpFetch | various | **PORTED+WIRED** (PO-13 landed; several *ahead* of LITFIN) | — | — |

### 2.4 Memory / knowledge / learning
Borjie has the parts but **not the closed loop** (~55–60% by capability, ~35% by integration).
| Pattern | LITFIN | Borjie status | Port | Eff |
|---|---|---|---|---|
| **Epistemic belief layer + convince-loop** (revise belief only when confidence Δ>0.25; never write beliefs directly) | `src/core/litfin-ai/learning/convince-loop.ts` | **ABSENT** — no epistemic substrate at all | HIGH — directly serves "evidence-required AI output" rule | L |
| **Unifying signal-emitter fan-out** (one action→outcome→reward→[belief\|DPO\|mastery\|pattern\|GEPA\|reflexion]) | `src/core/learning/signal-emitter.ts` | **ABSENT** (loop-runner persists quality only) | HIGH — the spine that makes it one loop; activates W5 | M |
| DPO preference-learner + LinUCB bandit | `src/core/learning/preference-learner.ts` | **ABSENT** | HIGH (pure, tiny-data) | M |
| Mem0 ADD/UPDATE/DELETE/NOOP semantics · cohort-concentration gate · memory↔KG bi-temporal bridge · nightly Pearson belief×outcome | `src/core/litfin-ai/memory/v2/*`, `learning/correlation-detector.ts` | **ABSENT/PARTIAL** | HIGH (all S, all pure) | S |
| GEPA / DSPy-MIPRO / GraphRAG communities / online conformal / RLVR | various | **PORTED/PARTIAL** (Borjie's RLVR verifiers are *ahead*) | — | — |
| V-JEPA-2 world-model **trainer** | `scripts/train-world-model/` | **PARTIAL** (linear extrapolator + swap-behind port) | DEFER — data-bound; keep the port hook | L |

### 2.5 Data platform / ledger / sidecars (Borjie mostly *ahead* here)
| Pattern | LITFIN | Borjie status | Port | Eff |
|---|---|---|---|---|
| **Ledger attestor** (Merkle root + external object-lock/transparency-log signing) | Step-4 in the isolation doc | **ABSENT in BOTH** — highest tamper-evidence control for a royalty/treasury ledger | HIGH (build on `audit-hash-chain`) | M |
| Ledger physical isolation: engine/api/attestor as separate **Postgres roles**, write-role INSERT-only | `Docs/ARCHITECTURE-LEDGER-ISOLATION.md` | **PARTIAL** — `payments-ledger` is one deployable; verify distinct DB roles or `LedgerService.post()` is partly theater | MED | M |
| MCP **per-tenant calls/day meter** (calls axis, separate from token spend) | `src/core/mcp/budget/per-tenant-meter.ts` | **ABSENT** | MED | S |
| CDC transport-agnostic projection router (testable without PG) | `src/core/cdc/projection-stream.ts` | **PARTIAL** (Supabase-coupled) | MED | S |
| TabPFN + anomaly (DIF/LSTM) **sidecar adapter pattern** ("auditable 2nd opinion, never changes the live decision") | `services/{tabpfn,anomaly}-sidecar` | **ABSENT** (Borjie has `anomaly-detection` pkg, no sidecar) | HIGH — ore-grade/assay/fraud/failure | M |
| Outbox-refuses-memory-boot · optimistic-concurrency CTE · tenant-isolation-guard+leak-scanner · anti-corruption-layer pkg · forward-only saga compensation | — | **Borjie AHEAD** — do not re-port | — | — |

### 2.6 Observability / SRE / eval-ops
| Pattern | LITFIN | Borjie status | Port | Eff |
|---|---|---|---|---|
| **Sleep-pass durability** — `brain_sleep_runs`/`emissions` rows + `raceAgainstAbort` LLM-interrupt + aggregate budget w/ platform-cap undercut | `src/core/heartbeat/{sleep-tick.ts,sleep-passes/race-against-abort.ts}` | **PARTIAL** — Borjie keeps state in an in-memory `Map`; a slow LLM call can starve all later passes with zero audit trail | HIGH — biggest ops unknown-unknown | M |
| Deterministic eval-ops **release-gate CLIs** (capability-evals + sota-validation → dated reports + CI exit) | `scripts/run-{capability-evals,sota-validation}/run-all` | **PARTIAL** (engines exist as workers; no run-all gate) | MED | M |
| Model-card **renderer** (Mitchell et al.) | `scripts/emit-model-card-pure.mjs` | **PARTIAL** (only a coverage *auditor*) | MED | M |
| `deploy-preflight` cron↔route coverage gate | `scripts/deploy-preflight.mjs` | **PARTIAL** | MED | M |
| AXTree replay wired to decision-trace · METR time-horizon eval · audit-streamer Helm chart · runbook-linked Prom rules | various | **PARTIAL/ABSENT** | MED | S–M |
| not-yet-wired auditor · RLS-coverage auditor | `scripts/litfin-audit-*` | **PORTED & BROADER** — Borjie *ahead* | — | — |

### 2.7 Frontend / GenUI / i18n
| Pattern | LITFIN | Borjie status | Port | Eff |
|---|---|---|---|---|
| **Fail-*fixed* dynamic-language-rewriter** (detect contamination → live AI rewrite → cache) | `src/core/language-intelligence/dynamic-language-rewriter.ts` | **PARTIAL & fails-OPEN** ✓ — `translation/contamination.ts` throws, `translate.ts` returns *source text* on failure; never repairs → can ship wrong-language to user | HIGH — enforces the absolute zero-mix mandate at runtime | M |
| conversation-feel guard suite (sycophancy/hedging/brevity/position/rhythm) | `src/core/conversation-feel/guards/*` | **PARTIAL — shell only** (Borjie shipped the package skeleton, not the guard logic — silent capability gap) | HIGH (pure, locale-agnostic) | M |
| Streaming-artifact contract (`StreamingArtifact<T>` open/delta/close) + choreography engine | `src/core/smartboard/{chat-artifact-stream-parser,choreography-engine}.ts` | **ABSENT** (Borjie renders fully-formed 2D artifacts post-event) | MED — progressive rendering, ~80% of "smartboard feel" | M |
| 3D SDL→Three.js compiler · voice-camera sync · 3D avatar professor | `src/core/smartboard/`, research docs | **ABSENT** | LOW — heavy dep tail; avatar not even buildable from LITFIN today | L |
| GenUI catalog/projector · lazy-load/INP toolkit · recommendation bandits | — | **PORTED / Borjie AHEAD** (43 catalog components) | — | — |

### 2.8 Voice / document-intelligence / omnichannel — **Borjie's single biggest capability gap**
| Pattern | LITFIN | Borjie status | Port | Eff |
|---|---|---|---|---|
| **USSD menu-tree + session state machine** (feature-phone primary ingress) | `src/core/ussd/*` | **ABSENT** | HIGH — artisanal miners on feature phones | M |
| **Africa's-Talking IVR → inline STT → field-extraction** loop | `src/core/voice/channels/africas-talking-voice.ts` | **ABSENT** (AT exists only as outbound SMS) | HIGH | M |
| **Unified `ChannelEvent` gateway** (WhatsApp/SMS/USSD/voice/email/web canonicalize+verify+tier) | `src/core/channels/gateway/*` | **ABSENT** (siloed per-connector pollers) | HIGH | M |
| **Cross-channel state-sync** (Redis, WhatsApp 24h window, handoffs) | `src/core/omnichannel/state-sync.ts` | **ABSENT** | HIGH | M |
| Cross-document fact reconciliation · confidence-calibration + self-consistency vote · per-issuer fingerprint · EML/MSG/M-PESA-SMS/QR extractors · table-transformer/formula | `src/core/document-intelligence/*` | **ABSENT** (domain-neutral plumbing; ~80% portable) | MED–HIGH | M |
| Voice hardening: replay/spoof classifier→challenge · P95-TTFB TTS auto-failover · RNNoise · AudioSeal watermark + AI-voice disclosure | `src/core/voice/*` | **PARTIAL** | MED | S each |

---

## 3. Gap-closure backlog (the deferred issues)

The original P65 master doc (`LITFIN_PORTING_OPPORTUNITIES_2026-05-24.md`) is
**lost** — absent from both repos and from git history. This backlog reconstructs
and supersedes it from direct codebase comparison. Each `LP-NN` is filed as a
tracked task this session.

### Wave 0 — Turn the lights on (wiring debt; do first)
- **LP-01 · HIGH ·** Un-`null` the cognitive composer (`cognitive-wiring.ts:406`); route LATS + Self-Discover via `kernel/ttc-allocator.ts` (stakes 0.5–0.8 → Self-Discover, hard edge → LATS). *Turns ~70 written/tested files live.*
- **LP-02 · HIGH ·** Resolve the 7 orphan packages: wire each `litfin-port-*-extra` + `memory-port-extensions` into a real consumer, or formally retire (move to `_archive`) with a decision record. Re-open `KI-DEBT-001` scope.
- **LP-03 · HIGH ·** Wire `central-intelligence/semantic-cache` into the `brainCall`/LLM path (L1→semantic→prompt-cache).
- **LP-04 · HIGH ·** Wire `autonomy-governance/intent-verifier` into the kernel think-pipeline (post-LLM, pre-exec).
- **LP-05 · MED ·** Feed the orphaned `memory-v2/reflective` store from the signal-emitter (depends on LP-17).

### Wave 1 — Safety & correctness (high ROI, mostly small)
- **LP-06 · HIGH/S ·** Megaprompt deterministic-fragment ordering in `kernel/compose.ts` (prompt-cache stability).
- **LP-09 · HIGH/S ·** IP-protection + security-boundary prompt-hardening layers.
- **LP-13 · HIGH/M ·** promptfoo red-team CI gate, re-skinned to mining/sovereign-write/killswitch/PDPA-fabrication.
- **LP-14 · HIGH/M ·** sovereign-claim HMAC + recent-MFA + scope-binding on tier elevation.
- **LP-23 · HIGH/M ·** Replace fail-open contamination with the fail-*fixed* dynamic-language-rewriter (zero-mix mandate).
- **LP-28 · LOW/S ·** Re-skin property-domain residuals (`four-eye-approval.ts:20-23` + sweep `eviction`/`owner_payout`/`kra.file_mri_return`) to mining.

### Wave 2 — Capability gaps (net-new value)
- **LP-25 · HIGH/L ·** Feature-phone ingress stack: USSD engine + AT IVR→STT + unified `ChannelEvent` gateway + cross-channel state-sync (reuse `audio-capture` STT + `field-capture-service`).
- **LP-17 · HIGH/L ·** Epistemic belief layer + convince-loop (Δ>0.25) + unifying signal-emitter fan-out.
- **LP-21 · HIGH/M ·** Sleep-pass hardening: `brain_sleep_runs`/`emissions` persistence + `raceAgainstAbort` + aggregate budget w/ platform-cap.
- **LP-19 · HIGH/M ·** Ledger attestor (Merkle + external object-lock signing) on `audit-hash-chain`.
- **LP-10 · HIGH/M ·** Concurrency-gate Redis/Upstash backend (multi-replica).
- **LP-08 · HIGH/M ·** Prompt-budget trim cascade + estimateTokens + per-intent token limits + history-summarize (token SLO/telemetry).
- **LP-11 · MED/M ·** Cross-provider numeric-claim auditor (royalty/pricing) + self-judge regenerate loop.

### Wave 3 — Depth & regulator readiness
- **LP-07 · MED/M ·** `runTurn` typed stage-bus over `main-loop` (outcome+learning closure, OTel seam).
- **LP-18 · MED/M ·** DPO preference-learner + LinUCB bandit + cheap memory-semantics (Mem0 ops, bi-temporal bridge, nightly Pearson belief×outcome).
- **LP-15 · MED/M ·** Privacy Router (PO-17): sensitivity-tier→provider routing.
- **LP-16 · MED/M ·** Regulator-sim audit-replay + blind-review (PO-20/22) for TZ mining regulator.
- **LP-20 · MED/M ·** Ledger role separation (engine/api INSERT-only grants) + MCP per-tenant calls/day meter + CDC transport-agnostic router.
- **LP-22 · MED/M ·** Eval-ops release-gate CLIs + model-card renderer + deploy-preflight cron-coverage gate.
- **LP-26 · MED/M ·** Document reconciliation + confidence-calibration + issuer-fingerprint + EML/MSG/M-PESA-SMS/QR extractors.
- **LP-24 · MED/M ·** Fill conversation-feel guard stubs + streaming-artifact contract + choreography.
- **LP-27 · MED/S ·** Voice hardening: replay classifier→challenge, P95 TTS auto-failover, RNNoise, AudioSeal + AI-voice disclosure.
- **LP-12 · LOW/M ·** Speculative decoding + KV-cache prefix registry + per-thread effort selector (experimental tail).
- **LP-29 · LOW/L ·** 3D smartboard (SDL→Three.js, voice-camera sync) — spike only; avatar deferred (not buildable from LITFIN today).

---

## 4. Explicitly NOT worth porting (lending-specific)
Credit-rating math (Basel III RWA), KYC tiering tied to bank-account opening,
loan-collection escalation tree, CRB/bureau integrations, PD/LGD/EAD + SHAP
adverse-action, `credit-mind` borrower-state world-model, `memory/v2/fraud-graph`
credit-network relations, banking glossary/5C teaching content, and the lending
sub-MDs (loan-officer-chaser, credit-bureau-filer). Borjie already re-skinned the
*structures* (debate, cohort-signal, sub-MDs, document extraction) to mining — do
not carry the lending *payloads*.

## 5. Where Borjie already leads LITFIN (do not re-port)
Data platform (outbox-refuses-memory-boot, optimistic-concurrency CTE,
tenant-isolation-guard + leak-scanner, anti-corruption-layer package, workflow
modularity, forward-only saga compensation), gap-detection meta-tooling
(`audit-not-yet-wired` + bidirectional RLS-coverage auditors), GenUI catalog
(43 typed components + no-eval projector), the reasoning *library*
(ToT/GoT/SoT/PRM superset), RLVR verifiable verifiers, sandbox tiered-policy
caps, dynamic model registry (real `/v1/models` numeric version-compare),
hedged-requests, cost-cascade (RouteLLM), multi-region terraform, and a real
offline `field-capture-service`.

## 6. Recommended sequence
**Wave 0 first, always.** Wiring debt is near-free and unlocks the most value
(a live deep-reasoning brain, 7 packages, semantic cache, intent verification).
Then Wave 1 (safety/correctness), Wave 2 (capability gaps), Wave 3 (depth).
The lost P65 doc means this file is now the canonical port backlog — keep it in
sync with the `LP-NN` tasks and (recommended) mirror Wave-0/1 items as `R*`
entries in `Docs/ROADMAP.md`.

## 7. Provenance
9 parallel agents (brain, LLM-infra, governance, memory, data, observability,
frontend, voice, Borjie-verifier). Wiring-debt + correctness claims independently
verified by grep against the working tree on branch `rls-connection-pinning`
(2026-06-03); LITFIN source pointers are agent-sourced from `Claude Projects/LITFIN PROJECT/`.
