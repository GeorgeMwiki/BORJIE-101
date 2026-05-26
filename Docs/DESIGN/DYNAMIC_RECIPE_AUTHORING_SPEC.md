# Dynamic Recipe Authoring — Design Specification

> Wave: **18M** — LLM-driven dynamic recipe authoring.
> Persona: **Mr. Mwikila** — Borjie's autonomous Managing Director for
> Tanzanian mining operators.
> Companion package: `@borjie/dynamic-recipe-authoring`.
> Companion migration: `0066_dynamic_authored_recipes.sql`.
>
> **Cross-links:**
> [`ANTICIPATORY_UX_SPEC.md`](./ANTICIPATORY_UX_SPEC.md) (Wave 18B —
>   Tab Recipe contract this wave authors against),
> [`DOCUMENT_COMPOSITION_SPEC.md`](./DOCUMENT_COMPOSITION_SPEC.md)
>   (Wave 18C — Document Recipe contract),
> [`CAPABILITY_CATALOGUE_SPEC.md`](./CAPABILITY_CATALOGUE_SPEC.md)
>   (Wave CAPABILITY — lifecycle states reused here),
> [`ON_DEMAND_INTERNAL_SOFTWARE_SPEC.md`](./ON_DEMAND_INTERNAL_SOFTWARE_SPEC.md)
>   (Wave M7-M9 — the closest spec-generation pattern we reuse),
> [`MEDIA_GENERATION_SPEC.md`](./MEDIA_GENERATION_SPEC.md),
> [`MARKETING_PROMOTION_SPEC.md`](./MARKETING_PROMOTION_SPEC.md).

Brand: Borjie. Persona: Mr. Mwikila. Status: design-spec.

---

## 1. Why this exists

Waves 18B and 18C shipped the *closed-set* recipe registries: 2
reference Tab Recipes in `@borjie/dynamic-ui` and 11 Document
Recipes in `@borjie/document-templates`. Both are static — to add
a new tab or a new document class you edit TypeScript, write a
recipe by hand, ship a PR, await review.

This wave removes that limit. When an operator says

> *"I want a tab that shows pit safety KPIs broken by shift"*

…Mr. Mwikila composes a **brand-new Tab Recipe** on demand: an LLM
authors a candidate spec, a zod validator enforces the existing
contract (it must look exactly like a recipe `@borjie/dynamic-ui`
would accept), the lifecycle bridge advances the authored recipe
through `draft → shadow → live`, and a per-tenant repository
persists the spec as the source of truth.

The 2026 landscape this slots into:

- **Anthropic Tools API (Claude Opus 4 / 4.5)** —
  [https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview)
  (Anthropic, *"Tool use with Claude"*, 2024-2026). We adopt the
  same "LLM emits structured JSON conforming to a schema" primitive,
  but lift it from a tool-call to a *recipe spec*: a persisted,
  versioned, lifecycle-governed object the platform can replay.
- **Microsoft Copilot Studio — agent/topic authoring** —
  [https://learn.microsoft.com/en-us/microsoft-copilot-studio/](https://learn.microsoft.com/en-us/microsoft-copilot-studio/)
  (Microsoft, *"Microsoft Copilot Studio documentation"*, 2024-2026).
  Copilot Studio lets non-developers author conversational topics
  through natural language; Borjie lifts that pattern to full
  UI/document/media recipes.
- **Salesforce Agentforce + Flow Builder** —
  [https://www.salesforce.com/agentforce/](https://www.salesforce.com/agentforce/)
  (Salesforce, *"Agentforce"*, 2024-2026). LLM-authored declarative
  flows that map to a strict runtime contract. Borjie's recipes are
  the same idea, but for the four authoring kinds below.
- **Retool AI** —
  [https://retool.com/products/ai](https://retool.com/products/ai)
  (Retool, *"Retool AI"*, 2025-). LLM-assisted internal-tool
  authoring; Retool generates the UI then a human authors the
  handler. Borjie generates the *whole* recipe (UI + handler + audit
  + lifecycle), and binds it to a vertical-platform-native runtime.
- **Vercel v0.app** —
  [https://vercel.com/blog/announcing-v0-generative-ui](https://vercel.com/blog/announcing-v0-generative-ui)
  (Vercel, *"Announcing v0: Generative UI"*, 2024-2026). v0 emits a
  React component; Borjie emits a typed *Tab Recipe* that any
  Borjie-brand renderer can compose.

This wave's distinct contribution is the **bridge**: an LLM-authored
spec is not a UI component, it is a first-class, versioned,
lifecycle-governed Borjie artefact that joins the lock/improve loop
the catalogue and capability-measurement worker already manage.

---

## 2. Recipe kinds the author covers

`RecipeKind` is a discriminated union of five kinds. Each kind maps
to an existing contract elsewhere in the monorepo so the authored
spec drops cleanly into the live runtime.

| `kind`     | Existing contract                                | Wave   |
| ---------- | ------------------------------------------------ | ------ |
| `tab`      | `TabRecipe` in `@borjie/dynamic-ui`              | 18B    |
| `doc`      | `DocumentRecipe` in `@borjie/document-templates` | 18C    |
| `media`    | `MediaRecipe` (Wave 18D companion)               | 18D    |
| `campaign` | `CampaignRecipe` in `@borjie/marketing-brain`    | 18E    |
| `tool`     | `ToolSpec` in `@borjie/internal-software-generator` | M7-M9 |

`tab` and `doc` are the v1 authored kinds. `media`, `campaign`, and
`tool` are scaffolded in the type union and validator now; their
authoring prompts ship in a follow-up wave when their host packages
expose stable JSON contract schemas.

---

## 3. Lifecycle

We reuse the catalogue's five-state machine
(`@borjie/capability-catalogue` Wave CAPABILITY) so the authored
recipes share the same governance plane as every other capability
Mr. Mwikila exercises:

```
   draft  →  shadow  →  live  →  locked
                         │
                         ▼
                    deprecated
```

- **draft** — authored by the LLM, validated, persisted, NOT
  available for end-user use. The owner can review the spec and
  reject it.
- **shadow** — runs in parallel with whatever currently fulfils the
  operator's intent; output is discarded. The capability-
  measurement worker scores it in this phase.
- **live** — serves the operator-facing intent. Promoted from
  `shadow` only after the capability-measurement worker reports
  competence/calibration/utility above thresholds.
- **locked** — promotion paused pending review (a Tier-2 authority
  override).
- **deprecated** — removed from dispatch; historical only.

Allowed transitions are enforced by `lifecycle/lifecycle-bridge.ts`
and mirror the catalogue's `LIFECYCLE_STATES` ordering: linear
forward only, plus a `live → deprecated` exit. `locked` is reachable
from any forward state and can return to `live` (re-approval).

---

## 4. Authoring pipeline

The author orchestrator (`author/recipe-author.ts`) is a pure
dependency-injected function. It takes:

```
RecipeAuthorRequest {
  tenantId, kind, intentUtterance, desiredName?, authoredBy
}
RecipeAuthorDeps {
  llm: LlmAuthorPort,        // injected — Anthropic or stub
  validator: RecipeValidator,
  lifecycle: LifecycleBridge,
  repository: AuthoredRecipeRepository,
  now?: () => Date,
}
→ Promise<RecipeAuthorResult>
```

Five steps:

1. **Prompt selection** — pick the kind-specific template from
   `prompts/<kind>-recipe-prompt.ts`. The prompt embeds the existing
   contract (zod schema fields + invariants) so the LLM authors
   inside the contract, not against it.
2. **LLM call** — via the injected port. Tests inject a deterministic
   stub; production binds the Anthropic SDK.
3. **Validation** — pass the LLM's JSON output through
   `validator/recipe-validator.ts`. Errors are accumulated, not
   short-circuited. A failed validation rejects the authoring
   request (no partial persistence).
4. **Persistence** — persist to `dynamic_authored_recipes` as
   `draft` with prev_hash + audit_hash so the chain is verifiable.
5. **Lifecycle bridge** — return a `RecipeAuthorResult` carrying
   the persisted row plus a `transitions` array describing the
   legal next transitions for the owner UI.

No I/O outside the injected ports. The orchestrator is unit-testable
without a database or an LLM.

---

## 5. Persistence — `dynamic_authored_recipes`

Migration `0060_dynamic_authored_recipes.sql` adds a single tenant-
scoped table:

```
dynamic_authored_recipes (
  id              uuid PK
  tenant_id       text NOT NULL  -- canonical app.tenant_id GUC RLS
  kind            text NOT NULL  -- tab | doc | media | campaign | tool
  name            text NOT NULL
  version         text NOT NULL  -- semver-ish, e.g. '0.1.0'
  spec            jsonb NOT NULL -- the validated recipe spec
  lifecycle_state text NOT NULL DEFAULT 'draft'
                                 -- draft|shadow|live|locked|deprecated
  authored_at     timestamptz NOT NULL DEFAULT now()
  authored_by     text NOT NULL  -- 'mr-mwikila' | 'tenant-user:<uuid>'
  prev_hash       text NOT NULL  -- previous chain hash
  audit_hash      text NOT NULL  -- chainHash({prev, payload})
  UNIQUE (tenant_id, kind, name, version)
)
```

CHECK constraints enforce the kind/lifecycle enums. Two indices:
`(tenant_id, kind, lifecycle_state)` for the live-lookup hot path,
and `(audit_hash)` for forensic replay. RLS uses the canonical
`current_setting('app.tenant_id', true)` policy.

Migration number 0058 is reserved by Wave PERF-1
(`employee_perf_followup`); 0059 by Wave 18DD (wave resilience);
0060 through 0065 are claimed by other in-flight waves visible in
the local tree (swarm coordination, work cycle, voice Swahili, org
legibility, strategic layer, RLVR). We use **0066** — the next free
slot at authoring time.

---

## 6. Validator invariants

Beyond the per-kind zod schema, the validator enforces:

1. `tab` recipes — `brand === 'borjie'`; `authority_tier ∈ {0,1,2}`;
   every required field has a `required_because` citation contract
   when the field's group claims regulatory provenance; field
   group IDs unique within the recipe.
2. `doc` recipes — `class` is in the closed 11; `output_formats`
   non-empty; `authority_tier ∈ {0,1,2}`; `approval_required`
   defaults to `true` for tier 2.
3. `media` / `campaign` / `tool` — schema-shape only at v1; deeper
   invariants land alongside their respective host-package contracts.

Failed invariants are accumulated and returned as a single rejection
result so a tenant UI can render all errors at once.

---

## 7. Tests

≥10 vitest cases under `src/__tests__/`:

- `validator/recipe-validator.test.ts` — 1 happy path + 4 violation
  cases (missing brand, bad authority_tier, missing
  `required_because`, duplicate field-group id).
- `lifecycle/lifecycle-bridge.test.ts` — allowed transitions,
  rejected reverse transitions, deprecation exit.
- `author/recipe-author.test.ts` — happy path against an LLM stub +
  invalid-spec rejection.
- `repositories/authored-recipe-repository.test.ts` — insert, list,
  findById, lifecycle update, audit-hash continuity.

---

## 8. Out of scope (this wave)

- The runtime renderer for an authored recipe. Authored Tab Recipes
  flow into `@borjie/dynamic-ui`'s existing `TabRecipeRegistry` via
  a follow-up wire-up; this wave only authors and persists.
- Self-improvement scoring — handled by the capability-measurement
  worker (Wave CAPABILITY).
- LLM-prompt eval suite for the per-kind prompts — lands alongside
  the prompt-tuning pass.
