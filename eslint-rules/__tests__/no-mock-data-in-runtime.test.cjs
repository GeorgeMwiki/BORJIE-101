/**
 * Unit tests for `borjie/no-mock-data-in-runtime`.
 *
 * Coverage matrix (>= 10 invalid + >= 10 valid):
 *
 *   VALID
 *    - Bare string constant named MOCK_HEADER (not structured) — allowed
 *    - Plain runtime export with a non-mock name
 *    - Import from a non-mock file in runtime code
 *    - MOCK_PAYMENTS exported from a test file (path allowlist)
 *    - Recorded responses object in a __tests__/ file
 *    - mockFetch() call inside a *.spec.ts file
 *    - Object key `mockData` inside a *.stories.tsx file
 *    - .d.ts type declaration with `MOCK_CONST` — type files allowed
 *    - .md file containing forbidden patterns — docs allowlist
 *    - node_modules path — allowed
 *
 *   INVALID
 *    - Exported array MOCK_SITES from runtime fence.ts
 *    - Exported object FAKE_RECORDS from a service
 *    - Exported arrow function STUB_LLM_RESPONSES
 *    - FIXTURE_TENANT exported as CallExpression
 *    - Import from '../fixtures-mock' in runtime code
 *    - Import from './data-stubs' in runtime code
 *    - Import from './recorded-responses-recorded' in runtime code
 *    - mockFetch() call in runtime code
 *    - recordedResponse() member call in runtime code
 *    - Object literal with key `recordedResponses` in runtime code
 *    - Object literal with key `mockData` in runtime code
 */
'use strict';

const { RuleTester } = require('eslint');
const tsParser = require('@typescript-eslint/parser');
const rule = require('../no-mock-data-in-runtime.js');

const RUNTIME_FILE = '/repo/packages/customer-geo-routing/src/foo.ts';
const SERVICE_FILE = '/repo/services/api-gateway/src/middleware/x.ts';
const APP_FILE = '/repo/apps/buyer-mobile/src/lib/payments-data.ts';

// Allowlisted paths.
const TEST_FILE = '/repo/packages/customer-geo-routing/src/__tests__/x.test.ts';
const SPEC_FILE = '/repo/packages/customer-geo-routing/src/foo.spec.ts';
const STORY_FILE = '/repo/packages/design-system/src/Button.stories.tsx';
const STORIES_DIR_FILE =
  '/repo/packages/dynamic-sections/src/stories/utils.tsx';
const SEED_FILE = '/repo/packages/database/src/seeds/demo-org-seed.ts';
const DTS_FILE = '/repo/packages/types/src/foo.d.ts';
const NODE_MODULES_FILE =
  '/repo/node_modules/undici-types/mock-errors.d.ts';

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

ruleTester.run('no-mock-data-in-runtime', rule, {
  valid: [
    // 1. Bare string constant — HTTP header naming, not mock data.
    {
      filename: RUNTIME_FILE,
      code: "export const MOCK_HEADER = 'X-Mock-Market-Data';",
    },
    // 2. Plain runtime export with a non-mock name.
    {
      filename: RUNTIME_FILE,
      code: "export const buyers = [{ id: '1' }];",
    },
    // 3. Import from a non-mock file in runtime code.
    {
      filename: RUNTIME_FILE,
      code: "import { x } from './neighbour.js';",
    },
    // 4. MOCK_PAYMENTS exported from a test file.
    {
      filename: TEST_FILE,
      code: "export const MOCK_PAYMENTS = [{ id: '1' }];",
    },
    // 5. Recorded responses object in a __tests__/ file.
    {
      filename: TEST_FILE,
      code: "export const recordedResponses = { x: 1 };",
    },
    // 6. mockFetch() call inside a *.spec.ts file.
    {
      filename: SPEC_FILE,
      code: "mockFetch('/api/x');",
    },
    // 7. Object key `mockData` inside a *.stories.tsx file.
    {
      filename: STORY_FILE,
      code: "export const Story = { mockData: [] };",
    },
    // 8. .d.ts file — type declarations allowed.
    {
      filename: DTS_FILE,
      code: "export const MOCK_CONST: ReadonlyArray<string>;",
    },
    // 9. node_modules — allowed.
    {
      filename: NODE_MODULES_FILE,
      code: "export const MOCK_X = [];",
    },
    // 10. Non-flagged function call.
    {
      filename: RUNTIME_FILE,
      code: "fetch('/api/x');",
    },
    // 11. Scalar DEMO_TENANT_ID (string) — allowed, not structured.
    {
      filename: RUNTIME_FILE,
      code: "export const DEMO_TENANT_ID = 'demo-tenant';",
    },
    // 12. Scalar DEMO_TENANT_PREFIX with `as const` — allowed.
    {
      filename: RUNTIME_FILE,
      code: "export const DEMO_TENANT_PREFIX = 'demo_' as const;",
    },
    // 13. Structured DEMO_* inside a stories/ utility — allowed.
    {
      filename: STORIES_DIR_FILE,
      code: "export const DEMO_ROWS = [{ id: 'r1' }];",
    },
    // 14. Structured DEMO_* inside a seeds/ script — allowed.
    {
      filename: SEED_FILE,
      code: "const DEMO_REGIONS = { TZ: { tz: 'Africa/Dar_es_Salaam' } };",
    },
  ],

  invalid: [
    // 1. Exported array MOCK_SITES from runtime fence.ts
    {
      filename: '/repo/apps/workforce-mobile/src/location/fence.ts',
      code: "export const MOCK_SITES = [{ id: 'pit-1' }];",
      errors: [{ messageId: 'mockExport' }],
    },
    // 2. Exported object FAKE_RECORDS from a service.
    {
      filename: SERVICE_FILE,
      code: "export const FAKE_RECORDS = { count: 0 };",
      errors: [{ messageId: 'mockExport' }],
    },
    // 3. Exported arrow function STUB_LLM_RESPONSES.
    {
      filename: RUNTIME_FILE,
      code: "export const STUB_LLM_RESPONSES = () => [];",
      errors: [{ messageId: 'mockExport' }],
    },
    // 4. FIXTURE_TENANT exported as CallExpression.
    {
      filename: RUNTIME_FILE,
      code: "export const FIXTURE_TENANT = makeTenant();",
      errors: [{ messageId: 'mockExport' }],
    },
    // 5. Import from '*-mock' in runtime code.
    {
      filename: RUNTIME_FILE,
      code: "import { stuff } from '../fixtures-mock.js';",
      errors: [{ messageId: 'mockImport' }],
    },
    // 6. Import from '*-stubs' in runtime code.
    {
      filename: RUNTIME_FILE,
      code: "import { stuff } from './data-stubs.js';",
      errors: [{ messageId: 'mockImport' }],
    },
    // 7. Import from '*-recorded' in runtime code.
    {
      filename: RUNTIME_FILE,
      code: "import { stuff } from './responses-recorded.js';",
      errors: [{ messageId: 'mockImport' }],
    },
    // 8. mockFetch() call in runtime code.
    {
      filename: SERVICE_FILE,
      code: "mockFetch('/api/x');",
      errors: [{ messageId: 'mockCall' }],
    },
    // 9. recordedResponse member call in runtime code.
    {
      filename: APP_FILE,
      code: "client.recordedResponse('/api/x');",
      errors: [{ messageId: 'mockCall' }],
    },
    // 10. Object literal with key `recordedResponses` in runtime code.
    {
      filename: APP_FILE,
      code: "const config = { recordedResponses: [] };",
      errors: [{ messageId: 'mockObjectKey' }],
    },
    // 11. Object literal with key `mockData` in runtime code.
    {
      filename: APP_FILE,
      code: "const config = { mockData: [] };",
      errors: [{ messageId: 'mockObjectKey' }],
    },
    // 12. Exported array DEMO_JOIN_CODES in a runtime router file.
    {
      filename:
        '/repo/services/api-gateway/src/routes/marketplace/in-memory-data-port.ts',
      code: "export const DEMO_JOIN_CODES = [{ code: 'X' }];",
      errors: [{ messageId: 'mockExport' }],
    },
    // 13. Exported structured DEMO_RECORDS in a runtime app file.
    {
      filename: APP_FILE,
      code: "export const DEMO_RECORDS = { id: '1' };",
      errors: [{ messageId: 'mockExport' }],
    },
  ],
});

// Surface success for `node --test` integration.
console.log('PASS: no-mock-data-in-runtime — 14 valid + 13 invalid');
