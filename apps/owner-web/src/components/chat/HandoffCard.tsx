'use client';

/**
 * HandoffCard — owner-web renderer for the K-A cross-role handoff.
 *
 * Renders one card per `<chat_handoff />` SSE tag the brain emits.
 * Three states:
 *
 *   pending   — recipient hasn't acted yet ("Sent to Manager John, 2m ago")
 *   replied   — recipient replied; the reply is rendered inline as a
 *               quote block beneath the topic ("John: I will follow up")
 *   closed    — recipient closed without a reply (greyed out)
 *
 * The component is a pure presenter — it does not poll. The parent chat
 * stream is responsible for pushing `onResolutionUpdate` when the
 * recipient acts. The full SOTA pattern (bubble-back reply card) lives
 * in the source chat: when the brain detects relevance on the recipient
 * reply path, it surfaces the same handoff id on the owner's stream so
 * this card re-renders in `replied` state.
 *
 * Bilingual sw/en per the Borjie hard rule.
 */

import type { ReactElement } from 'react';
import { useMemo } from 'react';

export interface HandoffCardData {
  readonly id: string;
  readonly targetUserId: string;
  readonly targetRole: string;
  readonly targetDisplayName?: string;
  readonly topic: string;
  readonly scopePayload?: {
    readonly siteIds?: ReadonlyArray<string>;
    readonly category?: string;
    readonly [key: string]: unknown;
  };
  readonly resolution: 'pending' | 'replied' | 'closed' | 'declined';
  readonly replyText?: string | null;
  readonly createdAt: string;
}

export interface HandoffCardProps {
  readonly handoff: HandoffCardData;
  readonly language?: 'en' | 'sw';
}

const COPY = {
  en: {
    sentTo: 'Sent to',
    pending: 'Awaiting reply',
    closed: 'Closed without reply',
    declined: 'Declined',
    re: 'Re:',
    site: 'Site:',
    category: 'Topic:',
  },
  sw: {
    sentTo: 'Imetumwa kwa',
    pending: 'Inasubiri jibu',
    closed: 'Imefungwa bila jibu',
    declined: 'Imekataliwa',
    re: 'Kuhusu:',
    site: 'Eneo:',
    category: 'Mada:',
  },
} as const;

const ROLE_LABEL: Record<string, { en: string; sw: string }> = {
  T1_owner_strategist: { en: 'Owner', sw: 'Mmiliki' },
  T2_admin_strategist: { en: 'Admin', sw: 'Msimamizi' },
  T3_module_manager: { en: 'Manager', sw: 'Meneja' },
  T4_field_employee: { en: 'Worker', sw: 'Mfanyakazi' },
  T5_customer_concierge: { en: 'Concierge', sw: 'Mhudumu' },
  T_auditor: { en: 'Auditor', sw: 'Mkaguzi' },
  T_vendor: { en: 'Vendor', sw: 'Muuzaji' },
};

function relativeTime(iso: string, lang: 'en' | 'sw'): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return lang === 'sw' ? `${diffSec}s zilizopita` : `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return lang === 'sw' ? `${diffMin}m zilizopita` : `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return lang === 'sw' ? `${diffHr}h zilizopita` : `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return lang === 'sw' ? `${diffDay}d zilizopita` : `${diffDay}d ago`;
}

export function HandoffCard({ handoff, language = 'en' }: HandoffCardProps): ReactElement {
  const lang: 'en' | 'sw' = language === 'sw' ? 'sw' : 'en';
  const copy = COPY[lang];
  const roleLabel = ROLE_LABEL[handoff.targetRole]?.[lang] ?? handoff.targetRole;
  const targetName = handoff.targetDisplayName ?? handoff.targetUserId;
  const when = useMemo(() => relativeTime(handoff.createdAt, lang), [handoff.createdAt, lang]);

  const statusLabel =
    handoff.resolution === 'replied'
      ? null
      : handoff.resolution === 'closed'
        ? copy.closed
        : handoff.resolution === 'declined'
          ? copy.declined
          : copy.pending;

  const isReplied = handoff.resolution === 'replied' && handoff.replyText;

  return (
    <div
      role="article"
      aria-label={`handoff to ${targetName}`}
      className={`borjie-handoff-card borjie-handoff-${handoff.resolution}`}
      style={{
        border: '1px solid var(--borjie-border, #2a2a32)',
        borderRadius: 12,
        padding: 12,
        marginTop: 8,
        background: 'var(--borjie-surface, #16161c)',
        fontSize: 13,
        color: 'var(--borjie-text, #e7e7ea)',
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontWeight: 600 }}>
          {copy.sentTo} {roleLabel} {targetName}
        </span>
        <span style={{ opacity: 0.7, fontSize: 11 }}>{when}</span>
      </header>

      <div style={{ marginBottom: 8 }}>
        <strong>{copy.re}</strong> {handoff.topic}
      </div>

      {handoff.scopePayload?.siteIds && handoff.scopePayload.siteIds.length > 0 ? (
        <div style={{ fontSize: 11, opacity: 0.7 }}>
          {copy.site} {handoff.scopePayload.siteIds.join(', ')}
        </div>
      ) : null}
      {handoff.scopePayload?.category ? (
        <div style={{ fontSize: 11, opacity: 0.7 }}>
          {copy.category} {handoff.scopePayload.category}
        </div>
      ) : null}

      {isReplied ? (
        <blockquote
          style={{
            borderLeft: '3px solid var(--borjie-accent, #d4af37)',
            marginTop: 8,
            paddingLeft: 8,
            color: 'var(--borjie-text-strong, #fafafa)',
            fontStyle: 'italic',
          }}
        >
          {targetName}: {handoff.replyText}
        </blockquote>
      ) : statusLabel ? (
        <div
          style={{
            marginTop: 8,
            fontSize: 11,
            opacity: 0.6,
            fontStyle: 'italic',
          }}
        >
          {statusLabel}
        </div>
      ) : null}
    </div>
  );
}
