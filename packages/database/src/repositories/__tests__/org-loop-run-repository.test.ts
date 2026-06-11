/**
 * OrgLoopRunRepository tests (in-memory twin) — the SELF-RUNNING-ORG SPINE
 * correlation identity (the join between an md_commitment and the mining_task it
 * spawned, plus each loop run's stage/status).
 *
 * Covers the store invariants that hold regardless of backend:
 *   - create persists + round-trips; a run is born 'strategize' / 'open' with
 *     the commitment back-edge + evidence ids threaded through;
 *   - commitmentId is REQUIRED (the close-the-loop back-edge) — a create without
 *     it is rejected;
 *   - findByTask resolves the close-the-loop edge once the task join is set;
 *   - findByCommitment is the dispatcher's de-dupe / resume read;
 *   - advance is field-scoped: it threads the task_id forward-edge, records the
 *     pick (chosenEmployeeId + matchConfidence), and walks the stage machine to
 *     'closed' / 'closed' without disturbing untouched fields;
 *   - listOpen returns only open/active runs (a closed run leaves the hot set);
 *   - tenant ISOLATION: tenant A never sees tenant B's loop runs.
 *
 * The Drizzle twin shares this exact surface; its RLS isolation is enforced by
 * migration 0341's FORCE policy (covered by the migration-apply RLS gate).
 */

import { describe, it, expect } from 'vitest';

import {
  createInMemoryOrgLoopRunRepository,
  type CreateOrgLoopRunInput,
} from '../org-loop-run-repository.js';

const A = 'tenant-A';
const B = 'tenant-B';

function baseInput(
  overrides: Partial<CreateOrgLoopRunInput> = {},
): CreateOrgLoopRunInput {
  return {
    tenantId: A,
    commitmentId: 'mdc-1',
    evidenceIds: ['evi-1'],
    sourceData: { gap: 'workforce.shortfall' },
    ...overrides,
  };
}

describe('OrgLoopRunRepository (in-memory)', () => {
  it('creates + round-trips a loop run; born strategize/open with the back-edge', async () => {
    const repo = createInMemoryOrgLoopRunRepository();
    const created = await repo.create(baseInput());

    expect(created.stage).toBe('strategize');
    expect(created.status).toBe('open');
    expect(created.loopKind).toBe('gap_to_delegate');
    expect(created.commitmentId).toBe('mdc-1');
    expect(created.taskId).toBeNull();
    expect(created.evidenceIds).toEqual(['evi-1']);
    expect(created.sourceData).toEqual({ gap: 'workforce.shortfall' });
  });

  it('rejects a create without a commitmentId (the close-the-loop back-edge)', async () => {
    const repo = createInMemoryOrgLoopRunRepository();
    await expect(
      repo.create(baseInput({ commitmentId: '' })),
    ).rejects.toThrow(/commitmentId required/);
  });

  it('findByTask resolves the close-the-loop edge once the task join is set', async () => {
    const repo = createInMemoryOrgLoopRunRepository();
    const created = await repo.create(baseInput());

    // Before dispatch there is no task join — the edge is not yet resolvable.
    expect(await repo.findByTask(A, 'task-1')).toBeNull();

    await repo.advance(A, created.id, {
      stage: 'dispatch',
      status: 'active',
      taskId: 'task-1',
    });

    const found = await repo.findByTask(A, 'task-1');
    expect(found?.id).toBe(created.id);
    expect(found?.commitmentId).toBe('mdc-1');
    expect(found?.taskId).toBe('task-1');
    expect(found?.status).toBe('active');
  });

  it('adopts the winner on a double-create race — one open run per (tenant, commitment)', async () => {
    // Mirrors migration 0342's partial unique index
    // (org_loop_runs_open_commitment_uniq WHERE status IN ('open','active')):
    // a second open create for the same commitment must NOT insert a duplicate
    // — it returns the already-open run (the Drizzle twin reaches the same
    // outcome via ON CONFLICT DO NOTHING + fetch-existing).
    const repo = createInMemoryOrgLoopRunRepository();
    const first = await repo.create(baseInput({ commitmentId: 'mdc-race' }));
    const second = await repo.create(
      baseInput({
        commitmentId: 'mdc-race',
        sourceData: { gap: 'a different racing tick' },
      }),
    );

    expect(second.id).toBe(first.id);
    // The loser's payload never overwrites the winner.
    expect(second.sourceData).toEqual({ gap: 'workforce.shortfall' });
    const open = await repo.listOpen(A);
    expect(open.filter((r) => r.commitmentId === 'mdc-race')).toHaveLength(1);

    // Once the open run leaves the hot set, a NEW run for the same commitment
    // is legal again (the guard is partial — open/active only).
    await repo.advance(A, first.id, { stage: 'closed', status: 'closed' });
    const reopened = await repo.create(baseInput({ commitmentId: 'mdc-race' }));
    expect(reopened.id).not.toBe(first.id);
    expect(reopened.status).toBe('open');
  });

  it('findByCommitment is the dispatcher de-dupe / resume read', async () => {
    const repo = createInMemoryOrgLoopRunRepository();
    const created = await repo.create(baseInput({ commitmentId: 'mdc-7' }));
    const found = await repo.findByCommitment(A, 'mdc-7');
    expect(found?.id).toBe(created.id);
    expect(await repo.findByCommitment(A, 'mdc-absent')).toBeNull();
  });

  it('advance records the pick (employee + confidence) without disturbing untouched fields', async () => {
    const repo = createInMemoryOrgLoopRunRepository();
    const created = await repo.create(baseInput());

    const picked = await repo.advance(A, created.id, {
      stage: 'pick',
      chosenEmployeeId: 'emp-42',
      matchConfidence: 0.87,
    });

    expect(picked?.stage).toBe('pick');
    expect(picked?.chosenEmployeeId).toBe('emp-42');
    expect(picked?.matchConfidence).toBeCloseTo(0.87);
    // Untouched fields survive the field-scoped patch.
    expect(picked?.commitmentId).toBe('mdc-1');
    expect(picked?.status).toBe('open');
    expect(picked?.evidenceIds).toEqual(['evi-1']);
  });

  it('walks the stage machine to closed and leaves the open hot set', async () => {
    const repo = createInMemoryOrgLoopRunRepository();
    const created = await repo.create(baseInput());

    // The run is in the open hot set while live.
    let open = await repo.listOpen(A);
    expect(open.map((r) => r.id)).toContain(created.id);

    await repo.advance(A, created.id, {
      stage: 'closed',
      status: 'closed',
    });

    open = await repo.listOpen(A);
    expect(open.map((r) => r.id)).not.toContain(created.id);

    // The closed run is still retrievable by its joins.
    const still = await repo.findByCommitment(A, 'mdc-1');
    expect(still?.stage).toBe('closed');
    expect(still?.status).toBe('closed');
  });

  it('advance returns null for an unknown id', async () => {
    const repo = createInMemoryOrgLoopRunRepository();
    expect(await repo.advance(A, 'olr-absent', { stage: 'pick' })).toBeNull();
  });

  it('isolates tenants — A never sees B runs', async () => {
    const repo = createInMemoryOrgLoopRunRepository();
    const aRun = await repo.create(baseInput({ tenantId: A }));
    await repo.advance(A, aRun.id, { taskId: 'task-shared' });
    const bRun = await repo.create(
      baseInput({ tenantId: B, commitmentId: 'mdc-b' }),
    );
    await repo.advance(B, bRun.id, { taskId: 'task-shared' });

    // findByTask is tenant-scoped: each tenant resolves only its own run.
    expect((await repo.findByTask(A, 'task-shared'))?.id).toBe(aRun.id);
    expect((await repo.findByTask(B, 'task-shared'))?.id).toBe(bRun.id);

    // listOpen never leaks across tenants.
    const aOpen = await repo.listOpen(A);
    expect(aOpen.map((r) => r.id)).toEqual([aRun.id]);
    expect(await repo.findByCommitment(A, 'mdc-b')).toBeNull();
  });

  it('asserts a non-empty tenantId on every method', async () => {
    const repo = createInMemoryOrgLoopRunRepository();
    await expect(repo.findByTask('', 'task-1')).rejects.toThrow(
      /non-empty tenantId/,
    );
    await expect(repo.listOpen('')).rejects.toThrow(/non-empty tenantId/);
  });
});
