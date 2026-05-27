import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { LiveCursors } from '../components/LiveCursors';
import type { LiveCursorState } from '../types';

describe('LiveCursors', () => {
  it('returns null when presence is undefined', () => {
    const { container } = render(<LiveCursors />);
    expect(container.firstChild).toBeNull();
  });

  it('hides stale cursors older than staleMs', () => {
    const stale: LiveCursorState = {
      userId: 'u1',
      name: 'Alice',
      colorOklch: 'oklch(0.65 0.18 70)',
      x: 10,
      y: 20,
      updatedAt: '2024-01-01T00:00:00Z',
    };
    const fresh: LiveCursorState = {
      ...stale,
      userId: 'u2',
      name: 'Bob',
      updatedAt: new Date().toISOString(),
    };
    render(<LiveCursors presence={[stale, fresh]} now={() => Date.now()} />);
    expect(screen.queryByTestId('cursor-u1')).toBeNull();
    expect(screen.getByTestId('cursor-u2')).toBeInTheDocument();
  });

  it('renders cursors with aria-hidden so they do not leak to AT', () => {
    const fresh: LiveCursorState = {
      userId: 'u3',
      name: 'Cara',
      colorOklch: 'oklch(0.65 0.18 200)',
      x: 5,
      y: 5,
      updatedAt: new Date().toISOString(),
    };
    render(<LiveCursors presence={[fresh]} />);
    expect(screen.getByTestId('live-cursors')).toHaveAttribute('aria-hidden', 'true');
  });
});
