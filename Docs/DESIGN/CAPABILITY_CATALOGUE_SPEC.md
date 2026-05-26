# Capability Catalogue — Design Specification

> Pillar 3 of [`CAPABILITY_BOOST_VISION.md`](../STRATEGY/CAPABILITY_BOOST_VISION.md).
> Sibling specs:
> [`OMNIDATA_CONNECTOR_INVENTORY.md`](./OMNIDATA_CONNECTOR_INVENTORY.md),
> [`TACIT_KNOWLEDGE_HARVESTING_SPEC.md`](./TACIT_KNOWLEDGE_HARVESTING_SPEC.md),
> [`SELF_IMPROVING_LOOPS_SPEC.md`](./SELF_IMPROVING_LOOPS_SPEC.md),
> [`MASTER_BRAIN_AUTONOMY_MANIFESTO.md`](../MASTER_BRAIN_AUTONOMY_MANIFESTO.md).

Brand: Borjie. Persona: Mr. Mwikila — Borjie's autonomous Managing
Director for Tanzanian mining operators. Status: design-spec.

---

## 1. The Thesis — Capabilities Are Measurable

Existing AI-maturity literature (cf. [larridin.com — AI Maturity 2026](https://larridin.com/solutions/ai-maturity-the-complete-enterprise-guide-2026),
[thinking.inc — 5 stages](https://thinking.inc/en/pillar-pages/ai-maturity-model/),
[hyscaler.com — AI Maturity Model 2026](https://hyscaler.com/insights/ai-maturity-model/))
measures *organisations* on aggregate AI maturity. Borjie inverts the
unit: we measure **discrete capabilities**, not organisational stages.
An organisation does not "have AI maturity Stage 3"; it has — or
fails to have — the capability to file a Tumemadini return in under
ten minutes with 0.99 accuracy at $0.04 per invocation. That is a
shippable, testable, observable property. Either the tenant can do it,
or it cannot.

The shift matters. Maturity models tell the owner *where they are*.
A capability catalogue tells the owner *what they can do, what they
cannot, and what is changing this week*. The catalogue is the
**operational surface** of capability boost: every gap in the
catalogue is an opportunity; every improvement is a celebration; every
weekly briefing references the catalogue.

The founder's brief implies this directly:

> "Think intelligent AI-powered organisation with AI-native software."

The intelligent organisation knows its own capabilities. The
capability catalogue is the artefact that makes the organisation
self-aware.

The 2026 AI-maturity research itself flags the same gap:

> "A key limitation of existing models is that they're organisational-
> level assessments that miss granular variation — an enterprise
> doesn't have a single maturity level, as different teams may be at
> different stages."
> — [larridin.com / AI Maturity Measurement](https://larridin.com/blog/ai-maturity-measurement)

The catalogue is exactly the granular variation.

---

## 2. The `OrgCapability` Model

```typescript
export interface OrgCapability {
  readonly id: string;                              // 'file_tumemadini_return'
  readonly tenant_id: string;
  readonly name: string;
  readonly description: string;
  readonly domain: CapabilityDomain;
  readonly required_inputs: ReadonlyArray<CapabilityInput>;
  readonly required_actors: ReadonlyArray<ActorRole>;
  readonly required_know_how: ReadonlyArray<KnowHowRequirement>;
  readonly measurement: CapabilityMeasurement;
  readonly gap_analysis: CapabilityGap | null;
  readonly dependencies: ReadonlyArray<string>;     // other capability ids
  readonly value_estimate_usd: number;              // $ impact if achieved
  readonly priority_tier: 'must' | 'should' | 'nice';
  readonly created_at: string;
  readonly last_measured_at: string;
  readonly audit_hash: string;
}

export type CapabilityDomain =
  | 'regulatory'      // Tumemadini, NEMC, TRA, BoT, GePG
  | 'commercial'      // buyer relationships, pricing, sales
  | 'operational'     // production, shift mgmt, equipment
  | 'financial'       // accounting, treasury, FX
  | 'compliance'      // EHS, audit, governance
  | 'marketing'       // brand, social, comms
  | 'people'          // hiring, retention, training
  | 'strategic';      // M&A, expansion, capital

export interface CapabilityInput {
  readonly kind: 'data_source' | 'document_template' | 'connector' | 'know_how_artifact';
  readonly reference_id: string;
  readonly required: boolean;
}

export interface ActorRole {
  readonly role_tag: string;       // 'mine_surveyor' | 'site_supervisor' | etc.
  readonly autonomy_tier: 'autonomous' | 'staged' | 'execute';
}

export interface KnowHowRequirement {
  readonly kind: KnowHowKind;
  readonly tag: string;            // e.g. 'tumemadini_filing_procedure'
  readonly minimum_artifacts: number;
}

export interface CapabilityMeasurement {
  readonly achievability: AchievabilityLevel;
  readonly speed_p50_minutes: number;
  readonly speed_p95_minutes: number;
  readonly accuracy_pct: number;
  readonly cost_per_invocation_usd: number;
  readonly invocations_last_30d: number;
  readonly success_rate_30d: number;
  readonly last_measured_at: string;
  readonly measurement_method: 'observed' | 'shadow' | 'declared';
}

export type AchievabilityLevel =
  | 'not_yet'             // capability does not exist
  | 'manual_only'         // human handles end-to-end
  | 'partial_ai_assist'   // AI helps; human runs
  | 'fully_ai_assisted'   // AI runs; human approves
  | 'autonomous';         // AI runs end-to-end within delegated authority

export interface CapabilityGap {
  readonly id: string;
  readonly missing_inputs: ReadonlyArray<CapabilityInput>;
  readonly missing_know_how: ReadonlyArray<KnowHowRequirement>;
  readonly missing_actors: ReadonlyArray<ActorRole>;
  readonly recommended_actions: ReadonlyArray<RecommendedAction>;
  readonly estimated_close_effort: 'low' | 'medium' | 'high';
}

export interface RecommendedAction {
  readonly kind: 'install_connector' | 'run_interview' | 'compose_template' | 'hire_role';
  readonly target_id: string;
  readonly rationale: string;
}
```

This is the operational atom. Every capability in the catalogue is a
typed record with measurable properties. The catalogue at any moment
is a queryable, sortable, exportable list — the owner can ask
*"what are my top 5 capability gaps by value estimate?"* and get a
deterministic, citation-anchored answer.

---

## 3. Capability Emergence — How New Capabilities Appear

Capabilities are not authored manually by a product team. They emerge
continuously from three sources:

### 3.1 Backwards-Derived From Successful Task Completions

When a tenant completes a task end-to-end (e.g. owner approves a
Tumemadini filing the MD drafted), the post-action audit-chain entry
includes a `task_signature`: the combination of input data sources,
know-how artifacts referenced, actors involved, the time taken, and
the outcome. The capability-emergence worker
(`services/capability-measurement-worker/`) inspects new completions
and, if it sees a signature it has not catalogued, proposes a new
`OrgCapability` for the tenant. The owner can confirm, edit, or
reject the proposal in the catalogue UI.

This is **observed** measurement — the measurement floor is real
production data, not lab benchmarks.

### 3.2 Stitched From Omnidata + Tacit Knowledge

When omnidata ingestion + tacit-knowledge harvesting cross a threshold
of coverage — e.g. the tenant now has a Salesforce connector + the
buyer-rep has been interviewed + a `relationship` artifact pool of
≥30 — Mr. Mwikila proposes a new capability: *"You now have the
substrate to run buyer-segmentation-by-provenance-preference."* The
owner enables; the capability is added to the catalogue with
`achievability = 'not_yet'`; the measurement worker runs the first
shadow invocation in the background to set a baseline.

### 3.3 External Research

The deep-research loop ([`DEEP_RESEARCH_SPEC.md`](./DEEP_RESEARCH_SPEC.md))
scans industry literature, competitor disclosures, and regulator
guidance for capability mentions. *"Three of your peer tenants now
run forward-sale hedging with smelter X — do you?"* If no, surface
as a gap with `priority_tier = 'should'` and an estimated value.

---

## 4. Gap Surfacing — How Owners See What They're Missing

Capabilities with `gap_analysis ≠ null` are surfaced through three
channels:

1. **Morning Briefing** — the manifesto's Daily Research Loop pulls
   the top 3 gaps by value-estimate × close-effort and surfaces them
   as "Today's capability opportunities". Each comes with a one-tap
   action: *install this connector*, *run this interview*, *compose
   this template*.
2. **Capability Catalogue Dashboard** — owner-facing surface (see §5).
3. **In-Flow Triggers** — when the owner is mid-task and Mr. Mwikila
   detects an adjacent missing capability, surface a `ProactiveHint`
   ("By the way, you also lack the EIA-renewal capability for this
   site — want me to draft a path?").

---

## 5. The Owner-Facing Catalogue Dashboard

Surface lives at `apps/owner-dashboard/src/capabilities/`. Renders:

- **Capability Heatmap** — a grid of all capabilities for the tenant,
  coloured by `achievability` (red = not_yet, yellow = manual_only,
  amber = partial_ai_assist, green = fully_ai_assisted, dark green =
  autonomous). Filtering by domain, by priority tier, by value.
- **Capability Detail Page** — for each capability, shows the
  measurement (speed / accuracy / cost / invocation count over time),
  the gap analysis if any, the recommended actions, the dependencies,
  the contributing know-how artifacts, the contributing omnidata
  connectors, and the audit-chain trail.
- **Gap Backlog** — sortable list of open gaps with one-tap actions.
- **Weekly Changes** — diff view: what capabilities moved
  achievability tiers this week.

Charts use the existing `genui` block surface (see
`packages/genui/src/blocks/`). Capability trend lines use the
existing `arrears-projection-chart` style.

---

## 6. Measurement — How Capabilities Get Scored

The measurement worker
(`services/capability-measurement-worker/`) runs hourly. Per
capability:

- **Observed mode (default):** scan the last 30 days of completion
  records in the audit chain; compute speed p50 / p95, accuracy
  (compared to ground truth where it exists; otherwise from
  owner-confirmed outcomes), cost per invocation, success rate.
- **Shadow mode:** for capabilities with low invocation counts, run
  a daily shadow invocation against a synthetic input drawn from the
  capability's `RegressionFixture` set. Measure latency + a regression
  match against the known good output. Used to detect silent regressions.
- **Declared mode:** for capabilities the owner has confirmed as
  externally executed (e.g. *"my CFO does this manually"*), record the
  owner's declared metrics; revisit with a periodic prompt to
  reconfirm.

Every measurement event writes a `capability_measurements` row and
anchors in the audit chain.

---

## 7. Capability Composition — Building Big From Small

Capabilities form a dependency graph. *"Run a board-pack composition"*
depends on *"reconcile FX against BoT"*, *"compute royalty due"*,
*"summarise top 3 production deltas"*, *"draft an executive narrative"*.
The catalogue UI surfaces the graph — owners can drill down from a
high-level capability into its component capabilities, see which
sub-capability is the weakest link, and target the gap closure there.

Composition is **typed**: a composite capability declares its
sub-capability ids in `dependencies`. The measurement worker
propagates failures upward — if `reconcile_fx_against_bot` regresses,
the composite `compose_board_pack` capability surfaces as at-risk
even before its own measurement updates.

---

## 8. Anti-Patterns

Mr. Mwikila MUST NOT:

1. **Declare a capability without measurement.** Every catalogue
   entry must have at least a shadow-mode baseline measurement.
   "We think we can do X" is not a capability.
2. **Hide capability regressions from the owner.** Achievability tier
   downgrades are flagged in the morning brief.
3. **Conflate capability with usage.** A capability the owner does not
   use is still a capability; the catalogue records both achievability
   and 30-day invocation count separately.
4. **Surface low-value gaps prominently.** The gap backlog is sorted
   by value-estimate × close-effort; trivial gaps stay quiet.
5. **Catalogue capabilities the tenant has not consented to track.**
   Some capabilities touch sensitive areas (e.g. personnel performance
   evaluation). The owner explicitly enables those domains; default off.
6. **Use one tenant's capability data for another tenant's
   benchmark without consent.** Cross-tenant benchmarking (the
   "your peer tenants do X" research signal) uses only
   differential-privacy aggregates from federation
   ([`SELF_IMPROVING_LOOPS_SPEC.md`](./SELF_IMPROVING_LOOPS_SPEC.md)).

---

## 9. Schema Additions

Migration `0031_capability_catalogue.sql`:

- `org_capabilities` — per §2 schema. PK `id`. RLS by `tenant_id`.
- `capability_measurements` — append-only measurement events per
  capability. `(tenant_id, capability_id, measured_at DESC)` index.
- `capability_gaps` — current open gaps (one row per open gap; closed
  gaps tombstoned with `closed_at`).
- `capability_dependencies` — adjacency table; `(parent_id, child_id)`.

Indexes: `(tenant_id, domain, priority_tier)`, `(tenant_id, achievability)`,
`(tenant_id, value_estimate_usd DESC)`.

Audit-chain hooks: every catalogue mutation (capability create,
measurement insert, gap-close, achievability upgrade / downgrade)
appends to the tenant's chain.

---

## 10. Persona-Kernel Tools

The catalogue exposes the following persona-kernel tools (per the
existing `packages/ai-copilot/src/personas/` contract):

- `list_capabilities_v1({ domain?, priority_tier?, achievability? })`
  → `ReadonlyArray<OrgCapability>`.
- `describe_capability_v1({ capability_id })` → full detail view.
- `measure_capability_v1({ capability_id, mode: 'observed' | 'shadow' })`
  → triggers a fresh measurement.
- `close_capability_gap_v1({ capability_id, action_id })` →
  executes a recommended action (e.g. install a connector,
  schedule an interview) under Tier-1 staging or Tier-2 approval.
- `propose_capability_v1({ name, description, signature })` →
  surface a candidate new capability for owner confirmation.

These wire into Mr. Mwikila's `availableTools` array.

---

## 11. Cross-Spec Integration Map

- **Omnidata:** capability `required_inputs` include connector
  `reference_id`s. A missing connector becomes a `RecommendedAction`
  of kind `install_connector`.
- **Tacit knowledge:** capability `required_know_how` references
  `KnowHowKind` + tags. A missing know-how pool becomes a
  `RecommendedAction` of kind `run_interview`.
- **Self-improving loops:** the per-recipe loop and meta-learning
  conductor read the catalogue to identify *classes* of weakness
  ("the tenant's regulatory-domain capabilities have average
  achievability 'manual_only' — propose a strategy").
- **Cognitive engine:** every capability invocation routes through
  the cognitive loop; the measurement worker reads the resulting
  reasoning trace + confidence score as part of its accuracy
  computation.
- **Mutation authority:** Tier-2 owner-approval flows write the
  outcome (approved / declined / executed-and-reverted) into the
  capability measurement record.
- **Anticipatory UX:** the next-3-moves predictor uses the catalogue
  to choose what to pre-stage — only capabilities at
  `partial_ai_assist` or above are eligible for pre-staging.

The catalogue is what turns Mr. Mwikila from a chat surface into an
**operational instrument**. The owner does not chat with an AI; the
owner runs a business whose capabilities are visible, measured,
ranked, and improving — with Mr. Mwikila as the engine that closes
the gaps.
