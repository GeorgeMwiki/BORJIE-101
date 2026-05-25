# Progressive Intelligence Research — 2026-05-24

Captured while building `packages/progressive-intelligence`. Scope: the
seven subsystems (schema-evolving entities, entity resolution, active
learning, live coaching, streaming inference, multi-source profile
unification, per-user few-shot personalization).

> This is a working research note, not architecture or policy. Cited
> sources are summarised with the design implications we adopted (or
> deliberately did not adopt).

## 1. Entity Resolution (dedup + canonicalization)

### Splink (Ministry of Justice UK)

Splink is an open-source probabilistic record-linkage library
implementing the Fellegi–Sunter model with EM-based parameter
estimation; it can link a million records on a laptop in approximately
one minute and is being adopted by NHS England as the engine of a new
probabilistic data-linkage service[1]. The library leans heavily on
**blocking rules + comparison vectors**, which informed our decision
to short-circuit on shared strong identifiers (`email`, `phone`,
`nationalId`, `kraPin`) before computing the soft-similarity composite.
A 2025 Harvard/Vanderbilt study used Splink to link 8.1M internet death
records to EHR data, lifting mortality ascertainment by 18–24%[1] —
strong evidence that probabilistic linkage still beats pure-ML
embeddings when the identifiers carry real signal.

### Zingg

Zingg is a Spark/Snowflake/Glue-native MDM tool (v0.6.0 shipped
2026-04-30) that supports **both probabilistic and deterministic**
matching, with an interactive active-learning training loop that builds
high-accuracy models on small samples[2]. Zingg's "build models on
small training samples" pattern is exactly what we replicate in the
active-learning subsystem: flag uncertain cases at threshold, ship
them to a human or LLM jury, then incorporate labels into the model
accumulator.

### dedupe.io / dedupe Python

`dedupe` is the canonical OSS library for fuzzy record matching;
it pairs blocking with a logistic-regression classifier over per-field
similarity scores. Our `MatchScoreBreakdown` mirrors dedupe's "score
per comparison" shape so an operator can read why a match fired and
re-tune individual weights without touching the orchestrator.

### deepmatcher

Stanford's `deepmatcher` showed embeddings + attention beats hand-crafted
features on noisy data. We adopt the principle (embedding similarity
is a first-class signal) but stop short of bundling a model — the
package accepts an `Embedder` port so the caller chooses (OpenAI
text-embedding-3-small, Voyage, Cohere, or a local SBERT model).

### Embedding-based dedup (FAISS, USearch, ScaNN, sentence-transformers, OpenAI text-embedding-3)

FAISS remains the most widely used library for vector similarity
search (million-to-billion scale, memory–speed–accuracy
tradeoffs)[3]. Recent comparative work (2026) benchmarks FAISS and
ScaNN on gene embeddings showing both viable at the millions-of-vectors
scale[3]. We deliberately keep our matcher in-memory — entity
resolution operates on small candidate sets (already pre-blocked by
tenant + kind) — so FAISS/USearch/ScaNN are out-of-band. The
embedding port is the seam where a vector-DB-backed pre-filter would
plug in later.

**Design implication:** the resolver runs a 3-signal composite
(embedding + fuzzy string + structural) with two thresholds (`match`,
`uncertain`). The strong-identity short-circuit guarantees the
verdict is decisive when phone/email/national ID is shared.

## 2. Active Learning + Weak Supervision

### modAL, libact

modAL is the canonical "modular active learning" framework, built on
top of scikit-learn — `ActiveLearner` accepts an estimator + a query
strategy[4]. We don't import modAL (no sklearn dependency in
TypeScript), but we adopt its **query-strategy abstraction**: caller
picks `low_confidence` (default) or — once population stats are
available — `outlier` (z-score against the mean).

### Snorkel (weak supervision)

Snorkel popularized labeling-function aggregation when labeled data is
scarce. Our `incorporateLabel` is the JS-side equivalent: each
oracle's label is a vote, agreement is tracked per `caseId`, and a
caller can wire a Snorkel-style noise-aware aggregator at the
boundary. We don't replicate Snorkel's matrix factorization — too
heavyweight for runtime — but the structure (labels-as-streams) is
deliberately compatible.

### Cleanlab

Confident learning (Northcutt et al., 2021) is the state-of-the-art
for finding label issues, learning with noisy labels, uncertainty
estimation, and dataset-quality scoring[5]. Cleanlab is model-agnostic
and is in production at Google, Amazon, Microsoft, Tesla, and Meta[5].
Our `detectNoisyLabels` is a minimal Cleanlab-style heuristic: when
multiple oracles disagree on the same `caseId`, the minority value is
flagged as noisy. The full confident-learning algorithm (estimate
`P(y_true | y_obs)` from a confusion matrix) is the next iteration —
the current shape is the harness it slots into.

### Label-Studio

Label-Studio is the de-facto labeling UI; our `LabelRequest` envelope
mirrors the shape Label-Studio sends to webhooks, so a future
integration can be ~50 lines of glue.

## 3. Live Coaching (inline AI)

### GitHub Copilot inline, Notion AI, Linear "Magic", Grammarly real-time

The pattern these tools share is **debounced, low-latency,
schema-grounded** assistance. Notion AI debounces at 400–800 ms;
Copilot inline at ~150 ms with cancellation; Linear Magic batches edits
into ~500 ms windows. We default to 500 ms (`createThrottledCoach`)
because data-entry coaching is more like Notion than Copilot — the
user is typing prose-like values, not tokens of code.

Crucial UX learning: **heuristics first, brain second**. Grammarly
shows spelling/grammar instantly from a local model, then layers in
LLM suggestions when network is available. We mirror this — pure
heuristic checks fire synchronously (`heuristicCoach`), then brain
hints append asynchronously if a `Brain` port is supplied. Brain
failure degrades silently to heuristics-only; no hint reaches the user
unless we are confident in it (we strip hallucinated field names).

## 4. Streaming Inference

### Vercel AI SDK (v6, 2026)

Vercel's AI SDK v6 uses an SSE-based "data stream protocol" with
typed events, keep-alive pings, reconnect, and an
`x-vercel-ai-ui-message-stream` header[6]. v6 shipped a typed-event
SSE protocol with 15–25% first-token latency improvement[6]. Critical
gotcha: pinning `ai@^6` and `@ai-sdk/react@^6` together is required —
mixed v5/v6 across the wire produces silent parse failures[6]. We
adopt the same wire shape (`id`, `event`, multi-line `data`) and emit
a numeric `id` per event so SSE `Last-Event-ID` resumption works.

### Anthropic streaming messages

The Anthropic API streams via SSE; each event has a typed name (e.g.
`event: message_stop`) and JSON data, with content blocks split into
`content_block_start`/`delta`/`stop`[7]. The SDK uses a dual-path
architecture — accumulator for in-place snapshot, builder for
immutable typed events[7]. Our `streamInference` is the
builder-equivalent: every chunk maps to an immutable `StreamingEvent`,
ids strictly increasing, no shared mutable state.

### SSE in general

Server-Sent Events is unidirectional HTTP-streaming with auto-reconnect
and `Last-Event-ID` headers; preferable to WebSockets when the server
is the only sender. We encode events as
`id: N\nevent: kind\ndata: ...\n\n` per the SSE spec, splitting
multi-line `data` across `data:` lines.

### WebSocket-as-RPC

We deliberately decoupled the SSE encoder from the event iterator so a
WebSocket relay can subscribe to the same `AsyncIterable<StreamingEvent>`
and frame events as JSON envelopes. This keeps the package usable from
Hono routes (HTTP/SSE), WebSocket gateways, and queue workers.

## 5. Multi-source Identity Unification

### Segment Unify (Twilio)

Segment's identity-resolution model is 100% deterministic with first-
party data; you provide many identifiers per person and set match
priorities to control how profiles are stitched[8]. Best-practice
guidance: use a consistent identifier across sources, regularly review
rules, don't make rules more restrictive after profiles exist outside
them, and use **Merge Protection** to block hard-coded test values
from being used as identifiers[8]. We adopted the **deterministic-
first** stance: strong identifier (email/phone/nationalId/MSISDN/Stripe
customer id) → score 1 instantly; otherwise fall back to soft
signals. The `subjectHintId` shortcut maps to Segment's external-id
table.

### Census reverse-ETL

Census pushes unified profiles back into downstream tools; their model
treats the warehouse as the source of truth. Our `currentUnified`
fetches fragments from a caller-supplied `FragmentStore` (warehouse,
Supabase, anywhere) and re-unifies on read so the canonical view is
always derivable from the append-only fragment log — no separate
synced table to drift.

### HubSpot Smart Forms / Progressive Profiling

Progressive profiling asks for **small pieces of information from a
contact over multiple form submissions** instead of all at once,
maximising first-conversion completion rates[9]. Best practice: ask
only the minimum to follow up on first conversion; queue additional
fields for return visits[9]. Our `ProfileFragment` shape is this
pattern at the data layer — each conversation, payment, scan, or
signup is one fragment, the unifier folds them on demand. Schema
versioning lets us promote frequently-captured "open attributes" into
typed slots without breaking older fragments.

### Gravity Forms Progressive, Klaviyo identify, Typeform AI, Tally, Fillout AI

These tools all converge on the same vocabulary: fragments captured
over time, server-side identity resolution, and last-touch / weighted
attribute resolution. Our `UnifyRules.resolveScalarsBy` supports both
`most_recent` (Klaviyo / Typeform default) and `authoritative`
(Segment / Census default).

## 6. Few-shot Personalization

### Per-user prompt augmentation, RAG-personalization, DSPy

DSPy is Stanford's framework for programmatic prompt optimization;
it replaces hand-written templates with signatures + modules + metrics
and runs optimizers (BootstrapFewShot, MIPRO, etc.) to find the best
prompt. Benchmarks show 10–40% quality improvement over manual
prompting[10]. The 2026 release added typed signatures + automatic
system-prompt optimization[10].

We don't ship a DSPy-style optimizer (it would need labeled training
data plus an offline pipeline — out of scope for this package). What we
do ship is the **runtime half**: `buildPersonalizedPrompt` retrieves
the top-k semantically similar examples for the calling user, fits
them into a token budget, and assembles the prompt. The caller can
plug in a DSPy-optimized base prompt; our personalization layer
injects per-user examples on top.

### Token-budget awareness

We default to 4000 tokens and use a `length / 4` heuristic counter;
callers can inject a real BPE tokenizer for precise accounting. The
trim algorithm drops examples one at a time from the bottom (lowest
similarity) until the budget fits — never the base prompt and never
the preferences block.

## 7. Schema Evolution

### Pydantic v2 / Zod 4 / JSON Schema 2026 draft

Pydantic v2 deprecated `allow_mutation` in favor of `frozen`; mutation
is not enforced at the Python layer[11]. Tooling like `pyrmute` adds
semver versioning + automatic migrations across versions[11]. Our
`Entity` and `UnifiedProfile` carry a `schemaVersion` field bumped when
a new attribute is promoted from the open `attributes` bag to a typed
slot. Callers can run migrations lazily on read.

Zod 4 mutable schemas + JSON Schema 2026 follow the same convention:
keep the open-attribute door cracked, version the typed core. Our
shape is deliberately compatible with both (we ship Zod-friendly
shapes; consumers can write a `z.object({...})` schema that picks
known fields and leaves `attributes` as `z.record(z.unknown())`).

## Cross-cutting design decisions captured

1. **Pure / DI-first.** Every subsystem accepts ports (Embedder,
   Brain, FragmentStore). No DB or network is hardcoded.
2. **Deterministic.** Same input → same output. Sort losers in merge,
   sort fragments in unify, monotonic stream ids — all in service of
   reproducibility and safe retry.
3. **Multi-tenant guard.** Entity resolution, fragment linking, and
   unification all reject cross-tenant inputs at the boundary. Defense
   in depth complementing P7's RBAC.
4. **Graceful degradation.** Live coaching falls back to heuristics
   when the brain is down; streaming emits a single `error` event then
   completes; uncertain-case flagging works without an outlier check.
5. **Append-only fragments.** Unification is a function of (fragment
   set, rules); there is no separate synced canonical table to drift
   out of date.

## References

1. [Splink — Free software for probabilistic record linkage at scale (NHS England, 2026 deployment notes)](https://moj-analytical-services.github.io/splink/index.html); also [paper](https://www.researchgate.net/publication/363226193_Splink_Free_software_for_probabilistic_record_linkage_at_scale); also [NICD end-to-end guide](https://nicd.org.uk/knowledge-hub/an-end-to-end-guide-to-overcoming-unique-identifier-challenges-with-splink); also [Probabilistic Record Linkage with Splink (Matt Simmons, Indiana MPH)](https://www.in.gov/mph/files/Probabilistic-Record-Linkage-with-Splink-State-Health-Simmons.pdf).
2. [Zingg — Scalable identity resolution + golden records (v0.6.0, 2026-04-30)](https://github.com/zinggAI/zingg); also [Zingg deep-dive on entity resolution](https://www.zingg.ai/deep-dives/the-what-and-why-of-entity-resolution); also [Entity resolution and fuzzy matches in AWS Glue using Zingg (AWS Big Data Blog)](https://aws.amazon.com/blogs/big-data/entity-resolution-and-fuzzy-matches-in-aws-glue-using-the-zingg-open-source-library/).
3. [The Faiss Library (Douze, Guzhva, Deng et al. — arXiv 2401.08281)](https://arxiv.org/abs/2401.08281); also [Faiss: A library for efficient similarity search (Meta Engineering)](https://engineering.fb.com/2017/03/29/data-infrastructure/faiss-a-library-for-efficient-similarity-search/); also [FAISS vs ScaNN comparative study on gene embeddings (arXiv 2507.16978, 2025)](https://arxiv.org/pdf/2507.16978).
4. [modAL — a modular active learning framework for Python (arXiv 1805.00979)](https://arxiv.org/pdf/1805.00979); also [modAL GitHub](https://github.com/modAL-python/modAL); also [modAL beginner's guide](https://medium.com/@moonchangin/unlocking-the-power-of-active-learning-with-modal-a-beginners-guide-93e9208f344).
5. [Cleanlab — confident learning standard package (cleanlab GitHub)](https://github.com/cleanlab/cleanlab); also [Confident Learning paper (Northcutt et al., 2021 — arXiv 1911.00068)](https://arxiv.org/pdf/1911.00068); also [Cleanlab data preprocessing guide (aimojo.io, 2026)](https://aimojo.io/cleanlab-data-preprocessing/).
6. [Vercel AI SDK UI: Stream Protocols](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol); also [Vercel AI SDK v5 to v6 Migration Playbook 2026 (Digital Applied)](https://www.digitalapplied.com/blog/vercel-ai-sdk-v5-to-v6-migration-playbook-2026); also [Vercel streaming functions docs](https://vercel.com/docs/functions/streaming-functions).
7. [Anthropic — Streaming messages (Claude API docs)](https://platform.claude.com/docs/en/build-with-claude/streaming); also [Streaming | anthropics/anthropic-sdk-python (DeepWiki)](https://deepwiki.com/anthropics/anthropic-sdk-python/6-streaming); also [Streaming Tool Calls: Parse Anthropic SSE Without Loading the Whole Message (dev.to, 2026)](https://dev.to/gabrielanhaia/streaming-tool-calls-parse-anthropic-sse-without-loading-the-whole-message-2on).
8. [Identity Resolution Overview (Segment / Twilio docs)](https://segment.com/docs/unify/identity-resolution/); also [Identity Resolution Settings (Twilio docs)](https://www.twilio.com/docs/segment/unify/identity-resolution/identity-resolution-settings); also [Leveling Up Identity Resolution — best practices for data scientists (Segment blog)](https://segment.com/blog/identity-resolution-best-practices-for-data-scientists/).
9. [What Is Progressive Profiling & How to Use It (HubSpot blog)](https://blog.hubspot.com/blog/tabid/6307/bid/34155/how-to-capture-more-and-better-lead-intel-with-progressive-profiling.aspx); also [Advanced HubSpot Lead Capture: Smart Forms & Progressive Profiling (Hypha)](https://www.hyphadev.io/blog/hubspot-advanced-lead-capture); also [HubSpot — use progressive fields in forms](https://knowledge.hubspot.com/forms/use-progressive-fields-in-forms).
10. [DSPy — programmatic prompt optimization (Stanford NLP)](https://github.com/stanfordnlp/dspy); also [DSPy guide (MyEngineeringPath, 2026)](https://myengineeringpath.dev/tools/dspy-guide/); also [Prompt Optimization with DSPy (Haystack cookbook)](https://haystack.deepset.ai/cookbook/prompt_optimization_with_dspy); also [Is It Time To Treat Prompts As Code? A Multi-Use Case Study Using DSPy (arXiv 2507.03620)](https://arxiv.org/pdf/2507.03620).
11. [Pydantic Models docs](https://docs.pydantic.dev/latest/concepts/models/); also [Pyrmute — Pydantic model versioning, migrations, multi-format schema generation](https://github.com/mferrera/pyrmute); also [Pydantic: The Complete Guide for 2026 (DevToolbox)](https://devtoolbox.dedyn.io/blog/pydantic-complete-guide).
