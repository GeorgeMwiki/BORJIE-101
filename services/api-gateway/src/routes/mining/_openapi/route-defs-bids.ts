/**
 * `createRoute` definitions for `/api/v1/mining/bids`.
 *
 * Includes a sibling `BidKycGateError` schema for the KYC-gate 403:
 * it extends the standard `ApiErrorEnvelope` with a `kyc_url` hint
 * pointing at the buyers-KYC submission endpoint.
 */
import { createRoute, z } from '@hono/zod-openapi';

import {
  successEnvelope,
  errorResponses,
  jsonContent,
  ErrorEnvelopeSchema,
} from './envelopes';
import {
  BidSchema,
  BidWithJoinsSchema,
  PlaceBidSchema,
  RejectBidSchema,
  ListBidsQuerySchema,
  BidIdParamSchema,
} from './bid-schemas';

const security = [{ BearerAuth: [] }];
const tags = ['bids'];

const BidKycGateErrorSchema = ErrorEnvelopeSchema.extend({
  kyc_url: z.string(),
}).openapi('BidKycGateError');

export const bidsPlaceRoute = createRoute({
  method: 'post',
  path: '/',
  tags,
  summary: 'Buyer places a bid on a marketplace listing.',
  security,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: PlaceBidSchema } },
    },
  },
  responses: {
    201: jsonContent(successEnvelope(BidSchema), 'Newly created bid row.'),
    400: errorResponses[400],
    401: errorResponses[401],
    403: jsonContent(
      BidKycGateErrorSchema,
      'Buyer must complete KYC before bidding.',
    ),
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

export const bidsListRoute = createRoute({
  method: 'get',
  path: '/',
  tags,
  summary: 'Seller view of bids on one listing.',
  security,
  request: { query: ListBidsQuerySchema },
  responses: {
    200: jsonContent(
      successEnvelope(z.array(BidWithJoinsSchema)),
      'Bids joined to listing + buyer summaries.',
    ),
    400: errorResponses[400],
    401: errorResponses[401],
    500: errorResponses[500],
  },
});

export const bidsAcceptRoute = createRoute({
  method: 'post',
  path: '/{id}/accept',
  tags,
  summary: 'Seller accepts a pending bid.',
  security,
  request: { params: BidIdParamSchema },
  responses: {
    200: jsonContent(
      successEnvelope(BidSchema),
      'Updated bid row (status=accepted).',
    ),
    401: errorResponses[401],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

export const bidsRejectRoute = createRoute({
  method: 'post',
  path: '/{id}/reject',
  tags,
  summary: 'Seller rejects a pending bid (with required reason).',
  security,
  request: {
    params: BidIdParamSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: RejectBidSchema } },
    },
  },
  responses: {
    200: jsonContent(
      successEnvelope(BidSchema),
      'Updated bid row (status=rejected).',
    ),
    400: errorResponses[400],
    401: errorResponses[401],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});
