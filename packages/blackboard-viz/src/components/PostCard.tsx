'use client';

/**
 * PostCard — single blackboard post renderer.
 *
 * Hosts the KS badge, author chip, timestamp, body (with entity
 * tokenisation), reaction shelf, edit-history toggle, and permalink.
 *
 * Density target: 14 px body / 12 px metadata, matching Linear's
 * Refactoring-UI-aligned activity feed.
 *
 * Accessibility:
 *  - The whole card is a `role="article"` with `tabIndex={0}` so j/k
 *    keyboard nav can land on it.
 *  - Each action satisfies WCAG 2.2 SC 2.5.8 target-size (24 × 24).
 *  - Focus ring rendered via `bb-focusable`.
 */

import type { CSSProperties } from 'react';
import { useState } from 'react';

import type { BlackboardPost, BlackboardEntityClickEventDetail } from '../types';
import { BLACKBOARD_OKLCH_THEME, tokenForKind } from '../themes/blackboard-oklch';
import { parseEntities } from './entity-parser';
import { EntityLink } from './EntityLink';
import { Permalink } from './Permalink';

export interface PostCardProps {
  readonly post: BlackboardPost;
  readonly isFocused?: boolean;
  readonly onClickEntity?: (detail: BlackboardEntityClickEventDetail) => void;
  readonly onFocus?: (postId: string) => void;
  readonly variant?: 'expanded' | 'compact';
}

function shortDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().slice(0, 16).replace('T', ' ');
  } catch {
    return iso;
  }
}

function cardStyle(isFocused: boolean): CSSProperties {
  return {
    background: BLACKBOARD_OKLCH_THEME.surface.oklch,
    border: `1px solid ${
      isFocused
        ? BLACKBOARD_OKLCH_THEME.focusRing.oklch
        : BLACKBOARD_OKLCH_THEME.border.oklch
    }`,
    borderRadius: 10,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    color: BLACKBOARD_OKLCH_THEME.foreground.oklch,
  };
}

function badgeStyle(kindOklch: string): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    background: 'transparent',
    border: `1px solid ${kindOklch}`,
    color: kindOklch,
    borderRadius: 999,
    padding: '1px 8px',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  };
}

function headerStyle(): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  };
}

function metaStyle(): CSSProperties {
  return {
    fontSize: 12,
    color: BLACKBOARD_OKLCH_THEME.muted.oklch,
  };
}

function bodyStyle(): CSSProperties {
  return {
    fontSize: 14,
    lineHeight: 1.5,
    color: BLACKBOARD_OKLCH_THEME.foreground.oklch,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  };
}

function reactionShelfStyle(): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  };
}

function reactionChipStyle(): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
    background: BLACKBOARD_OKLCH_THEME.background.oklch,
    border: `1px solid ${BLACKBOARD_OKLCH_THEME.border.oklch}`,
    borderRadius: 12,
    padding: '2px 6px',
    fontSize: 11,
    minHeight: 24,
    color: BLACKBOARD_OKLCH_THEME.foreground.oklch,
  };
}

export function PostCard({
  post,
  isFocused = false,
  onClickEntity,
  onFocus,
  variant = 'expanded',
}: PostCardProps): JSX.Element {
  const kindToken = tokenForKind(post.knowledgeState);
  const tokens = parseEntities(post.body);
  const [historyOpen, setHistoryOpen] = useState(false);

  function handleFocus(): void {
    if (onFocus) onFocus(post.id);
  }

  const reactionEntries = post.reactions ? Object.entries(post.reactions) : [];

  return (
    <article
      data-testid={`post-card-${post.id}`}
      data-post-id={post.id}
      data-knowledge-state={post.knowledgeState}
      data-region-status={post.regionStatus}
      data-variant={variant}
      tabIndex={0}
      onFocus={handleFocus}
      className="bb-focusable"
      style={cardStyle(isFocused)}
      aria-label={`Post by ${post.author.name} in ${post.region}`}
    >
      <header style={headerStyle()}>
        <span
          data-testid={`ks-badge-${post.id}`}
          style={badgeStyle(kindToken.oklch)}
          aria-label={`Knowledge state ${post.knowledgeState}`}
        >
          {post.knowledgeState}
        </span>
        <strong style={{ fontSize: 13 }}>{post.author.name}</strong>
        <span style={metaStyle()} aria-label="Author kind">
          {post.author.kind === 'agent' ? 'agent' : 'human'}
        </span>
        <span style={metaStyle()}>·</span>
        <time
          data-testid={`timestamp-${post.id}`}
          dateTime={post.createdAt}
          style={metaStyle()}
        >
          {shortDate(post.createdAt)}
        </time>
        <span style={metaStyle()}>·</span>
        <span style={metaStyle()}>#{post.region}</span>
        <span style={{ ...metaStyle(), marginLeft: 'auto' }}>
          <Permalink postId={post.id} />
        </span>
      </header>

      <div data-testid={`post-body-${post.id}`} style={bodyStyle()}>
        {tokens.map((token, idx) => {
          if (token.kind === 'text') {
            return <span key={`t-${idx}`}>{token.value}</span>;
          }
          return (
            <EntityLink
              key={`e-${idx}`}
              entityRef={token.ref}
              originPostId={post.id}
              {...(onClickEntity ? { onClick: onClickEntity } : {})}
            />
          );
        })}
      </div>

      {reactionEntries.length > 0 ? (
        <div
          data-testid={`reactions-${post.id}`}
          style={reactionShelfStyle()}
          aria-label="Reactions"
        >
          {reactionEntries.map(([emoji, count]) => (
            <span key={emoji} style={reactionChipStyle()}>
              <span>{emoji}</span>
              <span>{count}</span>
            </span>
          ))}
        </div>
      ) : null}

      {(post.editCount ?? 0) > 0 ? (
        <div>
          <button
            type="button"
            data-testid={`edit-history-toggle-${post.id}`}
            aria-expanded={historyOpen}
            aria-controls={`edit-history-${post.id}`}
            className="bb-focusable bb-action"
            onClick={() => setHistoryOpen((open) => !open)}
            style={{
              background: 'transparent',
              border: 'none',
              padding: '2px 4px',
              color: BLACKBOARD_OKLCH_THEME.muted.oklch,
              fontSize: 11,
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            {historyOpen ? 'Hide' : 'Show'} edit history ({post.editCount} edits)
          </button>
          {historyOpen ? (
            <div
              id={`edit-history-${post.id}`}
              data-testid={`edit-history-${post.id}`}
              style={{ fontSize: 11, color: BLACKBOARD_OKLCH_THEME.muted.oklch, marginTop: 4 }}
            >
              Last edited {post.updatedAt ? shortDate(post.updatedAt) : 'unknown'}.
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
