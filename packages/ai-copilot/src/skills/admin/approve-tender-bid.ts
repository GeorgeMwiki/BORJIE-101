/**
 * skill.admin.approve_tender_bid — approve a winning bid after scoring.
 *
 * High-value bids (> KES 500k) flip to PROPOSED so the user confirms.
 * Also defensive: refuses to approve a bid not in the tender's scored list.
 */

import { z } from 'zod';
import type { ToolHandler } from '../../orchestrator/tool-dispatcher.js';
import {
  HIGH_RISK_THRESHOLDS,
  assertSameTenant,
  committed,
  failed,
  proposed,
  safeParse,
} from './shared.js';

export const ApproveTenderBidSchema = z.object({
  tenantId: z.string().min(1).optional(),
  tenderId: z.string().min(1),
  bidId: z.string().min(1),
  vendorId: z.string().min(1),
  priceTotalKes: z.number().positive(),
  /** Ids of all bids that were scored — bidId must be present for safety. */
  scoredBidIds: z.array(z.string()).min(1),
  rationale: z.string().max(2_000).optional(),
  force: z.boolean().default(false),
});
export type ApproveTenderBidParams = z.infer<typeof ApproveTenderBidSchema>;

export interface ApproveTenderBidResult {
  readonly tenderId: string;
  readonly bidId: string;
  readonly vendorId: string;
  readonly priceTotalKes: number;
  readonly approvedAt: string;
}

export const approveTenderBidTool: ToolHandler = {
  name: 'skill.admin.approve_tender_bid',
  description:
    'Approve a winning tender bid after scoring. If the bid total exceeds the high-value threshold, returns a PROPOSED action for explicit user confirmation. Refuses any bid not in the scored set.',
  parameters: {
    type: 'object',
    required: ['tenderId', 'bidId', 'vendorId', 'priceTotalKes', 'scoredBidIds'],
    properties: {
      tenantId: { type: 'string' },
      tenderId: { type: 'string' },
      bidId: { type: 'string' },
      vendorId: { type: 'string' },
      priceTotalKes: { type: 'number' },
      scoredBidIds: { type: 'array', items: { type: 'string' } },
      rationale: { type: 'string' },
      force: { type: 'boolean' },
    },
  },
  async execute(params, context) {
    const parsed = safeParse(ApproveTenderBidSchema, params);
    if (!parsed.ok) return failed(parsed.error);

    const iso = assertSameTenant(context, parsed.data.tenantId);
    if (iso) return failed(iso);

    if (!parsed.data.scoredBidIds.includes(parsed.data.bidId)) {
      return failed(`bid_not_scored:${parsed.data.bidId}`);
    }

    const result: ApproveTenderBidResult = {
      tenderId: parsed.data.tenderId,
      bidId: parsed.data.bidId,
      vendorId: parsed.data.vendorId,
      priceTotalKes: parsed.data.priceTotalKes,
      approvedAt: new Date().toISOString(),
    };

    const highValue = result.priceTotalKes >= HIGH_RISK_THRESHOLDS.tenderBidKes;
    if (!parsed.data.force && highValue) {
      return proposed(
        result,
        `Approve bid ${result.bidId} @ KES ${result.priceTotalKes.toLocaleString()} (above KES ${HIGH_RISK_THRESHOLDS.tenderBidKes.toLocaleString()} high-value cap)`
      );
    }
    return committed(
      result,
      `Bid ${result.bidId} approved (tender ${result.tenderId}, KES ${result.priceTotalKes.toLocaleString()})`
    );
  },
};
