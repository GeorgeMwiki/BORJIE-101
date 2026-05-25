# ADR 0013 — LITFIN-style architecture-imports lint

- **Status:** Proposed
- **Date:** 2026-05 (Wave 13 / F-series)

## Context

The dependency-graph between workspace packages is largely correct
(see `Docs/CODEMAPS/DEPENDENCY-GRAPH.md`), but enforcement is by
review only. As we approach 50+ packages and onboard contributors,
we want forbidden edges (e.g. a UX package importing a service,
or `domain-models` importing `database`) to be a hard error at lint
time — not a polite reviewer comment. LITFIN ports this pattern
via the `architecture-imports` lint already (F-series cross-pollination);
bringing it home keeps the two repos aligned.

Options considered:

| Option | Verdict |
|---|---|
| Reviewer discipline only | Doesn't scale; people leave |
| Custom ESLint rule with deny-list | Selected (proposed) |
| `dependency-cruiser` | Strong but extra tool; ESLint preferred |
| `nx enforce-module-boundaries` | Locks into Nx (see ADR-0001) |
| Custom TS compiler plugin | Heavyweight |

## Decision (proposed)

Introduce a custom ESLint rule (`architecture-imports`) in
`tools/eslint-plugin-borjie/` that reads a manifest of allowed
edges (`Docs/ARCHITECTURE.md` § dependency rules) and fails on any
import that violates it. Forbidden edges to enforce in v1:

- `packages/domain-models/**` may not import from anywhere outside itself.
- `packages/api-client/**` may not import from `services/**`.
- `packages/design-system/**` may not import from `packages/api-client/**`.
- `apps/marketing/**` may not import from `services/**`.
- Any UX package may not import from a service.

The rule runs in CI; violations are hard errors.

## Consequences

**Positive:**

- Forbidden edges become impossible to merge.
- The dependency graph stays honest.
- Mirrors LITFIN's architecture-imports rule (cross-repo consistency).
- Easier onboarding — the lint teaches the boundary.

**Negative:**

- Some legitimate edges may require explicit allowlist exemptions
  (e.g. a UX package re-exporting a service type — argue for moving
  the type to domain-models).
- The manifest needs maintenance as the graph evolves.
- Initial rollout will surface ~50-100 existing offenders to triage.

## Alternatives considered

`dependency-cruiser` is fine, but ESLint integration keeps the
DX in one tool. `nx enforce-module-boundaries` would force us
onto Nx (ADR-0001 chose pnpm-workspaces native).

## References

- `Docs/CODEMAPS/DEPENDENCY-GRAPH.md` — current map
- LITFIN architecture-imports rule (F-series mirror task)
- `Docs/ARCHITECTURE.md` § dependency rules
- ADR-0001 (monorepo choice)
