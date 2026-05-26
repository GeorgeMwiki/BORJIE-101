# Information Synthesis SOTA — Design Specification

> Wave 22. Pillar B of [`AI_NATIVE_OS_MASTER.md`](../STRATEGY/AI_NATIVE_OS_MASTER.md).
> The "diorize" capability: distill + categorise + synthesize.
> Hierarchical synthesis at corpus scale that yields typed reusable
> materials.
>
> **Cross-links:** [`COGNITIVE_ENGINE_SPEC.md`](./COGNITIVE_ENGINE_SPEC.md),
> [`UNIFIED_COGNITIVE_MEMORY_SPEC.md`](./UNIFIED_COGNITIVE_MEMORY_SPEC.md),
> [`DEEP_RESEARCH_SPEC.md`](./DEEP_RESEARCH_SPEC.md),
> [`ORG_LEGIBILITY_SPEC.md`](./ORG_LEGIBILITY_SPEC.md),
> [`TACIT_KNOWLEDGE_HARVESTING_SPEC.md`](./TACIT_KNOWLEDGE_HARVESTING_SPEC.md),
> [`FIVE_LAYER_LOOP_ARCHITECTURE.md`](./FIVE_LAYER_LOOP_ARCHITECTURE.md).

Brand: Borjie. Persona: Mr. Mwikila. Status: design-spec.

---

## 1. Vision — founder verbatim

> "Ability to DIORIZE (distill + categorise + synthesize) chunks of
> information — basically aggregating down and synthesising the
> important parts then using those as materials for whatever context
> is concerned — also needs to be SOTA. Full speed."

---

## 2. The Thesis — Synthesis Is the Bridge From Substrate to Compose

Borjie has, by Wave 21, accumulated a vast typed artifact stream
([`ORG_LEGIBILITY_SPEC.md`](./ORG_LEGIBILITY_SPEC.md)). For a tenant at
month 12, the stream is millions of artifacts: every Slack message
ingested, every employee chat turn, every regulator filing, every
tab-as-loop friction event, every memory cell, every tacit-knowledge
artifact, every recipe change. The substrate is real. The problem is
the substrate cannot fit into any single compose call's context
window.

The founder names the bridge: **diorize** — distill (compress to
essence) + categorise (label into taxonomy) + synthesize (recompose
multiple sources into a coherent whole). The output is **typed
reusable materials** that any downstream `compose_anything_v1` call
can consume — a paragraph-sized synthesis is a recipe ingredient in
exactly the way a teaspoon of vanilla is a baking-recipe ingredient.

The 2026 synthesis SOTA is converging on three primitives:

1. **Long-context base models** — Anthropic's [Claude 4.6 / 4.7 with 1M
   context, GA at standard pricing](https://byteiota.com/anthropic-drops-long-context-premium-1m-tokens-at-standard-pricing/)
   (March 2026) and the [migration path to April 30 2026](https://pasqualepillitteri.it/en/news/1451/anthropic-1m-context-beta-retirement-april-30-2026).
   The 1M context window lets us synthesize multi-document corpora in a
   single call when the budget allows. The [practical-use guide for
   long-context Claude](https://www.mindstudio.ai/blog/claude-1m-token-context-window-agents)
   names "research synthesis" as a top use case.
2. **Hierarchical retrieval + summarisation** — the [HIRES / RAPTOR
   style hierarchical approach](https://www.computeleap.com/blog/claude-1m-context-window-guide-2026/)
   chunks → summarises chunks → summarises summaries → produces
   document-level synthesis without quadratic cost.
3. **Verification-grounded summarisation** — Anthropic's
   [Three-Agent Harness](https://www.infoq.com/news/2026/04/anthropic-three-agent-harness-ai/)
   separates planning/generation/evaluation; the evaluator agent
   verifies the synthesis against the source claims (the same pattern
   our [`COGNITIVE_ENGINE_SPEC.md`](./COGNITIVE_ENGINE_SPEC.md) §5
   cite-validator implements).

Borjie's diorize pipeline composes all three with the platform-
specific extras: tenant scoping, privacy filtering, audit anchoring,
and the typed reusability-tagging that lets downstream compose calls
pick the right synthesis as a building block.

---

## 3. The Three Operations — Distill, Categorise, Synthesize

### 3.1 Distill — many tokens → essential gist

**Input:** a chunk of source material (1K–100K tokens).

**Output:** a `Distillation` — a compressed representation (typically
100–1000 tokens) that retains: the key claims, the entities, the
time bounds, the source provenance, the citation anchors, the
confidence label.

```typescript
export interface Distillation {
  readonly id: string;
  readonly source_artifact_ids: ReadonlyArray<string>;  // upstream provenance
  readonly tokens_in: number;
  readonly tokens_out: number;
  readonly compression_ratio: number;
  readonly distilled_text: string;
  readonly key_claims: ReadonlyArray<DistilledClaim>;
  readonly key_entities: ReadonlyArray<Entity>;
  readonly time_bounds: { start: string; end: string } | null;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly citations: ReadonlyArray<SpanCitation>;
  readonly model_used: string;                         // 'haiku_4_5' typical
  readonly cost_usd_cents: number;
  readonly audit_hash: string;
}
```

The distiller is **the hot path** — runs in the millions per tenant per
month. Cost discipline is critical. Default model: Haiku 4.5 with
prompt-cache reuse of the system prompt across all chunks in a batch.
Per-chunk budget: 2000 input + 500 output tokens; cost target ≤ $0.003
per chunk at 2026 Haiku pricing.

### 3.2 Categorise — assign taxonomy labels

**Input:** a Distillation.

**Output:** zero or more `CategoryLabel` entries that file the
distillation into the tenant's taxonomy.

```typescript
export interface CategoryLabel {
  readonly taxonomy_id: string;                        // 'mining.regulatory' | 'mining.operational' | etc.
  readonly path: ReadonlyArray<string>;                // ['mining', 'regulatory', 'tumemadini', 'royalty']
  readonly confidence: number;                          // 0..1
  readonly evidence: ReadonlyArray<string>;
}
```

The taxonomy is the existing
[`CAPABILITY_CATALOGUE_SPEC.md`](./CAPABILITY_CATALOGUE_SPEC.md)
`CapabilityDomain` enum extended with sub-domains. Labels are
multi-membership: a Tumemadini royalty calc distillation may be both
`mining.regulatory.tumemadini.royalty` AND `mining.financial.royalty`.

### 3.3 Synthesize — combine multiple sources

**Input:** N distillations (or N synthesised outputs from a lower
hierarchical level).

**Output:** a `SynthesisArtifact` — a coherent narrative or structured
output that draws from all the inputs with attribution.

```typescript
export interface SynthesisArtifact {
  readonly id: string;
  readonly synthesis_kind: SynthesisKind;             // 'narrative' | 'comparative' | 'temporal' | 'causal' | 'numerical_summary'
  readonly upstream_distillation_ids: ReadonlyArray<string>;
  readonly upstream_synthesis_ids: ReadonlyArray<string>; // higher-level synthesis inputs
  readonly hierarchical_level: number;                 // 0 = distillation level; +1 per synthesis layer
  readonly output_text: string;
  readonly output_structured: Record<string, unknown>; // typed per kind
  readonly citations: ReadonlyArray<SpanCitation>;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly contradictions: ReadonlyArray<Contradiction>;
  readonly synthesis_voice: 'guide' | 'learn' | 'neutral';
  readonly intended_audience: AudienceTag;
  readonly reusability_tags: ReadonlyArray<ReusabilityTag>;
  readonly composed_at: string;
  readonly cost_usd_cents: number;
  readonly audit_hash: string;
}
```

---

## 4. Hierarchical Synthesis — chunk → section → doc → corpus

The architectural pattern is hierarchical:

```
Level 0: raw artifacts (millions per tenant)
         │
         ▼
Level 1: distillations (100K-1M per tenant)
         │
         ▼ batched by category + time bound
Level 2: section-synthesis (10K-100K per tenant)
         │
         ▼ batched by audience + topic
Level 3: doc-synthesis (1K-10K per tenant)
         │
         ▼ requested on demand
Level 4: corpus-synthesis (1-100 per tenant)
```

Each level uses the prior level's outputs as input. Each level passes
through the 7 quality gates from
[`FIVE_LAYER_LOOP_ARCHITECTURE.md`](./FIVE_LAYER_LOOP_ARCHITECTURE.md).
Each level writes its output to the legibility stream
([`ORG_LEGIBILITY_SPEC.md`](./ORG_LEGIBILITY_SPEC.md)).

The structural payoff: a corpus-level synthesis (level 4) of a year's
worth of tenant activity is cheap because the level-1 and level-2
artifacts are already computed and cached. A new corpus-synthesis
"what is our regulatory posture in 2026" reads ~50 level-3 outputs
totalling ~50K tokens — fits comfortably in a single 1M-context call.

---

## 5. Synthesis trigger model — when does diorize run?

The diorize pipeline runs in three modes:

### 5.1 Continuous (Level 1)

Every legibility artifact, on write, triggers a distillation if the
artifact's `reusability_tags` include `'distillable'`. The
distiller runs asynchronously via
`services/diorize-worker/` within ≤5 minutes of artifact creation.

### 5.2 Batched (Level 2)

Every 6 hours, the worker scans new distillations grouped by category
+ scope + time bound and produces section-syntheses. Default batch size:
10–100 distillations per section-synthesis call. The output joins the
legibility stream.

### 5.3 On-demand (Levels 3–4)

When `compose_anything_v1` or a recipe needs a doc-level or
corpus-level synthesis, the kernel issues a synthesis request. The
worker:

1. Checks if a recent synthesis exists (cache-hit) — if cached <24h,
   return.
2. If stale, recompose from level-2 inputs (fast path).
3. If level-2 inputs are also stale, refresh those first.

The on-demand path optimises for cache reuse; corpus-level
syntheses for a tenant typically take <30s when level-2 is fresh.

---

## 6. Privacy filtering — the critical gate

Diorize is the place where private artifacts could most easily leak
into broader-audience materials. The privacy filter is the L4 gate
specific to synthesis:

1. **Subject-private artifacts** (tagged `'private_to_subject'` per
   [`ORG_LEGIBILITY_SPEC.md`](./ORG_LEGIBILITY_SPEC.md) §7.1) NEVER
   propagate into syntheses with broader audience tags.
2. **Scope-bound artifacts** propagate only into syntheses with the
   same or broader scope binding.
3. **Federation-eligible artifacts** (tagged `'reusable_as_pattern'`)
   propagate into cross-tenant patterns via differential privacy
   ([`SELF_IMPROVING_LOOPS_SPEC.md`](./SELF_IMPROVING_LOOPS_SPEC.md) §2.4).
4. **PII detection** at synthesis boundary: even artifacts that
   passed PII redaction at ingest re-run through a synthesis-output
   PII scanner; any leakage triggers a `'block'` gate verdict.

The privacy filter is its own quality gate, registered in the
quality-gates layer of every synthesis loop.

---

## 7. Cost + Latency Budgets

| Synthesis level | Model | Input tokens | Output tokens | Cost target / op | Latency target |
|---|---|---|---|---|---|
| **L1 distillation** | Haiku 4.5 | ≤2K | ≤500 | $0.003 | 2s |
| **L2 section** | Haiku 4.5 + cache | ≤8K | ≤2K | $0.015 | 6s |
| **L3 doc** | Sonnet 4.6/4.7 | ≤32K | ≤8K | $0.30 | 20s |
| **L4 corpus** | Sonnet 4.7 (1M) | ≤500K | ≤32K | $4.50 | 90s |

Cost is the *operational* budget; the tenant's monthly synthesis
spend cap is configurable. Default for a typical small mining
cooperative: $500/month synthesis budget. Above the cap, L1/L2 throttle
to opportunistic-only; L3/L4 require explicit owner approval.

The cost cascade reuses the existing
`@borjie/brain-llm-router` cost-meter discipline.

---

## 8. The reusable-materials catalogue

Synthesis outputs are not floating documents — they are **typed
ingredients** in a recipe-shaped catalogue. The catalogue surface
lives in `apps/owner-dashboard/src/synthesis-materials/` and lets
the owner browse, label, pin, and re-use synthesis artifacts.

Materials are tagged for re-use:

- `'reusable_as_briefing_material'` — fits in the morning brief.
- `'reusable_as_pitch_material'` — for board packs / investor decks.
- `'reusable_as_training_material'` — for LEARN-mode walk-throughs.
- `'reusable_as_corpus_fact'` — promotable to a memory cell.
- `'reusable_as_pattern'` — federation-eligible.
- `'reusable_as_strategic_input'` — for the strategic-direction layer.
- `'private_to_subject'` — not reusable beyond the subject's session.

The owner can pin a synthesis as a *standing input* to a recurring
compose. Example: pin the L3 synthesis "Buyer-relationship quarterly
review" as a standing input to every Monday's morning briefing for
the next quarter. The pinned synthesis re-runs on its own cadence
(default weekly) and the morning brief picks up the freshest version.

---

## 9. SOTA landscape — 2026 references

- **Anthropic Claude 4.6/4.7 with 1M context GA** ([byteiota](https://byteiota.com/anthropic-drops-long-context-premium-1m-tokens-at-standard-pricing/),
  [DEV community announcement](https://dev.to/onsen/claudes-1m-context-window-is-now-generally-available-95f),
  [Awesome Agents GA writeup](https://awesomeagents.ai/news/anthropic-1m-context-ga-opus-sonnet/),
  [WinBuzzer enterprise rollout](https://winbuzzer.com/2026/03/14/anthropic-drops-long-context-premium-1m-token-claude-xcxwbn/))
  — the 1M-context substrate for L3/L4 synthesis. Standard pricing.
- **Long-running agent tasks with Claude 1M** ([MindStudio guide](https://www.mindstudio.ai/blog/claude-1m-token-context-window-agents))
  — "research synthesis" named as primary use case.
- **Anthropic Three-Agent Harness** ([InfoQ](https://www.infoq.com/news/2026/04/anthropic-three-agent-harness-ai/))
  — planning + generation + evaluation as the synthesis verification
  pattern Borjie ports.
- **Hierarchical retrieval (RAPTOR-style)** — the chunking → summary
  → summary-of-summaries pattern. Reference implementation lineage:
  Stanford / Carnegie Mellon NLP labs 2024–25.
- **Verification-grounded summarisation** — the [arXiv 2508.00271
  MetaAgent](https://arxiv.org/pdf/2508.00271) self-reflection +
  answer-verification cycle.
- **OpenAI o3 / deep research** — competitor synthesis stack;
  Borjie's discipline (citations + audit chain + tenant scope) is the
  differentiator.

---

## 10. How this connects to existing Borjie architecture

- **Cognitive engine** [`COGNITIVE_ENGINE_SPEC.md`](./COGNITIVE_ENGINE_SPEC.md):
  the D5 relevance pruning discipline ranks synthesis materials
  against the current turn's intent before injection into context.
- **Unified cognitive memory** [`UNIFIED_COGNITIVE_MEMORY_SPEC.md`](./UNIFIED_COGNITIVE_MEMORY_SPEC.md):
  syntheses tagged `'reusable_as_corpus_fact'` promote into
  `MemoryKind = 'fact'` cells via the existing consolidation worker.
- **Deep research** [`DEEP_RESEARCH_SPEC.md`](./DEEP_RESEARCH_SPEC.md):
  research turns produce evidence; syntheses combine evidence with
  internal substrate.
- **Tacit knowledge harvesting** [`TACIT_KNOWLEDGE_HARVESTING_SPEC.md`](./TACIT_KNOWLEDGE_HARVESTING_SPEC.md):
  harvested know-how artifacts are first-class diorize inputs.
- **Org legibility** [`ORG_LEGIBILITY_SPEC.md`](./ORG_LEGIBILITY_SPEC.md):
  the legibility stream is the primary substrate the diorize pipeline
  consumes; synthesis outputs join the stream.
- **Five-layer loop** [`FIVE_LAYER_LOOP_ARCHITECTURE.md`](./FIVE_LAYER_LOOP_ARCHITECTURE.md):
  every synthesis runs all 7 quality gates.
- **24/7 work cycle** [`CONTINUOUS_24_7_WORK_CYCLE_SPEC.md`](./CONTINUOUS_24_7_WORK_CYCLE_SPEC.md):
  most L1/L2 work runs overnight; L3/L4 spike during morning
  briefing composition.
- **Strategic direction** [`STRATEGIC_DIRECTION_LAYER_SPEC.md`](./STRATEGIC_DIRECTION_LAYER_SPEC.md):
  consumes L4 corpus syntheses to inform strategic memos.

---

## 11. Anti-patterns

1. **Distill without citations.** A distillation that loses its
   citation anchors becomes unsourceable — the cognitive engine's
   cite-validator will reject any downstream output that uses it.
   Distillations MUST preserve span-citations.
2. **Synthesis hallucination.** A synthesis that introduces claims
   not present in the upstream distillations is hallucinated.
   Verification gate runs Haiku 4.5 over the synthesis output against
   the distillation set; novel claims block the output.
3. **Privacy leakage through synthesis.** Re-synthesising a public
   summary from a corpus that includes private artifacts must filter
   the private artifacts at the boundary. The privacy gate is the
   strict check.
4. **Cost runaway.** L4 corpus syntheses are $4.50 each at default
   budget. Running them on every owner question is bankruptcy. Default
   cache TTL: 24h. Always cache-check before compose.
5. **Stale materials in critical compose.** A pinned synthesis used
   in a Tumemadini filing must be ≤24h old; if older, the compose
   refreshes it first or surfaces a "stale evidence" warning to the
   owner.
6. **Cross-tenant synthesis leakage.** A synthesis must never include
   material from another tenant's substrate. The synthesis worker
   runs with the tenant's RLS GUC bound; arbitrary queries are
   audited via the existing `arbitrary_query` decision-trace branch.
7. **No reusability tagging.** A synthesis without `reusability_tags`
   is unreachable to downstream compose calls. Every synthesis MUST
   tag.

---

## 12. Phase 2 implementation map

- **New package** `packages/info-synthesis/` (≈1400 LOC):
  - `distiller.ts` (L1 op).
  - `categoriser.ts` (taxonomy assignment).
  - `synthesiser-level-2.ts` (section synthesis).
  - `synthesiser-level-3.ts` (doc synthesis).
  - `synthesiser-level-4.ts` (corpus synthesis with 1M context).
  - `privacy-filter.ts` (the synthesis-boundary PII + scope check).
  - `materials-catalogue.ts` (the typed-reusable-materials surface).
- **New service** `services/diorize-worker/` — continuous L1, batched
  L2, on-demand L3/L4.
- **Migration** `0038_info_synthesis.sql`:
  - `distillations` table.
  - `synthesis_artifacts` table.
  - `synthesis_pins` table (owner-pinned standing inputs).
  - `synthesis_taxonomy` table.
- **API routes:**
  - `POST /api/v1/synthesis/request` — on-demand L3/L4 trigger.
  - `GET  /api/v1/synthesis/materials` — catalogue browse.
  - `POST /api/v1/synthesis/pin` — owner pin action.
- **Owner-dashboard surface:** `apps/owner-dashboard/src/synthesis-materials/`.
- **Estimated effort:** 10 weeks (significant new work; ML-engineer
  + backend-engineer pair).

---

## 13. Cross-reference to siblings

- Master vision: [`AI_NATIVE_OS_MASTER.md`](../STRATEGY/AI_NATIVE_OS_MASTER.md) §2.4 + §10.
- Org legibility: [`ORG_LEGIBILITY_SPEC.md`](./ORG_LEGIBILITY_SPEC.md) — substrate.
- Cognitive engine: [`COGNITIVE_ENGINE_SPEC.md`](./COGNITIVE_ENGINE_SPEC.md).
- Unified cognitive memory: [`UNIFIED_COGNITIVE_MEMORY_SPEC.md`](./UNIFIED_COGNITIVE_MEMORY_SPEC.md).
- Five-layer loop: [`FIVE_LAYER_LOOP_ARCHITECTURE.md`](./FIVE_LAYER_LOOP_ARCHITECTURE.md).
- Tacit knowledge: [`TACIT_KNOWLEDGE_HARVESTING_SPEC.md`](./TACIT_KNOWLEDGE_HARVESTING_SPEC.md).
- On-demand internal software: [`ON_DEMAND_INTERNAL_SOFTWARE_SPEC.md`](./ON_DEMAND_INTERNAL_SOFTWARE_SPEC.md) — generated tools use synthesis materials as their data source.
- Strategic direction: [`STRATEGIC_DIRECTION_LAYER_SPEC.md`](./STRATEGIC_DIRECTION_LAYER_SPEC.md) — primary consumer of L4 corpus syntheses.
- Tab-as-loop: [`TAB_AS_LOOP_SPEC.md`](./TAB_AS_LOOP_SPEC.md) — friction events feed L1 distillations.
- 24/7 work cycle: [`CONTINUOUS_24_7_WORK_CYCLE_SPEC.md`](./CONTINUOUS_24_7_WORK_CYCLE_SPEC.md) — overnight is the synthesis hot window.

---

*Diorize is the bridge. Without it, the substrate is unreachable. With
it, every compose call has the right ingredients to hand, freshly
distilled, properly categorised, privacy-respecting, and audit-
anchored. This is what the founder names as "those as materials for
whatever context is concerned" — operationally.*
