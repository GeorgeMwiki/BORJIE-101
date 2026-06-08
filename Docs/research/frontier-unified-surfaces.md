# Frontier Dossier — Intelligent Unified Surfaces

**Lane:** `intelligent-unified-surfaces`
**Date:** 2026-06-08
**Author:** frontier-research subagent (workflow: SOTA-survey → beyond-today leap → our-gaps)
**Bar:** SOTA, best-in-the-world, PhD/MIT-level. No code, no commit — one dossier.
**Invariants honored:** INV-A (admin-web=control plane, never tenant business data), INV-B (surfaces are SEMANTIC LENSES over the org-graph, auto-categorized, roll-up/drill-down, auto-expand/contract), INV-C (infinite self-extending nervous system; money/licence/deletion stay HITL).

---

## 0. The one-sentence thesis

> A Borjie surface is not a screen. It is a **semantic lens** — a single, governed definition (a metric + dimension model authored over the org-graph) that the brain **re-derives** as reality changes, that **rolls up** to whole-estate visibility and **drills down** to one operation from the *same* definition, and whose sub-views **auto-expand and auto-contract** as the estate grows from 5 to 10 operations — with **zero hand-authored screens** for the new operations.

The 2026 industry has converged on every ingredient of this independently — semantic layers (the "single definition"), headless BI (the "one definition, many consumers"), agentic BI (the "view generated per intent"), KG-OLAP (the "roll-up/drill-down over a graph, not a star schema"), context graphs (the "graph the agent reads AND writes decision traces back into"), generative UI / A2UI (the "intent → rendered view"), self-organizing taxonomies (the "re-derive the categorization"), and malleable software (the "end-user composes the lens"). **No shipping product has assembled all eight into one self-re-categorizing lens.** That assembled lens is Borjie's leap.

---

## 1. The eight SOTA pillars (June 2026), each mapped to a verb in INV-B

### Pillar 1 — Semantic layer = "the single definition" (define once, trust everywhere)

The 2026 consensus: a **semantic layer** is the authoritative, vendor-neutral definition of metrics + dimensions + hierarchies, so a metric like "royalty exposure" or "recovery %" is computed *one* way regardless of who (human or agent) asks. The decisive 2025→2026 standardization event is the **Open Semantic Interchange (OSI)** — dbt Labs, Snowflake, Salesforce collaborating on a vendor-neutral YAML for metric definitions so "define once, every tool consumes." Carrefour migrated **3,000 KPIs** to a universal semantic layer; Blue Yonder rebuilt analytics around semantic governance. dbt's **MetricFlow** is the most-adopted vendor-neutral implementation (one definition, four APIs: SQL/REST/GraphQL/MDX).

- **INV-B mapping:** the **definition** that the lens *is*. The hierarchy in the semantic layer ("company → region → operation → product") is literally the roll-up/drill-down spine.
- **Hard number:** text-to-SQL accuracy climbs from **~40% (raw SQL on undecorated tables) to 83–95% when backed by a semantic layer** — the single largest reliability lever for any LLM that authors a view.

### Pillar 2 — Headless BI = "one definition, many consumers" (the lens has no fixed face)

**Cube** and the **dbt Semantic Layer** are the canonical headless engines: the metric definition is decoupled from any single dashboard tool, exposed via SQL/REST/GraphQL/MDX so a mobile app, a chat surface, Excel, *and* an LLM agent all read the same governed numbers. VentureBeat's 2026 analysis frames **headless vs. native** as "the architectural key to unlocking 90%+ text-to-SQL accuracy." Critically, the LLM **does not write SQL** — it calls the semantic layer's interface (`list_metrics()`, `get_dimension_values()`), shifting from "SQL writer" → "**semantic query writer**," which is what collapses hallucinated metrics. **dbt and Cube ship MCP servers** so agents (e.g. Claude) query metrics with full business context.

- **INV-B mapping:** headless = the lens is **faceless by design** — the *same* definition renders as an owner-web roll-up card, a workforce-mobile drill-down, or a chat answer. This is exactly Borjie's "one surface, many surfaces" requirement.

### Pillar 3 — Agentic BI = "intent → view, generated per question, not pre-built"

The 2026 category shift: **agents replace dashboards**. Knowi ships **15 specialized agents** (Query, Dashboard, Widget, AI-Dashboard-Generation, Recommendations…) that build a view *fresh per request* rather than serve a cached static screen. GoodData's reference architecture is a **5-step loop: sense → analyze → explain → recommend → act**, a *closed* feedback loop, with five named layers (Data / Agent-Orchestration / LLM / Semantic / Action). The defining property: **the same underlying retrieval answers both the aggregate question ("which assay defects recur across all mines?") and the single-entity question ("show me *this* mine's defect trend")** — one definition, two granularities, generated on the fly.

- **INV-B mapping:** this is **intent → view** + **roll-up AND drill-down from one definition**, the two hardest INV-B verbs, already shipping (Knowi, GoodData, Cube-backed chat-BI).

### Pillar 4 — KG-OLAP = "roll-up/drill-down over a *graph*, not a star schema"

The academic frontier that matters most for Borjie, because the org-graph is a **graph**, not a warehouse cube. **Knowledge-Graph OLAP** (IOS Press *Semantic Web* journal; **Graph Cube**, Zhao et al.; **CubeNet** network roll-up) decomposes the classical OLAP operators *onto a graph*:

- **Roll-up = MERGE + ABSTRACTION.** *Merge* selects knowledge from different contexts (union/intersection of sub-cells); *abstraction* replaces entities with more general entities — in three precise variants: **triple-generating** (redirect relationships to an abstract node), **individual-generating** (create a group node, e.g. "all gold operations in Geita"), and **value-generating** (compute averages/sums, e.g. mean recovery %).
- **Slice/dice** selects a subcube by restricting dimensional coordinates while **preserving knowledge-propagation paths** (coverage relationships).
- **Contextual hierarchy:** a two-layer structure where **knowledge from general contexts propagates DOWN to specific contexts** (the estate-wide schema/vocabulary is inherited by each operation) and **merges UP** along the hierarchy. **Graph Cube** generalizes the data cube to multidimensional networks; **CubeNet** merges nodes/edges into super-nodes/super-edges for faceted network drill-down.

- **INV-B mapping:** this is the *exact mathematical machinery* for "rolls UP to whole-estate and DRILLS DOWN to one operation from the same definition." The merge/abstraction/coverage triple is the formal spec Borjie should implement over `core_entity` + `org-graph`.
- **2026 reality check:** OLAP *cubes* are no longer the default storage (columnar engines — ClickHouse/Snowflake/BigQuery — compute aggregates on demand); but the **operators** (roll-up/drill-down/slice/dice/pivot) are the durable abstraction, now computed on-demand and, in the KG case, **over the graph**.

### Pillar 5 — Context graphs = "the graph the agent reads AND writes decisions back into" (the 2026 Gartner keyword)

Gartner's headline 2026 concept: **context graphs** *augment* knowledge graphs for agentic AI. KG = the **semantic layer** (entities, ontology, relationships); **context graph = the procedural layer** (decision logic, workflows, event traces — what triggered a decision, what context informed it, what rule governed it, what outcome it produced). Agents **read from the context graph and write their actions/decisions back as auditable traces**, enabling continuous evaluation against real decision logic. Atlan ships a "Context Engineering Studio" + "Context Lakehouse." Gartner: **active metadata will power >50% of BI/analytics by 2026**, producing a *continuously evolving operational knowledge graph* of which data is used, by whom, for what.

- **INV-B + INV-C mapping:** the context graph is *precisely* Borjie's audit-chain + decision-log fused with the org-graph. A surface that is a lens over the **context** graph (not just the data graph) is one where every roll-up card is back-linked to the decisions that produced it — and the brain's writes-back are the **self-extending nervous system** (INV-C). The read+write-back loop is also how the lens **learns** which sub-views matter.

### Pillar 6 — Palantir Ontology = "the org-graph IS the semantic lens, in production, today"

The single most concrete production instance of the thesis. The **Palantir Ontology** (Foundry + AIP) is "a digital twin of the organization" carrying **semantic elements** (objects, properties, links) *and* **kinetic elements** (actions, functions, dynamic security). Agents reason over real-world concepts, not tables; **AIP Analyst** gives conversational ontology access; AIP Autopilot debugs agentic workflows. It is the **"ontology-first AI thesis in production."**

- **INV-B + INV-C mapping:** validates the entire Borjie bet — surfaces as lenses over a kinetic org-graph. Palantir's gap (and Borjie's differentiator): the Ontology is **hand-modeled by forward-deployed engineers**; it does **not re-derive its own categorization** as the org changes. That re-derivation is the beyond-today leap (§3).

### Pillar 7 — Generative UI / A2UI = "intent → rendered, role-shaped view"

The 2026 rendering substrate. **A2UI v0.9** (Google, JSONL-based agent→UI declarative protocol) and **Open-JSON-UI** (standardization of OpenAI's internal GenUI schema) let an agent **return UI widgets as part of its response**. The pattern: instead of fixed layouts, "the agent assembles the metrics most relevant to each user's role and current goals — the sales VP sees pipeline; the account manager sees their book of business." Google Research's *Generative UI* and CopilotKit's *Developer's Guide to GenUI 2026* codify the loop. Context-aware layouts adapt to **role + time + upcoming meeting + recently-accessed data** with *no click or config*.

- **INV-B mapping:** the **render** half of intent→view, and the **auto-shape-to-need** half of "auto-categorizes by user-need." Borjie's `portal-genui` is already on this curve.

### Pillar 8 — Self-organizing taxonomies + malleable software = "re-derive the categorization" + "the user can re-shape the lens"

The two pillars that make the lens *alive*:

- **Self-organizing taxonomy/ontology evolution:** **TaxoAdapt** (aligns LLM-built multidimensional taxonomy to *evolving* corpora), **EvoTaxo** (builds + evolves taxonomy from streams), **online-clustering + LLM-agent ontology extension** (zero-shot, real-time class induction), **NeOn-GPT / LLMs4Life** (end-to-end prompt-driven ontology authoring with adaptive refinement). LLMs now author classes/properties/axioms "with consistency comparable to junior human modelers." The frontier: **the taxonomy is not curated once — it is continuously re-derived as data arrives.**
- **Malleable software (Ink & Switch, "Malleable Software" essay June 2025; *PlayBook* 2026):** users **reshape tools at runtime** (no vendor update); "tools, not apps — a kitchen knife, not an avocado slicer"; a *gentle slope* from user to creator (Excel/HyperCard lineage).

- **INV-B + INV-C mapping:** self-organizing taxonomy = the literal engine for "the brain auto-categorizes by region/operation/type" and "re-derives its own categorization as reality changes." Malleable software = the owner *composing* a new lens (INV-C: missing tool → CREATE or COMPOSE), gated by the meta-rail.

---

## 2. The synthesis — what "one surface = semantic lens" means concretely for Borjie

Stitching the eight pillars into INV-B's exact verbs:

| INV-B verb | SOTA pillar(s) that supply it | Concrete mechanism for Borjie |
|---|---|---|
| **one surface = one definition** | Semantic layer (OSI/MetricFlow) + Headless BI (Cube) | A `LensDefinition` = governed metric(s) + dimension model + hierarchy, authored over `core_entity`/`org-graph`, exposed headless (one def → owner-web card, mobile drill, chat answer, agent tool). |
| **brain auto-categorizes by region/operation/type** | Self-organizing taxonomy (TaxoAdapt/EvoTaxo) + KG-OLAP contextual hierarchy | LLM induces the dimension hierarchy from the org-graph shape; `parentEntityId` chains + `entity_type` give the natural roll-up axes (jurisdiction → operation → asset). |
| **rolls UP to whole-estate** | KG-OLAP **merge + abstraction** (value-generating) | Estate view = abstraction over all operation-cells; "total royalty exposure" = value-generating roll-up along the jurisdiction hierarchy. |
| **drills DOWN to one operation** | KG-OLAP **slice/dice** + coverage propagation | Drill = dice to `operation=Geita-3`; the estate schema/vocabulary is *inherited* (coverage), so the same lens definition renders the single-operation view with no re-authoring. |
| **auto-EXPANDS/CONTRACTS sub-views as org grows 5→10** | Self-organizing taxonomy re-derivation + GenUI render + dynamic-sections | When operation #6 materializes in `core_entity`, the lens re-derives its dimension members; a new sub-view *appears* (dynamic-sections already does "tab appears when entity type exists") **without a hand-authored screen**; when an operation is sold, its sub-view *contracts away*. |
| **intent → view** | Agentic BI (Knowi/GoodData) + A2UI/portal-genui | "Show me where we're losing recovery" → arbiter picks the lens, binds the metric, renders via portal-genui. |
| **the user can compose a new lens** (INV-C) | Malleable software + LLM-authored semantic model | Owner describes a lens in chat → brain drafts a `LensDefinition` → meta-rail approval (bodyChange) → it goes live as a first-class surface. |

**The keystone realization:** roll-up and drill-down are **not two features** — they are **one `LensDefinition` evaluated at two points on the dimension hierarchy**. This is the semantic-layer/KG-OLAP insight, and it is what lets "whole estate" and "this one mine" be answered *from the same definition* (the literal beyond-today ask).

---

## 3. Beyond-today leaps (the bar is "best in the world — exceed shipping SOTA")

Each leap pairs an INV-B/INV-C requirement with a capability **no 2026 product has shipped**:

1. **The self-re-categorizing lens (re-derives its own categorization as reality changes).**
   SOTA stops at *human-curated* dimension hierarchies (Palantir Ontology) or *batch-rebuilt* taxonomies (TaxoAdapt re-runs on a corpus). **Leap:** the `LensDefinition` carries a **derivation rule, not a frozen hierarchy** — when the org-graph mutates (new jurisdiction, a holdco restructure, an operation reclassified from artisanal→mid-tier), the brain **re-derives the dimension members and the roll-up axes online**, diffs old-vs-new categorization, and proposes the change through the **bodyChange meta-rail** (INV-C). The lens *is* a living function of the graph, not a snapshot. **No product re-derives categorization as a first-class, audited, online operation.**

2. **One definition, both poles — provably.** Today, aggregate and detail views *happen* to share retrieval (Knowi) but there is no **guarantee** they are the same definition. **Leap:** a single `LensDefinition` with a **conformance proof**: the estate roll-up MUST equal the value-generating abstraction of its operation-cells (a checkable invariant: `Σ(operation cells) ≡ estate cell`). Borjie's evidence-required AI rule (every output cites ≥1 `evidence_id`) extends to lenses: **a roll-up number is non-renderable unless its drill-down decomposition reconciles.** This makes "whole estate" and "this one mine" not just *from* the same definition but **mutually auditable** — a finance-grade lens. (Ties to MASTER_GAP_REGISTER COG-12 verifier and the double-entry reconciliation ethos.)

3. **The context-graph lens: every roll-up is back-linked to the decisions that made it.** Gartner's context graph is read+write for *agents*. **Leap:** make it the user's lens too — drilling into "royalty exposure = high" doesn't just show sub-numbers, it shows the **decision trace** (which junior flagged it, which evidence, which rule) inline, and the user's correction **writes back** into the context graph as a new trace that re-weights the lens. The surface becomes a **two-way nervous-system node** (INV-C), not a read-only report.

4. **Predictive expand/contract (spawn-before-need).** Progressive disclosure today is *reactive* (user clicks to expand). **Leap:** the lens **pre-derives the sub-view the owner is about to need** (operation #6 just crossed a licence-renewal threshold) and **pre-renders it into a blackboard slot** before the question is asked — fusing dynamic-sections + the ambient/proactive worker (MASTER_GAP_REGISTER EA-07). The estate view *grows a limb* exactly when reality demands it, and the limb is warm.

5. **Cross-domain lens portability (Borjie ⇄ BossNyumba).** Because the lens is defined over the *abstract* org-graph (`core_entity` + hierarchy), a lens like "exposure roll-up by jurisdiction" is **domain-agnostic** — the same definition serves "royalty exposure across mines" (Borjie) and "rent-arrears exposure across buildings" (BossNyumba) by swapping only the dimension binding. **Leap:** lenses are a **shared capability layer**, authored once, re-bound per domain — the literal "same brain/capability/wiring, only the domain layer differs" thesis, realized at the surface tier.

6. **INV-A-safe lens federation.** admin-web (control plane) must NEVER read tenant business data. **Leap:** the lens engine emits **two provably-disjoint lens classes** — *control-plane lenses* (fleet health, tenant counts, kill-switch state — zero business rows) and *data-plane lenses* (owner estate). The semantic layer's governance (Cube/dbt row-level security + Borjie RLS) is the enforcement; a lens is **typed** by plane at authoring time and the meta-rail rejects any control-plane lens whose definition touches a tenant business table. Break-glass stays audited (INV-A). **No BI vendor encodes a "plane" type into the semantic layer itself.**

---

## 4. Our gaps (we have the substrate; we lack the lens)

We already hold the rare half — the **graph** and the **render substrate**. We lack the **lens layer** that binds them.

**What we HAVE (verified in-repo):**
- `packages/core-entity` schema (`core_entity` + `entity_ext_*` + `tenant_schema_extensions`): a **polymorphic org-graph row-store** with hierarchy via `parentEntityId` self-reference (LAND_PARCEL→LAND_PARCEL, BUILDING→SUB_UNIT) and hybrid retrieval (BM25 `tsv` + dense `embedding` + geo `geoGeog` + JSONB `customFields`). **This is our KG-OLAP substrate** — the roll-up axes (`entity_type`, `parentEntityId` chains) already exist.
- `packages/org-graph` — the graph package itself.
- `packages/portal-genui` (`intent/detector.ts`, `generator/`, `fields/`, `widgets/`, `patch/`, `persistence/`): **intent→view rendering**, the GenUI/A2UI half. Already on the right curve.
- `packages/dynamic-sections`: "tabs appear only when the entity type exists; new entity types materialise the moment the MD creates them via chat." **This is the auto-expand primitive** — but it is *registry-predicate* filtering (`HasEntitiesPredicate`, `RoleAllowedPredicate`), **not** semantic-lens roll-up/drill-down.

**What we LACK (the gaps to close):**

- **GAP-LENS-1 — No `LensDefinition` / semantic-layer abstraction.** There is no governed metric+dimension+hierarchy object. portal-genui generates *a view*; nothing defines *the lens* such that the same definition yields both the estate roll-up and the single-operation drill. We render views, we don't *define lenses*. (Closest SOTA: Cube/MetricFlow `LensDefinition` over the org-graph; OSI YAML shape.)
- **GAP-LENS-2 — No roll-up/drill-down operators over `core_entity`.** `grep` for `rollup|drill|abstraction|merge` in portal-genui/dynamic-sections = **none**. The KG-OLAP merge/abstraction/coverage machinery (Pillar 4) is unimplemented; we cannot answer "whole estate" and "this one mine" from one definition.
- **GAP-LENS-3 — Categorization is static, not re-derived.** dynamic-sections decides tab visibility by *predicate on entity presence*, not by an LLM-derived dimension hierarchy that re-categorizes when the org-shape changes. There is no online taxonomy re-derivation (TaxoAdapt/EvoTaxo pattern) and no diff→meta-rail proposal loop. This is the headline beyond-today leap (§3.1) and we have *nothing* on it.
- **GAP-LENS-4 — Auto-expand exists; auto-contract and "as it grows 5→10" do not.** dynamic-sections adds a tab when an entity type appears; there is no evidence of **contraction** (operation sold → sub-view recedes) nor of **sub-view re-derivation** as member-count scales. Expansion is binary (type exists / not), not graduated by org size.
- **GAP-LENS-5 — No headless/multi-consumer guarantee.** owner-web, the two mobiles, and chat each render independently; there is no single governed definition they *all* consume, so the same metric can drift across surfaces — the exact problem the semantic layer solves (and the reason text-to-SQL accuracy is 40% vs 90%).
- **GAP-LENS-6 — No context-graph back-link on surfaces.** Our audit-chain/decision-log exists (per CLAUDE.md) but is not fused into the lens as an inline, drill-into decision trace, and surfaces don't write user corrections back (Pillar 5 / §3.3).
- **GAP-LENS-7 — No INV-A plane-typing of lenses.** Nothing types a lens as control-plane vs data-plane or rejects a control-plane lens whose definition touches a tenant business table (§3.6). The INV-A boundary is enforced at RLS/route level, not at the lens-definition level.
- **GAP-LENS-8 — Predictive/warm expansion absent.** Sub-views are rendered on demand, not pre-derived/pre-rendered into a blackboard slot before need (§3.4; ties to EA-07 in MASTER_GAP_REGISTER — ambient runtime doesn't subscribe estate event streams).

**Sequencing note (fits MASTER_GAP_REGISTER waves):** GAP-LENS-1/2 are the keystone (a `LensDefinition` + KG-OLAP operators over `core_entity`); they depend on the body-self-model/system-graph being wired (EA-01) and pair naturally with the modality-arbiter keystone (COG-07) — a lens is one of the modalities the arbiter can land on. GAP-LENS-3 (self-re-categorization) is a Wave-D self-improvement-class capability (re-derives + proposes through bodyChange, EA-04/AUT-01). GAP-LENS-8 fuses with EA-07 (ambient event streams) and EA-05 (blackboard).

---

## 5. The minimal viable lens (what to build first, framed for the build waves)

1. **`LensDefinition`** — `{ metrics[], dimensions[], hierarchy (roll-up axes), bindingToCoreEntity, plane: 'control'|'data' }`, authored over `core_entity`/`org-graph`, OSI-YAML-shaped, exposed **headless** so owner-web + mobiles + chat consume one definition (closes GAP-LENS-1, -5, partially -7).
2. **KG-OLAP operator kernel** over `core_entity` — `rollUp = merge ∘ abstraction(value-generating)`, `drillDown = dice + coverage-inherit`, with the **reconciliation invariant** (`Σ operation-cells ≡ estate-cell`) as a renderability gate (closes GAP-LENS-2; delivers §3.2).
3. **Self-re-categorizer** — LLM induces dimension hierarchy from org-graph shape; on graph mutation, re-derives, diffs, and proposes via **bodyChange meta-rail** (closes GAP-LENS-3, -4; delivers §3.1, INV-C).
4. **portal-genui binding** — arbiter routes "intent → lens → rendered view" (we already have intent→view; add the lens in the middle).
5. **Context-graph back-link + warm expansion** — inline decision-trace on drill; pre-render predicted sub-views into blackboard slots (closes GAP-LENS-6, -8; delivers §3.3, §3.4).

This is the path from "we render views over a graph" to "**one surface is a living semantic lens over the estate.**"
