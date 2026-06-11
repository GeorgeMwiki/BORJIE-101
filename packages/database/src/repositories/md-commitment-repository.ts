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

import { createHash } from 'node:crypto';

import { and, eq, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';

import { mdCommitments } from '../schemas/md-commitments.schema.js';
import type {
  MdCommitmentClass,
  MdCommitmentGapKind,
  MdCommitmentStatus,
  MdCommitmentTriggerKind,
  MdCommitmentTriggerSpec,
  MdUnblockTrigger,
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
  /** Reopened-attempt cap counter (0326) — dead-letters the gap at the cap. */
  readonly attemptFailedCount: number;
  /** Per-gap monotonic audit-chain ordinal (0326) — 0 at genesis, +1 per advance. */
  readonly gapAuditSeq: number;
  readonly auditChainHash: string | null;
  readonly idempotencyKey: string;
  // ── Capability Gap Register (migration 0326) ──────────────────────────
  /** null = ordinary commitment; else a typed capability/understanding gap. */
  readonly gapKind: MdCommitmentGapKind | null;
  /** DAG dependency edges — blocking commitment ids. */
  readonly blockedBy: ReadonlyArray<string>;
  /** The predicate that flips the gap to confident ({ kind, target }). */
  readonly unblockTrigger: MdUnblockTrigger | null;
  /** Jagged-frontier coordinate (licences | royalty | treasury | ...). */
  readonly competenceDomain: string | null;
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
  // ── Capability Gap Register (migration 0326) — optional on a base create ──
  /** null/omitted = ordinary commitment; else a typed capability gap. */
  readonly gapKind?: MdCommitmentGapKind | null;
  /** DAG dependency edges — blocking commitment ids. */
  readonly blockedBy?: ReadonlyArray<string>;
  /** The predicate that flips the gap to confident ({ kind, target }). */
  readonly unblockTrigger?: MdUnblockTrigger | null;
  /** Jagged-frontier coordinate (licences | royalty | treasury | ...). */
  readonly competenceDomain?: string | null;
}

/**
 * DETECT a capability gap — the metacognitive self-model write. A gap is born
 * at a typed impasse (a NOT_YET_WIRED organ hit, an empty evidence chain, a
 * sovereign-without-approval) and is the SAME suspended-goal shape as a
 * commitment, with the gap discriminators set. The repository derives the GTD
 * `class` + `triggerKind`/`triggerSpec` from the unblock trigger so the row
 * fits the existing reconcile sweep with zero special-casing.
 */
export interface CreateGapInput {
  readonly tenantId: string;
  readonly ownerId?: string;
  readonly threadId?: string | null;
  /** The typed gap kind — REQUIRED for a gap (never null on this path). */
  readonly gapKind: MdCommitmentGapKind;
  /** Domain verb describing the intent that was blocked. */
  readonly kind?: string;
  readonly title: string;
  readonly titleSw: string;
  readonly rationale: string;
  /** Evidence-required hard rule — at least one evidence id. */
  readonly evidenceIds: ReadonlyArray<string>;
  /** The predicate that flips the gap to confident. REQUIRED for a gap. */
  readonly unblockTrigger: MdUnblockTrigger;
  /** Blocking commitment ids (DAG edges). Empty for a leaf gap. */
  readonly blockedBy?: ReadonlyArray<string>;
  readonly competenceDomain?: string | null;
  /** Sovereign gaps never auto-actuate — they park on a human signal forever. */
  readonly sovereign?: boolean;
  /** UNIQUE per (tenantId, idempotencyKey) — never double-create a gap. */
  readonly idempotencyKey: string;
}

/**
 * Atomically advance a gap's lifecycle with a hash-chained audit stitch. The
 * caller computes the next status (e.g. blocked → scheduled on unblock,
 * scheduled → done on verifier pass) and supplies the prior chain hash; the
 * repository stitches the new audit_chain_hash append-only and writes both in
 * one update so the chain can never fork.
 */
export interface AdvanceGapStatusInput {
  /** The next lifecycle status. */
  readonly status: MdCommitmentStatus;
  /** Why the gap advanced — stitched into the audit-chain body. */
  readonly reason: string;
  /**
   * The positive-proof confirmation kind. REQUIRED + non-empty when
   * status === 'done' — supplied by the EXTERNAL verifier (the Auditor). There
   * is NO hardcoded default: a gap can never self-grade to `done`.
   */
  readonly confirmationKind?: string | null;
  /** Optional honest blocked reason (only when status === 'blocked'). */
  readonly blockedReason?: string | null;
}

/**
 * Append-only audit sink port (FIX 5). Each gap status advance persists a row
 * in the tamper-evident, hash-chained `ai_audit_chain` (the existing
 * onboarding-style `appendAudit`), not merely the overwritten head-hash column.
 * The head hash stays as a convenience pointer; the verifiable chain is the
 * append-only log that replays independently. Best-effort + never throws — an
 * audit-sink fault must not abort the durable status advance (the advance is
 * the load-bearing write; the chain row is the forensic mirror).
 */
export interface GapAuditAppendPort {
  append(entry: {
    readonly tenantId: string;
    readonly gapId: string;
    /** The transition recorded, e.g. 'gap:blocked->scheduled'. */
    readonly transition: string;
    readonly sovereign: boolean;
    /** The append-only head hash this advance stitched (chain convenience). */
    readonly chainHash: string;
    readonly occurredAtMs: number;
    // ── FIX 5 — REPLAYABLE inputs ──────────────────────────────────────────
    // The appended log alone must INDEPENDENTLY recompute + verify the chain
    // without the live row. `chainHash` is computed as
    // sha256(previousHash || gapId || status || reason || isoTs); persisting the
    // EXACT inputs (status, reason, previousHash, recordedAtMs) lets a verifier
    // re-derive each head hash from the log and confirm it links to the prior.
    /** The post-advance status the head hash was stitched over. */
    readonly status: MdCommitmentStatus;
    /** The reason string the head hash was stitched over. */
    readonly reason: string;
    /** The PRIOR head hash this advance chained from (null at genesis). */
    readonly previousHash: string | null;
    /**
     * Per-gap MONOTONIC sequence number (FIX 3b), 0 at genesis and +1 each
     * advance. Persisting it lets replay detect a TRUNCATED or INSERTED chain:
     * a sound log must present a gapless 0..N run. (The audit table's own
     * `sequence_id` is per-tenant; this is the per-GAP ordinal the replay needs.)
     */
    readonly sequence: number;
  }): Promise<void>;
}

/** Statuses a gap may legally advance to `done` FROM (FIX 1 from-guard). */
const GAP_DONE_FROM_STATUSES: ReadonlySet<MdCommitmentStatus> = new Set([
  'scheduled',
]);

/**
 * Reopened-attempt cap (FIX 4). After this many reopened auto-completion
 * attempts the gap is dead-lettered (TERMINAL, out of the live set) so the
 * auto-completer can never re-fire + re-verify it forever.
 */
const GAP_MAX_REOPEN_ATTEMPTS = 3;

/** TERMINAL gap statuses — excluded from the watcher live set + listOpenGaps. */
export const TERMINAL_GAP_STATUSES: ReadonlyArray<MdCommitmentStatus> = [
  'done',
  'needs_approval',
  'dead_letter',
];

/**
 * True when a gap status is TERMINAL (done / needs_approval / dead_letter) and
 * therefore OUT of the watcher live set. The composition root + tests use this
 * to assert a parked / dead-lettered / completed gap no longer re-fires.
 */
export function isTerminalGapStatus(status: MdCommitmentStatus): boolean {
  return TERMINAL_GAP_STATUSES.includes(status);
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
  // ── Capability Gap Register (migration 0326) ────────────────────────────
  /**
   * DETECT a capability gap. Idempotent on (tenantId, idempotencyKey) like
   * `create`. The gap is born `blocked` (it cannot proceed until its trigger
   * clears) with the typed gap discriminators + unblock trigger persisted, so
   * the watcher can re-probe it durably.
   */
  createGap(input: CreateGapInput): Promise<MdCommitment>;
  /**
   * The watcher's hot read: all OPEN/BLOCKED capability gaps for a tenant
   * (non-null gap_kind, live status). The GapRegistryWatcher re-probes each
   * one's unblock trigger against the live capability snapshot every tick.
   */
  listOpenGaps(tenantId: string): Promise<ReadonlyArray<MdCommitment>>;
  /**
   * Atomically advance a gap's status WITH a hash-chained audit append. Reads
   * the prior chain hash, stitches the next hash over
   * (prev || id || status || reason || ts), and writes status + hash in one
   * update. Append-only: the prior hash is never mutated. Returns the advanced
   * row (or null when the id is unknown / not a gap).
   *
   * Hardening invariants (the gap register self-tests prove each):
   *   - to `done` REQUIRES a non-empty `confirmationKind` (THROWS if absent —
   *     no self-grade, no hardcoded default) and is reachable ONLY from the
   *     `scheduled` state the auto-completer uses (THROWS from any other state);
   *   - a `reopened` advance increments the attempt cap; at the cap it is
   *     rewritten to the TERMINAL `dead_letter` (out of the live set);
   *   - an advance whose requested status + blockedReason already equal the
   *     current row is a NO-OP — the row is returned unchanged (no hash bump,
   *     no audit append) so a per-tick re-fire never storms the audit chain.
   */
  advanceGapStatus(
    tenantId: string,
    id: string,
    patch: AdvanceGapStatusInput,
  ): Promise<MdCommitment | null>;
}

// ---------------------------------------------------------------------------
// Audit-chain hash (append-only stitch) — mirrors workflow-engine hash-chain.
// ---------------------------------------------------------------------------

/**
 * Genesis-pin salt (FIX 3a). The FIRST gap-audit hash is stitched not over a
 * shared literal but over a PER-GAP seed so a forged chain cannot start fresh for
 * a different/new gap (a forge-from-scratch would have to know + reproduce this
 * exact seed for the real gapId + tenantId). A constant, not a secret: the
 * tamper-evidence is the chained derivation, the seed only binds the genesis to a
 * specific (gapId, tenantId).
 */
const GAP_GENESIS_SALT = 'borjie:md-gap:genesis:v1';

/**
 * The per-gap genesis seed (FIX 3a) = sha256(gapId || tenantId || GENESIS_SALT).
 * The genesis advance stitches its head hash over THIS seed (in place of the old
 * shared literal), and replay rejects any chain whose genesis does not derive
 * from the recomputed seed for the same (gapId, tenantId).
 */
export function gapGenesisSeed(gapId: string, tenantId: string): string {
  return createHash('sha256')
    .update(`${gapId} ${tenantId} ${GAP_GENESIS_SALT}`)
    .digest('hex');
}

/**
 * Stitch the next append-only audit-chain hash for a gap status advance.
 * current = sha256(previous || id || status || reason || isoTs). Changing any
 * prior advance invalidates every later hash (tamper-evident). At genesis
 * (`previousHash === null`) the hash is stitched over the per-gap `genesisSeed`
 * (FIX 3a) so a forged-from-scratch chain cannot start fresh for a new gap.
 */
function stitchGapHash(args: {
  readonly previousHash: string | null;
  readonly genesisSeed: string;
  readonly id: string;
  readonly status: MdCommitmentStatus;
  readonly reason: string;
  readonly atIso: string;
}): string {
  const body = JSON.stringify({
    previousHash: args.previousHash ?? args.genesisSeed,
    id: args.id,
    status: args.status,
    reason: args.reason,
    recordedAt: args.atIso,
  });
  return createHash('sha256').update(body).digest('hex');
}

/**
 * One appended gap-audit log entry, projected onto the fields needed to REPLAY
 * the hash chain (FIX 5). This is exactly the replayable subset of the
 * `GapAuditAppendPort.append` entry — the persisted log carries these, so the
 * chain re-derives WITHOUT the live row.
 */
export interface ReplayableGapAuditEntry {
  readonly gapId: string;
  readonly status: MdCommitmentStatus;
  readonly reason: string;
  readonly previousHash: string | null;
  readonly chainHash: string;
  readonly occurredAtMs: number;
  /** Per-gap monotonic sequence number (FIX 3b) — 0 at genesis, +1 each step. */
  readonly sequence: number;
}

/** The verdict of an independent gap-audit chain replay (FIX 5). */
export interface GapAuditReplayResult {
  readonly ok: boolean;
  /** Index of the first entry that failed to verify (−1 when the chain is sound). */
  readonly brokenAtIndex: number;
  /** Human-readable reason on failure (empty when sound). */
  readonly reason: string;
}

/**
 * The cross-check inputs replay needs ON TOP of the entry list (FIX 3). Without
 * these a replay only proves INTERNAL consistency — a forged-from-scratch chain
 * and a genesis-truncated chain both pass. With them, replay PINS the genesis to
 * a per-gap seed and CROSS-CHECKS the replayed terminal head against the live row.
 */
export interface GapAuditReplayContext {
  /** The gap id the log belongs to — used to recompute the genesis seed. */
  readonly gapId: string;
  /** The tenant the gap belongs to — folded into the genesis seed. */
  readonly tenantId: string;
  /**
   * The live `md_commitments.audit_chain_hash` head (FIX 3c). The replayed
   * terminal head MUST equal this, else the log does not describe the live row
   * (a forged log that does not match the live row fails). `null` only for a gap
   * that has never advanced (an empty log).
   */
  readonly expectedTerminalHead: string | null;
}

/**
 * Independently replay + verify a gap's append-only audit chain from the LOG
 * ALONE (FIX 5) AND prove it is tamper-evident against forge/truncate (FIX 3).
 *
 * For each entry the head hash is re-derived from the persisted inputs
 * (previousHash || gapId || status || reason || isoTs, genesis stitched over the
 * per-gap seed) and compared to the stored `chainHash`; consecutive entries must
 * link (entry N's `previousHash` equals entry N−1's `chainHash`). On TOP of that
 * internal check (FIX 3):
 *   (a) GENESIS PIN — entry 0's `previousHash` must be null and its head must
 *       derive from `sha256(gapId || tenantId || GENESIS_SALT)`, so a forged
 *       chain cannot start fresh for a different/new gap.
 *   (b) MONOTONIC SEQUENCE — `sequence` must be a gapless 0..N run (reject a
 *       truncated or inserted chain).
 *   (c) LIVE-HEAD CROSS-CHECK — the replayed terminal head must equal the live
 *       `expectedTerminalHead` (reject a forged log that does not match the row).
 * Pure: no IO, no live-row dependency beyond the supplied `expectedTerminalHead`.
 */
export function replayGapAuditChain(
  entries: ReadonlyArray<ReplayableGapAuditEntry>,
  context: GapAuditReplayContext,
): GapAuditReplayResult {
  const genesisSeed = gapGenesisSeed(context.gapId, context.tenantId);

  // FIX 3c — an empty log is sound ONLY if the live row has no head either.
  if (entries.length === 0) {
    if (context.expectedTerminalHead === null) {
      return { ok: true, brokenAtIndex: -1, reason: '' };
    }
    return {
      ok: false,
      brokenAtIndex: 0,
      reason:
        'live-head mismatch: empty log but the live row carries a terminal head',
    };
  }

  let prior: string | null = null;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;

    // FIX 3a — every entry must belong to the SAME gap the context pins.
    if (entry.gapId !== context.gapId) {
      return {
        ok: false,
        brokenAtIndex: i,
        reason: `gap mismatch: entry ${i} gapId does not match the replay context`,
      };
    }

    // FIX 3b — MONOTONIC sequence: a gapless 0..N run. A truncated head (first
    // sequence != 0) or an inserted/dropped entry (gap in the run) is rejected.
    if (entry.sequence !== i) {
      return {
        ok: false,
        brokenAtIndex: i,
        reason: `sequence break: entry ${i} sequence=${entry.sequence} (expected ${i})`,
      };
    }

    if (i === 0) {
      // FIX 3a — GENESIS PIN: the first entry must chain from genesis (null prior)
      // and its head must derive from the per-gap seed. A forge-from-scratch chain
      // for a different/new gap cannot reproduce this seed.
      if (entry.previousHash !== null) {
        return {
          ok: false,
          brokenAtIndex: 0,
          reason: 'genesis break: first entry previousHash is not null',
        };
      }
      const recomputedGenesis = stitchGapHash({
        previousHash: null,
        genesisSeed,
        id: entry.gapId,
        status: entry.status,
        reason: entry.reason,
        atIso: new Date(entry.occurredAtMs).toISOString(),
      });
      if (recomputedGenesis !== entry.chainHash) {
        return {
          ok: false,
          brokenAtIndex: 0,
          reason:
            'genesis pin mismatch: first head does not derive from the per-gap seed',
        };
      }
      prior = entry.chainHash;
      continue;
    }

    // The chain must link: this entry's previousHash equals the prior head.
    if (entry.previousHash !== prior) {
      return {
        ok: false,
        brokenAtIndex: i,
        reason: `chain break: entry ${i} previousHash does not link to prior head`,
      };
    }
    const recomputed = stitchGapHash({
      previousHash: entry.previousHash,
      genesisSeed,
      id: entry.gapId,
      status: entry.status,
      reason: entry.reason,
      atIso: new Date(entry.occurredAtMs).toISOString(),
    });
    if (recomputed !== entry.chainHash) {
      return {
        ok: false,
        brokenAtIndex: i,
        reason: `hash mismatch: entry ${i} recomputed head != stored chainHash`,
      };
    }
    prior = entry.chainHash;
  }

  // FIX 3c — LIVE-HEAD CROSS-CHECK: the replayed terminal head must equal the
  // live md_commitments.audit_chain_hash. A forged log that does not describe the
  // live row fails here even if it is internally consistent.
  if (prior !== context.expectedTerminalHead) {
    return {
      ok: false,
      brokenAtIndex: entries.length - 1,
      reason:
        'live-head mismatch: replayed terminal head != live audit_chain_hash',
    };
  }

  return { ok: true, brokenAtIndex: -1, reason: '' };
}

/**
 * The current gap state the advance is computed against. Just the fields the
 * advance planner needs — keeps the planner pure + shared across both impls.
 */
interface GapAdvanceCurrent {
  readonly status: MdCommitmentStatus;
  readonly blockedReason: string | null;
  readonly attemptFailedCount: number;
}

/** The planned effect of one `advanceGapStatus` call (pure; no IO). */
type GapAdvancePlan =
  | { readonly kind: 'noop' } // FIX 6 — requested state == current state.
  | {
      readonly kind: 'advance';
      readonly status: MdCommitmentStatus;
      readonly blockedReason: string | null;
      readonly attemptFailedCount: number;
      /** Stamp confirmedAt + confirmationKind only on a `done` advance. */
      readonly confirmationKind: string | null;
    };

/**
 * The from-states a REAL verify-failure transitions OUT of (FIX 4). The
 * verifier-gated auto-completer always `schedule`s a gap (→ `scheduled`) before
 * it re-attempts + verifies, so a genuine logical verify-FAILURE arrives as a
 * `scheduled → reopened` transition. A `reopened` request whose current status
 * is anything else (already `reopened`, or a stale/duplicate re-fire) is NOT a
 * fresh logical failure and must NOT bump the cap counter — that is the
 * duplicate-reopened de-dupe.
 */
const GAP_REOPEN_COUNTS_FROM: ReadonlySet<MdCommitmentStatus> = new Set([
  'scheduled',
  'overdue',
]);

/**
 * Normalize a blocked-reason for the settled-state compare (FIX 6). A re-park /
 * re-advance that carries a cosmetically-varying reason (trailing whitespace,
 * collapsed internal spacing, case) must still fold into the same SETTLED state
 * so it stays a no-op. Pure: trims, lowercases, and collapses internal runs of
 * whitespace. `null` stays `null` (no reason vs a reason are distinct states).
 */
function normalizeBlockedReason(reason: string | null): string | null {
  if (reason === null) return null;
  return reason.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * True when the requested status + (normalized) blockedReason already equal the
 * current SETTLED state (FIX 6) — the advance is then a no-op. Folds a re-park
 * with a cosmetically-different reason into the same state so it does not storm.
 */
function isSettledNoOp(
  current: GapAdvanceCurrent,
  status: MdCommitmentStatus,
  blockedReason: string | null,
): boolean {
  return (
    status === current.status &&
    normalizeBlockedReason(blockedReason) ===
      normalizeBlockedReason(current.blockedReason)
  );
}

/**
 * Compute the effect of an `advanceGapStatus` request against the current row —
 * the single place the hardening invariants live so both the Drizzle and
 * in-memory twins behave identically:
 *
 *   FIX 2  if the gap is already TERMINAL (done | dead_letter | needs_approval)
 *          the advance is a NO-OP — BEFORE the reopened/attempt-count branch — so
 *          a terminal gap can NEVER advance / append / re-count again (closes the
 *          dead-letter audit storm AND the needs_approval re-park hazard).
 *   FIX 1  `done` REQUIRES a non-empty confirmationKind (THROW if absent) and is
 *          reachable ONLY from the scheduled state the auto-completer uses — no
 *          self-grade, no hardcoded default, no arbitrary from-state.
 *   FIX 4  a `reopened` advance increments attempt_failed_count ONLY when it is a
 *          DISTINCT logical verify-FAILURE (prior status in the counting set); a
 *          duplicate reopened request does NOT double-count. At the cap the gap
 *          dead-letters (TERMINAL, out of the live set).
 *   FIX 6  when the requested status + NORMALIZED blockedReason already equal the
 *          current row state the advance is a NO-OP (no hash bump, no audit
 *          append) — even when the reason varies cosmetically.
 */
function planGapAdvance(
  current: GapAdvanceCurrent,
  patch: AdvanceGapStatusInput,
): GapAdvancePlan {
  // FIX 2 — TERMINAL short-circuit FIRST. A gap that has reached a terminal
  // status (done | dead_letter | needs_approval) is settled forever: no status
  // advance, no attempt-count bump, no audit append. This runs BEFORE the
  // reopened branch so a per-tick re-clear of a parked/dead-lettered gap can
  // never re-count toward the cap or storm the audit chain, and a re-park of a
  // needs_approval gap is structurally a no-op.
  if (isTerminalGapStatus(current.status)) {
    return { kind: 'noop' };
  }

  // FIX 1 — honest `done`: an explicit, non-empty, externally-supplied
  // confirmation kind is mandatory. There is NO default; a gap can never
  // self-grade to done. Reachable only from the scheduled set the completer
  // uses (not from blocked/open/reopened/terminal).
  if (patch.status === 'done') {
    if (!patch.confirmationKind || patch.confirmationKind.trim() === '') {
      throw new Error(
        'md-gap: advanceGapStatus to `done` requires a non-empty confirmationKind ' +
          '(external verifier proof) — no self-grade, no default',
      );
    }
    if (!GAP_DONE_FROM_STATUSES.has(current.status)) {
      throw new Error(
        `md-gap: advanceGapStatus to \`done\` is only reachable from ` +
          `[${[...GAP_DONE_FROM_STATUSES].join(', ')}] — current status is ` +
          `\`${current.status}\` (the auto-completer schedules before completing)`,
      );
    }
  }

  // FIX 4 — reopened-attempt cap counts DISTINCT logical verify-FAILURES, not
  // raw reopened CALLS. A genuine failure transitions out of the counting set
  // (`scheduled`/`overdue`); a duplicate reopened request (already `reopened`)
  // is folded to a no-op so it can never double-count toward dead_letter.
  if (patch.status === 'reopened') {
    const isDistinctFailure = GAP_REOPEN_COUNTS_FROM.has(current.status);
    if (!isDistinctFailure) {
      // A duplicate / non-failure reopened request. If the settled state already
      // matches it is a pure no-op; otherwise re-assert `reopened` WITHOUT
      // bumping the cap counter (no double-count).
      if (
        isSettledNoOp(
          current,
          'reopened',
          patch.blockedReason ?? current.blockedReason,
        )
      ) {
        return { kind: 'noop' };
      }
      return {
        kind: 'advance',
        status: 'reopened',
        blockedReason: patch.blockedReason ?? current.blockedReason,
        attemptFailedCount: current.attemptFailedCount,
        confirmationKind: null,
      };
    }
    const nextFailed = current.attemptFailedCount + 1;
    if (nextFailed >= GAP_MAX_REOPEN_ATTEMPTS) {
      const blockedReason =
        patch.blockedReason ??
        `dead_letter: ${nextFailed} reopened attempts exhausted — human triage required`;
      return {
        kind: 'advance',
        status: 'dead_letter',
        blockedReason,
        attemptFailedCount: nextFailed,
        confirmationKind: null,
      };
    }
    return {
      kind: 'advance',
      status: 'reopened',
      blockedReason: patch.blockedReason ?? current.blockedReason,
      attemptFailedCount: nextFailed,
      confirmationKind: null,
    };
  }

  // FIX 6 — no-op short-circuit: requested status + NORMALIZED blockedReason
  // already match the settled state (a cosmetically-varying re-advance folds in).
  const nextBlockedReason =
    patch.blockedReason !== undefined
      ? patch.blockedReason
      : current.blockedReason;
  if (isSettledNoOp(current, patch.status, nextBlockedReason)) {
    return { kind: 'noop' };
  }

  return {
    kind: 'advance',
    status: patch.status,
    blockedReason: nextBlockedReason,
    attemptFailedCount: current.attemptFailedCount,
    confirmationKind: patch.status === 'done' ? patch.confirmationKind! : null,
  };
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

/**
 * Defence-in-depth tenant assert (FIX 7). Every gap/commitment repo method runs
 * under the service-role RLS BYPASS (the out-of-band reconcile worker has no
 * request middleware to bind the tenant GUC), so a missing/empty tenantId could
 * otherwise become a silent cross-tenant read or clear. Asserting a non-empty
 * tenantId at the top of every method makes that structurally impossible.
 */
function assertTenant(tenantId: string, op: string): void {
  if (!tenantId) {
    throw new Error(`md-commitment: ${op} requires a non-empty tenantId`);
  }
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
    attemptFailedCount: row.attemptFailedCount ?? 0,
    gapAuditSeq: row.gapAuditSeq ?? 0,
    auditChainHash: row.auditChainHash ?? null,
    idempotencyKey: row.idempotencyKey,
    gapKind: row.gapKind ?? null,
    blockedBy: Object.freeze([...(row.blockedBy ?? [])]),
    unblockTrigger: row.unblockTrigger
      ? Object.freeze({ ...row.unblockTrigger })
      : null,
    competenceDomain: row.competenceDomain ?? null,
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

/** A gap's blocker maps onto the event trigger family (it fires on a signal). */
const GAP_TRIGGER_EVENT_KEY: Record<MdUnblockTrigger['kind'], string> =
  Object.freeze({
    tool_registered: 'capability.tool_registered',
    evidence_ingested: 'corpus.ingest',
    approval_granted: 'four_eye.approved',
    flag_enabled: 'flag.enabled',
    feature_shipped: 'feature.shipped',
  });

/**
 * Validate a gap DETECT input before it becomes a durable row. Evidence-required
 * is enforced here exactly as for an ordinary commitment, plus the gap-specific
 * invariants (a typed gap kind + a concrete unblock trigger target). Throws on
 * a violation.
 */
function assertValidGap(input: CreateGapInput): void {
  if (!input.tenantId) throw new Error('md-gap: tenantId required');
  if (!input.title || !input.titleSw) {
    throw new Error('md-gap: bilingual title (title + titleSw) required');
  }
  if (!input.rationale) throw new Error('md-gap: rationale required');
  if (!input.evidenceIds || input.evidenceIds.length === 0) {
    throw new Error('md-gap: evidence-required — at least one evidence id');
  }
  if (!input.idempotencyKey) throw new Error('md-gap: idempotencyKey required');
  if (!input.gapKind) throw new Error('md-gap: gapKind required');
  if (!input.unblockTrigger || !input.unblockTrigger.target) {
    throw new Error('md-gap: unblockTrigger { kind, target } required');
  }
}

/**
 * Derive the base commitment shape a gap inserts as. A gap is a `waiting_for`
 * commitment whose WAIT-FOR is the unblock trigger (event family), born
 * `blocked` because it structurally cannot proceed until the trigger clears.
 */
function gapToInsertValues(input: CreateGapInput): {
  readonly class: MdCommitmentClass;
  readonly triggerKind: MdCommitmentTriggerKind;
  readonly triggerSpec: MdCommitmentTriggerSpec;
  readonly status: MdCommitmentStatus;
} {
  return {
    class: 'waiting_for',
    triggerKind: 'event',
    triggerSpec: { eventKey: GAP_TRIGGER_EVENT_KEY[input.unblockTrigger.kind] },
    status: 'blocked',
  };
}

// ---------------------------------------------------------------------------
// Drizzle implementation (service-role; out-of-band reconcile worker safe)
// ---------------------------------------------------------------------------

export function createDrizzleMdCommitmentRepository(
  db: DatabaseClient,
  /**
   * Optional append-only audit sink (FIX 5). When wired, every gap status
   * advance ALSO appends a row to the tamper-evident `ai_audit_chain` so the
   * transition history replays independently of the overwritten head-hash
   * column. Best-effort: the composition root injects the Drizzle adapter; the
   * advance never aborts on an audit-sink fault.
   */
  auditSink?: GapAuditAppendPort | null,
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
      assertTenant(input.tenantId, 'create');
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
            gapKind: input.gapKind ?? null,
            blockedBy: input.blockedBy ? [...input.blockedBy] : [],
            unblockTrigger: input.unblockTrigger ?? null,
            competenceDomain: input.competenceDomain ?? null,
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
      assertTenant(tenantId, 'get');
      return withServiceRoleContext(db, (tx) => findById(tx, tenantId, id));
    },

    async listLive(tenantId) {
      assertTenant(tenantId, 'listLive');
      return withServiceRoleContext(db, async (tx) => {
        const rows = await tx
          .select()
          .from(mdCommitments)
          .where(
            and(
              eq(mdCommitments.tenantId, tenantId),
              // FIX 1 — STRUCTURAL gap segregation: the generic reconcile sweep
              // NEVER reads a gap row (gap_kind NOT NULL). A gap is completable
              // ONLY through the verifier-gated `advanceGapStatus` path, never
              // through the generic reconcile-engine's `markDone`. Excluding gap
              // rows here makes the bypass impossible at the read boundary.
              isNull(mdCommitments.gapKind),
              inArray(mdCommitments.status, [...LIVE_STATUSES]),
            ),
          );
        return rows.map(rowToCommitment);
      });
    },

    async listDueByTime(tenantId, nowMs) {
      assertTenant(tenantId, 'listDueByTime');
      return withServiceRoleContext(db, async (tx) => {
        const rows = await tx
          .select()
          .from(mdCommitments)
          .where(
            and(
              eq(mdCommitments.tenantId, tenantId),
              // FIX 1 — gap rows are invisible to the generic time-trigger poll.
              isNull(mdCommitments.gapKind),
              eq(mdCommitments.triggerKind, 'time'),
              inArray(mdCommitments.status, ['open', 'scheduled']),
              lte(mdCommitments.triggerDueAt, new Date(nowMs)),
            ),
          );
        return rows.map(rowToCommitment);
      });
    },

    async listWaitingForEvent(tenantId, eventKey) {
      assertTenant(tenantId, 'listWaitingForEvent');
      return withServiceRoleContext(db, async (tx) => {
        const rows = await tx
          .select()
          .from(mdCommitments)
          .where(
            and(
              eq(mdCommitments.tenantId, tenantId),
              // FIX 1 — gap rows are invisible to the generic event-trigger lookup
              // (a gap's blocker-clear flows through the GapRegistryWatcher, not
              // this generic WaitFor subscriber).
              isNull(mdCommitments.gapKind),
              eq(mdCommitments.triggerKind, 'event'),
              inArray(mdCommitments.status, ['open', 'scheduled']),
              sql`${mdCommitments.triggerSpec} ->> 'eventKey' = ${eventKey}`,
            ),
          );
        return rows.map(rowToCommitment);
      });
    },

    async transition(tenantId, id, patch) {
      assertTenant(tenantId, 'transition');
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
              // FIX 1 (WRITE-path) — gap segregation: a gap_kind!=null row is
              // REFUSED by the generic mutator. The guard means 0 rows update
              // for a gap id (the method then reports the row unchanged / not the
              // gap-completed shape). A gap mutates ONLY through the verifier-
              // gated advanceGapStatus path, never this generic transition.
              isNull(mdCommitments.gapKind),
            ),
          );
        return findById(tx, tenantId, id);
      });
    },

    async ack(tenantId, id, at) {
      assertTenant(tenantId, 'ack');
      return withServiceRoleContext(db, async (tx) => {
        await tx
          .update(mdCommitments)
          .set({ ackedAt: at ?? new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(mdCommitments.tenantId, tenantId),
              eq(mdCommitments.id, id),
              // FIX 1 (WRITE-path) — gap segregation: never ack a gap row.
              isNull(mdCommitments.gapKind),
            ),
          );
        return findById(tx, tenantId, id);
      });
    },

    async markDone(tenantId, id, proof) {
      assertTenant(tenantId, 'markDone');
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
            and(
              eq(mdCommitments.tenantId, tenantId),
              eq(mdCommitments.id, id),
              // FIX 1 (WRITE-path) — the load-bearing guard: a gap row can NEVER
              // be completed by the generic markDone. 0 rows update for a gap id,
              // so the gap is never silently marked done by the reconcile sweep —
              // only the verifier-gated advanceGapStatus (scheduled→done) can.
              isNull(mdCommitments.gapKind),
            ),
          );
        return findById(tx, tenantId, id);
      });
    },

    async reopen(tenantId, id, auditChainHash) {
      assertTenant(tenantId, 'reopen');
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
            and(
              eq(mdCommitments.tenantId, tenantId),
              eq(mdCommitments.id, id),
              // FIX 1 (WRITE-path) — gap segregation: never reopen a gap row
              // through the generic path (the gap's reopened-attempt cap is owned
              // exclusively by advanceGapStatus / planGapAdvance).
              isNull(mdCommitments.gapKind),
            ),
          );
        return findById(tx, tenantId, id);
      });
    },

    async block(tenantId, id, reason) {
      assertTenant(tenantId, 'block');
      return withServiceRoleContext(db, async (tx) => {
        await tx
          .update(mdCommitments)
          .set({
            status: 'blocked',
            blockedReason: reason,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(mdCommitments.tenantId, tenantId),
              eq(mdCommitments.id, id),
              // FIX 1 (WRITE-path) — gap segregation: never block a gap row
              // through the generic path (a gap is born blocked and re-probed by
              // the watcher; its lifecycle is owned by advanceGapStatus).
              isNull(mdCommitments.gapKind),
            ),
          );
        return findById(tx, tenantId, id);
      });
    },

    async createGap(input) {
      assertTenant(input.tenantId, 'createGap');
      assertValidGap(input);
      const base = gapToInsertValues(input);
      return withServiceRoleContext(db, async (tx) => {
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

        const inserted = await tx
          .insert(mdCommitments)
          .values({
            tenantId: input.tenantId,
            ownerId: input.ownerId ?? 'mwikila',
            threadId: input.threadId ?? null,
            class: base.class,
            kind: input.kind ?? 'capability.gap',
            title: input.title,
            titleSw: input.titleSw,
            rationale: input.rationale,
            evidenceIds: [...input.evidenceIds],
            triggerKind: base.triggerKind,
            triggerSpec: base.triggerSpec,
            status: base.status,
            sovereign: input.sovereign ?? false,
            idempotencyKey: input.idempotencyKey,
            gapKind: input.gapKind,
            blockedBy: input.blockedBy ? [...input.blockedBy] : [],
            unblockTrigger: input.unblockTrigger,
            competenceDomain: input.competenceDomain ?? null,
          })
          .onConflictDoNothing({
            target: [mdCommitments.tenantId, mdCommitments.idempotencyKey],
          })
          .returning();
        if (inserted[0]) return rowToCommitment(inserted[0]);
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
        throw new Error('md-gap: createGap failed (no row returned)');
      });
    },

    async listOpenGaps(tenantId) {
      assertTenant(tenantId, 'listOpenGaps');
      return withServiceRoleContext(db, async (tx) => {
        const rows = await tx
          .select()
          .from(mdCommitments)
          .where(
            and(
              eq(mdCommitments.tenantId, tenantId),
              isNotNull(mdCommitments.gapKind),
              // LIVE set only — TERMINAL needs_approval / dead_letter / done gaps
              // are excluded so a parked or dead-lettered gap leaves the watcher
              // hot set and never re-fires every tick.
              inArray(mdCommitments.status, [...LIVE_STATUSES]),
            ),
          );
        return rows.map(rowToCommitment);
      });
    },

    async advanceGapStatus(tenantId, id, patch) {
      assertTenant(tenantId, 'advanceGapStatus');
      const result = await withServiceRoleContext(db, async (tx) => {
        const current = await findById(tx, tenantId, id);
        if (!current || current.gapKind === null) {
          return { row: null as MdCommitment | null, appended: null };
        }
        // FIX 1/4/6 — the single source of advance truth (throws on a `done`
        // without proof / from the wrong state; caps reopened attempts; no-ops
        // an unchanged request).
        const plan = planGapAdvance(current, patch);
        if (plan.kind === 'noop') {
          // FIX 6 — return the row UNCHANGED: no hash bump, no audit append.
          return { row: current, appended: null };
        }
        const at = new Date();
        // FIX 3a — genesis is the FIRST advance (no prior hash); its head stitches
        // over the per-gap seed. FIX 3b — the per-gap sequence is 0 at genesis,
        // +1 each later advance.
        const isGenesis = current.auditChainHash === null;
        const nextSeq = isGenesis ? 0 : current.gapAuditSeq + 1;
        const nextHash = stitchGapHash({
          previousHash: current.auditChainHash,
          genesisSeed: gapGenesisSeed(id, tenantId),
          id,
          status: plan.status,
          reason: patch.reason,
          atIso: at.toISOString(),
        });
        await tx
          .update(mdCommitments)
          .set({
            status: plan.status,
            auditChainHash: nextHash,
            gapAuditSeq: nextSeq,
            attemptFailedCount: plan.attemptFailedCount,
            ...(plan.status === 'done' && {
              confirmedAt: at,
              confirmationKind: plan.confirmationKind,
            }),
            blockedReason: plan.blockedReason,
            updatedAt: at,
          })
          .where(
            and(eq(mdCommitments.tenantId, tenantId), eq(mdCommitments.id, id)),
          );
        const row = await findById(tx, tenantId, id);
        return {
          row,
          appended: {
            transition: `gap:${current.status}->${plan.status}`,
            sovereign: current.sovereign,
            chainHash: nextHash,
            occurredAtMs: at.getTime(),
            // FIX 5 — the EXACT head-hash inputs so the log replays independently.
            status: plan.status,
            reason: patch.reason,
            previousHash: current.auditChainHash,
            // FIX 3b — the per-gap monotonic sequence (0 at genesis).
            sequence: nextSeq,
          },
        };
      });

      // FIX 5 — append-only audit row OUTSIDE the status write txn (best-effort):
      // the durable advance is the load-bearing write; the tamper-evident
      // ai_audit_chain row is its forensic mirror and must never abort it.
      if (auditSink && result.appended) {
        try {
          await auditSink.append({
            tenantId,
            gapId: id,
            transition: result.appended.transition,
            sovereign: result.appended.sovereign,
            chainHash: result.appended.chainHash,
            occurredAtMs: result.appended.occurredAtMs,
            status: result.appended.status,
            reason: result.appended.reason,
            previousHash: result.appended.previousHash,
            sequence: result.appended.sequence,
          });
        } catch {
          // Swallow — the advance already committed; an audit-sink fault must
          // never propagate. The composition root's adapter logs via Pino.
        }
      }
      return result.row;
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
  attemptFailedCount: number;
  gapAuditSeq: number;
  auditChainHash: string | null;
  idempotencyKey: string;
  gapKind: MdCommitmentGapKind | null;
  blockedBy: string[];
  unblockTrigger: MdUnblockTrigger | null;
  competenceDomain: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function memToCommitment(r: MemRow): MdCommitment {
  return rowToCommitment({
    ...r,
    evidenceIds: r.evidenceIds,
    blockedBy: r.blockedBy,
  } as unknown as MdCommitmentRow);
}

export function createInMemoryMdCommitmentRepository(opts?: {
  readonly now?: () => number;
  /** Optional append-only audit sink (FIX 5) — same port as the Drizzle twin. */
  readonly auditSink?: GapAuditAppendPort | null;
}): MdCommitmentRepository {
  const now = opts?.now ?? (() => Date.now());
  const auditSink = opts?.auditSink ?? null;
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
      assertTenant(input.tenantId, 'create');
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
        attemptFailedCount: 0,
        gapAuditSeq: 0,
        auditChainHash: null,
        idempotencyKey: input.idempotencyKey,
        gapKind: input.gapKind ?? null,
        blockedBy: input.blockedBy ? [...input.blockedBy] : [],
        unblockTrigger: input.unblockTrigger ?? null,
        competenceDomain: input.competenceDomain ?? null,
        createdAt: ts,
        updatedAt: ts,
      };
      rows.set(key(row.tenantId, row.id), row);
      return memToCommitment(row);
    },

    async get(tenantId, id) {
      assertTenant(tenantId, 'get');
      const r = rows.get(key(tenantId, id));
      return r ? memToCommitment(r) : null;
    },

    async listLive(tenantId) {
      assertTenant(tenantId, 'listLive');
      return [...rows.values()]
        .filter(
          (r) =>
            r.tenantId === tenantId &&
            // FIX 1 — STRUCTURAL gap segregation (in-memory twin): the generic
            // reconcile sweep NEVER reads a gap row (gap_kind NOT NULL), so the
            // generic markDone can never complete a gap. A gap advances ONLY via
            // the verifier-gated advanceGapStatus path.
            r.gapKind === null &&
            (LIVE_STATUSES as ReadonlyArray<string>).includes(r.status),
        )
        .map(memToCommitment);
    },

    async listDueByTime(tenantId, nowMs) {
      assertTenant(tenantId, 'listDueByTime');
      return [...rows.values()]
        .filter(
          (r) =>
            r.tenantId === tenantId &&
            // FIX 1 — gap rows are invisible to the generic time-trigger poll.
            r.gapKind === null &&
            r.triggerKind === 'time' &&
            (r.status === 'open' || r.status === 'scheduled') &&
            r.triggerDueAt !== null &&
            r.triggerDueAt.getTime() <= nowMs,
        )
        .map(memToCommitment);
    },

    async listWaitingForEvent(tenantId, eventKey) {
      assertTenant(tenantId, 'listWaitingForEvent');
      return [...rows.values()]
        .filter(
          (r) =>
            r.tenantId === tenantId &&
            // FIX 1 — gap rows are invisible to the generic event-trigger lookup.
            r.gapKind === null &&
            r.triggerKind === 'event' &&
            (r.status === 'open' || r.status === 'scheduled') &&
            r.triggerSpec.eventKey === eventKey,
        )
        .map(memToCommitment);
    },

    async transition(tenantId, id, patch) {
      assertTenant(tenantId, 'transition');
      const r = rows.get(key(tenantId, id));
      if (!r) return null;
      // FIX 1 (WRITE-path) — gap segregation (in-memory twin): a gap row is
      // REFUSED by the generic mutator. Return it UNCHANGED (no status change)
      // so the generic transition can never advance / complete a gap; only the
      // verifier-gated advanceGapStatus path mutates a gap.
      if (r.gapKind !== null) return memToCommitment(r);
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
      assertTenant(tenantId, 'ack');
      const r = rows.get(key(tenantId, id));
      if (!r) return null;
      // FIX 1 (WRITE-path) — gap segregation: never ack a gap row.
      if (r.gapKind !== null) return memToCommitment(r);
      r.ackedAt = at ?? new Date(now());
      r.updatedAt = new Date(now());
      return memToCommitment(r);
    },

    async markDone(tenantId, id, proof) {
      assertTenant(tenantId, 'markDone');
      if (!proof.confirmationKind) {
        throw new Error(
          'md-commitment: markDone requires a confirmationKind (positive proof)',
        );
      }
      const r = rows.get(key(tenantId, id));
      if (!r) return null;
      // FIX 1 (WRITE-path) — the load-bearing guard: the generic markDone can
      // NEVER complete a gap row. Return it UNCHANGED (still uncompleted) so a
      // gap is closed ONLY by the verifier-gated advanceGapStatus (scheduled→done).
      if (r.gapKind !== null) return memToCommitment(r);
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
      assertTenant(tenantId, 'reopen');
      const r = rows.get(key(tenantId, id));
      if (!r) return null;
      // FIX 1 (WRITE-path) — gap segregation: never reopen a gap row through the
      // generic path (the gap's reopened-attempt cap is owned by advanceGapStatus).
      if (r.gapKind !== null) return memToCommitment(r);
      r.status = 'reopened';
      r.confirmedAt = null;
      r.confirmationKind = null;
      if (auditChainHash !== undefined) r.auditChainHash = auditChainHash;
      r.updatedAt = new Date(now());
      return memToCommitment(r);
    },

    async block(tenantId, id, reason) {
      assertTenant(tenantId, 'block');
      const r = rows.get(key(tenantId, id));
      if (!r) return null;
      // FIX 1 (WRITE-path) — gap segregation: never block a gap row through the
      // generic path (a gap is born blocked + re-probed; its lifecycle is owned
      // by advanceGapStatus).
      if (r.gapKind !== null) return memToCommitment(r);
      r.status = 'blocked';
      r.blockedReason = reason;
      r.updatedAt = new Date(now());
      return memToCommitment(r);
    },

    async createGap(input) {
      assertTenant(input.tenantId, 'createGap');
      assertValidGap(input);
      const dup = findIdem(input.tenantId, input.idempotencyKey);
      if (dup) return memToCommitment(dup);
      const base = gapToInsertValues(input);
      seq += 1;
      const ts = new Date(now());
      const row: MemRow = {
        id: `mdc_${seq}_${ts.getTime()}`,
        tenantId: input.tenantId,
        ownerId: input.ownerId ?? 'mwikila',
        threadId: input.threadId ?? null,
        class: base.class,
        kind: input.kind ?? 'capability.gap',
        title: input.title,
        titleSw: input.titleSw,
        rationale: input.rationale,
        evidenceIds: [...input.evidenceIds],
        triggerKind: base.triggerKind,
        triggerSpec: base.triggerSpec,
        triggerDueAt: null,
        status: base.status,
        rungLevel: 0,
        sovereign: input.sovereign ?? false,
        lastNudgedAt: null,
        ackedAt: null,
        confirmedAt: null,
        confirmationKind: null,
        blockedReason: null,
        attemptCount: 0,
        attemptFailedCount: 0,
        gapAuditSeq: 0,
        auditChainHash: null,
        idempotencyKey: input.idempotencyKey,
        gapKind: input.gapKind,
        blockedBy: input.blockedBy ? [...input.blockedBy] : [],
        unblockTrigger: input.unblockTrigger,
        competenceDomain: input.competenceDomain ?? null,
        createdAt: ts,
        updatedAt: ts,
      };
      rows.set(key(row.tenantId, row.id), row);
      return memToCommitment(row);
    },

    async listOpenGaps(tenantId) {
      assertTenant(tenantId, 'listOpenGaps');
      return [...rows.values()]
        .filter(
          (r) =>
            r.tenantId === tenantId &&
            r.gapKind !== null &&
            // LIVE set only — TERMINAL needs_approval / dead_letter / done gaps
            // leave the watcher hot set (no per-tick re-fire storm).
            (LIVE_STATUSES as ReadonlyArray<string>).includes(r.status),
        )
        .map(memToCommitment);
    },

    async advanceGapStatus(tenantId, id, patch) {
      assertTenant(tenantId, 'advanceGapStatus');
      const r = rows.get(key(tenantId, id));
      if (!r || r.gapKind === null) return null;
      // FIX 1/4/6 — same pure planner as the Drizzle twin (throws on a `done`
      // without proof / from the wrong state; caps reopened attempts; no-ops an
      // unchanged request). Mutation here is the in-memory store's internal
      // bookkeeping; the public return is a frozen snapshot.
      const plan = planGapAdvance(
        {
          status: r.status,
          blockedReason: r.blockedReason,
          attemptFailedCount: r.attemptFailedCount,
        },
        patch,
      );
      if (plan.kind === 'noop') {
        // FIX 6 — return UNCHANGED: no hash bump, no audit append.
        return memToCommitment(r);
      }
      const at = new Date(now());
      const fromStatus = r.status;
      const previousHash = r.auditChainHash;
      // FIX 3a/3b — genesis stitches over the per-gap seed; the per-gap sequence
      // is 0 at genesis, +1 each later advance.
      const isGenesis = previousHash === null;
      const nextSeq = isGenesis ? 0 : r.gapAuditSeq + 1;
      const nextHash = stitchGapHash({
        previousHash,
        genesisSeed: gapGenesisSeed(id, tenantId),
        id,
        status: plan.status,
        reason: patch.reason,
        atIso: at.toISOString(),
      });
      r.auditChainHash = nextHash;
      r.gapAuditSeq = nextSeq;
      r.status = plan.status;
      r.attemptFailedCount = plan.attemptFailedCount;
      if (plan.status === 'done') {
        r.confirmedAt = at;
        r.confirmationKind = plan.confirmationKind;
      }
      r.blockedReason = plan.blockedReason;
      r.updatedAt = at;
      const snapshot = memToCommitment(r);

      // FIX 5 — append-only audit row (best-effort; never aborts the advance).
      if (auditSink) {
        try {
          await auditSink.append({
            tenantId,
            gapId: id,
            transition: `gap:${fromStatus}->${plan.status}`,
            sovereign: r.sovereign,
            chainHash: nextHash,
            occurredAtMs: at.getTime(),
            // FIX 5 — the EXACT head-hash inputs so the log replays independently.
            status: plan.status,
            reason: patch.reason,
            previousHash,
            // FIX 3b — the per-gap monotonic sequence (0 at genesis).
            sequence: nextSeq,
          });
        } catch {
          // Swallow — the advance already landed; the audit mirror is forensic.
        }
      }
      return snapshot;
    },
  };
}
