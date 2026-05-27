/**
 * Control shell — opportunistic activation tests.
 *
 * Wave BLACKBOARD-CORE. Verifies:
 *   - picks the highest priority x freshness x competence scorer
 *   - filters by regionFilter (KSes that don't claim the region kind
 *     are excluded)
 *   - tie-broken lexicographically on KS id (deterministic under tests)
 *   - returns null when the top score is below the dormant floor
 *
 * Spec: Docs/DESIGN/BLACKBOARD_SOTA_2026.md §3.2, §6.
 */

import { describe, it, expect } from 'vitest';
import {
  BLACKBOARD_CONSTANTS,
  createControlShell,
  createInMemoryKnowledgeSourcesRepository,
  createKnowledgeSourceRegistry,
  createInMemoryRegionsRepository,
  createRegionManager,
  type KnowledgeSource,
} from '../index.js';
import {
  competenceByRegion,
  createInMemoryActivityClock,
  createInMemoryCompetenceLookup,
} from '../__fixtures__/control-shell.js';

async function buildSetup(): Promise<{
  readonly registry: ReadonlyArray<KnowledgeSource>;
  readonly regionId: string;
}> {
  const regionsRepo = createInMemoryRegionsRepository();
  const ksRepo = createInMemoryKnowledgeSourcesRepository();
  const mgr = createRegionManager({ repository: regionsRepo });
  const registry = createKnowledgeSourceRegistry({ repository: ksRepo });
  const region = await mgr.open({
    tenantId: 't1',
    id: 'incident-investigation:KAH-088',
    regionKind: 'incident-investigation',
  });
  // Two KS that claim the incident-investigation region; one that does not.
  await registry.register({
    tenantId: 't1',
    ksKind: 'junior',
    ksName: 'safety-officer',
    regionFilter: ['incident-investigation'],
    priority: 0.7,
  });
  await registry.register({
    tenantId: 't1',
    ksKind: 'junior',
    ksName: 'mining-planner',
    regionFilter: ['incident-investigation'],
    priority: 0.6,
  });
  await registry.register({
    tenantId: 't1',
    ksKind: 'tool',
    ksName: 'royalty-calculator',
    regionFilter: ['royalty-filing-prep'],
    priority: 1.0,
  });
  const all = await registry.listForRegion('t1', 'incident-investigation');
  return { registry: all, regionId: region.id };
}

describe('control-shell — opportunistic activation', () => {
  it('picks the highest priority x competence (KSes never spoke)', async () => {
    const { registry } = await buildSetup();
    const competence = createInMemoryCompetenceLookup(
      competenceByRegion({
        'incident-investigation': {
          'safety-officer': 0.9,
          'mining-planner': 0.5,
        },
      }),
    );
    const activityClock = createInMemoryActivityClock();
    const shell = createControlShell({ competence, activityClock });
    const regionsRepo = createInMemoryRegionsRepository();
    const region = await regionsRepo.open({
      tenantId: 't1',
      id: 'incident-investigation:KAH-088',
      regionKind: 'incident-investigation',
    });
    const decision = await shell.pickNext({ region, candidates: registry });
    expect(decision).not.toBeNull();
    expect(decision?.ksName).toBe('safety-officer');
    expect(decision?.breakdown.priority).toBeCloseTo(0.7, 5);
    expect(decision?.breakdown.competence).toBeCloseTo(0.9, 5);
    expect(decision?.breakdown.freshness).toBeCloseTo(1.0, 5);
  });

  it('filters out KSes that do not claim the region kind', async () => {
    const { registry } = await buildSetup();
    // Even with competence 1.0 for royalty-calculator, the region kind
    // mismatch should exclude it.
    expect(registry.map((k) => k.ksName)).not.toContain('royalty-calculator');
  });

  it('breaks ties lexicographically on ks.id (deterministic)', async () => {
    // Build two KS rows with the SAME priority + competence and known ids.
    const region = {
      id: 'r1',
      tenantId: 't1',
      regionKind: 'incident-investigation' as const,
      status: 'open' as const,
      openedAt: new Date(),
      closedAt: null,
      scopeId: null,
      prevHash: '',
      auditHash: 'h',
    };
    const ks1: KnowledgeSource = Object.freeze({
      id: 'aaa',
      tenantId: 't1',
      ksKind: 'junior',
      ksName: 'foo',
      regionFilter: ['incident-investigation'],
      priority: 0.6,
      auditHash: 'h',
    });
    const ks2: KnowledgeSource = Object.freeze({
      id: 'bbb',
      tenantId: 't1',
      ksKind: 'junior',
      ksName: 'bar',
      regionFilter: ['incident-investigation'],
      priority: 0.6,
      auditHash: 'h',
    });
    const competence = createInMemoryCompetenceLookup({
      map: {
        'foo::incident-investigation': 0.5,
        'bar::incident-investigation': 0.5,
      },
    });
    const activityClock = createInMemoryActivityClock();
    const shell = createControlShell({ competence, activityClock });
    const decision = await shell.pickNext({
      region,
      candidates: [ks1, ks2],
    });
    expect(decision?.ksId).toBe('aaa');
  });

  it('returns null when the top score is below the dormant floor', async () => {
    const region = {
      id: 'r1',
      tenantId: 't1',
      regionKind: 'incident-investigation' as const,
      status: 'open' as const,
      openedAt: new Date(),
      closedAt: null,
      scopeId: null,
      prevHash: '',
      auditHash: 'h',
    };
    const ks: KnowledgeSource = Object.freeze({
      id: 'aaa',
      tenantId: 't1',
      ksKind: 'junior',
      ksName: 'foo',
      regionFilter: ['incident-investigation'],
      priority: 0.01,
      auditHash: 'h',
    });
    const competence = createInMemoryCompetenceLookup({
      map: { 'foo::incident-investigation': 0.01 },
    });
    const activityClock = createInMemoryActivityClock({
      map: { 'aaa::r1': 0 }, // just spoke — freshness ≈ 0
    });
    const shell = createControlShell({ competence, activityClock });
    const decision = await shell.pickNext({ region, candidates: [ks] });
    // 0.01 x 0.01 x 1.0 = 1e-4 << 0.05 floor.
    expect(decision).toBeNull();
    expect(BLACKBOARD_CONSTANTS.CONTROL_SHELL_FLOOR).toBe(0.05);
  });
});
