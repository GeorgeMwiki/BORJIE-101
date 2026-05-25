import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as mod from '../useNegotiations';
import { ApiClientError } from '../../client';
import { bootstrapTestClient, stubFetchSequence } from './test-utils';

describe('useNegotiations module', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    bootstrapTestClient();
  });

  it('exports list / start / counter / accept / reject / audit hooks', () => {
    expect(typeof mod.useNegotiations).toBe('function');
    expect(typeof mod.useNegotiationAudit).toBe('function');
    expect(typeof mod.useStartNegotiation).toBe('function');
    expect(typeof mod.useCounterNegotiation).toBe('function');
    expect(typeof mod.useAcceptNegotiation).toBe('function');
    expect(typeof mod.useRejectNegotiation).toBe('function');
  });

  it('happy path — POST /negotiations starts a negotiation', async () => {
    const neg = { id: 'n1', status: 'active' };
    stubFetchSequence([{ body: { success: true, data: neg } }]);
    const client = bootstrapTestClient();
    const res = await client.post('/negotiations', {
      prospectCustomerId: 'c1',
      openingOffer: 100,
    });
    expect(res.data).toEqual(neg);
  });

  it('error path — 409 conflict on counter is surfaced', async () => {
    stubFetchSequence([
      { ok: false, status: 409, body: { error: { code: 'ALREADY_CLOSED', message: 'x' } } },
    ]);
    const client = bootstrapTestClient();
    await expect(client.post('/negotiations/n1/turns', {})).rejects.toBeInstanceOf(
      ApiClientError,
    );
  });
});
