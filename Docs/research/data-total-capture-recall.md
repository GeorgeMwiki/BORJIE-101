# SOTA Dossier — Total Capture · Total Recall · Complete Observability (INV-J)

**Lane:** `total-capture-recall-observability` (INV-J)
**Date:** 2026-06-08
**Branch:** `integration/parity-final`
**Bar:** SOTA, best-in-the-world, PhD/MIT.
**Mandate (INV-J, owner directive, MASTER_GAP_REGISTER.md §INV-J):** the system NEVER
loses a conversation thread or a piece of data at any moment. Every interaction, document,
transaction, signal/sensor reading, decision and event is captured DURABLY (event-sourced,
no-drop-on-crash via the transactional outbox + durable execution), RETAINED (per compliance;
archive-first INV-E; protected per data-protection/PII/KMS), and RETRIEVABLE. The MD ALWAYS
KNOWS everything it can possibly know — complete situational awareness (the resident Current
Situational Model), complete lineage/provenance, total-recall memory, retrieval-of-anything
(GraphRAG + semantic + org-graph). Maximal capture + retention + retrieval + awareness; NO
accidental loss, ever. Same both repos (Borjie mining + BossNyumba real-estate, same brain).

> **One-sentence thesis:** capture every state change as an immutable event co-committed with
> the business write (transactional outbox / WAL-CDC); make every long operation a durable
> execution with a replayable journal; consolidate memory **without destroying source** so the
> thread is always reconstructable; thread W3C-PROV/OpenLineage lineage through every
> transformation; keep a resident bi-temporal world-model the agent reads first each turn; and
> serve recall-of-anything through hybrid GraphRAG (vector + BM25 + graph + temporal). Retention
> is archive-first and WORM/legal-hold-aware; erasure is crypto-shredding, never silent loss.

This dossier is the SOTA survey + a "beyond-today" leap per finding + an honest gap analysis
against our three load-bearing assets: the **transactional outbox** (`packages/database/src/
schemas/outbox.schema.ts`), **memory-v2 + cognitive-memory** (`packages/memory-v2`,
`packages/cognitive-memory`), and the **audit hash-chain** (`packages/workflow-engine/src/
audit`, `packages/blackboard-intel/src/audit/post-audit-chain.ts`).

---

## 0 · Our current substrate (what INV-J builds on)

| Asset | Path | State today | INV-J role |
|---|---|---|---|
| Transactional outbox | `packages/database/src/schemas/outbox.schema.ts` | Table + DLQ + subscriptions + per-event-type index; **producer dual-write is in-memory** (RSS-01: `payments-ledger/server.ts:316` uses `InMemoryEventPublisher`; `IOutboxRepository` unimplemented). Drainer publishes on in-process bus, no leader election (RSS-02). | The **capture spine** — every state change must co-commit here. |
| memory-v2 (6-layer: episodic/narrative/procedural/reflective/cohort/topic) | `packages/memory-v2/src` | Substrate built; **in-memory only** (MEM-01) — wiped on restart. (Tasks show Drizzle stores landed on a branch; verify on integration.) | Total-recall **agent memory** tiers. |
| cognitive-memory (cells, promotion, audit) | `packages/cognitive-memory/src` | Live recall exists; **no live `observe()` writer** historically (MEM-02). | Working→long-term consolidation. |
| Audit hash-chain | `packages/workflow-engine/src/audit`, `packages/blackboard-intel/src/audit/post-audit-chain.ts` | Append-only, hash-chained (hard rule: append-only, no mutation). | **Tamper-evident decision lineage**. |
| KG bi-temporal + PROV-O | `packages/knowledge-graph/src/temporal/bi-temporal.ts`, `provenance/prov-o.ts` | Modules **built but unused by ingest** (MEM-07: facts overwrite, no invalidate-with-timestamp). | Point-in-time recall + provenance. |
| graph-rag-router (hybrid retrieval) | `packages/graph-rag-router/src` | **Orphan** — reached by no request path (KI-graphrag). | Retrieval-of-anything. |
| Durable execution | `services/api-gateway/src/composition/durable/*` (Temporal workflows + Inngest executor) | Inngest opt-in + **no worker deployed** (RSS-23); Temporal workflow files present. | Uncapped-horizon operations with replayable history. |
| forecast-engine + conformal-calibration | (per INV-I) | Built. | Predictive layer that consumes the captured history. |

**The honest one-liner:** we have the *schemas and modules* for total capture/recall, but the
**producer dual-write is in-memory, memory tiers don't durably persist+reconstruct, the bi-
temporal/PROV-O lineage is unwired, and the hybrid-retrieval router is orphaned.** INV-J is
~70% un-wired plumbing, not missing design.

---

## 1 · CAPTURE — event sourcing + the transactional outbox (no-drop on crash)

### SOTA finding 1.1 — Outbox is the 2026 default for "never lose an event"
The transactional outbox pattern co-commits a domain event into an `outbox` table **inside the
same DB transaction** as the business write, so a crash can never leave "state changed but event
lost" (or vice-versa). A relay then publishes asynchronously. This is now the textbook reliable-
events pattern; AWS Prescriptive Guidance, Conduktor, and multiple 2026 practitioner write-ups
treat it as the baseline ([AWS Prescriptive Guidance — Transactional outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html);
[Conduktor — Outbox for Reliable Event Publishing](https://www.conduktor.io/glossary/outbox-pattern-for-reliable-event-publishing);
[The Transactional Outbox Pattern (James Carr, 2026-01)](https://james-carr.org/posts/2026-01-15-transactional-outbox-pattern/)).

### SOTA finding 1.2 — CDC-first / WAL-message outbox removes the relay & the polling housekeeping
The 2026 refinement is **CDC-first**: Debezium tails Postgres logical decoding and streams every
new outbox row to the bus, **replacing the bespoke relay worker** and giving the
database-is-the-event-bus property. The even-leaner variant emits the event as a **Postgres
logical-decoding message straight into the WAL** (`pg_logical_emit_message`) — no outbox table to
vacuum, emphasising the append-only "messages must never be modified after being added" nature
([debugg.ai — The Database Is Your Event Bus (CDC-first, outbox+inbox, Debezium)](https://debugg.ai/resources/database-event-bus-cdc-first-architectures-postgres-outbox-inbox-debezium-2025);
[Decodable — Wonders of Postgres Logical Decoding Messages for CDC](https://www.decodable.co/blog/the-wonders-of-postgres-logical-decoding-messages-for-cdc);
[Conduktor — Transactional Outbox: DB-Kafka Consistency](https://www.conduktor.io/blog/transactional-outbox-pattern-database-kafka)).

### SOTA finding 1.3 — The delivery contract is at-least-once + idempotent inbox, NOT exactly-once
Even with CDC + LSN checkpoints you get **at-least-once, not exactly-once**: the walsender can ship
an event then crash before the LSN ack reaches Postgres, so the event re-sends on resume.
The SOTA contract is therefore **at-least-once delivery + an idempotent inbox**: the consumer
persists each event into an `inbox` table with a **UNIQUE constraint on event-id**, dedupes at the
DB boundary, and commits the processing outcome atomically. "Favor at-least-once with dedup rather
than chasing exactly-once" ([debugg.ai, ibid.](https://debugg.ai/resources/database-event-bus-cdc-first-architectures-postgres-outbox-inbox-debezium-2025);
[Practical Notes in CDC with Debezium and Postgres (Cermati)](https://medium.com/cermati-tech/practical-notes-in-change-data-capture-with-debezium-and-postgres-fe31bb11ab78)).
This matches Borjie's hard rule: *webhook delivery is at-least-once; consumers MUST be idempotent
via `Idempotency-Key`.*

### SOTA finding 1.4 — Event sourcing gives the append-only ground truth; CQRS gives the read models
Event sourcing (immutable event log as the source of truth, current state = a fold over events)
and the outbox are complementary: outbox publishes integration events; event sourcing makes the
**event the state**, enabling point-in-time reconstruction ("event store for point-in-time recovery")
— but only if event **ordering** is preserved, else data quality is compromised. Saga +
compensating actions handle the cross-aggregate consistency that 2PC can't
([Microservices Data Patterns: Saga, Outbox, CQRS, Event Sourcing](https://www.abstractalgorithms.dev/microservices-data-patterns-saga-outbox-cqrs-and-event-sourcing);
[Debezium — Event Sourcing vs CDC](https://debezium.io/blog/2020/02/10/event-sourcing-vs-cdc/)).

> **Beyond-today leap (CAPTURE):** make the **outbox the single capture chokepoint for the whole
> estate, not just money** — every consequential write (ledger, licence, assay, KYC, document,
> decision, sensor/FX reading, chat turn, UI mutation) co-commits an immutable
> `EstateEvent{tenant, aggregate, type, payload, t_occurred, causation_id, correlation_id}` in the
> *same* transaction. A Debezium/WAL-message relay (eliminating the in-process drainer's drop
> window) fans these to the bus, the memory consolidator, the KG ingest, and the world-model — so
> "what happened in the estate" has exactly **one** lossless append-only source. The estate becomes
> *event-sourced by construction*: any past estate state at time *t* is a deterministic fold of the
> log up to *t* — the foundation for the "reconstruct any past state on demand" goal.

---

## 2 · DURABLE EXECUTION — uncapped-horizon operations with replayable history (INV-G)

### SOTA finding 2.1 — Durable execution is now a *core requirement* for production AI, not niche
Agentic pipelines, long-running sagas, and event-driven jobs converged on one primitive: **a
function that resumes exactly where it left off after a crash.** Temporal defined the category;
Restate, Inngest, Hatchet, DBOS crowd it. Market signal: **Temporal raised a $300M Series D at a
$5B valuation in Feb 2026 (a16z-led)** — durable execution "moved from a niche infrastructure
concern to a core requirement for production AI systems" ([Spheron — Temporal/Inngest/Restate for durable AI pipelines (2026)](https://www.spheron.network/blog/ai-agent-workflow-orchestration-temporal-inngest-restate-gpu-cloud/);
[Olmec — Temporal and the 2026 shift to durable agentic workflows](https://olmecdynamics.com/news/temporal-durable-execution-agentic-workflows-2026)).

### SOTA finding 2.2 — The journal IS the full history; replay reconstructs without re-doing side effects
Temporal records **every step as an immutable event history**; if the process dies at step 47/100
it replays the log and resumes at step 48, returning cached results for completed steps.
**Critically: replay re-runs only the coordination code, NOT the activities** — "API calls, database
writes, and LLM calls are not repeated during replay." This requires deterministic workflow code.
This event-history *is* a lossless, queryable record of how every long operation unfolded
([Effloow — Temporal for AI Agents 2026](https://effloow.com/articles/temporal-ai-agents-durable-execution-guide-2026);
[AppScale — Durable Execution for LLM Agents 2026 (Temporal + LangGraph checkpointing)](https://appscale.blog/en/blog/durable-execution-llm-agents-temporal-langgraph-checkpointing-2026)).

### SOTA finding 2.3 — DBOS = cleanest exactly-once when the step and its durability record share Postgres
DBOS gives **transactional exactly-once** when the step writes to the same Postgres that stores
workflow state — the step's DB writes and its durability record commit together or not at all
("cleanest semantics in the category"). Restate journals `ctx.run()` before execution and replays
on crash, giving exactly-once without app-level idempotency keys. The trade-off vs Temporal is
operational: Postgres-native (DBOS) vs separate cluster (Temporal)
([DBOS vs Temporal: Choosing Durable Execution in 2026](https://www.tiarebalbi.com/en/blog/dbos-vs-temporal-postgres-durable-execution);
[Resonate — From where do deterministic constraints come?](https://journal.resonatehq.io/p/from-where-do-deterministic-constraints)).

> **Beyond-today leap (DURABLE):** treat **every estate "loop" (renewal ladders, multi-week
> shipments, 60-day licence cycles, 24/7 watch loops — INV-G) as a durable workflow whose event
> history is itself an INV-J capture stream.** Co-locate the durability journal in our Postgres
> (DBOS-class, exactly-once at the step boundary) so the durable journal and the outbox/event-store
> live in one ACID universe. Then "what is the MD doing right now, and every step it took to get
> here" is answerable by reading a replayable journal — durable execution doubles as the system's
> *operational memory*, never lost across restarts, deploys, or month-long horizons.

---

## 3 · TOTAL-RECALL MEMORY — consolidate WITHOUT losing the source thread

### SOTA finding 3.1 — Memory is a first-class architectural component, NOT a longer prompt
2026 consensus: memory is a dedicated component **separate from the context window**. The memory
layer extracts facts during conversation, stores them indexed by user/session/agent, and at a new
session retrieves relevant memories via **semantic similarity + keyword + entity matching**, then
injects them. BEAM (a 2026 benchmark) evaluates at conversation scales **exceeding any model's
context window** — the 1M-token split has 35 conversations × 20 questions across 10 memory
abilities ([mem0 — State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026);
[IBM — What Is AI Agent Memory?](https://www.ibm.com/think/topics/ai-agent-memory)).

### SOTA finding 3.2 — "Storage is not memory": retrieval-centered, verbatim-preserving beats extraction
The sharpest 2026 result for INV-J: **a database returns what was written; a memory returns what is
reconstructed at recall.** Retrieval-centered architectures argue **verbatim event preservation
outperforms extraction-based ingestion** — i.e., keep the raw thread, reconstruct at query time —
because extraction-on-ingest discards the source. This is *exactly* the INV-J "thread is always
reconstructable" requirement: **never collapse the source into a summary that loses it**
([arXiv 2605.04897 — Storage Is Not Memory: A Retrieval-Centered Architecture for Agent Recall](https://arxiv.org/html/2605.04897);
[arXiv 2603.07670 — Memory for Autonomous LLM Agents: Mechanisms, Evaluation, Frontiers](https://arxiv.org/html/2603.07670v1)).

### SOTA finding 3.3 — The four memory competencies, and the one everyone fails
MemoryAgentBench grounds evaluation in cognitive science across four competencies: **accurate
retrieval, test-time learning, long-range understanding, selective forgetting.** "**No current
system masters all four; most fail conspicuously on selective forgetting.**" For an estate that
must *never lose data* but must *deprecate stale facts*, the resolution is bi-temporal validity
(§5) — invalidate, never delete ([mem0, ibid.](https://mem0.ai/blog/state-of-ai-agent-memory-2026);
[arXiv 2603.07670](https://arxiv.org/html/2603.07670v1)).

### SOTA finding 3.4 — Concrete production numbers + the tiering
mem0's 2026 algorithm: **LoCoMo 92.5 / LongMemEval 94.4 / BEAM-1M 64.1 / BEAM-10M 48.6**, at
~6.7–7k tokens/query (vs full-context blow-up); **+29.6 pts temporal reasoning, +23.1 multi-hop.**
Tiers: **episodic** (what happened) · **semantic** (facts) · **procedural** (learned workflows/
tool-use habits — "still early-stage in tooling"). Production requirements that ship: **async-first
writes** (no latency hit), **a reranking layer** (Cohere/HF/LLM), metadata filtering, accurate
update timestamps. Provenance is preserved by **actor-aware storage** — user messages under
`user_id`, agent inferences under `agent_id` — so you can always separate "what the user said" from
"what the agent inferred." Open problems they flag: **memory staleness** ("high-relevance outdated
facts remain confidently wrong") and **temporal abstraction** (the 64.1→48.6 drop at 10× scale)
([mem0, ibid.](https://mem0.ai/blog/state-of-ai-agent-memory-2026)).

> **Beyond-today leap (MEMORY):** a **two-plane memory** that satisfies *both* halves of INV-J at
> once. Plane A = the **immutable verbatim plane**: every turn/document/event is the source of
> truth, append-only, never summarized-away (§3.2) — the thread is *always* reconstructable token-
> for-token. Plane B = the **consolidated recall plane**: our memory-v2 tiers + cognitive-memory
> cells hold *derived* facts, each carrying a **back-pointer (`source_event_id`)** into Plane A and
> a **bi-temporal validity** (§5). Consolidation then *enriches* without destroying: a stale fact is
> marked `t_invalid`, not erased, and its source remains. This is the architectural answer to "never
> lose a thread" *and* "selective forgetting" — we forget by **superseding**, never by **deleting**,
> and we can always reconstruct the exact conversation that produced any belief.

---

## 4 · LINEAGE / PROVENANCE — every datum and every decision carries its origin

### SOTA finding 4.1 — Two standards, complementary: W3C PROV (semantic) + OpenLineage (operational)
**W3C PROV** is the domain-agnostic provenance model built on three concepts — **Entity, Activity,
Agent** — capturing how data was created/transformed and who/what was responsible.
**OpenLineage** (LF AI & Data) is the operational standard for collecting lineage from running
pipelines (datasets/jobs/runs + extensible **facets**), with native integrations (Airflow, Spark,
dbt, Snowflake, BigQuery) and, per early-2026, **expanded support in IBM watsonx.** They compose:
PROV models the *meaning* of provenance; OpenLineage *collects* it at runtime
([GitHub — OpenLineage](https://github.com/OpenLineage/OpenLineage);
[datalakehousehub — OpenLineage as the spine of data observability (2026-05)](https://datalakehousehub.com/blog/2026-05-openlineage-observability/);
[W3C PROV family of specifications](https://dl.acm.org/doi/10.1145/2452376.2452478)).

### SOTA finding 4.2 — Lineage is the trust signal for explainable AI ("cite your own provenance")
2026 framing: data lineage is **the provenance layer of the enterprise context layer** — the trust
signal that tells the AI which transformations are verified, which dependencies carry compliance
risk, and which upstream changes will break downstream AI outputs — **enabling explainable AI that
can cite its own data provenance** ([Atlan — What Is Data Lineage (2026)](https://atlan.com/data-lineage-explained/);
[datalakehousehub, ibid.](https://datalakehousehub.com/blog/2026-05-openlineage-observability/)).
For Borjie this is the bridge to the **evidence-required AI rule** (every junior cites ≥1
`evidence_id`; the Auditor rejects empty chains) — lineage *is* the evidence chain made first-class.

### SOTA finding 4.3 — Provenance ≠ lineage: origin/authenticity vs flow
Provenance answers *origin & authenticity* (where did this come from, is it trustworthy);
lineage answers *flow* (how did it move/transform end-to-end). A complete INV-J system needs both:
**decision lineage** (which inputs/tools/agents produced a decision — our audit hash-chain) **+**
**data provenance** (the source authenticity of each input)
([truescreen — Data Provenance vs Data Lineage](https://truescreen.io/articles/data-provenance-definition-source-authenticity/);
[OvalEdge — Data Lineage vs Data Provenance](https://www.ovaledge.com/blog/data-lineage-vs-data-provenance)).

> **Beyond-today leap (LINEAGE):** make **every decision a PROV graph and every dataset an
> OpenLineage run.** The audit hash-chain already gives tamper-evident *decision* lineage; bind a
> **W3C-PROV emitter** so each MD decision materializes as `Activity(think) ⟵ used ⟵
> Entity(evidence_id, corpus_chunk, ledger_row) ⟵ wasAttributedTo ⟵ Agent(junior/persona)`, and an
> **OpenLineage facet** for each ingest/transform (corpus→KG→memory→forecast). Result: the MD can
> *render its own lineage as a live lens* (INV-B/INV-H) — "why do you believe X?" returns the full
> entity→activity→agent graph back to the immutable source event. Perfect lineage = every belief is
> click-through-traceable to ground truth, and any upstream change auto-flags every downstream
> decision it touched.

---

## 5 · POINT-IN-TIME RECALL — bi-temporal knowledge graphs (reconstruct any past state)

### SOTA finding 5.1 — Bi-temporal is the 2026 winner for agent memory over flat vector stores
**Zep v2 + Graphiti** is the reference: a **bi-temporal knowledge graph** that tracks **two time
axes — when an event *occurred* (`t_valid`/`t_invalid`) and when it was *ingested* (transaction
time).** Every edge carries explicit validity intervals. This lets the engine **contextualize
queries against both the original occurrence and the most-recent information state** — i.e.,
answer "what did we believe on date D?" *and* "what is true now?" Zep's paper (arXiv 2501.13956)
reports temporal-KG memory **beating vector memory** on agent benchmarks; Graphiti has 45k+ GitHub
stars and is the de-facto open temporal-KG for agents in 2026
([CallSphere — Zep v2 + Graphiti: Temporal KGs beat vector memory (2026)](https://callsphere.ai/blog/vw3g-zep-memory-v2-temporal-knowledge-graph-graphiti-2026);
[Neo4j — Graphiti: KG memory for an agentic world](https://neo4j.com/blog/developer/graphiti-knowledge-graph-memory/);
[arXiv 2501.13956 — Zep: A Temporal KG Architecture for Agent Memory](https://arxiv.org/abs/2501.13956);
[GitHub — getzep/graphiti](https://github.com/getzep/graphiti)).

### SOTA finding 5.2 — A fact has a validity window; supersede, never overwrite
"Unlike traditional KGs, each fact in a context graph has a validity window: when it became true,
and when (if ever) it was superseded." This is the mechanism that resolves the
"never-lose-data vs deprecate-stale-facts" tension: **a fact is invalidated by setting `t_invalid`,
never deleted** — so the historical graph state is always reconstructable
([contextgraph.tech — Open-Source Context Graph Tools (2026)](https://www.contextgraph.tech/learn/open-source-context-graph-tools);
[emergentmind — Zep: Temporal KG Architecture](https://www.emergentmind.com/topics/zep-a-temporal-knowledge-graph-architecture)).

> **Beyond-today leap (POINT-IN-TIME):** **wire our already-built bi-temporal + PROV-O modules**
> (`knowledge-graph/src/temporal/bi-temporal.ts`, `provenance/prov-o.ts`) into the ingest path
> (closing MEM-07: today facts *overwrite*). Every estate fact (royalty rate, licence status, assay
> grade, ownership, FX, employee role) becomes a bi-temporal edge with `(t_valid, t_invalid,
> ingested_at, source_event_id)`. Then the MD can **time-travel the estate's belief state**: "show
> the cap table / licence portfolio / cash position *as we understood it* on 2026-03-27 (the USD-
> cliff date)" replays the graph at that instant — *audit-defensible, regret-free* reconstruction.
> This is the literal realization of the lane's beyond-today vision: *an estate with perfect memory
> where any past state/thread/decision is reconstructable on demand.*

---

## 6 · SITUATIONAL AWARENESS — the resident Current Situational Model the agent reads first

### SOTA finding 6.1 — Persistent world-model: a belief state the agent updates like a Kalman filter
2026 situational-awareness models use weighted belief networks connecting observations → simple
beliefs → complex beliefs → **future beliefs**; the agent's state includes its **own identity,
stage, and impact on the world.** World models can be **continuous (retained in long-term memory
after sessions end)**, session-based, or non-persistent — INV-J demands **continuous/persistent.**
In closed-loop operation the agent **compares predicted vs observed outcomes to refine beliefs,
similar to a learned Kalman filter**; the belief state evolves as subgoals execute
([Springer — Learning Belief Connections in a Model for Situation Awareness](https://link.springer.com/chapter/10.1007/978-3-642-25044-6_30);
[Medium — World Models: The Next Leap Beyond LLMs](https://medium.com/@graison/world-models-the-next-leap-beyond-llms-012504a9c1e7)).

### SOTA finding 6.2 — Blackboard architecture as the shared situational substrate
The **blackboard pattern** (a shared world-model written/read by perception, reasoning, and
communication modules) is the 2026 multi-agent substrate for keeping a coherent "what the agent
thinks the current state of the world is." Domain agents own dedicated blackboards; perception and
comms modules read/write them ([Medium — Multi-Agent Systems with MCPs and the Blackboard Pattern](https://medium.com/@dp2580/building-intelligent-multi-agent-systems-with-mcps-and-the-blackboard-pattern-to-build-systems-a454705d5672)).
This maps directly to our `blackboard-sota` / cross-surface state-bus (EA-05) and the
`SituationalSelfModel` the gap register specifies (COG-15: six facets — happened/doing/todo/future/
blind-spots/caveats — *read first each turn*).

> **Beyond-today leap (AWARENESS):** a **resident Current Situational Model (CSM) materialized from
> the event log, updated on every outbox event, read first on every turn.** The CSM is a continuous
> world-model (§6.1) projected from §1's event stream + §5's bi-temporal KG: cash position, open
> loops, licence clocks, shipments-in-flight, KYC queue, FX exposure, blind-spots/caveats — always
> current, never recomputed from scratch. The agent updates beliefs Kalman-style (predicted vs
> observed via the forecast-engine + conformal residuals from INV-I). "Always knows everything it
> can possibly know" stops being aspirational: the CSM is the **single read** that *is* complete
> situational awareness, and because it's projected from the immutable log it is itself never lost.

---

## 7 · RETRIEVAL-OF-ANYTHING — hybrid GraphRAG (vector + BM25 + graph + temporal)

### SOTA finding 7.1 — Hybrid (vector + keyword + graph) is the 2026 retrieval default
No single paradigm suffices: **dense vectors** (semantic) + **sparse BM25** (exact/keyword) +
**graph traversal** (multi-hop, relationship-aware) combined beat any one alone. A query triggers
*both* semantic search over chunks *and* graph traversal from identified entities; graph adds the
multi-hop reasoning vectors can't ([Calmops — Hybrid Search RAG Complete Guide 2026](https://calmops.com/ai/hybrid-search-rag-complete-guide-2026/);
[FalkorDB — What Is Hybrid Search in AI](https://www.falkordb.com/blog/what-is-hybrid-search-in-ai/);
[AWS — Improving GenAI accuracy with vector+graph hybrid queries](https://aws.amazon.com/blogs/database/improving-generative-ai-accuracy-with-vector-and-graph-search-hybrid-queries/)).

### SOTA finding 7.2 — GraphRAG is explainable + scalable; efficient KG construction is the 2026 push
GraphRAG (graph traversal + vector search assembling "precise, connected context") gives
**explainable, relationship-aware multi-hop** retrieval; 2026 work targets **efficient KG
construction + hybrid retrieval at scale** so it's production-viable, not just accurate
([arXiv 2507.03226 — Towards Practical GraphRAG: Efficient KG Construction and Hybrid Retrieval at Scale](https://arxiv.org/html/2507.03226v3);
[Calmops — GraphRAG hybrid retrieval](https://calmops.com/algorithms/graphrag-hybrid-retrieval/)).

### SOTA finding 7.3 — Retrieval, not storage, is the differentiator
The retrieval-centered thesis (§3.2) generalizes: the value is in **reconstruction at recall** —
multi-signal fusion (semantic + keyword + entity + temporal validity) ranked and reranked — not in
how the bytes were stored. mem0's multi-signal retrieval (semantic + keyword + entity, fused
scores, reranked) is the production embodiment ([mem0, ibid.](https://mem0.ai/blog/state-of-ai-agent-memory-2026);
[arXiv 2605.04897](https://arxiv.org/html/2605.04897)).

> **Beyond-today leap (RETRIEVAL):** **un-orphan `graph-rag-router`** (KI-graphrag) and make it the
> single recall plane that fuses **(a) pgvector** over corpus+memory, **(b) BM25/`tsvector`** for
> exact licence-IDs/assay-codes/names, **(c) the org-graph + bi-temporal KG** for multi-hop +
> point-in-time, and **(d) the event log** for "what literally happened." A query like "every
> decision touching Licence ML-4471 and the evidence behind each" fans across all four planes,
> re-ranks, and returns a **traceable, time-aware answer with lineage** — retrieval-of-*anything*,
> because every plane indexes the same immutable source events. One router, four signals, perfect
> recall.

---

## 8 · RETENTION & COMPLIANCE — archive-first, WORM/legal-hold, erase-by-crypto-shred

### SOTA finding 8.1 — WORM + Object-Lock is the 2026 immutability baseline for regulated records
Write-Once-Read-Many immutable storage (Azure Immutable Blob, S3 Object Lock / Object Retention
Lock) enforces that objects **cannot be modified or deleted until the retention period expires** —
the compliance baseline for SEC 17a-4, FINRA, CFTC 1.31, HIPAA, GDPR. Object Retention Lock now sets
**per-object** "retain-until" times (enable-able on existing buckets as of 2025–2026)
([oneuptime — Immutable Storage with WORM in Azure Blob (2026-02)](https://oneuptime.com/blog/post/2026-02-16-how-to-configure-immutable-storage-worm-policies-azure-blob/view);
[DevSecOpsSchool — What is WORM Storage (2026 Guide)](http://devsecopsschool.com/blog/worm-storage/);
[Grotabyte — WORM Immutability Regulatory Compliance](https://www.grotabyte.com/blog/worm-storage-immutability-regulatory-compliance)).

### SOTA finding 8.2 — Legal hold + time-based retention compose; both must clear before deletion
A container can carry **both** a time-based retention policy **and** a legal hold; **both** must be
satisfied before any blob is deletable. Legal hold keeps data immutable **indefinitely until
explicitly cleared** — for litigation/regulatory investigation
([oneuptime, ibid.](https://oneuptime.com/blog/post/2026-02-16-how-to-configure-immutable-storage-worm-policies-azure-blob/view);
[CertLibrary — WORM in Azure Guide](https://www.certlibrary.com/blog/a-complete-guide-to-worm-storage-in-azure-for-compliance-and-data-security/)).
This is Borjie's INV-E made concrete: royalty/licence/audit-chain/financial/KYC records have
statutory retention and **must not be auto-touched.**

### SOTA finding 8.3 — GDPR is purpose-driven; right-to-erasure reconciles with WORM via crypto-shredding
"GDPR data retention is **purpose-driven, not time-driven** — data may only be kept while a lawful
basis still applies." When retention ends, WORM systems either allow deletion to comply with GDPR
right-to-erasure **or** extend retention. The reconciliation pattern (our DP lane, crypto-shred) is
**crypto-shredding**: encrypt per-subject, then destroy the key to render data unrecoverable
without mutating the immutable store or breaking the hash-chain
([Archon — GDPR Data Retention: Long-Term Storage Compliance](https://www.archondatastore.com/blog/gdpr-data-retention/);
[RDS — Data Retention Rules, Compliance & Strategies (2026)](https://rdsolutionsdata.io/what-is-data-retention-rules-compliance-and-strategies-across-industries/)).

> **Beyond-today leap (RETENTION):** a **per-event-class retention-policy engine** driven off the
> event log. Each captured event carries a **retention class** (`statutory-royalty-7y`,
> `kyc-legal-hold`, `chat-archive`, `pii-purpose-bound`); the engine routes immutable artifacts to
> **WORM/Object-Lock** with the right "retain-until," honors **legal-hold flags** (block deletion
> indefinitely), and satisfies GDPR erasure via **crypto-shredding the per-subject DEK** — which
> tombstones the data *without* mutating the append-only event store or the audit hash-chain. This
> is the INV-J ∩ INV-E reconciliation: *never lose data accidentally; erase only deliberately,
> gated, crypto-shredded, audit-logged — and even then the lineage skeleton (who/when/why erased)
> survives.* Compliant total-capture, by construction.

---

## 9 · THE INTEGRATED INV-J ARCHITECTURE (how the eight findings compose)

```
                      ┌─────────────────────────────────────────────────────┐
  every business      │  TRANSACTIONAL OUTBOX  (§1)  — co-commit, no drop    │
  write (ledger/      │  EstateEvent{aggregate,type,payload,t_occurred,      │
  licence/assay/KYC/  │  causation_id, source} ── append-only, immutable     │
  doc/decision/turn/  └───────────────┬─────────────────────────────────────┘
  sensor/FX/UI) ──────────────────────┘  Debezium / WAL-message relay (§1.2)
                                         (at-least-once + idempotent inbox §1.3)
        ┌──────────────────┬────────────────────┬──────────────────┬─────────────┐
        ▼                  ▼                    ▼                  ▼             ▼
  EVENT STORE        MEMORY (§3)          BI-TEMPORAL KG (§5)   LINEAGE (§4)   CSM (§6)
  fold→any past      Plane A verbatim     facts w/ validity     PROV graph +   resident
  estate state       (never summarized)   (t_valid,t_invalid,   OpenLineage    world-model,
  at time t          Plane B consolidated  ingested_at, src)    per decision/  read first
                     w/ source_event_id    supersede≠delete     transform      each turn
        └──────────────────┴────────────────────┴──────────────────┴─────────────┘
                                         ▼
                          RETRIEVAL-OF-ANYTHING (§7): graph-rag-router
                          vector + BM25 + graph + temporal + event-log → reranked, traceable
                                         ▼
                  DURABLE EXECUTION (§2) wraps every long loop; its journal is
                  itself a capture stream → operational memory, replayable, uncapped horizon
                                         ▼
                  RETENTION ENGINE (§8): WORM/Object-Lock + legal-hold + crypto-shred erasure
                  archive-first (INV-E); never auto-touch statutory/audit/financial/licence
```

**Invariant chain:** capture (§1) → never-drop (§1.3 + §2) → consolidate-without-loss (§3.2) →
time-travel (§5) → trace (§4) → always-aware (§6) → recall-anything (§7) → retain-compliantly (§8).
Each link is an immutable, append-only projection of the same source events — so **no single point
can silently lose data**, and **any past state/thread/decision is a deterministic reconstruction**.

---

## 10 · OUR GAPS vs SOTA (outbox · memory-v2 · audit-chain) — actionable

| # | Gap | Today | SOTA target | Register link |
|---|---|---|---|---|
| G1 | **Outbox producer dual-write is in-memory** → money-path at-least-once not real; drainer in-process, no leader election, drop window | `InMemoryEventPublisher` (`payments-ledger/server.ts:316`); `IOutboxRepository` unimplemented; drainer (RSS-02) | Durable `enqueueToOutbox(events, tx)` co-commit + Drizzle `IOutboxRepository`; CDC/WAL-message relay (§1.2) to remove the in-process drop window; leader-elected drainer | RSS-01, RSS-02 |
| G2 | **Capture is money-only, not estate-wide** | outbox used on payments path | Every consequential write (licence/assay/KYC/doc/decision/turn/sensor/FX/UI) co-commits an `EstateEvent` → one lossless capture spine (§1 leap) | new (INV-J) |
| G3 | **Idempotent inbox + dedup not formalized** | hard rule says consumers idempotent, but no first-class `inbox(unique event_id)` table | `inbox` table, UNIQUE on event-id, dedup at DB boundary, atomic outcome commit (§1.3) | new (INV-J) |
| G4 | **Memory tiers don't durably persist/reconstruct** | memory-v2 in-memory (MEM-01); cognitive-memory had no live `observe()` (MEM-02) — *Drizzle stores landed on branch, verify on integration* | Two-plane memory (§3 leap): verbatim Plane A (never summarized) + consolidated Plane B with `source_event_id` back-pointers; async-first writes; reranker | MEM-01, MEM-02, MEM-05 |
| G5 | **Consolidation can lose the source thread** | consolidator stub historically (MEM-05); risk of summarize-away | Retrieval-centered, verbatim-preserving (§3.2); forget-by-supersede, never delete | MEM-05 |
| G6 | **Bi-temporal + PROV-O modules unwired** → facts overwrite, no point-in-time | `temporal/bi-temporal.ts`, `provenance/prov-o.ts` built, not in ingest | Wire into ingest: every fact bi-temporal `(t_valid,t_invalid,ingested_at,source_event_id)`; supersede≠delete; time-travel queries (§5 leap) | MEM-07 |
| G7 | **No W3C-PROV / OpenLineage emission** | audit hash-chain gives decision lineage only; no data-provenance graph, no pipeline lineage | PROV emitter per decision + OpenLineage facets per ingest/transform; render lineage as a live lens (§4 leap) | new (INV-J); ties evidence-required rule |
| G8 | **graph-rag-router orphaned** → no retrieval-of-anything | reached by no request path (KI-graphrag) | Single recall plane fusing vector + BM25 + graph + temporal + event-log, reranked, traceable (§7 leap) | KI-graphrag, KI-11 |
| G9 | **No resident Current Situational Model** | world-model/goal-tracker/stall-detector disjoint; supervisor types unused | Six-facet CSM projected from event log, updated per event, read first each turn (§6 leap) | COG-15 / ORCH-situation |
| G10 | **Durable execution opt-in, no worker deployed** → long loops lost on restart | Inngest opt-in (RSS-23); Temporal files present; journal not used as capture | Deploy durable worker; DBOS-class exactly-once at step; treat journal as an INV-J capture stream (§2 leap) | RSS-23, EXEC-saga |
| G11 | **Retention engine not first-class** | INV-E archive-first stated; DP crypto-shred exists; no per-event-class WORM/legal-hold routing | Retention-class engine → WORM/Object-Lock + legal-hold + crypto-shred erasure; lineage-skeleton survives erasure (§8 leap) | INV-E, DP-01, DP-05 |
| G12 | **No "reconstruct any past state" capability end-to-end** | event store schema exists but state isn't folded; no time-travel surface | Event-fold reconstruction + bi-temporal replay → "the estate as we understood it on date D" (§§1,5 leaps) | new (INV-J flagship) |

**Closure order (dependency spine):** G1+G3 (real durable capture) → G2 (estate-wide capture) →
G4+G5 (memory persists + never loses source) → G6 (bi-temporal facts) → G7 (lineage) → G9 (CSM
reads the above) → G8 (retrieval fuses all planes) → G10 (durable journal as capture) → G11 (retain
compliantly) → G12 (the flagship: reconstruct any past state on demand). G1, G6, G8 are the three
highest-leverage un-wirings — each is "module built, never connected."

---

## 11 · THE BEYOND-TODAY VISION (what "best-in-the-world" looks like for INV-J)

> **An estate with perfect memory and perfect lineage, where any past state, thread, or decision
> is reconstructable on demand.**

Concretely, when this lane is closed:
- **Nothing is ever lost.** Every state change is an immutable event, co-committed (no crash window),
  fanned losslessly to memory/KG/world-model/retention. The conversation thread is preserved
  verbatim and is always reconstructable token-for-token.
- **The MD always knows everything it can know.** A resident Current Situational Model — projected
  continuously from the event log — is the single read that *is* complete situational awareness:
  cash, open loops, licence clocks, shipments, KYC, FX, blind-spots — never stale, never recomputed
  from scratch, never lost across restarts/deploys/month-long horizons.
- **The estate can time-travel.** Bi-temporal facts + event-fold let the MD answer "show the cap
  table / licence portfolio / cash position *as we understood it* on any past date" — audit-
  defensible, regret-free.
- **Every belief is click-through-traceable.** PROV + OpenLineage + the audit hash-chain mean "why
  do you believe X?" returns the entity→activity→agent graph back to the immutable source event —
  the evidence-required rule made first-class and visual (INV-B/H lens).
- **Recall is of *anything*.** One hybrid router fuses vector + keyword + graph + temporal +
  event-log over the same source — any thread, datum, or decision is retrievable in seconds, time-
  aware and lineage-attached.
- **Retention is compliant by construction.** Archive-first; WORM/legal-hold for statutory records;
  erasure only by deliberate, gated, audit-logged crypto-shredding that tombstones data without
  mutating the append-only store — even erased data leaves a lineage skeleton.

This is **lossless total capture + total recall + complete observability**, exactly as INV-J
demands — and it is mostly **wiring already-built modules into one append-only, event-sourced
spine**, not inventing new science.

---

## Source ledger (all real, June-2026-current)

- **Outbox / CDC / event sourcing:** AWS Prescriptive Guidance; Conduktor (glossary + DB-Kafka);
  James Carr (2026-01); debugg.ai (CDC-first outbox+inbox); Decodable (WAL logical-decoding
  messages); abstractalgorithms (Saga/Outbox/CQRS/ES); Debezium (ES vs CDC); Cermati (practical CDC notes).
- **Durable execution:** Spheron (Temporal/Inngest/Restate 2026); Olmec (2026 shift); Effloow
  (Temporal for AI agents 2026); AppScale (Temporal + LangGraph checkpointing); tiarebalbi (DBOS vs
  Temporal 2026); Resonate (deterministic constraints). [$300M/$5B Series D Feb-2026.]
- **Agent memory:** mem0 (State of AI Agent Memory 2026 — LoCoMo/LongMemEval/BEAM numbers); IBM
  (AI Agent Memory); arXiv 2605.04897 (Storage Is Not Memory — retrieval-centered); arXiv
  2603.07670 (Memory for Autonomous LLM Agents).
- **Lineage/provenance:** OpenLineage (GitHub + LF AI&Data); datalakehousehub (OpenLineage spine
  2026-05); W3C PROV (ACM); Atlan (Data Lineage 2026); truescreen + OvalEdge (provenance vs lineage).
- **Bi-temporal KG:** Zep arXiv 2501.13956; Neo4j/Graphiti; CallSphere (Zep v2 + Graphiti 2026);
  contextgraph.tech (open context-graph tools 2026); emergentmind (Zep architecture); getzep/graphiti.
- **Situational awareness / world model:** Springer (Belief Connections for Situation Awareness);
  Medium (World Models: Next Leap); Medium (Blackboard pattern + MCPs).
- **Hybrid GraphRAG retrieval:** Calmops (Hybrid Search 2026 + GraphRAG hybrid); FalkorDB (hybrid
  search); AWS (vector+graph hybrid queries); arXiv 2507.03226 (Practical GraphRAG at scale).
- **Retention/WORM/GDPR:** oneuptime (Azure WORM 2026-02); DevSecOpsSchool (WORM 2026 guide);
  Grotabyte (WORM compliance); CertLibrary (Azure WORM); Archon (GDPR retention); RDS (Data
  Retention 2026).
