import { describe, it, expect } from 'vitest';
import {
  createReconciliationSpawner,
  type ReconciliationKernel,
} from '../conflict/reconciliation-spawner.js';
import { createInMemoryConflictsRepository } from '../storage/conflicts-repository.js';

const stubKernel = (tier: number): ReconciliationKernel => ({
  async reconcile() {
    return {
      tier,
      reconciliationPayload: { suggestion: 'merge-A-with-B-date' },
      suggestedResolutionKind: tier === 0 ? 'ai_reconciled' : 'owner_picked',
    };
  },
});

describe('reconciliation-spawner', () => {
  it('auto-resolves tier-0 conflicts', async () => {
    const repo = createInMemoryConflictsRepository();
    const conflict = await repo.open({
      tenantId: 't1',
      subject: { kind: 'parcel', id: 'P1' },
      conflictingProposalIds: ['p1', 'p2'],
    });
    const spawner = createReconciliationSpawner({
      kernel: stubKernel(0),
      repository: repo,
    });
    const result = await spawner.spawn('t1', conflict);
    expect(result.resolved).toBe(true);
    expect(result.tier).toBe(0);
    expect(result.surfacedToOwner).toBe(false);
    const unresolved = await repo.listUnresolved('t1');
    expect(unresolved.length).toBe(0);
  });

  it('surfaces tier-1+ conflicts to owner', async () => {
    const repo = createInMemoryConflictsRepository();
    const conflict = await repo.open({
      tenantId: 't1',
      subject: { kind: 'parcel', id: 'P1' },
      conflictingProposalIds: ['p1', 'p2'],
    });
    const spawner = createReconciliationSpawner({
      kernel: stubKernel(1),
      repository: repo,
    });
    const result = await spawner.spawn('t1', conflict);
    expect(result.resolved).toBe(false);
    expect(result.surfacedToOwner).toBe(true);
    const unresolved = await repo.listUnresolved('t1');
    expect(unresolved.length).toBe(1);
  });
});
