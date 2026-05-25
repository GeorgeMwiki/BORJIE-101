/**
 * Haiku-backed evaluator for the weekly GEPA recompile.
 *
 * Phase C — C7. Pairs with `claude-mutator.ts`: the mutator emits
 * candidate variants, this evaluator scores each candidate against a
 * golden case on a 0..1 scale. Haiku is used because:
 *
 *   1. The evaluator runs N * iterations times per recompile, so cost
 *      matters far more than reasoning depth.
 *   2. The task ("is this candidate close to the expected output?") is
 *      a classic LLM-judge job — Haiku is well-tuned for it.
 *
 * Fallback (no client): a heuristic blends length similarity and
 * capability-keyword overlap and returns a score BOUNDED at 0.5 ± 0.1.
 * The bounding is critical: an unbounded heuristic would let the GEPA
 * loop "optimise" toward heuristic-friendly prompts that score well on
 * length similarity but poorly with humans. By compressing the
 * heuristic range, we ensure that whenever a real evaluator is wired,
 * its signal dominates; when not wired, no candidate ever beats the
 * baseline by more than 0.2, and the Pareto-improvement gate naturally
 * rejects most mutations.
 */

import { getModelLatest } from '@borjie/brain-llm-router/dynamic-registry';

export interface GoldenCase {
  readonly id: string;
  readonly input: string;
  readonly expectedOutput: string;
  readonly capability: string;
}

// Same duck-typed surface as the mutator — the composition root passes
// in a SINGLE wrapped client and the breakers are shared.
export interface ClaudeMessagesClient {
  messages: {
    create(args: {
      model: string;
      max_tokens: number;
      system: string;
      messages: ReadonlyArray<{ role: 'user'; content: string }>;
    }): Promise<{
      readonly content: ReadonlyArray<{ type: string; text?: string }>;
    }>;
  };
}

export interface HaikuEvaluatorArgs {
  readonly candidatePrompt: string;
  readonly goldenCase: GoldenCase;
  readonly expectedOutput: string;
}

export interface HaikuEvaluatorOutcome {
  readonly score: number;
  readonly reasoning: string;
}

export interface HaikuEvaluator {
  score(args: HaikuEvaluatorArgs): Promise<HaikuEvaluatorOutcome>;
}

export interface HaikuEvaluatorDeps {
  readonly anthropicClient: ClaudeMessagesClient | null;
  readonly model?: string;
  readonly maxTokens?: number;
}

export const DEFAULT_EVALUATOR_MODEL = getModelLatest('haiku');
const DEFAULT_MAX_TOKENS = 512;

/** Heuristic range — see header doc for rationale. */
export const HEURISTIC_CENTER = 0.5;
export const HEURISTIC_HALF_RANGE = 0.1;

export const EVALUATOR_SYSTEM_PROMPT = [
  'You are an evaluator scoring whether a candidate prompt, when applied to a',
  'property-management AI agent, would produce an output close to the expected output.',
  '',
  'Return STRICT JSON: {"score": <0..1 number>, "reasoning": "<one sentence>"}.',
  'A score of 1.0 means the candidate would almost certainly produce the expected output.',
  'A score of 0.0 means the candidate would almost certainly fail this case.',
  'Be calibrated — most candidates should land between 0.3 and 0.8.',
].join('\n');

export function createHaikuEvaluator(
  deps: HaikuEvaluatorDeps,
): HaikuEvaluator {
  const client = deps.anthropicClient;
  const model = deps.model ?? DEFAULT_EVALUATOR_MODEL;
  const maxTokens = deps.maxTokens ?? DEFAULT_MAX_TOKENS;

  return {
    async score(args) {
      if (!client) {
        return heuristicScore(args);
      }
      try {
        const userPrompt = buildEvaluatorUserPrompt(args);
        const response = await client.messages.create({
          model,
          max_tokens: maxTokens,
          system: EVALUATOR_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt }],
        });
        let body = '';
        for (const block of response.content ?? []) {
          if (block.type === 'text' && typeof block.text === 'string') {
            body += block.text;
          }
        }
        const parsed = parseEvaluatorResponse(body);
        if (parsed) return parsed;
        return heuristicScore(args);
      } catch (error) {
        return {
          score: HEURISTIC_CENTER,
          reasoning: `evaluator error: ${asMessage(error)} — defaulting to center`,
        };
      }
    },
  };
}

export function buildEvaluatorUserPrompt(args: HaikuEvaluatorArgs): string {
  return [
    `Capability: ${args.goldenCase.capability}`,
    `Golden case id: ${args.goldenCase.id}`,
    '',
    'CANDIDATE PROMPT:',
    '"""',
    args.candidatePrompt,
    '"""',
    '',
    `INPUT: ${args.goldenCase.input}`,
    `EXPECTED OUTPUT: ${args.expectedOutput}`,
    '',
    'Score on a 0..1 scale.',
  ].join('\n');
}

export function parseEvaluatorResponse(
  body: string,
): HaikuEvaluatorOutcome | null {
  const trimmed = (body ?? '').trim();
  if (!trimmed) return null;
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const obj = JSON.parse(jsonMatch[0]) as {
      score?: unknown;
      reasoning?: unknown;
    };
    const rawScore = typeof obj.score === 'number' ? obj.score : NaN;
    if (!Number.isFinite(rawScore)) return null;
    const clamped = clampUnit(rawScore);
    const reasoning =
      typeof obj.reasoning === 'string' && obj.reasoning.trim()
        ? obj.reasoning.trim()
        : 'no reasoning supplied';
    return { score: clamped, reasoning };
  } catch {
    return null;
  }
}

/**
 * Heuristic fallback. Returns a score in
 * `[HEURISTIC_CENTER - HEURISTIC_HALF_RANGE, HEURISTIC_CENTER + HEURISTIC_HALF_RANGE]`
 * computed from:
 *   - keyword overlap between candidate and expected output
 *   - length-similarity between candidate and expected output
 *
 * Bounded so it can't dominate a real evaluator's signal when wired.
 */
export function heuristicScore(args: HaikuEvaluatorArgs): HaikuEvaluatorOutcome {
  const cand = (args.candidatePrompt ?? '').toLowerCase();
  const expected = (args.expectedOutput ?? '').toLowerCase();
  const capability = (args.goldenCase.capability ?? '').toLowerCase();

  const expectedTokens = tokenise(expected);
  const candTokens = new Set(tokenise(cand));
  let overlap = 0;
  for (const t of expectedTokens) {
    if (candTokens.has(t)) overlap += 1;
  }
  const overlapRatio =
    expectedTokens.length === 0 ? 0 : overlap / expectedTokens.length;

  const capabilityHit = capability && cand.includes(capability) ? 1 : 0;

  const lenA = cand.length;
  const lenB = expected.length;
  const lenSim =
    lenA === 0 && lenB === 0
      ? 1
      : 1 - Math.abs(lenA - lenB) / Math.max(lenA, lenB, 1);

  // Combine into a 0..1 unbounded blend, then squash to ±half-range.
  const raw = 0.5 * overlapRatio + 0.3 * lenSim + 0.2 * capabilityHit;
  const offset = (raw - 0.5) * 2 * HEURISTIC_HALF_RANGE; // map [0,1] → [-half, +half]
  const score = clampUnit(HEURISTIC_CENTER + offset);
  return {
    score,
    reasoning: `heuristic: overlap=${overlapRatio.toFixed(2)} lenSim=${lenSim.toFixed(2)} capabilityHit=${capabilityHit}`,
  };
}

function tokenise(s: string): ReadonlyArray<string> {
  return s
    .split(/[^a-z0-9]+/i)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 2);
}

function clampUnit(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
