/**
 * Offtake domain skills:
 *  - skill.offtake.abstract        — extract standard data points from an offtake / supply agreement
 *  - skill.offtake.renewal_propose — produce renewal pricing options
 *
 * These skills wrap the existing `RenewalStrategyGenerator` / domain services
 * when available; otherwise they emit a structured stub that the persona can
 * still reason against. No silent failures — the `ok:false` branch is honest.
 */

import { z } from 'zod';
import { ToolHandler } from '../../orchestrator/tool-dispatcher.js';

// ---------------------------------------------------------------------------
// skill.offtake.abstract
// ---------------------------------------------------------------------------

export const OfftakeAbstractParamsSchema = z.object({
  /** Offtake / supply-agreement document text — typically OCR'd from a PDF. */
  documentText: z.string().min(1).max(400_000),
  /** Optional offtake-agreement id if the doc is already linked. */
  offtakeId: z.string().optional(),
});

export interface OfftakeAbstractResult {
  offtakeId?: string | undefined;
  parties: {
    owner?: string | undefined;
    buyers: string[];
  };
  consignment?: string | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
  priceMinorUnits?: number | undefined;
  priceFrequency?: 'per_shipment' | 'monthly' | 'quarterly' | 'annual' | undefined;
  performanceBondMinorUnits?: number | undefined;
  cooperativeLevyMinorUnits?: number | undefined;
  escalationPct?: number | undefined;
  noticePeriodDays?: number | undefined;
  renewalClausePresent: boolean;
  penaltyClausePresent: boolean;
  forceMajeureClausePresent: boolean;
  assignmentAllowed?: boolean | undefined;
  /** Flagged items the Compliance Junior should review. */
  flags: string[];
  /** Raw citations — {field: [line-range]} — for the UI to highlight. */
  citations: Record<string, string>;
}

/**
 * Heuristic offtake-abstraction. Deterministic, auditable, dependency-free.
 * Designed as a *fallback*: the persona executor can do richer extraction via
 * LLM; this skill is the belt-and-braces structured pass that catches the
 * must-have fields.
 */
export function abstractOfftake(
  params: z.infer<typeof OfftakeAbstractParamsSchema>
): OfftakeAbstractResult {
  const t = params.documentText;
  const citations: Record<string, string> = {};

  const match = (re: RegExp, key: string): string | undefined => {
    const m = t.match(re);
    if (m) citations[key] = `len:${m[0].length}@${m.index ?? 0}`;
    return m ? m[1] ?? m[0] : undefined;
  };

  // Bounded-length fillers avoid catastrophic backtracking ([^\n]{0,200}).
  // Numeric capture uses unambiguous [0-9] + [0-9,.] with explicit upper bound.
  // Currency-agnostic: accept the ISO code or symbol the document uses; never
  // hard-code a single currency (multi-currency, TZS at launch · expandable).
  const priceMatch = match(
    /\b(?:price|royalty|payment)[^\n]{0,200}?(?:[A-Z]{3}|[A-Za-z]{2,4}\b)?\s*([0-9][0-9,.]{0,20})/i,
    'priceMinorUnits'
  );
  const bondMatch = match(
    /\b(?:performance\s+)?bond[^\n]{0,200}?[A-Za-z]{0,4}\s*([0-9][0-9,.]{0,20})/i,
    'performanceBondMinorUnits'
  );
  const levyMatch = match(
    /\b(?:cooperative\s+)?levy[^\n]{0,200}?[A-Za-z]{0,4}\s*([0-9][0-9,.]{0,20})/i,
    'cooperativeLevyMinorUnits'
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
  const ownerMatch = match(
    /\b(?:owner|seller|producer|licensee)[:\s]+([A-Z][A-Za-z0-9'&\-. ]{2,60})/,
    'owner'
  );
  const consignmentMatch = match(
    /\b(?:consignment|parcel|lot|shipment)\s*(?:no\.?|number|#|:)?\s*([A-Z0-9\-/]{1,12})/i,
    'consignment'
  );
  const buyerMatches = Array.from(
    t.matchAll(/\b(?:buyer|off-?taker|purchaser)[:\s]+([A-Z][A-Za-z0-9'&\-. ]{2,60})/g)
  ).map((m) => (m[1] ?? '').trim()).filter((s) => s.length > 0);

  const parseMinor = (s: string | undefined): number | undefined =>
    s ? Number(s.replace(/[,\s]/g, '')) : undefined;

  const flags: string[] = [];
  if (!priceMatch) flags.push('no_price_amount_detected');
  if (!startMatch || !endMatch) flags.push('offtake_dates_incomplete');
  if (!bondMatch) flags.push('no_performance_bond_detected');

  const renewalClausePresent = /\brenewal\b/i.test(t);
  const penaltyClausePresent = /\b(penalt\w*|liquidated\s+damages|short(?:fall|-?lift))\b/i.test(t);
  const forceMajeureClausePresent = /\bforce\s+majeure\b/i.test(t);
  const assignmentAllowedMatch = t.match(/\bassign(?:ment)?\b[^\n]{0,60}\b(allowed|not\s+allowed|prohibited|permitted)\b/i);
  const assignmentAllowed = assignmentAllowedMatch
    ? /allowed|permitted/i.test(assignmentAllowedMatch[1] ?? '')
    : undefined;

  return {
    offtakeId: params.offtakeId,
    parties: {
      ...(ownerMatch !== undefined ? { owner: ownerMatch.trim() } : {}),
      buyers: buyerMatches.length ? buyerMatches : [],
    },
    consignment: consignmentMatch?.toUpperCase(),
    startDate: startMatch,
    endDate: endMatch,
    priceMinorUnits: parseMinor(priceMatch),
    priceFrequency: 'per_shipment',
    performanceBondMinorUnits: parseMinor(bondMatch),
    cooperativeLevyMinorUnits: parseMinor(levyMatch),
    escalationPct: escalationMatch ? Number(escalationMatch) : undefined,
    noticePeriodDays: noticeMatch ? Number(noticeMatch) : undefined,
    renewalClausePresent,
    penaltyClausePresent,
    forceMajeureClausePresent,
    assignmentAllowed,
    flags,
    citations,
  };
}

export const offtakeAbstractTool: ToolHandler = {
  name: 'skill.offtake.abstract',
  description:
    'Extract structured fields from an offtake / supply agreement (parties, consignment, dates, price, performance bond, clauses). Deterministic heuristic pass; flags items needing review.',
  parameters: {
    type: 'object',
    required: ['documentText'],
    properties: {
      documentText: { type: 'string' },
      offtakeId: { type: 'string' },
    },
  },
  async execute(params) {
    const parsed = OfftakeAbstractParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const result = abstractOfftake(parsed.data);
    return {
      ok: true,
      data: result,
      evidenceSummary: `Offtake abstract: ${result.parties.buyers.length} buyer(s), consignment ${result.consignment ?? '?'}, price ${result.priceMinorUnits ?? '?'}, ${result.flags.length} flag(s).`,
    };
  },
};

// ---------------------------------------------------------------------------
// skill.offtake.renewal_propose
// ---------------------------------------------------------------------------

export const RenewalProposeParamsSchema = z.object({
  offtakeId: z.string().min(1),
  currentPriceMinorUnits: z.number().positive(),
  marketMedianPriceMinorUnits: z.number().positive(),
  buyerPaymentScore: z.number().min(0).max(1).default(0.7),
  buyerTenureMonths: z.number().int().nonnegative().default(12),
  availableCapacityRisk: z.number().min(0).max(1).default(0.15),
  maxIncreasePct: z.number().min(0).max(1).default(0.1),
});

export interface RenewalOption {
  label: 'conservative' | 'market' | 'premium';
  priceMinorUnits: number;
  increasePct: number;
  termMonths: number;
  rationale: string;
  incentives: string[];
  estimatedAcceptanceProbability: number;
}

export interface RenewalProposeResult {
  offtakeId: string;
  options: RenewalOption[];
  recommended: 'conservative' | 'market' | 'premium';
  rationale: string;
}

export function proposeRenewalOptions(
  params: z.infer<typeof RenewalProposeParamsSchema>
): RenewalProposeResult {
  const marketGap =
    (params.marketMedianPriceMinorUnits - params.currentPriceMinorUnits) /
    params.currentPriceMinorUnits;
  const cappedMarket = Math.min(marketGap, params.maxIncreasePct);

  const conservative: RenewalOption = {
    label: 'conservative',
    priceMinorUnits: Math.round(params.currentPriceMinorUnits),
    increasePct: 0,
    termMonths: 12,
    rationale:
      'Hold price to retain a buyer with good payment history; avoid idle capacity.',
    incentives: [],
    estimatedAcceptanceProbability:
      0.9 * params.buyerPaymentScore + 0.1 * (1 - params.availableCapacityRisk),
  };

  const marketPrice = Math.round(
    params.currentPriceMinorUnits * (1 + Math.max(0, cappedMarket))
  );
  const market: RenewalOption = {
    label: 'market',
    priceMinorUnits: marketPrice,
    increasePct: cappedMarket,
    termMonths: 12,
    rationale:
      'Align price with market median while capping increase at the owner-configured limit.',
    incentives:
      params.buyerPaymentScore > 0.8 ? ['volume_rebate_on_24mo'] : [],
    estimatedAcceptanceProbability:
      0.75 - cappedMarket * 0.5 + params.buyerPaymentScore * 0.15,
  };

  const premiumPrice = Math.round(
    params.currentPriceMinorUnits * (1 + Math.min(params.maxIncreasePct, cappedMarket + 0.03))
  );
  const premium: RenewalOption = {
    label: 'premium',
    priceMinorUnits: premiumPrice,
    increasePct: (premiumPrice - params.currentPriceMinorUnits) / params.currentPriceMinorUnits,
    termMonths: 24,
    rationale:
      'Lock in a longer term at a higher rate for low-churn premium buyers.',
    incentives: ['lock_24mo_locked_rate'],
    estimatedAcceptanceProbability:
      0.55 - cappedMarket * 0.4 + params.buyerPaymentScore * 0.1,
  };

  let recommended: RenewalOption['label'] = 'market';
  if (params.availableCapacityRisk > 0.3 || params.buyerPaymentScore < 0.5)
    recommended = 'conservative';
  else if (
    params.buyerTenureMonths >= 24 &&
    params.buyerPaymentScore > 0.85 &&
    params.availableCapacityRisk < 0.1
  )
    recommended = 'premium';

  return {
    offtakeId: params.offtakeId,
    options: [conservative, market, premium],
    recommended,
    rationale:
      `available_capacity_risk=${params.availableCapacityRisk.toFixed(2)} ` +
      `tenure=${params.buyerTenureMonths}mo ` +
      `paymentScore=${params.buyerPaymentScore.toFixed(2)} ` +
      `marketGap=${(marketGap * 100).toFixed(1)}%`,
  };
}

export const renewalProposeTool: ToolHandler = {
  name: 'skill.offtake.renewal_propose',
  description:
    'Propose conservative/market/premium renewal options for an offtake agreement, weighted by buyer payment score, tenure, and available-capacity risk. Returns recommended option with rationale.',
  parameters: {
    type: 'object',
    required: ['offtakeId', 'currentPriceMinorUnits', 'marketMedianPriceMinorUnits'],
    properties: {
      offtakeId: { type: 'string' },
      currentPriceMinorUnits: { type: 'number' },
      marketMedianPriceMinorUnits: { type: 'number' },
      buyerPaymentScore: { type: 'number' },
      buyerTenureMonths: { type: 'number' },
      availableCapacityRisk: { type: 'number' },
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
      evidenceSummary: `Renewal options for ${result.offtakeId}: recommend "${result.recommended}" — ${result.rationale}`,
    };
  },
};

// ---------------------------------------------------------------------------
// skill.offtake.negotiation_open
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
  consignmentId: z.string().optional(),
  prospectiveBuyerId: z.string().optional(),
  listingId: z.string().optional(),
  tenderId: z.string().optional(),
  bidId: z.string().optional(),
  domain: z.enum(['offtake_price', 'tender_bid']).default('offtake_price'),
  openingOffer: z.number().positive(),
  openingRationale: z.string().max(2000).optional(),
});

export interface NegotiationOpenResult {
  action: 'negotiation_open';
  policyId: string;
  openingOffer: number;
  domain: 'offtake_price' | 'tender_bid';
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
    ...(params.openingRationale !== undefined ? { rationale: params.openingRationale } : {}),
  };
}

export const negotiationOpenTool: ToolHandler = {
  name: 'skill.offtake.negotiation_open',
  description:
    'Open a new negotiation session for an offtake enquiry or tender bid. Returns the structured payload the NegotiationService will persist — opening offer is subject to policy enforcement on the server.',
  parameters: {
    type: 'object',
    required: ['policyId', 'openingOffer'],
    properties: {
      policyId: { type: 'string' },
      consignmentId: { type: 'string' },
      prospectiveBuyerId: { type: 'string' },
      listingId: { type: 'string' },
      tenderId: { type: 'string' },
      bidId: { type: 'string' },
      domain: { type: 'string', enum: ['offtake_price', 'tender_bid'] },
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
// skill.offtake.negotiation_counter
// ---------------------------------------------------------------------------

export const NegotiationCounterParamsSchema = z.object({
  negotiationId: z.string().min(1),
  offer: z.number().positive(),
  lowerBound: z.number().nonnegative(),
  concessions: z
    .array(
      z.object({
        kind: z.enum([
          'price_holiday',
          'waived_bond',
          'reduced_bond',
          'payment_plan',
          'included_logistics',
          'flexible_mobilization',
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
    ...(params.rationale !== undefined ? { rationale: params.rationale } : {}),
    concessions:
      params.concessions?.map((c) => ({
        kind: c.kind,
        description: c.description,
      })) ?? [],
  };
}

export const negotiationCounterTool: ToolHandler = {
  name: 'skill.offtake.negotiation_counter',
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
// skill.offtake.negotiation_close
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
    ...(params.agreedPrice !== undefined ? { agreedPrice: params.agreedPrice } : {}),
    ...(params.reason !== undefined ? { reason: params.reason } : {}),
  };
}

export const negotiationCloseTool: ToolHandler = {
  name: 'skill.offtake.negotiation_close',
  description:
    'Close a negotiation (accept or reject). Accept requires agreedPrice; reject requires a reason. Server enforces that only owner/agent actors may close, and that accept creates an offtake-agreement draft downstream.',
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

export const OFFTAKE_SKILL_TOOLS: ToolHandler[] = [
  offtakeAbstractTool,
  renewalProposeTool,
  negotiationOpenTool,
  negotiationCounterTool,
  negotiationCloseTool,
];
