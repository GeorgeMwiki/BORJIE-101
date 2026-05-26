/**
 * Daily Follow-up engine — public type surface (Wave M2).
 *
 * Companion to Docs/DESIGN/DAILY_FOLLOWUP_AND_GUIDE_LEARN_SPEC.md.
 * Every record here is immutable. State transitions
 * (`pending → sent | dismissed | expired`) produce new projections
 * via dedicated handlers — never an in-place mutation. This mirrors
 * the immutability discipline used across the Borjie codebase.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Tunable constants
// ---------------------------------------------------------------------------

/** Default daily cap when a user has no `followup_preferences` row. */
export const DEFAULT_MAX_PER_DAY = 5;

/** Default in-app channel when nothing else is specified. */
export const DEFAULT_CHANNEL: FollowupChannel = 'inapp';

/** Default quiet-hours bracket (22:00 → 07:00 local). */
export const DEFAULT_QUIET_HOURS_START = '22:00:00';
export const DEFAULT_QUIET_HOURS_END = '07:00:00';

/** Confidence threshold below which anticipatory candidates are dropped. */
export const ANTICIPATORY_CONFIDENCE_THRESHOLD = 0.6;

// ---------------------------------------------------------------------------
// Sources, channels, statuses
// ---------------------------------------------------------------------------

export const FOLLOWUP_SOURCES = [
  'work_cycle',
  'anticipatory',
  'regulator',
  'user_flag',
  'relationship_dormancy',
  'incident_postmortem',
] as const;

export type FollowupSource = (typeof FOLLOWUP_SOURCES)[number];

export const FOLLOWUP_CHANNELS = ['inapp', 'email', 'whatsapp'] as const;
export type FollowupChannel = (typeof FOLLOWUP_CHANNELS)[number];

export const FOLLOWUP_STATUSES = [
  'pending',
  'sent',
  'dismissed',
  'expired',
] as const;

export type FollowupStatus = (typeof FOLLOWUP_STATUSES)[number];

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/** Numeric priority in [0, 1]. */
export type FollowupPriority = number;

export interface FollowupPayload {
  readonly text: string;
  readonly citations?: ReadonlyArray<{
    readonly title: string;
    readonly url?: string;
  }>;
  readonly action?: {
    readonly kind: 'approve' | 'review' | 'walk_through' | 'dismiss';
    readonly label: string;
    readonly href?: string;
  };
}

export interface FollowupCandidate {
  readonly id: string;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly source: FollowupSource;
  readonly payload: FollowupPayload;
  readonly priority: FollowupPriority;
  readonly channel: FollowupChannel;
  readonly scheduled_for: string;
  readonly status: FollowupStatus;
  readonly sent_at: string | null;
  readonly audit_hash: string;
  readonly created_at: string;
  /** Optional severity-bypass flag — set TRUE on T-3-or-sooner
      regulator candidates so the scheduler bypasses `max_per_day`. */
  readonly critical: boolean;
}

export interface FollowupPreferences {
  readonly tenant_id: string;
  readonly user_id: string;
  readonly allowed_channels: ReadonlyArray<FollowupChannel>;
  /** Local-time clock string `'HH:MM:SS'`. */
  readonly quiet_hours_start: string;
  /** Local-time clock string `'HH:MM:SS'`. */
  readonly quiet_hours_end: string;
  readonly max_per_day: number;
  /** IANA timezone (any tzdata zone — e.g. 'Africa/Dar_es_Salaam',
   *  'Africa/Nairobi', 'Europe/London'). Resolved per-tenant from the
   *  jurisdiction profile's `timezone_default`; this comment names a TZ
   *  example only because TZ is the launch beachhead. UNIV-4: example
   *  only — runtime accepts any IANA zone. */
  readonly timezone: string;
}

// ---------------------------------------------------------------------------
// Scoring input
// ---------------------------------------------------------------------------

export interface ScoringInput {
  /** Source-supplied impact in [0, 1]. */
  readonly impact_score: number;
  /** Days from now until the deadline. `null` means "no deadline". */
  readonly days_until_deadline: number | null;
  /** Has the user engaged with this topic recently? In [0, 1]. */
  readonly attention_score: number;
  /** How many follow-ups about this topic the user got this week. */
  readonly repeat_count_this_week: number;
}

// ---------------------------------------------------------------------------
// Ports — host-owned interfaces (no I/O in this package).
// ---------------------------------------------------------------------------

export interface FollowupCandidateRepository {
  insert(candidate: FollowupCandidate): Promise<void>;
  /** All candidates whose `scheduled_for ≤ now` AND `status = 'pending'`. */
  listDue(tenant_id: string, now: Date): Promise<ReadonlyArray<FollowupCandidate>>;
  /** Count of `status='sent'` candidates for the user today. */
  countSentToday(
    tenant_id: string,
    user_id: string,
    now: Date,
  ): Promise<number>;
  markSent(id: string, sent_at: Date, audit_hash: string): Promise<void>;
  markDismissed(id: string, dismissed_at: Date): Promise<void>;
  markExpired(id: string, expired_at: Date): Promise<void>;
}

export interface FollowupPreferencesRepository {
  get(
    tenant_id: string,
    user_id: string,
  ): Promise<FollowupPreferences | null>;
  upsert(prefs: FollowupPreferences): Promise<void>;
}

export interface ChannelDispatcher {
  readonly channel: FollowupChannel;
  dispatch(candidate: FollowupCandidate): Promise<DispatchResult>;
}

export interface DispatchResult {
  readonly delivered: boolean;
  readonly delivered_at: string;
  readonly error?: string;
}

export interface AuditChainPort {
  append(payload: Readonly<Record<string, unknown>>): Promise<string>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class UserFollowupError extends Error {
  public override readonly name = 'UserFollowupError';
  public readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Zod schemas (for runtime validation at the host boundary)
// ---------------------------------------------------------------------------

export const followupSourceSchema = z.enum(FOLLOWUP_SOURCES);
export const followupChannelSchema = z.enum(FOLLOWUP_CHANNELS);
export const followupStatusSchema = z.enum(FOLLOWUP_STATUSES);

export const followupCandidateInsertSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().min(1),
  user_id: z.string().min(1),
  source: followupSourceSchema,
  payload: z.object({
    text: z.string().min(1),
    citations: z
      .array(
        z.object({
          title: z.string().min(1),
          url: z.string().url().optional(),
        }),
      )
      .optional(),
    action: z
      .object({
        kind: z.enum(['approve', 'review', 'walk_through', 'dismiss']),
        label: z.string().min(1),
        href: z.string().optional(),
      })
      .optional(),
  }),
  priority: z.number().min(0).max(1),
  channel: followupChannelSchema,
  scheduled_for: z.string(),
  status: followupStatusSchema,
  critical: z.boolean(),
});

export const followupPreferencesUpsertSchema = z.object({
  tenant_id: z.string().min(1),
  user_id: z.string().min(1),
  allowed_channels: z.array(followupChannelSchema),
  quiet_hours_start: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  quiet_hours_end: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  max_per_day: z.number().int().min(0).max(50),
  timezone: z.string().min(1),
});
