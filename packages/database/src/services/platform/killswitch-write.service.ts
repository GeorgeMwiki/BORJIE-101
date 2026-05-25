/**
 * Killswitch-write Drizzle adapter — backs the HQ-tier
 * `platform.set_killswitch` tool (Central Command Phase B — B1).
 * Migration 0138.
 *
 * The kernel's existing `KillswitchPort` (in
 * `packages/central-intelligence/src/kernel/killswitch.ts`) reads from
 * env vars. This DB-backed override takes PRECEDENCE — on every write
 * the adapter optionally publishes a `cross-portal` event so all
 * running brain instances re-read the new state immediately (no
 * restart).
 *
 * The cross-portal bus is wired by B2 in the composition root. To keep
 * this adapter dependency-free we accept a `publishCrossPortalEvent`
 * callback in the deps bundle; if the composition root passes a no-op
 * (or omits it), the write still completes — the new state simply
 * propagates lazily as each brain re-reads.
 *
 * Hard DB failures:
 *   - writeKillswitch       : RE-THROWS (destroy-tier — caller must know)
 *   - restoreKillswitch     : RE-THROWS
 */
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { platformKillswitchState } from '../../schemas/platform-killswitch-state.schema.js';
import type { DatabaseClient } from '../../client.js';
import { logger } from '../../logger.js';

// ─────────────────────────────────────────────────────────────────────
// Structural port shapes — duck-typed to keep this package from
// compile-depending on @borjie/central-intelligence.
// ─────────────────────────────────────────────────────────────────────

export type KillswitchLevel = 'live' | 'degraded' | 'halt';

export type KillswitchReasonCode =
  | 'KILLSWITCH_HALT'
  | 'COMPLIANCE_HOLD_CBK'
  | 'COMPLIANCE_HOLD_EAC'
  | 'COMPLIANCE_HOLD_OAG'
  | 'PROVIDER_INCIDENT'
  | 'STALE_GROUNDING_FACTS'
  | 'TENANT_HALT'
  | 'TENANT_DATA_LEAK_SUSPECTED'
  | 'TENANT_PORTAL_COMPROMISED'
  | 'OWNER_STATEMENT_DISPUTE'
  | 'MAINTENANCE_TICKET_STORM';

export interface WriteKillswitchArgs {
  readonly scope: 'platform' | `tenant:${string}`;
  readonly level: KillswitchLevel;
  readonly reasonCode: KillswitchReasonCode;
  readonly note: string | null;
}

export interface SetKillswitchResult {
  readonly scope: 'platform' | `tenant:${string}`;
  readonly level: KillswitchLevel;
  readonly reasonCode: KillswitchReasonCode;
  readonly note: string | null;
  readonly previous: {
    readonly level: KillswitchLevel;
    readonly reasonCode: KillswitchReasonCode;
    readonly note: string | null;
  } | null;
  readonly updatedAt: string;
}

export interface RestoreKillswitchArgs {
  readonly scope: 'platform' | `tenant:${string}`;
  readonly previous: {
    readonly level: KillswitchLevel;
    readonly reasonCode: KillswitchReasonCode;
    readonly note?: string;
  } | null;
}

export interface PlatformKillswitchWriteService {
  writeKillswitch(args: WriteKillswitchArgs): Promise<SetKillswitchResult>;
  restoreKillswitch(args: RestoreKillswitchArgs): Promise<void>;
  /** Operator helper — read the current DB-backed override (or null). */
  readCurrent(
    scope: 'platform' | `tenant:${string}`,
  ): Promise<SetKillswitchResult['previous']>;
}

export interface KillswitchDeps {
  /**
   * Caller id (from `HqToolContext.caller.callerId`) for the `set_by`
   * audit column. The HQ-tool wiring threads this through a per-call
   * factory; the adapter accepts a getter so writes always stamp the
   * active operator.
   */
  readonly resolveActor: () => string;
  /**
   * Optional cross-portal publisher — when supplied, every successful
   * `writeKillswitch` invokes this so all running brains pick up the
   * new state immediately. Errors are swallowed + logged; the DB
   * write is the source of truth.
   *
   * B2 owns the actual cross-portal-bus wiring in
   * `services/api-gateway/src/composition/cross-portal-bus.ts`.
   */
  readonly publishCrossPortalEvent?: (event: {
    readonly type: 'killswitch:changed';
    readonly scope: 'platform' | `tenant:${string}`;
    readonly level: KillswitchLevel;
    readonly reasonCode: KillswitchReasonCode;
    readonly setAt: string;
  }) => Promise<void> | void;
}

function isLevel(v: unknown): v is KillswitchLevel {
  return v === 'live' || v === 'degraded' || v === 'halt';
}

function isReasonCode(v: unknown): v is KillswitchReasonCode {
  return (
    v === 'KILLSWITCH_HALT' ||
    v === 'COMPLIANCE_HOLD_CBK' ||
    v === 'COMPLIANCE_HOLD_EAC' ||
    v === 'COMPLIANCE_HOLD_OAG' ||
    v === 'PROVIDER_INCIDENT' ||
    v === 'STALE_GROUNDING_FACTS' ||
    v === 'TENANT_HALT' ||
    v === 'TENANT_DATA_LEAK_SUSPECTED' ||
    v === 'TENANT_PORTAL_COMPROMISED' ||
    v === 'OWNER_STATEMENT_DISPUTE' ||
    v === 'MAINTENANCE_TICKET_STORM'
  );
}

interface RawKsRow {
  level: string;
  reasonCode: string;
  note: string | null;
  prevLevel: string | null;
  prevReasonCode: string | null;
  prevNote: string | null;
  setAt: Date | string;
}

function toIso(value: unknown): string {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const asDate = new Date(value);
    if (!Number.isNaN(asDate.getTime())) return asDate.toISOString();
    return value;
  }
  return '';
}

export function createPlatformKillswitchWriteService(
  db: DatabaseClient,
  deps: KillswitchDeps,
): PlatformKillswitchWriteService {
  async function fireCrossPortal(args: {
    scope: 'platform' | `tenant:${string}`;
    level: KillswitchLevel;
    reasonCode: KillswitchReasonCode;
    setAt: string;
  }): Promise<void> {
    if (!deps.publishCrossPortalEvent) return;
    try {
      await deps.publishCrossPortalEvent({
        type: 'killswitch:changed',
        scope: args.scope,
        level: args.level,
        reasonCode: args.reasonCode,
        setAt: args.setAt,
      });
    } catch (error) {
      // Cross-portal publish is best-effort; DB is source of truth.
      logger.error('platform.killswitch.publishCrossPortalEvent failed', { error: error });
    }
  }

  return {
    async readCurrent(scope) {
      try {
        const rows = (await db
          .select({
            level: platformKillswitchState.level,
            reasonCode: platformKillswitchState.reasonCode,
            note: platformKillswitchState.note,
          })
          .from(platformKillswitchState)
          .where(eq(platformKillswitchState.scope, scope))
          .limit(1)) as ReadonlyArray<{
          level: string;
          reasonCode: string;
          note: string | null;
        }>;
        const r = rows[0];
        if (!r || !isLevel(r.level) || !isReasonCode(r.reasonCode)) return null;
        return {
          level: r.level,
          reasonCode: r.reasonCode,
          note: r.note,
        };
      } catch (error) {
        logger.error('platform.killswitch.readCurrent failed', { error: error });
        return null;
      }
    },

    async writeKillswitch(args) {
      const actor = deps.resolveActor();
      const now = new Date();
      try {
        // Load the existing row for the rollback contract — must capture
        // the previous (level, reasonCode, note) snapshot.
        const existingRows = (await db
          .select({
            level: platformKillswitchState.level,
            reasonCode: platformKillswitchState.reasonCode,
            note: platformKillswitchState.note,
            prevLevel: platformKillswitchState.prevLevel,
            prevReasonCode: platformKillswitchState.prevReasonCode,
            prevNote: platformKillswitchState.prevNote,
            setAt: platformKillswitchState.setAt,
          })
          .from(platformKillswitchState)
          .where(eq(platformKillswitchState.scope, args.scope))
          .limit(1)) as ReadonlyArray<RawKsRow>;
        const existing = existingRows[0] ?? null;
        const previous = existing
          ? {
              level: isLevel(existing.level) ? existing.level : ('live' as const),
              reasonCode: isReasonCode(existing.reasonCode)
                ? existing.reasonCode
                : ('PROVIDER_INCIDENT' as const),
              note: existing.note,
            }
          : null;

        if (!existing) {
          await db.insert(platformKillswitchState).values({
            id: randomUUID(),
            scope: args.scope,
            level: args.level,
            reasonCode: args.reasonCode,
            note: args.note,
            prevLevel: null,
            prevReasonCode: null,
            prevNote: null,
            setAt: now,
            setBy: actor,
          } as never);
        } else {
          await db
            .update(platformKillswitchState)
            .set({
              level: args.level,
              reasonCode: args.reasonCode,
              note: args.note,
              prevLevel: existing.level,
              prevReasonCode: existing.reasonCode,
              prevNote: existing.note,
              setAt: now,
              setBy: actor,
            } as never)
            .where(eq(platformKillswitchState.scope, args.scope));
        }
        await fireCrossPortal({
          scope: args.scope,
          level: args.level,
          reasonCode: args.reasonCode,
          setAt: now.toISOString(),
        });
        return {
          scope: args.scope,
          level: args.level,
          reasonCode: args.reasonCode,
          note: args.note,
          previous,
          updatedAt: now.toISOString(),
        };
      } catch (error) {
        logger.error('platform.killswitch.writeKillswitch failed', { error: error });
        throw error instanceof Error
          ? error
          : new Error('platform.killswitch.writeKillswitch failed');
      }
    },

    async restoreKillswitch(args) {
      const actor = deps.resolveActor();
      const now = new Date();
      try {
        if (!args.previous) {
          // Restore to "no DB override" — delete the row entirely so the
          // env-var killswitch becomes authoritative again.
          await db
            .delete(platformKillswitchState)
            .where(eq(platformKillswitchState.scope, args.scope));
          await fireCrossPortal({
            scope: args.scope,
            level: 'live',
            reasonCode: 'PROVIDER_INCIDENT',
            setAt: now.toISOString(),
          });
          return;
        }
        await db
          .update(platformKillswitchState)
          .set({
            level: args.previous.level,
            reasonCode: args.previous.reasonCode,
            note: args.previous.note ?? null,
            // We don't bump prev* on restore — the snapshot we're
            // restoring to was already the prior state.
            setAt: now,
            setBy: actor,
          } as never)
          .where(eq(platformKillswitchState.scope, args.scope));
        await fireCrossPortal({
          scope: args.scope,
          level: args.previous.level,
          reasonCode: args.previous.reasonCode,
          setAt: now.toISOString(),
        });
      } catch (error) {
        logger.error('platform.killswitch.restoreKillswitch failed', { error: error });
        throw error instanceof Error
          ? error
          : new Error('platform.killswitch.restoreKillswitch failed');
      }
    },
  };
}

// `toIso` kept exported indirectly for tests that want raw row mapping.
void toIso;
