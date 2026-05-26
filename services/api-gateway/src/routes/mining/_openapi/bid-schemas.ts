/**
 * Zod-OpenAPI schemas for `/api/v1/mining/bids` — buyer bids on
 * marketplace listings.
 */
import { z } from '@hono/zod-openapi';

export const PaymentTermsEnum = z
  .enum(['instant', 'net_30', 'net_60'])
  .openapi('PaymentTerms');

export const BidStatusEnum = z
  .enum(['pending', 'accepted', 'rejected', 'countered', 'withdrawn'])
  .openapi('BidStatus');

export const BidSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    listingId: z.string().uuid(),
    buyerId: z.string().uuid(),
    bidPriceTzs: z.string().describe('numeric(20,2) — string-encoded'),
    paymentTerms: PaymentTermsEnum,
    notes: z.string().nullable(),
    status: BidStatusEnum,
    attributes: z.record(z.unknown()).nullable().optional(),
    acceptedAt: z.string().datetime().nullable().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Bid');

export const BidWithJoinsSchema = z
  .object({
    bid: BidSchema,
    listing: z.object({
      id: z.string().uuid(),
      title: z.string(),
      category: z.string(),
    }),
    buyer: z.object({
      id: z.string().uuid(),
      name: z.string(),
      kind: z.string(),
    }),
  })
  .openapi('BidWithJoins');

export const PlaceBidSchema = z
  .object({
    listingId: z.string().min(1),
    bidPriceTzs: z.number().nonnegative(),
    paymentTerms: PaymentTermsEnum.default('instant'),
    notes: z.string().max(2000).optional(),
  })
  .openapi('PlaceBidRequest');

export const RejectBidSchema = z
  .object({
    reason: z.string().min(1).max(2000),
  })
  .openapi('RejectBidRequest');

export const ListBidsQuerySchema = z
  .object({
    listing_id: z.string().min(1),
  })
  .openapi('ListBidsQuery');

export const BidIdParamSchema = z
  .object({
    id: z.string().min(1).openapi({ param: { name: 'id', in: 'path' } }),
  })
  .openapi('BidIdParam');
