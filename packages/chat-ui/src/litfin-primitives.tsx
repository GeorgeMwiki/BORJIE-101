/**
 * Canonical chat-UI visual primitives (Borjie port of LitFin source).
 *
 * Every Borjie chat surface (marketing widget, owner-web cockpit chat,
 * admin-web chat, workforce-mobile chat shim, buyer-mobile chat shim,
 * blackboard adapter, mini panel) must use these primitives so the
 * brand experience is consistent. Per-surface settings are exposed
 * through slots (`actions`, `extras`, `composerActions`) — the visual
 * shell stays identical.
 *
 * Source of truth this mirrors (verbatim port + BorjieMark swap):
 *   LITFIN_PATH/src/components/chat-ui/index.tsx
 *
 * If you change the look here, BorjieChatPanel + FloatingChatWidget must
 * follow (or be migrated to consume these primitives).
 *
 * Color tokens (copper-on-cream — the LitFin brand wash):
 *   - Header gradient: linear-gradient(135deg, hsl(36 86% 64%) 0%, hsl(24 72% 50%) 45%, hsl(14 62% 28%) 100%)
 *   - User bubble:     linear-gradient(135deg, hsl(24 78% 54%) 0%, hsl(14 62% 30%) 100%)
 *   - AI bubble:       cream surface, copper-tinted shadow
 */

'use client';

import { type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ShieldCheck } from 'lucide-react';

import { BorjieMark } from './borjie/BorjieMark';

// ---------------------------------------------------------------------------
// `cn` — tiny class joiner (avoids a workspace dep for a one-line util).
// ---------------------------------------------------------------------------
function cn(...parts: ReadonlyArray<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Tokens — copper-on-cream gradients (LitFin canonical palette). Same
// palette as the LitFin / Borjie warm-gold marks. Change here → every
// chat surface updates in one shot.
// ---------------------------------------------------------------------------

/** Header bar — bright copper → mid copper → deep ember (3-stop, 135°). */
export const CHAT_HEADER_GRADIENT =
  'bg-[linear-gradient(135deg,hsl(36_86%_64%)_0%,hsl(24_72%_50%)_45%,hsl(14_62%_28%)_100%)]';

/** User bubble — copper → ember (2-stop). */
export const CHAT_USER_BUBBLE =
  'bg-[linear-gradient(135deg,hsl(24_78%_54%)_0%,hsl(14_62%_30%)_100%)] text-primary-foreground rounded-br-md shadow-[0_16px_40px_-12px_hsl(14_62%_30%/0.45),0_4px_12px_hsl(24_72%_50%/0.18)]';

/** AI bubble — cream surface, soft border, warm copper-tinted shadow. */
export const CHAT_AI_BUBBLE =
  'bg-card/85 text-foreground rounded-bl-md border border-border/40 shadow-[0_12px_28px_-12px_hsl(24_60%_36%/0.18),0_2px_6px_hsl(14_50%_24%/0.06)]';

// ---------------------------------------------------------------------------
// ChatShellHeader — gradient bar with logo, title, awareness badge, and
// an `actions` slot for per-surface controls. Includes the gloss sweep.
// ---------------------------------------------------------------------------

export interface ChatShellHeaderProps {
  readonly title: string;
  /** Small label under the title — typically "Aware of: <page>". */
  readonly subtitle?: ReactNode;
  /** Right-side icon row. Each item should be a button or link. */
  readonly actions?: ReactNode;
  /** Whether to render the slow gloss sweep. Default: respects motion pref. */
  readonly showGloss?: boolean;
}

export function ChatShellHeader({
  title,
  subtitle,
  actions,
  showGloss = true,
}: ChatShellHeaderProps): JSX.Element {
  const reduceMotion = useReducedMotion();
  const renderGloss = showGloss && !reduceMotion;
  return (
    <div
      className={cn(
        'relative flex items-center justify-between overflow-hidden border-b border-white/10 px-4 py-3 text-primary-foreground',
        CHAT_HEADER_GRADIENT,
      )}
    >
      {renderGloss && (
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/20 to-transparent"
          initial={{ x: 0 }}
          animate={{ x: ['-30%', '330%'] }}
          transition={{
            duration: 5,
            repeat: Infinity,
            repeatDelay: 2,
            ease: 'easeInOut',
          }}
        />
      )}
      <div className="relative flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-foreground/15 ring-1 ring-primary-foreground/20 shadow-[0_4px_12px_rgb(0_0_0_/_0.1)] backdrop-blur-sm">
          <BorjieMark size={20} />
        </div>
        <div>
          <h3 className="text-sm font-semibold leading-tight">{title}</h3>
          {subtitle &&
            (typeof subtitle === 'string' ? (
              <span className="text-[10px] text-primary-foreground/60">
                {subtitle}
              </span>
            ) : (
              subtitle
            ))}
        </div>
      </div>
      {actions && (
        <div className="relative flex items-center gap-0.5">{actions}</div>
      )}
    </div>
  );
}

/** Standard header icon button — for use inside `ChatShellHeader#actions`. */
export function ChatHeaderIconButton(props: {
  readonly onClick?: () => void;
  readonly ariaLabel: string;
  readonly active?: boolean;
  readonly title?: string;
  readonly children: ReactNode;
}): JSX.Element {
  const { onClick, ariaLabel, active, title, children } = props;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      title={title ?? ariaLabel}
      className={cn(
        'rounded-lg p-1.5 transition-colors',
        active
          ? 'bg-primary-foreground/20 text-primary-foreground'
          : 'text-primary-foreground/50 hover:bg-primary-foreground/10 hover:text-primary-foreground/80',
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// TypingDots — the 3-bouncing-dot indicator.
// ---------------------------------------------------------------------------

export function TypingDots(): JSX.Element {
  return (
    <div className="flex justify-start">
      <div className="flex gap-2">
        <div className="relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center">
          <motion.span
            aria-hidden="true"
            className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/30 via-emerald-500/20 to-cyan-500/15 blur-md"
            animate={{ opacity: [0.4, 0.9, 0.4], scale: [0.95, 1.08, 0.95] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          />
          <BorjieMark size={26} />
        </div>
        <div className={cn('rounded-2xl px-4 py-3', CHAT_AI_BUBBLE)}>
          <div className="flex items-center gap-1">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="block h-1.5 w-1.5 rounded-full bg-muted-foreground/60"
                animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
                transition={{
                  duration: 1.0,
                  repeat: Infinity,
                  ease: 'easeInOut',
                  delay: i * 0.15,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatShellEmptyState — shown when a chat has no messages yet.
// ---------------------------------------------------------------------------

export interface ChatShellEmptyStateProps {
  readonly title: string;
  readonly hint?: string;
  readonly suggestions?: ReadonlyArray<string>;
  readonly onSuggestionClick?: (suggestion: string) => void;
}

export function ChatShellEmptyState({
  title,
  hint,
  suggestions,
  onSuggestionClick,
}: ChatShellEmptyStateProps): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-8 text-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative mb-4"
      >
        <span
          aria-hidden="true"
          className="absolute inset-0 -z-10 rounded-full bg-gradient-to-br from-primary/20 via-emerald-500/15 to-cyan-500/10 blur-2xl"
        />
        <BorjieMark size={48} />
      </motion.div>
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      {hint && (
        <p className="mt-1 max-w-[28ch] text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {suggestions && suggestions.length > 0 && (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSuggestionClick?.(s)}
              className="rounded-full border border-border/60 bg-card/60 px-3 py-1.5 text-[11px] text-muted-foreground transition-all hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatShellBody — wraps the messages list with subtle scroll fade masks.
// ---------------------------------------------------------------------------

export function ChatShellBody({
  children,
}: {
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <div className="relative flex-1 overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-background to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-gradient-to-t from-background to-transparent"
      />
      <div className="h-full overflow-y-auto bg-gradient-to-b from-background/40 to-background">
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatShellMessageRow — canonical bubble layout.
// ---------------------------------------------------------------------------

export interface ChatShellMessageRowProps {
  readonly role: 'ai' | 'user';
  readonly children: ReactNode;
  readonly timestamp?: string;
  readonly onPlayAudio?: () => void;
  readonly isPlayingAudio?: boolean;
  /** Show the small gradient accent line on the top of AI bubbles. */
  readonly showAccent?: boolean;
}

export function ChatShellMessageRow({
  role,
  children,
  timestamp,
  onPlayAudio,
  isPlayingAudio,
  showAccent = true,
}: ChatShellMessageRowProps): JSX.Element {
  const isUser = role === 'user';
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, x: isUser ? 12 : -12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, x: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
      className={cn('flex', isUser ? 'justify-end' : 'justify-start')}
    >
      <div
        className={cn(
          'flex gap-2 max-w-[85%]',
          isUser ? 'flex-row-reverse' : 'flex-row',
        )}
      >
        {!isUser && (
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center">
            <BorjieMark size={26} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              'group/bubble relative rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
              'transition-all duration-300 hover:-translate-y-[1px]',
              isUser
                ? cn(
                    CHAT_USER_BUBBLE,
                    'hover:shadow-[0_22px_50px_rgb(15_23_42_/_0.16)]',
                  )
                : cn(
                    CHAT_AI_BUBBLE,
                    'hover:shadow-[0_14px_32px_rgb(15_23_42_/_0.08)] hover:border-border/60',
                  ),
            )}
          >
            {!isUser && showAccent && (
              <div className="absolute inset-x-0 top-0 h-[2px] rounded-t-2xl bg-gradient-to-r from-primary/40 via-emerald-500/30 to-cyan-500/20" />
            )}
            {children}
          </div>
          {(timestamp || (!isUser && onPlayAudio)) && (
            <div
              className={cn(
                'mt-1 flex items-center gap-2 px-1',
                isUser ? 'justify-end' : 'justify-start',
              )}
            >
              {timestamp && (
                <span className="text-[10px] text-muted-foreground">
                  {timestamp}
                </span>
              )}
              {!isUser && onPlayAudio && (
                <button
                  type="button"
                  onClick={onPlayAudio}
                  className={cn(
                    'inline-flex items-center justify-center rounded-full p-1 transition-all',
                    isPlayingAudio
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground/60 hover:bg-primary/5 hover:text-primary',
                  )}
                  aria-label={isPlayingAudio ? 'Playing audio' : 'Play audio'}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// ChatShellComposer — canonical 3-button composer (mic, attach, input, send).
// ---------------------------------------------------------------------------

export interface ChatShellComposerProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onVoiceToggle?: () => void;
  readonly onAttach?: () => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly isRecording?: boolean;
  /** Slot for additional left-side buttons before the textarea. */
  readonly extraButtons?: ReactNode;
  /** Left side of the status row — typically "Chat in <Lang>". */
  readonly statusLeft?: ReactNode;
  /** Right side of the status row — typically "Mic ready" / "Recording". */
  readonly statusRight?: ReactNode;
}

export function ChatShellComposer({
  value,
  onChange,
  onSubmit,
  onVoiceToggle,
  onAttach,
  placeholder,
  disabled,
  isRecording,
  extraButtons,
  statusLeft,
  statusRight,
}: ChatShellComposerProps): JSX.Element {
  return (
    <div className="shrink-0 border-t border-border px-4 py-3">
      <div className="flex items-end gap-2">
        {onVoiceToggle && (
          <button
            type="button"
            onClick={onVoiceToggle}
            disabled={disabled}
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors disabled:opacity-40',
              isRecording
                ? 'bg-red-500 text-white shadow-lg shadow-red-500/30 hover:bg-red-600'
                : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground',
            )}
            aria-label={isRecording ? 'Stop recording' : 'Voice input'}
          >
            {isRecording ? (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
            )}
          </button>
        )}
        {onAttach && (
          <button
            type="button"
            onClick={onAttach}
            disabled={disabled}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:opacity-40"
            aria-label="Attach image"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </button>
        )}
        {extraButtons}
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (!disabled && value.trim()) onSubmit();
            }
          }}
          placeholder={placeholder ?? 'Ask Mr. Mwikila anything…'}
          disabled={disabled || isRecording}
          rows={1}
          className="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || isRecording || !value.trim()}
          className={cn(
            'relative flex h-10 w-10 items-center justify-center rounded-full text-primary-foreground transition-all hover:scale-[1.04] active:scale-[0.96] disabled:opacity-40 disabled:hover:scale-100',
            // Canonical copper-gradient round send (matches widget + IgnitionHero)
            'bg-[linear-gradient(135deg,hsl(36_86%_64%)_0%,hsl(24_78%_54%)_50%,hsl(14_62%_36%)_100%)]',
            'shadow-[0_8px_20px_-4px_hsl(24_72%_50%/0.45),0_2px_6px_hsl(14_62%_30%/0.2)]',
            'hover:shadow-[0_10px_24px_-4px_hsl(24_72%_50%/0.55),0_3px_8px_hsl(14_62%_30%/0.25)]',
          )}
          aria-label="Send"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </div>
      {(statusLeft || statusRight) && (
        <div className="mt-2 flex items-center justify-between">
          {statusLeft ? (
            <span className="text-[10px] text-muted-foreground">
              {statusLeft}
            </span>
          ) : (
            <span />
          )}
          {statusRight && (
            <span className="text-[10px] text-muted-foreground">
              {statusRight}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatShellDisclaimer — wraps the canonical "AI-generated · not advice"
// notice. Mining estate flavour (Borjie-specific copy, not finance).
// ---------------------------------------------------------------------------

export interface ChatShellDisclaimerProps {
  readonly language?: 'en' | 'sw';
}

export function ChatShellDisclaimer({
  language = 'en',
}: ChatShellDisclaimerProps): JSX.Element {
  const text =
    language === 'sw'
      ? 'Imezalishwa na AI · Si ushauri wa kisheria · Maamuzi yanafanywa na mmiliki'
      : 'AI-generated · Not legal advice · Decisions are made by the mining owner';
  return (
    <div
      role="note"
      aria-label="AI compliance notice"
      className={cn(
        'flex items-center gap-2 border-t border-border/40 px-4 py-1.5',
        'bg-gradient-to-r from-gray-50/80 via-gray-50/60 to-gray-50/80',
        'dark:from-white/5 dark:via-white/[0.025] dark:to-white/5',
      )}
    >
      <ShieldCheck
        size={11}
        className="shrink-0 text-emerald-600/60 dark:text-emerald-400/60"
        aria-hidden="true"
      />
      <p className="min-w-0 flex-1 truncate text-[10px] font-medium leading-tight text-muted-foreground/80">
        {text}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatShell — convenience wrapper that composes the four primitives in
// the canonical layout.
// ---------------------------------------------------------------------------

export interface ChatShellProps {
  readonly header: ReactNode;
  readonly children: ReactNode;
  readonly disclaimer?: ReactNode;
  readonly composer: ReactNode;
  readonly className?: string;
}

export function ChatShell({
  header,
  children,
  disclaimer,
  composer,
  className,
}: ChatShellProps): JSX.Element {
  return (
    <div
      className={cn(
        'relative flex flex-col overflow-hidden rounded-[28px] border border-border/50 bg-background/92 backdrop-blur-2xl',
        'shadow-[0_28px_80px_rgb(15_23_42_/_0.22)] ring-1 ring-border/30',
        className,
      )}
    >
      {header}
      <div className="flex-1 overflow-hidden bg-gradient-to-b from-background/40 to-background">
        {children}
      </div>
      {disclaimer ?? <ChatShellDisclaimer />}
      {composer}
    </div>
  );
}
