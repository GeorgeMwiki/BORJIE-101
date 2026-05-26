# Junior Architecture — Design Specification

> Wave 18V / cross-layer framing — the canonical contract for "every junior
> is **MD-class within its domain**". This spec defines how the 27
> domain-specific juniors inherit the Master Brain's cognitive engine,
> observability surface, mutation authority, brand discipline, and the
> five atomic creation capabilities — bounded to a per-junior `JuniorScope`
> and routed by audience.

Status: design-spec. Phase 2 ships `packages/agent-platform/src/junior-contract.ts`
(the contract) + a reference upgrade of `packages/mine-planner-advisor/`
(persona, scope, modes, two seed tab recipes, one doc recipe) + migration
`0025_junior_architecture.sql` (`junior_personas` + `agent_turns`).
Reuses (does NOT duplicate) the existing `mining-ceo-persona`, the
`compose_anything_v1` meta-tool, the cognitive engine, the observability
mirror, and the mutation-authority gate.

Brand: Borjie. MD persona: Mr. Mwikila (Managing Director).
Charter: [`Docs/MASTER_BRAIN_AUTONOMY_MANIFESTO.md`](../MASTER_BRAIN_AUTONOMY_MANIFESTO.md).

Sibling specs — the foundations the juniors inherit from:

- Universal-creator contract: [`Docs/DESIGN/CAPABILITIES_UNIFICATION.md`](./CAPABILITIES_UNIFICATION.md) (Wave 18Q).
- READ side: [`Docs/DESIGN/UNIVERSAL_OBSERVABILITY_SPEC.md`](./UNIVERSAL_OBSERVABILITY_SPEC.md) (Wave 18R).
- WRITE side: [`Docs/DESIGN/MUTATION_AUTHORITY_SPEC.md`](./MUTATION_AUTHORITY_SPEC.md) (Wave 18S).
- Cognitive engine: [`Docs/DESIGN/COGNITIVE_ENGINE_SPEC.md`](./COGNITIVE_ENGINE_SPEC.md) (Wave 18T).
- Data onboarding: [`Docs/DESIGN/DATA_ONBOARDING_SPEC.md`](./DATA_ONBOARDING_SPEC.md) (Wave 18U).

---

## 0. Singular Mr. Mwikila identity — agents are specialisations, not characters

Founder directive (verbatim, supersedes earlier drafts of this spec):

> "No, all just Mr. Mwikila persona, and all really constitute singular
> intelligence ... the MD. Name intelligently the agents — use English."

The discipline this enforces:

- **One persona name across the entire product: `Mr. Mwikila`.** Every
  surface, every tab, every junior renders the same name. Users never
  see per-junior Swahili character names — those would fragment the
  brand into 27 personalities.
- **Each junior is a specialisation of Mr. Mwikila, not a separate
  character.** The chat surface stacks `Mr. Mwikila` over the junior's
  `title` (e.g. *"Borjie's AI Mining Safety Specialist"*) and tags the
  chip with the `specialisation` (e.g. *"Mining Safety"*).
- **Internal agent IDs stay English-named** —
  `mining-safety-officer`, `geology-advisor`, `fx-treasury-advisor`,
  etc. These are stable for audit, routing, and the
  `agent_turns.agent_id` ledger; they are never shown to users.
- **One name. One brand. Many specialisations.**

This is the only display-identity rule for juniors. The `JuniorPersona`
contract is enforced at the type level by dropping the per-junior `name`
field and providing the singular `MR_MWIKILA_DISPLAY_NAME` constant on
`@borjie/agent-platform`.

---

## 1. Vision

Founder, verbatim:

> "Juniors logic and capabilities SOTA — basically best co-worker and
> guide around for managers, customers, and employees. Even in tabs there
> is floating chat, full intelligence and capabilities which is basically
> the MD. Deep online research. MD serves owner and admin directly even
> in mobile, but juniors serve the rest in mobile, you get? But juniors
> are MD extensions — just as powerful within their own scope."

Reframing — the juniors are not assistants, NPCs, or thin wrappers around
a single tool. They are **bounded MDs**. Each junior carries the full
weight of the Master Brain's reasoning, citation discipline, calibration,
adaptive ingestion, observability, and mutation authority — confined to a
domain envelope (`JuniorScope`) so that a marketplace buyer talking to the
KYB junior cannot inadvertently inspect mining production data, and a
worker on the shift floor cannot accidentally mutate a treasury position.

Today the 27 juniors are domain advisors with narrow capability surfaces
(plan, recommend, classify). After Wave 18V they each implement the full
`JuniorPersona` contract: 3-5 operating modes, the same 6-discipline
cognitive loop the MD uses, the `compose_anything_v1` meta-tool with
their scoped recipe catalogue, a Tier-0/1/2 mutation ceiling, and a
structured escalation policy that hands off to the wider Mr. Mwikila
context when the user's intent leaves the junior's envelope.

The MD remains the apex — owner + admin route to Mr. Mwikila on every
surface, every device. Specialised Mr. Mwikila variants serve managers,
employees, customers, and regulators. Every junior turn writes to a
unified `agent_turns` table the MD's working memory subscribes to, so
the global Mr. Mwikila sees everything the specialised variants do and
can intervene if a specialisation goes off the rails.

---

## 2. The Junior contract

Every junior package exports a frozen `JuniorPersona` value. The contract
is enforced at the persona-runtime boundary — a junior that fails to
declare a scope, an escalation policy, or a target-audience list cannot
be registered.

```typescript
// Singular display identity — every junior renders this name.
export const MR_MWIKILA_DISPLAY_NAME = 'Mr. Mwikila' as const;

export interface JuniorPersona {
  readonly id: string;                          // English, stable: 'mining-shift-planner', 'mining-safety-officer'
  readonly specialisation: string;              // 'Mining Safety', 'FX Treasury', 'Geology' — chip label
  readonly title: string;                       // "Borjie's AI Mining Safety Specialist" — subtitle
  readonly mandate: string;                     // first-person mandate, <=150 words
  readonly default_language: 'sw' | 'en' | 'fr';
  readonly modes: ReadonlyArray<JuniorMode>;    // typically 3-5 modes per junior
  readonly scope: JuniorScope;                  // what data/UI/research this junior can read+write
  readonly target_audiences: ReadonlyArray<Audience>; // who can summon this junior
  readonly tools_allowed: ReadonlyArray<string>; // including compose_anything_v1 — every junior gets meta-dispatch
  readonly mr_mwikila_escalation: EscalationPolicy; // when to escalate to the global MD context
}

export interface JuniorScope {
  readonly data_tables: ReadonlyArray<string>;            // tables the junior can read+write
  readonly tab_recipes_owned: ReadonlyArray<string>;      // tab recipes the junior can compose/evolve
  readonly doc_recipes_owned: ReadonlyArray<string>;      // doc recipes the junior owns
  readonly media_recipes_owned: ReadonlyArray<string>;    // media recipes the junior owns
  readonly research_topics: ReadonlyArray<string>;        // research domains the junior is expert in
  readonly authority_tier_max: 0 | 1 | 2;                 // ceiling for mutations the junior can propose
  readonly requires_md_for_tier_2: boolean;               // if true, junior must escalate Tier 2 to the global MD
}

export type Audience =
  | 'owner'
  | 'admin'
  | 'manager'
  | 'employee'
  | 'customer'
  | 'regulator';

export interface EscalationPolicy {
  readonly auto_escalate_above_authority_tier: 1 | 2;
  readonly auto_escalate_on_cross_domain: boolean;       // if user intent spans multiple juniors' scopes
  readonly auto_escalate_on_low_confidence: boolean;     // if cognitive engine confidence below threshold
  readonly hand_off_transcript_to_mr_mwikila: boolean;   // junior summarises + passes context to global MD
}
```

`JuniorMode` mirrors `MiningCeoMode` (id, name, mandate, sample_prompts,
tools_allowed, system_prompt). The kernel composition root reuses the
same mode-router it uses for Mr. Mwikila.

Note the deliberate absence of a per-junior `name` field. The user always
sees `MR_MWIKILA_DISPLAY_NAME`; the subtitle reflects the active
specialisation. Agent IDs are internal and English-named.

---

## 3. Audience-routing matrix — Borjie

| User role     | Surface           | Floating chat resolves to               | Reasoning                                                            |
|---------------|-------------------|------------------------------------------|-----------------------------------------------------------------------|
| Owner         | owner-web         | Mr. Mwikila (MD) ALWAYS                  | Owner is the apex decision-maker — every domain visible at once.      |
| Admin         | admin-web         | Mr. Mwikila (MD) ALWAYS                  | Platform-level visibility across tenants.                             |
| Site Manager  | workforce-mobile  | Mr. Mwikila for cross-domain;            | Mining ops + shift planning concentrated; cross-domain (e.g. payroll  |
|               |                   | scoped specialisation for in-domain      | + safety) escalates to global MD context.                             |
| Worker        | workforce-mobile  | Safety / comms / shift specialisation    | Worker stays in-domain — no exposure to internal financials.          |
| Buyer         | buyer-mobile      | Marketplace / KYB specialisation         | Buyer sees only marketplace + KYB surfaces.                           |
| Regulator     | regulator-pack    | Compliance / safety specialisation       | Regulator sees compliance summaries + safety filings only.            |
| Public        | marketing         | Mr. Mwikila (public variant — Wave 14B)  | Already wired — marketing chat answers from public corpus only.       |

For BossNyumba the matrix is structurally identical with domain swap —
mining ops becomes property ops, site managers become estate managers,
workers become caretakers, buyers become tenants / leaseholders.

---

## 4. The 27 specialisations — MD-class upgrade list

Every row below is a specialisation of `Mr. Mwikila`. The user sees
`Mr. Mwikila` as the display name with the subtitle / specialisation
chip rendered underneath. Agent IDs are internal English-named handles.

| Agent ID                       | Specialisation                | Subtitle (user-facing)                            | Tier | Audience                |
|--------------------------------|-------------------------------|---------------------------------------------------|------|-------------------------|
| mining-shift-planner           | Shift Planning                | Borjie's AI Mining Shift Specialist               | T1   | manager, employee       |
| mining-safety-officer          | Mining Safety                 | Borjie's AI Mining Safety Specialist              | T2   | employee, manager       |
| geology-advisor                | Geology                       | Borjie's AI Geology Advisor                       | T1   | manager, owner          |
| fx-treasury-advisor            | FX & Treasury                 | Borjie's AI FX Treasury Specialist                | T2   | owner, admin            |
| buyer-kyb                      | Buyer KYB                     | Borjie's AI Buyer-KYB Specialist                  | T2   | customer, compliance    |
| marketplace                    | Marketplace                   | Borjie's AI Marketplace Specialist                | T1   | customer, manager       |
| cost-engineer                  | Cost Engineering              | Borjie's AI Cost Engineering Specialist           | T1   | owner, manager          |
| capacity-expansion             | Capacity Expansion            | Borjie's AI Capacity Expansion Advisor            | T1   | owner                   |
| workforce-orchestrator         | Workforce Operations          | Borjie's AI Workforce Specialist                  | T1   | manager, employee       |
| fleet-management               | Fleet Management              | Borjie's AI Fleet Specialist                      | T1   | manager, employee       |
| inventory-management           | Inventory                     | Borjie's AI Inventory Specialist                  | T1   | manager, employee       |
| procurement-coordination       | Procurement                   | Borjie's AI Procurement Specialist                | T1   | manager, finance        |
| mining-commodity-intelligence  | Commodity Intelligence        | Borjie's AI Commodity Intelligence Specialist     | T0   | owner, manager          |
| forecasting                    | Forecasting                   | Borjie's AI Forecasting Specialist                | T1   | owner, manager          |
| regulatory-tz-mining           | Tanzania Mining Regulatory    | Borjie's AI Regulatory Specialist                 | T2   | owner, compliance       |
| compliance-pack                | Compliance                    | Borjie's AI Compliance Specialist                 | T1   | compliance, regulator   |
| role-aware-router              | Role Routing                  | Borjie's AI Role Router                           | T0   | all                     |
| stage-advisor                  | Lifecycle Stage               | Borjie's AI Stage Advisor                         | T0   | owner, admin            |
| acquisition-advisor            | Mergers & Acquisitions        | Borjie's AI M&A Specialist                        | T2   | owner                   |
| content-studio                 | Content Creation              | Borjie's AI Content Specialist                    | T1   | manager, marketing      |
| document-studio                | Document Composition          | Borjie's AI Document Specialist                   | T1   | manager, owner          |
| marketing-brain                | Marketing Strategy            | Borjie's AI Marketing Specialist                  | T1   | manager                 |
| geo-intelligence               | Geographic Intelligence       | Borjie's AI Geo Specialist                        | T0   | manager                 |
| bias-handling                  | Bias & Fairness               | Borjie's AI Fairness Auditor                      | T0   | owner, admin            |
| ethics-framework               | Ethics                        | Borjie's AI Ethics Specialist                     | T0   | owner, admin            |
| proactive-intel                | Proactive Intelligence        | Borjie's AI Proactive Sentinel                    | T0   | owner, manager          |
| progressive-intelligence       | Skills & Mastery              | Borjie's AI Mastery Coach                         | T0   | owner, admin            |

Authority tier guidance:

- **T0** — observation + advice only; no mutations. The specialisation
  reads and reports. Reads can include the corpus + the org graph. Writes
  are zero.
- **T1** — observation + scoped propose. The specialisation may stage
  proposals within its `JuniorScope.data_tables` and
  `tab_recipes_owned`. Owner approval gate still applies.
- **T2** — scoped propose with the double-verify pair. The specialisation
  may stage proposals that touch counterparty graphs, regulatory filings,
  treasury, or safety. Owner + second authoriser both gate.

If `requires_md_for_tier_2` is true, the specialisation cannot stage T2 —
it hands off to the global Mr. Mwikila context which stages on the
specialisation's behalf with the specialisation named in the audit trail.

---

## 5. Junior runtime contract — request flow

```
User input via floating chat (any surface)
      |
      v
Audience-resolver  ->  agent_id (specialisation handle or 'mr-mwikila')
      |
      v
Specialisation system prompt loaded + JuniorScope applied to OrgUserDataContext
      |
      v
Cognitive Engine (Wave 18T) — same 6 disciplines:
   reason | ground | calibrate | scope | clarify | ingest
      |
      v
compose_anything_v1 — meta-dispatch within JuniorScope only
   research_v1 (restricted to research_topics)
   compose_tab_v1 (restricted to tab_recipes_owned)
   compose_doc_v1 (restricted to doc_recipes_owned)
   compose_media_v1 (restricted to media_recipes_owned)
   compose_campaign_v1 (only if the specialisation owns a campaign recipe)
      |
      v
Mutation Authority (Wave 18S) — tier check via JuniorScope.authority_tier_max
      |
      +-- if tier exceeded  ->  escalate to global Mr. Mwikila with hand-off transcript
      |
      v
Output produced + audit-chained to agent_id + global-MD visibility row in agent_turns
```

The flow is identical to the MD's flow except for the scope filter that
gates which capabilities and which data joins the specialisation can
reach. The specialisation never bypasses the cognitive engine — every
turn is reasoned, grounded, calibrated, scoped, clarified-when-needed,
and ingest-aware.

---

## 6. Global Mr. Mwikila visibility

Every specialisation turn writes a row to `agent_turns`. The global
Mr. Mwikila working memory has a subscription to `agent_turns where
agent_id != 'mr-mwikila'`. Treats those rows as oversight signal —
sampling them in the Daily Briefing, surfacing anomalies (e.g. a
specialisation with sustained low-confidence turns, or a specialisation
repeatedly escalating cross-domain), and proactively offering to retrain
the specialisation's prompt or extend its scope.

The MD can also **intervene mid-turn** — if a specialisation is composing
a Tier 2 mutation proposal that conflicts with another in-flight proposal
the global Mr. Mwikila knows about, the MD inserts a "wait — there is
context you do not have" frame and offers to take over the turn. The
handoff is logged.

---

## 7. Escalation patterns

The specialisation escalates to the global Mr. Mwikila context in five
clearly-defined situations:

1. **Cross-domain intent.** The user asks something that spans the
   specialisation's scope plus another specialisation's scope (e.g.
   shift question + FX exposure). The specialisation recognises the
   cross-cut, summarises what it would have said, and hands off the
   transcript.
2. **Low confidence.** The cognitive engine returns confidence < 0.4
   (or the per-specialisation threshold). The specialisation declines
   to answer and summarises why; the global MD takes the turn.
3. **Tier exceeded.** The user is asking for a mutation above the
   specialisation's `authority_tier_max`. The specialisation drafts the
   proposal for the record, but the global MD stages it.
4. **Owner names a specialisation + asks cross-domain.** Owner says
   "ask the Mining Shift specialisation about FX exposure" — the Mining
   Shift specialisation cannot answer (FX is not in its scope) and
   politely says so, then hands off with the owner's intent preserved.
5. **Safety / compliance critical event.** Any specialisation that
   detects a critical safety incident, regulatory violation, or ethics
   breach escalates immediately — regardless of which specialisation
   the user was talking to. The global Mr. Mwikila takes the turn
   within one second.

---

## 8. The 4 capability scopings per specialisation

Every specialisation owns a slice of each of the four atomic creation
capabilities. Examples:

**Tab recipes owned.** `mining-safety-officer` owns `incident_report`,
`safety_walkthrough`, `near_miss_capture`. The specialisation can
`compose_tab_v1` on any of these recipes; trying to compose
`buyer_kyb_start` (owned by `buyer-kyb`) yields a scope-violation error
and an escalation suggestion.

**Doc recipes owned.** `mining-safety-officer` owns `monthly_osha_filing`,
`incident_postmortem`, `safety_training_certificate`. Same scope check.

**Media recipes owned.** `mining-safety-officer` owns
`hazard_illustration_image`, `safety_training_video`. The marketing
specialisation does NOT own these — keeps the brand voice consistent
without letting the safety voice get hijacked.

**Research topics.** `mining-safety-officer` is an expert in OSHA, ILO
OHS conventions, Tanzania OHS Act, MSHA precedents, and Borjie's own
historical incident corpus. Out-of-topic research (e.g. commodity prices)
gets refused with an escalation hint.

---

## 9. Persona identity — singular Mr. Mwikila

The user always sees `Mr. Mwikila` as the persona name. The subtitle
reflects the active specialisation. Agent IDs are internal and
English-named. There are no per-specialisation character names anywhere
in the product. The chip + subtitle pattern is the only way the user
distinguishes one specialisation from another:

```
Mr. Mwikila                        <- singular display name
Borjie's AI Mining Safety Specialist   <- title (subtitle)
[Mining Safety]                    <- specialisation chip
```

When the user switches contexts (e.g. asks a treasury question in the
middle of a shift-planning chat), the chip + subtitle change but the
name stays `Mr. Mwikila`. The brand stays singular; the intelligence
specialises.

> **Founder correction (post 18V-FIX) — the subtitle / chip pattern
> above is OBSOLETE for the user-facing chat surface.** See §9.1
> below; the chip + specialisation subtitle now live ONLY in the
> owner admin panel.

---

## 9.1. User-facing identity is locked

The user always sees ONE string in every chat / floating-widget / home-shell surface: **"Mr. Mwikila — Borjie's AI Mining Operations Manager"** (or the Boss Nyumba equivalent). No specialisation subtitle. No agent_id. Mr. Mwikila is presented as ONE intelligence — the user never knows whether a turn was handled by the root MD or a scoped specialisation.

The specialisation / agent_id / subtitle remain in the data model for:
- Backend routing (which specialisation logic the LLM draws from)
- Audit logs (`agent_turns` / `cognitive_turns` capture the agent_id)
- Owner admin panel (ONLY surface where internal names appear)

Reference: `packages/agent-platform/src/canonical-display.ts` defines the single source of truth (`MR_MWIKILA_CANONICAL_DISPLAY`).

---

## 10. Anti-patterns

- **Output outside scope.** A specialisation produces a document or tab
  not in its `recipes_owned`. Caught by the persona-runtime scope filter;
  turn is rejected and the specialisation must escalate.
- **Bypassing the cognitive engine.** A specialisation returns a raw
  model completion without routing through the 6 disciplines. Caught by
  the agent-runtime which refuses to commit any output that lacks the
  `cognitive_turn_id` linkage.
- **Writes outside `data_tables`.** A specialisation issues a mutation
  proposal for a table not in `JuniorScope.data_tables`. Caught at the
  mutation authority gate — the proposal is rejected, audit-logged, and
  the specialisation is suspended from staging until investigated.
- **Specialisation shown to an unauthorised audience.** A customer
  summons a specialisation whose `target_audiences` excludes 'customer'.
  The audience-resolver returns 'mr-mwikila-public' as the fallback and
  the unauthorised specialisation is never even loaded.
- **Global Mr. Mwikila silently swaps specialisations.** Owner asks
  "what is happening on safety?" and the global MD silently swaps to the
  safety specialisation without disclosure. Owner has the right to know
  which specialisation is responding — the MD MUST say "switching to
  Mining Safety specialisation for this" before swapping, and every
  artefact must be tagged with the specialisation id in the audit trail.
- **Inventing a per-specialisation character name.** Strictly forbidden.
  Every turn renders as `Mr. Mwikila`.

---

## 11. Implementation plan — the 26 remaining specialisations

Each specialisation upgrade is 4-8 hours of engineering:

1. Write `<specialisation>-persona.ts` mirroring the
   `mining-shift-planner-persona.ts` reference shape — `JuniorPersona`
   value with mandate, modes, scope, target_audiences,
   mr_mwikila_escalation. `specialisation` + `title` only — no `name`.
2. Define `JuniorScope`: enumerate `data_tables`, `tab_recipes_owned`,
   `doc_recipes_owned`, `media_recipes_owned`, `research_topics`,
   `authority_tier_max`.
3. Write 3-5 modes (plan / report / escalate / brief is the floor; some
   specialisations need extra modes — e.g. safety needs `file-incident`).
4. Register the recipes the specialisation owns. Seed at least one tab
   recipe and one doc recipe so the specialisation has something to
   compose from day one.
5. Tests: persona shape, scope filter, escalation triggers, mode router.
   Assertions on `specialisation` + `title` — never assert a character
   name.

Sequencing (after the reference specialisation `mine-planner-advisor`):

- **Wave 18V-B (next batch — 5 specialisations).** Top-of-mind for the
  busiest audiences: `mining-safety-officer`, `geology-advisor`,
  `fx-treasury-advisor`, `marketplace`, `buyer-kyb`.
- **Wave 18V-C (next 10).** `cost-engineer`,
  `capacity-expansion`, `workforce-orchestrator`,
  `fleet-management`, `inventory-management`,
  `procurement-coordination`, `mining-commodity-intelligence`,
  `forecasting`, `regulatory-tz-mining`, `compliance-pack`.
- **Wave 18V-D (final 12).** `role-aware-router`, `stage-advisor`,
  `acquisition-advisor`, `content-studio`, `document-studio`,
  `marketing-brain`, `geo-intelligence`, `bias-handling`,
  `ethics-framework`, `proactive-intel`, `progressive-intelligence`.

App work (floating chat surfaces, specialisation pickers, mobile routing)
is Wave 18W and is intentionally out of scope here.

---

## 12. Schema additions

```sql
CREATE TABLE junior_personas (
  id text PRIMARY KEY,                          -- 'mining-shift-planner'
  display_name text NOT NULL,                   -- DEPRECATED — always 'Mr. Mwikila' (see CAPABILITIES_UNIFICATION)
  specialisation text NOT NULL DEFAULT '',      -- 'Mining Safety', 'Geology', ...
  title text NOT NULL,                          -- "Borjie's AI Mining Shift Specialist"
  mandate text NOT NULL,
  default_language text NOT NULL DEFAULT 'en',
  target_audiences text[] NOT NULL,
  scope jsonb NOT NULL,                         -- JuniorScope shape
  escalation_policy jsonb NOT NULL,
  brand text NOT NULL DEFAULT 'borjie',
  version int NOT NULL DEFAULT 1,
  registered_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  user_id text NOT NULL,
  session_id uuid NOT NULL,
  agent_id text NOT NULL,                       -- 'mr-mwikila' OR specialisation id
  audience text NOT NULL,                       -- owner|admin|manager|employee|customer
  was_escalation_to_md boolean NOT NULL DEFAULT false,
  cognitive_turn_id uuid REFERENCES cognitive_turns(id),  -- Wave 18T
  artifact_ref jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_turns_session ON agent_turns (session_id, occurred_at DESC);
CREATE INDEX idx_agent_turns_md_visibility ON agent_turns (tenant_id, agent_id, occurred_at DESC);
```

`junior_personas` is global (tenant-agnostic) — every tenant gets the
same specialisation catalogue. `agent_turns` is tenant-scoped and
RLS-bound.

The `display_name` column is retained for backward compatibility but is
considered deprecated — every junior renders as `Mr. Mwikila`. Surface
code should read the `MR_MWIKILA_DISPLAY_NAME` constant from
`@borjie/agent-platform` instead of the column.

---

## 13. Reference specialisation — `mine-planner-advisor` (Mining Shift)

Wave 18V ships the reference upgrade of `mine-planner-advisor`:

- **Persona.** Display name `Mr. Mwikila`; `specialisation` =
  `"Shift Planning"`; `title` = `"Borjie's AI Mining Shift Specialist"`;
  default Swahili, mandate ~140 words, four modes (`plan`, `report`,
  `escalate`, `brief`).
- **Scope.** `data_tables`: sites, site_polygons, assets_fleet,
  workforce_members, shift_plans, plan_recommendations.
  `tab_recipes_owned`: `shift_plan_review`, `crew_assignment`.
  `doc_recipes_owned`: `weekly_production_brief`. `research_topics`:
  mine-planning, blast-design, haul-cycle optimisation, Tanzania mining
  shift law, fleet-utilisation benchmarks. `authority_tier_max`: 1.
- **Target audiences.** `manager`, `employee` (worker can summon for
  shift questions; site manager has the full surface).
- **Escalation.** Auto-escalate above T1; auto-escalate on cross-domain;
  auto-escalate on confidence < 0.4. Hand off transcript to the global
  Mr. Mwikila context.
- **Recipes.** Two seed tab recipes + one seed doc recipe under
  `packages/mine-planner-advisor/src/recipes/`.

This is the template every other specialisation upgrade follows.

---

## 14. Cross-repo

BossNyumba mirrors this spec at `Docs/DESIGN/JUNIOR_ARCHITECTURE_SPEC.md`
with brand + domain rename. Property-domain specialisations
(`tenant-onboarding-advisor`, `lease-renewal-advisor`,
`maintenance-coordinator`, `billing-collections`, `property-inspection`,
`property-listings`, `viewings-coordinator`, plus the property-domain
workforce / fleet / inventory specialisations) get the same contract
with property-domain `data_tables`, `tab_recipes_owned`, etc. Subtitles
follow the same shape — `Boss Nyumba's AI Tenant-Onboarding Specialist`,
`Boss Nyumba's AI Lease-Renewal Specialist`, etc. The MD persona name
(`Mr. Mwikila`) is preserved across both brands; both repos share the
singular display identity discipline from Section 0.
