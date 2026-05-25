/**
 * skill.estate.tender_bid_scoring — score incoming tender bids.
 *
 * Weighted-score across 5 dimensions: price, past-performance,
 * compliance readiness, timeline, references. Returns a ranked list.
 */

import { z } from 'zod';
import { ToolHandler } from '../../orchestrator/tool-dispatcher.js';

export const BidSchema = z.object({
  bidId: z.string().min(1),
  vendorId: z.string().min(1),
  vendorName: z.string().min(1),
  priceTotal: z.number().positive(),
  timelineDays: z.number().int().positive(),
  pastPerformanceScore: z.number().min(0).max(1).default(0.6),
  complianceDocsComplete: z.boolean().default(false),
  referenceCount: z.number().int().nonnegative().default(0),
});
export type Bid = z.infer<typeof BidSchema>;

export const TenderScoringParamsSchema = z.object({
  tenderId: z.string().min(1),
  bids: z.array(BidSchema).min(1).max(50),
  priceWeight: z.number().min(0).max(1).default(0.4),
  performanceWeight: z.number().min(0).max(1).default(0.25),
  complianceWeight: z.number().min(0).max(1).default(0.15),
  timelineWeight: z.number().min(0).max(1).default(0.1),
  referenceWeight: z.number().min(0).max(1).default(0.1),
});
export type TenderScoringParams = z.infer<typeof TenderScoringParamsSchema>;

export interface ScoredBid {
  readonly bidId: string;
  readonly vendorId: string;
  readonly vendorName: string;
  readonly score: number;
  readonly breakdown: {
    readonly price: number;
    readonly performance: number;
    readonly compliance: number;
    readonly timeline: number;
    readonly references: number;
  };
  readonly flagged: readonly string[];
}

export function scoreTenderBids(params: TenderScoringParams): {
  readonly tenderId: string;
  readonly ranking: readonly ScoredBid[];
  readonly winnerBidId: string;
} {
  const parsed = TenderScoringParamsSchema.parse(params);
  const maxPrice = Math.max(...parsed.bids.map((b) => b.priceTotal));
  const minPrice = Math.min(...parsed.bids.map((b) => b.priceTotal));
  const maxTimeline = Math.max(...parsed.bids.map((b) => b.timelineDays));
  const maxReferences = Math.max(...parsed.bids.map((b) => b.referenceCount), 1);

  const scored: ScoredBid[] = parsed.bids.map((bid) => {
    // Lower price = higher price score.
    const priceScore = maxPrice === minPrice ? 1 : 1 - (bid.priceTotal - minPrice) / (maxPrice - minPrice);
    const performanceScore = bid.pastPerformanceScore;
    const complianceScore = bid.complianceDocsComplete ? 1 : 0.3;
    const timelineScore = maxTimeline === 0 ? 1 : 1 - bid.timelineDays / maxTimeline;
    const referenceScore = Math.min(1, bid.referenceCount / maxReferences);

    const composite =
      priceScore * parsed.priceWeight +
      performanceScore * parsed.performanceWeight +
      complianceScore * parsed.complianceWeight +
      timelineScore * parsed.timelineWeight +
      referenceScore * parsed.referenceWeight;

    const flagged: string[] = [];
    if (!bid.complianceDocsComplete) flagged.push('compliance_docs_incomplete');
    if (bid.pastPerformanceScore < 0.4) flagged.push('low_past_performance');
    if (bid.priceTotal === minPrice && bid.pastPerformanceScore < 0.5)
      flagged.push('low_price_unproven_vendor');

    return {
      bidId: bid.bidId,
      vendorId: bid.vendorId,
      vendorName: bid.vendorName,
      score: Math.round(composite * 1000) / 1000,
      breakdown: {
        price: Math.round(priceScore * 1000) / 1000,
        performance: Math.round(performanceScore * 1000) / 1000,
        compliance: Math.round(complianceScore * 1000) / 1000,
        timeline: Math.round(timelineScore * 1000) / 1000,
        references: Math.round(referenceScore * 1000) / 1000,
      },
      flagged,
    };
  });

  const ranking = [...scored].sort((a, b) => b.score - a.score);
  return {
    tenderId: parsed.tenderId,
    ranking,
    winnerBidId: ranking[0].bidId,
  };
}

export const tenderBidScoringTool: ToolHandler = {
  name: 'skill.estate.tender_bid_scoring',
  description:
    'Rank tender bids across price, past performance, compliance, timeline, references. Returns the winner and the full breakdown.',
  parameters: {
    type: 'object',
    required: ['tenderId', 'bids'],
    properties: {
      tenderId: { type: 'string' },
      bids: { type: 'array', items: { type: 'object' } },
      priceWeight: { type: 'number' },
      performanceWeight: { type: 'number' },
      complianceWeight: { type: 'number' },
      timelineWeight: { type: 'number' },
      referenceWeight: { type: 'number' },
    },
  },
  async execute(params) {
    const parsed = TenderScoringParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const result = scoreTenderBids(parsed.data);
    return {
      ok: true,
      data: result,
      evidenceSummary: `Scored ${result.ranking.length} bid(s) on tender ${result.tenderId}; winner ${result.winnerBidId}`,
    };
  },
};
