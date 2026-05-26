/**
 * `@borjie/user-followup` — public surface (Wave M2).
 *
 * Owner-facing daily nudge engine. Mr. Mwikila proactively follows
 * up on flagged items, regulator deadlines, relationship dormancy,
 * and anticipatory sweeps. Spec:
 *   Docs/DESIGN/DAILY_FOLLOWUP_AND_GUIDE_LEARN_SPEC.md
 *
 * This package is pure — no HTTP, SMTP, WhatsApp, or database
 * client code. The host wires concrete dispatchers and a SQL
 * adapter through the `Channel*` + `Repository` ports.
 */

// ---------------------------------------------------------------------------
// Types — the public domain surface
// ---------------------------------------------------------------------------
export {
  // Constants
  DEFAULT_MAX_PER_DAY,
  DEFAULT_CHANNEL,
  DEFAULT_QUIET_HOURS_START,
  DEFAULT_QUIET_HOURS_END,
  ANTICIPATORY_CONFIDENCE_THRESHOLD,
  // Enums
  FOLLOWUP_SOURCES,
  FOLLOWUP_CHANNELS,
  FOLLOWUP_STATUSES,
  type FollowupSource,
  type FollowupChannel,
  type FollowupStatus,
  type FollowupPriority,
  // Domain types
  type FollowupPayload,
  type FollowupCandidate,
  type FollowupPreferences,
  type ScoringInput,
  // Ports
  type FollowupCandidateRepository,
  type FollowupPreferencesRepository,
  type ChannelDispatcher,
  type DispatchResult,
  type AuditChainPort,
  // Errors
  UserFollowupError,
  // Zod
  followupSourceSchema,
  followupChannelSchema,
  followupStatusSchema,
  followupCandidateInsertSchema,
  followupPreferencesUpsertSchema,
} from './types.js';

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------
export {
  IMPACT_WEIGHT,
  URGENCY_WEIGHT,
  ATTENTION_WEIGHT,
  FATIGUE_PER_REPEAT,
  FATIGUE_CAP_REPEATS,
  NO_DEADLINE_URGENCY,
  URGENCY_WINDOW_DAYS,
  clamp01,
  computeUrgency,
  computeFatigue,
  scoreCandidate,
  isCriticalDeadline,
} from './scoring/priority-scorer.js';

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------
export {
  clockToMinutes,
  isInQuietHours,
  nowMinutesInTimezone,
  defaultPreferencesFor,
  resolveChannel,
  runSchedulerOnce,
  type SchedulerDeps,
  type SchedulerTickResult,
  type DispatchSummary,
  type SuppressionRecord,
} from './scheduler/followup-scheduler.js';

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------
export {
  createInAppDispatcher,
  type InAppDispatcherDeps,
} from './channels/inapp.js';
export {
  createEmailDispatcher,
  type EmailDispatcherDeps,
  type EmailSendPayload,
} from './channels/email.js';
export {
  createWhatsAppDispatcher,
  type WhatsAppDispatcherDeps,
  type WhatsAppSendPayload,
} from './channels/whatsapp.js';

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------
export { createInMemoryCandidateRepository } from './repositories/candidate.js';
export { createInMemoryPreferencesRepository } from './repositories/preferences.js';
export { createInMemoryAuditChain } from './repositories/audit.js';
