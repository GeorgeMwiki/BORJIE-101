/**
 * Mastery tracker write — bump `user_action_tracker` after a successful
 * execution.
 *
 * The table (migration 0183) is a per-(tenant, user, action) lifetime
 * counter backing the progressive-disclosure mastery layer
 * (`<MasteryGate>` + `/me/mastery` + `/me/shortcuts`). Until the chat
 * could actually DO things there was nothing to count; now every real
 * execution increments the verb's counter so the UI can learn which
 * actions an owner has mastered.
 *
 * RLS: FORCE-enabled. The Drizzle connection already has
 * `app.current_tenant_id` bound by `databaseMiddleware`, so the
 * INSERT … WITH CHECK and UPDATE policies fire against the caller's
 * tenant. We pass `tenant_id` in the row because it is part of the
 * composite primary key — the RLS predicate independently verifies it
 * equals the bound GUC, so this is not an app-level tenant override.
 *
 * Append-on-conflict: `ON CONFLICT … DO UPDATE` increments
 * `action_count` and bumps `last_seen`; `first_seen` is preserved. This
 * is the canonical idempotent upsert for the table — never a mutation of
 * historical audit state.
 *
 * Best-effort: a tracker write must NEVER fail the execution it is
 * counting. Failures are logged + swallowed by the caller.
 */

import { sql } from 'drizzle-orm';

import type { ExecContext } from './types.js';

/**
 * Upsert one (tenant, user, action) counter: insert at count 1 or bump
 * an existing row's count + last_seen. Raw parameterised SQL mirrors the
 * read path in `services/me-progression/repo.ts` (same table, same GUC
 * reliance). Values are bound parameters — no string interpolation, no
 * SQL-injection surface.
 *
 * Returns true on a successful write, false when it was skipped /
 * soft-failed. NEVER throws.
 */
export async function bumpActionMastery(
  ctx: ExecContext,
  verb: string,
): Promise<boolean> {
  try {
    await ctx.db.execute(sql`
      INSERT INTO user_action_tracker
        (tenant_id, user_id, action_id, action_count, first_seen, last_seen)
      VALUES
        (${ctx.tenantId}, ${ctx.userId}, ${verb}, 1, now(), now())
      ON CONFLICT (tenant_id, user_id, action_id)
      DO UPDATE SET
        action_count = user_action_tracker.action_count + 1,
        last_seen = now()
    `);
    return true;
  } catch (err) {
    ctx.logger.warn?.(
      {
        wiring: 'action-executor-mastery',
        verb,
        tenantId: ctx.tenantId,
        error: err instanceof Error ? err.message : String(err),
      },
      'action-executor: mastery tracker write failed (soft)',
    );
    return false;
  }
}
