/**
 * HomeMessageList — auto-scrolling message list for HomeShell.
 *
 * Renders the conversation. The composer at the bottom is sticky;
 * this list scrolls inside the remaining viewport. New messages
 * auto-scroll to the bottom — respects prefers-reduced-motion.
 *
 * Spec: HOME_DASHBOARD_STANDARD §8.
 */

import { useEffect, useRef, type CSSProperties } from 'react';
import type { ChatMessage } from './types.js';

export interface HomeMessageListProps {
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly emptyState: string;
  readonly testId?: string | undefined;
}

const LIST_STYLE: CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '64px 16px 24px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const EMPTY_STYLE: CSSProperties = {
  margin: 'auto',
  maxWidth: 480,
  textAlign: 'center',
  color: 'var(--color-muted-foreground, #64748b)',
  fontSize: 15,
  lineHeight: 1.6,
};

function bubbleStyle(role: ChatMessage['role']): CSSProperties {
  const base: CSSProperties = {
    padding: '10px 14px',
    borderRadius: 12,
    fontSize: 14,
    lineHeight: 1.55,
    maxWidth: '75%',
    whiteSpace: 'pre-wrap',
  };
  if (role === 'user') {
    return {
      ...base,
      alignSelf: 'flex-end',
      background: 'var(--color-primary-soft, #f1f5f9)',
      color: 'var(--color-foreground, #0f172a)',
    };
  }
  return {
    ...base,
    alignSelf: 'flex-start',
    background: 'var(--color-card, #ffffff)',
    border: '1px solid var(--color-border, #e5e7eb)',
    color: 'var(--color-foreground, #0f172a)',
  };
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function HomeMessageList(props: HomeMessageListProps): JSX.Element {
  const { messages, emptyState, testId = 'home-message-list' } = props;
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = bottomRef.current;
    if (!node || typeof node.scrollIntoView !== 'function') return;
    const behaviour: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth';
    node.scrollIntoView({ behavior: behaviour, block: 'end' });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div data-testid={testId} style={LIST_STYLE}>
        <div data-testid="home-message-list-empty" style={EMPTY_STYLE}>
          {emptyState}
        </div>
      </div>
    );
  }

  return (
    <div data-testid={testId} style={LIST_STYLE}>
      {messages.map((m) => (
        <div
          key={m.id}
          data-testid={`home-message-${m.role}`}
          style={bubbleStyle(m.role)}
        >
          {m.content}
        </div>
      ))}
      <div ref={bottomRef} aria-hidden="true" />
    </div>
  );
}
