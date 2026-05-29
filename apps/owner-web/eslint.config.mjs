/**
 * Owner-web ESLint flat-config.
 *
 * Inherits the root monorepo flat-config (see ../../eslint.config.mjs) and
 * registers two plugins scoped to React + Next surfaces:
 *
 *  1. `eslint-plugin-react-hooks` — resolves inline directives like
 *     `// eslint-disable-next-line react-hooks/exhaustive-deps` under
 *     the root config's `reportUnusedDisableDirectives: true` setting.
 *  2. `@next/eslint-plugin-next` — registers Next.js-specific rules
 *     (e.g. `@next/next/no-img-element`) so that inline disable
 *     directives referencing them resolve cleanly under the same
 *     `reportUnusedDisableDirectives: true` policy. Wired without
 *     `recommended` to avoid escalating unrelated rules; only the
 *     definitions need to exist for the directives to type-check.
 *
 * Mirrors apps/workforce-mobile/eslint.config.mjs for the React-hooks
 * block — the Next plugin is owner-web-specific because workforce-mobile
 * is Expo / React Native (no Next.js).
 *
 * Persona: Mr. Mwikila
 */

import nextPlugin from '@next/eslint-plugin-next';
import rootConfig from '../../eslint.config.mjs';
import reactHooksPlugin from 'eslint-plugin-react-hooks';

export default [
  ...rootConfig,
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    plugins: {
      'react-hooks': reactHooksPlugin,
      '@next/next': nextPlugin,
    },
    rules: {
      // Match React's recommended hooks rules without escalating severity.
      // exhaustive-deps stays `warn` so the existing inline disable
      // directives remain meaningful but don't block CI on hooks deps
      // shape (which is sometimes intentional — see context-breadcrumbs).
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
