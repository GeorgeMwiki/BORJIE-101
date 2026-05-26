# Five-Layer Loop Architecture — Design Specification

> Wave 20. Pillar C of [`AI_NATIVE_OS_MASTER.md`](../STRATEGY/AI_NATIVE_OS_MASTER.md).
> Every loop in the system passes through all five layers — sensors,
> policy, tools, **quality gates**, learning. The quality-gates layer
> is the missing middle that turns *fast cycles* into *trustworthy
> cycles*.
>
> **Cross-links:** [`AUTONOMOUS_LOOPS_SPEC.md`](./AUTONOMOUS_LOOPS_SPEC.md),
> [`SELF_IMPROVING_LOOPS_SPEC.md`](./SELF_IMPROVING_LOOPS_SPEC.md),
> [`COGNITIVE_ENGINE_SPEC.md`](./COGNITIVE_ENGINE_SPEC.md),
> [`MUTATION_AUTHORITY_SPEC.md`](./MUTATION_AUTHORITY_SPEC.md),
> [`UNIVERSAL_OBSERVABILITY_SPEC.md`](./UNIVERSAL_OBSERVABILITY_SPEC.md),
> [`UNIFIED_COGNITIVE_MEMORY_SPEC.md`](./UNIFIED_COGNITIVE_MEMORY_SPEC.md),
> [`TAB_AS_LOOP_SPEC.md`](./TAB_AS_LOOP_SPEC.md).

Brand: Borjie. Persona: Mr. Mwikila. Status: design-spec.

---

## 1. Vision — founder verbatim

> "AI loops have at least 5 LAYERS: sensors/data, policy layer, tool
> layer, quality gates and learning mechanisms — we need to expand
> these deeply and make each SOTA. Deep online research. Minimal human
> intervention."

---

## 2. The Thesis — Five Layers, Mandatory for Every Loop

Borjie already has many loops:
- 4 autonomous loops ([`AUTONOMOUS_LOOPS_SPEC.md`](./AUTONOMOUS_LOOPS_SPEC.md))
- 5 self-improving loops ([`SELF_IMPROVING_LOOPS_SPEC.md`](./SELF_IMPROVING_LOOPS_SPEC.md))
- The cognitive loop ([`COGNITIVE_ENGINE_SPEC.md`](./COGNITIVE_ENGINE_SPEC.md))
- The mutation-authority loop ([`MUTATION_AUTHORITY_SPEC.md`](./MUTATION_AUTHORITY_SPEC.md))
- The lock/improve recipe lifecycle
- The junior dynamic-spawning lifecycle

Each was independently designed; each touches sensors, policy, tools,
and learning in its own way. The founder's directive standardises the
architecture: **every loop in the platform conforms to a single
5-layer template**, with mandatory quality gates between layers.

The architectural payoff is two-fold. First, **composability**: a new
loop can be added by filling in five slots, not redesigning a system.
Second, and more important, **safety + auditability**: a quality-gates
layer between tools and learning ensures no output that fails
citation, brand, factual, or regulatory checks reaches the learning
substrate. Without this layer, a recursive self-improver optimises
against the wrong target (the [Boyd-OODA pathology](https://securityboulevard.com/2025/10/agentic-ais-ooda-loop-problem/):
*"fast cycles to bad decisions"*).

The intellectual foundations are robust. The OODA-loop framework
([Observe → Orient → Decide → Act](https://atlassc.net/2026/02/13/cybernetic-recursion-ai-agent-loops))
gave us the agent-loop primitive. Karl Friston's
[Free Energy Principle](https://pmc.ncbi.nlm.nih.gov/articles/PMC8871280/)
and the [Active Inference framework](https://arxiv.org/pdf/2410.02972)
gave us the formal account of agents as predictive systems that
minimise variational free energy. The 2026 Boyd-OODA-cybernetic-AI
literature ([Snyk Agentic OODA](https://snyk.io/blog/agentic-ooda-loop/),
[IEEE Spectrum on Agentic AI's OODA loop problem](https://ieeexplore.ieee.org/document/11194053/))
explicitly names the governance problem: "who set the goals, who
approved the boundaries, who can intervene". Borjie's quality-gates
layer is the *governance* answer to that question — quality is not a
side-effect of clever modelling; it is a *structural property* of the
loop template.

---

## 3. The Five Layers — definitions

### 3.1 Layer 1 — Sensors / Data

**What it is:** everything the loop sees.

**What's in it:**

- Tier I universal data observability ([`UNIVERSAL_OBSERVABILITY_SPEC.md`](./UNIVERSAL_OBSERVABILITY_SPEC.md) §2.1)
  — every Drizzle table row the MD has authority to read.
- Tier II field state — in-flight form values (Wave 18R §2.2).
- Tier III UI state — open tabs, focus, hover, scroll (Wave 18R §2.3).
- Omnidata ingestion ([`OMNIDATA_CONNECTOR_INVENTORY.md`](./OMNIDATA_CONNECTOR_INVENTORY.md))
  — Slack, Gmail, WhatsApp, M-Pesa, regulator portals, etc.
- Tacit-knowledge artifacts ([`TACIT_KNOWLEDGE_HARVESTING_SPEC.md`](./TACIT_KNOWLEDGE_HARVESTING_SPEC.md)).
- Cognitive memory cells ([`UNIFIED_COGNITIVE_MEMORY_SPEC.md`](./UNIFIED_COGNITIVE_MEMORY_SPEC.md)).
- External research results ([`DEEP_RESEARCH_SPEC.md`](./DEEP_RESEARCH_SPEC.md)).
- Inbound events ([`CONTINUOUS_24_7_WORK_CYCLE_SPEC.md`](./CONTINUOUS_24_7_WORK_CYCLE_SPEC.md)).

**Contract:** every sensor produces a typed, citation-anchored
`EvidenceItem` (already defined in Cognitive Engine §4). No sensor
emits raw bytes; all are wrapped in the existing span-citation
contract.

### 3.2 Layer 2 — Policy

**What it is:** what the loop is allowed to do.

**What's in it:**

- RBAC (`authz-policy` package, existing).
- ABAC (per-row attribute checks via `app.tenant_id` GUC).
- The 4-tier mutation-authority ladder ([`MUTATION_AUTHORITY_SPEC.md`](./MUTATION_AUTHORITY_SPEC.md) §2).
- Scope resolution ([`ORG_HIERARCHY_TERMINOLOGY_SPEC.md`](./ORG_HIERARCHY_TERMINOLOGY_SPEC.md))
  — which org-unit branch this loop is bound to.
- Brand discipline (the persona name is always Mr. Mwikila;
  specialisation surfaces as subtitle).
- Citation discipline (no claim without a span citation; from
  `COGNITIVE_ENGINE_SPEC` §5).
- Cost budget per loop tier (from `brain-llm-router` cost-meter).
- Recipe subject scope (what subjects this loop can author against).

**Contract:** every policy is a pure predicate
`(loop_context, proposed_action) → 'allow' | 'deny' | 'gate'`. Gating
returns the gate name (e.g. `'tier_2_owner_approval'`) so the loop knows
where to route.

### 3.3 Layer 3 — Tools

**What it is:** what the loop can invoke.

**What's in it:**

- The 5 atomic capabilities ([`CAPABILITIES_UNIFICATION.md`](./CAPABILITIES_UNIFICATION.md)):
  `research_v1`, `compose_tab_v1`, `compose_doc_v1`,
  `compose_media_v1`, `compose_campaign_v1`.
- The universal-creator dispatcher `compose_anything_v1`.
- The mutation classes ([`MUTATION_AUTHORITY_SPEC.md`](./MUTATION_AUTHORITY_SPEC.md) §2):
  UI / Data / Document / Action mutations.
- External MCP servers ([`mcp-server-tra`](../../services/mcp-server-tra),
  [`mcp-server-tumemadini`](../../services/mcp-server-tumemadini),
  NEMC, GePG, BoT).
- Approved third-party tools via the connector framework.

**Contract:** every tool implements the existing `Tool` interface
(`name`, `description`, `input_schema`, `invoke`) and gets a per-tool
audit-chain entry on every call.

### 3.4 Layer 4 — Quality Gates ← the new layer

**What it is:** the validators between tool output and learning write.

**What's in it (7 mandatory gates):**

1. **Citation Gate.** Reuses `COGNITIVE_ENGINE_SPEC` §5 cite-validator.
   Every factual sentence must have a `citation_id` resolving to a real
   evidence item.
2. **Brand Gate.** Output must obey persona discipline: "Mr. Mwikila"
   as the visible name; English IDs; Swahili-or-English voice match
   to the user preference; Borjie design tokens for any rendered
   surfaces.
3. **Factual Consistency Gate.** Output must not contradict the
   tenant's existing high-confidence memory cells. If it does, the
   gate flags `'contradicted'`; the cognitive memory layer transitions
   the affected cells to `contradicted` status (per
   [`UNIFIED_COGNITIVE_MEMORY_SPEC.md`](./UNIFIED_COGNITIVE_MEMORY_SPEC.md) §2);
   the new claim is held for owner review.
4. **Regulatory Compliance Gate.** Domain-specific. For mining: NEMC
   EIA section coverage, Tumemadini royalty calc validity, TRA tax
   schedule alignment, BoT FX-window timing. Each is a deterministic
   check against the regulator MCP servers. Failures route to a Tier 2
   mutation proposal with the regulator citation embedded.
5. **Friction Detection Gate.** Output must surface a *friction score*
   computed from passive-capture-events ([`UNIVERSAL_OBSERVABILITY_SPEC.md`](./UNIVERSAL_OBSERVABILITY_SPEC.md) §2.2)
   and tab-as-loop telemetry ([`TAB_AS_LOOP_SPEC.md`](./TAB_AS_LOOP_SPEC.md)).
   A high friction score does not block ship; it tags the output for
   recipe-improvement consideration.
6. **Success Measurement Gate.** Output must declare a measurable
   success criterion (e.g. *"the buyer will respond within 7 days"*)
   and a measurement worker schedule (cron + check). Without this,
   the learning layer cannot reinforce or contradict the output.
7. **Anomaly Detection Gate.** Output must not be statistically
   anomalous against the tenant's prior distribution. Example: a
   royalty calc that returns 8x the prior month's value triggers the
   anomaly gate; the output is held for owner review even if it would
   otherwise pass the other gates. Uses isolation-forest + simple
   z-score thresholds; details below.

**Contract:** each gate is a function
`(loop_output, loop_context) → GateVerdict`. The verdict is
`'pass' | 'flag' | 'block'`. `'block'` rejects the output and routes
to the appropriate recovery path (owner review for regulatory,
recipe-revision for friction, contradiction-handling for factual,
etc.). `'flag'` allows ship but writes a tag to the learning layer.
`'pass'` permits silent forward motion.

### 3.5 Layer 5 — Learning Mechanisms

**What it is:** what the loop writes back to make the next loop better.

**What's in it (already mostly shipped):**

- Cognitive memory cell promotions/demotions
  ([`UNIFIED_COGNITIVE_MEMORY_SPEC.md`](./UNIFIED_COGNITIVE_MEMORY_SPEC.md)).
- Recipe lock/improve cycle (`recipe_evolution_audit`).
- Junior dynamic lifecycle ([`JUNIOR_DYNAMIC_SPAWNING_SPEC.md`](./JUNIOR_DYNAMIC_SPAWNING_SPEC.md)).
- Cross-tenant federation ([`SELF_IMPROVING_LOOPS_SPEC.md`](./SELF_IMPROVING_LOOPS_SPEC.md) §2.4).
- Meta-learning conductor weekly audit ([`SELF_IMPROVING_LOOPS_SPEC.md`](./SELF_IMPROVING_LOOPS_SPEC.md) §2.5).

**Contract:** every learning write carries the originating loop_id,
the gate-verdict set that produced it, and an audit hash. Reads back
through the legibility stream
([`ORG_LEGIBILITY_SPEC.md`](./ORG_LEGIBILITY_SPEC.md)).

---

## 4. The mandatory loop template

Every loop in Borjie — old or new — conforms to this template:

```typescript
export interface LoopDefinition<TContext, TOutput> {
  readonly id: string;                                          // 'morning_briefing_v3'
  readonly name: string;
  readonly description: string;

  // L1: Sensors / Data
  readonly sensors: ReadonlyArray<SensorBinding>;
  readonly contextBuilder: (rawSignals: ReadonlyArray<EvidenceItem>) => TContext;

  // L2: Policy
  readonly policy_predicates: ReadonlyArray<PolicyPredicate>;
  readonly required_tier: 0 | 1 | 2;
  readonly cost_budget_usd_cents: number;
  readonly scope_binding: ScopeBinding;                         // which org_unit

  // L3: Tools
  readonly invokable_tools: ReadonlyArray<ToolName>;
  readonly tool_orchestrator: (ctx: TContext, tools: ToolRegistry) => Promise<TOutput>;

  // L4: Quality Gates
  readonly gates: ReadonlyArray<QualityGate>;                   // ≥ 4 mandatory: citation/brand/factual/regulatory
  readonly gate_failure_recovery: (verdict: GateVerdict) => RecoveryAction;

  // L5: Learning
  readonly learning_writes: ReadonlyArray<LearningWriteBinding>;
  readonly success_measurement_schedule: CronExpression | null;
}

export type GateVerdict =
  | { gate: 'citation';   result: 'pass' | 'flag' | 'block'; details: CitationGateDetails }
  | { gate: 'brand';      result: 'pass' | 'flag' | 'block'; details: BrandGateDetails }
  | { gate: 'factual';    result: 'pass' | 'flag' | 'block'; details: FactualGateDetails }
  | { gate: 'regulatory'; result: 'pass' | 'flag' | 'block'; details: RegulatoryGateDetails }
  | { gate: 'friction';   result: 'pass' | 'flag' | 'block'; details: FrictionGateDetails }
  | { gate: 'success';    result: 'pass' | 'flag' | 'block'; details: SuccessGateDetails }
  | { gate: 'anomaly';    result: 'pass' | 'flag' | 'block'; details: AnomalyGateDetails };
```

The orchestrator that runs a loop:

```typescript
async function runLoop<TC, TO>(loop: LoopDefinition<TC, TO>): Promise<LoopRunResult<TO>> {
  // L1: gather sensors
  const signals = await Promise.all(loop.sensors.map(s => s.read()));
  const ctx = loop.contextBuilder(signals);

  // L2: policy check
  for (const predicate of loop.policy_predicates) {
    const verdict = await predicate.evaluate(ctx);
    if (verdict === 'deny') return blockedRun('policy_deny');
    if (verdict === 'gate') return gatedRun(predicate.gate);
  }

  // L3: tool orchestration
  const output = await loop.tool_orchestrator(ctx, toolRegistry);

  // L4: quality gates — the new layer
  const verdicts: GateVerdict[] = [];
  for (const gate of loop.gates) {
    const verdict = await gate.evaluate(output, ctx);
    verdicts.push(verdict);
    if (verdict.result === 'block') {
      const recovery = loop.gate_failure_recovery(verdict);
      return rejectedRun(verdict, recovery);
    }
  }

  // L5: learning writes
  for (const writeBinding of loop.learning_writes) {
    await writeBinding.write(output, verdicts, ctx);
  }

  return successfulRun(output, verdicts);
}
```

This is the **single loop runner** every existing and future loop will
use. Migration of existing loops is mechanical: each gets wrapped in a
`LoopDefinition` rather than rewritten.

---

## 5. The loop-of-loops — recursion at every layer

Each of the 5 layers is itself a loop. Layer 4 (quality gates) is the
clearest case: the quality-gate evaluator runs *its own 5-layer loop*
to decide whether to pass/flag/block:

```
                    Outer Loop (e.g. morning briefing)
                              │
                              ▼
                     L1 → L2 → L3 → L4 → L5
                                ▲
                                │  L4 itself is a loop:
                                │
                       ┌─────────────────────┐
                       │ Quality-Gate Loop:  │
                       │  L1: read output    │
                       │  L2: gate policy    │
                       │  L3: validators     │
                       │  L4: meta-gates     │
                       │  L5: gate learning  │
                       └─────────────────────┘
```

The recursion bottoms out at the **meta-learning conductor**
([`SELF_IMPROVING_LOOPS_SPEC.md`](./SELF_IMPROVING_LOOPS_SPEC.md) §2.5),
which audits its own audit chain — the *self-referent* loop that
closes the recursion. This is the architectural pattern the founder
named as "literal recursive self-improving AI loops from the ground up".

---

## 6. The 5 top-of-mind quality gates — concrete contracts

### 6.1 Citation Gate

```typescript
export interface CitationGate {
  readonly evaluate: (output: LoopOutput, ctx: LoopContext) => Promise<CitationGateVerdict>;
}
// Implementation reuses cognitive-engine §5 cite-validator.
// Block: >20% uncited claim sentences.
// Flag: 1-20% uncited (output rewritten with [unverified] tags).
// Pass: 0% uncited.
```

### 6.2 Brand Gate

```typescript
export interface BrandGate {
  readonly evaluate: (output: LoopOutput, ctx: LoopContext) => Promise<BrandGateVerdict>;
}
// Checks: persona name is "Mr. Mwikila"; subtitle pattern conforms;
// design tokens present; language matches user preference; no
// competitor names in branded artifacts.
```

### 6.3 Factual Consistency Gate

```typescript
export interface FactualGate {
  readonly evaluate: (output: LoopOutput, ctx: LoopContext) => Promise<FactualGateVerdict>;
}
// Runs Haiku 4.5 claim-extractor over the output.
// Each claim is searched against tenant's consolidated memory cells.
// Contradictions:
//   - against 'observed' cells: PASS (new evidence may displace old).
//   - against 'reinforced' cells: FLAG (write contradiction marker).
//   - against 'consolidated' cells: BLOCK (route to owner review).
```

### 6.4 Regulatory Compliance Gate

```typescript
export interface RegulatoryGate {
  readonly evaluate: (output: LoopOutput, ctx: LoopContext) => Promise<RegulatoryGateVerdict>;
}
// Domain-specific. Borjie ships 4 sub-gates:
//   - tumemadini_compliance.ts  (royalty calc schema validity)
//   - nemc_compliance.ts        (EIA section coverage)
//   - tra_compliance.ts         (tax schedule alignment)
//   - bot_compliance.ts         (FX window timing)
// Each sub-gate consults the regulator MCP server.
```

### 6.5 Anomaly Detection Gate

```typescript
export interface AnomalyGate {
  readonly evaluate: (output: LoopOutput, ctx: LoopContext) => Promise<AnomalyGateVerdict>;
}
// Approach:
//   1. Extract numeric outputs (royalty $, hedge size, payment $).
//   2. Z-score against trailing 90-day distribution per tenant per metric.
//   3. If |z| > 3.0: BLOCK (route to owner).
//   4. If 2.0 < |z| < 3.0: FLAG (annotate "outlier vs prior 90d").
//   5. Apply isolation-forest for multivariate cases (e.g. royalty
//      paired with assay-grade).
```

The three remaining gates (friction, success, brand-strict) follow the
same template. All gate implementations live in `packages/loop-quality-gates/`.

---

## 7. SOTA landscape — 2026 references

- **OODA loop and agentic AI** ([atlassc.net "Cybernetic Recursion"](https://atlassc.net/2026/02/13/cybernetic-recursion-ai-agent-loops),
  [Snyk Agentic OODA](https://snyk.io/blog/agentic-ooda-loop/)) —
  agent feedback loops, governance requirements, the "fast cycles to
  bad decisions" pathology.
- **Karl Friston Free Energy Principle** ([PMC review](https://pmc.ncbi.nlm.nih.gov/articles/PMC8871280/),
  [arXiv 2410.02972 Synaptic Learning under FEP](https://arxiv.org/pdf/2410.02972))
  — formal foundation for agents as predictive systems minimising
  variational free energy. Maps directly onto the quality-gates
  layer: gates *minimise expected surprise* on the learning substrate.
- **Active Inference for AI** ([Tasshin survey](https://tasshin.com/blog/active-inference-and-the-free-energy-principle/),
  [ResearchGate review of Friston applied to AI](https://www.researchgate.net/publication/397380587_From_Neuroscience_to_Artificial_Intelligence_Karl_Friston's_Free_Energy_Principle_and_the_Rise_of_Active_Inference))
  — "autonomous, adaptive, and interpretable agents" via active
  inference. Borjie's loop runner is an active-inference-style agent
  with explicit gate-as-surprise-bound.
- **MetaAgent and Truly Self-Improving Agents** ([arXiv 2508.00271](https://arxiv.org/pdf/2508.00271),
  [arXiv 2506.05109](https://arxiv.org/pdf/2506.05109)) — tool
  meta-learning, self-reflection, answer-verification — directly
  informs the quality-gates layer.
- **ServiceNow + MCP** ([ServiceNow May 2026](https://newsroom.servicenow.com/press-releases/details/2026/ServiceNow-opens-its-full-system-of-action-to-every-AI-Agent-in-the-enterprise/default.aspx))
  — open system of action to every AI agent via MCP; ServiceNow's
  governance pattern maps onto the policy + quality-gates layers.

---

## 8. Migrating existing loops to the 5-layer template

The migration is mechanical. Example for the existing Daily Research
Loop ([`AUTONOMOUS_LOOPS_SPEC.md`](./AUTONOMOUS_LOOPS_SPEC.md) §1):

```typescript
const dailyResearchLoop: LoopDefinition<DailyResearchContext, DailyBriefing> = {
  id: 'daily_research_v2',
  name: 'Daily Research Loop',
  description: 'Pre-dawn briefing for the owner',

  // L1: sensors
  sensors: [
    sensorBindings.tenantWatchlists,
    sensorBindings.lmbmPortfolio,
    sensorBindings.dailyResearchCache,
    sensorBindings.regulatorFeeds,
    sensorBindings.commodityFeeds,
  ],
  contextBuilder: buildDailyResearchContext,

  // L2: policy
  policy_predicates: [
    predicates.tier0_or_1_only,
    predicates.cost_budget_under_5_usd,
    predicates.scope_root_md_only,
  ],
  required_tier: 1,
  cost_budget_usd_cents: 500,
  scope_binding: scopeBindings.tenant_root,

  // L3: tools
  invokable_tools: ['research_v1', 'compose_doc_v1', 'compose_tab_v1'],
  tool_orchestrator: orchestrateMorningBriefing,

  // L4: quality gates (NEW for this migration)
  gates: [
    gates.citation,
    gates.brand,
    gates.factual,
    gates.regulatory,
    gates.friction,
    gates.success,
    gates.anomaly,
  ],
  gate_failure_recovery: dailyBriefingRecovery,

  // L5: learning
  learning_writes: [
    learningBindings.write_memory_cells_from_briefing,
    learningBindings.update_capability_measurements,
    learningBindings.write_turn_feedback,
  ],
  success_measurement_schedule: '0 6 * * *', // re-check next morning
};
```

The migration is a wrapper, not a rewrite. Existing loop code becomes
the `tool_orchestrator`; the L1/L2/L4/L5 slots get filled with binding
references.

---

## 9. Anti-patterns

1. **Layer skipping.** A loop that reads sensors and writes learning
   without going through tools + quality gates is unsafe. The runner
   refuses to execute a `LoopDefinition` missing any of the 5 layers.
2. **Quality-gate bypass for speed.** "It's a fast loop, skip the
   factual gate" is the Boyd OODA pathology. Every loop, however fast,
   runs all 7 gates. Gates run in parallel; the budget is ≤300ms
   total for a Tier 0 loop.
3. **Loop deadlock.** A quality gate that depends on a sibling loop's
   output (e.g. friction gate reading from tab-as-loop) must not block
   indefinitely. Default timeout 5s; on timeout, gate returns
   `'flag'` with `details.reason: 'gate_timeout'`.
4. **Anomaly false-positives at tenant startup.** New tenants have <90
   days of distribution. The anomaly gate must use platform-memory
   patterns ([`SELF_IMPROVING_LOOPS_SPEC.md`](./SELF_IMPROVING_LOOPS_SPEC.md) §2.4)
   as the prior for the first 90 days, then transition to tenant-local
   prior.
5. **Gate without recovery path.** A `'block'` verdict that has no
   recovery action is a dead-end. Every gate's blocking verdict MUST
   route to a defined recovery (owner review, recipe revision, mutation
   proposal, etc.).
6. **Learning writes that bypass gate verdicts.** The learning layer
   MUST read the gate verdict set; cells flagged or blocked must NOT
   reinforce in memory. The cells become observation-class only.
7. **Different gate semantics per loop.** Citation gate behaviour must
   be identical across all loops. No loop is allowed to weaken a gate.
8. **Tenant-specific gate weakening without owner consent.** A tenant
   can tighten gates (e.g. raise the citation threshold to 100% from
   80%) but cannot weaken — except by explicit owner consent recorded
   in the audit chain.

---

## 10. Phase 2 implementation map

- **New package** `packages/loop-quality-gates/` (≈1800 LOC):
  - `gates/citation-gate.ts`
  - `gates/brand-gate.ts`
  - `gates/factual-gate.ts`
  - `gates/regulatory-gate.ts` + 4 sub-gates (tumemadini/nemc/tra/bot)
  - `gates/friction-gate.ts`
  - `gates/success-gate.ts`
  - `gates/anomaly-gate.ts`
- **New package** `packages/loop-runner/` (≈700 LOC):
  - `loop-definition.ts` (the `LoopDefinition` interface)
  - `loop-orchestrator.ts` (the `runLoop` function)
  - `loop-registry.ts` (loops by id)
  - `loop-audit.ts` (audit-chain hooks)
- **Migration** `0035_quality_gates.sql`:
  - `loop_runs` table — one row per loop execution.
  - `gate_verdicts` table — one row per gate per run.
  - `loop_definitions` table — one row per registered loop.
- **Refactoring waves:**
  - Wave 20A: migrate the 4 autonomous loops.
  - Wave 20B: migrate the 5 self-improving loops.
  - Wave 20C: migrate the cognitive turn loop.
  - Wave 20D: migrate the mutation-authority pipeline.
- **Estimated effort:** 8 weeks total (4 engineers × 2 weeks).

---

## 11. Acceptance criteria

- 100% of loops in the registry conform to `LoopDefinition`.
- Each loop has ≥4 mandatory gates (citation, brand, factual,
  regulatory) registered.
- Gate verdict coverage in the audit-chain audit: 100% of loop
  outputs have a verdict row per registered gate.
- A `'block'` verdict triggers a defined recovery within 30s.
- Anomaly-gate false-positive rate on synthetic data: <2%.
- The meta-learning conductor's weekly audit
  ([`SELF_IMPROVING_LOOPS_SPEC.md`](./SELF_IMPROVING_LOOPS_SPEC.md))
  reports gate-trend metrics: # block / # flag / # pass per gate per
  week.

---

## 12. Cross-reference to siblings

- Master vision: [`AI_NATIVE_OS_MASTER.md`](../STRATEGY/AI_NATIVE_OS_MASTER.md)
  §6.
- All 4 autonomous loops: [`AUTONOMOUS_LOOPS_SPEC.md`](./AUTONOMOUS_LOOPS_SPEC.md).
- All 5 self-improving loops: [`SELF_IMPROVING_LOOPS_SPEC.md`](./SELF_IMPROVING_LOOPS_SPEC.md).
- Cognitive engine: [`COGNITIVE_ENGINE_SPEC.md`](./COGNITIVE_ENGINE_SPEC.md).
- Mutation authority: [`MUTATION_AUTHORITY_SPEC.md`](./MUTATION_AUTHORITY_SPEC.md).
- Universal observability: [`UNIVERSAL_OBSERVABILITY_SPEC.md`](./UNIVERSAL_OBSERVABILITY_SPEC.md).
- Tab-as-loop: [`TAB_AS_LOOP_SPEC.md`](./TAB_AS_LOOP_SPEC.md) — every
  tab is a 5-layer loop too.
- Org legibility: [`ORG_LEGIBILITY_SPEC.md`](./ORG_LEGIBILITY_SPEC.md) — the gate verdicts join the
  legibility stream.
- Info synthesis: [`INFORMATION_SYNTHESIS_SOTA_SPEC.md`](./INFORMATION_SYNTHESIS_SOTA_SPEC.md) —
  synthesis outputs pass all 7 gates before becoming reusable material.
- 24/7 work cycle: [`CONTINUOUS_24_7_WORK_CYCLE_SPEC.md`](./CONTINUOUS_24_7_WORK_CYCLE_SPEC.md) — overnight actions run all 7 gates.
- Strategic direction: [`STRATEGIC_DIRECTION_LAYER_SPEC.md`](./STRATEGIC_DIRECTION_LAYER_SPEC.md) — strategic memos route through the same gates with elevated regulatory-compliance weighting.

---

*The 5-layer loop template is the engineering invariant that turns
"recursive self-improvement" from marketing copy into a structural
property of the platform. Every loop, every gate, every learning
write, every audit-chain entry — bottoms out here.*

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.
