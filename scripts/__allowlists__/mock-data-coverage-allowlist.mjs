/**
 * Mock-data-coverage allow-list.
 *
 * Production files that legitimately reference `mockData`, `MOCK_<NAME>`,
 * or import from `__mocks__/` outside of `__fixtures__/` and `__tests__/`
 * directories. Test files and fixture files are auto-allowlisted by the
 * scanner (any `*.test.ts`, `*.spec.ts`, `*.fixture.ts`, or any file under
 * `__tests__/` / `__fixtures__/` / `__mocks__/`).
 *
 * Legitimate categories:
 *   1. HTTP header constants asking an upstream API for a mock response
 *      (e.g. `X-MOCK-MARKET-DATA` sent to Airbnb / Zillow sandbox).
 *   2. Empty-array sentinels exported as bootstrap defaults (e.g.
 *      `MOCK_PAYMENTS: Payment[] = []`). Pending rename to drop the
 *      misleading `MOCK_` prefix (#33).
 *
 * Adding a new mock fixture to production code → register here with a
 * justification ≥ 8 characters explaining why production needs it.
 *
 * Note: identifiers like `USE_MOCK_DATA` (the env-flag NAME, not a fixture
 * body) are NOT flagged because the `\bMOCK_` regex requires a word
 * boundary BEFORE `MOCK_`, which doesn't fire after `USE_`.
 *
 * Keys are paths RELATIVE to the repo root.
 */

// Empty: the three former entries (market-intelligence airbnb.ts / zillow.ts
// real-estate adapters and the customer-app payments-data.ts sentinel) were
// property-domain files removed in the property→mining migration. No
// production file currently needs a mock-data exemption.
export const MOCK_DATA_ALLOWLIST = new Map([]);
