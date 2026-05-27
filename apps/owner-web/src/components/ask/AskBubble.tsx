'use client';

import { fmtTime } from '@/lib/format';
import type { AskBorjieMessage } from '@/lib/queries/brain';
import type { BrainCitation } from '@/lib/brain-api';
import { CitationChip } from './CitationChip';

interface AskBubbleProps {
  readonly message: AskBorjieMessage;
  readonly onCitationClick?: (citation: BrainCitation) => void;
}

/**
 * Single transcript bubble for ask-Borjie. Owner messages align right,
 * assistant messages align left with the warning-accent border so
 * role separation is immediate. While `streaming` is true a blinking
 * cursor sits at the tail of the text.
 *
 * The bubble also surfaces:
 *   - tool-call breadcrumbs (e.g. "Geology · ok 240ms") as small chips
 *     above the text, when the brain returned them
 *   - citation chips from the corpus-evidence array as clickable pills
 *     under the text
 */
export function AskBubble({ message, onCitationClick }: AskBubbleProps) {
  const isOwner = message.role === 'user';
  return (
    <div
      data-testid={`ask-bubble-${message.role}`}
      data-streaming={message.streaming || undefined}
      className={`flex flex-col gap-1 ${isOwner ? '' : 'items-end'}`}
    >
      <div className="text-badge text-neutral-500">
        {isOwner ? 'Owner' : 'Borjie Brain'} · {fmtTime(message.createdAt)}
      </div>
      {!isOwner && message.toolCalls.length > 0 ? (
        <ul
          data-testid="ask-toolcall-chips"
          className="m-0 flex max-w-2xl list-none flex-wrap gap-1 p-0"
          aria-label="Junior calls"
        >
          {message.toolCalls.map((call, i) => (
            <li
              key={`${call.name}_${i}`}
              className="rounded-full bg-info/10 px-2 py-0.5 text-tiny font-medium tracking-wide text-info"
            >
              {call.name}
              {call.status ? ` · ${call.status}` : ''}
              {typeof call.latencyMs === 'number'
                ? ` (${call.latencyMs}ms)`
                : ''}
            </li>
          ))}
        </ul>
      ) : null}
      <div
        className={`max-w-2xl rounded-lg px-3 py-2 text-sm leading-relaxed ${
          isOwner
            ? 'bg-surface text-foreground'
            : `border ${message.errored ? 'border-destructive/40 bg-destructive/10' : 'border-warning/40 bg-warning-subtle/20'} text-foreground`
        }`}
      >
        <p className="whitespace-pre-wrap">
          {message.text}
          {message.streaming ? (
            <span
              aria-hidden="true"
              data-testid="ask-stream-cursor"
              className="ml-1 inline-block h-3 w-1.5 animate-pulse bg-warning align-text-bottom"
            />
          ) : null}
        </p>
        {!isOwner && message.citations.length > 0 ? (
          <div
            className="mt-2 flex flex-wrap gap-1.5"
            data-testid="ask-citations"
          >
            {message.citations.map((citation) => (
              <CitationChip
                key={citation.id}
                citation={citation}
                {...(onCitationClick ? { onClick: onCitationClick } : {})}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
