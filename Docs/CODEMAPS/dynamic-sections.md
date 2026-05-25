# Dynamic Sections Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/dynamic-sections/`
**Public entry:** `packages/dynamic-sections/src/index.ts`
**Tier scope:** all (sections are tenant + role + persona filtered)

## Purpose

Adaptive layout engine — UI-1. A page's sections rearrange themselves
based on brain signal (mind-state, mastery, recent actions), viewport
breakpoint, and per-tenant configuration. Replaces hard-coded route
templates with a registry + evaluator pipeline.

## Entry points

- `registry/section-registry.ts` — `createSectionRegistry` + the
  global section catalogue.
- `registry/evaluate.ts` — ranks + filters sections per request.
- `registry/filter.ts` — tier / persona / mastery predicates.
- `components/SectionMount.tsx` — React mount point.
- `components/DynamicTabBar.tsx` — adaptive tab bar.
- `hooks/use-section-registry.ts`, `hooks/use-viewport-breakpoint.ts`,
  `hooks/use-swipe-nav.ts`, `hooks/section-context-provider.tsx`.

## Internal structure

- `components/` — `SectionMount`, `DynamicTabBar`, `SectionSkeleton`.
- `contracts/` — typed contracts between registry + consumer apps.
- `hooks/` — query-keys, section registry hook, viewport breakpoint,
  swipe nav, section context.
- `registry/` — registry + evaluator + filter.
- `seed/` — initial section definitions.
- `lib/` — pure utilities (sorting, weight calc).
- `stories/` — Storybook (visual specs).

## Dependencies

- Upstream: every app (`apps/customer-app`, `apps/estate-manager-app`,
  `apps/owner-portal`, `apps/admin-portal`). Apps wrap their route
  shells in `SectionMount`.
- Downstream: `packages/database` (`section_layouts` table, migration
  `0182_section_layouts.sql`), `packages/chat-ui` (mastery score
  feeds into evaluator), `packages/central-intelligence` (mind-state
  from theory-of-mind).

## Common workflows

- **Register a section** → call `registry.register({ id, render,
  predicate, weight })` in app's startup. Predicate gets `{ tenantId,
  persona, mastery, viewport }`.
- **Persist layout** → `section_layouts` table holds per-user
  pinned order; reset to default when user clears.
- **Add multi-tenant section** → the `predicate` MUST honour
  `tenantId` so a section never leaks across tenants (this was a
  Wave 1 critical fix).
- **Test responsive** → `use-viewport-breakpoint` returns `xs / sm /
  md / lg / xl`; evaluator down-weights heavy sections on `xs`.
- **Brain-driven reorder** → mind-state `urgency=high` boosts
  related-task sections (e.g. arrears at top for owner).

## Anti-patterns to avoid

- Never hard-code a section's position in app code — go through the
  registry.
- Never skip the tenant predicate — multi-tenant leakage was a real
  bug. Audit at `__tests__/section-registry-tenant.test.ts`.
- Sections must be pure render functions or lazy chunks; no top-level
  side effects.
- Never read brain state inline — consume via the section context.

## Related codemaps

- [chat-ui.md](./chat-ui.md) — MasteryGate + LearnedShortcutsPanel
  feed the same evaluator
- [central-intelligence.md](./central-intelligence.md) — mind-state
- [database.md](./database.md) — `section_layouts`,
  `user_action_tracker`
