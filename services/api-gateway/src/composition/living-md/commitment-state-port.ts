/**
 * commitment-state-port.ts — the chat READ-PORT over the durable commitment
 * ledger (the LIVING-MD organ's per-turn lens).
 *
 * THE SOTA DISCIPLINE THIS ENFORCES
 * ---------------------------------
 * Magentic-One's dual-ledger contract requires the outer TASK LEDGER to be
 * RE-READ every loop — the agent never trusts its in-context memory of what is
 * outstanding between ticks. This port is that re-read for the chat turn: it
 * calls `repository.listLive(tenantId)` (the never-drop-a-thread sweep), then
 * partitions the backlog into the counts + briefs the pre-turn / post-turn hooks
 * inject into the model's attention window. It is PURE over the repository
 * snapshot — no writes, frozen returns, no caching (a fresh read every call).
 *
 * GTD TAXONOMY + SOMEDAY INVISIBILITY (CLAUDE.md / felt-plan rail): `someday`
 * items are EXCLUDED from `due`, `becameDueSince`, and `nextActions` — they are
 * invisible until the owner re-reviews them (the someday-review supervisor is
 * the only path that resurfaces them). They are still counted in `somedayCount`
 * so the owner's living-plan can show the parked horizon.
 *
 * No `console.*` (the port is logger-free; the caller logs). Immutable.
 */

import type {
  MdCommitment,
  MdCommitmentRepository,
} from '@borjie/database/repositories';

/** A compact commitment brief surfaced to the chat layer (read-only). */
export interface CommitmentBrief {
  readonly id: string;
  readonly title: string;
  readonly titleSw: string;
  readonly kind: string;
  readonly status: MdCommitment['status'];
  readonly sovereign: boolean;
  readonly triggerDueAtMs: number | null;
  readonly rungLevel: number;
  readonly evidenceIds: ReadonlyArray<string>;
}

/** The lifecycle-class counts the hooks reason over. */
export interface CommitmentCounts {
  readonly open: number;
  readonly scheduled: number;
  readonly due: number;
  readonly overdue: number;
  readonly blocked: number;
}

/** The immutable per-turn state snapshot the hooks consume. */
export interface CommitmentState {
  readonly tenantId: string;
  readonly counts: CommitmentCounts;
  /** Parked long-horizon items (someday) — invisible until owner re-review. */
  readonly somedayCount: number;
  /** Deferred = the live backlog excluding terminal/someday (open threads). */
  readonly deferredCount: number;
  /** Soonest upcoming due timestamp across the live backlog (null when none). */
  readonly nextDueAtMs: number | null;
  /** Commitments that BECAME due/overdue since `sinceMs` (updatedAt > sinceMs). */
  readonly becameDueSince: ReadonlyArray<CommitmentBrief>;
  /** Commitments CREATED since `sinceMs` (createdAt > sinceMs). */
  readonly newSince: ReadonlyArray<CommitmentBrief>;
  /** Overdue commitments older than the warn horizon (>7d) — flag tone. */
  readonly staleOverdue: ReadonlyArray<CommitmentBrief>;
  /** The top next-actions the owner should see first (someday excluded). */
  readonly nextActions: ReadonlyArray<CommitmentBrief>;
}

export interface CommitmentStatePort {
  getState(tenantId: string, sinceMs: number): Promise<CommitmentState>;
}

/** Statuses that are "actionable now" (the model should be reminded of these). */
const DUE_STATUSES: ReadonlySet<MdCommitment['status']> = new Set([
  'overdue',
]);

/** Overdue-staleness horizon: an overdue commitment older than this warns. */
const STALE_OVERDUE_MS = 7 * 24 * 60 * 60 * 1000;

/** Cap on the briefs we surface so a huge backlog never floods the prompt. */
const MAX_BRIEFS = 5;

function toBrief(c: MdCommitment): CommitmentBrief {
  return Object.freeze({
    id: c.id,
    title: c.title,
    titleSw: c.titleSw,
    kind: c.kind,
    status: c.status,
    sovereign: c.sovereign,
    triggerDueAtMs: c.triggerDueAtMs,
    rungLevel: c.rungLevel,
    evidenceIds: Object.freeze([...c.evidenceIds]),
  });
}

/**
 * Build the chat read-port. `clock` is injected for testability; the port reads
 * the ledger FRESH on every call (never caches between ticks).
 */
export function createCommitmentStatePort(deps: {
  readonly repository: MdCommitmentRepository;
  readonly clock?: () => Date;
}): CommitmentStatePort {
  const clock = deps.clock ?? (() => new Date());

  return {
    async getState(tenantId: string, sinceMs: number): Promise<CommitmentState> {
      // THE OUTER TASK-LEDGER RE-READ — fresh, every turn, never from memory.
      const live = await deps.repository.listLive(tenantId);
      const nowMs = clock().getTime();

      const counts = { open: 0, scheduled: 0, due: 0, overdue: 0, blocked: 0 };
      let somedayCount = 0;
      let nextDueAtMs: number | null = null;
      const becameDue: CommitmentBrief[] = [];
      const fresh: CommitmentBrief[] = [];
      const staleOverdue: CommitmentBrief[] = [];
      const nextActions: CommitmentBrief[] = [];

      for (const c of live) {
        const isSomeday = c.class === 'someday';
        if (isSomeday) {
          // someday is invisible to the chat lens — counted, never surfaced.
          somedayCount += 1;
          continue;
        }

        switch (c.status) {
          case 'open':
            counts.open += 1;
            break;
          case 'scheduled':
            counts.scheduled += 1;
            break;
          case 'overdue':
            counts.overdue += 1;
            counts.due += 1;
            break;
          case 'blocked':
            counts.blocked += 1;
            break;
          default:
            break;
        }

        if (c.triggerDueAtMs !== null && c.triggerDueAtMs >= nowMs) {
          if (nextDueAtMs === null || c.triggerDueAtMs < nextDueAtMs) {
            nextDueAtMs = c.triggerDueAtMs;
          }
        }

        if (DUE_STATUSES.has(c.status) && c.updatedAtMs > sinceMs) {
          becameDue.push(toBrief(c));
        }
        if (c.createdAtMs > sinceMs) {
          fresh.push(toBrief(c));
        }
        if (
          c.status === 'overdue' &&
          c.triggerDueAtMs !== null &&
          nowMs - c.triggerDueAtMs > STALE_OVERDUE_MS
        ) {
          staleOverdue.push(toBrief(c));
        }
        // next-actions: the owner-facing front of the queue (someday excluded).
        if (c.status === 'overdue' || c.status === 'open') {
          nextActions.push(toBrief(c));
        }
      }

      // The live backlog the MD is "still chasing" (someday parked separately).
      const deferredCount =
        counts.open + counts.scheduled + counts.overdue + counts.blocked;

      return Object.freeze({
        tenantId,
        counts: Object.freeze(counts),
        somedayCount,
        deferredCount,
        nextDueAtMs,
        becameDueSince: Object.freeze(becameDue.slice(0, MAX_BRIEFS)),
        newSince: Object.freeze(fresh.slice(0, MAX_BRIEFS)),
        staleOverdue: Object.freeze(staleOverdue.slice(0, MAX_BRIEFS)),
        nextActions: Object.freeze(nextActions.slice(0, MAX_BRIEFS)),
      });
    },
  };
}
