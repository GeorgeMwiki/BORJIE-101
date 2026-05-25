# BORJIE E2E Tests (Playwright)

End-to-end coverage for the critical user flows of the BORJIE platform:
customer-app, estate-manager-app, owner-portal, and admin-portal.

## Directory layout

```
e2e/
  playwright.config.ts          Playwright config (projects per portal)
  fixtures/                     Shared test data + auth fixtures
  helpers.ts                    Common helpers (selectors, waiting)
  page-objects/                 Page-object classes per portal
  tests/                        Existing legacy spec files
  tests/critical-flows/         NEW: critical user flow specs
    _helpers.ts                 API mocks, webhook sim, sign-in shortcut
    tenant-onboarding.spec.ts
    tenant-letter-request.spec.ts
    tenant-payment-gepg.spec.ts
    owner-approval-routing.spec.ts
    maintenance-flow.spec.ts
    negotiation-floor-breach.spec.ts
    conditional-survey.spec.ts
    subdivision.spec.ts
    waitlist-outreach.spec.ts
    move-out-damage.spec.ts
```

## Running locally

Install deps and Playwright browsers:

```bash
pnpm install
pnpm exec playwright install --with-deps chromium
```

Start the four dev servers (separate terminals or tmux panes):

```bash
pnpm --filter @borjie/customer-app dev        # http://localhost:3002
pnpm --filter @borjie/estate-manager-app dev  # http://localhost:3003
pnpm --filter @borjie/owner-portal dev        # http://localhost:3000
pnpm --filter @borjie/admin-portal dev        # http://localhost:3001
```

Run everything:

```bash
pnpm test:e2e
```

Run a single spec:

```bash
pnpm exec playwright test --config e2e/playwright.config.ts \
  e2e/tests/critical-flows/tenant-payment-gepg.spec.ts
```

Run only the critical-flows folder:

```bash
pnpm exec playwright test --config e2e/playwright.config.ts \
  e2e/tests/critical-flows
```

Filter by project (portal):

```bash
pnpm exec playwright test --project=customer-app
pnpm exec playwright test --project=estate-manager
pnpm exec playwright test --project=owner-portal
pnpm exec playwright test --project=admin-portal
```

## Environment variables

Copy `e2e/.env.example` to `e2e/.env` and populate. Critical ones:

| Variable | Purpose |
|----------|---------|
| `CUSTOMER_APP_URL` | Tenant PWA base URL (default `http://localhost:3002`) |
| `ESTATE_MANAGER_URL` | Estate manager portal URL |
| `OWNER_PORTAL_URL` | Owner portal URL |
| `ADMIN_PORTAL_URL` | Admin portal URL |
| `E2E_TEST_PHONE` | Tanzania-format phone for seed login (+2557...) |

## Fixture data

- `fixtures/data.fixture.ts` — property, lease, work-order generators
- `fixtures/test-data.ts` — canonical test users / tenants / properties
- `fixtures/auth.ts` — authentication storage state helpers

The critical-flows specs use their own inline mocks (`_helpers.ts`) so they do
not depend on seeded DB data. This keeps them hermetic in CI.

## Mocking external APIs

`tests/critical-flows/_helpers.ts` exposes `installApiMocks(page, overrides)`
which installs default `page.route()` handlers for:

- GePG control-number issuance + webhook
- M-Pesa STK push
- Generic notifications dispatcher

Override any handler by passing a map keyed by URL glob:

```ts
await installApiMocks(page, {
  '**/api/payments/gepg/control-number**': (route) =>
    route.fulfill({ status: 500, body: '{}' }),
});
```

To simulate an inbound webhook from inside a test, use `fireMockWebhook`:

```ts
await fireMockWebhook(page, '/api/payments/gepg/webhook', {
  controlNumber: '991234567890',
  invoiceId: 'INV-001',
  status: 'PAID',
});
```

No real network calls are made by these specs. Do not add live external
endpoints to critical-flows tests — they must run offline in CI.

## Debugging failing tests

1. **UI mode** (fastest feedback loop):

   ```bash
   pnpm exec playwright test --ui
   ```

2. **Headed with slow-mo**:

   ```bash
   pnpm exec playwright test --headed --project=customer-app --slow-mo=500
   ```

3. **Inspect a single step**:

   ```bash
   PWDEBUG=1 pnpm exec playwright test e2e/tests/critical-flows/tenant-payment-gepg.spec.ts
   ```

4. **Trace viewer** — on CI, traces are stored on first retry. Download the
   `playwright-report-strict` artifact from the failed job and run:

   ```bash
   pnpm exec playwright show-trace path/to/trace.zip
   ```

5. **Show the last HTML report**:

   ```bash
   pnpm exec playwright show-report e2e/e2e-report
   ```

## CI integration

- `ci.yml` — legacy non-blocking workflow (current baseline)
- `strict-ci.yml` — blocking lint / typecheck / unit / build / e2e across Node 20 & 22
- `db-migrations-check.yml` — forward-only linter + empty-Postgres dry run
- `security-scan.yml` — `pnpm audit`, `gitleaks`, npm-check-updates report
- `deploy-staging.yml` — gated by Strict CI before staging deploy

Playwright artifacts (`e2e/e2e-report/`, `e2e/test-results/`) are uploaded on
failure from the `E2E (Playwright, strict)` job and retained for 14 days.

## Adding a new critical-flow spec

1. Create `e2e/tests/critical-flows/<flow>.spec.ts`
2. Import `installApiMocks`, `signInAsTenant`, `hasText` from `./_helpers`
3. Mock every external call with `page.route()` — do NOT hit real services
4. Assert on both **UI state** (text visible, URL matches) and **API responses**
   where applicable (via `page.request.get(...)`)
5. Prefer `browser.newContext({ baseURL })` when the flow spans portals
6. Run locally with `--ui` before opening a PR
