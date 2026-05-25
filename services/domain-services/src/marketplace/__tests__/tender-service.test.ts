import { describe, it, expect, vi } from 'vitest';
import type { TenantId, UserId, ISOTimestamp } from '@borjie/domain-models';

import { TenderService } from '../tender-service.js';
import {
  asTenderId,
  type Bid,
  type BidId,
  type BidRepository,
  type Tender,
  type TenderId,
  type TenderRepository,
} from '../types.js';

function memTenders(): TenderRepository & { all: Map<string, Tender> } {
  const all = new Map<string, Tender>();
  return {
    all,
    async findById(id) {
      return all.get(id) ?? null;
    },
    async create(t) {
      all.set(t.id, t);
      return t;
    },
    async update(id, _t, patch) {
      const c = all.get(id)!;
      const n = { ...c, ...patch } as Tender;
      all.set(id, n);
      return n;
    },
    async listOpen() {
      return Array.from(all.values()).filter((t) => t.status === 'open');
    },
  };
}

function memBids(): BidRepository & { all: Map<string, Bid> } {
  const all = new Map<string, Bid>();
  return {
    all,
    async findById(id) {
      return all.get(id) ?? null;
    },
    async create(b) {
      all.set(b.id, b);
      return b;
    },
    async update(id, _t, patch) {
      const c = all.get(id)!;
      const n = { ...c, ...patch } as Bid;
      all.set(id, n);
      return n;
    },
    async listByTender(tenderId) {
      return Array.from(all.values()).filter((b) => b.tenderId === tenderId);
    },
  };
}

function bus() {
  return { publish: vi.fn(), subscribe: vi.fn(() => () => {}) } as any;
}

const tenantId = 'tnt_1' as TenantId;
const userId = 'usr_1' as UserId;
const closesAt = ('2030-01-01T00:00:00.000Z' as unknown) as ISOTimestamp;

describe('TenderService', () => {
  it('publishes a tender', async () => {
    const svc = new TenderService({
      tenderRepo: memTenders(),
      bidRepo: memBids(),
      eventBus: bus(),
    });
    const r = await svc.publish(
      tenantId,
      {
        scope: 'fix roof',
        budgetRangeMin: 100,
        budgetRangeMax: 500,
        closesAt,
      },
      userId,
      'c1'
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe('open');
  });

  it('rejects invalid budget', async () => {
    const svc = new TenderService({
      tenderRepo: memTenders(),
      bidRepo: memBids(),
      eventBus: bus(),
    });
    const r = await svc.publish(
      tenantId,
      {
        scope: 's',
        budgetRangeMin: 500,
        budgetRangeMax: 100,
        closesAt,
      },
      userId,
      'c'
    );
    expect(r.ok).toBe(false);
  });

  it('enforces invite-only', async () => {
    const tenders = memTenders();
    const svc = new TenderService({
      tenderRepo: tenders,
      bidRepo: memBids(),
      eventBus: bus(),
    });
    const tender = await svc.publish(
      tenantId,
      {
        scope: 's',
        budgetRangeMin: 100,
        budgetRangeMax: 500,
        closesAt,
        visibility: 'invite_only',
        invitedVendorIds: ['v1'],
      },
      userId,
      'c'
    );
    if (!tender.ok) throw tender.error;
    const rejected = await svc.bid(
      tenantId,
      {
        tenderId: tender.value.id,
        vendorId: 'v2',
        price: 200,
        timelineDays: 7,
      },
      'c'
    );
    expect(rejected.ok).toBe(false);

    const accepted = await svc.bid(
      tenantId,
      {
        tenderId: tender.value.id,
        vendorId: 'v1',
        price: 200,
        timelineDays: 7,
      },
      'c'
    );
    expect(accepted.ok).toBe(true);
  });

  it('awards a tender and rejects peer bids', async () => {
    const tenders = memTenders();
    const bids = memBids();
    const svc = new TenderService({
      tenderRepo: tenders,
      bidRepo: bids,
      eventBus: bus(),
    });
    const tender = await svc.publish(
      tenantId,
      {
        scope: 's',
        budgetRangeMin: 100,
        budgetRangeMax: 500,
        closesAt,
      },
      userId,
      'c'
    );
    if (!tender.ok) throw tender.error;
    const b1 = await svc.bid(
      tenantId,
      {
        tenderId: tender.value.id,
        vendorId: 'v1',
        price: 200,
        timelineDays: 7,
      },
      'c'
    );
    const b2 = await svc.bid(
      tenantId,
      {
        tenderId: tender.value.id,
        vendorId: 'v2',
        price: 220,
        timelineDays: 5,
      },
      'c'
    );
    if (!b1.ok || !b2.ok) throw new Error('bad setup');

    const award = await svc.awardTender(
      tenantId,
      { tenderId: tender.value.id, bidId: b1.value.id, awardedBy: userId },
      'c'
    );
    expect(award.ok).toBe(true);
    if (award.ok) {
      expect(award.value.tender.status).toBe('awarded');
      expect(award.value.bid.status).toBe('awarded');
    }
    const peer = await bids.findById(b2.value.id, tenantId);
    expect(peer?.status).toBe('rejected');
  });

  it('cannot bid on closed tender', async () => {
    const tenders = memTenders();
    const svc = new TenderService({
      tenderRepo: tenders,
      bidRepo: memBids(),
      eventBus: bus(),
    });
    const tender = await svc.publish(
      tenantId,
      {
        scope: 's',
        budgetRangeMin: 100,
        budgetRangeMax: 500,
        closesAt,
      },
      userId,
      'c'
    );
    if (!tender.ok) throw tender.error;
    await svc.cancelTender(tenantId, tender.value.id, 'obsolete', userId, 'c');
    const r = await svc.bid(
      tenantId,
      {
        tenderId: tender.value.id,
        vendorId: 'v1',
        price: 200,
        timelineDays: 7,
      },
      'c'
    );
    expect(r.ok).toBe(false);
  });
});
