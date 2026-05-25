import { describe, expect, it } from 'vitest';
import { createProgressiveIntelligence } from '../factory.js';
import { createDeterministicMockEmbedder } from '../embedders.js';
import type { Brain, BrainChunk, MatchCandidate } from '../types.js';

function brainEmitting(chunks: BrainChunk[]): Brain {
  return {
    stream() {
      return {
        async *[Symbol.asyncIterator]() {
          for (const c of chunks) yield c;
        },
      };
    },
  };
}

describe('createProgressiveIntelligence', () => {
  it('binds the embedder so resolveEntity callers skip the embedder arg', async () => {
    const embedder = createDeterministicMockEmbedder({ dimension: 32 });
    const pi = createProgressiveIntelligence({ embedder });
    const probe: MatchCandidate = {
      entity: {
        id: 'p1',
        kind: 'tenant',
        tenantId: 't1',
        attributes: { displayName: 'Jane', email: 'jane@example.com' },
        updatedAt: '2026-05-01Z',
        schemaVersion: 1,
      },
    };
    const candidate: MatchCandidate = {
      entity: {
        id: 'c1',
        kind: 'tenant',
        tenantId: 't1',
        attributes: { displayName: 'Jane', email: 'jane@example.com' },
        updatedAt: '2026-05-01Z',
        schemaVersion: 1,
      },
    };
    const decision = await pi.resolveEntity({ probe, candidates: [candidate] });
    expect(decision.verdict).toBe('match');
  });

  it('binds the brain so streamInference callers skip the brain arg', async () => {
    const brain = brainEmitting([
      { kind: 'token', text: 'hi' },
      { kind: 'done' },
    ]);
    const pi = createProgressiveIntelligence({ brain });
    const events = [];
    for await (const ev of pi.streamInference({
      request: { prompt: 'hello' },
    })) {
      events.push(ev);
    }
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  it('streamInference throws helpfully when no brain is wired', () => {
    const pi = createProgressiveIntelligence();
    expect(() => pi.streamInference({ request: { prompt: 'x' } })).toThrow(
      /brain required/,
    );
  });
});
