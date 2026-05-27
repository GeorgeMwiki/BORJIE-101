# Mobile E2E — Detox specs (skipped: Detox not configured)

`apps/workforce-mobile` and `apps/buyer-mobile` are Expo Router apps.
Detox is **not** installed in either workspace (verified by grep on
`package.json` — no `detox` dev-dependency, no `.detoxrc.js`, no
`e2e` script).

The two spec files under this directory are intentional placeholders
that document the **next-step suite** so when Detox is wired the
mining team has ready-to-port flows. They are **not** picked up by
the Playwright config — Playwright only globs
`tests/e2e/web/**/*.spec.ts`.

To enable mobile E2E:

1. `pnpm --filter @borjie/workforce-mobile add -D detox @types/detox jest`
   (and same for `@borjie/buyer-mobile`)
2. `detox init -r jest` in each app
3. Add `.detoxrc.js` per
   <https://wix.github.io/Detox/docs/introduction/getting-started/>
4. Move the `.e2e.ts` specs under `apps/<app>/e2e/` and adapt
   `device.launchApp()` boilerplate
5. Add `mobile-e2e` target to root `Makefile`

Until then the specs sit here as documentation of intent. They are
TypeScript stubs that import a placeholder `detox` namespace so
linting/`tsc --noEmit` will fail loudly if you copy them into a
configured app without removing the placeholder.
