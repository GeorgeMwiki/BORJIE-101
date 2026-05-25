# Persona Runtime Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/persona-runtime/`
**Public entry:** `packages/persona-runtime/src/index.ts`
**Tier scope:** cognitive core (Piece D — persona-bound assistants + title-tier hierarchy)

## Purpose

Implements the **TITLE → TIER** hierarchy that Piece D of the master
plan locks: tenants relabel their roles however they like (TRC: "DG",
hotel: "GM", university: "VC"), but the brain and policy gate route
on a fixed five-level **power tier**:

| Tier | Label | Examples |
|---|---|---|
| 1 | OWNER | Org founder / board / ultimate auth |
| 2 | ADMIN | Top operational lead (DG / CEO / VC / GM) |
| 3 | MANAGER | Dept / region / module head |
| 4 | EMPLOYEE | Field staff |
| 5 | CUSTOMER | External (lessee / guest / student / vendor) |

A **persona** is a scoped + tiered behavioural template (NOT a user). A
**binding** attaches a user to a persona inside a tenant; the
binding's `title_id` is the tenant-defined label for that binding. The
brain selects the persona by tier + scope predicate at request time.

## Entry points

- `src/index.ts` — barrel.
- `src/types.ts` — Zod schemas + TS types for Title, Persona,
  PersonaBinding, AuthorizationContext, ScopePredicate.
- `src/tool-catalog.ts` — `computeToolCatalog()` — frozen, filtered
  tool list per (persona, ctx).
- `src/scope-predicate.ts` — `evaluateScopePredicate()` +
  `renderScopeFilter()` — pure evaluator for scope JSON.
- `src/binding-resolver.ts` — default-persona resolution + active
  persona session store + tier compatibility check.
- `src/seeds.ts` — `seedBuiltInTitlesAndPersonas()` — idempotent seed
  helper called when a tenant is created.

## Internal structure

- **types** — 5 power tiers, 4 action tiers, 5 channels, 7 scope kinds.
- **tool-catalog** — 5-stage filter pipeline (kill-switch → channel →
  feature flag → max_action_tier).
- **scope-predicate** — exhaustive `switch` over scope kinds; tenant-
  isolation rail blocks every kind except `all`.
- **binding-resolver** — explicit `isDefault` wins; otherwise lowest
  power_tier with createdAt tie-break.
- **seeds** — 5 built-in titles (one per tier), 7 built-in personas
  (T1..T5 + T_auditor + T_vendor). Idempotent.

## Dependencies

- Upstream: `zod` only.
- Downstream:
  - `conversation-threads` (peer — uses Persona types for project gate)
  - `central-intelligence` (will read the active persona at think-time)
  - `services/api-gateway` (resolves default persona on session start)
  - `services/identity` (calls seedBuiltInTitlesAndPersonas on tenant
    creation)

## Common workflows

- **Tenant creation seeds defaults** → service/identity calls
  `seedBuiltInTitlesAndPersonas({tenantId, port})`.
- **Login resolves persona** → api-gateway calls
  `resolveDefaultPersonaForUser({userId, tenantId, port})` and writes
  the returned persona id into the session via `setActivePersona`.
- **Brain request lifecycle** → reads the persona row by id, computes
  `computeToolCatalog({persona, ctx, descriptors})`, runs sensors with
  the frozen catalogue.
- **Switching persona mid-session** → UI lets the user pick another
  bound persona; runtime calls `setActivePersona(sessionId, newId)`.
- **Adding a tenant-specific title** → tenant admin POSTs a new title
  row; the brain doesn't care because routing is on `power_tier`.

## Migrations

- `0195_personas.sql` — `personas` table.
- `0196_persona_bindings.sql` — `persona_bindings` table.
- `0197_memory_namespaces.sql` — `memory_namespaces` table.
- `0198_tickets.sql` — `tickets` table (cross-persona escalation).
- `0199_titles.sql` — `titles` table + retroactive FK on `persona_bindings.title_id`.

## Anti-patterns to avoid

- Never route on a persona's `displayName` — it's tenant-localised.
  Always route on `slug` (stable) or `power_tier` (canonical).
- Never bypass `computeToolCatalog` — the kill-switch fail-closed
  semantics depend on it being the single source of truth.
- Never set a binding whose persona's `power_tier` is *more powerful*
  than the title's `power_tier` (lower number = more power). Use
  `validateBindingTierCompatibility` first.
- Never call the seed helper inside a tight loop — it's intended for
  tenant-creation one-shots. It IS idempotent but still does a
  round-trip per call.

## Related codemaps

- [conversation-threads.md](./conversation-threads.md) — Piece F — uses
  this package's Persona type for the project-tier gate.
- [central-intelligence.md](./central-intelligence.md) — kernel pipeline
  reads the active persona to compose the identity preamble.
- [api-gateway.md](./api-gateway.md) — request lifecycle + AuthContext.
- [database.md](./database.md) — RLS + GUC discipline.
