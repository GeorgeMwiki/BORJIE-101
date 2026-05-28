'use client';

import Link from 'next/link';

/**
 * "via Mr. Mwikila" / "via form" / "via agent" pill.
 *
 * Implements principle 5 of the Chat-as-OS Bidirectional Parity
 * Manifesto: every row in a list view surfaces the path that
 * produced it. Chat-created rows get a small gold pill; clicking the
 * pill opens the originating chat session at the turn that produced
 * the row.
 *
 * Reads `provenance.via` / `provenance.sessionId` / `provenance.turnId`
 * from the row. Falls back gracefully if any field is missing.
 *
 * Visual tones:
 *   - chat        → gold pill, "via Mr. Mwikila"
 *   - form        → muted pill, "via you"  (only shown when explicit)
 *   - agent_apply → blue pill, "via agent"
 *   - api         → muted pill, "via API"
 *   - legacy      → hidden (no pill rendered)
 *   - unknown     → hidden (no pill rendered)
 *
 * The component is a self-contained `next/link` that opens
 * `/dashboard/chat?session=<sessionId>&turn=<turnId>` when via=chat.
 */

export interface ProvenanceEnvelope {
  readonly via: 'chat' | 'form' | 'agent_apply' | 'api' | 'legacy' | 'unknown';
  readonly actorId?: string | null;
  readonly sessionId?: string | null;
  readonly turnId?: string | null;
  readonly requestedAt?: string;
}

interface ProvenancePillProps {
  readonly provenance: ProvenanceEnvelope | undefined | null;
  /** Hide the pill entirely when via is 'legacy' / 'unknown' (default true). */
  readonly hideForLegacy?: boolean;
  /** Override the destination URL builder (e.g. for buyer-mobile). */
  readonly buildSessionUrl?: (sessionId: string, turnId?: string | null) => string;
}

const TONE_CLASS: Record<ProvenanceEnvelope['via'], string> = {
  chat: 'border-warning/40 bg-warning-subtle/10 text-warning hover:bg-warning-subtle/20',
  form: 'border-border bg-card text-neutral-400',
  agent_apply: 'border-info/40 bg-info-subtle/10 text-info',
  api: 'border-border bg-card text-neutral-400',
  legacy: 'border-border bg-card text-neutral-500',
  unknown: 'border-destructive/40 bg-destructive-subtle/10 text-destructive',
};

const LABEL: Record<ProvenanceEnvelope['via'], string> = {
  chat: 'via Mr. Mwikila',
  form: 'via you',
  agent_apply: 'via agent',
  api: 'via API',
  legacy: 'legacy',
  unknown: 'unknown source',
};

function defaultUrl(sessionId: string, turnId?: string | null): string {
  const t = turnId ? `&turn=${encodeURIComponent(turnId)}` : '';
  return `/dashboard/chat?session=${encodeURIComponent(sessionId)}${t}`;
}

export function ProvenancePill({
  provenance,
  hideForLegacy = true,
  buildSessionUrl,
}: ProvenancePillProps) {
  if (!provenance) return null;
  const { via, sessionId, turnId } = provenance;
  if (hideForLegacy && (via === 'legacy' || via === 'unknown')) return null;

  const className = `inline-flex items-center gap-1 rounded-full border px-1.5 py-0 text-tiny ${TONE_CLASS[via]}`;
  const label = LABEL[via];

  if (via === 'chat' && sessionId) {
    const href = (buildSessionUrl ?? defaultUrl)(sessionId, turnId ?? null);
    return (
      <Link
        href={href}
        className={className}
        title="Open the chat turn that produced this record"
      >
        {label}
      </Link>
    );
  }

  return <span className={className}>{label}</span>;
}
