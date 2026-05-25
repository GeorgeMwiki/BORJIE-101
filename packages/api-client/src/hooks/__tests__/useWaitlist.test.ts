import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as mod from '../useWaitlist';
import { ApiClientError } from '../../client';
import { bootstrapTestClient, stubFetchSequence } from './test-utils';

describe('useWaitlist module', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    bootstrapTestClient();
  });

  it('exports join / leave / forUnit / forCustomer hooks', () => {
    expect(typeof mod.useJoinWaitlist).toBe('function');
    expect(typeof mod.useLeaveWaitlist).toBe('function');
    expect(typeof mod.useWaitlistForUnit).toBe('function');
    expect(typeof mod.useWaitlistForCustomer).toBe('function');
  });

  it('happy path — POST /waitlist/units/:unitId/join', async () => {
    const entry = { id: 'w1', status: 'active' };
    stubFetchSequence([{ body: { success: true, data: entry } }]);
    const res = await bootstrapTestClient().post('/waitlist/units/u1/join', {
      customerId: 'c1',
    });
    expect(res.data).toEqual(entry);
  });

  it('error path — 400 invalid input', async () => {
    stubFetchSequence([
      { ok: false, status: 400, body: { error: { code: 'VALIDATION', message: 'x' } } },
    ]);
    await expect(
      bootstrapTestClient().post('/waitlist/w1/leave', {}),
    ).rejects.toBeInstanceOf(ApiClientError);
  });
});
