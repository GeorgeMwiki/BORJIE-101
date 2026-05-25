import { describe, it, expect } from 'vitest';
import { POLICY_REGISTRY, policyFor } from '../policies/index.js';
import { WORKFLOW_KINDS } from '../types.js';

describe('POLICY_REGISTRY', () => {
  it('has exactly one entry per WorkflowKind', () => {
    for (const kind of WORKFLOW_KINDS) {
      expect(POLICY_REGISTRY[kind], `missing policy for ${kind}`).toBeDefined();
      expect(POLICY_REGISTRY[kind].kind).toBe(kind);
    }
  });

  it('policyFor() returns the matching entry', () => {
    for (const kind of WORKFLOW_KINDS) {
      expect(policyFor(kind).kind).toBe(kind);
    }
  });

  it('is frozen — cannot be mutated', () => {
    expect(() => {
      // @ts-expect-error mutation deliberately attempted
      POLICY_REGISTRY['parcel_edit'] = undefined as never;
    }).toThrow();
  });
});
