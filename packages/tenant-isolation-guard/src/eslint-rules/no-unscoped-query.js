/**
 * ESLint rule: `tenant-isolation/no-unscoped-query`
 *
 * Flags Drizzle queries that do not visibly carry a `tenant_id`
 * constraint in their call expression OR a nearby `.where(...)`
 * chain. Specifically:
 *
 *   - `db.select().from(table)` without a sibling `.where(...)`
 *     mentioning `tenant_id` => error.
 *   - `db.update(table).set(...)` without a sibling `.where(...)`
 *     mentioning `tenant_id` => error.
 *   - `db.delete(table)` without a sibling `.where(...)` mentioning
 *     `tenant_id` => error.
 *   - `sql\`...${userInput}...\`` template literals that include
 *     an interpolation but no `tenant_id` token => error.
 *
 * Files in `__tests__/`, `__fixtures__/`, `.test.ts`, `.spec.ts`,
 * `packages/observability/`, `packages/audit-hash-chain/`, and
 * `packages/database/src/rls/` are skipped.
 *
 * Persona: Mr. Mwikila, SEC-1.
 */
'use strict';

const SKIPPED_PATH_SUBSTRINGS = [
  '/__tests__/',
  '/__fixtures__/',
  '/fixtures/',
  '.test.ts',
  '.spec.ts',
  '.stories.ts',
  '/packages/observability/',
  '/packages/audit-hash-chain/',
  '/packages/database/src/rls/',
  '/packages/database/src/migrations/',
  '/packages/database/src/schemas/',
  '/packages/database/src/seeds/',
  '/packages/config/',
  '/packages/feature-flags-adapter/',
  '/packages/skill-library/',
  '/packages/central-intelligence/src/corpus-loader',
  '/dist/',
  '/build/',
];

function isSkipped(filename) {
  if (!filename) return false;
  return SKIPPED_PATH_SUBSTRINGS.some((s) => filename.includes(s));
}

function chainHasTenantWhere(node) {
  // Walk up + sideways across a chained CallExpression looking for
  // a .where() call whose argument-source contains "tenant_id" or
  // "tenantId".
  let cur = node;
  for (let depth = 0; depth < 6 && cur; depth += 1) {
    if (
      cur.type === 'CallExpression' &&
      cur.callee &&
      cur.callee.type === 'MemberExpression' &&
      cur.callee.property &&
      cur.callee.property.name === 'where'
    ) {
      const arg = cur.arguments && cur.arguments[0];
      if (arg && containsTenantToken(arg)) return true;
    }
    cur = cur.parent;
  }
  return false;
}

function containsTenantToken(node) {
  if (!node) return false;
  const src = JSON.stringify(node, (key, val) => {
    if (key === 'parent') return undefined;
    if (key === 'loc') return undefined;
    if (key === 'range') return undefined;
    if (key === 'start') return undefined;
    if (key === 'end') return undefined;
    return val;
  });
  return /tenant[_-]?[iI]d/.test(src);
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'require every Drizzle mutator/query to carry a tenant_id WHERE clause',
      recommended: true,
    },
    schema: [],
    messages: {
      missingTenantWhere:
        '{{op}}() on a tenant-scoped table must be paired with .where(eq(table.tenant_id, ctx.tenantId)); route through @borjie/tenant-isolation-guard tenantAwareQuery instead.',
      rawSqlWithInterpolation:
        'raw sql`` template with ${{expr}} interpolation and no tenant_id token — high risk of cross-tenant leak.',
    },
  },
  create(context) {
    const filename = context.getFilename();
    if (isSkipped(filename)) return {};

    return {
      CallExpression(node) {
        // db.select() / db.update() / db.delete() / db.insert()
        const callee = node.callee;
        if (
          callee &&
          callee.type === 'MemberExpression' &&
          callee.property &&
          ['select', 'update', 'delete', 'insert'].includes(callee.property.name) &&
          callee.object &&
          (callee.object.name === 'db' ||
            (callee.object.type === 'MemberExpression' &&
              callee.object.property &&
              callee.object.property.name === 'db'))
        ) {
          if (callee.property.name === 'insert') {
            // For insert we check that the values() argument
            // contains tenant_id. Walk up to find .values(...).
            let cur = node;
            for (let d = 0; d < 4 && cur; d += 1) {
              if (
                cur.type === 'CallExpression' &&
                cur.callee &&
                cur.callee.type === 'MemberExpression' &&
                cur.callee.property &&
                cur.callee.property.name === 'values'
              ) {
                const arg = cur.arguments && cur.arguments[0];
                if (arg && containsTenantToken(arg)) return;
              }
              cur = cur.parent;
            }
            context.report({
              node,
              messageId: 'missingTenantWhere',
              data: { op: 'db.insert' },
            });
            return;
          }
          if (!chainHasTenantWhere(node)) {
            context.report({
              node,
              messageId: 'missingTenantWhere',
              data: { op: `db.${callee.property.name}` },
            });
          }
        }
      },
      TaggedTemplateExpression(node) {
        if (
          node.tag &&
          node.tag.type === 'Identifier' &&
          node.tag.name === 'sql' &&
          node.quasi &&
          node.quasi.expressions &&
          node.quasi.expressions.length > 0
        ) {
          // any interpolation + no tenant_id mention anywhere in the
          // template => report
          const text = node.quasi.quasis
            .map((q) => q.value && q.value.raw)
            .join(' ');
          if (!/tenant[_-]?[iI]d/.test(text)) {
            context.report({
              node,
              messageId: 'rawSqlWithInterpolation',
              data: { expr: 'expr' },
            });
          }
        }
      },
    };
  },
};
