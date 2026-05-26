/**
 * ESLint custom rule: `borjie/no-non-token-in-doc-template`
 *
 * Sibling enforcement to `borjie/no-non-token-style`, scoped to the
 * document-composition layer (`docs/DESIGN/DOCUMENT_COMPOSITION_SPEC.md`
 * Layer 3 — Brand-Locked Rendering). DOCX / PDF / PPTX / XLSX branders
 * frequently embed CSS, HTML, or color values as plain string literals
 * (the format-specific libraries take strings, not JSX). The base rule
 * would miss those because it only scans CSS-in-JS template literals
 * and JSX style props.
 *
 * What this rule adds on top of `no-non-token-style`:
 *   - Scope: only files matching the document-template glob:
 *     - `packages/document-templates/**`
 *     - any `*-brander.{ts,tsx}` file (pdf-brander, docx-brander, …)
 *     - any `*-recipe.{ts,tsx}` file (`document-recipes` registry)
 *   - Every string literal in scope is scanned (not just JSX / CSS-in-JS).
 *     This catches inline HTML / CSS embedded in DOCX / PDF templates.
 *
 * Why a separate rule
 *   - The base rule is scoped to UI surfaces; running its full-strings
 *     scan there would generate false positives on i18n copy and prose.
 *     The document-template surface is narrower and almost-exclusively
 *     rendering, so we can afford the wider net.
 *
 * Allowed locations
 *   - Files under `__tests__` / `__fixtures__` / `*.test.ts` — fixtures
 *     legitimately use raw hex when asserting the brand-lint catches
 *     them.
 *
 * The implementation simply re-uses `no-non-token-style`'s `buildCreate`
 * factory with `scanAllStrings: true` + the doc-template skipFile
 * predicate. All pattern detection lives in one place.
 */
'use strict';

const baseRule = require('./no-non-token-style.js');

const { buildCreate } = baseRule.internals;

/**
 * File-path predicate. Returns true to SKIP the file (allowlist /
 * out-of-scope). We invert it inside `buildCreate`.
 */
const DOC_TEMPLATE_PATTERNS = [
  /packages\/document-templates\/.*\.(?:ts|tsx|cts|mts|js|jsx|cjs|mjs)$/,
  /[a-z0-9-]+-brander\.(?:ts|tsx|cts|mts|js|jsx|cjs|mjs)$/,
  /[a-z0-9-]+-recipe\.(?:ts|tsx|cts|mts|js|jsx|cjs|mjs)$/,
];

const ALWAYS_SKIP_PATTERNS = [
  /\/__tests__\//,
  /\/__fixtures__\//,
  /\/fixtures\//,
  /\.test\.[cm]?[jt]sx?$/,
  /\.spec\.[cm]?[jt]sx?$/,
  /\.stories\.[cm]?[jt]sx?$/,
  /\.md$/,
  /eslint\.config\.mjs$/,
  /eslint-rules\//,
];

function skipFile(filename) {
  if (!filename || filename === '<input>' || filename === '<text>') {
    return true;
  }
  // Tests / docs / configs ALWAYS skipped.
  for (const re of ALWAYS_SKIP_PATTERNS) {
    if (re.test(filename)) return true;
  }
  // Only run on files inside the doc-template glob. Anything else: skip.
  for (const re of DOC_TEMPLATE_PATTERNS) {
    if (re.test(filename)) return false;
  }
  return true;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow non-token color / spacing / font literals in document-template files (PDF / DOCX / PPTX / XLSX branders). Use @borjie/design-system tokens — even inside embedded HTML / CSS strings.',
      recommended: false,
    },
    hasSuggestions: true,
    schema: [],
    messages: {
      nonToken:
        "Non-token {{ kind }} literal '{{ snippet }}' in {{ source }} (document template). Brand-locked rendering requires @borjie/design-system tokens — see docs/DESIGN/DOCUMENT_COMPOSITION_SPEC.md §3 Layer 3.",
      suggestToken: "Replace with '{{ token }}'",
    },
  },
  create: buildCreate({
    skipFile,
    scanAllStrings: true,
  }),
};
