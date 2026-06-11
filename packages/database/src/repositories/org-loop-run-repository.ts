/**
 * OrgLoopRunRepository — the durable store port for the SELF-RUNNING-ORG SPINE
 * correlation identity (the join between an md_commitment and the mining_task it
 * spawned, plus each loop run's stage/status).
 *
 * Two implementations (the md-commitment-repository two-impl pattern):
 *   - createDrizzleOrgLoopRunRepository(db) — PROD. Every method runs inside
 *     `withServiceRoleContext` because the loop-economy cron / reconcile sweep
 *     advances loop runs OUT OF BAND (no request middleware binds the tenant
 *     GUC); the service-role bypass policy on org_loop_runs (migration 0341)
 *     permits the system path while RLS FORCE still isolates every request
 *     caller. Every read/write is explicitly tenant-scoped in SQL as defence in
 *     depth, so the service-role bypass never reaches across tenants by accident.
 *   - createInMemoryOrgLoopRunRepository() — TESTS. Same surface, a Map.
 *
 * The lifecycle is APPEND-DISCIPLINED via `advance`: a patch carries only the
 * fields a stage transition changes (stage / status / task join / chosen
 * employee / confidence / strategy), and every write stamps `updatedAt`. The
 * repository never mutates a caller's object — inputs are spread into fresh rows
 * and reads return frozen snapshots.
 *
 * A Postgres `numeric` round-trips through the driver as a string; `matchConfidence`
 * is converted to/from a JS number at this boundary so callers see a clean
 * `number | null`.
 *
 * No `console.*` (the database package uses silent degrade / the injected
 * logger). Immutable inputs; the repository never mutates a caller's object.
 */

import { and, eq, inArray } from 'drizzle-orm';

import { orgLoopRuns } from '../schemas/org-loop-runs.js';
import type {
  OrgLoopRunRow,
  OrgLoopRunStage,
  OrgLoopRunStatus,
} from '../schemas/org-loop-runs.js';
import type { DatabaseClient } from '../client.js';
import { withServiceRoleContext } from '../rls/with-tenant-context.js';

// ---------------------------------------------------------------------------
// Domain types — the immutable loop-run view the spine reads.
// ---------------------------------------------------------------------------

export interface OrgLoopRun {
  readonly id: string;
  readonly tenantId: string;
  readonly commitmentId: string;
  readonly loopKind: string;
  readonly stage: OrgLoopRunStage;
  readonly status: OrgLoopRunStatus;
  readonly driveId: string | null;
  readonly strategyJson: Record<string, unknown> | null;
  readonly chosenEmployeeId: string | null;
  readonly matchConfidence: number | null;
  readonly taskId: string | null;
  readonly sourceData: Record<string, unknown>;
  readonly evidenceIds: ReadonlyArray<string>;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

/** CREATE input — the shape a loop run is born from (detect → strategize). */
export interface CreateOrgLoopRunInput {
  readonly tenantId: string;
  /** The originating md_commitments.id this run closes (REQUIRED, the back-edge). */
  readonly commitmentId: string;
  /** WHICH universal loop (loop-economy LoopSpec id). Defaults gap_to_delegate. */
  readonly loopKind?: string;
  /** Initial stage-machine position. Defaults 'strategize'. */
  readonly stage?: OrgLoopRunStage;
  /** Initial honest status. Defaults 'open'. */
  readonly status?: OrgLoopRunStatus;
  readonly driveId?: string | null;
  readonly strategyJson?: Record<string, unknown> | null;
  readonly chosenEmployeeId?: string | null;
  readonly matchConfidence?: number | null;
  readonly taskId?: string | null;
  readonly sourceData?: Record<string, unknown>;
  /** Evidence-required hard rule: the evidence ids threaded from the commitment. */
  readonly evidenceIds?: ReadonlyArray<string>;
}

/** A stage advance — only the fields a transition changes. */
export interface AdvanceOrgLoopRunInput {
  readonly stage?: OrgLoopRunStage;
  readonly status?: OrgLoopRunStatus;
  readonly taskId?: string | null;
  readonly chosenEmployeeId?: string | null;
  readonly matchConfidence?: number | null;
  readonly strategyJson?: Record<string, unknown> | null;
}

export interface OrgLoopRunRepository {
  /** CREATE a loop run (the detect → strategize birth). */
  create(input: CreateOrgLoopRunInput): Promise<OrgLoopRun>;
  /** The close-the-loop edge: find the run a completed task belongs to. */
  findByTask(tenantId: string, taskId: string): Promise<OrgLoopRun | null>;
  /** The dispatcher's de-dupe / resume read: find a run by its commitment. */
  findByCommitment(
    tenantId: string,
    commitmentId: string,
  ): Promise<OrgLoopRun | null>;
  /** Advance a run's stage/status/joins (only the patched fields change). */
  advance(
    tenantId: string,
    id: string,
    patch: AdvanceOrgLoopRunInput,
  ): Promise<OrgLoopRun | null>;
  /** The cron's hot read: all open/active runs for a tenant. */
  listOpen(tenantId: string): Promise<ReadonlyArray<OrgLoopRun>>;
}

// ---------------------------------------------------------------------------
// Mapping + validation
// ---------------------------------------------------------------------------

/** The non-terminal statuses the cron re-reads each tick. */
const OPEN_STATUSES: ReadonlyArray<OrgLoopRunStatus> = ['open', 'active'];

/**
 * Is this create() landing in the open hot set? Migration 0342's partial
 * unique index (`org_loop_runs_open_commitment_uniq` on (tenant_id,
 * commitment_id) WHERE status IN ('open','active')) makes a concurrent
 * double-create structurally impossible — on conflict the loser ADOPTS the
 * already-open run instead of racing the dispatcher's SELECT-then-INSERT
 * de-dupe read.
 */
function isOpenStatus(status: OrgLoopRunStatus): boolean {
  return (OPEN_STATUSES as ReadonlyArray<string>).includes(status);
}

/**
 * Defence-in-depth tenant assert. Every method runs under the service-role RLS
 * BYPASS (the out-of-band cron has no request middleware to bind the tenant
 * GUC), so a missing/empty tenantId could otherwise become a silent
 * cross-tenant read or write. Asserting a non-empty tenantId at the top of
 * every method makes that structurally impossible.
 */
function assertTenant(tenantId: string, op: string): void {
  if (!tenantId) {
    throw new Error(`org-loop-run: ${op} requires a non-empty tenantId`);
  }
}

/** Validate a CREATE input before it becomes a durable row. Throws on a violation. */
function assertValidCreate(input: CreateOrgLoopRunInput): void {
  if (!input.tenantId) throw new Error('org-loop-run: tenantId required');
  if (!input.commitmentId) {
    throw new Error('org-loop-run: commitmentId required (the close-the-loop back-edge)');
  }
}

function ms(d: Date): number {
  return d.getTime();
}

/** A Postgres numeric round-trips as a string — parse to a clean number | null. */
function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function rowToLoopRun(row: OrgLoopRunRow): OrgLoopRun {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenantId,
    commitmentId: row.commitmentId,
    loopKind: row.loopKind,
    stage: row.stage,
    status: row.status,
    driveId: row.driveId ?? null,
    strategyJson: row.strategyJson
      ? Object.freeze({ ...row.strategyJson })
      : null,
    chosenEmployeeId: row.chosenEmployeeId ?? null,
    matchConfidence: toNumber(row.matchConfidence),
    taskId: row.taskId ?? null,
    sourceData: Object.freeze({ ...(row.sourceData ?? {}) }),
    evidenceIds: Object.freeze([...(row.evidenceIds ?? [])]),
    createdAtMs: ms(row.createdAt),
    updatedAtMs: ms(row.updatedAt),
  });
}

// ---------------------------------------------------------------------------
// Drizzle implementation (service-role; out-of-band cron safe)
// ---------------------------------------------------------------------------

export function createDrizzleOrgLoopRunRepository(
  db: DatabaseClient,
): OrgLoopRunRepository {
  async function findById(
    tx: DatabaseClient,
    tenantId: string,
    id: string,
  ): Promise<OrgLoopRun | null> {
    const rows = await tx
      .select()
      .from(orgLoopRuns)
      .where(and(eq(orgLoopRuns.tenantId, tenantId), eq(orgLoopRuns.id, id)))
      .limit(1);
    const row = rows[0];
    return row ? rowToLoopRun(row) : null;
  }

  return {
    async create(input) {
      assertTenant(input.tenantId, 'create');
      assertValidCreate(input);
      return withServiceRoleContext(db, async (tx) => {
        // ON CONFLICT DO NOTHING (no target) absorbs the 0342 partial-unique
        // race: when another tick already opened a run for this commitment
        // the insert is skipped and we ADOPT the existing open run below —
        // double-create is structurally impossible, never a thrown 23505.
        const inserted = await tx
          .insert(orgLoopRuns)
          .values({
            tenantId: input.tenantId,
            commitmentId: input.commitmentId,
            loopKind: input.loopKind ?? 'gap_to_delegate',
            stage: input.stage ?? 'strategize',
            status: input.status ?? 'open',
            driveId: input.driveId ?? null,
            strategyJson: input.strategyJson ?? null,
            chosenEmployeeId: input.chosenEmployeeId ?? null,
            // numeric column takes a string; null stays null.
            matchConfidence:
              input.matchConfidence === null ||
              input.matchConfidence === undefined
                ? null
                : String(input.matchConfidence),
            taskId: input.taskId ?? null,
            sourceData: input.sourceData ?? {},
            evidenceIds: input.evidenceIds ? [...input.evidenceIds] : [],
          })
          .onConflictDoNothing()
          .returning();
        const row = inserted[0];
        if (row) return rowToLoopRun(row);
        // Conflict path — fetch the open/active run that won the race.
        const existing = await tx
          .select()
          .from(orgLoopRuns)
          .where(
            and(
              eq(orgLoopRuns.tenantId, input.tenantId),
              eq(orgLoopRuns.commitmentId, input.commitmentId),
              inArray(orgLoopRuns.status, [...OPEN_STATUSES]),
            ),
          )
          .limit(1);
        const winner = existing[0];
        if (!winner) {
          throw new Error('org-loop-run: create failed (no row returned)');
        }
        return rowToLoopRun(winner);
      });
    },

    async findByTask(tenantId, taskId) {
      assertTenant(tenantId, 'findByTask');
      return withServiceRoleContext(db, async (tx) => {
        const rows = await tx
          .select()
          .from(orgLoopRuns)
          .where(
            and(
              eq(orgLoopRuns.tenantId, tenantId),
              eq(orgLoopRuns.taskId, taskId),
            ),
          )
          .limit(1);
        const row = rows[0];
        return row ? rowToLoopRun(row) : null;
      });
    },

    async findByCommitment(tenantId, commitmentId) {
      assertTenant(tenantId, 'findByCommitment');
      return withServiceRoleContext(db, async (tx) => {
        const rows = await tx
          .select()
          .from(orgLoopRuns)
          .where(
            and(
              eq(orgLoopRuns.tenantId, tenantId),
              eq(orgLoopRuns.commitmentId, commitmentId),
            ),
          )
          .limit(1);
        const row = rows[0];
        return row ? rowToLoopRun(row) : null;
      });
    },

    async advance(tenantId, id, patch) {
      assertTenant(tenantId, 'advance');
      return withServiceRoleContext(db, async (tx) => {
        await tx
          .update(orgLoopRuns)
          .set({
            ...(patch.stage !== undefined && { stage: patch.stage }),
            ...(patch.status !== undefined && { status: patch.status }),
            ...(patch.taskId !== undefined && { taskId: patch.taskId }),
            ...(patch.chosenEmployeeId !== undefined && {
              chosenEmployeeId: patch.chosenEmployeeId,
            }),
            ...(patch.matchConfidence !== undefined && {
              matchConfidence:
                patch.matchConfidence === null
                  ? null
                  : String(patch.matchConfidence),
            }),
            ...(patch.strategyJson !== undefined && {
              strategyJson: patch.strategyJson,
            }),
            updatedAt: new Date(),
          })
          .where(
            and(eq(orgLoopRuns.tenantId, tenantId), eq(orgLoopRuns.id, id)),
          );
        return findById(tx, tenantId, id);
      });
    },

    async listOpen(tenantId) {
      assertTenant(tenantId, 'listOpen');
      return withServiceRoleContext(db, async (tx) => {
        const rows = await tx
          .select()
          .from(orgLoopRuns)
          .where(
            and(
              eq(orgLoopRuns.tenantId, tenantId),
              inArray(orgLoopRuns.status, [...OPEN_STATUSES]),
            ),
          );
        return rows.map(rowToLoopRun);
      });
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory implementation (tests; same surface, a Map)
// ---------------------------------------------------------------------------

interface MemRow {
  id: string;
  tenantId: string;
  commitmentId: string;
  loopKind: string;
  stage: OrgLoopRunStage;
  status: OrgLoopRunStatus;
  driveId: string | null;
  strategyJson: Record<string, unknown> | null;
  chosenEmployeeId: string | null;
  matchConfidence: number | null;
  taskId: string | null;
  sourceData: Record<string, unknown>;
  evidenceIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

function memToLoopRun(r: MemRow): OrgLoopRun {
  return Object.freeze({
    id: r.id,
    tenantId: r.tenantId,
    commitmentId: r.commitmentId,
    loopKind: r.loopKind,
    stage: r.stage,
    status: r.status,
    driveId: r.driveId,
    strategyJson: r.strategyJson ? Object.freeze({ ...r.strategyJson }) : null,
    chosenEmployeeId: r.chosenEmployeeId,
    matchConfidence: r.matchConfidence,
    taskId: r.taskId,
    sourceData: Object.freeze({ ...r.sourceData }),
    evidenceIds: Object.freeze([...r.evidenceIds]),
    createdAtMs: r.createdAt.getTime(),
    updatedAtMs: r.updatedAt.getTime(),
  });
}

export function createInMemoryOrgLoopRunRepository(opts?: {
  readonly now?: () => number;
}): OrgLoopRunRepository {
  const now = opts?.now ?? (() => Date.now());
  const rows = new Map<string, MemRow>();
  let seq = 0;

  function key(tenantId: string, id: string): string {
    return `${tenantId}::${id}`;
  }

  return {
    async create(input) {
      assertTenant(input.tenantId, 'create');
      assertValidCreate(input);
      // Mirror the 0342 partial-unique adopt-the-winner semantics: at most ONE
      // open/active run per (tenant, commitment) — a second open create
      // returns the existing run instead of inserting a duplicate.
      if (isOpenStatus(input.status ?? 'open')) {
        for (const r of rows.values()) {
          if (
            r.tenantId === input.tenantId &&
            r.commitmentId === input.commitmentId &&
            isOpenStatus(r.status)
          ) {
            return memToLoopRun(r);
          }
        }
      }
      seq += 1;
      const ts = new Date(now());
      const row: MemRow = {
        id: `olr_${seq}_${ts.getTime()}`,
        tenantId: input.tenantId,
        commitmentId: input.commitmentId,
        loopKind: input.loopKind ?? 'gap_to_delegate',
        stage: input.stage ?? 'strategize',
        status: input.status ?? 'open',
        driveId: input.driveId ?? null,
        strategyJson: input.strategyJson ?? null,
        chosenEmployeeId: input.chosenEmployeeId ?? null,
        matchConfidence: input.matchConfidence ?? null,
        taskId: input.taskId ?? null,
        sourceData: input.sourceData ? { ...input.sourceData } : {},
        evidenceIds: input.evidenceIds ? [...input.evidenceIds] : [],
        createdAt: ts,
        updatedAt: ts,
      };
      rows.set(key(row.tenantId, row.id), row);
      return memToLoopRun(row);
    },

    async findByTask(tenantId, taskId) {
      assertTenant(tenantId, 'findByTask');
      for (const r of rows.values()) {
        if (r.tenantId === tenantId && r.taskId === taskId) {
          return memToLoopRun(r);
        }
      }
      return null;
    },

    async findByCommitment(tenantId, commitmentId) {
      assertTenant(tenantId, 'findByCommitment');
      for (const r of rows.values()) {
        if (r.tenantId === tenantId && r.commitmentId === commitmentId) {
          return memToLoopRun(r);
        }
      }
      return null;
    },

    async advance(tenantId, id, patch) {
      assertTenant(tenantId, 'advance');
      const r = rows.get(key(tenantId, id));
      if (!r) return null;
      // Immutable update: replace the stored row with a fresh object (no caller
      // object is mutated; the Map entry is swapped, not patched in place).
      const next: MemRow = {
        ...r,
        ...(patch.stage !== undefined && { stage: patch.stage }),
        ...(patch.status !== undefined && { status: patch.status }),
        ...(patch.taskId !== undefined && { taskId: patch.taskId }),
        ...(patch.chosenEmployeeId !== undefined && {
          chosenEmployeeId: patch.chosenEmployeeId,
        }),
        ...(patch.matchConfidence !== undefined && {
          matchConfidence: patch.matchConfidence,
        }),
        ...(patch.strategyJson !== undefined && {
          strategyJson: patch.strategyJson,
        }),
        updatedAt: new Date(now()),
      };
      rows.set(key(tenantId, id), next);
      return memToLoopRun(next);
    },

    async listOpen(tenantId) {
      assertTenant(tenantId, 'listOpen');
      return [...rows.values()]
        .filter(
          (r) =>
            r.tenantId === tenantId &&
            (OPEN_STATUSES as ReadonlyArray<string>).includes(r.status),
        )
        .map(memToLoopRun);
    },
  };
}
