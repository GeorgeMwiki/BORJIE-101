import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as mod from '../useTenders';
import { ApiClientError } from '../../client';
import { bootstrapTestClient, stubFetchSequence } from './test-utils';

describe('useTenders module', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    bootstrapTestClient();
  });

  it('exports the five hooks', () => {
    expect(typeof mod.useTender).toBe('function');
    expect(typeof mod.useTenderBids).toBe('function');
    expect(typeof mod.usePublishTender).toBe('function');
    expect(typeof mod.useSubmitBid).toBe('function');
    expect(typeof mod.useAwardTender).toBe('function');
  });

  it('happy path — POST /tenders/:id/bids', async () => {
    const bid = { id: 'b1', price: 1000 };
    stubFetchSequence([{ body: { success: true, data: bid } }]);
    const res = await bootstrapTestClient().post('/tenders/t1/bids', {
      vendorId: 'v1',
      price: 1000,
      timelineDays: 10,
    });
    expect(res.data).toEqual(bid);
  });

  it('error path — 409 tender closed', async () => {
    stubFetchSequence([
      { ok: false, status: 409, body: { error: { code: 'TENDER_CLOSED', message: 'x' } } },
    ]);
    await expect(
      bootstrapTestClient().post('/tenders/t1/bids', {}),
    ).rejects.toBeInstanceOf(ApiClientError);
  });
});
