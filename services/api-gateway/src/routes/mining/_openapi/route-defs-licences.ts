/**
 * `createRoute` definitions for `/api/v1/mining/licences`.
 */
import { createRoute, z } from '@hono/zod-openapi';

import { successEnvelope, errorResponses, jsonContent } from './envelopes';
import {
  LicenceSchema,
  LicenceEventSchema,
  CreateLicenceSchema,
  RenewLicenceSchema,
  ListLicencesQuerySchema,
  LicenceIdParamSchema,
} from './licence-schemas';

const security = [{ BearerAuth: [] }];
const tags = ['licences'];

export const licencesListRoute = createRoute({
  method: 'get',
  path: '/',
  tags,
  summary: 'List licences (filter by kind, status, mineral).',
  security,
  request: { query: ListLicencesQuerySchema },
  responses: {
    200: jsonContent(successEnvelope(z.array(LicenceSchema)), 'Licences array.'),
    401: errorResponses[401],
    500: errorResponses[500],
  },
});

export const licencesGetRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags,
  summary: 'Fetch one licence by id.',
  security,
  request: { params: LicenceIdParamSchema },
  responses: {
    200: jsonContent(successEnvelope(LicenceSchema), 'Licence row.'),
    401: errorResponses[401],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

export const licencesCreateRoute = createRoute({
  method: 'post',
  path: '/',
  tags,
  summary: 'Create a licence (admin-only).',
  security,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: CreateLicenceSchema } },
    },
  },
  responses: {
    201: jsonContent(successEnvelope(LicenceSchema), 'Newly created licence.'),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

export const licencesRenewRoute = createRoute({
  method: 'post',
  path: '/{id}/renew',
  tags,
  summary: 'Register renewal event + extend expiry.',
  security,
  request: {
    params: LicenceIdParamSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: RenewLicenceSchema } },
    },
  },
  responses: {
    201: jsonContent(
      successEnvelope(
        z.object({ licence: LicenceSchema, event: LicenceEventSchema }),
      ),
      'Renewed licence + the recorded licence_event row.',
    ),
    400: errorResponses[400],
    401: errorResponses[401],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});
