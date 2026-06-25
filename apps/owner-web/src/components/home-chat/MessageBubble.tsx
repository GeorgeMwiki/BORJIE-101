'use client';

/**
 * MessageBubble — single chat row (assistant or owner). Independent
 * author against the owner-chat stepper/learning design spec §5 +
 * §6 — visually equivalent to the reference UnifiedChat MessageBubble,
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
  /**
   * Per-message action row (copy / regenerate / voice). Rendered AFTER the
   * text on an assistant row — hover-reveal on desktop, always-visible on
   * mobile (the caller owns the contents; this component owns the placement).
   */
  readonly actions?: ReactNode;
  /**
   * Trailing label shown once the turn completes (e.g. "Mr. Mwikila ·
   * <persona>"). Fades in with the action row; omitted while streaming.
   */
  readonly trailingLabel?: ReactNode;
}

function PersonaAvatar(): ReactElement {
  // Inline mining mark — keep the reference pattern (always-on persona
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
  actions,
  trailingLabel,
}: MessageBubbleProps): ReactElement {
  const isOwner = role === 'user';
  const label = isOwner ? 'Owner' : 'Mr. Mwikila';

  // OWNER row — keep the compact, right-aligned bubble (asymmetric corners,
  // amber tint). ASSISTANT row — flat, full-width, no bubble chrome: a 28px
  // avatar gutter, optional faint surface, body that reads like a document.
  if (isOwner) {
    return (
      <div
        data-testid={testId ?? `home-chat-bubble-${role}`}
        data-streaming={streaming || undefined}
        data-errored={errored || undefined}
        className="group relative flex animate-fade-up justify-end gap-3"
      >
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-warning/15 px-4 py-2.5 text-sm leading-relaxed text-foreground ring-1 ring-warning/25">
          {children}
          <p className="mt-1.5 text-[10px] text-muted-foreground/70">
            <span className="sr-only">{label} · </span>
            {fmtTime(createdAt)}
          </p>
        </div>
        <OwnerAvatar />
      </div>
    );
  }

  return (
    <div
      data-testid={testId ?? `home-chat-bubble-${role}`}
      data-streaming={streaming || undefined}
      data-errored={errored || undefined}
      className="group relative flex w-full animate-fade-up justify-start gap-3"
    >
      <PersonaAvatar />
      <div className="min-w-0 flex-1">
        {/* Flat assistant register (Claude.ai / Linear): the answer reads as a
            document in the reading spine — NO bubble, bg, or padding box. The
            error state earns a subtle left-accent treatment, not a bubble. */}
        <div
          className={cn(
            'text-foreground transition-colors',
            errored &&
              'rounded-lg border-l-2 border-destructive/50 bg-destructive/5 py-2 pl-3',
          )}
        >
          {children}
          {streaming ? (
            <span
              aria-hidden="true"
              data-testid="home-chat-stream-cursor"
              className="home-chat-caret"
            />
          ) : null}
        </div>

        {/* Meta row — persona label (on a completed turn) or timestamp, plus
            the per-message action row (copy / regenerate). After the text;
            hover-reveal on desktop, always-visible on mobile. Hidden while
            streaming (the caret carries the live state). */}
        {!streaming ? (
          <div className="mt-1.5 flex items-center gap-2 px-1">
            {trailingLabel ? (
              <span
                data-testid="home-chat-persona-label"
                className="animate-fade-in text-[10px] text-muted-foreground/70"
              >
                <span className="sr-only">{label} · </span>
                {trailingLabel}
              </span>
            ) : (
              <span className="text-[10px] text-muted-foreground/60">
                <span className="sr-only">{label} · </span>
                {fmtTime(createdAt)}
              </span>
            )}
            {actions ? (
              <span className="flex items-center gap-1 opacity-100 transition-opacity duration-150 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                {actions}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export interface TypingBubbleProps {
  readonly language: 'sw' | 'en';
}

export function TypingBubble({ language }: TypingBubbleProps): ReactElement {
  const thinking = language === 'sw' ? 'Inafikiri…' : 'Thinking…';
  return (
    <div
      data-testid="home-chat-typing"
      className="flex w-full animate-fade-up justify-start gap-3"
    >
      <PersonaAvatar />
      <div className="min-w-0 flex-1 rounded-xl bg-surface/40 px-3 py-2.5">
        <span className="sr-only" role="status" aria-live="polite">
          {thinking}
        </span>
        {/* Shimmer skeleton lines — a premium "drafting" affordance that
            replaces the three bouncing dots. Decorative; the SR text above
            carries the status. */}
        <div className="flex flex-col gap-2" aria-hidden="true">
          <span className="home-chat-skeleton h-3 w-3/4" />
          <span className="home-chat-skeleton h-3 w-full" />
          <span className="home-chat-skeleton h-3 w-2/5" />
        </div>
      </div>
    </div>
  );
}
