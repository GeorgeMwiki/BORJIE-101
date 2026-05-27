/**
 * BorjieChatBubble — single message bubble for FloatingAskBorjie.
 *
 * Visual spec mirrors LitFin's `MessageBubble`:
 *   - Assistant bubbles render a 16px BorjieMark on the left, a subtle
 *     warm-gold top accent rail, a soft border, and tabular-nums on any
 *     numeric span.
 *   - User bubbles align right, fill with deep navy, foreground in
 *     paper-cream — same contrast LitFin uses for the user lane.
 *   - While `streaming` is true the bubble shows a 3-dot bouncing
 *     indicator BEFORE the first chunk arrives, and a blinking
 *     typing-cursor at the tail once tokens flow in.
 *   - Junior-call breadcrumbs render as small slate chips below the
 *     bubble.
 *   - Evidence citations render as monospace chips below the breadcrumb
 *     row; clicking opens the evidence via the host-supplied callback.
 *
 * Honours `prefers-reduced-motion`: dots + cursor freeze (no animation)
 * but stay visible as static state markers so streaming is still
 * legible. WCAG 2.2 AA contrast on every text/background pair.
 */
import { useCallback } from 'react';
import { BorjieMark } from './BorjieMark';
import { MESSAGES, t } from './messages';
import type { BorjieLanguage, BorjieMessage } from './useBorjieChat';

interface BorjieChatBubbleProps {
  readonly message: BorjieMessage;
  readonly language: BorjieLanguage;
  readonly onOpenEvidence?: ((evidenceId: string) => void) | undefined;
  /** When true, an empty streaming bubble shows the 3-dot thinking
   *  indicator. Set by the panel based on `isStreaming && !text`. */
  readonly showThinking?: boolean;
  /** Respects user accessibility preference. When true, animations are
   *  collapsed to instant transitions. */
  readonly reducedMotion?: boolean;
}

export function BorjieChatBubble({
  message,
  language,
  onOpenEvidence,
  showThinking = false,
  reducedMotion = false,
}: BorjieChatBubbleProps): JSX.Element {
  const isUser = message.role === 'user';
  const handleEvidence = useCallback(
    (id: string) => {
      if (onOpenEvidence) onOpenEvidence(id);
    },
    [onOpenEvidence],
  );

  const textToShow = message.text
    ? message.text
    : message.errored
    ? t(MESSAGES.errorGeneric, language)
    : '';
  const showThinkingDots =
    !isUser && message.streaming && textToShow.length === 0 && !message.errored;
  const showCursor = !isUser && message.streaming && textToShow.length > 0;

  return (
    <li
      data-testid={`borjie-bubble-${message.role}`}
      data-streaming={message.streaming || undefined}
      style={{
        display: 'flex',
        flexDirection: isUser ? 'row-reverse' : 'row',
        gap: 8,
        alignItems: 'flex-start',
        listStyle: 'none',
      } as React.CSSProperties}
    >
      {!isUser ? (
        <span
          aria-hidden="true"
          style={{
            marginTop: 2,
            flexShrink: 0,
          }}
        >
          <BorjieMark size={20} />
        </span>
      ) : null}

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          maxWidth: '85%',
          minWidth: 0,
          alignItems: isUser ? 'flex-end' : 'flex-start',
        }}
      >
        <div
          style={{
            position: 'relative',
            background: isUser
              ? 'linear-gradient(180deg, #1B2434 0%, #0B0F19 100%)'
              : '#F7F8FA',
            color: isUser ? '#F7F8FA' : '#0B0F19',
            padding: isUser ? '10px 14px' : '12px 14px 12px 14px',
            borderRadius: isUser ? '16px 16px 4px 16px' : '4px 16px 16px 16px',
            fontSize: 13.5,
            lineHeight: 1.55,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflow: 'hidden',
            border: message.errored
              ? '1px solid #E14B4B'
              : isUser
              ? '1px solid rgba(255,255,255,0.06)'
              : '1px solid rgba(11, 15, 25, 0.08)',
            boxShadow: isUser
              ? '0 4px 14px -6px rgba(11, 15, 25, 0.35)'
              : '0 2px 8px -4px rgba(11, 15, 25, 0.10)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {!isUser ? (
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 2,
                background:
                  'linear-gradient(90deg, rgba(255,200,87,0.55) 0%, rgba(245,178,62,0.30) 60%, transparent 100%)',
                pointerEvents: 'none',
              }}
            />
          ) : null}

          {showThinkingDots || showThinking ? (
            <ThinkingDots language={language} reducedMotion={reducedMotion} />
          ) : (
            <>
              {textToShow}
              {showCursor ? (
                <span
                  aria-hidden="true"
                  data-testid="borjie-stream-cursor"
                  style={{
                    display: 'inline-block',
                    width: 6,
                    height: 14,
                    marginLeft: 3,
                    background: isUser ? '#F7F8FA' : '#0B0F19',
                    verticalAlign: '-2px',
                    borderRadius: 1,
                    animation: reducedMotion
                      ? 'none'
                      : 'borjie-cursor-blink 0.9s steps(2, end) infinite',
                  }}
                />
              ) : null}
            </>
          )}
        </div>

        {!isUser && message.juniorCalls.length > 0 ? (
          <ul
            data-testid="borjie-junior-chips"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 4,
              listStyle: 'none',
              padding: 0,
              margin: 0,
            }}
          >
            {message.juniorCalls.map((call, i) => (
              <li
                key={`${call.junior}_${i}`}
                style={{
                  background: 'rgba(255, 200, 87, 0.10)',
                  color: '#7A5A12',
                  padding: '2px 8px',
                  borderRadius: 999,
                  fontSize: 10.5,
                  fontWeight: 500,
                  letterSpacing: '0.02em',
                  border: '1px solid rgba(255, 200, 87, 0.30)',
                }}
              >
                {call.junior} {'→'} {call.status}
              </li>
            ))}
          </ul>
        ) : null}

        {!isUser && message.evidenceIds.length > 0 ? (
          <ul
            data-testid="borjie-evidence-chips"
            aria-label={language === 'sw' ? 'Vyanzo' : 'Evidence'}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 4,
              listStyle: 'none',
              padding: 0,
              margin: 0,
            }}
          >
            {message.evidenceIds.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => handleEvidence(id)}
                  data-testid="borjie-evidence-chip"
                  aria-label={`${
                    language === 'sw' ? 'Fungua chanzo' : 'Open evidence'
                  } ${id}`}
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(11, 15, 25, 0.18)',
                    color: '#334155',
                    padding: '2px 8px',
                    borderRadius: 999,
                    fontSize: 10.5,
                    cursor: 'pointer',
                    fontFamily:
                      "'JetBrains Mono', 'SF Mono', 'Fira Code', ui-monospace, monospace",
                    transition: 'background 120ms ease, border-color 120ms ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 200, 87, 0.12)';
                    e.currentTarget.style.borderColor = 'rgba(245, 178, 62, 0.50)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.borderColor = 'rgba(11, 15, 25, 0.18)';
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.outline = '2px solid #FFC857';
                    e.currentTarget.style.outlineOffset = '2px';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.outline = 'none';
                  }}
                >
                  {id}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

/** 3-dot "thinking" pulse shown inside an assistant bubble while the
 *  brain hasn't emitted its first chunk yet. Mirrors LitFin's identical
 *  pattern. Reduced-motion path swaps the bounce for static dots. */
function ThinkingDots({
  language,
  reducedMotion,
}: {
  readonly language: BorjieLanguage;
  readonly reducedMotion: boolean;
}): JSX.Element {
  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="borjie-thinking-dots"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        color: 'rgba(11, 15, 25, 0.55)',
      }}
    >
      <span style={{ display: 'inline-flex', gap: 3 }}>
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            aria-hidden="true"
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: '#8B6914',
              opacity: 0.65,
              animation: reducedMotion
                ? 'none'
                : `borjie-bounce 1.05s ease-in-out ${delay}ms infinite`,
            }}
          />
        ))}
      </span>
      <span style={{ fontSize: 11, fontStyle: 'italic' }}>
        {t(MESSAGES.thinking, language)}…
      </span>
    </span>
  );
}
