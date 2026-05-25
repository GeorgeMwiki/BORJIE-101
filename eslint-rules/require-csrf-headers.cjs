/**
 * ESLint Rule: `borjie/require-csrf-headers`
 *
 * Ported from LITFIN's `require-csrf-headers` rule and adapted to
 * BORJIE's multi-app monorepo layout.
 *
 * What it does
 * ------------
 * Warns when a client-side (browser-facing) file makes a mutating
 * `fetch(url, { method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' | ... })`
 * call without one of the BORJIE-blessed CSRF mechanisms in scope:
 *
 *   1. A named import `getCsrfHeaders` from `@/lib/csrf`, `~/lib/csrf`,
 *      `../lib/csrf`, or any matching relative path. The companion
 *      helper lives at `apps/customer-app/src/lib/csrf.ts` (created in
 *      the same PR as this rule) — other apps may add their own helper
 *      under `src/lib/csrf.ts` and the rule will pick it up by name.
 *   2. Any import from `@borjie/api-client` (the typed client
 *      threads CSRF via a request interceptor — direct fetch is unsafe
 *      but using the client is fine).
 *
 * Scope (the rule only runs on these file paths)
 * ----------------------------------------------
 *   - `apps/*\/src/app/**`         (Next.js App-Router pages / layouts)
 *   - `apps/*\/src/components/**`  (React components, client by default)
 *   - `apps/*\/src/contexts/**`    (React Contexts, client)
 *   - `apps/*\/src/screens/**`     (legacy customer-app screens)
 *   - `apps/*\/src/features/**`    (feature folders if/when adopted)
 *   - `apps/*\/src/hooks/**`       (client hooks)
 *
 * NEVER runs on
 * -------------
 *   - `apps/*\/src/app/api/**`              (Next.js server route handlers)
 *   - `apps/*\/src/app/**\/route.{ts,tsx}`  (any App-Router route handler)
 *   - `apps/*\/src/lib/**`                  (utility libs — could be either,
 *                                            but we treat them as server-safe
 *                                            and they don't host UI POSTs)
 *   - `services/**`                         (server-side gateway / workers)
 *   - `packages/**`                         (shared libraries — the api-client
 *                                            handles CSRF centrally)
 *   - any `*.test.*`, `*.spec.*`, `**\/__tests__\/**`, `**\/e2e\/**` file
 *   - any file with `.server.{ts,tsx}` suffix (Next.js server-component
 *     convention)
 *
 * Severity
 * --------
 * Wired as `warn` in `eslint.config.mjs` so existing call-sites surface
 * in CI without blocking the build. Flip to `error` once the existing
 * violations are migrated.
 */

'use strict';

// ---------------------------------------------------------------------------
// Path classification
// ---------------------------------------------------------------------------

const CLIENT_DIR_PATTERNS = [
  /\/apps\/[^/]+\/src\/app\//,
  /\/apps\/[^/]+\/src\/components\//,
  /\/apps\/[^/]+\/src\/contexts\//,
  /\/apps\/[^/]+\/src\/screens\//,
  /\/apps\/[^/]+\/src\/features\//,
  /\/apps\/[^/]+\/src\/hooks\//,
];

// Server-side path fragments that override the client classification
// when matched. Order matters here only conceptually — any one match
// disqualifies the file.
const SERVER_PATH_FRAGMENTS = [
  '/app/api/',
  '/route.ts',
  '/route.tsx',
  '/route.js',
  '/route.jsx',
  '/services/',
  '/packages/',
  '.server.ts',
  '.server.tsx',
];

const TEST_PATH_FRAGMENTS = [
  '.test.',
  '.spec.',
  '/__tests__/',
  '/e2e/',
  '/tests/',
];

/**
 * Decide whether a file should be linted by this rule. A file qualifies
 * iff it sits inside a `CLIENT_DIR_PATTERNS` directory AND it does NOT
 * match any of the server / test exclusion fragments.
 *
 * Normalizes path separators so the rule behaves identically on macOS,
 * Linux, and Windows (Windows tests pass `\\` but ESLint always reports
 * filenames with `/` post-normalization — we still defensively swap).
 */
function isClientFile(rawFilename) {
  if (!rawFilename) return false;
  if (rawFilename === '<input>' || rawFilename === '<text>') return false;

  const filename = rawFilename.replace(/\\/g, '/');

  for (const fragment of TEST_PATH_FRAGMENTS) {
    if (filename.includes(fragment)) return false;
  }
  for (const fragment of SERVER_PATH_FRAGMENTS) {
    if (filename.includes(fragment)) return false;
  }
  for (const pattern of CLIENT_DIR_PATTERNS) {
    if (pattern.test(filename)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// CSRF import detection
// ---------------------------------------------------------------------------

// Accept any specifier that ends in `/lib/csrf` (relative paths) or
// the path-aliased forms `@/lib/csrf` / `~/lib/csrf`. The helper file
// itself lives at apps/customer-app/src/lib/csrf.ts; other apps may
// add their own under the same name and the rule will accept it.
const CSRF_HELPER_PATTERNS = [
  /^@\/lib\/csrf$/,
  /^~\/lib\/csrf$/,
  /(^|\/)lib\/csrf$/, // matches `./lib/csrf`, `../lib/csrf`, `../../lib/csrf`
];

const API_CLIENT_PACKAGE = '@borjie/api-client';

function importMatchesCsrfHelper(specifier) {
  if (typeof specifier !== 'string') return false;
  return CSRF_HELPER_PATTERNS.some((re) => re.test(specifier));
}

function importsGetCsrfHeaders(node) {
  if (!Array.isArray(node.specifiers)) return false;
  return node.specifiers.some((spec) => {
    if (spec.type === 'ImportDefaultSpecifier') return true;
    if (spec.type === 'ImportNamespaceSpecifier') return true;
    if (
      spec.type === 'ImportSpecifier' &&
      spec.imported &&
      spec.imported.type === 'Identifier' &&
      spec.imported.name === 'getCsrfHeaders'
    ) {
      return true;
    }
    return false;
  });
}

// ---------------------------------------------------------------------------
// fetch() inspection
// ---------------------------------------------------------------------------

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Pull the literal string value out of an ObjectExpression property whose
 * key is `method`. Returns the upper-cased method string or null when:
 *   - the property is absent,
 *   - the property is a spread / computed key we can't statically resolve,
 *   - the value isn't a literal (e.g. `method: someVariable`) — we err on
 *     the side of NOT reporting to keep false-positive rate low.
 */
function resolveMethodLiteral(optionsNode) {
  if (!optionsNode || optionsNode.type !== 'ObjectExpression') return null;

  for (const prop of optionsNode.properties) {
    if (prop.type !== 'Property') continue;
    if (prop.computed) continue;
    const keyName =
      prop.key.type === 'Identifier'
        ? prop.key.name
        : prop.key.type === 'Literal'
          ? String(prop.key.value)
          : null;
    if (keyName !== 'method') continue;

    if (prop.value.type === 'Literal' && typeof prop.value.value === 'string') {
      return prop.value.value.toUpperCase();
    }
    if (
      prop.value.type === 'TemplateLiteral' &&
      prop.value.expressions.length === 0 &&
      prop.value.quasis.length === 1
    ) {
      const cooked = prop.value.quasis[0].value.cooked;
      if (typeof cooked === 'string') return cooked.toUpperCase();
    }
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rule implementation
// ---------------------------------------------------------------------------

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require getCsrfHeaders() (or the @borjie/api-client wrapper) on mutating fetch() calls from client files.',
      category: 'Security',
      recommended: true,
    },
    messages: {
      missingCsrf:
        "Mutating fetch() call ({{method}}) without CSRF protection. " +
        "Either import { getCsrfHeaders } from '@/lib/csrf' and spread " +
        '...getCsrfHeaders() into headers, or use the typed client at ' +
        "'@borjie/api-client' which threads CSRF via interceptor.",
    },
    schema: [],
  },

  create(context) {
    const filename =
      typeof context.getFilename === 'function'
        ? context.getFilename()
        : context.filename;

    if (!isClientFile(filename)) return {};

    let hasCsrfImport = false;
    /** @type {Array<{ node: any, method: string }>} */
    const pendingViolations = [];

    return {
      ImportDeclaration(node) {
        const source =
          node.source && typeof node.source.value === 'string'
            ? node.source.value
            : '';

        if (source === API_CLIENT_PACKAGE) {
          hasCsrfImport = true;
          return;
        }
        if (importMatchesCsrfHelper(source) && importsGetCsrfHeaders(node)) {
          hasCsrfImport = true;
        }
      },

      CallExpression(node) {
        if (
          node.callee.type !== 'Identifier' ||
          node.callee.name !== 'fetch'
        ) {
          return;
        }

        const optionsArg = node.arguments[1];
        const method = resolveMethodLiteral(optionsArg);
        if (!method || !MUTATING_METHODS.has(method)) return;

        // Defer reporting until program exit so imports declared AFTER
        // the fetch call still count. ESLint doesn't strictly require
        // this for top-level ESM imports (they're hoisted by spec), but
        // visitor order on a flat AST walk is top-to-bottom and we'd
        // otherwise miss legitimate imports lower in the file.
        pendingViolations.push({ node, method });
      },

      'Program:exit'() {
        if (hasCsrfImport) return;
        for (const { node, method } of pendingViolations) {
          context.report({
            node,
            messageId: 'missingCsrf',
            data: { method },
          });
        }
      },
    };
  },
};
