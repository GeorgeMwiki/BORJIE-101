/**
 * owner.draft_suspension_notice — generate a DRAFT licence-suspension
 * notice for the owner to review.
 *
 * Risk tier: mutate (persists a draft row).
 *
 * IMPORTANT BLAST-RADIUS NOTE:
 *
 *   This tool DOES NOT send, file, or otherwise execute a suspension.
 *   The real `platform.suspend_licence` HQ-tier tool is the only path
 *   that can dispatch the licence-suspension workflow. This owner-tier
 *   tool simply drafts a non-binding document into the tenant's notices
 *   table; the owner must then explicitly approve + escalate it to
 *   the HQ-tier path. The draft is reversible (delete row) so the
 *   `rollback` handler is supplied.
 *
 * The wording is generated server-side from a vetted template; the
 * brain may NEVER hand-roll legal copy.
 */

import { z } from 'zod';
import type {
  HqToolContext,
  HqToolExecutionResult,
} from '../../risk-tier.js';
import { ownerCanReachTenant, ownerRefusal, withOwnerTelemetry } from './shared.js';
import type { OwnerToolSpec } from './types.js';

export const DraftSuspensionNoticeInputSchema = z.object({
  tenantId: z.string().min(1).max(64),
  siteId: z.string().min(1).max(64),
  operatorId: z.string().min(1).max(64),
  breachKind: z.enum([
    'outstanding',
    'damage',
    'unauthorised-operators',
    'illicit-use',
    'other',
  ]),
  breachSummary: z.string().min(10).max(500),
  // Locale gives the renderer enough context to pick the right
  // template (e.g. Swahili / English); not a free-text override of
  // the template itself.
  locale: z.enum(['en-KE', 'sw-KE', 'en-TZ', 'sw-TZ']).optional(),
});

export const DraftSuspensionNoticeOutputSchema = z.object({
  draftId: z.string(),
  tenantId: z.string(),
  siteId: z.string(),
  operatorId: z.string(),
  breachKind: z.string(),
  bodyMarkdown: z.string(),
  createdAt: z.string(),
  status: z.literal('draft'),
});

export type DraftSuspensionNoticeInput = z.infer<typeof DraftSuspensionNoticeInputSchema>;
export type DraftSuspensionNoticeOutput = z.infer<typeof DraftSuspensionNoticeOutputSchema>;

export interface SuspensionNoticeDraftPort {
  draftNotice(args: {
    readonly tenantId: string;
    readonly siteId: string;
    readonly operatorId: string;
    readonly breachKind: DraftSuspensionNoticeInput['breachKind'];
    readonly breachSummary: string;
    readonly locale: DraftSuspensionNoticeInput['locale'] | null;
  }): Promise<DraftSuspensionNoticeOutput>;
  /** Remove the draft row by id. Idempotent (no-op when missing). */
  deleteDraft(draftId: string): Promise<void>;
}

export interface DraftSuspensionNoticeDeps {
  readonly notices: SuspensionNoticeDraftPort;
}

const REQUIRED_SCOPES: ReadonlyArray<string> = ['owner:notices:draft'];

export function createDraftSuspensionNoticeTool(
  deps: DraftSuspensionNoticeDeps,
): OwnerToolSpec<DraftSuspensionNoticeInput, DraftSuspensionNoticeOutput> {
  return {
    name: 'owner.draft_suspension_notice',
    riskTier: 'mutate',
    description:
      'Generate a DRAFT licence-suspension notice (status=draft, non-binding) for the caller-owned tenant from a vetted server-side template. Does NOT send or file. Owner must explicitly escalate to platform.suspend_licence to actually dispatch.',
    inputSchema: DraftSuspensionNoticeInputSchema,
    outputSchema: DraftSuspensionNoticeOutputSchema,
    requiredScopes: REQUIRED_SCOPES,
    approvalRequired: false,
    rollback: async (output, _ctx): Promise<void> => {
      await deps.notices.deleteDraft(output.draftId);
    },
    async execute(
      input: DraftSuspensionNoticeInput,
      ctx: HqToolContext,
    ): Promise<HqToolExecutionResult<DraftSuspensionNoticeOutput>> {
      return withOwnerTelemetry({
        toolName: 'owner.draft_suspension_notice',
        riskTier: 'mutate',
        tenantId: input.tenantId,
        ctx,
        input,
        body: async () => {
          if (!ownerCanReachTenant(ctx.caller.scopes, input.tenantId)) {
            return ownerRefusal(
              'OUT_OF_SCOPE',
              `caller cannot draft notices for tenant ${input.tenantId}`,
            );
          }
          const draft = await deps.notices.draftNotice({
            tenantId: input.tenantId,
            siteId: input.siteId,
            operatorId: input.operatorId,
            breachKind: input.breachKind,
            breachSummary: input.breachSummary,
            locale: input.locale ?? null,
          });
          // Hard invariant: the draft MUST come back as `status: draft`
          // — if the port forgets and returns a `sent`/`filed` row we
          // would have just executed a suspension without HQ-tier
          // approval. Refuse and surface for ops.
          if (draft.status !== 'draft') {
            return ownerRefusal(
              'INVARIANT_VIOLATION',
              `notice service returned status=${String(
                (draft as { status?: unknown }).status,
              )} (expected 'draft'); refusing to surface non-draft as draft`,
            );
          }
          return { kind: 'ok', output: draft };
        },
      });
    },
  };
}
