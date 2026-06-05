/**
 * `@borjie/belief-engine` — shared types.
 *
 * Backs the always-learning, convince-yourself loop. Every chat turn /
 * decision can fire the learning hook; the hook extracts factual claims and
 * either investigates (no prior belief) or runs the convince-loop (a prior
 * belief exists). The brain revises a belief ONLY when the confidence delta
 * clears the 0.25 gate.
 *
 * Re-skinned from LITFIN litfin-ai/learning to the Borjie mining-estate
 * domain. NO lending / PD / credit shapes — beliefs are about mining facts
 * (royalty caps, ore-grade economics, regional logistics, regulatory rules).
 *
 * Tenant mapping per the port conventions: org → tenant, borrower → owner /
 * worker. `subjectUserId` is an owner/worker id; `subjectOrgId` an
 * org-process id. Both null ⇒ platform-wide / domain-scoped fact.
 *
 * Tables backing these types (migration 0274):
 *   - brain_beliefs            (one row per subject+scope)
 *   - belief_revisions         (immutable revision history)
 *   - belief_review_queue      (the 0.05–0.25 split band)
 *   - correlation_findings     (nightly belief×outcome pass)
 */

export type BeliefDomain =
  | 'regulatory' // royalty rate, licence cap, TRA WHT rate, mining-act rules
  | 'sector-economics' // ore-grade margins, recovery rates, seasonality
  | 'regional-economics' // logistics, demand patterns per region
  | 'market-prices' // commodity prices (gold, tanzanite, …), FX rates
  | 'estate-pattern' // empirical patterns across estates / owners
  | 'process' // operational facts about Borjie itself
  | 'general';

export const ALL_BELIEF_DOMAINS: ReadonlyArray<BeliefDomain> = [
  'regulatory',
  'sector-economics',
  'regional-economics',
  'market-prices',
  'estate-pattern',
  'process',
  'general',
];

export interface BeliefValue {
  readonly kind: 'scalar' | 'range' | 'categorical' | 'boolean' | 'text';
  readonly scalar?: number;
  readonly rangeMin?: number;
  readonly rangeMax?: number;
  readonly unit?: string;
  readonly categorical?: string;
  readonly boolean?: boolean;
  readonly text?: string;
}

export type BeliefSourceKind =
  | 'user-claim'
  | 'web-research'
  | 'internal-data'
  | 'regulator-doc'
  | 'prior-belief'
  | 'manager-input'
  | 'admin-input';

export interface BeliefSource {
  readonly kind: BeliefSourceKind;
  /** 0..1 authority weight. */
  readonly authority: number;
  readonly url?: string;
  readonly excerpt?: string;
  readonly capturedAt: string;
  /** owner/worker id, org id, or doc id (anonymised when public). */
  readonly authorRef?: string;
}

export interface Belief {
  readonly id: string;
  readonly domain: BeliefDomain;
  /** canonical key, e.g. 'mwanza-gold-ore-grade'. */
  readonly subject: string;
  readonly description: string;
  readonly value: BeliefValue;
  /** 0..1 */
  readonly confidence: number;
  readonly sources: ReadonlyArray<BeliefSource>;
  readonly revisedAt: string;
  readonly revisionCount: number;
  readonly tags: ReadonlyArray<string>;
  /**
   * Nullable tenant scope.
   *   subjectUserId set → owner/worker-scoped (only readable by that user)
   *   subjectOrgId set  → org-process-scoped (only readable by org members)
   *   both null         → platform-wide / domain-scoped (readable by all)
   */
  readonly subjectUserId?: string | null;
  readonly subjectOrgId?: string | null;
}

/** Borjie product surfaces, re-skinned from LITFIN portals. */
export type ChatPortal = 'worker' | 'manager' | 'admin' | 'owner';

export interface ExtractedClaim {
  readonly subject: string;
  readonly description: string;
  readonly proposedValue: BeliefValue;
  /** exact phrase from the source turn. */
  readonly evidenceFromTurn: string;
  /** initial confidence from the extractor (0..1). */
  readonly confidence: number;
  readonly conversationId: string;
  readonly turnId: string;
  readonly portal: ChatPortal;
  readonly domain: BeliefDomain;
  readonly subjectUserId?: string | null;
  readonly subjectOrgId?: string | null;
  /**
   * Quarantine flag set by the prompt-injection defence layer when the
   * source span looked suspicious. When true the convince-loop raises the
   * required revise floor from 0.25 to 0.4 before the belief becomes writable.
   */
  readonly quarantined?: boolean;
}

export type ConvinceAction =
  | 'no-change'
  | 'strengthen'
  | 'revise'
  | 'split';

export interface ConvinceResult {
  readonly action: ConvinceAction;
  readonly priorBelief: Belief | null;
  readonly newBelief: Belief;
  readonly confidenceDelta: number;
  readonly rationale: string;
  readonly newSourcesAdded: number;
  readonly contradictionDetected: boolean;
  /** Set when action === 'split' — the queued review item id (if persisted). */
  readonly reviewQueued?: boolean;
}

export interface CorrelationFinding {
  readonly id: string;
  readonly sector: string | null;
  readonly region: string | null;
  readonly beliefSubject: string;
  readonly outcomeMetric: string;
  readonly r: number;
  readonly p: number;
  readonly n: number;
  readonly summary: string;
  readonly generatedAt: string;
}

export interface WebSearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  readonly authority: number;
}

export type RevisionTrigger =
  | 'chat-hook'
  | 'admin-force'
  | 'cron-pass'
  | 'self-revision'
  | 'signal-emitter';

// ─────────────────────────────────────────────────────────────────────
// Ports — pluggable persistence injected at composition root.
// The belief-engine NEVER reaches into a DB directly; the caller supplies
// a store adapter. This keeps every leaf module pure + testable.
// ─────────────────────────────────────────────────────────────────────

/** Optional tenant scope passed alongside a subject lookup / list. */
export interface BeliefScope {
  readonly subjectUserId?: string | null;
  readonly subjectOrgId?: string | null;
}

export interface RevisionRecord {
  readonly beliefId: string;
  readonly before: Belief;
  readonly after: Belief;
  readonly rationale: string;
  readonly newSources: ReadonlyArray<BeliefSource>;
  readonly triggeredBy?: RevisionTrigger;
}

export interface ReviewQueueItem {
  readonly beliefId: string;
  readonly subject: string;
  readonly proposedValue: BeliefValue;
  readonly confidenceDelta: number;
  readonly rationale: string;
  readonly subjectUserId?: string | null;
  readonly subjectOrgId?: string | null;
}

/**
 * Belief store port — the ONLY surface that touches persistence. The
 * convince-loop is the sole caller of `upsert`; app code must never call
 * `upsert` directly to write a belief (CLAUDE.md hard rule: beliefs are
 * never written directly).
 */
export interface BeliefStorePort {
  findBySubject(
    subject: string,
    scope?: BeliefScope,
  ): Promise<Belief | null>;
  listByDomain(
    domain: BeliefDomain,
    limit?: number,
    scope?: BeliefScope,
  ): Promise<ReadonlyArray<Belief>>;
  /** Insert-or-replace by the (subject, user, org) natural key. */
  upsert(belief: Belief): Promise<Belief>;
  /** Append an immutable revision-history row. */
  recordRevision(record: RevisionRecord): Promise<void>;
  /** Enqueue a contradiction in the 0.05–0.25 split band for review. */
  enqueueReview(item: ReviewQueueItem): Promise<void>;
}
