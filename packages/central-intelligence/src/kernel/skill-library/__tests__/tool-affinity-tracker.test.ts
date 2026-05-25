/**
 * Tool affinity tracker — unit tests.
 *
 * Coverage:
 *   1. cold start: getAffinityScore returns 0.5 with empty store.
 *   2. cosine similarity helper — orthogonal → 0, identical → 1.
 *   3. recordToolUsage stores valid records.
 *   4. recordToolUsage rejects malformed records.
 *   5. affinity boosts a tool that succeeded for similar past intents.
 *   6. affinity penalises a tool that failed for similar past intents.
 *   7. re-rank returns base ranking on empty intent embedding.
 *   8. re-rank floats a strong-affinity tool above a base-top tool.
 *   9. re-rank cold start preserves base order (stable).
 *  10. ring buffer evicts oldest records past `maxRecords`.
 *  11. persistence — append called on recordToolUsage.
 *  12. persistence — hydrate loads stored records.
 *  13. similarityFloor excludes weak-similarity records.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  ToolAffinityTracker,
  cosineSimilarity,
  type AffinityPersistencePort,
  type ToolUsageRecord,
} from '../tool-affinity-tracker.js';

function mkRecord(
  overrides: Partial<ToolUsageRecord> = {},
): ToolUsageRecord {
  return {
    intent_embedding: [1, 0, 0],
    tool_name: 'sendSms',
    success: true,
    latency_ms: 100,
    cost_usd: 0.001,
    ts: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });
  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });
  it('returns 0 for mismatched dimensions', () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
  });
  it('returns 0 for zero magnitudes', () => {
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });
});

describe('ToolAffinityTracker', () => {
  it('cold start returns 0.5 for any tool', () => {
    const t = new ToolAffinityTracker();
    expect(t.getAffinityScore([1, 0, 0], 'anything')).toBe(0.5);
  });

  it('records valid usage', () => {
    const t = new ToolAffinityTracker();
    t.recordToolUsage(mkRecord());
    expect(t.size()).toBe(1);
  });

  it('rejects malformed records', () => {
    const t = new ToolAffinityTracker();
    t.recordToolUsage(mkRecord({ tool_name: '' }));
    t.recordToolUsage(mkRecord({ intent_embedding: [] }));
    t.recordToolUsage(mkRecord({ ts: '' }));
    expect(t.size()).toBe(0);
  });

  it('boosts tools that succeeded on similar past intents', () => {
    const t = new ToolAffinityTracker();
    t.recordToolUsage(mkRecord({ intent_embedding: [1, 0, 0], success: true }));
    t.recordToolUsage(mkRecord({ intent_embedding: [1, 0, 0], success: true }));
    const score = t.getAffinityScore([1, 0, 0], 'sendSms');
    expect(score).toBeGreaterThan(0.9);
  });

  it('penalises tools that failed on similar past intents', () => {
    const t = new ToolAffinityTracker();
    t.recordToolUsage(mkRecord({ intent_embedding: [1, 0, 0], success: false }));
    t.recordToolUsage(mkRecord({ intent_embedding: [1, 0, 0], success: false }));
    const score = t.getAffinityScore([1, 0, 0], 'sendSms');
    expect(score).toBeLessThan(0.1);
  });

  it('similarityFloor excludes weak-similarity records', () => {
    const t = new ToolAffinityTracker({ similarityFloor: 0.99 });
    t.recordToolUsage(mkRecord({ intent_embedding: [0.6, 0.8, 0], success: false }));
    // cos([1,0,0], [0.6,0.8,0]) = 0.6, below floor → cold start
    expect(t.getAffinityScore([1, 0, 0], 'sendSms')).toBe(0.5);
  });

  it('re-ranks with cold-start preserves base order (stable)', () => {
    const t = new ToolAffinityTracker();
    const base = [
      { name: 'a' },
      { name: 'b' },
      { name: 'c' },
    ];
    const re = t.reRankWithAffinity(base, [1, 0, 0]);
    expect(re.map((x) => x.name)).toEqual(['a', 'b', 'c']);
  });

  it('re-rank returns base on empty intent embedding', () => {
    const t = new ToolAffinityTracker();
    const base = [{ name: 'a' }, { name: 'b' }];
    expect(t.reRankWithAffinity(base, []).map((x) => x.name)).toEqual([
      'a',
      'b',
    ]);
  });

  it('floats a strong-affinity tool above the base top', () => {
    const t = new ToolAffinityTracker({ affinityWeight: 2 });
    // 'b' has a heavy history of success on [1,0,0]; 'a' has nothing.
    for (let i = 0; i < 8; i += 1) {
      t.recordToolUsage(
        mkRecord({
          intent_embedding: [1, 0, 0],
          tool_name: 'b',
          success: true,
        }),
      );
    }
    const base = [{ name: 'a' }, { name: 'b' }];
    const re = t.reRankWithAffinity(base, [1, 0, 0]);
    expect(re[0]?.name).toBe('b');
  });

  it('evicts oldest records past maxRecords', () => {
    const t = new ToolAffinityTracker({ maxRecords: 3 });
    for (let i = 0; i < 7; i += 1) {
      t.recordToolUsage(
        mkRecord({ ts: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z` }),
      );
    }
    expect(t.size()).toBe(3);
  });

  it('persistence — append is called on recordToolUsage', () => {
    const append = vi.fn(async () => undefined);
    const port: AffinityPersistencePort = {
      load: async () => [],
      append,
    };
    const t = new ToolAffinityTracker({ persistence: port });
    t.recordToolUsage(mkRecord());
    expect(append).toHaveBeenCalledTimes(1);
  });

  it('persistence — hydrate loads stored records', async () => {
    const stored = [mkRecord({ tool_name: 'a' }), mkRecord({ tool_name: 'b' })];
    const port: AffinityPersistencePort = {
      load: async () => stored,
      append: async () => undefined,
    };
    const t = new ToolAffinityTracker({ persistence: port });
    await t.hydrate();
    expect(t.size()).toBe(2);
  });

  it('persistence — append failures are swallowed', () => {
    const port: AffinityPersistencePort = {
      load: async () => [],
      append: async () => {
        throw new Error('boom');
      },
    };
    const t = new ToolAffinityTracker({ persistence: port });
    expect(() => t.recordToolUsage(mkRecord())).not.toThrow();
  });
});
