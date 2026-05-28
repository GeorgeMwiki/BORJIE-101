/**
 * Advisor memory — typed shapes shared by the read + write services.
 *
 * Cross-session persistent memory backed by migration 0108
 * (`advisor_preferences`, `advisor_observed_patterns`). The brain reads
 * a `MemorySnapshot` at the start of every turn and writes a single
 * `AdvisorObservation` at the end of every turn.
 *
 * No mutation, no defaults synthesized at read time outside `getMemory`.
 * Every callsite operates on a frozen value.
 */

export type CommunicationStyle = 'concise' | 'detailed' | 'technical';

export type BriefCadence = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'off';

export type Language = 'sw' | 'en';

export type PatternKind =
  | 'routine'
  | 'aversion'
  | 'peak_time'
  | 'recurring_question';

/**
 * Stored preferences. `lastTaughtAt` / `friction*` are nullable when
 * the record has never been written.
 */
export interface AdvisorPreferences {
  readonly tenantId: string;
  readonly language: Language;
  readonly timeZone: string;
  readonly defaultBriefCadence: BriefCadence;
  readonly communicationStyle: CommunicationStyle;
  readonly preferredChannels: ReadonlyArray<string>;
  readonly doNotDisturb: ReadonlyArray<Record<string, unknown>>;
  readonly lastTaughtAt: string | null;
  readonly masteryLevels: Readonly<Record<string, string>>;
  readonly frictionSignals: Readonly<Record<string, number>>;
  readonly updatedAt: string;
}

export interface ObservedPattern {
  readonly id: string;
  readonly tenantId: string;
  readonly patternKind: PatternKind;
  readonly patternPayload: Readonly<Record<string, unknown>>;
  readonly confidence: number;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly occurrences: number;
}

/**
 * Snapshot returned to the brain prompt. Always returns a populated
 * preferences object (defaults synthesized when the row is missing)
 * and a bounded list of the most salient observed patterns per kind.
 */
export interface MemorySnapshot {
  readonly preferences: AdvisorPreferences;
  readonly patterns: ReadonlyArray<ObservedPattern>;
}

/**
 * Observation the brain records at the end of every turn. Each
 * observation is normalized by the recorder into one or more
 * `advisor_observed_patterns` upserts plus optional preference
 * adjustments.
 *
 * `engagement`:
 *   continue — owner kept the thread alive after the response
 *   accept   — owner accepted a recommendation / clicked through
 *   bounce   — owner left the thread within ~10s of the response
 */
export interface AdvisorObservation {
  readonly tenantId: string;
  readonly userId: string;
  /** Length of the assistant response, in chars. */
  readonly responseLengthChars: number;
  /** Hour-of-day the turn happened in the owner's local time (0-23). */
  readonly localHour: number;
  /** Classified question kind. Free-form string from the brain. */
  readonly questionKind: string;
  /** Raw owner question (normalized + truncated). Used as the canonical
   *  signature for `recurring_question` patterns. */
  readonly normalizedQuestion: string;
  readonly engagement: 'continue' | 'accept' | 'bounce';
  /** Optional: a recommendation the owner explicitly rejected. */
  readonly rejectedRecommendationKind?: string;
  /** Optional: a recurring action the brain detected the owner took
   *  (e.g. `royalty_file`). */
  readonly detectedRoutineAction?: string;
  /** Optional: day-of-month context for the routine, captured when the
   *  owner performs the action. */
  readonly routineDayOfMonth?: number;
}

/**
 * Default preferences synthesized when no row exists yet for the tenant.
 * Swahili-first per CLAUDE.md hard rule.
 */
export const DEFAULT_PREFERENCES: Omit<AdvisorPreferences, 'tenantId' | 'updatedAt'> = {
  language: 'sw',
  timeZone: 'Africa/Dar_es_Salaam',
  defaultBriefCadence: 'daily',
  communicationStyle: 'concise',
  preferredChannels: ['email'],
  doNotDisturb: [],
  lastTaughtAt: null,
  masteryLevels: {},
  frictionSignals: {},
};
