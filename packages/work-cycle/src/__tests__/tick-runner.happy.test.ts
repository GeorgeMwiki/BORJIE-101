/**
 * Tick-runner happy-path orchestration (spec §3).
 *
 * Walks one tick through: policy gate → tool call → quality gate →
 * journal write → state advance → budget record.
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
  type ToolInvocation,
} from '../tick/ports.js';
import { createTickRunner } from '../tick/tick-runner.js';
import type { TickInput } from '../types.js';

function fixedClock(...iso: string[]): () => Date {
  let i = 0;
  return () => {
    const next = iso[Math.min(i, iso.length - 1)];
    i += 1;
    return new Date(next as string);
  };
}

function makeSweepToolBag(invocation: Partial<ToolInvocation> = {}): ToolBag {
  return {
    async selectAndInvoke(_input: TickInput) {
      const result: ToolInvocation = {
        tool_id: 'telemetry_sweep_v1',
        tier: 't0',
        output: {
          status: 'completed',
          kind: 'sweep',
          summary:
            'Mr. Mwikila swept telemetry — no anomalies on the cyanide-leach pad.',
          artifact_refs: [{ kind: 'sweep_report', id: 'sr-1' }],
          requires_owner_attention: false,
        },
        estimated_cost_usd_cents: 5,
        ...invocation,
      };
      return result;
    },
  };
}

describe('tick-runner / happy path', () => {
  it('runs a tick and writes a completed journal entry', async () => {
    const journal = createInMemoryJournalRepository();
    const stateRepo = createInMemoryStateRepository();
    // Pin the ledger's "now" to the same simulated tick clock so the
    // 24h rolling window check on the recorded spend is deterministic
    // regardless of when the suite is actually run.
    const ledger = createInMemoryBudgetLedger({
      now: () => new Date('2026-05-26T02:00:00.501Z'),
    });
    const runner = createTickRunner({
      policyGate: createDefaultPolicyGate(),
      toolBag: makeSweepToolBag(),
      qualityGate: createPassThroughQualityGate(),
      memoryPort: createNullMemoryPort(),
      journalRepo: journal,
      stateRepo,
      budgetGate: createBudgetGate({ ledger }),
      clock: fixedClock(
        '2026-05-26T02:00:00.000Z',
        '2026-05-26T02:00:00.500Z',
        '2026-05-26T02:00:00.501Z',
      ),
    });

    const entry = await runner.runOne({ tenantId: 't1', mode: 'night' });
    expect(entry.tick_no).toBe(1n);
    expect(entry.outputs.status).toBe('completed');
    expect(entry.outputs.kind).toBe('sweep');
    expect(entry.cost_usd_cents).toBe(5);
    expect(entry.prev_hash).toBeNull();
    expect(entry.audit_hash).toMatch(/^[0-9a-f]{64}$/);

    // State advanced.
    const state = await stateRepo.read('t1');
    expect(state?.last_tick_no).toBe(1n);
    expect(state?.last_tick_at).toBe('2026-05-26T02:00:00.500Z');

    // Budget recorded.
    expect(await ledger.spentLast24hCents('t1')).toBe(5);
  });

  it('chains consecutive ticks with prev_hash', async () => {
    const journal = createInMemoryJournalRepository();
    const stateRepo = createInMemoryStateRepository();
    const ledger = createInMemoryBudgetLedger();
    const runner = createTickRunner({
      policyGate: createDefaultPolicyGate(),
      toolBag: makeSweepToolBag(),
      qualityGate: createPassThroughQualityGate(),
      memoryPort: createNullMemoryPort(),
      journalRepo: journal,
      stateRepo,
      budgetGate: createBudgetGate({ ledger }),
      clock: fixedClock(
        '2026-05-26T02:00:00.000Z',
        '2026-05-26T02:00:00.500Z',
        '2026-05-26T02:15:00.000Z',
        '2026-05-26T02:15:00.500Z',
      ),
    });

    const a = await runner.runOne({ tenantId: 't1', mode: 'night' });
    const b = await runner.runOne({ tenantId: 't1', mode: 'night' });
    expect(b.prev_hash).toBe(a.audit_hash);
    expect(b.tick_no).toBe(2n);
  });

  it('persists artifact_refs through the journal', async () => {
    const journal = createInMemoryJournalRepository();
    const runner = createTickRunner({
      policyGate: createDefaultPolicyGate(),
      toolBag: makeSweepToolBag(),
      qualityGate: createPassThroughQualityGate(),
      memoryPort: createNullMemoryPort(),
      journalRepo: journal,
      stateRepo: createInMemoryStateRepository(),
      budgetGate: createBudgetGate({ ledger: createInMemoryBudgetLedger() }),
    });
    const entry = await runner.runOne({ tenantId: 't1', mode: 'night' });
    expect(entry.outputs.artifact_refs).toEqual([
      { kind: 'sweep_report', id: 'sr-1' },
    ]);
  });

  it('falls back to skipped when no tool fits', async () => {
    const noopBag: ToolBag = {
      async selectAndInvoke() {
        return null;
      },
    };
    const runner = createTickRunner({
      policyGate: createDefaultPolicyGate(),
      toolBag: noopBag,
      qualityGate: createPassThroughQualityGate(),
      memoryPort: createNullMemoryPort(),
      journalRepo: createInMemoryJournalRepository(),
      stateRepo: createInMemoryStateRepository(),
      budgetGate: createBudgetGate({ ledger: createInMemoryBudgetLedger() }),
    });
    const entry = await runner.runOne({ tenantId: 't1', mode: 'idle' });
    expect(entry.outputs.status).toBe('skipped');
    expect(entry.outputs.reason).toBe('no_tool');
    expect(entry.cost_usd_cents).toBe(0);
  });
});
