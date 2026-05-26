/**
 * Nightly aggregator cron — composition root for the sweep.
 *
 * Default schedule: 02:00 UTC every day. The cron expression is
 * configurable via `UI_EVO_CRON` in env. The schedule itself is set
 * by `node-cron` at construction; this module owns the orchestration
 * loop that runs PER schedule tick:
 *
 *   1. Pull every `live` row from `tab_recipes`.
 *   2. For each row, aggregate metrics across the 14d + 60d windows.
 *   3. Decide lock vs improve.
 *   4. On `lock_candidate` sustained ≥ 30 days → applyLock.
 *   5. On `improve_candidate` → generate + validate + emit proposal.
 *
 * The whole loop is wrapped in a try/catch so a single recipe's
 * failure does not break the rest of the sweep. Per-recipe errors
 * land in the structured logger AND in the summary returned by the
 * cron handler.
 */

import cron from 'node-cron';

import type {
  FitnessReport,
  NightlySweepSummary,
  RecipeSweepResult,
  TabRecipeRow,
  WorkerLogger,
} from '../types.js';
import { aggregateRecipe, makeWindow } from '../aggregator/daily-aggregator.js';
import {
  decideLock,
  type LockCandidateLedger,
} from '../decisions/lock-decision.js';
import {
  decideImprove,
} from '../decisions/improve-decision.js';
import { generateProposal } from '../decisions/proposal-generator.js';
import { validateProposal } from '../decisions/proposal-validator.js';
import { emitProposal, type NotificationSink } from '../approval/proposal-emitter.js';
import {
  applyLock,
  markLockCandidate,
} from '../approval/promotion.js';
import type { RecipeRepository } from '../storage/recipe-repository.js';
import type { TelemetryRepository } from '../storage/telemetry-repository.js';
import type { ProposalRepository } from '../storage/proposal-repository.js';
import type { AuditEmitter } from '../audit/audit-emit.js';
import type { FormSchema } from '@borjie/dynamic-ui';
import type { BrainLLMClient } from '@borjie/brain-llm-router';

// ---------------------------------------------------------------------------
// Dependency bundle the cron handler closes over
// ---------------------------------------------------------------------------

export interface SweepDeps {
  readonly recipes: RecipeRepository;
  readonly telemetry: TelemetryRepository;
  readonly proposals: ProposalRepository;
  readonly notifications: NotificationSink;
  readonly audit: AuditEmitter;
  readonly ledger: LockCandidateLedger;
  /** Returns the live FormSchema for an (id, version). The cron worker
   *  needs this for the proposal validator. The implementation lives
   *  outside this package — typically a thin wrapper around the
   *  `@borjie/dynamic-ui` registry. */
  readonly fetchCurrentSchema: (args: {
    readonly tabRecipeId: string;
    readonly tabRecipeVersion: number;
  }) => Promise<FormSchema | null>;
  /** Returns the citations the corpus knows about for this recipe.
   *  Empty array is acceptable. */
  readonly fetchKnownCitations: (args: {
    readonly tabRecipeId: string;
    readonly tabRecipeVersion: number;
  }) => Promise<ReadonlyArray<string>>;
  /** Maps a recipe to the tenant the proposal is for. The Tab Recipe
   *  itself is global, but the proposal queue lives per tenant — so
   *  the worker iterates tenants per recipe. */
  readonly fetchTenantsForRecipe: (args: {
    readonly tabRecipeId: string;
    readonly tabRecipeVersion: number;
  }) => Promise<ReadonlyArray<string>>;
  readonly llm: {
    readonly client?: BrainLLMClient;
    readonly model?: string;
    readonly disabled: boolean;
  };
  readonly logger?: WorkerLogger;
}

export interface CronOptions {
  readonly shortWindowDays: number;
  readonly longWindowDays: number;
  readonly sustainDays: number;
  readonly concurrency: number;
}

// ---------------------------------------------------------------------------
// Public — run-once entry point (used by cron tick AND by manual
// invocation in CronJob mode).
// ---------------------------------------------------------------------------

export async function runNightlySweep(
  deps: SweepDeps,
  options: CronOptions,
): Promise<NightlySweepSummary> {
  const startedAtIso = new Date().toISOString();
  let liveRecipes: ReadonlyArray<TabRecipeRow> = [];
  try {
    liveRecipes = await deps.recipes.listLive();
  } catch (err) {
    deps.logger?.warn?.(
      { err: asMessage(err) },
      'ui-evolution-worker: listLive failed — sweep aborted',
    );
    return {
      startedAtIso,
      finishedAtIso: new Date().toISOString(),
      recipesProcessed: 0,
      proposalsEmitted: 0,
      locksApplied: 0,
      errored: 1,
      results: [],
    };
  }

  const results: RecipeSweepResult[] = [];
  let proposalsEmitted = 0;
  let locksApplied = 0;
  let errored = 0;

  // Process recipes serially within a tenant boundary, parallel across
  // tenants. Concurrency is bounded by `options.concurrency`.
  const queue = [...liveRecipes];
  const workers: Promise<void>[] = [];

  const tick = async (): Promise<void> => {
    while (queue.length > 0) {
      const recipe = queue.shift();
      if (!recipe) break;
      const partial = await processRecipe(deps, recipe, options);
      for (const r of partial) {
        results.push(r);
        if (r.proposalEmitted) proposalsEmitted += 1;
        if (r.lockApplied) locksApplied += 1;
        if (r.status === 'error') errored += 1;
      }
    }
  };
  const parallelism = Math.max(1, Math.min(options.concurrency, queue.length || 1));
  for (let i = 0; i < parallelism; i += 1) workers.push(tick());
  await Promise.all(workers);

  return {
    startedAtIso,
    finishedAtIso: new Date().toISOString(),
    recipesProcessed: liveRecipes.length,
    proposalsEmitted,
    locksApplied,
    errored,
    results,
  };
}

// ---------------------------------------------------------------------------
// Per-recipe processing — returns per-tenant outcomes
// ---------------------------------------------------------------------------

async function processRecipe(
  deps: SweepDeps,
  recipe: TabRecipeRow,
  options: CronOptions,
): Promise<ReadonlyArray<RecipeSweepResult>> {
  const out: RecipeSweepResult[] = [];

  let aggregation;
  try {
    const nowIso = new Date().toISOString();
    aggregation = await aggregateRecipe({
      tabRecipeId: recipe.id,
      tabRecipeVersion: recipe.version,
      shortWindow: makeWindow(nowIso, options.shortWindowDays),
      longWindow: makeWindow(nowIso, options.longWindowDays),
      reader: deps.telemetry,
    });
  } catch (err) {
    deps.logger?.warn?.(
      { recipeId: recipe.id, recipeVersion: recipe.version, err: asMessage(err) },
      'ui-evolution-worker: aggregation failed — skipping recipe',
    );
    out.push({
      tenantId: '*',
      tabRecipeId: recipe.id,
      tabRecipeVersion: recipe.version,
      status: 'error',
      decision: 'neutral',
      proposalEmitted: false,
      lockApplied: false,
      errorMessage: asMessage(err),
    });
    return out;
  }

  // Lock decision is global (the recipe is global). Improve decision
  // fans out per tenant because proposals are tenant-scoped.
  const lockOutcome = await safeDecideLock({
    deps,
    recipe,
    options,
    short: aggregation.shortReport,
    long: aggregation.longReport,
  });

  if (lockOutcome.lockApplied) {
    out.push({
      tenantId: '*',
      tabRecipeId: recipe.id,
      tabRecipeVersion: recipe.version,
      status: 'ok',
      decision: 'lock_candidate',
      proposalEmitted: false,
      lockApplied: true,
      errorMessage: null,
    });
    // Once locked, we DO NOT fire improve proposals for this version.
    return out;
  }

  // Improve fan-out per tenant.
  if (aggregation.shortReport.decision === 'improve_candidate') {
    const tenants = await deps.fetchTenantsForRecipe({
      tabRecipeId: recipe.id,
      tabRecipeVersion: recipe.version,
    });
    for (const tenantId of tenants) {
      const tenantOutcome = await safeProposeForTenant({
        deps,
        recipe,
        tenantId,
        report: aggregation.shortReport,
      });
      out.push(tenantOutcome);
    }
    if (tenants.length === 0) {
      out.push({
        tenantId: '*',
        tabRecipeId: recipe.id,
        tabRecipeVersion: recipe.version,
        status: 'skipped',
        decision: 'improve_candidate',
        proposalEmitted: false,
        lockApplied: false,
        errorMessage: 'No tenants for recipe — no proposals to emit.',
      });
    }
    return out;
  }

  // Neutral / lock-candidate marker — single summary row. The
  // `lockApplied` summary field is reserved for actual lock flips;
  // mark_lock_candidate is just a ledger marker so it does NOT count.
  out.push({
    tenantId: '*',
    tabRecipeId: recipe.id,
    tabRecipeVersion: recipe.version,
    status: 'ok',
    decision: aggregation.shortReport.decision,
    proposalEmitted: false,
    lockApplied: false,
    errorMessage: null,
  });
  return out;
}

interface LockOutcome {
  readonly lockApplied: boolean;
  readonly markedCandidate: boolean;
}

async function safeDecideLock(args: {
  readonly deps: SweepDeps;
  readonly recipe: TabRecipeRow;
  readonly options: CronOptions;
  readonly short: FitnessReport;
  readonly long: FitnessReport;
}): Promise<LockOutcome> {
  try {
    const decision = await decideLock({
      shortReport: args.short,
      longReport: args.long,
      ledger: args.deps.ledger,
      nowIso: new Date().toISOString(),
      sustainDays: args.options.sustainDays,
    });
    if (decision.action === 'lock') {
      await applyLock({
        recipe: args.recipe,
        recipeRepository: args.deps.recipes,
        auditEmitter: args.deps.audit,
        reason: decision.reason,
      });
      return { lockApplied: true, markedCandidate: false };
    }
    if (decision.action === 'mark_lock_candidate') {
      await markLockCandidate({
        recipe: args.recipe,
        auditEmitter: args.deps.audit,
        reason: decision.reason,
      });
      return { lockApplied: false, markedCandidate: true };
    }
    return { lockApplied: false, markedCandidate: false };
  } catch (err) {
    args.deps.logger?.warn?.(
      { recipeId: args.recipe.id, err: asMessage(err) },
      'ui-evolution-worker: lock decision failed',
    );
    return { lockApplied: false, markedCandidate: false };
  }
}

async function safeProposeForTenant(args: {
  readonly deps: SweepDeps;
  readonly recipe: TabRecipeRow;
  readonly tenantId: string;
  readonly report: FitnessReport;
}): Promise<RecipeSweepResult> {
  const { deps, recipe, tenantId, report } = args;
  try {
    const improve = await decideImprove({
      tenantId,
      shortReport: report,
      pendingProbe: deps.proposals,
      lockProbe: {
        async isLocked({ tabRecipeId, tabRecipeVersion }) {
          return deps.recipes.isLocked({ id: tabRecipeId, version: tabRecipeVersion });
        },
      },
    });
    if (improve.action !== 'propose_improvement') {
      return {
        tenantId,
        tabRecipeId: recipe.id,
        tabRecipeVersion: recipe.version,
        status: 'skipped',
        decision: 'improve_candidate',
        proposalEmitted: false,
        lockApplied: false,
        errorMessage: improve.reason,
      };
    }

    const currentSchema = await deps.fetchCurrentSchema({
      tabRecipeId: recipe.id,
      tabRecipeVersion: recipe.version,
    });
    if (!currentSchema) {
      return {
        tenantId,
        tabRecipeId: recipe.id,
        tabRecipeVersion: recipe.version,
        status: 'skipped',
        decision: 'improve_candidate',
        proposalEmitted: false,
        lockApplied: false,
        errorMessage: 'fetchCurrentSchema returned null',
      };
    }

    const knownCitations = await deps.fetchKnownCitations({
      tabRecipeId: recipe.id,
      tabRecipeVersion: recipe.version,
    });

    const generated = await generateProposal({
      recipe,
      currentSchema,
      failingSignals: improve.failingSignals,
      knownCitations,
      mode: deps.llm.disabled ? 'stub' : 'llm',
      ...(deps.llm.client ? { llmClient: deps.llm.client } : {}),
      ...(deps.llm.model ? { model: deps.llm.model } : {}),
    });

    const validation = validateProposal({
      currentSchema,
      diff: generated.diff,
      knownCitations,
    });
    if (!validation.ok) {
      deps.logger?.warn?.(
        {
          recipeId: recipe.id,
          tenantId,
          violations: validation.violations.length,
        },
        'ui-evolution-worker: proposal rejected by validator',
      );
      return {
        tenantId,
        tabRecipeId: recipe.id,
        tabRecipeVersion: recipe.version,
        status: 'error',
        decision: 'improve_candidate',
        proposalEmitted: false,
        lockApplied: false,
        errorMessage: validation.violations.join('; '),
      };
    }

    const emitted = await emitProposal({
      tenantId,
      tabRecipeId: recipe.id,
      currentVersion: recipe.version,
      diff: generated.diff,
      signals: improve.failingSignals,
      citations: generated.citations,
      repository: deps.proposals,
      sink: deps.notifications,
    });
    await deps.audit.append({
      kind: 'proposal.created',
      tenantId,
      payload: {
        proposalId: emitted.id,
        tabRecipeId: recipe.id,
        currentVersion: recipe.version,
        proposedVersion: emitted.proposedVersion,
        signalsCount: emitted.signals.length,
      },
    });
    return {
      tenantId,
      tabRecipeId: recipe.id,
      tabRecipeVersion: recipe.version,
      status: 'ok',
      decision: 'improve_candidate',
      proposalEmitted: true,
      lockApplied: false,
      errorMessage: null,
    };
  } catch (err) {
    deps.logger?.warn?.(
      { recipeId: recipe.id, tenantId, err: asMessage(err) },
      'ui-evolution-worker: per-tenant proposal failed',
    );
    return {
      tenantId,
      tabRecipeId: recipe.id,
      tabRecipeVersion: recipe.version,
      status: 'error',
      decision: 'improve_candidate',
      proposalEmitted: false,
      lockApplied: false,
      errorMessage: asMessage(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Cron scheduler — wraps `runNightlySweep` in a node-cron task.
// ---------------------------------------------------------------------------

export interface CronHandle {
  readonly schedule: string;
  stop(): void;
}

export function scheduleNightlySweep(args: {
  readonly cronExpression: string;
  readonly deps: SweepDeps;
  readonly options: CronOptions;
  readonly onTick?: (summary: NightlySweepSummary) => void;
}): CronHandle {
  if (!cron.validate(args.cronExpression)) {
    throw new Error(
      `ui-evolution-worker: invalid cron expression '${args.cronExpression}'`,
    );
  }
  const task = cron.schedule(
    args.cronExpression,
    () => {
      runNightlySweep(args.deps, args.options)
        .then((summary) => {
          args.deps.logger?.info?.(
            {
              recipesProcessed: summary.recipesProcessed,
              proposalsEmitted: summary.proposalsEmitted,
              locksApplied: summary.locksApplied,
              errored: summary.errored,
            },
            'ui-evolution-worker: sweep complete',
          );
          args.onTick?.(summary);
        })
        .catch((err: unknown) => {
          args.deps.logger?.warn?.(
            { err: asMessage(err) },
            'ui-evolution-worker: sweep failed',
          );
        });
    },
    { scheduled: true, timezone: 'UTC' },
  );
  return {
    schedule: args.cronExpression,
    stop() {
      task.stop();
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
