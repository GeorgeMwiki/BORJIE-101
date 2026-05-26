/**
 * `createRoute` definitions for owner-cockpit-adjacent mining routes:
 *   /lmbm, /documents, /reports, /portfolio-map, /buyers (KYC).
 */
import { createRoute, z } from '@hono/zod-openapi';

import {
  successEnvelope,
  errorResponses,
  jsonContent,
  ErrorEnvelopeSchema,
} from './envelopes';
import { IdParamSchema } from './field-capture-schemas';
import {
  LmbmGraphDataSchema,
  LmbmTraverseDataSchema,
  LmbmGraphQuerySchema,
  LmbmTraverseQuerySchema,
  DocumentUploadSchema,
  UploadMetadataSchema,
  DocChatSchema,
  SignDocumentSchema,
  DocumentUploadResultSchema,
  DocumentChatResultSchema,
  GenerateReportSchema,
  ReportJobSchema,
  PortfolioMapDataSchema,
  BuyerSchema,
  SubmitKycSchema,
  KycStatusSchema,
} from './owner-cockpit-schemas';

const security = [{ BearerAuth: [] }];

// ---------------------------------------------------------------------------
// lmbm
// ---------------------------------------------------------------------------

const lmbmTags = ['lmbm'];

export const lmbmGraphRoute = createRoute({
  method: 'get',
  path: '/graph',
  tags: lmbmTags,
  summary: 'Temporal entities + edges (filter by entity_type).',
  security,
  request: { query: LmbmGraphQuerySchema },
  responses: {
    200: jsonContent(
      successEnvelope(LmbmGraphDataSchema),
      'Entity + edge collection.',
    ),
    401: errorResponses[401],
    500: errorResponses[500],
  },
});

export const lmbmTraverseRoute = createRoute({
  method: 'get',
  path: '/traverse',
  tags: lmbmTags,
  summary: 'Depth-bounded outbound traversal from one entity.',
  security,
  request: { query: LmbmTraverseQuerySchema },
  responses: {
    200: jsonContent(
      successEnvelope(LmbmTraverseDataSchema),
      'Outbound edges with hop depth.',
    ),
    400: errorResponses[400],
    401: errorResponses[401],
    500: errorResponses[500],
  },
});

// ---------------------------------------------------------------------------
// documents
// ---------------------------------------------------------------------------

const docsTags = ['documents'];

export const documentsUploadRoute = createRoute({
  method: 'post',
  path: '/upload',
  tags: docsTags,
  summary: 'Record document metadata + return a presigned upload URL.',
  security,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: UploadMetadataSchema } },
    },
  },
  responses: {
    201: jsonContent(
      successEnvelope(DocumentUploadResultSchema),
      'Document row + presigned PUT URL.',
    ),
    400: errorResponses[400],
    401: errorResponses[401],
    500: errorResponses[500],
  },
});

export const documentsChatRoute = createRoute({
  method: 'post',
  path: '/{id}/chat',
  tags: docsTags,
  summary: 'Ask a question scoped to one document.',
  security,
  request: {
    params: IdParamSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: DocChatSchema } },
    },
  },
  responses: {
    200: jsonContent(
      successEnvelope(DocumentChatResultSchema),
      'Document chat dispatch result.',
    ),
    400: errorResponses[400],
    401: errorResponses[401],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

export const documentsSignRoute = createRoute({
  method: 'post',
  path: '/{id}/sign',
  tags: docsTags,
  summary: 'Apply a biometric-signed sign-off to a document.',
  security,
  request: {
    params: IdParamSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: SignDocumentSchema } },
    },
  },
  responses: {
    200: jsonContent(
      successEnvelope(DocumentUploadSchema),
      'Updated document row.',
    ),
    400: errorResponses[400],
    401: errorResponses[401],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

// ---------------------------------------------------------------------------
// reports
// ---------------------------------------------------------------------------

export const reportsGenerateRoute = createRoute({
  method: 'post',
  path: '/generate',
  tags: ['reports'],
  summary: 'Queue a report-render job for the consolidation worker.',
  security,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: GenerateReportSchema } },
    },
  },
  responses: {
    202: jsonContent(successEnvelope(ReportJobSchema), 'Queued job ticket.'),
    400: errorResponses[400],
    401: errorResponses[401],
    500: errorResponses[500],
  },
});

// ---------------------------------------------------------------------------
// portfolio-map
// ---------------------------------------------------------------------------

export const portfolioMapRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['portfolio-map'],
  summary: 'GeoJSON FeatureCollection of sites + licences + layers.',
  security,
  responses: {
    200: jsonContent(
      successEnvelope(PortfolioMapDataSchema),
      'GeoJSON feature collection.',
    ),
    401: errorResponses[401],
    500: errorResponses[500],
  },
});

// ---------------------------------------------------------------------------
// buyers / kyc
// ---------------------------------------------------------------------------

const buyersTags = ['buyers'];

const BuyerKycConflictSchema = ErrorEnvelopeSchema.extend({
  buyerId: z.string().optional(),
}).openapi('BuyerKycConflictError');

export const buyersKycSubmitRoute = createRoute({
  method: 'post',
  path: '/kyc',
  tags: buyersTags,
  summary: 'Submit KYC for a mineral counterparty (NIDA + TIN + AML).',
  security,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: SubmitKycSchema } },
    },
  },
  responses: {
    201: jsonContent(successEnvelope(BuyerSchema), 'Newly created buyer row.'),
    400: errorResponses[400],
    401: errorResponses[401],
    409: jsonContent(
      BuyerKycConflictSchema,
      'A buyer record already exists for this user.',
    ),
    500: errorResponses[500],
  },
});

export const buyersKycStatusRoute = createRoute({
  method: 'get',
  path: '/kyc/{id}/status',
  tags: buyersTags,
  summary: 'Poll the current KYC status for a buyer.',
  security,
  request: { params: IdParamSchema },
  responses: {
    200: jsonContent(successEnvelope(KycStatusSchema), 'Buyer KYC status.'),
    401: errorResponses[401],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});
