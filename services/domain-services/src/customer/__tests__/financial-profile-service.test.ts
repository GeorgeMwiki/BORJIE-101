/**
 * FinancialProfileService — submitStatement, verifyBankReference, recordLitigation.
 */

import { describe, it, expect, vi } from 'vitest';
import { asTenantId, asUserId } from '@borjie/domain-models';
import type { EventBus } from '../../common/events.js';
import {
  FinancialProfileService,
  type FinancialStatement,
  type FinancialStatementRepository,
  type IBankReferenceProvider,
  type LitigationRecord,
  type LitigationRepository,
  type SubmitStatementInput,
} from '../financial-profile-service.js';

const tenantA = asTenantId('tnt_a');
const userId = asUserId('usr_1');

function makeStatementRepo(): FinancialStatementRepository {
  const store = new Map<string, FinancialStatement>();
  return {
    create: vi.fn(async (s) => {
      store.set(s.id, s);
      return s;
    }),
    update: vi.fn(async (s) => {
      store.set(s.id, s);
      return s;
    }),
    findById: vi.fn(async (id, tenantId) => {
      const s = store.get(id);
      if (!s || s.tenantId !== tenantId) return null;
      return s;
    }),
    findLatestByCustomer: vi.fn(async () => null),
  };
}

function makeLitigationRepo(): LitigationRepository {
  return {
    create: vi.fn(async (r) => r),
    findByCustomer: vi.fn(async () => []),
  };
}

function makeBus(): EventBus {
  return {
    publish: vi.fn(async () => undefined),
    subscribe: vi.fn(),
  } as unknown as EventBus;
}

function validInput(
  overrides: Partial<SubmitStatementInput> = {},
): SubmitStatementInput {
  return {
    customerId: 'cust_1',
    monthlyGrossIncome: 1000,
    monthlyNetIncome: 800,
    incomeCurrency: 'TZS',
    incomeSources: [
      { kind: 'salary', monthlyAmount: 800, description: 'Day job', verified: false },
    ],
    monthlyExpenses: 300,
    monthlyDebtService: 100,
    consentGiven: true,
    submittedBy: userId,
    ...overrides,
  };
}

describe('FinancialProfileService.submitStatement', () => {
  it('persists a valid statement and emits an event', async () => {
    const stmt = makeStatementRepo();
    const lit = makeLitigationRepo();
    const bus = makeBus();
    const svc = new FinancialProfileService(stmt, lit, bus);

    const r = await svc.submitStatement(tenantA, validInput(), 'corr_1');
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.tenantId).toBe(tenantA);
    expect(r.data.status).toBe('submitted');
    expect(r.data.bankReferenceStatus).toBe('not_requested');
    expect(stmt.create).toHaveBeenCalledTimes(1);
    expect(bus.publish).toHaveBeenCalledTimes(1);
  });

  it('rejects when consent not given', async () => {
    const svc = new FinancialProfileService(
      makeStatementRepo(),
      makeLitigationRepo(),
      makeBus(),
    );
    const r = await svc.submitStatement(
      tenantA,
      validInput({ consentGiven: false }),
      'corr_1',
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe('CONSENT_REQUIRED');
  });

  it('rejects negative income', async () => {
    const svc = new FinancialProfileService(
      makeStatementRepo(),
      makeLitigationRepo(),
      makeBus(),
    );
    const r = await svc.submitStatement(
      tenantA,
      validInput({ monthlyNetIncome: -1 }),
      'corr_1',
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe('INVALID_INPUT');
  });

  it('rejects net income greater than gross income', async () => {
    const svc = new FinancialProfileService(
      makeStatementRepo(),
      makeLitigationRepo(),
      makeBus(),
    );
    const r = await svc.submitStatement(
      tenantA,
      validInput({ monthlyGrossIncome: 100, monthlyNetIncome: 200 }),
      'corr_1',
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe('INVALID_INPUT');
  });

  it('defaults optional numeric fields to zero / empty', async () => {
    const stmt = makeStatementRepo();
    const svc = new FinancialProfileService(stmt, makeLitigationRepo(), makeBus());
    const r = await svc.submitStatement(tenantA, validInput(), 'corr_1');
    if (!r.success) throw new Error('unexpected fail');
    expect(r.data.otherIncome).toBe(0);
    expect(r.data.existingArrears).toBe(0);
    expect(r.data.supportingDocumentIds).toEqual([]);
  });
});

describe('FinancialProfileService.verifyBankReference', () => {
  it('returns PROVIDER_ERROR when no provider configured', async () => {
    const svc = new FinancialProfileService(
      makeStatementRepo(),
      makeLitigationRepo(),
      makeBus(),
    );
    const r = await svc.verifyBankReference(
      'fin_x',
      tenantA,
      { bankAccountLast4: '1234' },
      'corr',
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe('PROVIDER_ERROR');
  });

  it('returns NOT_FOUND for missing statement', async () => {
    const provider: IBankReferenceProvider = {
      name: 'mock',
      fetch: vi.fn(),
    };
    const svc = new FinancialProfileService(
      makeStatementRepo(),
      makeLitigationRepo(),
      makeBus(),
      provider,
    );
    const r = await svc.verifyBankReference('missing', tenantA, {}, 'corr');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe('NOT_FOUND');
  });

  it('updates statement and publishes event on provider success', async () => {
    const stmt = makeStatementRepo();
    const bus = makeBus();
    const provider: IBankReferenceProvider = {
      name: 'plaid',
      fetch: vi.fn(async () => ({
        status: 'verified' as const,
        provider: 'plaid',
        score: 85,
        details: { ok: true },
        receivedAt: '2026-05-08T00:00:00Z' as never,
      })),
    };
    const svc = new FinancialProfileService(
      stmt,
      makeLitigationRepo(),
      bus,
      provider,
    );

    const submit = await svc.submitStatement(tenantA, validInput(), 'corr_a');
    if (!submit.success) throw new Error('seed failed');

    const r = await svc.verifyBankReference(
      submit.data.id,
      tenantA,
      { bankAccountLast4: '1234' },
      'corr_b',
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.bankReferenceStatus).toBe('verified');
    expect(r.data.bankReferenceProvider).toBe('plaid');
    expect(r.data.bankReferenceScore).toBe(85);
    expect(provider.fetch).toHaveBeenCalled();
    expect(bus.publish).toHaveBeenCalledTimes(2); // submit + verify
  });

  it('wraps provider errors in PROVIDER_ERROR', async () => {
    const stmt = makeStatementRepo();
    const provider: IBankReferenceProvider = {
      name: 'plaid',
      fetch: vi.fn(async () => {
        throw new Error('Network exploded');
      }),
    };
    const svc = new FinancialProfileService(
      stmt,
      makeLitigationRepo(),
      makeBus(),
      provider,
    );
    const submit = await svc.submitStatement(tenantA, validInput(), 'corr_a');
    if (!submit.success) throw new Error('seed failed');

    const r = await svc.verifyBankReference(submit.data.id, tenantA, {}, 'corr');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe('PROVIDER_ERROR');
    expect(r.error.message).toContain('Network exploded');
  });
});

describe('FinancialProfileService.recordLitigation', () => {
  it('persists a record and publishes LitigationRecorded', async () => {
    const lit = makeLitigationRepo();
    const bus = makeBus();
    const svc = new FinancialProfileService(
      makeStatementRepo(),
      lit,
      bus,
    );
    const r = await svc.recordLitigation(
      tenantA,
      {
        customerId: 'cust_1',
        kind: 'eviction',
        outcome: 'lost',
        disclosedBySelf: false,
        recordedBy: userId,
      },
      'corr',
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.kind).toBe('eviction');
    expect(r.data.tenantId).toBe(tenantA);
    expect(lit.create).toHaveBeenCalledTimes(1);
    expect(bus.publish).toHaveBeenCalledTimes(1);
  });

  it('defaults outcome to "pending"', async () => {
    const svc = new FinancialProfileService(
      makeStatementRepo(),
      makeLitigationRepo(),
      makeBus(),
    );
    const r = await svc.recordLitigation(
      tenantA,
      {
        customerId: 'cust_1',
        kind: 'lawsuit_as_defendant',
        disclosedBySelf: true,
        recordedBy: userId,
      },
      'corr',
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.outcome).toBe('pending');
  });

  it('defaults optional fields to null / empty', async () => {
    const svc = new FinancialProfileService(
      makeStatementRepo(),
      makeLitigationRepo(),
      makeBus(),
    );
    const r = await svc.recordLitigation(
      tenantA,
      {
        customerId: 'cust_1',
        kind: 'other',
        disclosedBySelf: true,
        recordedBy: userId,
      },
      'corr',
    );
    if (!r.success) throw new Error('unexpected fail');
    expect(r.data.caseNumber).toBeNull();
    expect(r.data.court).toBeNull();
    expect(r.data.amountInvolved).toBeNull();
    expect(r.data.evidenceDocumentIds).toEqual([]);
  });
});
