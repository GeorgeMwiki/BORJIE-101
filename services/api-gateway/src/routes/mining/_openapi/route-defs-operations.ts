/**
 * `createRoute` definitions for /attendance, /fuel-logs, /maintenance,
 * /ore-parcels. Sales / incidents / grievances live in
 * `./route-defs-sales-incidents.ts` to keep each module under 300 lines.
 */
import { createRoute, z } from '@hono/zod-openapi';

import { successEnvelope, errorResponses, jsonContent, ErrorEnvelopeSchema } from './envelopes';
import { IdParamSchema } from './field-capture-schemas';
import {
  AttendanceRowSchema,
  CheckInSchema,
  CheckOutSchema,
  FuelLogSchema,
  CreateFuelLogSchema,
  MaintenanceEventSchema,
  CreateMaintenanceEventSchema,
  ListMaintenanceQuerySchema,
  OreParcelSchema,
  CreateOreParcelSchema,
  ListForSaleSchema,
  ListOreParcelsQuerySchema,
} from './operations-schemas';
import { MarketplaceListingSchema } from './marketplace-schemas';

const security = [{ BearerAuth: [] }];

// ---------------------------------------------------------------------------
// attendance
// ---------------------------------------------------------------------------

const attendanceTags = ['attendance'];

export const attendanceCheckInRoute = createRoute({
  method: 'post',
  path: '/check-in',
  tags: attendanceTags,
  summary: 'GPS-fenced check-in for the start of a shift.',
  security,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: CheckInSchema } },
    },
  },
  responses: {
    201: jsonContent(successEnvelope(AttendanceRowSchema), 'New attendance row.'),
    400: errorResponses[400],
    401: errorResponses[401],
    422: jsonContent(ErrorEnvelopeSchema, 'GPS fence rejected the check-in.'),
    500: errorResponses[500],
  },
});

export const attendanceCheckOutRoute = createRoute({
  method: 'post',
  path: '/check-out',
  tags: attendanceTags,
  summary: 'Close an open attendance row (computes hoursWorked).',
  security,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: CheckOutSchema } },
    },
  },
  responses: {
    200: jsonContent(successEnvelope(AttendanceRowSchema), 'Closed attendance row.'),
    400: errorResponses[400],
    401: errorResponses[401],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

// ---------------------------------------------------------------------------
// fuel-logs
// ---------------------------------------------------------------------------

export const fuelLogsCreateRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['fuel-logs'],
  summary: 'Record fuel issued or consumed per asset (worker-only).',
  security,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: CreateFuelLogSchema } },
    },
  },
  responses: {
    201: jsonContent(successEnvelope(FuelLogSchema), 'Newly created fuel log.'),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

// ---------------------------------------------------------------------------
// maintenance
// ---------------------------------------------------------------------------

const maintenanceTags = ['maintenance'];

export const maintenanceListRoute = createRoute({
  method: 'get',
  path: '/',
  tags: maintenanceTags,
  summary: 'List maintenance events (filter by assetId, status).',
  security,
  request: { query: ListMaintenanceQuerySchema },
  responses: {
    200: jsonContent(
      successEnvelope(z.array(MaintenanceEventSchema)),
      'Maintenance event rows.',
    ),
    401: errorResponses[401],
    500: errorResponses[500],
  },
});

export const maintenanceCreateRoute = createRoute({
  method: 'post',
  path: '/',
  tags: maintenanceTags,
  summary: 'Record a maintenance event against an asset.',
  security,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: CreateMaintenanceEventSchema } },
    },
  },
  responses: {
    201: jsonContent(
      successEnvelope(MaintenanceEventSchema),
      'Newly created maintenance event.',
    ),
    400: errorResponses[400],
    401: errorResponses[401],
    500: errorResponses[500],
  },
});

// ---------------------------------------------------------------------------
// ore-parcels
// ---------------------------------------------------------------------------

const oreParcelsTags = ['ore-parcels'];

const OreParcelWithListingSchema = z
  .object({
    parcel: OreParcelSchema,
    listing: MarketplaceListingSchema,
  })
  .openapi('OreParcelWithListing');

export const oreParcelsListRoute = createRoute({
  method: 'get',
  path: '/',
  tags: oreParcelsTags,
  summary: 'List ore parcels (filter by siteId, status).',
  security,
  request: { query: ListOreParcelsQuerySchema },
  responses: {
    200: jsonContent(
      successEnvelope(z.array(OreParcelSchema)),
      'Ore parcel rows.',
    ),
    401: errorResponses[401],
    500: errorResponses[500],
  },
});

export const oreParcelsCreateRoute = createRoute({
  method: 'post',
  path: '/',
  tags: oreParcelsTags,
  summary: 'Create a new ore parcel (stockpile).',
  security,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: CreateOreParcelSchema } },
    },
  },
  responses: {
    201: jsonContent(successEnvelope(OreParcelSchema), 'Newly created parcel.'),
    400: errorResponses[400],
    401: errorResponses[401],
    500: errorResponses[500],
  },
});

export const oreParcelsListForSaleRoute = createRoute({
  method: 'post',
  path: '/{id}/list-for-sale',
  tags: oreParcelsTags,
  summary: 'Flip parcel to sale-eligible and publish a marketplace listing.',
  security,
  request: {
    params: IdParamSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: ListForSaleSchema } },
    },
  },
  responses: {
    201: jsonContent(
      successEnvelope(OreParcelWithListingSchema),
      'Parcel + freshly published listing.',
    ),
    400: errorResponses[400],
    401: errorResponses[401],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

