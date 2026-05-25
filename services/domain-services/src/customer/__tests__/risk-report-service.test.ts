/**
 * RiskReportService — composite tenant risk reports (NEW-13).
 */

import { describe, it, expect, vi } from 'vitest';
import { asTenantId, asUserId } from '@borjie/domain-models';
import {
  RiskReportService,
  type RiskNarrator,
  type RiskReportInputsProvider,
  type RiskReportRepository,
  type RiskReportSnapshot,
  type TenantRiskReport,
} from '../risk-report-service.js';

const tenantA = asTenantId('tnt_a');
const userId = asUserId('usr_1');

function snapshot(): RiskReportSnapshot {
  return {
    payment: { score: 70, level: 'low', subScores: { ontime: 70 } },
    churn: { score: 30, level: 'low', subScores: { engagement: 30 } },
    financial: {
      statementId: 'fin_1',
      monthlyNetIncome: 10000,
      existingArrears: 0,
      bankReferenceStatus: 'verified',
    },
    litigation: { count: 0, evictions: 0, judgments: 0 },
  };
}

function makeRepo(): RiskReportRepository {
  const store = new Map<string, TenantRiskReport>();
  return {
    create: vi.fn(async (r) => {
      store.set(r.id, r);
      return r;
    }),
    findLatestByCustomer: vi.fn(async (customerId) => {
      return Array.from(store.values()).find((r) => r.customerId === customerId) ?? null;
    }),
  };
}

function makeInputs(snap: RiskReportSnapshot = snapshot()): RiskReportInputsProvider {
  return { collect: vi.fn(async () => snap) };
}

function makeNarrator(): RiskNarrator {
  return {
    narrate: vi.fn(async () => ({
      narrative: 'Tenant looks fine.',
      recommendations: [
        { title: 'Monitor', detail: 'Re-check in 30 days', priority: 'low' as const },
      ],
      modelId: 'mock-llm-v1',
    })),
  };
}

describe('RiskReportService.generate', () => {
  it('produces a generated report combining inputs and narration', async () => {
    const repo = makeRepo();
    const svc = new RiskReportService(repo, makeInputs(), makeNarrator());

    const r = await svc.generate(tenantA, 'cust_1', userId);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.tenantId).toBe(tenantA);
    expect(r.data.customerId).toBe('cust_1');
    expect(r.data.status).toBe('generated');
    expect(r.data.paymentRiskScore).toBe(70);
    expect(r.data.churnRiskScore).toBe(30);
    expect(r.data.litigationCount).toBe(0);
    expect(r.data.narrative).toBe('Tenant looks fine.');
    expect(r.data.recommendations.length).toBe(1);
    expect(r.data.generatedByModel).toBe('mock-llm-v1');
    expect(repo.create).toHaveBeenCalledTimes(1);
  });

  it('returns NARRATION_FAILED when narrator throws', async () => {
    const failing: RiskNarrator = {
      narrate: vi.fn(async () => {
        throw new Error('LLM unavailable');
      }),
    };
    const svc = new RiskReportService(makeRepo(), makeInputs(), failing);
    const r = await svc.generate(tenantA, 'cust_1', userId);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe('NARRATION_FAILED');
    expect(r.error.message).toContain('LLM unavailable');
  });

  it('preserves deterministic snapshot — never mutated by narrator', async () => {
    const snap = snapshot();
    const inputs = makeInputs(snap);
    const repo = makeRepo();
    const svc = new RiskReportService(repo, inputs, makeNarrator());

    const r = await svc.generate(tenantA, 'cust_1', userId);
    if (!r.success) throw new Error('unexpected fail');
    expect(r.data.snapshot.payment.score).toBe(snap.payment.score);
    expect(r.data.snapshot.churn.score).toBe(snap.churn.score);
  });

  it('forwards customerId + tenantId to inputs provider', async () => {
    const inputs = makeInputs();
    const svc = new RiskReportService(makeRepo(), inputs, makeNarrator());
    await svc.generate(tenantA, 'cust_xyz', userId);
    expect(inputs.collect).toHaveBeenCalledWith({
      tenantId: tenantA,
      customerId: 'cust_xyz',
    });
  });

  it('handles non-Error thrown values in narration', async () => {
    const failing: RiskNarrator = {
      narrate: vi.fn(async () => {
        throw 'string-error';
      }),
    };
    const svc = new RiskReportService(makeRepo(), makeInputs(), failing);
    const r = await svc.generate(tenantA, 'cust_1', userId);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe('NARRATION_FAILED');
    expect(r.error.message).toBe('Narration failed');
  });
});

describe('RiskReportService.getLatest', () => {
  it('returns NOT_FOUND when no report exists', async () => {
    const svc = new RiskReportService(makeRepo(), makeInputs(), makeNarrator());
    const r = await svc.getLatest(tenantA, 'cust_unknown');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe('NOT_FOUND');
  });

  it('returns the saved report after generate', async () => {
    const repo = makeRepo();
    const svc = new RiskReportService(repo, makeInputs(), makeNarrator());
    const created = await svc.generate(tenantA, 'cust_1', userId);
    if (!created.success) throw new Error('seed failed');

    const r = await svc.getLatest(tenantA, 'cust_1');
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.id).toBe(created.data.id);
  });
});
