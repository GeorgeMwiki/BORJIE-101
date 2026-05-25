import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as mod from '../useGepgPayment';
import { ApiClientError } from '../../client';
import { bootstrapTestClient, stubFetchSequence } from './test-utils';

describe('useGepgPayment module', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    bootstrapTestClient();
  });

  it('exports status + request hooks', () => {
    expect(typeof mod.useGepgStatus).toBe('function');
    expect(typeof mod.useRequestGepgControlNumber).toBe('function');
  });

  it('happy path — POST /gepg/control-numbers', async () => {
    const cn = { controlNumber: '992233', billId: 'b1', status: 'issued' };
    stubFetchSequence([{ body: { success: true, data: cn } }]);
    const res = await bootstrapTestClient().post('/gepg/control-numbers', {
      invoiceId: 'i1',
      billId: 'b1',
      amountMinorUnits: 100000,
      currency: 'TZS',
      payerName: 'Alice',
      description: 'rent',
    });
    expect(res.data).toEqual(cn);
  });

  it('error path — 502 upstream gepg error', async () => {
    stubFetchSequence([
      { ok: false, status: 502, body: { error: { code: 'GEPG_ERROR', message: 'down' } } },
    ]);
    await expect(
      bootstrapTestClient().get('/gepg/control-numbers/99', {
        params: { billId: 'b1' },
      }),
    ).rejects.toBeInstanceOf(ApiClientError);
  });
});
