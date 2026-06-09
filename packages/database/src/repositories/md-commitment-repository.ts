/**
 * MdCommitmentRepository — the durable store port for the MD DEFERRAL /
 * FOLLOW-THROUGH commitment ledger (prospective memory + the closed loop).
 *
 * Two implementations (the work-cycle StateRepository two-impl pattern):
 *   - createDrizzleMdCommitmentRepository(db) — PROD. Every method runs inside
 *     `withServiceRoleContext` because the EstateMind RECONCILE sweep runs
 *     OUT OF BAND (no request middleware binds the tenant GUC); the
 *     service-role bypass policy on md_commitments (migration 0321) permits the
 *     system path while RLS FORCE still isolates every request caller. Every
 *     read/write is explicitly tenant-scoped in SQL as defence in depth, so the
 *     service-role bypass never reaches across tenants by accident.
 *   - createInMemoryMdCommitmentRepository() — TESTS. Same surface, a Map.
 *
 * The lifecycle is APPEND-DISCIPLINED: status transitions go through the typed
 * `transition` / `confirm` / `reopen` / `block` methods, never a blind blob
 * overwrite, and `markDone` is honest — it REQUIRES a confirmation proof
 * (confirmedAt + confirmationKind) so the row can never claim `done` without
 * positive proof. `create` is idempotent on (tenantId, idempotencyKey): a
 * duplicate deferral returns the existing row rather than inserting a second.
 *
 * No `console.*` (the database package uses the injected logger / silent
 * degrade). Immutable inputs; the repository never mutates a caller's object.
 */

import { and, eq, inArray, lte, sql } from 'drizzle-orm';

import { mdCommitments } from '../schemas/md-commitments.schema.js';
import type {
  MdCommitmentClass,
  MdCommitmentStatus,
  MdCommitmentTriggerKind,
  MdCommitmentTriggerSpec,
  MdCommitmentRow,
} from '../schemas/md-commitments.schema.js';
import type { DatabaseClient } from '../client.js';
import { withServiceRoleContext } from '../rls/with-tenant-context.js';

// ---------------------------------------------------------------------------
// Domain types — the immutable commitment view the brain reads.
// ---------------------------------------------------------------------------

export interface MdCommitment {
  readonly id: string;
  readonly tenantId: string;
  readonly ownerId: string;
  readonly threadId: string | null;
  readonly class: MdCommitmentClass;
  readonly kind: string;
  readonly title: string;
  readonly titleSw: string;
  readonly rationale: string;
  readonly evidenceIds: ReadonlyArray<string>;
  readonly triggerKind: MdCommitmentTriggerKind;
  readonly triggerSpec: MdCommitmentTriggerSpec;
  readonly triggerDueAtMs: number | null;
  readonly status: MdCommitmentStatus;
  readonly rungLevel: number;
  readonly sovereign: boolean;
  readonly lastNudgedAtMs: number | null;
  readonly ackedAtMs: number | null;
  readonly confirmedAtMs: number | null;
  readonly confirmationKind: string | null;
  readonly blockedReason: string | null;
  readonly attemptCount: number;
  readonly auditChainHash: string | null;
  readonly idempotencyKey: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

/** DETECT input — the shape a commitment is born from (chat defer / drive / nudge). */
export interface CreateMdCommitmentInput {
  readonly tenantId: string;
  readonly ownerId?: string;
  readonly threadId?: string | null;
  readonly class: MdCommitmentClass;
  readonly kind?: string;
  readonly title: string;
  readonly titleSw: string;
  readonly rationale: string;
  /** Evidence-required hard rule — at least one evidence id. */
  readonly evidenceIds: ReadonlyArray<string>;
  readonly triggerKind: MdCommitmentTriggerKind;
  readonly triggerSpec: MdCommitmentTriggerSpec;
  /** ISO-8601 fire / fallback deadline. Time triggers MUST carry it. */
  readonly triggerDueAt?: string | null;
  readonly sovereign?: boolean;
  /** UNIQUE per (tenantId, idempotencyKey) — never double-create. */
  readonly idempotencyKey: string;
}

/** A status transition the reconcile sweep advances a commitment through. */
export interface TransitionInput {
  readonly status: MdCommitmentStatus;
  readonly rungLevel?: number;
  readonly attemptCount?: number;
  readonly lastNudgedAt?: Date | null;
  readonly auditChainHash?: string | null;
}

/** Positive-proof closure — the ONLY path to `done`. */
export interface ConfirmInput {
  /** Required proof — 'regulator_ack' | 'ledger_entry' | 'owner_approved' | ... */
  readonly confirmationKind: string;
  readonly auditChainHash?: string | null;
  readonly confirmedAt?: Date;
}

export interface MdCommitmentRepository {
  /** Idempotent DETECT write. Returns the existing row on an idempotency hit. */
  create(input: CreateMdCommitmentInput): Promise<MdCommitment>;
  /** Read one by id within a tenant. */
  get(tenantId: string, id: string): Promise<MdCommitment | null>;
  /**
   * The reconcile re-read: ALL live commitments for a tenant (status in the
   * live set). The brain re-reads this whole set each tick — never-drop-a-thread.
   */
  listLive(tenantId: string): Promise<ReadonlyArray<MdCommitment>>;
  /**
   * Time-trigger claim (the reminders-dispatch poll re-aimed): rows with a
   * time trigger whose due timestamp has passed and that are still waiting.
   * Used by the WaitFor time path.
   */
  listDueByTime(
    tenantId: string,
    nowMs: number,
  ): Promise<ReadonlyArray<MdCommitment>>;
  /**
   * Event-trigger lookup: waiting event commitments matching a fired eventKey
   * for a tenant. The WaitFor event subscriber flips these → overdue/scheduled.
   */
  listWaitingForEvent(
    tenantId: string,
    eventKey: string,
  ): Promise<ReadonlyArray<MdCommitment>>;
  /** Advance the lifecycle (status / rung / nudge stamp / attempt). */
  transition(
    tenantId: string,
    id: string,
    patch: TransitionInput,
  ): Promise<MdCommitment | null>;
  /** Record positive-proof acknowledgement of a surfaced rung. */
  ack(tenantId: string, id: string, at?: Date): Promise<MdCommitment | null>;
  /** Close ONLY on positive proof → status 'done' + confirmedAt + kind. */
  markDone(
    tenantId: string,
    id: string,
    proof: ConfirmInput,
  ): Promise<MdCommitment | null>;
  /** Re-open an unconfirmed commitment → status 'reopened' (never silently closes). */
  reopen(
    tenantId: string,
    id: string,
    auditChainHash?: string | null,
  ): Promise<MdCommitment | null>;
  /** Block a commitment with an honest reason (e.g. predicate blocked). */
  block(
    tenantId: string,
    id: string,
    reason: string,
  ): Promise<MdCommitment | null>;
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

const LIVE_STATUSES: ReadonlyArray<MdCommitmentStatus> = [
  'open',
  'scheduled',
  'overdue',
  'blocked',
  'reopened',
];

function ms(d: Date | null | undefined): number | null {
  return d ? d.getTime() : null;
}

function rowToCommitment(row: MdCommitmentRow): MdCommitment {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenantId,
    ownerId: row.ownerId,
    threadId: row.threadId ?? null,
    class: row.class,
    kind: row.kind,
    title: row.title,
    titleSw: row.titleSw,
    rationale: row.rationale,
    evidenceIds: Object.freeze([...(row.evidenceIds ?? [])]),
    triggerKind: row.triggerKind,
    triggerSpec: Object.freeze({ ...(row.triggerSpec ?? {}) }),
    triggerDueAtMs: ms(row.triggerDueAt),
    status: row.status,
    rungLevel: row.rungLevel,
    sovereign: row.sovereign,
    lastNudgedAtMs: ms(row.lastNudgedAt),
    ackedAtMs: ms(row.ackedAt),
    confirmedAtMs: ms(row.confirmedAt),
    confirmationKind: row.confirmationKind ?? null,
    blockedReason: row.blockedReason ?? null,
    attemptCount: row.attemptCount,
    auditChainHash: row.auditChainHash ?? null,
    idempotencyKey: row.idempotencyKey,
    createdAtMs: row.createdAt.getTime(),
    updatedAtMs: row.updatedAt.getTime(),
  });
}

/**
 * Validate a DETECT input before it becomes a durable row. Evidence-required
 * is enforced HERE so a deferral with an empty evidence chain is never created
 * (the Auditor rail at the row boundary). Throws on a violation.
 */
function assertValidCreate(input: CreateMdCommitmentInput): void {
  if (!input.tenantId) throw new Error('md-commitment: tenantId required');
  if (!input.title || !input.titleSw) {
    throw new Error('md-commitment: bilingual title (title + titleSw) required');
  }
  if (!input.rationale) throw new Error('md-commitment: rationale required');
  if (!input.evidenceIds || input.evidenceIds.length === 0) {
    throw new Error(
      'md-commitment: evidence-required — at least one evidence id',
    );
  }
  if (!input.idempotencyKey) {
    throw new Error('md-commitment: idempotencyKey required');
  }
  if (input.triggerKind === 'time' && !input.triggerDueAt) {
    throw new Error('md-commitment: a time trigger requires triggerDueAt');
  }
}

/** Initial status: a time trigger starts scheduled; event/condition start open. */
function initialStatus(kind: MdCommitmentTriggerKind): MdCommitmentStatus {
  return kind === 'time' ? 'scheduled' : 'open';
}

// ---------------------------------------------------------------------------
// Drizzle implementation (service-role; out-of-band reconcile worker safe)
// ---------------------------------------------------------------------------

export function createDrizzleMdCommitmentRepository(
  db: DatabaseClient,
): MdCommitmentRepository {
  async function findById(
    tx: DatabaseClient,
    tenantId: string,
    id: string,
  ): Promise<MdCommitment | null> {
    const rows = await tx
      .select()
      .from(mdCommitments)
      .where(and(eq(mdCommitments.tenantId, tenantId), eq(mdCommitments.id, id)))
      .limit(1);
    const row = rows[0];
    return row ? rowToCommitment(row) : null;
  }

  return {
    async create(input) {
      assertValidCreate(input);
      return withServiceRoleContext(db, async (tx) => {
        // Idempotency: an existing (tenant, key) row wins — never double-create.
        const existing = await tx
          .select()
          .from(mdCommitments)
          .where(
            and(
              eq(mdCommitments.tenantId, input.tenantId),
              eq(mdCommitments.idempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1);
        if (existing[0]) return rowToCommitment(existing[0]);

        const dueAt = input.triggerDueAt ? new Date(input.triggerDueAt) : null;
        const inserted = await tx
          .insert(mdCommitments)
          .values({
            tenantId: input.tenantId,
            ownerId: input.ownerId ?? 'mwikila',
            threadId: input.threadId ?? null,
            class: input.class,
            kind: input.kind ?? 'general',
            title: input.title,
            titleSw: input.titleSw,
            rationale: input.rationale,
            evidenceIds: [...input.evidenceIds],
            triggerKind: input.triggerKind,
            triggerSpec: input.triggerSpec,
            triggerDueAt: dueAt,
            status: initialStatus(input.triggerKind),
            sovereign: input.sovereign ?? false,
            idempotencyKey: input.idempotencyKey,
          })
          .onConflictDoNothing({
            target: [mdCommitments.tenantId, mdCommitments.idempotencyKey],
          })
          .returning();
        if (inserted[0]) return rowToCommitment(inserted[0]);
        // Lost the idempotency race — re-read the row the other writer inserted.
        const reread = await tx
          .select()
          .from(mdCommitments)
          .where(
            and(
              eq(mdCommitments.tenantId, input.tenantId),
              eq(mdCommitments.idempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1);
        if (reread[0]) return rowToCommitment(reread[0]);
        throw new Error('md-commitment: create failed (no row returned)');
      });
    },

    async get(tenantId, id) {
      return withServiceRoleContext(db, (tx) => findById(tx, tenantId, id));
    },

    async listLive(tenantId) {
      return withServiceRoleContext(db, async (tx) => {
        const rows = await tx
          .select()
          .from(mdCommitments)
          .where(
            and(
              eq(mdCommitments.tenantId, tenantId),
              inArray(mdCommitments.status, [...LIVE_STATUSES]),
            ),
          );
        return rows.map(rowToCommitment);
      });
    },

    async listDueByTime(tenantId, nowMs) {
      return withServiceRoleContext(db, async (tx) => {
        const rows = await tx
          .select()
          .from(mdCommitments)
          .where(
            and(
              eq(mdCommitments.tenantId, tenantId),
              eq(mdCommitments.triggerKind, 'time'),
              inArray(mdCommitments.status, ['open', 'scheduled']),
              lte(mdCommitments.triggerDueAt, new Date(nowMs)),
            ),
          );
        return rows.map(rowToCommitment);
      });
    },

    async listWaitingForEvent(tenantId, eventKey) {
      return withServiceRoleContext(db, async (tx) => {
        const rows = await tx
          .select()
          .from(mdCommitments)
          .where(
            and(
              eq(mdCommitments.tenantId, tenantId),
              eq(mdCommitments.triggerKind, 'event'),
              inArray(mdCommitments.status, ['open', 'scheduled']),
              sql`${mdCommitments.triggerSpec} ->> 'eventKey' = ${eventKey}`,
            ),
          );
        return rows.map(rowToCommitment);
      });
    },

    async transition(tenantId, id, patch) {
      return withServiceRoleContext(db, async (tx) => {
        await tx
          .update(mdCommitments)
          .set({
            status: patch.status,
            ...(patch.rungLevel !== undefined && { rungLevel: patch.rungLevel }),
            ...(patch.attemptCount !== undefined && {
              attemptCount: patch.attemptCount,
            }),
            ...(patch.lastNudgedAt !== undefined && {
              lastNudgedAt: patch.lastNudgedAt,
            }),
            ...(patch.auditChainHash !== undefined && {
              auditChainHash: patch.auditChainHash,
            }),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(mdCommitments.tenantId, tenantId),
              eq(mdCommitments.id, id),
            ),
          );
        return findById(tx, tenantId, id);
      });
    },

    async ack(tenantId, id, at) {
      return withServiceRoleContext(db, async (tx) => {
        await tx
          .update(mdCommitments)
          .set({ ackedAt: at ?? new Date(), updatedAt: new Date() })
          .where(
            and(eq(mdCommitments.tenantId, tenantId), eq(mdCommitments.id, id)),
          );
        return findById(tx, tenantId, id);
      });
    },

    async markDone(tenantId, id, proof) {
      if (!proof.confirmationKind) {
        // Honest closure: `done` is impossible without proof.
        throw new Error(
          'md-commitment: markDone requires a confirmationKind (positive proof)',
        );
      }
      return withServiceRoleContext(db, async (tx) => {
        await tx
          .update(mdCommitments)
          .set({
            status: 'done',
            confirmedAt: proof.confirmedAt ?? new Date(),
            confirmationKind: proof.confirmationKind,
            ...(proof.auditChainHash !== undefined && {
              auditChainHash: proof.auditChainHash,
            }),
            updatedAt: new Date(),
          })
          .where(
            and(eq(mdCommitments.tenantId, tenantId), eq(mdCommitments.id, id)),
          );
        return findById(tx, tenantId, id);
      });
    },

    async reopen(tenantId, id, auditChainHash) {
      return withServiceRoleContext(db, async (tx) => {
        await tx
          .update(mdCommitments)
          .set({
            status: 'reopened',
            confirmedAt: null,
            confirmationKind: null,
            ...(auditChainHash !== undefined && { auditChainHash }),
            updatedAt: new Date(),
          })
          .where(
            and(eq(mdCommitments.tenantId, tenantId), eq(mdCommitments.id, id)),
          );
        return findById(tx, tenantId, id);
      });
    },

    async block(tenantId, id, reason) {
      return withServiceRoleContext(db, async (tx) => {
        await tx
          .update(mdCommitments)
          .set({
            status: 'blocked',
            blockedReason: reason,
            updatedAt: new Date(),
          })
          .where(
            and(eq(mdCommitments.tenantId, tenantId), eq(mdCommitments.id, id)),
          );
        return findById(tx, tenantId, id);
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
  ownerId: string;
  threadId: string | null;
  class: MdCommitmentClass;
  kind: string;
  title: string;
  titleSw: string;
  rationale: string;
  evidenceIds: string[];
  triggerKind: MdCommitmentTriggerKind;
  triggerSpec: MdCommitmentTriggerSpec;
  triggerDueAt: Date | null;
  status: MdCommitmentStatus;
  rungLevel: number;
  sovereign: boolean;
  lastNudgedAt: Date | null;
  ackedAt: Date | null;
  confirmedAt: Date | null;
  confirmationKind: string | null;
  blockedReason: string | null;
  attemptCount: number;
  auditChainHash: string | null;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
}

function memToCommitment(r: MemRow): MdCommitment {
  return rowToCommitment({
    ...r,
    evidenceIds: r.evidenceIds,
  } as unknown as MdCommitmentRow);
}

export function createInMemoryMdCommitmentRepository(opts?: {
  readonly now?: () => number;
}): MdCommitmentRepository {
  const now = opts?.now ?? (() => Date.now());
  const rows = new Map<string, MemRow>();
  let seq = 0;

  function key(tenantId: string, id: string): string {
    return `${tenantId}::${id}`;
  }

  function findIdem(tenantId: string, idem: string): MemRow | undefined {
    for (const r of rows.values()) {
      if (r.tenantId === tenantId && r.idempotencyKey === idem) return r;
    }
    return undefined;
  }

  return {
    async create(input) {
      assertValidCreate(input);
      const dup = findIdem(input.tenantId, input.idempotencyKey);
      if (dup) return memToCommitment(dup);
      seq += 1;
      const ts = new Date(now());
      const row: MemRow = {
        id: `mdc_${seq}_${ts.getTime()}`,
        tenantId: input.tenantId,
        ownerId: input.ownerId ?? 'mwikila',
        threadId: input.threadId ?? null,
        class: input.class,
        kind: input.kind ?? 'general',
        title: input.title,
        titleSw: input.titleSw,
        rationale: input.rationale,
        evidenceIds: [...input.evidenceIds],
        triggerKind: input.triggerKind,
        triggerSpec: input.triggerSpec,
        triggerDueAt: input.triggerDueAt ? new Date(input.triggerDueAt) : null,
        status: initialStatus(input.triggerKind),
        rungLevel: 0,
        sovereign: input.sovereign ?? false,
        lastNudgedAt: null,
        ackedAt: null,
        confirmedAt: null,
        confirmationKind: null,
        blockedReason: null,
        attemptCount: 0,
        auditChainHash: null,
        idempotencyKey: input.idempotencyKey,
        createdAt: ts,
        updatedAt: ts,
      };
      rows.set(key(row.tenantId, row.id), row);
      return memToCommitment(row);
    },

    async get(tenantId, id) {
      const r = rows.get(key(tenantId, id));
      return r ? memToCommitment(r) : null;
    },

    async listLive(tenantId) {
      return [...rows.values()]
        .filter(
          (r) =>
            r.tenantId === tenantId &&
            (LIVE_STATUSES as ReadonlyArray<string>).includes(r.status),
        )
        .map(memToCommitment);
    },

    async listDueByTime(tenantId, nowMs) {
      return [...rows.values()]
        .filter(
          (r) =>
            r.tenantId === tenantId &&
            r.triggerKind === 'time' &&
            (r.status === 'open' || r.status === 'scheduled') &&
            r.triggerDueAt !== null &&
            r.triggerDueAt.getTime() <= nowMs,
        )
        .map(memToCommitment);
    },

    async listWaitingForEvent(tenantId, eventKey) {
      return [...rows.values()]
        .filter(
          (r) =>
            r.tenantId === tenantId &&
            r.triggerKind === 'event' &&
            (r.status === 'open' || r.status === 'scheduled') &&
            r.triggerSpec.eventKey === eventKey,
        )
        .map(memToCommitment);
    },

    async transition(tenantId, id, patch) {
      const r = rows.get(key(tenantId, id));
      if (!r) return null;
      r.status = patch.status;
      if (patch.rungLevel !== undefined) r.rungLevel = patch.rungLevel;
      if (patch.attemptCount !== undefined) r.attemptCount = patch.attemptCount;
      if (patch.lastNudgedAt !== undefined) r.lastNudgedAt = patch.lastNudgedAt;
      if (patch.auditChainHash !== undefined) {
        r.auditChainHash = patch.auditChainHash;
      }
      r.updatedAt = new Date(now());
      return memToCommitment(r);
    },

    async ack(tenantId, id, at) {
      const r = rows.get(key(tenantId, id));
      if (!r) return null;
      r.ackedAt = at ?? new Date(now());
      r.updatedAt = new Date(now());
      return memToCommitment(r);
    },

    async markDone(tenantId, id, proof) {
      if (!proof.confirmationKind) {
        throw new Error(
          'md-commitment: markDone requires a confirmationKind (positive proof)',
        );
      }
      const r = rows.get(key(tenantId, id));
      if (!r) return null;
      r.status = 'done';
      r.confirmedAt = proof.confirmedAt ?? new Date(now());
      r.confirmationKind = proof.confirmationKind;
      if (proof.auditChainHash !== undefined) {
        r.auditChainHash = proof.auditChainHash;
      }
      r.updatedAt = new Date(now());
      return memToCommitment(r);
    },

    async reopen(tenantId, id, auditChainHash) {
      const r = rows.get(key(tenantId, id));
      if (!r) return null;
      r.status = 'reopened';
      r.confirmedAt = null;
      r.confirmationKind = null;
      if (auditChainHash !== undefined) r.auditChainHash = auditChainHash;
      r.updatedAt = new Date(now());
      return memToCommitment(r);
    },

    async block(tenantId, id, reason) {
      const r = rows.get(key(tenantId, id));
      if (!r) return null;
      r.status = 'blocked';
      r.blockedReason = reason;
      r.updatedAt = new Date(now());
      return memToCommitment(r);
    },
  };
}
