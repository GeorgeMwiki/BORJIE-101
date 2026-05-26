import { describe, expect, it } from 'vitest';
import { createProposalRepository } from '../storage/proposal-repository.js';
import type { RecipeDb } from '../storage/recipe-repository.js';
import type { ProposedDiff } from '../types.js';

function fakeDb(handler: (query: string, params: ReadonlyArray<unknown>) => unknown): RecipeDb {
  return {
    async query<T = unknown>(query: string, params: ReadonlyArray<unknown> = []) {
      const out = handler(query, params);
      return (Array.isArray(out) ? out : []) as ReadonlyArray<T>;
    },
  };
}

const DIFF: ProposedDiff = {
  ops: [
    {
      op: 'rename_label',
      fieldId: 'f1',
      labelEnBefore: 'A',
      labelEnAfter: 'B',
      labelSwBefore: 'A',
      labelSwAfter: 'B',
    },
  ],
  rationaleEn: 'Reasonable explanation',
  rationaleSw: 'Maelezo yenye mantiki',
};

describe('createProposalRepository.insertPending', () => {
  it('returns the mapped proposal row', async () => {
    const repo = createProposalRepository(
      fakeDb(() => [
        {
          id: 'p-1',
          tenant_id: 't1',
          tab_recipe_id: 'r',
          current_version: 1,
          proposed_version: 2,
          proposed_schema_diff: JSON.stringify(DIFF),
          signals: JSON.stringify([]),
          citations: ['C1', 'C2'],
          status: 'pending',
          proposed_at: '2026-05-10T02:00:00.000Z',
        },
      ]),
    );
    const out = await repo.insertPending({
      tenantId: 't1',
      tabRecipeId: 'r',
      currentVersion: 1,
      proposedVersion: 2,
      diff: DIFF,
      signals: [],
      citations: ['C1', 'C2'],
    });
    expect(out.id).toBe('p-1');
    expect(out.tabRecipeId).toBe('r');
    expect(out.proposedSchemaDiff.ops[0]?.op).toBe('rename_label');
    expect(out.citations).toEqual(['C1', 'C2']);
  });

  it('throws when insert returns zero rows', async () => {
    const repo = createProposalRepository(fakeDb(() => []));
    await expect(
      repo.insertPending({
        tenantId: 't1',
        tabRecipeId: 'r',
        currentVersion: 1,
        proposedVersion: 2,
        diff: DIFF,
        signals: [],
        citations: [],
      }),
    ).rejects.toThrow();
  });
});

describe('createProposalRepository.hasPendingProposalFor', () => {
  it('returns true when a row exists', async () => {
    const repo = createProposalRepository(fakeDb(() => [{ exists: 1 }]));
    expect(
      await repo.hasPendingProposalFor({
        tenantId: 't1',
        tabRecipeId: 'r',
        currentVersion: 1,
      }),
    ).toBe(true);
  });
  it('returns false when no row exists', async () => {
    const repo = createProposalRepository(fakeDb(() => []));
    expect(
      await repo.hasPendingProposalFor({
        tenantId: 't1',
        tabRecipeId: 'r',
        currentVersion: 1,
      }),
    ).toBe(false);
  });
});

describe('createProposalRepository.findById', () => {
  it('returns null when not found', async () => {
    const repo = createProposalRepository(fakeDb(() => []));
    expect(await repo.findById('missing')).toBeNull();
  });
  it('maps the row', async () => {
    const repo = createProposalRepository(
      fakeDb(() => [
        {
          id: 'p-1',
          tenant_id: 't1',
          tab_recipe_id: 'r',
          current_version: 1,
          proposed_version: 2,
          proposed_schema_diff: DIFF, // not a string — object passed through
          signals: [],
          citations: ['C1'],
          status: 'approved',
          proposed_at: '2026-05-10T02:00:00.000Z',
          reviewed_at: '2026-05-11T02:00:00.000Z',
          reviewed_by: 'reviewer-1',
          reviewer_reason: 'Looks good',
          rollout_strategy: 'gradual',
          approval_audit_hash: 'h1',
        },
      ]),
    );
    const out = await repo.findById('p-1');
    expect(out?.status).toBe('approved');
    expect(out?.reviewedBy).toBe('reviewer-1');
    expect(out?.rolloutStrategy).toBe('gradual');
  });
});

describe('createProposalRepository.updateStatus', () => {
  it('passes through to UPDATE', async () => {
    const calls: Array<{ params: ReadonlyArray<unknown> }> = [];
    const repo = createProposalRepository(
      fakeDb((query, params) => {
        calls.push({ params });
        return [];
      }),
    );
    await repo.updateStatus({
      id: 'p-1',
      nextStatus: 'approved',
      reviewedBy: 'owner',
      rolloutStrategy: 'a_b',
      approvalAuditHash: 'h',
    });
    expect(calls[0]?.params[0]).toBe('p-1');
    expect(calls[0]?.params[1]).toBe('approved');
  });
});
