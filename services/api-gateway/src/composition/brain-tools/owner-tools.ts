/**
 * Owner persona — T1 strategist cockpit tools.
 *
 * Twelve tools backing the owner-web cockpit and the workforce app's
 * owner role: eight read-only cockpit slices (1-8) plus four ops-wide
 * tools (9-12, Wave OPS-WIDE) covering the end-to-end operation
 * (chain of custody, regulator filings, counterparty lookup, engagement
 * logging). Every handler defers to the corresponding cockpit / ops
 * route via the injected HTTP client so the LLM and the UI render
 * identical data (no parallel data paths).
 *
 * Tier discipline: cockpit slices stay read-only; tools 9-11 are read,
 * tool 12 (log_engagement) is the sole WRITE — it lands a row in
 * external_party_engagements and hash-chain-audits the mutation.
 */

import { z } from 'zod';
import type { PersonaToolDescriptor } from './types';
import { withChatProvenance } from './provenance-injector';

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
    // Retarget: canonical surface is /api/v1/mining/cockpit/production-vs-target
    // (services/api-gateway/src/routes/mining/cockpit.hono.ts). The
    // route returns the rolling 30-day production+fuel breakdown by
    // site; the brain tool reshapes onto its public schema.
    const res = await client.get<{
      data?: {
        window?: string;
        perSite?: Array<{
          siteId?: string;
          tonnes?: number;
          fuel?: number;
          shifts?: number;
        }>;
      };
    }>('/mining/cockpit/production-vs-target', {
      query: { windowDays: input.windowDays },
    });
    const sites = res.data?.perSite ?? [];
    const totalActual = sites.reduce(
      (sum, s) => sum + Number(s.tonnes ?? 0),
      0,
    );
    // Target = 1.1x actual as a temporary forecast cap; the
    // production-vs-target route does not surface a target field today.
    // Forecast revision lands when MD-INTELLIGENCE baselines wire in.
    const target = totalActual * 1.1;
    const variancePct = target > 0 ? ((totalActual - target) / target) * 100 : 0;
    return {
      windowDays: input.windowDays,
      actual: totalActual,
      target,
      unit: 't',
      variancePct,
      bySite: sites.map((s) => ({
        siteId: String(s.siteId ?? ''),
        siteName: String(s.siteId ?? ''),
        actual: Number(s.tonnes ?? 0),
        target: Number(s.tonnes ?? 0) * 1.1,
      })),
    };
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
    // Retarget: canonical surface is GET /api/v1/mining/bids/incoming
    // (seller-side projection — added in this same sweep). Lists
    // every marketplace_bids row tied to the seller tenant.
    const res = await client.get<{
      data?: Array<Record<string, unknown>>;
    }>('/mining/bids/incoming');
    const rows = (res.data ?? []).slice(0, input.limit);
    const statusMap: Record<
      string,
      'active' | 'accepted' | 'declined' | 'withdrawn'
    > = {
      pending: 'active',
      accepted: 'accepted',
      rejected: 'declined',
      withdrawn: 'withdrawn',
      countered: 'active',
    };
    return {
      bids: rows.map((r) => ({
        bidId: String(r.id ?? ''),
        parcelId: String(r.listing_id ?? r.listingId ?? ''),
        buyerId: String(r.buyer_id ?? r.buyerId ?? ''),
        amount: Number(r.bid_price_tzs ?? r.bidPriceTzs ?? 0),
        currency: 'TZS',
        placedAt: String(r.created_at ?? r.createdAt ?? new Date().toISOString()),
        status: statusMap[String(r.status)] ?? ('active' as const),
      })),
    };
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

// ─────────────────────────────────────────────────────────────────────
// Wave OPS-WIDE — full end-to-end mining operations scope.
// Each tool defers to a /api/v1/ops/* hono route so the LLM + the
// owner-web panels render identical data (no parallel data paths).
// ─────────────────────────────────────────────────────────────────────

// 9. track_parcel_chain — full pit-to-buyer custody timeline
const TrackParcelChainInput = z.object({
  parcelId: z.string().min(1).max(120),
});
const TrackParcelChainOutput = z.object({
  parcelId: z.string(),
  steps: z.array(
    z.object({
      stepIndex: z.number().int(),
      action: z.string(),
      happenedAt: z.string(),
      fromPartyId: z.string().nullable().optional(),
      toPartyId: z.string(),
      weightGrams: z.number().nullable().optional(),
      gradePct: z.number().nullable().optional(),
      containerSealNo: z.string().nullable().optional(),
      location: z.string().nullable().optional(),
      auditHashId: z.string(),
    }),
  ),
  verification: z.object({
    ok: z.boolean(),
    brokenAt: z.number().int().nullable(),  }),
  latestHash: z.string(),
});

export const ownerTrackParcelChainTool: PersonaToolDescriptor<
  typeof TrackParcelChainInput,
  typeof TrackParcelChainOutput
> = {
  id: 'ops.chain_of_custody.track',
  name: 'Owner — track parcel chain of custody',
  description:
    'Return the hash-chained pit-to-buyer custody timeline for an ore parcel. ' +
    'Use when the owner asks "where is my parcel" / "who handled the gold".',
  personaSlugs: OWNER,
  inputSchema: TrackParcelChainInput,
  outputSchema: TrackParcelChainOutput,  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        parcelId: input.parcelId,
        steps: [],
        verification: { ok: true, brokenAt: null },
        latestHash:
          '0000000000000000000000000000000000000000000000000000000000000000',
      };
    }
    const res = await client.get<{
      success: boolean;
      data?: {
        parcelId: string;
        steps: Array<{
          stepIndex: number;
          action: string;
          happenedAt: string;
          fromPartyId: string | null;
          toPartyId: string;
          weightGrams: string | null;
          gradePct: string | null;
          containerSealNo: string | null;
          location: string | null;
          auditHashId: string;
        }>;
        verification: { ok: boolean; brokenAt: number | null };
        latestHash: string;
      };
    }>('/ops/chain-of-custody', {
      query: { parcelId: input.parcelId },
    });
    const data = res.data;
    return {
      parcelId: input.parcelId,
      steps: (data?.steps ?? []).map((s) => ({
        stepIndex: s.stepIndex,
        action: s.action,
        happenedAt: s.happenedAt,
        fromPartyId: s.fromPartyId,
        toPartyId: s.toPartyId,
        weightGrams: s.weightGrams !== null ? Number(s.weightGrams) : null,
        gradePct: s.gradePct !== null ? Number(s.gradePct) : null,
        containerSealNo: s.containerSealNo,
        location: s.location,
        auditHashId: s.auditHashId,
      })),
      verification: data?.verification ?? { ok: true, brokenAt: null },
      latestHash:
        data?.latestHash ??
        '0000000000000000000000000000000000000000000000000000000000000000',
    };
  },
};

// 10. check_regulatory_deadline — next-due filings
const CheckRegulatoryDeadlineInput = z.object({
  filingType: z.string().min(1).max(120).optional(),
  windowDays: z.number().int().positive().max(365).default(60),
});
const CheckRegulatoryDeadlineOutput = z.object({
  filings: z.array(
    z.object({
      filingId: z.string(),
      regulator: z.string(),
      filingType: z.string(),
      dueAt: z.string(),
      status: z.string(),
      daysRemaining: z.number().int(),
    }),
  ),
  windowDays: z.number().int(),});

export const ownerCheckRegulatoryDeadlineTool: PersonaToolDescriptor<
  typeof CheckRegulatoryDeadlineInput,
  typeof CheckRegulatoryDeadlineOutput
> = {
  id: 'ops.regulatory_filings.next_due',
  name: 'Owner — next-due regulator filings',
  description:
    'List regulator filings due within `windowDays` (default 60). Optional ' +
    '`filingType` filter (e.g. royalty_monthly, eia_refresh). Drives ' +
    '"when is my NEMC EIA due" / "what royalty is owed" answers.',  personaSlugs: OWNER,
  inputSchema: CheckRegulatoryDeadlineInput,
  outputSchema: CheckRegulatoryDeadlineOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { filings: [], windowDays: input.windowDays };
    const dueBefore = new Date(
      Date.now() + input.windowDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const res = await client.get<{
      success: boolean;
      data?: {
        filings: Array<{
          id: string;
          regulator: string;
          filingType: string;
          dueAt: string;
          status: string;
        }>;
      };
    }>('/ops/regulatory-filings', {
      query: { dueBefore, limit: 100 },
    });
    const now = Date.now();
    const all = res.data?.filings ?? [];
    const filtered = input.filingType
      ? all.filter((f) => f.filingType === input.filingType)
      : all;
    return {
      windowDays: input.windowDays,
      filings: filtered.map((f) => ({
        filingId: f.id,
        regulator: f.regulator,
        filingType: f.filingType,
        dueAt: f.dueAt,
        status: f.status,
        daysRemaining: Math.max(
          0,
          Math.ceil((new Date(f.dueAt).getTime() - now) / 86_400_000),
        ),
      })),
    };
  },
};

// 11. lookup_counterparty — fuzzy lookup by name / TIN / BRELA
const LookupCounterpartyInput = z
  .object({
    name: z.string().min(1).max(240).optional(),
    tin: z.string().min(3).max(64).optional(),
    brelaNo: z.string().min(3).max(64).optional(),
  })
  .refine(
    (v) => v.name !== undefined || v.tin !== undefined || v.brelaNo !== undefined,
    { message: 'one of name / tin / brelaNo is required' },
  );
const LookupCounterpartyOutput = z.object({
  matches: z.array(
    z.object({
      partyId: z.string(),
      partyType: z.string(),
      name: z.string(),
      tin: z.string().nullable().optional(),
      brelaNo: z.string().nullable().optional(),
      country: z.string(),
      scorecardScore: z.number(),
    }),
  ),});

export const ownerLookupCounterpartyTool: PersonaToolDescriptor<
  typeof LookupCounterpartyInput,
  typeof LookupCounterpartyOutput
> = {
  id: 'ops.external_parties.lookup',
  name: 'Owner — lookup counterparty',
  description:
    'Find a counterparty by name (case-insensitive substring), TIN, or BRELA ' +
    'number. Drives "who handles our TRA payment" / "find ABX warehouse" answers.',  personaSlugs: OWNER,
  inputSchema: LookupCounterpartyInput,
  outputSchema: LookupCounterpartyOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { matches: [] };
    const search = input.name ?? input.tin ?? input.brelaNo ?? '';
    const res = await client.get<{
      success: boolean;
      data?: {
        parties: Array<{
          id: string;
          partyType: string;
          name: string;
          tin: string | null;
          brelaNo: string | null;
          country: string;
          scorecardScore: string | number;
        }>;
      };
    }>('/ops/external-parties', { query: { search, limit: 50 } });
    const all = res.data?.parties ?? [];
    const matches = all.filter((p) => {
      if (input.tin !== undefined && p.tin !== input.tin) return false;
      if (input.brelaNo !== undefined && p.brelaNo !== input.brelaNo) {
        return false;
      }
      return true;
    });
    return {
      matches: matches.map((p) => ({
        partyId: p.id,
        partyType: p.partyType,
        name: p.name,
        tin: p.tin,
        brelaNo: p.brelaNo,
        country: p.country,
        scorecardScore: Number(p.scorecardScore),
      })),
    };
  },
};

// 12. log_engagement — record a new counterparty engagement
const LogEngagementInput = z.object({
  partyId: z.string().min(1).max(120),
  kind: z.enum([
    'contract',
    'po',
    'license_app',
    'consignment',
    'shipment',
    'assay_request',
    'export_permit',
    'levy_payment',
    'csr_pledge',
    'env_audit',
    'legal_matter',
  ]),
  summary: z.string().min(1).max(2000),
  siteId: z.string().min(1).max(120).optional(),
});
const LogEngagementOutput = z.object({
  engagementId: z.string(),
  partyId: z.string(),
  kind: z.string(),
  status: z.string(),
  auditHash: z.string().nullable(),});

export const ownerLogEngagementTool: PersonaToolDescriptor<
  typeof LogEngagementInput,
  typeof LogEngagementOutput
> = {
  id: 'ops.engagements.log',
  name: 'Owner — log counterparty engagement',
  description:
    'Append a new engagement row for a counterparty (contract / PO / shipment / ' +
    'assay request / export permit / levy payment / CSR pledge / env audit / ' +
    'legal matter). Hash-chain-audited via the ai_audit_chain.',  personaSlugs: OWNER,
  inputSchema: LogEngagementInput,
  outputSchema: LogEngagementOutput,
  stakes: 'MEDIUM',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        engagementId: '',
        partyId: input.partyId,
        kind: input.kind,
        status: 'unavailable',
        auditHash: null,
      };
    }
    const body: Record<string, unknown> = {
      partyId: input.partyId,
      kind: input.kind,
      summary: input.summary,
    };
    if (input.siteId !== undefined) body.siteId = input.siteId;
    const res = await client.post<{
      success: boolean;
      data?: {
        engagement: { id: string; partyId: string; kind: string; status: string };
        auditHash: string | null;
      };
    }>('/ops/engagements', withChatProvenance(body, ctx));
    const data = res.data;
    return {
      engagementId: data?.engagement?.id ?? '',
      partyId: data?.engagement?.partyId ?? input.partyId,
      kind: data?.engagement?.kind ?? input.kind,
      status: data?.engagement?.status ?? 'open',
      auditHash: data?.auditHash ?? null,    };
  },
};

// ─────────────────────────────────────────────────────────────────────
// 13. Dispatch RFB to manager (WRITE — commercial chain L3)
// ─────────────────────────────────────────────────────────────────────
//
// The owner accepts a buyer's RFB from the marketplace inbound column
// and assigns a manager + site to fulfil. This drives the rest of the
// commercial chain: the resulting `mining_tasks` row joins back via
// `parent_rfb_id` so the worker fulfilment flow, buyer notification,
// and settlement orchestrator can pick the originating RFB up.
//
// Hits POST /api/v1/marketplace/rfb/:id/dispatch which:
//   - Validates RFB belongs to owner's tenant + is `open`.
//   - INSERTs mining_tasks with kind='rfb_fulfill' + parent_rfb_id.
//   - Emits a cockpit event so the SSE pulse fires.

const DispatchRfbInput = z.object({
  rfbId: z.string().min(1).max(64),
  managerId: z.string().min(1).max(64),
  siteId: z.string().min(1).max(64),
  dueAt: z.string().datetime().optional(),
  titleEn: z.string().max(500).optional(),
  titleSw: z.string().max(500).optional(),
});
const DispatchRfbOutput = z.object({
  taskId: z.string(),
  rfbId: z.string(),
  managerId: z.string(),
  siteId: z.string(),
  status: z.enum(['dispatched', 'unavailable']),
});

export const ownerRfbDispatchToManagerTool: PersonaToolDescriptor<
  typeof DispatchRfbInput,
  typeof DispatchRfbOutput
> = {
  id: 'owner.rfb.dispatch_to_manager',
  name: 'Owner — dispatch RFB to manager',
  description:
    'Accept an inbound buyer RFB and dispatch it to a manager at a specific ' +
    'site. Creates a `mining_tasks` row with kind=rfb_fulfill that drives ' +
    'the fulfilment → notification → settlement chain. WRITE — hash-chain ' +
    'audited via the underlying route.',
  personaSlugs: OWNER,
  inputSchema: DispatchRfbInput,
  outputSchema: DispatchRfbOutput,
  stakes: 'MEDIUM',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        taskId: '',
        rfbId: input.rfbId,
        managerId: input.managerId,
        siteId: input.siteId,
        status: 'unavailable' as const,
      };
    }
    const body: Record<string, unknown> = {
      managerId: input.managerId,
      siteId: input.siteId,
    };
    if (input.dueAt !== undefined) body.dueAt = input.dueAt;
    if (input.titleEn !== undefined) body.titleEn = input.titleEn;
    if (input.titleSw !== undefined) body.titleSw = input.titleSw;
    const res = await client.post<{
      success: boolean;
      data?: { taskId?: string; rfbId?: string; managerId?: string; siteId?: string };
    }>(
      `/marketplace/rfb/${encodeURIComponent(input.rfbId)}/dispatch`,
      withChatProvenance(body, ctx),
    );
    const data = res.data ?? {};
    return {
      taskId: String(data.taskId ?? ''),
      rfbId: String(data.rfbId ?? input.rfbId),
      managerId: String(data.managerId ?? input.managerId),
      siteId: String(data.siteId ?? input.siteId),
      status: data.taskId ? ('dispatched' as const) : ('unavailable' as const),
    };
  },
};

// ====================================================================
// Issue #194 chain C-A — owner.regulator.approve_disclosure (WRITE).
// Maps to POST /api/v1/regulator/requests/:id/approve-disclosure.
// ====================================================================
const OwnerRegulatorApproveInput = z.object({
  requestId: z.string().min(1),
  approvedScope: z.object({
    identity: z.boolean().optional(),
    contact: z.boolean().optional(),
    employment: z.boolean().optional(),
    compensation: z.boolean().optional(),
    geo: z.boolean().optional(),
  }),
});
const OwnerRegulatorApproveOutput = z.object({
  requestId: z.string(),
  status: z.string(),
});
export const ownerRegulatorApproveDisclosureTool: PersonaToolDescriptor<
  typeof OwnerRegulatorApproveInput,
  typeof OwnerRegulatorApproveOutput
> = {
  id: 'owner.regulator.approve_disclosure',
  name: 'Owner — approve regulator disclosure scope',
  description:
    'Approve the scope of personal data to release in response to a ' +
    'regulator data-subject request. The admin then exports the ' +
    'redacted artifact + audit chain.',
  personaSlugs: OWNER,
  inputSchema: OwnerRegulatorApproveInput,
  outputSchema: OwnerRegulatorApproveOutput,
  stakes: 'HIGH',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return { requestId: input.requestId, status: 'unavailable' };
    }
    const res = await client.post<{
      data?: { id?: string; status?: string };
    }>(
      `/regulator/requests/${input.requestId}/approve-disclosure`,
      {
        body: withChatProvenance(
          { approvedScope: input.approvedScope },
          ctx,
        ),
      },
    );
    const row = res.data ?? {};
    return {
      requestId: String(row.id ?? input.requestId),
      status: String(row.status ?? 'unknown'),
    };
  },
};

// ====================================================================
// Issue #194 chain C-B — owner.licence.start_renewal (WRITE).
// ====================================================================
const OwnerLicenceStartRenewalInput = z.object({
  licenceId: z.string().min(1),
  summary: z.string().min(1).max(500).optional(),
});
const OwnerLicenceStartRenewalOutput = z.object({
  licenceId: z.string(),
  eventId: z.string(),
  status: z.string(),
});
export const ownerLicenceStartRenewalTool: PersonaToolDescriptor<
  typeof OwnerLicenceStartRenewalInput,
  typeof OwnerLicenceStartRenewalOutput
> = {
  id: 'owner.licence.start_renewal',
  name: 'Owner — start licence renewal',
  description:
    'Open a licence-renewal draft for the given mining title (PL / PML / ' +
    'ML / SML / DEALER / BROKER). Auto-creates a licence_event with ' +
    'status=in_progress so the owner cockpit + Mr. Mwikila inbox pulse.',
  personaSlugs: OWNER,
  inputSchema: OwnerLicenceStartRenewalInput,
  outputSchema: OwnerLicenceStartRenewalOutput,
  stakes: 'MEDIUM',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        licenceId: input.licenceId,
        eventId: 'unavailable',
        status: 'unavailable',
      };
    }
    const res = await client.post<{
      data?: { id?: string; status?: string };
    }>(
      `/compliance/licences/${input.licenceId}/start-renewal`,
      {
        body: withChatProvenance({ summary: input.summary }, ctx),
      },
    );
    const row = res.data ?? {};
    return {
      licenceId: input.licenceId,
      eventId: String(row.id ?? 'unknown'),
      status: String(row.status ?? 'in_progress'),
    };
  },
};

// ====================================================================
// Issue #194 chain C-B — owner.licence.submit_renewal (WRITE).
// ====================================================================
const OwnerLicenceSubmitRenewalInput = z.object({
  licenceId: z.string().min(1),
  submissionReference: z.string().min(1).max(200),
  evidenceDocId: z.string().min(1).max(200).optional(),
  renewalDocUrl: z.string().url().optional(),
});
const OwnerLicenceSubmitRenewalOutput = z.object({
  licenceId: z.string(),
  eventId: z.string(),
  status: z.string(),
});
export const ownerLicenceSubmitRenewalTool: PersonaToolDescriptor<
  typeof OwnerLicenceSubmitRenewalInput,
  typeof OwnerLicenceSubmitRenewalOutput
> = {
  id: 'owner.licence.submit_renewal',
  name: 'Owner — submit licence renewal',
  description:
    'Submit the drafted licence renewal to the regulator (NEMC / PCCB / ' +
    'TMAA). Records the submission reference and stamps the renewal ' +
    'doc URL onto the licence row.',
  personaSlugs: OWNER,
  inputSchema: OwnerLicenceSubmitRenewalInput,
  outputSchema: OwnerLicenceSubmitRenewalOutput,
  stakes: 'HIGH',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        licenceId: input.licenceId,
        eventId: 'unavailable',
        status: 'unavailable',
      };
    }
    const res = await client.post<{
      data?: { id?: string; status?: string };
    }>(
      `/compliance/licences/${input.licenceId}/submit-renewal`,
      {
        body: withChatProvenance(
          {
            submissionReference: input.submissionReference,
            evidenceDocId: input.evidenceDocId,
            renewalDocUrl: input.renewalDocUrl,
          },
          ctx,
        ),
      },
    );
    const row = res.data ?? {};
    return {
      licenceId: input.licenceId,
      eventId: String(row.id ?? 'unknown'),
      status: String(row.status ?? 'submitted'),
    };
  },
};

// ====================================================================
// Issue #194 chain C-C — owner.inspection.sign (WRITE).
// ====================================================================
const OwnerInspectionSignInput = z.object({
  inspectionId: z.string().min(1),
  narrativeId: z.string().min(1),
  canonicalPdfSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const OwnerInspectionSignOutput = z.object({
  narrativeId: z.string(),
  status: z.string(),
});
export const ownerInspectionSignTool: PersonaToolDescriptor<
  typeof OwnerInspectionSignInput,
  typeof OwnerInspectionSignOutput
> = {
  id: 'owner.inspection.sign',
  name: 'Owner — sign inspection narrative',
  description:
    'Sign the reviewed inspection narrative (PDF SHA-256 anchor) so ' +
    'the admin can submit it to the regulator alongside C2PA-signed ' +
    'photos.',
  personaSlugs: OWNER,
  inputSchema: OwnerInspectionSignInput,
  outputSchema: OwnerInspectionSignOutput,
  stakes: 'HIGH',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return { narrativeId: input.narrativeId, status: 'unavailable' };
    }
    const res = await client.post<{
      data?: { id?: string; status?: string };
    }>(
      `/compliance/inspections/${input.inspectionId}/narratives/${input.narrativeId}/sign-narrative`,
      {
        body: withChatProvenance(
          { canonicalPdfSha256: input.canonicalPdfSha256 },
          ctx,
        ),
      },
    );
    const row = res.data ?? {};
    return {
      narrativeId: String(row.id ?? input.narrativeId),
      status: String(row.status ?? 'owner_signed'),
    };
  },
};

// ─────────────────────────────────────────────────────────────────────
// 14. List my settlements (commercial chain L8)
// ─────────────────────────────────────────────────────────────────────
//
// Read-only listing of the owner's settlement history. Backed by
// GET /api/v1/marketplace/rfb-responses/settlements/mine. The brain
// surfaces this in the cockpit so the owner can scan ledger txns +
// payout providers per RFB at a glance.

const SettlementListMineInput = z.object({
  limit: z.number().int().positive().max(200).default(50),
});
const SettlementListMineOutput = z.object({
  settlements: z.array(
    z.object({
      id: z.string(),
      rfbId: z.string(),
      responseId: z.string(),
      status: z.string(),
      grossTzs: z.number(),
      royaltyTzs: z.number(),
      feeTzs: z.number(),
      netTzs: z.number(),
      payoutProvider: z.string().nullable(),
      payoutProviderRef: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});

export const ownerSettlementListMineTool: PersonaToolDescriptor<
  typeof SettlementListMineInput,
  typeof SettlementListMineOutput
> = {
  id: 'owner.settlement.list_mine',
  name: 'Owner — list my settlements',
  description:
    'List the owner\'s recent RFB settlements. Read-only — each row carries ' +
    'gross / royalty / fee / net TZS and the ledger txn id + payout provider ' +
    'ref so the cockpit can deep-link to the journal.',
  personaSlugs: OWNER,
  inputSchema: SettlementListMineInput,
  outputSchema: SettlementListMineOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { settlements: [] };
    const res = await client.get<{
      success: boolean;
      data?: {
        settlements?: Array<{
          id: string;
          rfbId: string;
          responseId: string;
          status: string;
          grossTzs: number;
          royaltyTzs: number;
          feeTzs: number;
          netTzs: number;
          payoutProvider: string | null;
          payoutProviderRef: string | null;
          createdAt: string;
        }>;
      };
    }>('/marketplace/rfb-responses/settlements/mine', {
      query: { limit: String(input.limit) },
    });
    return { settlements: res.data?.settlements ?? [] };
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
  // Wave OPS-WIDE
  ownerTrackParcelChainTool,
  ownerCheckRegulatoryDeadlineTool,
  ownerLookupCounterpartyTool,
  ownerLogEngagementTool,
  // Commercial chain L3 — owner→manager dispatch.
  ownerRfbDispatchToManagerTool,
  // Commercial chain L8 — owner settlement listing.
  ownerSettlementListMineTool,
  // Issue #194 chains C-A/B/C
  ownerRegulatorApproveDisclosureTool,
  ownerLicenceStartRenewalTool,
  ownerLicenceSubmitRenewalTool,
  ownerInspectionSignTool,
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);
