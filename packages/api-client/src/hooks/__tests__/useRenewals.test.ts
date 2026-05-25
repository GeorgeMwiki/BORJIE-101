import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as mod from '../useRenewals';
import { ApiClientError } from '../../client';
import { bootstrapTestClient, stubFetchSequence } from './test-utils';

describe('useRenewals module', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    bootstrapTestClient();
  });

  it('exports list / window / propose / accept / decline hooks', () => {
    expect(typeof mod.useRenewals).toBe('function');
    expect(typeof mod.useOpenRenewalWindow).toBe('function');
    expect(typeof mod.useProposeRenewal).toBe('function');
    expect(typeof mod.useAcceptRenewal).toBe('function');
    expect(typeof mod.useDeclineRenewal).toBe('function');
  });

  it('happy path — POST /renewals/:leaseId/propose', async () => {
    const renewal = { leaseId: 'L1', status: 'proposed', proposedRent: 1200 };
    stubFetchSequence([{ body: { success: true, data: renewal } }]);
    const res = await bootstrapTestClient().post('/renewals/L1/propose', {
      proposedRent: 1200,
    });
    expect(res.data).toEqual(renewal);
  });

  it('error path — 400 service error', async () => {
    stubFetchSequence([
      { ok: false, status: 400, body: { error: { code: 'INVALID_STATE', message: 'x' } } },
    ]);
    await expect(
      bootstrapTestClient().post('/renewals/L1/accept', {}),
    ).rejects.toBeInstanceOf(ApiClientError);
  });
});
