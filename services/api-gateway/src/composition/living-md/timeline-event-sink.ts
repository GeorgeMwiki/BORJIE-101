/**
 * timeline-event-sink.ts — the APPEND-ONLY, hash-chained lifecycle-trail writer
 * for the MD commitment ledger (the LIVING-MD organ's audit spine).
 *
 * WHAT IT DOES
 * ------------
 * `record(event)` appends ONE immutable row to `md_commitment_timeline`
 * (migration 0339) per lifecycle event of a commitment. It is called as a
 * SIDE-EFFECT alongside the load-bearing commitment transition (the reconcile
 * sweep's status flips, the md-defer-tools confirm/reopen) so the timeline is
 * always in lockstep with the ledger.
 *
 * THE HASH CHAIN (CLAUDE.md hard rule: hash-chained, append-only, no mutation)
 * --------------------------------------------------------------------------
 * Each row stitches `audit_hash = sha256(previousHash || commitmentId ||
 * eventKind || newStatus || isoTs)` and persists the `previousHash` it chained
 * from, so an independent replay can detect a truncated / inserted / mutated
 * trail (a sound per-commitment chain is a linked run). The previous hash is
 * read from the latest existing row for the commitment, inside the SAME
 * service-role transaction as the insert so two concurrent appends cannot fork.
 *
 * BEST-EFFORT (felt-plan rail): the timeline is the forensic MIRROR, never the
 * load-bearing write. `record` NEVER throws — a sink fault (DB down, missing
 * table after a down-migration) is swallowed + logged so the commitment
 * transition that triggered it still commits. The reconcile tick / the chat
 * turn / the confirm tool are never broken by a timeline fault.
 *
 * OUT-OF-BAND RLS: every write runs inside `withServiceRoleContext` (the
 * reconcile sweep / someday supervisor have no request middleware to bind the
 * tenant GUC), and every statement is explicitly tenant-scoped in SQL as
 * defence in depth. No `console.*` (Pino shim only). Immutable inputs.
 */

import { createHash } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { withServiceRoleContext } from '@borjie/database';
import type { PinoLikeLogger } from '../../utils/pino-shim.js';
import { createPinoLikeLogger } from '../../utils/pino-shim.js';
import type { MdTimelineEventKind } from '@borjie/database/schemas';

/** The minimal DB surface the sink needs (execute + optional transaction). */
export interface TimelineDbLike {
  execute(query: unknown): Promise<unknown>;
  transaction?: unknown;
}

/** One lifecycle event to append to the trail. Immutable input. */
export interface TimelineEvent {
  readonly tenantId: string;
  readonly commitmentId: string;
  readonly eventKind: MdTimelineEventKind;
  readonly previousStatus?: string | null;
  readonly newStatus?: string | null;
  /** Positive-proof closure kind (closure-by-confirmation, never timeout). */
  readonly proofKind?: string | null;
  readonly evidenceIds?: ReadonlyArray<string>;
  /** 'mwikila' | 'owner' | 'reconcile' | 'event:<key>' — default 'mwikila'. */
  readonly actor?: string;
  /** Event timestamp (ms). Defaults to the injected clock. */
  readonly occurredAtMs?: number;
}

export interface TimelineSink {
  /** Append one lifecycle row. Best-effort: never throws. */
  record(event: TimelineEvent): Promise<void>;
}

/** Genesis salt so a forged chain cannot start fresh for a different commitment. */
const TIMELINE_GENESIS_SALT = 'borjie:md-timeline:genesis:v1';

function genesisSeed(commitmentId: string, tenantId: string): string {
  return createHash('sha256')
    .update(`${commitmentId} ${tenantId} ${TIMELINE_GENESIS_SALT}`)
    .digest('hex');
}

/** Stitch the next append-only hash over (prev || id || kind || status || ts). */
function stitchHash(
  previousHash: string,
  commitmentId: string,
  eventKind: string,
  newStatus: string,
  isoTs: string,
): string {
  return createHash('sha256')
    .update(`${previousHash}|${commitmentId}|${eventKind}|${newStatus}|${isoTs}`)
    .digest('hex');
}

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return result as ReadonlyArray<Record<string, unknown>>;
  }
  const rows = (result as { rows?: ReadonlyArray<Record<string, unknown>> })
    ?.rows;
  return Array.isArray(rows) ? rows : [];
}

/**
 * Build the timeline sink. When `db` is null (degraded boot / tests without a
 * DB) the sink is an honest no-op that logs once at debug-info — the trail is
 * simply dark, never a crash.
 */
export function createTimelineSink(deps: {
  readonly db: TimelineDbLike | null;
  readonly logger?: PinoLikeLogger;
  readonly clock?: () => Date;
}): TimelineSink {
  const logger = deps.logger ?? createPinoLikeLogger('md-timeline-sink');
  const clock = deps.clock ?? (() => new Date());
  const db = deps.db;

  if (!db) {
    logger.info(
      { wiring: 'md-timeline-sink' },
      'md-timeline-sink: no db bound — timeline trail dark (honest no-op)',
    );
    return {
      async record(): Promise<void> {
        // Honest no-op — the trail is dark, the commitment transition still wins.
      },
    };
  }

  return {
    async record(event: TimelineEvent): Promise<void> {
      const occurredAtMs = event.occurredAtMs ?? clock().getTime();
      const isoTs = new Date(occurredAtMs).toISOString();
      const newStatus = event.newStatus ?? '';
      const evidenceJson = JSON.stringify([...(event.evidenceIds ?? [])]);
      try {
        await withServiceRoleContext(
          db as unknown as Parameters<typeof withServiceRoleContext>[0],
          async (tx) => {
            const txDb = tx as unknown as TimelineDbLike;
            // Read the latest existing hash for this commitment IN-TX so two
            // concurrent appends cannot fork the per-commitment chain.
            const prior = rowsOf(
              await txDb.execute(sql`
                SELECT audit_hash
                  FROM md_commitment_timeline
                 WHERE tenant_id = ${event.tenantId}
                   AND commitment_id = ${event.commitmentId}
                 ORDER BY event_at DESC, created_at DESC
                 LIMIT 1
              `),
            );
            const previousHash =
              prior.length > 0 && typeof prior[0]?.audit_hash === 'string'
                ? (prior[0].audit_hash as string)
                : null;
            const chainFrom =
              previousHash ??
              genesisSeed(event.commitmentId, event.tenantId);
            const auditHash = stitchHash(
              chainFrom,
              event.commitmentId,
              event.eventKind,
              newStatus,
              isoTs,
            );
            await txDb.execute(sql`
              INSERT INTO md_commitment_timeline
                (tenant_id, commitment_id, event_kind, event_at,
                 previous_status, new_status, proof_kind, evidence_ids,
                 actor, audit_hash, previous_hash)
              VALUES
                (${event.tenantId}, ${event.commitmentId}, ${event.eventKind},
                 ${isoTs}::timestamptz,
                 ${event.previousStatus ?? null}, ${event.newStatus ?? null},
                 ${event.proofKind ?? null}, ${evidenceJson}::jsonb,
                 ${event.actor ?? 'mwikila'}, ${auditHash}, ${previousHash})
            `);
          },
        );
      } catch (err) {
        // Best-effort: a timeline fault NEVER aborts the load-bearing transition.
        logger.warn(
          {
            wiring: 'md-timeline-sink',
            tenantId: event.tenantId,
            commitmentId: event.commitmentId,
            eventKind: event.eventKind,
            err: err instanceof Error ? err.message : String(err),
          },
          'md-timeline-sink: append failed (swallowed — commitment transition unaffected)',
        );
      }
    },
  };
}
