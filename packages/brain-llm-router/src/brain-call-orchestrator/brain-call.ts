/**
 * brain-call-orchestrator/ — THE single entry point.
 *
 * Pipeline (research §8):
 *   1. resolveLadder(task, tenant)
 *   2. loadDSPyCompiledPrompt(task, model)
 *   3. preflightCostCheck (cost-cap)
 *   4. provider-fallback iterate
 *      - within each: optionally Self-Consistency N-sample vote
 *      - optionally CoVe critic
 *      - optionally hedged 2-provider race
 *   5. postflightCharge (cost-cap)
 *   6. logDrift (eval-drift-logger)
 *
 * Every step is duck-typed. The orchestrator owns the ordering — modules
 * are interchangeable. Immutable throughout.
 */

import type {
  BrainCallRequest,
  BrainLLMClient,
  BrainLLMRequest,
  BrainLLMResponse,
  ModelTier,
} from '../types.js';
import { BrainLLMError } from '../types.js';
import { type TenantLadderMap } from '../task-ladder/index.js';
import {
  resolveConfigDrivenLadder,
  resolveEnsembleConfig,
} from '../routing-config/index.js';
import {
  runEnsemble,
  type EnsembleInvoke,
  type EnsembleBudgetCheck,
  type EnsembleSynthesise,
} from '../ensemble/index.js';
import { runFallback, type ProviderLadderEntry } from '../provider-fallback/index.js';
import { computeCost, getPricing } from '../cost-cascade/pricing.js';
import {
  preflightCostCheck,
  postflightCharge,
  type CostCapConfig,
} from '../cost-cap/index.js';
import { hedgedInvoke } from '../hedged-requests/index.js';
import { logDrift, type EvalDriftSink } from '../eval-drift-logger/index.js';
import {
  PromptCache,
  PromptCacheMissError,
  type CompiledPrompt,
} from '../dspy-compile/index.js';
import { renderXml, type XmlPrompt } from '../prompt-portability/index.js';
import { majorityVote } from './consistency.js';
import { runCove, type CoveConfig } from './cove.js';

export interface ModelClientRegistry {
  /** Resolve a `BrainLLMClient` for a given canonical model id. */
  resolve(model: ModelTier): BrainLLMClient;
}

export interface BrainCallContext {
  readonly conversationId: string;
  readonly clientRegistry: ModelClientRegistry;
  readonly promptCache: PromptCache;
  readonly costCap: CostCapConfig;
  readonly driftSink: EvalDriftSink;
  readonly cove?: CoveConfig;
  readonly tenantOverrides?: TenantLadderMap;
  readonly hedgeAfterMs?: number;
  /**
   * Cost-aware pre-flight for the ENSEMBLE seam (F2). Wired by the
   * composition root to @borjie/llm-budget-governor.evaluateCall. When the
   * budget is constrained the ensemble degrades to a single model and
   * surfaces an economy note. Absent → ensemble runs unbudgeted (dev/test).
   */
  readonly ensembleBudgetCheck?: EnsembleBudgetCheck;
  /**
   * Judge/synthesiser port for 'judge-synthesis' / 'debate' ensemble
   * strategies. Absent → those strategies fall back to majority-vote.
   */
  readonly ensembleSynthesise?: EnsembleSynthesise;
}

export interface BrainCallResult {
  readonly response: BrainLLMResponse;
  readonly modelUsed: ModelTier;
  readonly fallbackDepth: number;
  readonly consistency: number;
  readonly verificationScore: number;
  readonly costUsd: number;
  readonly wasHedged: boolean;
  readonly compiledPromptUsed: boolean;
  /** True iff the all-at-once ensemble strategy ran this turn. */
  readonly wasEnsemble: boolean;
  /** Surfaced economy note when the ensemble degraded to a single model. */
  readonly economyNote?: string;
  /** Where the ladder came from: 'call-override' | 'admin-config' | 'static-ladder'. */
  readonly ladderSource: 'call-override' | 'admin-config' | 'static-ladder';
}

/**
 * THE entry point. Every brain call flows through this function.
 */
export async function brainCall(req: BrainCallRequest, ctx: BrainCallContext): Promise<BrainCallResult> {
  const options = req.options ?? {};
  // 1. Resolve ladder — CONFIG-DRIVEN (F1+F3) with fail-safe fallback to the
  //    static TASK_LADDER. A bad/empty/absent admin config is transparent:
  //    the resolver returns the static ladder, so this is identical to the
  //    legacy behaviour when the kill-switch is off or no config is set.
  const ladderResolution = resolveConfigDrivenLadder({
    task: req.task,
    tenantId: req.tenantId,
    // `exactOptionalPropertyTypes`: only pass these optional fields when they
    // are actually present — never an explicit `undefined` (the api-gateway
    // tsconfig is strict here even though the router's own is not). Matches the
    // conditional-spread pattern used for the ensemble/economyNote fields below.
    ...(options.useCase !== undefined ? { useCase: options.useCase } : {}),
    ...(ctx.tenantOverrides !== undefined ? { tenantOverrides: ctx.tenantOverrides } : {}),
    ...(options.ladderOverride !== undefined ? { callOverride: options.ladderOverride } : {}),
  });
  const ladder = ladderResolution.ladder;
  if (ladder.length === 0) {
    throw new BrainLLMError({ code: 'EMPTY_LADDER', message: 'no models in ladder', retryable: false });
  }

  // 2. Load DSPy-compiled prompt for the primary model (if exists).
  const primary = ladder[0]!;
  const taskName = `${req.task}_task`;
  const compiledPromptUsed = await tryLoadCompiledPrompt(ctx.promptCache, taskName, primary);

  // Build the raw BrainLLMRequest — use compiled-prompt system if loaded,
  // else fall back to XML-rendered shell.
  const xml: XmlPrompt = {
    role: `Task: ${req.task}`,
    task: req.prompt,
  };
  const systemPrompt = compiledPromptUsed?.compiledSystem ?? renderXml(xml);
  const instructionPrompt = compiledPromptUsed?.compiledInstruction ?? req.prompt;

  const baseRequest: BrainLLMRequest = {
    model: primary,
    system: systemPrompt,
    messages: [{ role: 'user', content: [{ type: 'text', text: instructionPrompt }] }],
    maxTokens: 1024,
  };

  // 3. Pre-flight cost check against the primary model.
  await preflightCostCheck(
    baseRequest,
    { tenantId: req.tenantId, conversationId: ctx.conversationId, model: primary },
    ctx.costCap
  );

  // 4. Provider-fallback ladder iteration.
  const ladderEntries: ProviderLadderEntry[] = ladder.map((m) => ({
    model: m,
    client: ctx.clientRegistry.resolve(m),
  }));

  // Self-Consistency: N samples on the primary, then vote.
  // If N > 1 we bypass the standard fallback and run multi-sample manually.
  const N = options.consistencyN ?? 1;

  let response: BrainLLMResponse;
  let fallbackDepth = 0;
  let wasHedged = false;
  let consistency = 1.0;
  let wasEnsemble = false;
  let economyNote: string | undefined;

  // ENSEMBLE seam (F2). When the admin enabled an all-at-once ensemble for
  // this scope, fan the turn to the member models in parallel and combine per
  // strategy. Cost-aware: the budget check gates fan-out and degrades to a
  // single model when constrained. Fail-safe: a null/empty config returns no
  // ensemble and we fall through to the standard single/vote/hedged path.
  const ensembleConfig = resolveEnsembleConfig(req.tenantId);

  if (ensembleConfig) {
    const invoke: EnsembleInvoke = (model, request) =>
      ctx.clientRegistry.resolve(model).invoke(request);
    const ensembleResult = await runEnsemble({
      request: baseRequest,
      members: ensembleConfig.members,
      strategy: ensembleConfig.combineStrategy,
      ...(ensembleConfig.judgeModel ? { judgeModel: ensembleConfig.judgeModel } : {}),
      invoke,
      ...(ctx.ensembleSynthesise ? { synthesise: ctx.ensembleSynthesise } : {}),
      ...(ctx.ensembleBudgetCheck ? { budgetCheck: ctx.ensembleBudgetCheck } : {}),
    });
    response = ensembleResult.response;
    consistency = ensembleResult.confidence;
    wasEnsemble = ensembleResult.strategyUsed !== 'single';
    economyNote = ensembleResult.economyNote;
    fallbackDepth = 0;
  } else if (N > 1) {
    const samples: BrainLLMResponse[] = [];
    for (let i = 0; i < N; i += 1) {
      const result = await runFallback(baseRequest, ladderEntries, {});
      samples.push(result.response);
      if (i === 0) {
        fallbackDepth = result.depth;
      }
    }
    const vote = majorityVote(samples);
    response = vote.winner;
    consistency = vote.consistency;
  } else if (options.hedged === true && ladderEntries.length >= 2) {
    const result = await hedgedInvoke(baseRequest, {
      primary: ladderEntries[0]!.client,
      secondary: ladderEntries[1]!.client,
      hedgeAfterMs: ctx.hedgeAfterMs ?? 1500,
    });
    response = result.response;
    wasHedged = result.wasHedged;
    fallbackDepth = result.winner === 'primary' ? 0 : 1;
  } else {
    const result = await runFallback(baseRequest, ladderEntries, {});
    response = result.response;
    fallbackDepth = result.depth;
  }

  // 5. CoVe verification (optional).
  let verificationScore = 1.0;
  if (options.cove === true && ctx.cove !== undefined) {
    const coveResult = await runCove(response, baseRequest, ctx.cove);
    verificationScore = coveResult.verificationScore;
  }

  // 6. Post-flight charge.
  const { chargedUsd } = await postflightCharge(
    response,
    { tenantId: req.tenantId, conversationId: ctx.conversationId },
    ctx.costCap.ledger
  );

  // 7. Log drift event.
  const confidence = (consistency + verificationScore) / 2;
  await logDrift(
    {
      task: req.task,
      request: baseRequest,
      response,
      confidence,
      costUsd: chargedUsd,
      tenantId: req.tenantId,
      conversationId: ctx.conversationId,
      fallbackDepth,
      cascadeSteps: 1,
      wasHedged,
    },
    ctx.driftSink
  );

  // Optionally enforce per-call cap.
  if (options.costCapUsd !== undefined && chargedUsd > options.costCapUsd) {
    throw new BrainLLMError({
      code: 'COST_CAP_EXCEEDED',
      message: `per-call cap $${options.costCapUsd} exceeded ($${chargedUsd.toFixed(4)} actual)`,
      retryable: false,
    });
  }

  return {
    response,
    modelUsed: response.model,
    fallbackDepth,
    consistency,
    verificationScore,
    costUsd: chargedUsd,
    wasHedged,
    compiledPromptUsed: compiledPromptUsed !== undefined,
    wasEnsemble,
    ...(economyNote !== undefined ? { economyNote } : {}),
    ladderSource: ladderResolution.source,
  };
}

async function tryLoadCompiledPrompt(
  cache: PromptCache,
  taskName: string,
  model: ModelTier
): Promise<CompiledPrompt | undefined> {
  try {
    return await cache.load(taskName, model);
  } catch (err) {
    if (err instanceof PromptCacheMissError) return undefined;
    throw err;
  }
}

/** Helper: estimate cost without invoking (orchestrator + callers reuse). */
export function projectCallCost(req: BrainLLMRequest, model: ModelTier): number {
  const pricing = getPricing(model);
  let chars = req.system?.length ?? 0;
  for (const m of req.messages) {
    for (const c of m.content) {
      if (c.type === 'text') chars += c.text.length;
    }
  }
  const inputTokens = Math.ceil(chars / 4);
  const outputTokens = req.maxTokens ?? 4096;
  return computeCost({ inputTokens, outputTokens }, pricing).usd;
}
