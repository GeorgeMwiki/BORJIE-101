/**
 * `<DynamicTabBar>` tests — rendering, selection, keyboard nav,
 * mobile collapse, swipe nav, and empty-state.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DynamicTabBar } from '../components/DynamicTabBar.js';
import { __clearLazyCacheForTesting } from '../components/SectionMount.js';
import type { Section } from '../contracts/section.js';

declare global {
  // eslint-disable-next-line no-var
  var __setMatchMedia: ((matches: boolean) => void) | undefined;
}

function mk(
  key: string,
  Component: React.ComponentType<unknown> = () => <div data-testid={`comp-${key}`}>{key}</div>,
  sort_order = 10,
): Section {
  return {
    key,
    label: key.toUpperCase(),
    icon: 'circle',
    entity_type: key,
    sort_order,
    visibility_predicate: { kind: 'has-entities', entity_type: key },
    component_loader: () => Promise.resolve({ default: Component }),
  };
}

beforeEach(() => {
  __clearLazyCacheForTesting();
  globalThis.__setMatchMedia?.(false); // desktop by default
});

describe('<DynamicTabBar>', () => {
  it('renders the desktop tab list at desktop breakpoint', async () => {
    const sections = [mk('a'), mk('b')];
    render(
      <DynamicTabBar sections={sections} tenantId="t1" scope="owner-customer" />,
    );
    expect(screen.getByTestId('dynamic-tabbar-list-desktop')).toBeInTheDocument();
    expect(screen.queryByTestId('dynamic-tabbar-list-mobile')).not.toBeInTheDocument();
  });

  it('renders empty-state when there are zero sections', () => {
    render(
      <DynamicTabBar sections={[]} tenantId="t1" scope="owner-customer" />,
    );
    expect(screen.getByTestId('dynamic-tabbar-empty')).toBeInTheDocument();
  });

  it('renders a custom emptyState when supplied', () => {
    render(
      <DynamicTabBar
        sections={[]}
        tenantId="t1"
        scope="owner-customer"
        emptyState={<div data-testid="my-empty">custom empty</div>}
      />,
    );
    expect(screen.getByTestId('my-empty')).toBeInTheDocument();
  });

  it('renders the first section by default (uncontrolled)', async () => {
    const sections = [mk('a'), mk('b')];
    render(
      <DynamicTabBar sections={sections} tenantId="t1" scope="owner-customer" />,
    );
    await waitFor(() => expect(screen.getByTestId('comp-a')).toBeInTheDocument());
    expect(screen.queryByTestId('comp-b')).not.toBeInTheDocument();
  });

  it('respects the controlled activeKey', async () => {
    const sections = [mk('a'), mk('b')];
    render(
      <DynamicTabBar
        sections={sections}
        tenantId="t1"
        scope="owner-customer"
        activeKey="b"
      />,
    );
    await waitFor(() => expect(screen.getByTestId('comp-b')).toBeInTheDocument());
    expect(screen.queryByTestId('comp-a')).not.toBeInTheDocument();
  });

  it('fires onChange on click', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const sections = [mk('a'), mk('b')];
    render(
      <DynamicTabBar
        sections={sections}
        tenantId="t1"
        scope="owner-customer"
        onChange={onChange}
      />,
    );
    await user.click(screen.getByTestId('dynamic-tabbar-trigger-b'));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('selects ArrowRight to next tab + ArrowLeft to previous (wraps)', async () => {
    const sections = [mk('a'), mk('b'), mk('c')];
    const onChange = vi.fn();
    render(
      <DynamicTabBar
        sections={sections}
        tenantId="t1"
        scope="owner-customer"
        onChange={onChange}
      />,
    );
    const triggerA = screen.getByTestId('dynamic-tabbar-trigger-a');
    fireEvent.keyDown(triggerA, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('b');
    fireEvent.keyDown(triggerA, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('a');
  });

  it('Home jumps to first, End jumps to last', async () => {
    const sections = [mk('a'), mk('b'), mk('c')];
    const onChange = vi.fn();
    render(
      <DynamicTabBar
        sections={sections}
        tenantId="t1"
        scope="owner-customer"
        activeKey="b"
        onChange={onChange}
      />,
    );
    const triggerB = screen.getByTestId('dynamic-tabbar-trigger-b');
    fireEvent.keyDown(triggerB, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('c');
    fireEvent.keyDown(triggerB, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('a');
  });

  it('sets aria-selected on the active tab', async () => {
    const sections = [mk('a'), mk('b')];
    render(
      <DynamicTabBar
        sections={sections}
        tenantId="t1"
        scope="owner-customer"
        activeKey="b"
      />,
    );
    expect(
      screen.getByTestId('dynamic-tabbar-trigger-a').getAttribute('aria-selected'),
    ).toBe('false');
    expect(
      screen.getByTestId('dynamic-tabbar-trigger-b').getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('falls back to the first section if the controlled activeKey is unknown', async () => {
    const sections = [mk('a'), mk('b')];
    const onChange = vi.fn();
    render(
      <DynamicTabBar
        sections={sections}
        tenantId="t1"
        scope="owner-customer"
        activeKey="ghost"
        onChange={onChange}
      />,
    );
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('a'));
  });

  it('renders the mobile hamburger header when matchMedia reports mobile', async () => {
    globalThis.__setMatchMedia?.(true);
    const sections = [mk('a'), mk('b')];
    render(
      <DynamicTabBar sections={sections} tenantId="t1" scope="owner-customer" />,
    );
    expect(screen.getByTestId('dynamic-tabbar-hamburger')).toBeInTheDocument();
    // List is collapsed by default.
    expect(screen.queryByTestId('dynamic-tabbar-list-mobile')).not.toBeInTheDocument();
  });

  it('expanding the hamburger reveals the mobile tab list', async () => {
    globalThis.__setMatchMedia?.(true);
    const user = userEvent.setup();
    const sections = [mk('a'), mk('b')];
    render(
      <DynamicTabBar sections={sections} tenantId="t1" scope="owner-customer" />,
    );
    await user.click(screen.getByTestId('dynamic-tabbar-hamburger'));
    expect(screen.getByTestId('dynamic-tabbar-list-mobile')).toBeInTheDocument();
  });

  it('selecting from the mobile list collapses the hamburger', async () => {
    globalThis.__setMatchMedia?.(true);
    const user = userEvent.setup();
    const sections = [mk('a'), mk('b')];
    render(
      <DynamicTabBar sections={sections} tenantId="t1" scope="owner-customer" />,
    );
    await user.click(screen.getByTestId('dynamic-tabbar-hamburger'));
    await user.click(screen.getByTestId('dynamic-tabbar-trigger-b'));
    await waitFor(() =>
      expect(screen.queryByTestId('dynamic-tabbar-list-mobile')).not.toBeInTheDocument(),
    );
  });

  it('swipe-left advances to next tab on mobile', async () => {
    globalThis.__setMatchMedia?.(true);
    const onChange = vi.fn();
    const sections = [mk('a'), mk('b'), mk('c')];
    render(
      <DynamicTabBar
        sections={sections}
        tenantId="t1"
        scope="owner-customer"
        onChange={onChange}
      />,
    );
    const panel = screen.getByTestId('dynamic-tabbar-panel');
    await act(async () => {
      panel.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          pointerType: 'touch',
          clientX: 200,
          clientY: 100,
        }),
      );
      panel.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerType: 'touch',
          clientX: 100,
          clientY: 102,
        }),
      );
    });
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('swipe-right goes to previous tab (wrap)', async () => {
    globalThis.__setMatchMedia?.(true);
    const onChange = vi.fn();
    const sections = [mk('a'), mk('b'), mk('c')];
    render(
      <DynamicTabBar
        sections={sections}
        tenantId="t1"
        scope="owner-customer"
        onChange={onChange}
      />,
    );
    const panel = screen.getByTestId('dynamic-tabbar-panel');
    await act(async () => {
      panel.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          pointerType: 'touch',
          clientX: 100,
          clientY: 100,
        }),
      );
      panel.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerType: 'touch',
          clientX: 200,
          clientY: 102,
        }),
      );
    });
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('vertical drags do not trigger tab nav', async () => {
    globalThis.__setMatchMedia?.(true);
    const onChange = vi.fn();
    const sections = [mk('a'), mk('b'), mk('c')];
    render(
      <DynamicTabBar
        sections={sections}
        tenantId="t1"
        scope="owner-customer"
        onChange={onChange}
      />,
    );
    const panel = screen.getByTestId('dynamic-tabbar-panel');
    await act(async () => {
      panel.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          pointerType: 'touch',
          clientX: 100,
          clientY: 100,
        }),
      );
      panel.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerType: 'touch',
          clientX: 105,
          clientY: 300,
        }),
      );
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disableSwipe prop suppresses gesture handling even on mobile', async () => {
    globalThis.__setMatchMedia?.(true);
    const onChange = vi.fn();
    const sections = [mk('a'), mk('b'), mk('c')];
    render(
      <DynamicTabBar
        sections={sections}
        tenantId="t1"
        scope="owner-customer"
        onChange={onChange}
        disableSwipe
      />,
    );
    const panel = screen.getByTestId('dynamic-tabbar-panel');
    await act(async () => {
      panel.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          pointerType: 'touch',
          clientX: 200,
          clientY: 100,
        }),
      );
      panel.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerType: 'touch',
          clientX: 100,
          clientY: 100,
        }),
      );
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not swipe-navigate on desktop', async () => {
    globalThis.__setMatchMedia?.(false);
    const onChange = vi.fn();
    const sections = [mk('a'), mk('b'), mk('c')];
    render(
      <DynamicTabBar
        sections={sections}
        tenantId="t1"
        scope="owner-customer"
        onChange={onChange}
      />,
    );
    const panel = screen.getByTestId('dynamic-tabbar-panel');
    await act(async () => {
      panel.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          pointerType: 'touch',
          clientX: 300,
          clientY: 100,
        }),
      );
      panel.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerType: 'touch',
          clientX: 100,
          clientY: 100,
        }),
      );
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('exposes role=tablist / role=tab / role=tabpanel for a11y', async () => {
    const sections = [mk('a'), mk('b')];
    render(
      <DynamicTabBar sections={sections} tenantId="t1" scope="owner-customer" />,
    );
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('tabpanel')).toBeInTheDocument();
  });

  it('panel ID is wired to the active tab via aria-labelledby', async () => {
    const sections = [mk('a'), mk('b')];
    render(
      <DynamicTabBar
        sections={sections}
        tenantId="t1"
        scope="owner-customer"
        activeKey="b"
      />,
    );
    const panel = screen.getByRole('tabpanel');
    expect(panel.getAttribute('id')).toBe('dynamic-section-panel-b');
    expect(panel.getAttribute('aria-labelledby')).toBe('dynamic-section-tab-b');
  });

  it('handles a section that disappears (e.g. last entity deleted)', async () => {
    const onChange = vi.fn();
    const sections = [mk('a'), mk('b')];
    const { rerender } = render(
      <DynamicTabBar
        sections={sections}
        tenantId="t1"
        scope="owner-customer"
        activeKey="b"
        onChange={onChange}
      />,
    );
    rerender(
      <DynamicTabBar
        sections={[mk('a')]}
        tenantId="t1"
        scope="owner-customer"
        activeKey="b"
        onChange={onChange}
      />,
    );
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('a'));
  });
});
