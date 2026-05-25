/**
 * AdaptiveRenderer unknown-kind fallback test.
 *
 * Mirrors the chat-ui block-system renderer's defensive degrade: when
 * the brain emits a `kind` this client does not yet know, the renderer
 * shows the kind name + a collapsible raw payload instead of crashing.
 *
 * NOTE: importing AdaptiveRenderer pulls in the lazy chunks for
 * VegaChart / MapView / CalendarView / FilePreview — those resolve to
 * `react-vega`, `react-leaflet`, `@fullcalendar/react`, `react-pdf`
 * which are peer dependencies of the consuming app. The lazy
 * `import('react-vega')` etc. is only triggered when the matching kind
 * renders, so this test (which renders only the unknown kind) does NOT
 * load those modules.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { UnknownKindCard } from '../components/UnknownKindCard';

describe('UnknownKindCard', () => {
  it('renders the unknown kind name', () => {
    render(<UnknownKindCard kind="kanban" payload={{ kind: 'kanban', columns: [] }} />);
    expect(screen.getByText(/kanban/)).toBeDefined();
  });

  it('marks the surrounding element with data-genui-unknown-kind', () => {
    const { container } = render(
      <UnknownKindCard kind="heatmap" payload={{ kind: 'heatmap' }} />,
    );
    const el = container.querySelector('[data-genui-unknown-kind="heatmap"]');
    expect(el).not.toBeNull();
  });

  it('toggles the raw payload visibility', () => {
    const { container } = render(
      <UnknownKindCard kind="dashboard-grid" payload={{ kind: 'dashboard-grid', cells: 12 }} />,
    );
    expect(container.querySelector('pre')).toBeNull();
    const btn = screen.getByRole('button', { name: /show raw payload/i });
    fireEvent.click(btn);
    expect(container.querySelector('pre')).not.toBeNull();
  });
});
