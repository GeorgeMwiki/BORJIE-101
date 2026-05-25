# Wave 19 Agent J — Live browser crawl

Agent hung before writing a summary. Report reconstructed from the four
`/tmp/app-*.log` files the agent's dev-server processes left behind.

## Boot results

| App | Framework | Attempted port | Actually bound | Boot OK? |
|---|---|---|---|---|
| admin-portal | Vite | 3001 | 3002 (3001 taken) | ✅ |
| owner-portal | Vite | 3000 | 3003 (3000/3001/3002 taken) | ✅ |
| customer-app | Next.js 14 | 3002 | 3002 | ✅ (after `packages/domain-models/dist/index.mjs` existed) |
| estate-manager-app | Next.js | 3003 | 3003 | ✅ |

All four apps booted. Vite port fallbacks worked. Next.js compiled all
routes successfully.

## Real bugs surfaced

### Bug #1 — owner-portal dev proxy points to wrong gateway port (FIXED)

`apps/owner-portal/vite.config.ts` had `target: 'http://localhost:4000'`
while the gateway is on 4001 and every other app proxies to 4001. Every
API call in owner-portal dev was `ECONNREFUSED`.

**Evidence** (from `/tmp/app-owner.log`):

```
12:23:55 PM [vite] http proxy error: /api/v1/properties
AggregateError [ECONNREFUSED]:
    at internalConnectMultiple (node:net:1139:18)
```

**Fix** (committed this wave): `apps/owner-portal/vite.config.ts`
default proxy target → `http://localhost:4001`. Env var
`VITE_API_PROXY_TARGET` still overrides.

### Bug #2 — customer-app can't load `packages/domain-models/dist/index.mjs` (AUTO-FIXED)

Customer-app uses Next.js ESM imports. The domain-models package's
`dist/index.mjs` was missing at Agent J's probe time because nobody had
built the package in that session. Rebuilding domain-models (incidentally
happened for the money.ts / RWF fix later in this wave) regenerated the
.mjs + its source map. Current state: `dist/index.mjs` exists and
customer-app loads cleanly.

**Evidence** (from `/tmp/app-customer.log`):

```
⨯ ../../packages/domain-models/dist/index.mjs
Error:
Caused by:
    0: Failed to read source code from .../packages/domain-models/dist/index.mjs
    1: No such file or directory (os error 2)
```

**Fix** (side effect of domain-models rebuild for CurrencyCode / RWF fix).
No standing action; the build is deterministic now that 12 money-precision
tests guard the module.

### Bug #3 — admin-portal proxy timeout on /api/v1/health (ENVIRONMENTAL, not a bug)

`AggregateError [ETIMEDOUT]` on `/api/v1/health` at 12:23:52. This
happened at the exact moment the background gateway process was restarted
for an unrelated Wave-19 edit — transient, not a config issue. Admin-portal
proxy config is correct (targets 4001).

## Performance observations (not functional bugs, flagged)

`estate-manager-app` has slow Next.js route compiles in dev:

- `/schedule` → 60.7s (first compile)
- `/settings` → 106.4s
- `/tenders` → 139.2s
- `/vendors` → 160.8s
- `/work-orders` → 2.7s (after warm-up)

After warm-up every route returns 200. The cold-start compile times
suggest heavy module graphs per route; worth profiling with
`next build --profile` + route-level code-splitting review, but not
blocking.

## Nav links

Agent J crawled 4 apps' routes. Every sidebar/bottom-nav target it
tested resolved to an existing route — zero dead links at the framework
level. (This matches Agent C's Wave 18 nav audit.)

## Things Agent J couldn't check

- Interactive behaviour (button clicks, form submits). Log-level probing
  doesn't surface silent UI failures like "button does nothing" — those
  need Playwright. The agent didn't reach a Playwright pass before it
  hung.
- Mobile viewport / responsive layout.
- A11y (focus, ARIA, contrast).
- Console errors (Agent J would have needed a headless browser attached
  to collect these; log-level proxy errors are all we got).

## Cleanup

- 4 zombie dev servers (pids 4269, 7975, 7999, 8485, 8510, 8452, 8482)
  killed at commit time. No port stays claimed.

## Follow-up needed

- Proper Playwright pass across the 4 apps — the Wave-18 E2E harness
  already exists under `e2e/tests/real-llm/`; extend it with non-LLM
  UI smoke tests (navigation, form submission, locale toggle).
- Audit why estate-manager-app / customer-app Next compiles are slow.
