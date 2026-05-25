# Wave 21 Agent R — Next.js cold-compile perf (estate-manager-app)

Scope: `apps/estate-manager-app` only (Next.js 15.5.15, Webpack dev compiler,
App Router + next-intl).

## Baseline (cold-compile times per slow route, from Wave-20 Agent N's logs)

| Route          | Cold TTFB | Note                                  |
| -------------- | --------- | ------------------------------------- |
| `/schedule`    | 60.7s     | 7 lucide-react icons + local page     |
| `/settings`    | 106.4s    | 6 lucide-react icons + PageHeader     |
| `/tenders`     | 139.2s    | 8 named imports from `@borjie/design-system` barrel |
| `/vendors`     | 160.8s    | `@tanstack/react-query` + `@borjie/api-client` full barrel |
| `/work-orders` | 2.7s      | Warm measurement only (first-hit was equivalent to /vendors) |

## Root causes (per route, what was pulling the module graph)

All four slow routes shared the same underlying pathology: `next.config.js`
had zero `experimental.optimizePackageImports` entries, so the dev Webpack
compiler walked full barrels on every cold route compile.

1. `lucide-react` (**2960 files in `dist/esm/icons/`** — 1480 icons × JS+map).
   A single `import { ChevronLeft } from 'lucide-react'` compiled the entire
   package barrel. 54 files in `apps/estate-manager-app/src` do this.
2. `@borjie/design-system` barrel re-exports **~40 components + Radix
   dialog/dropdown/tooltip deps**. `/tenders` imports 8 names from it
   (Card/Button/Badge/Alert/Skeleton/EmptyState), which under the old config
   meant every component file + every Radix dep was parsed for `/tenders`.
3. `@borjie/api-client` barrel re-exports **17 service modules**
   (tenants, properties, units, customers, leases, invoices, payments,
   work-orders, vendors, inspections, documents, notifications, reports,
   feedback, messaging, scheduling, sla) plus React Query hook wrappers.
   `/vendors` and `/work-orders` pull the whole graph via `vendorsService` /
   `workOrdersService` named imports.
4. `src/app/layout.tsx` is the ancestor of every route. It synchronously
   imported `MwikilaWidgetMount` (which pulls `@borjie/chat-ui`'s full
   barrel: chat-modes, generative-ui, blackboard, hooks, widget, dopamine)
   and `SpotlightMount` (`@borjie/spotlight/react`). Every cold route
   compile paid that cost even though neither module is visible in first
   paint — both are post-hydration floaties.
5. `/schedule` and `/settings` had no barrel packages but still hit
   lucide-react unoptimized (~2960 files per icon named-import).
6. `transpilePackages` for 10 workspace packages compounds the effect: every
   barrel gets transpiled through Babel/SWC in dev.

## Fixes shipped (config + per-page)

### `apps/estate-manager-app/next.config.js`
- Added `experimental.optimizePackageImports` for: `lucide-react`,
  `@tanstack/react-query`, `@hookform/resolvers`, `react-hook-form`, `zod`,
  `@borjie/design-system`, `@borjie/api-client`,
  `@borjie/chat-ui`, `@borjie/ai-copilot`,
  `@borjie/authz-policy`, `@borjie/observability`,
  `@borjie/spotlight`, `@borjie/domain-models`.
- Added `modularizeImports` for `lucide-react` with
  `transform: 'lucide-react/dist/esm/icons/{{ kebabCase member }}'` and
  `preventFullImport: true` as a belt-and-braces guard.
- Kept the existing `resolve.extensionAlias` for NodeNext `.js` → TS.

### `apps/estate-manager-app/src/app/layout.tsx`
- Replaced direct imports of `MwikilaWidgetMount` + `SpotlightMount` with a
  new client-boundary wrapper `DeferredMounts` that lazy-loads both via
  `next/dynamic({ ssr: false })`. The root layout is a Server Component, so
  the `next/dynamic` calls live inside a sibling `'use client'` file.

### `apps/estate-manager-app/src/components/DeferredMounts.tsx` (new)
- `'use client'` wrapper with `next/dynamic(...{ssr:false})` for
  `MwikilaWidgetMount` (chat-ui barrel) and `SpotlightMount` (spotlight).
- Typed with `ComponentType<MwikilaProps>` / `ComponentType<Record<string, never>>`
  casts to satisfy the strict-nulls tsconfig.
- Relative imports use `.js` extensions as required by the repo's NodeNext
  module resolution.

### Per-page code
- No per-page changes needed. The config-level fix eliminated the cold
  module-graph cost for every route without editing page source.

## New cold-compile times (per route, measured)

Methodology: for each route, wiped `.next`, restarted `pnpm dev`, waited for
"Ready", then hit the route exactly once with `curl` and recorded both the
dev-server's `✓ Compiled /<route> in Xs (N modules)` line and the client's
TTFB. Dev server killed between runs — every row is a true cold-compile.

| Route           | Cold compile | Cold TTFB | Modules | vs baseline    |
| --------------- | ------------ | --------- | ------- | -------------- |
| `/schedule`     | 13.3s        | 16.4s     | 1401    | -78% (60.7s)   |
| `/settings`     | 15.0s        | 18.2s     | 1397    | -86% (106.4s)  |
| `/tenders`      | 13.8s        | 17.3s     | 1379    | -90% (139.2s)  |
| `/vendors`      | 10.6s        | 13.6s     | 1395    | -93% (160.8s)  |
| `/work-orders`  | 14.7s        | 17.5s     | 1394    | (was 2.7s warm) |

All five routes now cold-compile in **10-15s** (TTFB **13-18s**) —
comfortably under the 20s ideal target and far under the 30s stop-ship.
Module counts converged to ~1380-1400 per route (previously the barrel
explosion pushed them far higher).

Warm-path times after first compile are sub-second: second hit of any route
was **~1.0-1.3s total** in one-dev-session testing, i.e. the warm behaviour
is preserved.

## Build output (bundle size deltas if notable)

`pnpm --filter @borjie/estate-manager-app build` completed cleanly. Route
bundles for the previously-slow pages:

| Route           | Route JS | First Load JS |
| --------------- | -------- | ------------- |
| `/schedule`     | 3.58 kB  | 109 kB        |
| `/settings`     | 2.26 kB  | 108 kB        |
| `/tenders`      | 1.23 kB  | 177 kB        |
| `/vendors`      | 1.32 kB  | 119 kB        |
| `/work-orders`  | 1.96 kB  | 136 kB        |

Shared: 102 kB (webpack runtime 45.7 kB + main chunk 54.2 kB + 2 kB other).
No bundle-size regression — `modularizeImports` + `optimizePackageImports`
also improve production tree-shaking, so these numbers are at-or-better vs
pre-fix.

Typecheck: `pnpm --filter @borjie/estate-manager-app typecheck` — clean.

## Deferrals (with reason)

1. **Turbopack dev-mode migration.** Next 15 ships Turbopack stable for
   `next dev --turbopack`, which would give an additional 3-5x cold-start
   win. The repo's `next.config.js` uses `webpack: (config) => {...}` to set
   `resolve.extensionAlias` for NodeNext `.js` → TS resolution. Turbopack
   uses a separate, SWC-native resolver with a different config surface
   (`experimental.turbo.resolveAlias` / `resolveExtensions`). Migration is
   mechanical but needs verification that the NodeNext behaviour for
   third-party ESM packages (e.g. `@opentelemetry/api` referencing `.js`
   that is actually `.ts` in workspace source) is preserved. Cost/benefit
   says ship the config-level fix first (which alone hits the perf target)
   and tackle Turbopack migration as its own change with a dedicated smoke
   run.

2. **Design-system barrel split.** Long-term, splitting
   `@borjie/design-system`'s single `index.ts` into sub-entrypoints
   (`@borjie/design-system/button`, `.../card`, etc.) via `exports`
   map sub-paths would make barrel optimization unnecessary and give
   bundlers a deterministic shape. Not blocking; `optimizePackageImports`
   covers the dev-compile cost today.

3. **api-client service granularity.** Same story for
   `@borjie/api-client`. 17 services exported from one barrel is
   suboptimal; ideally each service would live behind its own sub-path
   export. Out of scope for this agent (services + packages/* are not in
   `apps/estate-manager-app`).

4. **Transpilation scope.** `transpilePackages` still lists 10 workspace
   packages. Any of those that publish pre-built ESM via `dist/*.mjs`
   could be removed from that list, avoiding re-transpilation. Needs a
   per-package audit of which ones actually need in-tree transpile —
   deferred because it touches package exports, not just the app.

## Files changed

- `apps/estate-manager-app/next.config.js` — added
  `experimental.optimizePackageImports` (13 entries) + `modularizeImports`
  for lucide-react.
- `apps/estate-manager-app/src/app/layout.tsx` — replaced direct
  `MwikilaWidgetMount` + `SpotlightMount` imports with `DeferredMounts`.
- `apps/estate-manager-app/src/components/DeferredMounts.tsx` — new file,
  `'use client'` boundary that lazy-loads the two floating mounts via
  `next/dynamic({ ssr: false })`.

## Verification commands

```bash
pnpm --filter @borjie/estate-manager-app typecheck   # clean
pnpm --filter @borjie/estate-manager-app build       # clean, 0 warnings
rm -rf apps/estate-manager-app/.next && \
  (cd apps/estate-manager-app && pnpm dev) &
# then curl each of /schedule /settings /tenders /vendors /work-orders
# once each, restarting between for true cold measurement.
```
