/**
 * Killswitch RBAC helpers — scope matching + authority lookup.
 *
 * Owns the glob-match logic so the route file stays under 300 lines.
 * A scope grant of `killswitch:platform:*` covers any target. A grant
 * of `killswitch:tenant:<id>:*` only covers `tenant:<id>` targets.
 *
 * Consumed by killswitch.hono.ts at both /killswitch (initiator) and
 * /killswitch/:id/confirm (confirmer) entry points.
 */

import { randomUUID } from 'node:crypto';
import { and, eq, isNull, inArray } from 'drizzle-orm';
import {
  killswitchAuthorities,
  platformKillswitchState,
} from '@borjie/database';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = any;

export type KillswitchScope = 'platform' | `tenant:${string}`;

/**
 * Resolve the canonical grant patterns that would cover a given target
 * scope. Returned in priority order: a platform-wide grant covers
 * everything, a tenant-specific grant only that tenant.
 */
export function requiredAuthorityScopes(target: KillswitchScope): string[] {
  if (target === 'platform') {
    return ['killswitch:platform:*'];
  }
  const tenantId = target.slice('tenant:'.length);
  if (!tenantId) {
    throw new Error('Invalid tenant scope');
  }
  return [
    'killswitch:platform:*',
    `killswitch:tenant:${tenantId}:*`,
  ];
}

/**
 * Returns true if `userId` holds any active authority covering
 * `targetScope` (revoked_at IS NULL). Reads-only — no side effects.
 */
export async function userHoldsAuthority(
  db: DrizzleDb,
  userId: string,
  targetScope: KillswitchScope,
): Promise<boolean> {
  const candidateScopes = requiredAuthorityScopes(targetScope);
  const rows = await db
    .select({ id: killswitchAuthorities.id })
    .from(killswitchAuthorities)
    .where(
      and(
        eq(killswitchAuthorities.userId, userId),
        inArray(killswitchAuthorities.scope, candidateScopes),
        isNull(killswitchAuthorities.revokedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Parse and validate a free-form scope string into our typed shape.
 * Throws if the value does not match either `platform` or
 * `tenant:<non-empty-id>`.
 */
export function parseScope(raw: string): KillswitchScope {
  if (raw === 'platform') return 'platform';
  if (raw.startsWith('tenant:')) {
    const tenantId = raw.slice('tenant:'.length);
    if (tenantId.length === 0) {
      throw new Error('tenant scope requires non-empty tenant id');
    }
    return raw as KillswitchScope;
  }
  throw new Error('Scope must be "platform" or "tenant:<tenantId>"');
}

export interface ApplyTarget {
  readonly scope: string;
  readonly level: 'live' | 'degraded' | 'halt';
  readonly reasonCode: string;
  readonly note?: string;
}

/**
 * Apply a validated kill-switch target to platform_killswitch_state.
 * Inserts a new row when no row exists for the scope, otherwise updates
 * in place with the prev_* snapshot the rollback contract requires.
 */
export async function applyKillswitch(
  db: DrizzleDb,
  target: ApplyTarget,
  setBy: string,
  now: Date,
): Promise<{ row: unknown; created: boolean }> {
  const [existing] = await db
    .select()
    .from(platformKillswitchState)
    .where(eq(platformKillswitchState.scope, target.scope))
    .limit(1);
  if (!existing) {
    const [row] = await db
      .insert(platformKillswitchState)
      .values({
        id: randomUUID(),
        scope: target.scope,
        level: target.level,
        reasonCode: target.reasonCode,
        note: target.note ?? null,
        prevLevel: null,
        prevReasonCode: null,
        prevNote: null,
        setAt: now,
        setBy,
      })
      .returning();
    return { row, created: true };
  }
  const [row] = await db
    .update(platformKillswitchState)
    .set({
      level: target.level,
      reasonCode: target.reasonCode,
      note: target.note ?? null,
      prevLevel: existing.level,
      prevReasonCode: existing.reasonCode,
      prevNote: existing.note,
      setAt: now,
      setBy,
    })
    .where(eq(platformKillswitchState.scope, target.scope))
    .returning();
  return { row, created: false };
}
