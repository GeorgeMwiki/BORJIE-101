import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe } from './setup';

import { ThreadedView } from '../views/ThreadedView';
import { makeSmallPosts } from './fixtures';

describe('ThreadedView', () => {
  it('mounts and renders root posts at depth 0', () => {
    render(<ThreadedView posts={makeSmallPosts()} />);
    expect(screen.getByTestId('threaded-view')).toBeInTheDocument();
    expect(screen.getByTestId('thread-node-p1')).toHaveAttribute('aria-level', '1');
  });

  it('collapses a parent when the toggle is clicked', () => {
    render(<ThreadedView posts={makeSmallPosts()} />);
    const toggle = screen.getByTestId('thread-toggle-p1');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // p2 is a child of p1 — its post-card row must disappear.
    expect(screen.queryByTestId('thread-children-p1')).toBeNull();
  });

  it('persists collapse state via localStorage when persistKey is set', () => {
    const { rerender } = render(
      <ThreadedView posts={makeSmallPosts()} persistKey="unit-test-thread" />,
    );
    fireEvent.click(screen.getByTestId('thread-toggle-p1'));
    expect(window.localStorage.getItem('bb-collapse-unit-test-thread')).toContain('p1');
    rerender(<ThreadedView posts={makeSmallPosts()} persistKey="unit-test-thread" />);
    expect(screen.getByTestId('thread-toggle-p1')).toHaveAttribute('aria-expanded', 'false');
  });

  it('has no axe violations', async () => {
    const { container } = render(<ThreadedView posts={makeSmallPosts()} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  }, 15000);
});
