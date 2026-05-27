import { describe, it, expect } from 'vitest';
import { createPostMeasurer, AXIS_ORDER } from '../measure/post-measurer.js';
import { createInMemoryBlackboardCore } from '../__fixtures__/in-memory-blackboard-core.js';
import { createInMemoryPostQualityScoresRepository } from '../repositories/post-quality-scores-repository.js';
import { createDefaultAuditChainPort } from '../audit/post-audit-chain.js';
import { BlackboardIntelError, type BlackboardPostRef } from '../types.js';

let uuidCounter = 0;
const fakeUuid = (): string => {
  uuidCounter += 1;
  return `uuid-${uuidCounter}`;
};

function deps() {
  uuidCounter = 0;
  const core = createInMemoryBlackboardCore();
  const repo = createInMemoryPostQualityScoresRepository();
  const auditChain = createDefaultAuditChainPort();
  let nowMs = Date.parse('2026-05-27T10:00:00.000Z');
  const clock = {
    nowIso: () => new Date(nowMs).toISOString(),
    nowMs: () => nowMs,
  };
  const uuid = { next: fakeUuid };
  return { core, repo, auditChain, clock, uuid, tick: (ms: number) => { nowMs += ms; } };
}

function makePost(
  overrides: Partial<BlackboardPostRef> = {},
): BlackboardPostRef {
  return Object.freeze({
    id: 'post-1',
    tenantId: 'tenant-1',
    content: 'the loader-7 fuel spike is bearing fatigue',
    authorKind: 'junior' as const,
    citations: ['cite-1'] as ReadonlyArray<string>,
    postedAt: '2026-05-27T09:55:00.000Z',
    parentThreadId: null,
    hedgeMarkers: [] as ReadonlyArray<string>,
    contentEmbedding: null,
    ...overrides,
  });
}

describe('createPostMeasurer', () => {
  it('emits exactly three score rows in groundedness → calibration → utility order', async () => {
    const d = deps();
    d.core.seed([makePost()]);
    d.core.setResolvableCitations(['cite-1']);

    const measurer = createPostMeasurer({
      blackboardCore: d.core,
      repo: d.repo,
      auditChain: d.auditChain,
      clock: d.clock,
      uuid: d.uuid,
    });

    const rows = await measurer.measure('tenant-1', 'post-1');
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.axis)).toEqual([...AXIS_ORDER]);
    // Groundedness — 1 citation resolved.
    expect(rows[0]?.score).toBe(1);
    // Calibration — no follow-ups, neutral 0.5.
    expect(rows[1]?.score).toBe(0.5);
    // Utility — no cross-refs.
    expect(rows[2]?.score).toBe(0);
  });

  it('chains audit hashes across the three rows', async () => {
    const d = deps();
    d.core.seed([makePost()]);
    d.core.setResolvableCitations(['cite-1']);
    const measurer = createPostMeasurer({
      blackboardCore: d.core,
      repo: d.repo,
      auditChain: d.auditChain,
      clock: d.clock,
      uuid: d.uuid,
    });
    const rows = await measurer.measure('tenant-1', 'post-1');
    expect(rows[0]?.prevHash).toBe('');
    expect(rows[1]?.prevHash).toBe(rows[0]?.auditHash);
    expect(rows[2]?.prevHash).toBe(rows[1]?.auditHash);
    expect(new Set(rows.map((r) => r.auditHash)).size).toBe(3);
  });

  it('throws POST_NOT_FOUND when the post is missing', async () => {
    const d = deps();
    const measurer = createPostMeasurer({
      blackboardCore: d.core,
      repo: d.repo,
      auditChain: d.auditChain,
      clock: d.clock,
      uuid: d.uuid,
    });
    await expect(measurer.measure('tenant-1', 'absent')).rejects.toBeInstanceOf(
      BlackboardIntelError,
    );
  });
});
