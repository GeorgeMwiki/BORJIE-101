/**
 * owner.next_actions — proactive proposal of the highest-ROI next
 * actions for the owner today. Each suggestion includes a one-line
 * rationale and a deterministic "do this" link the AdaptiveRenderer
 * can drop into an action-bar primitive.
 *
 * Risk tier: read.
 *
 * The brain calls this tool whenever the owner asks "what should I
 * focus on today?" or when the morning briefing fires. The proposal
 * service is responsible for ranking; this tool only validates +
 * narrows the surface to a tenant the caller actually owns.
 */

import { z } from 'zod';
import type {
  HqToolContext,
  HqToolExecutionResult,
} from '../../risk-tier.js';
import { ownerCanReachTenant, ownerRefusal, withOwnerTelemetry } from './shared.js';
import type { OwnerToolSpec } from './types.js';

export const NextActionsInputSchema = z.object({
  tenantId: z.string().min(1).max(64),
  topN: z.number().int().min(1).max(20).optional(),
});

export const NextActionUrgencySchema = z.enum(['critical', 'high', 'medium', 'low']);

/**
 * ISO-4217 currency code — any 3 upper-case letters. The proposer
 * service resolves the per-row currency from the action's underlying
 * payload; we accept any well-formed code at this boundary so a new
 * compliance plugin doesn't have to touch the owner-tool contract.
 */
const CurrencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'ISO-4217 currency code (3 upper-case letters)');

export const NextActionRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  rationale: z.string(),
  urgency: NextActionUrgencySchema,
  href: z.string().min(1),
  /** ISO-8601 expected payoff/due timestamp (purely informational). */
  expectedAt: z.string().nullable(),
  estimatedImpactMinorUnits: z.number().int().nullable(),
  currency: CurrencyCodeSchema.nullable(),
});

export const NextActionsOutputSchema = z.object({
  rows: z.array(NextActionRowSchema),
  generatedAt: z.string(),
});

export type NextActionsInput = z.infer<typeof NextActionsInputSchema>;
export type NextActionsOutput = z.infer<typeof NextActionsOutputSchema>;
export type NextActionRow = z.infer<typeof NextActionRowSchema>;
export type NextActionUrgency = z.infer<typeof NextActionUrgencySchema>;

export interface NextActionsServicePort {
  proposeNextActions(args: {
    readonly tenantId: string;
    readonly topN: number;
  }): Promise<NextActionsOutput>;
}

export interface NextActionsDeps {
  readonly proposer: NextActionsServicePort;
}

const REQUIRED_SCOPES: ReadonlyArray<string> = ['owner:proposals:read'];

export function createNextActionsTool(
  deps: NextActionsDeps,
): OwnerToolSpec<NextActionsInput, NextActionsOutput> {
  return {
    name: 'owner.next_actions',
    riskTier: 'read',
    description:
      'Ranked list of the highest-ROI next actions for the caller-owned tenant today. Each row carries title, rationale, urgency, deep-link href, and (optional) estimated payoff. Brain calls this on briefing or when owner asks "what next?".',
    inputSchema: NextActionsInputSchema,
    outputSchema: NextActionsOutputSchema,
    requiredScopes: REQUIRED_SCOPES,
    approvalRequired: false,
    async execute(
      input: NextActionsInput,
      ctx: HqToolContext,
    ): Promise<HqToolExecutionResult<NextActionsOutput>> {
      return withOwnerTelemetry({
        toolName: 'owner.next_actions',
        riskTier: 'read',
        tenantId: input.tenantId,
        ctx,
        input,
        body: async () => {
          if (!ownerCanReachTenant(ctx.caller.scopes, input.tenantId)) {
            return ownerRefusal(
              'OUT_OF_SCOPE',
              `caller cannot read next-actions for tenant ${input.tenantId}`,
            );
          }
          const raw = await deps.proposer.proposeNextActions({
            tenantId: input.tenantId,
            topN: input.topN ?? 5,
          });
          return { kind: 'ok', output: raw };
        },
      });
    },
  };
}
