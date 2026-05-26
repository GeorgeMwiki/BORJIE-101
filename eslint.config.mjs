/**
 * Root ESLint flat-config for the BORJIE monorepo.
 *
 * Migrated from the legacy `.eslintrc.cjs` (ESLint 8.x) to flat-config for
 * ESLint 10.x. Every per-package `pnpm lint` script resolves this file via
 * cosmiconfig because flat-config is the only supported format on ESLint 10.
 *
 * Enforces security best practices at lint time:
 *  - eslint-plugin-security: well-known injection / insecure-API rules
 *  - eslint-plugin-no-secrets: entropy-based secret detection in source
 *  - no-console (warn) everywhere except tests + explicit console.warn/error
 *  - no-eval / no-implied-eval: hard-errors
 */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import securityPlugin from 'eslint-plugin-security';
import noSecretsPlugin from 'eslint-plugin-no-secrets';
import globals from 'globals';
import { createRequire } from 'node:module';

// Local custom rules live in `./eslint-rules/` and are exposed as the
// `borjie` plugin. We use createRequire because the plugin entry is
// CommonJS (idiomatic for ESLint rule authoring) while this file is ESM.
const require = createRequire(import.meta.url);
const borjiePlugin = require('./eslint-rules/index.js');

const NO_SECRETS_OPTIONS = {
  tolerance: 4.5,
  additionalRegexes: {
    // Stripe-style keys
    'Stripe Secret Key': 'sk_(test|live)_[0-9a-zA-Z]{16,}',
    'Stripe Publishable Key': 'pk_(test|live)_[0-9a-zA-Z]{16,}',
    // OpenAI / Anthropic / Google
    'OpenAI API Key': 'sk-(proj-)?[A-Za-z0-9_-]{20,}',
    'Anthropic API Key': 'sk-ant-(api|admin)\\d{2}-[A-Za-z0-9_-]{20,}',
    'Google API Key': 'AIza[0-9A-Za-z_-]{35}',
    // AWS
    'AWS Access Key ID': 'AKIA[0-9A-Z]{16}',
    'AWS Secret Access Key':
      'aws_secret_access_key[\\s"\':=]+[A-Za-z0-9/+=]{40}',
    // Generic private keys
    'Private Key Block':
      '-----BEGIN (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY',
    // JWT
    'JWT Token':
      'eyJ[A-Za-z0-9_-]{10,}\\.eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}',
    // GitHub
    'GitHub PAT': 'gh[pousr]_[A-Za-z0-9]{36,}',
    // Slack
    'Slack Token': 'xox[aboprs]-[A-Za-z0-9-]{10,}',
    // Project-specific: GePG / M-Pesa style tokens often prefixed
    'GePG Token': 'GEPG_(API|SECRET)_[A-Za-z0-9]{20,}',
  },
  ignoreContent: [
    'xxxxx',
    'placeholder',
    'example',
    'your-key-here',
    'changeme',
  ],
  ignoreIdentifiers: [],
};

export default [
  // ------ Ignore patterns (migrated from `ignorePatterns`) ------
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/.blob/**',
      '**/e2e-report/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/*.tsbuildinfo',
      // Flutter app is not JS
      'apps/borjie_app/**',
      // Generated / vendored
      '**/generated/**',
      '**/*.generated.ts',
      '**/*.generated.tsx',
      '**/*.d.ts',
    ],
  },

  // ------ Base: eslint:recommended ------
  js.configs.recommended,

  // ------ TypeScript baseline (typescript-eslint v8 flat-config bundle) ------
  // We deliberately do NOT extend `tseslint.configs.recommended` (it would
  // introduce hundreds of new errors). We only attach the parser + plugin so
  // existing rules continue to work as they did under the legacy config.
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      // Delegate to TS compiler; ESLint core rules conflict with TS
      // namespace/type merging and type-level checks.
      'no-undef': 'off',
      'no-redeclare': 'off',
      'no-unused-vars': 'off',
    },
  },

  // ------ Core rules + security + no-secrets (apply to all JS/TS sources) ------
  {
    files: ['**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.es2022,
      },
    },
    plugins: {
      security: securityPlugin,
      'no-secrets': noSecretsPlugin,
      borjie: borjiePlugin,
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    rules: {
      // ---- Hard security ----
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',

      // ---- Numeric-parsing discipline (A-BUG-DEEP #10) ----
      // `parseInt` without radix is a recurring source of bugs (e.g.
      // octal interpretation of leading-zero strings on Node <22). Force
      // an explicit radix everywhere.
      radix: ['error', 'always'],

      // ---- Insecure randomness (A-BUG-DEEP #11) ----
      // Math.random() is fast but not unguessable; ID-generation paths
      // must use crypto.randomUUID() or nanoid. Surface every call site
      // as a warning — legitimate uses (jitter sleeps, mock fixtures)
      // can suppress per-line; the security review picks up the rest.
      'no-restricted-syntax': [
        'warn',
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: 'Math.random() is not unguessable. Use crypto.randomUUID() or nanoid for IDs.',
        },
      ],

      // ---- Console discipline ----
      // Allow warn/error (operational signals) but flag info/log/debug so they
      // get routed through @borjie/observability instead.
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // ---- Secret detection ----
      'no-secrets/no-secrets': ['error', NO_SECRETS_OPTIONS],

      // ---- Phase E.0: jurisdictional literal containment ----
      // Default to `warn` so the existing literals across the codebase
      // surface in CI without blocking PRs. The companion audit script
      // (`scripts/audit-jurisdictional-literals.mjs`) enumerates each
      // violation site as a worklist for the Phase E.0.4 rebind pass;
      // once that pass lands the severity will flip to `error`.
      'borjie/no-jurisdictional-literal': 'warn',

      // ---- CSRF protection on client-side mutating fetch() ----
      // Errors when a file under apps/*/src/{app,components,contexts,
      // screens,features,hooks} makes a `fetch(url, { method: POST|PUT|
      // PATCH|DELETE })` call without importing `getCsrfHeaders` from a
      // local `lib/csrf` helper (or using @borjie/api-client, which
      // threads CSRF via interceptor). Severity was promoted from `warn`
      // to `error` after the F1 migration pass closed all 32 call-sites.
      'borjie/require-csrf-headers': 'error',

      // ---- Security plugin tuning ----
      // Object-injection is noisy on TS with typed keys; keep as warn so CI
      // surfaces it but doesn't block legitimate typed array access.
      'security/detect-object-injection': 'warn',
      'security/detect-non-literal-fs-filename': 'error',
      'security/detect-child-process': 'error',
      'security/detect-non-literal-regexp': 'warn',
      // detect-unsafe-regex (safe-regex) has many false positives on bounded
      // alternation patterns like `(?:a|b|c)` — flag-as-warn so CI surfaces
      // them for human review without blocking on cosmetic regex shape.
      'security/detect-unsafe-regex': 'warn',
      // no-useless-escape is auto-fixable in regexes but not in string
      // literals (case-study text uses \' liberally). Demote to warn so the
      // ~50 case-study string-escape annotations don't block CI.
      'no-useless-escape': 'warn',
      'security/detect-buffer-noassert': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-no-csrf-before-method-override': 'error',
      'security/detect-possible-timing-attacks': 'warn',
      'security/detect-pseudoRandomBytes': 'error',
      'security/detect-new-buffer': 'error',
      'security/detect-bidi-characters': 'error',

      // TS handles unused-vars better than core rule
      'no-unused-vars': 'off',
    },
  },

  // ------ Tests ------
  {
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      '**/*.spec.tsx',
      '**/__tests__/**/*.ts',
      '**/__tests__/**/*.tsx',
      '**/test/**/*.ts',
      '**/tests/**/*.ts',
      '**/e2e/**/*.ts',
    ],
    languageOptions: {
      globals: {
        ...globals.node,
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-object-injection': 'off',
      'no-secrets/no-secrets': 'off',
      // Tests legitimately use NIDA / KRA / +254 / +255 in fixtures.
      'borjie/no-jurisdictional-literal': 'off',
    },
  },

  // ------ Config / build / script files ------
  {
    files: [
      '**/*.config.ts',
      '**/*.config.js',
      '**/*.config.cjs',
      '**/*.config.mjs',
      '**/scripts/**/*.ts',
      '**/scripts/**/*.js',
    ],
    rules: {
      'no-console': 'off',
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-child-process': 'warn',
    },
  },

  // ------ Documentation / fixtures ------
  {
    files: ['**/fixtures/**', '**/__fixtures__/**'],
    rules: {
      'no-secrets/no-secrets': 'off',
    },
  },

  // ------ Brand-DNA enforcement (Phase 2 Layer 3) ------
  //
  // `borjie/no-non-token-style` runs on every brand-locked UI surface.
  // It rejects raw color/spacing/font literals that did not come from
  // the @borjie/design-system token set (see
  // docs/DESIGN/ANTICIPATORY_UX_SPEC.md §6).
  //
  // Severity is `error`: existing violations are documented as a
  // follow-up worklist (the rule's file-path allowlist already excludes
  // the design-system token registry, story files, and tests, so the
  // surface that turns `error` is intentionally narrow). The companion
  // genui runtime validator routes any payload that slips past lint to
  // UnknownKindCard(malformed: true).
  {
    files: [
      'packages/genui/**/*.{ts,tsx,js,jsx}',
      'packages/chat-ui/**/*.{ts,tsx,js,jsx}',
      'packages/design-system/**/*.{ts,tsx,js,jsx}',
      'apps/marketing/**/*.{ts,tsx,js,jsx}',
      'apps/owner-web/**/*.{ts,tsx,js,jsx}',
      'apps/admin-web/**/*.{ts,tsx,js,jsx}',
    ],
    rules: {
      'borjie/no-non-token-style': 'error',
    },
  },

  // `borjie/no-non-token-in-doc-template` runs on the document-templates
  // package and any `*-brander.ts` / `*-recipe.ts` file. It uses the
  // wider string-scan mode because DOCX / PDF templates frequently
  // embed inline HTML / CSS as plain string literals.
  // See docs/DESIGN/DOCUMENT_COMPOSITION_SPEC.md §3 Layer 3.
  {
    files: [
      'packages/document-templates/**/*.{ts,tsx,js,jsx,cts,mts,cjs,mjs}',
      '**/*-brander.{ts,tsx,js,jsx,cts,mts,cjs,mjs}',
      '**/*-recipe.{ts,tsx,js,jsx,cts,mts,cjs,mjs}',
    ],
    rules: {
      'borjie/no-non-token-in-doc-template': 'error',
    },
  },

  // The design-system token registry IS the canonical raw-OKLCH / hex
  // source. The rule already short-circuits on these files via its
  // file-path allowlist; we still belt-and-brace by explicitly turning
  // it off here in case the file ever moves.
  {
    files: [
      'packages/design-system/src/styles/globals.css',
      'packages/design-system/src/brand/index.ts',
      'packages/design-system/tailwind.config.ts',
      'apps/*/src/app/globals.css',
      'apps/*/tailwind.config.ts',
    ],
    rules: {
      'borjie/no-non-token-style': 'off',
      'borjie/no-non-token-in-doc-template': 'off',
    },
  },
];
