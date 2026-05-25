/**
 * Canary-bridge contract tests.
 *
 * The bridge owns two closed-loop guarantees:
 *   1. regression pass-rate threshold blocks promotion past `shadow`
 *   2. SLO-driven demotion below `shadow` rolls back to the prior
 *      version (or retires the AOP if none exists)
 *
 * The adapter is wired to autonomy-governance in production; here we
 * inject a deterministic in-memory adapter that mimics the canary
 * controller's stage ladder semantics.
 */

import { describe, expect, it } from 'vitest';
import {
  createAOPCanaryBridge,
  type AOPCanaryAdapter,
  type AOPCanaryStage,
} from '../canary-bridge.js';
import {
  createAOPRegistry,
  createInMemoryAOPRegistryStore,
  type AOPRegistry,
} from '../aop-registry.js';
import type { AOPSpec, RegressionSet } from '../aop-spec.js';
import type { RegressionReport } from '../regression-runner.js';

const STAGE_LADDER: ReadonlyArray<AOPCanaryStage> = [
  'shadow',
  'canary-1pct',
  'canary-5pct',
  'canary-25pct',
  'live',
];

function nextStage(s: AOPCanaryStage): AOPCanaryStage | null {
  const i = STAGE_LADDER.indexOf(s);
  if (i === -1 || i === STAGE_LADDER.length - 1) return null;
  return STAGE_LADDER[i + 1] ?? null;
}

function prevStage(s: AOPCanaryStage): AOPCanaryStage | null {
  const i = STAGE_LADDER.indexOf(s);
  if (i <= 0) return null;
  return STAGE_LADDER[i - 1] ?? null;
}

/** In-memory adapter that mirrors `packages/autonomy-governance/src/slo/canary-controller.ts`. */
function inMemoryAdapter(): AOPCanaryAdapter {
  const stages = new Map<string, AOPCanaryStage>();
  const key = (id: string, v: string): string => `${id}@${v}`;
  return {
    async getStage(id, version) {
      return stages.get(key(id, version)) ?? null;
    },
    async promoteStage(id, version) {
      const cur = stages.get(key(id, version));
      if (!cur) throw new Error('not enrolled');
      const next = nextStage(cur);
      if (!next) throw new Error('already at live');
      stages.set(key(id, version), next);
      return next;
    },
    async demoteStage(id, version) {
      const cur = stages.get(key(id, version));
      if (!cur) return null;
      const prev = prevStage(cur);
      if (!prev) return null;
      stages.set(key(id, version), prev);
      return prev;
    },
    async enrol(id, version) {
      stages.set(key(id, version), 'shadow');
    },
    async retire(id, version) {
      stages.delete(key(id, version));
    },
  };
}

function spec(id: string, version: string): AOPSpec {
  return {
    id,
    version,
    systemPrompt: 'be precise',
    tools: [],
    model: { provider: 'anthropic', name: 'claude-opus-4-7' },
    regressionSetId: 'rs-1',
    ownedBy: 'platform',
    createdAt: new Date(0).toISOString(),
  } as AOPSpec;
}

function emptyReport(id: string, version: string, passRate: number): RegressionReport {
  return {
    aopId: id,
    aopVersion: version,
    regressionSetId: 'rs-1',
    total: 10,
    passed: Math.round(passRate * 10),
    failed: 10 - Math.round(passRate * 10),
    passRate,
    results: [],
    startedAt: new Date(0).toISOString(),
    completedAt: new Date(1).toISOString(),
  };
}

async function setup(): Promise<{ readonly registry: AOPRegistry; readonly adapter: AOPCanaryAdapter }> {
  const registry = await createAOPRegistry({ store: createInMemoryAOPRegistryStore() });
  await registry.registerRegressionSet({ id: 'rs-1', transcripts: [] } as RegressionSet);
  const adapter = inMemoryAdapter();
  return { registry, adapter };
}

describe('AOPCanaryBridge — regression gate', () => {
  it('blocks promotion when pass-rate below threshold', async () => {
    const { registry, adapter } = await setup();
    await registry.registerAOP(spec('triage', 'v1'));
    await adapter.enrol('triage', 'v1');
    const bridge = createAOPCanaryBridge({ registry, adapter, minRegressionPassRate: 0.9 });
    const result = await bridge.promote('triage', 'v1', emptyReport('triage', 'v1', 0.7));
    expect(result.kind).toBe('regression-gate-failed');
    expect(await adapter.getStage('triage', 'v1')).toBe('shadow');
  });

  it('promotes when pass-rate meets threshold', async () => {
    const { registry, adapter } = await setup();
    await registry.registerAOP(spec('triage', 'v1'));
    await adapter.enrol('triage', 'v1');
    const bridge = createAOPCanaryBridge({ registry, adapter, minRegressionPassRate: 0.9 });
    const result = await bridge.promote('triage', 'v1', emptyReport('triage', 'v1', 0.95));
    expect(result.kind).toBe('promoted');
    expect(await adapter.getStage('triage', 'v1')).toBe('canary-1pct');
  });

  it('flips active version on promotion to live', async () => {
    const { registry, adapter } = await setup();
    await registry.registerAOP(spec('triage', 'v1'));
    await adapter.enrol('triage', 'v1');
    const bridge = createAOPCanaryBridge({ registry, adapter, minRegressionPassRate: 0.5 });

    // Climb shadow → canary-1pct → canary-5pct → canary-25pct → live.
    for (let i = 0; i < 4; i++) {
      await bridge.promote('triage', 'v1', emptyReport('triage', 'v1', 1));
    }
    expect(registry.activeVersion('triage')).toBe('v1');
    expect(await adapter.getStage('triage', 'v1')).toBe('live');
  });

  it('rejects promote when registry / report id mismatch', async () => {
    const { registry, adapter } = await setup();
    await registry.registerAOP(spec('triage', 'v1'));
    await adapter.enrol('triage', 'v1');
    const bridge = createAOPCanaryBridge({ registry, adapter });
    await expect(
      bridge.promote('triage', 'v1', emptyReport('triage', 'v2', 1)),
    ).rejects.toThrow(/report mismatch/);
  });
});

describe('AOPCanaryBridge — SLO rollback contract', () => {
  it('demotes one stage when above shadow', async () => {
    const { registry, adapter } = await setup();
    await registry.registerAOP(spec('triage', 'v1'));
    await adapter.enrol('triage', 'v1');
    const bridge = createAOPCanaryBridge({ registry, adapter, minRegressionPassRate: 0.5 });
    await bridge.promote('triage', 'v1', emptyReport('triage', 'v1', 1));
    await bridge.promote('triage', 'v1', emptyReport('triage', 'v1', 1));
    // Now at canary-5pct.
    const result = await bridge.rollback('triage', 'v1');
    expect(result.kind).toBe('demoted');
    if (result.kind === 'demoted') {
      expect(result.fromStage).toBe('canary-5pct');
      expect(result.toStage).toBe('canary-1pct');
    }
  });

  it('rolls back to prior version when at shadow and prior version exists', async () => {
    const { registry, adapter } = await setup();
    await registry.registerAOP(spec('triage', 'v1'));
    await registry.registerAOP(spec('triage', 'v2'));
    await registry.setActiveVersion('triage', 'v2');
    await adapter.enrol('triage', 'v2');

    const bridge = createAOPCanaryBridge({ registry, adapter });
    const result = await bridge.rollback('triage', 'v2');
    expect(result.kind).toBe('rolled-back-to-previous');
    if (result.kind === 'rolled-back-to-previous') {
      expect(result.previousVersion).toBe('v1');
    }
    expect(registry.activeVersion('triage')).toBe('v1');
    expect(await adapter.getStage('triage', 'v2')).toBeNull();
  });

  it('retires and reports no-previous-version when nothing to fall back to', async () => {
    const { registry, adapter } = await setup();
    await registry.registerAOP(spec('triage', 'v1'));
    await registry.setActiveVersion('triage', 'v1');
    await adapter.enrol('triage', 'v1');

    const bridge = createAOPCanaryBridge({ registry, adapter });
    const result = await bridge.rollback('triage', 'v1');
    expect(result.kind).toBe('no-previous-version');
    expect(registry.activeVersion('triage')).toBeNull();
    expect(await adapter.getStage('triage', 'v1')).toBeNull();
  });

  it('reports not-enrolled when version was never canary-attached', async () => {
    const { registry, adapter } = await setup();
    await registry.registerAOP(spec('triage', 'v1'));
    const bridge = createAOPCanaryBridge({ registry, adapter });
    const r1 = await bridge.rollback('triage', 'v1');
    expect(r1.kind).toBe('not-enrolled');
    const r2 = await bridge.promote('triage', 'v1', emptyReport('triage', 'v1', 1));
    expect(r2.kind).toBe('not-enrolled');
  });
});
