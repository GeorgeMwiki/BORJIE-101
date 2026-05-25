import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as mod from '../useGamification';
import { ApiClientError } from '../../client';
import { bootstrapTestClient, stubFetchSequence } from './test-utils';

describe('useGamification module', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    bootstrapTestClient();
  });

  it('exports policy + customer hooks', () => {
    expect(typeof mod.useGamificationPolicy).toBe('function');
    expect(typeof mod.useUpdateGamificationPolicy).toBe('function');
    expect(typeof mod.useGamificationCustomer).toBe('function');
  });

  it('happy path — PUT /gamification/policies', async () => {
    const policy = { id: 'g1', tenantId: 't', onTimePoints: 10 };
    stubFetchSequence([{ body: { success: true, data: policy } }]);
    const res = await bootstrapTestClient().put('/gamification/policies', {
      onTimePoints: 10,
    });
    expect(res.data).toEqual(policy);
  });

  it('error path — 403 tenant mismatch', async () => {
    stubFetchSequence([
      { ok: false, status: 403, body: { error: { code: 'TENANT_MISMATCH', message: 'x' } } },
    ]);
    await expect(
      bootstrapTestClient().get('/gamification/customers/c1'),
    ).rejects.toBeInstanceOf(ApiClientError);
  });
});
