/**
 * owner.draft_eviction_notice — generate a DRAFT eviction notice for
 * the owner to review.
 *
 * Risk tier: mutate (persists a draft row).
 *
 * IMPORTANT BLAST-RADIUS NOTE:
 *
 *   This tool DOES NOT send, file, or otherwise execute an eviction.
 *   The real `platform.evict_tenant` HQ-tier tool is the only path
 *   that can dispatch the eviction workflow. This owner-tier tool
 *   simply drafts a non-binding document into the tenant's notices
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

export const DraftEvictionNoticeInputSchema = z.object({
  tenantId: z.string().min(1).max(64),
  unitId: z.string().min(1).max(64),
  occupantId: z.string().min(1).max(64),
  breachKind: z.enum([
    'arrears',
    'damage',
    'unauthorised-occupants',
    'illegal-use',
    'other',
  ]),
  breachSummary: z.string().min(10).max(500),
  // Locale gives the renderer enough context to pick the right
  // template (e.g. Swahili / English); not a free-text override of
  // the template itself.
  locale: z.enum(['en-KE', 'sw-KE', 'en-TZ', 'sw-TZ']).optional(),
});

export const DraftEvictionNoticeOutputSchema = z.object({
  draftId: z.string(),
  tenantId: z.string(),
  unitId: z.string(),
  occupantId: z.string(),
  breachKind: z.string(),
  bodyMarkdown: z.string(),
  createdAt: z.string(),
  status: z.literal('draft'),
});

export type DraftEvictionNoticeInput = z.infer<typeof DraftEvictionNoticeInputSchema>;
export type DraftEvictionNoticeOutput = z.infer<typeof DraftEvictionNoticeOutputSchema>;

export interface EvictionNoticeDraftPort {
  draftNotice(args: {
    readonly tenantId: string;
    readonly unitId: string;
    readonly occupantId: string;
    readonly breachKind: DraftEvictionNoticeInput['breachKind'];
    readonly breachSummary: string;
    readonly locale: DraftEvictionNoticeInput['locale'] | null;
  }): Promise<DraftEvictionNoticeOutput>;
  /** Remove the draft row by id. Idempotent (no-op when missing). */
  deleteDraft(draftId: string): Promise<void>;
}

export interface DraftEvictionNoticeDeps {
  readonly notices: EvictionNoticeDraftPort;
}

const REQUIRED_SCOPES: ReadonlyArray<string> = ['owner:notices:draft'];

export function createDraftEvictionNoticeTool(
  deps: DraftEvictionNoticeDeps,
): OwnerToolSpec<DraftEvictionNoticeInput, DraftEvictionNoticeOutput> {
  return {
    name: 'owner.draft_eviction_notice',
    riskTier: 'mutate',
    description:
      'Generate a DRAFT eviction notice (status=draft, non-binding) for the caller-owned tenant from a vetted server-side template. Does NOT send or file. Owner must explicitly escalate to platform.evict_tenant to actually dispatch.',
    inputSchema: DraftEvictionNoticeInputSchema,
    outputSchema: DraftEvictionNoticeOutputSchema,
    requiredScopes: REQUIRED_SCOPES,
    approvalRequired: false,
    rollback: async (output, _ctx): Promise<void> => {
      await deps.notices.deleteDraft(output.draftId);
    },
    async execute(
      input: DraftEvictionNoticeInput,
      ctx: HqToolContext,
    ): Promise<HqToolExecutionResult<DraftEvictionNoticeOutput>> {
      return withOwnerTelemetry({
        toolName: 'owner.draft_eviction_notice',
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
            unitId: input.unitId,
            occupantId: input.occupantId,
            breachKind: input.breachKind,
            breachSummary: input.breachSummary,
            locale: input.locale ?? null,
          });
          // Hard invariant: the draft MUST come back as `status: draft`
          // — if the port forgets and returns a `sent`/`filed` row we
          // would have just executed an eviction without HQ-tier
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
