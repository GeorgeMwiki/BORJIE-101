/**
 * MdCommitmentRepository tests (in-memory twin) — the durable DEFERRAL /
 * FOLLOW-THROUGH commitment store.
 *
 * Covers the store invariants that hold regardless of backend:
 *   - create persists + round-trips; a time trigger starts 'scheduled', an
 *     event/condition trigger starts 'open';
 *   - create is IDEMPOTENT on (tenantId, idempotencyKey) — a duplicate deferral
 *     returns the existing row, never a second;
 *   - evidence-required: a create with an empty evidence chain is rejected;
 *   - listDueByTime claims only time triggers past due; listWaitingForEvent
 *     matches by eventKey;
 *   - markDone is HONEST — it requires a confirmation proof; reopen clears it;
 *   - tenant ISOLATION: tenant A never sees tenant B's commitments.
 *
 * The Drizzle twin shares this exact surface; its RLS isolation is enforced by
 * migration 0321's FORCE policy (covered by the migration-apply RLS gate).
 */

import { describe, it, expect } from 'vitest';

import {
  createInMemoryMdCommitmentRepository,
  type CreateMdCommitmentInput,
} from '../md-commitment-repository.js';

const A = 'tenant-A';
const B = 'tenant-B';

function baseInput(
  overrides: Partial<CreateMdCommitmentInput> = {},
): CreateMdCommitmentInput {
  return {
    tenantId: A,
    class: 'waiting_for',
    title: 'File royalty after settlement lands',
    titleSw: 'Wasilisha mrabaha baada ya malipo kuingia',
    rationale: 'The buyer settlement clears the filing amount.',
    evidenceIds: ['evi-1'],
    triggerKind: 'event',
    triggerSpec: { eventKey: 'ledger.credit' },
    idempotencyKey: 'idem-1',
    ...overrides,
  };
}

describe('MdCommitmentRepository (in-memory)', () => {
  it('persists + round-trips a commitment; event trigger starts open', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    const created = await repo.create(baseInput());
    expect(created.status).toBe('open');
    expect(created.triggerKind).toBe('event');

    const fetched = await repo.get(A, created.id);
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.title).toBe('File royalty after settlement lands');
  });

  it('a time trigger starts scheduled', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    const created = await repo.create(
      baseInput({
        triggerKind: 'time',
        triggerSpec: { dueAt: new Date(1000).toISOString() },
        triggerDueAt: new Date(1000).toISOString(),
        idempotencyKey: 'idem-time',
      }),
    );
    expect(created.status).toBe('scheduled');
  });

  it('create is idempotent on (tenantId, idempotencyKey)', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    const first = await repo.create(baseInput());
    const second = await repo.create(baseInput({ title: 'changed title' }));
    expect(second.id).toBe(first.id);
    // The first write wins — the duplicate did not overwrite.
    expect(second.title).toBe('File royalty after settlement lands');
    expect((await repo.listLive(A)).length).toBe(1);
  });

  it('rejects a create with an empty evidence chain (evidence-required)', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    await expect(
      repo.create(baseInput({ evidenceIds: [] })),
    ).rejects.toThrow(/evidence-required/);
  });

  it('listDueByTime claims only time triggers past due', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    await repo.create(
      baseInput({
        idempotencyKey: 'past',
        triggerKind: 'time',
        triggerSpec: { dueAt: new Date(1000).toISOString() },
        triggerDueAt: new Date(1000).toISOString(),
      }),
    );
    await repo.create(
      baseInput({
        idempotencyKey: 'future',
        triggerKind: 'time',
        triggerSpec: { dueAt: new Date(9_000_000).toISOString() },
        triggerDueAt: new Date(9_000_000).toISOString(),
      }),
    );
    const due = await repo.listDueByTime(A, 5000);
    expect(due.map((c) => c.idempotencyKey)).toEqual(['past']);
  });

  it('listWaitingForEvent matches by eventKey', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    await repo.create(baseInput({ idempotencyKey: 'credit', triggerSpec: { eventKey: 'ledger.credit' } }));
    await repo.create(baseInput({ idempotencyKey: 'settle', triggerSpec: { eventKey: 'offtake.settled' } }));
    const waiting = await repo.listWaitingForEvent(A, 'ledger.credit');
    expect(waiting.map((c) => c.idempotencyKey)).toEqual(['credit']);
  });

  it('markDone is HONEST — requires a confirmation proof; reopen clears it', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    const c = await repo.create(baseInput());

    // No proof kind → impossible.
    await expect(
      repo.markDone(A, c.id, { confirmationKind: '' }),
    ).rejects.toThrow(/positive proof/);

    const done = await repo.markDone(A, c.id, {
      confirmationKind: 'ledger_entry',
    });
    expect(done?.status).toBe('done');
    expect(done?.confirmationKind).toBe('ledger_entry');
    expect(done?.confirmedAtMs).not.toBeNull();

    const reopened = await repo.reopen(A, c.id);
    expect(reopened?.status).toBe('reopened');
    expect(reopened?.confirmedAtMs).toBeNull();
    expect(reopened?.confirmationKind).toBeNull();
  });

  it('isolates tenants — A never sees B', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    const a = await repo.create(baseInput({ tenantId: A, idempotencyKey: 'a' }));
    await repo.create(baseInput({ tenantId: B, idempotencyKey: 'b' }));

    const liveA = await repo.listLive(A);
    const liveB = await repo.listLive(B);
    expect(liveA.map((c) => c.tenantId)).toEqual([A]);
    expect(liveB.map((c) => c.tenantId)).toEqual([B]);
    // A cannot fetch B's row by id.
    expect(await repo.get(B, a.id)).toBeNull();
  });
});
