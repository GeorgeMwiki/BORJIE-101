/**
 * Reflexion writer — unit tests.
 *
 * Coverage:
 *   1. buildReflection includes intent / outcome / lessons / grounded
 *   2. buildReflection caps bullets at MAX_BULLETS=3
 *   3. buildReflection truncates to MAX_REFLECTION_CHARS
 *   4. recordReflection rejects missing tenant/user/session
 *   5. recordReflection swallows port throws (returns null)
 *   6. recordReflection returns the row id on success
 *   7. isExplicitSessionTerminator catches bye / /end / "thanks that's all"
 *   8. isIdleSessionEnd respects the idle window
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildReflection,
  isExplicitSessionTerminator,
  isIdleSessionEnd,
  recordReflection,
  type ReflexionWriterPort,
} from '../reflexion-writer.js';

function makePort(): {
  port: ReflexionWriterPort;
  calls: Array<{
    tenantId: string;
    userId: string;
    sessionId: string;
    reflection: string;
    outcome: string;
  }>;
  failNext?: boolean;
} {
  const calls: Array<{
    tenantId: string;
    userId: string;
    sessionId: string;
    reflection: string;
    outcome: string;
  }> = [];
  const state = { failNext: false };
  const port: ReflexionWriterPort = {
    async record(args) {
      if (state.failNext) {
        state.failNext = false;
        throw new Error('port boom');
      }
      calls.push({ ...args });
      return { id: `rec-${calls.length}` };
    },
  };
  return Object.assign(state, { port, calls });
}

describe('buildReflection', () => {
  it('emits intent + outcome + lessons + grounded', () => {
    const out = buildReflection({
      userMessage: 'compute prorated charge for tenant moving mid-month',
      outcome: 'failure',
      negativeNotes: [
        'I assumed the lease anniversary is the 1st but it was the 15th',
        'I quoted the gross rent instead of the prorated portion',
      ],
      groundedFacts: ['Lease L-42 starts 15th'],
    });
    expect(out).toMatch(/Intent:/);
    expect(out).toMatch(/Outcome: failure/);
    expect(out).toMatch(/Lessons:/);
    expect(out).toMatch(/Grounded facts used:/);
  });

  it('caps the bullet list at 3 entries', () => {
    const out = buildReflection({
      userMessage: 'x',
      outcome: 'mixed',
      negativeNotes: ['a', 'b', 'c', 'd', 'e'],
    });
    const bullets = out.split('\n').filter((l) => l.startsWith('- '));
    expect(bullets).toHaveLength(3);
  });

  it('truncates an enormous reflection to the cap', () => {
    const huge = 'x'.repeat(5_000);
    const out = buildReflection({
      userMessage: huge,
      outcome: 'success',
      negativeNotes: [huge, huge, huge],
    });
    expect(out.length).toBeLessThanOrEqual(1_200);
  });

  it('emits only outcome when nothing else is provided', () => {
    const out = buildReflection({ userMessage: '', outcome: 'success' });
    expect(out).toBe('Outcome: success');
  });
});

describe('recordReflection', () => {
  it('returns null when (tenantId|userId|sessionId) is missing', async () => {
    const { port } = makePort();
    const out = await recordReflection(port, {
      tenantId: '',
      userId: 'u-1',
      sessionId: 's-1',
      userMessage: 'hi',
      outcome: 'success',
    });
    expect(out).toBeNull();
  });

  it('returns the row id on success', async () => {
    const { port, calls } = makePort();
    const out = await recordReflection(port, {
      tenantId: 't-1',
      userId: 'u-1',
      sessionId: 's-1',
      userMessage: 'do a thing',
      outcome: 'success',
      negativeNotes: ['none'],
    });
    expect(out).toBe('rec-1');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.outcome).toBe('success');
  });

  it('returns null when the port throws (swallowed)', async () => {
    const stub = makePort();
    stub.failNext = true;
    const out = await recordReflection(stub.port, {
      tenantId: 't-1',
      userId: 'u-1',
      sessionId: 's-1',
      userMessage: 'x',
      outcome: 'failure',
    });
    expect(out).toBeNull();
  });
});

describe('session-end detection', () => {
  it('catches "bye" / "/end" / "thanks, that\'s all"', () => {
    expect(isExplicitSessionTerminator('bye')).toBe(true);
    expect(isExplicitSessionTerminator('/end')).toBe(true);
    expect(isExplicitSessionTerminator("thanks, that's all")).toBe(true);
    expect(isExplicitSessionTerminator('goodbye Jarvis')).toBe(true);
  });

  it('does NOT trigger on conversational filler', () => {
    expect(isExplicitSessionTerminator('I bought something today')).toBe(
      false,
    );
    expect(isExplicitSessionTerminator('thanks for the help with X')).toBe(
      false,
    );
  });

  it('respects the idle window', () => {
    expect(
      isIdleSessionEnd({
        lastTurnAt: 1_000,
        now: 1_000 + 6 * 60 * 1000,
      }),
    ).toBe(true);
    expect(
      isIdleSessionEnd({
        lastTurnAt: 1_000,
        now: 1_000 + 2 * 60 * 1000,
      }),
    ).toBe(false);
  });

  it('honours a custom idle window', () => {
    expect(
      isIdleSessionEnd({
        lastTurnAt: 1_000,
        now: 2_000,
        idleMs: 500,
      }),
    ).toBe(true);
  });
});
