/**
 * `createRoute` definitions for /internal/corpus, /internal/prompts,
 * /internal/audit-log. Split out of `route-defs-internal-platform.ts`
 * to keep each module under 300 lines.
 */
import { createRoute, z } from '@hono/zod-openapi';

import { successEnvelope, errorResponses, jsonContent } from './envelopes';
import {
  CorpusChunkSchema,
  CorpusVersionSchema,
  UploadCorpusSchema,
  SupersedeCorpusSchema,
  CorpusVersionsQuerySchema,
  PromptRegistryRowSchema,
  PromotePromptSchema,
  PromptListQuerySchema,
  WormAuditRowSchema,
  AuditLogQuerySchema,
} from './internal-platform-schemas';

const security = [{ BearerAuth: [] }];

// ---------------------------------------------------------------------------
// corpus
// ---------------------------------------------------------------------------

const corpusTags = ['internal-corpus'];

export const internalCorpusUploadRoute = createRoute({
  method: 'post',
  path: '/upload',
  tags: corpusTags,
  summary: 'Ingest a single chunk into the global intelligence corpus.',
  security,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: UploadCorpusSchema } },
    },
  },
  responses: {
    201: jsonContent(successEnvelope(CorpusChunkSchema), 'Inserted chunk row.'),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

export const internalCorpusSupersedeRoute = createRoute({
  method: 'post',
  path: '/supersede',
  tags: corpusTags,
  summary: 'Mark an old corpus chunk superseded by a newer one.',
  security,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: SupersedeCorpusSchema } },
    },
  },
  responses: {
    200: jsonContent(successEnvelope(CorpusChunkSchema), 'Updated chunk row.'),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

export const internalCorpusVersionsRoute = createRoute({
  method: 'get',
  path: '/versions',
  tags: corpusTags,
  summary: 'List corpus chunks grouped by source_file.',
  security,
  request: { query: CorpusVersionsQuerySchema },
  responses: {
    200: jsonContent(
      successEnvelope(z.array(CorpusVersionSchema)),
      'Version rows.',
    ),
    401: errorResponses[401],
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

// ---------------------------------------------------------------------------
// prompts
// ---------------------------------------------------------------------------

const promptsTags = ['internal-prompts'];

export const internalPromptsListRoute = createRoute({
  method: 'get',
  path: '/',
  tags: promptsTags,
  summary: 'List kernel prompt registry rows.',
  security,
  request: { query: PromptListQuerySchema },
  responses: {
    200: jsonContent(
      successEnvelope(z.array(PromptRegistryRowSchema)),
      'Prompt registry rows.',
    ),
    401: errorResponses[401],
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

export const internalPromptsPromoteRoute = createRoute({
  method: 'post',
  path: '/promote',
  tags: promptsTags,
  summary: 'Promote a prompt from shadow into canary.',
  security,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: PromotePromptSchema } },
    },
  },
  responses: {
    200: jsonContent(
      successEnvelope(PromptRegistryRowSchema),
      'Updated prompt row.',
    ),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

// ---------------------------------------------------------------------------
// audit-log
// ---------------------------------------------------------------------------

export const internalAuditLogListRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['internal-audit-log'],
  summary: 'Paginated WORM audit log rows.',
  security,
  request: { query: AuditLogQuerySchema },
  responses: {
    200: jsonContent(
      successEnvelope(z.array(WormAuditRowSchema)),
      'WORM audit rows.',
    ),
    401: errorResponses[401],
    403: errorResponses[403],
    500: errorResponses[500],
  },
});
