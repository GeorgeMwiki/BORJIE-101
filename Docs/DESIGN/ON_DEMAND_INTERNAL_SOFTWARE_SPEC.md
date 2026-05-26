# On-Demand Internal Software — Design Specification

> Wave 22. Pillar B of [`AI_NATIVE_OS_MASTER.md`](../STRATEGY/AI_NATIVE_OS_MASTER.md).
> The MD generates org-specific internal tools on demand. The owner
> says *"I need a tool to track buyer onboarding velocity"* and Mr.
> Mwikila creates one — UI + recipe + storage + workflow + authority
> gate — wired into the platform.
>
> **Cross-links:** [`ANTICIPATORY_UX_SPEC.md`](./ANTICIPATORY_UX_SPEC.md),
> [`CAPABILITIES_UNIFICATION.md`](./CAPABILITIES_UNIFICATION.md),
> [`MUTATION_AUTHORITY_SPEC.md`](./MUTATION_AUTHORITY_SPEC.md),
> [`TAB_AS_LOOP_SPEC.md`](./TAB_AS_LOOP_SPEC.md),
> [`JUNIOR_DYNAMIC_SPAWNING_SPEC.md`](./JUNIOR_DYNAMIC_SPAWNING_SPEC.md),
> [`INFORMATION_SYNTHESIS_SOTA_SPEC.md`](./INFORMATION_SYNTHESIS_SOTA_SPEC.md),
> [`ORG_LEGIBILITY_SPEC.md`](./ORG_LEGIBILITY_SPEC.md).

Brand: Borjie. Persona: Mr. Mwikila. Status: design-spec.

---

## 1. Vision — founder verbatim

> "Almost like an ON-DEMAND INTERNAL SOFTWARE for all orgs' ops."

---

## 2. The Thesis — Internal Tools That Don't Exist Until You Need Them

Every organisation, eventually, needs internal tools that no SaaS
vendor sells: *"the report that shows me each surveyor's last 5 wall-
stability flags"*, *"the dashboard that ranks my buyers by repeat-
order frequency"*, *"the workflow that fires a reminder when an EIA
renewal is within 60 days"*. The traditional path: hire a developer,
file a Jira ticket, wait 6 weeks, get something that works for 3
months until the requirements drift.

Borjie's contract: the owner says it in chat, Mr. Mwikila generates
the tool in <60 seconds, the tool ships into the workspace alongside
every other tab, and the tool joins the lock/improve cycle so it
gets better the more it's used. The internal-tool ceiling stops being
"what a 2-engineer dev team can ship in a quarter" and becomes "what
the owner can name in a sentence."

The 2026 landscape:

- [**Vercel v0.app**](https://vercel.com/blog/announcing-v0-generative-ui)
  (rebranded January 2026) — "input natural language description →
  automatically generate high-quality React components → one-click
  deployment to Vercel". v0 is the closest analogue. v0 generates a
  *UI component*; Borjie generates a *whole tool* — UI + persisted
  data + recipe + workflow + authority gate + audit anchoring.
- [**Vercel AI SDK 3 with generative UI**](https://vercel.com/blog/ai-sdk-3-generative-ui)
  — primitives for streaming React Server Components.
- [**v0 Enterprise**](https://www.nxcode.io/resources/news/v0-by-vercel-complete-guide-2026)
  — SSO, SOC 2 commitments, secure Snowflake/AWS integrations. The
  enterprise-shape Borjie needs is similar.
- **Retool, Glide, internal-tool builders** — pre-2026 generation;
  human authors the tool. Borjie's distinction: the *MD* authors.

Borjie's distinct contribution is the *vertical-platform-native*
generation: the generated tool inherits the tenant's terminology,
scope binding, RBAC, audit-chain anchoring, mutation-authority gates,
and quality gates from the host platform. It's not a separate app —
it's a first-class Borjie tab.

---

## 3. The Architecture — five-component synthesis

When the owner requests a new tool, the generator produces a
**`GeneratedToolBundle`** with five components. All five must
generate together; partial bundles are rejected.

```
   "I need a tool to track buyer onboarding velocity"
                       │
                       ▼
        ┌──────────────────────────────────┐
        │  Tool Specification Composer     │
        │  (LLM: Sonnet 4.7 / Opus 4.7)    │
        └──────────────┬───────────────────┘
                       │
   ┌───────────┬───────┼──────────┬──────────┬─────────────┐
   ▼           ▼       ▼          ▼          ▼             ▼
┌──────┐  ┌────────┐ ┌─────┐  ┌────────┐  ┌─────────┐  ┌─────────┐
│ UI   │  │ Tab    │ │ DB  │  │ Work-  │  │ Authy   │  │ Junior  │
│ form │  │ Recipe │ │table│  │ flow   │  │ gate    │  │ persona │
│ comp │  │ +canary│ │+ RLS│  │ (cron) │  │ (tier1) │  │ (opt)   │
└──────┘  └────────┘ └─────┘  └────────┘  └─────────┘  └─────────┘
   │           │       │          │          │             │
   └───────────┴───────┴──────────┴──────────┴─────────────┘
                              │
                              ▼
            ┌──────────────────────────────┐
            │ Owner one-tap approval       │
            │ (Tier 2 mutation per         │
            │  MUTATION_AUTHORITY_SPEC)    │
            └──────────────┬───────────────┘
                           │
                           ▼
           ┌──────────────────────────────┐
           │ Tool live in workspace.      │
           │ Joins lock/improve cycle.    │
           └──────────────────────────────┘
```

### 3.1 Component 1 — UI form / display component

A React component using the existing
`@borjie/design-system` primitives. The composer generates JSX (or
declarative recipe JSON the recipe runtime renders). Same
quality-gates: cite-validator over any inline data; brand-gate; design-
token compliance.

### 3.2 Component 2 — TabRecipe

A versioned `TabRecipe` per
[`ANTICIPATORY_UX_SPEC.md`](./ANTICIPATORY_UX_SPEC.md). The recipe
declares the tab's fields, prefill sources, capability bindings, and
authority tier. The recipe enters the `shadow` state for canary
testing.

### 3.3 Component 3 — Database table + RLS policy

If the tool needs persisted state (e.g. buyer onboarding velocity
needs a "buyer onboarding event" table), the generator emits the
migration SQL + the RLS policy + the Drizzle schema. The migration
runs as a Tier 2-Critical mutation per
[`MUTATION_AUTHORITY_SPEC.md`](./MUTATION_AUTHORITY_SPEC.md) §2.2
(critical because schema changes are irreversible without rollback).

### 3.4 Component 4 — Workflow / cron / event handler

If the tool needs background behaviour (reminders, daily refreshes,
event subscriptions), the generator emits a worker registration
config. The worker runs in the existing
`services/proactive-triggers-worker/` substrate.

### 3.5 Component 5 — Authority gate

Every generated tool inherits an authority gate. Reads are Tier 0
(autonomous); writes are at minimum Tier 1 (drafts queued); external
actions are Tier 2 (owner approval).

### 3.6 Component 6 (optional) — Specialist junior persona

If the tool's domain is specialised enough, the generator spawns a
junior persona ([`JUNIOR_DYNAMIC_SPAWNING_SPEC.md`](./JUNIOR_DYNAMIC_SPAWNING_SPEC.md))
to handle the tool's chat-anchored interactions. The junior enters
`draft` state and matures normally.

---

## 4. The owner conversation flow

The end-to-end owner experience:

**Owner:** *"I need a tool to track buyer onboarding velocity — how
fast we get new buyers from first contact to first purchase."*

**Mr. Mwikila** (Cognitive Engine D4: interactive scoping):
*"Three quick questions. (1) Which steps in onboarding do you want
to track — first contact, KYB submitted, KYB approved, first
purchase? (2) Should the tool include average + median + p95 across
the buyer cohort, or just the median? (3) When the velocity slows
beyond a threshold, should I draft a buyer-followup reminder, or
just flag it?"*

**Owner:** *"All four steps. All three stats. Draft the reminder."*

**Mr. Mwikila:** *"Got it. Generating the tool. ETA 45 seconds."*

[~45 seconds]

**Mr. Mwikila:** *"Tool is ready. Here's the preview: a new tab called
'Buyer Onboarding Velocity' under your Sales section, a database
table called `buyer_onboarding_events`, a daily worker that recomputes
the velocity metrics, an authority gate that drafts the follow-up
reminder for your approval when velocity drops 20% week-over-week.
I'd like to test it on your current buyer cohort first as a shadow —
the live tool ships if the canary passes. Tap to approve."*

The owner taps approve. The tool is live within 60 seconds.

---

## 5. Operating contract — TypeScript

```typescript
export interface ToolRequestIntent {
  readonly raw_utterance: string;
  readonly extracted_intent: string;           // structured paraphrase
  readonly inferred_domain: CapabilityDomain;
  readonly clarifying_questions_asked: ReadonlyArray<ClarifyingQuestion>;
  readonly clarifying_answers: ReadonlyArray<string>;
  readonly required_data_sources: ReadonlyArray<DataSourceRef>;
  readonly required_actions: ReadonlyArray<ActionDescriptor>;
}

export interface GeneratedToolBundle {
  readonly id: string;
  readonly tenant_id: string;
  readonly request: ToolRequestIntent;
  readonly component_ui: UiComponentSpec;
  readonly component_recipe: TabRecipeSpec;
  readonly component_schema: DatabaseSchemaSpec | null;
  readonly component_workflow: WorkflowSpec | null;
  readonly component_authority_gate: AuthorityGateSpec;
  readonly component_junior_persona: JuniorPersonaSpec | null;
  readonly preview_url: string;
  readonly composition_cost_usd_cents: number;
  readonly composition_duration_ms: number;
  readonly status: 'composing' | 'pending_approval' | 'shadow_canary' | 'live' | 'rejected' | 'sunset';
  readonly composed_at: string;
  readonly approved_at: string | null;
  readonly approved_by: string | null;
  readonly audit_hash: string;
  readonly canary_metrics: CanaryMetrics | null;
}

export interface ToolLifecycleTransition {
  readonly bundle_id: string;
  readonly from_status: GeneratedToolBundle['status'];
  readonly to_status: GeneratedToolBundle['status'];
  readonly trigger: 'owner_approve' | 'canary_pass' | 'canary_fail' | 'owner_reject' | 'sunset_disuse';
  readonly transition_at: string;
  readonly notes: string;
}
```

Schema (migration `0039_on_demand_software.sql`):

```sql
CREATE TABLE generated_tool_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  request JSONB NOT NULL,
  component_ui JSONB NOT NULL,
  component_recipe JSONB NOT NULL,
  component_schema JSONB,
  component_workflow JSONB,
  component_authority_gate JSONB NOT NULL,
  component_junior_persona JSONB,
  preview_url TEXT NOT NULL,
  composition_cost_usd_cents INTEGER,
  composition_duration_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'composing'
    CHECK (status IN ('composing','pending_approval','shadow_canary','live','rejected','sunset')),
  composed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  approved_by UUID,
  audit_hash TEXT NOT NULL,
  canary_metrics JSONB
);
CREATE INDEX idx_gtb_tenant_status ON generated_tool_bundles(tenant_id, status, composed_at DESC);

CREATE TABLE tool_lifecycle_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id UUID NOT NULL REFERENCES generated_tool_bundles(id),
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  trigger TEXT NOT NULL,
  transition_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  audit_hash TEXT NOT NULL
);
```

---

## 6. The lock/improve cycle for generated tools

Generated tools join the same lifecycle as recipe-authored tabs:

```
draft → shadow_canary → live → locked → sunset
```

Defaults:

- `composing → pending_approval` on bundle complete.
- `pending_approval → shadow_canary` on owner approval (Tier 2).
- `shadow_canary → live` after ≥10 uses + ≥0.7 user-satisfaction
  sustained 14 days.
- `live → locked` after ≥50 uses + ≥0.85 satisfaction sustained
  30 days.
- `live/locked → sunset` if 0 uses in 90 days (with owner notice).

The tab-as-loop friction meter
([`TAB_AS_LOOP_SPEC.md`](./TAB_AS_LOOP_SPEC.md)) runs on every
generated tool from day one. Improvement proposals fold back into the
same lock/improve cycle.

---

## 7. Quality gates specific to tool generation

The standard 7 gates from
[`FIVE_LAYER_LOOP_ARCHITECTURE.md`](./FIVE_LAYER_LOOP_ARCHITECTURE.md)
all run, plus two extra:

### 7.1 Schema-safety gate

Schema mutations must not violate referential integrity, must not
drop columns currently referenced by other live tools, and must not
exceed the tenant's storage budget. Schema-safety gate runs against
the live schema via a pgquery dry-run before approval.

### 7.2 Brand-consistency gate (strict)

Generated UI components must use design-system tokens *only*. No
inline styles, no custom hex values, no third-party components. The
generated React tree is statically analysed; any non-conformance
blocks the bundle.

---

## 8. SOTA landscape — 2026 references

- **Vercel v0.app** ([Announcing v0](https://vercel.com/blog/announcing-v0-generative-ui),
  [Introducing the new v0](https://vercel.com/blog/introducing-the-new-v0),
  [WeavAI 2026 review](https://weavai.app/blog/en/2026/04/25/v0-by-vercel-2026-ai-ui-generator-review-pricing/),
  [NxCode complete guide](https://www.nxcode.io/resources/news/v0-by-vercel-complete-guide-2026),
  [Automation Atlas review](https://automationatlas.io/answers/v0-review-2026/))
  — generative UI; closest competitor; component-level not tool-level.
- **Vercel AI SDK 3 with generative UI** ([blog post](https://vercel.com/blog/ai-sdk-3-generative-ui))
  — streaming React Server Components for dynamic UI.
- **v0 enterprise integrations** ([VibeCoder guide](https://blog.vibecoder.me/v0-by-vercel-complete-guide))
  — secure Snowflake / AWS DB integrations; SSO; SOC 2.
- **ServiceNow + MCP "every AI agent in the enterprise"** ([newsroom, May 2026](https://newsroom.servicenow.com/press-releases/details/2026/ServiceNow-opens-its-full-system-of-action-to-every-AI-Agent-in-the-enterprise/default.aspx))
  — actions accessible via MCP for agent-built tools.
- **Microsoft Copilot Studio** ([May 2026 governance update](https://www.helpnetsecurity.com/2026/05/14/copilot-studio-security-governance-updates/))
  — agent-control-center model for governed agent execution.
- **Anthropic Three-Agent Harness** ([InfoQ](https://www.infoq.com/news/2026/04/anthropic-three-agent-harness-ai/))
  — separated planner / generator / evaluator for ≥4-hour autonomous
  development. Borjie ports the discipline to tool generation.

---

## 9. How this connects to existing Borjie architecture

- **Anticipatory UX** [`ANTICIPATORY_UX_SPEC.md`](./ANTICIPATORY_UX_SPEC.md):
  the lock/improve cycle is *the same* lifecycle as ordinary tab
  recipes; generated tools are not a special case.
- **Capabilities unification** [`CAPABILITIES_UNIFICATION.md`](./CAPABILITIES_UNIFICATION.md):
  `compose_anything_v1` is extended with a sixth sub-capability,
  `compose_tool_v1`. The compose layer routes a tool-generation intent
  to this sub-capability.
- **Mutation authority** [`MUTATION_AUTHORITY_SPEC.md`](./MUTATION_AUTHORITY_SPEC.md):
  schema mutations and tool-publish are Tier 2/2-Critical mutations
  that require owner approval.
- **Tab-as-loop** [`TAB_AS_LOOP_SPEC.md`](./TAB_AS_LOOP_SPEC.md):
  generated tools are tab loops from inception; friction meters
  run on day one.
- **Junior dynamic spawning** [`JUNIOR_DYNAMIC_SPAWNING_SPEC.md`](./JUNIOR_DYNAMIC_SPAWNING_SPEC.md):
  specialised tool-chat surfaces spawn juniors automatically.
- **Information synthesis** [`INFORMATION_SYNTHESIS_SOTA_SPEC.md`](./INFORMATION_SYNTHESIS_SOTA_SPEC.md):
  generated tools query the synthesis catalogue for their data.
- **Org legibility** [`ORG_LEGIBILITY_SPEC.md`](./ORG_LEGIBILITY_SPEC.md):
  every generated tool is itself a legibility artifact.
- **Five-layer loop** [`FIVE_LAYER_LOOP_ARCHITECTURE.md`](./FIVE_LAYER_LOOP_ARCHITECTURE.md):
  the tool's runtime is a 5-layer loop.

---

## 10. Anti-patterns

1. **Bypassing mutation authority.** A generated tool that writes to
   the tenant DB without going through `MutationProposal` →
   `MutationApproval` is an arbitrary write channel. The schema-safety
   gate blocks the tool's deployment otherwise.
2. **Inline styles / custom design tokens.** The brand-consistency
   gate blocks any UI that bypasses the design system.
3. **Tool generation without canary.** Going `composing → live`
   without `shadow_canary` skips empirical validation. The tool MUST
   pass canary first.
4. **Tool with no measurable success criterion.** A tool that doesn't
   declare a measurable outcome cannot be evaluated for promotion.
   The composer prompts the owner for a success criterion at
   request time; absence blocks approval.
5. **Cross-tenant tool sharing without consent.** A generated tool
   that the meta-learning conductor proposes to other tenants
   ([`SELF_IMPROVING_LOOPS_SPEC.md`](./SELF_IMPROVING_LOOPS_SPEC.md) §2.4)
   must be tagged `'reusable_as_template'` and stripped of all
   tenant-specific data, scope bindings, and terminology.
6. **Schema mutation that drops live data.** A tool that proposes
   dropping a column currently referenced by other live tools must
   be rejected at the schema-safety gate.
7. **Generated worker without idempotency.** A workflow component
   with no idempotency key can re-fire and cause double-effects. The
   composer always wraps generated workers in the existing
   `IdempotencyCache`.
8. **Storage runaway.** A tool that writes a row per second to a
   table without TTL or partitioning grows unboundedly. The schema
   composer ALWAYS includes a retention policy.

---

## 11. Phase 2 implementation map

- **New package** `packages/internal-software-generator/` (≈1800 LOC):
  - `tool-spec-composer.ts` (LLM-driven spec generation).
  - `component-generators/` (UI, recipe, schema, workflow, gate, junior).
  - `bundle-validator.ts` (the schema-safety + brand-consistency gates).
  - `bundle-renderer.ts` (preview URL generation).
  - `tool-lifecycle.ts` (the lock/improve transitions).
- **New service** `services/tool-generation-worker/` — runs the
  Sonnet 4.7 / Opus 4.7 composition.
- **Migration** `0039_on_demand_software.sql`:
  - `generated_tool_bundles` table.
  - `tool_lifecycle_transitions` table.
- **API routes:**
  - `POST /api/v1/tools/request`
  - `GET  /api/v1/tools/preview/:bundle_id`
  - `POST /api/v1/tools/approve`
  - `GET  /api/v1/tools/list`
- **Owner-dashboard surface:** `apps/owner-dashboard/src/generated-tools/`.
- **compose_anything_v1 extension:** sub-capability `compose_tool_v1`.
- **Estimated effort:** 10 weeks (significant — closest analogue is
  v0, which took Vercel ~6 months at higher headcount).

---

## 12. Examples — what kinds of tools

Examples already discoverable in Borjie tenants:

| Owner request | Generated tool |
|---|---|
| "Track buyer onboarding velocity" | Tab + table + cron + reminder workflow |
| "Show me each surveyor's last 5 wall-stability flags" | Tab + denormalised view + display widget |
| "Workflow to remind me when an EIA renewal is within 60 days" | Cron worker + Tier 1 draft generator + reminder UI |
| "Dashboard showing my buyers ranked by repeat-order frequency" | Tab + aggregation view + sortable display |
| "Tool to log shift handoffs from the night surveyor" | Tab + form + table + WhatsApp connector listener |
| "Workflow that flags any parcel with assay > 8 g/t" | Trigger on parcel-insert + flag table + notification |
| "Tool to compare this quarter's pricing variance vs same quarter last year" | Tab + comparative-analysis view + synthesis input |

These examples are not curated; they are the typical class of
internal-software requests a mining cooperative generates per month.

---

## 13. Cross-reference to siblings

- Master vision: [`AI_NATIVE_OS_MASTER.md`](../STRATEGY/AI_NATIVE_OS_MASTER.md) §2.4.
- Anticipatory UX: [`ANTICIPATORY_UX_SPEC.md`](./ANTICIPATORY_UX_SPEC.md).
- Capabilities unification: [`CAPABILITIES_UNIFICATION.md`](./CAPABILITIES_UNIFICATION.md).
- Mutation authority: [`MUTATION_AUTHORITY_SPEC.md`](./MUTATION_AUTHORITY_SPEC.md).
- Tab-as-loop: [`TAB_AS_LOOP_SPEC.md`](./TAB_AS_LOOP_SPEC.md).
- Junior dynamic spawning: [`JUNIOR_DYNAMIC_SPAWNING_SPEC.md`](./JUNIOR_DYNAMIC_SPAWNING_SPEC.md).
- Information synthesis: [`INFORMATION_SYNTHESIS_SOTA_SPEC.md`](./INFORMATION_SYNTHESIS_SOTA_SPEC.md).
- Org legibility: [`ORG_LEGIBILITY_SPEC.md`](./ORG_LEGIBILITY_SPEC.md).
- Five-layer loop: [`FIVE_LAYER_LOOP_ARCHITECTURE.md`](./FIVE_LAYER_LOOP_ARCHITECTURE.md).
- Strategic direction: [`STRATEGIC_DIRECTION_LAYER_SPEC.md`](./STRATEGIC_DIRECTION_LAYER_SPEC.md) — strategic-grade tools (M&A scanner, capital-allocation model) generate via this same surface.
- 24/7 work cycle: [`CONTINUOUS_24_7_WORK_CYCLE_SPEC.md`](./CONTINUOUS_24_7_WORK_CYCLE_SPEC.md) — generated workflow components schedule themselves into the overnight cycle.

---

*Internal tools that don't exist until the owner names them. The
ceiling on what the business can do stops being a developer-team
constraint and becomes a *named-intent* constraint. The owner stops
ordering custom software and starts thinking about the work itself —
because the software is the work, generated on demand.*

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.

---

## § Founder-locked overrides applied per FOUNDER_LOCKED_DECISIONS_2026_05_26.md

This section is the immutable reconciliation record of founder-locked decisions that override prior defaults in this spec. Idempotent — re-running the reconcile pass is a no-op once this section exists. Persona: Mr. Mwikila.

### Override — Decision #5 (Cross-tenant template sharing — federation_consents scope='tools')

**Verbatim**: *FOLD into federation consent. Cross-tenant template sharing IS a federation-consent surface; do NOT build a separate consent UI.*

**Effect on this spec**:
- The `internal_tools` table from migration 0039 gains a `federation_scope` column (nullable). When a tenant authors a tool tagged `reusable_as_template`, sharing it cross-tenant requires that the tenant has an active row in `federation_consents` with `scope = 'tools'` (per Wave M10 migration 0040).
- No new table, no new consent UI; reuses the existing `federation_consents` surface.
- Templates surfaced to other tenants are auto-stripped of tenant-specific data: entity IDs hashed via the existing `packages/session-mirror/` salted-hash pattern; LLM prompts re-templated to use placeholders.
- The federation-consent dashboard (M10 spec) gains a "Templates" row; toggling it on/off flips `federation_consents.scope = 'tools'` rows on/off in a single click.
- Cross-references: `Docs/DESIGN/STRATEGIC_DIRECTION_LAYER_SPEC.md` (consent dashboard surface) and `Docs/DESIGN/SELF_IMPROVE_AND_DP_FEDERATION_SPEC.md` (meta-learning consumer reads same table).

**Action**: `packages/internal-software-generator/` adds the `federation_scope` field + enforcement gate. The gate refuses any cross-tenant template publish unless the producer tenant has an active `federation_consents.scope = 'tools'` row.

**Rationale**: Founder-locked unification: every cross-tenant data flow (templates, meta-learning gradients, anonymised insights) routes through one consent surface so the owner sees one toggle, one audit trail, one revocation path.
