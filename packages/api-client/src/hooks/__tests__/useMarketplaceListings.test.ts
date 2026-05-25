import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as mod from '../useMarketplaceListings';
import { ApiClientError } from '../../client';
import { bootstrapTestClient, stubFetchSequence } from './test-utils';

describe('useMarketplaceListings module', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    bootstrapTestClient();
  });

  it('exports list / detail / publish / status hooks', () => {
    expect(typeof mod.useMarketplaceListings).toBe('function');
    expect(typeof mod.useMarketplaceListing).toBe('function');
    expect(typeof mod.usePublishListing).toBe('function');
    expect(typeof mod.useUpdateListingStatus).toBe('function');
  });

  it('happy path — GET /marketplace/listings returns items', async () => {
    const listings = [{ id: 'l1', status: 'published' }];
    stubFetchSequence([{ body: { success: true, data: listings } }]);
    const res = await bootstrapTestClient().get('/marketplace/listings');
    expect(res.data).toEqual(listings);
  });

  it('error path — 404 on detail', async () => {
    stubFetchSequence([
      { ok: false, status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } },
    ]);
    await expect(
      bootstrapTestClient().get('/marketplace/listings/missing'),
    ).rejects.toBeInstanceOf(ApiClientError);
  });
});
