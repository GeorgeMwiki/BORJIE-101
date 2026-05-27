/**
 * Summary generator + rolling-summary cron tests.
 *
 * Wave BLACKBOARD-CORE. Verifies:
 *   - generator respects the token budget per summary_kind
 *   - generator forwards regionKindHint to the LLM port
 *   - rolling cron skips regions younger than 2h
 *   - rolling cron emits a summary for regions older than 2h with new
 *     posts; the next tick skips if no posts have arrived since.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createInMemoryPostsRepository,
  createInMemoryRegionsRepository,
  createInMemorySummariesRepository,
  createPostPublisher,
  createSummaryGenerator,
  createRollingSummaryCron,
  BLACKBOARD_CONSTANTS,
  type Post,
} from '../index.js';
import { createDeterministicSummaryLLM } from '../__fixtures__/summary-llm.js';
import { createManualClock } from '../__fixtures__/clock.js';

function mkPost(id: string, content: string, postedAt: Date): Post {
  return Object.freeze({
    id,
    tenantId: 't1',
    regionId: 'r1',
    ksId: 'ks',
    parentPostId: null,
    content,
    contentEmbedding: null,
    structured: {},
    postedAt,
    editCount: 0,
    prevHash: '',
    auditHash: 'h',
  });
}

describe('summary-generator — token budgets', () => {
  it('respects the rolling token budget (500 tokens)', async () => {
    const generator = createSummaryGenerator({
      llm: createDeterministicSummaryLLM(),
    });
    const posts = Array.from({ length: 4 }, (_, i) =>
      mkPost(`p-${i}`, `post #${i} ` + 'x'.repeat(50), new Date(1000 + i)),
    );
    const result = await generator.generate({
      tenantId: 't1',
      regionId: 'r1',
      summaryKind: 'rolling',
      posts,
      coversFrom: new Date(1000),
      coversTo: new Date(1005),
    });
    expect(result.tokenCount).toBeLessThanOrEqual(
      BLACKBOARD_CONSTANTS.ROLLING_SUMMARY_TOKEN_BUDGET,
    );
    expect(result.summaryText.length).toBeGreaterThan(0);
  });

  it('hard-clamps token_count at the budget when LLM overshoots', async () => {
    const llm = {
      summarise: vi.fn().mockResolvedValue({
        text: 'X'.repeat(99999),
        tokenCount: 99999,
      }),
    };
    const generator = createSummaryGenerator({ llm });
    const result = await generator.generate({
      tenantId: 't1',
      regionId: 'r1',
      summaryKind: 'final',
      posts: [mkPost('p1', 'content', new Date(1))],
      coversFrom: new Date(1),
      coversTo: new Date(2),
    });
    expect(result.tokenCount).toBeLessThanOrEqual(
      BLACKBOARD_CONSTANTS.FINAL_SUMMARY_TOKEN_BUDGET,
    );
  });

  it('forwards regionKindHint to the LLM port', async () => {
    const summarise = vi.fn().mockResolvedValue({ text: 's', tokenCount: 1 });
    const generator = createSummaryGenerator({ llm: { summarise } });
    await generator.generate({
      tenantId: 't1',
      regionId: 'r1',
      summaryKind: 'rolling',
      posts: [mkPost('p1', 'content', new Date(1))],
      coversFrom: new Date(1),
      coversTo: new Date(2),
      regionKindHint: 'incident-investigation',
    });
    expect(summarise).toHaveBeenCalled();
    const callArg = summarise.mock.calls[0]?.[0];
    expect(callArg.regionKind).toBe('incident-investigation');
  });
});

describe('rolling-summary-cron — 2h threshold', () => {
  it('skips regions younger than 2 hours', async () => {
    const clock = createManualClock('2026-05-27T08:00:00Z');
    const regionsRepo = createInMemoryRegionsRepository({
      now: () => clock.now(),
    });
    const postsRepo = createInMemoryPostsRepository({
      now: () => clock.now(),
    });
    const summariesRepo = createInMemorySummariesRepository({
      now: () => clock.now(),
    });
    const region = await regionsRepo.open({
      tenantId: 't1',
      id: 'incident-investigation:KAH-088',
      regionKind: 'incident-investigation',
    });
    const publisher = createPostPublisher({ repository: postsRepo });
    await publisher.publish({
      tenantId: 't1',
      regionId: region.id,
      ksId: 'ks',
      content: 'first observation',
    });
    // Advance 1 hour — still under the 2h threshold.
    clock.advanceMs(60 * 60 * 1000);
    const cron = createRollingSummaryCron({
      tenantId: 't1',
      regions: regionsRepo,
      posts: postsRepo,
      summaries: summariesRepo,
      generator: createSummaryGenerator({
        llm: createDeterministicSummaryLLM(),
      }),
      now: () => clock.now(),
    });
    const tick = await cron.tick();
    expect(tick.emitted).toBe(0);
    expect(tick.skipped).toBe(1);
  });

  it('emits a rolling summary for regions older than 2h with new posts', async () => {
    const clock = createManualClock('2026-05-27T08:00:00Z');
    const regionsRepo = createInMemoryRegionsRepository({
      now: () => clock.now(),
    });
    const postsRepo = createInMemoryPostsRepository({
      now: () => clock.now(),
    });
    const summariesRepo = createInMemorySummariesRepository({
      now: () => clock.now(),
    });
    const region = await regionsRepo.open({
      tenantId: 't1',
      id: 'incident-investigation:KAH-088',
      regionKind: 'incident-investigation',
    });
    const publisher = createPostPublisher({ repository: postsRepo });
    await publisher.publish({
      tenantId: 't1',
      regionId: region.id,
      ksId: 'ks',
      content: 'first observation',
    });
    // Advance past 2h.
    clock.advanceMs(3 * 60 * 60 * 1000);
    await publisher.publish({
      tenantId: 't1',
      regionId: region.id,
      ksId: 'ks',
      content: 'second observation at hour 3',
    });
    const cron = createRollingSummaryCron({
      tenantId: 't1',
      regions: regionsRepo,
      posts: postsRepo,
      summaries: summariesRepo,
      generator: createSummaryGenerator({
        llm: createDeterministicSummaryLLM(),
      }),
      now: () => clock.now(),
    });
    const tick = await cron.tick();
    expect(tick.evaluated).toBe(1);
    expect(tick.emitted).toBe(1);
    const summaries = await summariesRepo.listByRegion('t1', region.id);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.summaryKind).toBe('rolling');
  });

  it('next tick skips when no posts have arrived since last summary', async () => {
    const clock = createManualClock('2026-05-27T08:00:00Z');
    const regionsRepo = createInMemoryRegionsRepository({
      now: () => clock.now(),
    });
    const postsRepo = createInMemoryPostsRepository({
      now: () => clock.now(),
    });
    const summariesRepo = createInMemorySummariesRepository({
      now: () => clock.now(),
    });
    const region = await regionsRepo.open({
      tenantId: 't1',
      id: 'incident-investigation:KAH-088',
      regionKind: 'incident-investigation',
    });
    const publisher = createPostPublisher({ repository: postsRepo });
    await publisher.publish({
      tenantId: 't1',
      regionId: region.id,
      ksId: 'ks',
      content: 'one',
    });
    clock.advanceMs(3 * 60 * 60 * 1000); // beyond 2h
    const cron = createRollingSummaryCron({
      tenantId: 't1',
      regions: regionsRepo,
      posts: postsRepo,
      summaries: summariesRepo,
      generator: createSummaryGenerator({
        llm: createDeterministicSummaryLLM(),
      }),
      now: () => clock.now(),
    });
    const first = await cron.tick();
    expect(first.emitted).toBe(1);
    clock.advanceMs(30 * 60 * 1000); // another 30 min
    const second = await cron.tick();
    expect(second.emitted).toBe(0);
    expect(second.skipped).toBe(1);
  });
});
