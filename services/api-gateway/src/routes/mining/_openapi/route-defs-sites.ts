/**
 * `createRoute` definitions for `/api/v1/mining/sites`.
 *
 * Imported by `sites.hono.ts` (handler bindings) and by
 * `scripts/build-mining-openapi-spec.ts` (spec generation). Pure data —
 * no DB, no middleware.
 */
import { createRoute, z } from '@hono/zod-openapi';

import { successEnvelope, errorResponses, jsonContent } from './envelopes';
import {
  SiteSchema,
  CreateSiteSchema,
  UpdateSiteSchema,
  ListSitesQuerySchema,
  SiteIdParamSchema,
} from './site-schemas';

const security = [{ BearerAuth: [] }];
const tags = ['sites'];

export const sitesListRoute = createRoute({
  method: 'get',
  path: '/',
  tags,
  summary: 'List sites (filter by licenceId, phase, status).',
  security,
  request: { query: ListSitesQuerySchema },
  responses: {
    200: jsonContent(successEnvelope(z.array(SiteSchema)), 'Sites array.'),
    401: errorResponses[401],
    500: errorResponses[500],
  },
});

export const sitesGetRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags,
  summary: 'Fetch one site by id.',
  security,
  request: { params: SiteIdParamSchema },
  responses: {
    200: jsonContent(successEnvelope(SiteSchema), 'Site row.'),
    401: errorResponses[401],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

export const sitesCreateRoute = createRoute({
  method: 'post',
  path: '/',
  tags,
  summary: 'Create a new site under an existing licence.',
  security,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: CreateSiteSchema } },
    },
  },
  responses: {
    201: jsonContent(successEnvelope(SiteSchema), 'Newly created site.'),
    400: errorResponses[400],
    401: errorResponses[401],
    500: errorResponses[500],
  },
});

export const sitesUpdateRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags,
  summary: 'Update site phase / manager / status / geometry.',
  security,
  request: {
    params: SiteIdParamSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: UpdateSiteSchema } },
    },
  },
  responses: {
    200: jsonContent(successEnvelope(SiteSchema), 'Updated site row.'),
    400: errorResponses[400],
    401: errorResponses[401],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});
