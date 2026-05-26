import { describe, expect, it } from 'vitest';
import { decideLock, type LockCandidateLedger } from '../decisions/lock-decision.js';
import type { FitnessReport, RecipeMetrics } from '../types.js';

function emptyMetrics(): RecipeMetrics {
  return {
    tabRecipeId: 'r',
    tabRecipeVersion: 1,
    windowStartIso: '2026-04-01T00:00:00.000Z',
    windowEndIso: '2026-05-01T00:00:00.000Z',
    renderCount: 100,
    submitCount: 90,
    completionRate: 0.9,
    errorRate: 0.01,
    maxFieldAbandonmentRate: 0.05,
    fields: [
      {
        fieldId: 'a',
        focusCount: 100,
        errorCount: 1,
        blurWithoutSubmitCount: 5,
        tooltipHitCount: 1,
        errorRate: 0.01,
        abandonmentRate: 0.05,
        tooltipHitRate: 0.01,
      },
    ],
  };
}

function report(decision: FitnessReport['decision']): FitnessReport {
  return {
    tabRecipeId: 'r',
    tabRecipeVersion: 1,
    score: 0.9,
    decision,
    failingSignals: [],
    passingSignals: [],
    metrics: emptyMetrics(),
  };
}

function inMemoryLedger(): LockCandidateLedger & {
  readonly state: Map<string, string>;
} {
  const state = new Map<string, string>();
  const key = (id: string, v: number) => `${id}:${v}`;
  return {
    state,
    async readFirstCandidateAt({ tabRecipeId, tabRecipeVersion }) {
      return state.get(key(tabRecipeId, tabRecipeVersion)) ?? null;
    },
    async writeFirstCandidateAt({ tabRecipeId, tabRecipeVersion, atIso }) {
      const k = key(tabRecipeId, tabRecipeVersion);
      if (!state.has(k)) state.set(k, atIso);
    },
    async clearCandidacy({ tabRecipeId, tabRecipeVersion }) {
      state.delete(key(tabRecipeId, tabRecipeVersion));
    },
  };
}

describe('decideLock', () => {
  it('returns noop and clears the ledger when not a candidate in either window', async () => {
    const ledger = inMemoryLedger();
    // Pre-seed candidacy to verify it gets cleared.
    await ledger.writeFirstCandidateAt({
      tabRecipeId: 'r',
      tabRecipeVersion: 1,
      atIso: '2026-04-01T00:00:00.000Z',
    });
    const out = await decideLock({
      shortReport: report('improve_candidate'),
      longReport: report('lock_candidate'),
      ledger,
      nowIso: '2026-05-01T00:00:00.000Z',
      sustainDays: 30,
    });
    expect(out.action).toBe('noop');
    expect(ledger.state.size).toBe(0);
  });

  it('marks first candidacy and asks for sustained tracking', async () => {
    const ledger = inMemoryLedger();
    const out = await decideLock({
      shortReport: report('lock_candidate'),
      longReport: report('lock_candidate'),
      ledger,
      nowIso: '2026-05-01T00:00:00.000Z',
      sustainDays: 30,
    });
    expect(out.action).toBe('mark_lock_candidate');
    expect(ledger.state.get('r:1')).toBe('2026-05-01T00:00:00.000Z');
  });

  it('still marks (not lock) when sustained < 30 days', async () => {
    const ledger = inMemoryLedger();
    await ledger.writeFirstCandidateAt({
      tabRecipeId: 'r',
      tabRecipeVersion: 1,
      atIso: '2026-04-20T00:00:00.000Z', // 11 days ago
    });
    const out = await decideLock({
      shortReport: report('lock_candidate'),
      longReport: report('lock_candidate'),
      ledger,
      nowIso: '2026-05-01T00:00:00.000Z',
      sustainDays: 30,
    });
    expect(out.action).toBe('mark_lock_candidate');
  });

  it('LOCKs when sustained >= 30 days', async () => {
    const ledger = inMemoryLedger();
    await ledger.writeFirstCandidateAt({
      tabRecipeId: 'r',
      tabRecipeVersion: 1,
      atIso: '2026-03-25T00:00:00.000Z',
    });
    const out = await decideLock({
      shortReport: report('lock_candidate'),
      longReport: report('lock_candidate'),
      ledger,
      nowIso: '2026-05-01T00:00:00.000Z',
      sustainDays: 30,
    });
    expect(out.action).toBe('lock');
  });

  it('edge — exactly 30 days sustained still triggers lock', async () => {
    const ledger = inMemoryLedger();
    await ledger.writeFirstCandidateAt({
      tabRecipeId: 'r',
      tabRecipeVersion: 1,
      atIso: '2026-04-01T00:00:00.000Z',
    });
    const out = await decideLock({
      shortReport: report('lock_candidate'),
      longReport: report('lock_candidate'),
      ledger,
      nowIso: '2026-05-01T00:00:00.000Z',
      sustainDays: 30,
    });
    expect(out.action).toBe('lock');
  });

  it('clearCandidacy when long window drops candidacy', async () => {
    const ledger = inMemoryLedger();
    await ledger.writeFirstCandidateAt({
      tabRecipeId: 'r',
      tabRecipeVersion: 1,
      atIso: '2026-04-01T00:00:00.000Z',
    });
    const out = await decideLock({
      shortReport: report('lock_candidate'),
      longReport: report('neutral'),
      ledger,
      nowIso: '2026-05-01T00:00:00.000Z',
      sustainDays: 30,
    });
    expect(out.action).toBe('noop');
    expect(ledger.state.size).toBe(0);
  });
});
