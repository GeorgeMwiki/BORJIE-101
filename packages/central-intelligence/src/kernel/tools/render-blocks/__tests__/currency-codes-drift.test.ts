/**
 * Currency-mirror drift test.
 *
 * DA1 MEDIUM finding: `currency-codes.ts` mirrors
 * `packages/domain-models/src/common/currencies.ts` so the
 * `@borjie/central-intelligence` package can stay zero-runtime-dep
 * on domain-models (identical pattern to `regulatory-mirror.ts`). The
 * downside: if either side drifts, the renderer silently rejects valid
 * tenant currencies (or worse, accepts ones the rest of the system
 * doesn't know about). This test fails at build time when that drift
 * occurs.
 *
 * Contract: the local mirror MUST be a strict SUPERSET of
 * `SUPPORTED_CURRENCY_CODES` from `@borjie/domain-models`. The
 * mirror is allowed to be ahead (we can pre-stage new codes in the
 * brain↔UI wire protocol before they reach money.ts); it MUST NOT be
 * behind.
 *
 * Import path note: central-intelligence intentionally lists no
 * runtime dependency on domain-models. The relative-path import here
 * works because vitest's `include: ['src/**.test.ts']` plus
 * tsconfig's `exclude: ['**.test.ts']` means this file is NEVER part
 * of the production build — only the test runner ever resolves it.
 */

import { describe, expect, it } from 'vitest';

import { SUPPORTED_CURRENCY_CODES as MIRROR } from '../currency-codes.js';
// Relative path is intentional — see the file header. This import
// resolves only at test time; the package's dist output never includes
// this test file.
import { SUPPORTED_CURRENCY_CODES as SOURCE_OF_TRUTH } from '../../../../../../domain-models/src/common/currencies.js';

describe('currency-codes mirror — drift detection (DA1 MEDIUM)', () => {
  it('local mirror is a strict superset of domain-models SUPPORTED_CURRENCY_CODES', () => {
    // Each canonical code must exist in the mirror. The reverse is NOT
    // required (mirror may carry pre-staged codes), but the missing
    // direction is the load-bearing one — a tenant currency the brain
    // can't format silently degrades the UI.
    const mirror = new Set<string>(MIRROR);
    const missing = SOURCE_OF_TRUTH.filter((code) => !mirror.has(code));
    expect(missing).toEqual([]);
  });

  it('mirror contains the EAC + USD baseline (regression for the pre-mirror state)', () => {
    // Before the mirror existed the renderer hardcoded `'KES' | 'TZS' |
    // 'USD'` and dropped formatting for the other 140+ codes. Lock
    // these in as a smoke check so a future refactor can't quietly
    // re-narrow the enum.
    for (const code of ['KES', 'TZS', 'UGX', 'RWF', 'USD', 'EUR', 'GBP']) {
      expect(MIRROR).toContain(code);
    }
  });

  it('mirror entries are all 3 upper-case ISO-4217 letters', () => {
    // Defence against accidental whitespace, lower-case, or 4-char
    // additions slipping in via PR. The renderer's Zod schema would
    // reject these at runtime, but this test surfaces the failure at
    // CI time with a more useful diff.
    for (const code of MIRROR) {
      expect(code).toMatch(/^[A-Z]{3}$/);
    }
  });

  it('mirror has no duplicate codes', () => {
    expect(new Set(MIRROR).size).toBe(MIRROR.length);
  });

  it('mirror size is ≥ canonical size (superset cardinality check)', () => {
    expect(MIRROR.length).toBeGreaterThanOrEqual(SOURCE_OF_TRUTH.length);
  });
});
