/**
 * Unit tests for `borjie/require-csrf-headers`.
 *
 * Uses ESLint's built-in `RuleTester` (flat-config-style API for ESLint
 * 10.x). Each test case explicitly sets the `filename` so the rule's
 * file-path classifier triggers correctly — without a filename the
 * rule short-circuits to `{}` and reports nothing.
 *
 * Coverage matrix:
 *   - Client file + mutating fetch + no import         → 1 violation
 *   - Client file + mutating fetch + CSRF import       → 0 violations
 *   - Client file + GET fetch                          → 0 violations
 *   - Server file (services/, packages/, app/api/, .server.ts) → 0
 *   - Test file (.test.ts, /__tests__/, /e2e/)         → 0
 *   - Non-fetch CallExpression (axios, sdk)            → 0
 *   - Method as variable (statically unresolvable)     → 0 (intentional)
 *   - PATCH and DELETE                                  → 1 each
 *   - @borjie/api-client import (any specifier)    → 0
 *   - Path-aliased import @/lib/csrf, ../lib/csrf      → 0
 *
 * The RuleTester throws synchronously on any case mismatch, so the
 * script exits with non-zero on failure and prints a one-line success
 * banner on pass.
 */

'use strict';

const { RuleTester } = require('eslint');
const tsParser = require('@typescript-eslint/parser');
const rule = require('../require-csrf-headers.cjs');

// Each test fixture stipulates a filename — without one the rule's
// `isClientFile()` short-circuit returns false. We use representative
// real paths from the customer-app tree so the test doubles as
// documentation for which paths are in-scope.
const CLIENT_FILE =
  '/repo/apps/customer-app/src/components/feedback/FeedbackThumbs.tsx';
const CLIENT_HOOK_FILE =
  '/repo/apps/customer-app/src/hooks/useSomething.ts';
const CONTEXT_FILE =
  '/repo/apps/customer-app/src/contexts/AuthContext.tsx';
const APP_ROUTE_FILE =
  '/repo/apps/customer-app/src/app/settings/page.tsx';
const SERVER_API_FILE =
  '/repo/apps/customer-app/src/app/api/foo/route.ts';
const SERVICES_FILE = '/repo/services/api-gateway/src/index.ts';
const PACKAGES_FILE = '/repo/packages/api-client/src/client.ts';
const SERVER_COMPONENT_FILE =
  '/repo/apps/customer-app/src/app/page.server.tsx';
const TEST_FILE =
  '/repo/apps/customer-app/src/components/__tests__/FeedbackThumbs.test.tsx';
const E2E_FILE = '/repo/e2e/customer-app/checkout.spec.ts';

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: {
      ecmaFeatures: { jsx: true },
    },
  },
});

ruleTester.run('require-csrf-headers', rule, {
  valid: [
    // 1. Client file with proper CSRF import + spread.
    {
      filename: CLIENT_FILE,
      code: `
        import { getCsrfHeaders } from '@/lib/csrf';
        async function submit() {
          await fetch('/api/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
            body: JSON.stringify({ rating: 5 }),
          });
        }
      `,
    },

    // 2. Client file using relative path import for the helper.
    {
      filename: CLIENT_FILE,
      code: `
        import { getCsrfHeaders } from '../../lib/csrf';
        fetch('/api/x', { method: 'PATCH', headers: { ...getCsrfHeaders() } });
      `,
    },

    // 3. Client file using @borjie/api-client (interceptor handles CSRF).
    //    Even raw fetch with no helper passes when this import is present.
    {
      filename: CLIENT_FILE,
      code: `
        import { ApiClient } from '@borjie/api-client';
        const c = new ApiClient();
        fetch('/api/x', { method: 'POST', headers: {} });
      `,
    },

    // 4. Client file with a GET fetch — no mutation, no CSRF needed.
    {
      filename: CLIENT_FILE,
      code: `
        async function load() {
          const r = await fetch('/api/feedback', { method: 'GET' });
          return r.json();
        }
      `,
    },

    // 5. Client file with fetch but no options at all (defaults to GET).
    {
      filename: CLIENT_FILE,
      code: `await fetch('/api/feedback');`,
    },

    // 6. Server-side: services/ never linted.
    {
      filename: SERVICES_FILE,
      code: `fetch('/api/x', { method: 'POST', headers: {} });`,
    },

    // 7. Server-side: packages/ never linted.
    {
      filename: PACKAGES_FILE,
      code: `fetch('/api/x', { method: 'DELETE' });`,
    },

    // 8. App Router server route handler.
    {
      filename: SERVER_API_FILE,
      code: `fetch('http://upstream/x', { method: 'POST' });`,
    },

    // 9. .server.tsx suffix.
    {
      filename: SERVER_COMPONENT_FILE,
      code: `fetch('http://upstream/x', { method: 'PUT' });`,
    },

    // 10. Test file.
    {
      filename: TEST_FILE,
      code: `fetch('/api/x', { method: 'POST' });`,
    },

    // 11. E2E file.
    {
      filename: E2E_FILE,
      code: `fetch('/api/x', { method: 'POST' });`,
    },

    // 12. Not a fetch() — it's an axios call. We only police global fetch.
    {
      filename: CLIENT_FILE,
      code: `axios.post('/api/x', { foo: 'bar' });`,
    },

    // 13. Dynamic method (variable) — intentionally NOT reported. Static
    //     analysis can't prove mutation; we defer to type system / review.
    {
      filename: CLIENT_FILE,
      code: `
        const method = 'POST';
        fetch('/api/x', { method, headers: {} });
      `,
    },

    // 14. CSRF import declared AFTER the fetch site — Program:exit
    //     ordering means we still treat the file as protected. (Imports
    //     are hoisted by spec, so this mirrors actual runtime behavior.)
    {
      filename: CLIENT_FILE,
      code: `
        fetch('/api/x', { method: 'POST', headers: { ...getCsrfHeaders() } });
        import { getCsrfHeaders } from '@/lib/csrf';
      `,
    },
  ],

  invalid: [
    // POST without CSRF in a component.
    {
      filename: CLIENT_FILE,
      code: `fetch('/api/x', { method: 'POST', headers: {} });`,
      errors: [{ messageId: 'missingCsrf', data: { method: 'POST' } }],
    },

    // PUT in a hook.
    {
      filename: CLIENT_HOOK_FILE,
      code: `fetch('/api/x', { method: 'PUT', body: '{}' });`,
      errors: [{ messageId: 'missingCsrf', data: { method: 'PUT' } }],
    },

    // PATCH in a context.
    {
      filename: CONTEXT_FILE,
      code: `fetch('/api/x', { method: 'PATCH' });`,
      errors: [{ messageId: 'missingCsrf', data: { method: 'PATCH' } }],
    },

    // DELETE in an App Router page.
    {
      filename: APP_ROUTE_FILE,
      code: `fetch('/api/x', { method: 'DELETE' });`,
      errors: [{ messageId: 'missingCsrf', data: { method: 'DELETE' } }],
    },

    // Lowercase `post` should still trigger (the rule upper-cases).
    {
      filename: CLIENT_FILE,
      code: `fetch('/api/x', { method: 'post' });`,
      errors: [{ messageId: 'missingCsrf', data: { method: 'POST' } }],
    },

    // Importing from @/lib/csrf WITHOUT `getCsrfHeaders` specifier
    // (e.g. just types or unrelated helper) should NOT count as
    // protection.
    {
      filename: CLIENT_FILE,
      code: `
        import type { CsrfToken } from '@/lib/csrf';
        fetch('/api/x', { method: 'POST', headers: {} });
      `,
      errors: [{ messageId: 'missingCsrf', data: { method: 'POST' } }],
    },

    // Multiple violations in the same file all surface.
    {
      filename: CLIENT_FILE,
      code: `
        fetch('/api/x', { method: 'POST' });
        fetch('/api/y', { method: 'DELETE' });
      `,
      errors: [
        { messageId: 'missingCsrf', data: { method: 'POST' } },
        { messageId: 'missingCsrf', data: { method: 'DELETE' } },
      ],
    },
  ],
});

// RuleTester throws on failure; reaching this line means every case
// matched. Print a small banner so CI logs are unambiguous.
// eslint-disable-next-line no-console
console.log('require-csrf-headers: all cases passed');
