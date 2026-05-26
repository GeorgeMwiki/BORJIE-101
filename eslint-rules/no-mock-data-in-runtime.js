/**
 * ESLint custom rule: `borjie/no-mock-data-in-runtime`
 *
 * Wave 18Z — live-test discipline. Refuses mock-data shapes in runtime
 * source. The product is positioned as a 24/7 managing director the
 * owner trusts with mutation authority; a managing director that makes
 * up data is worse than one that admits uncertainty.
 *
 * Reads from Docs/DESIGN/CUSTOMER_GEO_ROUTING_AND_SCOPE_LOGIN.md §A.
 *
 * What it catches
 * ---------------
 *   1. Variable / function exports whose name matches:
 *        /^MOCK_/, /^FAKE_/, /^STUB_/, /^FIXTURE_/, /^DEMO_/
 *      WHEN the export's value is an array, object, or function. A bare
 *      string constant named e.g. `MOCK_HEADER = 'X-Mock-Header'` or
 *      `DEMO_TENANT_ID = 'demo-tenant'` is legitimate (HTTP header name
 *      / tenant prefix) and NOT flagged — only structured fabricated
 *      data trips the rule.
 *
 *   2. Imports of files whose path matches:
 *        *-mock.ts, *-mocks.ts, *-stub.ts, *-stubs.ts,
 *        *-recorded.ts, *-fixture.ts, *-fixtures.ts
 *      from non-test code. Test paths (__tests__/, *.test.*, *.spec.*,
 *      *.stories.*, e2e/) are allowlisted.
 *
 *   3. Calls to functions named:
 *        mockFetch, mockResponse, recordedResponse, stubLLM
 *
 *   4. Object literal property keys named:
 *        recordedResponses, mockData, fakeRows, stubData
 *
 * Allowed locations (rule short-circuits)
 * ---------------------------------------
 *   - `**\/__tests__/**`
 *   - `**\/__fixtures__/**`
 *   - `**\/fixtures/**`
 *   - `**\/stories/**` (storybook companion utilities)
 *   - `**\/seeds/**` (operator-gated DB seed scripts)
 *   - `**\/*.test.[cm]?[jt]sx?$`
 *   - `**\/*.spec.[cm]?[jt]sx?$`
 *   - `**\/*.stories.[cm]?[jt]sx?$`
 *   - `**\/e2e/**`
 *   - `**\/*.md` (documentation)
 *
 * Severity in `eslint.config.mjs`: `error`. Wave 18Z-cleanup (SCRUB-3)
 * closed every runtime violation; the rule now fails the build on
 * any regression so the live-test discipline holds as a structural
 * invariant.
 */
'use strict';

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const FORBIDDEN_NAME_RE = /^(MOCK|FAKE|STUB|FIXTURE|DEMO)_/;
const FORBIDDEN_IMPORT_RE = /(?:-mocks?|-stubs?|-recorded|-fixtures?)(?:\.[cm]?[jt]sx?)?$/;
const FORBIDDEN_FUNCTIONS = new Set([
  'mockFetch',
  'mockResponse',
  'recordedResponse',
  'stubLLM',
]);
const FORBIDDEN_OBJECT_KEYS = new Set([
  'recordedResponses',
  'mockData',
  'fakeRows',
  'stubData',
]);

const ALLOWLIST_PATH_RE = [
  /\/__tests__\//,
  /\/__fixtures__\//,
  /\/fixtures\//,
  /\.test\.[cm]?[jt]sx?$/,
  /\.spec\.[cm]?[jt]sx?$/,
  /\.stories\.[cm]?[jt]sx?$/,
  // Storybook companion utilities — `*.stories.tsx` siblings under a
  // `stories/` directory share the same intent (visual demos, never
  // shipped to a production user surface).
  /\/stories\//,
  /^e2e\//,
  /\/e2e\//,
  // Database seed scripts — `packages/database/src/seeds/*` define the
  // demo tenant baseline that operators wipe before going live. The
  // seed runner is gated behind explicit `pnpm db:seed:demo`, not a
  // production request path.
  /\/seeds\//,
  /\.md$/,
  // The rule itself + its tests.
  /eslint-rules\//,
  // Type declarations from upstream packages (e.g. undici-types
  // mock-errors.d.ts). They are types, not runtime code.
  /\.d\.ts$/,
  // node_modules
  /\/node_modules\//,
];

function isAllowlisted(filename) {
  if (!filename || filename === '<input>' || filename === '<text>') {
    return true;
  }
  for (const re of ALLOWLIST_PATH_RE) {
    if (re.test(filename)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Classifiers
// ---------------------------------------------------------------------------

/**
 * The forbidden-name rule applies only when the bound value is a
 * structured value (array / object / arrow / function). A scalar
 * string constant named e.g. `MOCK_HEADER = 'X-Mock-Header'` is the
 * name of an HTTP header — keep it.
 */
function valueIsStructured(node) {
  if (!node) return false;
  switch (node.type) {
    case 'ArrayExpression':
    case 'ObjectExpression':
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
    case 'ClassExpression':
      return true;
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSTypeAssertion':
      return valueIsStructured(node.expression);
    case 'CallExpression':
      // `MOCK_THINGS = createMocks(...)` style.
      return true;
    case 'NewExpression':
      return true;
    default:
      return false;
  }
}

function* iterateExportedIdentifiers(node) {
  // export const X = ...
  if (node.type === 'ExportNamedDeclaration' && node.declaration) {
    const d = node.declaration;
    if (d.type === 'VariableDeclaration') {
      for (const decl of d.declarations) {
        if (decl.id && decl.id.type === 'Identifier') {
          yield { idNode: decl.id, valueNode: decl.init };
        }
      }
      return;
    }
    if (d.type === 'FunctionDeclaration' && d.id && d.id.type === 'Identifier') {
      // function expressions are always structured.
      yield { idNode: d.id, valueNode: d };
      return;
    }
    if (d.type === 'ClassDeclaration' && d.id && d.id.type === 'Identifier') {
      yield { idNode: d.id, valueNode: d };
      return;
    }
  }
  // export { X, Y }
  if (node.type === 'ExportNamedDeclaration' && node.specifiers) {
    for (const spec of node.specifiers) {
      if (
        spec.exported &&
        spec.exported.type === 'Identifier' &&
        spec.local &&
        spec.local.type === 'Identifier'
      ) {
        yield { idNode: spec.exported, valueNode: null };
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Rule
// ---------------------------------------------------------------------------

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow MOCK_/FAKE_/STUB_/FIXTURE_ data in runtime source. Test fixtures must live under __tests__/, *.test.*, *.stories.*, or e2e/.',
      recommended: false,
    },
    schema: [],
    messages: {
      mockExport:
        "Mock-data export '{{ name }}' in runtime source. Move to a __tests__/ file or rename if the value is a non-mock constant (e.g. an HTTP header name).",
      mockImport:
        "Import from '{{ source }}' in runtime source. Files matching *-mock(s)/*-stub(s)/*-recorded/*-fixture(s) are reserved for tests; move the consumer under __tests__/ or replace with a real implementation.",
      mockCall:
        "Call to '{{ name }}' in runtime source. Mock-data helpers must not run in production code paths.",
      mockObjectKey:
        "Object literal property '{{ name }}' in runtime source. Keys like recordedResponses / mockData / fakeRows / stubData declare test intent in production code.",
    },
  },

  create(context) {
    const filename =
      typeof context.getFilename === 'function'
        ? context.getFilename()
        : context.filename;
    if (isAllowlisted(filename)) {
      return {};
    }

    return {
      // ---- Forbidden export names ---------------------------------------
      ExportNamedDeclaration(node) {
        for (const { idNode, valueNode } of iterateExportedIdentifiers(node)) {
          if (!FORBIDDEN_NAME_RE.test(idNode.name)) continue;
          if (valueNode && !valueIsStructured(valueNode)) continue;
          context.report({
            node: idNode,
            messageId: 'mockExport',
            data: { name: idNode.name },
          });
        }
      },

      // ---- Forbidden imports --------------------------------------------
      ImportDeclaration(node) {
        const src = node.source && node.source.value;
        if (typeof src !== 'string') return;
        if (FORBIDDEN_IMPORT_RE.test(src)) {
          context.report({
            node: node.source,
            messageId: 'mockImport',
            data: { source: src },
          });
        }
      },

      // ---- Forbidden function calls -------------------------------------
      CallExpression(node) {
        const callee = node.callee;
        if (!callee) return;
        if (callee.type === 'Identifier' && FORBIDDEN_FUNCTIONS.has(callee.name)) {
          context.report({
            node: callee,
            messageId: 'mockCall',
            data: { name: callee.name },
          });
          return;
        }
        if (
          callee.type === 'MemberExpression' &&
          callee.property &&
          callee.property.type === 'Identifier' &&
          FORBIDDEN_FUNCTIONS.has(callee.property.name)
        ) {
          context.report({
            node: callee.property,
            messageId: 'mockCall',
            data: { name: callee.property.name },
          });
        }
      },

      // ---- Forbidden object literal keys --------------------------------
      Property(node) {
        const key = node.key;
        if (!key) return;
        let name = null;
        if (key.type === 'Identifier') {
          name = key.name;
        } else if (key.type === 'Literal' && typeof key.value === 'string') {
          name = key.value;
        }
        if (!name) return;
        if (!FORBIDDEN_OBJECT_KEYS.has(name)) return;
        context.report({
          node: key,
          messageId: 'mockObjectKey',
          data: { name },
        });
      },
    };
  },
};
