/**
 * Unit tests for `borjie/no-non-token-style`.
 *
 * Coverage matrix (>= 10 invalid + >= 10 valid):
 *   VALID
 *    - Tailwind utility resolving to a token (`bg-signal-500`)
 *    - CSS variable in inline style (`color: 'var(--color-signal-500)'`)
 *    - `hsl(var(--…))` inside template-literal CSS
 *    - Tailwind spacing on the scale (`gap-4`)
 *    - `transparent` / `currentColor` sentinels
 *    - Token-registry file path skipped (raw OKLCH allowed)
 *    - `globals.css` allowlist path (raw hex allowed)
 *    - Stories / test files skipped
 *    - Non-color inline style key (e.g. `position: 'absolute'`) ignored
 *    - Plain string with hex in a non-template, non-className context
 *      (when scanAllStrings is false, ignored by the base rule)
 *
 *   INVALID
 *    - Raw hex in inline style color prop
 *    - Raw hex literal embedded in CSS-in-JS template literal
 *    - `rgb(…)` in inline style
 *    - Tailwind arbitrary color: `bg-[#C9A66B]`
 *    - Tailwind arbitrary spacing: `gap-[17px]`
 *    - Tailwind arbitrary in className via JSXExpressionContainer
 *    - Named color string in inline style
 *    - Spacing prop with raw `16px` literal
 *    - Numeric raw spacing in inline style (e.g. `padding: 12`)
 *    - Font-family with non-token font literal
 *    - `hsl(45 90% 50%)` literal in template-literal CSS (rejected; var-
 *      backed `hsl(var(--signal-500))` is allowed)
 *
 * NOTE: ESLint 10 RuleTester requires that when `data` is provided in a
 * test expectation, the synthesized message matches exactly. We therefore
 * assert only `messageId` (not `data`) for the invalid cases — message
 * content is exercised by the rule body, not by the tests.
 */
'use strict';

const { RuleTester } = require('eslint');
const tsParser = require('@typescript-eslint/parser');
const rule = require('../no-non-token-style.js');

const COMPONENT_FILE =
  '/repo/packages/genui/src/components/MyCard.tsx';
const CHAT_UI_FILE =
  '/repo/packages/chat-ui/src/components/ChatBubble.tsx';
const DESIGN_FILE =
  '/repo/packages/design-system/src/components/Button.tsx';

// Allowlisted (registry / config / tests).
const TOKEN_REGISTRY_FILE =
  '/repo/packages/design-system/src/brand/index.ts';
const TAILWIND_CONFIG =
  '/repo/packages/design-system/tailwind.config.ts';
const STORY_FILE =
  '/repo/packages/design-system/src/components/Button.stories.tsx';
const TEST_FILE =
  '/repo/packages/genui/src/components/__tests__/MyCard.test.tsx';

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: {
      ecmaFeatures: { jsx: true },
    },
  },
});

ruleTester.run('no-non-token-style', rule, {
  valid: [
    // 1. Tailwind token utility — fine.
    {
      filename: COMPONENT_FILE,
      code: `export const C = () => <div className="bg-signal-500 text-foreground gap-4 p-6" />;`,
    },
    // 2. CSS variable in inline style — fine.
    {
      filename: COMPONENT_FILE,
      code: `export const C = () => <div style={{ color: 'var(--color-signal-500)' }} />;`,
    },
    // 3. hsl(var(--…)) inside template-literal CSS — fine.
    {
      filename: COMPONENT_FILE,
      code: "const css = `color: hsl(var(--signal-500)); background: hsl(var(--background));`;",
    },
    // 4. `transparent` sentinel — fine.
    {
      filename: COMPONENT_FILE,
      code: `export const C = () => <div style={{ backgroundColor: 'transparent', color: 'currentColor' }} />;`,
    },
    // 5. Token-registry file — allowed even with raw OKLCH / hex.
    {
      filename: TOKEN_REGISTRY_FILE,
      code: `export const BRAND = { colors: { ink: '#1E140C', signal: '#E5B26B' } };`,
    },
    // 6. Tailwind config file — allowed (defines the tokens).
    {
      filename: TAILWIND_CONFIG,
      code: `export default { theme: { extend: { colors: { ink: '#1e140c' } } } };`,
    },
    // 7. Story file — skipped (loads design tokens for showcase).
    {
      filename: STORY_FILE,
      code: `export const Story = () => <div style={{ color: '#fff' }} />;`,
    },
    // 8. Test file — skipped.
    {
      filename: TEST_FILE,
      code: `it('renders', () => { const x = <div style={{ color: '#C9A66B' }} />; });`,
    },
    // 9. Non-color, non-spacing style key — ignored.
    {
      filename: COMPONENT_FILE,
      code: `export const C = () => <div style={{ position: 'absolute', display: 'flex' }} />;`,
    },
    // 10. Plain string with hex outside CSS / className — ignored by the
    //     base rule (the doc-template variant catches these).
    {
      filename: COMPONENT_FILE,
      code: `const userColor = '#abc'; export const fn = () => userColor.length;`,
    },
    // 11. Template literal without CSS shape — ignored.
    {
      filename: COMPONENT_FILE,
      code: "const greeting = `Hello, world!`;",
    },
    // 12. JSX expression className resolving to a registered token.
    {
      filename: CHAT_UI_FILE,
      code: `const cls = 'bg-signal-500'; export const B = () => <div className={cls} />;`,
    },
    // 13. width: 0 (zero) is a sentinel.
    {
      filename: DESIGN_FILE,
      code: `export const C = () => <div style={{ padding: 0, margin: '0' }} />;`,
    },
  ],

  invalid: [
    // 1. Raw hex in inline style color prop — has a token-replacement
    //    suggestion attached.
    {
      filename: COMPONENT_FILE,
      code: `export const C = () => <div style={{ color: '#C9A66B' }} />;`,
      errors: [{ messageId: 'nonToken', suggestions: 1 }],
    },
    // 2. Raw hex in CSS-in-JS template literal — TemplateElement node, so
    //    no autofix-able suggestion (we can't safely rewrite a quasi).
    {
      filename: COMPONENT_FILE,
      code: "const css = `color: #C9A66B; padding: 16px;`;",
      errors: [{ messageId: 'nonToken' }],
    },
    // 3. rgb(…) literal in inline style — no suggestion (we don't auto-
    //    pick a token for rgb).
    {
      filename: COMPONENT_FILE,
      code: `export const C = () => <div style={{ backgroundColor: 'rgb(229, 178, 107)' }} />;`,
      errors: [{ messageId: 'nonToken' }],
    },
    // 4. Tailwind arbitrary color in className — flags BOTH the embedded
    //    hex AND the arbitrary-class wrapper (one report each).
    {
      filename: COMPONENT_FILE,
      code: `export const C = () => <div className="bg-[#C9A66B] text-white" />;`,
      errors: [
        { messageId: 'nonToken', suggestions: 1 },
        { messageId: 'nonToken' },
      ],
    },
    // 5. Tailwind arbitrary spacing in className.
    {
      filename: COMPONENT_FILE,
      code: `export const C = () => <div className="gap-[17px] p-2" />;`,
      errors: [{ messageId: 'nonToken' }],
    },
    // 6. Tailwind arbitrary in JSXExpressionContainer className.
    {
      filename: COMPONENT_FILE,
      code: `export const C = () => <div className={"rounded-[7px]"} />;`,
      errors: [{ messageId: 'nonToken' }],
    },
    // 7. Named color string in inline style.
    {
      filename: COMPONENT_FILE,
      code: `export const C = () => <div style={{ color: 'red' }} />;`,
      errors: [{ messageId: 'nonToken' }],
    },
    // 8. Spacing prop with raw px literal.
    {
      filename: COMPONENT_FILE,
      code: `export const C = () => <div style={{ padding: '16px' }} />;`,
      errors: [{ messageId: 'nonToken' }],
    },
    // 9. Spacing prop with raw numeric (React inline-style coerces to px).
    {
      filename: COMPONENT_FILE,
      code: `export const C = () => <div style={{ margin: 12 }} />;`,
      errors: [{ messageId: 'nonToken' }],
    },
    // 10. Font-family with a non-token literal.
    {
      filename: COMPONENT_FILE,
      code: `export const C = () => <div style={{ fontFamily: 'Comic Sans MS' }} />;`,
      errors: [{ messageId: 'nonToken' }],
    },
    // 11. hsl(…) literal in template-literal CSS (numeric arg, NOT var).
    {
      filename: COMPONENT_FILE,
      code: "const css = `color: hsl(45 90% 50%);`;",
      errors: [{ messageId: 'nonToken' }],
    },
    // 12. Multiple hex hits in one template — should report each (no
    //     suggestions because TemplateElement-keyed reports omit them).
    {
      filename: COMPONENT_FILE,
      code: "const css = `color: #abc; background: #def;`;",
      errors: [
        { messageId: 'nonToken' },
        { messageId: 'nonToken' },
      ],
    },
  ],
});

// eslint-disable-next-line no-console
console.log('no-non-token-style: all cases passed');
