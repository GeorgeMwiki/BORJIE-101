# VISION DOSSIER — Dynamic Schema & Ontology Synthesis

**Lane:** `dynamic-schema-ontology-synthesis`
**Date:** 2026-06-08
**Author:** SOTA research pass (deep current online survey, June-2026 sources)
**Scope:** How a brain CREATES entity types + fields + relationships at RUNTIME,
per-tenant, RLS-safe, and EVOLVES them safely. Shared between Borjie (mining)
and BossNyumba (real-estate) — the synthesis machinery is identical; only the
*seed ontology* differs.

**The one-line vision:** the org's data model is not designed by a human and then
frozen — the MD **induces it from the org's own evidence, proposes it through the
body-change meta-rail, and rewrites it as the business changes**, with the
physical Postgres schema, the RLS policies, the validation contracts, and the
knowledge-graph ontology all kept in lockstep as *data*, never as hand-edited DDL.

---

## 0. Why this lane is the substrate under every other vision lane

A "self-constructing organizational brain" (owner vision) cannot exist on a fixed
schema. If `core_entity.entity_type` can only ever be one of 17 hardcoded
discriminators and the KG ontology is a checked-in TypeScript file, then the MD
can *route* and *reason* dynamically but it can never **model something the
founder never anticipated** — a new ancillary business, a novel licence class, a
bespoke offtake instrument, a family-office trust vehicle. The org-graph,
task-routing, surface-synthesis, and proactive org-design loops all *read* a
schema; this lane is the only one that lets the brain *write* one. It is the
data-plane twin of the body-change meta-rail (`MD_AS_BODY_ARCHITECTURE.md`):
body-change mutates **code/surfaces**; this lane mutates the **data model**.

---

## 1. The state of the art (June 2026), surveyed

### 1.1 Schema/ontology induction is now a solved-enough research problem
The field has moved from "LLMs help you author an ontology" to "LLMs induce the
schema bottom-up from a corpus, at web scale, with no predefined types." The
canonical 2025 reference is **AutoSchemaKG** (Bai et al., arXiv 2505.23628): it
builds a 900M+-node KG over web-scale corpora with **zero predefined schema** by
extracting entity/relation/**event** triples, then inducing the type system
*post-hoc* via a **conceptualization layer** — a semantic layer that clusters
surface forms (synonyms, paraphrases) into canonical conceptual categories and
organizes them hierarchically, which is exactly what stops "schema explosion."
Its reusable primitives map directly onto a per-tenant runtime: iterative type
**clustering by embedding** (not string match), **hierarchical type
organization**, **frequency-based filtering** (rare extractions quarantined),
**incremental consolidation** (merge similar types as data arrives, no
disruptive batch rebuilds), and **scope-boundary detection** (tenant-specific vs
cross-tenant types).

The Oct-2025 survey **"LLM-empowered Knowledge Graph Construction"** (arXiv
2510.20345) gives the taxonomy that should structure our implementation as three
*selectable modes*, not one:
- **Schema-free** (ChatIE multi-turn, KGGEN's entity-then-relation decomposition)
  — maximal recall, used at *ingest* of a brand-new tenant with no model yet.
- **Schema-induced / data-to-schema** (GraphRAG, OntoRAG, and the **EDC**
  pattern: **Extract → Define → Canonicalize**, Zhang & Soh 2024) — the EDC
  *Define* stage does LLM-based dedup via natural-language definitions + vector
  similarity; *Canonicalize* aligns to existing types. This is our **steady-state
  loop**.
- **Schema-guided / top-down** (Ontogenia's *metacognitive prompting* with
  Ontology Design Patterns; NeOn-GPT; competency-question-driven CQbyCQ) — used
  when a *regulatory* type must be exact (a JORC resource class, a RICS valuation
  basis), so the seed ontology constrains induction.

Crucially for safe evolution: **AdaKGC** (Ye et al.) handles *dynamic schema
evolution at inference time* via **Schema-Enriched Prefix Instruction** + **Schema-
Constrained Dynamic Decoding** — the model adapts to a changed schema **without
retraining**, which is the property we need when the org adds a type mid-quarter.
**KARMA** (Lu & Wang 2025) and **Graphusion** show the *multi-agent self-refining*
shape: specialized agents do schema-alignment, conflict-resolution, and a
dedicated **quality-evaluation** pass for global consistency — i.e. the induction
loop must have its own auditor, not just an extractor.

### 1.2 The human-in-the-loop is the accepted governance pattern
**LLMs4SchemaDiscovery** (arXiv 2504.00752) is an explicit *human-in-the-loop
workflow* for schema mining: LLM proposes properties/types/constraints/relations,
a domain expert refines. **PARSE** (arXiv 2510.08623) does LLM-driven schema
*optimization* for reliable extraction. **AI-driven data-contract generation**
(arXiv 2507.21056) reframes the output as a **data contract** — a formal,
versioned agreement on structure + semantics — which is the artifact our
body-change meta-rail should gate. This is the governance answer to "the schema
rewrites itself": it never *self*-applies; it proposes a contract.

### 1.3 Temporal KGs already do "schema that updates itself" in production
**Graphiti / Zep** (arXiv 2501.13956) is the production proof. Graphiti
**automatically builds an ontology from incoming data**, de-duplicates nodes,
labels edges consistently, and — the key property — uses a **bi-temporal model**
where every edge carries `(t_valid, t_invalid)` plus ingestion time. When new
facts conflict, it **invalidates rather than discards** the old edge, preserving
history without large-scale recompute, at P95 ≈ 300ms retrieval. This is the
template for *safe evolution*: a synthesized schema must be **append-only +
invalidated-with-timestamp**, never overwritten.

### 1.4 Postgres can host a tenant-synthesized schema four ways — pick deliberately
The 2025/2026 consensus (BSWEN, Crunchy, Razsamuel, AWS Prescriptive Guidance):
- **JSONB + a config/catalog table** — flexible columns hosting tenant-specific
  fields, *governed by* a tenant-schema catalog. ~10× faster writes than EAV,
  GIN-indexable. **But** `GROUP BY`/aggregation over deep JSONB degrades badly
  (>5s on 100k rows past ~5KB blobs). **Verdict: the default for synthesized
  *attributes*.**
- **EAV** — maximally dynamic but slow writes (index thrash per attribute) and
  painful queries. **Verdict: avoid; it's the trap.**
- **Per-tenant Postgres *schemas* (namespaces)** — real `CREATE TABLE` in an
  isolated `search_path`. Best query performance + isolation; operationally
  heavy. **Verdict: promotion target** for a tenant type that has *graduated*
  (high volume, needs joins/aggregation/typed constraints).
- **Property-graph** (Apache AGE / external Neo4j-style) — best for the
  *relationship* layer of the org-graph; pairs with the KG ontology.

The decisive evolution primitive is **pgroll** (xataio): zero-downtime,
**reversible** migrations via **multiple schema versions coexisting as views over
the same physical tables**, selected by `search_path`; expand/contract with
trigger-synced dual columns; rollback is instant because the old version was
never destroyed. **This is "schema-as-data + safe online evolution" already
built** — the exact mechanism a runtime needs to *promote* a JSONB type to a
typed table without downtime and to *undo* it.

### 1.5 Validation must be a first-class, evolving artifact
**SHACL** (W3C) is the constraint layer for the graph side; **OntoRipple**
(ScienceDirect 2026) automates *propagating an ontology change into its dependent
RML mappings and SHACL shapes* — i.e. when the ontology evolves, the validators
evolve **declaratively and automatically**. On the relational side the analogue
is **JSON Schema as data** + check-triggers. The lesson: a synthesized type ships
*with* its validators, and an ontology edit *ripples* into those validators.

---

## 2. The architecture this implies for Borjie/BN

A four-plane meta-schema, all stored **as data**, all RLS-scoped, all evolving via
the body-change meta-rail:

1. **Type catalog** (`entity_type_definition`) — induced entity/event types, each
   with: canonical name, parent type (hierarchy from §1.1), provenance
   `evidence_id`s, frequency/confidence, lifecycle status
   (`proposed → approved → active → deprecated`), and bi-temporal validity.
2. **Field catalog** (`tenant_schema_extensions`) — per-type fields: name, JSON
   Schema type, constraints, PII-class, residency-class, and a *storage hint*
   (`jsonb` vs `promoted-column` vs `promoted-table`).
3. **Relationship catalog** — typed edges between entity types (the org-graph
   ontology), bi-temporal, SHACL-style cardinality/domain/range constraints.
4. **Instance plane** — `core_entity` (JSONB `custom_fields`, GIN-indexed)
   for the long tail; promoted typed tables/namespaces for graduated types.

The **synthesis loop** (the EDC steady-state, §1.1): ingest evidence →
schema-free extract → Define (LLM dedup vs catalog + vector similarity) →
Canonicalize (align to existing type or **propose new**) → consistency auditor
(KARMA-style, evidence-required per CLAUDE.md) → **body-change proposal** (data
contract, §1.2) → human/auto-approve gate → write catalog rows + (optionally)
pgroll-promote → SHACL/JSON-Schema validators regenerated (OntoRipple-style) →
bi-temporal invalidation of superseded types (Graphiti-style), never deletion.

---

## 3. Borjie/BN implication (load-bearing — what's already here vs missing)

**The substrate already exists in-repo and is ~70% of the way there.** Migration
`packages/database/src/migrations/0306_create_core_entity_family.sql` already
ships the exact SOTA meta-schema primitives:
- `core_entity` — universal entity with `entity_type text NOT NULL` discriminator,
  `custom_fields jsonb DEFAULT '{}'`, a **GIN index on `custom_fields`
  (`jsonb_path_ops`)**, FORCE RLS (`app.current_tenant_id` GUC), tsvector search,
  `vector(1536)` embedding, PostGIS geog — i.e. exactly the "JSONB + config-table"
  SOTA pattern (§1.4).
- `entity_type_definition` — a **type catalog** with 17 platform built-ins and an
  `entity_type` **check-trigger** that already enforces "instances must reference a
  declared type." This IS the §2 type-catalog plane.
- `tenant_schema_extensions` — a **per-tenant schema-as-data catalog** already
  carrying the `tenant_id IS NULL OR tenant_id = guc` platform-shared RLS shape, so
  built-in types stay globally visible while tenant types are isolated. This IS the
  §2 field-catalog plane, RLS-safe by construction.

**What's missing is the synthesis *loop and governance*, not the storage:**
- **No induction loop writes these tables.** There is *zero* schema-induction code
  anywhere (`grep` for `induceSchema/entity_types/AutoSchemaKG` → none). The
  catalogs are populated only by the 17 hardcoded built-ins; nothing turns tenant
  evidence into a *new* `entity_type_definition` row. (Closes the spirit of
  gap **MEM-06**: KG ingest is heuristic substring `mentions`, no LLM
  entity/relation extraction.)
- **The KG ontology is hardcoded and wrong-domain.** `packages/knowledge-graph/
  src/ontology/` exports only `realEstateOntology` (a static `CLASSES` array in
  `real-estate.ts`) — a real-estate ontology inside a mining product, with
  `extendOntology`/`validateOntology` present but no *runtime synthesis* path.
  This is gap **KI-10** confirmed, and it proves both products will need the *same*
  induction engine with a different seed ontology — the BN parity point.
- **Bi-temporal + provenance exist but are unwired.** `temporal/bi-temporal.ts`
  (`validFrom/validTo`, `getStateAt`, `compareStates`) and `provenance/prov-o.ts`
  are built but the ingest path writes neither (gap **MEM-07**) — so today a
  schema change would *overwrite*, violating the Graphiti-style "invalidate, never
  discard" invariant the moment we let the schema move.
- **No body-change gate on the data model.** The body-change meta-rail
  (`EA-04/AUT-01`) is wired for code/surfaces but the data-model mutation path
  (new type, new field, promote-to-table) is not routed through it. Per the UI/
  Modality Invariant (`MASTER_GAP_REGISTER.md` §314): schema mutation must be
  **proposal-gated, chat-refinable, reversible** — pgroll gives the reversibility,
  the meta-rail gives the gate.

**Closure shape (cross-product with the register):** author a `miningOntology` +
`realEstateOntology` *seed* each (KI-10), build the EDC-style induction loop at
ingest (MEM-06) writing `entity_type_definition` + `tenant_schema_extensions`
rows as **proposals**, wire bi-temporal + PROV-O so types are append-only/
invalidated (MEM-07), route every catalog write through the body-change syscall as
a versioned **data contract** (EA-04/AUT-01), and add a **pgroll-style promotion
lane** so a graduated JSONB type becomes a typed table reversibly. The induction
engine is **shared**; only the seed ontology and the regulatory schema-guided
constraints differ between Borjie (JORC/Tumemadini/royalty) and BN (RICS/IVS/
land-tenure) — making this the single highest-leverage shared lane across the two
products.

---

## 4. Beyond-today leaps (what the owner has not yet articulated)

1. **The schema that rewrites itself — under a fitness function.** Don't just
   *induce* the schema once; put the meta-schema in the nightly self-improvement
   loop (`AUT-06`). Replay the quarter's decisions; where a JSONB `custom_fields`
   key is queried/aggregated often enough that GIN-on-JSONB degrades (§1.4's >5s
   cliff), the brain *proposes its own pgroll promotion* to a typed column/table —
   and where a type hasn't been instanced in N months, it proposes deprecation.
   The schema's shape becomes a **learned, measured artifact**, not a guess.

2. **Counterfactual schema simulation before commit.** Before any catalog write,
   run the proposed type through the world-model / simulate-before-act gate
   (`RSS-17`): replay historical evidence against the *new* shape in a shadow
   namespace (pgroll's coexisting versions make this free) and report
   blast-radius — "this new `tailings_facility` type would re-home 412 existing
   `core_entity` rows and break 3 SHACL shapes" — *before* the owner approves.
   Schema migration becomes **previewable**, like a `git diff` of the data model.

3. **Bi-temporal ontology = time-travel org modeling.** Because every type and
   field is bi-temporal (Graphiti-style), the MD can answer "what was our org's
   data model on the day we signed the Geita offtake?" and re-run a past decision
   under the *schema of that era*. This is auditability the regulators don't even
   ask for yet, and it makes schema evolution **non-destructive by construction**.

4. **Cross-tenant schema federation with a privacy floor.** When 40 artisanal
   tenants independently induce a near-identical `mercury_retort_log` type, the
   platform can detect the convergence (the AutoSchemaKG conceptualization layer,
   run *across* tenants on metadata only, never instances) and propose promoting
   it to a **platform built-in** seed — so the 41st tenant inherits it on day one.
   The org's collective schema becomes a **compounding network asset**, gated by
   the same `tenant_id IS NULL` platform-row RLS shape already in 0306.

5. **The data contract as the unit of governance and rollback.** Make the
   body-change artifact a signed, versioned **data contract** (§1.2) in a schema
   registry; every approval is hash-chained into the AI audit chain. "Undo the
   schema change" = check out the previous contract version and let pgroll
   reverse — making the *entire data model* as reversible as a code deploy, which
   no mining or real-estate OS on the market does today.

6. **OntoRipple-style validator co-evolution.** When the ontology edge
   `licence —covers→ mineral` gains a cardinality constraint, the SHACL shape, the
   JSON-Schema for `custom_fields`, *and* the check-trigger regenerate in one
   declarative ripple — so the validators can never silently drift from the
   ontology (the failure mode behind half the register's "doc-vs-reality" gaps).

---

## 5. Sources (real, June-2026)

- AutoSchemaKG — Dynamic Schema Induction at scale: https://arxiv.org/pdf/2505.23628
- LLM-empowered Knowledge Graph Construction (survey, taxonomy): https://arxiv.org/html/2510.20345v1
- Ontology Learning & KG Construction vs RAG (approaches): https://arxiv.org/html/2511.05991v1
- LLMs4SchemaDiscovery — human-in-the-loop schema mining: https://arxiv.org/pdf/2504.00752
- PARSE — LLM-driven schema optimization for extraction: https://arxiv.org/html/2510.08623v1
- AI-driven data-contract generation: https://arxiv.org/pdf/2507.21056
- Zep / Graphiti — temporal KG architecture, bi-temporal, dynamic ontology: https://arxiv.org/html/2501.13956v1
- Graphiti (Neo4j engineering blog): https://neo4j.com/blog/developer/graphiti-knowledge-graph-memory/
- pgroll — zero-downtime reversible Postgres migrations (multi-version views): https://github.com/xataio/pgroll
- pgroll guide (Neon): https://neon.com/guides/pgroll
- JSONB vs EAV in PostgreSQL for dynamic attributes: https://docs.bswen.com/blog/2026-04-24-jsonb-vs-eav-postgresql/
- Row-Level Security for tenants in Postgres (Crunchy): https://www.crunchydata.com/blog/row-level-security-for-tenants-in-postgres
- AWS Prescriptive Guidance — RLS for multi-tenant Postgres: https://docs.aws.amazon.com/prescriptive-guidance/latest/saas-multitenant-managed-postgresql/rls.html
- OntoRipple — propagating ontology change into SHACL/RML: https://www.sciencedirect.com/science/article/pii/S2352711026000361
- SHACL validation in presence of ontologies: https://arxiv.org/pdf/2507.12286
- Expand-contract / zero-downtime migration patterns: https://www.datasops.com/blog/database-migrations-zero-downtime
