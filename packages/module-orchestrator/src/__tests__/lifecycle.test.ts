/**
 * lifecycle.test.ts — pin down the state machine edges.
 */

import { describe, it, expect } from 'vitest';
import {
  canTransition,
  reachableStates,
  isTerminal,
  MODULE_LIFECYCLE_STATES,
} from '../lifecycle.js';

describe('canTransition', () => {
  it('accepts DRAFT → PROPOSED', () => {
    expect(canTransition({ from: 'DRAFT', to: 'PROPOSED' }).ok).toBe(true);
  });

  it('accepts PROPOSED → APPROVED only with a non-empty hitlApprovalId', () => {
    expect(canTransition({ from: 'PROPOSED', to: 'APPROVED' }).ok).toBe(false);
    expect(
      canTransition({
        from: 'PROPOSED',
        to: 'APPROVED',
        hitlApprovalId: '',
      }).ok,
    ).toBe(false);
    expect(
      canTransition({
        from: 'PROPOSED',
        to: 'APPROVED',
        hitlApprovalId: 'apr_001',
      }).ok,
    ).toBe(true);
  });

  it('accepts APPROVED → LIVE', () => {
    expect(canTransition({ from: 'APPROVED', to: 'LIVE' }).ok).toBe(true);
  });

  it('accepts LIVE → DEPRECATED', () => {
    expect(canTransition({ from: 'LIVE', to: 'DEPRECATED' }).ok).toBe(true);
  });

  it('accepts DEPRECATED → ARCHIVED', () => {
    expect(canTransition({ from: 'DEPRECATED', to: 'ARCHIVED' }).ok).toBe(true);
  });

  it('rejects DRAFT → LIVE (skipping states)', () => {
    expect(canTransition({ from: 'DRAFT', to: 'LIVE' }).ok).toBe(false);
  });

  it('rejects LIVE → DRAFT (going backwards past stable)', () => {
    expect(canTransition({ from: 'LIVE', to: 'DRAFT' }).ok).toBe(false);
  });

  it('rejects ARCHIVED → anything', () => {
    expect(canTransition({ from: 'ARCHIVED', to: 'LIVE' }).ok).toBe(false);
    expect(canTransition({ from: 'ARCHIVED', to: 'DRAFT' }).ok).toBe(false);
  });

  it('accepts roll-back edges PROPOSED → DRAFT and APPROVED → PROPOSED', () => {
    expect(canTransition({ from: 'PROPOSED', to: 'DRAFT' }).ok).toBe(true);
    expect(canTransition({ from: 'APPROVED', to: 'PROPOSED' }).ok).toBe(true);
  });

  it('rejects an unknown source state', () => {
    expect(
      canTransition({ from: 'WAT' as any, to: 'LIVE' }).ok,
    ).toBe(false);
  });
});

describe('reachableStates', () => {
  it('returns the outgoing edges for each state', () => {
    expect(reachableStates('DRAFT')).toEqual(['PROPOSED']);
    expect(reachableStates('PROPOSED')).toEqual(['APPROVED', 'DRAFT']);
    expect(reachableStates('ARCHIVED')).toEqual([]);
  });
});

describe('isTerminal', () => {
  it('ARCHIVED is terminal', () => {
    expect(isTerminal('ARCHIVED')).toBe(true);
  });

  it('LIVE is not terminal', () => {
    expect(isTerminal('LIVE')).toBe(false);
  });
});

describe('MODULE_LIFECYCLE_STATES', () => {
  it('exports the canonical ordered tuple', () => {
    expect(MODULE_LIFECYCLE_STATES).toEqual([
      'DRAFT',
      'PROPOSED',
      'APPROVED',
      'LIVE',
      'DEPRECATED',
      'ARCHIVED',
    ]);
  });
});
