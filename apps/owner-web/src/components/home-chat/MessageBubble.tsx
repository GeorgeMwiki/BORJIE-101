'use client';

/**
 * MessageBubble — single chat row (assistant or owner). Independent
 * author against Docs/DESIGN/LITFIN_STEPPER_LEARNING_SPEC.md §5 +
 * §6 — visually equivalent to LitFin's UnifiedChat MessageBubble,
 * rendered with Borjie navy / gold tokens and design-system primitives.
 *
 * Single source of bubble chrome (avatar gutter, rounded asymmetric
 * corners, timestamp, streaming cursor, typing dots). The body of the
 * message is rendered by the caller (HomeChatTeach) so this component
 * stays cohesive — it doesn't know about inline blocks, ui_blocks,
 * quick replies, etc.
 */

import type { ReactElement, ReactNode } from 'react';
import { User } from 'lucide-react';
import { cn } from '@borjie/design-system';
import { fmtTime } from '@/lib/format';

export interface MessageBubbleProps {
  readonly role: 'assistant' | 'user';
  readonly createdAt: string;
  readonly errored?: boolean;
  readonly streaming?: boolean;
  readonly children: ReactNode;
  readonly testId?: string;
}

function PersonaAvatar(): ReactElement {
  // Inline mining mark — keep the LitFin pattern (always-on persona
  // glyph in the avatar gutter) without depending on the marketing
  // wordmark for an authenticated surface.
  return (
    <span
      aria-hidden="true"
      className="flex h-7 w-7 items-center justify-center rounded-full shrink-0 mt-0.5 bg-gradient-to-br from-warning to-warning/70 shadow-sm shadow-warning/20"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5 text-primary-foreground"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 2 4 8l8 6 8-6-8-6Z" />
        <path d="M4 16l8 6 8-6" />
        <path d="M4 12l8 6 8-6" />
      </svg>
    </span>
  );
}

function OwnerAvatar(): ReactElement {
  return (
    <span
      aria-hidden="true"
      className="flex h-7 w-7 items-center justify-center rounded-full shrink-0 mt-0.5 bg-gradient-to-br from-neutral-700 to-neutral-800"
    >
      <User aria-hidden="true" className="h-3.5 w-3.5 text-neutral-300" />
    </span>
  );
}

export function MessageBubble({
  role,
  createdAt,
  errored = false,
  streaming = false,
  children,
  testId,
}: MessageBubbleProps): ReactElement {
  const isOwner = role === 'user';
  const label = isOwner ? 'Owner' : 'Borjie Teach';

  return (
    <div
      data-testid={testId ?? `home-chat-bubble-${role}`}
      data-streaming={streaming || undefined}
      data-errored={errored || undefined}
      className={cn('relative flex gap-3 animate-fade-up', isOwner ? 'justify-end' : 'justify-start')}
    >
      {!isOwner ? <PersonaAvatar /> : null}

      <div
        className={cn(
          'max-w-[80%] text-sm leading-relaxed',
          isOwner
            ? 'rounded-2xl rounded-tr-sm bg-warning/15 ring-1 ring-warning/25 text-foreground px-4 py-2.5'
            : errored
              ? 'rounded-2xl rounded-tl-sm bg-destructive/10 ring-1 ring-destructive/30 text-foreground px-4 py-2.5'
              : 'rounded-2xl rounded-tl-sm bg-surface/70 dark:bg-white/[0.04] text-foreground px-4 py-2.5',
        )}
      >
        {children}
        {streaming ? (
          <span
            aria-hidden="true"
            data-testid="home-chat-stream-cursor"
            className="inline-block w-1.5 h-4 ml-0.5 bg-warning animate-pulse rounded-sm align-text-bottom"
          />
        ) : null}
        <p
          className={cn(
            'text-[10px] mt-1.5',
            isOwner ? 'text-muted-foreground/70' : 'text-muted-foreground/60',
          )}
        >
          <span className="sr-only">{label} · </span>
          {fmtTime(createdAt)}
        </p>
      </div>

      {isOwner ? <OwnerAvatar /> : null}
    </div>
  );
}

export interface TypingBubbleProps {
  readonly language: 'sw' | 'en';
}

export function TypingBubble({ language }: TypingBubbleProps): ReactElement {
  return (
    <div
      data-testid="home-chat-typing"
      className="flex justify-start animate-fade-up"
    >
      <div className="flex items-center gap-3">
        <PersonaAvatar />
        <div className="flex flex-col gap-1 px-4 py-3 rounded-2xl rounded-tl-sm bg-surface/70 dark:bg-white/[0.04]">
          <span className="text-xs text-muted-foreground">
            {language === 'sw' ? 'Inafikiri…' : 'Thinking…'}
          </span>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-warning animate-pulse" style={{ animationDelay: '0ms' }} />
            <span className="w-2 h-2 rounded-full bg-warning animate-pulse" style={{ animationDelay: '150ms' }} />
            <span className="w-2 h-2 rounded-full bg-warning animate-pulse" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      </div>
    </div>
  );
}
