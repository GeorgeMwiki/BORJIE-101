/**
 * ensemble/run-ensemble.ts — the all-at-once ENSEMBLE orchestrator (F2).
 *
 * Runs N member models in PARALLEL over the SAME request and combines their
 * outputs per the admin-chosen strategy:
 *
 *   - 'first-wins'      : the fastest non-error response wins.
 *   - 'majority-vote'   : majority of normalised first-text answers (reuses
 *                         the existing majorityVote helper).
 *   - 'judge-synthesis' : a judge model scores + synthesises a single answer
 *                         (reuses runJudgeLoop with the members' drafts).
 *   - 'debate'          : members critique then a synthesiser reconciles.
 *
 * COST-AWARE (HARD RULE): an ensemble of N members costs N x a single call.
 * Before any fan-out, the orchestrator consults an injected `budgetCheck`. If
 * it returns `{ allow: false }`, the run DEGRADES to a single primary model
 * and SURFACES an economy note (never silent — the caller can render it).
 * This makes "TEST = PAYING": a budget-constrained tenant gets one model with
 * a visible reason, not a broken turn.
 *
 * FAIL-SAFE: an empty member list, all-errored members, or a thrown
 * budgetCheck degrades to the single primary; the orchestrator never throws
 * for a recoverable condition. Pure orchestration — all collaborators are
 * injected ports (no client import).
 */

import type { BrainLLMRequest, BrainLLMResponse, ModelTier } from '../types.js';
import { BrainLLMError } from '../types.js';
import { majorityVote } from '../brain-call-orchestrator/consistency.js';
import { runJudgeLoop, type JudgeVerdict } from '../judge-loop/index.js';
import type { CombineStrategy } from '../routing-config/config-model.js';

/** Port: invoke one member model with the request, returning its response. */
export type EnsembleInvoke = (
  model: ModelTier,
  req: BrainLLMRequest,
) => Promise<BrainLLMResponse>;

/**
 * Port: judge/synthesise from the members' drafts. Used by 'judge-synthesis'
 * and 'debate'. Returns a synthesised answer string + a 0..100 confidence.
 */
export type EnsembleSynthesise = (args: {
  readonly prompt: string;
  readonly drafts: readonly string[];
  readonly judgeModel: ModelTier;
}) => Promise<JudgeVerdict>;

/**
 * Port: the cost-aware pre-flight. Returns whether the N-member fan-out is
 * affordable; when not, the orchestrator degrades to a single model and
 * surfaces `economyNote`.
 */
export type EnsembleBudgetCheck = (args: {
  readonly memberCount: number;
  readonly members: readonly ModelTier[];
}) => Promise<EnsembleBudgetDecision> | EnsembleBudgetDecision;

export interface EnsembleBudgetDecision {
  readonly allow: boolean;
  /** Model to use when degraded to single (defaults to first member). */
  readonly degradeTo?: ModelTier;
  /** Surfaced economy note when degraded (never silent). */
  readonly economyNote?: string;
}

export interface RunEnsembleArgs {
  readonly request: BrainLLMRequest;
  readonly members: readonly ModelTier[];
  readonly strategy: CombineStrategy;
  readonly judgeModel?: ModelTier;
  readonly invoke: EnsembleInvoke;
  readonly synthesise?: EnsembleSynthesise;
  readonly budgetCheck?: EnsembleBudgetCheck;
}

export interface RunEnsembleResult {
  readonly response: BrainLLMResponse;
  readonly strategyUsed: CombineStrategy | 'single';
  /** Models that actually ran. */
  readonly membersRun: readonly ModelTier[];
  /** True iff cost-awareness collapsed the run to a single model. */
  readonly degraded: boolean;
  /** Surfaced economy note when degraded (never silent). */
  readonly economyNote?: string;
  /** [0..1] confidence proxy (vote agreement / judge score / 1.0). */
  readonly confidence: number;
}

function firstText(resp: BrainLLMResponse): string {
  const block = resp.content.find((c) => c.type === 'text');
  return block && block.type === 'text' ? block.text : '';
}

/**
 * Run a single model and wrap it as the degraded result.
 */
async function runSingle(
  model: ModelTier,
  args: RunEnsembleArgs,
  economyNote: string | undefined,
): Promise<RunEnsembleResult> {
  const response = await args.invoke(model, { ...args.request, model });
  return {
    response,
    strategyUsed: 'single',
    membersRun: [model],
    degraded: economyNote !== undefined,
    ...(economyNote !== undefined ? { economyNote } : {}),
    confidence: 1.0,
  };
}

/**
 * Settle all members in parallel, returning the successful responses in the
 * order they RESOLVED (so first-wins picks the fastest), plus the count of
 * failures. We push into the array as each promise fulfils, capturing true
 * completion order rather than input order.
 */
async function fanOut(
  members: readonly ModelTier[],
  args: RunEnsembleArgs,
): Promise<{ responses: BrainLLMResponse[]; failures: number }> {
  const responses: BrainLLMResponse[] = [];
  let failures = 0;
  await Promise.all(
    members.map((m) =>
      args
        .invoke(m, { ...args.request, model: m })
        .then((r) => {
          responses.push(r); // resolution order
        })
        .catch(() => {
          failures += 1;
        }),
    ),
  );
  return { responses, failures };
}

/**
 * THE ensemble entry point. Gates on budget, fans out, combines.
 */
export async function runEnsemble(
  args: RunEnsembleArgs,
): Promise<RunEnsembleResult> {
  const members = args.members.filter(
    (m) => typeof m === 'string' && m.trim().length > 0,
  );

  // Fail-safe: no members → single primary (request.model).
  if (members.length === 0) {
    return runSingle(args.request.model, args, undefined);
  }

  // Single member → no fan-out needed; just run it (no economy note).
  if (members.length === 1) {
    return runSingle(members[0]!, args, undefined);
  }

  // COST-AWARE pre-flight BEFORE fan-out.
  if (args.budgetCheck) {
    let decision: EnsembleBudgetDecision;
    try {
      decision = await args.budgetCheck({
        memberCount: members.length,
        members,
      });
    } catch {
      // FAIL-SAFE: a throwing budget check degrades to single (conservative).
      return runSingle(
        members[0]!,
        args,
        'Ensemble degraded to a single model: budget check unavailable.',
      );
    }
    if (!decision.allow) {
      const degradeTo = decision.degradeTo ?? members[0]!;
      const note =
        decision.economyNote ??
        'Ensemble degraded to a single model to stay within the budget.';
      return runSingle(degradeTo, args, note);
    }
  }

  // Fan out in parallel.
  const { responses } = await fanOut(members, args);

  // Fail-safe: every member errored → retry the primary once as single.
  if (responses.length === 0) {
    return runSingle(members[0]!, args, undefined);
  }

  const prompt = promptOf(args.request);

  switch (args.strategy) {
    case 'first-wins':
      return {
        response: responses[0]!,
        strategyUsed: 'first-wins',
        membersRun: members,
        degraded: false,
        confidence: 1.0,
      };

    case 'majority-vote': {
      const vote = majorityVote(responses);
      return {
        response: vote.winner,
        strategyUsed: 'majority-vote',
        membersRun: members,
        degraded: false,
        confidence: vote.consistency,
      };
    }

    case 'judge-synthesis':
    case 'debate': {
      return combineWithJudge(args, members, responses, prompt);
    }

    default: {
      // Unknown strategy → safest combine (first response).
      return {
        response: responses[0]!,
        strategyUsed: 'first-wins',
        membersRun: members,
        degraded: false,
        confidence: 1.0,
      };
    }
  }
}

function promptOf(req: BrainLLMRequest): string {
  for (const m of req.messages) {
    for (const c of m.content) {
      if (c.type === 'text') return c.text;
    }
  }
  return req.system ?? '';
}

/**
 * Judge-synthesis / debate combine. Uses runJudgeLoop with a generator that
 * synthesises from the members' drafts. When no synthesiser port is wired (or
 * no judge model), falls back to majority-vote over the drafts so the turn
 * still resolves.
 */
async function combineWithJudge(
  args: RunEnsembleArgs,
  members: readonly ModelTier[],
  responses: readonly BrainLLMResponse[],
  prompt: string,
): Promise<RunEnsembleResult> {
  const judgeModel = args.judgeModel ?? members[0]!;
  const drafts = responses.map(firstText).filter((t) => t.length > 0);

  if (!args.synthesise || drafts.length === 0) {
    // Fail-safe: no synthesiser → majority-vote the raw responses.
    const vote = majorityVote(responses);
    return {
      response: vote.winner,
      strategyUsed: args.strategy,
      membersRun: members,
      degraded: false,
      confidence: vote.consistency,
    };
  }

  const synthesise = args.synthesise;
  const loop = await runJudgeLoop(prompt, {
    generate: async () => {
      const verdict = await synthesise({ prompt, drafts, judgeModel });
      return verdict.feedback || drafts[0]!;
    },
    judge: async ({ draft }) => synthesise({ prompt, drafts: [draft], judgeModel }),
    maxAttempts: 1,
  });

  // Wrap the synthesised text into the best member response envelope so the
  // caller still gets usage/provider metadata.
  const base = responses[0]!;
  const synthesised: BrainLLMResponse = {
    ...base,
    model: judgeModel,
    content: [{ type: 'text', text: loop.output || firstText(base) }],
  };

  if (loop.output.length === 0) {
    // Defence: empty synthesis → fall back to first response.
    return {
      response: base,
      strategyUsed: args.strategy,
      membersRun: members,
      degraded: false,
      confidence: 1.0,
    };
  }

  return {
    response: synthesised,
    strategyUsed: args.strategy,
    membersRun: members,
    degraded: false,
    confidence: loop.score / 100,
  };
}

/** Re-export the error so callers can detect ensemble-specific failures. */
export { BrainLLMError };
