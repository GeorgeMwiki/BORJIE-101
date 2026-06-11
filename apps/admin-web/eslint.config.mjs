/**
 * Admin-web ESLint flat-config.
 *
 * Inherits the root monorepo flat-config (see ../../eslint.config.mjs) and
 * registers `eslint-plugin-react-hooks` scoped to React surfaces so that
 * inline directives like
 * `// eslint-disable-next-line react-hooks/exhaustive-deps` resolve under
 * the root config's `reportUnusedDisableDirectives: true` setting — without
 * a plugin registering the rule, the directive references an undefined rule
 * and `next lint` fails the build with "Definition for rule
 * 'react-hooks/exhaustive-deps' was not found".
 *
 * Mirrors apps/owner-web/eslint.config.mjs for the React-hooks block.
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
      // directives remain meaningful but don't block CI on hooks deps shape.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
