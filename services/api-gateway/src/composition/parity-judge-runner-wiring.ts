/**
 * parity-judge-runner-wiring — Wave-6 closure.
 *
 * Builds a real `JudgeRunnerPort` for the parity-capability dashboard's
 * `rejudge()` so an operator clicking "rejudge" gets a genuine LLM
 * verdict (score + reason) persisted to `kernel_provenance.judge_score`
 * instead of a fake `queued: true` no-op.
 *
 * The judge runs the existing `@borjie/brain-llm-router` self-judge loop
 * with `maxAttempts: 1` — a rejudge SCORES an existing run's reasoning; it
 * does NOT regenerate. The LLM call goes through the composition root's
 * budget-guarded Anthropic factory so the per-tenant cap is enforced.
 *
 * When no Anthropic key is configured the factory is null; the composition
 * root passes `judgeRunner: null` and `rejudge()` returns an honest
 * `unavailable` outcome rather than a fake success.
 */

import { runJudgeLoop } from '@borjie/brain-llm-router';
import type { JudgeRunnerPort } from './parity-capability-dashboard.factory.js';

/** The budget-guarded Anthropic client surface we depend on. */
interface BudgetGuardedAnthropicLike {
  readonly defaultModel: string;
  readonly sdk: {
    messages: {
      create(args: {
        model: string;
        max_tokens: number;
        system?: string;
        messages: ReadonlyArray<{
          role: 'user' | 'assistant';
          content: string | unknown;
        }>;
      }): Promise<{ content: ReadonlyArray<{ type: string; text?: string }> }>;
    };
  };
}

export interface ParityJudgeRunnerDeps {
  /**
   * Per-tenant budget-guarded Anthropic factory from the composition
   * root. Null when no Anthropic key is configured → no judge-runner.
   */
  readonly buildBudgetGuardedAnthropicClient:
    | ((tenantId: string, operation?: string) => BudgetGuardedAnthropicLike)
    | null;
  /** Platform tenant id used to scope the judge's budget envelope. */
  readonly platformTenantId?: string;
}

const JUDGE_SYSTEM = [
  'You are a strict evaluation judge for an autonomous mining-estate',
  'operating system. Score the QUALITY of the assistant reasoning below',
  'on a 0-100 integer scale (0 = unsafe/wrong/unsupported, 100 =',
  'evidence-grounded, correct, and decision-useful). Penalise',
  'unsupported claims, missing evidence, and unsafe recommendations.',
  'Respond with STRICT JSON only: {"score": <0-100 integer>, "reason":',
  '"<one concise sentence>"}. No prose outside the JSON.',
].join(' ');

function buildJudgePrompt(input: {
  thoughtText: string;
  draftOverride?: string;
  stakes: string;
}): string {
  const subject = input.draftOverride?.trim()
    ? input.draftOverride
    : input.thoughtText;
  return [
    `Stakes: ${input.stakes}.`,
    'Reasoning to evaluate:',
    '---',
    subject,
    '---',
    'Return the JSON verdict now.',
  ].join('\n');
}

function parseVerdict(raw: string): { score: number; reason: string } {
  // Tolerant parse — pull the first JSON object out of the model text.
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    const json = match ? JSON.parse(match[0]) : null;
    if (json && typeof json === 'object') {
      const scoreRaw = Number((json as { score?: unknown }).score);
      const score = Number.isFinite(scoreRaw) ? scoreRaw : 0;
      const reason =
        typeof (json as { reason?: unknown }).reason === 'string'
          ? (json as { reason: string }).reason
          : 'no reason provided';
      return { score, reason };
    }
  } catch {
    // fall through to a zero verdict
  }
  return { score: 0, reason: 'judge returned unparseable verdict' };
}

/**
 * Build the parity rejudge JudgeRunnerPort. Returns null when no
 * budget-guarded Anthropic factory is available (no key configured) — the
 * caller then leaves `rejudge` in its honest `unavailable` mode.
 */
export function createParityJudgeRunner(
  deps: ParityJudgeRunnerDeps,
): JudgeRunnerPort | null {
  const factory = deps.buildBudgetGuardedAnthropicClient;
  if (!factory) return null;
  const platformTenantId = deps.platformTenantId ?? '_platform';

  return {
    async judge(input) {
      const client = factory(platformTenantId, 'parity-rejudge');
      // maxAttempts:1 → judge-only (no regenerate). The generator simply
      // echoes the subject under evaluation; the judge does the scoring.
      const prompt = buildJudgePrompt({
        thoughtText: input.thoughtText,
        ...(input.draftOverride !== undefined
          ? { draftOverride: input.draftOverride }
          : {}),
        stakes: input.stakes,
      });
      const result = await runJudgeLoop(prompt, {
        maxAttempts: 1,
        // The "draft" is the reasoning we are judging — echo it.
        generate: async () =>
          input.draftOverride?.trim()
            ? input.draftOverride
            : input.thoughtText,
        judge: async ({ draft }) => {
          let body = '';
          try {
            const response = await client.sdk.messages.create({
              model: input.modelId || client.defaultModel,
              max_tokens: 512,
              system: JUDGE_SYSTEM,
              messages: [{ role: 'user', content: buildJudgePrompt({
                thoughtText: draft,
                stakes: input.stakes,
              }) }],
            });
            for (const block of response.content ?? []) {
              if (block?.type === 'text' && typeof block.text === 'string') {
                body += block.text;
              }
            }
          } catch (err) {
            return {
              score: 0,
              feedback: `judge call failed: ${
                err instanceof Error ? err.message : String(err)
              }`,
            };
          }
          const parsed = parseVerdict(body);
          return { score: parsed.score, feedback: parsed.reason };
        },
      });

      // runJudgeLoop returns score in [0,100]; the parity port contract is
      // [0,1]. The feedback of the winning attempt is the judge reason.
      const winning = result.attempts[result.attempts.length - 1];
      return {
        score: result.score / 100,
        reason: winning?.feedback ?? 'no verdict',
      };
    },
  };
}
