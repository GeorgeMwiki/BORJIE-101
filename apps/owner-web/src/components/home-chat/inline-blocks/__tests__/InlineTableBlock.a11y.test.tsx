/**
 * B11 — InlineTableBlock pagination-chevron accessibility.
 *
 * Guards WCAG 4.1.2 (Name, Role, Value): the prev/next pagination
 * buttons carry only aria-hidden chevron glyphs, so without an
 * aria-label a screen reader announces a nameless "button". Each
 * control must expose a localized accessible name (en / sw), matching
 * the active locale with zero language mixing.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import { InlineTableBlock } from '../InlineTableBlock';

// 20 rows over the default page size of 8 → 3 pages → chevrons render.
const block = {
  type: 'inline_table' as const,
  columns: [{ key: 'name', label: { en: 'Name', sw: 'Jina' }, kind: 'text' as const }],
  rows: Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, name: `Row ${i}` })),
};

describe('InlineTableBlock pagination chevron accessible names', () => {
  it('exposes English accessible names on the pager buttons', () => {
    render(<InlineTableBlock block={block} locale="en" />);
    expect(
      screen.getByRole('button', { name: 'Previous page' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Next page' }),
    ).toBeInTheDocument();
  });

  it('exposes Swahili accessible names when locale is sw (no language mixing)', () => {
    render(<InlineTableBlock block={block} locale="sw" />);
    expect(
      screen.getByRole('button', { name: 'Ukurasa uliopita' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Ukurasa ufuatao' }),
    ).toBeInTheDocument();
    // Absolute toggle: no English pager label leaks onto the sw surface.
    expect(screen.queryByRole('button', { name: 'Previous page' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
  });
});
