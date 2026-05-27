import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe } from './setup';

import { TimelineView } from '../views/TimelineView';
import { makeSmallPosts } from './fixtures';
import type { BlackboardPost } from '../types';

describe('TimelineView', () => {
  it('mounts without throwing on an empty post list', () => {
    render(<TimelineView posts={[]} />);
    expect(screen.getByTestId('timeline-view')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-empty')).toBeInTheDocument();
  });

  it('renders one post-card per post in reverse-chronological order', () => {
    const posts: ReadonlyArray<BlackboardPost> = makeSmallPosts();
    render(<TimelineView posts={posts} />);
    const cards = screen.getAllByTestId(/^post-card-p/);
    expect(cards).toHaveLength(posts.length);
    // The newest post (p4 — 2026-05-27) must precede the oldest (p1).
    const ids = cards.map((c) => c.getAttribute('data-post-id'));
    expect(ids.indexOf('p4')).toBeLessThan(ids.indexOf('p1'));
  });

  it('keyboard "j" advances focus to the next post', () => {
    render(<TimelineView posts={makeSmallPosts()} />);
    const root = screen.getByTestId('timeline-view');
    root.focus();
    fireEvent.keyDown(root, { key: 'j' });
    const cards = screen.getAllByTestId(/^post-card-p/);
    expect(document.activeElement).toBe(cards[0]);
  });

  it('keyboard "k" retreats focus to the previous post', () => {
    render(<TimelineView posts={makeSmallPosts()} />);
    const root = screen.getByTestId('timeline-view');
    root.focus();
    fireEvent.keyDown(root, { key: 'j' });
    fireEvent.keyDown(root, { key: 'j' });
    fireEvent.keyDown(root, { key: 'k' });
    const cards = screen.getAllByTestId(/^post-card-p/);
    expect(document.activeElement).toBe(cards[0]);
  });

  it('has no axe violations', async () => {
    const { container } = render(<TimelineView posts={makeSmallPosts()} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
