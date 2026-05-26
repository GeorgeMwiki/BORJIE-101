/**
 * `createRoute` definitions for SUPER_ADMIN-only internal mining routes:
 *   decision-log, slo, killswitch, promotions, regulator-pipeline,
 *   citations.
 */
import { createRoute, z } from '@hono/zod-openapi';

import { successEnvelope, errorResponses, jsonContent } from './envelopes';
import {
  InternalIdParamSchema,
  DecisionTraceRowSchema,
  DecisionLogQuerySchema,
  SloRowSchema,
  SloQuerySchema,
  KillswitchInitiateSchema,
  KillswitchPendingSchema,
  KillswitchStateRowSchema,
  KillswitchPendingRowSchema,
  KillswitchListQuerySchema,
  PromotionRowSchema,
  PromotionQuerySchema,
  RegulatorEntrySchema,
  RegulatorListQuerySchema,
  RegulatorMoveSchema,
  CitationRowSchema,
  CitationQuerySchema,
} from './internal-schemas';

const security = [{ BearerAuth: [] }];

// ---------------------------------------------------------------------------
// decision-log
// ---------------------------------------------------------------------------

export const internalDecisionLogListRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['internal-decision-log'],
  summary: 'Paginated finalised decision traces.',
  security,
  request: { query: DecisionLogQuerySchema },
  responses: {
    200: jsonContent(
      successEnvelope(z.array(DecisionTraceRowSchema)),
      'Decision-trace page (cursor in meta).',
    ),
    401: errorResponses[401],
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

// ---------------------------------------------------------------------------
// slo
// ---------------------------------------------------------------------------

export const internalSloListRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['internal-slo'],
  summary: 'Per-junior, per-tenant SLO snapshot for the last N hours.',
  security,
  request: { query: SloQuerySchema },
  responses: {
    200: jsonContent(
      successEnvelope(z.array(SloRowSchema)),
      'SLO rows aggregated over the audit window.',
    ),
    401: errorResponses[401],
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

// ---------------------------------------------------------------------------
// killswitch
// ---------------------------------------------------------------------------

const killswitchTags = ['internal-killswitch'];

export const internalKillswitchInitiateRoute = createRoute({
  method: 'post',
  path: '/',
  tags: killswitchTags,
  summary: 'Initiate a kill-switch change (two-operator flow).',
  security,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: KillswitchInitiateSchema } },
    },
  },
  responses: {
    201: jsonContent(
      successEnvelope(KillswitchPendingSchema),
      'Pending confirmation row, awaiting second operator.',
    ),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

export const internalKillswitchConfirmRoute = createRoute({
  method: 'post',
  path: '/{id}/confirm',
  tags: killswitchTags,
  summary: 'Second operator confirms a pending kill-switch change.',
  security,
  request: { params: InternalIdParamSchema },
  responses: {
    200: jsonContent(
      successEnvelope(KillswitchStateRowSchema),
      'Applied kill-switch state.',
    ),
    201: jsonContent(
      successEnvelope(KillswitchStateRowSchema),
      'Newly created kill-switch state row.',
    ),
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

export const internalKillswitchListRoute = createRoute({
  method: 'get',
  path: '/',
  tags: killswitchTags,
  summary: 'List the active kill-switch state per scope.',
  security,
  request: { query: KillswitchListQuerySchema },
  responses: {
    200: jsonContent(
      successEnvelope(z.array(KillswitchStateRowSchema)),
      'Kill-switch state rows.',
    ),
    401: errorResponses[401],
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

export const internalKillswitchPendingRoute = createRoute({
  method: 'get',
  path: '/pending',
  tags: killswitchTags,
  summary: 'List pending confirmations the caller can act on.',
  security,
  responses: {
    200: jsonContent(
      successEnvelope(z.array(KillswitchPendingRowSchema)),
      'Pending confirmation rows (excluding callers own initiations).',
    ),
    401: errorResponses[401],
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

// ---------------------------------------------------------------------------
// promotions
// ---------------------------------------------------------------------------

export const internalPromotionsListRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['internal-promotions'],
  summary: 'List recent prompt / model / corpus promotions.',
  security,
  request: { query: PromotionQuerySchema },
  responses: {
    200: jsonContent(
      successEnvelope(z.array(PromotionRowSchema)),
      'Promotion rows.',
    ),
    401: errorResponses[401],
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

// ---------------------------------------------------------------------------
// regulator-pipeline
// ---------------------------------------------------------------------------

const regulatorTags = ['internal-regulator-pipeline'];

export const internalRegulatorListRoute = createRoute({
  method: 'get',
  path: '/',
  tags: regulatorTags,
  summary: 'List regulator pipeline entries (filter by source, status).',
  security,
  request: { query: RegulatorListQuerySchema },
  responses: {
    200: jsonContent(
      successEnvelope(z.array(RegulatorEntrySchema)),
      'Regulator pipeline rows.',
    ),
    401: errorResponses[401],
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

export const internalRegulatorMoveRoute = createRoute({
  method: 'patch',
  path: '/{id}/stage',
  tags: regulatorTags,
  summary: 'Move a regulator entry to the next kanban stage.',
  security,
  request: {
    params: InternalIdParamSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: RegulatorMoveSchema } },
    },
  },
  responses: {
    200: jsonContent(
      successEnvelope(RegulatorEntrySchema),
      'Updated regulator entry.',
    ),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

// ---------------------------------------------------------------------------
// citations
// ---------------------------------------------------------------------------

export const internalCitationsListRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['internal-citations'],
  summary: 'Search the global Borjie regulation corpus.',
  security,
  request: { query: CitationQuerySchema },
  responses: {
    200: jsonContent(
      successEnvelope(z.array(CitationRowSchema)),
      'Citation rows.',
    ),
    401: errorResponses[401],
    403: errorResponses[403],
    500: errorResponses[500],
  },
});
