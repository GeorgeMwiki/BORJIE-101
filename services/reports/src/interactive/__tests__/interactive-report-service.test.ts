/**
 * Tests for InteractiveReportService (NEW 17).
 *
 * Verifies:
 *   - compile() produces a version with the HTML bundle persisted
 *     through the storage port.
 *   - acknowledge() routes action plans to the correct handler port.
 *   - Cross-tenant isolation is enforced.
 *   - Action-plan-not-found raises the expected error.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  InteractiveReportService,
  InteractiveReportServiceError,
  InteractiveReportServiceException,
} from '../interactive-report-service.js';
import type {
  ActionPlan,
  InteractiveReportStorage,
  InteractiveReportVersion,
  InteractiveReportVersionRepository,
  MediaReference,
} from '../types.js';

function makeRepo(): InteractiveReportVersionRepository & {
  saved: InteractiveReportVersion[];
  acks: Array<Record<string, unknown>>;
} {
  const saved: InteractiveReportVersion[] = [];
  const acks: Array<Record<string, unknown>> = [];
  return {
    saved,
    acks,
    async save(version) {
      saved.push(version);
      return version;
    },
    async findById(tenantId, id) {
      return (
        saved.find((s) => s.id === id && s.tenantId === tenantId) ?? null
      );
    },
    async findLatestByReportInstance(tenantId, reportInstanceId) {
      const rows = saved
        .filter(
          (s) =>
            s.tenantId === tenantId && s.reportInstanceId === reportInstanceId
        )
        .sort((a, b) => b.version - a.version);
      return rows[0] ?? null;
    },
    async recordAck(input) {
      acks.push(input as unknown as Record<string, unknown>);
    },
  };
}

function makeStorage(): InteractiveReportStorage & { calls: number } {
  let calls = 0;
  const store: InteractiveReportStorage & { calls: number } = {
    calls: 0,
    async putHtmlBundle(input) {
      calls += 1;
      store.calls = calls;
      return {
        signedUrl: `https://cdn.test/${input.reportInstanceId}/v${input.version}`,
        key: `reports/${input.reportInstanceId}/v${input.version}.html`,
        expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString(),
      };
    },
  };
  return store;
}

const plan: ActionPlan = {
  id: 'plan-1',
  title: 'Fix leaking tap',
  description: 'Maintenance item raised during inspection',
  severity: 'high',
  action: {
    kind: 'create_work_order',
    payload: { category: 'plumbing', unitId: 'unit-1' },
  },
  status: 'pending',
  createdAt: '2025-01-01T00:00:00.000Z',
};

const media: MediaReference[] = [
  {
    id: 'm1',
    kind: 'image',
    storageKey: 'photos/1.jpg',
    signedUrl: 'https://cdn.test/photos/1.jpg',
    caption: 'tap',
  },
];

describe('InteractiveReportService', () => {
  it('compile() persists a bundle and returns a version with a signed url', async () => {
    const repo = makeRepo();
    const storage = makeStorage();
    let idCounter = 0;
    const svc = new InteractiveReportService({
      repository: repo,
      storage,
      generateId: () => `irv_test_${++idCounter}`,
      now: () => new Date('2025-01-15T10:00:00Z'),
    });

    const version = await svc.compile({
      tenantId: 't1',
      reportInstanceId: 'rpt-1',
      title: 'Monthly report',
      findings: [{ id: 'f1', title: 'Finding A', body: 'Body A' }],
      media,
      actionPlans: [plan],
    });

    expect(version.tenantId).toBe('t1');
    expect(version.version).toBe(1);
    expect(version.signedUrl).toContain('rpt-1/v1');
    expect(storage.calls).toBe(1);
    expect(repo.saved).toHaveLength(1);
  });

  it('acknowledge() dispatches create_work_order through the port', async () => {
    const repo = makeRepo();
    const storage = makeStorage();
    const workOrderCreator = {
      create: vi.fn().mockResolvedValue({ workOrderId: 'wo-42' }),
    };
    const svc = new InteractiveReportService({
      repository: repo,
      storage,
      workOrderCreator,
      generateId: () => 'irv_abc',
    });

    await svc.compile({
      tenantId: 't1',
      reportInstanceId: 'rpt-1',
      title: 'X',
      findings: [],
      media: [],
      actionPlans: [plan],
    });

    const result = await svc.acknowledge({
      tenantId: 't1',
      interactiveReportVersionId: 'irv_abc',
      actionPlanId: 'plan-1',
      acknowledgedBy: 'user-1',
    });

    expect(result.resolution).toBe('work_order_created');
    expect(result.resolutionRefId).toBe('wo-42');
    expect(workOrderCreator.create).toHaveBeenCalledTimes(1);
    expect(repo.acks).toHaveLength(1);
  });

  it('acknowledge() raises CROSS_TENANT for a foreign tenant', async () => {
    const repo = makeRepo();
    const storage = makeStorage();
    const svc = new InteractiveReportService({
      repository: repo,
      storage,
      generateId: () => 'irv_abc',
    });

    await svc.compile({
      tenantId: 't1',
      reportInstanceId: 'rpt-1',
      title: 'X',
      findings: [],
      media: [],
      actionPlans: [plan],
    });

    await expect(
      svc.acknowledge({
        tenantId: 't2',
        interactiveReportVersionId: 'irv_abc',
        actionPlanId: 'plan-1',
        acknowledgedBy: 'user-1',
      })
    ).rejects.toBeInstanceOf(InteractiveReportServiceException);
  });

  it('acknowledge() raises ACTION_PLAN_NOT_FOUND for an unknown plan', async () => {
    const repo = makeRepo();
    const storage = makeStorage();
    const svc = new InteractiveReportService({
      repository: repo,
      storage,
      generateId: () => 'irv_abc',
    });

    await svc.compile({
      tenantId: 't1',
      reportInstanceId: 'rpt-1',
      title: 'X',
      findings: [],
      media: [],
      actionPlans: [plan],
    });

    try {
      await svc.acknowledge({
        tenantId: 't1',
        interactiveReportVersionId: 'irv_abc',
        actionPlanId: 'plan-missing',
        acknowledgedBy: 'user-1',
      });
      expect.fail('expected to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(InteractiveReportServiceException);
      expect((e as InteractiveReportServiceException).code).toBe(
        InteractiveReportServiceError.ACTION_PLAN_NOT_FOUND
      );
    }
  });
});
