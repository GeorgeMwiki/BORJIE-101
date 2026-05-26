/**
 * `createRoute` definitions for `/api/v1/mining/marketplace`.
 */
import { createRoute, z } from '@hono/zod-openapi';

import { successEnvelope, errorResponses, jsonContent } from './envelopes';
import {
  MarketplaceListingSchema,
  ListListingsQuerySchema,
  ListingIdParamSchema,
} from './marketplace-schemas';

const security = [{ BearerAuth: [] }];
const tags = ['marketplace'];

export const marketplaceListListingsRoute = createRoute({
  method: 'get',
  path: '/listings',
  tags,
  summary: 'Search public marketplace listings.',
  security,
  request: { query: ListListingsQuerySchema },
  responses: {
    200: jsonContent(
      successEnvelope(z.array(MarketplaceListingSchema)),
      'Listings array (visibility-filtered).',
    ),
    401: errorResponses[401],
    500: errorResponses[500],
  },
});

export const marketplaceGetListingRoute = createRoute({
  method: 'get',
  path: '/listings/{id}',
  tags,
  summary: 'Fetch one marketplace listing.',
  security,
  request: { params: ListingIdParamSchema },
  responses: {
    200: jsonContent(successEnvelope(MarketplaceListingSchema), 'Listing row.'),
    401: errorResponses[401],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});
