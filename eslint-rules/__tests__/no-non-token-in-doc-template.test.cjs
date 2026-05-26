/**
 * Unit tests for `borjie/no-non-token-in-doc-template`.
 *
 * Coverage matrix (>= 10 invalid + >= 10 valid):
 *   VALID
 *    - Doc-template file using design-system token color via var(--…)
 *    - Brander file (`docx-brander.ts`) using `hsl(var(--signal-500))`
 *    - Recipe file using a Tailwind utility / token reference
 *    - Non-doc-template file (rule out of scope, raw hex tolerated here)
 *    - Test fixture inside the doc-templates package — skipped
 *    - Stories file — skipped
 *    - Comment-only file with no literals
 *    - Plain identifier-only references
 *    - Reading a token via `BRAND.colors.signal` constant
 *    - Numeric raw `12` in a non-style context (not a spacing prop)
 *
 *   INVALID
 *    - Plain string literal containing raw hex (DOCX/PDF inline CSS)
 *    - Plain string literal containing `rgba(...)`
 *    - Brander file containing a `bg-[#…]` Tailwind arbitrary class
 *    - Recipe file embedding inline `<div style="color: #abc">` HTML
 *    - Template literal containing CSS-in-string with hex
 *    - Template literal containing rgb(…)
 *    - Inline JSX style with hex (the doc template still flags it)
 *    - Tailwind arbitrary spacing in a brander
 *    - Tailwind arbitrary border-radius
 *    - Named color in inline style
 *    - hsl(numeric) literal in a string
 *    - Multiple distinct hex literals → multiple reports
 */
'use strict';

const { RuleTester } = require('eslint');
const tsParser = require('@typescript-eslint/parser');
const rule = require('../no-non-token-in-doc-template.js');

const RECIPE_FILE =
  '/repo/packages/document-templates/src/recipes/quarterly-board-report.ts';
const DOCX_BRANDER =
  '/repo/packages/document-templates/src/brand-lock/docx-brander.ts';
const PDF_BRANDER_LOOSE =
  '/repo/packages/report-engine/src/pdf-brander.ts';
const NESTED_RECIPE_LOOSE =
  '/repo/packages/document-studio/src/templates/board-recipe.ts';

// Out-of-scope: rule should be a no-op for these.
const COMPONENT_FILE =
  '/repo/packages/genui/src/components/MyCard.tsx';
const TEST_FILE =
  '/repo/packages/document-templates/src/__tests__/recipe.test.ts';
const STORY_FILE =
  '/repo/packages/document-templates/src/recipes/board.stories.tsx';

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

ruleTester.run('no-non-token-in-doc-template', rule, {
  valid: [
    // 1. Doc-template file using a CSS-variable color reference.
    {
      filename: RECIPE_FILE,
      code: "export const heading = `color: var(--color-signal-500); font-family: var(--font-display);`;",
    },
    // 2. Brander using hsl(var(--…)) — fine.
    {
      filename: DOCX_BRANDER,
      code: "export const headerStyle = `color: hsl(var(--signal-500));`;",
    },
    // 3. Recipe file using a token via Tailwind utility.
    {
      filename: NESTED_RECIPE_LOOSE,
      code: `export const tw = 'bg-signal-500 text-foreground gap-4 p-6';`,
    },
    // 4. Out-of-scope file — even raw hex is fine here (this rule
    //    doesn't run; the sibling rule polices these files).
    {
      filename: COMPONENT_FILE,
      code: `export const x = '#C9A66B';`,
    },
    // 5. Test fixture inside doc-templates — skipped.
    {
      filename: TEST_FILE,
      code: `it('renders', () => { const css = 'color: #fff; padding: 16px;'; expect(css).toBeTruthy(); });`,
    },
    // 6. Story file — skipped.
    {
      filename: STORY_FILE,
      code: `export const Story = { args: { color: '#000000' } };`,
    },
    // 7. Comment-only file — no literals.
    {
      filename: RECIPE_FILE,
      code: `// purely commentary\nexport {};`,
    },
    // 8. Identifier-only references — no literal strings.
    {
      filename: RECIPE_FILE,
      code: `import { BRAND } from '@borjie/design-system'; export const c = BRAND.colors.signal;`,
    },
    // 9. Constant whose value is a token reference string.
    {
      filename: PDF_BRANDER_LOOSE,
      code: `export const PRIMARY = 'var(--color-signal-500)';`,
    },
    // 10. Numeric literal alone — not a spacing prop.
    {
      filename: RECIPE_FILE,
      code: `export const MAX_PAGES = 12;`,
    },
    // 11. Sentinel keywords.
    {
      filename: DOCX_BRANDER,
      code: `export const transparentBg = 'transparent';`,
    },
    // 12. Template literal containing prose only (no CSS shape).
    {
      filename: RECIPE_FILE,
      code: "export const title = `Quarterly Board Report — auto-composed by Mr. Mwikila.`;",
    },
  ],

  invalid: [
    // 1. Plain string literal with raw hex — embedded CSS in a DOCX template.
    {
      filename: DOCX_BRANDER,
      code: `export const css = 'color: #C9A66B; font-weight: 600;';`,
      errors: [{ messageId: 'nonToken', suggestions: 1 }],
    },
    // 2. Plain string with rgba(…).
    {
      filename: PDF_BRANDER_LOOSE,
      code: `export const bg = 'background-color: rgba(229, 178, 107, 0.4);';`,
      errors: [{ messageId: 'nonToken' }],
    },
    // 3. Tailwind arbitrary color in a brander — flags both the embedded
    //    hex AND the arbitrary class.
    {
      filename: DOCX_BRANDER,
      code: `export const tw = 'bg-[#C9A66B] text-foreground';`,
      errors: [
        { messageId: 'nonToken', suggestions: 1 },
        { messageId: 'nonToken' },
      ],
    },
    // 4. Inline HTML `style="color: #abc"` literal — caught by string scan.
    {
      filename: RECIPE_FILE,
      code: `export const html = '<div style="color: #abc; padding: 8px;">x</div>';`,
      errors: [{ messageId: 'nonToken', suggestions: 1 }],
    },
    // 5. Template-literal CSS with hex — TemplateElement node carries the
    //    finding, so no fix-able suggestion is attached.
    {
      filename: NESTED_RECIPE_LOOSE,
      code: "export const css = `border: 1px solid #1e140c;`;",
      errors: [{ messageId: 'nonToken' }],
    },
    // 6. Template-literal CSS with rgb(…).
    {
      filename: DOCX_BRANDER,
      code: "export const css = `background: rgb(229, 178, 107);`;",
      errors: [{ messageId: 'nonToken' }],
    },
    // 7. JSX inline style with hex inside a .tsx recipe (recipes can return
    //    JSX for HTML-based PDF rendering paths).
    {
      filename: '/repo/packages/document-templates/src/recipes/board-recipe.tsx',
      code: `export const C = () => <div style={{ color: '#fff' }} />;`,
      errors: [{ messageId: 'nonToken', suggestions: 1 }],
    },
    // 8. Tailwind arbitrary spacing in a brander.
    {
      filename: DOCX_BRANDER,
      code: `export const layout = 'gap-[17px] p-2';`,
      errors: [{ messageId: 'nonToken' }],
    },
    // 9. Tailwind arbitrary border-radius.
    {
      filename: PDF_BRANDER_LOOSE,
      code: `export const card = 'rounded-[7px] shadow-sm';`,
      errors: [{ messageId: 'nonToken' }],
    },
    // 10. Named color in JSX inline style (in a .tsx recipe).
    {
      filename: '/repo/packages/document-templates/src/recipes/board-recipe.tsx',
      code: `export const C = () => <div style={{ color: 'blue' }} />;`,
      errors: [{ messageId: 'nonToken' }],
    },
    // 11. hsl(numeric) literal in a string.
    {
      filename: DOCX_BRANDER,
      code: `export const css = 'color: hsl(45 90% 50%);';`,
      errors: [{ messageId: 'nonToken' }],
    },
    // 12. Two distinct hex literals → two reports.
    {
      filename: NESTED_RECIPE_LOOSE,
      code: `export const css = 'color: #abc; background-color: #def;';`,
      errors: [
        { messageId: 'nonToken', suggestions: 1 },
        { messageId: 'nonToken', suggestions: 1 },
      ],
    },
  ],
});

// eslint-disable-next-line no-console
console.log('no-non-token-in-doc-template: all cases passed');
