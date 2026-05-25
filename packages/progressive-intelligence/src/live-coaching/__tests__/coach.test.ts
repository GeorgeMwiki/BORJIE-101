import { describe, expect, it } from 'vitest';
import type { Brain, BrainChunk, CoachingSchema } from '../../types.js';
import { coach } from '../coach.js';

const schema: CoachingSchema = {
  entityKind: 'tenant',
  fields: [
    { name: 'displayName', type: 'string', required: true },
    {
      name: 'monthlyRent',
      type: 'number',
      expectedRange: { min: 1000, max: 5_000_000 },
    },
  ],
};

function chunks(...c: BrainChunk[]): AsyncIterable<BrainChunk> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const x of c) yield x;
    },
  };
}

function brainEmitting(text: string): Brain {
  return {
    stream() {
      return chunks(
        { kind: 'token', text },
        { kind: 'done' },
      );
    },
  };
}

describe('coach', () => {
  it('returns heuristic-only hints when no brain is supplied', async () => {
    const hints = await coach({
      workInProgress: { monthlyRent: 10 },
      schema,
    });
    expect(hints.length).toBeGreaterThanOrEqual(2);
    expect(hints.every((h) => !h.id.startsWith('brain_'))).toBe(true);
  });

  it('appends parseable brain hints to heuristics', async () => {
    const brain = brainEmitting(
      JSON.stringify([
        {
          field: 'monthlyRent',
          severity: 'info',
          message: 'Comp set median is 250k; this is low.',
          reason: 'below_comp_set',
          confidence: 0.8,
        },
      ]),
    );
    const hints = await coach({
      workInProgress: { displayName: 'Jane', monthlyRent: 50 },
      schema,
      brain,
    });
    expect(hints.some((h) => h.id.startsWith('brain_'))).toBe(true);
    const brainHint = hints.find((h) => h.id.startsWith('brain_'));
    expect(brainHint?.message).toContain('Comp set median');
    expect(brainHint?.confidence).toBe(0.8);
  });

  it('silently falls back to heuristics when brain emits garbage', async () => {
    const brain = brainEmitting('not actually JSON at all');
    const hints = await coach({
      workInProgress: { monthlyRent: 1 },
      schema,
      brain,
    });
    expect(hints.every((h) => !h.id.startsWith('brain_'))).toBe(true);
  });

  it('drops brain hints that reference unknown fields', async () => {
    const brain = brainEmitting(
      JSON.stringify([
        { field: 'NOT_A_FIELD', severity: 'info', message: 'hi', reason: 'x' },
      ]),
    );
    const hints = await coach({
      workInProgress: { displayName: 'Jane' },
      schema,
      brain,
    });
    expect(hints.some((h) => h.id.startsWith('brain_'))).toBe(false);
  });

  it('falls back gracefully when brain throws', async () => {
    const errorBrain: Brain = {
      stream() {
        throw new Error('boom');
      },
    };
    const hints = await coach({
      workInProgress: { monthlyRent: 1 },
      schema,
      brain: errorBrain,
    });
    // Heuristics still produce something.
    expect(hints.length).toBeGreaterThanOrEqual(2);
  });

  it('accepts {hints: [...]} envelope', async () => {
    const brain = brainEmitting(
      JSON.stringify({
        hints: [
          {
            field: 'monthlyRent',
            severity: 'warn',
            message: 'wrapped',
            reason: 'wrapped',
          },
        ],
      }),
    );
    const hints = await coach({
      workInProgress: { displayName: 'Jane' },
      schema,
      brain,
    });
    expect(hints.some((h) => h.message === 'wrapped')).toBe(true);
  });
});
