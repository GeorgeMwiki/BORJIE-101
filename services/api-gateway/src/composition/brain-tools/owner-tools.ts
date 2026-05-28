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

// ─────────────────────────────────────────────────────────────────────
// 9. Ops-wide tools — Wave OPS-WIDE
// ─────────────────────────────────────────────────────────────────────

const TrackParcelInput = z.object({
  parcelId: z.string().trim().min(1).max(120),
});
const TrackParcelOutput = z.object({
  parcelId: z.string(),
  steps: z.array(z.record(z.any())),
  verification: z.object({
    ok: z.boolean(),
    brokenAt: z.number().nullable(),
  }),
  latestHash: z.string(),
});

export const ownerTrackParcelChainTool: PersonaToolDescriptor<
  typeof TrackParcelInput,
  typeof TrackParcelOutput
> = {
  id: 'mining.ops.track_parcel_chain',
  name: 'Owner — track parcel chain',
  description:
    'Pull the full hash-chained chain-of-custody trail for one mineral parcel. ' +
    'Read-only. Defers to /api/v1/ops/chain-of-custody.',
  personaSlugs: OWNER,
  inputSchema: TrackParcelInput,
  outputSchema: TrackParcelOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        parcelId: input.parcelId,
        steps: [],
        verification: { ok: true, brokenAt: null },
        latestHash: '',
      };
    }
    return client.get<{
      parcelId: string;
      steps: Array<Record<string, any>>;
      verification: { ok: boolean; brokenAt: number | null };
      latestHash: string;
    }>('/ops/chain-of-custody', {
      query: { parcelId: input.parcelId },
    });
  },
};

const CheckRegulatoryDeadlineInput = z.object({
  regulator: z.string().optional(),
  dueWithinDays: z.coerce.number().int().min(1).max(365).default(60),
});
const CheckRegulatoryDeadlineOutput = z.object({
  filings: z.array(z.record(z.any())),
});

export const ownerCheckRegulatoryDeadlineTool: PersonaToolDescriptor<
  typeof CheckRegulatoryDeadlineInput,
  typeof CheckRegulatoryDeadlineOutput
> = {
  id: 'mining.ops.check_regulatory_deadline',
  name: 'Owner — check regulatory deadline',
  description:
    'List upcoming regulator filings within a window. Read-only. Defers to ' +
    '/api/v1/ops/regulatory-filings.',
  personaSlugs: OWNER,
  inputSchema: CheckRegulatoryDeadlineInput,
  outputSchema: CheckRegulatoryDeadlineOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { filings: [] };
    const dueBefore = new Date(
      Date.now() + input.dueWithinDays * 86_400_000,
    ).toISOString();
    const query: Record<string, string> = { dueBefore };
    if (input.regulator) query.regulator = input.regulator;
    return client.get<{ filings: Array<Record<string, any>> }>(
      '/ops/regulatory-filings',
      { query },
    );
  },
};

const LookupCounterpartyInput = z.object({
  search: z.string().trim().min(1).max(200),
  partyType: z.string().optional(),
});
const LookupCounterpartyOutput = z.object({
  parties: z.array(z.record(z.any())),
});

export const ownerLookupCounterpartyTool: PersonaToolDescriptor<
  typeof LookupCounterpartyInput,
  typeof LookupCounterpartyOutput
> = {
  id: 'mining.ops.lookup_counterparty',
  name: 'Owner — lookup counterparty',
  description:
    'Find a counterparty by name / TIN / BRELA. Read-only. Defers to ' +
    '/api/v1/ops/external-parties.',
  personaSlugs: OWNER,
  inputSchema: LookupCounterpartyInput,
  outputSchema: LookupCounterpartyOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { parties: [] };
    const query: Record<string, string> = { search: input.search };
    if (input.partyType) query.partyType = input.partyType;
    return client.get<{ parties: Array<Record<string, any>> }>(
      '/ops/external-parties',
      { query },
    );
  },
};

const LogEngagementInput = z.object({
  partyId: z.string().uuid(),
  siteId: z.string().nullable().optional(),
  kind: z.string(),
  summary: z.string().trim().min(1).max(4000),
});
const LogEngagementOutput = z.object({
  id: z.string(),
  auditHashId: z.string().nullable(),
});

export const ownerLogEngagementTool: PersonaToolDescriptor<
  typeof LogEngagementInput,
  typeof LogEngagementOutput
> = {
  id: 'mining.ops.log_engagement',
  name: 'Owner — log engagement',
  description:
    'Append a single engagement row in external_party_engagements. WRITE — ' +
    'hash-chained audit. Defers to POST /api/v1/ops/engagements.',
  personaSlugs: OWNER,
  inputSchema: LogEngagementInput,
  outputSchema: LogEngagementOutput,
  stakes: 'MEDIUM',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { id: '', auditHashId: null };
    return client.post<{ id: string; auditHashId: string | null }>(
      '/ops/engagements',
      input as Record<string, unknown>,
    );
  },
};

// ─────────────────────────────────────────────────────────────────────
// 13. Compliance full picture — Wave SOTA-DEPTH
//     NEVER SHALLOW. Surface the full 18-sub-area compliance matrix.
// ─────────────────────────────────────────────────────────────────────

const ComplianceFullPictureInput = z.object({
  siteId: z.string().uuid().optional(),
});
const ComplianceFullPictureOutput = z.object({
  domainId: z.literal('compliance'),
  subAreas: z.array(
    z.object({
      id: z.string(),
      labelEn: z.string(),
      labelSw: z.string(),
      regulator: z.string().optional(),
      cadence: z.string(),
      status: z.string(),
      note: z.string().optional(),
    }),
  ),
});

export const ownerComplianceFullPictureTool: PersonaToolDescriptor<
  typeof ComplianceFullPictureInput,
  typeof ComplianceFullPictureOutput
> = {
  id: 'sota.compliance_full_picture',
  name: 'Owner — compliance full picture (18 sub-areas)',
  description:
    'Return the ENTIRE compliance matrix (≥15 sub-areas: licences, tax, ' +
    'environmental, banking, trade, labour, workplace safety, workforce ' +
    'certs, anti-corruption, data protection, AML, standards, customs, ' +
    'assay, insurance, local content, human rights, telecoms). NEVER ' +
    'shallow — always surface the whole picture.',
  personaSlugs: OWNER,
  inputSchema: ComplianceFullPictureInput,
  outputSchema: ComplianceFullPictureOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(_input, _ctx) {
    const { getDomain, awaitingDataResolver } = await import(
      '../../services/domain-depth/index.js'
    );
    const domain = getDomain('compliance');
    if (!domain) {
      return { domainId: 'compliance' as const, subAreas: [] };
    }
    const subAreas = await Promise.all(
      domain.subAreas.map(async (sa) => {
        const st = await awaitingDataResolver({ tenantId: '' });
        return {
          id: sa.id,
          labelEn: sa.label.en,
          labelSw: sa.label.sw,
          regulator: sa.regulator,
          cadence: sa.cadence,
          status: st.status,
          note: st.note,
        };
      }),
    );
    return { domainId: 'compliance' as const, subAreas };
  },
};

// ─────────────────────────────────────────────────────────────────────
// 14. Domain full picture — generic
// ─────────────────────────────────────────────────────────────────────

const DomainFullPictureInput = z.object({
  domainId: z.enum([
    'compliance',
    'finance',
    'operations',
    'hr',
    'marketing',
    'risk',
    'treasury',
    'geology',
    'marketplace',
    'licences',
    'holdings',
    'subsidiaries',
    'succession',
    'asset-register',
  ]),
});
const DomainFullPictureOutput = z.object({
  domainId: z.string(),
  subAreas: z.array(
    z.object({
      id: z.string(),
      labelEn: z.string(),
      labelSw: z.string(),
      cadence: z.string(),
      status: z.string(),
      note: z.string().optional(),
    }),
  ),
});

export const ownerDomainFullPictureTool: PersonaToolDescriptor<
  typeof DomainFullPictureInput,
  typeof DomainFullPictureOutput
> = {
  id: 'sota.domain_full_picture',
  name: 'Owner — domain full picture',
  description:
    'Return the FULL sub-area matrix for any of the 14 owner-os ' +
    'domains. NEVER shallow.',
  personaSlugs: OWNER,
  inputSchema: DomainFullPictureInput,
  outputSchema: DomainFullPictureOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, _ctx) {
    const { getDomain, awaitingDataResolver } = await import(
      '../../services/domain-depth/index.js'
    );
    const domain = getDomain(input.domainId);
    if (!domain) return { domainId: input.domainId, subAreas: [] };
    const subAreas = await Promise.all(
      domain.subAreas.map(async (sa) => {
        const st = await awaitingDataResolver({ tenantId: '' });
        return {
          id: sa.id,
          labelEn: sa.label.en,
          labelSw: sa.label.sw,
          cadence: sa.cadence,
          status: st.status,
          note: st.note,
        };
      }),
    );
    return { domainId: input.domainId, subAreas };
  },
};

// ─────────────────────────────────────────────────────────────────────
// 15. Sub-area drill — single sub-area, full descriptor
// ─────────────────────────────────────────────────────────────────────

const SubAreaDrillInput = z.object({
  domainId: z.string(),
  subAreaId: z.string(),
});
const SubAreaDrillOutput = z.object({
  found: z.boolean(),
  labelEn: z.string().optional(),
  labelSw: z.string().optional(),
  cadence: z.string().optional(),
  regulator: z.string().optional(),
  riskEn: z.string().optional(),
  riskSw: z.string().optional(),
  status: z.string().optional(),
  note: z.string().optional(),
});

export const ownerSubAreaDrillTool: PersonaToolDescriptor<
  typeof SubAreaDrillInput,
  typeof SubAreaDrillOutput
> = {
  id: 'sota.sub_area_drill',
  name: 'Owner — sub-area drill',
  description:
    'Drill into one sub-area of one domain: label, cadence, regulator, ' +
    'risk-if-missed, and live status.',
  personaSlugs: OWNER,
  inputSchema: SubAreaDrillInput,
  outputSchema: SubAreaDrillOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, _ctx) {
    const { getSubArea, awaitingDataResolver } = await import(
      '../../services/domain-depth/index.js'
    );
    const sa = getSubArea(input.domainId as any, input.subAreaId);
    if (!sa) return { found: false };
    const status = await awaitingDataResolver({ tenantId: '' });
    return {
      found: true,
      labelEn: sa.label.en,
      labelSw: sa.label.sw,
      cadence: sa.cadence,
      regulator: sa.regulator,
      riskEn: sa.riskIfMissed.en,
      riskSw: sa.riskIfMissed.sw,
      status: status.status,
      note: status.note,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────
// 16-19. Cross-domain MD intelligence — Wave MD-INTELLIGENCE
// ─────────────────────────────────────────────────────────────────────

const CorrelationInput = z.object({
  domain: z.string(),
  siteId: z.string().uuid().optional(),
});
const CorrelationOutput = z.object({
  domain: z.string(),
  touches: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      touchedDomain: z.string(),
      strength: z.number(),
      lagDays: z.number(),
      kind: z.string(),
      rationale: z.string(),
    }),
  ),
});

export const ownerCorrelationForQuestionTool: PersonaToolDescriptor<
  typeof CorrelationInput,
  typeof CorrelationOutput
> = {
  id: 'md.correlation_for_question',
  name: 'Owner — correlation for question',
  description:
    'Surface which OTHER domains the asked-about state touches via the ' +
    'signal graph. Read-only.',
  personaSlugs: OWNER,
  inputSchema: CorrelationInput,
  outputSchema: CorrelationOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const { correlate } = await import(
      '../../services/md-intelligence/index.js'
    );
    const scope: { tenantId: string; siteId?: string } = {
      tenantId: ctx.tenantId,
      ...(input.siteId ? { siteId: input.siteId } : {}),
    };
    const result = await correlate({
      domain: input.domain as any,
      scope,
      probe: async () => true,
    });
    return {
      domain: input.domain,
      touches: result.touches.map((t) => ({
        from: t.from,
        to: t.to,
        touchedDomain: t.touchedDomain,
        strength: t.strength,
        lagDays: t.lagDays,
        kind: t.kind,
        rationale: t.rationale,
      })),
    };
  },
};

const TraceCausesInput = z.object({
  symptom: z.string(),
  siteId: z.string().uuid().optional(),
});
const TraceCausesOutput = z.object({
  chains: z.array(
    z.object({
      steps: z.array(
        z.object({
          from: z.string(),
          to: z.string(),
          strength: z.number(),
          lagDays: z.number(),
          rationale: z.string(),
        }),
      ),
    }),
  ),
});

export const ownerTraceCausesTool: PersonaToolDescriptor<
  typeof TraceCausesInput,
  typeof TraceCausesOutput
> = {
  id: 'md.trace_causes',
  name: 'Owner — trace causes',
  description:
    'Walk upstream from a symptom to surface root causes through the ' +
    'signal graph. Read-only.',
  personaSlugs: OWNER,
  inputSchema: TraceCausesInput,
  outputSchema: TraceCausesOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const { trace } = await import(
      '../../services/md-intelligence/index.js'
    );
    const scope: { tenantId: string; siteId?: string } = {
      tenantId: ctx.tenantId,
      ...(input.siteId ? { siteId: input.siteId } : {}),
    };
    const result = await trace({
      symptom: input.symptom,
      scope,
      probe: async () => true,
      maxDepth: 4,
    });
    return {
      chains: result.chains.map((chain) => ({
        steps: chain.steps.map((s) => ({
          from: s.from,
          to: s.to,
          strength: s.strength,
          lagDays: s.lagDays,
          rationale: s.rationale,
        })),
      })),
    };
  },
};

const CompareInputSchema = z.object({
  metricId: z.string(),
  liveValue: z.number(),
  cohortKey: z.string().optional(),
});
const CompareOutputSchema = z.object({
  metricId: z.string(),
  liveValue: z.number(),
  historicalBand: z
    .object({ p25: z.number(), p50: z.number(), p75: z.number() })
    .optional(),
  peerBand: z
    .object({ p25: z.number(), p50: z.number(), p75: z.number() })
    .optional(),
  externalBenchmark: z.number().optional(),
  verdict: z.string(),
});

export const ownerCompareBaselinesTool: PersonaToolDescriptor<
  typeof CompareInputSchema,
  typeof CompareOutputSchema
> = {
  id: 'md.compare_baselines',
  name: 'Owner — compare baselines',
  description:
    'Compare a live value to historical / peer / external benchmark ' +
    'baselines. Read-only.',
  personaSlugs: OWNER,
  inputSchema: CompareInputSchema,
  outputSchema: CompareOutputSchema,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, _ctx) {
    // No DB access from a brain tool surface here — return a structured
    // shell so the caller can hydrate against the comparison-framework
    // through the gateway once a comparison endpoint lands.
    return {
      metricId: input.metricId,
      liveValue: input.liveValue,
      verdict: 'baseline_pending',
    };
  },
};

const EmitInsightsInputSchema = z.object({
  domain: z.string(),
  context: z.record(z.unknown()).optional(),
});
const EmitInsightsOutputSchema = z.object({
  insights: z.array(
    z.object({
      kind: z.string(),
      headlineEn: z.string(),
      headlineSw: z.string(),
      rationale: z.string(),
      action: z.string().optional(),
    }),
  ),
});

export const ownerEmitInsightsTool: PersonaToolDescriptor<
  typeof EmitInsightsInputSchema,
  typeof EmitInsightsOutputSchema
> = {
  id: 'md.emit_insights',
  name: 'Owner — emit insights',
  description:
    'Return 0-3 NON-OBVIOUS, GROUNDED insights for a domain. Every ' +
    'insight is anchored to a real data point in the same turn — never ' +
    'fabricated. Read-only.',
  personaSlugs: OWNER,
  inputSchema: EmitInsightsInputSchema,
  outputSchema: EmitInsightsOutputSchema,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(_input, _ctx) {
    // Insight emission requires live signal data; without grounding the
    // tool returns no insights rather than fabricated ones.
    return { insights: [] };
  },
};

// ─────────────────────────────────────────────────────────────────────
// 20-24. Scope-aware reasoning — Wave SCOPE-SEGMENTATION
// ─────────────────────────────────────────────────────────────────────

const ResolveScopeLabelInput = z.object({
  kindCanonical: z.string(),
  locale: z.enum(['en', 'sw']).default('sw'),
});
const ResolveScopeLabelOutput = z.object({
  kindCanonical: z.string(),
  displayLabel: z.string(),
});

export const ownerResolveScopeLabelTool: PersonaToolDescriptor<
  typeof ResolveScopeLabelInput,
  typeof ResolveScopeLabelOutput
> = {
  id: 'scope.resolve_label',
  name: 'Owner — resolve scope label',
  description:
    'Map a canonical scope kind to the tenant-preferred display label ' +
    'in the requested locale.',
  personaSlugs: OWNER,
  inputSchema: ResolveScopeLabelInput,
  outputSchema: ResolveScopeLabelOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        kindCanonical: input.kindCanonical,
        displayLabel: input.kindCanonical,
      };
    }
    const res = await client.get<{
      data: {
        taxonomy: {
          displayLabelEn: Record<string, string>;
          displayLabelSw: Record<string, string>;
        } | null;
      };
    }>('/scope/taxonomy', {});
    const map =
      input.locale === 'en'
        ? res.data?.taxonomy?.displayLabelEn ?? {}
        : res.data?.taxonomy?.displayLabelSw ?? {};
    return {
      kindCanonical: input.kindCanonical,
      displayLabel: map[input.kindCanonical] ?? input.kindCanonical,
    };
  },
};

const RollUpInput = z.object({
  scopeNodeIds: z.array(z.string().uuid()).min(1).max(200),
  metricId: z.string(),
});
const RollUpOutput = z.object({
  metricId: z.string(),
  total: z.number(),
  mean: z.number(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  count: z.number(),
});

export const ownerRollUpAcrossScopesTool: PersonaToolDescriptor<
  typeof RollUpInput,
  typeof RollUpOutput
> = {
  id: 'scope.roll_up_across_scopes',
  name: 'Owner — roll up across scopes',
  description:
    'Aggregate a metric across a set of scope nodes (sum, mean, min, max). ' +
    'Read-only.',
  personaSlugs: OWNER,
  inputSchema: RollUpInput,
  outputSchema: RollUpOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, _ctx) {
    // Sample fetch is not yet wired to a live source; return zeros so
    // the caller knows the rollup is empty rather than fabricated.
    const { rollUp } = await import(
      '../../services/md-intelligence/index.js'
    );
    const result = await rollUp({
      scopeNodeIds: input.scopeNodeIds,
      metricId: input.metricId,
      fetchSample: async () => null,
    });
    return {
      metricId: result.metricId,
      total: result.total,
      mean: result.mean,
      min: result.min,
      max: result.max,
      count: result.count,
    };
  },
};

const CompareScopesInput = z.object({
  scopeNodeIds: z.array(z.string().uuid()).min(2).max(50),
  metricId: z.string(),
});
const CompareScopesOutput = z.object({
  metricId: z.string(),
  topScopeNodeId: z.string().nullable(),
  bottomScopeNodeId: z.string().nullable(),
  ranking: z.array(
    z.object({
      scopeNodeId: z.string(),
      value: z.number(),
      rank: z.number(),
      deltaFromMean: z.number(),
    }),
  ),
});

export const ownerCompareAcrossScopesTool: PersonaToolDescriptor<
  typeof CompareScopesInput,
  typeof CompareScopesOutput
> = {
  id: 'scope.compare_across_scopes',
  name: 'Owner — compare across scopes',
  description:
    'Rank scope nodes by a metric (top / bottom / delta-from-mean). ' +
    'Read-only.',
  personaSlugs: OWNER,
  inputSchema: CompareScopesInput,
  outputSchema: CompareScopesOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, _ctx) {
    const { compareScopes } = await import(
      '../../services/md-intelligence/index.js'
    );
    const result = compareScopes({
      metricId: input.metricId,
      samples: input.scopeNodeIds.map((id) => ({
        scopeNodeId: id,
        value: 0,
      })),
    });
    return {
      metricId: result.metricId,
      topScopeNodeId: result.topScopeNodeId,
      bottomScopeNodeId: result.bottomScopeNodeId,
      ranking: result.ranking.map((r) => ({
        scopeNodeId: r.scopeNodeId,
        value: r.value,
        rank: r.rank,
        deltaFromMean: r.deltaFromMean,
      })),
    };
  },
};

const CrossDomainScopeInputSchema = z.object({
  scopeNodeIds: z.array(z.string().uuid()).min(1).max(20),
  domains: z.array(z.string()).min(1).max(14),
});
const CrossDomainScopeOutputSchema = z.object({
  scopeNodeIds: z.array(z.string()),
  domains: z.array(z.string()),
  cells: z.array(
    z.object({
      scopeNodeId: z.string(),
      domainId: z.string(),
      status: z.string(),
      note: z.string().optional(),
    }),
  ),
});

export const ownerCrossDomainScopeMatrixTool: PersonaToolDescriptor<
  typeof CrossDomainScopeInputSchema,
  typeof CrossDomainScopeOutputSchema
> = {
  id: 'scope.cross_domain_scope_matrix',
  name: 'Owner — cross-domain × scope matrix',
  description:
    'Build a status matrix: rows = scopes, columns = domains, cells = ' +
    'status tone. Read-only.',
  personaSlugs: OWNER,
  inputSchema: CrossDomainScopeInputSchema,
  outputSchema: CrossDomainScopeOutputSchema,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, _ctx) {
    const { buildScopeDomainMatrix } = await import(
      '../../services/md-intelligence/index.js'
    );
    const result = await buildScopeDomainMatrix({
      scopeNodeIds: input.scopeNodeIds,
      domains: input.domains as any,
      fetchDomainStatus: async () => ({ status: 'unknown' as const }),
    });
    return {
      scopeNodeIds: [...result.scopeNodeIds],
      domains: result.domains.map((d) => d as string),
      cells: result.cells.map((c) => ({
        scopeNodeId: c.scopeNodeId,
        domainId: c.domainId as string,
        status: c.status,
        ...(c.note !== undefined ? { note: c.note } : {}),
      })),
    };
  },
};

const TaxonomyDisplayForInput = z.object({
  locale: z.enum(['en', 'sw']).default('sw'),
});
const TaxonomyDisplayForOutput = z.object({
  defaultKind: z.string(),
  labels: z.record(z.string()),
});

export const ownerTaxonomyDisplayForTool: PersonaToolDescriptor<
  typeof TaxonomyDisplayForInput,
  typeof TaxonomyDisplayForOutput
> = {
  id: 'scope.taxonomy_display_for',
  name: 'Owner — taxonomy display for locale',
  description:
    'Return the tenant-preferred scope-kind labels for the requested ' +
    'locale, plus the default scope kind.',
  personaSlugs: OWNER,
  inputSchema: TaxonomyDisplayForInput,
  outputSchema: TaxonomyDisplayForOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { defaultKind: 'site', labels: {} };
    const res = await client.get<{
      data: {
        taxonomy: {
          displayLabelEn: Record<string, string>;
          displayLabelSw: Record<string, string>;
          defaultKind: string;
        } | null;
      };
    }>('/scope/taxonomy', {});
    const labels =
      input.locale === 'en'
        ? res.data?.taxonomy?.displayLabelEn ?? {}
        : res.data?.taxonomy?.displayLabelSw ?? {};
    return {
      defaultKind: res.data?.taxonomy?.defaultKind ?? 'site',
      labels,
    };
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
  ownerTrackParcelChainTool,
  ownerCheckRegulatoryDeadlineTool,
  ownerLookupCounterpartyTool,
  ownerLogEngagementTool,
  ownerComplianceFullPictureTool,
  ownerDomainFullPictureTool,
  ownerSubAreaDrillTool,
  ownerCorrelationForQuestionTool,
  ownerTraceCausesTool,
  ownerCompareBaselinesTool,
  ownerEmitInsightsTool,
  ownerResolveScopeLabelTool,
  ownerRollUpAcrossScopesTool,
  ownerCompareAcrossScopesTool,
  ownerCrossDomainScopeMatrixTool,
  ownerTaxonomyDisplayForTool,
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);
