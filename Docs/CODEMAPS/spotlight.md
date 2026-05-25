# Spotlight Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/spotlight/`
**Public entry:** `packages/spotlight/src/index.ts`
**Tier scope:** user surface (Cmd+K palette)

## Purpose

Universal Cmd+K command palette + entity search. Provides a single
React component (`<Spotlight />`) that any app embeds at the root.
Resolves entities (tenants, properties, leases, customers, work
orders), runs actions from the action catalog, and ranks results
via a fuzzy engine. Tier-aware: which actions surface depends on
the caller's tier + role.

## Entry points

- `src/index.ts` — barrel.
- `src/Spotlight.tsx` — root component.
- `src/spotlight-engine.ts` — ranking + filtering engine.
- `src/action-catalog.ts` — registry of palette actions.
- `src/entity-resolver.ts` — entity fetcher per-tenant.

## Internal structure

- `Spotlight.tsx` — Radix Dialog + keyboard handler.
- `spotlight-engine.ts` — fuzzy matcher + scoring.
- `action-catalog.ts` — actions registered by package
  (e.g. owner-portal registers "Open property X").
- `entity-resolver.ts` — calls api-client for entity hydration.
- `__tests__/` — engine + resolver tests.

## Dependencies

- Upstream: `@borjie/design-system`, `@borjie/api-client`,
  Radix Dialog.
- Downstream: owner-portal, estate-manager-app, customer-app,
  admin-platform-portal.

## Common workflows

- **Embed the palette** → mount `<Spotlight />` once at app root.
- **Register an action** → `actionCatalog.register({ id, label,
  scope, run })` in a feature folder.
- **Open** → Cmd+K (Mac) / Ctrl+K (others).

## Anti-patterns to avoid

- Never register actions that don't respect the tier + role gate.
- Never make a network call in the action `run` without a tenant
  context.
- Never duplicate ranking logic in a feature — extend the engine.
- Never bypass the entity-resolver — it enforces tenant isolation.

## Related codemaps

- [design-system.md](./design-system.md) — palette UI
- [api-client.md](./api-client.md) — entity fetch
- [central-intelligence.md](./central-intelligence.md) — tier-policy resolver
