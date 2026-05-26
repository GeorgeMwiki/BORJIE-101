/**
 * ESLint custom rule: `borjie/no-non-token-style`
 *
 * Brand-DNA enforcement for the Anticipatory UX layer (`Layer 3 — Brand-
 * Locked Rendering`, see `docs/DESIGN/ANTICIPATORY_UX_SPEC.md` §6 and
 * `docs/DESIGN/DOCUMENT_COMPOSITION_SPEC.md` §3). Refuses any UI surface
 * that ships a color / font / spacing value that did not come from the
 * canonical `@borjie/design-system` token set.
 *
 * What it catches
 * ---------------
 *   1. Raw hex colors as string literals:           '#fff', '#C9A66B',
 *      '#1E140C', '#fa0', '#1a1a1aff'.
 *   2. CSS color-function literals:                 'rgb(0,0,0)',
 *      'rgba(0,0,0,0.5)', 'hsl(30 72% 52%)', 'hsla(30 72% 52% / 0.5)'
 *      (only when written as a literal — `hsl(var(--…))` references are
 *      OK because they consume a token).
 *   3. Tailwind arbitrary values that bypass the scale:
 *        bg-[#…], text-[#…], border-[#…], from-[#…], to-[#…], via-[#…],
 *        gap-[…], p-[…], px-[…], py-[…], pt/r/b/l-[…],
 *        m-[…], mx/y/t/r/b/l-[…],
 *        w-[…px|rem|em|vh|vw|%], h-[…px|rem|em|vh|vw|%],
 *        rounded-[…], shadow-[…].
 *   4. Inline `style={{ … }}` JSX attributes whose values are raw color /
 *      length literals (instead of `var(--…)`, `currentColor`,
 *      `transparent`, `inherit`).
 *
 * Allowed
 * -------
 *   - `var(--color-*)`, `var(--font-*)`, `var(--space-*)`, `var(--radius-*)`,
 *     `var(--shadow-*)`, `hsl(var(--…))`, `oklch(var(--…))`.
 *   - Tailwind utility classes that resolve to registered tokens:
 *     `bg-signal-500`, `text-foreground`, `gap-4`, `p-6`, `rounded-md`.
 *   - Pure transparent / inherit / currentColor sentinels.
 *   - Files explicitly allowlisted (token registry, raw-OKLCH definition,
 *     test fixtures, generated code).
 *
 * Auto-fix
 * --------
 *   For a small set of high-confidence cases the rule provides a suggested
 *   token replacement (e.g. `'#C9A66B'` → `'var(--color-signal-500)'`).
 *   These are surfaced via `context.report({ suggest: [...] })` so the
 *   author opts-in per call-site rather than batch-rewriting indiscriminately.
 *
 * Scope
 * -----
 *   By default this rule runs on every `.ts/.tsx/.js/.jsx` file. Project-
 *   level `eslint.config.mjs` narrows it to the brand-locked packages /
 *   apps (`packages/genui`, `packages/chat-ui`, `packages/design-system`,
 *   `apps/marketing`, `apps/owner-web`, `apps/admin-web`).
 */
'use strict';

// ---- Patterns -------------------------------------------------------------

// 3-, 4-, 6- or 8-digit hex. Anchored to a leading `#` and a non-hex
// terminator (or end of string) so we don't false-positive on `#abc-foo`
// CSS ID selectors embedded in arbitrary string content.
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/;
// More permissive — used for template-literal scans where surrounding
// punctuation may differ.
const HEX_LOOSE_RE = /#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])/;
const RGB_RE = /\brgba?\s*\(/;
const HSL_LITERAL_RE = /\bhsla?\s*\(\s*\d/;
const NAMED_COLOR_KEYS = new Set([
  'red',
  'green',
  'blue',
  'yellow',
  'orange',
  'purple',
  'pink',
  'brown',
  'black',
  'white',
  'gray',
  'grey',
  'cyan',
  'magenta',
  'navy',
  'teal',
  'olive',
  'maroon',
  'lime',
  'aqua',
  'fuchsia',
  'silver',
  'gold',
]);

// Tailwind arbitrary-value utility classes. We deliberately *do not*
// blanket-ban every `*-[…]` token (e.g. `grid-cols-[200px_1fr]` is a
// legitimate layout escape hatch). The list below is the brand-token
// vocabulary — colors, spacing, radii, shadows — anything that has a
// design-system equivalent must come through the token, not via the
// arbitrary value bracket.
const ARBITRARY_PREFIXES = [
  'bg',
  'text',
  'border',
  'fill',
  'stroke',
  'from',
  'to',
  'via',
  'caret',
  'decoration',
  'divide',
  'outline',
  'ring',
  'accent',
  'placeholder',
  'shadow',
  'rounded',
  'gap',
  'p',
  'px',
  'py',
  'pt',
  'pr',
  'pb',
  'pl',
  'm',
  'mx',
  'my',
  'mt',
  'mr',
  'mb',
  'ml',
  'w',
  'h',
  'min-w',
  'min-h',
  'max-w',
  'max-h',
  'space-x',
  'space-y',
  'inset',
  'top',
  'right',
  'bottom',
  'left',
  'translate-x',
  'translate-y',
  'leading',
  'tracking',
  'text-size',
  'font',
];
const ARBITRARY_RE = new RegExp(
  `\\b(?:${ARBITRARY_PREFIXES.join('|')})-\\[[^\\]\\s]+\\]`
);

// CSS variable references — these are always OK.
const CSS_VAR_RE = /var\(\s*--[a-zA-Z0-9_-]+/;

// Approved sentinel keyword values for inline style props.
const SENTINEL_VALUES = new Set([
  'transparent',
  'currentColor',
  'currentcolor',
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
  'auto',
  'none',
  '0',
  '0px',
  '100%',
  'fit-content',
  'max-content',
  'min-content',
]);

// Style props that carry color-like values. We police only these (not
// every single inline style key) to keep false-positives low — `display`,
// `position`, `zIndex` etc. are intentionally unchecked.
const COLOR_PROPS = new Set([
  'color',
  'background',
  'backgroundColor',
  'borderColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'outlineColor',
  'fill',
  'stroke',
  'caretColor',
  'textDecorationColor',
  'columnRuleColor',
]);

// Style props that carry length/spacing values. Raw px/rem/em values
// here are flagged because they bypass the spacing scale; values that
// reference a CSS variable are OK.
const SPACING_PROPS = new Set([
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'gap',
  'rowGap',
  'columnGap',
  'borderRadius',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomLeftRadius',
  'borderBottomRightRadius',
  'fontSize',
  'lineHeight',
  'letterSpacing',
]);

const FONT_PROPS = new Set([
  'fontFamily',
  'font',
]);

// ---- File-path allowlists -------------------------------------------------

/**
 * Files where raw color / OKLCH / spacing literals are legitimate because
 * the file IS the token registry, or it's tooling / tests. The rule
 * short-circuits to `{}` for these.
 */
const TOKEN_REGISTRY_PATTERNS = [
  // The canonical token registry — OKLCH source of truth.
  /packages\/design-system\/src\/styles\/globals\.css$/,
  /packages\/design-system\/src\/brand\/index\.ts$/,
  /packages\/design-system\/tailwind\.config\.ts$/,
  // App-level globals are thin wrappers around the token registry; they
  // may also declare local OKLCH helpers.
  /apps\/[a-z-]+\/src\/app\/globals\.css$/,
  /apps\/[a-z-]+\/tailwind\.config\.ts$/,
  // Tests / stories / fixtures.
  /\/__tests__\//,
  /\/__fixtures__\//,
  /\/fixtures\//,
  /\.test\.[cm]?[jt]sx?$/,
  /\.spec\.[cm]?[jt]sx?$/,
  /\.stories\.[cm]?[jt]sx?$/,
  /^e2e\/.*\.[cm]?[jt]sx?$/,
  // Documentation snippets.
  /\.md$/,
  // ESLint config itself (it inlines example patterns).
  /eslint\.config\.mjs$/,
  /eslint-rules\//,
];

function isTokenRegistryFile(filename) {
  if (!filename || filename === '<input>' || filename === '<text>') {
    return true;
  }
  for (const re of TOKEN_REGISTRY_PATTERNS) {
    if (re.test(filename)) return true;
  }
  return false;
}

// ---- Classifiers ----------------------------------------------------------

/**
 * Pure-color-token mapping for the canonical Borjie palette. When a raw
 * hex literal is recognized, we surface a token-replacement suggestion
 * the developer can apply with one click.
 */
const HEX_TO_TOKEN = {
  // Brand
  '#1e140c': 'var(--color-ink)',
  '#fbf7ee': 'var(--color-paper)',
  '#e5b26b': 'var(--color-signal-500)',
  '#b8873e': 'var(--color-signal-700)',
  '#17100a': 'var(--color-midnight)',
  '#f5ebd8': 'var(--color-bone)',
  // Common neutral fall-throughs
  '#fff': 'var(--color-paper)',
  '#ffffff': 'var(--color-paper)',
  '#000': 'var(--color-ink)',
  '#000000': 'var(--color-ink)',
};

function suggestTokenForHex(hex) {
  const key = hex.toLowerCase();
  if (HEX_TO_TOKEN[key]) return HEX_TO_TOKEN[key];
  // Default to the signal scale — surfaces "you probably meant an amber
  // step here". Developer still has to pick the right step.
  return 'var(--color-signal-500)';
}

/**
 * Is the string a literal raw color (hex, rgb(), rgba(), hsl-literal)?
 * Returns the offending substring (for the diagnostic) or null.
 *
 * Note: `hsl(var(--…))` is NOT a literal — the `var(--…)` consumes a
 * token. We special-case that.
 */
function findColorLiteral(s) {
  if (typeof s !== 'string' || s.length === 0) return null;
  // var(--…) consumed — strip it before scanning so e.g.
  // `hsl(var(--signal-500) / 0.5)` does not trip HSL_LITERAL_RE.
  const stripped = s.replace(/var\(\s*--[a-zA-Z0-9_-]+\s*(?:,[^)]*)?\)/g, '');
  const hex = HEX_LOOSE_RE.exec(stripped);
  if (hex) return hex[0];
  if (RGB_RE.test(stripped)) return 'rgb(...)';
  if (HSL_LITERAL_RE.test(stripped)) return 'hsl(...)';
  return null;
}

/**
 * Is the className string carrying a Tailwind arbitrary value that
 * targets a brand-token slot?
 */
function findArbitraryClass(s) {
  if (typeof s !== 'string') return null;
  const m = ARBITRARY_RE.exec(s);
  return m ? m[0] : null;
}

/**
 * Resolve a JSX attribute literal expression — handles
 * `style={{ color: '#fff' }}`, where the value is an ObjectExpression.
 */
function* iterateStyleProperties(node) {
  if (!node || node.type !== 'ObjectExpression') return;
  for (const prop of node.properties) {
    if (prop.type !== 'Property') continue;
    if (prop.shorthand) continue;
    const keyName =
      prop.key.type === 'Identifier'
        ? prop.key.name
        : prop.key.type === 'Literal'
          ? String(prop.key.value)
          : null;
    if (!keyName) continue;
    yield { keyName, valueNode: prop.value };
  }
}

function literalStringValue(valueNode) {
  if (!valueNode) return null;
  if (valueNode.type === 'Literal' && typeof valueNode.value === 'string') {
    return valueNode.value;
  }
  if (valueNode.type === 'TemplateLiteral' && valueNode.expressions.length === 0) {
    return valueNode.quasis.map((q) => q.value.cooked).join('');
  }
  return null;
}

// ---- Reusable analyser invoked by both rule entry-points ------------------

/**
 * Walk a string against every brand-rejection pattern; emit one report
 * per finding. Used by template-literal css helpers and plain string
 * literals alike. The `context.report` shim is passed in so this can be
 * reused by `no-non-token-in-doc-template` without duplicating the body.
 */
function reportPatternFindings({ context, node, value, messageId, source }) {
  const seen = new Set();
  // Suggestions require a `fix` that returns a real Fix (not null) under
  // ESLint 10. We can only synthesize a fix for Literal nodes whose `raw`
  // we can rewrite in place. For TemplateElement / other AST nodes we
  // omit the suggestion entirely.
  const canSuggest =
    node && node.type === 'Literal' && typeof node.value === 'string';

  function once(kind, snippet) {
    const key = `${kind}:${snippet}`;
    if (seen.has(key)) return;
    seen.add(key);
    const token = kind === 'hex' ? suggestTokenForHex(snippet) : null;
    context.report({
      node,
      messageId,
      data: {
        snippet,
        source: source || 'literal',
        kind,
      },
      // Token-replacement suggestion for the high-confidence hex case.
      suggest:
        kind === 'hex' && canSuggest
          ? [
              {
                messageId: 'suggestToken',
                data: { token },
                fix(fixer) {
                  const fixed = node.raw.replace(snippet, token);
                  return fixer.replaceText(node, fixed);
                },
              },
            ]
          : undefined,
    });
  }

  // 1. Hex colors
  let hexMatch;
  // Use a fresh global regex so we collect every hit on the line.
  const hexGlobal = new RegExp(HEX_LOOSE_RE.source, 'g');
  while ((hexMatch = hexGlobal.exec(value)) !== null) {
    once('hex', hexMatch[0]);
  }
  // 2. rgb()/rgba()
  if (RGB_RE.test(value)) {
    const m = /\brgba?\s*\([^)]*\)/.exec(value);
    once('rgb', m ? m[0] : 'rgb(...)');
  }
  // 3. hsl() / hsla() — only when literal (not var-backed)
  const strippedForHsl = value.replace(
    /var\(\s*--[a-zA-Z0-9_-]+\s*(?:,[^)]*)?\)/g,
    ''
  );
  if (HSL_LITERAL_RE.test(strippedForHsl)) {
    const m = /\bhsla?\s*\([^)]*\)/.exec(value);
    once('hsl', m ? m[0] : 'hsl(...)');
  }
  // 4. Tailwind arbitrary values
  const arb = findArbitraryClass(value);
  if (arb) {
    once('arbitrary', arb);
  }
}

// ---- Rule body factory ----------------------------------------------------
//
// We expose the rule body as a factory so the sibling rule
// `no-non-token-in-doc-template` can reuse the exact same AST visitors
// with a different file-allowlist + a wider string-content scan.

/**
 * @param {object} opts
 * @param {(filename: string) => boolean} opts.skipFile  — return true to
 *   short-circuit (allowlisted file).
 * @param {boolean} opts.scanAllStrings — when true, every string literal
 *   in the file is checked (including HTML / CSS embedded as strings,
 *   used by document templates).
 */
function buildCreate(opts) {
  return function create(context) {
    const filename =
      typeof context.getFilename === 'function'
        ? context.getFilename()
        : context.filename;
    if (opts.skipFile(filename)) {
      return {};
    }

    function report(node, value, source) {
      reportPatternFindings({
        context,
        node,
        value,
        messageId: 'nonToken',
        source,
      });
    }

    return {
      // ---- JSX className / class attributes ------------------------------
      JSXAttribute(node) {
        if (!node.name || node.name.type !== 'JSXIdentifier') return;
        const attrName = node.name.name;
        if (attrName !== 'className' && attrName !== 'class') return;
        const v = node.value;
        if (!v) return;
        if (v.type === 'Literal' && typeof v.value === 'string') {
          const arb = findArbitraryClass(v.value);
          if (arb) {
            report(v, v.value, 'className');
          }
        } else if (v.type === 'JSXExpressionContainer') {
          const expr = v.expression;
          if (expr.type === 'Literal' && typeof expr.value === 'string') {
            report(expr, expr.value, 'className');
          } else if (
            expr.type === 'TemplateLiteral' &&
            expr.expressions.length === 0
          ) {
            const joined = expr.quasis.map((q) => q.value.cooked).join('');
            report(expr, joined, 'className');
          }
        }
      },

      // ---- Inline style={{ … }} props ------------------------------------
      JSXExpressionContainer(node) {
        const parent = node.parent;
        if (
          !parent ||
          parent.type !== 'JSXAttribute' ||
          !parent.name ||
          parent.name.type !== 'JSXIdentifier' ||
          parent.name.name !== 'style'
        ) {
          return;
        }
        const expr = node.expression;
        if (!expr || expr.type !== 'ObjectExpression') return;
        for (const { keyName, valueNode } of iterateStyleProperties(expr)) {
          const literal = literalStringValue(valueNode);
          if (literal === null) {
            // Could be a numeric (e.g. `width: 4` → 4px in React inline
            // style). Treat raw numerics on a spacing prop as a finding.
            if (
              SPACING_PROPS.has(keyName) &&
              valueNode &&
              valueNode.type === 'Literal' &&
              typeof valueNode.value === 'number' &&
              valueNode.value !== 0
            ) {
              context.report({
                node: valueNode,
                messageId: 'nonToken',
                data: {
                  snippet: `${keyName}: ${valueNode.value}`,
                  source: 'style',
                  kind: 'spacing',
                },
              });
            }
            continue;
          }
          if (CSS_VAR_RE.test(literal)) continue;
          if (SENTINEL_VALUES.has(literal.trim())) continue;

          if (COLOR_PROPS.has(keyName)) {
            const lit = findColorLiteral(literal);
            if (lit) {
              const hasHex = HEX_RE.test(literal);
              const token = hasHex ? suggestTokenForHex(lit) : null;
              context.report({
                node: valueNode,
                messageId: 'nonToken',
                data: {
                  snippet: `${keyName}: '${literal}'`,
                  source: 'style',
                  kind: 'color',
                },
                suggest: hasHex
                  ? [
                      {
                        messageId: 'suggestToken',
                        data: { token },
                        fix(fixer) {
                          if (
                            valueNode.type === 'Literal' &&
                            typeof valueNode.value === 'string' &&
                            typeof valueNode.raw === 'string'
                          ) {
                            const quote = valueNode.raw.charAt(0);
                            return fixer.replaceText(
                              valueNode,
                              `${quote}${token}${quote}`
                            );
                          }
                          return null;
                        },
                      },
                    ]
                  : undefined,
              });
            } else if (NAMED_COLOR_KEYS.has(literal.toLowerCase())) {
              context.report({
                node: valueNode,
                messageId: 'nonToken',
                data: {
                  snippet: `${keyName}: '${literal}'`,
                  source: 'style',
                  kind: 'named-color',
                },
              });
            }
            continue;
          }
          if (SPACING_PROPS.has(keyName) || FONT_PROPS.has(keyName)) {
            // Spacing / font props with raw px/rem/em or non-token font.
            if (
              /\d+(\.\d+)?(px|rem|em|vh|vw|%)/.test(literal) ||
              (FONT_PROPS.has(keyName) && /[A-Za-z]/.test(literal))
            ) {
              context.report({
                node: valueNode,
                messageId: 'nonToken',
                data: {
                  snippet: `${keyName}: '${literal}'`,
                  source: 'style',
                  kind: FONT_PROPS.has(keyName) ? 'font' : 'spacing',
                },
              });
            }
          }
        }
      },

      // ---- String literals (template CSS / styled-components / scanAll) --
      Literal(node) {
        if (typeof node.value !== 'string') return;
        // Skip className literals — handled above.
        const parent = node.parent;
        if (parent && parent.type === 'JSXAttribute') return;
        // When we are not in scan-all mode, only police *template* CSS
        // strings (template literals are handled in TemplateLiteral).
        if (!opts.scanAllStrings) return;
        // In scan-all mode (doc-template rule), also skip Literal nodes
        // that live INSIDE a JSX `style={{ … }}` prop — the
        // JSXExpressionContainer visitor already handles those and we
        // don't want double-reporting.
        let p = parent;
        let depth = 0;
        while (p && depth < 8) {
          if (
            p.type === 'JSXAttribute' &&
            p.name &&
            p.name.type === 'JSXIdentifier' &&
            (p.name.name === 'style' || p.name.name === 'className')
          ) {
            return;
          }
          p = p.parent;
          depth += 1;
        }
        report(node, node.value, 'string');
      },

      // ---- Template literals (CSS-in-JS, embedded HTML/CSS in strings) ---
      TemplateLiteral(node) {
        // We only care about CSS-in-JS template literals (tagged or
        // assigned to a `css` / `styled` call) when not scanning everything;
        // detecting them precisely is fragile, so we scan the cooked
        // content and emit reports keyed to each quasi.
        if (!Array.isArray(node.quasis)) return;
        for (const quasi of node.quasis) {
          const cooked = quasi && quasi.value && quasi.value.cooked;
          if (typeof cooked !== 'string' || cooked.length === 0) continue;
          // CSS-in-JS guards: only scan when the quasi looks like CSS
          // (contains `:` and a unit / hex / function), OR when caller
          // asked for `scanAllStrings` (doc-template mode).
          const looksLikeCss =
            /[A-Za-z-]+\s*:\s*/.test(cooked) &&
            (HEX_LOOSE_RE.test(cooked) ||
              RGB_RE.test(cooked) ||
              HSL_LITERAL_RE.test(cooked) ||
              /\d(?:px|rem|em|vh|vw|%)/.test(cooked));
          if (!opts.scanAllStrings && !looksLikeCss) continue;
          report(quasi, cooked, 'template');
        }
      },
    };
  };
}

// ---- Exported rule --------------------------------------------------------

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow non-token color / spacing / font literals in brand-locked UI surfaces. Use @borjie/design-system tokens instead.',
      recommended: false,
    },
    hasSuggestions: true,
    schema: [],
    messages: {
      nonToken:
        "Non-token {{ kind }} literal '{{ snippet }}' in {{ source }}. Use a @borjie/design-system token (var(--…) / hsl(var(--…)) / Tailwind utility like bg-signal-500) — raw hex / rgb / hsl-literal / arbitrary Tailwind values are rejected by Layer 3 brand enforcement.",
      suggestToken: "Replace with '{{ token }}'",
    },
  },
  create: buildCreate({
    skipFile: isTokenRegistryFile,
    scanAllStrings: false,
  }),

  // Internals re-exported so the sibling rule can compose the same
  // analyser with a different file allowlist + content-scan setting.
  internals: {
    buildCreate,
    isTokenRegistryFile,
    reportPatternFindings,
    HEX_LOOSE_RE,
    RGB_RE,
    HSL_LITERAL_RE,
    ARBITRARY_RE,
  },
};
