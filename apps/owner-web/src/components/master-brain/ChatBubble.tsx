'use client';

import type { ChatMessage } from '@/lib/types/chat';
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
  // KI-005 — the evidence-chain Auditor verdict (surfaced by the /chat stream)
  // rides on message.grounding; show a caution badge when the answer is
  // ungrounded / unverified / the gate flagged it. Approved + grounded answers
  // get no badge (no clutter).
  const g = isOwner ? undefined : message.grounding;
  const groundingWarn = g?.groundingFault
    ? 'Grounding check unavailable. Treat with caution.'
    : g?.evidenceWarning === 'no_evidence_cited'
      ? 'Unverified: no evidence cited.'
      : g?.evidenceWarning === 'evidence_invalid'
        ? 'Evidence could not be verified.'
        : g?.verdict === 'needs_human'
          ? 'Auditor flagged this answer for review.'
          : null;
  return (
    <div className={`flex flex-col gap-1 ${isOwner ? '' : 'items-end'}`}>
      <div className="text-badge text-neutral-500">
        {isOwner ? 'Owner' : 'Master Brain'} · {fmtTime(message.createdAt)}
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
          <div className="mt-2 text-tiny text-neutral-500">
            Junior calls:{' '}
            {message.breadcrumbs
              .map((bc) => `${bc.agent}·${bc.action} (${bc.latencyMs}ms)`)
              .join(' → ')}
          </div>
        ) : null}
        {groundingWarn ? (
          <div className="mt-2 inline-flex items-center gap-1 rounded border border-warning/60 bg-warning-subtle/40 px-1.5 py-0.5 text-tiny font-medium text-warning">
            <span aria-hidden>⚠</span> {groundingWarn}
          </div>
        ) : null}
      </div>
    </div>
  );
}
