/**
 * BorjieChatBubble — single message bubble for FloatingAskBorjie.
 *
 * Renders the bubble (user vs assistant styling), a streaming cursor
 * while the SSE stream is open, junior-call breadcrumb chips emitted
 * by the orchestrator, and evidence chips (clickable — opens the
 * citation source via the host-supplied onOpenEvidence callback).
 */
import { useCallback } from 'react';
import type { BorjieLanguage, BorjieMessage } from './useBorjieChat';

interface BorjieChatBubbleProps {
  readonly message: BorjieMessage;
  readonly language: BorjieLanguage;
  readonly onOpenEvidence?: (evidenceId: string) => void;
}

export function BorjieChatBubble({
  message,
  language,
  onOpenEvidence,
}: BorjieChatBubbleProps): JSX.Element {
  const isUser = message.role === 'user';
  const handleEvidence = useCallback(
    (id: string) => {
      if (onOpenEvidence) onOpenEvidence(id);
    },
    [onOpenEvidence],
  );

  return (
    <li
      data-testid={`borjie-bubble-${message.role}`}
      data-streaming={message.streaming || undefined}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
        gap: 6,
        listStyle: 'none',
      }}
    >
      <div
        style={{
          maxWidth: '88%',
          background: isUser ? '#0f172a' : '#f1f5f9',
          color: isUser ? '#f8fafc' : '#0f172a',
          padding: '10px 14px',
          borderRadius: 14,
          fontSize: 13.5,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          border: message.errored ? '1px solid #dc2626' : '1px solid transparent',
        }}
      >
        {message.text || (message.streaming ? '' : message.errored ? errorText(language) : '')}
        {message.streaming ? (
          <span
            aria-hidden="true"
            data-testid="borjie-stream-cursor"
            style={{
              display: 'inline-block',
              width: 6,
              height: 14,
              marginLeft: 3,
              background: isUser ? '#f8fafc' : '#0f172a',
              verticalAlign: '-2px',
              animation: 'borjie-cursor-blink 0.9s steps(2, end) infinite',
            }}
          />
        ) : null}
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
                background: '#e0f2fe',
                color: '#075985',
                padding: '2px 7px',
                borderRadius: 999,
                fontSize: 10.5,
                fontWeight: 500,
                letterSpacing: '0.02em',
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
                aria-label={`${language === 'sw' ? 'Fungua chanzo' : 'Open evidence'} ${id}`}
                style={{
                  background: 'transparent',
                  border: '1px solid #cbd5e1',
                  color: '#334155',
                  padding: '2px 7px',
                  borderRadius: 999,
                  fontSize: 10.5,
                  cursor: 'pointer',
                  fontFamily: 'monospace',
                }}
              >
                {id}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function errorText(language: BorjieLanguage): string {
  return language === 'sw'
    ? 'Samahani — kuna tatizo na mtandao. Jaribu tena.'
    : 'Sorry — something went wrong on the wire. Please try again.';
}
