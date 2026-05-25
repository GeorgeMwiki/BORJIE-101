import { describe, expect, test } from 'vitest';
import {
  evaluatePreconditions,
  createPermissivePreconditionPorts,
} from '../preconditions.js';

describe('action-runtime preconditions', () => {
  const baseCtx = {
    tenantId: 't',
    personaId: 'p',
    planId: 'ap_1',
    stepIndex: 0,
    stepKind: 'POST_LEDGER',
    toolCallRef: 'ref_1',
    requiredMicros: 5_000,
    succeededStepIndices: [],
  };

  test('all permissive ports → ok', async () => {
    const r = await evaluatePreconditions({
      preconditions: [
        { kind: 'kill_switch_open' },
        { kind: 'persona_still_bound' },
        { kind: 'budget_remaining' },
      ],
      context: baseCtx,
      ports: createPermissivePreconditionPorts(),
    });
    expect(r.ok).toBe(true);
  });

  test('fail-closed on handler exception', async () => {
    const r = await evaluatePreconditions({
      preconditions: [{ kind: 'kill_switch_open', failureMessage: 'kill is open' }],
      context: baseCtx,
      ports: {
        ...createPermissivePreconditionPorts(),
        isKillSwitchOpen: async () => {
          throw new Error('db unavailable');
        },
      },
    });
    expect(r.ok).toBe(false);
    expect(r.failures[0]?.message).toContain('db unavailable');
  });

  test('reports all failures, not just the first', async () => {
    const r = await evaluatePreconditions({
      preconditions: [
        { kind: 'kill_switch_open', failureMessage: 'kill-switch open' },
        { kind: 'budget_remaining', failureMessage: 'no budget' },
      ],
      context: baseCtx,
      ports: {
        ...createPermissivePreconditionPorts(),
        isKillSwitchOpen: async () => false,
        hasBudgetRemaining: async () => false,
      },
    });
    expect(r.ok).toBe(false);
    expect(r.failures).toHaveLength(2);
  });

  test('parent_step_succeeded matches succeededStepIndices', async () => {
    const r = await evaluatePreconditions({
      preconditions: [
        { kind: 'parent_step_succeeded', params: { stepIndex: 2 } },
      ],
      context: { ...baseCtx, succeededStepIndices: [0, 1, 2] },
      ports: createPermissivePreconditionPorts(),
    });
    expect(r.ok).toBe(true);
  });

  test('parent_step_succeeded fails when index not in list', async () => {
    const r = await evaluatePreconditions({
      preconditions: [
        { kind: 'parent_step_succeeded', params: { stepIndex: 5 } },
      ],
      context: { ...baseCtx, succeededStepIndices: [0, 1, 2] },
      ports: createPermissivePreconditionPorts(),
    });
    expect(r.ok).toBe(false);
  });

  test('idempotency_unconsumed with null toolCallRef → pass', async () => {
    const r = await evaluatePreconditions({
      preconditions: [{ kind: 'idempotency_unconsumed' }],
      context: { ...baseCtx, toolCallRef: null },
      ports: createPermissivePreconditionPorts(),
    });
    expect(r.ok).toBe(true);
  });

  test('expression precondition is permissive by default', async () => {
    const r = await evaluatePreconditions({
      preconditions: [{ kind: 'expression', params: { x: 1 } }],
      context: baseCtx,
      ports: createPermissivePreconditionPorts(),
    });
    expect(r.ok).toBe(true);
  });
});
