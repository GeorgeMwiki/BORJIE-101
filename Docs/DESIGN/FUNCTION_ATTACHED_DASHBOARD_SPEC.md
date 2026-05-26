# FUNCTION_ATTACHED_DASHBOARD_SPEC — Function carries its UI; UI is ephemeral

> Operative design spec for the ephemeral-software runtime.
> Companion to `Docs/STRATEGY/EPHEMERAL_SOFTWARE_SOTA.md`.
> Implementation package: `packages/ephemeral-ui/`.
> Persona owner: Mr. Mwikila.

This spec codifies the contract by which every domain function in Borjie can
generate its own dashboard on demand, render it briefly, discard it by default,
and learn its way into a persistent recipe only when operators *demonstrate* the
pattern is worth keeping. It is the *how* to the strategy doc's *why*.

The spec is binding for any function that wants to be invokable from Mr. Mwikila's
runtime with a generated UI. Functions without manifests still work — they return
data through the chat surface — but they cannot host an ephemeral dashboard.

---

## 1. The contract — `FunctionUIManifest`

Every domain function — whether in `services/domain-services/`, in a
`packages/*-advisor/` package, behind an `apps/api-gateway` route, or as the
report-output of a background worker — declares a `FunctionUIManifest`:

```typescript
export interface FunctionUIManifest {
  /** Stable function identifier — same shape as Wave 18B's intent.kind.
   *  Example: 'project_fx_exposure', 'query_incident_shifts', 'match_buyer_offer'. */
  readonly function_id: string;

  /** Manifest version. Bump when output_shape or allowed_actions change. */
  readonly version: number;

  /** The visual archetype to compose into. Closed set of 11. */
  readonly dashboard_archetype: DashboardArchetype;

  /** What context the composer requires to compose well. */
  readonly required_context: ReadonlyArray<ContextRequirement>;

  /** Zod schema for the function's output shape. The composer reads the
   *  output through this schema; unknown fields are silently dropped. */
  readonly output_shape: ZodSchema;

  /** Suggested visual treatment. Composer respects or overrides per context. */
  readonly ui_hints: UIHints;

  /** Authority tier of any submit actions this UI may expose. Tier-0 inline;
   *  Tier-1 routes through ApprovalGate; Tier-2 routes through ApprovalGate
   *  + second authoriser per Wave 18S. */
  readonly authority_tier: 0 | 1 | 2;

  /** True for one-off read-only patterns. False for high-reuse functions
   *  (mutating commits, scheduled reports) that should default to persistent. */
  readonly ephemeral_by_default: boolean;

  /** Cache TTL in seconds. 0 = never cache; >0 = cache for this window
   *  inside the session. Invalidated automatically on user_context change. */
  readonly cache_ttl_seconds: number;

  /** Optional. Only these actions may appear as wired submit affordances.
   *  Any generated button without a declared backing is rejected at compose. */
  readonly allowed_actions?: ReadonlyArray<ActionDescriptor>;
}

export type DashboardArchetype =
  | 'list_with_filters'
  | 'chart_with_table'
  | 'map_with_overlays'
  | 'kpi_grid'
  | 'pipeline_kanban'
  | 'calendar_timeline'
  | 'document_render'
  | 'split_compare'
  | 'wizard_form'
  | 'detail_with_chain'  // entity profile chain (uses Wave 18U)
  | 'composite';         // multi-archetype mashup

export interface UIHints {
  readonly preferred_size: 'inline' | 'tab' | 'fullscreen' | 'modal';
  /** OKLCH token refs from @borjie/brand. Raw hex/rgb is rejected. */
  readonly preferred_colors: ReadonlyArray<string>;
  readonly preferred_layout: 'cards' | 'table' | 'split' | 'tabs';
  readonly emphasis: 'data_density' | 'narrative' | 'actionable';
  readonly mobile_strategy: 'reflow' | 'stack' | 'simplify' | 'hide_secondary';
}

export interface ContextRequirement {
  readonly kind:
    | 'scope'          // Wave 18Y org-scope hierarchy
    | 'recent_turns'   // Wave 18T conversation threads
    | 'memory_recall'  // Wave 18AA cognitive memory
    | 'brand_dna'      // Wave 18K brand tokens
    | 'mastery_tier'   // user-mastery, novice|intermediate|expert|power-user
    | 'locale';        // 'en' | 'sw'
  readonly required: boolean;  // false = use sensible default when missing
}

export interface ActionDescriptor {
  readonly action_id: string;
  readonly authority_tier: 0 | 1 | 2;
  readonly label: { readonly en: string; readonly sw: string };
}
```

Every field is `readonly`. The manifest is frozen at module-load time and
hash-pinned into the audit trail (Section 10).

---

## 2. The composer — `composeDashboardForFunction`

The composer is a pure function with one signature:

```typescript
export async function composeDashboardForFunction(
  manifest: FunctionUIManifest,
  function_output: unknown,           // validated through manifest.output_shape
  user_context: UserContext,
): Promise<TabRecipe>;                // the existing Wave 18B contract
```

It does five things in order:

1. **Validate** `function_output` against `manifest.output_shape`. Reject on
   schema mismatch — no fallback presentation.
2. **Recall** the cognitive-memory (Wave 18AA) for any prior recipe shapes
   bound to `(manifest.function_id, manifest.dashboard_archetype,
   user_context.scope_id)` with engagement signals. Prefer shapes the same
   operator reacted positively to.
3. **Compose** a candidate `TabRecipe` by selecting an archetype-renderer
   (Section 4) keyed off `manifest.dashboard_archetype`, threading the
   function output and the brand tokens through it.
4. **Brand-lock-pass** the candidate (Section 5). Reject + regenerate on
   violation. Three retries; then hard fail with a structured error.
5. **Hash + return** the TabRecipe. The hash is the *recipe fingerprint*
   used by the reuse counter; it is computed deterministically from the
   recipe's structural shape (archetype, ordered UiPart kinds, action ids)
   so that *cosmetically different / structurally identical* recipes share
   a hash.

The TabRecipe emitted is a fully-valid Wave 18B recipe — same `brand: 'borjie'`
literal, same `authority_tier`, same `compose` shape. The existing dynamic-ui
rail renders it. The composer adds nothing new to the renderer; it only adds a
new *source* of recipes.

---

## 3. The lifecycle

```
Function invoked ──► output produced ──► composeDashboardForFunction
                                              │
                                              ▼
                                     ephemeral TabRecipe
                                              │
                                              ▼
                                          rendered
                                              │
                                              ▼
                                       user interacts
                                              │
                                       (telemetry row)
                                              │
                                              ▼
                                       user closes tab
                                              │
                                              ▼
                                         DISCARD
                                              │
                                  (on reuse-threshold hit)
                                              │
                                              ▼
                                  promote to LEARNED TabRecipe
                                  in registry (Wave 17B/18B)
                                  → enters lock/improve cycle (18F)
```

Five stages: **compose → render → telemetry → discard | promote**.

Discard is the default terminal. Promotion is the conditional terminal triggered
by the promotion-decider (Section 7).

---

## 4. Context propagation

`user_context` is the composer's primary lever. It carries six dimensions, each
of which can change the generated UI:

| Dimension | Source wave | Effect on generation |
|-----------|-------------|----------------------|
| `scope_id`, `scope_kind` | Wave 18Y org-scope | Selects tenant brand tokens, tenant-customised copy, tenant-only memory recall. |
| `recent_turns` | Wave 18T conversation threads | Lets composer choose narrative vs data-density emphasis based on whether operator just asked 3 follow-ups (narrative) or jumped from a different topic (data-density). |
| `memory_recall` | Wave 18AA cognitive memory | Anchors archetype + emphasis to prior high-engagement shapes for this `(function_id, scope_id)`. |
| `brand_dna` | Wave 18K brand-lock | OKLCH token set, type stack, motion preset. |
| `mastery_tier` | chat-ui user-mastery module | `novice` → simplified copy, fewer affordances; `power-user` → dense + keyboard shortcuts surfaced. |
| `locale` | session | `en` vs `sw` strings; mirrors Mr. Mwikila's bilingual contract. |

Every dimension is included in the `user_context_hash` that participates in the
cache key. A change in any dimension invalidates the cache.

---

## 5. Brand-lock enforcement

Every candidate recipe passes through `brand-lock-pass.ts` before being
returned. The pass:

1. Recursively walks the recipe's `field_groups[*].fields[*]` and any
   styling carried in `ui_hints.preferred_colors`.
2. Runs the same matchers the `borjie/no-non-token-style` ESLint rule uses
   (Wave 18K) — rejecting any non-token color, non-token spacing token, or
   raw hex/rgb/hsl literal.
3. On rejection: emits a structured error
   `BrandLockViolation { offenders: ReadonlyArray<string> }`.

The composer catches `BrandLockViolation`, re-runs composition with the
`BorjieBrandConstraint` (a stricter prompt for any LLM-assisted step + a
narrower archetype-renderer mode that uses only pre-bound token references),
up to three times. On the fourth try, it throws — the request fails loudly.

The pass is the runtime mirror of the CI rule. The CI rule prevents off-brand
code from being merged. The pass prevents off-brand UI from being rendered.
Together they form the closed brand-lock loop.

---

## 6. Cache strategy

| `cache_ttl_seconds` | Behaviour |
|---|---|
| `0` | Never cache; always regenerate from fresh function output + fresh context. |
| `300` (default for `ephemeral_by_default = true`) | Cache for 5 minutes inside the session. Invalidated on any change to `user_context_hash` (scope, recent turns, memory recall, brand DNA, mastery, locale). |
| `3600` (default for `ephemeral_by_default = false`) | Cache for 1 hour across sessions. Invalidated on context change and on `function_input_hash` change. |
| `> 3600` | Allowed but discouraged. Anything > 86400 (1 day) requires an explicit override flag (`cache_ttl_override: true`) on the manifest. |

Cache key: `sha256(function_id ‖ manifest.version ‖ function_input_hash ‖
user_context_hash ‖ brand_tokens_version)`. Implementation lives in
`packages/ephemeral-ui/src/lifecycle/cache-policy.ts`. No durable storage —
in-memory LRU per process, evicted by TTL or capacity (8K entries).

---

## 7. Persistence promotion

The promotion decider lifts an ephemeral pattern to a static `TabRecipe` in
the registry when **both** thresholds are met:

- **Reuse count for the same `generated_recipe_hash` ≥ 10**
- **Distinct user count for the same `generated_recipe_hash` ≥ 3**

Both numbers are tenant-scoped. Cross-tenant promotion only happens through
Wave 18AA's federation pathway (PII-stripped, promoter is sole writer).

On promotion:

1. The composer crystallises the most recently composed recipe of that
   shape into a frozen `TabRecipe` (with a stable `id =
   ${function_id}-${dashboard_archetype}-${scope_label}-promoted-${date}`).
2. The recipe is inserted into the registry with `status = 'shadow'`.
3. Wave 18F's lock/improve cycle takes over.
4. The `ephemeral_dashboard_telemetry` row is updated with
   `was_promoted = true` and `promotion_recipe_id`.

Promotion never blocks the next composition. The promoted recipe is
loaded-by-default *next* time the same `(function_id, archetype, scope)`
context is seen; the ephemeral path is the fallback.

---

## 8. Anti-patterns

1. **Pre-generating UIs that were not requested.** A composer that
   speculatively renders dashboards "in case the operator asks" is wasted
   inference + a stale-UI risk. Composition is request-driven only.
2. **Caching beyond context-change boundaries.** A `cache_ttl_seconds = 86400`
   that ignores `user_context_hash` produces stale UIs. The cache key
   *must* include `user_context_hash`.
3. **Skipping the brand-lock pass.** Any code path that emits a TabRecipe
   without running `brand-lock-pass.ts` is forbidden. Lint rule
   `borjie/ephemeral-ui-requires-brand-lock` enforces.
4. **Persisting ephemeral UIs to long-term storage.** Only telemetry
   persists. The TabRecipe itself lives in process memory + the LRU cache.
   Writing TabRecipes to a durable table is forbidden outside the
   promotion path.
5. **Regenerating without consulting cognitive-memory recall.** A composer
   that re-derives from scratch when it could have anchored on a prior
   high-engagement shape is unstable. Recall is *not* an option — it is a
   `required_context` entry on every read-shaped manifest by default.
6. **Hallucinated affordances.** A button labelled "Submit hedge order"
   that does not map to a declared `allowed_actions` entry is rejected at
   compose time. The composer cannot invent actions.
7. **Manifest sprawl.** Every public function should declare *at most one*
   manifest. Variants per scope/mastery/locale are the composer's job, not
   the manifest author's. If you find yourself writing two manifests for
   one function, generalise the manifest instead.

---

## 9. Retrofit map

Every existing function that returns data should eventually declare a
`FunctionUIManifest`. Rollout per package, in this order:

### Phase 2.1 — Domain advisors (small effort per package, high payoff)

- `packages/mining-shift-planner/` — `plan_shift`, `query_shift_history`,
  `compute_shift_throughput`.
- `packages/geology-advisor/` — `compute_ore_grade`,
  `survey_drillhole_summary`.
- `packages/fx-treasury-advisor/` — `project_fx_exposure`,
  `recommend_hedge_strategy`.
- `packages/capacity-expansion-advisor/` — `analyse_capex_options`.
- `packages/cost-engineer-advisor/` — `compute_unit_cost`,
  `flag_cost_anomalies`.
- `packages/buyer-marketplace-advisor/` — `match_buyer_offer`,
  `query_buyer_offers`.

### Phase 2.2 — `apps/api-gateway` routes (medium)

- Every read-shaped REST/GraphQL endpoint that returns a list, a record,
  or a summary should host a manifest. The gateway exposes a tiny adapter
  that calls `composeDashboardForFunction` when the request's `Accept`
  header is `application/vnd.borjie.tab-recipe+json`.

### Phase 2.3 — Background workers (small, but slower because schedule-driven)

- Scheduled jobs that produce a report (daily safety summary, weekly
  buyer match digest, monthly compliance roll-up) declare manifests so
  the resulting report can be composed into a dashboard the moment the
  recipient opens it — generated from the worker's output, fresh.

### Phase 2.4 — Background mutating commits (deliberately later)

- Mutating functions (`commit_hedge_order`, `submit_tumemadini_return`)
  declare manifests too — but with `ephemeral_by_default = false`,
  `authority_tier ≥ 1`, and the resulting UI is a confirmation surface,
  not a query result.

---

## 10. Schema additions

Only one new durable table — `ephemeral_dashboard_telemetry`. Everything
else lives in process memory + the LRU cache. The table is the audit + the
promotion-decider's source of truth.

Migration file: next available number. Sibling agents have added several
recent migrations (most recently 0029); this migration ships as **0030**.

```sql
-- 0030_ephemeral_dashboard.sql
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS ephemeral_dashboard_telemetry (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                       text NOT NULL,
  function_id                     text NOT NULL,
  manifest_version                int NOT NULL,
  generated_recipe_hash           text NOT NULL,
  user_id                         text NOT NULL,
  session_id                      uuid NOT NULL,
  scope_kind                      text,
  scope_id                        text,
  user_context_hash               text NOT NULL,
  generated_at                    timestamptz NOT NULL DEFAULT now(),
  closed_at                       timestamptz,
  reuse_count_for_this_pattern    int NOT NULL DEFAULT 0,
  distinct_user_count_for_pattern int NOT NULL DEFAULT 0,
  was_promoted                    boolean NOT NULL DEFAULT false,
  promotion_recipe_id             text,
  audit_hash                      text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_edt_function_recent
  ON ephemeral_dashboard_telemetry (function_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_edt_pattern_reuse
  ON ephemeral_dashboard_telemetry (
    generated_recipe_hash,
    reuse_count_for_this_pattern DESC
  );

CREATE INDEX IF NOT EXISTS idx_edt_tenant_scope
  ON ephemeral_dashboard_telemetry (tenant_id, scope_id);

ALTER TABLE ephemeral_dashboard_telemetry ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'ephemeral_dashboard_telemetry'
      AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON ephemeral_dashboard_telemetry
      USING (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END;
$$;

COMMIT;
```

Drizzle schema sibling: `packages/database/src/schemas/
ephemeral-dashboard-telemetry.schema.ts`, exported through the schemas
barrel.

Retention policy: 90 days TTL by default. The cron service (Wave 18EE on-
demand internal software) handles eviction. Promoted patterns keep their
last-promotion telemetry row indefinitely (referenced by
`promotion_recipe_id`).

---

## 11. Audit-hash integration

Every composition writes one audit-chain entry via `@borjie/audit-hash-chain`:

```typescript
{
  kind: 'ephemeral_dashboard_compose',
  payload: {
    function_id,
    manifest_version,
    function_input_hash,
    function_output_hash,
    user_context_hash,
    generated_recipe_hash,
    composer_version,
    user_id, session_id,
    tenant_id, scope_kind, scope_id,
    timestamp,
  },
}
```

This is the *replay key*. Given an audit row, an engineer can deterministically
regenerate the exact same TabRecipe (assuming the function and composer
versions are pinned). Debugging an ephemeral UI is therefore a `git checkout
<composer_version> && replay <audit_row_id>` away.

---

## 12. Failure modes

| Mode | Composer behaviour |
|------|--------------------|
| `function_output` fails `output_shape` validation | Throw `ManifestSchemaMismatch`. Operator sees a chat-only response with the function's raw answer + an error toast: *"Mr. Mwikila could not compose a dashboard — function output did not match its declared shape."* |
| Brand-lock pass fails 3× | Throw `BrandLockExhausted`. Operator sees the chat-only response. Telemetry row records `was_brand_lock_failure = true` (optional column in Phase 3+). |
| Cognitive-memory recall times out (>250ms) | Composer proceeds without recall. Telemetry row records `recall_used = false`. No user-visible error. |
| `allowed_actions` declared but recipe attempts unwired action | Reject at compose; operator sees chat-only answer + structured error. |
| Cache hit on stale `user_context_hash` | Impossible by construction — `user_context_hash` is in the cache key. |
| Composer model unavailable (provider outage) | Compose with a deterministic fallback renderer that emits a minimal `kpi_grid` of the function's top-level fields. Mark `compose_fallback = true` in telemetry. Brand-lock still applies. |

Every failure mode degrades gracefully to "chat-only answer with raw function
output". The operator is never blocked.

---

## 13. Acceptance criteria for Phase 1 (`packages/ephemeral-ui/` ships)

A function shipping Phase 1 must:

- [ ] Declare a `FunctionUIManifest` registered via
  `registerFunctionUIManifest(manifest)` at module load.
- [ ] Pass `validateFunctionUIManifest(manifest)` (Zod-backed).
- [ ] Be invoked exclusively through `composeDashboardForFunction` —
  direct rendering of the function's output to UiParts is forbidden.
- [ ] Have at least one unit test composing the function's output into a
  `TabRecipe` and asserting the recipe's archetype + brand-locked styling.
- [ ] Emit exactly one `ephemeral_dashboard_telemetry` row per composition.
- [ ] Emit exactly one audit-chain entry per composition.

The package's own Phase 1 milestone is the contract above, the composer
skeleton, three archetype renderers (`list_with_filters`,
`chart_with_table`, `kpi_grid`), and the lifecycle controller — with ≥70%
test coverage.

---

## 14. Observability

Three OTel spans per composition:

1. `ephemeral_ui.compose` — wraps `composeDashboardForFunction`. Attributes:
   `function_id`, `manifest_version`, `cache_hit` (bool), `user_context_hash`,
   `generated_recipe_hash`, `brand_lock_retries`, `compose_fallback`.
2. `ephemeral_ui.brand_lock` — wraps the brand-lock pass. Attribute:
   `violation_count`.
3. `ephemeral_ui.recall` — wraps cognitive-memory recall. Attribute:
   `recall_used`, `recall_anchored_shape_hash`.

Metrics: composition counter, p50/p95/p99 compose latency, brand-lock
retry histogram, cache hit ratio, promotion-event counter, distinct-pattern
counter per tenant.

Dashboard: a generated `kpi_grid` (eating our own dog food) of the above,
auto-composed from the metrics' OTel adapter. Recursion intentional.

---

## 15. Open extensions (Phase 5+)

- **Voice ephemeral UIs.** A spoken answer is an ephemeral UI too;
  `ui_hints.preferred_size = 'voice'` produces a Mr. Mwikila audio recipe
  composed from the same function output. Discardable, regenerable.
- **Multi-archetype compositions.** A `composite` recipe combines two or
  three archetypes (e.g. `kpi_grid` + `map_with_overlays` for a regional
  ops view). Composer must learn when to compose vs split.
- **Cross-tenant federated promotion.** When a generated pattern is
  promoted in 3+ tenants, the Wave 18AA federation promoter lifts it into
  `platform_memory_cells` (PII-stripped) and tags it as a *suggested
  archetype* for any new tenant whose first request matches the shape.
- **Per-archetype mobile renderers.** Each archetype renderer ships a
  desktop and a mobile pass; `mobile_strategy` selects between them at
  compose time.

---

— Mr. Mwikila
