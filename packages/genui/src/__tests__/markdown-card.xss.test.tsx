/**
 * Regression test for CRITICAL C3 — MarkdownCard XSS via attribute escape.
 *
 * Pre-fix: `escapeHtml` only replaced `& < >`, so a markdown link with a
 * `"` inside the URL escaped the `href="..."` attribute and let the LLM
 * inject arbitrary handlers (`onmouseover`, etc.). The fix extends
 * escapeHtml to cover `" ' /` too. This test asserts character-by-character
 * that the dangerous characters are escaped in the rendered HTML and that
 * the literal exploit fragment never appears un-escaped.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import { MarkdownCard } from '../components/MarkdownCard';

// Exploit URL without `)` so the markdown link regex `[^)]+` matches the
// whole URL. The fragment `"` is the actual attribute-breakout vector.
const EXPLOIT_URL = 'https://example.com/x" onmouseover="alert`1`';

describe('MarkdownCard — XSS regression (C3)', () => {
  it('escapes `"` inside a markdown link URL so the href attribute cannot be broken out of', () => {
    const md = `[click](${EXPLOIT_URL})`;
    const { container } = render(
      <MarkdownCard kind="markdown-card" markdown={md} />,
    );

    // 1. The escaped fragment must appear (with &quot; for ").
    const html = container.innerHTML;
    expect(html).toContain('&quot;');

    // 2. The raw exploit string (working attribute breakout) MUST NOT
    //    appear in the rendered HTML. The literal "onmouseover" SUBSTRING
    //    may appear as text inside the escaped href value (`...&amp;quot;
    //    onmouseover=&amp;quot;...`) — but never as an attribute-breakout
    //    where a raw `"` is followed by `onmouseover=`. We check the
    //    DOM-level signal: the anchor element must not actually have an
    //    `onmouseover` attribute or any inline event handler.
    expect(html).not.toMatch(/onmouseover\s*=\s*["'][^"']*["']/);
    expect(html).not.toContain('" onmouseover');

    // 3. The anchor element exists and its href is the escaped URL — not
    //    a broken-out attribute.
    const a = container.querySelector('a');
    expect(a).not.toBeNull();
    // DOM-level check: the anchor must have no event-handler attribute
    // (no `onmouseover`, no `onclick`, no `onerror`, etc.).
    if (a) {
      for (let i = 0; i < a.attributes.length; i += 1) {
        const attrName = a.attributes[i]!.name;
        expect(attrName.toLowerCase().startsWith('on')).toBe(false);
      }
    }

    // 4. The string `&quot;` (escaped) must appear inside the href value
    //    — single OR double escaped form (`&quot;` or `&amp;quot;`).
    const innerHtml = container.innerHTML;
    const hrefIdx = innerHtml.indexOf('href="');
    expect(hrefIdx).toBeGreaterThanOrEqual(0);
    const afterHref = innerHtml.slice(hrefIdx + 6);
    const closingQuoteIdx = afterHref.indexOf('"');
    const hrefValue = afterHref.slice(0, closingQuoteIdx);
    expect(/&(amp;)?quot;/.test(hrefValue)).toBe(true);
    // The href substring must not contain a raw `"` (which would have
    // ended the attribute already, splitting the original onmouseover
    // breakout into a separate attribute).
    expect(hrefValue).not.toContain('"');
  });

  it('escapes `<`, `>`, `&`, `"`, `\'` character-by-character', () => {
    // Note: `/` is intentionally NOT escaped — see MarkdownCard.tsx
    // comment on escapeHtml. The prefix-check regex requires literal `://`
    // for http(s) URLs to be allowed.
    //
    // The renderer escapes the whole line FIRST via escapeHtml, then the
    // link replacement re-escapes the href. That produces double-escaped
    // output in the attribute (e.g. `&amp;lt;` for an input `<`); the
    // browser surfaces this back to the user as literal `&lt;` text in
    // the link, not as a `<` glyph — still safe. We assert the
    // double-escaped form to keep the test honest about reality.
    const md = `[ok](https://example.com/dangerous<\'"&>path)`;
    const { container } = render(
      <MarkdownCard kind="markdown-card" markdown={md} />,
    );
    const html = container.innerHTML;

    // Find the href attribute substring.
    const hrefIdx = html.indexOf('href="');
    expect(hrefIdx).toBeGreaterThanOrEqual(0);
    const afterHref = html.slice(hrefIdx + 6);
    const closingQuoteIdx = afterHref.indexOf('"');
    const hrefValue = afterHref.slice(0, closingQuoteIdx);

    // The raw attribute-breakout vectors (`<`, `>`, raw `"` ending the
    // attr) must NOT appear inside the href value.
    expect(hrefValue).not.toContain('<');
    expect(hrefValue).not.toContain('>');
    // Each dangerous character is escaped at least once — we look for
    // its escaped form anywhere in the href attribute (single or double
    // escaped). The double-escape pattern is the post-renderInline form.
    expect(/&(amp;)?lt;/.test(hrefValue)).toBe(true);
    expect(/&(amp;)?gt;/.test(hrefValue)).toBe(true);
    expect(/&(amp;)?quot;/.test(hrefValue)).toBe(true);
    expect(/&(amp;)?#39;/.test(hrefValue)).toBe(true);
  });

  it('rejects a link with a javascript: scheme (prefix-check)', () => {
    const md = `[click](javascript:alert(1))`;
    const { container } = render(
      <MarkdownCard kind="markdown-card" markdown={md} />,
    );
    // The link prefix check rejects non-(http(s)|/|#) schemes — the text
    // is rendered, but NO anchor is emitted.
    expect(container.querySelector('a')).toBeNull();
    // Defense-in-depth: even the literal javascript:alert(1) must not
    // appear as an href attribute substring.
    expect(container.innerHTML).not.toContain('href="javascript:');
  });
});
