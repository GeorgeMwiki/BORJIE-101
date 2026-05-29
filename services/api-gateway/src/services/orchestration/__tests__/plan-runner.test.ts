/**
 * plan-runner tests — CE-2.
 *
 * Drives `runPlan` with stub dispatch + confirm hooks. Covers:
 *
 *   - autonomous low-stakes plan succeeds end-to-end
 *   - high-stakes step asks for confirmation; declines → cancelled
 *   - high-stakes step asks for confirmation; accepts → succeeds
 *   - failure short-circuits when stopOnFailure=true
 *   - failure leaves independent branches alive when stopOnFailure=false
 *   - dependent of failed step is marked 'skipped'
 *   - dispatcher exceptions are caught and become failed state
 *   - confirmation hook throws → cancelled with the throw message
 */

import { describe, it, expect, vi } from 'vitest';
import { runPlan } from '../plan-runner.js';
import { applyRiskTierPolicy, type PlanDag } from '../plan-dag.js';

const STEP_A = {
  id: 'a',
  toolId: 'mining.ui.navigate',
  input: { route: '/' },
  riskTier: 'low' as const,
  evidenceIds: [],
  labelEn: 'a',
  labelSw: 'a',
};
const STEP_B = {
  id: 'b',
  toolId: 'mining.ui.share_view',
  input: { entityType: 'draft', entityId: '1' },
  riskTier: 'medium' as const,
  evidenceIds: [],
  labelEn: 'b',
  labelSw: 'b',
};
const STEP_C = {
  id: 'c',
  toolId: 'owner.connected_agents.revoke',
  input: { tokenId: 't1', reason: 'rotation' },
  riskTier: 'high' as const,
  evidenceIds: [],
  labelEn: 'c',
  labelSw: 'c',
};

function plan(steps: PlanDag['steps'], edges: PlanDag['edges']): PlanDag {
  return applyRiskTierPolicy({
    planId: 'p1',
    intent: 't',
    steps,
    edges,
  });
}

describe('runPlan', () => {
  it('runs a low-stakes plan end-to-end without confirmation', async () => {
    const dispatch = vi.fn(async () => ({ ok: true, value: 'ok' }));
    const snap = await runPlan(plan([STEP_A], []), { dispatchTool: dispatch });
    expect(snap.status).toBe('succeeded');
    expect(snap.steps[0]!.state).toBe('succeeded');
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('cancels a checkpointed step when the user declines', async () => {
    const dispatch = vi.fn(async () => ({ ok: true }));
    const confirm = vi.fn(async () => ({ confirmed: false, reason: 'no' }));
    const snap = await runPlan(plan([STEP_B], []), {
      dispatchTool: dispatch,
      confirmCheckpoint: confirm,
    });
    expect(snap.steps[0]!.state).toBe('cancelled');
    expect(snap.status).toBe('cancelled');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('proceeds when the user confirms a checkpoint', async () => {
    const dispatch = vi.fn(async () => ({ ok: true, value: 42 }));
    const confirm = vi.fn(async () => ({ confirmed: true }));
    const snap = await runPlan(plan([STEP_C], []), {
      dispatchTool: dispatch,
      confirmCheckpoint: confirm,
    });
    expect(snap.steps[0]!.state).toBe('succeeded');
    expect(snap.steps[0]!.result).toBe(42);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('short-circuits the run on first failure (stopOnFailure=true default)', async () => {
    let i = 0;
    const dispatch = vi.fn(async () => {
      i += 1;
      if (i === 1) return { ok: false, error: 'boom' };
      return { ok: true };
    });
    const snap = await runPlan(
      plan(
        [
          STEP_A,
          { ...STEP_A, id: 'a2' },
        ],
        [{ from: 'a', to: 'a2' }],
      ),
      { dispatchTool: dispatch },
    );
    expect(snap.steps[0]!.state).toBe('failed');
    expect(snap.steps[0]!.error).toBe('boom');
    expect(snap.status).toBe('failed');
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('marks dependents of failed steps as skipped', async () => {
    const dispatch = vi.fn(async ({ stepId }) =>
      stepId === 'a' ? { ok: false, error: 'x' } : { ok: true },
    );
    const snap = await runPlan(
      plan(
        [
          STEP_A,
          { ...STEP_A, id: 'a2' },
        ],
        [{ from: 'a', to: 'a2' }],
      ),
      { dispatchTool: dispatch, stopOnFailure: false },
    );
    expect(snap.steps[0]!.state).toBe('failed');
    expect(snap.steps[1]!.state).toBe('skipped');
  });

  it('catches dispatcher exceptions and reports failed state', async () => {
    const dispatch = vi.fn(async () => {
      throw new Error('network down');
    });
    const snap = await runPlan(plan([STEP_A], []), { dispatchTool: dispatch });
    expect(snap.steps[0]!.state).toBe('failed');
    expect(snap.steps[0]!.error).toContain('network down');
  });

  it('catches confirmation hook exceptions and cancels', async () => {
    const dispatch = vi.fn(async () => ({ ok: true }));
    const confirm = vi.fn(async () => {
      throw new Error('user offline');
    });
    const snap = await runPlan(plan([STEP_B], []), {
      dispatchTool: dispatch,
      confirmCheckpoint: confirm,
    });
    expect(snap.steps[0]!.state).toBe('cancelled');
    expect(snap.steps[0]!.error).toContain('user offline');
  });

  it('refuses checkpointed steps when no confirm hook supplied', async () => {
    const dispatch = vi.fn(async () => ({ ok: true }));
    const snap = await runPlan(plan([STEP_B], []), { dispatchTool: dispatch });
    expect(snap.steps[0]!.state).toBe('cancelled');
  });

  it('throws on invalid plans (cycle / missing step)', async () => {
    const bad: PlanDag = {
      planId: 'p',
      intent: 't',
      steps: [STEP_A, { ...STEP_A, id: 'a2' }],
      edges: [
        { from: 'a', to: 'a2' },
        { from: 'a2', to: 'a' },
      ],
    };
    await expect(
      runPlan(bad, { dispatchTool: vi.fn() }),
    ).rejects.toThrow(/cycle/);
  });
});
