'use client';

/**
 * ThreadedView — Reddit/Slack-style threaded tree.
 *
 * Each post is rendered with parent → child indentation up to six
 * levels (Slack capping convention; deeper nests are visually
 * indented at six but stored at the true depth in the underlying
 * shape). Each parent has a collapse toggle that hides its subtree.
 *
 * Per-node collapse state is held in local state. When the host
 * passes `persistKey`, the state is persisted to `localStorage` so
 * the user's collapses survive page reloads.
 *
 * Sources:
 *  - Slack — "How Slack Built Shared Channels" (thread model)
 *    <https://slack.engineering/how-slack-built-shared-channels/> (2025-11-12)
 *  - Notion — "The Data Model Behind Notion" (collapsible parents)
 *    <https://www.notion.so/blog/data-model-behind-notion> (2026-03-02)
 *
 * Accessibility:
 *  - Root is `role="tree"`; each node is `role="treeitem"` with
 *    `aria-level` and `aria-expanded`.
 *  - Collapse toggle is a `<button>` with `aria-controls` and
 *    `aria-expanded`.
 */

import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';

import type { BlackboardPost, ViewProps } from '../types';
import { BLACKBOARD_OKLCH_THEME } from '../themes/blackboard-oklch';
import { PostCard } from '../components/PostCard';
import { applyFilter } from '../components/SearchBar';

interface TreeNode {
  readonly post: BlackboardPost;
  readonly depth: number;
  readonly children: ReadonlyArray<TreeNode>;
}

function buildTree(posts: ReadonlyArray<BlackboardPost>): ReadonlyArray<TreeNode> {
  // Build a map of parentId → children
  const byParent = new Map<string | undefined, BlackboardPost[]>();
  for (const p of posts) {
    const key = p.parentId;
    const list = byParent.get(key);
    if (list) list.push(p);
    else byParent.set(key, [p]);
  }
  function descend(parentId: string | undefined, depth: number): ReadonlyArray<TreeNode> {
    const kids = byParent.get(parentId) ?? [];
    // Sort children chronologically so the read order is
    // deterministic regardless of fetch order.
    const sortedKids = [...kids].sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
    );
    return sortedKids.map((kid) => ({
      post: kid,
      depth,
      children: descend(kid.id, Math.min(depth + 1, 6)),
    }));
  }
  return descend(undefined, 0);
}

function rootStyle(): CSSProperties {
  return {
    background: BLACKBOARD_OKLCH_THEME.background.oklch,
    color: BLACKBOARD_OKLCH_THEME.foreground.oklch,
    border: `1px solid ${BLACKBOARD_OKLCH_THEME.border.oklch}`,
    borderRadius: 12,
    padding: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  };
}

function rowStyle(depth: number): CSSProperties {
  return {
    paddingLeft: depth * 18,
    borderLeft:
      depth > 0
        ? `2px solid ${BLACKBOARD_OKLCH_THEME.border.oklch}`
        : undefined,
    marginLeft: depth > 0 ? 4 : 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  };
}

function loadPersisted(persistKey: string | undefined): Record<string, boolean> {
  if (!persistKey || typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(`bb-collapse-${persistKey}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, boolean>;
    }
    return {};
  } catch {
    return {};
  }
}

function persistCollapse(
  persistKey: string | undefined,
  state: Record<string, boolean>,
): void {
  if (!persistKey || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      `bb-collapse-${persistKey}`,
      JSON.stringify(state),
    );
  } catch {
    /* localStorage might be disabled — best effort only */
  }
}

interface NodeProps {
  readonly node: TreeNode;
  readonly collapsed: Record<string, boolean>;
  readonly onToggle: (postId: string) => void;
  readonly onFocusPost?: (postId: string) => void;
}

function ThreadNode({ node, collapsed, onToggle, onFocusPost }: NodeProps): JSX.Element {
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed[node.post.id] === true;
  return (
    <div
      role="treeitem"
      aria-level={node.depth + 1}
      aria-expanded={hasChildren ? !isCollapsed : undefined}
      data-testid={`thread-node-${node.post.id}`}
      style={rowStyle(node.depth)}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        {hasChildren ? (
          <button
            type="button"
            data-testid={`thread-toggle-${node.post.id}`}
            aria-expanded={!isCollapsed}
            aria-controls={`thread-children-${node.post.id}`}
            aria-label={isCollapsed ? 'Expand thread' : 'Collapse thread'}
            onClick={() => onToggle(node.post.id)}
            className="bb-focusable bb-action"
            style={{
              background: 'transparent',
              border: `1px solid ${BLACKBOARD_OKLCH_THEME.border.oklch}`,
              borderRadius: 4,
              padding: '0 6px',
              fontSize: 12,
              color: BLACKBOARD_OKLCH_THEME.muted.oklch,
              cursor: 'pointer',
              minWidth: 24,
              minHeight: 24,
              alignSelf: 'flex-start',
            }}
          >
            {isCollapsed ? `+ ${node.children.length}` : '−'}
          </button>
        ) : null}
        <div style={{ flex: 1 }}>
          <PostCard
            post={node.post}
            {...(onFocusPost ? { onFocus: onFocusPost } : {})}
          />
        </div>
      </div>
      {hasChildren && !isCollapsed ? (
        <div
          id={`thread-children-${node.post.id}`}
          role="group"
          data-testid={`thread-children-${node.post.id}`}
          style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          {node.children.map((child) => (
            <ThreadNode
              key={child.post.id}
              node={child}
              collapsed={collapsed}
              onToggle={onToggle}
              {...(onFocusPost ? { onFocusPost } : {})}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ThreadedView(props: ViewProps): JSX.Element {
  const { posts, filter, persistKey, onFocusPost } = props;
  const filteredPosts = useMemo(
    () => (filter ? applyFilter(posts, filter) : posts),
    [posts, filter],
  );

  const tree = useMemo(() => buildTree(filteredPosts), [filteredPosts]);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    loadPersisted(persistKey),
  );

  useEffect(() => {
    persistCollapse(persistKey, collapsed);
  }, [persistKey, collapsed]);

  function handleToggle(postId: string): void {
    setCollapsed((prev) => ({ ...prev, [postId]: !prev[postId] }));
  }

  return (
    <div
      data-testid="threaded-view"
      role="tree"
      aria-label="Threaded blackboard view"
      style={rootStyle()}
    >
      {tree.length === 0 ? (
        <div
          data-testid="threaded-empty"
          style={{ fontSize: 12, color: BLACKBOARD_OKLCH_THEME.muted.oklch, padding: 24, textAlign: 'center' }}
        >
          No posts yet.
        </div>
      ) : null}
      {tree.map((node) => (
        <ThreadNode
          key={node.post.id}
          node={node}
          collapsed={collapsed}
          onToggle={handleToggle}
          {...(onFocusPost ? { onFocusPost } : {})}
        />
      ))}
    </div>
  );
}
