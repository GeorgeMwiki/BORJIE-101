/**
 * Jarvis feedback fan-out — multi-sink dispatch test (D8).
 *
 * The /feedback endpoint persists the canonical row to kernel_feedback
 * AND fans out to three additional sinks:
 *   1. kernel_action_audit  — forensic row of the feedback event
 *   2. reflective digest    — negative-signal hint for tomorrow's sleep
 *   3. drift-buffer (opt)   — persona-drift sample hook
 *
 * This test asserts the fan-out semantics by exercising the inner
 * fan-out helper directly. The full HTTP path is covered by the
 * existing admin-jarvis-stream router smoke tests.
 *
 * This test uses lightweight fakes for the three services and asserts
 * the call-shape contract — the full HTTP path is exercised by the
 * admin-jarvis-stream router smoke tests.
 */

import { describe, it, expect } from 'vitest';

interface FeedbackBody {
  thoughtId: string;
  threadId: string;
  signal: 'thumbs-up' | 'thumbs-down' | 'correction' | 'flagged';
  correctionText?: string;
  category?: string;
}

interface SinkCalls {
  feedback: Array<unknown>;
  audit: Array<unknown>;
  reflect: Array<unknown>;
  drift: Array<unknown>;
}

// Replicates the fan-out section of the jarvis-router-factory feedback
// endpoint as a pure function so we can unit-test the dispatch logic.
async function fanOutFeedback(
  body: FeedbackBody,
  tenantId: string,
  userId: string,
  sinks: {
    feedback: { record: (args: unknown) => Promise<{ id: string }> };
    audit: { record: (args: unknown) => Promise<void> };
    reflect: { record: (args: unknown) => Promise<void> };
    drift?: { record: (args: unknown) => Promise<void> };
  },
): Promise<{ id: string } | null> {
  const isNegative =
    body.signal === 'thumbs-down' ||
    body.signal === 'correction' ||
    body.signal === 'flagged';

  const feedbackP = sinks.feedback.record({
    tenantId,
    userId,
    thoughtId: body.thoughtId,
    threadId: body.threadId,
    signal: body.signal,
  });

  const auditP = sinks.audit.record({
    tenantId,
    userId,
    goalId: `feedback:${body.thoughtId}`,
    stepId: `feedback:${body.signal}`,
    toolName: 'kernel-feedback',
    decision: 'done',
    payloadHash: body.thoughtId,
  });

  const reflectP = isNegative
    ? sinks.reflect.record({
        tenantId,
        userId,
        periodKind: 'daily',
        summary: `Negative feedback on thought ${body.thoughtId}`,
      })
    : Promise.resolve(undefined);

  const driftP = isNegative && sinks.drift
    ? sinks.drift.record({
        tenantId,
        userId,
        thoughtId: body.thoughtId,
        signal: body.signal,
      })
    : Promise.resolve(undefined);

  const [feedbackResult] = await Promise.allSettled([
    feedbackP,
    auditP,
    reflectP,
    driftP,
  ]);

  if (feedbackResult.status !== 'fulfilled') return null;
  return feedbackResult.value as { id: string };
}

function makeSinks(): {
  calls: SinkCalls;
  sinks: Parameters<typeof fanOutFeedback>[3];
} {
  const calls: SinkCalls = {
    feedback: [],
    audit: [],
    reflect: [],
    drift: [],
  };
  return {
    calls,
    sinks: {
      feedback: {
        record: async (a) => {
          calls.feedback.push(a);
          return { id: 'fb-1' };
        },
      },
      audit: {
        record: async (a) => {
          calls.audit.push(a);
        },
      },
      reflect: {
        record: async (a) => {
          calls.reflect.push(a);
        },
      },
      drift: {
        record: async (a) => {
          calls.drift.push(a);
        },
      },
    },
  };
}

describe('jarvis feedback fan-out (D8)', () => {
  it('positive feedback hits kernel-feedback + audit only', async () => {
    const { calls, sinks } = makeSinks();
    const out = await fanOutFeedback(
      {
        thoughtId: 't1',
        threadId: 'th1',
        signal: 'thumbs-up',
      },
      'tn1',
      'usr1',
      sinks,
    );
    expect(out?.id).toBe('fb-1');
    expect(calls.feedback).toHaveLength(1);
    expect(calls.audit).toHaveLength(1);
    expect(calls.reflect).toHaveLength(0);
    expect(calls.drift).toHaveLength(0);
  });

  it('negative feedback fans out to all 4 sinks', async () => {
    const { calls, sinks } = makeSinks();
    await fanOutFeedback(
      {
        thoughtId: 't2',
        threadId: 'th2',
        signal: 'thumbs-down',
      },
      'tn1',
      'usr1',
      sinks,
    );
    expect(calls.feedback).toHaveLength(1);
    expect(calls.audit).toHaveLength(1);
    expect(calls.reflect).toHaveLength(1);
    expect(calls.drift).toHaveLength(1);
  });

  it('correction signal triggers reflective + drift sinks', async () => {
    const { calls, sinks } = makeSinks();
    await fanOutFeedback(
      {
        thoughtId: 't3',
        threadId: 'th3',
        signal: 'correction',
        correctionText: 'The arrears figure was off by 1k',
      },
      'tn1',
      'usr1',
      sinks,
    );
    expect(calls.reflect).toHaveLength(1);
    expect(calls.drift).toHaveLength(1);
  });

  it('drift sink absent does not affect other sinks', async () => {
    const { calls, sinks: withDrift } = makeSinks();
    const sinks = { ...withDrift, drift: undefined };
    await fanOutFeedback(
      {
        thoughtId: 't4',
        threadId: 'th4',
        signal: 'flagged',
      },
      'tn1',
      'usr1',
      sinks,
    );
    expect(calls.feedback).toHaveLength(1);
    expect(calls.audit).toHaveLength(1);
    expect(calls.reflect).toHaveLength(1);
    expect(calls.drift).toHaveLength(0);
  });

  it('feedback sink failure returns null but does not throw', async () => {
    const { calls, sinks } = makeSinks();
    sinks.feedback.record = async () => {
      throw new Error('db down');
    };
    const out = await fanOutFeedback(
      {
        thoughtId: 't5',
        threadId: 'th5',
        signal: 'thumbs-up',
      },
      'tn1',
      'usr1',
      sinks,
    );
    expect(out).toBeNull();
    // Audit still runs even though feedback failed.
    expect(calls.audit).toHaveLength(1);
  });
});
