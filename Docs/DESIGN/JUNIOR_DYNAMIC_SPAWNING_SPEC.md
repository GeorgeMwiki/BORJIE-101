# Junior Dynamic Spawning Spec — Addendum to Wave 18V

> **Status:** Spec — addendum to `JUNIOR_ARCHITECTURE_SPEC.md` (Wave 18V).
> **Wave:** 18V-DYNAMIC (parallel to 18V-FIX which unifies Mr. Mwikila's persona surface).
> **Cross-links:** `JUNIOR_ARCHITECTURE_SPEC.md` (18V), `CAPABILITIES_UNIFICATION.md` (18Q), `MUTATION_AUTHORITY_SPEC.md` (18S), `COGNITIVE_ENGINE_SPEC.md` (18T), `ANTICIPATORY_UX_SPEC.md` (lock/improve template).

## 1. Vision — the founder correction

> **Founder, verbatim:** *"Aren't the juniors supposed to be created and spawned depending on need or is this better? Basically all just talk to one persona the MD, in the background knows which it has deployed for its purposes."*

The founder is right. Wave 18V's static catalogue of 27 pre-registered juniors is a useful *seed*, not a ceiling. The MD ("Mr. Mwikila") should **dynamically author new specialisations** whenever an intent does not match a seed junior — and that authoring should travel through the same `draft → shadow → live → locked` lifecycle that anticipatory UX recipes (Wave 17B / 18F), doc recipes (17D / 18G), media recipes (18N), and campaigns (18P) already use.

The user-facing invariant is unchanged: every owner / admin surface shows **"Mr. Mwikila" + a subtitle**. The subtitle is the only visible cue that the MD has handed the turn to a specialist ("Borjie's AI Drone Imagery Specialist", "Borjie's AI Tailings Stability Advisor"). Whether that specialist is a seed junior, a previously-spawned junior, or a freshly-authored draft is invisible to the human — but fully visible to the owner via the admin portal and to the audit-chain.

The unified Mr. Mwikila persona surface (Wave 18V-FIX) handles the **front of the curtain** (one display name, one voice, one branding pass). This addendum handles the **back of the curtain** — how the MD decides which specialist to deploy, when to mint a new one, and how new juniors mature into the catalogue.

## 2. The three provenance classes

Every row in `junior_personas` now carries a `provenance` discriminator with exactly three legal values:

1. **`seed`** — pre-registered in code (the 27 juniors enumerated in 18V). Stable, version-controlled, global to every tenant. Never mutated by the runtime; only edited by humans through PRs. `lifecycle_status` is always `live`. No lock/improve cycle.

2. **`spawned`** — LLM-authored at runtime when the cognitive engine determines an intent cannot be satisfactorily served by any existing junior. Tenant-scoped (per-tenant catalogue). Starts in `draft`, matures via the lifecycle state machine.

3. **`tenant_authored`** — explicitly created by an owner or admin via the admin portal (a Tier 2 mutation, staged through the mutation-authority pipeline). Tenant-scoped. Starts in `shadow` (skipping `draft` because a human authored it directly) and matures.

The discriminator is *the* gate for downstream behaviour: a seed junior never appears on the lock/improve queue; a `draft` spawned junior cannot stage Tier 2 mutations; a `tenant_authored` junior never crosses tenant boundaries.

## 3. The Junior Lifecycle State Machine

```
                  ┌─────────────┐
                  │   draft     │  ← LLM proposes a new junior
                  └──────┬──────┘
                         │ (first use)
                         ▼
                  ┌─────────────┐
                  │   shadow    │  ← in pilot, accepting traffic
                  └──────┬──────┘
                         │ (≥10 uses + ≥0.7 user-satisfaction)
                         ▼
                  ┌─────────────┐
                  │    live     │  ← available to all sessions
                  └──────┬──────┘
                         │ (≥50 uses + ≥0.85 satisfaction sustained 30d)
                         ▼
                  ┌─────────────┐
                  │   locked    │  ← stable, no further mutation
                  └──────┬──────┘
                         │ (manual or schema drift)
                         ▼
                  ┌─────────────┐
                  │ deprecated  │
                  └─────────────┘
```

The state machine is intentionally identical in shape to anticipatory-UX recipe locking — every operator (and the worker code) already knows this mental model.

| State | Who can use it | Authority ceiling | Mutability |
|--|--|--|--|
| `draft` | Author session only | Tier 0 (read-only) | LLM may rewrite |
| `shadow` | Any session in the same tenant | Tier 1 | LLM may suggest revision |
| `live` | Any session in the same tenant | Up to its `authority_tier_max` | Only via approved revision |
| `locked` | Any session in the same tenant | Up to its `authority_tier_max` | Frozen |
| `deprecated` | Read-only audit access | Tier 0 | Frozen |

**Promotion thresholds** are not constants in the worker — they are policy values stored alongside the junior so the owner can tighten them per-tenant (a regulated mining house may demand `≥100 uses + ≥0.9 satisfaction` for `live` promotion). Defaults match the diagram.

## 4. The Spawner contract

The spawner exposes two named functions. `selectJunior` decides; `spawnNewJunior` authors. Both are pure I/O orchestrators over the cognitive engine + brain-llm-router + repository.

```typescript
export interface JuniorSpawnRequest {
  readonly tenant_id: string;
  readonly user_id: string;
  readonly intent_natural_language: string;
  readonly research_session_handle: ResearchSessionHandle | null;
  readonly active_scope: ResolvedScope;
  readonly evidence_attachments?: ReadonlyArray<AttachmentRef>;
}

export interface SpawnDecision {
  readonly kind: 'use_seed' | 'use_spawned' | 'use_tenant_authored' | 'spawn_new';
  readonly junior_id: string;               // resolved agent_id (English)
  readonly specialisation: string;          // short label for the subtitle
  readonly subtitle: string;                // "Borjie's AI ... Specialist"
  readonly reasoning: string;               // why this junior was chosen / spawned
  readonly confidence: number;              // 0-1
}

export interface SpawnedJuniorAuthorPayload {
  readonly proposed_agent_id: string;       // e.g. 'drone-imagery-analyst'
  readonly proposed_specialisation: string; // "Drone Imagery Analysis"
  readonly proposed_subtitle: string;
  readonly proposed_scope: JuniorScope;
  readonly proposed_modes: ReadonlyArray<JuniorMode>;
  readonly proposed_escalation_policy: EscalationPolicy;
  readonly proposed_audiences: ReadonlyArray<Audience>;
  readonly proposed_authority_tier_max: 0 | 1 | 2;
  readonly llm_reasoning: string;
}

export interface SelectJuniorFn {
  (request: JuniorSpawnRequest): Promise<SpawnDecision>;
}

export interface SpawnNewJuniorFn {
  (request: JuniorSpawnRequest): Promise<SpawnedJuniorAuthorPayload>;
}
```

`SpawnedJuniorAuthorPayload` is validated against the existing `JuniorPersona` contract by Zod *before* it touches the database. Invalid payloads are rejected; the spawner falls back to escalation.

## 5. The selection algorithm

```
selectJunior(request):
  1. cognitive engine classifies intent → IntentClass with confidence
  2. lookup SEED juniors by (audience, intent_keywords) → top match
  3. if seed match.score ≥ 0.85 → return use_seed
  4. lookup TENANT_AUTHORED juniors → top match
  5. if tenant_authored.score ≥ 0.85 → return use_tenant_authored
  6. lookup SPAWNED juniors with status in (shadow|live|locked) → top match
  7. if spawned.score ≥ 0.85 → return use_spawned
  8. (no good match) → spawnNewJunior(request) → status=draft → return spawn_new

  All resolution writes to agent_turns table for visibility to root MD.
```

The 0.85 cutoff is deliberately tight: we prefer a *new* specialist over a *forced* fit. A loose match degrades user satisfaction faster than a fresh draft junior does, because the user sees a wrong subtitle ("Drone Imagery Specialist" when they wanted a tailings opinion) and loses trust.

Tie-break order within each pool: highest `avg_satisfaction` → highest `usage_count` → most-recent `last_used_at`. Locked juniors beat `live`, `live` beats `shadow`.

## 6. The spawning LLM call

```
LLM (Claude Opus, extended thinking 32000 tokens):

  Input:
    - The user's intent
    - The active scope's context
    - The seed junior list (so we don't duplicate)
    - The recent spawned junior list (so we don't duplicate)
    - The tenant's authority configuration

  Task:
    Propose a junior persona for this intent. Include:
    - English agent_id (kebab-case)
    - Short specialisation label
    - Subtitle (Borjie's AI ___ Specialist / Advisor / Coordinator)
    - JuniorScope: which data_tables, tab_recipes, doc_recipes, media_recipes, research_topics
    - 3-5 modes
    - Escalation policy
    - Target audiences
    - Authority tier max
    - Reasoning trace

  Output:
    SpawnedJuniorAuthorPayload (validated by Zod against the JuniorPersona contract)
```

Routing uses `@borjie/brain-llm-router` cost-cascade. Heavy authoring (the first draft) runs Opus with the 32k extended-thinking budget; subsequent revisions (`shadow → live` polish) run Sonnet via the cascade. Cost budget per spawn: **≤ $0.50 + 90 s wall-clock**. The cascade aborts if either ceiling is crossed; the request degrades to a "best seed match" escalation rather than failing the turn.

The display name in every output is the constant `"Mr. Mwikila"`. The LLM is *not* permitted to propose alternative human names; the subtitle is the only surface where it expresses the specialisation.

## 7. The lifecycle worker

A new service `services/junior-evolution-worker/` (stub in this wave, full implementation later) runs the same cron pattern as `ui-evolution-worker`:

- **Cron:** `0 4 * * *` (04:00 UTC daily — two hours after the UI evolution sweep so the cognitive-engine snapshot is fresh).
- **Pass 1 — promotion:** for each tenant + junior in `shadow`, count usages and satisfaction over the last 14d; promote to `live` when ≥10 uses and ≥0.7 avg.
- **Pass 2 — locking:** for each junior in `live`, check 30-day sustained ≥0.85 satisfaction; lock if held.
- **Pass 3 — revision:** for each junior with falling satisfaction (<0.5 over 14d), emit a `junior_revision_proposal` (analogous to the UI evolution proposal) for owner approval.
- **Pass 4 — deprecation:** for juniors that score <0.3 sustained or that have not been used in 60d, propose deprecation.

The worker emits to the existing audit-hash-chain so every state transition is tamper-evident. Tier-1 promotions are auto-applied; Tier-2 revisions and deprecations are owner-approved (mutation-authority pipeline).

## 8. User-facing invariant

The user **always** sees `"Mr. Mwikila"` as the agent name. The subtitle changes ("Borjie's AI Drone Imagery Specialist") when a new specialisation activates — that is the only visible cue.

There is no leakage path:
- The chat surface (handled by 18V-FIX) renders the display name from a constant, never the agent_id.
- The audit-chain stores the agent_id for the owner's eyes but never renders it to the chat thread.
- Notification emails / SMS / push reference Mr. Mwikila only.

The MD is one *persona*, many *specialists*.

## 9. Owner visibility

The owner can manage all juniors via the admin portal:

- **List view** — every junior for the tenant grouped by `provenance` + `lifecycle_status`, with usage count, last-used, avg-satisfaction.
- **Draft inbox** — recent LLM-proposed drafts awaiting auto-promotion or manual review.
- **Manual lifecycle controls** — approve / reject a draft, manually lock a `live` junior, manually deprecate a junior, override the promotion thresholds.
- **Lifecycle audit-chain** — every state transition with timestamp, reason, LLM reasoning trace, and the turn that triggered it.
- **Catalogue export** — full junior catalogue as JSON for backup / cross-tenant migration.

The admin portal pulls through the existing org-scope hierarchy (Wave 18Q) — owners see their tenant's catalogue; SUPER_ADMIN sees all.

## 10. Anti-patterns (do not do)

- Spawn a junior for *every* novel intent without checking for fuzzy seed/spawned matches first — creates junior bloat, fragments the catalogue, and degrades retrieval quality.
- Show the user the `agent_id` — always render `"Mr. Mwikila"` + the subtitle only.
- Skip the lock/improve cycle — every spawned junior matures or it never moves past `draft`.
- Allow Tier 2 mutations from a `draft` junior — must reach `live` first and even then is gated by the per-junior `authority_tier_max`.
- Drop satisfaction metrics — every turn must update the satisfaction signal in `junior_turn_feedback`.
- Mutate the `seed` provenance class at runtime — seeds are PRs only.

## 11. Schema extensions

Additive only — no destructive alteration of the existing 18V tables.

```sql
-- Extend junior_personas (additive — no destructive alteration)
ALTER TABLE junior_personas
  ADD COLUMN provenance text NOT NULL DEFAULT 'seed'
    CHECK (provenance IN ('seed','spawned','tenant_authored')),
  ADD COLUMN lifecycle_status text NOT NULL DEFAULT 'live'
    CHECK (lifecycle_status IN ('draft','shadow','live','locked','deprecated')),
  ADD COLUMN usage_count int NOT NULL DEFAULT 0,
  ADD COLUMN last_used_at timestamptz,
  ADD COLUMN avg_satisfaction numeric(3,2),
  ADD COLUMN spawned_by_user_id text,
  ADD COLUMN spawned_from_turn_id uuid,            -- references cognitive_turns(id)
  ADD COLUMN promoted_at timestamptz,
  ADD COLUMN locked_at timestamptz,
  ADD COLUMN deprecated_at timestamptz;

-- For tenant-authored juniors: tenant_id is now meaningful
-- (seed = global, spawned/tenant_authored = tenant-scoped)
ALTER TABLE junior_personas
  ADD COLUMN tenant_id text;  -- null for seed; required for spawned/tenant_authored

-- Backfill: existing rows are seed, tenant_id NULL.
UPDATE junior_personas SET provenance = 'seed' WHERE provenance IS NULL OR provenance = '';

-- Track each turn's junior satisfaction
CREATE TABLE junior_turn_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  junior_id text NOT NULL,                         -- junior_personas.id
  tenant_id text NOT NULL,
  turn_id uuid NOT NULL,                           -- references agent_turns(id)
  satisfaction_score numeric(3,2),                 -- 0.0-1.0
  feedback_kind text NOT NULL,                     -- explicit_positive|explicit_negative|implicit_completed|implicit_abandoned
  recorded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE junior_turn_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON junior_turn_feedback
  USING (tenant_id = current_setting('app.tenant_id', true));
```

Note: `seed` rows keep `tenant_id = NULL` (global catalogue); `spawned` and `tenant_authored` rows MUST have a non-null `tenant_id`. The application layer enforces this — the migration leaves the column nullable to avoid blocking the backfill.

## 12. Cross-wave coordination

| Wave | Surface | Coordination |
|--|--|--|
| **18V** (parent) | The static junior contract | This addendum extends it; no modification |
| **18V-FIX** (sibling) | Unified Mr. Mwikila persona surface | Owns the front of the curtain (display name, voice); this addendum owns the back (selection, authoring) |
| **18Q** | Capabilities unification | The admin portal grouping pulls from 18Q's hierarchy |
| **18S** | Mutation authority | Tier 2 lifecycle events (tenant-authored juniors, deprecation) ride the existing T2 pipeline |
| **18T** | Cognitive engine | The intent classifier drives step 1 of the selection algorithm |
| **17B / 18F** | UI lock/improve | The lifecycle worker is modelled on the UI evolution worker |
| **17D / 18G** | Doc recipes lock/improve | Same lifecycle vocabulary |

## 13. Out of scope (this wave)

- Full implementation of `services/junior-evolution-worker/` — only a stub is created. Promotion / deprecation / revision logic land in a follow-up after Codex C4 settled.
- Cross-tenant junior portability (migrating a tenant-authored junior to a sibling tenant) — gated on the org-scope hierarchy work in 18Q.
- Multi-language subtitle authoring — every subtitle is English in this wave; Swahili / French translations land with the next persona-i18n pass.
- Junior-to-junior delegation (a junior calling another junior) — explicitly deferred until the cognitive engine's cross-domain detection is hardened.

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.
