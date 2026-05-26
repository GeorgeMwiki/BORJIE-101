/**
 * Tick runner — pure orchestrator (spec §3).
 *
 * Pipeline:
 *   input  →  policy gate  →  tool call  →  quality gate  →  journal write
 *
 * Deps {policyGate, toolBag, qualityGate, journalRepo, stateRepo,
 *       memoryPort, budgetGate, logger, clock} are injected — no
 * globals. Each tick:
 *
 *   1. Read state + last journal entry (for prev_hash).
 *   2. Budget gate → if cap_reached, write a 'mode_transition' tick
 *      that flips the tenant to 'observe' and returns. mode_locked
 *      writes a 'skipped' row.
 *   3. Memory recall → seed `TickInput.recall`.
 *   4. Tool selection → ToolBag.selectAndInvoke. Null means no work →
 *      'skipped' row.
 *   5. Policy gate → if blocked, write a 'failed' row with reason.
 *   6. Quality gate → if failed, write a 'failed' row with reason.
 *   7. Journal append (which hashes + persists atomically).
 *   8. State apply.
 *   9. Budget gate record spend.
 *  10. Return JournalEntry.
 *
 * Returns a `JournalEntry` (the persisted projection). Throws only on
 * infrastructural failures (repo I/O) — domain failures (policy block,
 * quality fail, budget exhaustion) write a journal row rather than
 * throw, so the audit chain captures every decision.
 */

import type { BudgetGate } from '../budget/night-budget.js';
import type { JournalRepository } from '../journal/journal-repository.js';
import type { StateRepository } from '../state/state-repository.js';
import {
  noopLogger,
  type JournalEntry,
  type TickOutput,
  type WorkCycleLogger,
  type WorkCycleMode,
  type WorkCycleState,
} from '../types.js';
import type {
  MemoryPort,
  PolicyGate,
  QualityGate,
  ToolBag,
} from './ports.js';

export interface TickRunnerDeps {
  readonly policyGate: PolicyGate;
  readonly toolBag: ToolBag;
  readonly qualityGate: QualityGate;
  readonly journalRepo: JournalRepository;
  readonly stateRepo: StateRepository;
  readonly memoryPort: MemoryPort;
  readonly budgetGate: BudgetGate;
  readonly logger?: WorkCycleLogger;
  readonly clock?: () => Date;
  /** Memory recall k. Default 8. */
  readonly recallK?: number;
}

export interface TickRunner {
  /**
   * Run exactly one tick for `tenantId`. Returns the persisted
   * `JournalEntry`.
   */
  runOne(args: {
    readonly tenantId: string;
    readonly mode?: WorkCycleMode;
  }): Promise<JournalEntry>;
}

export function createTickRunner(deps: TickRunnerDeps): TickRunner {
  const logger = deps.logger ?? noopLogger();
  const clock = deps.clock ?? (() => new Date());
  const recallK = deps.recallK ?? 8;

  async function appendJournal(args: {
    readonly state: WorkCycleState;
    readonly mode: WorkCycleMode;
    readonly output: TickOutput;
    readonly costCents: number;
    readonly startedAt: string;
    readonly endedAt: string;
    readonly lastHash: string | null;
  }): Promise<JournalEntry> {
    const nextTick = args.state.last_tick_no + 1n;
    const inputs = {
      tenant_id: args.state.tenant_id,
      tick_no: nextTick,
      mode: args.mode,
      last_hash: args.lastHash,
      recall: [],
      pending_threads: args.state.pending_threads,
      clock_iso: args.startedAt,
    } as const;
    const entry = await deps.journalRepo.append({
      tenant_id: args.state.tenant_id,
      tick_no: nextTick,
      started_at: args.startedAt,
      ended_at: args.endedAt,
      mode: args.mode,
      inputs,
      outputs: args.output,
      cost_usd_cents: args.costCents,
      prev_hash: args.lastHash,
    });
    await deps.stateRepo.applyTickResult({
      tenantId: args.state.tenant_id,
      tickNo: nextTick,
      tickAtIso: args.endedAt,
      nextMode: args.mode,
      pendingThreads: args.state.pending_threads,
    });
    return entry;
  }

  return {
    async runOne({ tenantId, mode: requestedMode }) {
      const startedAt = clock().toISOString();
      const state = await deps.stateRepo.readOrDefault(tenantId);
      const mode = requestedMode ?? state.current_mode;
      const last = await deps.journalRepo.readLast(tenantId);
      const lastHash = last ? last.audit_hash : null;

      // -----------------------------------------------------------------
      // Step 1: pre-flight budget check using zero estimated cost (the
      // 'observe' mode rejects even free ticks if they intend to spend).
      // -----------------------------------------------------------------
      const preflightBudget = await deps.budgetGate.canAffordTick({
        tenantId,
        mode,
        estimatedCostCents: 0,
      });
      if (!preflightBudget.allowed) {
        logger.warn('work-cycle.budget_preflight_blocked', {
          tenant_id: tenantId,
          mode,
          reason: preflightBudget.reason ?? 'unknown',
        });
        const output: TickOutput = {
          status: 'skipped',
          kind: 'mode_transition',
          summary: 'Mr. Mwikila paused — budget gate locked the tick.',
          reason: preflightBudget.reason ?? 'budget',
          artifact_refs: [],
          requires_owner_attention: false,
        };
        return appendJournal({
          state,
          mode,
          output,
          costCents: 0,
          startedAt,
          endedAt: clock().toISOString(),
          lastHash,
        });
      }

      // -----------------------------------------------------------------
      // Step 2: cognitive-memory recall (T0; never blocked)
      // -----------------------------------------------------------------
      const recall = await deps.memoryPort.recall({
        tenantId,
        pendingThreadTitles: state.pending_threads.map((t) => t.title),
        k: recallK,
      });

      // -----------------------------------------------------------------
      // Step 3: select-and-invoke a tool
      // -----------------------------------------------------------------
      const invocation = await deps.toolBag.selectAndInvoke({
        tenant_id: tenantId,
        tick_no: state.last_tick_no + 1n,
        mode,
        last_hash: lastHash,
        recall,
        pending_threads: state.pending_threads,
        clock_iso: startedAt,
      });
      if (!invocation) {
        const output: TickOutput = {
          status: 'skipped',
          kind: 'sweep',
          summary: 'Mr. Mwikila idled — no tool selected.',
          reason: 'no_tool',
          artifact_refs: [],
          requires_owner_attention: false,
        };
        return appendJournal({
          state,
          mode,
          output,
          costCents: 0,
          startedAt,
          endedAt: clock().toISOString(),
          lastHash,
        });
      }

      // -----------------------------------------------------------------
      // Step 4: policy gate
      // -----------------------------------------------------------------
      const policy = await deps.policyGate.check({
        tenantId,
        mode,
        toolTier: invocation.tier,
        toolId: invocation.tool_id,
      });
      if (!policy.allowed) {
        const output: TickOutput = {
          status: 'failed',
          kind: invocation.output.kind,
          summary: 'Mr. Mwikila held back — policy gate blocked the action.',
          reason: policy.reason ?? 'tier_blocked',
          artifact_refs: [],
          requires_owner_attention: invocation.tier === 't2-critical',
        };
        return appendJournal({
          state,
          mode,
          output,
          costCents: 0,
          startedAt,
          endedAt: clock().toISOString(),
          lastHash,
        });
      }

      // -----------------------------------------------------------------
      // Step 5: budget re-check with real cost estimate
      // -----------------------------------------------------------------
      const finalBudget = await deps.budgetGate.canAffordTick({
        tenantId,
        mode,
        estimatedCostCents: invocation.estimated_cost_usd_cents,
      });
      if (!finalBudget.allowed) {
        const output: TickOutput = {
          status: 'skipped',
          kind: 'mode_transition',
          summary: 'Mr. Mwikila deferred work — daily cap reached.',
          reason: finalBudget.reason ?? 'budget',
          artifact_refs: [],
          requires_owner_attention: false,
        };
        return appendJournal({
          state,
          mode,
          output,
          costCents: 0,
          startedAt,
          endedAt: clock().toISOString(),
          lastHash,
        });
      }

      // -----------------------------------------------------------------
      // Step 6: quality gate
      // -----------------------------------------------------------------
      const verdict = await deps.qualityGate.check(invocation.output);
      const finalOutput: TickOutput = verdict.ok
        ? invocation.output
        : {
            status: 'failed',
            kind: invocation.output.kind,
            summary: 'Mr. Mwikila rejected the draft — quality gate flagged it.',
            reason: verdict.failed_gate ?? 'quality',
            artifact_refs: [],
            requires_owner_attention: false,
          };
      const finalCost = verdict.ok ? invocation.estimated_cost_usd_cents : 0;

      // -----------------------------------------------------------------
      // Step 7: journal + state + budget
      // -----------------------------------------------------------------
      const endedAt = clock().toISOString();
      const entry = await appendJournal({
        state,
        mode,
        output: finalOutput,
        costCents: finalCost,
        startedAt,
        endedAt,
        lastHash,
      });
      if (finalCost > 0) {
        await deps.budgetGate.recordSpend({
          tenantId,
          amountUsdCents: finalCost,
          atIso: endedAt,
        });
      }
      logger.info('work-cycle.tick_done', {
        tenant_id: tenantId,
        tick_no: entry.tick_no.toString(),
        mode,
        status: finalOutput.status,
        cost_usd_cents: finalCost,
      });
      return entry;
    },
  };
}
