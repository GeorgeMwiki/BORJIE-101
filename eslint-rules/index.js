/**
 * Local ESLint plugin bundling BORJIE-specific custom rules.
 *
 * Loaded by `eslint.config.mjs` as the `borjie` plugin. New rules
 * should be:
 *   1. Implemented in a sibling `<rule-name>.js` file.
 *   2. Exported here under `rules['<rule-name>']`.
 *   3. Documented in the rule file header + referenced from JURISDICTIONAL-RULES.md
 *      when relevant.
 */
'use strict';

const noJurisdictionalLiteral = require('./no-jurisdictional-literal.js');
const requireCsrfHeaders = require('./require-csrf-headers.cjs');

module.exports = {
  rules: {
    'no-jurisdictional-literal': noJurisdictionalLiteral,
    'require-csrf-headers': requireCsrfHeaders,
  },
};
