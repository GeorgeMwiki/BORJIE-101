/**
 * nightly-aggregator — the 03:00 UTC cron job.
 *
 * For every live (non-locked) recipe:
 *   1. Pull every `doc_feedback_event` in the rolling window.
 *   2. Compute metrics + fitness score.
 *   3. Run lock-decision; if `lock` and sustained 90d → lock the recipe.
 *   4. Otherwise run improve-decision; if `improve` → call the LLM
 *      proposal generator → validate → emit a pending proposal +
 *      notification.
 *
 * The aggregator is purely a coordinator — every concrete dependency
 * (recipes, feedback, proposal sink, LLM, audit chain) is injected.
 */

import type { ChainEntry } from '@borjie/audit-hash-chain';
import { computeRecipeStats } from './metric-computer.js';
import { scoreFitness } from './fitness-scorer.js';
import { decideLock } from '../decisions/lock-decision.js';
import {
  decideImprove,
  targetedSectionsForImprove,
} from '../decisions/improve-decision.js';
import {
  generateProposal,
  type ProposalLlmPort,
  type FeedbackNarrative,
} from '../decisions/proposal-generator.js';
import {
  validateProposal,
} from '../decisions/proposal-validator.js';
import { emitProposal, type NotificationSink } from '../approval/proposal-emitter.js';
import { emitAuditEntry } from '../audit/audit-emit.js';
import type { ArtifactRepository } from '../storage/artifact-repository.js';
import type { FeedbackRepository } from '../storage/feedback-repository.js';
import type { ProposalRepository } from '../storage/proposal-repository.js';
import type { RecipeRepository } from '../storage/recipe-repository.js';
import type {
  DocumentRecipeRow,
  NightlyAggregationSummary,
  WorkerLogger,
} from '../types.js';

export interface NightlyAggregatorDeps {
  readonly recipes: RecipeRepository;
  readonly feedback: FeedbackRepository;
  readonly artifacts: ArtifactRepository;
  readonly proposals: ProposalRepository;
  readonly llm: ProposalLlmPort;
  readonly notificationSink: NotificationSink;
  readonly auditChain?: ReadonlyArray<ChainEntry>;
  readonly auditSecretId?: string;
  readonly auditSecretValue?: string;
  readonly logger?: WorkerLogger;
  /** Returns the current candidate-streak in days for (recipe_id, version). */
  readonly readCandidateStreakDays?: (
    recipe_id: string,
    version: number,
  ) => Promise<number>;
  /** Records the streak (caller persists, e.g. to redis). */
  readonly writeCandidateStreakDays?: (
    recipe_id: string,
    version: number,
    days: number,
  ) => Promise<void>;
}

export interface NightlyAggregatorConfig {
  readonly rolling_window_days: number;
  readonly lock_sustained_days: number;
  readonly regulator_flag_lookback_days: number;
  readonly lock_acceptance_threshold: number;
  readonly lock_revision_ceiling: number;
  readonly improve_acceptance_ceiling: number;
  readonly improve_section_revision_threshold: number;
  /** Now-iso seed for deterministic test runs. */
  readonly now_iso?: string;
}

export async function runNightlyAggregation(
  deps: NightlyAggregatorDeps,
  config: NightlyAggregatorConfig,
): Promise<NightlyAggregationSummary> {
  const now = config.now_iso ?? new Date().toISOString();
  const windowStart = isoMinusDays(now, config.rolling_window_days);
  const regulatorLookback = isoMinusDays(
    now,
    config.regulator_flag_lookback_days,
  );

  let liveRecipes: ReadonlyArray<DocumentRecipeRow>;
  try {
    liveRecipes = await deps.recipes.listLive();
  } catch (error) {
    deps.logger?.warn?.(
      { err: errMessage(error) },
      'doc-evolution-worker: recipe scan failed — aggregation aborted',
    );
    return summarise(now, now, []);
  }

  const results: PerRecipeResult[] = [];
  let chain: ReadonlyArray<ChainEntry> = deps.auditChain ?? [];

  for (const recipe of liveRecipes) {
    try {
      const out = await processRecipe(deps, config, recipe, chain, {
        windowStart,
        now,
        regulatorLookback,
      });
      chain = out.chain;
      results.push(out.result);
    } catch (error) {
      deps.logger?.warn?.(
        {
          recipe_id: recipe.id,
          recipe_version: recipe.version,
          err: errMessage(error),
        },
        'doc-evolution-worker: recipe processing failed — skipping',
      );
      results.push({
        kind: 'error',
        recipe_id: recipe.id,
      });
    }
  }

  return summarise(windowStart, now, results);
}

interface RecipeProcessOutput {
  readonly chain: ReadonlyArray<ChainEntry>;
  readonly result: PerRecipeResult;
}

type PerRecipeResult =
  | { readonly kind: 'lock'; readonly recipe_id: string }
  | { readonly kind: 'improve'; readonly recipe_id: string }
  | { readonly kind: 'hold'; readonly recipe_id: string }
  | { readonly kind: 'error'; readonly recipe_id: string };

async function processRecipe(
  deps: NightlyAggregatorDeps,
  config: NightlyAggregatorConfig,
  recipe: DocumentRecipeRow,
  chain: ReadonlyArray<ChainEntry>,
  windows: { readonly windowStart: string; readonly now: string; readonly regulatorLookback: string },
): Promise<RecipeProcessOutput> {
  if (recipe.status === 'locked') {
    return { chain, result: { kind: 'hold', recipe_id: recipe.id } };
  }

  const compositionCount = await deps.artifacts.countByRecipeWindow({
    recipe_id: recipe.id,
    recipe_version: recipe.version,
    window_start_iso: windows.windowStart,
    window_end_iso: windows.now,
  });
  const events = await deps.feedback.listForRecipeWindow({
    recipe_id: recipe.id,
    recipe_version: recipe.version,
    window_start_iso: windows.windowStart,
    window_end_iso: windows.now,
  });

  // Tenant scoping: spec §11 keeps doc_feedback_events tenant_id
  // denormalised so the worker need not GUC-switch per tenant. We
  // aggregate per recipe across tenants — proposal emission is then
  // scoped to a real tenant by reading the first event's tenant_id.
  const tenantId = events[0]?.tenant_id ?? 'global';

  const stats = computeRecipeStats({
    recipe_id: recipe.id,
    recipe_version: recipe.version,
    tenant_id: tenantId,
    window_start_iso: windows.windowStart,
    window_end_iso: windows.now,
    composition_count: compositionCount,
    events,
  });

  const regulatorFlags30d = await deps.feedback.countRegulatorFlags({
    recipe_id: recipe.id,
    recipe_version: recipe.version,
    since_iso: windows.regulatorLookback,
  });

  const fitness = scoreFitness(stats);
  deps.logger?.info?.(
    {
      recipe_id: recipe.id,
      recipe_version: recipe.version,
      composition_count: compositionCount,
      fitness_score: fitness.score.toFixed(3),
    },
    'doc-evolution-worker: recipe stats computed',
  );

  // Lock decision.
  const streak =
    deps.readCandidateStreakDays !== undefined
      ? await deps.readCandidateStreakDays(recipe.id, recipe.version)
      : 0;
  const lockOutcome = decideLock({
    stats,
    regulator_flag_count_30d: regulatorFlags30d,
    candidate_streak_days: streak,
    thresholds: {
      acceptance_threshold: config.lock_acceptance_threshold,
      revision_ceiling: config.lock_revision_ceiling,
      sustained_days: config.lock_sustained_days,
    },
  });

  if (lockOutcome.kind === 'lock_candidate' && deps.writeCandidateStreakDays) {
    await deps.writeCandidateStreakDays(recipe.id, recipe.version, streak + 1);
  }
  if (
    lockOutcome.kind === 'hold' &&
    deps.writeCandidateStreakDays !== undefined &&
    streak > 0
  ) {
    // Streak broken — reset to 0.
    await deps.writeCandidateStreakDays(recipe.id, recipe.version, 0);
  }

  if (lockOutcome.kind === 'lock') {
    await deps.recipes.updateStatus(
      recipe.id,
      recipe.version,
      'locked',
      null,
    );
    const audit = emitAuditEntry({
      kind: 'doc_evo.lock_decision',
      tenant_id: tenantId,
      subject: {
        recipe_id: recipe.id,
        recipe_version: recipe.version,
        reasons: lockOutcome.reasons,
        fitness_score: fitness.score,
      },
      chain,
      ...(deps.auditSecretId !== undefined
        ? { secret_id: deps.auditSecretId }
        : {}),
      ...(deps.auditSecretValue !== undefined
        ? { secret_value: deps.auditSecretValue }
        : {}),
    });
    return {
      chain: audit.chain,
      result: { kind: 'lock', recipe_id: recipe.id },
    };
  }

  // Improve decision.
  const improveOutcome = decideImprove({
    stats,
    regulator_flag_count_30d: regulatorFlags30d,
    thresholds: {
      acceptance_ceiling: config.improve_acceptance_ceiling,
      section_revision_threshold: config.improve_section_revision_threshold,
    },
  });

  if (improveOutcome.kind !== 'improve') {
    return { chain, result: { kind: 'hold', recipe_id: recipe.id } };
  }

  const narratives = extractNarratives(events);
  const knownSectionPaths = stats.section_revision_rates.map(
    (s) => s.section_path,
  );
  const corpusCitations = uniqueCitations(events);

  let diff;
  try {
    diff = await generateProposal(deps.llm, {
      recipe_id: recipe.id,
      current_version: recipe.version,
      stats,
      recent_narratives: narratives,
      section_revision_threshold: config.improve_section_revision_threshold,
      corpus_citations: corpusCitations,
    });
  } catch (error) {
    deps.logger?.warn?.(
      {
        recipe_id: recipe.id,
        recipe_version: recipe.version,
        err: errMessage(error),
      },
      'doc-evolution-worker: proposal generation failed — skipping recipe',
    );
    return { chain, result: { kind: 'hold', recipe_id: recipe.id } };
  }

  const validation = validateProposal({
    diff,
    known_section_paths: knownSectionPaths,
    available_citation_refs: corpusCitations,
  });
  if (!validation.ok) {
    deps.logger?.warn?.(
      {
        recipe_id: recipe.id,
        recipe_version: recipe.version,
        violations: validation.violations,
      },
      'doc-evolution-worker: proposal validation failed — refused',
    );
    return { chain, result: { kind: 'hold', recipe_id: recipe.id } };
  }

  const emission = await emitProposal(
    {
      proposals: deps.proposals,
      sink: deps.notificationSink,
      auditChain: chain,
      ...(deps.auditSecretId !== undefined
        ? { auditSecretId: deps.auditSecretId }
        : {}),
      ...(deps.auditSecretValue !== undefined
        ? { auditSecretValue: deps.auditSecretValue }
        : {}),
    },
    {
      tenant_id: tenantId,
      recipe_id: recipe.id,
      diff,
      signals: {
        fitness_score: fitness.score,
        acceptance: stats.first_submit_acceptance_rate,
        revision: stats.revision_rate,
        regulator_flags_30d: regulatorFlags30d,
        targeted_sections: targetedSectionsForImprove(
          stats,
          config.improve_section_revision_threshold,
        ),
        improve_reasons: improveOutcome.reasons,
      },
      citations: corpusCitations,
    },
  );

  return {
    chain: emission.auditChain,
    result: { kind: 'improve', recipe_id: recipe.id },
  };
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function isoMinusDays(nowIso: string, days: number): string {
  const ts = Date.parse(nowIso);
  const ms = days * 24 * 60 * 60 * 1000;
  return new Date(ts - ms).toISOString();
}

function extractNarratives(
  events: ReadonlyArray<{
    readonly section_path: string | null;
    readonly detail: Readonly<Record<string, unknown>>;
    readonly recorded_at: string;
    readonly feedback_kind: string;
  }>,
): ReadonlyArray<FeedbackNarrative> {
  return events
    .filter(
      (e) =>
        e.feedback_kind === 'revised' ||
        e.feedback_kind === 'owner_rewrite' ||
        e.feedback_kind === 'rejected',
    )
    .map((e) => ({
      section_path: e.section_path,
      note:
        typeof e.detail['note'] === 'string'
          ? (e.detail['note'] as string)
          : `${e.feedback_kind} feedback`,
      recorded_at: e.recorded_at,
    }))
    .slice(-20);
}

function uniqueCitations(
  events: ReadonlyArray<{
    readonly detail: Readonly<Record<string, unknown>>;
  }>,
): ReadonlyArray<string> {
  const set = new Set<string>();
  for (const e of events) {
    const cites = e.detail['citations'];
    if (Array.isArray(cites)) {
      for (const c of cites) {
        if (typeof c === 'string' && c.length > 0) set.add(c);
      }
    }
  }
  return Array.from(set);
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function summarise(
  windowStart: string,
  windowEnd: string,
  results: ReadonlyArray<PerRecipeResult>,
): NightlyAggregationSummary {
  let lock = 0;
  let improve = 0;
  let errored = 0;
  for (const r of results) {
    if (r.kind === 'lock') lock += 1;
    else if (r.kind === 'improve') improve += 1;
    else if (r.kind === 'error') errored += 1;
  }
  return {
    window_start_iso: windowStart,
    window_end_iso: windowEnd,
    recipes_scanned: results.length,
    lock_decisions: lock,
    improve_decisions: improve,
    proposals_emitted: improve,
    tier2_cards_emitted: 0,
    errored,
  };
}
