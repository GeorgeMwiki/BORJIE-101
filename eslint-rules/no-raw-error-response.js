/**
 * ESLint custom rule: `no-raw-error-response`
 *
 * Prevents regression of the deep-audit 2026-05-20 (HIGH) finding: the
 * api-gateway emitted FOUR different error envelope shapes, so clients
 * could not write a single parser. The canonical shape is now produced
 * by `services/api-gateway/src/utils/error-response.ts`:
 *
 *   { success: false, error: { code, message, details? }, meta: { ... } }
 *
 * This rule flags raw `c.json({ error: ... }, status)` and
 * `c.json({ success: false, error: ... }, status)` calls inside the
 * gateway routes layer, and points the author at the helper.
 *
 * Why a rule + not just docs:
 *   - 100+ route files; a docs-only convention drifts in <2 weeks.
 *   - The drift was the actual cause of the audit finding.
 *
 * Scope: warns by default so existing call-sites we can't auto-migrate
 * (centralized error handlers in `middleware/error-envelope.ts`, the
 * brain.hono.ts streaming `handleError` helper) don't block CI. Promote
 * to `error` once the K-followup / M-owned routes also adopt the helper.
 *
 * Whitelisted (rule is skipped):
 *   - `services/api-gateway/src/utils/error-response.ts` itself
 *   - `services/api-gateway/src/middleware/**` (central handlers)
 *   - `services/api-gateway/src/utils/safe-error.ts` (legacy compat shim)
 *   - any `**\/__tests__\/**` file
 *
 * Allowed forms (NOT flagged):
 *   - `errorResponse(c, ...)`, `e400(...)`, `e404(...)`, `e500(...)`, etc.
 *   - `c.json({ success: true, ... }, ...)` — non-error responses
 *   - `c.json({ data: ... }, ...)` — non-error responses
 *
 * Flagged (now covering the full set of error statuses we emit, including
 * 502 Bad Gateway and 504 Gateway Timeout — see DA1 2026-05-21):
 *   - `c.json({ error: '...' }, 400)`
 *   - `c.json({ error: { code, message } }, 401)`
 *   - `c.json({ success: false, error: '...' }, 403)`
 *   - `c.json({ success: false, error: { code, message } }, 404)`
 *   - `c.json({ error: '...' }, 409 | 422 | 429)`
 *   - `c.json({ error: '...' }, 500 | 502 | 503 | 504)`
 *
 * The shape-based detection (looksLikeErrorBody) is status-agnostic, so
 * any raw error envelope is caught regardless of the numeric status code
 * the route writes. We enumerate the codes above as a reminder that 502
 * and 504 are equally in-scope — there are matching `e502` and `e504`
 * helpers.
 */
'use strict';

const path = require('path');

const ALLOWED_FILES = [
  // The helper itself emits `c.json({...})` — that's the canonical impl.
  /services\/api-gateway\/src\/utils\/error-response\.(t|j)s$/,
  // Centralized envelope handlers and the legacy `routeCatch` helper.
  /services\/api-gateway\/src\/middleware\//,
  /services\/api-gateway\/src\/utils\/safe-error\.(t|j)s$/,
  // Tests routinely fabricate the shape under test.
  /__tests__\//,
  /\.test\.(t|j)sx?$/,
];

function isAllowedFile(filename) {
  if (!filename) return true;
  return ALLOWED_FILES.some((re) => re.test(filename));
}

/**
 * Does this ObjectExpression look like an error response body?
 *
 * We return `true` when either:
 *   - it has an `error:` property (any value), OR
 *   - it has both `success: false` AND any other property (likely the
 *     `error` field).
 *
 * Returning false for `{ success: true, data: ... }` is the explicit
 * non-error case we want to keep allowed.
 */
function looksLikeErrorBody(node) {
  if (!node || node.type !== 'ObjectExpression') return false;
  let hasErrorKey = false;
  let hasSuccessFalse = false;
  for (const prop of node.properties) {
    if (prop.type !== 'Property') continue;
    const keyName =
      prop.key.type === 'Identifier'
        ? prop.key.name
        : prop.key.type === 'Literal'
          ? String(prop.key.value)
          : null;
    if (keyName === 'error') hasErrorKey = true;
    if (
      keyName === 'success' &&
      prop.value.type === 'Literal' &&
      prop.value.value === false
    ) {
      hasSuccessFalse = true;
    }
  }
  return hasErrorKey || hasSuccessFalse;
}

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow raw c.json({error: ...}) — use error-response.ts helpers instead.',
      recommended: false,
    },
    schema: [],
    messages: {
      rawError:
        'Use the canonical error helper (errorResponse / e400 / e401 / e403 / e404 / e409 / e422 / e429 / e500 / e502 / e503 / e504 from src/utils/error-response.ts) instead of raw `c.json({ error: ... })`. This keeps every error response on the same shape so clients can write a single parser, and routes the body through redactDetails() which strips Error stacks and secret-shaped keys.',
    },
  },

  create(context) {
    const filename = context.getFilename
      ? context.getFilename()
      : context.filename;
    if (isAllowedFile(filename)) {
      return {};
    }

    // Only lint files under services/api-gateway/src/routes/.
    const normalized = filename.replace(/\\/g, '/');
    if (!/services\/api-gateway\/src\/routes\//.test(normalized)) {
      return {};
    }

    return {
      CallExpression(node) {
        // Match `c.json(...)` calls.
        const callee = node.callee;
        if (
          callee.type !== 'MemberExpression' ||
          callee.property.type !== 'Identifier' ||
          callee.property.name !== 'json'
        ) {
          return;
        }
        const obj = callee.object;
        if (obj.type !== 'Identifier' || obj.name !== 'c') return;

        const firstArg = node.arguments[0];
        if (!firstArg) return;
        if (looksLikeErrorBody(firstArg)) {
          context.report({ node, messageId: 'rawError' });
        }
      },
    };
  },
};
