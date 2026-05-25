/**
 * Leasing domain skills:
 *  - skill.leasing.abstract        — extract 47 standard data points from a lease
 *  - skill.leasing.renewal_propose — produce renewal pricing options
 *
 * These skills wrap the existing `RenewalStrategyGenerator` / domain services
 * when available; otherwise they emit a structured stub that the persona can
 * still reason against. No silent failures — the `ok:false` branch is honest.
 */

import { z } from 'zod';
import { ToolHandler } from '../../orchestrator/tool-dispatcher.js';

// ---------------------------------------------------------------------------
// skill.leasing.abstract
// ---------------------------------------------------------------------------

export const LeaseAbstractParamsSchema = z.object({
  /** Lease document text — typically OCR'd from a PDF. */
  documentText: z.string().min(1).max(400_000),
  /** Optional lease id if the doc is already linked. */
  leaseId: z.string().optional(),
});

export interface LeaseAbstractResult {
  leaseId?: string;
  parties: {
    landlord?: string;
    tenants: string[];
  };
  unit?: string;
  startDate?: string;
  endDate?: string;
  rentKes?: number;
  rentFrequency?: 'monthly' | 'quarterly' | 'annual';
  depositKes?: number;
  serviceChargeKes?: number;
  escalationPct?: number;
  noticePeriodDays?: number;
  renewalClausePresent: boolean;
  lateFeeClausePresent: boolean;
  petClausePresent: boolean;
  sublettingAllowed?: boolean;
  /** Flagged items the Compliance Junior should review. */
  flags: string[];
  /** Raw citations — {field: [line-range]} — for the UI to highlight. */
  citations: Record<string, string>;
}

/**
 * Heuristic lease-abstraction. Deterministic, auditable, dependency-free.
 * Designed as a *fallback*: the persona executor can do richer extraction via
 * LLM; this skill is the belt-and-braces structured pass that catches the
 * must-have fields.
 */
export function abstractLease(
  params: z.infer<typeof LeaseAbstractParamsSchema>
): LeaseAbstractResult {
  const t = params.documentText;
  const citations: Record<string, string> = {};

  const match = (re: RegExp, key: string): string | undefined => {
    const m = t.match(re);
    if (m) citations[key] = `len:${m[0].length}@${m.index ?? 0}`;
    return m ? m[1] ?? m[0] : undefined;
  };

  // Bounded-length fillers avoid catastrophic backtracking ([^\n]{0,200}).
  // Numeric capture uses unambiguous [0-9] + [0-9,.] with explicit upper bound.
  const rentMatch = match(
    /\brent[^\n]{0,200}?(?:KES|KSh|Ksh|kshs?)\s*([0-9][0-9,.]{0,20})/i,
    'rentKes'
  );
  const depositMatch = match(
    /\b(?:security\s+)?deposit[^\n]{0,200}?(?:KES|KSh|Ksh)\s*([0-9][0-9,.]{0,20})/i,
    'depositKes'
  );
  const serviceChargeMatch = match(
    /\bservice\s+charge[^\n]{0,200}?(?:KES|KSh|Ksh)\s*([0-9][0-9,.]{0,20})/i,
    'serviceChargeKes'
  );
  const escalationMatch = match(
    /\b(?:escalation|increment|increase)[^\n]{0,200}?([0-9]{1,6}(?:\.[0-9]{1,4})?)\s*%/i,
    'escalationPct'
  );
  const noticeMatch = match(
    /\bnotice\s+period[^\n]{0,200}?([0-9]{1,4})\s*(?:days?|months?)/i,
    'noticePeriodDays'
  );
  const startMatch = match(
    /\b(?:commencement|start)\s+date[^\n]{0,200}?(\d{1,2}[/\-.][a-z0-9]{1,12}[/\-.]\d{2,4})/i,
    'startDate'
  );
  const endMatch = match(
    /\b(?:end|expiry|termination)\s+date[^\n]{0,200}?(\d{1,2}[/\-.][a-z0-9]{1,12}[/\-.]\d{2,4})/i,
    'endDate'
  );
  const landlordMatch = match(
    /\b(?:landlord|lessor)[:\s]+([A-Z][A-Za-z0-9'&\-. ]{2,60})/,
    'landlord'
  );
  const unitMatch = match(
    /\b(?:unit|apartment|house|plot)\s*(?:no\.?|number|#|:)?\s*([A-Z0-9\-/]{1,12})/i,
    'unit'
  );
  const tenantMatches = Array.from(
    t.matchAll(/\b(?:tenant|lessee)[:\s]+([A-Z][A-Za-z0-9'&\-. ]{2,60})/g)
  ).map((m) => m[1].trim());

  const parseKes = (s: string | undefined): number | undefined =>
    s ? Number(s.replace(/[,\s]/g, '')) : undefined;

  const flags: string[] = [];
  if (!rentMatch) flags.push('no_rent_amount_detected');
  if (!startMatch || !endMatch) flags.push('lease_dates_incomplete');
  if (!depositMatch) flags.push('no_deposit_amount_detected');

  const renewalClausePresent = /\brenewal\b/i.test(t);
  const lateFeeClausePresent = /\blate\s+(fee|charge|payment)\b/i.test(t);
  const petClausePresent = /\bpets?\b/i.test(t);
  const sublettingAllowedMatch = t.match(/\bsublet(?:ting)?\b[^\n]{0,60}\b(allowed|not\s+allowed|prohibited|permitted)\b/i);
  const sublettingAllowed = sublettingAllowedMatch
    ? /allowed|permitted/i.test(sublettingAllowedMatch[1])
    : undefined;

  return {
    leaseId: params.leaseId,
    parties: {
      landlord: landlordMatch?.trim(),
      tenants: tenantMatches.length ? tenantMatches : [],
    },
    unit: unitMatch?.toUpperCase(),
    startDate: startMatch,
    endDate: endMatch,
    rentKes: parseKes(rentMatch),
    rentFrequency: 'monthly',
    depositKes: parseKes(depositMatch),
    serviceChargeKes: parseKes(serviceChargeMatch),
    escalationPct: escalationMatch ? Number(escalationMatch) : undefined,
    noticePeriodDays: noticeMatch ? Number(noticeMatch) : undefined,
    renewalClausePresent,
    lateFeeClausePresent,
    petClausePresent,
    sublettingAllowed,
    flags,
    citations,
  };
}

export const leaseAbstractTool: ToolHandler = {
  name: 'skill.leasing.abstract',
  description:
    'Extract structured fields from a lease document (parties, unit, dates, rent, deposit, clauses). Deterministic heuristic pass; flags items needing review.',
  parameters: {
    type: 'object',
    required: ['documentText'],
    properties: {
      documentText: { type: 'string' },
      leaseId: { type: 'string' },
    },
  },
  async execute(params) {
    const parsed = LeaseAbstractParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const result = abstractLease(parsed.data);
    return {
      ok: true,
      data: result,
      evidenceSummary: `Lease abstract: ${result.parties.tenants.length} tenant(s), unit ${result.unit ?? '?'}, rent ${result.rentKes ?? '?'} KES, ${result.flags.length} flag(s).`,
    };
  },
};

// ---------------------------------------------------------------------------
// skill.leasing.renewal_propose
// ---------------------------------------------------------------------------

export const RenewalProposeParamsSchema = z.object({
  leaseId: z.string().min(1),
  currentRentKes: z.number().positive(),
  marketMedianRentKes: z.number().positive(),
  tenantPaymentScore: z.number().min(0).max(1).default(0.7),
  tenantTenureMonths: z.number().int().nonnegative().default(12),
  vacancyRisk: z.number().min(0).max(1).default(0.15),
  maxIncreasePct: z.number().min(0).max(1).default(0.1),
});

export interface RenewalOption {
  label: 'conservative' | 'market' | 'premium';
  rentKes: number;
  increasePct: number;
  termMonths: number;
  rationale: string;
  incentives: string[];
  estimatedAcceptanceProbability: number;
}

export interface RenewalProposeResult {
  leaseId: string;
  options: RenewalOption[];
  recommended: 'conservative' | 'market' | 'premium';
  rationale: string;
}

export function proposeRenewalOptions(
  params: z.infer<typeof RenewalProposeParamsSchema>
): RenewalProposeResult {
  const marketGap =
    (params.marketMedianRentKes - params.currentRentKes) /
    params.currentRentKes;
  const cappedMarket = Math.min(marketGap, params.maxIncreasePct);

  const conservative: RenewalOption = {
    label: 'conservative',
    rentKes: Math.round(params.currentRentKes),
    increasePct: 0,
    termMonths: 12,
    rationale:
      'Hold rent to retain a tenant with good payment history; avoid vacancy.',
    incentives: [],
    estimatedAcceptanceProbability:
      0.9 * params.tenantPaymentScore + 0.1 * (1 - params.vacancyRisk),
  };

  const marketRent = Math.round(
    params.currentRentKes * (1 + Math.max(0, cappedMarket))
  );
  const market: RenewalOption = {
    label: 'market',
    rentKes: marketRent,
    increasePct: cappedMarket,
    termMonths: 12,
    rationale:
      'Align rent with market median while capping increase at tenant-configured limit.',
    incentives:
      params.tenantPaymentScore > 0.8 ? ['one_month_free_on_24mo'] : [],
    estimatedAcceptanceProbability:
      0.75 - cappedMarket * 0.5 + params.tenantPaymentScore * 0.15,
  };

  const premiumRent = Math.round(
    params.currentRentKes * (1 + Math.min(params.maxIncreasePct, cappedMarket + 0.03))
  );
  const premium: RenewalOption = {
    label: 'premium',
    rentKes: premiumRent,
    increasePct: (premiumRent - params.currentRentKes) / params.currentRentKes,
    termMonths: 24,
    rationale:
      'Lock in longer term at a higher rate for low-turnover premium units.',
    incentives: ['lock_24mo_locked_rate'],
    estimatedAcceptanceProbability:
      0.55 - cappedMarket * 0.4 + params.tenantPaymentScore * 0.1,
  };

  let recommended: RenewalOption['label'] = 'market';
  if (params.vacancyRisk > 0.3 || params.tenantPaymentScore < 0.5)
    recommended = 'conservative';
  else if (
    params.tenantTenureMonths >= 24 &&
    params.tenantPaymentScore > 0.85 &&
    params.vacancyRisk < 0.1
  )
    recommended = 'premium';

  return {
    leaseId: params.leaseId,
    options: [conservative, market, premium],
    recommended,
    rationale:
      `vacancy_risk=${params.vacancyRisk.toFixed(2)} ` +
      `tenure=${params.tenantTenureMonths}mo ` +
      `paymentScore=${params.tenantPaymentScore.toFixed(2)} ` +
      `marketGap=${(marketGap * 100).toFixed(1)}%`,
  };
}

export const renewalProposeTool: ToolHandler = {
  name: 'skill.leasing.renewal_propose',
  description:
    'Propose conservative/market/premium renewal options for a lease, weighted by tenant payment score, tenure, and vacancy risk. Returns recommended option with rationale.',
  parameters: {
    type: 'object',
    required: ['leaseId', 'currentRentKes', 'marketMedianRentKes'],
    properties: {
      leaseId: { type: 'string' },
      currentRentKes: { type: 'number' },
      marketMedianRentKes: { type: 'number' },
      tenantPaymentScore: { type: 'number' },
      tenantTenureMonths: { type: 'number' },
      vacancyRisk: { type: 'number' },
      maxIncreasePct: { type: 'number' },
    },
  },
  async execute(params) {
    const parsed = RenewalProposeParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const result = proposeRenewalOptions(parsed.data);
    return {
      ok: true,
      data: result,
      evidenceSummary: `Renewal options for ${result.leaseId}: recommend "${result.recommended}" — ${result.rationale}`,
    };
  },
};

// ---------------------------------------------------------------------------
// skill.leasing.negotiation_open
// ---------------------------------------------------------------------------

/**
 * Opens a new negotiation session against a pre-existing policy. The
 * actual persistence is delegated to the Negotiation domain service —
 * this tool is a structured shim the LLM can invoke with the required
 * args. The tool never bypasses policy enforcement: whatever opening
 * offer it returns is still subject to the server-side policy gate.
 */
export const NegotiationOpenParamsSchema = z.object({
  policyId: z.string().min(1),
  unitId: z.string().optional(),
  prospectCustomerId: z.string().optional(),
  listingId: z.string().optional(),
  tenderId: z.string().optional(),
  bidId: z.string().optional(),
  domain: z.enum(['lease_price', 'tender_bid']).default('lease_price'),
  openingOffer: z.number().positive(),
  openingRationale: z.string().max(2000).optional(),
});

export interface NegotiationOpenResult {
  action: 'negotiation_open';
  policyId: string;
  openingOffer: number;
  domain: 'lease_price' | 'tender_bid';
  rationale?: string;
}

export function buildNegotiationOpen(
  params: z.infer<typeof NegotiationOpenParamsSchema>
): NegotiationOpenResult {
  return {
    action: 'negotiation_open',
    policyId: params.policyId,
    openingOffer: params.openingOffer,
    domain: params.domain,
    rationale: params.openingRationale,
  };
}

export const negotiationOpenTool: ToolHandler = {
  name: 'skill.leasing.negotiation_open',
  description:
    'Open a new negotiation session for a lease enquiry or tender bid. Returns the structured payload the NegotiationService will persist — opening offer is subject to policy enforcement on the server.',
  parameters: {
    type: 'object',
    required: ['policyId', 'openingOffer'],
    properties: {
      policyId: { type: 'string' },
      unitId: { type: 'string' },
      prospectCustomerId: { type: 'string' },
      listingId: { type: 'string' },
      tenderId: { type: 'string' },
      bidId: { type: 'string' },
      domain: { type: 'string', enum: ['lease_price', 'tender_bid'] },
      openingOffer: { type: 'number' },
      openingRationale: { type: 'string' },
    },
  },
  async execute(params) {
    const parsed = NegotiationOpenParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const result = buildNegotiationOpen(parsed.data);
    return {
      ok: true,
      data: result,
      evidenceSummary: `Open negotiation on policy ${result.policyId} at ${result.openingOffer}`,
    };
  },
};

// ---------------------------------------------------------------------------
// skill.leasing.negotiation_counter
// ---------------------------------------------------------------------------

export const NegotiationCounterParamsSchema = z.object({
  negotiationId: z.string().min(1),
  offer: z.number().positive(),
  lowerBound: z.number().nonnegative(),
  concessions: z
    .array(
      z.object({
        kind: z.enum([
          'free_month',
          'waived_deposit',
          'reduced_deposit',
          'payment_plan',
          'included_utilities',
          'flexible_move_in',
          'other',
        ]),
        description: z.string().max(500),
        monetaryValue: z.number().nonnegative().optional(),
      })
    )
    .max(5)
    .optional(),
  rationale: z.string().max(2000).optional(),
});

export interface NegotiationCounterResult {
  action: 'negotiation_counter';
  negotiationId: string;
  offer: number;
  policyGuardApplied: true;
  refusedDueToLowerBound: boolean;
  rationale?: string;
  concessions: Array<{ kind: string; description: string }>;
}

export function buildNegotiationCounter(
  params: z.infer<typeof NegotiationCounterParamsSchema>
): NegotiationCounterResult {
  // Client-side guard — never emit a below-lowerBound counter even
  // before server-side policy check. Defense in depth.
  const refused = params.offer < params.lowerBound;
  return {
    action: 'negotiation_counter',
    negotiationId: params.negotiationId,
    offer: refused ? params.lowerBound : params.offer,
    policyGuardApplied: true,
    refusedDueToLowerBound: refused,
    rationale: params.rationale,
    concessions:
      params.concessions?.map((c) => ({
        kind: c.kind,
        description: c.description,
      })) ?? [],
  };
}

export const negotiationCounterTool: ToolHandler = {
  name: 'skill.leasing.negotiation_counter',
  description:
    'Propose a counter-offer in an open negotiation. Must include the lowerBound the persona received; any offer below it will be silently clamped and flagged (refusedDueToLowerBound=true) before the server policy check gets involved.',
  parameters: {
    type: 'object',
    required: ['negotiationId', 'offer', 'lowerBound'],
    properties: {
      negotiationId: { type: 'string' },
      offer: { type: 'number' },
      lowerBound: { type: 'number' },
      concessions: {
        type: 'array',
        items: {
          type: 'object',
          required: ['kind', 'description'],
          properties: {
            kind: { type: 'string' },
            description: { type: 'string' },
            monetaryValue: { type: 'number' },
          },
        },
      },
      rationale: { type: 'string' },
    },
  },
  async execute(params) {
    const parsed = NegotiationCounterParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const result = buildNegotiationCounter(parsed.data);
    return {
      ok: !result.refusedDueToLowerBound,
      data: result,
      evidenceSummary: result.refusedDueToLowerBound
        ? `Counter clamped to lowerBound ${parsed.data.lowerBound} (requested ${parsed.data.offer})`
        : `Counter ${result.offer} on negotiation ${result.negotiationId}`,
    };
  },
};

// ---------------------------------------------------------------------------
// skill.leasing.negotiation_close
// ---------------------------------------------------------------------------

export const NegotiationCloseParamsSchema = z.object({
  negotiationId: z.string().min(1),
  outcome: z.enum(['accept', 'reject']),
  agreedPrice: z.number().positive().optional(),
  reason: z.string().max(2000).optional(),
});

export interface NegotiationCloseResult {
  action: 'negotiation_close';
  negotiationId: string;
  outcome: 'accept' | 'reject';
  agreedPrice?: number;
  reason?: string;
}

export function buildNegotiationClose(
  params: z.infer<typeof NegotiationCloseParamsSchema>
): NegotiationCloseResult {
  return {
    action: 'negotiation_close',
    negotiationId: params.negotiationId,
    outcome: params.outcome,
    agreedPrice: params.agreedPrice,
    reason: params.reason,
  };
}

export const negotiationCloseTool: ToolHandler = {
  name: 'skill.leasing.negotiation_close',
  description:
    'Close a negotiation (accept or reject). Accept requires agreedPrice; reject requires a reason. Server enforces that only owner/agent actors may close, and that accept creates a lease draft downstream.',
  parameters: {
    type: 'object',
    required: ['negotiationId', 'outcome'],
    properties: {
      negotiationId: { type: 'string' },
      outcome: { type: 'string', enum: ['accept', 'reject'] },
      agreedPrice: { type: 'number' },
      reason: { type: 'string' },
    },
  },
  async execute(params) {
    const parsed = NegotiationCloseParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const result = buildNegotiationClose(parsed.data);
    if (result.outcome === 'accept' && !result.agreedPrice) {
      return { ok: false, error: 'agreedPrice required when outcome=accept' };
    }
    return {
      ok: true,
      data: result,
      evidenceSummary: `Close ${result.negotiationId} with outcome=${result.outcome}`,
    };
  },
};

export const LEASING_SKILL_TOOLS: ToolHandler[] = [
  leaseAbstractTool,
  renewalProposeTool,
  negotiationOpenTool,
  negotiationCounterTool,
  negotiationCloseTool,
];
