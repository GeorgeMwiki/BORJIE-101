import { describe, it, expect } from 'vitest';
import { runStaleCleaner } from '../registry/stale-cleaner.js';
import { createInMemoryActiveAgentsRepository } from '../storage/active-agents-repository.js';

describe('stale-cleaner', () => {
  it('clears agents whose heartbeat exceeds the threshold', async () => {
    let clockMs = 1_700_000_000_000;
    const repo = createInMemoryActiveAgentsRepository({
      now: () => new Date(clockMs),
    });
    const row = await repo.register({
      tenantId: 't1',
      agentId: 'safety',
      agentKind: 'specialisation',
    });
    // Advance clock past stale threshold.
    clockMs += 300_000;
    const result = await runStaleCleaner({
      repository: repo,
      now: () => new Date(clockMs),
      staleThresholdMs: 120_000,
    });
    expect(result.clearedIds).toContain(row.id);
  });

  it('leaves fresh agents alone', async () => {
    let clockMs = 1_700_000_000_000;
    const repo = createInMemoryActiveAgentsRepository({
      now: () => new Date(clockMs),
    });
    await repo.register({
      tenantId: 't1',
      agentId: 'safety',
      agentKind: 'specialisation',
    });
    clockMs += 10_000;
    const result = await runStaleCleaner({
      repository: repo,
      now: () => new Date(clockMs),
      staleThresholdMs: 120_000,
    });
    expect(result.clearedIds.length).toBe(0);
  });
});
