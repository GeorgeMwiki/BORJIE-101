/**
 * MessageBubble — user + mwikila variants, markdown rendered body,
 * optional block-embed slot for AdaptiveRenderer, plus the SHARED
 * `InlineRichRender` for tab-detail / blackboard / uiBlocks / uiParts
 * payloads carried on `message.metadata`. The home chat surface and the
 * floating widget BOTH use this bubble so they render identical rich
 * content (per-founder directive: floating must reach home parity).
 */
import type { ReactNode } from 'react';
import type { ChatMessage } from './types';
import { renderMarkdown } from './markdown';
import { DegradedBanner, type DegradedMarker } from '../components/DegradedBanner';
import {
  InlineRichRender,
  type InlineRichRenderVariant,
} from '../shared/InlineRichRender';
import type { Language } from '../chat-modes/types';

interface MessageBubbleProps {
  readonly message: ChatMessage;
  readonly personaName: string;
  /**
   * Optional caller-supplied block slot (legacy host-supplied embed).
   * Rendered IN ADDITION to the automatic InlineRichRender so a host
   * that already wires its own renderer continues to work.
   */
  readonly blockSlot?: ReactNode;
  /**
   * Variant controls how InlineRichRender packs its embeds. Floating
   * chat passes `compact` (380px panel); home chat passes `expanded`.
   * Defaults to `expanded` — safe for any wide surface.
   */
  readonly inlineVariant?: InlineRichRenderVariant;
  /**
   * Optional language override for the InlineRichRender. Falls back to
   * `message.language` when omitted.
   */
  readonly inlineLanguage?: Language;
  /**
   * Forwarded to the InlineRichRender so quick-reply / action-button
   * blocks can send messages back into the conversation.
   */
  readonly onSendMessage?: (msg: string) => void;
  /**
   * Forwarded to the InlineRichRender so embedded quiz blocks can
   * report answers back to the host.
   */
  readonly onQuizAnswer?: (
    blockId: string,
    optionId: string,
    correct: boolean,
  ) => void;
}

/**
 * Extract a well-formed degraded marker from an assistant turn's metadata.
 * Returns null when the role is not assistant, metadata is absent, or the
 * payload fails shape validation (missing reason / non-array capabilities /
 * non-string capability entries).
 */
function extractDegradedMarker(message: ChatMessage): DegradedMarker | null {
  if (message.role !== 'mwikila') return null;
  const meta = message.metadata;
  if (!meta || typeof meta !== 'object') return null;
  const raw = (meta as Record<string, unknown>).degraded;
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  const reason = candidate.reason;
  if (typeof reason !== 'string' || reason.length === 0) return null;
  const caps = candidate.affected_capabilities;
  if (!Array.isArray(caps)) return null;
  if (!caps.every((entry) => typeof entry === 'string')) return null;
  const since =
    typeof candidate.since === 'string' ? candidate.since : undefined;
  return {
    reason,
    affected_capabilities: caps as ReadonlyArray<string>,
    since,
  };
}

export function MessageBubble({
  message,
  personaName,
  blockSlot,
  inlineVariant = 'expanded',
  inlineLanguage,
  onSendMessage,
  onQuizAnswer,
}: MessageBubbleProps): JSX.Element {
  const isUser = message.role === 'user';
  const degraded = extractDegradedMarker(message);
  const resolvedLanguage: Language = inlineLanguage ?? message.language;
  return (
    <li
      data-testid="message-bubble"
      data-role={message.role}
      data-streaming={message.isStreaming ? 'true' : 'false'}
      aria-live={message.isStreaming ? 'polite' : undefined}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
        gap: 4,
        listStyle: 'none',
      }}
    >
      <span style={{ fontSize: 11, color: '#64748b' }}>{isUser ? 'You' : personaName}</span>
      {degraded ? <DegradedBanner degraded={degraded} compact /> : null}
      <div
        style={{
          maxWidth: '80%',
          background: isUser ? '#2563eb' : '#f1f5f9',
          color: isUser ? '#fff' : '#0f172a',
          padding: '8px 12px',
          borderRadius: 12,
          fontSize: 14,
          lineHeight: 1.45,
        }}
      >
        <div
          data-testid="message-bubble-body"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(message.text) }}
        />
        {message.attachments && message.attachments.length > 0 ? (
          <ul data-testid="message-bubble-attachments" style={{ margin: '6px 0 0', padding: 0, listStyle: 'none', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {message.attachments.map((att) => (
              <li key={att.id} style={{ fontSize: 11, background: '#ffffff22', padding: '2px 6px', borderRadius: 6 }}>
                {att.name}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {!isUser ? (
        <InlineRichRender
          metadata={message.metadata}
          language={resolvedLanguage}
          variant={inlineVariant}
          {...(onSendMessage ? { onSendMessage } : {})}
          {...(onQuizAnswer ? { onQuizAnswer } : {})}
        />
      ) : null}
      {blockSlot ? <div data-testid="message-bubble-blocks">{blockSlot}</div> : null}
    </li>
  );
}
