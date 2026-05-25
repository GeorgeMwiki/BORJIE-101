'use client';

import type { ChatMessage } from '@/lib/mocks/chat';
import { fmtTime } from '@/lib/format';
import { EvidenceChip } from './EvidenceChip';

interface ChatBubbleProps {
  readonly message: ChatMessage;
  readonly onSelectEvidence: (id: string) => void;
}

/**
 * One transcript bubble. Owner bubbles align right with a neutral
 * surface; brain bubbles align left with the amber-warning accent so
 * the role separation is immediate. Evidence IDs render as clickable
 * pills inline that open the right-hand side panel.
 */
export function ChatBubble({ message, onSelectEvidence }: ChatBubbleProps) {
  const isOwner = message.role === 'owner';
  return (
    <div className={`flex flex-col gap-1 ${isOwner ? '' : 'items-end'}`}>
      <div className="text-[11px] text-neutral-500">
        {isOwner ? 'Owner' : `Master Brain · ${message.mode}`} · {fmtTime(message.createdAt)}
      </div>
      <div
        className={`max-w-2xl rounded-lg px-3 py-2 text-sm leading-relaxed ${
          isOwner
            ? 'bg-surface text-foreground'
            : 'border border-warning/40 bg-warning-subtle/20 text-foreground'
        }`}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
        {message.evidenceIds.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {message.evidenceIds.map((id) => (
              <EvidenceChip key={id} id={id} onClick={onSelectEvidence} />
            ))}
          </div>
        ) : null}
        {message.breadcrumbs.length > 0 ? (
          <div className="mt-2 text-[10px] text-neutral-500">
            Junior calls:{' '}
            {message.breadcrumbs
              .map((bc) => `${bc.agent}·${bc.action} (${bc.latencyMs}ms)`)
              .join(' → ')}
          </div>
        ) : null}
      </div>
    </div>
  );
}
