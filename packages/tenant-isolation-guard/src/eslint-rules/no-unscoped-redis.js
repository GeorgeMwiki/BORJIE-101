/**
 * ESLint rule: `tenant-isolation/no-unscoped-redis`
 *
 * Flags Redis ops where the key is not visibly tenant-prefixed.
 * A key is considered acceptable if its source mentions:
 *   - the literal `tenant:` prefix in a template literal, OR
 *   - the helper functions `tenantKey(`, `buildTenantKey(`,
 *     `tenantPrefixed(`, `TENANT_KEY`.
 *
 * Operations covered: set / get / del / hset / hget / hgetall /
 * expire / lpush / rpush / sadd / srem.
 *
 * Files in `__tests__/`, `__fixtures__/`, `.test.ts`, `.spec.ts`,
 * `packages/observability/`, `packages/config/`, and any
 * `bootstrap*.ts` are skipped.
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
  '/packages/config/',
  '/bootstrap',
  '/composition-root',
  '/dist/',
  '/build/',
];

const REDIS_OPS = new Set([
  'set',
  'get',
  'del',
  'hset',
  'hget',
  'hgetall',
  'expire',
  'lpush',
  'rpush',
  'sadd',
  'srem',
]);

function isSkipped(filename) {
  if (!filename) return false;
  return SKIPPED_PATH_SUBSTRINGS.some((s) => filename.includes(s));
}

function keyArgIsTenantScoped(arg) {
  if (!arg) return false;
  if (arg.type === 'TemplateLiteral') {
    const raw = arg.quasis.map((q) => q.value && q.value.raw).join('');
    if (raw.startsWith('tenant:')) return true;
    if (raw.includes('tenant:')) return true;
  }
  if (arg.type === 'Literal' && typeof arg.value === 'string') {
    if (arg.value.startsWith('tenant:')) return true;
  }
  if (arg.type === 'CallExpression' && arg.callee) {
    if (
      arg.callee.type === 'Identifier' &&
      ['tenantKey', 'buildTenantKey', 'tenantPrefixed', 'tenantScopedKey'].includes(
        arg.callee.name,
      )
    ) {
      return true;
    }
    if (
      arg.callee.type === 'MemberExpression' &&
      arg.callee.property &&
      ['tenantKey', 'buildTenantKey', 'tenantPrefixed'].includes(
        arg.callee.property.name,
      )
    ) {
      return true;
    }
  }
  if (arg.type === 'Identifier' && /tenant/i.test(arg.name)) return true;
  return false;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'require every Redis op to use a tenant-prefixed key',
      recommended: true,
    },
    schema: [],
    messages: {
      unprefixedKey:
        'redis.{{op}}() key is not visibly tenant-prefixed; use tenantKey(tenantId, "...") or wrap the client with wrapRedisWithTenantPrefix() from @borjie/tenant-isolation-guard.',
    },
  },
  create(context) {
    const filename = context.getFilename();
    if (isSkipped(filename)) return {};

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee &&
          callee.type === 'MemberExpression' &&
          callee.property &&
          REDIS_OPS.has(callee.property.name) &&
          callee.object &&
          (callee.object.name === 'redis' ||
            callee.object.name === 'redisClient' ||
            callee.object.name === 'cache' ||
            (callee.object.type === 'MemberExpression' &&
              callee.object.property &&
              (callee.object.property.name === 'redis' ||
                callee.object.property.name === 'cache')))
        ) {
          const keyArg = node.arguments && node.arguments[0];
          if (!keyArgIsTenantScoped(keyArg)) {
            context.report({
              node,
              messageId: 'unprefixedKey',
              data: { op: callee.property.name },
            });
          }
        }
      },
    };
  },
};
