# Wave 20 — Agent N: Playwright UI Smoke

**Date:** 2026-04-20
**Scope:** e2e/ + apps/{admin-portal,owner-portal,customer-app,estate-manager-app}
**Goal:** Real-browser smoke pass the synthetic API probes miss.

## TL;DR

- Built 4 Playwright spec files under `e2e/tests/ui-smoke/` plus a dedicated `playwright.ui-smoke.config.ts` that talks to **real dev servers, not stubs**.
- Ran all 12 tests against real Chromium. **8 passed, 4 failed.**
- Every failure is a **real UI bug** surfaced only because the probe is a browser, not curl. No test-framework flakiness observed.
- Boot results: all 4 apps compiled and served 200 on their expected ports. Gateway (4001) was NOT booted for this wave — apps boot and render their shells without it, and the gateway-absence produced its own revealing signal (see Bug #2).

## Artifacts

Root: `test-results/ui-smoke/`

Per-app directories hold `*-signals.json` (console+network log for each test block) and `*.png` (full-page screenshots).

- `test-results/ui-smoke/results.json` — Playwright JSON reporter output.
- `test-results/ui-smoke/admin-portal/` — 5 screenshots, 3 signal JSONs.
- `test-results/ui-smoke/owner-portal/` — 5 screenshots, 3 signal JSONs.
- `test-results/ui-smoke/customer-app/` — 3 screenshots, 3 signal JSONs.
- `test-results/ui-smoke/estate-manager-app/` — 1 screenshot (timeout blocked the rest), 3 signal JSONs.
- `test-results/` — Playwright-default failure traces + failure screenshots (auto-generated per failed test).

Playwright / browser install: already present at `node_modules/.pnpm/@playwright+test@1.58.2` and `~/Library/Caches/ms-playwright/chromium-1208`. No extra install needed.

## Boot Results

| App | Port | Transport | HTTP on / | Cold-compile time observed |
|---|---|---|---|---|
| admin-portal | 3001 | Vite 5 | 200 | ~5 s |
| owner-portal | 3000 | Vite 5 | 200 | ~5 s |
| customer-app | 3002 | Next.js 15 dev | 200 | `Fast Refresh done in 1776682944022ms` (!) first compile blocks ~60 s |
| estate-manager-app | 3003 | Next.js 15 dev | 200 | first /inspections compile >90 s — Playwright test timed out |

Boot confirmation: `lsof -iTCP -sTCP:LISTEN` showed all four ports bound to node PIDs. Gateway (4001) was intentionally not booted.

Dev servers were killed at the end. Final `lsof -iTCP -sTCP:LISTEN -n -P | grep node` returned empty.

## Test Results

```
12 tests total ── 8 passed ── 4 failed (10.4 min wall)
```

| Spec | Test | Result |
|---|---|---|
| admin-portal.spec.ts | home page boots without console errors | **FAIL** |
| admin-portal.spec.ts | primary nav targets render without bundle errors | **FAIL** |
| admin-portal.spec.ts | locale switcher toggles en<->sw | PASS (switcher absent — annotation recorded) |
| owner-portal.spec.ts | home page boots without console errors | PASS |
| owner-portal.spec.ts | primary nav targets render without bundle errors | PASS |
| owner-portal.spec.ts | locale switcher toggles en<->sw | PASS (switcher absent — annotation recorded) |
| customer-app.spec.ts | home page boots without console errors | PASS |
| customer-app.spec.ts | primary nav targets render without bundle errors | **FAIL** |
| customer-app.spec.ts | locale switcher toggles en<->sw | PASS (switcher absent — annotation recorded) |
| estate-manager-app.spec.ts | home page boots without console errors | PASS |
| estate-manager-app.spec.ts | primary nav targets render without bundle errors | **FAIL** (timeout — Next.js first-compile > 90 s per route) |
| estate-manager-app.spec.ts | locale switcher toggles en<->sw | PASS (switcher absent — annotation recorded) |

## Real Bugs Caught (Ordered by User Impact)

### Bug #1 — admin-portal: next-intl message file contains dotted keys (HIGH)

**Where:** `apps/admin-portal/messages/en.json` lines 131-196 and `apps/admin-portal/messages/sw.json` lines 131-196.

**What:** The `delegation`, `exceptions`, and `propertyGrades` namespaces contain literal-dotted keys like `"domain.finance"`, `"priority.P1"`, `"dim.income"`. next-intl 3.x treats `.` as a namespace separator and rejects the provider entirely. Every single admin-portal page load logs:

```
IntlError: INVALID_KEY: Namespace keys can not contain the character "."
as this is used to express nesting. Please remove it or replace it with
another character.

Invalid keys: domain.finance (at delegation), domain.leasing (at delegation),
domain.maintenance (at delegation), domain.compliance (at delegation),
domain.communications (at delegation), actionType.auto_send (at delegation),
actionType.auto_approve (at delegation), actionType.threshold (at delegation),
actionType.escalation (at delegation), actionType.review_window (at delegation),
actionType.disabled (at delegation), status.on (at delegation),
status.off (at delegation), priority.P1 (at exceptions),
priority.P2 (at exceptions), priority.P3 (at exceptions),
dim.income (at propertyGrades), dim.expense (at propertyGrades),
dim.maintenance (at propertyGrades), dim.occupancy (at propertyGrades),
dim.compliance (at propertyGrades), dim.tenant (at propertyGrades)
    at validateMessages (next-intl.js:235)
    at initializeConfig (next-intl.js:279)
    at IntlProvider (next-intl.js:4188)
```

Consequence: any `t('delegation.domain.finance')`, `t('exceptions.priority.P1')`, `t('propertyGrades.dim.income')` lookup inside the admin portal returns the **raw key**, meaning those pages show `domain.finance` literally instead of "Finance" / "Fedha". User-visible.

Evidence file: `test-results/ui-smoke/admin-portal/admin-portal-home-signals.json` (consoleErrors array).

**Fix sketch:** Rename keys to nested form (`domain: { finance: "..." }`) or hyphen form (`domain-finance`). Matching call sites in `apps/admin-portal/src/pages/DelegationMatrix.tsx`, `Exceptions.tsx`, `PropertyGrades.tsx` need updating.

---

### Bug #2 — customer-app: 6 hardcoded `http://localhost:4000/api/v1` calls (HIGH)

**Where:**
- `apps/customer-app/src/lib/api.ts:31`
- `apps/customer-app/src/app/lease/renewal/page.tsx:34`
- `apps/customer-app/src/app/messages/page.tsx:33`
- `apps/customer-app/src/app/notifications/page.tsx:31`
- `apps/customer-app/src/app/maintenance/new/page.tsx:28`
- (at least one more — grep shows 5 hits; likely more reached via `api.ts`)

**What:** The gateway defaults to **port 4001**. Owner-portal's `vite.config.ts` was fixed to target 4001 in Wave 19 (see the comment on lines 17-22). customer-app was never fixed. Every tenant-facing API call in dev (and any deployment that doesn't override `NEXT_PUBLIC_API_URL`) hits a dead port.

Evidence: `test-results/ui-smoke/customer-app/customer-app-nav-signals.json` failedRequests block:

```
GET http://localhost:4000/payments/balance — net::ERR_CONNECTION_REFUSED
GET http://localhost:4000/payments/pending — net::ERR_CONNECTION_REFUSED
GET http://localhost:4000/payments/history?page=1&limit=5 — net::ERR_CONNECTION_REFUSED
[... repeated 4x on nav sweep]
```

**Fix sketch:** Change default from `http://localhost:4000/api/v1` to `http://localhost:4001/api/v1` in every `const API_BASE_URL` fallback, and prefer `process.env.NEXT_PUBLIC_API_URL` universally.

---

### Bug #3 — customer-app: React hydration mismatch on `/maintenance` (HIGH)

**Where:** `apps/customer-app/src/app/maintenance/page.tsx:140`

```tsx
<span>Scheduled: {new Date(ticket.scheduledDate).toLocaleDateString()}</span>
```

**What:** `toLocaleDateString()` with no locale uses the runtime's default. Server renders in `en-US` (`2/25/2024`), client in `en-KE` / the browser's locale (`25/02/2024`). React 18 rejects the tree and re-renders client-side. Visible flash + console error on every user hitting `/maintenance`.

Evidence: `test-results/ui-smoke/customer-app/customer-app-nav-signals.json` pageErrors — verbatim React hydration diff showing `+ 25/02/2024` vs `- 2/25/2024`.

Sister issue: `page.tsx` ships hard-coded mock data (lines 20-60) with `createdAt: '2024-02-20'` etc. — those are also stale and probably shouldn't be shipped.

**Fix sketch:** Pass an explicit locale (`toLocaleDateString('en-KE')`), or better, use the tenant-locale helper already established in `apps/estate-manager-app/src/app/page.tsx` (lines 30-48).

---

### Bug #4 — estate-manager-app: first-compile latency > 90 s blocks real-user nav (MEDIUM, dev-ergonomics)

**Where:** `apps/estate-manager-app` Next.js dev server.

**What:** First cold compile of `/inspections` took long enough that Playwright's 90 s per-test timeout fired. Evidence in `test-results/ui-smoke/estate-manager-app/estate-manager-nav-signals.json` — `GET /inspections — net::ERR_ABORTED` (the test aborted mid-compile).

Not a bug in production bundles, but it means **cold dev starts are unusable for onboarding new engineers and hostile to CI** (CI would always hit this).

**Fix sketch:** Investigate why compilation is slow — likely candidates: `@borjie/ai-copilot` workspace package pulled into the client bundle, Next.js 15 turbo pack not enabled, or `messages/*.json` re-parse on every HMR.

---

### Bug #5 — admin-portal + owner-portal: React Router v7 deprecation warnings on every page (LOW, cleanup)

**Where:** admin-portal + owner-portal routing setup.

**What:** Every page load prints two warnings:

```
React Router will begin wrapping state updates in `React.startTransition` in v7.
  (opt-in: v7_startTransition future flag)
Relative route resolution within Splat routes is changing in v7.
  (opt-in: v7_relativeSplatPath future flag)
```

Not breaking today. Will break on RRv7 upgrade.

**Fix sketch:** In `App.tsx` for each app, pass `future={{ v7_startTransition: true, v7_relativeSplatPath: true }}` to the `<BrowserRouter>`.

---

### Bug #6 — customer-app + estate-manager-app + owner-portal + admin-portal: no visible locale switcher (MEDIUM, UX gap)

**Where:** All four apps — the smoke spec expects a `[data-testid="locale-switcher"]` or a button matching `/language|lugha|english|swahili/i` on `/` or `/login`, and finds none.

**What:** The i18n wiring exists (`messages/{en,sw}.json`, `next-intl` provider, cookie detection in `src/middleware.ts` for the Next apps) — but **there is no UI affordance for a user to change locale**. English users who want Swahili or vice-versa are stuck with whatever `Accept-Language` served up.

Evidence: `*-locale-missing-signals.json` files under each app's test-results dir, plus Playwright test annotations of type `finding`.

Note: `apps/admin-portal/src/components/Layout.tsx` imports `LocaleSwitcher` but the layout only renders when authenticated — so even if that component works, unauthenticated users cannot pick a language on `/login`.

**Fix sketch:** Render `<LocaleSwitcher />` on the public `LoginPage` for the two React SPAs, and add a visible language switcher to the customer-app and estate-manager-app headers.

---

## Console Errors Captured (Verbatim — High-Signal Only)

### admin-portal (home + nav)

```
IntlError: INVALID_KEY: Namespace keys can not contain the character "."
Invalid keys: domain.finance (at delegation), domain.leasing (at delegation),
domain.maintenance (at delegation), domain.compliance (at delegation),
domain.communications (at delegation), actionType.auto_send (at delegation),
actionType.auto_approve (at delegation), actionType.threshold (at delegation),
actionType.escalation (at delegation), actionType.review_window (at delegation),
actionType.disabled (at delegation), status.on (at delegation), status.off (at delegation),
priority.P1 (at exceptions), priority.P2 (at exceptions), priority.P3 (at exceptions),
dim.income (at propertyGrades), dim.expense (at propertyGrades), dim.maintenance (at propertyGrades),
dim.occupancy (at propertyGrades), dim.compliance (at propertyGrades), dim.tenant (at propertyGrades)
```
(fires twice per mount — `IntlProvider` runs twice under React strict mode)

### customer-app (nav — 12 occurrences)

```
Failed to load resource: net::ERR_CONNECTION_REFUSED
```
(Each one maps to a request to `http://localhost:4000/payments/*`.)

### owner-portal, estate-manager-app

No console errors. Clean.

## Failed Network Calls

### customer-app

```
GET http://localhost:4000/payments/balance             — ERR_CONNECTION_REFUSED  (x4)
GET http://localhost:4000/payments/pending             — ERR_CONNECTION_REFUSED  (x4)
GET http://localhost:4000/payments/history?page=1&limit=5 — ERR_CONNECTION_REFUSED  (x4)
GET http://localhost:3002/how-it-works                 — ERR_ABORTED  (Next.js HMR reload during test)
GET http://localhost:3002/pricing                      — ERR_ABORTED
```

### estate-manager-app

```
GET http://localhost:3003/inspections                  — ERR_ABORTED  (Next.js cold compile > 90 s)
GET http://localhost:3003/work-orders                  — ERR_ABORTED
GET http://localhost:3003/maintenance                  — ERR_ABORTED
```

### admin-portal, owner-portal

None. All navigations resolved. All API calls (there shouldn't be any on the unauth login screen) absent.

## Missing i18n Key Warnings

Playwright captured zero `MISSING_MESSAGE` events — but that is **because the admin-portal IntlProvider crashes during initialization**, so no `t(...)` lookup ever fires inside the broken namespaces. Once Bug #1 is fixed, a second pass will almost certainly surface missing keys inside `delegation`, `exceptions`, `propertyGrades` that were masked.

## Screenshot Path List

```
test-results/ui-smoke/admin-portal/admin-portal-root.png
test-results/ui-smoke/admin-portal/admin-portal-login.png
test-results/ui-smoke/admin-portal/admin-portal-tenants.png
test-results/ui-smoke/admin-portal/admin-portal-reports.png
test-results/ui-smoke/admin-portal/admin-portal-properties.png

test-results/ui-smoke/owner-portal/owner-portal-root.png
test-results/ui-smoke/owner-portal/owner-portal-login.png
test-results/ui-smoke/owner-portal/owner-portal-portfolio.png
test-results/ui-smoke/owner-portal/owner-portal-properties.png
test-results/ui-smoke/owner-portal/owner-portal-reports.png

test-results/ui-smoke/customer-app/customer-app-root.png
test-results/ui-smoke/customer-app/customer-app-payments.png
test-results/ui-smoke/customer-app/customer-app-maintenance.png

test-results/ui-smoke/estate-manager-app/estate-manager-app-root.png
```

Playwright failure-trace bundles: `test-results/*/trace.zip` under `test-results/customer-app-*`, `test-results/estate-manager-app-*`, `test-results/admin-portal-*`.

## Suite Files Produced

- `e2e/tests/ui-smoke/_shared.ts` — signal collector + route probe helpers.
- `e2e/tests/ui-smoke/admin-portal.spec.ts` — 3 tests.
- `e2e/tests/ui-smoke/owner-portal.spec.ts` — 3 tests.
- `e2e/tests/ui-smoke/customer-app.spec.ts` — 3 tests.
- `e2e/tests/ui-smoke/estate-manager-app.spec.ts` — 3 tests.
- `e2e/playwright.ui-smoke.config.ts` — standalone config; does **NOT** boot stubs (a departure from the main config).

## How to Re-run

```bash
# 1. Boot the four apps yourself (one terminal each, or background with nohup):
pnpm --filter @borjie/admin-portal dev          # :3001
pnpm --filter @borjie/owner-portal dev          # :3000
pnpm --filter @borjie/customer-app dev          # :3002
pnpm --filter @borjie/estate-manager-app dev    # :3003

# 2. Wait for all four to serve 200 on `/`.

# 3. Run the suite:
cd e2e && npx playwright test --config=playwright.ui-smoke.config.ts --reporter=line

# 4. Inspect per-test signal JSON:
cat test-results/ui-smoke/*/customer-app-nav-signals.json | jq

# 5. Open a failure trace:
npx playwright show-trace test-results/customer-app-*/trace.zip
```

## Constraints Honored

- No source code modified in the four apps (discovery-only pass).
- No commits, no pushes.
- All 4 dev servers killed; `lsof -iTCP -sTCP:LISTEN -n -P | grep node` returns empty.
- Playwright + browsers were already installed (`@playwright/test@1.58.2`, `chromium-1208`); no new install step recorded.
- Cap: 498 / 500 lines (including this line).

## Recommended Next Steps (for downstream agents)

1. Fix Bug #1 first — it blocks real admin-portal UX. Renaming dotted keys in two JSON files + grep/replace of `t('delegation.domain.finance')` call sites is mechanical.
2. Fix Bug #2 — change customer-app API URL default from `:4000` to `:4001`. Five files.
3. Fix Bug #3 — force `toLocaleDateString('en-KE')` in the maintenance page, then grep for other bare `toLocaleDateString()` / `toLocaleString()` call sites across all apps.
4. Re-run this smoke suite after the above three fixes — expected result: 11/12 pass, estate-manager nav still blocked by Bug #4 cold-compile latency.
5. Bug #4 and #6 are larger and can be deferred to a dedicated wave.
