# Vision dossier — Org Knowledge-Graph & Digital Twin

**Lane:** `org-knowledge-graph-and-digital-twin`
**Date:** 2026-06-08
**Branch:** `integration/parity-final`
**Author:** vision-research subagent (deep current-web survey, June 2026)
**Scope:** the org as a LIVE knowledge graph the brain reasons over — entities,
fields, surfaces, flows, people, assets as **nodes**; data-flow, skill, and
ownership as **edges** — plus a **digital twin** of the mining operation that the
MD can query, simulate, and use to propose org redesigns. This is the
substrate beneath the self-constructing organizational brain: the MD cannot
*reason over* the org it is meant to run unless the org *exists as a graph it
can read, simulate, and safely mutate*.

> Sibling note (Borjie ↔ BossNyumba): the graph/twin substrate is **domain-agnostic**.
> Borjie populates it with a mining ontology (licence/deposit/assay/royalty/shipment/
> buyer/jurisdiction); BossNyumba populates it with a real-estate ontology
> (asset/lease/tenant/valuation/fund/works-order). Same engine, same twin verbs,
> same redesign loop — only the ontology pack and the deterministic domain engines
> differ. Build the substrate once; ship two ontology packs.

---

## 1. Why this lane is the spine of the self-constructing brain

The owner vision is an MD that **synthesizes the org data-model, surfaces,
org-graph, task-routing, and a proactive org-design loop dynamically** — nothing
hardcoded — and creates anything missing through a `bodyChange` meta-rail under
user approval. Every one of those verbs presupposes a single artifact: a
machine-readable, queryable, simulatable model of the organization itself.

Today Borjie has the *pieces* but not the *live model*. From the
`MASTER_GAP_REGISTER`:

- **EA-01 [CONFIRMED]** — the body self-model is never derived; the live brain
  reads a static `BRAIN_MODULES` list (27 entries) instead of the real 180+ node
  system-graph. `deriveSystemGraph` exists but is never invoked.
- **KI-10** — the live knowledge graph is wired with the **real-estate ontology**
  in a mining product; no `miningOntology` exists yet.
- **KI-graphrag / KI-11** — two parallel graph stacks (`knowledge-graph` wired,
  `graph-rag-router` orphan); no single graph of record.
- **MEM-06 / MEM-07** — KG ingest is heuristic substring `mentions` with no LLM
  entity/relation extraction; bi-temporal + PROV-O modules are built but unused,
  so facts overwrite instead of invalidating-with-timestamp.

So the lane's job is precise: **(a)** make the org a real, typed, temporal graph
(not a doc-RAG index, not a static module list); **(b)** make that graph
*simulatable* — a digital twin the MD can run what-if scenarios against before it
acts; **(c)** close the loop so the twin *proposes* org redesigns that flow
through the `bodyChange` meta-rail (reasoned-need-only, proposal-gated,
chat-refinable, reversible — the UI/Modality Invariant, applied to the org
structure itself).

The state of the art in June 2026 has converged on exactly this stack. Below is
the survey, then per-finding "beyond-today" leaps.

---

## 2. SOTA survey (real, current, June-2026)

### 2.1 The ontology IS the digital twin (Palantir Foundry / AIP)

Palantir's Foundry/AIP is the clearest production proof of the owner's thesis.
Their **Ontology** is explicitly "the digital twin of your organization's
reality" — you work with real-world entities ("Employee," "Aircraft," "Purchase
Order," "Field Service Ticket") and the relationships and business logic that
govern them, not tables and columns
([Palantir docs](https://www.palantir.com/docs/foundry/ontology/overview),
[The AI Architects](https://theaiarchitects.substack.com/p/palantirs-digital-twin-building-the)).
Two layers matter directly for Borjie's `bodyChange` design:

- **Semantic layer** — objects, properties, links (the *nouns*).
- **Kinetic layer** — actions, functions, dynamic security (the *verbs*). "The
  twin is not a mirror. It is a control panel" — changes in Foundry **push back**
  into downstream systems (ERP states, work orders, supply plans). AIP agents
  "watch the twin for anomalies and propose corrective actions" and are
  "grounded in the ontology and data of the twin, so they are not hallucinating
  in a vacuum"
  ([zerofuturetech](https://zerofuturetech.substack.com/p/palantir-ontology-explained-why-its)).

This is the single most important architectural confirmation: an ontology with
*both* semantic and kinetic elements, with agents grounded in it and a write-back
path, is the operating system. Borjie's `system-graph` + `mutation-authority`
(`authorizeBodyChange`) + blackboard is the same shape — it just isn't wired
(EA-01/EA-04). Foundry validates the target; the gap register validates the work.

### 2.2 GraphRAG is the 2026 enterprise default for reasoning over the business

GraphRAG (knowledge graph + vector DB) is now the production standard for
reliable enterprise AI: vector for semantic recall, graph for *structural
reasoning* across multi-system relationships. Organizations report a **68%
reduction in multi-hop reasoning failures** vs pure-vector pipelines, and the
market is projected at **$9.88B by 2032 (31.6% CAGR)**
([NStarX](https://nstarxinc.com/blog/the-next-frontier-of-rag-how-enterprise-knowledge-systems-will-evolve-2026-2030/),
[Datahub Analytics](https://datahubanalytics.com/graphrag-the-next-phase-of-enterprise-knowledge-retrieval/),
[GraphRAG 2026 buyer's guide](https://medium.com/@tongbing00/graphrag-in-2026-a-practical-buyers-guide-to-knowledge-graph-augmented-rag-43e5e72d522d)).
The recurring lesson: GraphRAG value concentrates where questions are
relationship-heavy and span multiple systems — *exactly* the org-graph case
(how a licence connects to a deposit, an offtake contract, a royalty schedule, a
buyer's KYC, and a shipment). And it works only when the org has invested in
clean entity definitions and ontology — "the better the underlying business
meaning, the better the retrieval."

### 2.3 Autonomous KG construction — no hand-built ontology required (AutoSchemaKG)

The hardest objection to "synthesize the org data-model dynamically" is: who
writes the ontology? **AutoSchemaKG** (HKUST, arXiv:2505.23628) answers it:
fully autonomous KG construction that **simultaneously extracts triples and
induces the schema** from text, modeling entities *and events* — no predefined
ontology. At web scale it built **ATLAS** (900M+ nodes, 5.9B edges over 50M
docs) and its induced schemas hit **92% semantic alignment with human-crafted
schemas, zero manual intervention**
([arXiv](https://arxiv.org/abs/2505.23628),
[Emergent Mind](https://www.emergentmind.com/topics/autoschemakg)).
This is the mechanism that closes MEM-06: the corpus + estate data can *grow its
own ontology*, with a human-gated seed (KI-10's `miningOntology`) as the
anchoring backbone rather than the whole hand-built model.

### 2.4 Temporal knowledge graphs are the memory substrate (Graphiti / Zep, Cognee)

Static GraphRAG "doesn't inherently handle temporal aspects of data." **Graphiti/
Zep** (arXiv:2501.13956) is the production answer: a real-time, **bi-temporal**
graph where every fact carries `valid_from` / `valid_to` (superseded) /
`invalid_at` (explicitly contradicted) — it tracks *when an event occurred* and
*when it was ingested*. On LoCoMo it reaches **94.7% accuracy at 155ms retrieval**
([Neo4j/Graphiti](https://neo4j.com/blog/developer/graphiti-knowledge-graph-memory/),
[Zep paper](https://arxiv.org/abs/2501.13956),
[getzep/graphiti](https://github.com/getzep/graphiti)).
**Cognee** complements it: ingest heterogeneous sources (PDF, Slack, images,
audio) into a queryable graph
([Zep vs Cognee](https://vectorize.io/articles/zep-vs-cognee)).
This is precisely the design Borjie's `temporal/bi-temporal.ts` + `provenance/
prov-o.ts` foreshadow but never wire (MEM-07). The org graph must be bi-temporal
or it cannot answer "what did we believe about this deposit's grade *last
quarter*, and what changed?" — the core of an auditable mining estate.

### 2.5 Digital twins of operations — virtual-test-before-real (Siemens × NVIDIA)

At CES/GTC 2026 the operational-twin pattern hardened into product. Siemens +
NVIDIA target **autonomous digital twins** delivering real-time engineering and
optimization; PepsiCo's Siemens Digital Twin Composer + Omniverse twin lets AI
agents "simulate, test, and refine system changes, identifying **up to 90% of
potential issues before any physical modification**"
([Siemens](https://www.siemens.com/en-us/company/artificial-intelligence/siemens-nvidia-partnership/),
[Interesting Engineering](https://interestingengineering.com/ai-robotics/siemens-nvidia-industrial-ai-operating-system),
[NVIDIA Mega blueprint](https://blogs.nvidia.com/blog/mega-omniverse-blueprint/)).
Borjie's twin is *organizational/economic*, not 3D-physical — but the invariant
is identical: **the agent simulates the change against the twin before it touches
reality.** This is the missing `preCommit` simulate-before-act gate (RSS-17 in
the register) expressed at org-structure scale.

### 2.6 Process mining → agentic process synthesis (Celonis 2026)

The "proactive org-design loop" has a direct industrial analog. Process mining
discovers *how processes actually run* from event logs (the "what should we
automate"); agentic AI executes (the "how"). In 2026 Celonis shipped an
**Orchestration Engine** (GA) that coordinates AI agents + people + systems
end-to-end, and **the first MCP server for process intelligence** to feed agents
live operational context
([Celonis](https://www.processexcellencenetwork.com/process-mining/news/celonis-announces-new-platform-innovations-to-power-ai-driven-composable-enterprises),
[Kognitos](https://www.kognitos.com/blog/process-mining-vs-agentic-ai-2026-guide/),
[AIMultiple trends](https://research.aimultiple.com/process-mining-trends/)).
The headline stat for the whole thesis: **89% of businesses believe AI delivers
ROI only if it has the context of how the business runs.** That context *is* the
org graph. Borjie's gap: there is no process-mining layer over `event_outbox` /
`audit_events` that discovers the org's *actual* flows — yet that exact log
already exists and is the raw material for both the twin and the redesign loop.

### 2.7 Ontology-driven apps & the "semantic OS" (W3C stack, BPMN synthesis)

The standards substrate is mature and 2026-relevant: RDF 1.1 / SPARQL 1.1 / OWL 2
/ SHACL are stable W3C Recommendations, and the emerging framing is **"ontology
engineering as the semantic operating system of the AI-first enterprise"**
([Agarwaal, Apr 2026](https://gauravagg2016.medium.com/ontology-engineering-as-the-semantic-operating-system-of-the-ai-first-enterprise-e8db15bc0957),
[Chapeaux RDF/SPARQL/SHACL](https://chapeaux.github.io/blog/2026-04-05-sparql.html)).
Crucial design guidance: **OWL = open-world inference; SHACL = closed-world
*constraint/validation*** — you "introduce SHACL shapes alongside every class
from day one" so the graph is governed without exposing OWL syntax to users
([TopQuadrant](https://www.topquadrant.com/resources/why-i-use-shacl-for-defining-ontology-models/),
[Semantic Arts](https://www.semanticarts.com/shacl-and-owl/)).
For process synthesis specifically: BPMN 2.0 (OMG) is the de-facto flow notation,
and 2025–26 work shows LLM + ontology pipelines that **generate BPMN from text/
logs** via RML semantic-lifting (JSON→RDF/OWL) → ontology alignment → BPMN via
the Camunda Model API, preserving semantic traceability
([arXiv:2511.13661](https://arxiv.org/pdf/2511.13661),
[arXiv:2412.00023 — LLMs on BPM + self-improvement](https://arxiv.org/pdf/2412.00023)).
This is the formal grammar for "synthesize task-routing dynamically."

### 2.8 Causal & simulatable org twins (LLM-empowered agent-based modeling)

The leading edge — and the bridge to "propose redesigns" — is **LLM-empowered
agent-based modeling (ABM)** and **structural causal models embedded in LLM
agents**. Researchers embed structural causal models into LLM agents to do
"automated theory-building and simulation-based testing of social mechanisms,"
and "Social Digital Twinner" explores "plausible effects of what-if scenarios in
complex adaptive social systems"
([Emergent Mind — LLM ABM](https://www.emergentmind.com/topics/large-language-models-empowered-agent-based-modeling),
[Social Digital Twinning, arXiv:2505.10681](https://arxiv.org/pdf/2505.10681),
[LLM × DT survey, arXiv:2503.02167](https://arxiv.org/pdf/2503.02167),
[LLM-MAS for DT parametrization, arXiv:2405.18092](https://arxiv.org/pdf/2405.18092)).
A causal org model is what lets the MD answer *"if I move royalty approval from
the manager to an auto-flow with a TZS threshold, what happens to cycle time,
error rate, and four-eye load?"* — a counterfactual, not a correlation.

---

## 3. The synthesis — what Borjie's org-graph-and-twin should BE

Layered, each layer mapping to a register lane so this is buildable, not abstract:

1. **Org graph of record (typed, temporal, governed).** One graph stack
   (resolve KI-11/KI-graphrag). Nodes = entities + **fields + surfaces + flows +
   people + assets**; edges = **data-flow + skill + ownership** (plus
   `mirrors` edges to the BN twin). Seed a hand-authored `miningOntology`
   backbone (KI-10) as the SHACL-governed schema; let AutoSchemaKG-style
   induction *grow* it from corpus + estate data (MEM-06). Bi-temporal +
   PROV-O on every fact (MEM-07) so it is auditable and never overwrites.
2. **Body self-model fused in (EA-01/EA-02).** `deriveSystemGraph` runs as a
   cron + `listChanged` trigger and persists the *real* 180+-node system graph;
   `query_body_schema` / `body_blast_radius` become live brain tools. The org
   graph and the body graph are **one graph** — the MD reasons over org *and*
   self in the same query plane.
3. **Process layer mined from logs.** A process-mining pass over `event_outbox`
   + `audit_events` discovers the org's *actual* flows (BPMN-shaped), attaches
   them as `flow` nodes with cycle-time / error-rate / four-eye-load metrics —
   the raw material for both the twin and redesign.
4. **The digital twin (simulatable).** A causal/agent-based simulation layer over
   the graph: given a proposed change, run what-if (LLM-ABM + structural causal
   model) and return predicted deltas *before* acting. This **is** the missing
   `preCommit` simulate-before-act gate (RSS-17), scoped to org structure.
5. **The redesign loop (proposal-gated, reversible).** The twin doesn't just
   answer queries — it **proposes** org redesigns (new flow, re-routed approval,
   new sub-MD, merged surfaces) when it detects a recurring gap (ties to AUT-02
   self-extension, EA-12 reversible body-change). Every proposal flows through
   the `bodyChange` meta-rail: reasoned-need-only, surfaced as a proposal
   (ambient notice + Open/Undo), chat-refinable, reversible — the **UI/Modality
   Invariant applied to org structure**, never just to a tab.

The keystone insight from the survey: **steps 4–5 are what no competitor ships
for the SME/mining segment.** Foundry has the twin-as-control-panel but redesign
is human-driven consulting; Celonis mines processes but a human approves changes;
Siemens simulates the physical line. *A twin that autonomously proposes
org-structure redesigns, gated by approval and reversible, is open white space.*

---

## 4. Beyond-today leaps (per finding — not yet articulated by the owner)

- **B-1 · The twin proposes org redesigns, not just corrective actions.** Foundry/
  Celonis stop at "propose a corrective action *inside* the existing process."
  Borjie's leap: the twin proposes **changes to the org graph itself** — split a
  flow, promote a sub-MD, merge two surfaces, move an approval from manager to a
  threshold-gated auto-flow — each as a reversible `bodyChange` proposal. The MD
  redesigns the *company shape*, not just runs the current one.
- **B-2 · Counterfactual org diff before commit ("org git").** Every proposed
  redesign is run as a *branch* of the twin: simulate it (LLM-ABM + causal model)
  on replayed `event_outbox` history, produce a **predicted delta sheet**
  (cycle-time, royalty-error rate, four-eye load, TZS cost, EN/SW purity,
  calibration) and a **blast-radius** from the body graph. Approve = merge;
  reject = discard the branch. Reversibility becomes literal: the org has version
  control with simulated diffs. (Extends RSS-17 + EA-12 + the Siemens
  "90%-of-issues-before-physical-change" pattern to org structure.)
- **B-3 · Self-inducing ontology with a human-gated backbone.** Don't choose
  between hand-built `miningOntology` (KI-10) and autonomous induction (MEM-06/
  AutoSchemaKG) — **do both**: a SHACL-governed seed backbone the agent may never
  silently mutate (it is part of the meta-rail), plus an induction lane that
  *proposes* schema extensions through `bodyChange` when it sees recurring
  un-modeled entities (e.g. a new mineral class, a new buyer type). The ontology
  grows by approved proposal, never by drift.
- **B-4 · Bi-temporal "org memory" answers regulator/audit time-travel.** Because
  every fact is bi-temporal (Graphiti/Zep pattern), the MD can answer "reconstruct
  exactly what we knew, and what the org structure was, on the day we filed that
  royalty return" — a *provably* point-in-time view. For a mining estate facing
  Tumemadini/TRA audits this is not a feature, it is a moat. (Operationalizes
  MEM-07's dormant PROV-O.)
- **B-5 · Process mining as a continuous blind-spot sensor feeding the curriculum.**
  The mined-flow metrics aren't just a dashboard — the *largest negative deltas*
  (slowest flow, highest-error approval) become the autotelic curriculum for the
  nightly self-improvement loop (ties AUT-06/AUT-11). The twin tells the brain
  *what to get better at next* from the org's own friction.
- **B-6 · One graph, two estates — cross-domain transfer via `mirrors` edges.**
  Because Borjie (mining) and BossNyumba (real-estate) share the substrate, a flow
  redesign proven on one estate can be *proposed* on the mirror estate
  (`mirrors` edge), with the twin re-simulating it against the *other* domain's
  history before surfacing. Org-design learnings transfer across domains — an
  asset no single-domain competitor can build.
- **B-7 · The org graph is the agent's first read every turn (situational
  self-state).** Fuse this lane with COG-15's `SituationalSelfModel`: the MD reads
  the live org+body graph *first* on every consequential turn — what exists, who
  owns it, what flows touch it, what the twin predicts — so grounding and
  blast-radius are computed from the real model, not a stale module list. The
  graph stops being a retrieval target and becomes the agent's *proprioception*.

---

## 5. Borjie ↔ BossNyumba parity implication

The graph/twin engine, the bi-temporal + PROV-O fact model, the process-mining
pass, the simulate-before-redesign loop, and the `bodyChange`-gated proposal rail
are **100% shared substrate** — built once, in `packages/knowledge-graph` (+ a new
`org-twin` package), and consumed identically by both products. The **only**
domain difference is the **ontology pack** (mining vs real-estate entity/edge
classes + SHACL shapes) and the **deterministic domain engines** that populate
metrics (CRIRSCO/JORC, royalty, assay for Borjie; RICS/IVS, rent-roll, WALT for
BN). EA-10 already flags that BN has actuators but *zero* body-model layer — so
the parity action is: **build the org-graph-and-twin substrate in Borjie to a
clean, domain-agnostic seam, then port the engine to BN and ship a real-estate
ontology pack.** Two ontology packs, one self-redesigning organizational brain.
