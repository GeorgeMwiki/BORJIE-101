/**
 * Owner-web ESLint flat-config.
 *
 * Inherits the root monorepo flat-config (see ../../eslint.config.mjs) and
 * registers `eslint-plugin-react-hooks` so that inline directives like
 * `// eslint-disable-next-line react-hooks/exhaustive-deps` resolve
 * correctly under the root config's `reportUnusedDisableDirectives: true`
 * setting.
 *
 * Mirrors apps/workforce-mobile/eslint.config.mjs — the plugin is scoped
 * to React surfaces only (monorepo also hosts non-React services where
 * the rule is meaningless and the parser overhead is unwanted).
 *
 * Persona: Mr. Mwikila
 */

import rootConfig from '../../eslint.config.mjs';
import reactHooksPlugin from 'eslint-plugin-react-hooks';

export default [
  ...rootConfig,
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    plugins: {
      'react-hooks': reactHooksPlugin,
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
