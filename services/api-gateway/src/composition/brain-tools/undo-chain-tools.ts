/**
 * Undo-chain brain tools — Wave CE-5.
 *
 * Lifts the existing single-action `mining.ui.undo_last_action`
 * (superpowers-tools.ts) to chain undo: `undo.last_n(n)` calls the
 * undo-journal route N times sequentially. Each iteration goes
 * through the same policy + audit gate, so a partial failure leaves
 * the chain in a well-defined state (some undone, some not — fully
 * idempotent because the journal pops in LIFO order).
 *
 * Also ships `undo.undo_by_id` — a typed wrapper around the
 * existing `/owner/undo-journal/undo-by-id` route — so the brain
 * can target a specific past action ("undo my last dispatch to John"
 * → resolve to id → call undo_by_id).
 *
 * Frontier reference:
 *   - Claude Code's "undo last edit" — single step.
 *   - Cursor's worktree-revert — git-level multi-step.
 *
 * Borjie's undo-chain is server-state, append-only-journal driven:
 * each undo IS itself a write, recorded as a new journal row with
 * action='reversal'. There is no global rollback — each step is
 * individually validated.
 *
 * Discipline:
 *   - Both tools MEDIUM stakes (reversal is itself a mutation).
 *   - HTTP client injected via ctx; no direct DB access.
 *   - Failure on step k of n returns a partial result with
 *     `undoneCount` so the brain can surface "I undid 3 of 5".
 *   - Functions <50 lines, nesting <4.
 */

import { z } from 'zod';
import type { PersonaToolDescriptor } from './types';
import { withChatProvenance } from './provenance-injector';

const OWNER_AND_ADMIN: ReadonlyArray<
  'T1_owner_strategist' | 'T2_admin_strategist'
> = ['T1_owner_strategist', 'T2_admin_strategist'];

// ────────────────────────────────────────────────────────────────────
// undo.last_n — reverse the last N reversible actions
// ────────────────────────────────────────────────────────────────────

const UndoLastNInput = z
  .object({
    n: z.number().int().min(1).max(10),
    reason: z.string().min(1).max(400).optional(),
  })
  .strict();

const UndoLastNOutput = z
  .object({
    requested: z.number().int().nonnegative(),
    undoneCount: z.number().int().nonnegative(),
    undoneIds: z.array(z.string()),
    stoppedReason: z.string().nullable(),
  })
  .strict();

interface UndoLastResponse {
  data?: {
    undone?: boolean;
    journalId?: string | null;
  };
  undone?: boolean;
  journalId?: string | null;
}

export const undoLastNTool: PersonaToolDescriptor<
  typeof UndoLastNInput,
  typeof UndoLastNOutput
> = {
  id: 'undo.last_n',
  name: 'Undo the last N reversible actions (LIFO)',
  description:
    "Call the undo-journal `undo-last` endpoint up to N times " +
    "(N <= 10) to reverse the owner's N most recent reversible " +
    "writes. Stops early when the journal returns undone=false " +
    "(nothing left in the 5-min window). Use when the owner says " +
    "'undo my last 3', 'reverse the last 5 actions', or 'cancel " +
    "everything I just did'.",
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: UndoLastNInput,
  outputSchema: UndoLastNOutput,
  stakes: 'MEDIUM',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      throw new Error('undo.last_n requires httpClient');
    }
    const ids: string[] = [];
    let stoppedReason: string | null = null;
    for (let i = 0; i < input.n; i += 1) {
      const body = withChatProvenance(
        {
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          ...(input.reason && {
            reason: `${input.reason} (step ${i + 1}/${input.n})`,
          }),
        },
        ctx,
      );
      const res = (await client.post<UndoLastResponse>(
        '/owner/undo-journal/undo-last',
        body,
      )) ?? {};
      const row = res.data ?? res;
      if (!row.undone) {
        stoppedReason = 'no_more_reversible_actions';
        break;
      }
      if (row.journalId) ids.push(row.journalId);
    }
    return {
      requested: input.n,
      undoneCount: ids.length,
      undoneIds: ids,
      stoppedReason,
    };
  },
};

// ────────────────────────────────────────────────────────────────────
// undo.by_id — reverse a specific past action by journal id
// ────────────────────────────────────────────────────────────────────

const UndoByIdInput = z
  .object({
    journalId: z.string().min(1).max(120),
    reason: z.string().min(1).max(400),
  })
  .strict();

const UndoByIdOutput = z
  .object({
    undone: z.boolean(),
    journalId: z.string(),
    actionKind: z.string().nullable(),
    entityType: z.string().nullable(),
    entityId: z.string().nullable(),
  })
  .strict();

interface UndoByIdResponse {
  data?: {
    undone?: boolean;
    journalId?: string;
    actionKind?: string | null;
    entityType?: string | null;
    entityId?: string | null;
  };
  undone?: boolean;
  journalId?: string;
  actionKind?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}

export const undoByIdTool: PersonaToolDescriptor<
  typeof UndoByIdInput,
  typeof UndoByIdOutput
> = {
  id: 'undo.by_id',
  name: 'Undo a specific past action by journal id',
  description:
    "Reverse the named journal entry. The brain resolves the id by " +
    "first calling `decisions.recent` or `decisions.search` to find " +
    "the action ('undo my dispatch to John yesterday'), then passes " +
    "the row id here. Reason is mandatory and lands in the audit " +
    "chain. The reversal itself is a new journal row so a future " +
    "'undo my undo' is reachable via undo.by_id again.",
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: UndoByIdInput,
  outputSchema: UndoByIdOutput,
  stakes: 'MEDIUM',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      throw new Error('undo.by_id requires httpClient');
    }
    const body = withChatProvenance(
      {
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        journalId: input.journalId,
        reason: input.reason,
      },
      ctx,
    );
    const res = (await client.post<UndoByIdResponse>(
      '/owner/undo-journal/undo-by-id',
      body,
    )) ?? {};
    const row = res.data ?? res;
    return {
      undone: Boolean(row.undone ?? true),
      journalId: String(row.journalId ?? input.journalId),
      actionKind: (row.actionKind ?? null) as string | null,
      entityType: (row.entityType ?? null) as string | null,
      entityId: (row.entityId ?? null) as string | null,
    };
  },
};

// ────────────────────────────────────────────────────────────────────
// Catalog export
// ────────────────────────────────────────────────────────────────────

export const UNDO_CHAIN_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([undoLastNTool, undoByIdTool] as unknown as readonly PersonaToolDescriptor<
  z.ZodTypeAny,
  z.ZodTypeAny
>[]);
