/**
 * platform.send_announcement — push a banner / email to one tenant or
 * the whole platform.
 *
 * Risk tier: external-comm. Requires four-eye approval. Sovereign-
 * ledger persisted.
 *
 * Rollback semantics: external-comm calls are NOT pure-rollback (you
 * cannot un-send an email). The tool exposes a `recall` action that
 * sends a follow-up "retraction" — surfaced through the same port. The
 * registry treats this as the rollback for ledger-replay purposes.
 */

import { z } from 'zod';
import {
  type HqToolContext,
  type HqToolExecutionResult,
  type HqToolSpec,
  callerCanReachTenant,
  callerHasAllScopes,
} from '../../risk-tier.js';
import { refusal, withHqTelemetry } from './shared.js';

const AnnouncementScopeSchema = z.union([
  z.literal('global'),
  z.string().regex(/^tenant:[A-Za-z0-9_-]{1,64}$/),
]);

export const AnnouncementChannelSchema = z.enum(['banner', 'email', 'both']);

export const SendAnnouncementInputSchema = z.object({
  scope: AnnouncementScopeSchema,
  channel: AnnouncementChannelSchema,
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(4_000),
  scheduleAt: z.string().datetime({ offset: true }).optional(),
});

export const SendAnnouncementOutputSchema = z.object({
  announcementId: z.string(),
  scope: AnnouncementScopeSchema,
  channel: AnnouncementChannelSchema,
  subject: z.string(),
  recipientCount: z.number().int().nonnegative(),
  scheduledFor: z.string(),
  status: z.enum(['queued', 'sending', 'sent']),
});

export type SendAnnouncementInput = z.infer<typeof SendAnnouncementInputSchema>;
export type SendAnnouncementOutput = z.infer<typeof SendAnnouncementOutputSchema>;

export interface AnnouncementPort {
  send(args: {
    readonly scope: 'global' | `tenant:${string}`;
    readonly channel: z.infer<typeof AnnouncementChannelSchema>;
    readonly subject: string;
    readonly body: string;
    readonly scheduleAt: string | null;
  }): Promise<SendAnnouncementOutput>;
  recall(args: {
    readonly announcementId: string;
    readonly reason: string;
  }): Promise<void>;
}

export interface SendAnnouncementDeps {
  readonly announcements: AnnouncementPort;
  /** Hard ceiling for the recipient broadcast. */
  readonly maxRecipientCount: number;
}

const REQUIRED_SCOPES: ReadonlyArray<string> = [
  'platform:comms:write',
  'platform:ops:write',
];

function parseTenantFromScope(scope: string): string | null {
  if (scope === 'global') return null;
  return scope.slice('tenant:'.length);
}

export function createSendAnnouncementTool(
  deps: SendAnnouncementDeps,
): HqToolSpec<SendAnnouncementInput, SendAnnouncementOutput> {
  return {
    name: 'platform.send_announcement',
    riskTier: 'external-comm',
    description:
      'Push a banner / email announcement to one tenant or the entire platform. Four-eye approval required. Rollback = recall (retraction follow-up).',
    inputSchema: SendAnnouncementInputSchema,
    outputSchema: SendAnnouncementOutputSchema,
    requiredScopes: REQUIRED_SCOPES,
    approvalRequired: true,
    rollback: async (output, _ctx) => {
      await deps.announcements.recall({
        announcementId: output.announcementId,
        reason: `automated rollback of ${output.announcementId}`,
      });
    },
    async execute(
      input: SendAnnouncementInput,
      ctx: HqToolContext,
    ): Promise<HqToolExecutionResult<SendAnnouncementOutput>> {
      const tenantId = parseTenantFromScope(input.scope);
      return withHqTelemetry({
        toolName: 'platform.send_announcement',
        riskTier: 'external-comm',
        approvalRequired: true,
        costEstimateUsd: null,
        tenantId,
        ctx,
        input,
        body: async () => {
          if (!callerHasAllScopes(ctx.caller, REQUIRED_SCOPES)) {
            return refusal(
              'OUT_OF_SCOPE',
              'caller lacks platform:comms:write + platform:ops:write scopes',
            );
          }
          if (tenantId !== null && !callerCanReachTenant(ctx.caller, tenantId)) {
            return refusal(
              'OUT_OF_SCOPE',
              `caller cannot reach tenant ${tenantId}`,
            );
          }
          const out = await deps.announcements.send({
            scope: input.scope as 'global' | `tenant:${string}`,
            channel: input.channel,
            subject: input.subject,
            body: input.body,
            scheduleAt: input.scheduleAt ?? null,
          });
          if (out.recipientCount > deps.maxRecipientCount) {
            // Compensating recall — broadcast cardinality exceeded the
            // configured ceiling. We refuse rather than allow the
            // out-of-bounds send to stand.
            await deps.announcements.recall({
              announcementId: out.announcementId,
              reason: `recipient count ${out.recipientCount} exceeds ceiling ${deps.maxRecipientCount}`,
            });
            return refusal(
              'DOMAIN_LIMIT_EXCEEDED',
              `recipient count ${out.recipientCount} exceeds platform ceiling ${deps.maxRecipientCount}`,
            );
          }
          return { kind: 'ok', output: out };
        },
      });
    },
  };
}
