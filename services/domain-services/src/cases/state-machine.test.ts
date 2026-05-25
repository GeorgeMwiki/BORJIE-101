/**
 * Tests for case state machine.
 */

import { describe, it, expect } from 'vitest';
import {
  CaseStatus,
  TRANSITIONS,
  canTransition,
  assertTransition,
  type CaseStatusValue,
} from './state-machine.js';

describe('CaseStatus / TRANSITIONS', () => {
  it('defines all six statuses', () => {
    expect(CaseStatus).toEqual([
      'OPEN',
      'IN_PROGRESS',
      'PENDING_RESPONSE',
      'ESCALATED',
      'RESOLVED',
      'CLOSED',
    ]);
  });

  it('has a transition entry for every status', () => {
    for (const s of CaseStatus) {
      expect(TRANSITIONS[s]).toBeDefined();
    }
  });

  it('treats CLOSED as terminal', () => {
    expect(TRANSITIONS.CLOSED).toEqual([]);
  });
});

describe('canTransition — legal transitions', () => {
  const legalPairs: Array<[CaseStatusValue, CaseStatusValue]> = [
    ['OPEN', 'IN_PROGRESS'],
    ['OPEN', 'PENDING_RESPONSE'],
    ['OPEN', 'ESCALATED'],
    ['OPEN', 'CLOSED'],
    ['IN_PROGRESS', 'PENDING_RESPONSE'],
    ['IN_PROGRESS', 'ESCALATED'],
    ['IN_PROGRESS', 'RESOLVED'],
    ['IN_PROGRESS', 'CLOSED'],
    ['PENDING_RESPONSE', 'IN_PROGRESS'],
    ['PENDING_RESPONSE', 'ESCALATED'],
    ['PENDING_RESPONSE', 'RESOLVED'],
    ['PENDING_RESPONSE', 'CLOSED'],
    ['ESCALATED', 'IN_PROGRESS'],
    ['ESCALATED', 'RESOLVED'],
    ['ESCALATED', 'CLOSED'],
    ['RESOLVED', 'CLOSED'],
  ];

  it.each(legalPairs)('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });
});

describe('canTransition — illegal transitions', () => {
  const illegalPairs: Array<[CaseStatusValue, CaseStatusValue]> = [
    ['OPEN', 'RESOLVED'], // must pass through work state
    ['CLOSED', 'OPEN'],
    ['CLOSED', 'IN_PROGRESS'],
    ['CLOSED', 'RESOLVED'],
    ['RESOLVED', 'OPEN'],
    ['RESOLVED', 'IN_PROGRESS'],
    ['RESOLVED', 'ESCALATED'],
    ['ESCALATED', 'PENDING_RESPONSE'],
    ['IN_PROGRESS', 'OPEN'],
  ];

  it.each(illegalPairs)('rejects %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });
});

describe('assertTransition', () => {
  it('returns ok for a legal transition', () => {
    const res = assertTransition('OPEN', 'IN_PROGRESS');
    expect(res.success).toBe(true);
  });

  it('returns err with ILLEGAL_TRANSITION for an illegal transition', () => {
    const res = assertTransition('CLOSED', 'OPEN');
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.code).toBe('ILLEGAL_TRANSITION');
      expect(res.error.from).toBe('CLOSED');
      expect(res.error.to).toBe('OPEN');
    }
  });

  it('no status can transition to itself (not listed in TRANSITIONS)', () => {
    for (const s of CaseStatus) {
      expect(canTransition(s, s)).toBe(false);
    }
  });
});
