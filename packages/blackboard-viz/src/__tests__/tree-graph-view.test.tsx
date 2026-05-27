import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from './setup';

import { TreeGraphView } from '../views/TreeGraphView';
import { makeSmallPosts } from './fixtures';

describe('TreeGraphView', () => {
  it('mounts a graph surface for a non-empty post list', () => {
    render(<TreeGraphView posts={makeSmallPosts()} />);
    expect(screen.getByTestId('tree-graph-view')).toBeInTheDocument();
    // We accept either the in-package fallback SVG (when the peer
    // `@borjie/graph-viz` is not resolvable) or the engine surface
    // (when it is). Both must result in *some* SVG mounted under the
    // tree-graph-view container.
    const view = screen.getByTestId('tree-graph-view');
    const svgs = view.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThanOrEqual(1);
  });

  it('renders the empty state when given no posts', () => {
    render(<TreeGraphView posts={[]} />);
    expect(screen.getByTestId('tree-graph-empty')).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = render(<TreeGraphView posts={makeSmallPosts()} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
