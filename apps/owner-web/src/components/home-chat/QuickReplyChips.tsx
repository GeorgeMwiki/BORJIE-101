'use client';

/**
 * QuickReplyChips — chip row rendered under the latest assistant
 * bubble. Independent author against
 * Docs/DESIGN/LITFIN_STEPPER_LEARNING_SPEC.md §7 — matches the pill
 * shape, gap, horizontal wrap, hover overlay and the "Or type your
 * own" affordance used by LitFin, with Borjie gold tokens.
 *
 * The row is `pl-10` so each chip lines up with the message body
 * column (after the 28px avatar + 12px gap gutter the bubble uses).
 */

import type { ReactElement } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@borjie/design-system';

export interface QuickReply {
  readonly value: string;
  readonly label?: string;
  readonly labelSw?: string;
  readonly emoji?: string;
}

export interface QuickReplyChipsProps {
  readonly replies: ReadonlyArray<QuickReply>;
  readonly language: 'sw' | 'en';
  readonly onSelect: (value: string) => void;
  readonly disabled?: boolean;
  /** Optional eyebrow label rendered above the chip row. */
  readonly eyebrow?: string;
}

export function QuickReplyChips({
  replies,
  language,
  onSelect,
  disabled = false,
  eyebrow,
}: QuickReplyChipsProps): ReactElement | null {
  if (replies.length === 0) return null;
  const isSw = language === 'sw';
  return (
    <div className="pl-10 animate-fade-up" data-testid="home-chat-quick-replies">
      {eyebrow ? (
        <p className="mb-1.5 text-tiny uppercase tracking-wide text-neutral-500">
          {eyebrow}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {replies.map((reply, i) => {
          const label = (isSw && reply.labelSw) || reply.label || reply.value;
          return (
            <button
              key={`${reply.value}_${i}`}
              type="button"
              onClick={() => onSelect(reply.value)}
              disabled={disabled}
              data-testid="home-chat-quick-reply"
              className={cn(
                'group relative inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium',
                'transition-all duration-200 backdrop-blur-sm cursor-pointer select-none whitespace-nowrap shrink-0',
                'bg-warning/[0.10] border border-warning/30 text-warning',
                'hover:bg-warning/15 hover:border-warning/40 disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              <span
                aria-hidden="true"
                className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none bg-gradient-to-br from-warning/[0.10] to-transparent"
              />
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-px rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none bg-gradient-to-r from-transparent via-warning/40 to-transparent"
              />
              {reply.emoji ? (
                <span className="relative text-sm">{reply.emoji}</span>
              ) : null}
              <span className="relative opacity-90 group-hover:opacity-100 transition-opacity duration-200">
                {label}
              </span>
              <ChevronRight
                aria-hidden="true"
                className="relative h-2.5 w-2.5 opacity-0 -translate-x-1 group-hover:opacity-40 group-hover:translate-x-0 transition-all duration-200"
              />
            </button>
          );
        })}
        <span className="inline-flex items-center px-3 py-2 text-[11px] text-muted-foreground/60 italic">
          {isSw ? 'au andika lako' : 'or type your own'}
        </span>
      </div>
    </div>
  );
}
