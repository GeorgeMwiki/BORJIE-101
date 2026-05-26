/**
 * Zod-OpenAPI schemas for `/api/v1/mining/cockpit` — owner cockpit
 * widget response shapes.
 *
 * Pure read endpoints. No request bodies; one response payload per
 * route. Keeps the cockpit's UX contract documented for client codegen.
 */
import { z } from '@hono/zod-openapi';

export const DailyBriefDataSchema = z
  .object({
    date: z.string().describe('ISO yyyy-mm-dd in the gateway tz.'),
    shiftsToday: z.number().int().nonnegative(),
    openIncidents: z.number().int().nonnegative(),
    openGrievances: z.number().int().nonnegative(),
    criticalIncidents: z.number().int().nonnegative(),
  })
  .openapi('CockpitDailyBrief');

export const CashRunwayDataSchema = z
  .object({
    ninetyDayNetTzs: z.number(),
    dailyAvgTzs: z.number(),
    sampleCount: z.number().int().nonnegative(),
    note: z.string(),
  })
  .openapi('CockpitCashRunway');

export const LicenceHealthRowSchema = z
  .object({
    id: z.string(),
    licenceNumber: z.string().optional(),
    kind: z.string().optional(),
    dormancyScore: z.number().int().nullable().optional(),
    expiryDate: z.string().nullable().optional(),
    daysToExpiry: z.number().int().nullable(),
    atRisk: z.boolean(),
  })
  .passthrough()
  .openapi('CockpitLicenceHealthRow');

export const LicenceHealthDataSchema = z
  .array(LicenceHealthRowSchema)
  .openapi('CockpitLicenceHealth');

export const ProductionVsTargetRowSchema = z
  .object({
    siteId: z.string(),
    tonnes: z.number(),
    fuel: z.number(),
    shifts: z.number().int().nonnegative(),
  })
  .openapi('CockpitProductionVsTargetRow');

export const ProductionVsTargetDataSchema = z
  .object({
    window: z.literal('30d'),
    perSite: z.array(ProductionVsTargetRowSchema),
  })
  .openapi('CockpitProductionVsTarget');

export const CliffStatusDataSchema = z
  .object({
    cliffDateIso: z.string().datetime(),
    postCliffSales: z.number().int().nonnegative(),
    usdDenominated: z.number().int().nonnegative(),
    remediationComplete: z.boolean(),
    note: z.string(),
  })
  .openapi('CockpitCliffStatus');
