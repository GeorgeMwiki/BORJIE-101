/**
 * Context-breadcrumbs (K-D) helper tests — pure functions.
 *
 * Validates the wire-payload serializer + label-stack rendering. The
 * React hooks are exercised by the chat composer's e2e suite.
 */

import { describe, it, expect } from 'vitest';
import {
  serializeCrumbStack,
  toWirePayload,
  type ContextCrumb,
} from '../context-breadcrumbs';

const STACK: ReadonlyArray<ContextCrumb> = Object.freeze([
  Object.freeze({ kind: 'site', id: 'mwadui', label: 'Mwadui Foreman', scopeId: 'mwadui' }),
  Object.freeze({ kind: 'worker', id: 'w_hassan', label: 'Worker Hassan' }),
  Object.freeze({ kind: 'shift_report', id: 'sr_42', label: 'Last shift report' }),
]);

describe('serializeCrumbStack', () => {
  it('returns null for an empty stack', () => {
    expect(serializeCrumbStack([])).toBeNull();
  });

  it('joins labels with → separator in stack order', () => {
    expect(serializeCrumbStack(STACK)).toBe(
      'Mwadui Foreman → Worker Hassan → Last shift report',
    );
  });
});

describe('toWirePayload', () => {
  it('serialises only the wire fields and freezes the result', () => {
    const wire = toWirePayload(STACK);
    expect(wire.stack).toHaveLength(3);
    expect(wire.stack[0]).toEqual({
      kind: 'site',
      id: 'mwadui',
      label: 'Mwadui Foreman',
      scopeId: 'mwadui',
    });
    // scopeId is optional in the wire shape — workers/shift_reports omit it.
    expect((wire.stack[1] as Record<string, unknown>)['scopeId']).toBeUndefined();
    expect(Object.isFrozen(wire)).toBe(true);
    expect(Object.isFrozen(wire.stack)).toBe(true);
    expect(Object.isFrozen(wire.stack[0])).toBe(true);
  });

  it('handles an empty input by returning a frozen empty stack', () => {
    const wire = toWirePayload([]);
    expect(wire.stack).toHaveLength(0);
    expect(Object.isFrozen(wire.stack)).toBe(true);
  });
});
