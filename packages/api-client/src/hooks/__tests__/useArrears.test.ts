import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as mod from '../useArrears';
import { ApiClientError } from '../../client';
import { bootstrapTestClient, stubFetchSequence } from './test-utils';

describe('useArrears module', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    bootstrapTestClient();
  });

  it('exports projection / open / propose / approve hooks', () => {
    expect(typeof mod.useArrearsProjection).toBe('function');
    expect(typeof mod.useOpenArrearsCase).toBe('function');
    expect(typeof mod.useProposeArrears).toBe('function');
    expect(typeof mod.useApproveArrearsProposal).toBe('function');
  });

  it('happy path — GET projection', async () => {
    const proj = { tenantId: 't', arrearsCaseId: 'c1', currency: 'KES' };
    stubFetchSequence([{ body: { success: true, data: proj } }]);
    const res = await bootstrapTestClient().get('/arrears/cases/c1/projection');
    expect(res.data).toEqual(proj);
  });

  it('error path — 404 proposal not found on approve', async () => {
    stubFetchSequence([
      { ok: false, status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } },
    ]);
    await expect(
      bootstrapTestClient().post('/arrears/proposals/p1/approve', {}),
    ).rejects.toBeInstanceOf(ApiClientError);
  });
});
