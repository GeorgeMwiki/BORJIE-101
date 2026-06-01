/**
 * Read the caller's `user_action_tracker` rows.
 *
 * RLS is FORCE-enabled on `user_action_tracker`: the gateway's
 * `databaseMiddleware` binds `app.current_tenant_id` before this query
 * runs, so the result is already clipped to the caller's tenant. We add
 * a `user_id` predicate ONLY to pick the per-user slice (the table is
 * keyed on (tenant_id, user_id, action_id)) — this is NOT a tenant
 * double-filter, which the hard rules forbid.
 */

import { sql } from 'drizzle-orm';
import type { ActionTrackerRecord } from './engines.js';

export interface DbExec {
  execute(query: unknown): Promise<unknown>;
}

function extractRows(res: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(res)) return res as Array<Record<string, unknown>>;
  const maybe = (res as { rows?: Array<Record<string, unknown>> } | null)?.rows;
  return maybe ?? [];
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date(0).toISOString();
}

/**
 * Fetch every action-tracker row for `userId` in the bound tenant scope.
 * Capped at 1000 distinct actions — far beyond any real user's surface,
 * but bounds the scan. Returns [] when the user has no rows.
 */
export async function readUserActions(
  db: DbExec,
  userId: string,
): Promise<ReadonlyArray<ActionTrackerRecord>> {
  const res = await db.execute(sql`
    SELECT action_id, action_count, first_seen, last_seen
      FROM user_action_tracker
     WHERE user_id = ${userId}
     ORDER BY last_seen DESC
     LIMIT 1000
  `);
  return extractRows(res).map((r) => ({
    actionId: String(r.action_id),
    actionCount:
      typeof r.action_count === 'number'
        ? r.action_count
        : Number(r.action_count ?? 0),
    firstSeen: toIso(r.first_seen),
    lastSeen: toIso(r.last_seen),
  }));
}
