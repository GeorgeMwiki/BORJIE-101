/**
 * ConfirmationProbe (K3 close-the-loop) tests — the durable positive-proof
 * checker the reconcile sweep closes a commitment on.
 *
 * Covers:
 *   - a TASK commitment closes when a matching `mining_tasks status='done'` row
 *     exists for one of its evidence ids (proof 'task_completed'); null when no
 *     done row exists;
 *   - an ACTION commitment closes when a matching `mwikila_actions_inbox` row is
 *     executed/committed (proof 'action_executed'), or a SUCCESS `audit_events`
 *     row matches the commitment kind (proof 'audit_event'); null otherwise;
 *   - the probe routes by `commitment.kind` (generic), not a per-commitment id;
 *   - FAIL-SAFE — a read fault returns null (never throws), never closing a
 *     commitment on a degraded read.
 *
 * The db is stubbed with a bare `{ execute }` seam (the repository-test pattern);
 * `withTenantContext` runs the read directly against the stub (no transaction).
 */

import { describe, it, expect, vi } from 'vitest';

import type { MdCommitment } from '@borjie/database/repositories';

import { createDurableConfirmationProbe } from '../confirmation-probe.js';

const T = '11111111-1111-1111-1111-111111111111';
const TASK_ID = '22222222-2222-2222-2222-222222222222';
const ACTION_ID = '33333333-3333-3333-3333-333333333333';

const NOOP_LOGGER = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as unknown as Parameters<typeof createDurableConfirmationProbe>[0]['logger'];

/** Build an MdCommitment fixture — only the probe-read fields matter here. */
function commitment(overrides: Partial<MdCommitment> = {}): MdCommitment {
  return Object.freeze({
    id: 'cmt-1',
    tenantId: T,
    ownerId: 'mwikila',
    threadId: null,
    class: 'next_action',
    kind: 'task',
    title: 'Finish the haul-road repair',
    titleSw: 'Maliza ukarabati wa barabara',
    rationale: 'The task was delegated to a worker.',
    evidenceIds: [TASK_ID],
    triggerKind: 'event',
    triggerSpec: {},
    triggerDueAtMs: null,
    status: 'overdue',
    rungLevel: 0,
    sovereign: false,
    lastNudgedAtMs: null,
    ackedAtMs: 1000,
    confirmedAtMs: null,
    confirmationKind: null,
    blockedReason: null,
    attemptCount: 0,
    attemptFailedCount: 0,
    gapAuditSeq: 0,
    auditChainHash: null,
    idempotencyKey: 'idem-1',
    gapKind: null,
    blockedBy: [],
    unblockTrigger: null,
    competenceDomain: null,
    createdAtMs: 0,
    updatedAtMs: 0,
    ...overrides,
  }) as MdCommitment;
}

/**
 * A db stub whose `execute` matches the probed table by inspecting the compiled
 * SQL text and returns rows only for the table the test wants to satisfy.
 */
function stubDb(present: {
  miningTasksDone?: boolean;
  actionExecuted?: boolean;
  auditSuccess?: boolean;
  throws?: boolean;
}) {
  return {
    async execute(query: unknown) {
      if (present.throws) throw new Error('db down');
      // Drizzle `sql` objects serialise their literal chunks (e.g. the table
      // name) into JSON — the proven repository-test extraction.
      const text = JSON.stringify(query);
      if (text.includes('mining_tasks')) {
        return { rows: present.miningTasksDone ? [{ '?column?': 1 }] : [] };
      }
      if (text.includes('mwikila_actions_inbox')) {
        return { rows: present.actionExecuted ? [{ '?column?': 1 }] : [] };
      }
      if (text.includes('audit_events')) {
        return { rows: present.auditSuccess ? [{ '?column?': 1 }] : [] };
      }
      return { rows: [] };
    },
  } as unknown as Parameters<typeof createDurableConfirmationProbe>[0]['db'];
}

describe('ConfirmationProbe — TASK commitments', () => {
  it('returns task_completed when a matching done mining_tasks row exists', async () => {
    const probe = createDurableConfirmationProbe({
      db: stubDb({ miningTasksDone: true }),
      logger: NOOP_LOGGER,
    });
    const proof = await probe.proofFor(commitment());
    expect(proof).toBe('task_completed');
  });

  it('returns null when no done task row exists', async () => {
    const probe = createDurableConfirmationProbe({
      db: stubDb({ miningTasksDone: false }),
      logger: NOOP_LOGGER,
    });
    const proof = await probe.proofFor(commitment());
    expect(proof).toBeNull();
  });

  it('returns null (no row query) when the commitment carries no uuid evidence', async () => {
    const execute = vi.fn(async () => ({ rows: [] }));
    const db = { execute } as unknown as Parameters<
      typeof createDurableConfirmationProbe
    >[0]['db'];
    const probe = createDurableConfirmationProbe({ db, logger: NOOP_LOGGER });
    const proof = await probe.proofFor(
      commitment({ evidenceIds: ['evi-not-a-uuid'] }),
    );
    expect(proof).toBeNull();
    // No row-id join possible → the probe short-circuits without querying.
    expect(execute).not.toHaveBeenCalled();
  });

  it('routes a `task.fulfil` kind to the task evidence table (generic prefix)', async () => {
    const probe = createDurableConfirmationProbe({
      db: stubDb({ miningTasksDone: true }),
      logger: NOOP_LOGGER,
    });
    const proof = await probe.proofFor(commitment({ kind: 'task.fulfil' }));
    expect(proof).toBe('task_completed');
  });
});

describe('ConfirmationProbe — ACTION commitments', () => {
  it('returns action_executed when an executed inbox action matches', async () => {
    const probe = createDurableConfirmationProbe({
      db: stubDb({ actionExecuted: true }),
      logger: NOOP_LOGGER,
    });
    const proof = await probe.proofFor(
      commitment({ kind: 'royalty.filing', evidenceIds: [ACTION_ID] }),
    );
    expect(proof).toBe('action_executed');
  });

  it('falls back to a SUCCESS audit_events row matching the commitment kind', async () => {
    const probe = createDurableConfirmationProbe({
      db: stubDb({ actionExecuted: false, auditSuccess: true }),
      logger: NOOP_LOGGER,
    });
    const proof = await probe.proofFor(
      commitment({ kind: 'royalty.filing', evidenceIds: [ACTION_ID] }),
    );
    expect(proof).toBe('audit_event');
  });

  it('returns null when no executed action and no SUCCESS audit row exist', async () => {
    const probe = createDurableConfirmationProbe({
      db: stubDb({ actionExecuted: false, auditSuccess: false }),
      logger: NOOP_LOGGER,
    });
    const proof = await probe.proofFor(
      commitment({ kind: 'royalty.filing', evidenceIds: [ACTION_ID] }),
    );
    expect(proof).toBeNull();
  });
});

describe('ConfirmationProbe — fail-safe', () => {
  it('returns null (never throws) when the evidence read faults', async () => {
    const probe = createDurableConfirmationProbe({
      db: stubDb({ throws: true }),
      logger: NOOP_LOGGER,
    });
    const proof = await probe.proofFor(commitment());
    expect(proof).toBeNull();
  });
});
