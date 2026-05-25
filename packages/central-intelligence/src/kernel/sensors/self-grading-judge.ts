/**
 * Self-grading judge — Phase D / D12.6.
 *
 * A second pass of the SAME model asks: "is this YOUR previous answer
 * good enough to ship?". It is deliberately separate from the standard
 * `anthropic-judge.ts` because:
 *
 *   - the system prompt frames the model as the AUTHOR of the draft
 *     (not a third-party reviewer). Self-grading is a different cognitive
 *     posture; ego-protective bias is partly addressed by an explicit
 *     "if you would not ship this to a regulator, mark it `kill`" clause.
 *
 *   - the return shape carries an explicit ship-or-kill verdict, not just
 *     a numeric score. The kernel folds the verdict into the regen loop
 *     differently from the third-party score (kill → regen; ship-with-
 *     reservations → soften; ship → pass through).
 *
 * Pure adapter; provider-agnostic; the kernel never touches the SDK.
 */

import { getModelLatest } from '@borjie/brain-llm-router/dynamic-registry';
import type { AnthropicMessagesClient } from './anthropic-sensor.js';

export type SelfGradeVerdict =
  | 'ship'
  | 'ship-with-reservations'
  | 'kill';

export interface SelfGradeResult {
  readonly verdict: SelfGradeVerdict;
  /** Score on [0, 1] — `kill` typically returns < 0.5. */
  readonly score: number;
  /** One short sentence (≤ 25 words) the model writes about its own draft. */
  readonly rationale: string;
  /** Concrete imperative the model would give itself to fix the draft. Empty when verdict is `ship`. */
  readonly suggestedRewrite: string;
}

export interface SelfGradingJudgeConfig {
  readonly modelId?: string;
  readonly maxTokens?: number;
}

const DEFAULT_MODEL = getModelLatest('haiku');

const SELF_GRADING_SYSTEM_PROMPT = `You are reviewing YOUR OWN previous answer for a property-management AI. Ask yourself: "Would I be comfortable shipping this to a regulator?"

Return EXACTLY this JSON object:
{"verdict": "ship" | "ship-with-reservations" | "kill", "score": NUMBER, "rationale": STRING, "suggestedRewrite": STRING}

Verdict definitions:
  - "ship": every claim is grounded, the tone matches a property-ops voice, and a regulator would have no questions. score ≥ 0.85.
  - "ship-with-reservations": broadly correct but at least one hedge is missing, OR an uncited number snuck in. score 0.55 - 0.84.
  - "kill": at least one fabrication, off-topic claim, or unsupported certainty. ALSO use "kill" for any answer you would not ship to a regulator. score < 0.55.

"rationale" — ONE sentence (≤ 25 words). Use first person; be honest about your draft's weakest part.
"suggestedRewrite" — ONE imperative sentence. Empty string when verdict is "ship".

Return ONLY the JSON object. No markdown. No commentary.`;

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function parseSelfGrade(body: string): SelfGradeResult {
  const match = body.match(/\{[\s\S]*\}/);
  if (!match) {
    return {
      verdict: 'ship',
      score: 1,
      rationale: '',
      suggestedRewrite: '',
    };
  }
  try {
    const obj = JSON.parse(match[0]) as {
      verdict?: unknown;
      score?: unknown;
      rationale?: unknown;
      suggestedRewrite?: unknown;
    };
    const verdictRaw = typeof obj.verdict === 'string' ? obj.verdict : 'ship';
    const verdict: SelfGradeVerdict =
      verdictRaw === 'kill' || verdictRaw === 'ship-with-reservations'
        ? verdictRaw
        : 'ship';
    const scoreN = Number(obj.score);
    return {
      verdict,
      score: clamp01(Number.isFinite(scoreN) ? scoreN : 1),
      rationale: typeof obj.rationale === 'string' ? obj.rationale : '',
      suggestedRewrite:
        typeof obj.suggestedRewrite === 'string' ? obj.suggestedRewrite : '',
    };
  } catch {
    return {
      verdict: 'ship',
      score: 1,
      rationale: '',
      suggestedRewrite: '',
    };
  }
}

export function createSelfGradingJudge(
  client: AnthropicMessagesClient,
  config: SelfGradingJudgeConfig = {},
): (text: string) => Promise<SelfGradeResult> {
  const modelId = config.modelId ?? DEFAULT_MODEL;
  const maxTokens = config.maxTokens ?? 512;

  return async function selfGrade(text: string): Promise<SelfGradeResult> {
    if (!text.trim()) {
      return {
        verdict: 'kill',
        score: 0,
        rationale: 'my draft is empty.',
        suggestedRewrite: 'Produce a response — the draft is empty.',
      };
    }
    try {
      const response = await client.messages.create({
        model: modelId,
        max_tokens: maxTokens,
        system: SELF_GRADING_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Your previous draft answer:\n\n${text}\n\nReturn the JSON object now.`,
          },
        ],
      });
      let body = '';
      for (const block of response.content) {
        if (block.type === 'text' && typeof block.text === 'string') body += block.text;
      }
      return parseSelfGrade(body);
    } catch {
      // A self-grade failure must not break the main turn; fall back to
      // a neutral "ship" so the kernel does not regen on a transient
      // judge error.
      return {
        verdict: 'ship',
        score: 1,
        rationale: '',
        suggestedRewrite: '',
      };
    }
  };
}

/** Pure helper exported for test coverage. */
export const __test = { parseSelfGrade, SELF_GRADING_SYSTEM_PROMPT };
