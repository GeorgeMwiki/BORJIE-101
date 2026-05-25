/**
 * MoveOutChecklistService (lease/) — pure orchestration over an in-memory repo.
 *
 * Wave-4 D1: covers the four-step checklist the lease aggregate exposes.
 */

import { describe, it, expect } from 'vitest';
import type { TenantId, UserId } from '@borjie/domain-models';
import { asTenantId, asUserId } from '@borjie/domain-models';
import {
  MoveOutChecklistService,
  createMoveOutChecklist,
  type MoveOutChecklist,
  type MoveOutRepository,
  type UtilityReading,
} from '../move-out-checklist.js';

const tenantA: TenantId = asTenantId('tnt_a');
const inspectorId: UserId = asUserId('usr_inspector');
const tenantUserId: UserId = asUserId('usr_tenant');

function createRepo(): MoveOutRepository {
  const store = new Map<string, MoveOutChecklist>();
  return {
    async findByLeaseId(leaseId, tenantId) {
      const c = store.get(leaseId);
      if (!c || c.tenantId !== tenantId) return null;
      return c;
    },
    async save(checklist) {
      store.set(checklist.leaseId, checklist);
      return checklist;
    },
  };
}

function seed(repo: MoveOutRepository, leaseId = 'lease_1'): Promise<MoveOutChecklist> {
  const checklist = createMoveOutChecklist({
    leaseId,
    tenantId: tenantA,
    currency: 'TZS',
    totalDeposit: 100_000,
  });
  return repo.save(checklist);
}

describe('createMoveOutChecklist', () => {
  it('initialises all four steps as pending with totals defaulted', () => {
    const c = createMoveOutChecklist({
      leaseId: 'lease_42',
      tenantId: tenantA,
      currency: 'KES',
      totalDeposit: 50_000,
    });

    expect(c.leaseId).toBe('lease_42');
    expect(c.tenantId).toBe(tenantA);
    expect(c.finalInspection.status).toBe('pending');
    expect(c.utilityReadings.status).toBe('pending');
    expect(c.depositReconciliation.status).toBe('pending');
    expect(c.residencyProofLetter.status).toBe('pending');
    expect(c.depositReconciliation.totalDeposit).toBe(50_000);
    expect(c.depositReconciliation.totalDeductions).toBe(0);
    expect(c.depositReconciliation.refundAmount).toBe(50_000);
    expect(c.depositReconciliation.currency).toBe('KES');
    expect(c.utilityReadings.readings).toEqual([]);
    expect(c.finalInspection.conditionReportId).toBeNull();
    expect(c.residencyProofLetter.documentId).toBeNull();
  });

  it('uses ISO timestamps for created/updated', () => {
    const c = createMoveOutChecklist({
      leaseId: 'lease_42',
      tenantId: tenantA,
      currency: 'TZS',
      totalDeposit: 0,
    });
    expect(() => new Date(c.createdAt).toISOString()).not.toThrow();
    expect(c.createdAt).toBe(c.updatedAt);
  });
});

describe('MoveOutChecklistService.completeFinalInspection', () => {
  it('marks final inspection completed and records report id', async () => {
    const repo = createRepo();
    await seed(repo);
    const svc = new MoveOutChecklistService(repo);

    const result = await svc.completeFinalInspection(
      'lease_1',
      tenantA,
      'rpt_99',
      inspectorId,
      'all good',
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.finalInspection.status).toBe('completed');
    expect(result.data.finalInspection.conditionReportId).toBe('rpt_99');
    expect(result.data.finalInspection.completedBy).toBe(inspectorId);
    expect(result.data.finalInspection.notes).toBe('all good');
  });

  it('returns CHECKLIST_NOT_FOUND when checklist absent', async () => {
    const repo = createRepo();
    const svc = new MoveOutChecklistService(repo);

    const result = await svc.completeFinalInspection(
      'missing',
      tenantA,
      'rpt_x',
      inspectorId,
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('CHECKLIST_NOT_FOUND');
  });

  it('isolates by tenantId — tenant B cannot complete tenant A checklist', async () => {
    const repo = createRepo();
    await seed(repo);
    const svc = new MoveOutChecklistService(repo);

    const tenantB = asTenantId('tnt_b');
    const result = await svc.completeFinalInspection(
      'lease_1',
      tenantB,
      'rpt_99',
      inspectorId,
    );
    expect(result.success).toBe(false);
  });
});

describe('MoveOutChecklistService.recordUtilityReadings', () => {
  it('saves all readings and marks step completed', async () => {
    const repo = createRepo();
    await seed(repo);
    const svc = new MoveOutChecklistService(repo);
    const readings: UtilityReading[] = [
      {
        utility: 'electricity',
        meterReading: 1234,
        unit: 'kWh',
        readingDate: '2026-05-08T00:00:00Z' as never,
      },
      {
        utility: 'water',
        meterReading: 567,
        unit: 'm3',
        readingDate: '2026-05-08T00:00:00Z' as never,
      },
    ];

    const result = await svc.recordUtilityReadings(
      'lease_1',
      tenantA,
      readings,
      tenantUserId,
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.utilityReadings.status).toBe('completed');
    expect(result.data.utilityReadings.readings).toEqual(readings);
  });

  it('rejects empty readings list', async () => {
    const repo = createRepo();
    await seed(repo);
    const svc = new MoveOutChecklistService(repo);
    const result = await svc.recordUtilityReadings(
      'lease_1',
      tenantA,
      [],
      tenantUserId,
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('INVALID_INPUT');
  });

  it('returns CHECKLIST_NOT_FOUND for missing lease', async () => {
    const repo = createRepo();
    const svc = new MoveOutChecklistService(repo);
    const result = await svc.recordUtilityReadings(
      'lease_x',
      tenantA,
      [
        {
          utility: 'gas',
          meterReading: 1,
          unit: 'm3',
          readingDate: '2026-05-08T00:00:00Z' as never,
        },
      ],
      tenantUserId,
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('CHECKLIST_NOT_FOUND');
  });
});

describe('MoveOutChecklistService.reconcileDeposit', () => {
  it('computes refund as deposit minus deductions', async () => {
    const repo = createRepo();
    await seed(repo);
    const svc = new MoveOutChecklistService(repo);

    const result = await svc.reconcileDeposit(
      'lease_1',
      tenantA,
      30_000,
      tenantUserId,
      'damages on wall',
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.depositReconciliation.totalDeductions).toBe(30_000);
    expect(result.data.depositReconciliation.refundAmount).toBe(70_000);
    expect(result.data.depositReconciliation.notes).toBe('damages on wall');
  });

  it('rejects negative deductions', async () => {
    const repo = createRepo();
    await seed(repo);
    const svc = new MoveOutChecklistService(repo);
    const result = await svc.reconcileDeposit('lease_1', tenantA, -5, tenantUserId);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('INVALID_INPUT');
  });

  it('rejects deductions that exceed deposit', async () => {
    const repo = createRepo();
    await seed(repo);
    const svc = new MoveOutChecklistService(repo);
    const result = await svc.reconcileDeposit(
      'lease_1',
      tenantA,
      999_999,
      tenantUserId,
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(result.error.message).toContain('exceed');
  });

  it('allows zero deductions (full refund)', async () => {
    const repo = createRepo();
    await seed(repo);
    const svc = new MoveOutChecklistService(repo);
    const result = await svc.reconcileDeposit('lease_1', tenantA, 0, tenantUserId);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.depositReconciliation.refundAmount).toBe(100_000);
  });

  it('allows full deduction (zero refund)', async () => {
    const repo = createRepo();
    await seed(repo);
    const svc = new MoveOutChecklistService(repo);
    const result = await svc.reconcileDeposit('lease_1', tenantA, 100_000, tenantUserId);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.depositReconciliation.refundAmount).toBe(0);
  });
});

describe('MoveOutChecklistService.issueResidencyProofLetter', () => {
  it('marks letter step completed and stores documentId', async () => {
    const repo = createRepo();
    await seed(repo);
    const svc = new MoveOutChecklistService(repo);
    const result = await svc.issueResidencyProofLetter(
      'lease_1',
      tenantA,
      'doc_abc',
      tenantUserId,
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.residencyProofLetter.status).toBe('completed');
    expect(result.data.residencyProofLetter.documentId).toBe('doc_abc');
  });

  it('returns CHECKLIST_NOT_FOUND when missing', async () => {
    const repo = createRepo();
    const svc = new MoveOutChecklistService(repo);
    const result = await svc.issueResidencyProofLetter(
      'missing',
      tenantA,
      'doc_x',
      tenantUserId,
    );
    expect(result.success).toBe(false);
  });
});

describe('MoveOutChecklistService.isCompleted', () => {
  it('returns false when not all steps completed', () => {
    const svc = new MoveOutChecklistService(createRepo());
    const c = createMoveOutChecklist({
      leaseId: 'l',
      tenantId: tenantA,
      currency: 'TZS',
      totalDeposit: 0,
    });
    expect(svc.isCompleted(c)).toBe(false);
  });

  it('returns true when all four steps are completed', async () => {
    const repo = createRepo();
    await seed(repo);
    const svc = new MoveOutChecklistService(repo);
    await svc.completeFinalInspection('lease_1', tenantA, 'rpt', inspectorId);
    await svc.recordUtilityReadings(
      'lease_1',
      tenantA,
      [
        {
          utility: 'electricity',
          meterReading: 1,
          unit: 'kWh',
          readingDate: '2026-05-08T00:00:00Z' as never,
        },
      ],
      tenantUserId,
    );
    await svc.reconcileDeposit('lease_1', tenantA, 0, tenantUserId);
    const r = await svc.issueResidencyProofLetter(
      'lease_1',
      tenantA,
      'doc',
      tenantUserId,
    );
    if (!r.success) throw new Error('seed failed');
    expect(svc.isCompleted(r.data)).toBe(true);
  });
});
