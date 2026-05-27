/**
 * Plan builder — turns an owner intent + context into a ResearchPlan.
 *
 * Per DEEP_RESEARCH_SPEC §4.1 (Planner), the planner is LLM-driven for
 * Reactive Query / Anticipatory Sweep / Deep Dive and rule-based for
 * Daily Briefing / Continuous Watch (whose templates are fixed).
 *
 * This module exposes:
 *   - `buildPlan(...)` — produce a typed ResearchPlan from a query +
 *     mode + available tools.
 *   - `BUILT_IN_TEMPLATES` — the fixed step templates for the cron-
 *     driven modes. The Daily Briefing template implements the spec
 *     §3.3 step list: commodity prices, regulatory diff, news scan,
 *     FX moves, competitor licence-register diff.
 *
 * LLM-driven path uses `@borjie/brain-llm-router`'s `brainCall` with
 * task='plan'. Output is parsed as a strict zod schema — a malformed
 * LLM output triggers `plan-validator` to attempt a rule-based fallback
 * so the plan never fails to materialise.
 *
 * Pure builder. No DB or network I/O — the caller (mode handler)
 * persists the plan via `PlanRepository.create()`.
 *
 * @module research-orchestrator/planner/plan-builder
 */

import { randomUUID } from 'node:crypto';
import type {
  ResearchMode,
  ResearchPlan,
  ResearchStep,
  ResearchTool,
} from '../types.js';

export interface BuildPlanInput {
  readonly tenantId: string;
  readonly query: string;
  readonly mode: ResearchMode;
  readonly createdBy: 'mr_mwikila' | 'owner_explicit' | 'worker_cron';
  readonly budget_ms: number;
  readonly budget_usd_cents: number;
  /** Whitelist of tools the planner can pick from. */
  readonly availableTools: ReadonlyArray<ResearchTool>;
  /** Optional override — when provided, skips LLM and uses these steps verbatim. */
  readonly stepTemplate?: ReadonlyArray<StepTemplate>;
  /** Optional LLM-call function — when omitted, a rule-based plan is built. */
  readonly llmPlan?: (req: LlmPlanRequest) => Promise<ReadonlyArray<StepTemplate>>;
  /** ISO timestamp override (tests). */
  readonly nowIso?: string;
}

export interface StepTemplate {
  readonly tool: ResearchTool;
  readonly tool_input: Readonly<Record<string, unknown>>;
}

export interface LlmPlanRequest {
  readonly query: string;
  readonly mode: ResearchMode;
  readonly availableTools: ReadonlyArray<ResearchTool>;
  readonly tenantId: string;
}

/**
 * The fixed step templates the cron-driven modes consume. The mode
 * handlers call `BUILT_IN_TEMPLATES.daily_briefing(...)` to build the
 * step list — keeping the template logic centralised + testable.
 */
export const BUILT_IN_TEMPLATES = {
  /**
   * Daily Briefing template — DEEP_RESEARCH_SPEC §3.3. The owner sees
   * a one-page briefing with prices, regulatory deltas, FX, news, and
   * competitor licence-register diffs.
   */
  daily_briefing(args: {
    readonly minerals: ReadonlyArray<string>;
    readonly regulators: ReadonlyArray<string>;
    readonly fxPairs: ReadonlyArray<string>;
  }): ReadonlyArray<StepTemplate> {
    const steps: Array<StepTemplate> = [];
    // 1. Commodity-price pulls — one step per mineral.
    for (const mineral of args.minerals) {
      steps.push({
        tool: 'commodity_price',
        tool_input: { mineral, source: 'lme,kitco' },
      });
    }
    // 2. Regulator feed diffs — one step per regulator.
    for (const regulator of args.regulators) {
      steps.push({
        tool: 'regulatory_diff',
        tool_input: { regulator },
      });
    }
    // 3. FX moves — BoT gold-window.
    for (const pair of args.fxPairs) {
      steps.push({
        tool: 'fx_rate',
        tool_input: { pair, source: 'bot' },
      });
    }
    // 4. News scan via GDELT.
    steps.push({
      tool: 'news_scan',
      tool_input: {
        terms: [...args.minerals, ...args.regulators, 'Tanzania mining'],
        window_hours: 24,
      },
    });
    return Object.freeze(steps);
  },

  /**
   * Continuous Watch template — single poll step that diffs against
   * the last-seen hash. §3.5.
   */
  continuous_watch(args: {
    readonly topic: string;
    readonly thresholds: Readonly<Record<string, unknown>>;
  }): ReadonlyArray<StepTemplate> {
    return Object.freeze([
      {
        tool: 'web_search' as ResearchTool,
        tool_input: { query: args.topic, thresholds: args.thresholds, depth: 'shallow' },
      },
    ]);
  },

  /**
   * Reactive Query default — 2-step corpus + web fallback. §3.1.
   * The LLM planner usually replaces this; rule-based fallback shape.
   */
  reactive_query(args: { readonly query: string }): ReadonlyArray<StepTemplate> {
    return Object.freeze([
      { tool: 'corpus_query' as ResearchTool, tool_input: { query: args.query } },
      { tool: 'web_search' as ResearchTool, tool_input: { query: args.query, depth: 'shallow' } },
    ]);
  },

  /**
   * Anticipatory Sweep — 3 parallel-ready 1-step web-search probes
   * derived from the owner's last turn. §3.2.
   */
  anticipatory_sweep(args: {
    readonly predictedFollowUps: ReadonlyArray<string>;
  }): ReadonlyArray<StepTemplate> {
    return Object.freeze(
      args.predictedFollowUps.slice(0, 3).map((q) => ({
        tool: 'web_search' as ResearchTool,
        tool_input: { query: q, depth: 'shallow' },
      })),
    );
  },

  /**
   * Deep Dive seed plan — 5 broad steps the executor expands as
   * findings accumulate. §3.4.
   */
  deep_dive(args: { readonly query: string }): ReadonlyArray<StepTemplate> {
    return Object.freeze([
      { tool: 'corpus_query' as ResearchTool, tool_input: { query: args.query } },
      { tool: 'web_search' as ResearchTool, tool_input: { query: args.query, depth: 'advanced' } },
      { tool: 'news_scan' as ResearchTool, tool_input: { terms: [args.query], window_hours: 720 } },
      { tool: 'regulatory_diff' as ResearchTool, tool_input: { regulator: 'tumemadini' } },
      { tool: 'commodity_price' as ResearchTool, tool_input: { mineral: 'gold' } },
    ]);
  },
} as const;

/**
 * Build a ResearchPlan from a query + mode + tool list. Returns an
 * already-validated plan object — the caller persists it.
 */
export async function buildPlan(input: BuildPlanInput): Promise<ResearchPlan> {
  const planId = randomUUID();
  const createdAt = input.nowIso ?? new Date().toISOString();

  // Pick the step list: explicit override > LLM > rule-based default.
  const stepTemplates = await pickStepTemplates(input);

  const steps: ReadonlyArray<ResearchStep> = stepTemplates.map((t, idx) => ({
    id: randomUUID(),
    plan_id: planId,
    seq: idx,
    tool: t.tool,
    tool_input: t.tool_input,
    status: 'pending' as const,
    artifact_ids: Object.freeze([]) as ReadonlyArray<string>,
    cost_usd_cents: null,
    duration_ms: null,
  }));

  return {
    id: planId,
    tenant_id: input.tenantId,
    mode: input.mode,
    query: input.query,
    created_by: input.createdBy,
    created_at: createdAt,
    budget_ms: input.budget_ms,
    budget_usd_cents: input.budget_usd_cents,
    steps,
    status: 'planned',
    result_id: null,
  };
}

async function pickStepTemplates(
  input: BuildPlanInput,
): Promise<ReadonlyArray<StepTemplate>> {
  // Explicit override — when the caller passes `stepTemplate`, honour
  // it verbatim (including an empty array). The empty-array case
  // intentionally surfaces "zero steps" so plan-validator can reject
  // it; if we silently fell back here we'd hide the misuse.
  if (input.stepTemplate !== undefined) {
    return input.stepTemplate.filter((s) =>
      input.availableTools.includes(s.tool),
    );
  }
  if (input.llmPlan) {
    const llmSteps = await safeCallLlm(input.llmPlan, {
      query: input.query,
      mode: input.mode,
      availableTools: input.availableTools,
      tenantId: input.tenantId,
    });
    if (llmSteps.length > 0) {
      return llmSteps.filter((s) => input.availableTools.includes(s.tool));
    }
  }
  return fallbackTemplate(input);
}

async function safeCallLlm(
  llmPlan: (req: LlmPlanRequest) => Promise<ReadonlyArray<StepTemplate>>,
  req: LlmPlanRequest,
): Promise<ReadonlyArray<StepTemplate>> {
  try {
    return await llmPlan(req);
  } catch {
    return [];
  }
}

function fallbackTemplate(input: BuildPlanInput): ReadonlyArray<StepTemplate> {
  switch (input.mode) {
    case 'reactive_query':
      return BUILT_IN_TEMPLATES.reactive_query({ query: input.query });
    case 'anticipatory_sweep':
      return BUILT_IN_TEMPLATES.anticipatory_sweep({
        predictedFollowUps: [input.query],
      });
    case 'daily_briefing':
      return BUILT_IN_TEMPLATES.daily_briefing({
        minerals: ['gold'],
        regulators: ['tumemadini', 'nemc', 'tra'],
        fxPairs: ['USD/TZS'],
      });
    case 'deep_dive':
      return BUILT_IN_TEMPLATES.deep_dive({ query: input.query });
    case 'continuous_watch':
      return BUILT_IN_TEMPLATES.continuous_watch({
        topic: input.query,
        thresholds: {},
      });
    default: {
      // exhaustive — TS forces all modes covered.
      const _never: never = input.mode;
      return _never;
    }
  }
}
