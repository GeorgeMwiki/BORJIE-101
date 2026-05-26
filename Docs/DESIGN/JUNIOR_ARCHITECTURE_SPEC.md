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
`0024_junior_architecture.sql` (`junior_personas` + `agent_turns`).
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
`JuniorPersona` contract: a named persona, 3-5 operating modes, the same
6-discipline cognitive loop the MD uses, the `compose_anything_v1`
meta-tool with their scoped recipe catalogue, a Tier-0/1/2 mutation
ceiling, and a structured escalation policy that hands off to Mr. Mwikila
when the user's intent leaves the junior's envelope.

The MD remains the apex — owner + admin route to Mr. Mwikila on every
surface, every device. Juniors serve managers, employees, customers, and
regulators. Every junior turn writes to a unified `agent_turns` table the
MD's working memory subscribes to, so Mr. Mwikila sees everything the
juniors do and can intervene if a junior goes off the rails.

---

## 2. The Junior contract

Every junior package exports a frozen `JuniorPersona` value. The contract
is enforced at the persona-runtime boundary — a junior that fails to
declare a scope, an escalation policy, or a target-audience list cannot
be registered.

```typescript
export interface JuniorPersona {
  readonly id: string;                          // 'mining-shift-planner', 'mining-safety-officer'
  readonly name: string;                        // 'Ms. Sifa — Shift Planner'  (juniors have names too)
  readonly title: string;                       // "Borjie's AI Shift-Planning Specialist"
  readonly mandate: string;                     // first-person mandate, <=150 words
  readonly default_language: 'sw' | 'en' | 'fr';
  readonly modes: ReadonlyArray<JuniorMode>;    // typically 3-5 modes per junior
  readonly scope: JuniorScope;                  // what data/UI/research this junior can read+write
  readonly target_audiences: ReadonlyArray<Audience>; // who can summon this junior
  readonly tools_allowed: ReadonlyArray<string>; // including compose_anything_v1 — every junior gets meta-dispatch
  readonly mr_mwikila_escalation: EscalationPolicy; // when to escalate to the MD
}

export interface JuniorScope {
  readonly data_tables: ReadonlyArray<string>;            // tables the junior can read+write
  readonly tab_recipes_owned: ReadonlyArray<string>;      // tab recipes the junior can compose/evolve
  readonly doc_recipes_owned: ReadonlyArray<string>;      // doc recipes the junior owns
  readonly media_recipes_owned: ReadonlyArray<string>;    // media recipes the junior owns
  readonly research_topics: ReadonlyArray<string>;        // research domains the junior is expert in
  readonly authority_tier_max: 0 | 1 | 2;                 // ceiling for mutations the junior can propose
  readonly requires_md_for_tier_2: boolean;               // if true, junior must escalate Tier 2 to Mr. Mwikila
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
  readonly hand_off_transcript_to_mr_mwikila: boolean;   // junior summarises + passes context to MD
}
```

`JuniorMode` mirrors `MiningCeoMode` (id, name, mandate, sample_prompts,
tools_allowed, system_prompt). The kernel composition root reuses the
same mode-router it uses for Mr. Mwikila.

---

## 3. Audience-routing matrix — Borjie

| User role     | Surface           | Floating chat resolves to               | Reasoning                                                            |
|---------------|-------------------|------------------------------------------|-----------------------------------------------------------------------|
| Owner         | owner-web         | Mr. Mwikila (MD) ALWAYS                  | Owner is the apex decision-maker — every domain visible at once.      |
| Admin         | admin-web         | Mr. Mwikila (MD) ALWAYS                  | Platform-level visibility across tenants.                             |
| Site Manager  | workforce-mobile  | Mr. Mwikila for cross-domain;            | Mining ops + shift planning concentrated; cross-domain (e.g. payroll  |
|               |                   | scoped junior for in-domain              | + safety) escalates to MD.                                            |
| Worker        | workforce-mobile  | Safety / comms / shift junior            | Worker stays in-domain — no exposure to internal financials.          |
| Buyer         | buyer-mobile      | Marketplace / KYB junior                 | Buyer sees only marketplace + KYB surfaces.                           |
| Regulator     | regulator-pack    | Compliance / safety junior               | Regulator sees compliance summaries + safety filings only.            |
| Public        | marketing         | Mr. Mwikila (public variant — Wave 14B)  | Already wired — marketing chat answers from public corpus only.       |

For BossNyumba the matrix is structurally identical with domain swap —
mining ops becomes property ops, site managers become estate managers,
workers become caretakers, buyers become tenants / leaseholders.

---

## 4. The 27 Juniors — MD-class upgrade list

| #  | Junior package                  | Domain                                | Audiences                | Tier | Modes (suggested)                                    | Junior name      |
|----|---------------------------------|----------------------------------------|---------------------------|------|------------------------------------------------------|-------------------|
| 1  | mine-planner-advisor            | Production / shift planning           | site_mgr, worker          | T1   | plan / report / escalate / brief                     | Ms. Sifa          |
| 2  | geology-advisor                 | Ore body modelling                    | site_mgr, owner-readonly  | T1   | interpret / report / advise                          | Dr. Mbeya         |
| 3  | fx-treasury-advisor             | FX exposure + cash runway             | owner, admin              | T2   | analyse / hedge-propose / brief                      | Ms. Hesabu        |
| 4  | cost-engineer-advisor           | Unit economics + break-even           | owner, site_mgr           | T1   | decompose / what-if / report                         | Mr. Bei           |
| 5  | capacity-expansion-advisor      | NPV / IRR scenario modelling           | owner                     | T1   | scenario / rank / brief                              | Mr. Panua         |
| 6  | role-aware-advisor              | Role-shaped front door                | all                       | T0   | route / nudge / propose                              | Mr. Sajili        |
| 7  | stage-advisor                   | Org maturity detection                | owner, admin              | T0   | detect / propose / nudge                             | Ms. Hatua         |
| 8  | acquisition-advisor             | M&A and licence acquisition           | owner                     | T2   | screen / value / brief                               | Mr. Mnunuzi       |
| 9  | content-studio (junior aspect)  | Brand collateral generation           | manager, customer-facing  | T1   | compose / improve / publish-propose                  | Ms. Sanaa         |
| 10 | document-studio (junior aspect) | Doc generation per recipe             | manager, owner            | T1   | draft / cite-check / approve-propose                 | Mr. Hati          |
| 11 | marketing-brain                 | Campaign composition                  | manager (marketing)       | T1   | plan / launch-propose / measure                      | Ms. Tangaza       |
| 12 | mining-commodity-intelligence   | Commodity price + market intel        | owner, site_mgr           | T0   | watch / brief / alert                                | Mr. Soko          |
| 13 | geo-intelligence                | Geo / parcel / spatial intelligence    | site_mgr                  | T0   | map / overlay / brief                                | Mr. Ramani        |
| 14 | fleet-management                | Asset & fleet ops                     | site_mgr, worker          | T1   | dispatch-plan / maintain / brief                     | Mr. Gari          |
| 15 | inventory-management            | Stockpile + warehouse                 | site_mgr, worker          | T1   | count / reconcile / brief                            | Mr. Ghala         |
| 16 | procurement-coordination        | Vendor + PO orchestration             | manager, finance          | T1   | source / negotiate-propose / track                   | Ms. Manunuzi      |
| 17 | workforce-orchestrator          | Roster + assignment + comms           | site_mgr, worker          | T1   | roster / dispatch / hand-off                         | Ms. Kazi          |
| 18 | safety (workforce-safety)       | OSHA / OHS / incident management      | worker, site_mgr          | T2   | observe / alert / file-propose                       | Mr. Kombo         |
| 19 | buyer-kyb (marketplace)         | KYB onboarding + sanctions screening  | buyer, compliance         | T2   | onboard / verify / decline-propose                   | Mr. Mlinzi        |
| 20 | marketplace (sales-advice)      | Listings + offers + ore matching      | buyer, manager            | T1   | match / negotiate / publish                          | Ms. Biashara      |
| 21 | regulatory-tz-mining            | Tanzania mining regulator filings     | owner, compliance         | T2   | file-prepare / cite-check / submit-propose           | Mr. Sheria        |
| 22 | compliance-pack                 | Compliance pack delivery              | compliance, regulator     | T1   | assemble / verify / brief                            | Ms. Idhini        |
| 23 | bias-handling                   | Fairness + bias monitoring            | owner-readonly, admin     | T0   | monitor / report / propose-mitigation                | Dr. Haki          |
| 24 | ethics-framework                | Ethics policy guidance                | owner, admin              | T0   | advise / brief / propose                             | Mr. Adili         |
| 25 | forecasting                     | Demand + production forecasting       | owner, site_mgr           | T1   | forecast / report / brief                            | Ms. Tabiri        |
| 26 | proactive-intel                 | Proactive ops intelligence            | owner, site_mgr           | T0   | watch / surface / brief                              | Mr. Macho         |
| 27 | progressive-intelligence        | Adaptive capability surfacing         | owner, admin              | T0   | detect / propose / nudge                             | Ms. Ongezeko      |

Authority tier guidance:

- **T0** — observation + advice only; no mutations. The junior reads and
  reports. Reads can include the corpus + the org graph. Writes are
  zero.
- **T1** — observation + scoped propose. The junior may stage proposals
  within its `JuniorScope.data_tables` and `tab_recipes_owned`. Owner
  approval gate still applies.
- **T2** — scoped propose with the double-verify pair. The junior may
  stage proposals that touch counterparty graphs, regulatory filings,
  treasury, or safety. Owner + second authoriser both gate.

If `requires_md_for_tier_2` is true, the junior cannot stage T2 — it
hands off to Mr. Mwikila who stages on the junior's behalf with the
junior named in the audit trail.

---

## 5. Junior runtime contract — request flow

```
User input via floating chat (any surface)
      |
      v
Audience-resolver  ->  junior_id (or 'mr-mwikila')
      |
      v
Junior persona system prompt loaded + JuniorScope applied to OrgUserDataContext
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
   compose_campaign_v1 (only if junior owns a campaign recipe)
      |
      v
Mutation Authority (Wave 18S) — tier check via JuniorScope.authority_tier_max
      |
      +-- if tier exceeded  ->  escalate to Mr. Mwikila with hand-off transcript
      |
      v
Output produced + audit-chained to junior_id + Mr. Mwikila visibility row in agent_turns
```

The flow is identical to the MD's flow except for the scope filter that
gates which capabilities and which data joins the junior can reach. The
junior never bypasses the cognitive engine — every junior turn is
reasoned, grounded, calibrated, scoped, clarified-when-needed, and
ingest-aware.

---

## 6. Mr. Mwikila visibility

Every junior turn writes a row to `agent_turns`. Mr. Mwikila's working
memory has a subscription to `agent_turns where agent_id != 'mr-mwikila'`.
The MD treats those rows as oversight signal — sampling them in the
Daily Briefing, surfacing anomalies (e.g. a junior with sustained
low-confidence turns, or a junior repeatedly escalating cross-domain),
and proactively offering to retrain the junior's persona or extend its
scope.

The MD can also **intervene mid-turn** — if a junior is composing a Tier
2 mutation proposal that conflicts with another in-flight proposal Mr.
Mwikila knows about, the MD inserts a "wait — there is context you do
not have" frame and offers to take over the turn. The handoff is
logged.

---

## 7. Escalation patterns

The junior escalates to Mr. Mwikila in five clearly-defined situations:

1. **Cross-domain intent.** The user asks something that spans the
   junior's scope plus another junior's scope (e.g. shift question + FX
   exposure). The junior recognises the cross-cut, summarises what it
   would have said, and hands off the transcript to the MD who
   orchestrates the multi-junior response.
2. **Low confidence.** The cognitive engine returns confidence < 0.4 (or
   the per-junior threshold). The junior declines to answer and
   summarises why; the MD takes the turn.
3. **Tier exceeded.** The user is asking for a mutation above the
   junior's `authority_tier_max`. Junior drafts the proposal for the
   record, but the MD stages it.
4. **Owner names a junior + asks cross-domain.** Owner says "ask
   Ms. Sifa about FX exposure" — Ms. Sifa cannot answer (FX is not in
   her scope) and politely says so, then hands off to Mr. Mwikila with
   the owner's intent preserved.
5. **Safety / compliance critical event.** Any junior that detects a
   critical safety incident, regulatory violation, or ethics breach
   escalates immediately — regardless of which junior the user was
   talking to. Mr. Mwikila takes the turn within one second.

---

## 8. The 4 capability scopings per junior

Every junior owns a slice of each of the four atomic creation
capabilities. Examples:

**Tab recipes owned.** `mining-safety-officer` owns `incident_report`,
`safety_walkthrough`, `near_miss_capture`. The junior can `compose_tab_v1`
on any of these recipes; trying to compose `buyer_kyb_start` (owned by
`buyer-kyb`) yields a scope-violation error and an escalation suggestion.

**Doc recipes owned.** `mining-safety-officer` owns `monthly_osha_filing`,
`incident_postmortem`, `safety_training_certificate`. Same scope check.

**Media recipes owned.** `mining-safety-officer` owns
`hazard_illustration_image`, `safety_training_video`. The marketing junior
does NOT own these — keeps the brand voice consistent without letting the
safety voice get hijacked.

**Research topics.** `mining-safety-officer` is an expert in OSHA, ILO
OHS conventions, Tanzania OHS Act, MSHA precedents, and Borjie's own
historical incident corpus. Out-of-topic research (e.g. commodity prices)
gets refused with an escalation hint.

---

## 9. Junior personas have names

To make juniors feel like real co-workers — not chatbots — each gets a
name drawn from Swahili name traditions reflecting the domain. The
full name is `<first name> — Borjie's AI <Domain> Specialist`.

Sample assignments (full list in §4):

- mining-shift-planner -> **Ms. Sifa** (sifa = "merit / qualification")
- mining-safety-officer -> **Mr. Kombo** (kombo = "alertness")
- mining-geology -> **Dr. Mbeya** (Mbeya = region rich in mineral geology)
- fx-treasury -> **Ms. Hesabu** (hesabu = "accounts")
- marketplace -> **Ms. Biashara** (biashara = "trade")
- buyer-kyb -> **Mr. Mlinzi** (mlinzi = "guardian")
- commodity-intelligence -> **Mr. Soko** (soko = "market")
- cost-engineer -> **Mr. Bei** (bei = "price")
- capacity-expansion -> **Mr. Panua** (panua = "expand")
- compliance -> **Ms. Idhini** (idhini = "permit / licence")
- regulatory-tz-mining -> **Mr. Sheria** (sheria = "law")
- workforce-orchestrator -> **Ms. Kazi** (kazi = "work")
- fleet-management -> **Mr. Gari** (gari = "vehicle")
- inventory -> **Mr. Ghala** (ghala = "warehouse")
- procurement -> **Ms. Manunuzi** (manunuzi = "purchases")
- forecasting -> **Ms. Tabiri** (tabiri = "predict")
- proactive-intel -> **Mr. Macho** (macho = "eyes / watch")
- progressive-intel -> **Ms. Ongezeko** (ongezeko = "growth")
- bias-handling -> **Dr. Haki** (haki = "justice / fairness")
- ethics -> **Mr. Adili** (adili = "ethics")
- acquisition -> **Mr. Mnunuzi** (mnunuzi = "acquirer")
- role-aware -> **Mr. Sajili** (sajili = "register")
- stage-advisor -> **Ms. Hatua** (hatua = "stage / step")

Naming convention for BossNyumba is the same — Swahili first names
appropriate to the property domain (e.g. property-inspection -> **Mr.
Tafiti**, tenant-onboarding -> **Ms. Karibu**, lease-renewal -> **Mr.
Mkataba**).

---

## 10. Anti-patterns

- **Output outside scope.** A junior produces a document or tab not in
  its `recipes_owned`. Caught by the persona-runtime scope filter; turn
  is rejected and the junior must escalate.
- **Bypassing the cognitive engine.** A junior returns a raw model
  completion without routing through the 6 disciplines. Caught by the
  agent-runtime which refuses to commit any output that lacks the
  `cognitive_turn_id` linkage.
- **Writes outside `data_tables`.** A junior issues a mutation proposal
  for a table not in `JuniorScope.data_tables`. Caught at the mutation
  authority gate — the proposal is rejected, audit-logged, and the
  junior is suspended from staging until investigated.
- **Junior shown to an unauthorised audience.** A customer summons a
  junior whose `target_audiences` excludes 'customer'. The
  audience-resolver returns 'mr-mwikila-public' as the fallback and the
  unauthorised junior is never even loaded.
- **Owner asks Mr. Mwikila but he silently delegates.** Owner asks "what
  is happening on safety?" and the MD silently swaps to the safety
  junior without disclosure. Owner has the right to know who is
  responding — the MD MUST say "I'll bring Mr. Kombo (safety) in for
  this" before delegating, and Mr. Kombo MUST sign every artefact he
  produces.

---

## 11. Implementation plan — the 26 remaining juniors

Each junior upgrade is 4-8 hours of engineering:

1. Write `<junior>-persona.ts` mirroring the `mining-shift-planner-persona.ts`
   reference shape — `JuniorPersona` value with mandate, modes, scope,
   target_audiences, mr_mwikila_escalation.
2. Define `JuniorScope`: enumerate `data_tables`, `tab_recipes_owned`,
   `doc_recipes_owned`, `media_recipes_owned`, `research_topics`,
   `authority_tier_max`.
3. Write 3-5 modes (plan / report / escalate / brief is the floor; some
   juniors need extra modes — e.g. safety needs `file-incident`).
4. Register the recipes the junior owns. Seed at least one tab recipe
   and one doc recipe so the junior has something to compose from day
   one.
5. Tests: persona shape, scope filter, escalation triggers, mode router.

Sequencing (after the reference junior `mine-planner-advisor`):

- **Wave 18V-B (next batch — 5 juniors).** Top-of-mind for the busiest
  audiences: `mining-safety-officer`, `geology-advisor`,
  `fx-treasury-advisor`, `marketplace`, `buyer-kyb`.
- **Wave 18V-C (next 10).** `cost-engineer-advisor`,
  `capacity-expansion-advisor`, `workforce-orchestrator`,
  `fleet-management`, `inventory-management`,
  `procurement-coordination`, `mining-commodity-intelligence`,
  `forecasting`, `regulatory-tz-mining`, `compliance-pack`.
- **Wave 18V-D (final 12).** `role-aware-advisor`, `stage-advisor`,
  `acquisition-advisor`, `content-studio`, `document-studio`,
  `marketing-brain`, `geo-intelligence`, `bias-handling`,
  `ethics-framework`, `proactive-intel`, `progressive-intelligence`,
  `audio-logics-litfin`.

App work (floating chat surfaces, junior pickers, mobile routing) is
Wave 18W and is intentionally out of scope here.

---

## 12. Schema additions

```sql
CREATE TABLE junior_personas (
  id text PRIMARY KEY,                          -- 'mining-shift-planner'
  display_name text NOT NULL,                   -- 'Ms. Sifa'
  title text NOT NULL,                          -- "Borjie's AI Shift-Planning Specialist"
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
  agent_id text NOT NULL,                       -- 'mr-mwikila' OR junior_id
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
same junior catalogue. `agent_turns` is tenant-scoped and RLS-bound.

---

## 13. Reference junior — `mine-planner-advisor` (Ms. Sifa)

Wave 18V ships the reference upgrade of `mine-planner-advisor`:

- **Persona.** Ms. Sifa, default Swahili, mandate ~140 words, four modes
  (`plan`, `report`, `escalate`, `brief`).
- **Scope.** `data_tables`: sites, ore_polygons, fleet, crew_members,
  shift_plans, plan_recommendations. `tab_recipes_owned`:
  `shift_plan_review`, `crew_assignment`. `doc_recipes_owned`:
  `weekly_production_brief`. `research_topics`: mine-planning,
  blast-design, haul-cycle optimisation, Tanzania mining shift law.
  `authority_tier_max`: 1.
- **Target audiences.** `manager`, `employee` (worker can summon for
  shift questions; site manager has the full surface).
- **Escalation.** Auto-escalate above T1; auto-escalate on cross-domain;
  auto-escalate on confidence < 0.4. Hand off transcript.
- **Recipes.** Two seed tab recipes + one seed doc recipe under
  `packages/mine-planner-advisor/recipes/`.

This is the template every other junior upgrade follows.

---

## 14. Cross-repo

BossNyumba mirrors this spec at `Docs/DESIGN/JUNIOR_ARCHITECTURE_SPEC.md`
with brand + domain rename. Property juniors (`acquisition-advisor`,
`estate-department-advisor`, `expansion-advisor`, `green-angle-advisor`,
`lifecycle-advisor`, `role-aware-advisor`, `stage-advisor`,
`sustainability-advisor`, `market-intelligence`, plus the
property-domain workforce / fleet / inventory juniors) get the same
contract with property-domain `data_tables`, `tab_recipes_owned`, etc.
The MD persona name (Mr. Mwikila) is preserved across both brands.
