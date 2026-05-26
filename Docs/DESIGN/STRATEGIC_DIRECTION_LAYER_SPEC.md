# Strategic Direction Layer — Design Specification

> Wave 23. Pillar C of [`AI_NATIVE_OS_MASTER.md`](../STRATEGY/AI_NATIVE_OS_MASTER.md).
> Board-level strategic analysis. Mr. Mwikila is not just operational —
> he is a strategic counsel.
>
> **Cross-links:** [`DEEP_RESEARCH_SPEC.md`](./DEEP_RESEARCH_SPEC.md),
> [`CAPABILITY_CATALOGUE_SPEC.md`](./CAPABILITY_CATALOGUE_SPEC.md),
> [`SELF_IMPROVING_LOOPS_SPEC.md`](./SELF_IMPROVING_LOOPS_SPEC.md),
> [`INFORMATION_SYNTHESIS_SOTA_SPEC.md`](./INFORMATION_SYNTHESIS_SOTA_SPEC.md),
> [`JUNIOR_DYNAMIC_SPAWNING_SPEC.md`](./JUNIOR_DYNAMIC_SPAWNING_SPEC.md),
> [`AUTONOMOUS_LOOPS_SPEC.md`](./AUTONOMOUS_LOOPS_SPEC.md),
> [`MASTER_BRAIN_AUTONOMY_MANIFESTO.md`](../MASTER_BRAIN_AUTONOMY_MANIFESTO.md).

Brand: Borjie. Persona: Mr. Mwikila. Status: design-spec.

---

## 1. Vision — founder verbatim

> "Give strategic directions and ways to improve etc, always
> optimising and identifying areas of friction etc — all in a
> never-ending improving loop making judgement calls and asks for
> approvals etc."

---

## 2. The Thesis — From Operational MD to Strategic MD

Borjie's existing autonomy stack runs the operational MD beautifully —
morning briefings, capability measurement, mutation authority, daily
follow-ups. But the founder's directive is broader: Mr. Mwikila must
think *strategically*, not just operationally. A real Managing
Director does both. The operational day is the floor; the strategic
quarter is the ceiling.

Strategic thinking is distinct from operational thinking in three
ways:

1. **Time horizon.** Operational decisions span hours to days.
   Strategic decisions span quarters to years.
2. **Information substrate.** Operational decisions are dominated by
   internal data (tenant ops, regulator state, buyer relationships).
   Strategic decisions require external substrate (market trends,
   competitive intelligence, macro signals) blended with internal
   state.
3. **Output form.** Operational outputs are artifacts you act on
   (file the return, send the email). Strategic outputs are
   *decision frames* you think with (board pack, scenario plan,
   capital allocation memo, M&A target list).

The 2026 enterprise-AI landscape is converging:
[Microsoft's Copilot Leadership Team](https://blogs.microsoft.com/blog/2026/03/17/announcing-copilot-leadership-update/)
restructured the org around AI-for-executives in March 2026.
[Microsoft's "Where leadership meets AI" Copilot in the C-suite series](https://news.microsoft.com/copilot-in-the-c-suite/)
runs C-suite case studies. [Adoptify's 2026 C-suite Copilot training](https://www.adoptify.ai/blogs/microsoft-copilot-training-c-suite-necessity-for-2026/)
positions Copilot Training as a "structured, leader-level mastery" need.
[Microsoft 365 Copilot's 2026 evolution](https://windowsnews.ai/article/microsofts-2026-copilot-evolution-from-drafting-assistant-to-governed-ai-execution-layer.409373)
moves it "from drafting assistant to active execution layer" — exactly
the operational → strategic shift Borjie needs to make explicit.

Borjie's distinct play: every other vendor is shipping a
*horizontal* strategic copilot (Copilot, Bard, ChatGPT for executives).
Borjie ships a *vertical* one — Mr. Mwikila knows mining, regulator
context, the specific market dynamics of Tanzanian artisanal gold, the
gold-window FX regime, the licensing landscape, the buyer network. The
strategic memos are domain-grounded in a way no horizontal product can
match.

---

## 3. The 4 Strategic Output Forms

### 3.1 SWOT analyses

Strengths / Weaknesses / Opportunities / Threats — quarterly default,
on demand. Composed from:

- Internal capability state ([`CAPABILITY_CATALOGUE_SPEC.md`](./CAPABILITY_CATALOGUE_SPEC.md)).
- Internal performance trends (revenue, margin, FX position, royalty
  costs).
- External market intel (gold price trajectory, regulator-direction
  forecasts, competitor activity in the cadastre).
- Internal pattern memory (cross-tenant federated patterns where
  enabled).

Each entry in the SWOT carries citations to the contributing artifacts
and the confidence label. The owner reviews the SWOT, can drag-and-
drop entries between quadrants, can ask for elaboration on any one.

### 3.2 Scenario plans

What-if forecasts. Format: 3 scenarios (downside / base / upside)
across a 6-quarter horizon, each with:

- Macro assumptions (gold price, FX, royalty rate, licensing speed).
- Operational implications (production targets, hiring needs, capex).
- Financial implications (revenue, margin, cash runway).
- Recommended actions per scenario.
- Decision triggers (signals that would shift the company from base
  to downside or upside).

The scenario engine reuses
[`DEEP_RESEARCH_SPEC.md`](./DEEP_RESEARCH_SPEC.md) for the external
assumption gathering and
[`INFORMATION_SYNTHESIS_SOTA_SPEC.md`](./INFORMATION_SYNTHESIS_SOTA_SPEC.md)
L4 corpus synthesis for the internal-history assumption set.

### 3.3 Capital allocation memos

How should the next $X be deployed? Composed inputs:

- Current cash + runway position.
- Capability gaps with $-value estimates
  ([`CAPABILITY_CATALOGUE_SPEC.md`](./CAPABILITY_CATALOGUE_SPEC.md) — every capability
  carries a `value_estimate_usd`).
- Operational improvement opportunities from the meta-learning
  conductor's weekly proposals.
- Capex / opex breakdown of competing investments.
- Risk-adjusted return estimates per option.

Output: a ranked list of investment options with the
recommendation, the alternatives, the trade-offs, the
recommended-action confidence label. The owner approves the top
option (or asks for elaboration).

### 3.4 M&A / partnership opportunity memos

Who could we acquire? Who could we partner with? Composed inputs:

- The Tanzanian PML cadastre via the `mcp-server-tumemadini` (which
  licences are dormant, expiring, transferable).
- Buyer / supplier health from omnidata.
- External research on regional consolidation patterns.
- Internal capacity to absorb (people, capital, regulatory
  positioning).

Output: a short list of opportunities with
strategic fit, capital cost estimate, integration complexity, and
recommended next step (DD, outreach, watch-list).

---

## 4. The strategic-junior specialisation

[`JUNIOR_DYNAMIC_SPAWNING_SPEC.md`](./JUNIOR_DYNAMIC_SPAWNING_SPEC.md)
already defines the dynamic-junior framework. Wave 23 adds a seed
junior class: **`strategic-advisor`**, the strategic-grade
specialisation Mr. Mwikila summons for strategic outputs.

The `strategic-advisor` junior:

- Has elevated `authority_tier_max = 1` (drafts only; never executes —
  strategic outputs always route to the owner).
- Has access to the external-research stack
  ([`DEEP_RESEARCH_SPEC.md`](./DEEP_RESEARCH_SPEC.md)) at higher cost
  budgets ($5–$50 per strategic memo vs $0.50 for an operational
  draft).
- Reads the full legibility stream
  ([`ORG_LEGIBILITY_SPEC.md`](./ORG_LEGIBILITY_SPEC.md)) with
  long-context window (Sonnet 4.7 1M context).
- Uses L4 corpus syntheses
  ([`INFORMATION_SYNTHESIS_SOTA_SPEC.md`](./INFORMATION_SYNTHESIS_SOTA_SPEC.md))
  as primary inputs.
- Always cites both internal and external sources; passes the
  citation gate with elevated strictness (zero uncited claims
  allowed; standard threshold is 80% cited).
- Outputs the strategic-memo voice (more formal; less directive;
  framing-heavy).

The junior matures through the standard lifecycle. Seasoned
`strategic-advisor` juniors per-tenant carry tenant-specific strategic
priors.

---

## 5. The strategic loop — when does it run?

### 5.1 Scheduled

- **Quarterly SWOT** — fires at the end of each calendar quarter.
- **Annual scenario plan** — fires in Q4 for the following year.
- **Weekly strategic-pulse** — a short (≤400 word) summary of the
  week's strategic-relevant signals: macro moves, competitor activity,
  regulator-direction shifts. Ships as part of the
  [`SELF_IMPROVING_LOOPS_SPEC.md`](./SELF_IMPROVING_LOOPS_SPEC.md)
  weekly report's strategic section.

### 5.2 Event-triggered

- **Major macro shift** — e.g. gold price moves ±10% from the rolling
  90-day mean. Triggers an ad-hoc strategic memo.
- **Regulator-direction shift** — e.g. a Minister speech, a Tumemadini
  policy update, a TRA reform proposal. Triggers a regulatory-strategic
  memo.
- **Competitor visibility** — e.g. a major competitor announces an
  acquisition, a licence grant, a financing round. Triggers a
  competitive-strategic memo.

### 5.3 Owner-on-demand

- Owner asks: *"Should we expand to the Mwanza region?"* The
  strategic-junior composes a 1500-word strategic memo using all the
  primitives above.

---

## 6. The strategic memo — anatomy

Every strategic memo conforms to a structured template:

```markdown
# [Memo Title] — Strategic Memo
## TL;DR
- 3 bullet points
- The single recommended action
- The single key signal to watch

## Context
[Why this memo, what triggered it, prior memos that bear on this]

## Internal Position
[Current capability state, performance trends, recent decisions
that bear on this — all citation-anchored]

## External Landscape
[Market state, competitor positioning, regulator direction, macro
signals — all citation-anchored]

## Scenarios
[3 scenarios: downside, base, upside — assumptions, implications,
triggers]

## Options
[3-5 strategic options — pros, cons, capital cost, time horizon,
risk-adjusted return]

## Recommendation
[The recommended option, the rationale, the dissenting view, the
owner-decision affordance]

## Decision triggers
[Signals that would invalidate or reinforce this recommendation]

## Audit chain
[evidence-id list; confidence label; cost incurred]
```

The memo is rendered as a `compose_doc_v1` output, lives in the
tenant's `strategic_memos` table, and is automatically pinned to the
owner-dashboard `apps/owner-dashboard/src/strategic-memos/` surface.

---

## 7. Operating contract — TypeScript

```typescript
export interface StrategicMemoRequest {
  readonly id: string;
  readonly tenant_id: string;
  readonly trigger: 'scheduled' | 'event_triggered' | 'on_demand';
  readonly memo_kind: 'swot' | 'scenario_plan' | 'capital_allocation' | 'ma_partnership' | 'ad_hoc';
  readonly subject: string;
  readonly horizon_quarters: number;                  // 1..8
  readonly cost_budget_usd_cents: number;             // tenant-configured cap
  readonly requested_by: 'mwikila' | string;          // user_id or system
  readonly requested_at: string;
}

export interface StrategicMemo {
  readonly id: string;
  readonly request_id: string;
  readonly tenant_id: string;
  readonly title: string;
  readonly memo_kind: StrategicMemoRequest['memo_kind'];
  readonly tldr: StrategicTLDR;
  readonly sections: StrategicMemoSections;
  readonly recommendation: StrategicRecommendation;
  readonly decision_triggers: ReadonlyArray<DecisionTrigger>;
  readonly internal_citations: ReadonlyArray<SpanCitation>;
  readonly external_citations: ReadonlyArray<SpanCitation>;
  readonly synthesis_inputs: ReadonlyArray<SynthesisArtifactRef>;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly composed_by_junior_id: string;             // strategic-advisor.<lifecycle>
  readonly composition_cost_usd_cents: number;
  readonly composed_at: string;
  readonly owner_decision: 'pending' | 'approved' | 'deferred' | 'declined';
  readonly owner_decision_at: string | null;
  readonly owner_notes: string | null;
  readonly audit_hash: string;
}

export interface StrategicRecommendation {
  readonly recommended_option: string;
  readonly rationale: string;
  readonly capital_cost_usd: number;
  readonly time_horizon_quarters: number;
  readonly risk_adjusted_return_pct: number | null;
  readonly dissenting_view: string;                   // always include the counter
  readonly confidence: 'high' | 'medium' | 'low';
}

export interface DecisionTrigger {
  readonly signal_description: string;
  readonly threshold: string;                         // "Gold price below $1900 sustained 5 days"
  readonly action_if_triggered: 'reinforce' | 'invalidate' | 'recompose';
}
```

Schema (migration `0040_strategic_layer.sql`):

```sql
CREATE TABLE strategic_memos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  title TEXT NOT NULL,
  memo_kind TEXT NOT NULL CHECK (memo_kind IN ('swot','scenario_plan','capital_allocation','ma_partnership','ad_hoc')),
  tldr JSONB NOT NULL,
  sections JSONB NOT NULL,
  recommendation JSONB NOT NULL,
  decision_triggers JSONB NOT NULL DEFAULT '[]',
  internal_citations JSONB NOT NULL DEFAULT '[]',
  external_citations JSONB NOT NULL DEFAULT '[]',
  synthesis_inputs JSONB NOT NULL DEFAULT '[]',
  confidence TEXT NOT NULL,
  composed_by_junior_id TEXT NOT NULL,
  composition_cost_usd_cents INTEGER,
  composed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  owner_decision TEXT NOT NULL DEFAULT 'pending'
    CHECK (owner_decision IN ('pending','approved','deferred','declined')),
  owner_decision_at TIMESTAMPTZ,
  owner_notes TEXT,
  audit_hash TEXT NOT NULL
);

CREATE TABLE strategic_memo_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  trigger TEXT NOT NULL,
  memo_kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  horizon_quarters INTEGER NOT NULL,
  cost_budget_usd_cents INTEGER NOT NULL,
  requested_by TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','composing','composed','failed','rejected'))
);
```

---

## 8. SOTA landscape — 2026 references

- **Microsoft Copilot Leadership Update** ([blog, March 2026](https://blogs.microsoft.com/blog/2026/03/17/announcing-copilot-leadership-update/))
  — Copilot Leadership Team established to drive "brand strategy,
  product roadmap, models and core infrastructure".
- **Where Leadership Meets AI — Copilot in the C-suite** ([series](https://news.microsoft.com/copilot-in-the-c-suite/))
  — Microsoft positioning Copilot as the C-suite AI surface.
- **C-suite Copilot Training, 2026 Necessity** ([Adoptify](https://www.adoptify.ai/blogs/microsoft-copilot-training-c-suite-necessity-for-2026/))
  — LinkedIn 3x rise in C-suite AI skill listings.
- **Microsoft's 2026 Copilot Evolution** ([Windows News](https://windowsnews.ai/article/microsofts-2026-copilot-evolution-from-drafting-assistant-to-governed-ai-execution-layer.409373))
  — "from drafting assistant to active execution layer governed by
  corporate policies" — exactly the operational → strategic shift.
- **AI Agent & Copilot Summit 2026** ([speakers / sessions](https://cloudwars.com/ai/ai-agent-copilot-summit-2026-speakers-sessions-released/))
  — the 2026 industry alignment around AI-for-executives.
- **Copilot Studio April 2026 updates** ([Microsoft blog](https://www.microsoft.com/en-us/microsoft-copilot/blog/copilot-studio/new-and-improved-agent-governance-intelligent-workflows-and-connected-app-experiences/))
  — agent governance, intelligent workflows, connected app
  experiences — the orchestration substrate for strategic agents.
- **Copilot Studio security + governance** ([Help Net Security, May 2026](https://www.helpnetsecurity.com/2026/05/14/copilot-studio-security-governance-updates/))
  — "Microsoft turns Copilot Studio into an AI agent control center".

---

## 9. How this connects to existing Borjie architecture

- **Deep research** [`DEEP_RESEARCH_SPEC.md`](./DEEP_RESEARCH_SPEC.md):
  the primary external-substrate source. Strategic memos invoke
  `research_v1` with elevated cost budget and broader source-scope.
- **Capability catalogue** [`CAPABILITY_CATALOGUE_SPEC.md`](./CAPABILITY_CATALOGUE_SPEC.md):
  the internal capability state map is the SWOT/scenario internal
  input.
- **Self-improving loops** [`SELF_IMPROVING_LOOPS_SPEC.md`](./SELF_IMPROVING_LOOPS_SPEC.md):
  the weekly self-improvement report's strategic-pulse section reads
  from the strategic-memo stream.
- **Information synthesis** [`INFORMATION_SYNTHESIS_SOTA_SPEC.md`](./INFORMATION_SYNTHESIS_SOTA_SPEC.md):
  L4 corpus syntheses are the strategic-memo's internal-history
  substrate.
- **Junior dynamic spawning** [`JUNIOR_DYNAMIC_SPAWNING_SPEC.md`](./JUNIOR_DYNAMIC_SPAWNING_SPEC.md):
  the `strategic-advisor` junior is a seed in the catalogue.
- **Cognitive engine** [`COGNITIVE_ENGINE_SPEC.md`](./COGNITIVE_ENGINE_SPEC.md):
  the 6 disciplines run on strategic-memo composition (with strict
  citation discipline).
- **Five-layer loop** [`FIVE_LAYER_LOOP_ARCHITECTURE.md`](./FIVE_LAYER_LOOP_ARCHITECTURE.md):
  every strategic-memo composition is a 5-layer loop with elevated
  regulatory + factual gate weights.
- **Org legibility** [`ORG_LEGIBILITY_SPEC.md`](./ORG_LEGIBILITY_SPEC.md):
  every strategic memo joins the legibility stream as a high-tag
  artifact.
- **Autonomous loops** [`AUTONOMOUS_LOOPS_SPEC.md`](./AUTONOMOUS_LOOPS_SPEC.md):
  the morning briefing surfaces newly-composed strategic memos as
  decision affordances.
- **Mutation authority** [`MUTATION_AUTHORITY_SPEC.md`](./MUTATION_AUTHORITY_SPEC.md):
  the strategic-junior's outputs are draft-only (Tier 1); execution
  on the recommendations is always owner-driven.

---

## 10. Anti-patterns

1. **Strategic memo without market context.** A memo composed only
   from internal data is structurally under-informed. The composer
   MUST invoke `research_v1` for external sources; absence blocks
   the output.
2. **Strategic memo without dissenting view.** A memo that recommends
   X without articulating the case for Y is propaganda. Every memo
   includes a `dissenting_view` field; empty values block the output.
3. **Single-scenario plan.** A scenario plan with only one scenario
   is not a scenario plan. Always 3 (downside, base, upside).
4. **Hallucinated competitor data.** External-citation gate is strict:
   competitor claims need a URL + date + author. Vague *"competitors
   are doing X"* without specific sources blocks the gate.
5. **Confidence inflation.** Strategic memos default to
   `confidence: 'medium'` unless the calibration formula explicitly
   shows ≥0.85; strategic claims rarely warrant `'high'` confidence
   because the time horizon amplifies uncertainty.
6. **Execution from a strategic memo.** Strategic memos are
   Tier 1 (drafts only). Execution requires a separate Tier 2
   mutation per [`MUTATION_AUTHORITY_SPEC.md`](./MUTATION_AUTHORITY_SPEC.md).
   A junior that proposes execution-from-strategic-memo violates the
   layer.
7. **Cross-tenant strategic intel leakage.** A strategic memo for
   tenant A must not reference tenant B's specifics, even if
   federation is enabled. Federation supplies aggregated patterns
   only.
8. **Stale strategic memos used as decision inputs.** Strategic
   memos older than 90 days are considered stale; the morning
   briefing flags this and offers to re-compose.

---

## 11. Cost discipline

Strategic memos are the most expensive operations in the platform.
Defaults:

| Memo kind | Model | Cost target | Latency target |
|---|---|---|---|
| **Weekly strategic-pulse** | Sonnet 4.6 | $1 per memo | 60s |
| **SWOT analysis (quarterly)** | Sonnet 4.7 (1M ctx) | $10 per memo | 180s |
| **Scenario plan (annual)** | Sonnet 4.7 + Opus 4.7 ensemble | $30 per memo | 300s |
| **Capital allocation memo (ad-hoc)** | Sonnet 4.7 | $5 per memo | 120s |
| **M&A opportunity memo (ad-hoc)** | Sonnet 4.7 | $8 per memo | 180s |

The tenant has a configurable monthly strategic-budget cap (default
$200/month for small cooperatives; higher for larger tenants).
Over-budget memos require explicit owner authorisation.

---

## 12. Phase 2 implementation map

- **New package** `packages/strategic-layer/` (≈1500 LOC):
  - `strategic-memo-composer.ts` (the main composition orchestrator).
  - `swot-engine.ts`.
  - `scenario-engine.ts`.
  - `capital-allocation-engine.ts`.
  - `ma-opportunity-engine.ts`.
  - `strategic-advisor-junior.ts` (seed junior bootstrap).
- **New service** `services/strategic-memo-worker/` — runs on the
  scheduled triggers + on owner-on-demand.
- **Migration** `0040_strategic_layer.sql`:
  - `strategic_memos` table.
  - `strategic_memo_requests` table.
  - `strategic_memo_pins` table (owner-pinned standing inputs).
- **API routes:**
  - `POST /api/v1/strategic/request`
  - `GET  /api/v1/strategic/memos`
  - `POST /api/v1/strategic/decision`
- **Owner-dashboard surface:** `apps/owner-dashboard/src/strategic-memos/`.
- **Seed `strategic-advisor` junior** in the junior catalogue.
- **Estimated effort:** 7 weeks (one engineer; mostly orchestration
  over existing primitives).

---

## 13. Acceptance criteria

- Each tenant generates ≥1 quarterly SWOT and ≥1 annual scenario plan.
- The weekly strategic-pulse is part of the weekly self-improvement
  report.
- Strategic memos all carry ≥10 external citations and ≥10 internal
  citations (synthesis-input-citations count toward internal).
- Every strategic memo's recommendation includes a dissenting view.
- The owner decision rate on strategic memos is tracked; baseline
  target ≥50% within 30 days (approval + decline, not deferral).
- The strategic-budget cap is enforced at the tenant level.

---

## 14. Cross-reference to siblings

- Master vision: [`AI_NATIVE_OS_MASTER.md`](../STRATEGY/AI_NATIVE_OS_MASTER.md)
  §1 (Productivity → Capability → *Strategic*) and §7.1 (Aida's
  morning brief includes a strategic memo).
- Deep research: [`DEEP_RESEARCH_SPEC.md`](./DEEP_RESEARCH_SPEC.md).
- Capability catalogue: [`CAPABILITY_CATALOGUE_SPEC.md`](./CAPABILITY_CATALOGUE_SPEC.md).
- Junior dynamic spawning: [`JUNIOR_DYNAMIC_SPAWNING_SPEC.md`](./JUNIOR_DYNAMIC_SPAWNING_SPEC.md).
- Self-improving loops: [`SELF_IMPROVING_LOOPS_SPEC.md`](./SELF_IMPROVING_LOOPS_SPEC.md).
- Information synthesis: [`INFORMATION_SYNTHESIS_SOTA_SPEC.md`](./INFORMATION_SYNTHESIS_SOTA_SPEC.md).
- Org legibility: [`ORG_LEGIBILITY_SPEC.md`](./ORG_LEGIBILITY_SPEC.md).
- Five-layer loop: [`FIVE_LAYER_LOOP_ARCHITECTURE.md`](./FIVE_LAYER_LOOP_ARCHITECTURE.md).
- On-demand internal software: [`ON_DEMAND_INTERNAL_SOFTWARE_SPEC.md`](./ON_DEMAND_INTERNAL_SOFTWARE_SPEC.md) — strategic-grade tools can be generated through the same surface.
- Tab-as-loop: [`TAB_AS_LOOP_SPEC.md`](./TAB_AS_LOOP_SPEC.md) — the
  strategic-memo tab is itself a loop.
- 24/7 work cycle: [`CONTINUOUS_24_7_WORK_CYCLE_SPEC.md`](./CONTINUOUS_24_7_WORK_CYCLE_SPEC.md) — overnight is when scheduled strategic memos compose.

---

*The board-grade Mr. Mwikila. Same persona; same audit chain; same
cite-or-stay-silent discipline. Different time horizon, different
substrate balance, different cost profile. The owner walks into the
quarter with a board pack written by a counsel who knows the business
from every Slack DM to every Tumemadini royalty calc.*
