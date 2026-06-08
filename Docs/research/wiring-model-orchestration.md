# Wiring the Model-Orchestration Frontier — Many Models as One Intelligence

**Lane:** model-orchestration-frontier
**Author:** research subagent (Mr. Mwikila frontier-wiring program)
**Date:** 2026-06-09
**Status:** dossier — no code, no commit. A wiring map for the existing substrate.
**Owner directive:** "Think about wiring ways we don't even know we can do. Deep
online research, expand to 1000000%, FULL SOTA."

---

## 0. The substrate we are wiring INTO (ground truth from the repo)

This dossier is not greenfield. Borjie already ships a deep orchestration spine.
The job is to wire the 2026 frontier *into the seams that already exist*, not to
rebuild. The honest inventory:

**`packages/brain-llm-router/` — the LLM-as-Soul layer.** Single entry point
`brainCall({task, prompt, tenantId, options?}, ctx)` in
`src/brain-call-orchestrator/brain-call.ts`. Today its pipeline is: resolve
task-ladder → load DSPy-compiled prompt → preflight cost → provider-fallback
iterate → optional N-sample self-consistency vote → optional CoVe verify →
optional 2-provider hedge → postflight charge → drift log. It already owns:
- `cost-cascade/` — Haiku→Sonnet→Opus escalation gated by a duck-typed `evalFn`
  (this is a *manual* cascade; the eval is caller-supplied, not learned).
- `dspy-compile/` — a **simplified MIPROv2 port**. Crucially: it accepts
  caller-supplied candidate instructions and does NOT synthesise instructions
  on the fly (compiler.ts header says so explicitly).
- `judge-loop/`, `cross-provider-auditor/`, `hedged-requests/`, `effort/`
  (per-thread reasoning-effort selector), `task-ladder/`, `dynamic-registry/`
  (live model catalog + min-tier policy), `routing-overrides/`, `cost-meter/`,
  `cost-cap/`, `eval-drift-logger/`.

**`packages/central-intelligence/src/kernel/` — the CoALA cognitive kernel.**
Already has `ttc-allocator.ts` (4-tuple test-time-compute selector:
fast/deliberate/judge/multi-sample × samples × budgetUsd × maxTokens),
`model-tiering.ts` (cheap/standard/deep tier policy, env-flagged OFF by default),
`semantic-cache/` (embedder + cache-store + nearest-neighbour), `debate/`
(three-agent debate + counterfactual + default voices), `lats-search.ts`
(LATS tree search), `cot-reservoir.ts`, `orchestrator/` (main-loop, decision,
honest-confidence, batch-api, anthropic-router, tool-dispatcher).

**`packages/llm-budget-governor/` — cost-weighted token budget governor.**
Tier catalog → caps, cost-weighted metering, 5h rolling-session window, honest
three-state billing, auto-downgrade, postgres-store.

**Admin Control Plane (just launched).** Core LLM + ordered fallbacks + ensemble
modes {first-wins/vote/judge/debate} + per-use-case routing + AI-suggest. The
admin UI surface at `apps/admin-web/src/app/internal/models/page.tsx` is **still a
STUB** (hard-coded `MODELS` array, "Refresh metrics" button disabled, "Pending
gateway wiring"). This is the single most important wiring gap: the control plane
exists conceptually but the observability/learning loop that should feed it is dark.

**Also present:** `blackboard-sota` CRDT meta-substrate (live cross-surface
state-bus), EstateMind Slow Loop (perceive→orient→motivate→propose, leader-elected,
propose-only), IP-egress + input-containment guards, agent-platform (A2A auth /
webhooks / idempotency), durable-execution (Inngest, **currently unwired**).

**The orchestration gap in one sentence:** Borjie has every *primitive* of model
orchestration as a hand-wired, statically-configured component, but it has no
**learned, self-optimising, compiled routing graph** that closes the loop from
`eval-drift-logger` + `cost-meter` back into routing decisions. Everything below
is about turning the static graph into a living one — and the substrate to do it
is already 80% there.

---

## 1. Mixture-of-Agents (MoA) — layered ensembles

### State of the art (June 2026)
MoA stacks LLMs in layers; each layer's models receive the *concatenated outputs
of the previous layer* as additional context, then a final aggregator synthesises.
Open-source MoA hit 65.1% on AlpacaEval 2.0 vs GPT-4 Omni's 57.5% (ICLR 2025
Spotlight, Together AI). The 2026 frontier is about killing MoA's cost:
- **Pyramid MoA (2026):** a lightweight router decides per-query whether the full
  multi-model stack is needed or a single model suffices — 93.0% GSM8K at **−61%
  compute**.
- **Symbolic-MoE (Chen et al., 2026):** *instance-level* skill-based recruiting —
  selects experts per-instance by symbolic skill tags (e.g. "algebra",
  "metallurgy-assay"), each expert reasons, an aggregator synthesises; +8.15% avg
  over best baseline, 16 models on one GPU via expert-batched inference.
- **MOSAIC (2606.03014):** adaptive aggregation + inference concurrency scheduling
  to make MoA cheap enough to serve.
- **Rethinking-MoA / "Is mixing different LLMs beneficial?":** the sobering result
  — self-MoA (same strong model, multiple samples) often *beats* heterogeneous
  MoA because mixing weak models drags the aggregator down. Diversity must be
  *quality-gated*, not blind.

### How Borjie wires it
The kernel ALREADY has `debate/three-agent-debate.ts` and `default-voices.ts` —
that is a one-layer MoA in disguise (proposers + a synthesiser). Promote it to a
first-class **`moa-layer` mode** in `brain-call-orchestrator`:
- New `BrainCallOptions.ensemble: 'first-wins' | 'vote' | 'judge' | 'debate' |
  'moa'` (the control-plane already names the first four — `moa` is the fifth).
- An MoA layer = N proposer `BrainLLMClient`s (drawn from the `task-ladder` plus
  cross-provider entries) → an aggregator client. Reuse `majorityVote` for the
  cheap variant, the `judge-loop` synthesiser for the rich variant.
- **Symbolic-MoE instance routing** maps perfectly onto Borjie's *junior agents*:
  each junior (`metallurgy-agent`, `compliance-agent`, `cost-engineer`,
  `fx-treasury-agent`, `safety-agent`, `esg-disclosure-agent`,
  `machinery-advisory-agent`, `structural-civil-agent`) IS a symbolic skill.
  Wire a per-instance recruiter that reads the kernel's intent/skill tags and
  recruits only the relevant juniors as MoA proposers — gradient-free, exactly
  Symbolic-MoE's design.
- Quality-gate the diversity (the Rethinking-MoA lesson): only admit a model into
  the proposer set if its `eval-drift-logger` pass-rate for that `task` is above a
  floor. The control plane's per-use-case routing table becomes the recruiting
  policy; the `llm-budget-governor` caps how many proposers a tier may fan out to.

**BEYOND-TODAY leap:** *Evidence-gated MoA.* Borjie's hard rule is
"every junior recommendation cites ≥1 evidence_id." Make the MoA aggregator a
**citation-merging** synthesiser: it doesn't just vote on text, it unions the
evidence chains, drops any proposer whose claim lacks corroborating evidence in the
intelligence corpus, and emits a single answer whose evidence set is the
*intersection-validated union*. No published MoA does evidence-chain fusion — this
is mining-grade epistemic MoA.

**AMPLIFIES Borjie:** the three-agent debate becomes a *budget-aware, skill-recruited,
evidence-fused* council — the literal "Mr. Mwikila convenes his juniors" metaphor,
now real and cost-bounded by the governor.

**WE-DID-NOT-KNOW-WE-COULD:** run MoA *across the CRDT blackboard* — each proposer
junior writes its draft into a named blackboard slot (LWW + version-vector), the
aggregator reads the slots. The blackboard becomes the MoA inter-layer bus, so MoA
rounds are **durable, inspectable, and resumable** (via Inngest) instead of
ephemeral in-memory fan-out. Nobody ships MoA-on-a-CRDT-blackboard.

---

## 2. Model CASCADES — cheap→expensive escalation by difficulty

### State of the art
Cascades run the cheapest model first and escalate only when a confidence/agreement
signal says the answer is unreliable. RouteLLM-style cascades cut MT-Bench cost 85%
at 95% GPT-4 quality; on structured tasks (MMLU/GSM8K) 35–46%. The 2026 survey
"Dynamic Model Routing and Cascading for Efficient LLM Inference" (2603.04445)
unifies cascades + routers and shows the best systems *learn* the escalation
threshold per-domain rather than fixing it.

### How Borjie wires it
`cost-cascade/cascade-runner.ts` already does Haiku→Sonnet→Opus with a duck-typed
`evalFn` and budget cap. Two upgrades turn it SOTA:
1. **Learned escalation gate.** Today `confidenceThreshold` defaults to 0.6 and is
   global. Wire a per-`task` threshold learned from `eval-drift-logger` history:
   for each task, find the threshold on the cheap-model score that historically
   predicts the expensive model would *not* have changed the answer. The
   `eval-drift-logger` already records `confidence`, `costUsd`, `task`,
   `fallbackDepth` — that IS the training set.
2. **Self-consistency as the cascade eval.** The cleanest `evalFn` is "run the
   cheap model 3× cheaply; if they agree, ship; if they disagree, escalate." The
   orchestrator already has `majorityVote`; plug its `consistency` score in as the
   cascade gate. Disagreement-triggered escalation is the single best cost/quality
   lever and needs zero new model infra.

**BEYOND-TODAY leap:** *Stakes-coupled cascades.* Wire the kernel's
`ttc-allocator` 4-tuple directly into the cascade depth. `stakes=low` → 1 step,
cheap-only. `stakes=critical` → start mid-ladder AND require evidence-audit at
each step. The cascade depth becomes a function of (difficulty × stakes × budget),
not just difficulty — a mining-domain refinement (a $2M offtake settlement and a
"what's the weather" both have difficulty, but only one deserves Opus×5).

**AMPLIFIES Borjie:** bulk tenant chat (the 90% volume) rides Haiku; the
$0.6-budget critical path rides the full ladder; the governor's auto-downgrade and
the cascade share one budget envelope.

**WE-DID-NOT-KNOW-WE-COULD:** cascade *across providers AND across local vLLM*.
The `universal-client` already has a `vllm-adapter` and `ollama-adapter`. The
cheapest cascade step can be a **self-hosted edge model** (TZ-resident, zero
per-token cost, data never leaves), escalating to Anthropic only on disagreement.
For a Tanzanian mining OS this is *data-sovereignty-as-cost-optimisation*: the
cascade's bottom rung is free and on-soil.

---

## 3. LEARNED routers (RouteLLM, predictive routing, Pareto routers)

### State of the art
RouteLLM trains a classifier on preference data to predict, *before* inference,
whether a query needs the strong model. 2026 frontier: **MixLLM** (contextual
bandit + policy gradient over domain-tagged query embeddings), **gain-based
in-model routing** (best quality–cost frontier in the routing survey), duelling-
bandit routing with Feel-Good Thompson Sampling, and the observation that the
difficulty classifier transfers across model pairs (it learns difficulty, not the
specific models).

### How Borjie wires it
This is the **biggest missing piece**. Today routing is a *static* `task-ladder` +
`routing-overrides`. There is no predictive router. Wire a learned router as a new
`brain-llm-router/src/learned-router/` module:
- **Embedding-based difficulty head.** Reuse the kernel's existing `embedder.ts`
  (already used by `semantic-cache`). Embed the incoming prompt, run a small
  trained head (ModernBERT-class, the cascade comment already references it) → a
  difficulty score in [0,1].
- **Route table from the control plane.** The admin per-use-case routing config is
  the *policy*; the learned head supplies the *difficulty signal*; the
  `dynamic-registry` supplies the *available models*. The router picks the point on
  the cost-quality Pareto frontier that the admin selected (a single
  "quality-dial" slider, exactly RouteLLM's test-time-adjustable knob).
- **Training data is already being logged.** `eval-drift-logger` +
  `cross-provider-auditor` outcomes + `cost-meter` = (query, model, was-it-right,
  what-it-cost). That is a labelled router-training corpus accumulating *right now*
  but currently unused for routing. Close the loop.

**BEYOND-TODAY leap:** *Pareto-dial per persona, per tier, per tenant.* The owner's
strategic cockpit gets a high-quality dial; bulk workforce chat gets a cost dial;
the admin control plane exposes one slider per use-case and the learned router
honours it. The `llm-budget-governor` tiers (already built) *are* the Pareto
operating points — wire the tier to select the dial position automatically.

**AMPLIFIES Borjie:** the control plane stops being a stub. Its "AI-suggest" feature
becomes real: the learned router *recommends* a routing config to the admin from
observed Pareto data, and the admin accepts/overrides. Human-in-the-loop learned
routing.

**WE-DID-NOT-KNOW-WE-COULD:** route on **predicted evidence-availability**, not
just difficulty. Train the head to also predict "does the corpus contain enough
evidence to answer this?" If evidence is thin, route to a *retrieval-heavy* path
(self-RAG, already in the kernel) instead of a bigger model. Routing by epistemic
state, not just token difficulty — no public router does this.

---

## 4. Speculative decoding / draft-verify across models

### State of the art
A small draft model proposes k tokens; a large target verifies them in one
parallel forward pass; accepted tokens are free. 2–3× latency reduction with
*zero quality loss* (the target's distribution is preserved). 2026: multi-stage
asynchronous pipelines (k+1 models of increasing size), EasySpec layer-parallel,
SemShareKV (token-level LSH KV-sharing across semantically similar prompts).
Mature in vLLM / TGI / Ollama as of Dec 2025.

### How Borjie wires it
Speculative decoding lives *below* the `universal-client` adapter boundary — it's a
serving optimisation, not an orchestration one. So the wiring is at the
**self-hosted edge** layer:
- The `vllm-adapter` and `ollama-adapter` already exist. Enable vLLM's native
  speculative decoding (draft = a tiny TZ-resident model, target = a mid model) for
  the *self-hosted bottom rung* of the cascade (§2). This makes the free on-soil
  cascade step also *fast*.
- For Anthropic/OpenAI/Google paths, speculative decoding is the provider's job
  (already applied server-side) — Borjie can't wire it, but it CAN exploit
  **prompt-prefix caching** (§7) which is the API-level analogue.

**BEYOND-TODAY leap:** *Cross-model draft-verify as a cheap cascade.* Reframe the
cascade itself as speculative: let Haiku *draft a full answer*, then have Sonnet
*verify-or-correct* in a single pass (CoVe-style but token-level). The
`brain-call-orchestrator` already runs CoVe; promote it to a draft-verify mode where
the draft is the cheap model's whole response and the verifier only *edits the
deltas*. Borjie pays cheap-model price for the bulk, expensive-model price only for
the corrections.

**AMPLIFIES Borjie:** latency on the self-hosted edge drops 2–3×, making on-soil
inference *interactive* — critical for low-bandwidth Tanzanian field conditions
where round-trips to US providers are slow.

**WE-DID-NOT-KNOW-WE-COULD:** use **SemShareKV across tenants on the shared corpus.**
Every tenant inherits the same `tenant_id=NULL` ground-truth corpus chunks. The KV
cache for those shared corpus prefixes is *identical across all tenants* — share it
(LSH-matched) at the vLLM layer. The multi-tenant shared-corpus design makes
cross-tenant KV-sharing safe and free; no per-tenant data leaks because the shared
prefix is by-definition non-tenant data.

---

## 5. TEST-TIME-COMPUTE scaling (deliberate longer on hard queries)

### State of the art
o1/o3/R1 trade inference tokens for accuracy via long CoT. 2026 frontier is
*adaptive* TTC: don't scale uniformly (the "Reasoning on a Budget" survey
2507.02076, "Strategic Scaling … A Bandit Learning Approach" 2506.12721, and
crucially **"When More Thinking Hurts: Overthinking"** 2604.10739 + **"Inverse
Scaling in Test-Time Compute"** 2507.14417 — more thinking can *lower* accuracy).
Gemini's dynamic thinking mode and Claude's developer-controlled thinking budget
are the productised forms.

### How Borjie wires it
The kernel ALREADY has `ttc-allocator.ts` — a 4-tuple (mode × samples × budget ×
maxTokens) keyed on (stakes, surface, ambiguity, ceiling, requireJudge). This is
genuinely SOTA-shaped. Three upgrades:
1. **Wire ambiguity from a real signal.** Today `ambiguityScore` is optional and
   often unset. Feed it the learned-router difficulty head (§3) and the
   `semantic-cache` near-miss distance (a query far from anything cached is novel →
   higher ambiguity).
2. **Map mode→thinking-budget at the adapter.** `cognitionMode: 'deliberate'`
   should set Anthropic `thinking.budget_tokens` / Gemini thinking level — the
   `effort/` module already resolves an effort model; extend it to resolve a
   *thinking budget* not just a model id.
3. **Overthinking guard.** Wire the "When More Thinking Hurts" finding: cap thinking
   budget per task from `eval-drift-logger` — if longer thinking historically did
   NOT improve pass-rate for a task, the allocator caps it. The drift logger already
   has the data.

**BEYOND-TODAY leap:** *Budget the ENTIRE turn, not just the model.* The TTC
allocator returns `budgetUsd`. Wire that as a single envelope the orchestrator
spends across {router difficulty call + cascade steps + MoA proposers + judge +
evidence audit}. One turn = one budget, allocated *dynamically* across orchestration
stages by marginal-value-of-compute. This is portfolio TTC, not per-call TTC.

**AMPLIFIES Borjie:** the governor's per-tier caps and the allocator's per-turn
budget become one coherent spend story; an owner on the top tier literally gets
"think harder" on critical decisions, billed honestly.

**WE-DID-NOT-KNOW-WE-COULD:** spend TTC *asynchronously in the Slow Loop*. EstateMind
is propose-only and leader-elected. Let it spend "deliberate" compute *offline* on
standing estate drives (e.g. re-deriving a royalty forecast overnight with Opus×5)
and write the result to the blackboard, so the *interactive* path stays cheap/fast
and the deep thinking happens in the background. Decouple latency-budget from
quality-budget by moving heavy TTC off the request path entirely.

---

## 6. Model-as-JUDGE + LLM-as-ROUTER + capability-aware dispatch

### State of the art
LLM-as-judge is now known to be biased/shallow single-pass; the 2026 fix is
**Agent-as-a-Judge** (planning + tool-verification + multi-agent + memory,
2601.05111 survey), **multi-agent debate judges with adaptive stability detection**
(Beta-Binomial consensus + KS-test stopping, 2510.12697), and **"Auditing
Multi-Agent Reasoning Trees outperforms majority-vote and LLM-as-judge"**
(2602.09341). The danger: **confabulation consensus** — agents share pre-training
manifolds, so naive consensus reinforces shared hallucinations (Council Mode,
2604.02923).

### How Borjie wires it
The router already has `judge-loop/` and `cross-provider-auditor/`. The kernel has
`debate/` + `honest-confidence.ts`. Wire:
- **Cross-FAMILY judge to break confabulation consensus.** The
  `cross-provider-auditor` already samples a second-opinion across providers — make
  the *judge* in `judge-loop` deliberately a different model family than the
  generator. The `dynamic-registry` knows families; the `policy-audit`
  cross-family-alert already tracks family crossings. Epistemic independence by
  construction.
- **Adaptive stability stopping** for debate: today `three-agent-debate` runs fixed
  rounds. Wire the KS-test / Beta-Binomial stopping so debate halts when the council
  stabilises — saves compute on easy questions, spends it on contested ones.
- **Capability-aware dispatch = the junior registry.** Each junior already declares
  its domain. The dispatcher (`orchestrator/tool-dispatcher.ts`, currently being
  modified per git status) should dispatch by declared capability + observed
  pass-rate, not static config.

**BEYOND-TODAY leap:** *Evidence-grounded Agent-as-a-Judge.* Borjie's judge should
not score text — it should **verify each claim against the corpus** (the
`cross-provider-auditor` already extracts numeric claims). Make the judge a
tool-using agent that checks every cited `evidence_id` actually supports the claim.
The hard rule "Auditor rejects empty evidence chains" becomes "Auditor rejects
*unsupported* evidence chains" — agent-as-a-judge with real retrieval verification.

**AMPLIFIES Borjie:** the audit chain (hash-chained, append-only) records not just
*what* was decided but *which judge family verified which evidence* — a regulator-
grade decision trail no competitor has.

**WE-DID-NOT-KNOW-WE-COULD:** route the *judge itself* with the learned router.
Cheap questions get a cheap judge or no judge; contested high-stakes questions get a
cross-family debate-judge with stability stopping. Judging becomes a budgeted,
routed resource — meta-routing.

---

## 7. SEMANTIC + PROMPT-PREFIX + KV caching

### State of the art
Three layers: (a) **semantic cache** — embed query, NN-search past responses, skip
the LLM on a hit (30–70% hit rate; FAQ/agent workflows highest, creative lowest);
(b) **prompt/prefix cache** — vLLM RadixAttention / Anthropic prompt caching,
reuses computed KV for identical prefixes, −80–90% TTFT on long shared system
prompts; (c) **KV cache** — in-GPU. Combined: 40–80% cost reduction. SemShareKV
(2509.24832) shares KV across *semantically similar* (not identical) prompts via
token-level LSH.

### How Borjie wires it
The kernel ALREADY has `semantic-cache/` (embedder + cache-store + NN). It is
*built but not in the brainCall hot path*. Wire it as **step 0 of the orchestrator**:
- Before resolving the ladder, check the semantic cache. On a hit above a
  per-task similarity floor (tight for numeric/financial, loose for explanatory),
  return cached + skip all inference. The governor's metering records a $0 call.
- **Prompt-prefix caching at the adapter.** Borjie's system prompts are huge
  (persona + corpus context + tool specs). The `anthropic-adapter` should mark the
  stable prefix (persona + tool-spec + shared corpus) as a cache breakpoint so
  every turn after the first pays 10% for that prefix. This is the single biggest
  *immediate* cost win and requires only adapter-level flags.
- **Tenant-scoped semantic cache keys** to respect RLS — never serve tenant A's
  cached answer to tenant B. The shared corpus answers (tenant_id=NULL) can be
  cross-tenant; tenant-specific answers cannot.

**BEYOND-TODAY leap:** *Cache invalidation via the CRDT blackboard.* The classic
semantic-cache failure is staleness. Borjie's blackboard slots carry version-vectors.
Key each cached answer to the version-vector of the slots it depended on; when a slot
updates (new royalty rate, new licence status), *auto-invalidate* every cached answer
that read it. Dependency-tracked semantic caching — the blackboard makes it possible.

**AMPLIFIES Borjie:** 40–80% inference-cost reduction *on top of* cascade savings,
and the prefix-cache win makes the heavy persona+corpus prompts affordable to send
every turn.

**WE-DID-NOT-KNOW-WE-COULD:** a **shared-corpus semantic cache warmed by EstateMind.**
The Slow Loop can *precompute* answers to anticipated questions during off-hours and
warm the shared cache, so the first interactive ask of "what's my royalty exposure
this quarter" is a $0 cache hit. Proactive cache warming driven by the motivation
subsystem — the brain answers before it's asked.

---

## 8. Self-consistency / debate / constitutional chaining

### State of the art
Self-consistency (sample N, majority-vote) is the cheapest reliability lever.
Debate and constitutional chaining add critique passes. 2026 nuance: **self-MoA
often beats heterogeneous MoA** (same strong model × N > mixed weak models), and
**multi-agent reasoning-tree auditing > majority-vote** for hard problems.

### How Borjie wires it
The orchestrator already has `consistency.ts` (majorityVote) and `cove.ts`. The
kernel has `debate/`. These are present but *gated by per-call options*, not by a
policy. Wire a **reliability policy** in the control plane:
- Per use-case: `none | self-consistency-3 | self-consistency-5 | debate |
  constitutional`. The `ttc-allocator` already maps stakes→samples (1/3/5) — promote
  that mapping into the control plane so admins tune it per use-case.
- **Constitutional chaining = the inviolable layer.** The kernel has `inviolable.ts`
  + `policy-gate.ts`. Chain a constitutional critique pass that checks every answer
  against the inviolable rules (kill-switch, four-eye, sovereign prefixes) *before*
  surfacing. This is constitutional AI wired to Borjie's actual constitution.

**BEYOND-TODAY leap:** *Numeric self-consistency for money paths.* For any answer
touching the ledger, run self-consistency on the *number*, not the text — the
`cross-provider-auditor` already extracts numeric claims with a tolerance. Require
N-sample agreement on the dollar figure within tolerance before it can reach
`LedgerService.post()`. Self-consistency as a financial-integrity gate.

**AMPLIFIES Borjie:** the "predictions APPEND to rule-based decisions" rule gets
teeth — the prediction must survive self-consistency + constitutional critique
before it's allowed to append.

**WE-DID-NOT-KNOW-WE-COULD:** debate *bilingually* to catch translation drift. Run
one proposer in EN and one in SW on the same question; if they disagree, the
disagreement localises a translation/locale bug. Bilingual debate as a correctness
*and* localisation QA tool — uniquely possible because Borjie is hard-bilingual.

---

## 9. Pipeline COMPILATION + auto-prompt-optimization (DSPy, GEPA, TextGrad, MIPRO)

### State of the art
This is the deepest frontier. Stop hand-writing prompts and routing — **compile**
the graph and let an optimiser tune it against a metric.
- **MIPROv2:** jointly tunes instruction text + few-shot demos via bootstrapping +
  Bayesian optimization.
- **GEPA (Genetic-Pareto, 2026):** a *reflective* optimiser — an LM reads the
  program's *execution trajectory*, reflects on what worked/failed in natural
  language, proposes targeted prompt edits, keeps a Pareto front of candidates.
  Often beats MIPROv2 with far fewer rollouts and can use domain-specific textual
  feedback.
- **TextGrad:** backpropagates *natural-language gradients* through the pipeline.
- **BetterTogether:** alternates prompt-optimization with weight-finetuning.

### How Borjie wires it
This is the highest-leverage upgrade because the substrate is *already shaped for it*.
`dspy-compile/compiler.ts` is a **simplified MIPROv2 port that explicitly does NOT
synthesise instructions** — it only ranks caller-supplied candidates. Upgrade path:
1. **Add an instruction-proposer** (the piece the header says is out of scope). A
   small LM proposes candidate instructions → MIPROv2 selection already works.
   Instant upgrade from "rank what I give you" to "discover better prompts."
2. **Wire GEPA on top of the eval-drift-logger.** GEPA needs (trajectory, metric,
   reflection-LM). Borjie HAS the trajectory (drift log + decision-trace +
   audit-chain) and the metric (pass-rate, cost, evidence-completeness). Add a
   reflection-LM pass that reads failed traces and proposes prompt edits, keep a
   Pareto front of (quality × cost). Compilation happens at *deploy time* (the
   compiler header already says runtime just loads JSON) — so GEPA runs in
   `services/brain-evolution-worker/` (which already exists), nightly, offline.
3. **Compile the ROUTING GRAPH, not just prompts.** The real leap: treat the whole
   orchestration graph (router thresholds + cascade gates + ensemble mode + judge
   policy per task) as a DSPy program and let GEPA/MIPRO optimise *the graph
   structure* against the (quality, cost) Pareto metric. The routing graph stops
   being hand-wired and becomes *compiled + continuously re-optimised*.

**BEYOND-TODAY leap:** *Self-improving orchestration.* The `brain-evolution-worker`
already exists for prompt evolution. Point GEPA at the entire model-orchestration
config (control plane settings + router thresholds + cascade gates), run it nightly
against the accumulated drift/cost data, and propose a new orchestration config to
the admin control plane as an "AI-suggest." The control plane's existing AI-suggest
feature becomes the *delivery channel for a compiled, Pareto-optimised routing graph.*
Human approves; rollout package ships it. The orchestrator optimises itself.

**AMPLIFIES Borjie:** every other section in this dossier (router thresholds,
cascade gates, MoA recruiting, judge policy, TTC budgets) becomes a *compiled,
data-optimised* parameter instead of a hand-set constant. The whole lane self-tunes.

**WE-DID-NOT-KNOW-WE-COULD:** compile *per-tenant, per-jurisdiction* orchestration
graphs. A Tanzanian artisanal tenant and a mid-tier Nigerian holding company have
different query distributions, evidence corpora, and cost sensitivities. GEPA can
compile a *separate Pareto-optimal routing graph per tenant cohort* from each
cohort's own drift data — orchestration that specialises to each mining context
automatically. Nobody compiles per-tenant routing graphs.

---

## 10. Portfolio / bandit model selection

### State of the art
Frame model choice as a multi-armed / contextual bandit balancing
exploration/exploitation under cost. **MetaLLM** (MAB, picks cheapest-likely-correct),
**MixLLM** (contextual bandit + policy gradient over domain-tagged embeddings),
**LinUCB with provable sublinear regret** under evolving context (2506.17670),
**duelling-bandit routing with Feel-Good Thompson Sampling**, and reverse-auction
contextual bandits (AAMAS 2026). IBM's "Multi-Armed Bandits Meet LLMs" (AAAI 2026)
is the canonical synthesis.

### How Borjie wires it
Borjie's routing is currently *deterministic* (static ladder + overrides). A bandit
adds principled **exploration** — it occasionally tries a cheaper/newer model to
*learn* whether it's good enough, instead of forever using the incumbent. Wire a
`brain-llm-router/src/bandit-selector/`:
- **Context = the learned-router difficulty embedding (§3) + task + tier.** **Arms =
  the models in the `dynamic-registry` for that task.** **Reward = a blend of
  eval-drift pass-rate − normalised cost** (both already metered).
- **LinUCB / Thompson Sampling** picks the arm; the `routing-overrides` and
  `min-tier-policy` act as *hard constraints* (the bandit never explores below the
  min-tier for a HIGH-risk policy prefix). Exploration is *bounded by Borjie's
  inviolable rules.*
- The bandit auto-onboards new models. When `dynamic-registry` discovers a new
  Anthropic/OpenAI/Google model, it's a new arm with optimistic prior — the bandit
  trials it on low-stakes traffic, measures, and promotes it if it Pareto-dominates.
  **Zero-touch model adoption.**

**BEYOND-TODAY leap:** *Cohort-shared bandit posteriors.* The `cohort-signal.ts` in
the kernel already groups tenants. Share bandit reward posteriors across a cohort so
a new tenant inherits the cohort's learned model preferences on day one (warm start),
then personalises. Federated bandit routing across the tenant base — fleet-learning.

**AMPLIFIES Borjie:** model selection stops being a config decision the founder makes
and becomes a *self-optimising portfolio* that tracks the moving Pareto frontier of a
fast-changing model market — exactly the "models are interchangeable; we own accuracy"
thesis in the router's own header comment, finally realised.

**WE-DID-NOT-KNOW-WE-COULD:** run the bandit as a **reverse auction across providers**
(AAMAS 2026). Treat Anthropic/OpenAI/Google/self-hosted as bidders; the bandit's
context-conditioned value estimate + each provider's live price = a per-query auction
for who serves it. The `rate-limit-preflight` + `cost-meter` already supply live
price/availability signals. Borjie becomes a *market-maker over its own model
supply* — provider-agnostic by construction, always on the cost-quality frontier,
and resilient to any single provider's outage or price hike.

---

## 11. The unifying architecture — "the compiled council"

Wiring all ten into one coherent loop, anchored on existing components:

```
incoming turn
  │
  ├─[0] semantic-cache (kernel/semantic-cache)  ── HIT → $0 return
  │        └ invalidated by blackboard version-vectors
  ├─[1] learned-router difficulty head (NEW, uses kernel/embedder)
  │        └ + evidence-availability prediction
  ├─[2] ttc-allocator (kernel/ttc-allocator) → per-turn budget envelope
  ├─[3] bandit-selector (NEW) picks arm(s) under min-tier + override constraints
  │        └ cohort-warm-started, reverse-auction over providers
  ├─[4] orchestration mode (control-plane policy):
  │        first-wins | cascade | vote | judge | debate | MoA
  │        └ cascade gate = self-consistency disagreement (cost-cascade)
  │        └ MoA proposers = Symbolic-MoE-recruited juniors via blackboard slots
  │        └ judge = cross-FAMILY agent-as-a-judge, stability-stopping
  │        └ prompt = GEPA/MIPRO-compiled (dspy-compile + brain-evolution-worker)
  │        └ prefix-cached persona+corpus+toolspec at the adapter
  ├─[5] constitutional + evidence-audit gate (inviolable + cross-provider-auditor)
  │        └ numeric self-consistency before LedgerService.post()
  ├─[6] meter (cost-meter + llm-budget-governor) — honest billing
  └─[7] log trajectory (eval-drift-logger + audit-chain) ──┐
                                                            │
   nightly: brain-evolution-worker runs GEPA over the trajectory corpus,
   re-compiles prompts + the routing graph (thresholds, gates, modes,
   bandit priors) per-tenant-cohort, and proposes the new config to the
   ADMIN CONTROL PLANE as an AI-suggest. Human approves → rollout package.
                                                            │
   offline: EstateMind Slow Loop spends "deliberate" TTC on standing drives,
   warms the shared-corpus cache, writes proposals to the blackboard. ───────┘
```

The single sentence: **turn the static, hand-wired orchestration graph into a
compiled, bandit-explored, cache-fronted, evidence-gated council that re-optimises
itself nightly from its own audit trail and proposes the upgrade to a human.** Every
box above is either *already built* (semantic-cache, ttc-allocator, dspy-compile,
debate, cross-provider-auditor, brain-evolution-worker, llm-budget-governor,
blackboard, EstateMind) or a thin new module (learned-router, bandit-selector,
moa-mode) bolted onto an existing seam.

---

## 12. Priority wiring order (highest leverage first)

1. **Prompt-prefix caching at the adapter** (§7) — biggest immediate $ win, adapter
   flags only, zero risk.
2. **Semantic-cache as orchestrator step 0** (§7) — already built, just not in the
   hot path. Blackboard-version invalidation makes it safe.
3. **Self-consistency-as-cascade-gate** (§2, §8) — reuse `majorityVote` as the
   `cost-cascade` evalFn; learned per-task thresholds from drift data.
4. **Learned difficulty router** (§3) — the missing predictive layer; trains on data
   already being logged; un-stubs the control plane.
5. **GEPA over the brain-evolution-worker** (§9) — upgrade the MIPROv2 port with an
   instruction-proposer + reflective optimiser; compile prompts *and* the routing
   graph; deliver via the control-plane AI-suggest.
6. **Bandit selector** (§10) — principled exploration + zero-touch model onboarding +
   reverse-auction over providers.
7. **Symbolic-MoE / evidence-fused council** (§1, §6) — promote debate to a
   skill-recruited, evidence-merging MoA on the blackboard.
8. **Per-turn portfolio TTC + overthinking guard** (§5) — one budget across all
   stages; cap thinking where it doesn't help.

Items 1–3 are days; 4–5 are the strategic core; 6–8 are the moat.
