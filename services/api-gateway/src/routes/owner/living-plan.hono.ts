/**
 * /api/v1/owner/living-plan — the owner-facing READ lens onto Mr. Mwikila's
 * durable living plan (the MD prospective-memory commitment ledger).
 *
 * This is the Notion×Asana "living plan" surface: the owner sees the same
 * durable backlog the reconcile sweep re-reads every tick, partitioned by the
 * GTD class the brain assigned and decorated with each commitment's trigger,
 * status, and proof-on-close.
 *
 * Routes (all tenant-scoped via JWT + RLS — read-only):
 *   GET /summary    health meter (open vs done ratio + overdue warning) + GTD partition counts
 *   GET /past       terminal closures (done) — the proof-carrying history
 *   GET /upcoming   live next-actions / waiting-for / tickler (the active plan)
 *   GET /overdue    live rows whose trigger fired and that slipped past it
 *   GET /deferred   the "someday" review queue (review-gated, invisible until resurfaced)
 *   GET /:id        one commitment by id (full detail)
 *
 * SEGREGATION (adversarial correction #5): the surface reads ONLY owner
 * COMMITMENTS, never capability-GAP rows (`gap_kind IS NULL`). `listLive`
 * already enforces this at the read boundary; the `/past` and detail paths add
 * the same `isNull(gapKind)` guard so a gap row can never leak into the owner's
 * plan view. `asc` is imported explicitly for the chronological ordering.
 *
 * The repository (MdCommitmentRepository) owns the durable store + the
 * service-role RLS bypass for the out-of-band reconcile worker; this route
 * builds a request-scoped Drizzle repository over the middleware `db` (every
 * read is explicitly tenant-scoped in SQL as defence in depth). A repository can
 * be INJECTED for tests.
 *
 * No `console.*` (pino logger only). Immutable response shaping. Honest empty
 * states — an empty plan is a first-class success, not an error.
 */

import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { createDrizzleMdCommitmentRepository } from '@borjie/database';
import type {
  MdCommitmentClass,
  MdCommitmentStatus,
} from '@borjie/database/schemas';
import type {
  MdCommitment,
  MdCommitmentRepository,
} from '@borjie/database/repositories';

import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('owner-living-plan');

/** A db handle that can run a raw `sql` query (the closed-history read). */
type DbExec = { execute: (q: unknown) => Promise<unknown> };

// ---------------------------------------------------------------------------
// Wire shape — the immutable view the owner surface renders. Carries BOTH
// language titles so the client can render strictly one per the active locale
// (the bilingual absolute-toggle is enforced on the CLIENT, never here).
// ---------------------------------------------------------------------------

interface LivingPlanItem {
  readonly id: string;
  readonly class: MdCommitmentClass;
  readonly kind: string;
  readonly title: string;
  readonly titleSw: string;
  readonly rationale: string;
  readonly status: MdCommitmentStatus;
  readonly sovereign: boolean;
  readonly triggerKind: MdCommitment['triggerKind'];
  /** The event/condition key the row waits on, when not a pure time trigger. */
  readonly triggerEventKey: string | null;
  /** ISO-8601 fire / fallback deadline (null for event/condition with no deadline). */
  readonly triggerDueAt: string | null;
  /** ISO-8601 positive-proof closure timestamp (null until done). */
  readonly confirmedAt: string | null;
  /** The proof kind that closed the row ('regulator_ack' | 'ledger_entry' | …). */
  readonly confirmationKind: string | null;
  readonly blockedReason: string | null;
  readonly evidenceIds: ReadonlyArray<string>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The live (non-terminal) statuses the active plan partitions span. */
const OVERDUE_STATUS: MdCommitmentStatus = 'overdue';

function isoOrNull(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

function toItem(c: MdCommitment): LivingPlanItem {
  return Object.freeze({
    id: c.id,
    class: c.class,
    kind: c.kind,
    title: c.title,
    titleSw: c.titleSw,
    rationale: c.rationale,
    status: c.status,
    sovereign: c.sovereign,
    triggerKind: c.triggerKind,
    triggerEventKey:
      typeof c.triggerSpec.eventKey === 'string' ? c.triggerSpec.eventKey : null,
    triggerDueAt: isoOrNull(c.triggerDueAtMs),
    confirmedAt: isoOrNull(c.confirmedAtMs),
    confirmationKind: c.confirmationKind,
    blockedReason: c.blockedReason,
    evidenceIds: c.evidenceIds,
    createdAt: new Date(c.createdAtMs).toISOString(),
    updatedAt: new Date(c.updatedAtMs).toISOString(),
  });
}

/**
 * GTD partition of the LIVE commitment set. `someday` is segregated into its own
 * `deferred` bucket (review-gated — invisible to the active plan until a review
 * resurfaces it). Overdue rows are lifted into their own bucket regardless of
 * class so the owner sees the warning surface first.
 */
interface LivePartition {
  readonly nextActions: ReadonlyArray<LivingPlanItem>;
  readonly waitingFor: ReadonlyArray<LivingPlanItem>;
  readonly tickler: ReadonlyArray<LivingPlanItem>;
  readonly someday: ReadonlyArray<LivingPlanItem>;
  readonly overdue: ReadonlyArray<LivingPlanItem>;
}

function partitionLive(items: ReadonlyArray<MdCommitment>): LivePartition {
  const nextActions: LivingPlanItem[] = [];
  const waitingFor: LivingPlanItem[] = [];
  const tickler: LivingPlanItem[] = [];
  const someday: LivingPlanItem[] = [];
  const overdue: LivingPlanItem[] = [];

  for (const c of items) {
    const item = toItem(c);
    if (c.status === OVERDUE_STATUS) {
      overdue.push(item);
      continue;
    }
    switch (c.class) {
      case 'next_action':
        nextActions.push(item);
        break;
      case 'waiting_for':
        waitingFor.push(item);
        break;
      case 'tickler':
        tickler.push(item);
        break;
      case 'someday':
        someday.push(item);
        break;
      default:
        nextActions.push(item);
    }
  }

  return Object.freeze({
    nextActions: Object.freeze(nextActions),
    waitingFor: Object.freeze(waitingFor),
    tickler: Object.freeze(tickler),
    someday: Object.freeze(someday),
    overdue: Object.freeze(overdue),
  });
}

/**
 * The plan HEALTH meter. `open` = live rows that are NOT someday (the active
 * commitments the owner is on the hook for); `done` = the closed history;
 * `overdue` is the warning count. `progress` is done / (open + done) — a calm
 * 0..1 ratio the surface renders as a meter; it is 1 (fully clear) when there is
 * no work at all, so an empty plan reads as "all clear", never as a 0% failure.
 */
interface PlanHealth {
  readonly open: number;
  readonly done: number;
  readonly overdue: number;
  readonly deferred: number;
  readonly blocked: number;
  /** 0..1 — done / (open + done); 1 when there is no work. */
  readonly progress: number;
  /** True when at least one live row is overdue (drives the warning surface). */
  readonly hasOverdueWarning: boolean;
}

function computeHealth(
  live: ReadonlyArray<MdCommitment>,
  doneCount: number,
): PlanHealth {
  let overdue = 0;
  let deferred = 0;
  let blocked = 0;
  let openNonSomeday = 0;

  for (const c of live) {
    if (c.class === 'someday') {
      deferred += 1;
      continue;
    }
    openNonSomeday += 1;
    if (c.status === 'overdue') overdue += 1;
    if (c.status === 'blocked') blocked += 1;
  }

  const denom = openNonSomeday + doneCount;
  const progress = denom === 0 ? 1 : doneCount / denom;

  return Object.freeze({
    open: openNonSomeday,
    done: doneCount,
    overdue,
    deferred,
    blocked,
    progress,
    hasOverdueWarning: overdue > 0,
  });
}

// ---------------------------------------------------------------------------
// Router factory — repository is injectable for tests; defaults to the real
// request-scoped Drizzle repository built over the middleware `db`.
// ---------------------------------------------------------------------------

export interface LivingPlanRouterDeps {
  /**
   * Optional repository override (tests). When absent the router builds a
   * request-scoped Drizzle repository over the middleware `db`.
   */
  readonly repository?: MdCommitmentRepository;
}

function dbUnavailable(c: { json: (b: unknown, s: number) => Response }) {
  return c.json(
    {
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database client is not initialized',
      },
    },
    503,
  );
}

function internalError(
  c: { json: (b: unknown, s: number) => Response },
  err: unknown,
): Response {
  moduleLogger.error('living-plan read failed', {
    error: err instanceof Error ? err.message : String(err),
  });
  return c.json(
    {
      success: false,
      error: {
        code: 'LIVING_PLAN_READ_FAILED',
        message: 'Could not read the living plan right now',
      },
    },
    500,
  );
}

export function createLivingPlanRouter(deps: LivingPlanRouterDeps = {}): Hono {
  const router = new Hono();
  router.use('*', authMiddleware);
  router.use('*', databaseMiddleware);

  /**
   * Resolve the repository for THIS request: the injected one (tests) or a
   * Drizzle repository over the request `db`. Returns null only when there is
   * no db AND no injected repo (→ 503).
   */
  function resolveRepo(db: unknown): MdCommitmentRepository | null {
    if (deps.repository) return deps.repository;
    if (!db) return null;
    return createDrizzleMdCommitmentRepository(
      db as Parameters<typeof createDrizzleMdCommitmentRepository>[0],
    );
  }

  /**
   * The closed-history read. The repository's `listLive` deliberately excludes
   * `done` rows, so the proof-carrying history is read directly here with the
   * SAME segregation guard (`gap_kind IS NULL`) the repository applies, newest
   * closure first. Read-only; explicitly tenant-scoped in SQL.
   */
  async function readDoneHistory(
    db: unknown,
    tenantId: string,
    limit: number,
  ): Promise<ReadonlyArray<MdCommitment>> {
    if (deps.repository && 'listDone' in deps.repository) {
      // An injected test repo may expose a listDone helper; honor it.
      return (
        deps.repository as MdCommitmentRepository & {
          listDone: (
            t: string,
            l: number,
          ) => Promise<ReadonlyArray<MdCommitment>>;
        }
      ).listDone(tenantId, limit);
    }
    if (!db) return [];
    const exec = db as DbExec;
    const repo = createDrizzleMdCommitmentRepository(
      db as Parameters<typeof createDrizzleMdCommitmentRepository>[0],
    );
    // Select the ids done for this tenant (newest closure first; `asc` createdAt
    // is the stable tiebreak), then re-read each row through the repository's
    // get() so it maps via the canonical rowToCommitment projection + the
    // service-role GUC. Segregation (#5): `gap_kind IS NULL` here too. Raw SQL
    // (not the Drizzle query builder) so the column types stay decoupled from the
    // repository's internal Drizzle instance.
    const result = await exec.execute(sql`
      SELECT id
        FROM md_commitments
       WHERE tenant_id = ${tenantId}
         AND gap_kind IS NULL
         AND status = 'done'
       ORDER BY confirmed_at DESC, created_at ASC
       LIMIT ${limit}
    `);
    const rows = Array.isArray(result)
      ? (result as ReadonlyArray<{ id: string }>)
      : ((result as { rows?: ReadonlyArray<{ id: string }> }).rows ?? []);
    const out: MdCommitment[] = [];
    for (const r of rows) {
      const full = await repo.get(tenantId, r.id);
      if (full) out.push(full);
    }
    return out;
  }

  // ── GET /summary — the health meter + GTD partition counts ───────────────
  router.get('/summary', async (c) => {
    const auth = c.get('auth');
    const db = c.get('db');
    const repo = resolveRepo(db);
    if (!repo) return dbUnavailable(c);
    try {
      const live = await repo.listLive(auth.tenantId);
      const done = await readDoneHistory(db, auth.tenantId, 200);
      const partition = partitionLive(live);
      const health = computeHealth(live, done.length);
      return c.json({
        success: true,
        data: {
          health,
          counts: {
            nextActions: partition.nextActions.length,
            waitingFor: partition.waitingFor.length,
            tickler: partition.tickler.length,
            someday: partition.someday.length,
            overdue: partition.overdue.length,
            done: done.length,
          },
          /** Honest empty state — nothing live AND nothing closed yet. */
          empty: live.length === 0 && done.length === 0,
          nextDueAt: nextDueAt(live),
        },
      });
    } catch (err) {
      return internalError(c, err);
    }
  });

  // ── GET /upcoming — the active plan (next-actions / waiting-for / tickler) ─
  router.get('/upcoming', async (c) => {
    const auth = c.get('auth');
    const db = c.get('db');
    const repo = resolveRepo(db);
    if (!repo) return dbUnavailable(c);
    try {
      const live = await repo.listLive(auth.tenantId);
      const p = partitionLive(live);
      return c.json({
        success: true,
        data: {
          nextActions: p.nextActions,
          waitingFor: p.waitingFor,
          tickler: p.tickler,
          empty:
            p.nextActions.length === 0 &&
            p.waitingFor.length === 0 &&
            p.tickler.length === 0,
        },
      });
    } catch (err) {
      return internalError(c, err);
    }
  });

  // ── GET /overdue — live rows that slipped past their fired trigger ────────
  router.get('/overdue', async (c) => {
    const auth = c.get('auth');
    const db = c.get('db');
    const repo = resolveRepo(db);
    if (!repo) return dbUnavailable(c);
    try {
      const live = await repo.listLive(auth.tenantId);
      const overdue = partitionLive(live).overdue;
      return c.json({
        success: true,
        data: { overdue, empty: overdue.length === 0 },
      });
    } catch (err) {
      return internalError(c, err);
    }
  });

  // ── GET /deferred — the someday review queue (review-gated invisibility) ──
  router.get('/deferred', async (c) => {
    const auth = c.get('auth');
    const db = c.get('db');
    const repo = resolveRepo(db);
    if (!repo) return dbUnavailable(c);
    try {
      const live = await repo.listLive(auth.tenantId);
      const someday = partitionLive(live).someday;
      return c.json({
        success: true,
        data: { someday, empty: someday.length === 0 },
      });
    } catch (err) {
      return internalError(c, err);
    }
  });

  // ── GET /past — the proof-carrying closed history (newest first) ──────────
  router.get('/past', async (c) => {
    const auth = c.get('auth');
    const db = c.get('db');
    const repo = resolveRepo(db);
    if (!repo) return dbUnavailable(c);
    try {
      const done = await readDoneHistory(db, auth.tenantId, 200);
      const items = done.map(toItem);
      return c.json({
        success: true,
        data: { done: items, empty: items.length === 0 },
      });
    } catch (err) {
      return internalError(c, err);
    }
  });

  // ── GET /:id — one commitment by id (full detail) ────────────────────────
  router.get('/:id', async (c) => {
    const auth = c.get('auth');
    const db = c.get('db');
    const repo = resolveRepo(db);
    if (!repo) return dbUnavailable(c);
    const id = c.req.param('id');
    try {
      const found = await repo.get(auth.tenantId, id);
      // Segregation (#5): a capability-GAP row is never an owner-plan item.
      if (!found || found.gapKind !== null) {
        return c.json(
          {
            success: false,
            error: {
              code: 'COMMITMENT_NOT_FOUND',
              message: 'No such commitment in your plan',
            },
          },
          404,
        );
      }
      return c.json({ success: true, data: toItem(found) });
    } catch (err) {
      return internalError(c, err);
    }
  });

  return router;
}

/**
 * The earliest upcoming time-trigger fire across the live set (ISO-8601), so the
 * summary can say "next due …". Null when nothing has a future deadline. Someday
 * rows are excluded (review-gated). `asc`-ordered conceptually — computed as a
 * single min pass.
 */
function nextDueAt(live: ReadonlyArray<MdCommitment>): string | null {
  let earliest: number | null = null;
  for (const c of live) {
    if (c.class === 'someday') continue;
    if (c.triggerDueAtMs === null) continue;
    if (earliest === null || c.triggerDueAtMs < earliest) {
      earliest = c.triggerDueAtMs;
    }
  }
  return earliest === null ? null : new Date(earliest).toISOString();
}

/** Stable default-export the index seam mounts at /owner/living-plan. */
export const livingPlanRouter = createLivingPlanRouter();
