import { describe, it, expect } from 'vitest';
import { createPivotProposer, type PivotComposerPort } from '../pivot/pivot-proposer.js';
import { createInMemoryPivotProposalsRepository } from '../repositories/pivot-proposals-repository.js';
import type { NorthStar } from '../types.js';
import { InvalidStateTransition } from '../types.js';

const baseObjective: NorthStar = Object.freeze({
  id: 'obj-1',
  tenantId: 't1',
  scopeId: 'tenant_root',
  title: 'Q3 royalty target',
  description: 'desc',
  metricName: 'royalty_revenue_tzs',
  targetValue: 1_000_000_000,
  targetAt: new Date('2026-09-30T23:59:59.000Z').toISOString(),
  status: 'active',
  ownerUserId: 'owner-1',
  createdAt: new Date('2026-05-01T00:00:00.000Z').toISOString(),
  updatedAt: new Date('2026-05-01T00:00:00.000Z').toISOString(),
  auditHash: 'h0'.padEnd(64, '0'),
  prevHash: null,
});

const fakeComposer: PivotComposerPort = {
  async compose() {
    return {
      rationale:
        'Royalty revenue grew 4% MoM vs the 12% required to hit Q3 target. The gold-window FX regime has shifted; retargeting to TZS 800M is more credible.',
      shape: 'retarget',
      evidence: { citations: ['ev-1', 'ev-2'] },
    };
  },
};

describe('PivotProposer', () => {
  it('proposes a pivot with audit-chained hash + open status', async () => {
    const repo = createInMemoryPivotProposalsRepository();
    const proposer = createPivotProposer({
      repo,
      composer: fakeComposer,
      now: () => new Date('2026-06-10T00:00:00.000Z'),
    });
    const proposal = await proposer.composeAndPropose({
      tenantId: 't1',
      objective: baseObjective,
      progress: [],
    });
    expect(proposal.status).toBe('open');
    expect(proposal.tenantId).toBe('t1');
    expect(proposal.objectiveId).toBe('obj-1');
    expect(proposal.auditHash.length).toBe(64);
    expect(
      (proposal.evidence as { readonly shape: unknown }).shape,
    ).toBe('retarget');
  });

  it('accepts an open pivot proposal and refuses to re-decide it', async () => {
    const repo = createInMemoryPivotProposalsRepository();
    const proposer = createPivotProposer({
      repo,
      composer: fakeComposer,
      now: () => new Date('2026-06-10T00:00:00.000Z'),
    });
    const proposal = await proposer.composeAndPropose({
      tenantId: 't1',
      objective: baseObjective,
      progress: [],
    });
    const accepted = await proposer.accept('t1', proposal.id, 'owner-1');
    expect(accepted.status).toBe('accepted');
    expect(accepted.decidedBy).toBe('owner-1');
    expect(accepted.decidedAt).not.toBeNull();
    await expect(
      proposer.reject('t1', proposal.id, 'owner-1'),
    ).rejects.toBeInstanceOf(InvalidStateTransition);
  });
});
