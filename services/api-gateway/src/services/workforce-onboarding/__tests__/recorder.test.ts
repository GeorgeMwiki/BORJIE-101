/**
 * Pure deciders for HR onboarding chain L-A (issue #193).
 */

import { describe, it, expect } from 'vitest';
import {
  reviewCandidate,
  canReviewCandidates,
  describeReviewDecision,
} from '../recorder';

describe('reviewCandidate', () => {
  it('reject preserves count and opening status, flips user to rejected', () => {
    const result = reviewCandidate({
      currentOpeningStatus: 'open',
      currentCountNeeded: 3,
      decision: 'reject',
    });
    expect(result.newUserWorkforceStatus).toBe('rejected');
    expect(result.newCountNeeded).toBe(3);
    expect(result.newOpeningStatus).toBe('open');
    expect(result.openingFilled).toBe(false);
  });

  it('approve on open opening decrements count', () => {
    const result = reviewCandidate({
      currentOpeningStatus: 'open',
      currentCountNeeded: 3,
      decision: 'approve',
    });
    expect(result.newUserWorkforceStatus).toBe('active');
    expect(result.newCountNeeded).toBe(2);
    expect(result.newOpeningStatus).toBe('open');
    expect(result.openingFilled).toBe(false);
  });

  it('approve that drives count to 0 auto-fills the opening', () => {
    const result = reviewCandidate({
      currentOpeningStatus: 'open',
      currentCountNeeded: 1,
      decision: 'approve',
    });
    expect(result.newUserWorkforceStatus).toBe('active');
    expect(result.newCountNeeded).toBe(0);
    expect(result.newOpeningStatus).toBe('filled');
    expect(result.openingFilled).toBe(true);
  });

  it('approve on a non-open opening flips user but leaves opening alone', () => {
    const result = reviewCandidate({
      currentOpeningStatus: 'closed',
      currentCountNeeded: 5,
      decision: 'approve',
    });
    expect(result.newUserWorkforceStatus).toBe('active');
    expect(result.newCountNeeded).toBe(5);
    expect(result.newOpeningStatus).toBe('closed');
    expect(result.openingFilled).toBe(false);
  });

  it('count is clamped at zero (never negative)', () => {
    const result = reviewCandidate({
      currentOpeningStatus: 'open',
      currentCountNeeded: 0,
      decision: 'approve',
    });
    expect(result.newCountNeeded).toBe(0);
    expect(result.newOpeningStatus).toBe('filled');
    expect(result.openingFilled).toBe(true);
  });
});

describe('canReviewCandidates', () => {
  it.each([
    ['OWNER', true],
    ['TENANT_ADMIN', true],
    ['PROPERTY_MANAGER', true],
    ['SUPER_ADMIN', true],
    ['RESIDENT', false],
    ['MAINTENANCE_STAFF', false],
    [undefined, false],
    ['', false],
  ])('role=%s -> %s', (role, expected) => {
    expect(canReviewCandidates(role as string | undefined)).toBe(expected);
  });
});

describe('describeReviewDecision', () => {
  it('approve returns sw + en summary', () => {
    const summary = describeReviewDecision('approve');
    expect(summary.sw).toContain('amekubaliwa');
    expect(summary.en).toContain('approved');
  });

  it('reject returns sw + en summary', () => {
    const summary = describeReviewDecision('reject');
    expect(summary.sw).toContain('amekataliwa');
    expect(summary.en).toContain('rejected');
  });
});
