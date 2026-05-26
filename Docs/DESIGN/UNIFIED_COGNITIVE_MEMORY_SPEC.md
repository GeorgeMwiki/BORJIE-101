# Unified Cognitive Memory — Design Specification

> Wave 18AA / cross-layer framing — the canonical contract that turns
> Mr. Mwikila and his 27+ specialisations into **one mind**. Every
> specialisation reads from and writes into a **single shared memory
> store** — there is no private memory anywhere in the system.
>
> **Cross-links:** `MASTER_BRAIN_AUTONOMY_MANIFESTO.md`,
> `CAPABILITIES_UNIFICATION.md` (18Q), `UNIVERSAL_OBSERVABILITY_SPEC.md`
> (18R), `MUTATION_AUTHORITY_SPEC.md` (18S), `COGNITIVE_ENGINE_SPEC.md`
> (18T), `DATA_ONBOARDING_SPEC.md` (18U), `JUNIOR_ARCHITECTURE_SPEC.md`
> (18V), `JUNIOR_DYNAMIC_SPAWNING_SPEC.md` (18V-DYNAMIC).

---

## 1. Vision

The founder's principle, verbatim:

> "**Yes — because as MD learns, junior learns, and vice versa.**"

This is the **bidirectional learning principle**. Mr. Mwikila is **one
intelligence with many specialisations**. The Geology specialisation's
discovery that *Geita ore-grade peaks at 180m depth* feeds the
Marketplace specialisation's pricing model. The FX-Treasury
specialisation's successful hedge ladder feeds the Cost-Engineer
specialisation's unit-economics view. The root MD's cross-district
pattern recognition propagates **down** to every district MD; each
district MD's local discovery propagates **up** to the root MD and
**sideways** to peer districts via the root.

This is what makes Mr. Mwikila **one mind, not 27 silos**.

The Cognitive Engine (18T) gave us *how he thinks per turn*. The
Junior Architecture (18V) gave us *27 inheriting domain MDs*. The
Junior Dynamic Spawning addendum (18V-DYNAMIC) gave us *just-in-time
specialists*. The Capabilities Unification (18Q) gave us *one author
for every artifact*. None of those alone makes the specialisations
**share what they learn**. That is the gap this spec closes.

Unified Cognitive Memory is the substrate every other layer reads and
writes. Without it, Mr. Mwikila is a federation of forgetful workers.
With it, he is a single learning brain whose insights compound across
turns, sessions, districts, and (selectively, PII-stripped) tenants.

---

## 2. The Memory Cell — the atom of learning

Every observation, every fact, every rule, every preference is a
**`CognitiveMemoryCell`**. Cells are immutable on the write path
(replaced via promotion / contradiction transitions; never mutated in
place — this mirrors `coding-style.md`).

```typescript
export interface CognitiveMemoryCell {
  readonly id: string;
  readonly tenant_id: string;
  readonly scope_id: string;                              // 'tenant_root' or org_unit_id
  readonly content: MemoryContent;                        // text + embedding + structured
  readonly kind: MemoryKind;
  readonly contributed_by_specialisation: string;         // agent_id that wrote this
  readonly reinforced_by_specialisations: ReadonlyArray<string>;
  readonly contributed_in_turn_id: string;                // cognitive_turns reference
  readonly reinforced_in_turn_ids: ReadonlyArray<string>;
  readonly evidence_citations: ReadonlyArray<SpanCitation>;
  readonly confidence_score: number;                      // 0..1
  readonly access_count: number;
  readonly last_accessed_at: string | null;
  readonly promotion_status: MemoryStatus;
  readonly contradicting_cell_id: string | null;
  readonly audit_hash: string;
}

export type MemoryKind =
  | 'pattern' | 'fact' | 'rule' | 'preference'
  | 'template' | 'citation' | 'failure' | 'terminology';

export type MemoryStatus =
  | 'observed' | 'reinforced' | 'consolidated' | 'decayed' | 'contradicted';
```

A cell carries **provenance** (who contributed, who reinforced),
**evidence** (citations to corpus or research turns), **lifecycle
state** (status), and a **tamper-evident audit hash** (via
`@borjie/audit-hash-chain`).

---

## 3. The 5 memory operations

Every specialisation can — and indeed must — call these five
operations. **No specialisation has private memory.** Every operation
is on the shared store.

| Operation       | Signature                                              | When |
|-----------------|--------------------------------------------------------|------|
| **Observe**     | `memory.observe(content, kind, ctx) → cell_id`         | end of turn — record new learnings |
| **Reinforce**   | `memory.reinforce(cell_id, turn_id, ctx) → void`       | mid-turn — when an existing cell is used + confirmed |
| **Recall**      | `memory.recall(query, scope, opts) → readonly Cell[]`  | start of turn — semantic search seeds reasoning |
| **Cite**        | `memory.cite(cell_id, into_artifact_id) → void`        | during composition — record the cell as evidence |
| **Contradict**  | `memory.contradict(cell_id, new_evidence) → void`      | when new observation breaks an existing cell |

Each call goes through `@borjie/audit-hash-chain` — every memory
mutation is appended to the tenant chain so that "Mr. Mwikila changed
his mind on X" is provably traceable. There is no out-of-band write
path.

---

## 4. The promotion lifecycle (4 states + 1 off-path)

Memory matures through four states, with a fifth off-path
(`contradicted`) entered from any state when evidence is broken:

```
                  ┌─────────────┐
                  │  observed   │  ← first time discovered
                  └──────┬──────┘
                         │ reinforced by ≥2 OTHER specialisations
                         ▼
                  ┌─────────────┐
                  │ reinforced  │  ← cross-specialisation agreement
                  └──────┬──────┘
                         │ accessed ≥10× over ≥14 days, no contradiction
                         ▼
                  ┌─────────────┐
                  │consolidated │  ← canonical; high confidence
                  └──────┬──────┘
                         │ not accessed in 180+ days
                         ▼
                  ┌─────────────┐
                  │   decayed   │  ← still recoverable, not surfaced by default
                  └─────────────┘

       Any of the above can transition off-path:
                  ┌─────────────┐
                  │contradicted │  ← MD reconciles in a research turn
                  └─────────────┘
```

* `observed → reinforced` requires reinforcement from ≥2 **different**
  specialisations (the contributor doesn't count). This prevents one
  enthusiastic junior from auto-promoting its own bias.
* `reinforced → consolidated` requires ≥10 recalls over ≥14 elapsed
  days **and** zero contradictions in that window. Time + traffic +
  silence.
* `consolidated → decayed` after 180 days idle. Decayed cells are
  filtered out of default recall but remain query-able with
  `include_decayed: true` (e.g. a research turn auditing history).
* `* → contradicted` immediately when a `memory.contradict()` call
  passes the plausibility gate (`new_evidence.confidence ≥ 0.7` and
  cited). Contradicted cells surface in the MD inbox for reconciliation.

These thresholds mirror the recipe lock/improve cadence in
`ANTICIPATORY_UX_SPEC.md` and the junior dynamic lifecycle in
`JUNIOR_DYNAMIC_SPAWNING_SPEC.md`.

---

## 5. Scope rules — `tenant_root` vs `org_unit`

Memory cells live at one of two scopes:

* **`tenant_root`** — visible to **all** specialisations in the
  tenant (root MD + every junior + every district MD). Used for facts
  that apply tenant-wide ("this owner runs three Geita pits, all with
  the same compliance profile").
* **`org_unit` (org_unit_id)** — visible only to that org_unit's
  specialisations **plus** the root MD (universal-observability).
  Used for district-local facts ("Geita-South shift starts 06:00").

**Sub-org propagation** — the bidirectional principle made operational:

1. A cell written at district A's `org_unit` scope is **visible to
   root MD** automatically. Root MD's recall unions over root + all
   children.
2. Root MD may **reinforce** a child-scope cell. Reinforcement from
   root carries a *broadcast hint*; the consolidation worker then
   evaluates whether to promote a sibling cell at district B's scope.
3. Root MD may **promote** a child cell to `tenant_root` scope. This is
   an authority-tier-2 mutation (`MUTATION_AUTHORITY_SPEC.md`).

**Promotion gate for `tenant_root`**: a candidate must be reinforced by
≥2 **different** org_units (not just two specialisations within one
district) before it can consolidate at tenant_root. One district's
bias cannot become canonical for the whole tenant.

---

## 6. Cross-specialisation read+write patterns

The bidirectional principle operationally manifests as three patterns:

* **Pull (recall)** — Every specialisation's turn begins with
  `memory.recall(intent, scope)`. Semantic search returns the top-N
  relevant cells across **all** specialisations and statuses (filtered
  by status by default). The junior reading geology data still picks
  up the marketplace specialisation's pricing patterns that referenced
  the same ore body.
* **Push (observe → tag)** — When a specialisation writes a new cell,
  an event fires. The consolidation worker tags it for relevance to
  other specialisations (semantic similarity + entity overlap) and
  bumps its discoverability score for those domains.
* **Reinforce on agreement** — When a specialisation's reasoning trace
  reproduces a fact that already exists, the engine emits
  `memory.reinforce(cell_id)` instead of re-observing — cross-
  specialisation reinforcement is the promotion engine's input signal.

---

## 7. Anti-hallucination via memory

The Cognitive Engine's D2 cite-validator already enforces "cite or
stay silent" against corpus + research. Unified Cognitive Memory adds
a **third source-of-truth**: the tenant's own consolidated knowledge.

For every output the system composes (text claim, doc paragraph,
image caption, campaign hook):

1. **Contradiction check** — semantic-search the output against
   `consolidated` cells. If a cell with `confidence_score ≥ 0.8`
   contradicts the output, the cite-validator flags the turn and asks
   the owner to confirm the new claim.
2. **Provenance check** — if the output asserts a domain fact with no
   matching `consolidated` / `reinforced` cell **and** no corpus
   citation **and** no research turn evidence, the cite-validator
   rejects: ask, refuse, or research. Memory is a first-class evidence
   source.
3. **Citation surface** — every cited cell appears in the artifact's
   citation panel alongside corpus chunks and research sources.

Memory closes the third hole in citation discipline — the hole that
says "common knowledge inside this tenant should not need a fresh
corpus chunk every time."

---

## 8. Federation principle (≥10 tenants → platform_memory)

When **≥10 distinct tenants** observe the same pattern (≥0.92 cosine
similarity between cell embeddings, each ≥0.7 confidence), the pattern
is promoted to a **platform-level memory cell** in
`platform_memory_cells`. Platform cells are:

* **PII-stripped** — the `anonymizer` enforces a deny-list of tenant-
  name, person-name, and address surfaces;
* **Tenant-anonymised in provenance** — counts only
  ("observed by N tenants in jurisdiction K");
* **Read-only at the tenant boundary** — every tenant reads platform
  cells during recall, no tenant writes directly to them. The
  federation promoter is the sole writer, running with a service role
  in the consolidation worker.

This is the federated-learning equivalent of the DP-memory pattern in
`packages/ai-copilot/src/dp-memory/` but for unstructured semantic
knowledge rather than DP-aggregated numerical defaults. The two
mechanisms complement; `dp-memory` stays as-is for numerical
benchmarks, `cognitive-memory` carries semantics. Convergence is a
Phase-2 question (see §11).

---

## 9. Schema additions (3 tables + pgvector)

Three tables, one migration: `0029_cognitive_memory.sql`. Requires
the `vector` extension (already enabled in earlier migrations; the
migration includes `CREATE EXTENSION IF NOT EXISTS vector` for safety).

```sql
-- The unified memory store (tenant-scoped, RLS-bound)
CREATE TABLE cognitive_memory_cells (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  scope_id text NOT NULL,                       -- 'tenant_root' or org_unit_id
  kind text NOT NULL,                           -- pattern|fact|rule|preference|template|citation|failure|terminology
  content_text text NOT NULL,
  content_structured jsonb,
  embedding vector(1536),                       -- OpenAI text-embedding-3-large
  contributed_by_specialisation text NOT NULL,
  reinforced_by_specialisations text[] DEFAULT ARRAY[]::text[],
  contributed_in_turn_id uuid,                  -- → cognitive_turns(id)
  reinforced_in_turn_ids uuid[] DEFAULT ARRAY[]::uuid[],
  evidence_citations jsonb DEFAULT '[]'::jsonb,
  confidence_score numeric(3,2) DEFAULT 0.50,
  access_count int NOT NULL DEFAULT 0,
  last_accessed_at timestamptz,
  promotion_status text NOT NULL DEFAULT 'observed',
  contradicting_cell_id uuid REFERENCES cognitive_memory_cells(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  promoted_at timestamptz,
  decayed_at timestamptz,
  audit_hash text NOT NULL
);

CREATE INDEX idx_cmc_embedding
  ON cognitive_memory_cells USING hnsw (embedding vector_cosine_ops)
  WITH (m=16, ef_construction=64);
ALTER TABLE cognitive_memory_cells ENABLE ROW LEVEL SECURITY;

-- Cross-specialisation reinforcement audit trail
CREATE TABLE cognitive_memory_reinforcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cell_id uuid NOT NULL REFERENCES cognitive_memory_cells(id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  specialisation text NOT NULL,
  turn_id uuid NOT NULL,
  reinforced_at timestamptz NOT NULL DEFAULT now(),
  audit_hash text NOT NULL
);
ALTER TABLE cognitive_memory_reinforcements ENABLE ROW LEVEL SECURITY;

-- Platform-level federated memory (PII-stripped, global, no RLS)
CREATE TABLE platform_memory_cells (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  content_text text NOT NULL,
  embedding vector(1536),
  source_tenant_count int NOT NULL,
  promotion_status text NOT NULL DEFAULT 'observed',
  created_at timestamptz NOT NULL DEFAULT now(),
  promoted_at timestamptz,
  audit_hash text NOT NULL
);
```

Drizzle schema: `packages/database/src/schemas/cognitive-memory.schema.ts`.
Barrel updated in `packages/database/src/schemas/index.ts`.

---

## 10. Anti-patterns

* **Private memory per specialisation** — defeats the unified-brain
  principle. There is one store. A junior's "working memory" for a
  single turn is a `recall(opts: { ttl_seconds: 600 })` view, not a
  private buffer.
* **Skipping recall before composing** — every turn must begin with
  `memory.recall`. A turn that composes without recall is a cite-
  validator failure (equivalent to composing without consulting
  corpus).
* **Skipping observe after composing** — every turn must end with
  `memory.observe` for novel learnings (even "no new facts this turn"
  as a meta-cell with kind `pattern`).
* **Trusting a single-observation cell as if consolidated** — recall
  must filter by status, weight by confidence, and surface uncertainty
  notes when only `observed` cells are available.
* **Cross-tenant memory leak** — RLS on every read of
  `cognitive_memory_cells`. Federation goes through the anonymiser.
* **Federating user PII to platform memory** — PII must be stripped
  **before** a cell is candidate for federation. The federation
  promoter rejects any candidate that fails the anonymiser's deny-list.
* **Mutating cells in place** — cells are immutable. Status changes go
  through dedicated promote / decay / contradict transitions which
  write new audit-chain entries.

---

## 11. Phase 2 integration notes (deferred retrofit waves)

This wave ships the package + schema + the 5 operations as thin,
tested stubs. The retrofit map for downstream consumers — wiring
`memory.recall`/`memory.observe` into the Cognitive Engine D1/D5,
Junior Spawner selection, all five composers (UI/doc/media/campaign/
research), Mutation Authority precedent, Data Onboarding entity
recognizer, Org Scope terminology, Customer Geo Routing — is deferred
to a sequence of follow-up waves to avoid stomping in-flight sibling
packages. Headline integration points:

* **Cognitive Engine (18T)** — runtime/cognitive-loop calls
  `memory.recall` as D5 input and `memory.observe` from D1 conclusion.
* **Junior Spawner (18V-DYNAMIC)** — selection scorer uses
  `memory.recall` for fuzzy intent matching against prior successful
  spawns.
* **All five composers (UI / doc / media / campaign / research)** —
  read prior successful field orderings, terminology, brand-DNA
  precedents, audience-segment patterns; write recipe-evolution
  proposals and research findings.
* **Mutation Authority (18S)** — proposal-builder reads
  `memory.recall` for precedent on similar mutations + outcomes;
  writes mutation outcomes back as `pattern` cells.
* **Consolidation Worker** — extends its promotion-decider to operate
  on `cognitive_memory_cells`; also hosts the federation promoter
  (10-tenant threshold).

A separate `ai-copilot` convergence question — whether to fold
`dp-memory` and `learning-loop` into the unified store or run them
parallel — is flagged for a later wave; parallel is the
lowest-disruption first pass.

---

## 12. Tenancy + audit

* Every `observe` / `reinforce` / `promote` / `decay` / `contradict`
  call appends to the tenant audit chain via
  `@borjie/audit-hash-chain`. The cell's `audit_hash` is the row's
  link in the chain.
* RLS enforced on every `cognitive_memory_cells` and
  `cognitive_memory_reinforcements` read. The default Drizzle session
  must set `app.tenant_id` before any query.
* `platform_memory_cells` has no tenant column and no RLS — globally
  readable by design. The federation promoter is the only writer.

---

## 13. Phasing

* **Phase 0 (this wave, 18AA)** — package scaffold + 3-table migration
  + Drizzle schema + the 5 operations as thin, tested stubs.
* **Phase 1+** — sibling-wave retrofit map (§11). Each phase ships
  independently and is reversible (feature-flag-gated in
  `@borjie/feature-flags-adapter`).
