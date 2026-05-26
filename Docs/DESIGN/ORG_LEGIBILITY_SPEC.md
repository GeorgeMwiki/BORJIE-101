# Organisational Legibility — Design Specification

> Wave 21. Pillar B of [`AI_NATIVE_OS_MASTER.md`](../STRATEGY/AI_NATIVE_OS_MASTER.md).
> Every action creates a typed artifact. Every artifact joins the
> audit chain. Nothing is unanalysed. The org becomes legible to itself.
>
> **Cross-links:** [`MUTATION_AUTHORITY_SPEC.md`](./MUTATION_AUTHORITY_SPEC.md),
> [`UNIVERSAL_OBSERVABILITY_SPEC.md`](./UNIVERSAL_OBSERVABILITY_SPEC.md),
> [`UNIFIED_COGNITIVE_MEMORY_SPEC.md`](./UNIFIED_COGNITIVE_MEMORY_SPEC.md),
> [`TACIT_KNOWLEDGE_HARVESTING_SPEC.md`](./TACIT_KNOWLEDGE_HARVESTING_SPEC.md),
> [`INFORMATION_SYNTHESIS_SOTA_SPEC.md`](./INFORMATION_SYNTHESIS_SOTA_SPEC.md),
> [`FIVE_LAYER_LOOP_ARCHITECTURE.md`](./FIVE_LAYER_LOOP_ARCHITECTURE.md).

Brand: Borjie. Persona: Mr. Mwikila. Status: design-spec.

---

## 1. Vision — founder verbatim

> "We need to make the entire org LEGIBLE to the MD — basically anything
> recorded in the platform it knows, every action creates an artifact
> that can improve, basically almost like an ON-DEMAND INTERNAL
> SOFTWARE for all orgs' ops."
>
> "no knowledge missed, used or unanalysed organization wide."

---

## 2. The Thesis — From Surveillance to Legibility

The intellectual lineage runs through James C. Scott's [*Seeing Like a
State*](https://en.wikipedia.org/wiki/Seeing_Like_a_State) (Yale, 1998),
the canonical text on legibility:

> "The state attempts to make a society legible by arranging the
> population in ways that simplified the classic state functions of
> taxation, conscription, and prevention of rebellion." —
> [Wikipedia summary](https://en.wikipedia.org/wiki/Seeing_Like_a_State)

Scott's critique of state legibility is the failure mode Borjie must
avoid: imposed standardisation that flattens local *mētis* (the tacit
local knowledge that makes complex systems actually work). The
[Ribbonfarm essay on legibility](https://ribbonfarm.com/2010/07/26/a-big-little-idea-called-legibility/)
gives a useful one-line gloss: *"legibility is what allows you to
manipulate at scale; mētis is what allows local actors to succeed."*

Borjie's legibility contract is **owner-legibility, not state-
legibility**. The asymmetry matters:

- The *owner* gains legibility into *their own* org.
- Mētis is *preserved*, not flattened — the five-mode tacit-knowledge
  harvester ([`TACIT_KNOWLEDGE_HARVESTING_SPEC.md`](./TACIT_KNOWLEDGE_HARVESTING_SPEC.md))
  captures mētis as typed artifacts that join the legibility stream
  *alongside* the standardised data.
- The legibility surface is the *owner's own substrate*, not a remote
  administrative substrate.
- The data subject (employee, customer) retains agency via opt-out
  controls ([`DAILY_USER_FOLLOWUP_SPEC.md`](./DAILY_USER_FOLLOWUP_SPEC.md) §6).

The architectural principle: **every action creates a typed artifact;
every artifact joins an audit-chained event stream; every event stream
is queryable by Mr. Mwikila; every query produces composed output
through the universal-creator dispatcher.** This is what the founder
calls "anything recorded in the platform it knows".

The 2026 data-observability ecosystem (Monte Carlo, Acceldata, Bigeye,
Soda) operationalises this for *infrastructure* — table freshness,
schema drift, anomaly detection on numeric columns. Borjie ports the
discipline to *organisational state*: actions, decisions, know-how,
relationships, capabilities. The platform's audit-hash-chain (already
shipped in Wave 6) is the legibility substrate; this spec adds the
typed artifact taxonomy + the query surface.

---

## 3. The Legibility Contract — Every Act → Artifact → Signal

The three-step contract:

```
                  Action happens
                         │
                         ▼
              ┌─────────────────────┐
              │  ACT                │
              │  (a user action OR  │
              │   an MD action OR   │
              │   an external event)│
              └──────────┬──────────┘
                         ▼
              ┌─────────────────────┐
              │  ARTIFACT           │
              │  typed, named,      │
              │  cited, scoped      │
              └──────────┬──────────┘
                         ▼
              ┌─────────────────────┐
              │  SIGNAL             │
              │  joins legibility   │
              │  stream + audit     │
              │  hash-chain         │
              └─────────────────────┘
```

Every act produces an `Artifact` of a known type. Every artifact
joins the legibility stream. Every legibility-stream entry is
queryable by Mr. Mwikila and composable into downstream outputs.

---

## 4. The artifact taxonomy

Existing Borjie schema already has many artifact tables (cognitive
turns, mutation proposals, recipe versions, memory cells, etc.). The
legibility spec **unifies** them under a typed taxonomy and adds the
ones still missing.

The 12 artifact kinds:

| Kind | Source | Existing? |
|---|---|---|
| **`cognitive_turn`** | every chat turn | Yes (Wave 18T) |
| **`mutation_proposal`** | every UI/data/doc/action mutation | Yes (Wave 18S) |
| **`mutation_approval`** | every approve/decline/defer | Yes (Wave 18S) |
| **`recipe_change`** | every lock/improve transition | Yes (Wave 17B/18F) |
| **`junior_lifecycle`** | every draft → shadow → live → locked | Yes (Wave 18V-DYNAMIC) |
| **`memory_promotion`** | every cell promotion/demotion | Yes (Wave 18W) |
| **`know_how_artifact`** | every harvest interview output | Yes (Tacit-Knowledge spec) |
| **`capability_measurement`** | every measure-capability worker run | Yes (Capability-Catalogue spec) |
| **`federation_event`** | every cross-tenant pattern adoption | Yes (Self-Improving Loops §2.4) |
| **`tab_friction_event`** | every tab-as-loop signal | New (Wave 21) |
| **`improvement_proposal`** | every recipe-improvement proposal | New (Wave 21) |
| **`synthesis_artifact`** | every diorize output | New (Wave 22) |

Every artifact kind shares a base shape:

```typescript
export interface LegibilityArtifact<TKind extends ArtifactKind, TPayload> {
  readonly id: string;
  readonly tenant_id: string;
  readonly kind: TKind;
  readonly payload: TPayload;
  readonly created_at: string;
  readonly created_by_actor_id: string;            // user_id OR mr_mwikila OR external_source
  readonly scope_binding: ScopeBinding;            // which org_unit branch
  readonly evidence_citations: ReadonlyArray<SpanCitation>;
  readonly upstream_artifact_ids: ReadonlyArray<string>; // parents
  readonly audit_hash: string;                     // anchor in audit chain
  readonly reusability_tags: ReadonlyArray<ReusabilityTag>;
}
```

The `reusability_tags` field is critical: it labels the artifact for
downstream synthesis ([`INFORMATION_SYNTHESIS_SOTA_SPEC.md`](./INFORMATION_SYNTHESIS_SOTA_SPEC.md)).
Tags include `'reusable_as_training_material'`,
`'reusable_as_corpus_fact'`, `'reusable_as_pattern'`,
`'reusable_as_anti_pattern'`, `'private_to_subject'`, etc.

---

## 5. The legibility stream — the unified read surface

Mr. Mwikila accesses the entire artifact taxonomy through a single
typed read surface:

```typescript
export interface LegibilityStreamReader {
  // Range queries over the typed stream.
  readonly query: <TKind extends ArtifactKind>(params: {
    kind?: TKind | ReadonlyArray<TKind>;
    tenant_id: string;
    scope_id?: string;                             // 'tenant_root' | org_unit_id
    actor_id?: string;
    upstream_of?: string;                          // any artifact upstream from this one
    created_after?: string;
    created_before?: string;
    reusability_tags?: ReadonlyArray<ReusabilityTag>;
    limit: number;
  }) => Promise<ReadonlyArray<LegibilityArtifact<TKind, unknown>>>;

  // Reverse-lookup: from an artifact, walk its provenance.
  readonly walkProvenance: (artifact_id: string) => Promise<ProvenanceWalk>;

  // Semantic search via embedding.
  readonly semanticSearch: (params: {
    query_text: string;
    tenant_id: string;
    scope_id?: string;
    kind_filter?: ReadonlyArray<ArtifactKind>;
    top_k: number;
  }) => Promise<ReadonlyArray<{ artifact: LegibilityArtifact<ArtifactKind, unknown>; similarity: number }>>;

  // Stream subscription (server-sent events).
  readonly subscribe: (params: {
    tenant_id: string;
    kind_filter?: ReadonlyArray<ArtifactKind>;
  }) => AsyncIterable<LegibilityArtifact<ArtifactKind, unknown>>;
}
```

The reader is consumed by:

- The cognitive engine ([`COGNITIVE_ENGINE_SPEC.md`](./COGNITIVE_ENGINE_SPEC.md))
  as the primary "what does Mr. Mwikila know" source.
- The meta-learning conductor ([`SELF_IMPROVING_LOOPS_SPEC.md`](./SELF_IMPROVING_LOOPS_SPEC.md) §2.5)
  for weekly audits.
- The information synthesis layer ([`INFORMATION_SYNTHESIS_SOTA_SPEC.md`](./INFORMATION_SYNTHESIS_SOTA_SPEC.md))
  as the input substrate for diorize.
- The on-demand internal software generator ([`ON_DEMAND_INTERNAL_SOFTWARE_SPEC.md`](./ON_DEMAND_INTERNAL_SOFTWARE_SPEC.md))
  to source data for generated tools.
- The owner's morning briefing ([`AUTONOMOUS_LOOPS_SPEC.md`](./AUTONOMOUS_LOOPS_SPEC.md) §1).
- Audit and compliance review surfaces.

---

## 6. The audit-hash chain extension

Wave 6 shipped the audit-hash chain primitive. This spec extends it
with two new requirements:

### 6.1 Every artifact MUST anchor

The audit-chain head advances every time *any* legibility artifact
writes. No artifact bypasses. The existing
`audit_hash_chain.appendBlock(events: AuditEvent[])` accepts the new
artifact kinds.

### 6.2 The chain MUST be verifiable forward from genesis

A regulator (or the owner) can replay the chain from `audit_hash_0`
forward and confirm every artifact's `audit_hash` matches. The
verification CLI ships with Wave 21:

```bash
$ borjie audit verify --from-genesis --tenant TENANT_ID
✓ Block 0 (genesis): OK
✓ Block 1 (1 artifact): OK
...
✓ Block 12483 (47 artifacts): OK
Audit chain VERIFIED. Head: abc123...
Total artifacts: 4,891,203.
Earliest: 2026-01-15T08:21:33Z. Latest: 2026-05-26T22:14:08Z.
```

---

## 7. Privacy + scope constraints

Legibility is not surveillance. Three constraints govern what the
owner can see vs. what Mr. Mwikila can read:

### 7.1 Subject-of-the-action privacy

If an artifact's subject is a specific employee or customer, the
artifact's `reusability_tags` may include `'private_to_subject'`. Such
artifacts:

- Are readable by Mr. Mwikila for **that subject's own session**.
- Are aggregated (counts only) for the owner's morning briefing.
- Are not federated cross-tenant.
- Are not included in synthesis outputs that have a broader audience.

Example: a daily check-in for Joseph is private to Joseph. The owner
sees that Joseph's streak is 5 days; the owner does not see Joseph's
specific concerns.

### 7.2 Scope-binding inheritance

An artifact created in a district org-unit branch is readable by Mr.
Mwikila when scoped to that district or root. Other districts cannot
read it. The existing
[`ORG_HIERARCHY_TERMINOLOGY_SPEC.md`](./ORG_HIERARCHY_TERMINOLOGY_SPEC.md)
scope binding governs.

### 7.3 Owner override-with-record

The owner can explicitly request access to subject-private artifacts.
The request itself becomes a `legibility_access_request` artifact in
the chain; the subject is notified; the access is time-bound (default
30 days); the audit shows the access pattern. This is the
*regulator-grade access control* discipline Wave 6 set up.

---

## 8. The legibility KPIs

Three measurements drive the legibility track of the `ORG_AI_NATIVENESS_INDEX`
([`AI_NATIVE_OS_MASTER.md`](../STRATEGY/AI_NATIVE_OS_MASTER.md) §10):

```typescript
export interface LegibilityKPIs {
  // % of platform actions producing typed artifacts
  readonly action_to_artifact_ratio: number;       // target ≥ 0.95

  // % of artifacts that the audit chain seals successfully
  readonly artifact_anchor_ratio: number;          // target ≥ 0.99

  // % of artifact corpus participating in diorize synthesis
  readonly diorize_coverage_ratio: number;         // target ≥ 0.80
}
```

A target tenant at month 12: `0.97 × 0.99 × 0.85 ≈ 0.82` overall
legibility — passing the 80% threshold the master vision sets.

---

## 9. SOTA landscape — 2026 references

- **James C. Scott — *Seeing Like a State*** ([Wikipedia](https://en.wikipedia.org/wiki/Seeing_Like_a_State),
  [Wise Words summary](https://wisewords.blog/book-summaries/seeing-like-a-state-book-summary/),
  [Centre for Public Impact essay on imposed legibility](https://medium.com/centre-for-public-impact/the-il-logic-of-legibility-why-governments-should-stop-simplifying-complex-systems-f8822752d753))
  — the canonical legibility text. Borjie inverts the politics
  (owner-side, not state-side) but inherits the discipline of preserving
  mētis.
- **Ribbonfarm — *A Big Little Idea Called Legibility*** ([essay](https://ribbonfarm.com/2010/07/26/a-big-little-idea-called-legibility/))
  — the cleanest contemporary frame.
- **Umbrex / Tools for Thinking — *What is Legibility?*** ([explainer](https://umbrex.com/resources/tools-for-thinking/what-is-legibility/))
  — the management-consulting-grade summary.
- **Modern data observability** (Monte Carlo, Acceldata, Bigeye,
  Soda) — the infra discipline Borjie ports to org-state. Every act
  is a row; every row carries freshness + lineage + quality scores;
  every anomaly fires an alert.

---

## 10. How this connects to existing Borjie architecture

- **Mutation Authority** [`MUTATION_AUTHORITY_SPEC.md`](./MUTATION_AUTHORITY_SPEC.md):
  the WRITE-side already produces typed mutation proposals; legibility
  generalises the pattern to ALL actions, not just mutations.
- **Universal Observability** [`UNIVERSAL_OBSERVABILITY_SPEC.md`](./UNIVERSAL_OBSERVABILITY_SPEC.md):
  the READ tiers are the *substrate* this spec writes onto.
- **Unified Cognitive Memory** [`UNIFIED_COGNITIVE_MEMORY_SPEC.md`](./UNIFIED_COGNITIVE_MEMORY_SPEC.md):
  every memory cell is a legibility artifact; the legibility stream
  is the corpus the memory cells synthesise from.
- **Tacit Knowledge Harvesting** [`TACIT_KNOWLEDGE_HARVESTING_SPEC.md`](./TACIT_KNOWLEDGE_HARVESTING_SPEC.md):
  every `KnowHowArtifact` is the mētis-preserving artifact class.
- **Cognitive Engine** [`COGNITIVE_ENGINE_SPEC.md`](./COGNITIVE_ENGINE_SPEC.md):
  every cognitive turn is a legibility artifact (already shipped Wave
  18T).
- **Five-Layer Loop** [`FIVE_LAYER_LOOP_ARCHITECTURE.md`](./FIVE_LAYER_LOOP_ARCHITECTURE.md):
  every loop run is itself a legibility artifact; the gate verdicts
  attach.
- **Audit Hash Chain** (Wave 6, `@borjie/audit-hash-chain`): the
  cryptographic substrate the legibility stream rides on.

---

## 11. Anti-patterns

1. **Undocumented action.** Any platform action — UI click, MD
   compose, mutation, federation event, recipe change — that does
   not produce a typed artifact is **a legibility leak**. Every
   action handler MUST `appendLegibilityArtifact()` before returning.
2. **Lost decision.** A decision (approve / decline / defer) that
   does not write a `mutation_approval` artifact loses the *reasoning
   chain*. The decision must be a typed artifact with `upstream_artifact_ids`
   pointing to the proposal it answered.
3. **PII-in-corpus**. An artifact tagged `'private_to_subject'` that
   leaks into a non-private synthesis output is a privacy regression.
   The synthesis layer MUST filter on `reusability_tags`.
4. **Audit chain branch.** The audit chain is a single forward chain
   per tenant. Branching (two independent chains) violates the
   verification contract. Use one chain per tenant; cross-tenant
   federation rides a separate platform-chain.
5. **Owner access without record.** The owner reading a subject-
   private artifact MUST write a `legibility_access_request`
   artifact first. No silent access.
6. **Re-purposing artifacts without re-tagging.** An artifact that
   moves from internal-use to public-use must have its
   `reusability_tags` updated through a typed transition. The
   transition itself is an artifact (`artifact_retag`).
7. **Stale legibility.** An artifact older than 180 days that has not
   been read by Mr. Mwikila or accessed by anyone may decay (per
   memory-cell decay rules) but the underlying audit-chain entry
   never deletes. Decay affects the cognitive-memory cache; the
   audit chain is immutable.

---

## 12. Phase 2 implementation map

- **New package** `packages/legibility/` (≈1100 LOC):
  - `artifact-taxonomy.ts` (the 12 artifact kinds + base type).
  - `legibility-stream-reader.ts` (the unified read surface).
  - `audit-chain-extension.ts` (extends `@borjie/audit-hash-chain`).
  - `reusability-tagger.ts` (auto-tags artifacts on write).
  - `privacy-policy.ts` (subject-private + scope-binding enforcement).
- **Migration** `0037_org_legibility.sql`:
  - `legibility_artifacts` table — the unified write surface
    (existing artifact tables also register here via triggers).
  - `legibility_access_requests` table — owner override-with-record.
  - `legibility_artifact_taxonomy` table — kind catalogue.
- **CLI tool** `bin/borjie-audit` — verify chain forward from genesis.
- **Existing services update:**
  - Every `appendBlock(events)` call wraps with the legibility writer.
  - Cognitive engine, mutation authority, recipe lock/improve,
    memory cell promotion — all already emit artifacts; this wave
    unifies their schemas.
- **Estimated effort:** 6 weeks (most effort in migration of existing
  artifact emitters to the unified shape).

---

## 13. Cross-reference to siblings

- Master vision: [`AI_NATIVE_OS_MASTER.md`](../STRATEGY/AI_NATIVE_OS_MASTER.md)
  §5 (the legibility principle).
- Information synthesis: [`INFORMATION_SYNTHESIS_SOTA_SPEC.md`](./INFORMATION_SYNTHESIS_SOTA_SPEC.md)
  — primary consumer of the legibility stream.
- On-demand internal software: [`ON_DEMAND_INTERNAL_SOFTWARE_SPEC.md`](./ON_DEMAND_INTERNAL_SOFTWARE_SPEC.md)
  — generated tools query the legibility stream for their data.
- Strategic direction: [`STRATEGIC_DIRECTION_LAYER_SPEC.md`](./STRATEGIC_DIRECTION_LAYER_SPEC.md)
  — strategic memos compose over the legibility stream + market
  research.
- Tab-as-loop: [`TAB_AS_LOOP_SPEC.md`](./TAB_AS_LOOP_SPEC.md) —
  every tab-loop event is a legibility artifact.
- Five-layer loop: [`FIVE_LAYER_LOOP_ARCHITECTURE.md`](./FIVE_LAYER_LOOP_ARCHITECTURE.md) — every gate verdict joins the stream.
- 24/7 work cycle: [`CONTINUOUS_24_7_WORK_CYCLE_SPEC.md`](./CONTINUOUS_24_7_WORK_CYCLE_SPEC.md) — every inbound event is an artifact.
- Daily user follow-up: [`DAILY_USER_FOLLOWUP_SPEC.md`](./DAILY_USER_FOLLOWUP_SPEC.md) — the per-user thread state aggregates from the stream.
- Guide vs Learn: [`GUIDE_VS_LEARN_MODE_SPEC.md`](./GUIDE_VS_LEARN_MODE_SPEC.md) — mode toggles are artifacts.

---

*The org becomes a living spec of itself. No knowledge missed. No
action unanalysed. The audit chain is the documentation. The
documentation is the audit chain.*

---

## 14. Wave M6 — The Live Legibility Map

> Status: Wave M6. Companion to migration
> `packages/database/drizzle/0037_org_legibility.sql` and package
> `@borjie/legibility`. The first eleven sections describe the
> *stream* — every action emitting a typed artifact. Wave M6 adds the
> **live, queryable, brand-locked map** that the owner, Mr. Mwikila,
> and the dispatch router all read from.

The stream answers *"what just happened?"*. The **map** answers four
operational questions that arise dozens of times per hour:

1. *Who* in the org currently owns mine KAH-088, and what is their
   current state?
2. *Which* of the spawned juniors are routed to that mine right now,
   and what capability does each carry?
3. *What* mutation proposals are in flight for this scope, and what
   blocks resolution?
4. *Where* (in the org-unit tree) is capacity overloaded right now?

The map is **derived state** — assembled from the legibility stream
plus the org-scope hierarchy, the (private) junior registry, and the
capability catalogue. It is rebuilt on event arrival (the fast path)
and reconciled every 5 minutes (the safety net). End-users see a
brand-locked rendering; internal callers (Mr. Mwikila, dispatch
router) get the full typed object.

The pattern is now industry standard. Anthropic's
["Org tools" on Claude.ai](https://www.anthropic.com/news/claude-for-enterprise-org-tools)
(2025-09) lets admins query *who owns what knowledge*. Linear's
["Active issues across the org"](https://linear.app/blog/active-issues)
(2025-07-22) is a per-team live view of in-flight work. Notion's
[graph view](https://www.notion.com/releases/2025-11-06) (2025-11-06)
exposes the live relationships between databases. Glean's
[Knowledge Graph](https://www.glean.com/blog/glean-knowledge-graph)
(2025-04) keeps a live people × content × activity index. Borjie's
contribution is to **add the agent layer** — the spawned juniors and
their in-flight reasoning — to the same map, behind the persona of
Mr. Mwikila so the worker / customer never sees junior names.

---

## 15. Legibility map schema

The map is a typed tuple of five orthogonal axes:

```ts
interface LegibilityMap {
  readonly tenantId: string;
  readonly scopeId: string;            // org-scope tree node
  readonly assembledAt: string;        // ISO timestamp
  readonly people:        ReadonlyArray<PersonNode>;
  readonly roles:         ReadonlyArray<RoleEdge>;
  readonly scopes:        ReadonlyArray<ScopeNode>;
  readonly capabilities:  ReadonlyArray<CapabilityRef>;
  readonly currentWork:   ReadonlyArray<WorkItem>;
  readonly auditHash:     string;
}
```

**Axes**:

- `people` — owners + workers + customers in this scope. *Juniors are
  never in this array*; they are a separate internal axis (see §17).
- `roles` — `{ personId, role, scopeId, since }` edges. A person can
  hold multiple roles in multiple scopes.
- `scopes` — the org-unit subtree rooted at `scopeId` (from
  `@borjie/org-scope`).
- `capabilities` — `{ capabilityId, version, owner, status }` —
  what's currently live in this scope (e.g. `kyb_run.v7`,
  `tumemadini_filing.v3`).
- `currentWork` — in-flight items: `{ subject, kind, owner,
  startedAt, blocker? }`. Joined from `mutation_proposals`,
  `coordination_conflicts`, `active_agents` (all from earlier waves).

A snapshot of the map is persisted in `legibility_snapshots`
(jsonb). Each event-arrival that mutates the map writes a
`legibility_deltas` row; the snapshot is rebuilt by applying deltas
forward from the last snapshot.

---

## 16. Refresh cadence — event-driven + reconciliation

Two refresh paths run side by side:

**Fast path — event-driven (sub-second).** Every artifact emitter from
§4 publishes a typed event onto the legibility event bus. The map
builder subscribes and applies the delta in-process. Latency budget:
`p95 < 250ms` from artifact insert to map updated.

**Safe path — 5-min reconciliation.** A cron job rebuilds the
snapshot from authoritative source-of-truth (the canonical tables in
each domain package: `org_units`, `user_scope_bindings`,
`active_agents`, `mutation_proposals`, `legibility_artifacts`). The
reconciled snapshot is compared with the last fast-path snapshot; on
divergence, the slow path wins and a `reconciliation.divergence`
event is emitted for the owner inbox. This is the same dual-clock
pattern as
[Linear's reconciliation loop](https://linear.app/blog/scaling-the-linear-sync-engine)
(2025-04) and
[Datadog's event reconciliation](https://www.datadoghq.com/blog/event-reconciliation/)
(2024-08).

---

## 17. The internal-vs-external axis (persona separation)

Mr. Mwikila — the persona presented to humans — must **never** expose
junior names through the public map. The schema enforces this by
having two views:

```ts
// Public — what owner / worker / customer sees
interface PublicLegibilityMap extends LegibilityMap { /* as §15 */ }

// Internal — what dispatch router + the brain see
interface InternalLegibilityMap extends LegibilityMap {
  readonly juniors:       ReadonlyArray<JuniorAssignment>;
  readonly juniorRoutes:  ReadonlyArray<JuniorRouteEdge>;
}
```

The repository layer returns `PublicLegibilityMap` by default.
Internal callers ask explicitly via `getInternalMap()` and the call
is itself a logged artifact. The Mr. Mwikila persona contract from
[`AI_NATIVE_OS_MASTER.md`](../STRATEGY/AI_NATIVE_OS_MASTER.md) §4.3
requires that no junior-shaped string ever crosses to a non-internal
surface; the legibility package enforces this in code, not policy.

---

## 18. Query API

The query layer accepts a filterable, projection-shaped query and
returns the projected slice. The public surface lives in
`packages/legibility/src/queries/query-runner.ts`.

```ts
interface LegibilityQuery {
  readonly tenantId: string;
  readonly scopeId?: string;             // default: tenant root
  readonly axes?: ReadonlyArray<       // default: all
    'people'|'roles'|'capabilities'|'currentWork'
  >;
  readonly filter?: {
    role?: OrgRole;
    capabilityId?: string;
    workSubject?: { kind: string; id: string };
    activeOnly?: boolean;
  };
  readonly internal?: boolean;          // requires elevated caller
}
```

The runner walks the latest snapshot, applies in-memory filters,
projects to the requested axes, and returns an immutable result. For
queries that touch the **internal** axis, the runner requires the
caller to present an `InternalCallerCtx` token; without it the
juniors axis is stripped before return.

Typical queries:

- *"Who owns mine KAH-088 today?"* → `{ scopeId: 'kahama/mine-088',
  axes: ['people','roles'], filter: { role: 'owner' } }`.
- *"What capabilities are live in the Tabora district?"* →
  `{ scopeId: 'tabora', axes: ['capabilities'] }`.
- *"What work is in flight that's blocked?"* → `{ axes:
  ['currentWork'], filter: { activeOnly: true } }` and then filter on
  `blocker != null` client-side.

---

## 19. Brand-locked rendering

Every render of the map for a human surface runs through the
brand-lock pass from `@borjie/ephemeral-ui`
(`brandLockPass` — Wave 18FF). The pass:

- Replaces internal IDs with human-legible terminology from
  `@borjie/org-scope` (e.g. `tabora` → "Tabora District").
- Strips technical noise (audit hashes, internal proposal ids).
- Enforces the Borjie typeface + colour tokens.
- Localises strings via `resolveTerminologyForScope` so a Mwanza
  operator sees "Mwanyamala" while a Dar operator sees the
  district-specific terms.
- Hides any axis the caller is not authorised to see (and logs the
  hiding decision as an artifact).

The brand-lock pass is **mandatory** on all human surfaces; it is
*skipped* only for `internal=true` query callers, in which case the
raw structured data is returned for machine consumption.

---

## 20. M6 implementation map

- **Package** `@borjie/legibility` — types + builder + queries + repos.
- **Migration** `0037_org_legibility.sql` — `legibility_snapshots`
  + `legibility_deltas`.
- **Drizzle schema** `packages/database/src/schemas/org-legibility.schema.ts`.
- **Builder deps** — the snapshot builder accepts an opaque
  `BuilderDeps` shape: `{ orgScopeRepo, juniorRepo?, capabilityRepo?,
  legibilityArtifactReader }`. The package does **not** hard-import
  the junior or capability packages (they may not exist at build
  time); structural compatibility only.
- **Render adapter** (planned M6.1) — wires `brand-lock-pass` from
  `@borjie/ephemeral-ui` into the chat-ui + dynamic-ui renderers.

The package ships pure logic + in-memory repository + a fully typed
SQL repository contract. The database package wires the live Drizzle
adapter so the cycle is avoided.

---

## 21. References (M6)

- [Anthropic — Claude for Enterprise org tools](https://www.anthropic.com/news/claude-for-enterprise-org-tools) (2025-09).
- [Linear — Active issues across the org](https://linear.app/blog/active-issues) (2025-07-22).
- [Linear — Scaling the Linear Sync Engine](https://linear.app/blog/scaling-the-linear-sync-engine) (2025-04).
- [Notion — Graph view](https://www.notion.com/releases/2025-11-06) (2025-11-06).
- [Glean — Knowledge Graph](https://www.glean.com/blog/glean-knowledge-graph) (2025-04).
- [Datadog — Event reconciliation](https://www.datadoghq.com/blog/event-reconciliation/) (2024-08).
- [James C. Scott — Seeing Like a State (Yale, 1998)](https://en.wikipedia.org/wiki/Seeing_Like_a_State).
- [Ribbonfarm — A big little idea called legibility](https://ribbonfarm.com/2010/07/26/a-big-little-idea-called-legibility/) (2010-07-26).
