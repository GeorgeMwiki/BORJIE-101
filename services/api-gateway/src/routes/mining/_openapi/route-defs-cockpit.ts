/**
 * `createRoute` definitions for `/api/v1/mining/cockpit`.
 */
import { createRoute } from '@hono/zod-openapi';

import { successEnvelope, errorResponses, jsonContent } from './envelopes';
import {
  DailyBriefDataSchema,
  CashRunwayDataSchema,
  LicenceHealthDataSchema,
  ProductionVsTargetDataSchema,
  CliffStatusDataSchema,
} from './cockpit-schemas';

const security = [{ BearerAuth: [] }];
const tags = ['cockpit'];

export const cockpitDailyBriefRoute = createRoute({
  method: 'get',
  path: '/daily-brief',
  tags,
  summary: 'One-glance start-of-day summary for the owner cockpit.',
  security,
  responses: {
    200: jsonContent(successEnvelope(DailyBriefDataSchema), 'Daily brief.'),
    401: errorResponses[401],
    500: errorResponses[500],
  },
});

export const cockpitCashRunwayRoute = createRoute({
  method: 'get',
  path: '/cash-runway',
  tags,
  summary: 'Inflow-side cash signal over the last 90 days.',
  security,
  responses: {
    200: jsonContent(
      successEnvelope(CashRunwayDataSchema),
      'Cash runway snapshot.',
    ),
    401: errorResponses[401],
    500: errorResponses[500],
  },
});

export const cockpitLicenceHealthRoute = createRoute({
  method: 'get',
  path: '/licence-health',
  tags,
  summary: 'Dormancy + expiry risk per licence.',
  security,
  responses: {
    200: jsonContent(
      successEnvelope(LicenceHealthDataSchema),
      'Enriched licence rows with daysToExpiry + atRisk flags.',
    ),
    401: errorResponses[401],
    500: errorResponses[500],
  },
});

export const cockpitProductionVsTargetRoute = createRoute({
  method: 'get',
  path: '/production-vs-target',
  tags,
  summary: 'Rolling 30-day production breakdown per site.',
  security,
  responses: {
    200: jsonContent(
      successEnvelope(ProductionVsTargetDataSchema),
      'Per-site tonnes, fuel, and shift counts over 30 days.',
    ),
    401: errorResponses[401],
    500: errorResponses[500],
  },
});

export const cockpitCliffStatusRoute = createRoute({
  method: 'get',
  path: '/27mar-cliff-status',
  tags,
  summary: 'USD-cliff (2026-03-27) remediation rollup.',
  security,
  responses: {
    200: jsonContent(
      successEnvelope(CliffStatusDataSchema),
      'Counts of USD-denominated post-cliff sales.',
    ),
    401: errorResponses[401],
    500: errorResponses[500],
  },
});
