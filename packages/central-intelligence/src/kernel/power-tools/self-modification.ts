/**
 * power_tool.self_modification — Reflexion-style prompt rewrite.
 *
 * The agent reflects on the current turn (what went wrong, what it
 * learned) and persists a short summary that gets re-injected into
 * the system-prompt assembly for the NEXT iteration. The persisted
 * row goes to `anchor_summaries` — the same memory backbone the
 * kernel uses for anchored context.
 *
 * This is the "growth" pattern: the agent rewrites its own next-turn
 * prompt. It is constrained to a 600-char summary + a single anchor
 * key so it cannot smuggle arbitrary instructions.
 *
 * Tier model:
 *   - requiredTier: estate-manager. Residents do not edit their own
 *     persona prompt; the owner-advisor can reflect on its own
 *     advice but the estate-manager is the first tier where adapting
 *     internal reasoning is a normal capability.
 *
 * Approval: yes. Persona-prompt rewrites are reversible (the next
 * cycle can rewrite them back) but they steer future turns; we want
 * a second pair of eyes on every rewrite before it lands. The kernel
 * routes the call through the four-eye gate; this tool's execute
 * verifies the approval id is threaded through.
 *
 * Audit trail: sovereign_action_ledger — every persona modification
 * is sovereign-class because it changes future agent behaviour.
 *
 * @module kernel/power-tools/self-modification
 */

import { z } from 'zod';
import type {
  PowerTool,
  PowerToolContext,
  PowerToolResult,
} from './types.js';

const MAX_SUMMARY_CHARS = 600;
const MAX_ANCHOR_KEY_CHARS = 120;

// ─────────────────────────────────────────────────────────────────────
// Adapter — persists to anchor_summaries.
// ─────────────────────────────────────────────────────────────────────

export interface AnchorSummaryRecord {
  readonly anchorKey: string;
  readonly summary: string;
  readonly tenantId: string | null;
  readonly tier: PowerToolContext['tier'];
  readonly authoredAt: string;
  readonly approvalRecordId: string;
}

export interface AnchorSummaryAdapter {
  persist(record: AnchorSummaryRecord): Promise<{ readonly anchorId: string }>;
}

export interface InMemoryAnchorSummaryAdapter extends AnchorSummaryAdapter {
  readonly records: ReadonlyArray<AnchorSummaryRecord & { readonly anchorId: string }>;
  clear(): void;
}

export function createInMemoryAnchorSummaryAdapter(): InMemoryAnchorSummaryAdapter {
  const records: Array<AnchorSummaryRecord & { readonly anchorId: string }> = [];
  return {
    async persist(record: AnchorSummaryRecord): Promise<{ readonly anchorId: string }> {
      const anchorId = `anchor-${records.length + 1}-${Date.now().toString(36)}`;
      records.push({ ...record, anchorId });
      return { anchorId };
    },
    get records(): ReadonlyArray<AnchorSummaryRecord & { readonly anchorId: string }> {
      return records;
    },
    clear(): void {
      records.length = 0;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Control-char regex — built programmatically so file-roundtrip strips
// of literal control bytes cannot weaken it.
// ─────────────────────────────────────────────────────────────────────

const CONTROL_CHAR_REGEX = new RegExp(
  '[' +
    String.fromCharCode(0) +
    '-' +
    String.fromCharCode(31) +
    String.fromCharCode(127) +
    ']',
);

// ─────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────

export const SelfModificationSchema = z.object({
  /** Stable namespace for the rewrite (e.g. `persona.estate-manager.eviction`). */
  anchorKey: z
    .string()
    .min(1)
    .max(MAX_ANCHOR_KEY_CHARS)
    .regex(/^[a-z0-9._-]+$/i, 'anchorKey must be alphanumeric with . _ -'),
  /** Plain-language lesson to bias next-turn assembly. */
  summary: z
    .string()
    .min(16, 'summary must be at least 16 characters')
    .max(MAX_SUMMARY_CHARS, `summary must be at most ${MAX_SUMMARY_CHARS} characters`),
  /** Optional anchor categorisation (`lesson`, `caveat`, `preference`). */
  kind: z.enum(['lesson', 'caveat', 'preference']).optional(),
});

export type SelfModificationArgs = z.infer<typeof SelfModificationSchema>;
export type SelfModificationKind = 'lesson' | 'caveat' | 'preference';

export interface SelfModificationOutput {
  readonly action: 'self-modification';
  readonly anchorId: string;
  readonly anchorKey: string;
  readonly kind: SelfModificationKind;
  readonly summaryLength: number;
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createSelfModificationPowerTool(
  adapter: AnchorSummaryAdapter | null,
): PowerTool<SelfModificationArgs, SelfModificationOutput> {
  return {
    id: 'self_modification',
    name: 'Self-modification (Reflexion)',
    description:
      'Persist a short lesson to anchor_summaries that re-injects into the next iteration. Reflexion-style growth pattern.',
    requiredTier: 'estate-manager',
    requiresApproval: true,
    auditDestination: 'sovereign-action-ledger',
    schema: SelfModificationSchema,
    async execute(
      ctx: PowerToolContext,
      args: SelfModificationArgs,
    ): Promise<PowerToolResult<SelfModificationOutput>> {
      if (!adapter) {
        return {
          kind: 'refused',
          reasonCode: 'NOT_IMPLEMENTED',
          message:
            'No anchor-summary adapter wired. Bind one at composition root.',
        };
      }
      // The registry already enforces approval — defensive: if the gate
      // was bypassed (test misconfiguration), the adapter sees a null
      // approvalRecordId and we refuse to persist a sovereign row.
      if (ctx.approvalRecordId === null) {
        return {
          kind: 'refused',
          reasonCode: 'APPROVAL_MISSING',
          message:
            'self_modification persists to sovereign ledger; approval id is mandatory',
        };
      }

      if (CONTROL_CHAR_REGEX.test(args.summary)) {
        return {
          kind: 'failed',
          message: 'summary contains control characters',
        };
      }

      const kind: SelfModificationKind = args.kind ?? 'lesson';
      try {
        const { anchorId } = await adapter.persist({
          anchorKey: args.anchorKey,
          summary: args.summary,
          tenantId: ctx.tenantId,
          tier: ctx.tier,
          authoredAt: ctx.clock().toISOString(),
          approvalRecordId: ctx.approvalRecordId,
        });
        return {
          kind: 'ok',
          output: {
            action: 'self-modification',
            anchorId,
            anchorKey: args.anchorKey,
            kind,
            summaryLength: args.summary.length,
          },
        };
      } catch (err) {
        return {
          kind: 'failed',
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
