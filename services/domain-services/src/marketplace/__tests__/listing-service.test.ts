import { describe, it, expect, vi } from 'vitest';
import type { TenantId, UserId } from '@borjie/domain-models';

import { ListingService } from '../listing-service.js';
import {
  asMarketplaceListingId,
  type MarketplaceListing,
  type MarketplaceListingId,
  type MarketplaceListingRepository,
  type SearchListingsInput,
} from '../types.js';

function memoryRepo(): MarketplaceListingRepository & {
  all: Map<string, MarketplaceListing>;
} {
  const all = new Map<string, MarketplaceListing>();
  return {
    all,
    async findById(id) {
      return all.get(id) ?? null;
    },
    async create(l) {
      all.set(l.id, l);
      return l;
    },
    async update(id, _t, patch) {
      const curr = all.get(id)!;
      const next = { ...curr, ...patch } as MarketplaceListing;
      all.set(id, next);
      return next;
    },
    async search(_t, q: SearchListingsInput) {
      const items = Array.from(all.values()).filter((l) => {
        if (q.status && l.status !== q.status) return false;
        if (q.listingKind && l.listingKind !== q.listingKind) return false;
        if (q.minPrice && l.headlinePrice < q.minPrice) return false;
        if (q.maxPrice && l.headlinePrice > q.maxPrice) return false;
        return true;
      });
      return { items, total: items.length };
    },
  };
}

function bus() {
  return { publish: vi.fn(), subscribe: vi.fn(() => () => {}) } as any;
}

const tenantId = 'tnt_1' as TenantId;
const userId = 'usr_1' as UserId;

describe('ListingService', () => {
  it('publishes a listing immediately when requested', async () => {
    const svc = new ListingService({ repo: memoryRepo(), eventBus: bus() });
    const r = await svc.publish(
      tenantId,
      {
        unitId: 'unit_1',
        listingKind: 'rent',
        headlinePrice: 100_000,
        publishImmediately: true,
      },
      userId,
      'c1'
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('published');
      expect(r.value.publishedAt).not.toBeNull();
    }
  });

  it('rejects zero price', async () => {
    const svc = new ListingService({ repo: memoryRepo(), eventBus: bus() });
    const r = await svc.publish(
      tenantId,
      { unitId: 'u', listingKind: 'rent', headlinePrice: 0 },
      userId,
      'c1'
    );
    expect(r.ok).toBe(false);
  });

  it('updates status', async () => {
    const repo = memoryRepo();
    const svc = new ListingService({ repo, eventBus: bus() });
    const created = await svc.publish(
      tenantId,
      { unitId: 'u', listingKind: 'rent', headlinePrice: 100 },
      userId,
      'c1'
    );
    if (!created.ok) throw new Error('bad setup');
    const updated = await svc.updateStatus(
      tenantId,
      created.value.id,
      'published',
      userId,
      'c1'
    );
    expect(updated.ok).toBe(true);
    if (updated.ok) expect(updated.value.status).toBe('published');
  });

  it('searches by filters', async () => {
    const repo = memoryRepo();
    const svc = new ListingService({ repo, eventBus: bus() });
    await svc.publish(
      tenantId,
      {
        unitId: 'u1',
        listingKind: 'rent',
        headlinePrice: 100,
        publishImmediately: true,
      },
      userId,
      'c'
    );
    await svc.publish(
      tenantId,
      { unitId: 'u2', listingKind: 'sale', headlinePrice: 5000 },
      userId,
      'c'
    );
    const result = await svc.search(tenantId, { listingKind: 'rent' });
    expect(result.items.length).toBe(1);
  });
});
