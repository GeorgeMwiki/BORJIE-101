/**
 * R-FUTURE-4 — entity-specific event composers for the 4 polish
 * drawers (reminders / drafts / parcels / bids).
 *
 * Each composer is a PURE function that takes a raw entity envelope
 * + its history rows and returns the chronologically-ordered
 * `TimelineEvent[]` the generic `<EntityTimeline />` consumes.
 *
 * Composers are pure for two reasons:
 *   1. They run on the server (RSC) and in vitest — both want zero
 *      DOM / fetch side effects.
 *   2. They make the timeline deterministic — the same input always
 *      produces the same row order, which is critical for the
 *      "chat-as-OS bidirectional parity" invariant.
 */

import type { TimelineEvent } from '../shared/EntityTimeline';
import type { ProvenanceEnvelope } from '../shared/ProvenancePill';

// ──────────────────────────────────────────────────────────────────
// Shared shapes — every entity carries provenance + revision history
// in the same place. The 4 composers only differ in WHICH summary
// strings they emit per kind.
// ──────────────────────────────────────────────────────────────────

export interface EntityRevision {
  readonly id: string;
  readonly at: string;
  readonly actor: string;
  readonly summary: string;
  readonly provenance: ProvenanceEnvelope;
  readonly href?: string;
}

export interface EntityChatTurn {
  readonly id: string;
  readonly at: string;
  readonly actor: string;
  readonly summary: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly href?: string;
}

export interface EntityHistory {
  readonly createdAt: string;
  readonly createdBy: string;
  readonly createdSummary: string;
  readonly createdProvenance: ProvenanceEnvelope;
  readonly revisions: ReadonlyArray<EntityRevision>;
  readonly chatTurns: ReadonlyArray<EntityChatTurn>;
}

// ──────────────────────────────────────────────────────────────────
// Pure orderer (exported for unit tests)
// ──────────────────────────────────────────────────────────────────

/**
 * Merge the 'created' event + revisions + chat turns into a single
 * chronologically-ordered TimelineEvent[]. Ties broken by source
 * (created > revised > chat_turn) so the entity creation always lands
 * first when timestamps collide.
 */
export function mergeEvents(history: EntityHistory): TimelineEvent[] {
  const events: TimelineEvent[] = [
    {
      id: `created-${history.createdAt}`,
      kind: 'created',
      summary: history.createdSummary,
      at: history.createdAt,
      actor: history.createdBy,
      provenance: history.createdProvenance,
    },
    ...history.revisions.map((r): TimelineEvent => ({
      id: r.id,
      kind: 'revised',
      summary: r.summary,
      at: r.at,
      actor: r.actor,
      provenance: r.provenance,
      ...(r.href ? { href: r.href } : {}),
    })),
    ...history.chatTurns.map((t): TimelineEvent => ({
      id: t.id,
      kind: 'chat_turn',
      summary: t.summary,
      at: t.at,
      actor: t.actor,
      provenance: {
        via: 'chat',
        sessionId: t.sessionId,
        turnId: t.turnId,
      },
      ...(t.href ? { href: t.href } : {}),
    })),
  ];
  return [...events].sort((a, b) => a.at.localeCompare(b.at));
}

// ──────────────────────────────────────────────────────────────────
// Entity-specific composers
// ──────────────────────────────────────────────────────────────────
// Each takes a domain envelope + raw history and emits the
// bilingual-aware TimelineEvent[]. The composer is the ONLY thing
// each drawer needs — the rendering is delegated to the shared
// `<EntityTimeline />`.

export type Locale = 'sw' | 'en';

/** Localised label table — keeps copy out of the composer bodies. */
interface ComposerCopy {
  readonly created: { sw: string; en: string };
  readonly stateChange: (state: string) => { sw: string; en: string };
}

const REMINDER_COPY: ComposerCopy = {
  created: {
    sw: 'Kumbukumbu imeundwa',
    en: 'Reminder created',
  },
  stateChange: (state) => ({
    sw: `Hali imebadilika kuwa: ${state}`,
    en: `State changed to: ${state}`,
  }),
};

const DRAFT_COPY: ComposerCopy = {
  created: {
    sw: 'Rasimu imeandaliwa',
    en: 'Draft prepared',
  },
  stateChange: (state) => ({
    sw: `Hali ya rasimu: ${state}`,
    en: `Draft status: ${state}`,
  }),
};

const PARCEL_COPY: ComposerCopy = {
  created: {
    sw: 'Parcel imerekodi',
    en: 'Parcel logged',
  },
  stateChange: (state) => ({
    sw: `Hali ya parcel: ${state}`,
    en: `Parcel state: ${state}`,
  }),
};

const BID_COPY: ComposerCopy = {
  created: {
    sw: 'Zabuni imewekwa',
    en: 'Bid placed',
  },
  stateChange: (state) => ({
    sw: `Hali ya zabuni: ${state}`,
    en: `Bid state: ${state}`,
  }),
};

export interface DomainEntity {
  readonly state?: string;
  readonly stateChangedAt?: string;
  readonly stateChangedBy?: string;
  readonly stateChangedProvenance?: ProvenanceEnvelope;
}

export interface ComposerInput<T extends DomainEntity> {
  readonly entity: T;
  readonly history: EntityHistory;
  readonly locale: Locale;
}

/** Generic worker — picks the right summary strings from the copy table. */
function compose<T extends DomainEntity>(
  copy: ComposerCopy,
  { entity, history, locale }: ComposerInput<T>,
): TimelineEvent[] {
  // We use the created copy for the canonical row, then layer revisions
  // + chat turns on top via mergeEvents.
  const merged = mergeEvents({
    ...history,
    createdSummary: copy.created[locale],
  });

  if (entity.state && entity.stateChangedAt) {
    const stateCopy = copy.stateChange(entity.state)[locale];
    merged.push({
      id: `state-${entity.stateChangedAt}`,
      kind: 'state_changed',
      summary: stateCopy,
      at: entity.stateChangedAt,
      actor: entity.stateChangedBy ?? 'system',
      provenance: entity.stateChangedProvenance ?? { via: 'api' as const },
    });
  }
  return [...merged].sort((a, b) => a.at.localeCompare(b.at));
}

export interface ReminderEntity extends DomainEntity {
  readonly reminderText?: string;
}

export interface DraftEntity extends DomainEntity {
  readonly title?: string;
}

export interface ParcelEntity extends DomainEntity {
  readonly mineral?: string;
  readonly weightKg?: number;
}

export interface BidEntity extends DomainEntity {
  readonly amountTzs?: number;
  readonly listingId?: string;
}

export function composeReminderTimeline(
  input: ComposerInput<ReminderEntity>,
): TimelineEvent[] {
  return compose(REMINDER_COPY, input);
}

export function composeDraftTimeline(
  input: ComposerInput<DraftEntity>,
): TimelineEvent[] {
  return compose(DRAFT_COPY, input);
}

export function composeParcelTimeline(
  input: ComposerInput<ParcelEntity>,
): TimelineEvent[] {
  return compose(PARCEL_COPY, input);
}

export function composeBidTimeline(
  input: ComposerInput<BidEntity>,
): TimelineEvent[] {
  return compose(BID_COPY, input);
}
