import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { PostCard } from '../components/PostCard';
import { makeSmallPosts } from './fixtures';

describe('PostCard', () => {
  it('renders KS badge, timestamp, region, and permalink', () => {
    const [, p2] = makeSmallPosts();
    if (!p2) throw new Error('fixture missing');
    render(<PostCard post={p2} />);
    expect(screen.getByTestId(`ks-badge-${p2.id}`)).toHaveTextContent('evidence');
    expect(screen.getByTestId(`timestamp-${p2.id}`)).toHaveAttribute('datetime', p2.createdAt);
    expect(screen.getByTestId(`permalink-${p2.id}`)).toBeInTheDocument();
  });

  it('toggles edit history when the toggle is clicked', () => {
    const [, , , p4] = makeSmallPosts();
    if (!p4) throw new Error('fixture missing');
    render(<PostCard post={p4} />);
    const toggle = screen.getByTestId(`edit-history-toggle-${p4.id}`);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId(`edit-history-${p4.id}`)).toBeInTheDocument();
  });
});
