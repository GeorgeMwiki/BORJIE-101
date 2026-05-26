/**
 * `createRoute` definitions for /sales, /incidents, /grievances.
 * Split out of `route-defs-operations.ts` to keep each module under 300 lines.
 */
import { createRoute, z } from '@hono/zod-openapi';

import { successEnvelope, errorResponses, jsonContent } from './envelopes';
import {
  SaleSchema,
  CreateSaleSchema,
  ListSalesQuerySchema,
  IncidentSchema,
  CreateIncidentSchema,
  ListIncidentsQuerySchema,
  GrievanceSchema,
  CreateGrievanceSchema,
  ListGrievancesQuerySchema,
} from './sales-incidents-schemas';

const security = [{ BearerAuth: [] }];

// ---------------------------------------------------------------------------
// sales
// ---------------------------------------------------------------------------

const salesTags = ['sales'];

export const salesListRoute = createRoute({
  method: 'get',
  path: '/',
  tags: salesTags,
  summary: 'List sales (filter by parcelId, buyerId, paymentStatus).',
  security,
  request: { query: ListSalesQuerySchema },
  responses: {
    200: jsonContent(successEnvelope(z.array(SaleSchema)), 'Sale rows.'),
    401: errorResponses[401],
    500: errorResponses[500],
  },
});

export const salesCreateRoute = createRoute({
  method: 'post',
  path: '/',
  tags: salesTags,
  summary: 'Record a sale transaction and flip the parcel to sold.',
  security,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: CreateSaleSchema } },
    },
  },
  responses: {
    201: jsonContent(successEnvelope(SaleSchema), 'Newly created sale.'),
    400: errorResponses[400],
    401: errorResponses[401],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

// ---------------------------------------------------------------------------
// incidents
// ---------------------------------------------------------------------------

const incidentsTags = ['incidents'];

export const incidentsListRoute = createRoute({
  method: 'get',
  path: '/',
  tags: incidentsTags,
  summary: 'List incidents (filter by siteId, kind, severity, status).',
  security,
  request: { query: ListIncidentsQuerySchema },
  responses: {
    200: jsonContent(successEnvelope(z.array(IncidentSchema)), 'Incident rows.'),
    401: errorResponses[401],
    500: errorResponses[500],
  },
});

export const incidentsCreateRoute = createRoute({
  method: 'post',
  path: '/',
  tags: incidentsTags,
  summary: 'Report a new safety / environmental / community incident.',
  security,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: CreateIncidentSchema } },
    },
  },
  responses: {
    201: jsonContent(successEnvelope(IncidentSchema), 'Newly created incident.'),
    400: errorResponses[400],
    401: errorResponses[401],
    500: errorResponses[500],
  },
});

// ---------------------------------------------------------------------------
// grievances
// ---------------------------------------------------------------------------

const grievancesTags = ['grievances'];

export const grievancesListRoute = createRoute({
  method: 'get',
  path: '/',
  tags: grievancesTags,
  summary: 'List grievances (filter by siteId, status, category).',
  security,
  request: { query: ListGrievancesQuerySchema },
  responses: {
    200: jsonContent(successEnvelope(z.array(GrievanceSchema)), 'Grievance rows.'),
    401: errorResponses[401],
    500: errorResponses[500],
  },
});

export const grievancesCreateRoute = createRoute({
  method: 'post',
  path: '/',
  tags: grievancesTags,
  summary: 'Raise a new community or worker grievance.',
  security,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: CreateGrievanceSchema } },
    },
  },
  responses: {
    201: jsonContent(successEnvelope(GrievanceSchema), 'Newly raised grievance.'),
    400: errorResponses[400],
    401: errorResponses[401],
    500: errorResponses[500],
  },
});
