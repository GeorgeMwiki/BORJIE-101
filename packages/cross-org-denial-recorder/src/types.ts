/**
 * Cross-tenant denial recorder — public types.
 *
 * Ported from LITFIN `core/security/cross-org-denials/types.ts` with
 * tenant naming (BORJIE's unit is `tenant`, not LITFIN's `org`).
 *
 * Backing store: caller-supplied sink port (`DenialSink`). Production
 * wiring should plug Supabase; tests use the in-memory sink.
 */

/**
 * Canonical reason kinds. Open-set by design — backing column is plain
 * TEXT so callers can add novel reason codes without a migration.
 */
export const DenialReason = {
  /** Supabase RLS policy refused the row. */
  RLS_DENIED: "RLS_DENIED",
  /** Tier-policy resolver blocked the call (tier-based feature gate). */
  TIER_INSUFFICIENT: "TIER_INSUFFICIENT",
  /** Four-eye / dual-control approval gate fired. */
  APPROVAL_REQUIRED: "APPROVAL_REQUIRED",
  /** Role / permission map rejected the call. */
  PERMISSION_DENIED: "PERMISSION_DENIED",
} as const;

export type DenialReasonValue =
  | (typeof DenialReason)[keyof typeof DenialReason]
  | string;

/**
 * Input the recorder accepts.
 */
export interface DenialInput {
  readonly actorUserId?: string | null;
  readonly actorTenantId?: string | null;
  readonly targetTenantId: string;
  readonly route: string;
  readonly httpMethod: string;
  readonly reason: DenialReasonValue;
  readonly requestId?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** What gets persisted. Adds server-assigned timestamp. */
export interface DenialRow extends DenialInput {
  readonly deniedAtIso: string;
}

/** Pluggable sink — implementations may persist to DB, file, or stream. */
export interface DenialSink {
  write(row: DenialRow): Promise<void>;
}

/** Result of `aggregate` / `scanRecentDenials`. */
export interface AggregateStats {
  readonly total: number;
  readonly byReason: Readonly<Record<string, number>>;
  readonly byActor: Readonly<Record<string, number>>;
  readonly windowMs: number;
}

/** Output of `findBruteForcePatterns`. */
export interface BruteForceFinding {
  readonly actorUserId: string;
  readonly targetTenantId: string;
  readonly attempts: number;
  readonly distinctRoutes: number;
  readonly firstSeenIso: string;
  readonly lastSeenIso: string;
}
