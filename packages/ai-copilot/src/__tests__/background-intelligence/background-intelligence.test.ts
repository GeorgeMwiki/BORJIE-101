import { describe, it, expect } from 'vitest';
import {
  BackgroundTaskScheduler,
  InMemoryInsightStore,
  IntelligenceSyncService,
  buildTaskCatalogue,
  shouldRun,
  type BackgroundTaskData,
  type FeatureFlagProbe,
  type TenantProvider,
} from '../../background-intelligence/index.js';

const T1 = 'tenant_alpha';
const T2 = 'tenant_bravo';

function makeData(overrides: Partial<BackgroundTaskData> = {}): BackgroundTaskData {
  return {
    listPropertiesForHealthScan: async () => [
      {
        id: 'prop_1',
        name: 'Goba Heights',
        occupancyRate: 0.4,
        openTickets: 7,
        lastInspectionDaysAgo: 80,
      },
    ],
    listArrearsCases: async () => [
      {
        id: 'case_1',
        tenantName: 'Neema',
        unitId: 'B-12',
        daysOverdue: 65,
        balance: 1_200_000,
        ladderStep: 2,
      },
    ],
    listLeasesNearExpiry: async () => [
      {
        leaseId: 'lease_1',
        tenantName: 'Mama Asha',
        unitId: 'A-04',
        daysToExpiry: 45,
        rent: 800_000,
      },
    ],
    listInspectionsDue: async () => [
      {
        id: 'ins_1',
        propertyId: 'prop_2',
        daysOverdue: 20,
        type: 'FAR',
      },
    ],
    listComplianceNotices: async () => [
      { id: 'comp_1', kind: 'fire_permit', expiresInDays: 10 },
    ],
    summariseMonthlyCosts: async () => ({
      periodYearMonth: '2026-03',
      grossCost: 42_000_000,
      topCategories: [{ category: 'repairs', amount: 10_000_000 }],
    }),
    listVendorPerformance: async () => [
      {
        vendorId: 'v1',
        vendorName: 'Jiko Fix',
        completedTickets: 8,
        avgResolutionHours: 20,
        satisfactionScore: 0.6,
      },
    ],
    recomputeTenantHealth: async () => [
      {
        tenantProfileId: 'tp_1',
        tenantName: 'Mohamed',
        unitId: 'C-03',
        payment: 0.3,
        property: 0.9,
        people: 0.8,
        paperwork: 0.9,
        presence: 0.7,
      },
    ],
    ...overrides,
  };
}

function makeFlagsAllOn(): FeatureFlagProbe {
  return { isEnabled: async () => true };
}

function makeFlagsAllOff(): FeatureFlagProbe {
  return { isEnabled: async () => false };
}

function makeTenants(ids: readonly string[]): TenantProvider {
  return { listActiveTenants: async () => ids };
}

describe('BackgroundIntelligence: catalogue', () => {
  it('builds exactly eight scheduled tasks', () => {
    const tasks = buildTaskCatalogue(makeData());
    expect(tasks).toHaveLength(8);
  });

  it('every task has a unique name and a feature flag', () => {
    const tasks = buildTaskCatalogue(makeData());
    const names = tasks.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of tasks) {
      expect(t.featureFlagKey).toMatch(/^ai\.bg\./);
    }
  });
});

describe('BackgroundIntelligence: individual task bodies', () => {
  it('portfolio_health_scan emits medium/high for weak properties', async () => {
    const store = new InMemoryInsightStore();
    const tasks = buildTaskCatalogue(makeData());
    const task = tasks.find((t) => t.name === 'portfolio_health_scan')!;
    const summary = await task.run({
      tenantId: T1,
      now: new Date('2026-04-19T02:00:00Z'),
      store,
    });
    expect(summary.insightsEmitted).toBeGreaterThan(0);
    const unacked = await store.listUnacknowledged(T1);
    expect(unacked[0].severity).toBe('high');
  });

  it('arrears_ladder_tick maps days-overdue to severity', async () => {
    const store = new InMemoryInsightStore();
    const tasks = buildTaskCatalogue(makeData());
    const task = tasks.find((t) => t.name === 'arrears_ladder_tick')!;
    const summary = await task.run({
      tenantId: T1,
      now: new Date(),
      store,
    });
    expect(summary.insightsEmitted).toBe(1);
    const ins = await store.listUnacknowledged(T1);
    expect(ins[0].severity).toBe('high');
  });

  it('renewal_proposal_generator emits one insight per lease near expiry', async () => {
    const store = new InMemoryInsightStore();
    const tasks = buildTaskCatalogue(makeData());
    const task = tasks.find((t) => t.name === 'renewal_proposal_generator')!;
    const summary = await task.run({
      tenantId: T1,
      now: new Date(),
      store,
    });
    expect(summary.insightsEmitted).toBe(1);
  });

  it('renewal_proposal_generator dispatches a real proposal when the port is wired', async () => {
    const calls: Array<{ leaseId: string; tenantId: string; currentRent: number }> = [];
    const data = makeData({
      renewalProposal: {
        async propose(input) {
          calls.push({
            leaseId: input.leaseId,
            tenantId: input.tenantId,
            currentRent: input.currentRent,
          });
          return { proposalId: 'prop_42', proposedRent: 880_000 };
        },
      },
    });
    const store = new InMemoryInsightStore();
    const tasks = buildTaskCatalogue(data);
    const task = tasks.find((t) => t.name === 'renewal_proposal_generator')!;
    const summary = await task.run({
      tenantId: T1,
      now: new Date(),
      store,
    });
    expect(summary.insightsEmitted).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].tenantId).toBe(T1);
    expect(calls[0].leaseId).toBe('lease_1');
    expect(calls[0].currentRent).toBe(800_000);
    const ins = await store.listUnacknowledged(T1);
    expect(ins[0].title).toContain('submitted');
  });

  it('far_inspection_reminder_sweep flags overdue inspections', async () => {
    const store = new InMemoryInsightStore();
    const tasks = buildTaskCatalogue(makeData());
    const task = tasks.find((t) => t.name === 'far_inspection_reminder_sweep')!;
    const summary = await task.run({
      tenantId: T1,
      now: new Date(),
      store,
    });
    expect(summary.insightsEmitted).toBe(1);
  });

  it('compliance_expiry_check skips notices outside the window', async () => {
    const data = makeData({
      listComplianceNotices: async () => [
        { id: 'c1', kind: 'x', expiresInDays: 200 },
      ],
    });
    const store = new InMemoryInsightStore();
    const tasks = buildTaskCatalogue(data);
    const task = tasks.find((t) => t.name === 'compliance_expiry_check')!;
    const summary = await task.run({ tenantId: T1, now: new Date(), store });
    expect(summary.insightsEmitted).toBe(0);
  });

  it('cost_ledger_rollup emits exactly one insight', async () => {
    const store = new InMemoryInsightStore();
    const tasks = buildTaskCatalogue(makeData());
    const task = tasks.find((t) => t.name === 'cost_ledger_rollup')!;
    const summary = await task.run({ tenantId: T1, now: new Date(), store });
    expect(summary.insightsEmitted).toBe(1);
  });

  it('vendor_performance_digest flags underperformers', async () => {
    const store = new InMemoryInsightStore();
    const tasks = buildTaskCatalogue(makeData());
    const task = tasks.find((t) => t.name === 'vendor_performance_digest')!;
    const summary = await task.run({ tenantId: T1, now: new Date(), store });
    expect(summary.insightsEmitted).toBe(1);
  });

  it('tenant_health_5ps_recompute flags weak dimensions', async () => {
    const store = new InMemoryInsightStore();
    const tasks = buildTaskCatalogue(makeData());
    const task = tasks.find((t) => t.name === 'tenant_health_5ps_recompute')!;
    const summary = await task.run({ tenantId: T1, now: new Date(), store });
    expect(summary.insightsEmitted).toBe(1);
  });
});

describe('BackgroundIntelligence: dedupe + acknowledgement', () => {
  it('upsert dedupes on (tenant, dedupeKey)', async () => {
    const store = new InMemoryInsightStore();
    const tasks = buildTaskCatalogue(makeData());
    const task = tasks.find((t) => t.name === 'portfolio_health_scan')!;
    await task.run({ tenantId: T1, now: new Date(), store });
    await task.run({ tenantId: T1, now: new Date(), store });
    const rows = await store.listUnacknowledged(T1);
    expect(rows).toHaveLength(1);
  });

  it('acknowledge removes from unacknowledged list', async () => {
    const store = new InMemoryInsightStore();
    const tasks = buildTaskCatalogue(makeData());
    const task = tasks.find((t) => t.name === 'portfolio_health_scan')!;
    await task.run({ tenantId: T1, now: new Date(), store });
    const rows = await store.listUnacknowledged(T1);
    await store.acknowledge(rows[0].id, T1, 'user_1');
    const after = await store.listUnacknowledged(T1);
    expect(after).toHaveLength(0);
  });
});

describe('BackgroundIntelligence: scheduler', () => {
  it('respects feature-flag gating', async () => {
    const store = new InMemoryInsightStore();
    const scheduler = new BackgroundTaskScheduler({
      store,
      tenants: makeTenants([T1]),
      featureFlags: makeFlagsAllOff(),
      tasks: buildTaskCatalogue(makeData()),
      now: () => new Date('2026-04-19T02:00:00Z'),
    });
    const summaries = await scheduler.tick();
    expect(summaries).toHaveLength(0);
  });

  it('runOnce throws when flag is off', async () => {
    const scheduler = new BackgroundTaskScheduler({
      store: new InMemoryInsightStore(),
      tenants: makeTenants([T1]),
      featureFlags: makeFlagsAllOff(),
      tasks: buildTaskCatalogue(makeData()),
    });
    await expect(
      scheduler.runOnce('arrears_ladder_tick', T1),
    ).rejects.toThrow();
  });

  it('shouldRun matches cron fields', () => {
    expect(shouldRun('0 2 * * *', new Date('2026-04-19T02:00:00Z'))).toBe(true);
    expect(shouldRun('0 2 * * *', new Date('2026-04-19T03:00:00Z'))).toBe(false);
  });

  it('cross-tenant isolation: tenant A scan never emits into tenant B', async () => {
    const store = new InMemoryInsightStore();
    const tasks = buildTaskCatalogue(makeData());
    const scheduler = new BackgroundTaskScheduler({
      store,
      tenants: makeTenants([T1, T2]),
      featureFlags: makeFlagsAllOn(),
      tasks,
      now: () => new Date('2026-04-19T02:00:00Z'),
    });
    await scheduler.tick();
    const rowsT1 = await store.listUnacknowledged(T1);
    const rowsT2 = await store.listUnacknowledged(T2);
    for (const r of rowsT1) expect(r.tenantId).toBe(T1);
    for (const r of rowsT2) expect(r.tenantId).toBe(T2);
  });
});

describe('BackgroundIntelligence: sync service', () => {
  it('onSessionOpen returns only unacknowledged insights', async () => {
    const store = new InMemoryInsightStore();
    await store.upsert({
      tenantId: T1,
      kind: 'portfolio_health',
      severity: 'high',
      title: 't',
      description: 'd',
      evidenceRefs: [],
      actionPlan: { summary: 'x', steps: [] },
      dedupeKey: 'k',
    });
    const sync = new IntelligenceSyncService(store);
    const payload = await sync.onSessionOpen(T1, 'user_1');
    expect(payload.insights).toHaveLength(1);
    expect(payload.critical).toHaveLength(1);
  });
});
