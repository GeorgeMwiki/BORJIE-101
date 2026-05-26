# Tab as Loop — Design Specification

> Wave 21. Pillar C of [`AI_NATIVE_OS_MASTER.md`](../STRATEGY/AI_NATIVE_OS_MASTER.md).
> Every UI surface is an active discovery loop. Not a static dashboard.
>
> **Cross-links:** [`ANTICIPATORY_UX_SPEC.md`](./ANTICIPATORY_UX_SPEC.md),
> [`UNIVERSAL_OBSERVABILITY_SPEC.md`](./UNIVERSAL_OBSERVABILITY_SPEC.md),
> [`CAPABILITIES_UNIFICATION.md`](./CAPABILITIES_UNIFICATION.md),
> [`FIVE_LAYER_LOOP_ARCHITECTURE.md`](./FIVE_LAYER_LOOP_ARCHITECTURE.md),
> [`HOME_DASHBOARD_STANDARD.md`](./HOME_DASHBOARD_STANDARD.md),
> [`SELF_IMPROVING_LOOPS_SPEC.md`](./SELF_IMPROVING_LOOPS_SPEC.md).

Brand: Borjie. Persona: Mr. Mwikila. Status: design-spec.

---

## 1. Vision — founder verbatim

> "Each tab or part of a self never-ending improving and discovery
> loop with MD at centre."

---

## 2. The Thesis — No Static Surfaces

A traditional dashboard is dead until a human looks at it. A
traditional form is dead until a human types into it. A traditional
report is dead the moment it ships. Borjie inverts: **every UI surface
is an *active loop* that learns from how it is used, proposes
improvements, surfaces relevant hints, and recomposes itself when
the meta-learning conductor proposes a better variant.**

The 2026 dashboard literature is converging. [ServiceNow's Unified
Dashboards](https://www.servicenow.com/products/unified-dashboards.html)
and [interactive filters](https://www.servicenow.com/community/servicenow-ai-platform-articles/how-to-add-interactive-filters-in-servicenow-app-dashboards-2026/ta-p/3461519)
ship audience-aware widgets. Notion's [dashboard views](https://www.notion.com/releases/2026-03-10)
"let teams and agents easily assemble glanceable overviews directly on
top of databases". The pattern is: dashboards are no longer rectangles
of data — they are agent-active surfaces. Borjie pushes the pattern
one notch further: **every tab — Home, Dashboard, sub-routes,
recipe-spawned tabs, even modals — runs the 5-layer loop template
from [`FIVE_LAYER_LOOP_ARCHITECTURE.md`](./FIVE_LAYER_LOOP_ARCHITECTURE.md).**

---

## 3. The Tab-as-Loop Lifecycle

```
                       Tab open event
                              │
                              ▼
                ┌─────────────────────────┐
                │ L1: tab sensors fire    │
                │  (UI state, field state │
                │   from Wave 18R)        │
                └─────────────┬───────────┘
                              ▼
                ┌─────────────────────────┐
                │ L2: tab policy check    │
                │  (RBAC + scope + tier)  │
                └─────────────┬───────────┘
                              ▼
                ┌─────────────────────────┐
                │ L3: tab tools dispatch  │
                │  (proactive hints,      │
                │   spawn proposals,      │
                │   compose_anything_v1)  │
                └─────────────┬───────────┘
                              ▼
                ┌─────────────────────────┐
                │ L4: tab quality gates   │
                │  (citation / brand /    │
                │   friction / success)   │
                └─────────────┬───────────┘
                              ▼
                ┌─────────────────────────┐
                │ L5: tab learning writes │
                │  (telemetry, recipe     │
                │   evolution proposals)  │
                └─────────────────────────┘
```

Every tab is itself a `LoopDefinition`. The tab's lifecycle —
open / focus / use / blur / close — drives loop iterations. Each
iteration writes telemetry, computes a friction score, proposes
improvements, and may recompose its own recipe.

---

## 4. The four tab-loop primitives

Every tab implements four primitives. They are the layers above
collapsed into UI-friendly operations.

### 4.1 Tab Sensor — what the tab sees

When a tab opens, the tab sensor reads:

- The tab's recipe ID and version (e.g. `tab_recipe.buyer_kyb_start.v7`).
- The user's role + scope binding ([`ORG_HIERARCHY_TERMINOLOGY_SPEC.md`](./ORG_HIERARCHY_TERMINOLOGY_SPEC.md)).
- The user's mode preference ([`GUIDE_VS_LEARN_MODE_SPEC.md`](./GUIDE_VS_LEARN_MODE_SPEC.md)).
- The user's recent context (last 5 turns from cognitive-engine).
- The current Tier-II/III observability state (in-flight values,
  scroll, hover).
- The tab's prior friction score (from `tab_friction_history`).
- Available capability invocations for this tab's subject scope.

### 4.2 Hint Emitter — what the tab proposes

Within ≤500ms of open, the tab emits 0–3 **proactive hints** that
surface in the existing `NeedSpawnBanner` and `ProactiveHint`
components ([`ANTICIPATORY_UX_SPEC.md`](./ANTICIPATORY_UX_SPEC.md)).

Hint types:

- **Pre-fill suggestion** — "I've pre-filled this with buyer Jamhuri
  Mining Co (matched from your draft text)."
- **Adjacent-data offer** — "I noticed your draft KYB references the
  Geita PML; want me to attach the latest assay grades?"
- **Capability promotion** — "This tab has a `compose_doc_v1`
  affordance — want me to draft the buyer welcome packet alongside?"
- **Friction reminder** — "Last time you spent 22 minutes here;
  the field rearrangement we discussed cuts it to 8."

Each hint is itself an output of a sub-loop with its own quality
gates. A hint that fails the citation gate is suppressed.

### 4.3 Friction Meter — what the tab measures

Throughout the tab's lifetime, the friction meter accumulates signals:

- Time-on-tab (vs. tenant p50 for this tab).
- Field abandonment count (focus → blur without input).
- Backspaces and re-edits.
- Error states triggered.
- Help-affordance taps.
- Did the user exit before completing the workflow.
- Did Mr. Mwikila have to ask >1 clarifying question on the same tab.

These compose into a per-tab `FrictionScore` (0..1, higher = more
friction) that writes to `tab_friction_events` on every blur.

### 4.4 Recipe Improvement Proposer — what the tab learns

When friction crosses a threshold (default: rolling 7-day score
above 0.7), or when the meta-learning conductor proposes a recipe
variant, the tab evaluates the proposal:

- The current `live` recipe variant.
- The proposed `shadow` variant (different fields, different ordering,
  different defaults).
- Canary results from the existing
  [`ANTICIPATORY_UX_SPEC.md`](./ANTICIPATORY_UX_SPEC.md) recipe-variant
  testing.

If the shadow wins (friction drops + success rate holds), the tab's
runtime promotes the variant to `live` automatically (Tier 1
mutation per [`MUTATION_AUTHORITY_SPEC.md`](./MUTATION_AUTHORITY_SPEC.md) §2.1).
The prior `live` recipe `locks`. The owner sees the change in next
morning's briefing.

---

## 5. Operating contract — TypeScript

```typescript
export interface TabLoopDefinition extends LoopDefinition<TabContext, TabRunOutput> {
  readonly recipe_id: string;                      // 'tab_recipe.buyer_kyb_start'
  readonly version: string;
  readonly subject_scope: SubjectScope;
  readonly hint_emitters: ReadonlyArray<HintEmitter>;
  readonly friction_signals: ReadonlyArray<FrictionSignalReader>;
  readonly improvement_proposer: ImprovementProposer;
}

export interface TabContext {
  readonly tab_id: string;
  readonly session_id: string;
  readonly user_id: string;
  readonly tenant_id: string;
  readonly opened_at: string;
  readonly mode: 'guide' | 'learn';
  readonly mastery_score: number;
  readonly prior_friction_score: number;
  readonly recent_turns: ReadonlyArray<CognitiveTurnRef>;
  readonly ui_state_snapshot: UiStateGraph;
  readonly field_state_snapshot: FieldStateSnapshot;
}

export interface TabRunOutput {
  readonly hints_emitted: ReadonlyArray<EmittedHint>;
  readonly friction_score: number;
  readonly success_signals: ReadonlyArray<SuccessSignal>;
  readonly improvement_proposals: ReadonlyArray<RecipeImprovementProposal>;
}

export interface EmittedHint {
  readonly id: string;
  readonly kind: 'pre_fill' | 'adjacent_data' | 'capability_promotion' | 'friction_reminder';
  readonly content: string;
  readonly evidence_citations: ReadonlyArray<SpanCitation>;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly emitted_at: string;
  readonly action_taken: 'pending' | 'accepted' | 'dismissed' | 'ignored';
}

export interface FrictionSignal {
  readonly kind: 'time_on_tab' | 'field_abandonment' | 'backspace_burst' | 'error_state' | 'help_tap' | 'incomplete_exit' | 'clarification_loop';
  readonly value: number;
  readonly threshold: number;
  readonly weight: number;                         // 0..1
  readonly observed_at: string;
}

export interface RecipeImprovementProposal {
  readonly id: string;
  readonly source_tab_id: string;
  readonly current_recipe_id: string;
  readonly current_recipe_version: string;
  readonly proposed_recipe_version: string;
  readonly hypothesis: string;                     // "moving field X above field Y reduces abandonment"
  readonly canary_metrics: CanaryMetrics;
  readonly recommended_action: 'promote' | 'further_canary' | 'reject';
  readonly evidence: ReadonlyArray<FrictionSignal>;
}
```

Schema additions (migration `0036_tab_as_loop.sql`):

```sql
CREATE TABLE tab_friction_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  tab_id TEXT NOT NULL,
  recipe_id TEXT NOT NULL,
  signals JSONB NOT NULL,
  friction_score NUMERIC(4,3) NOT NULL,
  measured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tfe_recipe_measured ON tab_friction_events(recipe_id, measured_at DESC);

CREATE TABLE tab_hint_emissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  tab_id TEXT NOT NULL,
  recipe_id TEXT NOT NULL,
  hint_kind TEXT NOT NULL,
  hint_content TEXT NOT NULL,
  evidence_citations JSONB NOT NULL DEFAULT '[]',
  confidence TEXT NOT NULL,
  action_taken TEXT NOT NULL DEFAULT 'pending',
  emitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE recipe_improvement_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  source_tab_id TEXT NOT NULL,
  current_recipe_id TEXT NOT NULL,
  current_recipe_version TEXT NOT NULL,
  proposed_recipe_version TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  canary_metrics JSONB NOT NULL,
  recommended_action TEXT NOT NULL,
  evidence JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','promoted','rejected','expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
```

All three with RLS by `tenant_id`.

---

## 6. The four tab classes

Every Borjie tab falls into one of four classes; each gets a default
hint/friction profile.

### 6.1 Composer tabs (e.g. `tab_recipe.buyer_kyb_start`)

The user enters data; Mr. Mwikila composes a downstream artifact.
Friction signal weights: field abandonment ×3, backspace ×2,
clarification-loop ×2. Hints: pre-fill, adjacent data.

### 6.2 Workflow tabs (e.g. `tab_recipe.tumemadini_filing`)

Multi-step process with milestones. Friction signal weights:
incomplete-exit ×4, help-tap ×2. Hints: capability promotion, friction
reminder.

### 6.3 Dashboard tabs (Home/Dashboard standard)

Read-mostly; cards, charts, tables. Friction signal weights:
time-on-tab ×1, scroll-not-engaging ×2. Hints: adjacent-data,
capability-promotion.

### 6.4 Insight tabs (e.g. strategic memo, weekly self-improvement)

Read-only, high-stakes. Friction signal weights: incomplete-read ×3.
Hints: capability-promotion only (no pre-fill, no field-related).

---

## 7. SOTA landscape — 2026 references

- **ServiceNow Unified Dashboards** ([product page](https://www.servicenow.com/products/unified-dashboards.html),
  [interactive filters](https://www.servicenow.com/community/servicenow-ai-platform-articles/how-to-add-interactive-filters-in-servicenow-app-dashboards-2026/ta-p/3461519))
  — audience-aware dashboards, multiple data cuts, single report
  logic. The dashboard-as-active-surface pattern.
- **Notion dashboard views** ([March 2026 release](https://www.notion.com/releases/2026-03-10))
  — "let teams and agents assemble glanceable overviews directly on
  top of databases".
- **Microsoft Copilot Studio agent governance** ([May 2026](https://www.helpnetsecurity.com/2026/05/14/copilot-studio-security-governance-updates/))
  — "active execution layer governed by corporate policies"; the
  tab-as-loop mirror at the workspace level.
- **ServiceNow + MCP** ([newsroom, May 2026](https://newsroom.servicenow.com/press-releases/details/2026/ServiceNow-opens-its-full-system-of-action-to-every-AI-Agent-in-the-enterprise/default.aspx))
  — "open system of action to every AI agent" via MCP; every tab can
  invoke arbitrary external agents.

---

## 8. How this connects to existing Borjie architecture

- **Anticipatory UX** [`ANTICIPATORY_UX_SPEC.md`](./ANTICIPATORY_UX_SPEC.md):
  the lock/improve/promote cycle already shipped is the substrate this
  spec rides on. Tab-as-loop *extends* the existing recipe machinery
  with friction metering and hint emission.
- **Universal observability** [`UNIVERSAL_OBSERVABILITY_SPEC.md`](./UNIVERSAL_OBSERVABILITY_SPEC.md):
  Tier II (field state) + Tier III (UI state) feed the friction meter.
- **Capabilities unification** [`CAPABILITIES_UNIFICATION.md`](./CAPABILITIES_UNIFICATION.md):
  `compose_anything_v1` is the dispatch tool every tab loop invokes.
- **Five-layer loop** [`FIVE_LAYER_LOOP_ARCHITECTURE.md`](./FIVE_LAYER_LOOP_ARCHITECTURE.md):
  every tab is a `LoopDefinition` with the 7 mandatory gates.
- **Home/Dashboard** [`HOME_DASHBOARD_STANDARD.md`](./HOME_DASHBOARD_STANDARD.md):
  the Home tab and Dashboard tab are the two largest tab loops; same
  template.
- **Self-improving loops** [`SELF_IMPROVING_LOOPS_SPEC.md`](./SELF_IMPROVING_LOOPS_SPEC.md):
  recipe-improvement proposals from tab-as-loop join the per-recipe
  loop variant test stream.

---

## 9. Anti-patterns

1. **Read-only tab.** A tab that just displays and never produces
   hints, friction signals, or improvement proposals violates the
   spec. The tab is functionally an open-loop *device*, not a Borjie
   tab. Such surfaces must be wrapped or removed.
2. **Hint spam.** ≤3 hints per tab open; ≤1 hint per 30s during use.
   Beyond that, the user adapts by ignoring hints (the
   anticipatory-UX literature is consistent on this).
3. **Friction-meter false positive on novice users.** A novice taking
   45 minutes on a tab is *learning*, not *frustrated*. The friction
   meter must read the user's mastery score and gate signal weights.
   For mastery < 0.5, time-on-tab weight halves.
4. **Recipe auto-promotion without canary.** A shadow variant that
   wins on one user must not promote globally. Wait for the
   canary-tenant set (existing Wave 17B/18F discipline) before
   promoting to `live`.
5. **Hint without evidence.** Every hint MUST cite the evidence that
   produced it (matched draft, prior buyer record, etc.). Hints
   without citations fail the citation gate.
6. **Loops without quality gates.** Every tab loop runs the full
   7-gate stack from [`FIVE_LAYER_LOOP_ARCHITECTURE.md`](./FIVE_LAYER_LOOP_ARCHITECTURE.md);
   tabs do not weaken the standard.
7. **Tab-only learning that doesn't write to cognitive memory.** The
   tab loop's learning writes MUST include cognitive memory cell
   writes; learning that stays at the tab level is silo'd and does
   not compound across the platform.

---

## 10. Phase 2 implementation map

- **New package** `packages/tab-as-loop/` (≈900 LOC):
  - `tab-loop-definition.ts` (the `TabLoopDefinition` type + helpers).
  - `hint-emitters/` (per-class hint emitters).
  - `friction-meter.ts` (signal accumulation + score).
  - `improvement-proposer.ts` (recipe-variant proposer).
  - `tab-runtime.ts` (browser-side runtime that drives the loop).
- **Migration** `0036_tab_as_loop.sql` — 3 tables above.
- **API routes:**
  - `POST /api/v1/tab-loop/event` — accept browser-side signal events.
  - `GET  /api/v1/tab-loop/hints/:tab_id`
  - `GET  /api/v1/tab-loop/friction/:recipe_id` — aggregate query.
- **chat-ui changes:**
  - Wrap every existing tab in `<TabLoopProvider recipe_id=...>`.
  - Wire `NeedSpawnBanner` to read hint emissions.
  - Wire `ProactiveHint` for friction-reminder hints.
- **Estimated effort:** 5 weeks (most reuse from existing
  anticipatory-UX recipe machinery).

---

## 11. Cross-reference to siblings

- Master vision: [`AI_NATIVE_OS_MASTER.md`](../STRATEGY/AI_NATIVE_OS_MASTER.md)
  §3.2 (the immersed layer) and §6 (the 5-layer principle).
- Anticipatory UX: [`ANTICIPATORY_UX_SPEC.md`](./ANTICIPATORY_UX_SPEC.md).
- Universal observability: [`UNIVERSAL_OBSERVABILITY_SPEC.md`](./UNIVERSAL_OBSERVABILITY_SPEC.md).
- Five-layer loop: [`FIVE_LAYER_LOOP_ARCHITECTURE.md`](./FIVE_LAYER_LOOP_ARCHITECTURE.md).
- Daily user follow-up: [`DAILY_USER_FOLLOWUP_SPEC.md`](./DAILY_USER_FOLLOWUP_SPEC.md)
  — the check-in surfaces per-tab friction summaries.
- Org legibility: [`ORG_LEGIBILITY_SPEC.md`](./ORG_LEGIBILITY_SPEC.md) —
  every hint emission, every friction event is a typed legibility
  artifact.
- 24/7 work cycle: [`CONTINUOUS_24_7_WORK_CYCLE_SPEC.md`](./CONTINUOUS_24_7_WORK_CYCLE_SPEC.md) — overnight is when the recipe improvements canary-test.
- On-demand internal software: [`ON_DEMAND_INTERNAL_SOFTWARE_SPEC.md`](./ON_DEMAND_INTERNAL_SOFTWARE_SPEC.md)
  — generated tabs are themselves tab-loops from day one.

---

*Every UI surface improves itself, every visit, in front of the owner,
under the same audit discipline as every other loop. No static
surfaces. Ever.*
