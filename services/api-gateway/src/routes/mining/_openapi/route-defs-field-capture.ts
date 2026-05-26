/**
 * `createRoute` definitions for the field-capture mining routes
 * (drill-holes, samples, shift-reports). Pure data — handlers live in
 * the sibling `.hono.ts` files.
 */
import { createRoute, z } from '@hono/zod-openapi';

import { successEnvelope, errorResponses, jsonContent } from './envelopes';
import {
  DrillHoleSchema,
  DrillHoleLayerSchema,
  CreateDrillHoleSchema,
  CreateDrillHoleLayerSchema,
  ListDrillHolesQuerySchema,
  SampleSchema,
  CreateSampleSchema,
  AssayResultSchema,
  ListSamplesQuerySchema,
  ShiftReportSchema,
  CreateShiftReportSchema,
  ListShiftReportsQuerySchema,
  IdParamSchema,
} from './field-capture-schemas';

const security = [{ BearerAuth: [] }];

// ---------------------------------------------------------------------------
// drill-holes
// ---------------------------------------------------------------------------

const drillHolesTags = ['drill-holes'];

export const drillHolesListRoute = createRoute({
  method: 'get',
  path: '/',
  tags: drillHolesTags,
  summary: 'List drill holes (filter by siteId, kind).',
  security,
  request: { query: ListDrillHolesQuerySchema },
  responses: {
    200: jsonContent(
      successEnvelope(z.array(DrillHoleSchema)),
      'Drill hole rows.',
    ),
    401: errorResponses[401],
    500: errorResponses[500],
  },
});

export const drillHolesListLayersRoute = createRoute({
  method: 'get',
  path: '/{id}/layers',
  tags: drillHolesTags,
  summary: 'List lithological layers for one drill hole.',
  security,
  request: { params: IdParamSchema },
  responses: {
    200: jsonContent(
      successEnvelope(z.array(DrillHoleLayerSchema)),
      'Layer rows ordered by depthFromM ascending.',
    ),
    401: errorResponses[401],
    500: errorResponses[500],
  },
});

export const drillHolesCreateRoute = createRoute({
  method: 'post',
  path: '/',
  tags: drillHolesTags,
  summary: 'Create a new drill hole (worker-only).',
  security,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: CreateDrillHoleSchema } },
    },
  },
  responses: {
    201: jsonContent(successEnvelope(DrillHoleSchema), 'Newly created drill hole.'),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

export const drillHolesCreateLayerRoute = createRoute({
  method: 'post',
  path: '/{id}/layers',
  tags: drillHolesTags,
  summary: 'Append a lithological layer to a drill hole.',
  security,
  request: {
    params: IdParamSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: CreateDrillHoleLayerSchema } },
    },
  },
  responses: {
    201: jsonContent(successEnvelope(DrillHoleLayerSchema), 'Newly appended layer.'),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

// ---------------------------------------------------------------------------
// samples
// ---------------------------------------------------------------------------

const samplesTags = ['samples'];

export const samplesListRoute = createRoute({
  method: 'get',
  path: '/',
  tags: samplesTags,
  summary: 'List samples (filter by drillHoleId, passedQaqc).',
  security,
  request: { query: ListSamplesQuerySchema },
  responses: {
    200: jsonContent(successEnvelope(z.array(SampleSchema)), 'Sample rows.'),
    401: errorResponses[401],
    500: errorResponses[500],
  },
});

export const samplesCreateRoute = createRoute({
  method: 'post',
  path: '/',
  tags: samplesTags,
  summary: 'Create a new sample packet.',
  security,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: CreateSampleSchema } },
    },
  },
  responses: {
    201: jsonContent(successEnvelope(SampleSchema), 'Newly created sample.'),
    400: errorResponses[400],
    401: errorResponses[401],
    500: errorResponses[500],
  },
});

export const samplesAssayRoute = createRoute({
  method: 'post',
  path: '/{id}/assay-result',
  tags: samplesTags,
  summary: 'Attach lab assay result + QA/QC outcome to a sample.',
  security,
  request: {
    params: IdParamSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: AssayResultSchema } },
    },
  },
  responses: {
    200: jsonContent(successEnvelope(SampleSchema), 'Updated sample row.'),
    400: errorResponses[400],
    401: errorResponses[401],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

// ---------------------------------------------------------------------------
// shift-reports
// ---------------------------------------------------------------------------

const shiftTags = ['shift-reports'];

export const shiftReportsListRoute = createRoute({
  method: 'get',
  path: '/',
  tags: shiftTags,
  summary: 'List shift reports (filter by siteId + date range).',
  security,
  request: { query: ListShiftReportsQuerySchema },
  responses: {
    200: jsonContent(
      successEnvelope(z.array(ShiftReportSchema)),
      'Shift report rows.',
    ),
    401: errorResponses[401],
    500: errorResponses[500],
  },
});

export const shiftReportsCreateRoute = createRoute({
  method: 'post',
  path: '/',
  tags: shiftTags,
  summary: 'Create a new shift report.',
  security,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: CreateShiftReportSchema } },
    },
  },
  responses: {
    201: jsonContent(successEnvelope(ShiftReportSchema), 'Newly created shift report.'),
    400: errorResponses[400],
    401: errorResponses[401],
    500: errorResponses[500],
  },
});
