import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from './setup';

import { KanbanView } from '../views/KanbanView';
import { makeSmallPosts } from './fixtures';

describe('KanbanView', () => {
  it('mounts and renders all four columns', () => {
    render(<KanbanView posts={makeSmallPosts()} />);
    expect(screen.getByTestId('kanban-view')).toHaveAttribute('data-kanban-mode', 'readonly');
    expect(screen.getByTestId('kanban-column-open')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-column-in-progress')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-column-blocked')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-column-resolved')).toBeInTheDocument();
  });

  it('groups posts into their regionStatus column', () => {
    render(<KanbanView posts={makeSmallPosts()} />);
    expect(screen.getByTestId('kanban-column-open')).toContainElement(
      screen.getByTestId('post-card-p1'),
    );
    expect(screen.getByTestId('kanban-column-resolved')).toContainElement(
      screen.getByTestId('post-card-p3'),
    );
    expect(screen.getByTestId('kanban-column-blocked')).toContainElement(
      screen.getByTestId('post-card-p4'),
    );
  });

  it('mounts in mode "mutate" with the mutationAuthority injected', () => {
    const proposeMove = vi.fn().mockResolvedValue({ proposalId: 'proposal-1' });
    render(
      <KanbanView
        posts={makeSmallPosts()}
        mode="mutate"
        mutationAuthority={{ proposeMove }}
      />,
    );
    expect(screen.getByTestId('kanban-view')).toHaveAttribute('data-kanban-mode', 'mutate');
  });

  it('has no axe violations', async () => {
    const { container } = render(<KanbanView posts={makeSmallPosts()} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  }, 15000);
});
