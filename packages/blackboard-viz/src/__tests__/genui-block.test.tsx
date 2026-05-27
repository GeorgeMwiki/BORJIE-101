import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from './setup';

import {
  BlackboardVizBlock,
  pickViewForPayload,
} from '../genui-block/blackboard-viz-block';
import { makeSmallPosts } from './fixtures';

describe('BlackboardVizBlock', () => {
  it('selects the requested view via pickViewForPayload', () => {
    expect(pickViewForPayload({ kind: 'blackboard', posts: [] })).toBe('timeline');
    expect(pickViewForPayload({ kind: 'blackboard', view: 'kanban', posts: [] })).toBe('kanban');
    expect(pickViewForPayload({ kind: 'blackboard', view: 'threaded', posts: [] })).toBe('threaded');
    expect(pickViewForPayload({ kind: 'blackboard', view: 'tree-graph', posts: [] })).toBe('tree-graph');
  });

  it('mounts the timeline view by default', () => {
    render(
      <BlackboardVizBlock
        payload={{ kind: 'blackboard', posts: makeSmallPosts() }}
      />,
    );
    expect(screen.getByTestId('blackboard-viz-block')).toHaveAttribute(
      'data-blackboard-view',
      'timeline',
    );
    expect(screen.getByTestId('timeline-view')).toBeInTheDocument();
  });

  it('renders the malformed fallback on an invalid payload', () => {
    render(<BlackboardVizBlock payload={{ kind: 'wrong' } as unknown as Record<string, unknown>} />);
    expect(screen.getByTestId('blackboard-viz-block-malformed')).toBeInTheDocument();
  });

  it('renders the title when provided', () => {
    render(
      <BlackboardVizBlock
        payload={{
          kind: 'blackboard',
          view: 'kanban',
          title: 'Pit-B review',
          posts: makeSmallPosts(),
        }}
      />,
    );
    expect(screen.getByTestId('blackboard-viz-block-title')).toHaveTextContent('Pit-B review');
    expect(screen.getByTestId('kanban-view')).toBeInTheDocument();
  });

  it('has no axe violations across all four view selections', async () => {
    for (const view of ['timeline', 'threaded', 'kanban', 'tree-graph'] as const) {
      const { container, unmount } = render(
        <BlackboardVizBlock
          payload={{ kind: 'blackboard', view, posts: makeSmallPosts() }}
        />,
      );
      const results = await axe(container);
      expect(results, `axe violations in view=${view}`).toHaveNoViolations();
      unmount();
    }
  });
});
