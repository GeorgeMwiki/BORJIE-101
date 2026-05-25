/**
 * power_tool.handoff — escalate the turn to a higher tier.
 *
 * Used when the agent detects a permission gap mid-turn: e.g. the
 * estate-manager persona is mid-conversation about an eviction notice
 * but lacks the org-admin scope needed to authorise a court filing.
 * Rather than refuse the user outright, the agent emits a `handoff`
 * with the typed contract describing what it tried, why it stopped,
 * and what the receiving tier needs to action.
 *
 * Tier model:
 *   - requiredTier: tenant-resident (any tier can ASK to hand off)
 *   - the handoff TARGET tier is validated against `meetsTier(target,
 *     caller)` — you may only escalate UP, never lateral or down.
 *
 * Approval: none. The handoff itself is reversible (a no-op until the
 * receiving tier picks the conversation up). The downstream action the
 * receiving tier takes may carry its own approval requirement.
 *
 * Audit trail: row in `audit_events` (every handoff is visible to ops
 * but does not need the tamper-resistant sovereign ledger).
 *
 * @module kernel/power-tools/handoff
 */

import { z } from 'zod';
import {
  meetsTier,
  POWER_TOOL_TIERS_ORDERED,
  type PowerTool,
  type PowerToolContext,
  type PowerToolResult,
  type PowerToolTier,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────

const TierEnum = z.enum(POWER_TOOL_TIERS_ORDERED as unknown as readonly [PowerToolTier, ...PowerToolTier[]]);

const HandoffIntentEnum = z.enum([
  'escalate',
  'defer',
  'consult',
  'transfer_ownership',
  'request_review',
]);

export const HandoffSchema = z.object({
  /** The tier we are handing the conversation off TO. */
  targetTier: TierEnum,
  /** What kind of handoff this is (escalation, ask for advice, etc). */
  intent: HandoffIntentEnum,
  /** Plain-language explanation for the receiving tier. >= 16 chars. */
  rationale: z
    .string()
    .min(16, 'rationale must be at least 16 characters')
    .max(2000, 'rationale must be at most 2000 characters'),
  /** Stable conversation id so the next tier picks up the thread. */
  conversationRef: z.string().min(1),
  /** What the next tier is expected to do. */
  expectedAction: z.enum(['decision', 'review', 'authorise', 'advise']),
  /** Optional ISO 8601 deadline — null means "whenever". */
  deadlineIso: z.union([z.string().datetime(), z.null()]).optional(),
});

export type HandoffArgs = z.infer<typeof HandoffSchema>;

export interface HandoffOutput {
  readonly action: 'handoff';
  readonly fromTier: PowerToolTier;
  readonly toTier: PowerToolTier;
  readonly intent: HandoffArgs['intent'];
  readonly conversationRef: string;
  readonly appliesFromTurn: 'next';
  readonly deadlineIso: string | null;
}

// ─────────────────────────────────────────────────────────────────────
// Tool definition
// ─────────────────────────────────────────────────────────────────────

export const handoffPowerTool: PowerTool<HandoffArgs, HandoffOutput> = {
  id: 'handoff',
  name: 'Tier handoff',
  description:
    'Hand off the conversation to a higher tier when the current tier hits a permission gap. The receiving tier inherits the full context on the next turn.',
  requiredTier: 'tenant-resident',
  requiresApproval: false,
  auditDestination: 'audit-events',
  schema: HandoffSchema,
  async execute(
    ctx: PowerToolContext,
    args: HandoffArgs,
  ): Promise<PowerToolResult<HandoffOutput>> {
    // Only escalate UP. Refuse a lateral or downward handoff.
    if (!meetsTier(args.targetTier, ctx.tier)) {
      return {
        kind: 'refused',
        reasonCode: 'OUT_OF_SCOPE',
        message: `handoff target '${args.targetTier}' is not above caller tier '${ctx.tier}'`,
      };
    }
    // Refuse a self-handoff (target === caller).
    if (args.targetTier === ctx.tier) {
      return {
        kind: 'refused',
        reasonCode: 'OUT_OF_SCOPE',
        message: `cannot hand off to your own tier '${ctx.tier}'`,
      };
    }

    return {
      kind: 'ok',
      output: {
        action: 'handoff',
        fromTier: ctx.tier,
        toTier: args.targetTier,
        intent: args.intent,
        conversationRef: args.conversationRef,
        appliesFromTurn: 'next',
        deadlineIso: args.deadlineIso ?? null,
      },
    };
  },
};
