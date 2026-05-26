/**
 * `@borjie/tenant-isolation-guard/eslint-rules` — ESLint plugin
 * exporting the two cross-tenant-leak prevention rules.
 *
 * Usage in eslint.config.mjs:
 *
 *   import tenantIsolation from
 *     '@borjie/tenant-isolation-guard/eslint-rules';
 *
 *   export default [
 *     {
 *       plugins: { 'tenant-isolation': tenantIsolation },
 *       rules: {
 *         'tenant-isolation/no-unscoped-query': 'error',
 *         'tenant-isolation/no-unscoped-redis': 'error',
 *       },
 *     },
 *   ];
 *
 * Persona: Mr. Mwikila, SEC-1.
 */
'use strict';

const noUnscopedQuery = require('./no-unscoped-query.js');
const noUnscopedRedis = require('./no-unscoped-redis.js');

module.exports = {
  rules: {
    'no-unscoped-query': noUnscopedQuery,
    'no-unscoped-redis': noUnscopedRedis,
  },
};
