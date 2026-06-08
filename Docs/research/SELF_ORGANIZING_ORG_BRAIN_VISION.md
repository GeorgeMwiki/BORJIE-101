# The Self-Constructing Organizational Brain — Expanded Vision & Target Architecture

**Document:** `SELF_ORGANIZING_ORG_BRAIN_VISION.md`
**Date:** 2026-06-08
**Branch:** `integration/parity-final`
**Author:** synthesis pass over the 8 vision dossiers + `MASTER_GAP_REGISTER.md`
**Audience:** Borjie owner + brain/kernel/spine engineers; BossNyumba parity team.
**Status:** north-star architecture register — no code, no commit. The buildable
closure for every claim here is a row (or near-neighbour of a row) in
`MASTER_GAP_REGISTER.md`; this document is the *coherent whole* those rows compose into.

> **Sibling invariant (load-bearing, stated once, true everywhere below).**
> Borjie (AI-native **mining-estate** OS) and BossNyumba / "BN" (AI-native
> **real-estate** OS) are the **same brain, same capability layer, same wiring,
> same intelligence**. The *only* difference is the **domain layer** — a swappable
> **ontology pack** (entity/edge classes + SHACL shapes) plus the **deterministic
> domain engines** that populate metrics (mining: JORC/CRIRSCO, royalty, assay,
> offtake; real-estate: RICS/IVS, rent-roll, WALT, cap-rate). Every organ in this
> document is built **once**, domain-agnostic, in Borjie, and inherited by BN by
> pointing it at the other ontology pack. Wherever a sentence says "mining," read
> "or real-estate" — the machinery is identical.

---

## 0. Thesis — the system of record builds itself, governed

The 2026 frontier (SAP Joule / Autonomous Enterprise, OpenAI Frontier, Claude
Cowork, Microsoft Agent 365, Palantir AIP) has converged on **one consensus and
one concession**: agents are an *overlay* that *runs* software a human authored,
and *the system of record stays human-built* because "companies won't build
bespoke enterprise software — the engineering burden is too high"
(`vision-agentic-erp.md` §1). That concession is only true while a **human** is
the builder.

**Borjie/BN invert the consensus.** The brain — Mr. Mwikila — *authors and
continuously re-derives the system of record itself*: the data-model, the
surfaces, the org-graph, the task-routing, and the org-design loop are not
hand-drawn and frozen; they are **synthesized from the org's own reality,
proposed through one governed body-change rail, refined in chat, and reversible
by construction.** The cost of construction collapses toward the cost of
inference, so the overlay/SoR distinction collapses with it — and the incumbents'
claimed moats (they own the data + the workflow UX) evaporate, because the brain
authors both.

This is safe to ship for exactly one reason that no competitor has yet built
*first*: an **inviolable defense core** (the meta-rail, `inviolable.ts`,
policy-gate, RLS+`WITH CHECK`, hash-chained append-only audit, kill-switch
fail-closed, conformal abstention). The generative system-of-record is
**sandwiched between immutable invariants below** (money goes through
`LedgerService.post()`; licence/deletion stay dual-control HITL forever) **and the
meta-rail above** (every construction is a proposal). The offense (self-construction)
is safe *only because* of the defense; they are **one system, never separable**.

> **The one-line vision:** the org's data-model, screens, org-chart, routing, and
> its own *shape* are **generated and continuously reconciled by the brain** —
> reasoned-need-only, proposal-gated, chat-refinable, reversible, rail-protected —
> across two verticals from one machine.

---

## 1. The five pillars as ONE coherent architecture

The owner's vision decomposes into five capabilities. They are **not five
features** — they are **one pipeline** in which each pillar produces the substrate
the next reads, and a sixth, cross-cutting **body-change meta-rail** governs every
mutation any of them proposes. The data flows in a ring, and the ring closes:

```
                         ┌──────────────────────────────────────────────────┐
                         │   (6) BODY-CHANGE META-RAIL  — the one chokepoint │
                         │   every construction below is a PROPOSAL through  │
                         │   this rail: reasoned-need · approval-gated ·     │
                         │   chat-refinable · reversible · hash-chain audited│
                         └───────▲───────────────▲──────────────▲───────────┘
                                 │ proposes       │ proposes      │ proposes
   reality / evidence            │                │               │
   (corpus, uploads,   ┌─────────┴─────┐  ┌───────┴──────┐ ┌──────┴────────┐
    chat, event-outbox,│ (1) SCHEMA    │  │ (2) SURFACE  │ │ (4) SKILL/    │
    ledger, telemetry) │  SYNTHESIS    │─►│  GRAPH       │ │   CAPACITY    │
        │              │ induce types/ │  │  synthesis   │ │   ROUTING     │
        │              │ fields/edges  │  │ (role-lensed │ │ right node,   │
        ▼              │ as DATA       │  │  projections │ │ free-now,fair │
   ┌─────────────┐     └───────┬───────┘  │  of schema)  │ └──────┬────────┘
   │ (3) ORG      │            │          └──────┬───────┘        │
   │ KNOWLEDGE-   │◄───────────┘                 │                │
   │ GRAPH +      │  the schema, surfaces,       │                │
   │ DIGITAL TWIN │  people, assets, flows,      │ reads graph    │ reads graph
   │ (the model   │  ownership, skill = NODES;   │                │ skill/owner
   │  the brain   │  data-flow/skill/ownership   ▼                ▼ edges
   │  reasons over│  = EDGES; bi-temporal, ┌─────────────────────────────────┐
   │  — its       │  simulatable           │ (5) PROACTIVE ORG-DESIGN LOOP    │
   │  proprio-    │◄───────────────────────┤ sense→anticipate→simulate→       │
   │  ception)    │   redesign proposals    │ propose→act→verify→learn —      │
   └─────────────┘                          │ the twin proposes ORG redesigns │
          ▲                                 └──────────────┬──────────────────┘
          └────────────── re-derives the model ────────────┘  (loop closes)
```

**Read the ring as a sentence:** the brain **induces the data-model (1)** from
reality; that model is **projected into role-lensed surfaces and a navigable
surface-graph (2)**; the model + surfaces + people + assets + flows become **one
live, bi-temporal, simulatable org knowledge-graph and digital twin (3)**; the
graph's `skill`/`ownership`/`capacity` edges feed the **dispatch kernel that routes
the right node to each unit of work (4)**; and a standing **proactive org-design
loop (5)** watches the twin, notices structural gaps, simulates a fix, and
**proposes building the missing organ** — a new type, a new surface, a new edge, a
new sub-MD, a new workflow. **Every** proposal from **every** pillar passes through
**one body-change meta-rail (6)**, and an approved construction *re-derives the
model*, closing the ring. Nothing in the ring is fixed, hardcoded, or mock; every
edge of the ring is `proposal → approve/refine → reversible commit → audit`.

### Pillar 1 — Schema synthesis (the data-model the org *induces*)

The org's nouns/verbs/relations are **induced from evidence, not authored and
frozen**. The steady-state is the **EDC loop** (Extract → Define → Canonicalize,
`vision-dynamic-schema.md` §1.1): ingest evidence → schema-free extract entity/
relation/**event** triples (AutoSchemaKG pattern) → *Define* (LLM dedup vs the
existing catalog + vector similarity) → *Canonicalize* (align to an existing type
or **propose a new one**) → a KARMA-style consistency **auditor** (evidence-required
per CLAUDE.md) → **a body-change proposal** as a versioned **data contract** → owner/
auto approval → write catalog rows → optionally **pgroll-promote** a hot JSONB type
to a typed column/table → regenerate validators (OntoRipple ripple into SHACL +
JSON-Schema + check-triggers) → **bi-temporal invalidation** of superseded types
(Graphiti pattern: invalidate-with-timestamp, never delete).

The brain can therefore model **something the founder never anticipated** — a new
ancillary business, a novel licence class, a bespoke offtake instrument, a
family-office trust vehicle — because `core_entity.entity_type` is *not* a fixed
17-value enum but a **catalog the brain may extend by approved proposal**.

### Pillar 2 — Surface-graph synthesis (screens that are *projections* of the model)

A surface is **a role-lensed projection of a slice of the data-model**
(`vision-generative-surfaces.md` §3). The 2026 single-surface problem (pick +
parametrise components from a server-owned catalog, stream as a flat ID-referenced
list with state separated from structure — C1 / A2UI / AG-UI / AI-SDK-5) is
**already solved in-repo** (`packages/genui` = the A2UI-style trusted catalog and
security boundary; `packages/portal-genui` = the synthesis pipeline). The leap is
the **stratum above**: a **persisted, typed surface-GRAPH** —

- **Nodes = surfaces** (`hr_console | payroll_run | roster_board | maintenance_board
  | treasury_dashboard | …`), each `{ data_binding (named schema slice), role_lens,
  layout_spec (flat A2UI component list), provenance }`.
- **Edges = inter-surface relations, first-class data** (`drill_down`, `hand_off`,
  `derives_from`, `shares_context`) — **discovered** from foreign keys in the schema
  + task-routing in the org-graph, never hardcoded (the "entangler" idea).
- **Coherence under schema change via Cambria-style schema lenses, not
  regeneration:** persisted `layout_spec`s bind to a **read schema**; the live DB is
  the **write schema**; a migration registers a **lens** (`rename / add-default /
  wrap / hoist`). A column rename **migrates the binding on demand** instead of
  silently breaking a surface. A *truly destructive* change that can't be lensed is
  precisely the trigger for a **proposal** (re-bind / split / retire node) with a
  visual diff. **Coherence becomes proposal-gated by construction.**
- **The invariant that keeps a self-mutating UI usable** (Latent Navigation): *the
  surface may be dynamic; the promises must be stable.* At every node the user can
  answer **where am I, why am I here, how do I get out.** Stable anchors per surface
  kind; every adaptive reorder is **explainable** ("payroll moved up — pay-run due
  in 2 days") and **reversible**.

### Pillar 3 — Org knowledge-graph + digital twin (the model the brain reasons over)

The MD cannot *reason over* an org it cannot *read, simulate, and safely mutate*.
Pillars 1, 2, 4, 5 all *read* this graph; this pillar *is* it. One graph of record
(resolving the two parallel stacks): **nodes = entities + fields + surfaces + flows
+ people + assets**; **edges = data-flow + skill + ownership** (plus `mirrors` edges
to the BN twin). The **body self-model** (the brain's own 180+-node system-graph,
derived not from a static `BRAIN_MODULES` list) is **fused into the same graph**, so
the MD reasons over **org and self in one query plane** (proprioception). Every fact
is **bi-temporal + PROV-O** (Graphiti/Zep), so it is auditable and **never
overwrites** — enabling regulator-grade time-travel ("what did we believe about this
deposit's grade last quarter, and what was the org's shape the day we filed that
royalty return?"). A **process-mining pass** over `event_outbox` + `audit_events`
discovers the org's *actual* flows (BPMN-shaped) with cycle-time / error-rate /
four-eye-load metrics. And a **simulatable twin** (LLM-empowered agent-based
modeling + structural causal model) lets the MD run *what-if* before it acts —
"if I move royalty approval from the manager to a threshold-gated auto-flow, what
happens to cycle time, error rate, four-eye load?" — a **counterfactual, not a
correlation** (Siemens×NVIDIA "90% of issues caught before physical change," lifted
from the physical line to **org structure**).

### Pillar 4 — Skill / capacity / task-routing (right node, best-placed, free-now, fair)

When a unit of work appears — a haul cycle, a pit-wall inspection, a royalty filing,
a buyer-KYC review, a property viewing, a tenant maintenance ticket, a junior-agent
subtask — **one Dispatch Kernel** answers *who (human or agent), where-placed, free
now, fair across the estate*, and **self-heals in seconds** when reality breaks the
plan. It is the classical **assignment problem** wearing five 2026 hats:
skill-matching, capacity/availability, fairness, human↔agent handoff, online
disruption recovery. The reference shape (`vision-task-routing.md` §2):

1. **Eligibility filter (hard):** skills/certs/clearance, licence/jurisdiction
   validity, kill-switch/policy gates → candidate set. *(The one mining/RE fork
   lives here — which credentials, which jurisdiction rules.)*
2. **Cost/utility score (soft):** skill-fit × capacity-headroom × proximity/route ×
   SLA-slack × **fairness penalty** (Timefold squared-deviation) × cost.
3. **Solver tier by latency budget:** Hungarian (small optimal one-to-one) · **CP-SAT**
   (rich-constraint batch rosters) · **auction** (distributed/online fleets) · **MARL
   (QMIX-style)** (high-frequency physical dispatch — haul cycles, ms-latency).
4. **Confidence + handoff:** auto-assign above threshold; below it, surface *ranked*
   options (multi-signal, never a lone confidence number); log every escalation for
   the EU-AI-Act oversight trail (most obligations live 2 Aug 2026).
5. **Disruption listener (online):** no-show / breakdown / freeze / SLA-slip →
   incremental re-solve (set-partitioning + greedy warm-start) in seconds.
6. **Fairness ledger:** cumulative load per worker/agent across the cycle, so
   today's penalty sees yesterday's burden.

The same routing brain serves **humans and AI juniors** — capability vectors that
drift toward demonstrated competence (AgentNet), per-task self-abstention
(2603.28990: strong agents *decline* out of competence), and a hard **human/AI
boundary the agent can never cross** (money/licence/deletion stay HITL).

### Pillar 5 — The proactive org-design loop (the org redesigns *itself*)

A **standing loop** scores the *organizational* fitness of the estate — "which
decisions have no owning organ? which flows have no measurement? where is a sub-MD
overloaded? which junior consistently self-abstains (retire candidate)? which holon
keeps spawning sub-tasks (split candidate)? where do human↔AI handoffs leak?" — and,
when **reasoned need crosses a threshold**, **proposes structural change**: spawn an
ESG-disclosure cell, promote the metallurgy junior to own assay QA, route all offtake
disputes through a new settlement holon, re-route an SLA-bottlenecked manager, split
a flow, merge two surfaces. Each is a **reversible `bodyChange` proposal** the owner
approves/refines in chat; the org-chart **redraws**; every redraw is hash-chain
audited and one-click reversible. Two beyond-today amplifiers fold in here:

- **Predictive (not just reactive) org-design:** the twin **rolls the estate
  forward** ("if this licence is granted and we add a second pit, by Q3 I will need a
  metal-accounting junior, a closure-provisioning junior, and a third KYC reviewer")
  and **pre-drafts those organs under gate before the bottleneck arrives** — ProActor's
  "reference-ready window" applied to *organizational capacity itself*.
- **Simulate the reorg before you ship it:** every proposed redesign runs as a
  **branch of the twin** ("org git") on replayed `event_outbox` history → a **predicted
  delta sheet** (cycle-time, royalty-error rate, four-eye load, cost, EN/SW purity,
  calibration) + a **blast-radius** from the body-graph. Approve = merge; reject =
  discard the branch. The COO **proposes only reorgs that beat the current structure
  in simulation** — turning MoltBook's "negative baselines you must beat" into a
  literal pre-flight gate. (Ungoverned agent populations degenerate into hubs + dead
  weight; the COO's verb is *bend emergence toward useful, evidence-backed structure*.)

### Pillar 6 (cross-cutting) — the body-change meta-rail, the one governed syscall

The unifying primitive, and the largest structural innovation over the public
frontier: **collapse surface-construction, capability-construction, schema-
construction, and org-construction into ONE governed syscall.** Lovable-style
UI-gen, MOSS-style code-evolution, and OrgAgent-style org-arrangement are three
disjoint capabilities in three disjoint systems today; Borjie/BN route **every new
organ — screen, skill, sub-agent, table, field, edge, workflow — through the same
`bodyChange` event**, through the same `decideAutonomy → composeWithRail → meta-rail`
monotone controller. **Construction is a data patch, not a release:** surfaces /
flows / tool-defs / org-edges / schema rows live as inspectable, versioned,
RLS-governed, hash-chained **DATA**, so building a new organ is **reversible by
construction and provable by the meta-rail**. The UI/Modality Invariant
(`MASTER_GAP_REGISTER.md` §314) is the governing contract on this rail, restated
verbatim by the leading malleable-software research (Patchwork/Potluck: AI-generated
logic stays *visible, editable, reversible*):

1. **Infinite UI, not a catalog** — no fixed "forecast tab / media tab"; portal-genui
   synthesizes whatever the need calls for; forecast/media/document are *artifacts*
   that flow into a dynamically composed surface.
2. **Change only upon reasoned need** — a plain chat turn proposes no UI change; the
   AI evaluates (τ + evidence + goal) whether a change is warranted.
3. **User approval gates the mutation** — a proposal never self-applies (ambient
   notice + Open/Undo); auto-spawn *only* for a flow the user explicitly set to auto,
   always reversible.
4. **Chat-customizable** — the proposal is a starting point; the user refines in chat
   and genui re-synthesizes from the amended spec.

And the rail-protection that makes all the above shippable: **money / licence /
deletion stay dual-control HITL forever; the agent grows capability but can NEVER
touch its own gate/audit/test machinery** (`inviolable.ts`). **HIGH-risk policy
prefixes** (sovereign / kill_switch / four_eye / policy_rollout) hit literal policy
rules — no reason-resolver generalisation.

### Empirical-fitness gating — the self-pruning reflex (binds every pillar)

Construction without an empirical kill-switch is how an autonomous OS rots. **Every
self-built organ** (type, surface, skill, sub-MD, workflow) enters `draft → shadow →
canary → live` and is **kept only if it beats the incumbent on real outcomes**
(adoption, completion, error, approver-acceptance over 7/28/91-day windows), with
**burn-rate/NOI/SLO auto-rollback to the archived parent** (Darwin-Gödel empirical
fitness, applied not to benchmark scores but to *did this organ actually make the
estate run better*). The OS has a built-in reflex to **kill organs it built that
didn't earn their keep.**

---

## 2. The data substrate — runtime per-tenant schema on Postgres + pgvector + RLS

Runtime, per-tenant, brain-authored schema is **possible today on the existing
stack** — and ~70% of the substrate already ships in migration
`packages/database/src/migrations/0306_create_core_entity_family.sql`. A **four-plane
meta-schema, all stored AS DATA, all RLS-scoped, all evolving via the meta-rail**:

| Plane | Table (in-repo today) | Role | SOTA pattern |
|---|---|---|---|
| **Instance** | `core_entity` — `entity_type text NOT NULL`, `custom_fields jsonb DEFAULT '{}'`, **GIN `jsonb_path_ops`**, `vector(1536)`, PostGIS geog, tsvector, FORCE RLS on `app.current_tenant_id` | the long-tail polymorphic root | "JSONB + config-table" (the right default; ~10× faster writes than EAV) |
| **Type catalog** | `entity_type_definition` — declared types + `core_entity_type_check` trigger ("instances must reference a declared type") | induced entity/event types: canonical name, parent type, provenance `evidence_id`s, frequency/confidence, lifecycle (`proposed→approved→active→deprecated`), bi-temporal validity | AutoSchemaKG conceptualization layer |
| **Field catalog** | `tenant_schema_extensions` — `tenant_id IS NULL OR tenant_id = guc` carve-out (built-ins global, tenant fields isolated) | per-type fields: JSON-Schema type, constraints, PII-class, residency-class, storage-hint (`jsonb / promoted-column / promoted-table`) | schema-as-data catalog |
| **Relationship catalog** | *(to add)* typed edges between entity types (the org-graph ontology), bi-temporal, SHACL cardinality/domain/range | the graph schema | property-graph + SHACL |

**Storage choice is deliberate, not one-size:** JSONB+catalog is the **default for
synthesized attributes**; **EAV is the trap** (avoid — index thrash); a **per-tenant
Postgres namespace** or **promoted typed table** is the **graduation target** for a
type that earns it (high volume, needs joins/aggregation/typed constraints, GIN-on-
JSONB degrades past the >5s cliff). **EAV is never the answer.**

**Safe online evolution = pgroll** (the decisive primitive): zero-downtime,
**reversible** migrations via **multiple schema versions coexisting as views over the
same physical tables**, selected by `search_path`; expand/contract with trigger-synced
dual columns; **rollback is instant because the old version was never destroyed.**
This is "schema-as-data + safe online evolution" *already built* — exactly the
mechanism to **promote a JSONB type to a typed table without downtime and to undo it**.
It also makes **counterfactual schema simulation free**: replay historical evidence
against the *new* shape in a shadow namespace and report blast-radius ("this new
`tailings_facility` type would re-home 412 existing `core_entity` rows and break 3
SHACL shapes") **before** the owner approves — schema migration becomes previewable,
like a `git diff` of the data-model.

**Validators co-evolve, never drift:** a synthesized type ships **with** its
validators (SHACL shape on the graph side, JSON-Schema + check-triggers on the
relational side), and an ontology edit **ripples** declaratively into all of them
(OntoRipple) — closing the "doc-vs-reality" failure mode behind half the gap register.

**Governance = the data contract, never self-apply.** The schema never rewrites
itself silently; the induction loop emits a **signed, versioned data contract** into a
schema registry; every approval is **hash-chained into the AI audit chain**; "undo the
schema change" = check out the previous contract version and let pgroll reverse —
the **entire data-model as reversible as a code deploy**, which no mining or
real-estate OS ships today.

**What is missing is the loop and governance, not the storage** (the audit's precise
finding): there is *zero* induction code writing these catalogs from evidence
(MEM-06); the built-in catalog seeds **17 real-estate types** (`LAND_PARCEL`,
`BUILDING`, …) in a mining product (the data-plane twin of KI-10); bi-temporal +
PROV-O are built but unwired (MEM-07, facts would overwrite); and **no body-change
gate is on the data-model path** (EA-04). The closure is the EDC loop + a `miningOntology`
seed + bi-temporal wiring + routing catalog writes through the meta-rail + a pgroll
promotion lane.

---

## 3. SAME-BRAIN for Borjie (mining-deep) and BossNyumba (real-estate-deep)

The strategic core: **build the construction machinery once, ship two domains.**
Every pillar's engine is **domain-blind by construction** because it reads *whatever*
schema / ontology / org-graph it is pointed at:

| Shared organ (built once, domain-agnostic) | The ONLY thing that forks |
|---|---|
| EDC schema-induction engine | **seed ontology pack** + regulatory schema-guided constraints (mining JORC/Tumemadini/royalty vs RE RICS/IVS/land-tenure) |
| Surface-graph synthesiser + Cambria lens layer | the **data-model + ontology** it projects |
| Org knowledge-graph + bi-temporal/PROV-O fact model + process-mining + digital twin | the **ontology pack** + **deterministic domain engines** that populate metrics |
| Dispatch Kernel (eligibility → cost → solver-tier → handoff → disruption → fairness) | the **cost/eligibility function** (mining crew + ticket vs RE field team + viewing/maintenance) and the **role/department catalogue** |
| Proactive org-design loop (sense→simulate→propose→verify→learn) + COO | the **role-ontology pack** fed to capability-matching |
| Body-change meta-rail + `inviolable.ts` + Three-Ring Constitution + empirical-fitness gate | nothing — identical |

The org layer is a **kernel that ingests a role-ontology pack**: mining ships the
mining pack (metallurgy/assay/royalty/offtake holons); real-estate ships the property
pack (deal-sourcing/leasing/valuation/fund-ops). **Same brain, same self-organizing
machinery, different catalogue.** Cross-domain `mirrors` edges let an organ proven in
one estate be **proposed (never auto-applied)** into the sibling, the twin
**re-simulating it against the other domain's history** before surfacing — a
self-constructing OS that learns org-design *across verticals*, an asset no
single-domain competitor can build.

**An ironic parity dividend exists today:** Borjie's `entity_type_definition`
built-ins, its `org-graph` projector edges, and its KG ontology are **all still
real-estate** — *wrong for Borjie, but exactly the seed pack BN needs.* The residue
should be **lifted into a shared `realEstateOntology` pack for BN** and **replaced in
Borjie by a `miningOntology` pack** — physically proving the single-engine /
two-ontology-packs thesis. **BN is behind on the body layer** (EA-10: actuators but
*zero* system-graph / blackboard / mutation-authority), so the parity action is:
build the org-graph-twin + meta-rail to a **clean domain-agnostic seam** in Borjie,
then port the engine + ship the real-estate pack to BN.

---

## 4. The wow / unique end-to-end story — an org self-wiring on the fly

A real operator, a real Tuesday, the org constructing itself under the operator's thumb:

1. **08:00 — the estate has already done the thinking.** Overnight, the
   single-replica, leader-elected sleep-pass ran **sleep-time compute** (next-day
   questions are highly predictable from today's state — open bids, due royalties, FX
   exposure, licence windows, pending KYC), ran **counterfactual world-model rollouts**
   ("if FX moves 3%, if this assay comes back low, if the regulator publishes the
   expected amendment"), and **pre-staged gated proposals.** The owner's first coffee
   is **a sequence of approve/undo, not a backlog** — and only the proposals that
   cleared the **conformal value-of-information bar** surface (a silent estate that
   *earns the right to speak*, getting quieter and more precise the longer it runs).

2. **A new licence is granted (a noun the catalog never had).** The operator uploads
   the new licence PDF. The **EDC loop** extracts entities/events, finds no matching
   type, and **proposes a new `special_mining_licence` entity-type** with induced
   fields (renewal-window, royalty-rate, jurisdiction) — a **versioned data contract**,
   not a silent write. The operator taps **Approve**; the type, its SHACL shape, its
   JSON-Schema, and its check-trigger are born **in one ripple**; bi-temporal validity
   stamps it; the audit chain records it.

3. **The model re-derives, and a surface proposes itself.** The new type becomes a
   **node in the org knowledge-graph**, foreign-key edges to `deposit` and `royalty`
   are **discovered**, and the **surface-graph synthesiser** notices the operator has
   no place to *operate* this licence. It **proposes a `licence_console` surface** —
   a role-lensed projection of the new schema slice, with `drill_down` edges to the
   deposit surface and a `derives_from` edge to the royalty-run — as an **ambient
   notice (Open/Undo).** The operator opens it, says in chat *"put the renewal
   countdown at the top and add a four-eye approval band,"* and genui **re-synthesizes
   from the amended spec.** Nothing mutated without approval.

4. **The twin notices a structural gap and the COO proposes an organ.** The
   process-mining pass sees that **royalty filings for this new licence class have no
   owning organ** and that the existing compliance junior is over capacity. The
   **proactive org-design loop** rolls the estate forward, **simulates** spawning a
   dedicated royalty-reconciliation holon on **replayed history** ("org git" branch),
   and returns a **predicted delta sheet** (cycle-time −40%, four-eye load +1/week,
   cost +$X) that **beats the current structure in simulation.** It surfaces a single
   **reversible `bodyChange` proposal**: *"Create a royalty-reconciliation cell;
   re-route this licence's filings to it."* The operator approves; the **org-chart
   redraws**; the new sub-MD is compiled, sandbox-smoke-tested in an isolated-vm, and
   enters `shadow → canary → live` under **empirical-fitness gating.**

5. **Work routes to the right node, free-now, fair.** A royalty filing task appears.
   The **Dispatch Kernel** filters eligible nodes (the new holon is now skill-matched),
   scores by capacity-headroom × SLA-slack × fairness, and **auto-assigns** above
   threshold; a no-show on a parallel field inspection triggers an **incremental
   re-solve in seconds**, not a board redraw.

6. **Everything is reversible, provable, and bilingual.** Every step above is a row in
   the **hash-chained append-only audit**; the operator can **time-travel** ("show me
   the org's shape and data-model the day we filed the Q1 return"); any organ that
   doesn't earn its keep **auto-rolls back to its archived parent**; and the whole
   experience renders **strictly single-language** per the active locale (zero EN/SW
   mixing). **Money still hit `LedgerService.post()`; the licence approval still hit
   the policy-gate.** The org **wired itself on the fly — and the operator was in
   control of every mutation.**

This is the visible proof that Mr. Mwikila is **a self-constructing organizational
brain, not a chatbot with tools** — and the single flagship genUI surface is **the
living, reasoned, proposal-gated, reversible org-chart itself.**

---

## 5. Beyond-June-2026-SOTA angles the owner did *not* name

The dossiers surface a set of leaps past the frontier *and* past the owner's stated
vision. Consolidated, the ones the owner has not articulated:

- **B1 · The self-deriving ontology under active inference.** Don't author the
  data-model — *derive* it by walking the running system (routes, schemas, ledger,
  MCP discovery, event streams) into a live decision-centric ontology, then treat
  divergence between the derived model and ground truth as **prediction error
  reconciled on the sleep/consolidation cycle** (the ontology becomes a thing the
  brain *dreams against*, not a thing humans maintain). Palantir gives the
  decision-centric *shape*; self-derivation + Friston-style reconciliation is the
  leap they don't make.

- **B2 · The schema rewrites itself under a fitness function.** Put the meta-schema in
  the nightly loop: where a JSONB key is aggregated often enough that GIN-on-JSONB
  degrades, the brain **proposes its own pgroll promotion** to a typed column; where a
  type hasn't been instanced in N months, it **proposes deprecation.** The schema's
  shape becomes a **learned, measured artifact**, not a guess.

- **B3 · "Org git" — counterfactual org diff before commit.** Every redesign is a
  *branch* of the twin, simulated on replayed history, producing a predicted delta
  sheet + blast-radius; approve = merge, reject = discard. **Reversibility becomes
  literal: the org has version control with simulated diffs** — extending Siemens'
  "90%-of-issues-before-change" to *organizational* structure, which no org-design
  product does.

- **B4 · Bi-temporal org-memory = regulator-grade time-travel.** Because every type,
  field, edge, and fact is bi-temporal, the MD can **reconstruct exactly what the org
  knew and how it was shaped on any past date** — for a mining estate facing
  Tumemadini/TRA audits this is not a feature, it's a moat.

- **B5 · A calibrated "interruption budget" as a conformally-priced resource.** Treat
  the owner's *attention* as a scarce, conformally-priced asset: the MD surfaces a
  proactive proposal **only when calibrated value-of-information exceeds the measured
  annoyance cost for that specific owner**, and the threshold is **learned per-owner**
  from accept/dismiss/undo telemetry. A silent estate that earns the right to speak,
  with a **provable miscoverage bound on "should I have interrupted."** No competitor
  has wired calibration into the interruption decision.

- **B6 · Self-healing the *business* layer, not just infra.** Everyone self-heals
  Kubernetes; nobody self-heals a mining estate. Run the SRE detect→root-cause→
  remediate→**verify**→heal loop over the *estate's economic state* — a royalty filing
  trending late, a licence inside its renewal window, an offtake breaching an
  elasticity threshold, gold-room mass-balance out of tolerance — with **graduated
  autonomy** (a flow earns AUTO only after N clean closed-loop runs; one tripwire
  demotes it).

- **B7 · Compliance that rewrites its own checks when the law changes.** A standing
  regulator-feed sensor diffs today's regulation against the corpus; on a verified
  delta the MD **proposes an amendment to its own compliance rules** (a new check, a
  changed threshold), gated four-eye, and on approval the new check **goes live and is
  replayed against the existing estate** to surface positions that just became
  non-compliant. The *code that does the checking* is itself synthesized, gated,
  versioned, rollback-able — a closed regulatory loop no GRC vendor ships.

- **B8 · Predictive, simulation-driven org-design.** The MD doesn't just staff the org
  — it **predicts the org it will need next quarter and pre-builds it under gate**,
  spawning capability *before* the bottleneck arrives (the "reference-ready window"
  applied to organizational capacity).

- **B9 · Privacy-preserving estate benchmark — a true data network effect under DP.**
  A DP-gated cross-tenant benchmark lets a Tanzanian artisanal miner see "your
  recovery is 30th-percentile of comparable gold ops; your royalty-to-revenue is 1.4×
  the cohort median" **without any tenant ever seeing another's raw data.** Three
  compounding effects: a product moat that grows with every tenant; a de-identified
  pooled corpus that feeds the self-improvement loop (the brain gets better for
  everyone as the network grows); and the fuel for **Implicit Consortia** (pool demand
  across many small tenants to negotiate buyer terms no single artisanal miner could
  command). The one capability a single-tenant competitor **structurally cannot**
  replicate — safe *only* because of the DP budget + RLS + `WITH CHECK` corpus split.

- **B10 · Autonomous negotiation settled via signed mandates, audit-chain as the
  mandate ledger.** Map AP2's Intent→Cart→Payment mandate triad onto Borjie's existing
  hash-chained audit + policy-gate: the MD negotiates the offtake/procurement book
  inside owner-set **elasticity thresholds**, each negotiation producing three
  cryptographically-signed mandates that are rows in the append-only chain,
  four-eye-gated above threshold, settled through `LedgerService.post()`, defended by
  the already-built indirect-injection detector (AP2 is a published prompt-injection
  target).

- **B11 · The surface-graph and org-graph as *queryable body organs* (proprioception).**
  Expose `query_surface_graph()` / `surface_blast_radius(node)` / `query_body_schema()`
  / `body_blast_radius()` as brain tools, fused with a six-facet `SituationalSelfModel`
  read **first** on every consequential turn. The MD **reasons about its own UI and
  org graph before it proposes** ("which surfaces read `royalty_rate`? if I retire the
  legacy royalty surface, what breaks?"). The graph stops being a retrieval target and
  becomes the agent's **proprioception** — grounding and blast-radius computed from the
  real model, not a stale module list.

- **B12 · Durable, exactly-once organizational execution.** Stand the whole operating
  loop on durable execution (Temporal-class journal-replay + checkpointing) so a
  half-built organ, an interrupted royalty saga, or a multi-step compliance filing
  **resumes at step 48, not step 1** after any crash — and so a `bodyChange` is itself
  a durable, resumable, **compensatable** workflow. Self-construction inherits
  exactly-once + saga rollback **for free** — the missing reliability story in every
  self-evolving-agent paper.

**The frontier picture, named once:** every leap above is the **same loop** at a
different altitude — `ambient SENSE → ANTICIPATE (timing) → SIMULATE before act →
PROPOSE under gate → ACT inside thresholds → VERIFY & heal → LEARN overnight`. The
keystone the whole loop lands on is the **modality arbiter** (ANSWER / SKILL /
WORKFLOW / **LOOP** / AGENT) — the LOOP variant *is* ambient agency. And the invariant
that makes all of it shippable is unchanged: **the offense is safe only because of the
defense; they are one system; money/licence/deletion stay HITL forever; the agent can
grow capability but can never touch its own gate/audit/test machinery.**

---

## 6. Where we already lead, and the build spine

**We are not behind — on the load-bearing axis we are ahead.** Against the June-2026
frontier: SAP/Oracle/QAD operate on a *fixed* model; OpenAI Frontier / Claude Cowork /
Agent 365 are *overlays that concede the SoR stays human-built*; Palantir has the
right *decision-centric ontology* but *human-curated at build-time*; the self-
organizing / self-evolving results are *episodic and lab-bound*. **Borjie/BN's
`MD-as-body` thesis is the only design that attempts all five capabilities** — and the
**meta-rail + derived-body-schema + monotone-rail discipline is ahead of the public
frontier.** The substrate for all five pillars is **built to frontier quality in
package source**; the gap is almost always **wiring**, not absence.

**The one keystone that unblocks pillars 1, 2, 4, 5 simultaneously:** the body-change
meta-rail is **wired-but-inert** — the modality-arbiter already reaches
`bodyChangePort.authorizeBodyChange(...)`, but the port is a **fail-closed deny-stub**
(`buildBodyChangePort()` always denies), so every capability-growth path falls back to
`chat`. **Binding the real `@borjie/mutation-authority.authorizeBodyChange` at that
seam** (a `composition/body-change-wiring.ts`) is the single highest-leverage change:
it lets surface-graph commits, schema proposals, and skill registration **actually
persist — under approval, reversibly.**

**The build spine** (the frontier-closing work that makes Borjie/BN *demonstrably*
beyond every 2026 competitor), in priority order:

1. **Bind the body-change meta-rail** (replace the deny-stub) — *the keystone; unblocks
   1, 2, 4, 5.* `EA-04 / AUT-01`.
2. **Self-deriving ontology + reconciliation loop** — schedule `deriveSystemGraph` as
   cron + `listChanged`; derive the system-graph from routes/schemas/MCP-discovery;
   reconcile drift as prediction-error on the sleep cycle. *Flips us from "agent on a
   fixed model" to "brain that authors its own model."* `EA-01`.
3. **EDC schema-induction loop + mining seed ontology** — write `entity_type_definition`
   / `tenant_schema_extensions` rows as **proposals**; wire bi-temporal + PROV-O;
   pgroll promotion lane. `MEM-06 / KI-10 / MEM-07`.
4. **Surface-graph layer + Cambria lenses** — persisted node/edge model + graph
   synthesiser between portal-genui and mutation-authority + lens coherence. `EA-09 +
   vision-generative-surfaces §3`.
5. **Org-graph of record + digital twin** — one graph stack; re-domain the projector to
   mining; process-mine `event_outbox`; add the causal/ABM sim layer. `KI-10/11 / RSS-17`.
6. **Dispatch Kernel** — Hungarian/CP-SAT/auction/MARL tiers + fairness ledger +
   disruption listener over the org-graph skill/ownership/capacity edges.
   `skill-capacity-task-routing` lane.
7. **Proactive org-design loop on durable execution, bounded by the meta-rail** — bind
   `self-extension` into a scheduled worker; Dockerfiles + k8s for the evolution
   workers; twin-proposes-redesign through the rail; empirical-fitness `draft→shadow→
   canary→live` with auto-rollback. `AUT-02 / AUT-12 / EA-12`.

**The moat:** while OpenAI/Anthropic/SAP race to own the *overlay* on top of
human-built systems of record, Borjie/BN — **deliberately, and governed** — make the
system of record itself the brain's **self-constructed, self-reconciled, self-pruned
body, replicated across two verticals from one machine.** That is the frontier past
the frontier.

---

## 7. Source ledger (the 8 dossiers + the register this synthesizes)

- `Docs/research/vision-agentic-erp.md` — agentic-ERP / self-constructing OS frontier.
- `Docs/research/vision-dynamic-schema.md` — dynamic schema & ontology synthesis.
- `Docs/research/vision-generative-surfaces.md` — generative-UI surface-graph synthesis.
- `Docs/research/vision-agent-orgs.md` — self-organizing agent orgs / autonomous COO.
- `Docs/research/vision-task-routing.md` — skill/capacity/task-routing (Dispatch Kernel).
- `Docs/research/vision-org-graph-twin.md` — org knowledge-graph & digital twin.
- `Docs/research/vision-proactive-frontier.md` — proactive / ambient agency, beyond-2026.
- `Docs/research/vision-code-audit.md` — where Borjie can / cannot self-construct today.
- `Docs/research/MASTER_GAP_REGISTER.md` — 132 consolidated gaps + the UI/Modality
  Invariant (§314) that binds every wiring pass.
