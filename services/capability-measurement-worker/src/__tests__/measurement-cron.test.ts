import { describe, it, expect } from 'vitest';

import {
  createInMemoryCapabilityRepository,
  createInMemoryInvocationRepository,
  createInMemoryMeasurementRepository,
  createInMemoryOutcomeRepository,
  type Capability,
  type Invocation,
  type Outcome,
} from '@borjie/capability-catalogue';

import { runMeasurementTick } from '../cron/measurement-cron.js';

const noopLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function liveCap(): Capability {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    tenantId: 'tenant-A',
    name: 'compose_x',
    version: '1.0.0',
    kind: 'tenant',
    owner: 'tenant:tenant-A',
    lifecycleState: 'live',
    dependencies: [],
    contract: {
      inputSchema: {},
      outputSchema: {},
      costClass: 'tier_1',
      latencyBudgetMs: 5000,
    },
    provenanceClass: 'tenant_authored',
    createdAt: '2026-05-01T00:00:00.000Z',
    auditHash: 'h',
    prevHash: null,
  };
}

function draftCap(): Capability {
  return {
    ...liveCap(),
    id: '22222222-2222-2222-2222-222222222222',
    name: 'unused_cap',
    lifecycleState: 'draft',
  };
}

describe('runMeasurementTick', () => {
  it('persists one measurement per window when invocations exist', async () => {
    const cap = liveCap();
    const capRepo = createInMemoryCapabilityRepository({ rows: [cap] });
    const invRepo = createInMemoryInvocationRepository();
    const outRepo = createInMemoryOutcomeRepository();
    const measRepo = createInMemoryMeasurementRepository();

    const now = new Date('2026-05-26T00:00:00.000Z');
    const inv: Invocation = {
      id: 'inv-1',
      tenantId: 'tenant-A',
      capabilityId: cap.id,
      invokedAt: '2026-05-25T00:00:00.000Z',
      latencyMs: 100,
      success: true,
      errorKind: null,
      costUsdCents: 0,
      auditHash: 'h',
    };
    await invRepo.insert(inv);
    const outcome: Outcome = {
      id: 'o-1',
      invocationId: 'inv-1',
      claimedConfidence: 0.9,
      observedOutcome: 'confirmed',
      userFollowthrough: 'accepted',
      recordedAt: '2026-05-25T00:30:00.000Z',
      auditHash: 'h',
    };
    await outRepo.insert(outcome);

    const report = await runMeasurementTick({
      listTenants: async () => ['tenant-A'],
      capabilityRepo: capRepo,
      invocationRepo: invRepo,
      outcomeRepo: outRepo,
      measurementRepo: measRepo,
      now: () => now,
      logger: noopLogger,
    });

    expect(report.tenantsSwept).toBe(1);
    expect(report.capabilitiesSwept).toBe(1);
    // 3 windows × 1 capability — all carry the same invocation, so all 3
    // measurements persist.
    expect(report.measurementsPersisted).toBe(3);
    expect(report.measurementsSkipped).toBe(0);

    const persisted = await measRepo.listForTenant('tenant-A');
    expect(persisted).toHaveLength(3);
    for (const m of persisted) {
      expect(m.competenceRate).toBe(1);
      expect(m.utilityRate).toBe(1);
    }
  });

  it('skips windows with zero invocations', async () => {
    const cap = liveCap();
    const capRepo = createInMemoryCapabilityRepository({ rows: [cap] });
    const invRepo = createInMemoryInvocationRepository();
    const outRepo = createInMemoryOutcomeRepository();
    const measRepo = createInMemoryMeasurementRepository();

    const now = new Date('2026-05-26T00:00:00.000Z');
    const report = await runMeasurementTick({
      listTenants: async () => ['tenant-A'],
      capabilityRepo: capRepo,
      invocationRepo: invRepo,
      outcomeRepo: outRepo,
      measurementRepo: measRepo,
      now: () => now,
      logger: noopLogger,
    });

    expect(report.measurementsPersisted).toBe(0);
    expect(report.measurementsSkipped).toBe(3);
  });

  it('ignores draft / locked / deprecated capabilities', async () => {
    const live = liveCap();
    const draft = draftCap();
    const capRepo = createInMemoryCapabilityRepository({ rows: [live, draft] });
    const invRepo = createInMemoryInvocationRepository();
    const outRepo = createInMemoryOutcomeRepository();
    const measRepo = createInMemoryMeasurementRepository();

    const report = await runMeasurementTick({
      listTenants: async () => ['tenant-A'],
      capabilityRepo: capRepo,
      invocationRepo: invRepo,
      outcomeRepo: outRepo,
      measurementRepo: measRepo,
      now: () => new Date('2026-05-26T00:00:00.000Z'),
      logger: noopLogger,
    });

    // Only the live one counts.
    expect(report.capabilitiesSwept).toBe(1);
  });

  it('reports zero when there are no tenants', async () => {
    const capRepo = createInMemoryCapabilityRepository({ rows: [] });
    const invRepo = createInMemoryInvocationRepository();
    const outRepo = createInMemoryOutcomeRepository();
    const measRepo = createInMemoryMeasurementRepository();
    const report = await runMeasurementTick({
      listTenants: async () => [],
      capabilityRepo: capRepo,
      invocationRepo: invRepo,
      outcomeRepo: outRepo,
      measurementRepo: measRepo,
      now: () => new Date(),
      logger: noopLogger,
    });
    expect(report.tenantsSwept).toBe(0);
    expect(report.capabilitiesSwept).toBe(0);
    expect(report.measurementsPersisted).toBe(0);
  });
});
