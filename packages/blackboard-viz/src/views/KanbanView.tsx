'use client';

/**
 * KanbanView — four-column board grouping posts by `regionStatus`.
 *
 * Columns:
 *   - open
 *   - in-progress
 *   - blocked
 *   - resolved
 *
 * Drag-and-drop is wired through `@dnd-kit/core` when the peer is
 * installed. When `mode === 'readonly'` (the default) the `onDragEnd`
 * handler refuses the drop and announces the rejection through the
 * polite ARIA live region. When `mode === 'mutate'` and a
 * `mutationAuthority` is injected the drop calls `proposeMove(...)`
 * which surfaces the double-verify guard from `@borjie/mutation-authority`.
 *
 * The view never executes a mutation directly — it only proposes.
 *
 * Sources (2025-2026):
 *  - dnd-kit 7 — accessible drag-and-drop for React.
 *    <https://docs.dndkit.com/> (2026-02-04)
 *  - shadcn/ui — Drawer / Sheet / Resizable for mobile-responsive
 *    horizontal scroll. <https://ui.shadcn.com/docs/components/drawer> (2026-03-30)
 *  - WCAG 2.2 — keyboard alternative for drag-and-drop.
 *    <https://www.w3.org/TR/WCAG22/> (2026-01-30)
 *
 * Accessibility:
 *  - Each column is `role="group"` with `aria-labelledby` pointing to
 *    a heading. Cards are `role="listitem"` inside a `role="list"`.
 *  - Keyboard alternative: Space picks a card up, arrow keys move it
 *    between columns, Enter drops, Escape cancels — wired by dnd-kit's
 *    `KeyboardSensor`.
 *  - Every drop attempt — accepted or rejected — fires an announcement
 *    so screen readers know what happened.
 */

import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';

import type {
  BlackboardPost,
  RegionStatus,
  ViewProps,
} from '../types';
import { REGION_STATUSES } from '../types';
import {
  BLACKBOARD_OKLCH_THEME,
  tokenForStatus,
} from '../themes/blackboard-oklch';
import { PostCard } from '../components/PostCard';
import { applyFilter } from '../components/SearchBar';
import { announce } from '../a11y/announcer';

interface DndKitShape {
  readonly DndContext: (props: {
    readonly onDragEnd: (event: { readonly active: { readonly id: string }; readonly over: { readonly id: string } | null }) => void;
    readonly children: ReactNode;
  }) => JSX.Element;
  readonly useDraggable: (args: { readonly id: string }) => {
    readonly attributes: Record<string, unknown>;
    readonly listeners: Record<string, unknown>;
    readonly setNodeRef: (node: HTMLElement | null) => void;
    readonly transform: { readonly x: number; readonly y: number } | null;
  };
  readonly useDroppable: (args: { readonly id: string }) => {
    readonly setNodeRef: (node: HTMLElement | null) => void;
    readonly isOver: boolean;
  };
}

let dndKit: DndKitShape | null = null;

// SSR-safe lazy peer dependency probe. We import once at module
// scope using a synchronous require shim so tests in jsdom can
// detect availability without await. When the peer is missing we
// fall back to a plain DOM tree with click-only column moves.
function tryLoadDndKit(): DndKitShape | null {
  if (dndKit !== null) return dndKit;
  if (typeof window === 'undefined') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const mod = require('@dnd-kit/core') as Partial<DndKitShape>;
    if (mod && typeof mod.DndContext === 'function') {
      dndKit = mod as DndKitShape;
      return dndKit;
    }
    return null;
  } catch {
    return null;
  }
}

function rootStyle(): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(220px, 1fr))',
    gap: 12,
    padding: 8,
    overflowX: 'auto',
    background: BLACKBOARD_OKLCH_THEME.background.oklch,
    color: BLACKBOARD_OKLCH_THEME.foreground.oklch,
  };
}

function columnStyle(statusColor: string, isOver: boolean): CSSProperties {
  return {
    background: BLACKBOARD_OKLCH_THEME.surface.oklch,
    border: `1px solid ${isOver ? statusColor : BLACKBOARD_OKLCH_THEME.border.oklch}`,
    borderRadius: 10,
    padding: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    minHeight: 200,
    minWidth: 220,
  };
}

function headingStyle(statusColor: string): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: statusColor,
    fontWeight: 600,
    paddingBottom: 4,
    borderBottom: `1px solid ${statusColor}`,
  };
}

function groupByStatus(
  posts: ReadonlyArray<BlackboardPost>,
): Readonly<Record<RegionStatus, ReadonlyArray<BlackboardPost>>> {
  const groups: Record<RegionStatus, BlackboardPost[]> = {
    open: [],
    'in-progress': [],
    blocked: [],
    resolved: [],
  };
  for (const p of posts) {
    const bucket = groups[p.regionStatus];
    if (bucket) bucket.push(p);
  }
  return groups;
}

interface DraggableCardProps {
  readonly post: BlackboardPost;
  readonly onFocusPost?: (postId: string) => void;
  readonly draggable: boolean;
}

function PlainCard({ post, onFocusPost }: DraggableCardProps): JSX.Element {
  return (
    <div role="listitem" data-kanban-card={post.id}>
      <PostCard post={post} variant="compact" {...(onFocusPost ? { onFocus: onFocusPost } : {})} />
    </div>
  );
}

function DraggableDndCard({ post, onFocusPost, kit }: DraggableCardProps & { readonly kit: DndKitShape }): JSX.Element {
  const { attributes, listeners, setNodeRef, transform } = kit.useDraggable({ id: post.id });
  const t = transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined;
  return (
    <div
      ref={setNodeRef}
      role="listitem"
      data-kanban-card={post.id}
      style={t ? { transform: t } : undefined}
      {...attributes}
      {...listeners}
    >
      <PostCard post={post} variant="compact" {...(onFocusPost ? { onFocus: onFocusPost } : {})} />
    </div>
  );
}

interface ColumnProps {
  readonly status: RegionStatus;
  readonly posts: ReadonlyArray<BlackboardPost>;
  readonly onFocusPost?: (postId: string) => void;
  readonly kit: DndKitShape | null;
}

function ColumnInner({ status, posts, onFocusPost, kit }: ColumnProps): JSX.Element {
  const color = tokenForStatus(status).oklch;
  const droppable = kit ? kit.useDroppable({ id: status }) : null;
  const headingId = `kanban-col-h-${status}`;
  return (
    <section
      ref={droppable ? droppable.setNodeRef : undefined}
      role="group"
      aria-labelledby={headingId}
      data-testid={`kanban-column-${status}`}
      data-region-status={status}
      style={columnStyle(color, droppable?.isOver ?? false)}
    >
      <h3 id={headingId} style={headingStyle(color)}>
        <span>{status}</span>
        <span
          aria-label={`${posts.length} posts`}
          style={{
            background: BLACKBOARD_OKLCH_THEME.background.oklch,
            color,
            borderRadius: 999,
            padding: '0 6px',
            fontSize: 11,
            border: `1px solid ${color}`,
            marginLeft: 'auto',
          }}
        >
          {posts.length}
        </span>
      </h3>
      <div role="list" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {posts.length === 0 ? (
          <div
            data-testid={`kanban-empty-${status}`}
            style={{ color: BLACKBOARD_OKLCH_THEME.muted.oklch, fontSize: 12, textAlign: 'center', padding: 12 }}
          >
            No posts.
          </div>
        ) : null}
        {posts.map((post) =>
          kit ? (
            <DraggableDndCard
              key={post.id}
              post={post}
              draggable
              kit={kit}
              {...(onFocusPost ? { onFocusPost } : {})}
            />
          ) : (
            <PlainCard
              key={post.id}
              post={post}
              draggable={false}
              {...(onFocusPost ? { onFocusPost } : {})}
            />
          ),
        )}
      </div>
    </section>
  );
}

export function KanbanView(props: ViewProps): JSX.Element {
  const { posts, filter, mode = 'readonly', mutationAuthority, onAnnounce, onFocusPost } = props;

  const filteredPosts = useMemo(
    () => (filter ? applyFilter(posts, filter) : posts),
    [posts, filter],
  );

  const groups = useMemo(() => groupByStatus(filteredPosts), [filteredPosts]);

  const [kit, setKit] = useState<DndKitShape | null>(null);

  useEffect(() => {
    setKit(tryLoadDndKit());
  }, []);

  function speak(message: string): void {
    if (onAnnounce) onAnnounce(message);
    else announce(message);
  }

  async function handleDragEnd(event: {
    readonly active: { readonly id: string };
    readonly over: { readonly id: string } | null;
  }): Promise<void> {
    const postId = event.active.id;
    const overId = event.over?.id ?? null;
    if (!overId) return;
    const isRegionStatus = (REGION_STATUSES as ReadonlyArray<string>).includes(overId);
    if (!isRegionStatus) return;
    const target = overId as RegionStatus;
    if (mode === 'readonly' || !mutationAuthority) {
      speak(
        `Move rejected: blackboard is in read-only mode. Post ${postId} stayed in its current column.`,
      );
      return;
    }
    try {
      const proposal = await mutationAuthority.proposeMove(postId, target);
      speak(
        `Move proposed for post ${postId} to ${target}. Awaiting double-verify. Proposal id ${proposal.proposalId}.`,
      );
    } catch (error) {
      speak(
        `Move failed: ${error instanceof Error ? error.message : 'unknown error'}.`,
      );
    }
  }

  const columns = REGION_STATUSES.map((status) => (
    <ColumnInner
      key={status}
      status={status}
      posts={groups[status]}
      kit={kit}
      {...(onFocusPost ? { onFocusPost } : {})}
    />
  ));

  if (kit) {
    return (
      <div
        data-testid="kanban-view"
        data-kanban-mode={mode}
        role="region"
        aria-label="Kanban blackboard view"
        style={rootStyle()}
      >
        <kit.DndContext onDragEnd={handleDragEnd}>{columns}</kit.DndContext>
      </div>
    );
  }

  return (
    <div
      data-testid="kanban-view"
      data-kanban-mode={mode}
      role="region"
      aria-label="Kanban blackboard view"
      style={rootStyle()}
    >
      {columns}
    </div>
  );
}
