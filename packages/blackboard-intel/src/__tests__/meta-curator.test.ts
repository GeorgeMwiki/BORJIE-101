import { describe, it, expect } from 'vitest';
import { createMetaCurator } from '../feedback/meta-curator.js';
import { createInMemoryBlackboardCore } from '../__fixtures__/in-memory-blackboard-core.js';
import { createInMemoryPostQualityScoresRepository } from '../repositories/post-quality-scores-repository.js';
import { createInMemoryCapabilityRegistryPort } from '../capability/register-blackboard-capabilities.js';
import { registerBlackboardCapabilities } from '../capability/register-blackboard-capabilities.js';
import { createDefaultAuditChainPort } from '../audit/post-audit-chain.js';
import { createPostMeasurer } from '../measure/post-measurer.js';
import type { BlackboardPostRef } from '../types.js';

function makePost(
  overrides: Partial<BlackboardPostRef> = {},
): BlackboardPostRef {
  return Object.freeze({
    id: 'post-1',
    tenantId: 'tenant-1',
    content: 'loader-7 fuel spike is bearing fatigue',
    authorKind: 'junior' as const,
    citations: ['cite-1'] as ReadonlyArray<string>,
    postedAt: '2026-05-27T09:55:00.000Z',
    parentThreadId: null,
    hedgeMarkers: [] as ReadonlyArray<string>,
    contentEmbedding: null,
    ...overrides,
  });
}

let uuidCounter = 0;
const fakeUuid = (): string => {
  uuidCounter += 1;
  return `id-${uuidCounter}`;
};

describe('createMetaCurator', () => {
  it('emits a RawTrace-compatible record for a measured post', async () => {
    uuidCounter = 0;
    const core = createInMemoryBlackboardCore();
    core.seed([makePost()]);
    core.setResolvableCitations(['cite-1']);

    const registry = createInMemoryCapabilityRegistryPort({
      uuid: fakeUuid,
    });
    await registerBlackboardCapabilities('tenant-1', registry);

    const scoresRepo = createInMemoryPostQualityScoresRepository();
    const auditChain = createDefaultAuditChainPort();
    const clock = {
      nowIso: () => '2026-05-27T10:00:00.000Z',
      nowMs: () => Date.parse('2026-05-27T10:00:00.000Z'),
    };
    const measurer = createPostMeasurer({
      blackboardCore: core,
      repo: scoresRepo,
      auditChain,
      clock,
      uuid: { next: fakeUuid },
    });
    await measurer.measure('tenant-1', 'post-1');

    const curator = createMetaCurator({
      blackboardCore: core,
      scoresRepo,
      registry,
    });
    const trace = await curator.buildTraceForPost('tenant-1', 'post-1');
    expect(trace.tenantId).toBe('tenant-1');
    expect(trace.id).toBe('post-1');
    // Groundedness=1, calibration=0.5 (no follow-ups), utility=0.
    // baseReward = (1 + 0.5 + 0)/3 - 0.5 = 0.
    expect(trace.baseReward).toBeCloseTo(0, 6);
    expect(trace.confidenceScore).toBe(1);
    expect(trace.coverageScore).toBe(0);
    expect(trace.redactionPenalty).toBe(0);
    expect(trace.capabilityId).not.toBe('unregistered:junior');
  });

  it('throws when the score set is incomplete', async () => {
    uuidCounter = 0;
    const core = createInMemoryBlackboardCore();
    core.seed([makePost()]);
    const registry = createInMemoryCapabilityRegistryPort({
      uuid: fakeUuid,
    });
    const scoresRepo = createInMemoryPostQualityScoresRepository();
    const curator = createMetaCurator({
      blackboardCore: core,
      scoresRepo,
      registry,
    });
    await expect(
      curator.buildTraceForPost('tenant-1', 'post-1'),
    ).rejects.toThrow();
  });
});
