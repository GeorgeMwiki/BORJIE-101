import { describe, it, expect, beforeEach } from 'vitest';
import {
  createCreditRatingService,
  CreditRatingServiceError,
  DEFAULT_GRADING_WEIGHTS,
  type CreditRatingRepository,
  type CreditRatingInputs,
  type CreditRating,
  type CreditRatingHistoryEntry,
  type CreditSharingOptIn,
  type PromiseOutcomeRecord,
  type GradingWeights,
} from '../index.js';

function baseInputs(
  tenantId: string,
  customerId: string,
  overrides: Partial<CreditRatingInputs> = {},
): CreditRatingInputs {
  return {
    tenantId,
    customerId,
    totalInvoices: 12,
    paidOnTimeCount: 11,
    paidLate30DaysCount: 1,
    paidLate60DaysCount: 0,
    paidLate90PlusCount: 0,
    defaultCount: 0,
    extensionsGranted: 1,
    extensionsHonored: 1,
    installmentAgreementsOffered: 0,
    installmentAgreementsHonored: 0,
    rentToIncomeRatio: 0.3,
    avgTenancyMonths: 18,
    activeTenancyCount: 1,
    disputeCount: 0,
    damageDeductionCount: 0,
    subleaseViolationCount: 0,
    newestInvoiceAt: new Date().toISOString(),
    oldestInvoiceAt: new Date(Date.now() - 18 * 30 * 86400_000).toISOString(),
    asOf: new Date().toISOString(),
    ...overrides,
  };
}

function createInMemoryRepo(): CreditRatingRepository & {
  readonly snapshots: CreditRating[];
  readonly promises: PromiseOutcomeRecord[];
  readonly optIns: CreditSharingOptIn[];
  weights: GradingWeights | null;
  setInputs(tenantId: string, customerId: string, inputs: CreditRatingInputs | null): void;
  setHistory(tenantId: string, customerId: string, entries: CreditRatingHistoryEntry[]): void;
  setCustomers(tenantId: string, ids: string[]): void;
} {
  const snapshots: CreditRating[] = [];
  const promises: PromiseOutcomeRecord[] = [];
  const optIns: CreditSharingOptIn[] = [];
  const inputsMap = new Map<string, CreditRatingInputs | null>();
  const historyMap = new Map<string, CreditRatingHistoryEntry[]>();
  const customersMap = new Map<string, string[]>();
  let weights: GradingWeights | null = null;

  function key(tenantId: string, customerId: string): string {
    return `${tenantId}::${customerId}`;
  }

  return {
    snapshots,
    promises,
    optIns,
    get weights() {
      return weights;
    },
    set weights(v: GradingWeights | null) {
      weights = v;
    },
    setInputs(tenantId, customerId, inputs) {
      inputsMap.set(key(tenantId, customerId), inputs);
    },
    setHistory(tenantId, customerId, entries) {
      historyMap.set(key(tenantId, customerId), entries);
    },
    setCustomers(tenantId, ids) {
      customersMap.set(tenantId, ids);
    },
    async loadInputs(tenantId, customerId) {
      return inputsMap.get(key(tenantId, customerId)) ?? null;
    },
    async listCustomerIds(tenantId) {
      return customersMap.get(tenantId) ?? [];
    },
    async saveSnapshot(rating) {
      snapshots.push(rating);
    },
    async listHistory(tenantId, customerId) {
      return historyMap.get(key(tenantId, customerId)) ?? [];
    },
    async savePromiseOutcome(record) {
      promises.push(record);
    },
    async loadWeights() {
      return weights;
    },
    async saveWeights(_tenantId, w) {
      weights = w;
    },
    async saveSharingOptIn(optIn) {
      optIns.push(optIn);
    },
    async revokeSharingOptIn(tenantId, customerId, optInId) {
      const i = optIns.findIndex((x) => x.id === optInId);
      if (i >= 0 && optIns[i].tenantId === tenantId && optIns[i].customerId === customerId) {
        optIns[i] = { ...optIns[i], revokedAt: new Date().toISOString() };
      }
    },
    async listSharingOptIns(tenantId, customerId) {
      return optIns.filter(
        (o) =>
          o.tenantId === tenantId &&
          o.customerId === customerId &&
          !o.revokedAt,
      );
    },
  };
}

describe('credit-rating-service', () => {
  let repo: ReturnType<typeof createInMemoryRepo>;

  beforeEach(() => {
    repo = createInMemoryRepo();
  });

  it('computeRating pulls live inputs and persists snapshot', async () => {
    repo.setInputs('t-1', 'c-1', baseInputs('t-1', 'c-1'));
    const svc = createCreditRatingService({ repo });
    const rating = await svc.computeRating('t-1', 'c-1');
    expect(rating.customerId).toBe('c-1');
    expect(repo.snapshots.length).toBe(1);
    expect(repo.snapshots[0].customerId).toBe('c-1');
  });

  it('throws CUSTOMER_NOT_FOUND when repo returns null inputs', async () => {
    const svc = createCreditRatingService({ repo });
    await expect(svc.computeRating('t-1', 'missing')).rejects.toBeInstanceOf(
      CreditRatingServiceError,
    );
  });

  it('recomputeAll iterates all tenant customers', async () => {
    repo.setCustomers('t-1', ['c-1', 'c-2']);
    repo.setInputs('t-1', 'c-1', baseInputs('t-1', 'c-1'));
    repo.setInputs('t-1', 'c-2', baseInputs('t-1', 'c-2', { totalInvoices: 2 }));
    const svc = createCreditRatingService({ repo });
    const ratings = await svc.recomputeAll('t-1');
    expect(ratings.length).toBe(2);
  });

  it('recomputeAll skips failing customers, does not crash', async () => {
    repo.setCustomers('t-1', ['ok', 'fail']);
    repo.setInputs('t-1', 'ok', baseInputs('t-1', 'ok'));
    repo.setInputs('t-1', 'fail', null);
    const svc = createCreditRatingService({ repo });
    const ratings = await svc.recomputeAll('t-1');
    expect(ratings.length).toBe(1);
  });

  it('recordPromiseOutcome appends with uuid + delayDays', async () => {
    const svc = createCreditRatingService({ repo });
    const record = await svc.recordPromiseOutcome('t-1', 'c-1', {
      kind: 'extension',
      agreedDate: new Date().toISOString(),
      dueDate: new Date().toISOString(),
      actualOutcome: 'on_time',
      notes: 'tenant paid same day',
    });
    expect(record.id).toBeTruthy();
    expect(record.delayDays).toBe(0);
    expect(repo.promises.length).toBe(1);
  });

  it('recordPromiseOutcome flags late with delayDays > 0', async () => {
    const svc = createCreditRatingService({ repo });
    const dueDate = new Date(Date.now() - 7 * 86400_000).toISOString();
    const record = await svc.recordPromiseOutcome('t-1', 'c-1', {
      kind: 'installment',
      agreedDate: new Date(Date.now() - 14 * 86400_000).toISOString(),
      dueDate,
      actualOutcome: 'late',
    });
    expect(record.delayDays).toBeGreaterThan(0);
  });

  it('getWeights returns defaults when none stored', async () => {
    const svc = createCreditRatingService({ repo });
    const w = await svc.getWeights('t-1');
    expect(w).toEqual(DEFAULT_GRADING_WEIGHTS);
  });

  it('setWeights persists custom weights', async () => {
    const svc = createCreditRatingService({ repo });
    const custom: GradingWeights = {
      payment_history: 0.5,
      promise_keeping: 0.2,
      rent_to_income: 0.1,
      tenancy_length: 0.1,
      dispute_history: 0.1,
    };
    await svc.setWeights('t-1', custom);
    const read = await svc.getWeights('t-1');
    expect(read).toEqual(custom);
  });

  it('setWeights rejects zero-sum weights', async () => {
    const svc = createCreditRatingService({ repo });
    await expect(
      svc.setWeights('t-1', {
        payment_history: 0,
        promise_keeping: 0,
        rent_to_income: 0,
        tenancy_length: 0,
        dispute_history: 0,
      }),
    ).rejects.toBeInstanceOf(CreditRatingServiceError);
  });

  it('optInSharing creates record with 60-day default expiry', async () => {
    const svc = createCreditRatingService({ repo });
    const record = await svc.optInSharing({
      tenantId: 't-1',
      customerId: 'c-1',
      shareWithOrg: 'Other Landlord',
      purpose: 'tenancy_application',
      durationDays: 60,
    });
    const granted = Date.parse(record.grantedAt);
    const expires = Date.parse(record.expiresAt);
    const diffDays = (expires - granted) / 86400_000;
    expect(Math.round(diffDays)).toBe(60);
    expect(repo.optIns.length).toBe(1);
  });

  it('revokeSharing sets revokedAt timestamp', async () => {
    const svc = createCreditRatingService({ repo });
    const record = await svc.optInSharing({
      tenantId: 't-1',
      customerId: 'c-1',
      shareWithOrg: 'bank',
      purpose: 'loan',
      durationDays: 30,
    });
    await svc.revokeSharing('t-1', 'c-1', record.id);
    const active = await svc.listSharing('t-1', 'c-1');
    expect(active.length).toBe(0);
  });

  it('cross-tenant isolation: t-2 never sees t-1 opt-ins', async () => {
    const svc = createCreditRatingService({ repo });
    await svc.optInSharing({
      tenantId: 't-1',
      customerId: 'c-1',
      shareWithOrg: 'X',
      purpose: 'p',
      durationDays: 10,
    });
    const other = await svc.listSharing('t-2', 'c-1');
    expect(other.length).toBe(0);
  });

  it('getHistory clamps months to 1..60', async () => {
    repo.setHistory('t-1', 'c-1', [
      { computedAt: '2026-01-01', numericScore: 700, letterGrade: 'B', band: 'good', dimensionsSummary: {
        payment_history: 0.8, promise_keeping: 0.7, rent_to_income: 0.6, tenancy_length: 0.9, dispute_history: 1.0,
      } },
    ]);
    const svc = createCreditRatingService({ repo });
    const history = await svc.getHistory('t-1', 'c-1', 999);
    expect(history.length).toBe(1);
  });
});
