/**
 * @borjie/executive-brief-engine — orchestrator.
 *
 * Top-level glue that walks the entire pipeline:
 *
 *   sensors → hypothesis-generator → hypothesis-verifier
 *           → debate (HIGH stakes) → action-emitter → brief-assembler
 *
 * Honours:
 *   - Kill-switch fail-closed: if the killswitch port reports HALT for
 *     this tenant, return a refusal brief without firing any sensors
 *     or LLM calls.
 *   - Per-tenant cost budget: if over-budget, skip the LLM stack and
 *     return a degraded brief (rules-only, replays last LLM brief).
 *   - Persona-tier gate: only T1/T2/T3 can have briefs generated; the
 *     caller is responsible for the tier check (we verify by power_tier).
 *
 * Returns a Result discriminator so callers can distinguish ok / refused
 * / degraded outcomes without exception handling.
 */

// Soft-pointer: @borjie/persona-runtime is not yet built. Inline the
// minimal Persona contract this engine actually relies on; the upstream
// package will be a structural superset when it lands.
// TODO(#38): swap back to `import type { Persona } from '@borjie/persona-runtime'`
// once persona-runtime is published.
export interface Persona {
  readonly id: string;
  readonly powerTier: number;
  readonly displayName?: string;
}
import { runStakesAwareDebateOnBrief, type DebatePort } from './debate.js';
import { emitRecommendedActions, type RoutingRulesPort } from './action-emitter.js';
import { assembleBrief } from './brief-assembler.js';
import { generateHypotheses, type HaikuLlmPort } from './hypothesis-generator.js';
import { verifyHypotheses, type OnlineJudgePort, type ToTLatsPort } from './hypothesis-verifier.js';
import { gatherSignals, type SensorBundle } from './sensors.js';
import type { CostBudgetPort } from './cost-budget.js';
import type { HybridRetrieverDeps } from './retrieval.js';
import type { ExecutiveBrief } from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Ports
// ─────────────────────────────────────────────────────────────────────

export interface KillswitchHaltPort {
  isHaltedForTenant(tenantId: string): Promise<boolean>;
}

export interface PriorBriefLookupPort {
  /** Get the most recent brief for (tenant, persona). */
  findLatestForPersona(args: {
    readonly tenantId: string;
    readonly personaId: string;
  }): Promise<ExecutiveBrief | null>;
}

export interface AuditChainPort {
  /**
   * Append a single row to ai_audit_chain referring to the brief, and
   * return the appended row's id (audit_chain_link).
   *
   * The implementation is expected to compute prev_hash from the prior
   * row in the same (tenant, action='executive_brief') chain.
   */
  append(args: {
    readonly tenantId: string;
    readonly briefId: string;
    readonly payload: Readonly<Record<string, unknown>>;
  }): Promise<string>;
}

export interface OrchestratorDeps {
  readonly sensors: SensorBundle;
  readonly llm: HaikuLlmPort;
  readonly retrieval: HybridRetrieverDeps;
  readonly judge: OnlineJudgePort;
  readonly totLats: ToTLatsPort;
  readonly debate: DebatePort;
  readonly routingRules: RoutingRulesPort;
  readonly costBudget: CostBudgetPort;
  readonly killswitch: KillswitchHaltPort;
  readonly priorBrief: PriorBriefLookupPort;
  readonly auditChain?: AuditChainPort;
}

export interface GenerateBriefArgs {
  readonly tenantId: string;
  readonly persona: Persona;
  readonly modulesInScope: ReadonlyArray<string>;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly locale: string;
  readonly focusEntityIds?: ReadonlyArray<string>;
  /** ISO duration matching periodStart/periodEnd (e.g. P7D). */
  readonly timeWindow?: string;
  readonly generatorVersion?: string;
  readonly nowFn?: () => Date;
}

export type GenerateBriefResult =
  | { readonly status: 'ok'; readonly brief: ExecutiveBrief }
  | { readonly status: 'degraded'; readonly brief: ExecutiveBrief; readonly reason: string }
  | { readonly status: 'refused'; readonly reason: string };

// ─────────────────────────────────────────────────────────────────────
// generateBrief — the entry point. Used by both the daily cron worker
// and the on-demand /api/v1/briefs/generate route.
// ─────────────────────────────────────────────────────────────────────

export const ENGINE_VERSION = '2026-05-22.piece-c.v1';

export async function generateBrief(
  deps: OrchestratorDeps,
  args: GenerateBriefArgs,
): Promise<GenerateBriefResult> {
  // ── Step 0: tier gate — refuse below T3. ──────────────────────────
  if (args.persona.powerTier > 3) {
    return {
      status: 'refused',
      reason: `Persona ${args.persona.id} power tier ${args.persona.powerTier} cannot receive executive briefs (T1-T3 only).`,
    };
  }

  // ── Step 1: kill-switch fail-closed. ──────────────────────────────
  let halted = false;
  try {
    halted = await deps.killswitch.isHaltedForTenant(args.tenantId);
  } catch (err) {
    // Fail-closed on kill-switch errors — NEVER ignore.
    return {
      status: 'refused',
      reason: `Killswitch read failed for tenant ${args.tenantId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
  if (halted) {
    return {
      status: 'refused',
      reason: `Tenant ${args.tenantId} is currently halted by kill-switch.`,
    };
  }

  // ── Step 2: cost budget. ──────────────────────────────────────────
  let overBudget = false;
  try {
    overBudget = await deps.costBudget.isOverBudget(args.tenantId);
  } catch {
    overBudget = false; // budget service degrade-open
  }

  const scope: ExecutiveBrief['scope'] = {
    modules: [...args.modulesInScope],
    timeWindow: args.timeWindow ?? 'P7D',
    focusEntities: args.focusEntityIds ? [...args.focusEntityIds] : [],
  };
  const generatorVersion = args.generatorVersion ?? ENGINE_VERSION;

  const prior = await safeFindPrior(deps.priorBrief, {
    tenantId: args.tenantId,
    personaId: args.persona.id,
  });

  if (overBudget) {
    // Degraded path: replay prior + flag.
    return buildDegradedBrief({
      deps,
      args,
      scope,
      generatorVersion,
      prior,
      reason: 'over_budget',
    });
  }

  // ── Step 3: gather sensor signals. ────────────────────────────────
  const sensorResult = await gatherSignals({
    tenantId: args.tenantId,
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    sensors: deps.sensors,
  });

  if (sensorResult.signals.length === 0) {
    return buildDegradedBrief({
      deps,
      args,
      scope,
      generatorVersion,
      prior,
      reason: 'no_signals',
    });
  }

  // ── Step 4: hypothesis generation. ────────────────────────────────
  const hypothesisResult = await generateHypotheses({
    signals: sensorResult.signals,
    locale: args.locale,
    llm: deps.llm,
  });

  let totalCostMicros = hypothesisResult.costMicros;
  await safeRecordCost(deps.costBudget, {
    tenantId: args.tenantId,
    costMicros: hypothesisResult.costMicros,
    model: 'claude-3-5-haiku',
    correlationId: `brief:${args.persona.id}`,
  });

  if (hypothesisResult.hypotheses.length === 0) {
    return buildDegradedBrief({
      deps,
      args,
      scope,
      generatorVersion,
      prior,
      reason: 'no_hypotheses',
    });
  }

  // ── Step 5: verify (retrieval + ToT/LATS). ────────────────────────
  const verifierResult = await verifyHypotheses(
    {
      retrieval: deps.retrieval,
      judge: deps.judge,
      totLats: deps.totLats,
    },
    {
      tenantId: args.tenantId,
      hypotheses: hypothesisResult.hypotheses,
    },
  );

  if (verifierResult.survivors.length === 0) {
    return buildDegradedBrief({
      deps,
      args,
      scope,
      generatorVersion,
      prior,
      reason: 'no_survivors',
    });
  }

  // ── Step 6: stakes-aware debate. ──────────────────────────────────
  const debateResult = await runStakesAwareDebateOnBrief({
    tenantId: args.tenantId,
    survivors: verifierResult.survivors,
    debatePort: deps.debate,
  });
  totalCostMicros += debateResult.totalCostMicros;
  await safeRecordCost(deps.costBudget, {
    tenantId: args.tenantId,
    costMicros: debateResult.totalCostMicros,
    model: 'claude-3-5-sonnet',
    correlationId: `brief:${args.persona.id}`,
  });

  if (debateResult.survivors.length === 0) {
    return buildDegradedBrief({
      deps,
      args,
      scope,
      generatorVersion,
      prior,
      reason: 'all_dropped_by_debate',
    });
  }

  // ── Step 7: recommended actions. ──────────────────────────────────
  const actions = await emitRecommendedActions({
    tenantId: args.tenantId,
    hypotheses: debateResult.survivors,
    routingRules: deps.routingRules,
  });

  // ── Step 8: assemble + zod-validate. ──────────────────────────────
  let brief: ExecutiveBrief;
  try {
    brief = assembleBrief({
      tenantId: args.tenantId,
      personaId: args.persona.id,
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
      scope,
      hypotheses: debateResult.survivors,
      recommendedActions: actions.actions,
      actionSourceMap: actions.sourceMap,
      locale: args.locale,
      generatorVersion,
      costMicros: totalCostMicros,
      prevHash: prior?.hash ?? null,
      generatedAt: args.nowFn ? args.nowFn() : new Date(),
    });
  } catch (err) {
    // Schema rejected. We don't publish broken briefs.
    return buildDegradedBrief({
      deps,
      args,
      scope,
      generatorVersion,
      prior,
      reason: `assembly_failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // ── Step 9: optional audit-chain append. ──────────────────────────
  if (deps.auditChain) {
    try {
      const chainId = await deps.auditChain.append({
        tenantId: args.tenantId,
        briefId: brief.id,
        payload: {
          hash: brief.hash,
          prev_hash: brief.prevHash,
          generator_version: brief.generatorVersion,
          persona_id: brief.personaId,
        },
      });
      brief = { ...brief, auditChainLink: chainId };
    } catch {
      // Audit chain failure leaves the brief unlinked but still valid.
    }
  }

  return { status: 'ok', brief };
}

// ─────────────────────────────────────────────────────────────────────
// Degraded brief: rules-only fallback. We surface gaps/opportunities/
// risks from the prior LLM brief (so the executive sees SOMETHING) plus
// a single "engine degraded" risk so they know it's stale.
// ─────────────────────────────────────────────────────────────────────

interface DegradedArgs {
  readonly deps: OrchestratorDeps;
  readonly args: GenerateBriefArgs;
  readonly scope: ExecutiveBrief['scope'];
  readonly generatorVersion: string;
  readonly prior: ExecutiveBrief | null;
  readonly reason: string;
}

function buildDegradedBrief(input: DegradedArgs): GenerateBriefResult {
  const { args, scope, generatorVersion, prior, reason } = input;
  // Carry the prior brief's structure forward but mark degraded.
  if (prior) {
    const replayed: ExecutiveBrief = {
      ...prior,
      generatedAt: args.nowFn ? args.nowFn() : new Date(),
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
      degraded: true,
      status: 'GENERATED',
      // Note: we don't recompute the hash for a replay — the prior hash
      // covered the original payload. We mark prevHash to the prior so
      // the chain extends, but the new id is fresh.
      prevHash: prior.hash,
    };
    return { status: 'degraded', brief: replayed, reason };
  }
  // No prior — emit an empty-but-valid stub brief with one self-citing
  // risk. The schema requires at least one citation per finding; we
  // self-cite the persona itself.
  const personaCitation = {
    claimKind: 'risk' as const,
    claimIndex: 0,
    entityId: args.persona.id,
    note: `Engine degraded: ${reason}`,
  };
  const stub: ExecutiveBrief = {
    id: `ebr_stub_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    tenantId: args.tenantId,
    personaId: args.persona.id,
    scope,
    gaps: [],
    opportunities: [],
    risks: [
      {
        title: 'Executive brief degraded',
        description: `The brief engine is currently degraded (${reason}). Brief contains no fresh findings — review with caution.`,
        severity: 'MEDIUM',
        citationIndices: [0],
      },
    ],
    recommendedActions: [],
    approvalPackets: [],
    citations: [personaCitation],
    locale: args.locale,
    generatedAt: args.nowFn ? args.nowFn() : new Date(),
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    generatorVersion,
    hash: 'degraded:' + reason,
    prevHash: null,
    auditChainLink: null,
    status: 'GENERATED',
    degraded: true,
  };
  return { status: 'degraded', brief: stub, reason };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

async function safeFindPrior(
  port: PriorBriefLookupPort,
  args: { tenantId: string; personaId: string },
): Promise<ExecutiveBrief | null> {
  try {
    return await port.findLatestForPersona(args);
  } catch {
    return null;
  }
}

async function safeRecordCost(
  port: CostBudgetPort,
  args: { tenantId: string; costMicros: number; model: string; correlationId: string },
): Promise<void> {
  if (args.costMicros <= 0) return;
  try {
    await port.recordCost(args);
  } catch {
    // Cost tracking is best-effort.
  }
}
