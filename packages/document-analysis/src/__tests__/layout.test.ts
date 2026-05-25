import { describe, expect, it } from 'vitest';
import { locateInLayout, parseLayout } from '../layout/index.js';
import { loadFixture } from './fixtures.js';

describe('parseLayout', () => {
  it('emits a layout line per source line', async () => {
    const text = 'line one\nline two\nline three';
    const layout = await parseLayout({ text });
    expect(layout.lines).toHaveLength(3);
    expect(layout.lines[0]?.text).toBe('line one');
    expect(layout.lines[0]?.bbox).toEqual({ x: 0, y: 0, w: 8, h: 1 });
  });

  it('detects a stamp block from a fixture', async () => {
    const text = loadFixture('payment-receipt-gepg');
    const layout = await parseLayout({ text });
    const stamp = layout.blocks.find((b) => b.kind === 'stamp');
    expect(stamp).toBeDefined();
    expect(stamp?.text.toLowerCase()).toContain('stamp');
  });

  it('detects photo regions in a condition survey', async () => {
    const text = loadFixture('condition-survey');
    const layout = await parseLayout({ text });
    const photos = layout.blocks.filter((b) => b.kind === 'photo');
    expect(photos.length).toBeGreaterThanOrEqual(3);
  });

  it('detects a signature block on the lease application', async () => {
    const text = loadFixture('lease-application');
    const layout = await parseLayout({ text });
    const sig = layout.blocks.find((b) => b.kind === 'signature');
    expect(sig).toBeDefined();
  });

  it('detects a table block when columns are aligned', async () => {
    const text = `Header
Unit       Rent       Status
A1         900000     occupied
A2         950000     occupied
A3         800000     vacant
`;
    const layout = await parseLayout({ text });
    const table = layout.blocks.find((b) => b.kind === 'table');
    expect(table).toBeDefined();
    expect(table?.tableRows && table.tableRows.length).toBeGreaterThanOrEqual(3);
  });

  it('increments page on form-feed', async () => {
    const text = 'page one body\n\f\npage two body';
    const layout = await parseLayout({ text });
    expect(layout.pageCount).toBe(2);
  });
});

describe('locateInLayout', () => {
  it('returns the page + bbox for a substring', async () => {
    const layout = await parseLayout({ text: 'first line\nsecond line\nthird line' });
    const loc = locateInLayout(layout, 'second');
    expect(loc).not.toBeNull();
    expect(loc?.page).toBe(1);
    expect(loc?.bbox.y).toBe(1);
  });

  it('returns null when the substring is absent', async () => {
    const layout = await parseLayout({ text: 'nothing matches here' });
    expect(locateInLayout(layout, 'absent token')).toBeNull();
  });

  it('returns null for empty needle', async () => {
    const layout = await parseLayout({ text: 'abc' });
    expect(locateInLayout(layout, '   ')).toBeNull();
  });
});
