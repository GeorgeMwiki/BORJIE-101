/**
 * Offtake-agreement wire adapter tests (owner cockpit seller leg).
 *
 * Guards the casing seam between the live gateway
 * (GET /api/v1/mining/bids/offtake-agreements —
 * services/api-gateway/src/routes/mining/bids.hono.ts) and the
 * OfftakeContractsPanel. The gateway returns Drizzle rows serialized as
 * CAMELCASE (`agreedPriceTzs`, `quantityKg`, `paymentTerms`, `bidId`,
 * `listingId`, `signedAt`, `createdAt` — confirmed by the gateway contract test
 * offtake-crystallization.test.ts asserting `body.data[0].bidId`).
 *
 * Regression: the adapter previously read snake_case keys only
 * (`agreed_price_tzs`, `quantity_kg`, ...). Because id/status coincide across
 * casings, every contract still rendered — but with `agreedPriceTzs = 0`,
 * `quantityKg = 0`, and an empty `paymentTerms`, so the binding money/volume
 * terms were SILENTLY ZEROED. The fix reads camelCase as canonical with
 * snake_case as a defensive fallback (mirrors apps/buyer-mobile/src/api/offtake.ts).
 *
 * Mirrors the codebase pattern (chat-sse-normalisers.test.ts): test the pure
 * bridge, not the fetch machinery.
 */

import { describe, it, expect } from 'vitest';
import {
  adaptOfftake,
  type RawOfftakeRow,
  adaptIncomingBid,
  type RawIncomingBidRow,
} from '../marketplace';

describe('adaptOfftake — wire casing seam', () => {
  it('adapts a CAMELCASE row (the live gateway shape) to non-zero terms', () => {
    const row: RawOfftakeRow = {
      id: 'oft_1',
      listingId: 'lst_1',
      bidId: 'bid_1',
      buyerId: 'buy_1',
      agreedPriceTzs: '250000.00',
      quantityKg: '12.000',
      paymentTerms: 'net_30',
      status: 'signed',
      signedAt: '2026-06-20T00:00:00.000Z',
      createdAt: '2026-06-19T00:00:00.000Z',
    };

    const adapted = adaptOfftake(row);

    expect(adapted).not.toBeNull();
    // The crux: money/volume must NOT be silently zeroed off a camelCase row.
    expect(adapted!.agreedPriceTzs).toBe(250000);
    expect(adapted!.quantityKg).toBe(12);
    expect(adapted!.paymentTerms).toBe('net_30');
    expect(adapted!.listingId).toBe('lst_1');
    expect(adapted!.bidId).toBe('bid_1');
    expect(adapted!.buyerId).toBe('buy_1');
    expect(adapted!.status).toBe('signed');
    expect(adapted!.signedAt).toBe('2026-06-20T00:00:00.000Z');
    expect(adapted!.createdAt).toBe('2026-06-19T00:00:00.000Z');
  });

  it('still adapts a SNAKE_CASE row via the defensive fallback', () => {
    const row: RawOfftakeRow = {
      id: 'oft_2',
      listing_id: 'lst_2',
      bid_id: 'bid_2',
      buyer_id: 'buy_2',
      agreed_price_tzs: 99000,
      quantity_kg: 5,
      payment_terms: 'on_delivery',
      status: 'pending_signature',
      signed_at: null,
      created_at: '2026-06-18T00:00:00.000Z',
    };

    const adapted = adaptOfftake(row);

    expect(adapted).not.toBeNull();
    expect(adapted!.agreedPriceTzs).toBe(99000);
    expect(adapted!.quantityKg).toBe(5);
    expect(adapted!.paymentTerms).toBe('on_delivery');
    expect(adapted!.listingId).toBe('lst_2');
    expect(adapted!.bidId).toBe('bid_2');
    expect(adapted!.signedAt).toBeNull();
    expect(adapted!.createdAt).toBe('2026-06-18T00:00:00.000Z');
  });

  it('prefers camelCase over snake_case when both are present', () => {
    const row: RawOfftakeRow = {
      id: 'oft_3',
      agreedPriceTzs: 7,
      agreed_price_tzs: 999,
      quantityKg: 3,
      quantity_kg: 888,
      paymentTerms: 'net_15',
      payment_terms: 'on_delivery',
    };

    const adapted = adaptOfftake(row);

    expect(adapted).not.toBeNull();
    expect(adapted!.agreedPriceTzs).toBe(7);
    expect(adapted!.quantityKg).toBe(3);
    expect(adapted!.paymentTerms).toBe('net_15');
  });

  it('coerces an unknown status to pending_signature and drops a row with no id', () => {
    const noId: RawOfftakeRow = { agreedPriceTzs: 100 };
    expect(adaptOfftake(noId)).toBeNull();

    const badStatus = adaptOfftake({ id: 'oft_4', status: 'not_a_status' });
    expect(badStatus).not.toBeNull();
    expect(badStatus!.status).toBe('pending_signature');
  });
});

describe('adaptIncomingBid — wire casing seam (seller BidsInbox)', () => {
  it('adapts a CAMELCASE row (the live GET /incoming shape) to a non-zero bid price', () => {
    const row: RawIncomingBidRow = {
      id: 'bid_1',
      listingId: 'lst_1',
      buyerId: 'buy_1',
      bidPriceTzs: '175000.00',
      paymentTerms: 'net_30',
      status: 'pending',
      createdAt: '2026-06-20T00:00:00.000Z',
    };

    const adapted = adaptIncomingBid(row);

    expect(adapted).not.toBeNull();
    // The crux: the seller must NOT see incoming bids at 0.
    expect(adapted!.bidPriceTzs).toBe(175000);
    expect(adapted!.listingId).toBe('lst_1');
    expect(adapted!.buyerId).toBe('buy_1');
    expect(adapted!.paymentTerms).toBe('net_30');
    expect(adapted!.status).toBe('pending');
    expect(adapted!.createdAt).toBe('2026-06-20T00:00:00.000Z');
  });

  it('still adapts a SNAKE_CASE row via the defensive fallback', () => {
    const row: RawIncomingBidRow = {
      id: 'bid_2',
      listing_id: 'lst_2',
      buyer_id: 'buy_2',
      bid_price_tzs: 88000,
      payment_terms: 'on_delivery',
      status: 'accepted',
      created_at: '2026-06-18T00:00:00.000Z',
    };

    const adapted = adaptIncomingBid(row);

    expect(adapted).not.toBeNull();
    expect(adapted!.bidPriceTzs).toBe(88000);
    expect(adapted!.listingId).toBe('lst_2');
    expect(adapted!.buyerId).toBe('buy_2');
    expect(adapted!.paymentTerms).toBe('on_delivery');
    expect(adapted!.status).toBe('accepted');
  });

  it('prefers camelCase over snake_case and drops a row with no id', () => {
    const both = adaptIncomingBid({ id: 'bid_3', bidPriceTzs: 7, bid_price_tzs: 999 });
    expect(both!.bidPriceTzs).toBe(7);
    expect(adaptIncomingBid({ bidPriceTzs: 100 })).toBeNull();
  });
});
