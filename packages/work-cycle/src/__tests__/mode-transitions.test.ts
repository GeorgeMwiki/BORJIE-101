/**
 * Mode transition tests — manual switchMode + state.applyTickResult
 * cooperate to produce a coherent audit trail.
 */

import { describe, it, expect } from 'vitest';

import {
  createBudgetGate,
  createInMemoryBudgetLedger,
} from '../budget/night-budget.js';
import { createInMemoryJournalRepository } from '../journal/journal-repository.js';
import { createInMemoryStateRepository } from '../state/state-repository.js';
import {
  createDefaultPolicyGate,
  createNullMemoryPort,
  createPassThroughQualityGate,
  type ToolBag,
} from '../tick/ports.js';
import { createTickRunner } from '../tick/tick-runner.js';

function sweepBag(): ToolBag {
  return {
    async selectAndInvoke() {
      return {
        tool_id: 'telemetry_sweep_v1',
        tier: 't0' as const,
        output: {
          status: 'completed' as const,
          kind: 'sweep' as const,
          summary: 'Mr. Mwikila ran a telemetry sweep.',
          artifact_refs: [],
          requires_owner_attention: false,
        },
        estimated_cost_usd_cents: 0,
      };
    },
  };
}

describe('mode-transitions', () => {
  it('switches mode mid-cycle via state.switchMode', async () => {
    const stateRepo = createInMemoryStateRepository();
    await stateRepo.applyTickResult({
      tenantId: 't',
      tickNo: 1n,
      tickAtIso: '2026-05-26T10:00:00.000Z',
      nextMode: 'idle',
      pendingThreads: [],
    });
    const switched = await stateRepo.switchMode('t', 'night');
    expect(switched.current_mode).toBe('night');
    expect(switched.last_tick_no).toBe(1n);
  });

  it('runner uses the state-current mode when not overridden', async () => {
    const stateRepo = createInMemoryStateRepository();
    await stateRepo.switchMode('t', 'night');
    const runner = createTickRunner({
      policyGate: createDefaultPolicyGate(),
      toolBag: sweepBag(),
      qualityGate: createPassThroughQualityGate(),
      memoryPort: createNullMemoryPort(),
      journalRepo: createInMemoryJournalRepository(),
      stateRepo,
      budgetGate: createBudgetGate({ ledger: createInMemoryBudgetLedger() }),
    });
    const entry = await runner.runOne({ tenantId: 't' });
    expect(entry.mode).toBe('night');
  });

  it('runner can override mode for one tick via the mode argument', async () => {
    const stateRepo = createInMemoryStateRepository();
    await stateRepo.switchMode('t', 'idle');
    const runner = createTickRunner({
      policyGate: createDefaultPolicyGate(),
      toolBag: sweepBag(),
      qualityGate: createPassThroughQualityGate(),
      memoryPort: createNullMemoryPort(),
      journalRepo: createInMemoryJournalRepository(),
      stateRepo,
      budgetGate: createBudgetGate({ ledger: createInMemoryBudgetLedger() }),
    });
    const entry = await runner.runOne({ tenantId: 't', mode: 'observe' });
    expect(entry.mode).toBe('observe');
    expect(entry.outputs.status).toBe('completed'); // T0 sweep is allowed in observe
  });

  it('observe mode blocks T1 even when night-allowlisted', async () => {
    const t1Bag: ToolBag = {
      async selectAndInvoke() {
        return {
          tool_id: 'draft_v1',
          tier: 't1',
          output: {
            status: 'completed',
            kind: 'draft',
            summary: 'Mr. Mwikila tried to draft.',
            artifact_refs: [],
            requires_owner_attention: false,
          },
          estimated_cost_usd_cents: 5,
        };
      },
    };
    const runner = createTickRunner({
      policyGate: createDefaultPolicyGate({ nightAllowlist: ['draft_v1'] }),
      toolBag: t1Bag,
      qualityGate: createPassThroughQualityGate(),
      memoryPort: createNullMemoryPort(),
      journalRepo: createInMemoryJournalRepository(),
      stateRepo: createInMemoryStateRepository(),
      budgetGate: createBudgetGate({ ledger: createInMemoryBudgetLedger() }),
    });
    const entry = await runner.runOne({ tenantId: 't', mode: 'observe' });
    expect(entry.outputs.status).toBe('failed');
    expect(entry.outputs.reason).toBe('tier_blocked');
  });

  it('switching mode does not advance tick_no', async () => {
    const stateRepo = createInMemoryStateRepository();
    await stateRepo.applyTickResult({
      tenantId: 't',
      tickNo: 1n,
      tickAtIso: '2026-05-26T10:00:00.000Z',
      nextMode: 'idle',
      pendingThreads: [],
    });
    const before = await stateRepo.read('t');
    const after = await stateRepo.switchMode('t', 'night');
    expect(after.last_tick_no).toBe(before?.last_tick_no);
  });
});
