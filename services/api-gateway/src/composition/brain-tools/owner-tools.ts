/**
 * Owner persona — T1 strategist cockpit tools.
 *
 * Eight read-only tools backing the owner-web cockpit and the workforce
 * app's owner role. Every handler defers to the corresponding cockpit
 * route via the injected HTTP client so the LLM and the UI render
 * identical data (no parallel data paths).
 *
 * No WRITE tools at this tier — the owner cockpit is read-and-decide;
 * actions get routed through the manager / approvals queue.
 */

import { z } from 'zod';
import type { PersonaToolDescriptor } from './types';

const OWNER: ReadonlyArray<'T1_owner_strategist'> = ['T1_owner_strategist'];

// ─────────────────────────────────────────────────────────────────────
// 1. Daily brief
// ─────────────────────────────────────────────────────────────────────

const DailyBriefInput = z.object({
  asOfDate: z.string().optional(),
  locale: z.enum(['en', 'sw']).default('sw'),
});
const DailyBriefOutput = z.object({
  headlineEn: z.string(),
  headlineSw: z.string(),
  highlights: z.array(
    z.object({
      kind: z.string(),
      summary: z.string(),
      severity: z.enum(['info', 'warn', 'alert']),
    }),
  ),
  generatedAt: z.string(),
});

export const ownerDailyBriefTool: PersonaToolDescriptor<
  typeof DailyBriefInput,
  typeof DailyBriefOutput
> = {
  id: 'mining.cockpit.daily-brief',
  name: 'Owner — daily brief',
  description:
    'Owner cockpit daily brief: production deltas, cash deltas, incident summary, ' +
    'licence countdown. Read-only — defers to /mining/cockpit/daily-brief.',
  personaSlugs: OWNER,
  inputSchema: DailyBriefInput,
  outputSchema: DailyBriefOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        headlineEn: 'cockpit unavailable',
        headlineSw: 'cockpit haijapatikana',
        highlights: [],
        generatedAt: new Date().toISOString(),
      };
    }
    return client.get<{
      headlineEn: string;
      headlineSw: string;
      highlights: Array<{ kind: string; summary: string; severity: 'info' | 'warn' | 'alert' }>;
      generatedAt: string;
    }>('/mining/cockpit/daily-brief', {
      query: {
        tenantId: ctx.tenantId,
        asOfDate: input.asOfDate,
        locale: input.locale,
      },
    });
  },
};

// ─────────────────────────────────────────────────────────────────────
// 2. Pending decisions
// ─────────────────────────────────────────────────────────────────────

const DecisionsInput = z.object({
  limit: z.number().int().positive().max(50).default(10),
});
const DecisionsOutput = z.object({
  decisions: z.array(
    z.object({
      decisionId: z.string(),
      summary: z.string(),
      raisedAt: z.string(),
      severity: z.enum(['low', 'medium', 'high', 'sovereign']),
      requiredBy: z.string().optional(),
    }),
  ),
});

export const ownerDecisionsTool: PersonaToolDescriptor<
  typeof DecisionsInput,
  typeof DecisionsOutput
> = {
  id: 'mining.cockpit.decisions',
  name: 'Owner — pending decisions',
  description:
    'List the pending owner decisions surfaced by the cockpit Decision Inbox.',
  personaSlugs: OWNER,
  inputSchema: DecisionsInput,
  outputSchema: DecisionsOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { decisions: [] };
    return client.get<{ decisions: Array<{ decisionId: string; summary: string; raisedAt: string; severity: 'low' | 'medium' | 'high' | 'sovereign'; requiredBy?: string }> }>(
      '/mining/cockpit/decisions',
      { query: { tenantId: ctx.tenantId, limit: input.limit } },
    );
  },
};

// ─────────────────────────────────────────────────────────────────────
// 3. Cash runway + USD-cliff
// ─────────────────────────────────────────────────────────────────────

const CashRunwayInput = z.object({});
const CashRunwayOutput = z.object({
  runwayMonths: z.number(),
  cashOnHandTzs: z.number(),
  usdCliff: z.object({
    daysToCliff: z.number().int(),
    remediationStatus: z.enum(['pending', 'in_progress', 'complete']),
  }),
  generatedAt: z.string(),
});

export const ownerCashRunwayTool: PersonaToolDescriptor<
  typeof CashRunwayInput,
  typeof CashRunwayOutput
> = {
  id: 'mining.cockpit.cash-runway',
  name: 'Owner — cash runway and USD-cliff',
  description:
    'Cash runway in months, TZS-on-hand, and USD-cliff remediation status. Read-only ' +
    'snapshot from the cockpit.',
  personaSlugs: OWNER,
  inputSchema: CashRunwayInput,
  outputSchema: CashRunwayOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(_input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        runwayMonths: 0,
        cashOnHandTzs: 0,
        usdCliff: { daysToCliff: 0, remediationStatus: 'pending' as const },
        generatedAt: new Date().toISOString(),
      };
    }
    return client.get<{
      runwayMonths: number;
      cashOnHandTzs: number;
      usdCliff: { daysToCliff: number; remediationStatus: 'pending' | 'in_progress' | 'complete' };
      generatedAt: string;
    }>('/mining/cockpit/cash-runway', { query: { tenantId: ctx.tenantId } });
  },
};

// ─────────────────────────────────────────────────────────────────────
// 4. Production vs target
// ─────────────────────────────────────────────────────────────────────

const ProductionInput = z.object({
  windowDays: z.number().int().positive().max(90).default(7),
});
const ProductionOutput = z.object({
  windowDays: z.number().int(),
  actual: z.number(),
  target: z.number(),
  unit: z.string(),
  variancePct: z.number(),
  bySite: z.array(
    z.object({
      siteId: z.string(),
      siteName: z.string(),
      actual: z.number(),
      target: z.number(),
    }),
  ),
});

export const ownerProductionTool: PersonaToolDescriptor<
  typeof ProductionInput,
  typeof ProductionOutput
> = {
  id: 'mining.cockpit.production',
  name: 'Owner — production vs target',
  description:
    'Production volume vs target for the last `windowDays` (default 7). Breakdown by site.',
  personaSlugs: OWNER,
  inputSchema: ProductionInput,
  outputSchema: ProductionOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        windowDays: input.windowDays,
        actual: 0,
        target: 0,
        unit: 'g',
        variancePct: 0,
        bySite: [],
      };
    }
    return client.get<{
      windowDays: number;
      actual: number;
      target: number;
      unit: string;
      variancePct: number;
      bySite: Array<{ siteId: string; siteName: string; actual: number; target: number }>;
    }>('/mining/cockpit/production', {
      query: { tenantId: ctx.tenantId, windowDays: input.windowDays },
    });
  },
};

// ─────────────────────────────────────────────────────────────────────
// 5. High-severity incidents
// ─────────────────────────────────────────────────────────────────────

const HighIncidentsInput = z.object({
  limit: z.number().int().positive().max(50).default(10),
});
const HighIncidentsOutput = z.object({
  incidents: z.array(
    z.object({
      incidentId: z.string(),
      severity: z.enum(['high', 'critical']),
      title: z.string(),
      siteId: z.string().optional(),
      reportedAt: z.string(),
      status: z.enum(['open', 'investigating', 'mitigated']),
    }),
  ),
});

export const ownerHighIncidentsTool: PersonaToolDescriptor<
  typeof HighIncidentsInput,
  typeof HighIncidentsOutput
> = {
  id: 'mining.incidents.high',
  name: 'Owner — high-severity incidents',
  description:
    'Open incidents with severity HIGH or CRITICAL across all sites in the tenant. ' +
    'Used by the cockpit incident banner.',
  personaSlugs: OWNER,
  inputSchema: HighIncidentsInput,
  outputSchema: HighIncidentsOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { incidents: [] };
    return client.get<{ incidents: Array<{ incidentId: string; severity: 'high' | 'critical'; title: string; siteId?: string; reportedAt: string; status: 'open' | 'investigating' | 'mitigated' }> }>(
      '/mining/incidents',
      { query: { tenantId: ctx.tenantId, severity: 'high,critical', status: 'open', limit: input.limit } },
    );
  },
};

// ─────────────────────────────────────────────────────────────────────
// 6. Licence health (T-90/T-30/T-7)
// ─────────────────────────────────────────────────────────────────────

const LicenceHealthInput = z.object({});
const LicenceHealthOutput = z.object({
  alerts: z.array(
    z.object({
      licenceId: z.string(),
      name: z.string(),
      expiresOn: z.string(),
      daysRemaining: z.number().int(),
      tier: z.enum(['T-90', 'T-30', 'T-7', 'expired']),
    }),
  ),
});

export const ownerLicenceHealthTool: PersonaToolDescriptor<
  typeof LicenceHealthInput,
  typeof LicenceHealthOutput
> = {
  id: 'mining.licences.health',
  name: 'Owner — licence health',
  description:
    'Mining licences approaching renewal at T-90 / T-30 / T-7 plus any already expired. ' +
    'Drives the cockpit renewal carousel.',
  personaSlugs: OWNER,
  inputSchema: LicenceHealthInput,
  outputSchema: LicenceHealthOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(_input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { alerts: [] };
    return client.get<{ alerts: Array<{ licenceId: string; name: string; expiresOn: string; daysRemaining: number; tier: 'T-90' | 'T-30' | 'T-7' | 'expired' }> }>(
      '/mining/licences/health',
      { query: { tenantId: ctx.tenantId } },
    );
  },
};

// ─────────────────────────────────────────────────────────────────────
// 7. Marketplace — bids on my parcels
// ─────────────────────────────────────────────────────────────────────

const MarketBidsInput = z.object({
  limit: z.number().int().positive().max(50).default(20),
});
const MarketBidsOutput = z.object({
  bids: z.array(
    z.object({
      bidId: z.string(),
      parcelId: z.string(),
      buyerId: z.string(),
      amount: z.number(),
      currency: z.string(),
      placedAt: z.string(),
      status: z.enum(['active', 'accepted', 'declined', 'withdrawn']),
    }),
  ),
});

export const ownerMarketBidsTool: PersonaToolDescriptor<
  typeof MarketBidsInput,
  typeof MarketBidsOutput
> = {
  id: 'mining.marketplace.bids-on-my-parcels',
  name: 'Owner — bids on my parcels',
  description:
    'Active bids placed on the owner\'s marketplace parcels. Drives the owner cockpit ' +
    '"Incoming Offers" card.',
  personaSlugs: OWNER,
  inputSchema: MarketBidsInput,
  outputSchema: MarketBidsOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { bids: [] };
    return client.get<{ bids: Array<{ bidId: string; parcelId: string; buyerId: string; amount: number; currency: string; placedAt: string; status: 'active' | 'accepted' | 'declined' | 'withdrawn' }> }>(
      '/mining/marketplace/bids',
      { query: { tenantId: ctx.tenantId, recipient: 'owner', limit: input.limit } },
    );
  },
};

// ─────────────────────────────────────────────────────────────────────
// 8. Recent reports
// ─────────────────────────────────────────────────────────────────────

const ReportsListInput = z.object({
  limit: z.number().int().positive().max(50).default(20),
});
const ReportsListOutput = z.object({
  reports: z.array(
    z.object({
      reportId: z.string(),
      title: z.string(),
      generatedAt: z.string(),
      kind: z.string(),
      downloadUri: z.string().optional(),
    }),
  ),
});

export const ownerReportsListTool: PersonaToolDescriptor<
  typeof ReportsListInput,
  typeof ReportsListOutput
> = {
  id: 'mining.reports.list',
  name: 'Owner — recent reports',
  description:
    'List recently generated reports the owner can open or download.',
  personaSlugs: OWNER,
  inputSchema: ReportsListInput,
  outputSchema: ReportsListOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { reports: [] };
    return client.get<{ reports: Array<{ reportId: string; title: string; generatedAt: string; kind: string; downloadUri?: string }> }>(
      '/mining/reports',
      { query: { tenantId: ctx.tenantId, limit: input.limit } },
    );
  },
};

export const OWNER_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  ownerDailyBriefTool,
  ownerDecisionsTool,
  ownerCashRunwayTool,
  ownerProductionTool,
  ownerHighIncidentsTool,
  ownerLicenceHealthTool,
  ownerMarketBidsTool,
  ownerReportsListTool,
]);
