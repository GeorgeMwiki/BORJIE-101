/**
 * user-mastery — public types.
 *
 * The progressive-disclosure layer treats every UI surface as a
 * function of the user's mastery level. A first-time visitor and a
 * power-user MUST NOT see the same chrome. This module defines the
 * level enum, the action-event record we ingest, and the score shape
 * returned to the React layer.
 *
 * Boundaries (see mastery-policy.ts):
 *   novice      total <= 10
 *   intermediate 10 < total <= 50
 *   expert      50 < total <= 200
 *   power-user   total > 200
 *
 * `MasteryLevel` is ordered — `compareLevels(a, b)` lives in
 * mastery-policy.ts. Anything that needs "at-least" gating should call
 * that helper, not string-compare these literals.
 */

export type MasteryLevel =
  | 'novice'
  | 'intermediate'
  | 'expert'
  | 'power-user';

/**
 * Raw event flushed into the tracker when the user does something
 * meaningful. We DO NOT log every keystroke — call this on completed
 * actions (form submit, command invocation, panel toggle, etc.) so the
 * count reflects intentional engagement, not noise.
 */
export interface UserActionEvent {
  readonly tenantId: string;
  readonly userId: string;
  readonly actionId: string;
  /** ISO-8601 timestamp; defaults to "now" inside the tracker. */
  readonly timestamp?: string;
}

/**
 * Persistent per-(tenant, user, action) row mirrored from
 * `user_action_tracker` in the database. The React layer rebuilds
 * `MasteryScore` from a slice of these.
 */
export interface UserActionRecord {
  readonly tenantId: string;
  readonly userId: string;
  readonly actionId: string;
  readonly actionCount: number;
  readonly firstSeen: string;
  readonly lastSeen: string;
}

/**
 * The output of `computeMasteryScore`. `nextThreshold` is the action
 * count required to advance to the next tier — `null` once the user
 * is already a power-user.
 */
export interface MasteryScore {
  readonly level: MasteryLevel;
  readonly totalActions: number;
  readonly distinctActions: number;
  /** 0..1 — recency weight, 1.0 = active in last 7 days, 0.0 = stale. */
  readonly recencyWeight: number;
  /** Score after applying recency weight; used for boundary checks. */
  readonly weightedScore: number;
  /** Action count needed to reach the next level, or null at the top. */
  readonly nextThreshold: number | null;
  /** The next level the user would unlock, or null at the top. */
  readonly nextLevel: MasteryLevel | null;
}

/** Adapter contract: how the tracker reads/writes persistent counts. */
export interface UserActionStore {
  readonly read: (
    tenantId: string,
    userId: string,
  ) => Promise<ReadonlyArray<UserActionRecord>>;
  readonly upsert: (event: UserActionEvent) => Promise<UserActionRecord>;
}
