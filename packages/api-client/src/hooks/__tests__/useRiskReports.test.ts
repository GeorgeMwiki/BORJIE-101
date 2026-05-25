import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as mod from '../useRiskReports';
import { ApiClientError } from '../../client';
import { bootstrapTestClient, stubFetchSequence } from './test-utils';

describe('useRiskReports module', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    bootstrapTestClient();
  });

  it('exports latest + generate hooks', () => {
    expect(typeof mod.useLatestRiskReport).toBe('function');
    expect(typeof mod.useGenerateRiskReport).toBe('function');
  });

  it('happy path — POST /risk-reports/:customerId/generate', async () => {
    const rr = { id: 'rr1', riskScore: 25, tier: 'low' };
    stubFetchSequence([{ body: { success: true, data: rr } }]);
    const res = await bootstrapTestClient().post('/risk-reports/c1/generate', {});
    expect(res.data).toEqual(rr);
  });

  it('error path — 404 no report yet', async () => {
    stubFetchSequence([
      { ok: false, status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } },
    ]);
    await expect(
      bootstrapTestClient().get('/risk-reports/c1/latest'),
    ).rejects.toBeInstanceOf(ApiClientError);
  });
});
