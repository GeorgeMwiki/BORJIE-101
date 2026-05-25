/**
 * reflection tests — Wave 28 Learning-Loop.
 */

import { describe, it, expect } from 'vitest';
import { writeReflection } from '../reflection.js';
import { buildOutcome, createMemory, createMockLlm } from './helpers.js';

describe('reflection', () => {
  it('falls back to a deterministic reflection when no LLM is wired', async () => {
    const memory = createMemory();
    const outcome = buildOutcome({ actionId: 'a1', outcome: 'success' });
    const ref = await writeReflection(outcome, { memory });
    expect(ref.actionId).toBe('a1');
    expect(ref.lesson).toMatch(/Continue allowing/);
    const recall = await memory.recall('t1', 'reflection success', { limit: 5 });
    expect(recall.length).toBeGreaterThan(0);
    expect(recall[0].memory.metadata.kind).toBe('reflection');
  });

  it('parses an LLM payload when the port responds with valid JSON', async () => {
    const memory = createMemory();
    const llm = createMockLlm(
      JSON.stringify({
        what: 'refunded a small amount',
        why: 'under policy threshold',
        outcome: 'customer satisfied',
        lesson: 'current threshold is calibrated',
      }),
    );
    const outcome = buildOutcome({ actionId: 'llm_a', outcome: 'success' });
    const ref = await writeReflection(outcome, { memory, llm });
    expect(ref.lesson).toBe('current threshold is calibrated');
    expect(ref.what).toBe('refunded a small amount');
  });

  it('falls back deterministically if the LLM returns junk', async () => {
    const memory = createMemory();
    const llm = createMockLlm('not-json-at-all');
    const outcome = buildOutcome({ actionId: 'junk_a', outcome: 'failure' });
    const ref = await writeReflection(outcome, { memory, llm });
    expect(ref.lesson).toMatch(/Tighten/);
  });
});
