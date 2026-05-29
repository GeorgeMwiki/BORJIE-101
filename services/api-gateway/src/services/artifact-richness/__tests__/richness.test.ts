/**
 * Tests for the artifact-richness pipeline — mermaid extract, KaTeX
 * extract, citation embed, TOC injection, branded layout and the
 * one-call `prepareRichBody` helper.
 *
 * These tests pin the contract that every Borjie artifact relies on:
 *   - the pipeline is deterministic given the same input
 *   - markers are opaque and unique
 *   - graceful degradation when peer libs (mermaid headless / katex)
 *     are absent at runtime
 *   - bilingual sw/en parity for empty states + footnotes header
 */

import { describe, it, expect } from 'vitest';
import {
  applyHtmlOverrides,
  buildBrandedLayout,
  embedCitations,
  emptyState,
  emptyStateHtml,
  injectToc,
  prepareRichBody,
  renderMathBlocks,
  renderMermaidBlocks,
} from '../index.js';

describe('artifact-richness — mermaid extract', () => {
  it('replaces mermaid fences with opaque markers and produces fallback SVG', async () => {
    const md =
      '# Plan\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\nFollowing text.';
    const result = await renderMermaidBlocks(md, 'en');
    expect(result.count).toBe(1);
    // The body should no longer contain the fenced block
    expect(result.body).not.toContain('```mermaid');
    // The fallback HTML should describe the diagram source
    const overrideKey = Object.keys(result.htmlOverrides)[0]!;
    expect(result.htmlOverrides[overrideKey]).toContain('borjie-mermaid-fallback');
    expect(result.htmlOverrides[overrideKey]).toContain('flowchart TD');
  });

  it('emits bilingual fallback header (sw)', async () => {
    const md = '```mermaid\ngraph TD; A-->B;\n```';
    const result = await renderMermaidBlocks(md, 'sw');
    const overrideKey = Object.keys(result.htmlOverrides)[0]!;
    expect(result.htmlOverrides[overrideKey]).toContain('Mchoro wa Mermaid');
  });

  it('returns count=0 when no mermaid blocks present', async () => {
    const result = await renderMermaidBlocks('# Heading\n\nplain text', 'en');
    expect(result.count).toBe(0);
    expect(Object.keys(result.htmlOverrides)).toHaveLength(0);
  });
});

describe('artifact-richness — math (KaTeX) extract', () => {
  it('replaces display math with marker and produces fallback', async () => {
    const md = '$$ E = mc^2 $$';
    const result = await renderMathBlocks(md, 'en');
    expect(result.count).toBe(1);
    expect(result.body).not.toContain('$$');
    const key = Object.keys(result.htmlOverrides)[0]!;
    // KaTeX may or may not be present at runtime; either way the
    // override must be HTML that mentions the formula.
    expect(result.htmlOverrides[key]).toMatch(/(E\s*=\s*mc|katex)/i);
  });

  it('replaces inline math with marker', async () => {
    const md = 'Royalty is $r = 0.04 \\cdot V$ where V is value.';
    const result = await renderMathBlocks(md, 'en');
    expect(result.count).toBe(1);
    expect(result.body).not.toContain('$r =');
  });

  it('returns count=0 when no math present', async () => {
    const result = await renderMathBlocks('plain prose, costs $100 only', 'en');
    expect(result.count).toBe(0);
  });
});

describe('artifact-richness — citations', () => {
  it('replaces cite tokens with chip markers and emits a footnote section', () => {
    const md = 'TZS price climbed[^cite:src-1] last week.';
    const result = embedCitations(
      md,
      [
        {
          id: 'src-1',
          label: 'BoT FX bulletin',
          source: 'BoT',
          evidenceId: 'ev_001',
          url: 'https://www.bot.go.tz/fx',
        },
      ],
      'en',
    );
    expect(result.count).toBe(1);
    expect(result.body).not.toContain('[^cite:src-1]');
    expect(result.footnotesHtml).toContain('Evidence');
    expect(result.footnotesHtml).toContain('BoT FX bulletin');
  });

  it('uses Swahili header when language is sw', () => {
    const md = 'X[^cite:y]';
    const result = embedCitations(md, [{ id: 'y', label: 'L', source: 'S' }], 'sw');
    expect(result.footnotesHtml).toContain('Marejeo');
  });

  it('de-duplicates repeated citations with the same id', () => {
    const md = 'A[^cite:x] then B[^cite:x] then C[^cite:y]';
    const result = embedCitations(
      md,
      [
        { id: 'x', label: 'X', source: 'S1' },
        { id: 'y', label: 'Y', source: 'S2' },
      ],
      'en',
    );
    expect(result.count).toBe(3);
    // Footnotes section lists only 2 entries (deduped by id)
    const matches = (result.footnotesHtml ?? '').match(/<li id="cite-/g);
    expect(matches?.length).toBe(2);
  });

  it('returns null footnotes when no citations referenced', () => {
    const result = embedCitations('plain text', [], 'en');
    expect(result.footnotesHtml).toBeNull();
    expect(result.count).toBe(0);
  });
});

describe('artifact-richness — table of contents', () => {
  it('suppresses TOC when fewer than 4 headings', () => {
    const md = '# A\n\ntext\n\n## B\n\nmore';
    const result = injectToc(md, 'en');
    expect(result.tocHtml).toBeNull();
    expect(result.headingCount).toBe(2);
  });

  it('emits TOC when 4+ headings present', () => {
    const md = '# A\n## B\n## C\n### D\n## E\n';
    const result = injectToc(md, 'en');
    expect(result.tocHtml).not.toBeNull();
    expect(result.tocHtml).toContain('Table of contents');
    expect(result.tocHtml).toContain('href="#a"');
  });

  it('uses Swahili header when language is sw', () => {
    const md = '# A\n## B\n## C\n## D\n';
    const result = injectToc(md, 'sw');
    expect(result.tocHtml).toContain('Yaliyomo');
  });
});

describe('artifact-richness — empty states', () => {
  it('returns Swahili for sw language', () => {
    const msg = emptyState('no_data', 'sw');
    expect(msg).toContain('Hakuna');
  });

  it('returns English for en language', () => {
    const msg = emptyState('still_loading', 'en');
    expect(msg.toLowerCase()).toContain('loading');
  });

  it('emptyStateHtml escapes and wraps in a status paragraph', () => {
    const html = emptyStateHtml('no_evidence', 'en');
    expect(html).toContain('role="status"');
    expect(html).toContain('class="borjie-empty-state"');
  });
});

describe('artifact-richness — branded layout', () => {
  it('builds bilingual header / classification / footer / disclaimer', () => {
    const layout = buildBrandedLayout({
      tenantTradingName: 'Acme Mining Co.',
      artifactTitle: 'Quarterly Brief',
      artifactKind: 'owner_brief',
      classification: 'internal',
      auditHashTail: 'abcd1234',
      renderedAtUtc: '2026-05-29T10:00:00Z',
      authorDisplayName: 'Borjie brain',
      language: 'sw',
    });
    expect(layout.headerLine).toContain('Borjie | Acme');
    expect(layout.classificationBadge).toContain('Ndani ya Kampuni');
    expect(layout.footerLine).toContain('audit:abcd1234');
    expect(layout.disclaimer).toContain('Imeundwa');
  });

  it('English variant for English-language artifacts', () => {
    const layout = buildBrandedLayout({
      tenantTradingName: 'Acme',
      artifactTitle: 't',
      artifactKind: 'k',
      classification: 'confidential',
      auditHashTail: '12345678',
      renderedAtUtc: '2026-05-29T00:00:00Z',
      authorDisplayName: 'Borjie',
      language: 'en',
    });
    expect(layout.classificationBadge).toBe('[Confidential]');
    expect(layout.disclaimer).toContain('Decisions are yours');
  });
});

describe('artifact-richness — full pipeline (prepareRichBody + applyHtmlOverrides)', () => {
  it('runs mermaid + math + citation + TOC end-to-end', async () => {
    const md = `# Plan

## Summary

Royalty formula: $r = 0.04 \\cdot V$.

## Process

\`\`\`mermaid
flowchart TD
  A[Start] --> B[Extract] --> C[Smelt]
\`\`\`

The smelter must hit 92% recovery[^cite:s1].

## Risks

Tail risk: $$\\Pr(L>q) \\leq \\alpha$$

## Decisions

Owner signs.`;

    const result = await prepareRichBody(
      md,
      [{ id: 's1', label: 'TUMEMADINI ore-grade study', source: 'TUMEMADINI', evidenceId: 'ev_42' }],
      { language: 'en' },
    );
    expect(result.mermaidCount).toBe(1);
    expect(result.mathCount).toBe(2);
    expect(result.citationCount).toBe(1);
    expect(result.tocHtml).not.toBeNull();
    expect(result.footnotesHtml).toContain('TUMEMADINI');
    expect(result.body).not.toContain('```mermaid');
    expect(result.body).not.toContain('[^cite:');

    // Apply overrides into a faux HTML string
    const faux = `<p>${result.body}</p>`;
    const final = applyHtmlOverrides(faux, result.htmlOverrides);
    // The faux html still has the markers replaced with content
    expect(final).toContain('borjie-mermaid-fallback');
    expect(final).toContain('borjie-citation-chip');
  });

  it('graceful when body has no rich content', async () => {
    const md = '# Title\n\nJust plain prose.';
    const result = await prepareRichBody(md, [], { language: 'sw' });
    expect(result.mermaidCount).toBe(0);
    expect(result.mathCount).toBe(0);
    expect(result.citationCount).toBe(0);
    expect(result.tocHtml).toBeNull();
    expect(result.footnotesHtml).toBeNull();
  });
});
