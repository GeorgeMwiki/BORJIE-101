/**
 * Stage 08 — publish unit tests.
 *
 * Coverage:
 *   1. publisher invoked once with the delta payload
 *   2. publisher failure logged, delta still returned
 *   3. no publisher → delta logged + returned
 *   4. tickId is generated when not supplied
 *   5. tickId is honoured when supplied
 */

import { describe, it, expect, vi } from 'vitest';
import { runPublishStage } from '../../stages/08-publish.js';
import type {
  BrainDelta,
  BrainDeltaPublisher,
  StageLogger,
} from '../../stages/types.js';

function makeLogger(): StageLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function publisher(opts: { fail?: boolean } = {}): {
  pub: BrainDeltaPublisher;
  calls: BrainDelta[];
} {
  const calls: BrainDelta[] = [];
  const pub: BrainDeltaPublisher = {
    async publish(d) {
      if (opts.fail) throw new Error('publish boom');
      calls.push(d);
    },
  };
  return { pub, calls };
}

const baseArgs = {
  windowStart: new Date(0).toISOString(),
  windowEnd: new Date(1_000).toISOString(),
  skillsPromoted: 2,
  promptPatches: 1,
  factsDecayed: 50,
  entitiesMerged: 3,
  factsReEmbedded: 10,
  clustersInspected: 7,
};

describe('runPublishStage', () => {
  it('invokes the publisher with the delta', async () => {
    const { pub, calls } = publisher();
    const out = await runPublishStage({
      logger: makeLogger(),
      publisher: pub,
      ...baseArgs,
    });
    expect(calls).toHaveLength(1);
    expect(out.skillsPromoted).toBe(2);
    expect(out.entitiesMerged).toBe(3);
  });

  it('still returns the delta when publisher throws', async () => {
    const { pub } = publisher({ fail: true });
    const out = await runPublishStage({
      logger: makeLogger(),
      publisher: pub,
      ...baseArgs,
    });
    expect(out.skillsPromoted).toBe(2);
  });

  it('works without a publisher', async () => {
    const out = await runPublishStage({
      logger: makeLogger(),
      ...baseArgs,
    });
    expect(out.skillsPromoted).toBe(2);
  });

  it('generates a tickId when not supplied', async () => {
    const out = await runPublishStage({
      logger: makeLogger(),
      ...baseArgs,
    });
    expect(out.tickId).toMatch(/^tick_/);
  });

  it('honours an explicit tickId', async () => {
    const out = await runPublishStage({
      logger: makeLogger(),
      ...baseArgs,
      tickId: 'tick_custom_42',
    });
    expect(out.tickId).toBe('tick_custom_42');
  });
});
