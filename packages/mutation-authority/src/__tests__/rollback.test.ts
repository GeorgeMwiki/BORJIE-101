import { describe, expect, it } from 'vitest';
import { rollbackMutation } from '../execution/rollback.js';
import type { MutationResult } from '../types.js';

const NOW = '2026-05-26T10:30:00.000Z';

function executedResult(
  overrides: Partial<MutationResult> = {},
): MutationResult {
  return {
    proposal_id: 'p-1',
    status: 'executed',
    executed_at: NOW,
    rollback_token: 'tok-1',
    side_effects_summary: 'ok',
    downstream_artifacts: [{ kind: 'parcel', id: 'p-1' }],
    audit_hash: 'h',
    ...overrides,
  };
}

describe('rollbackMutation', () => {
  it('rolls back a fully-reversible executed mutation', async () => {
    const calls: Array<ReadonlyArray<{ kind: string; id: string }>> = [];
    const out = await rollbackMutation({
      result: executedResult(),
      reversibility: 'fully',
      async rollbackFn(artifacts) {
        calls.push(artifacts);
        return { summary: 'parcel grade restored' };
      },
      nowIso: () => NOW,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.summary).toBe('parcel grade restored');
      expect(out.atIso).toBe(NOW);
      expect(out.audit_hash).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([{ kind: 'parcel', id: 'p-1' }]);
  });

  it('refuses when reversibility is not fully', async () => {
    const out = await rollbackMutation({
      result: executedResult(),
      reversibility: 'partial',
      async rollbackFn() {
        throw new Error('should not be called');
      },
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('not_reversible');
  });

  it('refuses when result is not executed', async () => {
    const out = await rollbackMutation({
      result: executedResult({ status: 'failed' }),
      reversibility: 'fully',
      async rollbackFn() {
        return { summary: 'should not be called' };
      },
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('not_executed');
  });

  it('refuses when token has been consumed (null)', async () => {
    const out = await rollbackMutation({
      result: executedResult({ rollback_token: null }),
      reversibility: 'fully',
      async rollbackFn() {
        return { summary: 'should not be called' };
      },
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('token_consumed');
  });

  it('returns rollback_threw when the rollbackFn throws', async () => {
    const out = await rollbackMutation({
      result: executedResult(),
      reversibility: 'fully',
      async rollbackFn() {
        throw new Error('database down');
      },
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe('rollback_threw');
      expect(out.message).toBe('database down');
    }
  });
});
