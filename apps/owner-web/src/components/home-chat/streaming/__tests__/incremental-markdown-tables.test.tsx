/**
 * incremental-markdown — GFM pipe-table support (B3).
 *
 * The cockpit brain emits tabular answers (grades / tonnes / FX) as GFM pipe
 * tables. Before this fix `splitBlocks` had no table rule, so the header and
 * rows rendered as literal `| col | col |` paragraphs. These tests assert:
 *   1. A COMPLETE pipe table is recognized as a single `table` block with the
 *      right header, alignments and body rows.
 *   2. A PARTIAL table mid-stream (header typed, no delimiter yet) degrades
 *      safely — it stays a paragraph (rendered literally), never a crash and
 *      never a half-built table that re-lays-out when the delimiter lands.
 *   3. The component renders a real <table> for a complete table.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import {
  splitBlocks,
  IncrementalMarkdown,
  type Block,
} from '../incremental-markdown';

afterEach(() => {
  cleanup();
});

function firstOfKind(blocks: ReadonlyArray<Block>, kind: Block['kind']) {
  return blocks.find((b) => b.kind === kind);
}

describe('splitBlocks — GFM pipe tables', () => {
  it('recognizes a complete pipe table as a single table block', () => {
    const src = [
      '| Mineral | Grade | Tonnes |',
      '| --- | ---: | :---: |',
      '| Gold | 4.2 | 120 |',
      '| Copper | 1.8 | 340 |',
    ].join('\n');

    const blocks = splitBlocks(src);

    // Exactly one block, and it is a table.
    expect(blocks).toHaveLength(1);
    const table = blocks[0];
    expect(table?.kind).toBe('table');
    if (table?.kind !== 'table') throw new Error('expected table block');

    expect(table.header).toEqual(['Mineral', 'Grade', 'Tonnes']);
    expect(table.aligns).toEqual(['left', 'right', 'center']);
    expect(table.rows).toEqual([
      ['Gold', '4.2', '120'],
      ['Copper', '1.8', '340'],
    ]);
    // No stray paragraph carrying literal pipes.
    expect(firstOfKind(blocks, 'p')).toBeUndefined();
  });

  it('tolerates optional leading/trailing pipes and a header-only body', () => {
    const src = ['FX | Rate', '--- | ---', 'USD/TZS | 2650'].join('\n');
    const blocks = splitBlocks(src);
    const table = blocks[0];
    expect(table?.kind).toBe('table');
    if (table?.kind !== 'table') throw new Error('expected table block');
    expect(table.header).toEqual(['FX', 'Rate']);
    expect(table.rows).toEqual([['USD/TZS', '2650']]);
  });

  it('does NOT absorb a table that follows a paragraph into the paragraph', () => {
    const src = [
      'Here are the assay results:',
      '| Mineral | Grade |',
      '| --- | --- |',
      '| Gold | 4.2 |',
    ].join('\n');

    const blocks = splitBlocks(src);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.kind).toBe('p');
    expect(blocks[1]?.kind).toBe('table');
  });

  it('degrades a partial table (header only, delimiter not yet streamed) to a literal paragraph', () => {
    // Mid-stream: the header line has arrived but the `| --- |` separator has
    // not. Nothing may claim this as a table yet.
    const src = '| Mineral | Grade | Tonnes |';
    const blocks = splitBlocks(src);

    expect(firstOfKind(blocks, 'table')).toBeUndefined();
    expect(blocks[0]?.kind).toBe('p');
    // Rendered literally — the raw pipes are preserved, no crash.
    expect(blocks[0]?.src).toContain('| Mineral | Grade | Tonnes |');
  });

  it('does not crash on a header + partial delimiter row mid-stream', () => {
    // The delimiter is still being typed (`| --` with no closing cells). It is
    // not yet a valid delimiter, so still a paragraph, never a thrown error.
    const src = ['| A | B |', '| --'].join('\n');
    expect(() => splitBlocks(src)).not.toThrow();
    expect(firstOfKind(splitBlocks(src), 'table')).toBeUndefined();
  });
});

describe('IncrementalMarkdown — renders a real <table>', () => {
  it('renders header cells and body cells inside a table element', () => {
    const src = [
      '| Mineral | Tonnes |',
      '| --- | ---: |',
      '| Gold | 120 |',
    ].join('\n');

    const { container } = render(<IncrementalMarkdown text={src} />);

    expect(container.querySelector('table')).not.toBeNull();
    expect(screen.getByText('Mineral')).toBeInTheDocument();
    expect(screen.getByText('Gold')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
    // No literal pipe glyph leaked into the DOM text.
    expect(container.textContent ?? '').not.toContain('| Mineral');
  });
});
