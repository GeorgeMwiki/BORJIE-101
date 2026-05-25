import { describe, it, expect, vi } from 'vitest';
import type { TenantId, UserId, ISOTimestamp } from '@borjie/domain-models';

import { EnquiryService } from '../enquiry-service.js';
import {
  asMarketplaceListingId,
  type MarketplaceListing,
  type MarketplaceListingRepository,
} from '../types.js';

function memRepo(listing?: MarketplaceListing): MarketplaceListingRepository {
  const all = new Map<string, MarketplaceListing>();
  if (listing) all.set(listing.id, listing);
  return {
    async findById(id) {
      return all.get(id) ?? null;
    },
    async create(l) {
      all.set(l.id, l);
      return l;
    },
    async update(id, _t, patch) {
      const c = all.get(id)!;
      const n = { ...c, ...patch } as MarketplaceListing;
      all.set(id, n);
      return n;
    },
    async search() {
      return { items: [], total: 0 };
    },
  };
}

function bus() {
  return { publish: vi.fn(), subscribe: vi.fn(() => () => {}) } as any;
}

const tenantId = 'tnt_1' as TenantId;
const userId = 'usr_1' as UserId;

describe('EnquiryService', () => {
  it('rejects when listing is not published', async () => {
    const listing: MarketplaceListing = {
      id: asMarketplaceListingId('lst_1'),
      tenantId,
      unitId: 'u1',
      propertyId: null,
      listingKind: 'rent',
      headlinePrice: 100,
      currency: 'KES',
      negotiable: true,
      media: [],
      attributes: {},
      status: 'draft',
      publishedAt: null,
      expiresAt: null,
      negotiationPolicyId: 'pol_1',
      createdAt: '2026-01-01T00:00:00.000Z' as ISOTimestamp,
      createdBy: userId,
      updatedAt: '2026-01-01T00:00:00.000Z' as ISOTimestamp,
      updatedBy: userId,
    };
    const negSvc = {
      startNegotiation: vi.fn(),
    } as any;
    const svc = new EnquiryService({
      listingRepo: memRepo(listing),
      negotiationService: negSvc,
      eventBus: bus(),
    });
    const r = await svc.startEnquiry(
      tenantId,
      {
        listingId: listing.id,
        prospectCustomerId: 'c1',
        openingOffer: 95,
      },
      userId,
      'corr'
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('LISTING_NOT_PUBLISHED');
  });

  it('rejects when listing has no policy', async () => {
    const listing: MarketplaceListing = {
      id: asMarketplaceListingId('lst_1'),
      tenantId,
      unitId: 'u1',
      propertyId: null,
      listingKind: 'rent',
      headlinePrice: 100,
      currency: 'KES',
      negotiable: true,
      media: [],
      attributes: {},
      status: 'published',
      publishedAt: '2026-01-02T00:00:00.000Z' as ISOTimestamp,
      expiresAt: null,
      negotiationPolicyId: null,
      createdAt: '2026-01-01T00:00:00.000Z' as ISOTimestamp,
      createdBy: userId,
      updatedAt: '2026-01-01T00:00:00.000Z' as ISOTimestamp,
      updatedBy: userId,
    };
    const svc = new EnquiryService({
      listingRepo: memRepo(listing),
      negotiationService: {} as any,
      eventBus: bus(),
    });
    const r = await svc.startEnquiry(
      tenantId,
      {
        listingId: listing.id,
        prospectCustomerId: 'c1',
        openingOffer: 95,
      },
      userId,
      'corr'
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('POLICY_REQUIRED');
  });

  it('delegates to negotiation service when valid', async () => {
    const listing: MarketplaceListing = {
      id: asMarketplaceListingId('lst_1'),
      tenantId,
      unitId: 'u1',
      propertyId: null,
      listingKind: 'rent',
      headlinePrice: 100,
      currency: 'KES',
      negotiable: true,
      media: [],
      attributes: {},
      status: 'published',
      publishedAt: '2026-01-02T00:00:00.000Z' as ISOTimestamp,
      expiresAt: null,
      negotiationPolicyId: 'pol_1',
      createdAt: '2026-01-01T00:00:00.000Z' as ISOTimestamp,
      createdBy: userId,
      updatedAt: '2026-01-01T00:00:00.000Z' as ISOTimestamp,
      updatedBy: userId,
    };
    // Mock returns the dual-shape Result that `ok(...)` produces in
    // production code — both `{ok, value}` and `{success, data}` must be
    // populated so callers reading either shape behave correctly.
    const startNegotiation = vi.fn(async () => ({
      ok: true,
      success: true,
      value: { id: 'neg_1' },
      data: { id: 'neg_1' },
    }));
    const svc = new EnquiryService({
      listingRepo: memRepo(listing),
      negotiationService: { startNegotiation } as any,
      eventBus: bus(),
    });
    const r = await svc.startEnquiry(
      tenantId,
      {
        listingId: listing.id,
        prospectCustomerId: 'c1',
        openingOffer: 95,
      },
      userId,
      'corr'
    );
    expect(r.ok).toBe(true);
    expect(startNegotiation).toHaveBeenCalledOnce();
  });
});
