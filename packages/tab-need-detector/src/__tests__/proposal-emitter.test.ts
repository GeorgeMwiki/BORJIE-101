/**
 * Tests for proposal-emitter.ts — threshold, decline-snooze, expiry,
 * status transitions.
 */
import { describe, it, expect } from 'vitest';
import {
  planEmissions,
  planExpirations,
  validateTransition,
  type ProposalHistoryEntry,
} from '../proposal-emitter.js';
import type { AggregatedScore, ModuleTemplateId } from '../types.js';

const NOW = new Date('2026-05-22T00:00:00Z');

function mkAgg(overrides: Partial<AggregatedScore> = {}): AggregatedScore {
  return Object.freeze({
    tenantId: 'tnt-1',
    userId: 'usr-1',
    suggestedModuleTemplateId: 'COMPLIANCE' as ModuleTemplateId,
    score: 6.5,
    contributingSignalIds: Object.freeze(['s1', 's2']),
    ...overrides,
  });
}

let idCounter = 0;
function fakeId(): string {
  idCounter += 1;
  return `prop-${idCounter}`;
}

function resetIds(): void {
  idCounter = 0;
}

describe('planEmissions', () => {
  it('emits a proposal when score exceeds threshold and no history blocks', () => {
    resetIds();
    const plan = planEmissions([mkAgg()], {
      now: NOW,
      scoreThreshold: 5,
      declineSnoozeDays: 30,
      proposalExpiryDays: 14,
      installedModuleTemplateIds: new Set(),
      history: [],
      generateId: fakeId,
    });
    expect(plan.emit).toHaveLength(1);
    expect(plan.skipped).toHaveLength(0);
    const row = plan.emit[0]?.row;
    expect(row?.suggestedModuleTemplateId).toBe('COMPLIANCE');
    expect(row?.score).toBe(6.5);
    expect(row?.status).toBe('pending');
    expect(row?.topSignalIds).toEqual(['s1', 's2']);
    expect(row?.proposalMessage).toContain('Compliance');
  });

  it('skips below-threshold aggregations', () => {
    const plan = planEmissions([mkAgg({ score: 3 })], {
      now: NOW,
      scoreThreshold: 5,
      declineSnoozeDays: 30,
      proposalExpiryDays: 14,
      installedModuleTemplateIds: new Set(),
      history: [],
      generateId: fakeId,
    });
    expect(plan.emit).toEqual([]);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]?.reason).toBe('below_threshold');
  });

  it('skips already-installed modules', () => {
    const plan = planEmissions([mkAgg()], {
      now: NOW,
      scoreThreshold: 5,
      declineSnoozeDays: 30,
      proposalExpiryDays: 14,
      installedModuleTemplateIds: new Set(['COMPLIANCE'] as ModuleTemplateId[]),
      history: [],
      generateId: fakeId,
    });
    expect(plan.emit).toEqual([]);
    expect(plan.skipped[0]?.reason).toBe('module_already_installed');
  });

  it('skips if a pending proposal already exists', () => {
    const history: ProposalHistoryEntry[] = [
      {
        userId: 'usr-1',
        suggestedModuleTemplateId: 'COMPLIANCE',
        status: 'pending',
        decidedAt: null,
        createdAt: new Date('2026-05-20T00:00:00Z'),
      },
    ];
    const plan = planEmissions([mkAgg()], {
      now: NOW,
      scoreThreshold: 5,
      declineSnoozeDays: 30,
      proposalExpiryDays: 14,
      installedModuleTemplateIds: new Set(),
      history,
      generateId: fakeId,
    });
    expect(plan.emit).toEqual([]);
    expect(plan.skipped[0]?.reason).toBe('pending_proposal_exists');
  });

  it('skips if declined within snooze window', () => {
    // Declined 5 days ago; snooze is 30 days → still snoozed.
    const history: ProposalHistoryEntry[] = [
      {
        userId: 'usr-1',
        suggestedModuleTemplateId: 'COMPLIANCE',
        status: 'declined',
        decidedAt: new Date('2026-05-17T00:00:00Z'),
        createdAt: new Date('2026-05-10T00:00:00Z'),
      },
    ];
    const plan = planEmissions([mkAgg()], {
      now: NOW,
      scoreThreshold: 5,
      declineSnoozeDays: 30,
      proposalExpiryDays: 14,
      installedModuleTemplateIds: new Set(),
      history,
      generateId: fakeId,
    });
    expect(plan.emit).toEqual([]);
    expect(plan.skipped[0]?.reason).toBe('declined_within_snooze');
  });

  it('re-proposes after decline snooze window elapses', () => {
    // Declined 35 days ago, snooze is 30 → can re-propose.
    const history: ProposalHistoryEntry[] = [
      {
        userId: 'usr-1',
        suggestedModuleTemplateId: 'COMPLIANCE',
        status: 'declined',
        decidedAt: new Date('2026-04-17T00:00:00Z'),
        createdAt: new Date('2026-04-10T00:00:00Z'),
      },
    ];
    resetIds();
    const plan = planEmissions([mkAgg()], {
      now: NOW,
      scoreThreshold: 5,
      declineSnoozeDays: 30,
      proposalExpiryDays: 14,
      installedModuleTemplateIds: new Set(),
      history,
      generateId: fakeId,
    });
    expect(plan.emit).toHaveLength(1);
  });

  it('skips if snoozed recently', () => {
    const history: ProposalHistoryEntry[] = [
      {
        userId: 'usr-1',
        suggestedModuleTemplateId: 'COMPLIANCE',
        status: 'snoozed',
        decidedAt: new Date('2026-05-21T00:00:00Z'),
        createdAt: new Date('2026-05-10T00:00:00Z'),
      },
    ];
    const plan = planEmissions([mkAgg()], {
      now: NOW,
      scoreThreshold: 5,
      declineSnoozeDays: 30,
      proposalExpiryDays: 14,
      installedModuleTemplateIds: new Set(),
      history,
      generateId: fakeId,
    });
    expect(plan.emit).toEqual([]);
    expect(plan.skipped[0]?.reason).toBe('snoozed_recently');
  });

  it('uses a sensible fallback message for unknown modules', () => {
    resetIds();
    const plan = planEmissions(
      [mkAgg({ suggestedModuleTemplateId: 'UNKNOWN_MODULE' as ModuleTemplateId })],
      {
        now: NOW,
        scoreThreshold: 5,
        declineSnoozeDays: 30,
        proposalExpiryDays: 14,
        installedModuleTemplateIds: new Set(),
        history: [],
        generateId: fakeId,
      },
    );
    expect(plan.emit).toHaveLength(1);
    expect(plan.emit[0]?.row.proposalMessage).toContain('UNKNOWN_MODULE');
  });

  it('emits multiple proposals when conditions met for multiple modules', () => {
    resetIds();
    const aggs = [
      mkAgg({ suggestedModuleTemplateId: 'COMPLIANCE', score: 7 }),
      mkAgg({ suggestedModuleTemplateId: 'LEGAL', score: 6 }),
      mkAgg({ suggestedModuleTemplateId: 'HR', userId: 'usr-2', score: 8 }),
    ];
    const plan = planEmissions(aggs, {
      now: NOW,
      scoreThreshold: 5,
      declineSnoozeDays: 30,
      proposalExpiryDays: 14,
      installedModuleTemplateIds: new Set(),
      history: [],
      generateId: fakeId,
    });
    expect(plan.emit).toHaveLength(3);
  });

  it('sets expires_at to now + proposalExpiryDays', () => {
    resetIds();
    const plan = planEmissions([mkAgg()], {
      now: NOW,
      scoreThreshold: 5,
      declineSnoozeDays: 30,
      proposalExpiryDays: 14,
      installedModuleTemplateIds: new Set(),
      history: [],
      generateId: fakeId,
    });
    const expectedExpiresMs = NOW.getTime() + 14 * 24 * 60 * 60 * 1000;
    expect(plan.emit[0]?.row.expiresAt.getTime()).toBe(expectedExpiresMs);
  });

  it('returns empty plan for empty input', () => {
    const plan = planEmissions([], {
      now: NOW,
      scoreThreshold: 5,
      declineSnoozeDays: 30,
      proposalExpiryDays: 14,
      installedModuleTemplateIds: new Set(),
      history: [],
      generateId: fakeId,
    });
    expect(plan.emit).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });
});

describe('planExpirations', () => {
  it('returns ids for rows whose expires_at <= now', () => {
    const rows = [
      { id: 'a', expiresAt: new Date('2026-05-21T00:00:00Z') },
      { id: 'b', expiresAt: new Date('2026-05-23T00:00:00Z') },
      { id: 'c', expiresAt: NOW },
    ];
    const expired = planExpirations(rows, NOW);
    expect(expired).toContain('a');
    expect(expired).toContain('c');
    expect(expired).not.toContain('b');
  });

  it('returns empty for empty input', () => {
    expect(planExpirations([], NOW)).toEqual([]);
  });
});

describe('validateTransition', () => {
  it('rejects same-state transitions', () => {
    expect(validateTransition('pending', 'pending')).toContain('already');
  });

  it('allows pending -> accepted', () => {
    expect(validateTransition('pending', 'accepted')).toBeNull();
  });

  it('allows pending -> declined', () => {
    expect(validateTransition('pending', 'declined')).toBeNull();
  });

  it('allows pending -> snoozed', () => {
    expect(validateTransition('pending', 'snoozed')).toBeNull();
  });

  it('rejects transitions from non-pending statuses', () => {
    expect(validateTransition('accepted', 'declined')).toContain('not allowed');
    expect(validateTransition('declined', 'pending')).toContain('not allowed');
    expect(validateTransition('expired', 'pending')).toContain('not allowed');
  });

  it('rejects unknown target statuses', () => {
    expect(validateTransition('pending', 'pending')).not.toBeNull();
  });
});
