/**
 * Belief store — pure helpers + an in-memory adapter.
 *
 * The PURE helpers (`makeSubjectKey`, `computeConfidence`) carry the
 * source-of-truth for canonical keys + confidence aggregation. The
 * in-memory adapter implements `BeliefStorePort` for tests + local dev;
 * production wires a Drizzle/Supabase adapter at the composition root that
 * targets the `brain_beliefs` / `belief_revisions` / `belief_review_queue`
 * tables (migration 0274).
 *
 * No leaf module here touches a DB — the port is injected.
 */

import type {
  Belief,
  BeliefDomain,
  BeliefScope,
  BeliefSource,
  BeliefStorePort,
  RevisionRecord,
  ReviewQueueItem,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Subject-key canonicalisation
// ─────────────────────────────────────────────────────────────────────

/**
 * Canonicalise the parts of a subject key into a stable lowercase-dashed
 * identifier. Strips diacritics, collapses whitespace, drops punctuation
 * other than letters / digits / dashes.
 *
 * Example:
 *   makeSubjectKey(['Mwanza', 'Gold', 'Ore', 'Grade'])
 *     → 'mwanza-gold-ore-grade'
 */
export function makeSubjectKey(parts: ReadonlyArray<string>): string {
  return parts
    .map((part) =>
      part
        .normalize('NFD')
        .replace(/\p{M}/gu, '') // strip combining marks (diacritics)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''),
    )
    .filter((part) => part.length > 0)
    .join('-');
}

// ─────────────────────────────────────────────────────────────────────
// Confidence aggregation
// ─────────────────────────────────────────────────────────────────────

const SOURCE_KIND_WEIGHT: Record<BeliefSource['kind'], number> = {
  'regulator-doc': 1.0,
  'internal-data': 0.85,
  'manager-input': 0.75,
  'admin-input': 0.75,
  'web-research': 0.6,
  'user-claim': 0.45,
  'prior-belief': 0.4,
};

/**
 * Confidence is a weighted average of source.authority × kind-weight,
 * capped at 0.99 so the brain never claims certainty. PURE.
 */
export function computeConfidence(
  sources: ReadonlyArray<BeliefSource>,
): number {
  if (sources.length === 0) return 0.1;
  let weighted = 0;
  let denom = 0;
  for (const src of sources) {
    const kw = SOURCE_KIND_WEIGHT[src.kind] ?? 0.4;
    weighted += clamp01(src.authority) * kw;
    denom += kw;
  }
  if (denom === 0) return 0.1;
  return Math.min(0.99, weighted / denom);
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// ─────────────────────────────────────────────────────────────────────
// In-memory store adapter (tests + local dev)
// ─────────────────────────────────────────────────────────────────────

function scopeKey(
  subject: string,
  userId: string | null,
  orgId: string | null,
): string {
  return `${subject}|${userId ?? ''}|${orgId ?? ''}`;
}

export interface InMemoryBeliefStore extends BeliefStorePort {
  /** Test introspection — append-only revision log. */
  readonly revisions: ReadonlyArray<RevisionRecord>;
  /** Test introspection — queued split-band items. */
  readonly reviewQueue: ReadonlyArray<ReviewQueueItem>;
  /** Test introspection — current live beliefs. */
  snapshot(): ReadonlyArray<Belief>;
}

/**
 * Build an in-memory `BeliefStorePort`. `idFactory` mints belief ids on
 * insert (default: incrementing counter). Deterministic + dependency-free.
 */
export function createInMemoryBeliefStore(
  seed: ReadonlyArray<Belief> = [],
  idFactory?: () => string,
): InMemoryBeliefStore {
  const beliefs = new Map<string, Belief>();
  const revisions: RevisionRecord[] = [];
  const reviewQueue: ReviewQueueItem[] = [];
  let counter = 0;
  const nextId =
    idFactory ??
    (() => {
      counter += 1;
      return `belief-${counter}`;
    });

  for (const b of seed) {
    beliefs.set(
      scopeKey(b.subject, b.subjectUserId ?? null, b.subjectOrgId ?? null),
      b,
    );
  }

  return {
    get revisions() {
      return revisions;
    },
    get reviewQueue() {
      return reviewQueue;
    },
    snapshot() {
      return Array.from(beliefs.values());
    },

    async findBySubject(
      subject: string,
      scope?: BeliefScope,
    ): Promise<Belief | null> {
      const key = scopeKey(
        subject,
        scope?.subjectUserId ?? null,
        scope?.subjectOrgId ?? null,
      );
      return beliefs.get(key) ?? null;
    },

    async listByDomain(
      domain: BeliefDomain,
      limit = 100,
      scope?: BeliefScope,
    ): Promise<ReadonlyArray<Belief>> {
      const wantUser = scope?.subjectUserId ?? null;
      const wantOrg = scope?.subjectOrgId ?? null;
      return Array.from(beliefs.values())
        .filter(
          (b) =>
            b.domain === domain &&
            (b.subjectUserId ?? null) === wantUser &&
            (b.subjectOrgId ?? null) === wantOrg,
        )
        .sort((a, b) => Date.parse(b.revisedAt) - Date.parse(a.revisedAt))
        .slice(0, limit);
    },

    async upsert(belief: Belief): Promise<Belief> {
      const id = belief.id || nextId();
      const persisted: Belief = { ...belief, id };
      beliefs.set(
        scopeKey(
          persisted.subject,
          persisted.subjectUserId ?? null,
          persisted.subjectOrgId ?? null,
        ),
        persisted,
      );
      return persisted;
    },

    async recordRevision(record: RevisionRecord): Promise<void> {
      revisions.push(record);
    },

    async enqueueReview(item: ReviewQueueItem): Promise<void> {
      reviewQueue.push(item);
    },
  };
}
