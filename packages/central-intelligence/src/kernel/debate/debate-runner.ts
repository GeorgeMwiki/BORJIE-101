/**
 * Debate runner — orchestrates 2–3 internal voices arguing different
 * angles, then a synthesiser. Each round, every non-synthesiser voice
 * sees the question, the shared context, its own stance prompt, and
 * the OTHERS' prior-round contributions. The synthesiser sees ALL
 * contributions and emits the final answer.
 *
 * Pure orchestrator over the injected `Sensor` port — no globals,
 * no I/O of its own. Token-budget tracked across the whole debate;
 * exceeded → stop early but the synthesiser still runs on partial.
 *
 * Convergence: jaccard similarity (token-set) of each voice's last
 * two contributions ≥0.8 averaged across non-synthesiser voices →
 * `converged: true`. Single-round debates cannot converge.
 */

import type {
  DebateConfig,
  DebateContribution,
  DebateDeps,
  DebateOutcome,
  DebateVoice,
} from './debate-types.js';
import type { ThoughtRequest } from '../kernel-types.js';
import {
  runThreeAgentDebate,
  type DebateResult,
  type SensorLike,
  type ThreeAgentDebateOptions,
} from './three-agent-debate.js';

const DEFAULT_TOKEN_BUDGET = 4_000;
const CONVERGENCE_THRESHOLD = 0.8;

/**
 * Run a debate. For each round, every non-synthesiser voice gets the
 * question + context + the OTHERS' prior-round contributions. Final
 * step: the synthesiser receives ALL contributions and produces the
 * synthesis text.
 */
export async function runDebate(
  question: string,
  context: string,
  deps: DebateDeps,
  config: DebateConfig,
): Promise<DebateOutcome> {
  if (config.voices.length === 0) {
    throw new Error('runDebate: voices array must not be empty');
  }
  const synthesiser = config.voices.find((v) => v.id === config.synthesiserVoiceId);
  if (!synthesiser) {
    throw new Error(
      `runDebate: synthesiserVoiceId "${config.synthesiserVoiceId}" not present in voices`,
    );
  }
  const debaters = config.voices.filter((v) => v.id !== synthesiser.id);
  if (debaters.length === 0) {
    throw new Error('runDebate: at least one non-synthesiser voice is required');
  }

  const tokenBudget = config.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
  const clock = deps.clock ?? (() => Date.now());

  const contributions: DebateContribution[] = [];
  let tokensSpent = 0;
  let exhaustedBudget = false;

  for (let round = 1; round <= config.maxRounds; round++) {
    if (exhaustedBudget) break;
    for (const voice of debaters) {
      const others = priorRoundOthers(contributions, voice.id, round);
      const userMessage = buildVoicePrompt({
        question,
        context,
        voice,
        priorOthers: others,
        round,
      });
      // Approximate token usage BEFORE the call so we never exceed
      // the budget by more than one voice-turn. Heuristic: chars/4.
      const estimatedInputTokens = Math.ceil(userMessage.length / 4);
      if (tokensSpent + estimatedInputTokens > tokenBudget) {
        exhaustedBudget = true;
        break;
      }
      const start = clock();
      const result = await deps.sensor.call({
        system: voice.stancePrompt,
        userMessage,
        priorTurns: [],
        extendedThinking: false,
        stakes: 'high',
      });
      const latencyMs = Math.max(0, clock() - start);
      const text = result.text ?? '';
      contributions.push({
        voiceId: voice.id,
        round,
        text,
        latencyMs,
      });
      tokensSpent += estimatedInputTokens + Math.ceil(text.length / 4);
      if (tokensSpent >= tokenBudget) {
        exhaustedBudget = true;
        break;
      }
    }
  }

  // Synthesis — always runs even on partial contributions.
  const synthesisPrompt = buildSynthesiserPrompt({
    question,
    context,
    synthesiser,
    contributions,
  });
  const synthStart = clock();
  const synthResult = await deps.sensor.call({
    system: synthesiser.stancePrompt,
    userMessage: synthesisPrompt,
    priorTurns: [],
    extendedThinking: false,
    stakes: 'high',
  });
  const synthLatencyMs = Math.max(0, clock() - synthStart);
  tokensSpent +=
    Math.ceil(synthesisPrompt.length / 4) +
    Math.ceil((synthResult.text ?? '').length / 4);
  contributions.push({
    voiceId: synthesiser.id,
    round: config.maxRounds + 1,
    text: synthResult.text ?? '',
    latencyMs: synthLatencyMs,
  });

  const converged = computeConvergence(contributions, debaters);

  return {
    contributions,
    synthesis: synthResult.text ?? '',
    tokenSpent: tokensSpent,
    converged,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Prompt builders — exposed (lightly) for transparency but kept
// module-internal. Each non-synthesiser voice sees ONLY OTHERS' prior
// contributions, never its own. The synthesiser sees the full record.
// ─────────────────────────────────────────────────────────────────────

interface VoicePromptArgs {
  readonly question: string;
  readonly context: string;
  readonly voice: DebateVoice;
  readonly priorOthers: ReadonlyArray<DebateContribution>;
  readonly round: number;
}

function buildVoicePrompt(args: VoicePromptArgs): string {
  const lines: string[] = [];
  lines.push(`Question:\n${args.question}`);
  lines.push('');
  lines.push(`Context:\n${args.context || '(none)'}`);
  lines.push('');
  lines.push(`You are: ${args.voice.displayName} (round ${args.round}).`);
  if (args.priorOthers.length > 0) {
    lines.push('');
    lines.push("Other voices' prior-round contributions:");
    for (const c of args.priorOthers) {
      lines.push(`  - [${c.voiceId} r${c.round}]: ${c.text}`);
    }
  } else {
    lines.push('');
    lines.push('No prior contributions yet — open the argument from your stance.');
  }
  lines.push('');
  lines.push('Argue from your pinned stance. Be concrete. 4–8 sentences.');
  return lines.join('\n');
}

interface SynthesiserPromptArgs {
  readonly question: string;
  readonly context: string;
  readonly synthesiser: DebateVoice;
  readonly contributions: ReadonlyArray<DebateContribution>;
}

function buildSynthesiserPrompt(args: SynthesiserPromptArgs): string {
  const lines: string[] = [];
  lines.push(`Question:\n${args.question}`);
  lines.push('');
  lines.push(`Context:\n${args.context || '(none)'}`);
  lines.push('');
  lines.push(`You are: ${args.synthesiser.displayName} (synthesis step).`);
  if (args.contributions.length === 0) {
    lines.push('');
    lines.push('No contributions were produced (token budget exhausted).');
    lines.push('Answer the question directly from the context, hedging where evidence is missing.');
  } else {
    lines.push('');
    lines.push('Contributions to synthesise:');
    for (const c of args.contributions) {
      lines.push(`  - [${c.voiceId} r${c.round}]: ${c.text}`);
    }
  }
  lines.push('');
  lines.push(
    'Produce a final answer that acknowledges the strongest point from each voice.',
  );
  lines.push('End with a single recommended action.');
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Return the prior-ROUND contributions of every voice OTHER than
 * `selfId`. "Prior" here means rounds strictly less than `currentRound`.
 * Same-round contributions from voices that already spoke this round
 * are intentionally excluded so each voice in a round argues against a
 * stable snapshot of the prior round, not a moving target.
 */
function priorRoundOthers(
  contributions: ReadonlyArray<DebateContribution>,
  selfId: string,
  currentRound: number,
): ReadonlyArray<DebateContribution> {
  return contributions.filter(
    (c) => c.voiceId !== selfId && c.round < currentRound,
  );
}

/**
 * Average jaccard similarity across each non-synthesiser voice's
 * last two contributions. Returns true iff that average ≥ threshold.
 * If any voice has fewer than two contributions, convergence is false.
 */
function computeConvergence(
  contributions: ReadonlyArray<DebateContribution>,
  debaters: ReadonlyArray<DebateVoice>,
): boolean {
  if (debaters.length === 0) return false;
  const scores: number[] = [];
  for (const voice of debaters) {
    const own = contributions.filter((c) => c.voiceId === voice.id);
    if (own.length < 2) return false;
    const last = own[own.length - 1]!;
    const prev = own[own.length - 2]!;
    scores.push(jaccard(tokenSet(last.text), tokenSet(prev.text)));
  }
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return avg >= CONVERGENCE_THRESHOLD;
}

function tokenSet(s: string): ReadonlySet<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 0),
  );
}

function jaccard(
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// ─────────────────────────────────────────────────────────────────────
// Stakes-aware dispatcher — the default deliberation entry point for
// the kernel's post-judge gate. High / critical stakes (with
// `costSensitive=false`) route to the 3-agent debate; low / medium
// stakes (or cost-sensitive callers) bypass the debate and return the
// single-agent sensor output.
// ─────────────────────────────────────────────────────────────────────

export type DispatchedDebateMode = 'single-agent' | 'three-agent';

export interface RunStakesAwareDebateOptions extends ThreeAgentDebateOptions {
  /**
   * When true, the dispatcher SKIPS the three-agent path even at
   * stakes ≥ high — used when the caller has signalled cost pressure
   * (rate limit, budget circuit, low-fee surface). Default: false.
   */
  readonly costSensitive?: boolean;
}

export interface StakesAwareDebateResult {
  readonly mode: DispatchedDebateMode;
  readonly synthesis: string;
  readonly proposal?: string;
  readonly criticism?: string;
  readonly tokensUsed: number;
  readonly latencyMs: number;
  readonly convergence?: number;
}

/**
 * Stakes-gated deliberation dispatch.
 *
 *   - `stakes ∈ {high, critical}` AND `!costSensitive` → 3-agent debate
 *     (Proposer → Critic → Synthesizer). Constitutional rules are
 *     surfaced to the critic when supplied via `options.constitutionalRules`.
 *   - otherwise → single-agent: a single sensor call with the same
 *     question + context, surfaced as the synthesis.
 *
 * Pure orchestrator — every side-effect routes through the injected
 * sensor.
 */
export async function runStakesAwareDebate(
  question: string,
  stakes: ThoughtRequest['stakes'],
  context: string,
  sensor: SensorLike,
  options: RunStakesAwareDebateOptions = {},
): Promise<StakesAwareDebateResult> {
  const wantsThreeAgent =
    (stakes === 'high' || stakes === 'critical') && options.costSensitive !== true;

  if (wantsThreeAgent) {
    const result: DebateResult = await runThreeAgentDebate(
      question,
      context,
      sensor,
      options,
    );
    return {
      mode: 'three-agent',
      synthesis: result.synthesis,
      proposal: result.proposal,
      criticism: result.criticism,
      tokensUsed: result.tokensUsed,
      latencyMs: result.latencyMs,
      convergence: result.convergence,
    };
  }

  // Single-agent fallback for low / medium / cost-sensitive callers.
  const clock = options.clock ?? (() => Date.now());
  const start = clock();
  const userMessage = buildSingleAgentPrompt(question, context);
  const out = await sensor.call({
    system: SINGLE_AGENT_SYSTEM,
    systemPrompt: SINGLE_AGENT_SYSTEM,
    userMessage,
    priorTurns: [],
    extendedThinking: false,
    stakes,
  });
  const text = (out.text ?? '').trim();
  const latencyMs = Math.max(0, clock() - start);
  const tokensUsed =
    Math.ceil(SINGLE_AGENT_SYSTEM.length / 4) +
    Math.ceil(userMessage.length / 4) +
    Math.ceil(text.length / 4);
  return {
    mode: 'single-agent',
    synthesis: text,
    tokensUsed,
    latencyMs,
  };
}

const SINGLE_AGENT_SYSTEM =
  'You are a property-management assistant. Answer the question using the context. ' +
  'Cite concrete numbers from the context when present. End with a single recommended action.';

function buildSingleAgentPrompt(question: string, context: string): string {
  return [
    `Question:\n${question}`,
    '',
    `Context:\n${context || '(none)'}`,
    '',
    'Answer the question with concrete reasoning.',
  ].join('\n');
}

// The three-agent surface (`runThreeAgentDebate`, `DebateResult`,
// `SensorLike`, `ThreeAgentDebateOptions`, `ConstitutionRulePrompt`)
// is exported through the debate `index.ts` barrel — callers should
// reach for `./debate` rather than `./debate/three-agent-debate`
// directly. The imports above pull the bindings into this module so
// `runStakesAwareDebate` can call them.
