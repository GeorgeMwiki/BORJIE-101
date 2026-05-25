/**
 * Predicate-evaluator unit tests.
 *
 * Covers each leaf predicate kind + both combinators + the vacuous
 * cases (empty `and` / `or`) + the exhaustiveness guard.
 */

import { describe, expect, it } from 'vitest';
import { evaluatePredicate } from '../registry/evaluate.js';
import type {
  SectionContext,
  VisibilityPredicate,
} from '../contracts/section.js';

function makeContext(overrides: Partial<SectionContext> = {}): SectionContext {
  return {
    tenantId: 't1',
    scope: 'owner-customer',
    entityCounts: {},
    roles: [],
    featureFlags: [],
    ...overrides,
  };
}

describe('evaluatePredicate', () => {
  describe('has-entities', () => {
    it('returns true when entity count is positive', () => {
      const ctx = makeContext({ entityCounts: { customers: 3 } });
      const pred: VisibilityPredicate = {
        kind: 'has-entities',
        entity_type: 'customers',
      };
      expect(evaluatePredicate(pred, ctx)).toBe(true);
    });

    it('returns false when entity count is zero', () => {
      const ctx = makeContext({ entityCounts: { customers: 0 } });
      const pred: VisibilityPredicate = {
        kind: 'has-entities',
        entity_type: 'customers',
      };
      expect(evaluatePredicate(pred, ctx)).toBe(false);
    });

    it('returns false when entity_type is absent from the counts map', () => {
      const ctx = makeContext({ entityCounts: { properties: 5 } });
      const pred: VisibilityPredicate = {
        kind: 'has-entities',
        entity_type: 'customers',
      };
      expect(evaluatePredicate(pred, ctx)).toBe(false);
    });
  });

  describe('role-allowed', () => {
    it('returns true when viewer holds any of the named roles', () => {
      const ctx = makeContext({ roles: ['md', 'staff'] });
      const pred: VisibilityPredicate = {
        kind: 'role-allowed',
        roles: ['md', 'platform_ops'],
      };
      expect(evaluatePredicate(pred, ctx)).toBe(true);
    });

    it('returns false when viewer holds none of the named roles', () => {
      const ctx = makeContext({ roles: ['tenant'] });
      const pred: VisibilityPredicate = {
        kind: 'role-allowed',
        roles: ['platform_ops'],
      };
      expect(evaluatePredicate(pred, ctx)).toBe(false);
    });

    it('returns false when the role list is empty', () => {
      const ctx = makeContext({ roles: ['md'] });
      const pred: VisibilityPredicate = { kind: 'role-allowed', roles: [] };
      expect(evaluatePredicate(pred, ctx)).toBe(false);
    });
  });

  describe('feature-flag', () => {
    it('returns true when the named flag is enabled', () => {
      const ctx = makeContext({ featureFlags: ['phase-j3'] });
      const pred: VisibilityPredicate = {
        kind: 'feature-flag',
        flag: 'phase-j3',
      };
      expect(evaluatePredicate(pred, ctx)).toBe(true);
    });

    it('returns false when the named flag is not enabled', () => {
      const ctx = makeContext({ featureFlags: ['phase-j2'] });
      const pred: VisibilityPredicate = {
        kind: 'feature-flag',
        flag: 'phase-j3',
      };
      expect(evaluatePredicate(pred, ctx)).toBe(false);
    });
  });

  describe('and combinator', () => {
    it('returns true when every child predicate is true', () => {
      const ctx = makeContext({
        entityCounts: { customers: 1 },
        roles: ['md'],
      });
      const pred: VisibilityPredicate = {
        kind: 'and',
        preds: [
          { kind: 'has-entities', entity_type: 'customers' },
          { kind: 'role-allowed', roles: ['md'] },
        ],
      };
      expect(evaluatePredicate(pred, ctx)).toBe(true);
    });

    it('returns false when any child predicate is false', () => {
      const ctx = makeContext({
        entityCounts: { customers: 1 },
        roles: [],
      });
      const pred: VisibilityPredicate = {
        kind: 'and',
        preds: [
          { kind: 'has-entities', entity_type: 'customers' },
          { kind: 'role-allowed', roles: ['md'] },
        ],
      };
      expect(evaluatePredicate(pred, ctx)).toBe(false);
    });

    it('returns true on an empty children list (vacuous truth)', () => {
      const pred: VisibilityPredicate = { kind: 'and', preds: [] };
      expect(evaluatePredicate(pred, makeContext())).toBe(true);
    });
  });

  describe('or combinator', () => {
    it('returns true when at least one child predicate is true', () => {
      const ctx = makeContext({ roles: ['platform_ops'] });
      const pred: VisibilityPredicate = {
        kind: 'or',
        preds: [
          { kind: 'has-entities', entity_type: 'customers' },
          { kind: 'role-allowed', roles: ['platform_ops'] },
        ],
      };
      expect(evaluatePredicate(pred, ctx)).toBe(true);
    });

    it('returns false when all child predicates are false', () => {
      const ctx = makeContext();
      const pred: VisibilityPredicate = {
        kind: 'or',
        preds: [
          { kind: 'has-entities', entity_type: 'customers' },
          { kind: 'role-allowed', roles: ['platform_ops'] },
        ],
      };
      expect(evaluatePredicate(pred, ctx)).toBe(false);
    });

    it('returns false on an empty children list', () => {
      const pred: VisibilityPredicate = { kind: 'or', preds: [] };
      expect(evaluatePredicate(pred, makeContext())).toBe(false);
    });
  });

  describe('nested combinators', () => {
    it('handles three-level nesting correctly', () => {
      const ctx = makeContext({
        entityCounts: { campaigns: 2 },
        roles: ['md'],
        featureFlags: ['phase-j3'],
      });
      const pred: VisibilityPredicate = {
        kind: 'and',
        preds: [
          { kind: 'feature-flag', flag: 'phase-j3' },
          {
            kind: 'or',
            preds: [
              { kind: 'has-entities', entity_type: 'campaigns' },
              { kind: 'role-allowed', roles: ['platform_ops'] },
            ],
          },
        ],
      };
      expect(evaluatePredicate(pred, ctx)).toBe(true);
    });
  });

  describe('exhaustiveness guard', () => {
    it('throws on an unknown predicate kind', () => {
      const bogus = { kind: 'never-seen-this-before' } as unknown as VisibilityPredicate;
      expect(() => evaluatePredicate(bogus, makeContext())).toThrow(
        /unknown predicate kind/,
      );
    });
  });
});
