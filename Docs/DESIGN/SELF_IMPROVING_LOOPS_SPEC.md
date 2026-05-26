# Self-Improving Loops — Design Specification

> Pillar 4 of [`CAPABILITY_BOOST_VISION.md`](../STRATEGY/CAPABILITY_BOOST_VISION.md).
> Sibling specs:
> [`OMNIDATA_CONNECTOR_INVENTORY.md`](./OMNIDATA_CONNECTOR_INVENTORY.md),
> [`TACIT_KNOWLEDGE_HARVESTING_SPEC.md`](./TACIT_KNOWLEDGE_HARVESTING_SPEC.md),
> [`CAPABILITY_CATALOGUE_SPEC.md`](./CAPABILITY_CATALOGUE_SPEC.md),
> [`MASTER_BRAIN_AUTONOMY_MANIFESTO.md`](../MASTER_BRAIN_AUTONOMY_MANIFESTO.md),
> [`UNIFIED_COGNITIVE_MEMORY_SPEC.md`](./UNIFIED_COGNITIVE_MEMORY_SPEC.md),
> [`JUNIOR_DYNAMIC_SPAWNING_SPEC.md`](./JUNIOR_DYNAMIC_SPAWNING_SPEC.md).

Brand: Borjie. Persona: Mr. Mwikila — Borjie's autonomous Managing
Director for Tanzanian mining operators. Status: design-spec.

---

## 1. The Thesis — The MD Identifies + Closes His Own Gaps

The founder's brief, verbatim:

> "Literal self-improving AI loops from the ground up."

The 2026 academic literature confirms the architecture is now
operational, not theoretical. [Arxiv 2506.05109 — *Truly
Self-Improving Agents Require Intrinsic Metacognitive Learning*](https://arxiv.org/pdf/2506.05109)
names the discipline: an agent's intrinsic ability to actively
evaluate, reflect on, and adapt its own learning processes.
[Arxiv 2508.00271 — MetaAgent](https://arxiv.org/pdf/2508.00271)
operationalises this through tool meta-learning, self-reflection, and
answer-verification cycles. The Borjie kernel already runs four of the
five loops described below; this spec names them, formalises the
fifth (meta-learning), and binds them to the owner-visible weekly
self-improvement report that makes the regime accountable.

What makes Borjie's self-improvement different from prior art is
**owner transparency**. Self-improving systems that hide their
improvement from the principal violate the manifesto's "Cite or Stay
Silent" principle. Mr. Mwikila does not get smarter behind the
owner's back; every improvement is named, dated, scored, and
authorised in the weekly report.

---

## 2. The Five Self-Improvement Loops

### 2.1 Per-Turn Loop

**Frequency:** every owner-MD turn (continuously).

**Mechanism:** at the end of every cognitive turn, the engine writes
a `TurnFeedback` record:

```typescript
export interface TurnFeedback {
  readonly turn_id: string;
  readonly outcome: 'success' | 'partial' | 'failure' | 'declined';
  readonly owner_correction: string | null;
  readonly latency_ms: number;
  readonly cost_usd: number;
  readonly confidence_label: 'high' | 'medium' | 'low' | 'refused';
  readonly recipe_id: string;
  readonly memory_cells_read: ReadonlyArray<string>;
  readonly memory_cells_written: ReadonlyArray<string>;
  readonly capability_id: string | null;
}
```

The consolidation worker (`services/consolidation-worker/` — already
shipped) reads `TurnFeedback` records and promotes / demotes
`CognitiveMemoryCell`s per
[`UNIFIED_COGNITIVE_MEMORY_SPEC.md`](./UNIFIED_COGNITIVE_MEMORY_SPEC.md):
cells referenced by successful turns gain reinforcement weight; cells
referenced by failures are reviewed for contradiction. This is the
fastest loop — every turn shifts the memory substrate.

**Audit:** `TurnFeedback` records anchor in the audit-hash chain.

### 2.2 Per-Recipe Loop

**Frequency:** continuous; canary-tested overnight.

**Mechanism:** the existing Wave 17B / 18F (anticipatory-UX
recipe-variant testing) and Wave 17D / 18G
(document-composition recipe-variant testing) frameworks generate
recipe variants, run them against canary tenants (opted-in), and
promote winners. The reflexion-sleep-canary workflow
(`.github/workflows/reflexion-sleep-canary.yml`) gates promotion on
zero-regression across a hold-out tenant set.

**Audit:** every recipe promotion / demotion writes to
`recipe_evolution_audit` with the variant id, win metric, hold-out
results, and the model + prompt diff.

### 2.3 Per-Junior Loop

**Frequency:** continuous, per-junior lifecycle stage.

**Mechanism:** the Wave 18V-DYNAMIC junior lifecycle
([`JUNIOR_DYNAMIC_SPAWNING_SPEC.md`](./JUNIOR_DYNAMIC_SPAWNING_SPEC.md))
matures juniors through `proposed → spawning → trial → seasoned →
sunset`. The `services/junior-evolution-worker/` (visible in the
repo's untracked tree) monitors junior performance and advances or
retires juniors based on observed task completions. Seasoned juniors
become first-class specialisations that the root MD can compose; ones
that fail their trial period are sunset cleanly.

**Audit:** junior lifecycle transitions anchor in the audit chain.

### 2.4 Cross-Tenant Federation Loop

**Frequency:** weekly batch.

**Mechanism:** patterns observed in ≥10 distinct tenants (where each
tenant has explicitly opted into federation) promote to
**platform-memory** — a tenant-agnostic store of `MemoryKind = 'pattern'`
cells that any tenant can read. The promotion path uses **differential
privacy**: only aggregate statistics (e.g. "buyer-response-time p50
under 4 days predicts 18% higher repeat-rate") move across the
boundary, never raw artifact text. The differential-privacy primitives
follow the practice surveyed in [arXiv 2007.05553 — Differentially
Private Cross-Silo Federated Learning](https://arxiv.org/pdf/2007.05553)
and [arXiv 2403.11343 — Federated Transfer Learning with DP](https://arxiv.org/pdf/2403.11343).

**Default state:** OFF. Owners must explicitly opt in per-tenant.
Opt-in surfaces a clear consent screen with the differential-privacy
ε-budget, what types of patterns federate, what does not, and the
revocation path.

**Audit:** every federated pattern carries a provenance record showing
the tenant count, the ε-budget consumed, and the promotion timestamp.

### 2.5 Meta-Learning Loop

**Frequency:** weekly.

**Mechanism:** the **Meta-Learning Conductor** service
(`services/meta-learning-conductor/`) audits the audit-hash chain
over the prior 7 days and identifies **classes of weakness** —
patterns of failure that point to a structural gap, not a single bug.
Example outputs:

- *"Mr. Mwikila refused 23% of regulatory-deadline questions with
  horizon > 30d because the corpus is missing the multi-year
  Tumemadini renewal-schedule map. Proposal: ingest the public PML
  renewal calendar."*
- *"Mr. Mwikila scored 'medium' confidence on 41% of buyer-pricing
  questions for new tenants. Proposal: spawn a `pricing-historian`
  junior at tenant onboarding to seed initial pattern memory from
  the omnidata Slack + Gmail back-fill."*
- *"Mr. Mwikila spent 18% of cost-budget on web-search calls that
  returned no novel information. Proposal: tighten the
  source-quality scorer's recency cap."*

For each class-weakness, the conductor proposes one of: (a) request a
new omnidata connector, (b) propose a new tacit-knowledge interview,
(c) propose a new junior specialisation, (d) propose a corpus
expansion, (e) propose a kernel-level recipe revision, (f) ask the
owner for a clarifying input. The proposals route to the owner-facing
weekly self-improvement report (§3) for review.

**Audit:** every meta-learning proposal anchors in the audit chain
with the class-weakness evidence, the recommended path, and the
projected close-effort.

---

## 3. The Owner-Facing Weekly Self-Improvement Report

Lands every Monday at 06:00 owner-local. Generated by the
`meta-learning-conductor` over the prior 7 days. Format:

### Header

> Mr. Mwikila — Week of Mon DD–Sun DD. Summary: 3 capabilities
> upgraded; 1 capability regressed; 7 know-how artifacts captured;
> 2 federation patterns adopted; 3 self-improvement proposals for
> your review.

### Body sections

1. **Capabilities upgraded** — list of capabilities that moved
   achievability tier upward, with the contributing event (e.g.
   *"`reconcile_bot_fx_window` moved manual_only → partial_ai_assist
   after the BoT connector landed Tuesday"*).
2. **Capabilities regressed** — list of capabilities that moved
   downward, with the suspected cause and the proposed remediation.
3. **Know-how captured this week** — count by harvesting mode, top 5
   artifacts by reusability tag, link to the playbook.
4. **Federation patterns adopted** — for federation-opted-in tenants,
   the list of new platform-memory patterns the tenant inherited
   this week, each with its provenance (tenant count, ε-budget).
5. **Self-improvement proposals** — the meta-learning conductor's
   top proposals for owner review. Each carries a one-tap
   "approve" / "defer" / "decline" affordance.

### Footer

> Generated by `meta-learning-conductor` v0.X. Audit-chain head:
> `abc123…`. Verifiable from genesis via [the audit panel](#).

The report is also delivered to the owner-dashboard
(`apps/owner-dashboard/src/self-improvement/`) and the email channel.

---

## 4. The Meta-Learning Conductor — Service Contract

```typescript
export interface MetaLearningConductorService {
  readonly runWeeklyAudit: (params: { tenant_id: string; window_days: number }) => Promise<WeeklyAuditResult>;
  readonly proposeImprovement: (params: ProposeImprovementParams) => Promise<ImprovementProposal>;
  readonly recordOwnerDecision: (params: { proposal_id: string; decision: 'approve' | 'defer' | 'decline' }) => Promise<void>;
}

export interface WeeklyAuditResult {
  readonly tenant_id: string;
  readonly window_start: string;
  readonly window_end: string;
  readonly capabilities_upgraded: ReadonlyArray<CapabilityTransition>;
  readonly capabilities_regressed: ReadonlyArray<CapabilityTransition>;
  readonly know_how_captured_count: number;
  readonly federation_patterns_adopted: ReadonlyArray<FederationPatternAdoption>;
  readonly class_weaknesses: ReadonlyArray<ClassWeakness>;
  readonly proposals: ReadonlyArray<ImprovementProposal>;
}

export interface ClassWeakness {
  readonly id: string;
  readonly description: string;                   // human-readable name
  readonly evidence_turns: ReadonlyArray<string>; // turn_ids supporting
  readonly impact_estimate: 'low' | 'medium' | 'high';
  readonly affected_capabilities: ReadonlyArray<string>;
}

export interface ImprovementProposal {
  readonly id: string;
  readonly tenant_id: string;
  readonly kind: 'install_connector' | 'run_interview' | 'spawn_junior'
              | 'expand_corpus' | 'revise_recipe' | 'request_owner_input';
  readonly description: string;
  readonly target_class_weakness_id: string;
  readonly recommended_action_payload: Record<string, unknown>;
  readonly projected_close_effort: 'low' | 'medium' | 'high';
  readonly projected_value_usd: number;
  readonly status: 'pending' | 'approved' | 'deferred' | 'declined' | 'executed';
  readonly created_at: string;
  readonly audit_hash: string;
}
```

The service runs on a weekly cron in
`services/meta-learning-conductor/`. Reuses the existing
`services/sleep-pass-orchestrator/` substrate for scheduling; reuses
`services/research-orchestrator/` for the projected-value benchmark
queries.

---

## 5. Cross-Tenant Federation — Privacy Mechanics

Federation is the most privacy-sensitive surface in the system. The
contract:

1. **Opt-in only.** Default off. Owner enables per-tenant via a
   consent screen showing what types of patterns federate, the
   ε-budget per week, and the revocation path.
2. **Aggregate only.** No raw `KnowHowArtifact` text, no raw
   `OmnidataIngestedItem` content, no individual employee record
   ever crosses tenant boundaries. Federation transmits *statistics*
   (means, medians, proportions) computed with Laplace or Gaussian
   noise per the differential-privacy ε.
3. **K-anonymity floor.** A pattern only federates if ≥10 distinct
   tenants contribute evidence — and within each contributing tenant,
   ≥5 distinct invocations. Below either threshold, the pattern stays
   local.
4. **Revocation tombstones.** Owner can revoke federation at any
   time. Revocation triggers (a) immediate halt of new contributions,
   (b) tombstone all prior contributions within 30 days. Patterns
   already adopted by other tenants remain (they cannot be unmixed)
   but the contributing-tenant attribution is cleared.
5. **Audit-chain proof.** Every federation event (contribution,
   adoption, tombstone) anchors with ε-consumed metadata. A regulator
   can verify the entire federation history forward from genesis.
6. **No model training.** Federation does not train any base model.
   It only writes to the platform-memory store; cells inherited by a
   tenant are read into context at runtime, not baked into weights.

---

## 6. Anti-Patterns

Mr. Mwikila MUST NOT:

1. **Self-improve invisibly.** Every improvement is on the weekly
   report. The owner has visibility, not just trust.
2. **Train base models on tenant data.** Cross-tenant federation
   never trains — only writes aggregated, DP-bounded patterns to
   platform memory.
3. **Federate without consent.** Opt-in is mandatory. Default off.
4. **Cause trust regressions.** A recipe variant that improves a
   metric but degrades the owner-trust score (manifesto §2.5 —
   owner-aligned authority) is rejected by the canary gate, not
   promoted.
5. **Spawn juniors without measurement.** Wave 18V-DYNAMIC requires
   trial-period measurement before a junior is seasoned. The
   meta-learning conductor's `spawn_junior` proposal cannot bypass
   that gate.
6. **Hide regressions.** Capability regressions go on the weekly
   report — even when the meta-learning conductor's own recipe
   change caused them. This is the auditability discipline that
   makes self-improvement safe.
7. **Use tenant identity in platform memory.** Federation aggregates
   are tenant-agnostic. Even the federation provenance shows tenant
   *count*, never tenant *ids*.

---

## 7. Schema Additions

Migration `0032_self_improving_loops.sql`:

- `self_improvement_reports` — one row per weekly report; carries the
  `WeeklyAuditResult` snapshot.
- `meta_learnings` — one row per detected `ClassWeakness`.
- `gap_identifications` — link table between meta-learnings and
  capability gaps.
- `improvement_proposals` — per `ImprovementProposal` schema.
- `federation_consent` — per-tenant federation opt-in record.
- `federation_contributions` — per-pattern DP-aggregated contribution
  log.
- `federation_adoptions` — per-tenant adoption of platform patterns.
- `platform_memory_cells` — the cross-tenant memory store
  (tenant-agnostic; carries provenance only).

Indexes: `(tenant_id, window_end DESC)` on reports;
`(tenant_id, status)` on proposals.

---

## 8. Cross-Spec Integration Map

- **Omnidata:** `install_connector` proposals from the meta-learning
  conductor land directly in the omnidata installation flow.
- **Tacit knowledge:** `run_interview` proposals trigger
  `run_methodology_elicitation_v1` or `run_departure_interview_v1`
  scheduling.
- **Capability catalogue:** every `ImprovementProposal` references
  the capability ids it expects to upgrade; the catalogue dashboard
  links each capability to its open proposals.
- **Cognitive memory:** the per-turn loop is the primary write path
  into `CognitiveMemoryCell` reinforcement counters.
- **Junior architecture:** `spawn_junior` proposals route to the
  Wave 18V-DYNAMIC lifecycle pipeline.
- **Mutation authority:** owner approvals on proposals ride the
  existing Tier-2 mutation-authority queue.

---

## 9. Why This Closes the Capability-Boost Loop

A productivity tool delivers a function. A capability-boost platform
delivers a *learning organism*. The five loops are what makes Borjie
the organism:

- The **per-turn loop** ensures every interaction shifts memory.
- The **per-recipe loop** ensures every approach gets tested against
  variants and only winners promote.
- The **per-junior loop** ensures specialisations earn their place.
- The **federation loop** ensures the platform compounds across
  customers — with each owner's explicit consent and the strict
  differential-privacy regime.
- The **meta-learning loop** is the discipline that names the next
  thing to improve, surfaces it transparently to the owner, and
  closes the gap.

The 2026 self-improvement literature (
[timesofai.com — Self-Improving AI in 2026: Myth or Reality?](https://www.timesofai.com/industry-insights/self-improving-ai-myth-or-reality/))
positions 2026 as the inflection year when self-improving
architectures become mainstream. Borjie ships an
**owner-visible, audit-anchored, consent-gated** version of that
architecture from day one. That is what makes Mr. Mwikila a real
Managing Director — not a chatbot that learns, but a colleague who
gets better every week, in front of the owner, with the owner's
authorisation, against measurable benchmarks.

The four pillars of capability boost — omnidata, tacit knowledge,
capability catalogue, self-improving loops — compound because the
fifth loop, the meta-learning conductor, knows how to ask for more
of each. *"You're at 60% omnidata coverage; the next 20% would close
3 high-value gaps. Approve?"* That is the platform improving itself.
That is the differentiator.
