# Mutation Authority — Design Specification

> Wave 18S / cross-layer framing — the canonical contract for "the MD
> *writes* everything, under authority, double-verified when stakes are
> high." This spec is the **WRITE side** that completes
> [`UNIVERSAL_OBSERVABILITY_SPEC.md`](./UNIVERSAL_OBSERVABILITY_SPEC.md)
> (Wave 18R, the READ side). Together they define a Master Brain whose
> reach is total and whose authority is auditable.

Status: design-spec. Phase 2 ships `packages/mutation-authority/` +
migration `0023_mutation_authority.sql` + four api-gateway routes + four
persona-kernel mutation tools. Reuses (does NOT duplicate) Wave 6 killswitch
RBAC and the existing `approval_policy_actions` quorum table.
Brand: Borjie. Persona: Mr. Mwikila (Managing Director).
Charter: [`Docs/MASTER_BRAIN_AUTONOMY_MANIFESTO.md`](../MASTER_BRAIN_AUTONOMY_MANIFESTO.md).

Sibling specs:

- READ side: [`Docs/DESIGN/UNIVERSAL_OBSERVABILITY_SPEC.md`](./UNIVERSAL_OBSERVABILITY_SPEC.md) (Wave 18R).
- Universal-creator contract: [`Docs/DESIGN/CAPABILITIES_UNIFICATION.md`](./CAPABILITIES_UNIFICATION.md) (Wave 18Q).
- UI evolution (lock/improve flow): [`Docs/DESIGN/ANTICIPATORY_UX_SPEC.md`](./ANTICIPATORY_UX_SPEC.md) (Wave 17B / 18B / 18F).
- Document evolution (lock/improve flow): [`Docs/DESIGN/DOCUMENT_COMPOSITION_SPEC.md`](./DOCUMENT_COMPOSITION_SPEC.md) (Wave 17D / 18C / 18G).
- Autonomous loops: [`Docs/DESIGN/AUTONOMOUS_LOOPS_SPEC.md`](./AUTONOMOUS_LOOPS_SPEC.md).
- Deep research (origin of many proposals): [`Docs/DESIGN/DEEP_RESEARCH_SPEC.md`](./DEEP_RESEARCH_SPEC.md).
- Media generation: [`Docs/DESIGN/MEDIA_GENERATION_SPEC.md`](./MEDIA_GENERATION_SPEC.md).
- Marketing & promotion: [`Docs/DESIGN/MARKETING_PROMOTION_SPEC.md`](./MARKETING_PROMOTION_SPEC.md).

---

## 1. Vision

Founder, verbatim:

> "Yes — so this way can change UI by adding or removing fields for
> example, edit certain data with permissions and double-checking etc.
> Like this needs to be SOTA MD powers super open claw, like if you
> think deep online research."

The metaphor is "super open claw": Mr. Mwikila's reach extends into
every surface of the workspace — UI, data, documents, externally-facing
actions — but **every grasp goes through three gates**:

1. **Authority check** — does this mutation class live within his
   delegated tier? (Tier 0 / 1 / 2.)
2. **Sanity check** — is the proposal well-formed, cited, reversible,
   inside the recipe's declared subject scope?
3. **Double-verify** — when the stakes are high (funds, regulatory,
   killswitch, KYB, contract signing, bulk delete), a SECOND distinct
   authoriser must counter-sign before execution.

The READ contract (Wave 18R) is what gives Mr. Mwikila the situational
awareness to compose meaningful mutations. The WRITE contract (this
spec) is what lets him act on that awareness without ever sliding into
unilateral motion on owner-grade decisions. The four temperament words
of the manifesto — **obsessed, autonomous, anticipatory, accountable** —
all bottom out here: *accountable* is the audit-hash-chained mutation
ledger this spec defines; *autonomous* is the breadth of Tier 0 and
Tier 1; *anticipatory* is the proposals stream feeding the morning
approval queue; *obsessed* is the recipe registry that mints proposal
kinds for every domain Mr. Mwikila reaches into.

---

## 2. The Four Mutation Classes

Every write Mr. Mwikila performs falls into exactly one of four classes.
Class determines composition surface, preview shape, default tier,
default reversibility, and which downstream artefact systems it ties
into.

### 2.1 UI Mutation

Propose adding, removing, reordering, or rewording a field, group, or
step in an existing `TabRecipe`. Or propose a new `TabRecipe`
entirely. These ride the **lock/improve flow** from Wave 17B / 18F: the
recipe carries a `status` of `draft | shadow | live | locked | deprecated`;
a new variant lands as `shadow`, the owner reviews diffs vs the `live`
variant, then promotes (`shadow → live`, old live → `locked`).

Default tier: **Tier 1** (24h auto-promote unless rejected).
Reversibility: **fully**. Old variant is `locked`, can be reverted by
demoting the new live back and promoting the old one.

### 2.2 Data Mutation

Write to any tenant-scoped table — `INSERT` / `UPDATE` / `DELETE` of a
single (or bulk) row. The 10 canonical sub-categories are enumerated in
§8. Examples: update a parcel grade after a new assay arrives, register
a new buyer KYB record, flag a worker incident, log an FX hedge, write
an ore-stockpile correction, append a regulatory-filing entry.

Default tier: ranges from **Tier 1** (incident log, site metadata)
through **Tier 2-Critical** (KYB approval, regulatory filing, contract
sign, killswitch toggle, bulk delete). Reversibility varies; the recipe
declares it.

### 2.3 Document Mutation

Revise an existing doc, propose a new template version, or submit / file
a regulatory return. Tier 2 docs (Tumemadini monthly returns, NEMC
incident reports, signed contracts) ride the Wave 17D / 18G lock-improve
flow PLUS the owner-approval queue. Internal-only docs (draft briefs,
research summaries) can be Tier 1 if the recipe declares it.

Default tier: **Tier 2** for any doc with external impact, **Tier 1**
for internal-only.

### 2.4 Action Mutation

Execute a real-world action with external impact: send an email outside
the tenant, transfer funds, sign a contract, place an FX hedge, file a
Tumemadini return, publish a marketing asset, post to an external
channel. Highest stakes; uniformly **Tier 2**, and the irreversible-money
or regulatory subset is **Tier 2-Critical**.

Reversibility: **partial** (refund / clawback / retraction is sometimes
possible) or **irreversible** (signed contract, filed return).

---

## 3. The Three Authority Tiers (plus the Critical Tier)

Every mutation class is gated by an authority tier. Tier is declared at
the recipe level and pinned per-proposal — a Tier 1 recipe cannot escape
its tier at composition time without a recipe-version bump.

### 3.1 Tier 0 — Always Autonomous

No approval needed. Mr. Mwikila owns Tier 0 with zero friction. Covers:

- Reading any data (this is the entire surface of Wave 18R).
- Proposing any draft, gathering any research, staging any UI / doc /
  media variant in `shadow` state.
- Running any background pass (sleep-pass-orchestrator, proactive
  triggers).
- Writing to the per-MD scratchpad (kernel-memory-episodic, working
  memory, the "thinking out loud" surface).

Audit trail: every Tier 0 action still appends to the action-history
ledger. "Autonomous" means "no approval gate", not "no audit".

### 3.2 Tier 1 — Stage + 24h Auto-Promote

The MD authors a proposal. The owner sees it in the approval queue with
a 24h timer. If the owner takes no action, the proposal **auto-promotes**
at the timer's expiry. If the owner rejects, the proposal goes to
`rejected` and a 6h cooldown blocks re-proposal of the same `(recipe_id,
subject)` pair. Covers:

- Author a new UI variant (shadow → 24h → live).
- Draft a doc with internal-only audience.
- Compose a media artefact for owner inspection.
- Send an internal-only email (owner's own org).
- Update non-regulatory metadata (site name, parcel notes).
- Log an incident or worker safety observation.

Tier 1 is reversible without external impact. The 24h window gives the
owner time to course-correct without bottlenecking on every minor
decision.

### 3.3 Tier 2 — Owner-Approval Gate

Owner must explicitly Approve or Reject. No auto-promote. Expiry is 7d
(after which the proposal goes to `expired` and the MD may re-propose
with fresh evidence). Covers everything external-impact and non-trivial:

- File a regulatory return (Tumemadini, NEMC, TRA).
- Send funds (above per-tenant threshold; see Critical Tier).
- Sign a contract.
- Publish a marketing campaign.
- Mutate a regulatory record (licence renewal, KYB record).
- Revise a previously-live UI recipe that is `locked` (lock/improve
  re-entry).

The owner sees: subject of the mutation, preview diff (current vs
proposed), research citations, reversibility flag, cost / value at
stake, MD reasoning, and three buttons — **Approve**, **Reject**,
**Request Revision**.

### 3.4 Tier 2-Critical — Double-Verify

The Critical Tier is a strict subset of Tier 2 that REQUIRES a second
distinct authoriser. Triggered when ANY of the following hold:

- Funds transferred over $X (per-tenant configurable, default
  $50,000 USD-equivalent at the canonical FX rate).
- Killswitch toggled (reuses the Wave 6 RBAC primitives from
  `migration 0009_killswitch_rbac.sql`).
- Regulatory filing for the current period (Tumemadini, NEMC, TRA
  monthly returns).
- Buyer KYB approval (a buyer cannot transact without two approvers).
- Contract signing (auto-binding contracts only).
- Bulk delete of historical data (any `DELETE` affecting > 100 rows).

Requires:

- **Owner approval (primary)** — same UX as Tier 2.
- **Second authoriser** — pre-assigned per tenant (usually CFO,
  compliance officer, or co-founder). Configured in
  `second_authoriser_assignments`.
- **5-minute cooldown** between approvals — prevents a single operator
  double-clicking through two browser tabs.
- **Audit-chain entry** binding BOTH approvers' identities + timestamps
  + reasoning.

Implementation reuses the existing two-operator RBAC primitives from
Wave 6 — `killswitch_pending_confirmations` has the exact ephemeral
"awaiting second confirmer" state machine this needs, and the API
enforces `confirmer_user_id ≠ initiator_user_id`. The mutation-authority
package re-exports a generalised `DoubleVerifyGuard` that wraps the same
invariant for arbitrary critical mutations.

---

## 4. The Mutation Recipe Contract

```typescript
export interface MutationRecipe {
  readonly id: string;                          // 'register_new_buyer', 'file_tumemadini_return', 'set_killswitch'
  readonly class: 'ui' | 'data' | 'document' | 'action';
  readonly version: number;
  readonly status: 'draft' | 'shadow' | 'live' | 'locked' | 'deprecated';
  readonly authority_tier: 0 | 1 | 2;
  readonly is_critical: boolean;                // triggers double-verify
  readonly compose: (ctx: MutationComposeContext) => Promise<MutationProposal>;
  readonly execute: (proposal: MutationProposal, approvals: ApprovalRecord[]) => Promise<MutationResult>;
  readonly required_citations: ReadonlyArray<CitationContract>;  // every claim in the proposal must cite
  readonly reversibility: 'fully' | 'partial' | 'irreversible';   // matters for owner UX
  readonly brand: 'borjie';
}

export interface MutationProposal {
  readonly id: string;                          // uuid
  readonly recipe_id: string;
  readonly recipe_version: number;
  readonly proposed_by: 'mr_mwikila' | 'owner_explicit';
  readonly proposed_at: string;
  readonly subject: { kind: string; id: string };  // what's being mutated (parcel uuid, tab id, etc.)
  readonly preview: MutationPreview;             // what the owner sees: diff, current vs proposed, impact summary
  readonly research_evidence_ids: ReadonlyArray<string>;
  readonly cost_or_value_at_stake_usd_cents: number;  // for "above $X threshold" gating
  readonly reversibility: 'fully' | 'partial' | 'irreversible';
  readonly authority_tier: 0 | 1 | 2;
  readonly requires_double_verify: boolean;
  readonly expires_at: string;                  // 24h for Tier 1; 7d for Tier 2; 14d for Tier 2-Critical
}

export interface ApprovalRecord {
  readonly proposal_id: string;
  readonly approver_user_id: string;
  readonly approver_role: 'owner' | 'second_authoriser';
  readonly decision: 'approved' | 'rejected';
  readonly reasoning: string;
  readonly decided_at: string;
  readonly audit_hash: string;
}

export interface MutationResult {
  readonly proposal_id: string;
  readonly status: 'executed' | 'failed' | 'aborted';
  readonly executed_at: string;
  readonly rollback_token: string | null;       // for fully-reversible mutations
  readonly side_effects_summary: string;
  readonly downstream_artifacts: ReadonlyArray<{ kind: string; id: string }>;
  readonly audit_hash: string;
}
```

The contract is intentionally **content-agnostic**: `subject.kind` and
`preview` shape are recipe-defined. The runtime only enforces the
authority + double-verify + audit invariants. Each recipe owns its own
preview encoding (a diff for UI, a row delta for data, a markdown
diff for docs, an action signature for actions).

---

## 5. The Four Layers of Mutation

### 5.1 Layer 1 — Intent Recognition

A mutation opportunity emerges from one of three sources:

1. **Research finds it** — `deep_research_v1` surfaces a market signal
   ("USD/TZS dropped 4%") → the MD synthesises an FX-hedge MutationProposal.
2. **Owner triggers it** — owner says "approve buyer X" → the MD
   composes a KYB-approval proposal.
3. **Metric breach** — a monitor fires (incident rate above threshold,
   licence days-to-renewal < 30) → the MD composes the appropriate
   intervention proposal.

Intent recognition is owned by the persona kernel + sleep-pass orchestrator
+ proactive-triggers worker. The mutation-authority package is downstream
of intent — it doesn't decide WHAT to mutate, only authenticates HOW.

### 5.2 Layer 2 — Composition

The recipe's `compose(ctx)` assembles a `MutationProposal`:

1. Build the preview (diff vs current state).
2. Gather research citations (every claim must cite).
3. Compute `cost_or_value_at_stake_usd_cents`.
4. Classify authority tier (recipe default + per-subject overrides).
5. Determine reversibility.
6. Set `expires_at` per tier (24h / 7d / 14d).

Output is a `MutationProposal` written to `mutation_proposals` with
status `pending`. The audit-chain receives a "proposal-composed" entry.

### 5.3 Layer 3 — Approval Workflow

Tier 0 proposals execute immediately (Layer 4).

Tier 1 proposals land in the owner's queue. After 24h with no decision,
the workflow worker auto-promotes (state → `approved_full`).

Tier 2 proposals land in the owner's queue and wait for explicit Approve
/ Reject / Request Revision. On approval, state → `approved_primary`.

Tier 2-Critical proposals: after `approved_primary`, the proposal moves
to the second-authoriser queue. The second authoriser sees the SAME
preview + the owner's reasoning. On approval, state → `approved_full`.
Either party can reject; rejection terminates the workflow.

Invariants enforced by `DoubleVerifyGuard`:

- `approver_user_id` for primary ≠ `approver_user_id` for second.
- At least 5 minutes elapsed between the two approvals.
- Both approvals reference the same `proposal_id`.

### 5.4 Layer 4 — Execution + Audit

When state hits `approved_full`, the executor invokes `recipe.execute(
proposal, approvals)`. The function returns a `MutationResult`. The
result is written to `mutation_history`. The audit-chain receives a
final entry binding the proposal hash + every approval hash + the
result hash. The proposal moves to terminal state `executed`, `failed`,
or `aborted`.

For fully-reversible mutations, a `rollback_token` is minted and stored.
Calling `POST /api/v1/mutations/:id/rollback` with the token reverses
the side effects, appends an audit-chain entry, and marks the original
mutation as `rolled_back`.

---

## 6. Universal-Write Hooks

Each existing capability ties in cleanly:

- `compose_tab_v1` produces a **UI** MutationProposal when the recipe
  is in `shadow` state (lock/improve flow).
- `compose_doc_v1` produces a **Document** MutationProposal for Tier 2
  docs (Tumemadini returns, contracts, NEMC reports).
- `compose_media_v1` produces an **Action** MutationProposal when the
  media is to be published externally.
- `compose_campaign_v1` produces a portfolio of MutationProposals —
  some Tier 1 (draft asset), some Tier 2 (the external publish step).
- `research_v1` proposes MutationProposals when research surfaces an
  actionable opportunity (FX-hedge window, licence-renewal urgency).
- The new `mutate_data_v1` tool (added in Phase 2) lets the MD propose
  a single-record write — e.g. update a parcel grade after a new assay
  arrives.

---

## 7. Anti-Patterns

- Execute a Tier 2 mutation without owner approval.
- Execute a Tier 2-Critical mutation without TWO approvals.
- Mutate without an audit-chain entry.
- Mutate without research citations for the rationale.
- Propose a mutation the owner has already rejected within the cooldown
  window.
- Allow the same user to act as both owner and second authoriser.
- Mutate beyond the recipe's declared `subject` scope (recipe escape).
- Persist the rollback token in a place a client can read (token is
  server-side only; client receives an opaque handle).

---

## 8. The Ten Categories of Data Mutations

| # | Category | Operation | Tier |
| --- | --- | --- | --- |
| 1 | `parcel_update` | `UPDATE parcels SET grade=…, location=…` | Tier 1 |
| 2 | `buyer_register` | `INSERT INTO buyers + INSERT INTO kyb_records` | Tier 2-Critical |
| 3 | `site_metadata_update` | `UPDATE sites SET name=…, polygon=…` | Tier 1 |
| 4 | `worker_incident_log` | `INSERT INTO incidents` | Tier 1 |
| 5 | `fx_hedge_record` | `INSERT INTO fx_positions` | Tier 2 |
| 6 | `tumemadini_filing` | `INSERT INTO tumemadini_filings` | Tier 2-Critical |
| 7 | `nemc_filing` | `INSERT INTO nemc_filings` | Tier 2-Critical |
| 8 | `contract_sign` | `UPDATE contracts SET signed_at=…` | Tier 2-Critical |
| 9 | `killswitch_toggle` | `UPDATE killswitch_state` | Tier 2-Critical (existing Wave 6) |
| 10 | `bulk_delete` | `DELETE FROM <any> WHERE …` | Tier 2-Critical when > 100 rows |

Each category is a recipe with its own composer, preview shape, and
executor. The persona kernel calls `mutate_data_v1` with the category id;
the kernel routes to the appropriate recipe.

---

## 9. Schema Additions

```sql
CREATE TABLE mutation_recipes (
  id text NOT NULL,
  version int NOT NULL,
  status text NOT NULL,
  class text NOT NULL,                          -- ui|data|document|action
  authority_tier smallint NOT NULL,
  is_critical boolean NOT NULL DEFAULT false,
  reversibility text NOT NULL,                  -- fully|partial|irreversible
  compose_fn_ref text NOT NULL,
  execute_fn_ref text NOT NULL,
  required_citations jsonb NOT NULL,
  brand text NOT NULL DEFAULT 'borjie',
  promoted_at timestamptz,
  locked_at timestamptz,
  PRIMARY KEY (id, version)
);

CREATE TABLE mutation_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  recipe_id text NOT NULL,
  recipe_version int NOT NULL,
  proposed_by text NOT NULL,                    -- 'mr_mwikila' | 'owner_explicit:<uuid>'
  proposed_at timestamptz NOT NULL DEFAULT now(),
  subject jsonb NOT NULL,                       -- { kind, id }
  preview jsonb NOT NULL,                       -- the diff/preview payload
  research_evidence_ids text[] NOT NULL,
  cost_or_value_at_stake_usd_cents bigint NOT NULL DEFAULT 0,
  reversibility text NOT NULL,
  authority_tier smallint NOT NULL,
  requires_double_verify boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',       -- pending|approved_primary|approved_full|rejected|executed|aborted|expired
  audit_hash text NOT NULL
);

CREATE TABLE mutation_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES mutation_proposals(id),
  approver_user_id text NOT NULL,
  approver_role text NOT NULL,                  -- owner|second_authoriser
  decision text NOT NULL,                       -- approved|rejected
  reasoning text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  audit_hash text NOT NULL,
  CONSTRAINT no_self_double_approve UNIQUE (proposal_id, approver_user_id)
);

CREATE TABLE mutation_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES mutation_proposals(id),
  status text NOT NULL,                         -- executed|failed|aborted
  executed_at timestamptz NOT NULL DEFAULT now(),
  rollback_token text,
  side_effects_summary text NOT NULL,
  downstream_artifacts jsonb,
  audit_hash text NOT NULL
);

CREATE TABLE second_authoriser_assignments (
  tenant_id text NOT NULL,
  primary_user_id text NOT NULL,
  second_authoriser_user_id text NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, primary_user_id)
);
```

All five tables carry RLS keyed to `current_setting('app.tenant_id',
true)` for tenant-scoped reads, mirroring the existing pattern in
`0009_killswitch_rbac.sql`. The `mutation_recipes` table is global
(not tenant-scoped) — recipes are platform-level definitions; per-tenant
overrides live in `approval_policy_actions` (Wave 6's K5 parity table).

---

## 10. Phase 2 Implementation Map

- **New package** — `packages/mutation-authority/` (this wave creates
  the scaffold; full impl follows in 18S-runtime).
- **New api-gateway routes**:
  - `POST /api/v1/mutations/propose`
  - `POST /api/v1/mutations/:id/approve`
  - `POST /api/v1/mutations/:id/reject`
  - `GET  /api/v1/mutations/queue/:user_id`
  - `POST /api/v1/mutations/:id/execute`
  - `POST /api/v1/mutations/:id/rollback`
- **Persona kernel tools** — `mutate_ui_v1`, `mutate_data_v1`,
  `mutate_document_v1`, `mutate_action_v1`. Each tool wraps the
  appropriate `MutationRecipe` registry and emits a proposal.
- **Worker wiring**:
  - `proactive-triggers-worker` proposes mutations when its monitors
    fire (FX drop → hedge proposal; days-to-renewal < 30 → renewal
    pack proposal).
  - `sleep-pass-orchestrator` chains overnight mutation proposals into
    the morning briefing's approval queue, ordered by leverage.
- **Migration** — `0023_mutation_authority.sql` with the 5 new tables +
  RLS policies. Migration number bumps if sibling waves take 0023 first.
- **Test surface** — `mutation-authority` package ships ≥ 70% unit
  coverage; integration tests (router + DB) land with the runtime in
  18S-runtime.
- **Reuse, do not duplicate**:
  - The two-operator ephemeral state pattern from
    `killswitch_pending_confirmations` is re-exported as
    `DoubleVerifyGuard` — the new tables piggyback the same
    "initiator ≠ confirmer + expiry window" invariant.
  - The `approval_policy_actions` quorum / role-group / re-auth /
    recall-window schema (Wave 6 K5) is the authoritative source of
    per-tenant policy overrides; `mutation_recipes` declares defaults,
    `approval_policy_actions` overrides per-tenant.
  - The hash-chain primitive from `@borjie/audit-hash-chain` is the
    sole audit mechanism — no new chain types.

The MD's reach is total. His authority is auditable. Every grasp leaves
a hash.

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.
