# Anticipatory UX — Design Specification

> This spec elaborates the Anticipatory UX Loop named in [MASTER_BRAIN_AUTONOMY_MANIFESTO.md](../MASTER_BRAIN_AUTONOMY_MANIFESTO.md) and its sibling [AUTONOMOUS_LOOPS_SPEC.md](./AUTONOMOUS_LOOPS_SPEC.md).

---

## 1. Vision

Founder, verbatim:

> "Anticipatory UX layer — even in dynamic UI, knowing what fields to add, why, how. Constantly branding on the tab dynamic UIs. When to lock tab UI vs when to improve it to better suit user needs, all with proper human intervention. Again BossNyumba porting opportunities."

Expanded: Mr. Mwikila — Borjie's resident Mining Operations Manager brain — is not merely "spawning the right tab when a buyer KYB conversation kicks off." Mr. Mwikila is a **dynamic UI designer + UX optimizer**. He composes form schemas in real time from the corpus + the operator's joined data + the operator's mastery profile, renders them through a brand-locked primitive layer so nothing off-brand can ever ship, watches telemetry on every rendered field, and proposes UI improvements that the owner explicitly approves before they go live. Any UI evolution above Tier 0 is owner-gated. The brand DNA is not negotiable — every dynamically composed surface inherits Borjie's OKLCH amber-signal palette, Fraunces × Geist × JetBrains Mono triad, the 4 px spacing grid and the 7-step radius scale exposed by `@borjie/design-system`.

---

## 2. The 4 Layers of Anticipatory UX

### Layer 1 — Intent Recognition

Mr. Mwikila reads three concurrent streams:

1. **Chat surface** — what the operator typed / dictated in the last N turns (e.g. "new buyer Jamhuri Mining wants 8 tons gold concentrate next quarter").
2. **Voice + browser perception** — the `audio-capture` and `browser-perception` packages emit semantic events (visit to `/buyers`, mention of an FX threshold, dwell time on a parcel detail).
3. **Background signals** — `tab-need-detector` already aggregates these into Tab Spawn Proposals (`packages/tab-need-detector/src/proposal-emitter.ts`).

The classifier emits a typed `Intent` literal — e.g. `BuyerKYBStart`, `ParcelComplianceReview`, `FXHedgeAdjust`, `TumemadiniDeclaration`. Each Intent is bound to exactly one **Tab Recipe** in the registry. Recognition is conservative: a proposal is only emitted at confidence ≥ 0.7 (already implemented in the detector); below that the system stays silent rather than nag.

### Layer 2 — Dynamic Schema Composition

When the operator accepts a Tab Spawn Proposal, the bound Tab Recipe's `compose(ctx)` function runs server-side and returns a `FormSchema`. The composer is NOT a static template — it consults:

- **The intent** — what the operator wants to accomplish.
- **The corpus** — the regulator pack (Tumemadini KYB requirements, TRA tax-ID format, mining-finance FX risk thresholds, OFAC sanctions vocabulary). Every field added must cite the corpus passage that justified including it; that citation becomes a tooltip the operator can read.
- **The data joins available** — does the buyer already exist in the `buyers` table? Does the parcel have an active permit? Has the operator previously declared this buyer to TRA? Any pre-fillable value goes into `values` so the operator never re-types data Mr. Mwikila already knows.
- **The owner's preference profile** — which fields the owner usually completes personally vs which the owner delegates to ops staff. The composer can mark fields `owner_only`, `ops_default`, or `auto`.
- **The mastery tier** of the current operator (`packages/chat-ui/src/lib/user-mastery/`):
  - **novice** → fewer fields per step, more help copy, more progressive disclosure.
  - **intermediate** → standard density.
  - **expert / power-user** → dense layout, advanced controls unlocked via `MasteryGate`.

Composer output (sketched in §3) is a server-validated `FormSchema` JSON. The LLM never edits this; it can only pick which Tab Recipe to invoke. This is the same anti-pattern enforcement as `PrefillForm` already does (server-supplied `schemaJson`, see `packages/genui/src/components/PrefillForm.tsx`).

### Layer 3 — Brand-Locked Rendering

The `FormSchema` is handed to `AdaptiveRenderer` (`packages/genui/src/AdaptiveRenderer.tsx`) which dispatches each ordered group to the existing primitive that fits — `prefill-form`, `multistep-wizard`, `approval`, `signature-pad`, `file-preview`, `evidence-card`. Crucially, the renderer enforces **brand-only rendering**:

- Every color reference resolves to a `@borjie/design-system` HSL/OKLCH token (`--signal-500`, `--neutral-400`, `--surface-raised`, …). No raw hex, no `rgb(…)`, no named CSS colors.
- Typography is restricted to the three brand families: `var(--font-display)` (Fraunces), `var(--font-sans)` (Geist), `var(--font-mono)` (JetBrains Mono).
- Spacing must use the Tailwind scale (`gap-2`, `gap-4`, …). Arbitrary values (`gap-[17px]`) are rejected.
- Radii must come from the 7-step token set (`--radius-sm` … `--radius-2xl`).
- Shadows must come from the one-light-source scale (`--shadow-xs` … `--shadow-xl`).
- The signature amber glow utility (`.glow-signal` / `.glow-signal-strong` in `apps/marketing/src/app/globals.css` and design-system globals) is the only ambient accent permitted on hero surfaces. No rainbow gradient orbs, no decorative house icons.
- The Mr. Mwikila persona overlay (the wordmark, the warm-paper / midnight-ledger frame, the signature amber signal) is rendered on every dynamically composed tab. This is the "constantly branding on the tab dynamic UIs" requirement.

Enforcement is mechanical, not aspirational. A custom ESLint rule **`borjie/no-non-token-style`** (Phase 2 deliverable) rejects:

- inline `style=` attributes with raw color / spacing literals,
- `className` strings containing raw hex (`#[0-9a-f]{3,8}`),
- Tailwind arbitrary values for color / spacing / radius / shadow.

The genui-level brand validator runs the same checks at runtime on incoming UiPart payloads; violators route to `UnknownKindCard(malformed: true)`. (The dispatcher already has the `schema-validation-failed` fallback path — Layer 3 enforcement reuses the same hook.)

### Layer 4 — Continuous UX Optimization

Every rendered form emits telemetry events through the existing `genui:*` CustomEvent bus. A new event family carries:

- `kind` — `focus | blur | change | error | tooltip_hit | abandon | submit`.
- `tab_recipe_id`, `tab_recipe_version`, `field_id`, `session_id`, `tenant_id`.
- `payload` — duration on field, validation error code, value-was-changed flag.

A new worker `services/ui-evolution-worker` (Phase 2) consumes the event stream from `ui_telemetry_events` (DDL below), aggregates per (`tab_recipe_id`, `version`, `field_id`) on a 14-day rolling window, and computes a fitness score. Two outcomes possible:

- **Lock signal.** Recipe is performing across thresholds → mark version as a lock candidate; after 30 days at lock-candidate, lock the schema and stop variant testing.
- **Improve signal.** A field is bleeding completion → generate a variant proposal: reorder, regroup, split a step, add help copy citing the corpus passage that justifies the field. Land the proposal in `ui_evolution_proposals` with status `pending`.

The proposal is **never auto-rolled-out above Tier 0**. The owner sees it in the owner-portal Anticipatory UX review panel (Phase 2). The owner approves or rejects, with the reasoning citations visible inline.

---

## 3. The Tab Recipe contract

```typescript
interface TabRecipe {
  readonly id: string;                   // 'buyer_kyb_start'
  readonly intent: string;               // 'BuyerKYBStart'
  readonly version: number;              // monotonically increasing
  readonly status:
    | 'draft'
    | 'shadow'   // rendering in shadow alongside the live version
    | 'live'
    | 'locked'   // frozen — no variant testing
    | 'deprecated';
  readonly compose: (ctx: TabComposeContext) => Promise<FormSchema>;
  readonly telemetry_key: string;        // namespace for ui_telemetry_events
  readonly brand: 'borjie';              // forced literal — no escape
  readonly authority_tier: 0 | 1 | 2;    // see §5 for tier semantics
}

interface TabComposeContext {
  readonly tenantId: string;
  readonly operator: {
    readonly userId: string;
    readonly masteryLevel:
      | 'novice'
      | 'intermediate'
      | 'expert'
      | 'power-user';
  };
  readonly corpus: CorpusAccessor;       // regulator pack + internal SLAs
  readonly joins: DataJoinAccessor;      // typed read-side: buyer, parcel, …
  readonly ownerPreferences: OwnerPreferenceProfile;
  readonly locale: 'en' | 'sw';
}

interface FormSchema {
  readonly title_en: string;
  readonly title_sw: string;
  readonly groups: ReadonlyArray<FieldGroup>;
  readonly submit_action: ActionRef;     // /api/gateway/forms/<form-id> — matches PrefillForm contract
  readonly evidence_ids: ReadonlyArray<string>; // corpus citations for WHY each field is here
}

interface FieldGroup {
  readonly id: string;
  readonly title_en: string;
  readonly title_sw: string;
  readonly fields: ReadonlyArray<FieldSpec>;
  readonly visibility?: 'always' | 'gated_expert' | 'gated_power_user';
}

interface FieldSpec {
  readonly key: string;
  readonly label_en: string;
  readonly label_sw: string;
  readonly help_en?: string;             // tooltip text
  readonly help_sw?: string;
  readonly citation_id?: string;         // → corpus passage justifying inclusion
  readonly type: 'text' | 'number' | 'select' | 'date' | 'currency' | 'file' | 'signature';
  readonly required: boolean;
  readonly prefill?: unknown;            // pre-filled from joins
  readonly owner_only?: boolean;
  readonly validation?: ValidationRule;
}
```

The composer function signature deliberately mirrors `PrefillFormPartSchema.schemaJson` so a `FormSchema` can be projected down to the existing `prefill-form` UiPart with no AdaptiveRenderer changes. Multi-step recipes project to `multistep-wizard`.

---

## 4. Lock-vs-Improve Policy

The worker decides per (`tab_recipe_id`, `version`) on a 14-day rolling window.

| Signal                                                   | Threshold              | Outcome                |
|----------------------------------------------------------|------------------------|------------------------|
| 14-day rolling completion rate                           | > 80 %                 | Lock candidate         |
| Per-field error rate (validation_error / focus)          | < 5 %                  | Lock candidate         |
| Per-field abandonment hotspot (blur-without-submit)      | < 10 % per field       | Lock candidate         |
| All three above met continuously for 30 days             | yes                    | **LOCK**               |
| 14-day rolling completion rate                           | < 50 %                 | Improve candidate      |
| Any single field with error rate                         | > 15 %                 | Improve candidate      |
| Any single field with tooltip-hit rate                   | > 40 % of field views  | Improve candidate (operators don't understand the field) |
| Improvement proposal pending owner review                | yes                    | Render in shadow mode  |
| Owner approves proposal                                  | yes                    | Promote to live (version bump) |
| Owner rejects proposal                                   | yes                    | Discard, log to `audit_hash_chain` |
| Owner does not review proposal in 14 days                | yes                    | Expire, log, retry next aggregation cycle |

Locked recipes are immutable. To change a locked recipe the owner must explicitly UNLOCK from the same surface, which is itself an approval-gated action.

---

## 5. Human-in-the-Loop Approval Flow

The Anticipatory UX has three **authority tiers**:

- **Tier 0** — Mr. Mwikila MAY change copy and ordering within a single field group without owner approval. He logs the change to `ui_evolution_proposals` with `status='auto_applied_tier_0'`. The owner sees the change in the audit log but doesn't need to approve.
- **Tier 1** — Adding / removing a field, regrouping fields across steps, splitting / merging steps. Owner approval required.
- **Tier 2** — Changing the submit action (where the form posts to), changing the brand surface treatment (e.g. promoting an evidence card from secondary to primary), changing required vs optional. Owner approval AND a second authoriser (managing partner) required.

**Owner review surface (Phase 2, in `apps/owner-web`):**

1. Banner: _"Mr. Mwikila proposes a UI improvement for the Buyer KYB tab."_
2. Click reveals a **diff view** (uses existing `diff-view` UiPart primitive in `packages/genui/src/components/DiffView.tsx`):
   - **Before:** the current schema (rendered in shadow).
   - **After:** the proposed schema (rendered in shadow).
   - **Why:** the corpus citations + the triggering telemetry signals ("field `tin_number` has 24 % abandonment; proposing to move to step 2 and add help copy citing **Tumemadini Reg. 4.2**").
3. **Approve** → version bump + rollout strategy chooser (`gradual` 10 % → 50 % → 100 % over 7 days, `a_b` 50/50, or `full`). Approval is signed by the owner's WebAuthn / passkey credential and chained into `audit_hash_chain`.
4. **Reject** → discarded with a free-text reason which feeds back into the next aggregation cycle so the worker doesn't propose the same change twice.
5. **Snooze** → defer 7 days, then re-surface.

Every approve / reject / snooze writes an `approval_audit_hash` linking the decision to the immutable audit-hash chain. This is how the operator + the regulator can independently verify "yes, this UI version went live because the owner signed off at this timestamp."

---

## 6. Brand DNA Enforcement (mechanical)

1. **Token-only validation at the genui boundary.** A new validator `validateBrandTokens(uiPart)` runs before dispatch. It walks the payload and asserts every string field that could carry a style (any `className`, any `style`, any `theme`, any `color`) matches the allowlist regex:
   - `className`: `^[a-z0-9-_/:\[\]]+$` and no token in the string may resolve to a non-design-system class (a lookup against the Tailwind layer's known utilities + design-system token aliases).
   - `style` (inline object): every value must be `'transparent' | 'currentColor' | 'inherit'` OR a `hsl(var(--…))` expression OR a `var(--…)` reference. Raw hex / rgb / hsl-literal rejected.
2. **ESLint rule `borjie/no-non-token-style`.** Static check at edit time, on `packages/genui/src/**` and `packages/chat-ui/src/**` and every app surface that renders UiParts. Rules:
   - No `style={{ color: '#…' }}` literals.
   - No `className` containing `bg-[#…]`, `text-[#…]`, `border-[#…]`.
   - No `gap-[…]`, `p-[…]`, `rounded-[…]`, `shadow-[…]` arbitrary values.
   - No font-family string outside the three brand families.
3. **Brand-violation log.** Anything that slips past both layers (e.g. a raw color literal added in a hot-fix) is captured in `brand_lint_violations` (DDL below) when CI sweeps the repo nightly. Mr. Mwikila surfaces violation summaries in the owner-portal weekly digest.

The mandatory persona overlay rendered on every dynamic tab:

- Header strip with the Mr. Mwikila wordmark (`packages/design-system/src/brand/`).
- Signature amber signal accent on the primary CTA (`bg-signal-500 text-primary-foreground`).
- Warm-paper background in light mode, midnight-ledger near-black in dark mode (already in design-system tokens).
- The kicker line above the tab title uses `font-mono` to telegraph "operator surface, not marketing."

---

## 7. Anti-patterns (the Anticipatory UX MUST NOT)

1. **Silently mutate UI** at Tier 1 or Tier 2 in front of the owner. Auto-apply is restricted to Tier 0 ordering / copy tweaks; everything else is owner-gated.
2. **Compose a form that asks for data already in the corpus or joins.** If the operator already declared the buyer's TIN to TRA, the composer pre-fills `tin_number` and disables it (with a "edit" affordance for corrections); it does not ask the operator to retype.
3. **Render anything off-brand.** No raw HTML, no inline styles with literals, no off-palette colors, no non-design-system primitives. The renderer will fail closed.
4. **Optimize for a metric that hurts the operator's outcome.** Shortening a form by dropping a required regulatory field is not an improvement — it's a compliance violation. Required-field changes require a Tier-2 approval AND a compliance-pack re-validation (the `compliance-pack` package owns the regulator vocabulary).
5. **Propose a UI change without citing why.** Every proposal must carry corpus IDs + telemetry signals. Owner cannot approve a proposal that doesn't justify itself.
6. **Render the same Tab Recipe twice in one session** with conflicting schemas (live + shadow simultaneously visible). Shadow mode is invisible to the operator until promoted.
7. **Leak operator personal data into telemetry.** `ui_telemetry_events.payload` is scrubbed of field values; only field IDs and event kinds are recorded.

---

## 8. Phase 2 implementation plan

This spec defines the contract. Phase 2 ships the implementation. Pieces to build:

1. **`packages/dynamic-ui/`** (new package) — Tab Recipe registry, `composeTabV1(intent, ctx)` server-side composer entry, `FormSchema` → UiPart projector, `validateBrandTokens(uiPart)` runtime validator, types per §3.
2. **`services/ui-evolution-worker/`** (new service) — consumes `ui_telemetry_events`, aggregates per recipe/version, applies the §4 policy table, lands proposals in `ui_evolution_proposals`. Cron: daily 02:00 Africa/Nairobi.
3. **`POST /api/v1/ui/propose-evolution`** — only callable by the worker's service account; idempotent on `(tab_recipe_id, version, proposed_at_day)`.
4. **`POST /api/v1/ui/approve-evolution`** — owner-only; requires WebAuthn assertion; writes to `audit_hash_chain` before the recipe version flip.
5. **`POST /api/v1/ui/reject-evolution`** — owner-only; captures free-text reason.
6. **ESLint rule `borjie/no-non-token-style`** — under `eslint-rules/` alongside the existing custom rules.
7. **Brand-token runtime validator at the genui boundary** — extends `AdaptiveRenderer`'s pre-dispatch path.
8. **Owner-portal Anticipatory UX review panel** — new route in `apps/owner-web` rendering proposal diffs.
9. **Persona system-prompt addition** — Mr. Mwikila gains a built-in tool `compose_tab_v1(intent, context) → tab_recipe_id` in `packages/central-intelligence/.../tools/` so the brain can request a dynamic tab without inventing UI.
10. **Database migrations** — see §9 schema additions.

---

## 9. Schema additions

DDL sketches. No migration files generated in this wave — they land with Phase 2.

```sql
-- Tab recipes (versioned). Every (id, version) is immutable once published.
CREATE TABLE tab_recipes (
  id text NOT NULL,                          -- e.g. 'buyer_kyb_start'
  version int NOT NULL,
  status text NOT NULL,                      -- draft|shadow|live|locked|deprecated
  intent text NOT NULL,
  compose_fn_ref text NOT NULL,              -- path to the composer function module
  authority_tier smallint NOT NULL,          -- 0|1|2 per §5
  brand text NOT NULL DEFAULT 'borjie',
  promoted_at timestamptz,
  promoted_by uuid REFERENCES users(id),
  locked_at timestamptz,
  PRIMARY KEY (id, version),
  CHECK (brand = 'borjie'),
  CHECK (authority_tier IN (0,1,2))
);

-- Telemetry per rendered instance — append-only.
CREATE TABLE ui_telemetry_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  tab_recipe_id text NOT NULL,
  tab_recipe_version int NOT NULL,
  session_id uuid,
  field_id text,                             -- NULL for tab-level events
  event_kind text NOT NULL,                  -- focus|blur|change|error|tooltip_hit|abandon|submit
  payload jsonb,                             -- scrubbed of field values
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ui_telemetry_recipe_idx
  ON ui_telemetry_events (tab_recipe_id, tab_recipe_version, recorded_at);

-- Evolution proposals — owner-facing approval queue.
CREATE TABLE ui_evolution_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  tab_recipe_id text NOT NULL,
  current_version int NOT NULL,
  proposed_version int NOT NULL,
  proposed_schema_diff jsonb NOT NULL,       -- structured diff payload
  signals jsonb NOT NULL,                    -- which telemetry signals triggered this
  citations text[] NOT NULL,                 -- corpus refs for the reasoning
  status text NOT NULL DEFAULT 'pending',    -- pending|approved|rejected|expired|auto_applied_tier_0
  proposed_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES users(id),
  reviewer_reason text,
  rollout_strategy text,                     -- 'gradual'|'full'|'a_b'
  approval_audit_hash text                   -- linked to audit-hash-chain
);

-- Brand violation log — populated by the nightly CI sweep + the runtime validator.
CREATE TABLE brand_lint_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_path text NOT NULL,
  line_no int NOT NULL,
  rule text NOT NULL,                        -- 'raw-color'|'inline-style'|'arbitrary-spacing'|'non-brand-font'
  snippet text NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now()
);
```

Row-level security follows the existing tenant-isolation policy: every table above has `tenant_id` (where applicable) wired into `auth.tenant_id()` RLS predicates. `tab_recipes` is global (no tenant scope) because the recipes are product-wide. `ui_evolution_proposals` is tenant-scoped because the owner reviews per-tenant.

---

## 10. Delta needed in existing packages

Phase 2 will need (read-only audit confirms these are minimal):

- **`packages/genui/src/AdaptiveRenderer.tsx`** — add a pre-dispatch hook `validateBrandTokens(uiPart)` after the existing `PART_SCHEMAS[kind].safeParse` check. Same UnknownKindCard fallback shape.
- **`packages/genui/src/components/PrefillForm.tsx`** — add a `citationId` per field in the schema-rendering loop (tooltip surface). Backward-compatible: existing payloads without citations still render.
- **`packages/genui/src/components/MultistepWizard.tsx`** — same `citationId` per field, plus a per-step "Why this step?" affordance that opens the corpus citation.
- **`packages/chat-ui/src/components/NeedSpawnBanner.tsx`** — emit a `genui:tab-spawn-accept` event with the Tab Recipe ID so the composer can invoke synchronously. (Phase 2 adds a `targetRecipeId?: string` field to `TabSpawnProposal`.)
- **`packages/design-system/src/styles/globals.css`** — no changes; tokens are already correct.
- **`packages/dynamic-sections/`** — read-only audit confirms this is the right home for the Tab Recipe renderer; the new `packages/dynamic-ui/` will depend on it, not duplicate it.

No mutation to `services/api-gateway/src/routes/` in this spec; new routes (`/api/v1/ui/*`) are net-additions and ship in the Phase 2 wave.

---

## 11. Out of scope for this spec

- The actual composer implementations for each Tab Recipe (Phase 2+).
- The owner-portal review panel UX (Phase 2 design pass).
- The voice surface for owner approvals (future).
- Multi-locale rollout beyond `en` / `sw` (future).
- Cross-tenant Tab Recipe sharing (future — orthogonal to the Anticipatory UX vision).
