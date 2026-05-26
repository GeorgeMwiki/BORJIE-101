/**
 * Linear normalizer tests.
 */

import { describe, it, expect } from 'vitest';

import { normaliseLinearNode } from '../ingest/normalizer.js';

describe('linear/normalizer', () => {
  it('normalises an issue node', () => {
    const node = {
      id: 'lin-1',
      title: 'Fix M-Pesa reconciliation',
      description: 'Reconcile last week settlements',
      updatedAt: '2026-01-15T10:00:00.000Z',
      state: { name: 'In Progress' },
      assignee: { email: 'sha256:abc' },
    };
    const n = normaliseLinearNode({ kind: 'issue', node });
    expect(n).not.toBeNull();
    expect(n?.entityId).toBe('lin-1');
    expect(n?.state).toBe('In Progress');
    expect(n?.assigneeEmailHashed).toBe('sha256:abc');
  });

  it('returns null when id is missing', () => {
    expect(
      normaliseLinearNode({
        kind: 'issue',
        node: { updatedAt: '2026-01-01T00:00:00.000Z' } as Readonly<Record<string, unknown>>,
      }),
    ).toBeNull();
  });

  it('returns null when updatedAt is missing', () => {
    expect(
      normaliseLinearNode({ kind: 'issue', node: { id: 'x' } as Readonly<Record<string, unknown>> }),
    ).toBeNull();
  });
});
