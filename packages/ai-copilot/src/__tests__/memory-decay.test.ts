/**
 * Memory decay tests — Wave-11.
 */

import { describe, it, expect } from 'vitest';
import {
  computeDecayedScore,
  sweepTenantDecay,
  DEFAULT_DECAY,
} from '../memory/memory-decay.js';
import {
  createInMemorySemanticMemoryRepo,
  createSemanticMemory,
  createHashEmbedder,
} from '../memory/semantic-memory.js';

describe('memory-decay', () => {
  it('reduces score for untouched memories over time', () => {
    const baseline = computeDecayedScore(
      { decayScore: 1, lastAccessedAt: new Date(0).toISOString(), accessCount: 0 },
      new Date(0),
      DEFAULT_DECAY,
    );
    const after30 = computeDecayedScore(
      { decayScore: 1, lastAccessedAt: new Date(0).toISOString(), accessCount: 0 },
      new Date(30 * 24 * 60 * 60 * 1000),
      DEFAULT_DECAY,
    );
    expect(after30).toBeLessThan(baseline);
  });

  it('applies access boost so recently-used memories decay slower', () => {
    const dormant = computeDecayedScore(
      { decayScore: 1, lastAccessedAt: new Date(0).toISOString(), accessCount: 0 },
      new Date(14 * 24 * 60 * 60 * 1000),
      DEFAULT_DECAY,
    );
    const frequent = computeDecayedScore(
      { decayScore: 1, lastAccessedAt: new Date(0).toISOString(), accessCount: 20 },
      new Date(14 * 24 * 60 * 60 * 1000),
      DEFAULT_DECAY,
    );
    expect(frequent).toBeGreaterThan(dormant);
  });

  it('sweep archives memories below threshold', async () => {
    const repo = createInMemorySemanticMemoryRepo();
    const memory = createSemanticMemory({ repo, embedder: createHashEmbedder(16) });
    const row = await memory.remember({ tenantId: 't1', content: 'to be archived' });
    if (row) {
      await repo.updateDecay(row.id, 0.05);
      // Simulate old access.
      const stale = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
      await repo.touch(row.id, stale, 0);
    }
    const result = await sweepTenantDecay('t1', {
      repo,
      now: () => new Date(),
      policy: { archiveBelow: 0.1 },
    });
    expect(result.archived).toBeGreaterThan(0);
    const remaining = await repo.listForTenant('t1');
    expect(remaining.length).toBe(0);
  });
});
