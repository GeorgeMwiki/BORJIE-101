# Universal Observability — Design Specification

> Wave 18R / cross-layer framing — the canonical contract for "the MD sees
> everything." This spec defines the three observability tiers that the
> [`CAPABILITIES_UNIFICATION.md`](./CAPABILITIES_UNIFICATION.md) atomic
> capabilities all assume exist. The unification spec describes WHAT
> Mr. Mwikila composes; this spec describes HOW he SEES.

Status: design-spec. Phase 2 ships `packages/session-mirror/` + migration
`0022_ui_state_snapshots.sql` + two api-gateway routes. No runtime
side-effects beyond the new package and the migration.
Brand: Borjie. Persona: Mr. Mwikila (Managing Director).
Charter: [`Docs/MASTER_BRAIN_AUTONOMY_MANIFESTO.md`](../MASTER_BRAIN_AUTONOMY_MANIFESTO.md).

Sibling specs:

- Universal-creator contract: [`Docs/DESIGN/CAPABILITIES_UNIFICATION.md`](./CAPABILITIES_UNIFICATION.md) (Wave 18Q).
- Anticipatory UX (consumes Tier II + III): [`Docs/DESIGN/ANTICIPATORY_UX_SPEC.md`](./ANTICIPATORY_UX_SPEC.md) (Wave 17B / 18B / 18F).
- Autonomous loops (consumes all three tiers): [`Docs/DESIGN/AUTONOMOUS_LOOPS_SPEC.md`](./AUTONOMOUS_LOOPS_SPEC.md).
- Deep research (consumes Tier I): [`Docs/DESIGN/DEEP_RESEARCH_SPEC.md`](./DEEP_RESEARCH_SPEC.md).
- Document composition (consumes all three tiers): [`Docs/DESIGN/DOCUMENT_COMPOSITION_SPEC.md`](./DOCUMENT_COMPOSITION_SPEC.md).
- Media generation (consumes Tier I + III): [`Docs/DESIGN/MEDIA_GENERATION_SPEC.md`](./MEDIA_GENERATION_SPEC.md).
- Marketing & promotion (consumes all three tiers): [`Docs/DESIGN/MARKETING_PROMOTION_SPEC.md`](./MARKETING_PROMOTION_SPEC.md).

---

## 1. Vision

Founder, verbatim:

> "Yes — MD has access to every data, every field, every UI."

Expanded: Mr. Mwikila is **session-aware**, not just data-aware. The
Master Brain does not read the database at well-known query times and
otherwise stay blind to the workspace; he reads continuously and sees
**three concentric tiers**:

1. Every tenant **database row** he has authority for (parcels, contracts,
   prices, FX, sites, drill holes, assays, KPIs, regulatory filings,
   corpus, buyers, workers).
2. Every live **FIELD state** in the workspace (in-flight form values,
   partially-typed text, draft state, unsaved edits the owner has not
   yet pressed save on).
3. Every **UI state** in the workspace (which tabs are open, which is
   foreground, which panel inside is focused, which dialog is showing,
   the hover target, the scroll position of the active surface).

The four operating-principle words — **obsessed, autonomous, anticipatory,
accountable** — all degrade silently without this layer. *Anticipatory*
without seeing the partially-typed buyer name in a related tab degrades
to "guessed from the chat transcript alone." *Obsessed* without seeing
what the owner is looking at right now degrades to "morning-briefing only."
The universal observability layer is the substrate that makes the rest
of the autonomy stack genuinely intelligent rather than merely scheduled.

The authority ladder applies at the **write/execute** tier, not the
**read** tier. Reads are universal — the MD never asks "may I see this?"
Writes still gate at Tier 2 (publish, file, send, pay) and stage at
Tier 1 (draft, propose). The observability surface is read-only.

---

## 2. The Three Universal Observability Tiers

### 2.1 Tier I — Universal data observability

Every Drizzle table for the tenant is reachable from the MD's tool layer
through a typed `DataJoinRef`. `UniversalDataAccess` exposes query
builders (`queryParcels(filter)`, `queryContracts(filter)`, …) that read
directly from Supabase Postgres with the `app.tenant_id` RLS guard. The
MD never composes a SQL string by hand; the query builders compile to
parametrised Drizzle queries with batched dataloader reads (sub-second
latency budget per join, batched per turn).

> Example. Owner says "show me every parcel with assays above 5 g/t Au
> in Q4 across all sites." The MD invokes
> `ctx.data.parcels.list({ assay_filter: { metal: 'Au', cutoff_gpt: 5,
> period: 'Q4' } })`. No tenant_id parameter — it is bound at session
> construction and enforced by RLS.

Anti-pattern: the MD writing arbitrary SQL. The escape hatch
`ctx.data.query<T>(spec)` exists for dynamic-recipe authoring but goes
through the same RLS guard and is logged with a `decision_trace` branch
labelled `arbitrary_query` so audits can find them.

### 2.2 Tier II — Universal field state observability

The MD sees **live in-flight form values**, not just submitted data. When
the owner is mid-typing the buyer name "Jam…" in a KYB tab, Mr. Mwikila
already sees `Jam` and can offer the matching buyer record in a sibling
tab before the owner finishes typing.

This requires browser-side capture: every tracked form field emits a
debounced `field_change` event (every ~500ms or on blur) into
`passive_capture_events` (existing table, Wave 18A schema extended with
a `field_value_hashed` payload column for value-bearing events). The
MD's `FieldStateMirror` is a read-side view that joins
`passive_capture_events × tab_recipes` to recover the current draft
state for every open tab.

Per-session scope is **critical**: the MD sees in-flight state for the
**active owner's session only**. He does not see other users' draft text
within the same tenant — that would violate the per-user privacy contract
that the company-data RLS guard enforces.

> Example. Owner has the BuyerKYBStart tab open and has typed "Jamhuri
> M" in the company-name field but not pressed save. Mr. Mwikila's
> background tick reads `ctx.field_state.snapshot()`, sees the draft,
> joins to `buyers` table for fuzzy match, finds the existing record
> "Jamhuri Mining Co.", and stages a SpawnProposal to pre-fill the
> remaining fields the moment the owner commits the name.

### 2.3 Tier III — Universal UI state observability

The MD knows the **workspace topology**: which tabs are open, which is
foreground, which panel inside is focused, which dialog is showing, the
hover target, the scroll position of the active surface. The
`UiStateGraph` is a per-session mirror that the client publishes on tab
open / close / focus + every ~5s heartbeat. The MD reads the graph to
answer "what is the owner looking at right now?" and to anchor
anticipatory-UX SpawnProposals to the active context — never to a stale
five-minutes-ago context.

> Example. Owner is hovering over the `assay_grade_gpt` field in
> ParcelDetail tab. Mr. Mwikila reads `ctx.ui_state.hover_target`, sees
> the field, and uses it to choose which sub-tab to propose when the
> owner pauses (e.g. AssayDetail vs. ComplianceReview).

---

## 3. The OrgUserDataContext extended type

Every atomic capability receives the same context object. The
universal-creator contract from
[`CAPABILITIES_UNIFICATION.md`](./CAPABILITIES_UNIFICATION.md) §3 already
defines `OrgUserDataContext` with the minimum fields; this spec adds the
three observability tiers as first-class members.

```typescript
export interface OrgUserDataContext {
  // identity + session
  readonly tenant_id: string;
  readonly user_id: string;
  readonly session_id: string;

  // owner + brand
  readonly owner_profile: OwnerProfile;
  readonly tenant_brand: TenantBrand;
  readonly mastery_tier: 'novice' | 'fluent' | 'veteran';
  readonly authority_tier_max: 0 | 1 | 2;
  readonly language: 'en' | 'sw' | 'fr';

  // Tier I — Universal data
  readonly data: UniversalDataAccess;

  // Tier II — Universal field state
  readonly field_state: FieldStateMirror;

  // Tier III — Universal UI state
  readonly ui_state: UiStateGraph;

  // Existing handles
  readonly corpus_handle: CorpusHandle;
  readonly research_session_handle: ResearchSessionHandle | null;
}

export interface UniversalDataAccess {
  readonly parcels: ParcelQueryBuilder;
  readonly contracts: ContractQueryBuilder;
  readonly prices: PriceQueryBuilder;
  readonly fx: FxQueryBuilder;
  readonly sites: SiteQueryBuilder;
  readonly drill_holes: DrillHoleQueryBuilder;
  readonly assays: AssayQueryBuilder;
  readonly kpis: KpiQueryBuilder;
  readonly buyers: BuyerQueryBuilder;
  readonly workers: WorkerQueryBuilder;
  readonly tumemadini_filings: FilingQueryBuilder;
  readonly nemc_filings: FilingQueryBuilder;
  readonly tra_filings: FilingQueryBuilder;
  // ... one builder per tenant-scoped Drizzle table.

  /** Universal fallback for dynamic-recipe authoring. Logged as `arbitrary_query`. */
  readonly query: <T>(spec: ArbitraryQuerySpec) => Promise<ReadonlyArray<T>>;
}

export interface FieldStateMirror {
  /** Read the current in-flight draft for the given tab + field. */
  readonly read: (tab_id: string, field_id: string) => Promise<FieldValue | null>;
  /** Snapshot every in-flight draft for the active session. */
  readonly snapshot: () => Promise<ReadonlyMap<string, FieldValue>>;
  /** Resolve on the next change for this field, or null on timeout. */
  readonly waitForChange: (
    tab_id: string,
    field_id: string,
    timeout_ms: number,
  ) => Promise<FieldValue | null>;
}

export interface UiStateGraph {
  readonly active_tab_id: string | null;
  readonly tabs: ReadonlyArray<TabState>;
  readonly active_panel_id: string | null;
  readonly active_dialog_id: string | null;
  readonly hover_target: HoverTarget | null;
  readonly scroll_position: { tab_id: string; y: number } | null;
  readonly last_user_event: {
    kind: 'click' | 'keypress' | 'scroll' | 'hover';
    ts: string;
  } | null;
}

export interface TabState {
  readonly id: string;
  readonly recipe_id: string;
  readonly recipe_version: number;
  readonly opened_at: string;
  /** True iff the tab has unsaved field-state changes. */
  readonly is_dirty: boolean;
  readonly is_active: boolean;
}
```

The context is **deeply readonly** by TypeScript convention and is
constructed once per turn by the api-gateway middleware. Atomic
capabilities are pure consumers — they never mutate the context.

---

## 4. Capture Pipeline

### 4.1 Client side (browser)

The new `packages/session-mirror/` package provides three primitives:

- `useFieldCapture(tab_id, field_id)` — React hook that wraps
  `<input>` / `<textarea>` / `<select>` with debounced change capture.
  Emits `field_change` events through `SessionMirrorProvider`.
- `useUiStateBeacon(session_id)` — React hook that fires on tab focus,
  tab blur, dialog open / close, panel-focus changes, and ~5s heartbeat.
  Emits `ui_state` events.
- `SessionMirrorProvider` — context provider that bundles events from
  all hooks, batches them (max 500ms or 50 events whichever first), and
  POSTs to `/api/v1/session-mirror/capture`.

The existing `apps/admin-web/src/lib/sensorium/` bus stays in place for
the 14-event shape taxonomy (focus / scroll / a11y / network / etc.) —
it captures the SHAPE of interactions, never values. The session-mirror
layer is the **value-bearing complement**: it carries the actual field
values (hashed for PII) so the MD can read the draft state. The two
buses are siblings, not duplicates, and they POST to different endpoints
so the privacy contracts stay separable.

### 4.2 Server side

- `POST /api/v1/session-mirror/capture` — writes batched events into
  `passive_capture_events` (extended schema) and emits a
  `ui_state_snapshots` row when the batch carries UI-state payload.
- `GET /api/v1/session-mirror/snapshot/:session_id` — server-side
  on-demand snapshot for the MD's tool layer. Returns the current
  `FieldStateMirror` + `UiStateGraph` for the session.
- Supabase Realtime subscription on `passive_capture_events` so the
  MD's runtime can watch live (the anticipatory-UX trigger reads from
  this stream rather than polling).

### 4.3 The capture-privacy contract

- **PII redaction at the boundary.** Emails, phones, NIDA, KRA-PIN,
  TIN, IBAN, passports, M-Pesa codes, credit-card numbers are hashed
  client-side before leaving the browser. The raw value never crosses
  the network. The hash is salt-tagged with `tenant_id + field_id`
  so the same value in a different tenant or different field is
  unlinkable. `packages/session-mirror/src/field-capture/pii-redactor.ts`
  owns the boundary.
- **Opt-out attribute.** Any DOM element with `data-no-capture` is
  excluded — partner-API keys, draft secrets, secure tokens.
- **Consent surface.** Capture is on by default for authenticated owner
  sessions; off by default for unauthenticated / public-chat sessions.
  Tenant admins can disable per-feature via the `tenant_settings`
  toggles.
- **Retention.** 14-day rolling window for `passive_capture_events`;
  7-day for `ui_state_snapshots`. The MD's working-memory layer
  (`progressive-intelligence`) can pin specific events longer via the
  consolidation worker if they prove load-bearing for an open
  decision.
- **Per-session scope.** A user sees only their own session's
  field-state. Tenant-admins may aggregate field-shape telemetry across
  users (for UI evolution proposals) but never raw values.

---

## 5. Read Patterns for the Five Atomic Capabilities

| Capability | Tier I | Tier II | Tier III |
|---|---|---|---|
| `compose_tab_v1` | data joins for pre-fill | reads the sibling tab's draft buyer name to pre-populate the new tab | reads the active tab id to anchor the new tab next to it |
| `compose_doc_v1` | reads every joined parcel + assay + KPI the report needs | reads the open-tab's draft narrative to seed the executive summary | reads the active surface to choose default cover page |
| `compose_media_v1` | reads the parcel measurement to render into the still | (rare) — used only when the owner is mid-typing a brief | reads `active_tab_id` to know the subject to illustrate |
| `compose_campaign_v1` | reads buyer + investor segmentation | reads the announcement-draft tab if open | reads the open marketing-studio surface |
| `research_v1` | reads KPI table to ground research-question selection | (rare) — research is generally independent of in-flight typing | reads open tabs to bias source selection toward the active subject |

The pattern is uniform: **every capability reaches into the same
`OrgUserDataContext`**; the dispatcher does not need to know which tier
a given capability will read.

---

## 6. Anti-patterns

Mr. Mwikila violates the universal-observability contract when he:

1. **Polls field state with high frequency.** Use the realtime
   subscription pattern; the `waitForChange()` helper is the correct
   primitive for "tell me when the buyer field changes."
2. **Captures raw PII fields.** Always hash at the boundary. The
   redactor list is conservative — false positives are harmless, false
   negatives are privacy bugs.
3. **Reads data without tenant_id scope.** `UniversalDataAccess` binds
   tenant at construction; never accept a tenant_id from a tool
   argument.
4. **Mutates universal data without Tier-2 approval.** The
   observability surface is read-only by contract; writes go through
   the existing skill ladder.
5. **Reads another user's field-state in the same tenant.** Per-session
   scope is enforced server-side by `session_id` join; double-checked
   at the API layer.
6. **Exposes raw `arbitrary_query` to non-system callers.** The escape
   hatch is for dynamic-recipe authoring and is logged in
   `decision_trace`.

---

## 7. Schema Additions

Most tables already exist from Wave 18A (`passive_capture_events`) and
Wave 17B (`ui_telemetry_events`). The net-new artefact is one table for
the UI graph.

```sql
-- Migration 0022_ui_state_snapshots.sql
-- Per-session mirror of the workspace topology. The MD reads from this
-- table to answer "what is the owner looking at right now?"

CREATE TABLE IF NOT EXISTS ui_state_snapshots (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id             text NOT NULL,
  session_id          uuid NOT NULL,
  snapshot_at         timestamptz NOT NULL DEFAULT now(),
  active_tab_id       text,
  active_panel_id     text,
  active_dialog_id    text,
  tabs                jsonb NOT NULL,                     -- ReadonlyArray<TabState>
  hover_target        jsonb,
  scroll_position     jsonb,
  last_user_event     jsonb
);

CREATE INDEX IF NOT EXISTS idx_uss_session_recent
  ON ui_state_snapshots (session_id, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_uss_tenant_recent
  ON ui_state_snapshots (tenant_id, snapshot_at DESC);

ALTER TABLE ui_state_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ui_state_snapshots
  USING (tenant_id = current_setting('app.tenant_id', true));
```

A companion column extension on `passive_capture_events` carries the
hashed field-value for Tier-II events:

```sql
ALTER TABLE passive_capture_events
  ADD COLUMN IF NOT EXISTS field_value_hashed text,
  ADD COLUMN IF NOT EXISTS field_id text,
  ADD COLUMN IF NOT EXISTS tab_id text;

CREATE INDEX IF NOT EXISTS idx_pce_tab_field
  ON passive_capture_events (session_id, tab_id, field_id, captured_at DESC);
```

---

## 8. Phase 2 Implementation Map

| Artefact | Owner | Status |
|---|---|---|
| `packages/session-mirror/` — hooks + provider + capture client | this wave | scaffolded |
| `services/api-gateway/routes/session-mirror.ts` — POST capture, GET snapshot | follow-up wave | not started |
| Migration `0022_ui_state_snapshots.sql` + Drizzle schema | follow-up wave | spec only |
| Drop-in wrappers for `apps/owner-web/`, `apps/admin-web/`, `apps/marketing/` PrefillForm + Field components | follow-up wave | not started |
| `ctx.field_state` + `ctx.ui_state` factories in `@borjie/dynamic-ui` composer | follow-up wave | not started |
| Supabase Realtime subscription wiring in `packages/ai-copilot/src/heartbeat/` | follow-up wave | not started |

---

## 9. Cross-references

- Master operating manifesto: [`Docs/MASTER_BRAIN_AUTONOMY_MANIFESTO.md`](../MASTER_BRAIN_AUTONOMY_MANIFESTO.md)
- Universal-creator contract (Wave 18Q): [`Docs/DESIGN/CAPABILITIES_UNIFICATION.md`](./CAPABILITIES_UNIFICATION.md)
- Anticipatory UX (Wave 17B / 18B / 18F): [`Docs/DESIGN/ANTICIPATORY_UX_SPEC.md`](./ANTICIPATORY_UX_SPEC.md)
- Autonomous loops: [`Docs/DESIGN/AUTONOMOUS_LOOPS_SPEC.md`](./AUTONOMOUS_LOOPS_SPEC.md)
- Existing passive-capture schema (Wave 18A): `packages/database/src/schemas/master-brain-briefings.schema.ts`
- Existing UI-telemetry schema (Wave 17B): `packages/database/src/schemas/anticipatory-ux.schema.ts`
- Existing sensorium client bus: `apps/admin-web/src/lib/sensorium/` (shape-only complement)
- Existing decision-trace branch infra: `packages/observability/src/decision-trace/`

---

This document is the observability contract. Whenever an engineer
reaches for "but how does the MD know what the owner is looking at?",
the answer is: through `ctx.field_state` + `ctx.ui_state` +
`ctx.data` — the three tiers of universal observability, populated by
the `packages/session-mirror/` capture pipeline, gated by per-session
scope, PII-hashed at the boundary, and 14-day retained. The MD does not
ask "can I see this?" because the contract has already answered: he can.
