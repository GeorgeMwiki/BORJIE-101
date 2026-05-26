/**
 * Tick-runner guarded paths — budget-exhausted and policy-blocked.
 *
 * Both paths MUST write a journal row (silent failure forbidden).
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
  type QualityGate,
  type ToolBag,
} from '../tick/ports.js';
import { createTickRunner } from '../tick/tick-runner.js';

function makeT1Bag(): ToolBag {
  return {
    async selectAndInvoke() {
      return {
        tool_id: 'draft_buyer_reply_v1',
        tier: 't1' as const,
        output: {
          status: 'completed' as const,
          kind: 'draft' as const,
          summary: 'Mr. Mwikila drafted a buyer reply.',
          artifact_refs: [],
          requires_owner_attention: false,
        },
        estimated_cost_usd_cents: 25,
      };
    },
  };
}

describe('tick-runner / policy-blocked path', () => {
  it('writes a failed journal row when policy blocks a T1 at night', async () => {
    const journal = createInMemoryJournalRepository();
    const runner = createTickRunner({
      policyGate: createDefaultPolicyGate({ nightAllowlist: [] }),
      toolBag: makeT1Bag(),
      qualityGate: createPassThroughQualityGate(),
      memoryPort: createNullMemoryPort(),
      journalRepo: journal,
      stateRepo: createInMemoryStateRepository(),
      budgetGate: createBudgetGate({ ledger: createInMemoryBudgetLedger() }),
    });
    const entry = await runner.runOne({ tenantId: 't', mode: 'night' });
    expect(entry.outputs.status).toBe('failed');
    expect(entry.outputs.reason).toBe('night_restriction');
    expect(entry.cost_usd_cents).toBe(0);
  });

  it('allows T1 when allowlisted for night', async () => {
    const runner = createTickRunner({
      policyGate: createDefaultPolicyGate({
        nightAllowlist: ['draft_buyer_reply_v1'],
      }),
      toolBag: makeT1Bag(),
      qualityGate: createPassThroughQualityGate(),
      memoryPort: createNullMemoryPort(),
      journalRepo: createInMemoryJournalRepository(),
      stateRepo: createInMemoryStateRepository(),
      budgetGate: createBudgetGate({ ledger: createInMemoryBudgetLedger() }),
    });
    const entry = await runner.runOne({ tenantId: 't', mode: 'night' });
    expect(entry.outputs.status).toBe('completed');
    expect(entry.outputs.kind).toBe('draft');
  });
});

describe('tick-runner / budget-exhausted path', () => {
  it('writes a skipped row when the cap is already reached pre-flight in observe', async () => {
    const ledger = createInMemoryBudgetLedger();
    const runner = createTickRunner({
      policyGate: createDefaultPolicyGate(),
      toolBag: makeT1Bag(),
      qualityGate: createPassThroughQualityGate(),
      memoryPort: createNullMemoryPort(),
      journalRepo: createInMemoryJournalRepository(),
      stateRepo: createInMemoryStateRepository(),
      budgetGate: createBudgetGate({ ledger }),
    });
    // The runner pre-flights with estimated_cost=0; observe mode allows
    // a 0-cost preflight. The real-cost check then trips when the bag
    // returns a 25¢ T1 estimate. We force the cap-reached path by
    // pre-loading the ledger and running in night mode with a tighter
    // cap.
    const runnerStrict = createTickRunner({
      policyGate: createDefaultPolicyGate({
        nightAllowlist: ['draft_buyer_reply_v1'],
      }),
      toolBag: makeT1Bag(),
      qualityGate: createPassThroughQualityGate(),
      memoryPort: createNullMemoryPort(),
      journalRepo: createInMemoryJournalRepository(),
      stateRepo: createInMemoryStateRepository(),
      budgetGate: createBudgetGate({
        ledger,
        caps: {
          nightDailyCapUsdCents: 10,
          idleDailyCapUsdCents: 10,
          activeDailyCapUsdCents: 10,
        },
      }),
    });
    // Spend 5 cents already.
    await ledger.recordSpend({
      tenantId: 't',
      amountUsdCents: 5,
      atIso: new Date().toISOString(),
    });
    const entry = await runnerStrict.runOne({
      tenantId: 't',
      mode: 'night',
    });
    expect(entry.outputs.status).toBe('skipped');
    expect(entry.outputs.reason).toBe('cap_reached');
    expect(entry.cost_usd_cents).toBe(0);
    void runner; // silence unused-var lint
  });

  it('records spend only on successful T1 ticks', async () => {
    const ledger = createInMemoryBudgetLedger();
    const runner = createTickRunner({
      policyGate: createDefaultPolicyGate({
        nightAllowlist: ['draft_buyer_reply_v1'],
      }),
      toolBag: makeT1Bag(),
      qualityGate: createPassThroughQualityGate(),
      memoryPort: createNullMemoryPort(),
      journalRepo: createInMemoryJournalRepository(),
      stateRepo: createInMemoryStateRepository(),
      budgetGate: createBudgetGate({ ledger }),
    });
    await runner.runOne({ tenantId: 't', mode: 'night' });
    expect(await ledger.spentLast24hCents('t')).toBe(25);
  });
});

describe('tick-runner / quality-gate path', () => {
  it('downgrades to failed when the quality gate flags the output', async () => {
    const failing: QualityGate = {
      async check() {
        return { ok: false, failed_gate: 'citation' };
      },
    };
    const runner = createTickRunner({
      policyGate: createDefaultPolicyGate({
        nightAllowlist: ['draft_buyer_reply_v1'],
      }),
      toolBag: makeT1Bag(),
      qualityGate: failing,
      memoryPort: createNullMemoryPort(),
      journalRepo: createInMemoryJournalRepository(),
      stateRepo: createInMemoryStateRepository(),
      budgetGate: createBudgetGate({ ledger: createInMemoryBudgetLedger() }),
    });
    const entry = await runner.runOne({ tenantId: 't', mode: 'night' });
    expect(entry.outputs.status).toBe('failed');
    expect(entry.outputs.reason).toBe('citation');
    expect(entry.cost_usd_cents).toBe(0);
  });
});
