/**
 * LearnedShortcutsPanel component tests.
 *
 * Focus areas:
 *   - empty state (renders nothing)
 *   - top-N visibility + maxVisible prop
 *   - show-more expansion
 *   - click handler wiring
 *   - drag-to-pin handler wiring
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LearnedShortcutsPanel } from '../LearnedShortcutsPanel';
import type { LearnedShortcut } from '../../lib/learned-shortcuts/types';

function makeShortcuts(n: number): LearnedShortcut[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `action-${i}`,
    label: `Action ${i}`,
    confidence: 1 - i * 0.05,
  }));
}

describe('LearnedShortcutsPanel', () => {
  it('renders nothing when shortcuts is empty (empty state suppressed)', () => {
    const { container } = render(
      <LearnedShortcutsPanel shortcuts={[]} onActionClick={() => undefined} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the top 5 shortcuts by default', () => {
    render(
      <LearnedShortcutsPanel
        shortcuts={makeShortcuts(8)}
        onActionClick={() => undefined}
      />,
    );
    const panel = screen.getByTestId('learned-shortcuts-panel');
    const items = panel.querySelectorAll('button[data-shortcut-index]');
    expect(items).toHaveLength(5);
  });

  it('respects a custom maxVisible prop', () => {
    render(
      <LearnedShortcutsPanel
        shortcuts={makeShortcuts(8)}
        onActionClick={() => undefined}
        maxVisible={3}
      />,
    );
    const panel = screen.getByTestId('learned-shortcuts-panel');
    expect(panel.querySelectorAll('button[data-shortcut-index]')).toHaveLength(
      3,
    );
  });

  it('shows the Show-more button only when there are more entries', () => {
    render(
      <LearnedShortcutsPanel
        shortcuts={makeShortcuts(8)}
        onActionClick={() => undefined}
      />,
    );
    expect(screen.getByTestId('learned-shortcuts-show-more')).toBeInTheDocument();
  });

  it('hides the Show-more button when all shortcuts fit', () => {
    render(
      <LearnedShortcutsPanel
        shortcuts={makeShortcuts(3)}
        onActionClick={() => undefined}
      />,
    );
    expect(
      screen.queryByTestId('learned-shortcuts-show-more'),
    ).not.toBeInTheDocument();
  });

  it('reveals the next 5 entries after clicking Show more', () => {
    render(
      <LearnedShortcutsPanel
        shortcuts={makeShortcuts(12)}
        onActionClick={() => undefined}
      />,
    );
    fireEvent.click(screen.getByTestId('learned-shortcuts-show-more'));
    const panel = screen.getByTestId('learned-shortcuts-panel');
    // maxVisible (5) + default reveal batch (5) = 10
    expect(panel.querySelectorAll('button[data-shortcut-index]')).toHaveLength(
      10,
    );
  });

  it('fires onActionClick with the shortcut id when clicked', () => {
    const onClick = vi.fn();
    render(
      <LearnedShortcutsPanel
        shortcuts={makeShortcuts(3)}
        onActionClick={onClick}
      />,
    );
    fireEvent.click(screen.getByTestId('learned-shortcut-action-1'));
    expect(onClick).toHaveBeenCalledWith('action-1');
  });

  it('marks items draggable when onPin is supplied', () => {
    const onPin = vi.fn();
    render(
      <LearnedShortcutsPanel
        shortcuts={makeShortcuts(3)}
        onActionClick={() => undefined}
        onPin={onPin}
      />,
    );
    const button = screen.getByTestId(
      'learned-shortcut-action-0',
    ) as HTMLButtonElement;
    expect(button.getAttribute('draggable')).toBe('true');
  });

  it('does not mark items draggable when onPin is missing', () => {
    render(
      <LearnedShortcutsPanel
        shortcuts={makeShortcuts(3)}
        onActionClick={() => undefined}
      />,
    );
    const button = screen.getByTestId(
      'learned-shortcut-action-0',
    ) as HTMLButtonElement;
    expect(button.getAttribute('draggable')).toBe('false');
  });

  it('renders a confidence bar per item with width proportional to confidence', () => {
    render(
      <LearnedShortcutsPanel
        shortcuts={[
          { id: 'a', label: 'A', confidence: 1 },
          { id: 'b', label: 'B', confidence: 0.4 },
        ]}
        onActionClick={() => undefined}
      />,
    );
    const aFill = screen
      .getByTestId('learned-shortcut-confidence-a')
      .querySelector('span') as HTMLSpanElement;
    const bFill = screen
      .getByTestId('learned-shortcut-confidence-b')
      .querySelector('span') as HTMLSpanElement;
    expect(aFill.style.width).toBe('100%');
    expect(bFill.style.width).toBe('40%');
  });

  it('renders with inline placement when requested', () => {
    render(
      <LearnedShortcutsPanel
        shortcuts={makeShortcuts(2)}
        onActionClick={() => undefined}
        placement="inline"
      />,
    );
    expect(
      screen.getByTestId('learned-shortcuts-panel').getAttribute('data-placement'),
    ).toBe('inline');
  });

  it('uses the custom headline when provided', () => {
    render(
      <LearnedShortcutsPanel
        shortcuts={makeShortcuts(2)}
        onActionClick={() => undefined}
        headline="Vipendwa vyako"
      />,
    );
    expect(screen.getByText('Vipendwa vyako')).toBeInTheDocument();
  });
});
