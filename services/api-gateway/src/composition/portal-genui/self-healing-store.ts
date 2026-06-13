/**
 * Self-healing proposal store — the persistence behind the INTERNAL-ADMIN
 * self-healing console. Every blocker the MAPE-K loop reports lands here for
 * the Borjie PLATFORM team (never the owner).
 *
 * The table is platform-internal + service-role-only (migration 0349), so
 * EVERY access — the write from the heal loop AND the admin read/decide —
 * runs inside `withServiceRoleContext` (sets `app.is_service_role = true`, the
 * only context the RLS policy admits). A tenant request can never see a row.
 *
 * Dedup: `dedupe_key = blocker_kind:locus` is UNIQUE. A repeat occurrence bumps
 * `occurrence_count` + `last_seen_at` instead of flooding the queue; an
 * APPROVED proposal that recurs re-opens to `pending` (the fix did not take); a
 * DENIED one stays denied (the admin accepted the degrade).
 *
 * @module composition/portal-genui/self-healing-store
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { withServiceRoleContext, selfHealingProposals } from '@borjie/database';
import type {
  RepairOutcome,
  BlockerSignal,
} from '@borjie/portal-genui';

/** The DB client type `withServiceRoleContext` accepts (collision-safe). */
type ServiceRoleDb = Parameters<typeof withServiceRoleContext>[0];

// Derive the row type from the table value (NOT the named `SelfHealingProposalRow`
// type export — the @borjie/database barrel's `export *` shadows that name with
// a namespace at this consumption site, exactly like `DatabaseClient`).
export type SelfHealingProposalRow = typeof selfHealingProposals.$inferSelect;

/** Statuses an admin can still act on / that the console surfaces as "open". */
const OPEN_STATUSES = ['pending', 'auto-healed'] as const;

export interface SelfHealingDecisionInput {
  readonly id: string;
  readonly decision: 'approved' | 'denied';
  readonly actorId: string;
  readonly note?: string;
}

export interface SelfHealingStore {
  /** Record one heal outcome (insert-or-bump). Throws on DB failure — the
   *  caller (the sink) fires this fire-and-forget and guards the rejection. */
  record(outcome: RepairOutcome, signal: BlockerSignal): Promise<void>;
  /** List open proposals (pending + auto-healed), most-recently-seen first. */
  listOpen(limit?: number): Promise<ReadonlyArray<SelfHealingProposalRow>>;
  /** Approve / deny an open proposal. No-op (updated:false) if not open. */
  decide(input: SelfHealingDecisionInput): Promise<{ readonly updated: boolean }>;
}

const MAX_LIST = 200;

export function createSelfHealingStore(deps: {
  readonly db: ServiceRoleDb;
}): SelfHealingStore {
  const { db } = deps;

  return {
    async record(outcome, signal): Promise<void> {
      const kind = String(signal?.kind ?? 'unknown');
      const locus = signal?.locus ?? 'unknown';
      const dedupeKey = `${kind}:${locus}`;
      const proposal = outcome?.proposal;
      const status = outcome?.status === 'escalated' ? 'pending' : 'auto-healed';
      const now = new Date();

      await withServiceRoleContext(db, async (tx) => {
        await tx
          .insert(selfHealingProposals)
          .values({
            id: `shp_${randomUUID()}`,
            blockerKind: kind,
            repairClass: outcome?.class ?? 'escalate-novel',
            locus,
            detail: signal?.detail ?? null,
            title: proposal?.title ?? `blocker: ${kind}`,
            suggestedFix: proposal?.suggestedFix ?? 'investigate',
            insight: proposal?.insight ?? '',
            actionPlan: proposal?.actionPlan ?? [],
            autoApplicable: false,
            tenantId: signal?.tenantId ?? null,
            occurrenceCount: 1,
            dedupeKey,
            status,
            firstSeenAt: now,
            lastSeenAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: selfHealingProposals.dedupeKey,
            set: {
              occurrenceCount: sql`${selfHealingProposals.occurrenceCount} + 1`,
              lastSeenAt: now,
              updatedAt: now,
              // Refresh the latest triage detail (insight/plan may have improved).
              detail: signal?.detail ?? null,
              insight: proposal?.insight ?? '',
              actionPlan: proposal?.actionPlan ?? [],
              suggestedFix: proposal?.suggestedFix ?? 'investigate',
              repairClass: outcome?.class ?? 'escalate-novel',
              // Re-open an APPROVED proposal that recurred (fix did not take);
              // leave DENIED denied; pending/auto-healed keep their state.
              status: sql`CASE
                WHEN ${selfHealingProposals.status} = 'denied' THEN 'denied'
                WHEN ${selfHealingProposals.status} = 'approved' THEN 'pending'
                ELSE ${selfHealingProposals.status} END`,
            },
          });
      });
    },

    async listOpen(limit = 100): Promise<ReadonlyArray<SelfHealingProposalRow>> {
      const capped = Math.min(Math.max(1, limit), MAX_LIST);
      return withServiceRoleContext(db, async (tx) =>
        tx
          .select()
          .from(selfHealingProposals)
          .where(inArray(selfHealingProposals.status, [...OPEN_STATUSES]))
          .orderBy(desc(selfHealingProposals.lastSeenAt))
          .limit(capped),
      );
    },

    async decide(input): Promise<{ readonly updated: boolean }> {
      // Approving accepts a code-gated REPAIR PLAN — only meaningful for a
      // `pending` (escalated) proposal. Denying (dismiss) clears any open row,
      // including an auto-healed observation that has been reviewed.
      const allowedFrom =
        input.decision === 'approved' ? ['pending'] : [...OPEN_STATUSES];
      const rows = await withServiceRoleContext(db, async (tx) =>
        tx
          .update(selfHealingProposals)
          .set({
            status: input.decision,
            decidedByActorId: input.actorId,
            decisionNote: input.note ?? null,
            decidedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(selfHealingProposals.id, input.id),
              inArray(selfHealingProposals.status, allowedFrom),
            ),
          )
          .returning({ id: selfHealingProposals.id }),
      );
      return { updated: rows.length > 0 };
    },
  };
}
