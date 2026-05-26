import { describe, expect, it } from 'vitest';
import { executeMutation } from '../execution/executor.js';
import { createInMemoryHistoryRepository } from '../execution/history-repository.js';
import { createInMemoryProposalRepository } from '../proposals/proposal-repository.js';
import { appendMutationAudit } from '../audit/audit-chain-link.js';
import type {
  ApprovalRecord,
  MutationProposal,
  MutationRecipe,
  MutationResult,
} from '../types.js';

const NOW = '2026-05-26T10:30:00.000Z';

function fakeProposal(
  overrides: Partial<MutationProposal> = {},
): MutationProposal {
  return {
    id: 'p-1',
    recipe_id: 'parcel_update',
    recipe_version: 1,
    tenant_id: 't-1',
    proposed_by: 'mr_mwikila',
    proposed_at: '2026-05-26T10:00:00.000Z',
    subject: { kind: 'parcel', id: 'p-1' },
    preview: { summary: 's', current: null, proposed: null },
    research_evidence_ids: [],
    cost_or_value_at_stake_usd_cents: 0,
    reversibility: 'fully',
    authority_tier: 1,
    requires_double_verify: false,
    expires_at: '2026-05-27T10:00:00.000Z',
    audit_hash: 'h',
    ...overrides,
  };
}

function fakeRecipe(
  exec: MutationRecipe['execute'],
  overrides: Partial<MutationRecipe> = {},
): MutationRecipe {
  return {
    id: 'parcel_update',
    class: 'data',
    version: 1,
    status: 'live',
    authority_tier: 1,
    is_critical: false,
    reversibility: 'fully',
    required_citations: [],
    brand: 'borjie',
    async compose() {
      throw new Error('compose not exercised');
    },
    execute: exec,
    ...overrides,
  };
}

describe('executeMutation', () => {
  it('runs the recipe and writes history when approvals are valid', async () => {
    const result: MutationResult = {
      proposal_id: 'p-1',
      status: 'executed',
      executed_at: NOW,
      rollback_token: 'tok-1',
      side_effects_summary: 'parcel grade updated',
      downstream_artifacts: [{ kind: 'parcel', id: 'p-1' }],
      audit_hash: 'hash',
    };
    const recipe = fakeRecipe(async () => result);
    const history = createInMemoryHistoryRepository();
    const out = await executeMutation({
      recipe,
      proposal: fakeProposal(),
      approvals: [],
      history,
    });
    expect(out.result.status).toBe('executed');
    const stored = await history.findByProposalId('p-1');
    expect(stored?.status).toBe('executed');
  });

  it('aborts when critical proposal lacks double-verify approvals', async () => {
    const recipe = fakeRecipe(async () => {
      throw new Error('should never be invoked');
    });
    const proposal = fakeProposal({
      authority_tier: 2,
      requires_double_verify: true,
    });
    const history = createInMemoryHistoryRepository();
    const out = await executeMutation({
      recipe,
      proposal,
      approvals: [],
      history,
    });
    expect(out.result.status).toBe('aborted');
    expect(out.result.side_effects_summary).toContain('missing_double_verify');
  });

  it('marks as failed when the recipe throws', async () => {
    const recipe = fakeRecipe(async () => {
      throw new Error('boom');
    });
    const history = createInMemoryHistoryRepository();
    const out = await executeMutation({
      recipe,
      proposal: fakeProposal(),
      approvals: [],
      history,
      nowIso: () => NOW,
    });
    expect(out.result.status).toBe('failed');
    expect(out.result.side_effects_summary).toContain('boom');
  });

  it('refuses to overwrite history (append-only)', async () => {
    const result: MutationResult = {
      proposal_id: 'p-1',
      status: 'executed',
      executed_at: NOW,
      rollback_token: null,
      side_effects_summary: 'ok',
      downstream_artifacts: [],
      audit_hash: 'hash',
    };
    const history = createInMemoryHistoryRepository();
    await history.save(result);
    await expect(history.save(result)).rejects.toThrow(/append-only/);
  });
});

describe('proposal repository — pending queue', () => {
  it('lists proposals matching the requested statuses', async () => {
    const repo = createInMemoryProposalRepository();
    const a = fakeProposal({ id: 'p-a' });
    const b = fakeProposal({ id: 'p-b' });
    await repo.save(a);
    await repo.save(b);
    await repo.updateStatus('p-b', 'approved_primary');
    const pending = await repo.listForUser('any', ['pending']);
    expect(pending.map((p) => p.id)).toEqual(['p-a']);
    const advanced = await repo.listForUser('any', ['approved_primary']);
    expect(advanced.map((p) => p.id)).toEqual(['p-b']);
  });
});

describe('audit-chain-link', () => {
  it('chains a composed → approval → executed sequence', () => {
    const proposal = fakeProposal();
    let chain = appendMutationAudit([], { kind: 'composed', proposal });
    const approval: ApprovalRecord = {
      proposal_id: proposal.id,
      approver_user_id: 'owner',
      approver_role: 'owner',
      decision: 'approved',
      reasoning: 'r',
      decided_at: NOW,
      audit_hash: 'h',
    };
    chain = appendMutationAudit(chain, { kind: 'approval', approval });
    const result: MutationResult = {
      proposal_id: proposal.id,
      status: 'executed',
      executed_at: NOW,
      rollback_token: null,
      side_effects_summary: 'ok',
      downstream_artifacts: [],
      audit_hash: 'h',
    };
    chain = appendMutationAudit(chain, { kind: 'executed', result });
    expect(chain).toHaveLength(3);
    expect(chain[0]?.payload['kind']).toBe('mutation_proposal_composed');
    expect(chain[1]?.payload['kind']).toBe('mutation_approval_recorded');
    expect(chain[2]?.payload['kind']).toBe('mutation_executed');
  });
});
