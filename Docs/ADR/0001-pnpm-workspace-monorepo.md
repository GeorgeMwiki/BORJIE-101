# ADR 0001 — pnpm-workspace monorepo

- **Status:** Accepted
- **Date:** 2025-Q4 (backfilled 2026-05-18)

## Context

Borjie spans four user-facing apps (admin, owner, estate-manager,
customer), seven backend services (api-gateway, domain-services,
identity, notifications, payments, payments-ledger, reports,
webhooks, document-intelligence, consolidation-worker), and ~25
internal packages (kernel, design-system, observability, agent-
platform, …). Sharing TypeScript types across this surface area
without a monorepo would force npm-publishing every internal change,
turning a one-line type tweak into a five-package release.

Options considered:

| Option | Verdict |
|---|---|
| Nx + npm | Too prescriptive; Nx generators don't fit our shape |
| Turborepo + yarn | Good DX but yarn berry's PnP causes too many ecosystem friction points |
| Turborepo + pnpm | Strong contender; lost vs pnpm-workspace+native by margin |
| Lerna | Maintenance mode |
| pnpm-workspace (native) | Selected |

## Decision

Use pnpm 8+ workspaces as the monorepo substrate. Internal packages
are linked via `workspace:*` in `package.json`. The root `pnpm-workspace.yaml`
declares `packages/*`, `services/*`, `apps/*`. Builds are coordinated
by per-package scripts; cross-package builds use `pnpm -F <name> build`.

## Consequences

**Positive:**

- Hot-link semantics: edit a package, every consumer sees the change instantly.
- pnpm's content-addressable store keeps disk usage low (~3 GB vs 20+).
- Strict per-package `node_modules` prevents accidental cross-deps.
- `pnpm dlx` provides on-demand tool execution without polluting deps.

**Negative:**

- Some tools (Next.js, Vite) need `transpilePackages` config to handle
  workspace symlinks.
- Initial CI cache invalidation tuning required.
- Onboarding cost: developers used to npm find pnpm's stricter
  resolution surprising at first.

## Alternatives considered

Turborepo's incremental build cache is attractive but doesn't yet
justify the second tool. We can layer Turborepo on later without
disrupting pnpm-workspace.

## References

- `pnpm-workspace.yaml`
- `package.json` (root)
- `Docs/ARCHITECTURE.md` § Repository structure
