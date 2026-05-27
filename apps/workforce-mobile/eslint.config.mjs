/**
 * Workforce-mobile ESLint flat-config.
 *
 * Inherits the root monorepo flat-config (see ../../eslint.config.mjs) and
 * registers `eslint-plugin-react-hooks` so that inline directives like
 * `// eslint-disable-next-line react-hooks/exhaustive-deps` resolve
 * correctly under the root config's `reportUnusedDisableDirectives: true`
 * setting.
 *
 * The plugin is intentionally scoped to this app only — the broader
 * monorepo includes non-React packages (services, codegen, infra) for
 * which the rule would be meaningless and the plugin's parser overhead
 * is unwanted. Mobile (React Native + expo-router) is where the hooks
 * exhaustive-deps suppression actually appears.
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
      // shape (which is sometimes intentional — see FingerprintOverlay).
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
