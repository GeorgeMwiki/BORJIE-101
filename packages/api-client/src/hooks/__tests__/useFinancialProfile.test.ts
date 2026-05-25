import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as mod from '../useFinancialProfile';
import { ApiClientError } from '../../client';
import { bootstrapTestClient, stubFetchSequence } from './test-utils';

describe('useFinancialProfile module', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    bootstrapTestClient();
  });

  it('exports submit / verify / litigation hooks', () => {
    expect(typeof mod.useSubmitFinancialStatement).toBe('function');
    expect(typeof mod.useVerifyBankReference).toBe('function');
    expect(typeof mod.useRecordLitigation).toBe('function');
  });

  it('happy path — POST /financial-profile/statements', async () => {
    const stmt = { id: 'fs1', customerId: 'c1' };
    stubFetchSequence([{ body: { success: true, data: stmt } }]);
    const res = await bootstrapTestClient().post(
      '/financial-profile/statements',
      {
        customerId: 'c1',
        monthlyGrossIncome: 1000,
        monthlyNetIncome: 800,
        incomeCurrency: 'KES',
        incomeSources: [],
        monthlyExpenses: 200,
        monthlyDebtService: 100,
        consentGiven: true,
      },
    );
    expect(res.data).toEqual(stmt);
  });

  it('error path — 400 missing consent', async () => {
    stubFetchSequence([
      { ok: false, status: 400, body: { error: { code: 'CONSENT', message: 'x' } } },
    ]);
    await expect(
      bootstrapTestClient().post('/financial-profile/statements', {}),
    ).rejects.toBeInstanceOf(ApiClientError);
  });
});
