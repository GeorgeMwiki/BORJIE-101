/**
 * Mode-shared dependency bag — every mode handler consumes the same
 * port surface so the composition root has a single place to wire
 * Postgres + Redis + the LLM router + the tool registry.
 *
 * Kept in its own file so each mode handler is small + readable.
 *
 * @module research-orchestrator/modes/shared
 */

import type {
  Cache,
  ResearchPlan,
  ResearchStep,
  ResearchResult,
  ToolContext,
  ToolAdapter,
  ResearchArtifact,
  ResearchTool,
} from '../types.js';
import type { PlanRepository } from '../storage/plan-repository.js';
import type { StepRepository } from '../storage/step-repository.js';
import type { ArtifactRepository } from '../storage/artifact-repository.js';
import type { ResultRepository } from '../storage/result-repository.js';
import type { SessionRepository } from '../storage/session-repository.js';
import type { WatchRepository } from '../storage/watch-repository.js';
import type { CostTracker, OwnerConfirmGate } from '../types.js';
import type { LlmPlanRequest, StepTemplate } from '../planner/plan-builder.js';
import type { LlmSynthesizeRequest } from '../synthesizer/answer-synthesizer.js';

export interface ModeRepositories {
  readonly plan: PlanRepository;
  readonly step: StepRepository;
  readonly artifact: ArtifactRepository;
  readonly result: ResultRepository;
  readonly session: SessionRepository;
  readonly watch: WatchRepository;
}

export interface AuditEmitterPort {
  /** Emit a research result to the tenant's audit chain. */
  emit(result: ResearchResult, tenantId: string): Promise<void>;
}

export interface NotificationPort {
  emit(event: {
    readonly kind:
      | 'daily_briefing_ready'
      | 'watch_threshold_crossed'
      | 'deep_dive_gate_reached';
    readonly tenant_id: string;
    readonly plan_id: string;
    readonly result_id?: string;
    readonly payload: Readonly<Record<string, unknown>>;
  }): Promise<void>;
}

export interface BriefingSink {
  /** Write a daily briefing row to `master_brain_briefings`. */
  writeBriefing(row: {
    readonly tenant_id: string;
    readonly summary_md: string;
    readonly evidence_ids: ReadonlyArray<string>;
    readonly actions_proposed: ReadonlyArray<Record<string, unknown>>;
    readonly status: 'draft' | 'final' | 'superseded';
  }): Promise<{ readonly briefing_id: string }>;
}

export interface ModeBudgets {
  readonly reactive_query: { readonly latency_ms: number; readonly cost_usd_cents: number };
  readonly anticipatory_sweep: { readonly latency_ms: number; readonly cost_usd_cents: number };
  readonly daily_briefing: { readonly latency_ms: number; readonly cost_usd_cents: number };
  readonly deep_dive: {
    readonly latency_ms: number;
    readonly cost_usd_cents: number;
    readonly owner_confirm_gates_usd: ReadonlyArray<number>;
  };
  readonly continuous_watch: { readonly latency_ms: number; readonly cost_usd_cents: number };
}

export interface ModeRunDeps {
  readonly repos: ModeRepositories;
  readonly toolRegistry: ReadonlyMap<
    ResearchTool,
    ToolAdapter<Readonly<Record<string, unknown>>, ReadonlyArray<ResearchArtifact>>
  >;
  readonly cache: Cache;
  readonly audit: AuditEmitterPort;
  readonly notifications: NotificationPort;
  readonly briefingSink?: BriefingSink;
  readonly budgets: ModeBudgets;
  readonly llmPlan?: (req: LlmPlanRequest) => Promise<ReadonlyArray<StepTemplate>>;
  readonly llmSynthesize?: (req: LlmSynthesizeRequest) => Promise<string>;
}

export interface ToolContextFactoryArgs {
  readonly plan: ResearchPlan;
  readonly step: ResearchStep;
  readonly deps: ModeRunDeps;
  /** Optional cost-tracker override (per-plan, wired by the gate). */
  readonly costTracker?: CostTracker;
  readonly ownerConfirm?: OwnerConfirmGate;
}

/**
 * Build a per-step ToolContext. Each adapter receives a fresh context
 * scoped to (tenant, plan, step) — the cache + cost tracker are shared
 * across steps in the same plan.
 */
export function defaultToolContextFactory(
  args: ToolContextFactoryArgs,
): ToolContext {
  const baseCost: CostTracker = args.costTracker ?? {
    async tryReserve() {
      return true;
    },
    async commit() {
      // No-op — outer plan-runner is the source of truth.
    },
    async release() {
      // No-op.
    },
    async spent() {
      return 0;
    },
    budget() {
      return args.plan.budget_usd_cents;
    },
  };
  const ctx: ToolContext = {
    tenant_id: args.plan.tenant_id,
    plan_id: args.plan.id,
    step_id: args.step.id,
    cache: args.deps.cache,
    cost_tracker: baseCost,
    ...(args.ownerConfirm ? { owner_confirm: args.ownerConfirm } : {}),
  };
  return ctx;
}
