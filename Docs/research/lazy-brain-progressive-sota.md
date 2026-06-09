# Lazy Brain — Progressive-Intelligence SOTA (June 2026)

**Lane:** `brain-intelligence-progressive-SOTA`
**Author:** research subagent (workflow-orchestrated)
**Date:** 2026-06-09
**Status:** dossier — no code, no commit. Recommendations only.

---

## 0. The owner constraint, stated precisely

> "WE ARE ALWAYS LOADING SUPER FAST BUT KEEPING FULL INTELLIGENCE AND
> LOGIC." Fast = **DEFERRED / STREAMED / PROGRESSIVELY-ENHANCED**, never
> capability dropped or intelligence degraded.

The hard test is **PAYING**: a user on a paid turn must never see a *wrong*
fast answer that a "real" answer would later contradict. The only fast
things we are allowed to show are (a) **the same correct answer streamed
sooner**, (b) **honest structure/plan** that the reasoned content then
fills in, and (c) **honest status** (`thinking`, evidence-arriving, ETA) —
never a fabricated fast reply.

This reframes every technique below into one of two safe shapes:

- **Latency-hiding** — the answer is identical; we just reveal it earlier
  or overlap its sub-steps (token streaming, partial-object streaming,
  prompt-prefix cache, speculative decoding, warm pools, lazy-RAG,
  skeleton-of-thought, prefetch). These are *free* under the constraint.
- **Cheap-first cascade** — a smaller model answers first. This is ONLY
  safe with a **verification/deferral gate** so the cheap answer is either
  *confirmed* by a deeper pass or *visibly superseded* — and is gated by a
  **calibrated confidence + abstention** policy, not raw model self-report.
  This is the one place we can violate the constraint if we get it wrong,
  so it gets the most ink.

Borjie already has the right bones: SSE token streaming
(`kernel.thinkStream`), a deterministic fast-path router, a model-tiering
policy, a semantic cache (now wired on the orchestrator path), a genui
partial-artifact stream, EstateMind's slow loop, and a self-RAG retrieve
gate. The work is to make these *cooperate as one progressive pipeline*
rather than as independent flags.

---

## 1. Where Borjie is today (grounding)

| Capability | Status in repo | File |
|---|---|---|
| Token streaming over SSE | LIVE (`thinkStream` AsyncIterable; `turn_start` → `text_delta`/`thought_delta` → `gate_verdict` → `confidence` → `done`) | `packages/central-intelligence/src/kernel/kernel.ts:2025` |
| Fast-path router (trivial-turn gate, no LLM, µs regex) | BUILT, env-gated `BORJIE_FASTPATH` (default OFF) | `packages/central-intelligence/src/kernel/fast-path-router.ts` |
| Model tiering (cheap/standard/deep) | BUILT, env-gated `BORJIE_MODEL_TIERING` (default OFF) | `packages/central-intelligence/src/kernel/model-tiering.ts` |
| TTC allocator (fast/deliberate/judge/multi-sample) | BUILT | `packages/central-intelligence/src/kernel/ttc-allocator.ts` |
| Semantic cache (cosine, per tenant/surface/persona/locale) | BUILT + now wired on orchestrator path | `packages/central-intelligence/src/kernel/semantic-cache/` + `orchestrator-fast-cache.ts` |
| Brain-side LRU (whole-thought dedupe, intent-tiered TTL) | LIVE on stream path (replays cache hit as one delta) | `packages/central-intelligence/src/kernel/brain-cache.ts`, `kernel.ts:2117` |
| genui partial-object streaming (`schema → partial* → final`) | BUILT (`StreamingArtifact<T>`, `createArtifactWriter`) | `packages/genui/src/streaming/streaming-artifact.ts` |
| genui choreography (timed reveals + voice markers) | BUILT, pure state machine | `packages/genui/src/streaming/choreography-engine.ts` |
| AG-UI event emitter | BUILT | `packages/central-intelligence/src/kernel/streaming/ag-ui-emitter.ts` |
| Self-RAG retrieve-gate (retrieve only when needed) | BUILT | `packages/central-intelligence/src/kernel/self-rag/self-rag.ts` |
| EstateMind slow loop (PERCEIVE→ORIENT→MOTIVATE→PROPOSE→FORGET) | BUILT, leader-elected heartbeat | `packages/central-intelligence/src/kernel/estate-mind/estate-mind.ts` |

**The gap is not capability — it is orchestration + default-on wiring.**
Fast-path and tiering ship OFF. The stream path replays a cache hit but
does not *yet* run a cheap-first-then-confirm cascade. genui partials
exist but the brain turn does not emit a skeleton-first plan. Nothing
warms the *next* turn. That is the dossier's target surface.

---

## 2. Token streaming (we have it — sharpen it)

**SOTA (June 2026):** raw token streaming is table stakes; the frontier is
(a) streaming Claude's *adaptive/extended thinking* as a labelled,
redacted "reasoning" channel distinct from the answer, and (b) **never
streaming raw thinking to end users** without a UI affordance that labels
it internal. On Opus 4.6 / Sonnet 4.6, interleaved thinking is automatic;
older models need `interleaved-thinking-2025-05-14`. You are billed for
full thinking tokens, not the summary.

**Borjie application:** `thinkStream` already emits `thought_delta`
separate from `text_delta`. Promote that to a first-class, *labelled*
"Mr. Mwikila is reasoning" channel in chat-ui — redacted, collapsible,
never mixed into the answer body. Keep the locale invariant: a `sw` user
sees a Swahili reasoning label, an `en` user English — no mixing (CLAUDE.md
hard rule). Map extended-thinking budget onto the existing TTC
`cognitionMode` so `deliberate`/`judge`/`multi-sample` turns light up the
reasoning channel and `fast` turns suppress it.

**Fast-load win:** first *visible* token (a reasoning marker / persona
greeting) lands in tens of ms instead of after the whole pipeline. The
user sees "thinking" honestly while the deep pass runs — no fake answer.

---

## 3. Partial-object / structured-output streaming (genui)

**SOTA:** `streamObject`-style partial-object streams plus Anthropic
**fine-grained tool streaming** (`eager_input_streaming: true`, beta
`fine-grained-tool-streaming-2025-05-14`) emit tool inputs as
`input_json_delta` fragments *without buffering or JSON validation* — so a
UI renders a partially-built object immediately. Caveat: the fragment
stream is **not guaranteed valid JSON mid-flight** (a `max_tokens` stop can
truncate a parameter), so the client must tolerate partials and only
hard-parse on block close. Vercel's `json-render` (Jan 2026, 13k★) is the
reference "catalog-of-Zod-components → LLM emits constrained JSON →
progressive render" pattern — exactly Borjie's genui catalog model.

**Borjie application:** `StreamingArtifact<T>` already models
`schema → partial → final | error` with a pure reducer shared client/server
— this is the correct shape. Wire the brain's genui tab synthesis to emit
`schema` (component skeleton, slots pre-allocated) on the *first* token,
then `partial` merges as fields resolve, then `final`. The genui
`artifact-stream-parser` should consume Anthropic `input_json_delta`
fragments directly and feed `reduceArtifactChunk`, using a **partial-JSON
tolerant parser** so a half-written `bid` table or `royalty` chart paints
its frame before the numbers land. Validate against the catalog Zod schema
only on `final` (matches the "parse on block close" caveat).

**Fast-load win:** a genui tab shows its *structure* (chart axes, table
headers, KPI card frames) within the first chunk; cells fill as the model
streams. No blank spinner; no degraded data — the final values are the
real computed ones.

---

## 4. Progressive intelligence — the cheap-first cascade (the dangerous one)

**SOTA:** a small model answers first; a **deferral policy** (calibrated
confidence threshold) decides whether to *accept* or *escalate* to a deeper
model; an **abstention policy** decides whether to escalate to a human/HITL
(FrugalGPT lineage → 2025/2026 cascade work). The non-negotiable finding:
**LLM self-reported confidence is poorly calibrated** — a model can sound
authoritative while being wrong — so production cascades fit a small
**calibration model** (e.g. Bayesian logistic regression on a held-out
set) to make confidence comparable across tiers, and increasingly use
**reinforced hesitation / early abstention** (explicitly signal "this
exceeds my capability" rather than guess). One result: −13% cost, −5%
error by accepting +4.1% abstention.

**The constraint-safe pattern for Borjie** (this is the crux):

1. **Cheap tier answers in <300ms** AND streams immediately — but it is
   *framed as provisional* in the trace, never committed as final.
2. A **deferral gate** runs on the cheap answer using *calibrated*
   confidence (NOT raw self-report) + the existing honest-confidence
   scorer (`kernel/orchestrator` K-7) + evidence-chain check (every junior
   recommendation must cite ≥1 `evidence_id` — CLAUDE.md). Empty-evidence
   or low-calibrated-confidence ⇒ **escalate**, never accept.
3. If escalated, the deep tier refines. Two safe UX shapes:
   - **Confirm-in-place** — cheap answer streamed; deep pass *confirms* it
     (common case) → a subtle "verified" state, no contradiction.
   - **Supersede-honestly** — deep pass disagrees → the UI visibly
     *replaces* the provisional answer with an "updated after deeper
     analysis" transition. This is the ONLY allowed way a fast answer
     changes, and it is rare by construction (gate is conservative).
4. **High-stakes never cheap-first.** Anything `stakes ∈ {high, critical}`,
   any sovereign/kill_switch/four_eye/policy_rollout prefix, any money path,
   any licence/royalty decision skips the cascade entirely and goes deep —
   the existing fast-path router already refuses to route these to the fast
   lane; reuse that exact gate as the cascade's eligibility predicate.

**Borjie application:** the pieces exist but are not chained.
`fast-path-router` (eligibility) + `model-tiering` (cheap/standard/deep) +
`ttc-allocator` (judge/multi-sample as the verifier) + the honest-confidence
scorer (the deferral signal) compose into the cascade. Add ONE new pure
module — a **deferral/abstention policy** that reads calibrated confidence +
evidence-chain non-emptiness and returns `accept | escalate-deep |
abstain-HITL`. Flip `BORJIE_FASTPATH` / `BORJIE_MODEL_TIERING` on *only
behind that gate* so a trivial "what's the royalty rate for gold?" gets the
cheap-tier instant answer **only when the deep tier would agree** (cache /
deterministic corpus fact), and anything ambiguous escalates silently.

**Fast-load win:** <300ms first answer on the high-frequency long tail
(status, single-fact, greetings, "is my licence current?") with a
*confirmed-correct* guarantee — and zero fast-path exposure on the turns
that matter. The brain *feels* instant without ever being wrong.

> **Risk flag (own it):** the cascade is the single technique that can
> violate the owner constraint. Ship it last, behind the deferral gate,
> with the supersede-honestly UX, and with the high-stakes exclusion reusing
> the existing fast-path refusal predicate. Treat the calibration set as a
> first-class artifact and monitor false-accept rate before widening.

---

## 5. Prompt-prefix caching (persona + corpus) — biggest free win

**SOTA (June 2026):** Anthropic prompt caching references the full prefix
across **tools → system → messages, in that order**; up to 4 breakpoints;
hits require **100% byte-identical** prefix up to the breakpoint. Optimal
ordering = **most-stable first**: system prompt → tool defs → long static
context (corpus excerpts) → slowly-changing history → current message
(most variable). 5-minute default TTL; **1-hour extended TTL**
(`cache_control: { type: "ephemeral", ttl: "1h" }`) at 2× write / 0.1×
read, cutting cost up to 90% and latency up to 85% on long prompts. As of
**Feb 5 2026, caches are workspace-isolated** on the Claude API (was
org-level) — relevant to Borjie's multi-tenant posture. Cache metrics
arrive in the **final streaming chunk**, so caching composes with SSE with
no behaviour change. "Caching rewards stability — keep the prefix stable,
grow only the tail."

**Borjie application:** Borjie's prompt has a near-ideal stable prefix —
the **persona** (`persona.ts`, `prompt-layers.ts`, `vp-personas/`,
`sub-mds/`) and the **mining corpus** (`intelligence_corpus_chunks`,
`tenant_id = NULL` ground truth shared across all tenants). Restructure the
prompt assembly so the order is exactly: inviolable/system rails → tool
spec (`tool-spec.ts`) → persona block → tenant-invariant corpus prefix →
slowly-changing situational/EstateMind context → current user message. Put
a cache breakpoint after the corpus prefix and use the **1-hour TTL** for
the persona+corpus block (it is identical across every user in the tenant
and across turns), keeping the cache warm on a busy platform so a fraction
of requests don't become cold cache *writes*. Per-tenant branding override
(`applyBrandingOverride`) must sit *after* the shared corpus breakpoint so
it doesn't bust the shared prefix. Watch the **workspace-isolation** change:
if Borjie maps tenants to workspaces, the shared corpus prefix won't share
a cache across workspaces — model the workspace boundary deliberately.

**Fast-load win:** the dominant input-token cost (persona + corpus, often
the largest part of the prompt) collapses to ~0.1× read price and the model
skips re-ingesting it — directly improving **time-to-first-token** by up to
85% on long prompts, on *every* turn, with zero capability change. This is
the highest-ROI, lowest-risk item in the dossier.

---

## 6. Semantic caching + KV-cache reuse

**SOTA:** semantic cache stores response + query embedding; a new query
above a cosine threshold returns the stored answer in **3–8ms** vs
500–2000ms. Real production hit rates are **20–45%** (not the 95% vendors
claim); start `threshold ≈ 0.92`, watch false-positives 48h, adjust in 0.01
steps. TTL by content volatility (hours for news, days for stable facts,
7d for static FAQ). KV-cache / prefix-cache reuse (vLLM PagedAttention +
continuous batching) is the infra-side analogue; first-request-after-idle
on a cold prefix cache is the worst case — bursty traffic punishes cold
caches.

**Borjie application:** the semantic cache is already scoped per
`(tenantId, surface, personaId, locale)` with evidence/citations preserved,
and `orchestrator-fast-cache.ts` fixed the "built-but-dark" bug so every
real turn now consults it. Tune it for honesty: **never** cache refusals,
softened replies, or **evidence-empty** answers (already enforced) — and
set **volatility-aware TTLs** so a "current royalty rate" fact (stable)
caches for hours but a "today's gold price" / live treasury number caches
for minutes or not at all. The locale in the key is load-bearing: an `en`
hit must never serve a `sw` user (CLAUDE.md absolute-toggle rule). On the
infra side, if/when self-hosting any tier, enable prefix-cache + continuous
batching and **keep a warm path** for the cold-cache first-request case.

**Fast-load win:** 20–45% of the long-tail (FAQ-shaped corpus questions,
repeated "explain my dashboard") returns in single-digit ms *with its
original evidence chain intact* — instant and grounded, not degraded.

---

## 7. Speculative decoding + warm pools (infra TTFT)

**SOTA:** speculative decoding is **production-standard as of late 2025** —
a small draft model proposes 5–8 tokens, the target verifies them in one
forward pass, **2–3× speedup** (Llama-3.1-70B+1B draft = 2.31×; 405B on
H200 >3×; +FP8 → 3.6×) with **no change to the output distribution** (so
it's provably non-degrading — same answer, faster). Native in vLLM /
TensorRT-LLM. Warm pools: prewarming endpoints cuts TTFT **1.6–4.7×**;
one voice workload went 300ms → 40ms TTFT. SpeCache-style speculative
KV-prefetch preloads next-step KV entries during current-token decode.

**Borjie application:** these are provider/infra concerns — Borjie is
provider-agnostic by design (`model-tiering` deliberately maps tier→id at
the composition root, not in policy). The dossier recommendation is a
**procurement/infra requirement**, not app code: select inference for the
cheap/standard tiers that has **speculative decoding on by default** and a
**warm pool** sized to absorb Borjie's bursty owner-cockpit traffic (the
cold-prefix first-request case from §6). Because speculative decoding is
**distribution-preserving**, it is unconditionally constraint-safe: same
answer, lower inter-token latency. Capture it as an SLA: target sub-second
TTFT on the standard tier, low tens-of-ms on the cheap tier.

**Fast-load win:** 2–3× faster token emission on the deep/standard tiers
(so the "real" answer streams visibly faster) and warm pools kill the
cold-start seconds — the user never waits on a model spinning up.

---

## 8. Predictive prefetch / precompute (warm the next turn + EstateMind)

**SOTA:** **speculative tool execution** — predict and pre-run likely
next tool calls *during* the LLM's thinking time to hide the LLM↔tool
round-trip (PASTE: −48.5% task time, +1.8× throughput). Speculative agents
(SPAgent) overlap reasoning and action with a load-aware scheduler that
omits verification only when safe. Voice dual-agent: a "Fast Talker"
primes the cache on miss while a "Slow Thinker" predictively prefetches, so
the cache is warm by turn 3–4. Optimistic parallelization stages reversible
side-effects so *validation*, not waiting, is the critical path.

**Borjie application:** two precompute surfaces, both already half-built:

- **EstateMind precompute (proactive).** The slow loop already runs
  PERCEIVE→ORIENT→MOTIVATE→PROPOSE per tenant on a leader-elected
  heartbeat, surfacing nudges through the gated proposal sink. Upgrade it
  to **precompute the reasoned content of the top-salience nudge** ahead of
  time (during idle heartbeats) and cache it keyed by the situational
  snapshot, so when the owner opens the cockpit the proactive brief is
  *already computed* — instant, not generated on open. Keep the hard rule:
  the loop NEVER executes sovereign/money/licence actions; it precomputes
  the *answer*, the human still approves the *action*.
- **Next-turn prefetch (reactive).** During a turn's thinking time,
  speculatively pre-run the **read-only, reversible, side-effect-free**
  retrievals the next turn is likely to need (e.g. after "show my
  licences", prefetch the renewal-deadline + royalty-status reads). Bind
  this to the self-RAG retrieve gate so we only prefetch what's plausibly
  needed, and **only safe/idempotent reads** are speculated — money/ledger
  writes are NEVER speculated (CLAUDE.md money-path rule).

**Fast-load win:** the proactive cockpit brief and the most-likely next
question feel pre-answered — the latency of the *next* interaction is hidden
inside the *current* idle/thinking time. Correctness preserved because only
read-only, validated work is speculated.

---

## 9. Lazy RAG (retrieve only when needed, stream evidence as it arrives)

**SOTA:** self-RAG / retrieve-on-demand — the model decides *whether* to
retrieve before retrieving (skip retrieval for facts it knows; retrieve for
grounded claims), and evidence streams into the answer as it arrives rather
than blocking the first token. VoiceAgentRAG-style dual-agent patterns
specifically attack the "RAG blocks TTFT" bottleneck.

**Borjie application:** `self-rag.ts` already gates retrieval. Make it
**stream-aware**: emit `turn_start` + persona greeting + skeleton
*immediately*, fire the retrieval *in parallel*, and stream the
`evidence_id` citations into the answer as chunks land (the streaming
contract already has slots for confidence/citations; add an
`evidence_delta`). The evidence-required invariant is preserved — the
Auditor still rejects an empty evidence chain — but the user sees the
answer *forming* with citations appearing live instead of staring at a
spinner during a blocking retrieve. Crucially, lazy retrieval must not let
an answer *commit* before its evidence lands: the final `done` is gated on
the evidence chain being non-empty (existing rule), so the streaming is
"evidence-arriving", never "evidence-skipped".

**Fast-load win:** first token before retrieval completes; citations
stream in; no blank wait; evidence guarantee intact.

---

## 10. Skeleton / optimistic intelligence (show structure instantly)

**SOTA:** **Skeleton-of-Thought** — prompt the model to emit a 3–5-word-per-
point *outline* first, then expand each point in parallel (batched/parallel
calls) → **>2× speedup** on 8/12 models, quality equal-or-better in ~60% of
cases. Caveat: SoT is for answers whose structure can be planned ahead;
**not** for tightly sequential step-by-step reasoning or short answers.
Pairs naturally with partial-object streaming (the skeleton *is* the genui
schema chunk).

**Borjie application:** for cockpit-style "give me my estate situation" /
"summarise this licence" turns — which decompose into independent sections
(licences, royalty, workforce, treasury, marketplace) — emit a **skeleton
first** (the section headers / genui card frames) as the §3 `schema` chunk,
then **expand sections in parallel** and stream each into its pre-allocated
slot. Gate it on the same eligibility the fast-path router uses (skip SoT
for sequential-reasoning turns, which it already flags via
`COMPLEX_MARKERS_RE`). The skeleton is *honest structure*, not a fake
answer — it's the plan, and the reasoned content fills it. EstateMind's
choreography-engine (timed reveals + voice markers) is the perfect renderer
for the skeleton→fill sequence.

**Fast-load win:** the user sees the *shape* of the answer (5 section
frames) in the first chunk and watches them populate in parallel — perceived
latency drops to first-skeleton-token while total quality holds or improves.

---

## 11. Synthesis — one progressive pipeline, not eight flags

The constraint-safe ordering of a Borjie brain turn, end to end:

1. **t≈0ms** — `turn_start` + persona greeting (locale-correct, single
   language). Prompt-prefix cache (§5) means TTFT is already minimal.
2. **t<50ms** — emit the **skeleton** (§10) as the genui `schema` chunk
   (§3); show the **reasoning/thinking** channel (§2) honestly labelled.
3. **In parallel** — fire **lazy RAG** (§9, evidence streams in) and
   **prefetch** the likely next-turn reads (§8).
4. **t<300ms** — **cheap-tier provisional answer** streams *only if*
   eligible (§4); otherwise the deep tier streams directly. Semantic-cache
   hit (§6) short-circuits to single-digit-ms when available.
5. **Deferral gate** (§4) on calibrated confidence + evidence-chain:
   `accept` (confirm-in-place) / `escalate-deep` (supersede-honestly) /
   `abstain` (HITL).
6. **Deep pass** (speculative-decoded, §7) refines/confirms; sections fill
   their pre-allocated slots; citations land via `evidence_delta`.
7. **`done`** — gated on non-empty evidence; cache-write (§6) of the
   evidence-backed final; EstateMind precomputes the *next* proactive
   nudge during the following idle (§8).

Every step is either pure latency-hiding (identical answer, sooner) or a
gated cheap-first that is *confirmed or visibly superseded* — so the answer
the paying user keeps is always the correct one.

---

## 12. Recommended build order (risk-ascending)

1. **Prompt-prefix cache restructure (§5)** — highest ROI, zero risk,
   no behaviour change. Reorder prompt assembly, add corpus breakpoint,
   1-hour TTL on persona+corpus. (Watch Feb-2026 workspace isolation.)
2. **Skeleton-first + genui partial wiring (§3, §10)** — wire `schema`
   chunk emission into the brain turn; consume `input_json_delta`
   partials. Pure latency-hiding.
3. **Lazy-RAG streaming + `evidence_delta` (§9)** — unblock TTFT from
   retrieval; stream citations.
4. **Volatility-aware semantic-cache TTLs (§6)** — tune what's already
   wired; never cache volatile/evidence-empty.
5. **EstateMind precompute + safe next-turn prefetch (§8)** — read-only,
   reversible only.
6. **Cheap-first cascade behind the deferral/abstention gate (§4)** —
   LAST, most dangerous, needs a calibration set + false-accept monitoring
   + supersede-honestly UX + high-stakes exclusion reusing the fast-path
   predicate.
7. **Infra SLA (§7)** — procurement requirement: speculative decoding +
   warm pools on cheap/standard tiers.

---

## Sources

- Anthropic — Prompt caching docs (prefix order, 4 breakpoints, 1h TTL,
  Feb-2026 workspace isolation): https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- Anthropic on X — extended 1-hour TTL (−90% cost, −85% latency): https://x.com/AnthropicAI/status/1925633128174899453
- Anthropic — Fine-grained tool streaming (`eager_input_streaming`, `input_json_delta`, partial-JSON caveat): https://platform.claude.com/docs/en/agents-and-tools/tool-use/fine-grained-tool-streaming
- Anthropic — Streaming messages: https://docs.anthropic.com/en/docs/build-with-claude/streaming
- Anthropic — Building with extended thinking (interleaved, redaction, token economics): https://platform.claude.com/docs/en/build-with-claude/extended-thinking
- Claude — How prompt caching actually works (prefix stability): https://www.mager.co/blog/2026-04-29-claude-prompt-caching/
- Vercel AI SDK — `streamObject` / partial object stream: https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-object
- Vercel — json-render Generative UI (catalog Zod → constrained JSON → progressive render, Jan 2026): https://www.infoq.com/news/2026/03/vercel-json-render/
- FrugalGPT (cascade lineage): https://arxiv.org/pdf/2305.05176
- Towards a Cascaded LLM Framework for Cost-effective Human-AI Decision-Making (deferral + abstention + Bayesian calibration): https://arxiv.org/html/2506.11887v2
- Cost-Saving LLM Cascades with Early Abstention: https://arxiv.org/pdf/2502.09054
- Honesty over Accuracy: Trustworthy LMs through Reinforced Hesitation: https://arxiv.org/pdf/2511.11500
- Dynamic Model Routing and Cascading for Efficient LLM Inference: A Survey: https://arxiv.org/pdf/2603.04445
- Skeleton-of-Thought (parallel outline-then-expand, >2× speedup): https://arxiv.org/abs/2307.15337
- Semantic caching for LLMs (thresholds, 3–8ms, 20–45% real hit rate): https://blog.premai.io/semantic-caching-for-llms-how-to-cut-api-bills-by-60-without-hurting-quality/
- From Exact Hits to Close Enough: Semantic Caching for LLM Embeddings: https://arxiv.org/pdf/2603.03301
- Speculative decoding in production (2–3×, distribution-preserving): https://www.redhat.com/en/blog/solving-economics-llm-inference-speculative-decoding
- Speculative Actions: A Lossless Framework for Faster Agentic Systems: https://arxiv.org/pdf/2510.04371
- Reducing Latency of LLM Search Agent via Speculation (SPAgent): https://arxiv.org/abs/2511.20048
- VoiceAgentRAG — RAG latency bottleneck via dual-agent prefetch: https://arxiv.org/pdf/2603.02206
- vLLM — PagedAttention + continuous batching + prefix cache: https://www.runpod.io/articles/guides/vllm-pagedattention-continuous-batching
- WarmServe — GPU prewarming for multi-LLM serving: https://arxiv.org/pdf/2512.09472
