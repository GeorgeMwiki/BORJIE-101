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
const noNonTokenStyle = require('./no-non-token-style.js');
const noNonTokenInDocTemplate = require('./no-non-token-in-doc-template.js');
const noMockDataInRuntime = require('./no-mock-data-in-runtime.js');

module.exports = {
  rules: {
    'no-jurisdictional-literal': noJurisdictionalLiteral,
    'require-csrf-headers': requireCsrfHeaders,
    // Phase 2 brand-DNA enforcement.
    // - no-non-token-style: rejects raw color / spacing / font literals
    //   on every brand-locked UI surface (genui, chat-ui, design-system,
    //   marketing/owner-web/admin-web apps). See
    //   `docs/DESIGN/ANTICIPATORY_UX_SPEC.md` §6.
    // - no-non-token-in-doc-template: same rejection set scoped to the
    //   document-template package + any `*-brander.ts` / `*-recipe.ts`
    //   file. Also scans embedded HTML/CSS string literals. See
    //   `docs/DESIGN/DOCUMENT_COMPOSITION_SPEC.md` §3 Layer 3.
    'no-non-token-style': noNonTokenStyle,
    'no-non-token-in-doc-template': noNonTokenInDocTemplate,
    // Wave 18Z-cleanup (SCRUB-3): live-test discipline. No
    // MOCK_/FAKE_/STUB_/FIXTURE_/DEMO_ prefixed structured data, no
    // *-mock/*-stub/*-recorded/*-fixture imports, and no
    // mockFetch / recordedResponse calls / mockData object keys in
    // runtime source. Test fixtures live under __tests__/,
    // __fixtures__/, fixtures/, *.test.*, *.spec.*, *.stories.*,
    // stories/, or e2e/. See
    // `Docs/DESIGN/CUSTOMER_GEO_ROUTING_AND_SCOPE_LOGIN.md` §A.
    'no-mock-data-in-runtime': noMockDataInRuntime,
  },
};
