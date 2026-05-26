import { describe, it, expect } from 'vitest';

import {
  createInMemoryCapabilityRepository,
  createInMemoryInvocationRepository,
  createInMemoryMeasurementRepository,
  createInMemoryOutcomeRepository,
  type Capability,
  type Invocation,
  type Measurement,
  type Outcome,
} from '../index.js';

const seedCap: Capability = {
  id: 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
  tenantId: '__seed__',
  name: 'research_v1',
  version: '1.0.0',
  kind: 'atomic',
  owner: 'platform',
  lifecycleState: 'live',
  dependencies: [],
  contract: {
    inputSchema: {},
    outputSchema: {},
    costClass: 'tier_1',
    latencyBudgetMs: 8000,
  },
  provenanceClass: 'seed',
  createdAt: new Date().toISOString(),
  auditHash: 'h',
  prevHash: null,
};

const tenantCap: Capability = {
  id: 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2',
  tenantId: 'tenant-A',
  name: 'compose_x',
  version: '0.1.0',
  kind: 'tenant',
  owner: 'tenant:tenant-A',
  lifecycleState: 'shadow',
  dependencies: [],
  contract: {
    inputSchema: {},
    outputSchema: {},
    costClass: 'tier_1',
    latencyBudgetMs: 5000,
  },
  provenanceClass: 'tenant_authored',
  createdAt: new Date().toISOString(),
  auditHash: 'h',
  prevHash: null,
};

describe('in-memory repositories', () => {
  it('CapabilityRepository: lists seed + own-tenant rows', async () => {
    const repo = createInMemoryCapabilityRepository({
      rows: [seedCap, tenantCap],
    });
    const rows = await repo.listAll('tenant-A');
    expect(rows.map((r) => r.id).sort()).toEqual(
      [seedCap.id, tenantCap.id].sort(),
    );

    const otherTenant = await repo.listAll('tenant-B');
    expect(otherTenant.map((r) => r.id)).toEqual([seedCap.id]);
  });

  it('InvocationRepository: filters by window', async () => {
    const repo = createInMemoryInvocationRepository();
    const baseline = '2026-05-26T00:00:00.000Z';
    const before: Invocation = {
      id: 'i1',
      tenantId: 'tenant-A',
      capabilityId: tenantCap.id,
      invokedAt: '2026-05-20T00:00:00.000Z',
      latencyMs: 100,
      success: true,
      errorKind: null,
      costUsdCents: 0,
      auditHash: 'h',
    };
    const inWindow: Invocation = { ...before, id: 'i2', invokedAt: baseline };
    await repo.insert(before);
    await repo.insert(inWindow);
    const got = await repo.listByCapabilityInWindow({
      tenantId: 'tenant-A',
      capabilityId: tenantCap.id,
      from: '2026-05-25T00:00:00.000Z',
      to: '2026-05-27T00:00:00.000Z',
    });
    expect(got.map((g) => g.id)).toEqual(['i2']);
  });

  it('OutcomeRepository: scopes by invocation ids', async () => {
    const repo = createInMemoryOutcomeRepository();
    const o1: Outcome = {
      id: 'o1',
      invocationId: 'i1',
      claimedConfidence: 0.5,
      observedOutcome: 'confirmed',
      userFollowthrough: 'accepted',
      recordedAt: new Date().toISOString(),
      auditHash: 'h',
    };
    const o2: Outcome = { ...o1, id: 'o2', invocationId: 'i2' };
    await repo.insert(o1);
    await repo.insert(o2);
    const got = await repo.listForInvocations({ invocationIds: ['i2'] });
    expect(got.map((g) => g.id)).toEqual(['o2']);
  });

  it('MeasurementRepository: latestForCapability returns the most recent', async () => {
    const repo = createInMemoryMeasurementRepository();
    const baseline: Measurement = {
      id: 'm1',
      tenantId: 'tenant-A',
      capabilityId: tenantCap.id,
      windowDays: 7,
      measuredAt: '2026-05-20T00:00:00.000Z',
      competenceRate: 0.7,
      calibrationError: 0.2,
      utilityRate: 0.4,
      nObservations: 30,
      auditHash: 'h',
    };
    const newer: Measurement = {
      ...baseline,
      id: 'm2',
      measuredAt: '2026-05-26T00:00:00.000Z',
      competenceRate: 0.9,
    };
    await repo.insert(baseline);
    await repo.insert(newer);
    const got = await repo.latestForCapability({
      tenantId: 'tenant-A',
      capabilityId: tenantCap.id,
      windowDays: 7,
    });
    expect(got?.id).toBe('m2');
  });
});
