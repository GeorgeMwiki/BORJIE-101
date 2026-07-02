/**
 * markdown-expressive — proves the incremental renderer supports every
 * expressive-range device a thoughtful reply needs (GFM tables, task-lists,
 * del/strikethrough, mark/highlight, kbd, blockquote/callout, fenced code,
 * numbered steps) AND that partial mid-stream markdown never crashes or
 * mis-renders (settle-parse discipline).
 *
 * STRUCTURE is locale-agnostic; the mining CONTENT below stays single-locale
 * (English) per the zero-mix canon — the test asserts the devices, not copy.
 */
import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../widget/markdown';

describe('renderMarkdown — expressive devices', () => {
  it('renders a GFM table with aligned cells', () => {
    const md = [
      '| Mineral | Grade (g/t) |',
      '| :--- | ---: |',
      '| Gold | 4.2 |',
      '| Copper | 0.8 |',
    ].join('\n');
    const html = renderMarkdown(md);
    expect(html).toContain('<table');
    expect(html).toContain('>Mineral</th>');
    expect(html).toContain('text-align:left');
    expect(html).toContain('text-align:right');
    expect(html).toContain('>Gold</td>');
    expect(html).toContain('>4.2</td>');
  });

  it('renders a task-list with checked + unchecked items', () => {
    const md = ['- [x] Assay submitted', '- [ ] Royalty filed'].join('\n');
    const html = renderMarkdown(md);
    expect(html).toContain('borjie-md-tasklist');
    expect(html).toContain('type="checkbox" checked disabled');
    expect(html).toContain('Assay submitted');
    // Unchecked box present without `checked`.
    expect(html).toContain('type="checkbox" disabled');
    expect(html).toContain('Royalty filed');
  });

  it('renders strikethrough (del)', () => {
    const html = renderMarkdown('Old rate ~~2.5%~~ superseded.');
    expect(html).toContain('<del>2.5%</del>');
  });

  it('renders highlight (mark)', () => {
    const html = renderMarkdown('Flag the ==high-grade== seam.');
    expect(html).toContain('<mark class="borjie-md-mark">high-grade</mark>');
  });

  it('renders kbd keycaps', () => {
    const html = renderMarkdown('Press [[Ctrl]] + [[S]] to save.');
    expect(html).toContain('<kbd class="borjie-md-kbd">Ctrl</kbd>');
    expect(html).toContain('<kbd class="borjie-md-kbd">S</kbd>');
  });

  it('promotes a GFM admonition to a styled callout', () => {
    const md = [
      '> [!WARNING] Permit lapses in 14 days',
      '> Renew before the deadline.',
    ].join('\n');
    const html = renderMarkdown(md);
    expect(html).toContain('borjie-md-callout--warning');
    expect(html).toContain('Permit lapses in 14 days');
    expect(html).toContain('Renew before the deadline.');
  });

  it('renders a plain blockquote when unmarked', () => {
    const html = renderMarkdown('> A quoted regulatory clause.');
    expect(html).toContain('<blockquote class="borjie-md-quote">');
    expect(html).toContain('A quoted regulatory clause.');
    expect(html).not.toContain('borjie-md-callout');
  });

  it('renders a fenced code block with a language label', () => {
    const md = ['```sql', 'SELECT grade FROM assays;', '```'].join('\n');
    const html = renderMarkdown(md);
    expect(html).toContain('<pre class="borjie-md-pre" data-lang="sql">');
    expect(html).toContain('SELECT grade FROM assays;');
  });

  it('keeps numbered steps as an ordered list', () => {
    const md = ['1. Sample the ore', '2. Run the assay'].join('\n');
    const html = renderMarkdown(md);
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>Sample the ore</li>');
    expect(html).toContain('<li>Run the assay</li>');
  });

  it('escapes code-block content (no raw HTML survives a fence)', () => {
    const md = ['```html', '<img src=x onerror=alert(1)>', '```'].join('\n');
    const html = renderMarkdown(md);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

describe('renderMarkdown — partial-stream (settle-parse) safety', () => {
  it('does not crash on an unterminated code fence', () => {
    const partial = ['```python', 'x = compute_grade(']; // no closing fence yet
    expect(() => renderMarkdown(partial.join('\n'))).not.toThrow();
    const html = renderMarkdown(partial.join('\n'));
    expect(html).toContain('<pre class="borjie-md-pre"');
    expect(html).toContain('x = compute_grade(');
  });

  it('does not crash on an incomplete table (header + separator only)', () => {
    const partial = ['| Mineral | Grade |', '| --- | --- |']; // no body rows yet
    expect(() => renderMarkdown(partial.join('\n'))).not.toThrow();
    const html = renderMarkdown(partial.join('\n'));
    expect(html).toContain('<table');
    expect(html).toContain('<th>Mineral</th>');
    expect(html).toContain('<tbody></tbody>');
  });

  it('renders a header row as prose until the separator arrives', () => {
    // Mid-stream: the pipe row exists but the separator has not streamed in.
    const html = renderMarkdown('| Mineral | Grade |');
    expect(() => renderMarkdown('| Mineral | Grade |')).not.toThrow();
    // No <table> yet — it is still a paragraph, escaped, no crash.
    expect(html).not.toContain('<table');
    expect(html).toContain('Mineral');
  });

  it('renders a lone callout marker safely mid-stream', () => {
    // Only the marker line has arrived; body has not.
    const html = renderMarkdown('> [!TIP] Check the moisture content');
    expect(() => renderMarkdown('> [!TIP]')).not.toThrow();
    expect(html).toContain('borjie-md-callout--tip');
    expect(html).toContain('Check the moisture content');
  });

  it('does not throw on a half-typed inline device', () => {
    expect(() => renderMarkdown('Grade is ==high')).not.toThrow();
    expect(() => renderMarkdown('Press [[Ctrl')).not.toThrow();
    expect(() => renderMarkdown('Old ~~rate')).not.toThrow();
    // Half-typed mark leaks as escaped literal, not a broken tag.
    expect(renderMarkdown('Grade is ==high')).toContain('==high');
  });
});
