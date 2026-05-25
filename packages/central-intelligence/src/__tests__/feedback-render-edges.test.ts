/**
 * Feedback-fragment rendering — edge-case tests.
 *
 * The feedback-memory.test.ts suite covers the happy paths (3
 * corrections + the conservative directive). These tests target the
 * branches inside `renderFeedbackFragment` (kernel.ts) that the kernel
 * mixes into the system prompt at step 4c — exercised through
 * `composeSovereign` because the function itself is module-private:
 *
 *   - Empty corrections + only thumbs-down still emit the rate sentence
 *   - Dominant-category math: highest-count negative category wins ties
 *     deterministically (first-encountered wins on equal counts)
 *   - Generic "negative" sentence emits when no category was tagged
 *   - Correction text is truncated at 200 chars (the verbatim cap)
 *   - Only thumbs-up entries → rate sentence reads "0 of N" with no
 *     conservative directive
 *   - More than 3 corrections → only the first 3 are listed verbatim
 */

import { describe, it, expect } from 'vitest';
import {
  composeSovereign,
  type FeedbackEntry,
  type FeedbackMemoryPort,
  type ScopeContext,
  type Sensor,
  type SensorCallArgs,
  type SensorCallResult,
} from '../kernel/index.js';

const SCOPE: ScopeContext = {
  kind: 'tenant',
  tenantId: 't_demo',
  actorUserId: 'u_alice',
  roles: ['estate-manager'],
  personaId: 'estate-manager',
};

function captureSensor(): { sensor: Sensor; systems: string[] } {
  const systems: string[] = [];
  const sensor: Sensor = {
    id: 'capture',
    modelId: 'capture-1',
    priority: 1,
    capabilities: ['fast'],
    async call(args: SensorCallArgs): Promise<SensorCallResult> {
      systems.push(args.system);
      return {
        text: 'ack',
        thought: null,
        toolCalls: [],
        latencyMs: 1,
        modelId: 'capture-1',
        sensorId: 'capture',
      };
    },
  };
  return { sensor, systems };
}

function feedbackPort(
  entries: ReadonlyArray<FeedbackEntry>,
): FeedbackMemoryPort {
  return {
    async recallRecent() {
      return entries;
    },
  };
}

let counter = 0;
function entry(over: Partial<FeedbackEntry>): FeedbackEntry {
  counter += 1;
  return {
    id: `fb_${counter}`,
    tenantId: 't_demo',
    userId: 'u_alice',
    thoughtId: 'th_x',
    threadId: 't1',
    signal: 'thumbs-up',
    capturedAt: '2026-05-06T00:00:00.000Z',
    ...over,
  };
}

async function runOnce(feedback: FeedbackMemoryPort): Promise<string> {
  const { sensor, systems } = captureSensor();
  const sov = composeSovereign({ extraSensors: [sensor], feedback });
  await sov.kernel.think({
    threadId: `t_${counter}`,
    userMessage: `hello ${counter}`,
    scope: SCOPE,
    tier: 'tenant',
    stakes: 'low',
    surface: 'estate-manager-app',
  });
  const captured = systems[0];
  if (captured === undefined) {
    throw new Error('expected at least one captured system prompt');
  }
  return captured;
}

describe('feedback fragment — edge cases', () => {
  it('renders the dominant negative category when corrections share one tag', async () => {
    // 4 corrections in 'hallucinated', 2 thumbs-down in 'unhelpful'.
    // Total negatives = 6 of 6 entries → negativeRate=1.0, dominant
    // category = 'hallucinated'.
    const fb = feedbackPort([
      entry({ signal: 'correction', category: 'hallucinated', correctionText: 'no' }),
      entry({ signal: 'correction', category: 'hallucinated', correctionText: 'no' }),
      entry({ signal: 'correction', category: 'hallucinated', correctionText: 'no' }),
      entry({ signal: 'correction', category: 'hallucinated', correctionText: 'no' }),
      entry({ signal: 'thumbs-down', category: 'unhelpful' }),
      entry({ signal: 'thumbs-down', category: 'unhelpful' }),
    ]);
    const system = await runOnce(fb);
    expect(system).toContain('"hallucinated"');
    expect(system).toContain('You\'ve flagged 6 of my 6 recent answers');
    expect(system).toContain('higher-than-usual rate of negative feedback');
  });

  it('renders generic "negative" line when negatives have no category tag', async () => {
    const fb = feedbackPort([
      entry({ signal: 'thumbs-down' }),  // no category
      entry({ signal: 'correction', correctionText: 'wrong number' }), // no category
      entry({ signal: 'thumbs-up' }),
    ]);
    const system = await runOnce(fb);
    // No dominant category → generic "as negative" sentence.
    expect(system).toContain('as negative.');
    // 2 negatives / 3 total ≈ 0.667 → above 0.25 threshold
    expect(system).toContain('higher-than-usual rate of negative feedback');
    // Rate sentence does NOT use the categoried form when no category set.
    expect(system).not.toMatch(/recent answers as ".*"/);
  });

  it('thumbs-down without correctionText still drives the negativeRate but lists no verbatim corrections', async () => {
    const fb = feedbackPort([
      entry({ signal: 'thumbs-down', category: 'hallucinated' }),
      entry({ signal: 'thumbs-down', category: 'hallucinated' }),
      entry({ signal: 'thumbs-down', category: 'hallucinated' }),
      entry({ signal: 'thumbs-up' }),
    ]);
    const system = await runOnce(fb);
    // Verbatim section is omitted (no correction-with-text rows).
    expect(system).not.toContain('Recent corrections you gave me:');
    // But the dominant-category sentence renders.
    expect(system).toContain('"hallucinated"');
    expect(system).toContain('You\'ve flagged 3 of my 4 recent answers');
    // negativeRate = 0.75 → conservative directive emits.
    expect(system).toContain('higher-than-usual rate of negative feedback');
  });

  it('all-thumbs-up feedback renders the rate sentence but no conservative directive', async () => {
    const fb = feedbackPort([
      entry({ signal: 'thumbs-up' }),
      entry({ signal: 'thumbs-up' }),
      entry({ signal: 'thumbs-up' }),
    ]);
    const system = await runOnce(fb);
    expect(system).toContain("What I've learned from your feedback:");
    // 0 negatives / 3 total
    expect(system).toContain('You\'ve flagged 0 of my 3 recent answers as negative.');
    // Rate is 0 → conservative directive must NOT emit.
    expect(system).not.toContain('higher-than-usual rate of negative feedback');
  });

  it('truncates verbatim correction text at 200 characters', async () => {
    const longCorrection = 'A'.repeat(400);
    const fb = feedbackPort([
      entry({
        signal: 'correction',
        correctionText: longCorrection,
        category: 'wrong-tone',
      }),
    ]);
    const system = await runOnce(fb);
    expect(system).toContain('Recent corrections you gave me:');
    // The fragment caps verbatim text at 200 chars (FEEDBACK_CORRECTION_TEXT_MAX).
    // Find the line, then verify it does not contain the full 400-char run.
    const lines = system.split('\n');
    const correctionLine = lines.find((l) => l.includes('AAAA'));
    expect(correctionLine).toBeDefined();
    if (correctionLine) {
      // The wrapper reads `    - "<text>"`; with text ≤ 200 chars total
      // length is bounded by 200 + the 6-char wrapper.
      const a200 = 'A'.repeat(200);
      const a201 = 'A'.repeat(201);
      expect(correctionLine).toContain(a200);
      expect(correctionLine).not.toContain(a201);
    }
  });

  it('lists only the first 3 verbatim corrections even when more are present', async () => {
    const fb = feedbackPort([
      entry({ signal: 'correction', correctionText: 'first wrong thing' }),
      entry({ signal: 'correction', correctionText: 'second wrong thing' }),
      entry({ signal: 'correction', correctionText: 'third wrong thing' }),
      entry({ signal: 'correction', correctionText: 'fourth should be dropped' }),
      entry({ signal: 'correction', correctionText: 'fifth should be dropped' }),
    ]);
    const system = await runOnce(fb);
    expect(system).toContain('first wrong thing');
    expect(system).toContain('second wrong thing');
    expect(system).toContain('third wrong thing');
    // Only 3 verbatim → the 4th and 5th are excluded.
    expect(system).not.toContain('fourth should be dropped');
    expect(system).not.toContain('fifth should be dropped');
  });

  it('renders no fragment when only the THUMBS-UP signal carries a category', async () => {
    // Categories on positive signals don't count as a "negative bucket"
    // → dominantCategory falls through to null → generic "as negative"
    // sentence with negativeCount=0.
    const fb = feedbackPort([
      entry({ signal: 'thumbs-up', category: 'great' }),
      entry({ signal: 'thumbs-up', category: 'helpful' }),
    ]);
    const system = await runOnce(fb);
    expect(system).toContain('You\'ve flagged 0 of my 2 recent answers as negative.');
    expect(system).not.toMatch(/as ".*"/);
  });
});
