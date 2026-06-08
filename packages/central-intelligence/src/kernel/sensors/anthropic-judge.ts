/**
 * Anthropic Haiku judge — LLM-as-judge for high-stakes decisions.
 *
 * Mirrors LITFIN's self-review judge pass. The kernel passes the
 * sensor's draft answer to the judge, which returns a numeric score
 * in [0,1] indicating how well the answer satisfies the question
 * with citations and clarity. The kernel uses this score in the
 * confidence vector's `review` component.
 *
 * Wave-K parity update: the judge now returns `{score, reasonText,
 * suggestedFix}` so the kernel can bake the rejection feedback into
 * a single regeneration attempt when the score falls below a
 * stakes-driven floor (mirrors LITFIN `brain-kernel.ts:1190-1240`).
 *
 * Pure adapter; the kernel itself stays provider-agnostic.
 *
 * Fail-LOUD contract: a failed judge LLM call — or a response with no
 * parseable numeric score — THROWS `JudgeError`. It must NEVER fabricate a
 * neutral score: the kernel folds the judge into `min(...confidence)`, so a
 * fake 1.0 would silently INFLATE confidence on a dead judge and ship an
 * unverified high-stakes answer. The first judge call in the kernel is
 * unguarded, so the throw surfaces the turn as a loud error (the gateway
 * route maps it to a clean error response). An empty draft still scores 0 —
 * that is a real verdict, not a failure.
 */

import { getModelLatest } from '@borjie/brain-llm-router/dynamic-registry';
import type { AnthropicMessagesClient } from './anthropic-sensor.js';

/**
 * Thrown when the judge LLM call fails or returns no parseable verdict.
 * The loud replacement for the old fabricated neutral-1.0 score.
 */
export class JudgeError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message);
    this.name = 'JudgeError';
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export interface AnthropicJudgeConfig {
  readonly modelId?: string;
  readonly maxTokens?: number;
}

/**
 * D12.7 — 5-C rubric. When the model returns a `rubric` block the
 * judge parses it, clamps each axis to [0,1], and surfaces the
 * weakest axis so the kernel can target regeneration feedback.
 * Drops the rubric (and weakestAxis) when any axis is non-numeric.
 */
export interface JudgeRubric {
  readonly completeness: number;
  readonly correctness: number;
  readonly citations: number;
  readonly consistency: number;
  readonly candor: number;
}

export type JudgeRubricAxis = keyof JudgeRubric;

export interface JudgeVerdict {
  readonly score: number;
  /** Human-readable rationale from the judge (≤ 1-2 sentences). */
  readonly reasonText: string;
  /**
   * Concrete instruction the judge would give the sensor to fix the
   * draft. Used by the kernel as a "regen feedback" baked into the
   * follow-up prompt. Empty string when the judge declines to suggest.
   */
  readonly suggestedFix: string;
  /** 5-C rubric — present only when the model returned a valid block. */
  readonly rubric?: JudgeRubric;
  /** Lowest axis on the rubric — used to focus regen feedback. */
  readonly weakestAxis?: JudgeRubricAxis;
}

const DEFAULT_MODEL = getModelLatest('haiku');

const SYSTEM_PROMPT = `You are a quality judge for mining-estate AI answers. You read a draft answer and return a single JSON object: {"score": NUMBER, "reasonText": STRING, "suggestedFix": STRING, "rubric": {"completeness": NUMBER, "correctness": NUMBER, "citations": NUMBER, "consistency": NUMBER, "candor": NUMBER}}.

The score is in [0, 1]:
  1.0 — every factual claim is grounded; tone matches a mining-ops voice; no fabrication.
  0.7 — mostly grounded; some uncited claims, but no hallucination.
  0.4 — partial grounding; reasonable structure; at least one clear hedge missing.
  0.0 — fabrications, off-topic, or refuses without justification.

The 5-C rubric scores each axis in [0, 1]:
  completeness — covers every part of the question.
  correctness — every claim is right.
  citations   — load-bearing claims are sourced.
  consistency — tone + voice match the mining-ops persona.
  candor      — hedges when uncertain; never fabricates confidence.

"reasonText" is one short sentence (≤ 25 words) explaining the score.
"suggestedFix" is a one-sentence imperative instruction the mining-ops AI could follow to lift the score; empty string if the draft already scores ≥ 0.9.

Return ONLY the JSON object. No markdown. No commentary.`;

const RUBRIC_AXES: ReadonlyArray<JudgeRubricAxis> = [
  'completeness',
  'correctness',
  'citations',
  'consistency',
  'candor',
];

export function createAnthropicJudge(
  client: AnthropicMessagesClient,
  config: AnthropicJudgeConfig = {},
): (text: string) => Promise<JudgeVerdict> {
  const modelId = config.modelId ?? DEFAULT_MODEL;
  const maxTokens = config.maxTokens ?? 512;

  return async function judge(text: string): Promise<JudgeVerdict> {
    if (!text.trim()) {
      return { score: 0, reasonText: 'empty draft', suggestedFix: 'Produce a response — the draft is empty.' };
    }
    try {
      const response = await client.messages.create({
        model: modelId,
        max_tokens: maxTokens,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Draft answer to evaluate:\n\n${text}\n\nReturn the JSON object now.`,
          },
        ],
      });
      let body = '';
      for (const block of response.content) {
        if (block.type === 'text' && typeof block.text === 'string') body += block.text;
      }
      const parsed = parseJudgeResponse(body);
      const verdict: JudgeVerdict = {
        score: clamp01(parsed.score),
        reasonText: parsed.reasonText,
        suggestedFix: parsed.suggestedFix,
        ...(parsed.rubric ? { rubric: parsed.rubric } : {}),
        ...(parsed.weakestAxis ? { weakestAxis: parsed.weakestAxis } : {}),
      };
      return verdict;
    } catch (err) {
      // A judge LLM failure (or an unparseable verdict) is a BUG, not a
      // pass. Faking the neutral 1.0 would silently lift confidence on a
      // dead judge (the kernel takes min(...components)) and ship an
      // unverified high-stakes answer. Throw so the turn fails loudly.
      if (err instanceof JudgeError) throw err;
      throw new JudgeError(
        `anthropic-judge call failed: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  };
}

interface ParsedJudgeBody {
  readonly score: number;
  readonly reasonText: string;
  readonly suggestedFix: string;
  readonly rubric?: JudgeRubric;
  readonly weakestAxis?: JudgeRubricAxis;
}

function parseJudgeResponse(body: string): ParsedJudgeBody {
  // Lenient EXTRACTION (the model may wrap JSON in prose) is fine — but a
  // genuinely unparseable verdict, or one with no numeric score, is a judge
  // failure and THROWS. It must never default to a fabricated perfect score.
  const match = body.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new JudgeError('anthropic-judge returned no parseable JSON verdict');
  }
  let obj: {
    score?: unknown;
    reasonText?: unknown;
    reasons?: unknown;
    suggestedFix?: unknown;
    rubric?: unknown;
  };
  try {
    obj = JSON.parse(match[0]);
  } catch (err) {
    throw new JudgeError('anthropic-judge returned malformed JSON verdict', {
      cause: err,
    });
  }
  const s = Number(obj.score);
  if (!Number.isFinite(s)) {
    throw new JudgeError('anthropic-judge verdict carried no numeric score');
  }
  const reasonText = readReasonText(obj.reasonText, obj.reasons);
  const suggestedFix = typeof obj.suggestedFix === 'string' ? obj.suggestedFix : '';
  const rubric = parseRubric(obj.rubric);
  const weakestAxis = rubric ? findWeakestAxis(rubric) : undefined;
  return {
    score: s,
    reasonText,
    suggestedFix,
    ...(rubric ? { rubric } : {}),
    ...(weakestAxis ? { weakestAxis } : {}),
  };
}

/**
 * Validate + clamp a 5-C rubric block. Returns undefined when any
 * axis is missing or non-numeric — the kernel falls back to the
 * legacy single-score shape.
 */
function parseRubric(raw: unknown): JudgeRubric | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const out: Record<JudgeRubricAxis, number> = {
    completeness: 0,
    correctness: 0,
    citations: 0,
    consistency: 0,
    candor: 0,
  };
  for (const axis of RUBRIC_AXES) {
    const v = r[axis];
    if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
    out[axis] = clamp01(v);
  }
  return out;
}

function findWeakestAxis(rubric: JudgeRubric): JudgeRubricAxis {
  let weakest: JudgeRubricAxis = RUBRIC_AXES[0]!;
  let weakestValue = rubric[weakest];
  for (const axis of RUBRIC_AXES) {
    if (rubric[axis] < weakestValue) {
      weakest = axis;
      weakestValue = rubric[axis];
    }
  }
  return weakest;
}

function readReasonText(reasonText: unknown, reasons: unknown): string {
  if (typeof reasonText === 'string') return reasonText;
  if (Array.isArray(reasons)) {
    const joined = reasons
      .filter((r): r is string => typeof r === 'string')
      .join('; ');
    return joined;
  }
  return '';
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 1;
  return Math.max(0, Math.min(1, x));
}
