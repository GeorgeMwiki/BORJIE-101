/**
 * Resumption-brief tests — token-budgeted size, bucketing, persona.
 */

import { describe, it, expect } from 'vitest';

import { createInMemoryJournalRepository } from '../journal/journal-repository.js';
import {
  assertNoJuniorLeak,
  createBuildResumptionBrief,
  DEFAULT_TOKEN_BUDGET,
} from '../resumption/resumption-brief.js';
import { createInMemoryStateRepository } from '../state/state-repository.js';
import type { TickInput, TickOutput } from '../types.js';

const baseInputs: TickInput = {
  tenant_id: 't',
  tick_no: 0n,
  mode: 'night',
  last_hash: null,
  recall: [],
  pending_threads: [],
  clock_iso: '2026-05-26T02:00:00.000Z',
};

async function seedTicks(args: {
  readonly outputs: ReadonlyArray<TickOutput>;
  readonly tenantId?: string;
}): Promise<{
  readonly journal: ReturnType<typeof createInMemoryJournalRepository>;
  readonly state: ReturnType<typeof createInMemoryStateRepository>;
}> {
  const tenant = args.tenantId ?? 't';
  const journal = createInMemoryJournalRepository();
  const state = createInMemoryStateRepository();
  let prev: string | null = null;
  for (let i = 0; i < args.outputs.length; i += 1) {
    const tickNo = BigInt(i + 1);
    const entry = await journal.append({
      tenant_id: tenant,
      tick_no: tickNo,
      started_at: `2026-05-26T02:${String(i).padStart(2, '0')}:00.000Z`,
      ended_at: `2026-05-26T02:${String(i).padStart(2, '0')}:01.000Z`,
      mode: 'night',
      inputs: { ...baseInputs, tick_no: tickNo },
      outputs: args.outputs[i] as TickOutput,
      cost_usd_cents: 0,
      prev_hash: prev,
    });
    prev = entry.audit_hash;
    await state.applyTickResult({
      tenantId: tenant,
      tickNo,
      tickAtIso: entry.ended_at,
      nextMode: 'night',
      pendingThreads: [],
    });
  }
  return { journal, state };
}

describe('resumption-brief / basic shape', () => {
  it('returns a genesis brief when no ticks ran', async () => {
    const build = createBuildResumptionBrief({
      journalRepo: createInMemoryJournalRepository(),
      stateRepo: createInMemoryStateRepository(),
    });
    const brief = await build({ tenantId: 'never-ran' });
    expect(brief.headline).toMatch(/awaiting his first tick/);
    expect(brief.completed_overnight).toEqual([]);
    expect(brief.last_tick_at).toBeNull();
  });

  it('summarises completed sweeps as one collapsed line', async () => {
    const { journal, state } = await seedTicks({
      outputs: [
        sweepOutput('sweep 1'),
        sweepOutput('sweep 2'),
        sweepOutput('sweep 3'),
      ],
    });
    const build = createBuildResumptionBrief({
      journalRepo: journal,
      stateRepo: state,
    });
    const brief = await build({ tenantId: 't' });
    const collapsedLine = brief.completed_overnight.find((l) =>
      l.startsWith('Ran 3 anticipatory sweep'),
    );
    expect(collapsedLine).toBeDefined();
  });

  it('surfaces awaiting_approval entries', async () => {
    const { journal, state } = await seedTicks({
      outputs: [
        sweepOutput('sweep'),
        {
          status: 'completed',
          kind: 'draft',
          summary: 'Mr. Mwikila drafted a Tumemadini Q2 return.',
          artifact_refs: [],
          requires_owner_attention: true,
        },
      ],
    });
    const build = createBuildResumptionBrief({
      journalRepo: journal,
      stateRepo: state,
    });
    const brief = await build({ tenantId: 't' });
    expect(brief.awaiting_approval).toEqual([
      'Mr. Mwikila drafted a Tumemadini Q2 return.',
    ]);
  });

  it('surfaces killswitch failed entries into escalations', async () => {
    const { journal, state } = await seedTicks({
      outputs: [
        {
          status: 'failed',
          kind: 'investigate',
          summary: 'Killswitch fired on hedge proposal.',
          reason: 'killswitch',
          artifact_refs: [],
          requires_owner_attention: true,
        },
      ],
    });
    const build = createBuildResumptionBrief({
      journalRepo: journal,
      stateRepo: state,
    });
    const brief = await build({ tenantId: 't' });
    expect(brief.escalations).toContain('Killswitch fired on hedge proposal.');
  });
});

describe('resumption-brief / token budget', () => {
  it('truncates when token budget exceeded', async () => {
    const longLine = 'a'.repeat(500);
    const outputs: TickOutput[] = Array.from({ length: 10 }, (_, i) => ({
      status: 'completed',
      kind: 'investigate',
      summary: `${longLine} ${i}`,
      artifact_refs: [],
      requires_owner_attention: false,
    }));
    const { journal, state } = await seedTicks({ outputs });
    const build = createBuildResumptionBrief({
      journalRepo: journal,
      stateRepo: state,
    });
    const brief = await build({ tenantId: 't', tokenBudget: 200 });
    expect(brief.token_estimate).toBeLessThanOrEqual(
      200 + estimateTokens(brief.headline) + 50,
    );
    expect(brief.headline).toMatch(/truncated/);
  });

  it('respects default token budget when none provided', async () => {
    const { journal, state } = await seedTicks({
      outputs: [sweepOutput('one'), sweepOutput('two')],
    });
    const build = createBuildResumptionBrief({
      journalRepo: journal,
      stateRepo: state,
    });
    const brief = await build({ tenantId: 't' });
    expect(brief.token_estimate).toBeLessThan(DEFAULT_TOKEN_BUDGET);
  });

  it('persona-leak guard rejects any junior name in the brief', async () => {
    const brief = {
      headline: 'Mr. Mwikila ran 2 ticks',
      pending_threads: [],
      completed_overnight: ['junior-fx-treasury closed the trade'],
      awaiting_approval: [],
      escalations: [],
      last_tick_at: null,
      token_estimate: 5,
    };
    expect(() =>
      assertNoJuniorLeak(brief, ['junior-fx-treasury']),
    ).toThrow(/leaked/);
  });
});

function sweepOutput(summary: string): TickOutput {
  return {
    status: 'completed',
    kind: 'sweep',
    summary,
    artifact_refs: [],
    requires_owner_attention: false,
  };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
