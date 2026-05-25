/**
 * Reflection agent — Co-Scientist agent #2 of 6.
 *
 * Role: peer-review each generated hypothesis. Returns a methodological
 * score in [0, 1] per hypothesis plus a one-sentence critique.
 *
 * Pure function over (hypotheses, llmClient).
 */

import type { Hypothesis, LLMClient } from '../types.js';

export interface ReflectionVerdict {
  readonly hypothesisId: string;
  readonly score: number;
  readonly critique: string;
}

export async function reflectOnHypotheses(
  hypotheses: readonly Hypothesis[],
  llm: LLMClient,
): Promise<readonly ReflectionVerdict[]> {
  const out: ReflectionVerdict[] = [];
  for (const h of hypotheses) {
    const verdict = await reflectOne(h, llm);
    out.push(verdict);
  }
  return out;
}

async function reflectOne(h: Hypothesis, llm: LLMClient): Promise<ReflectionVerdict> {
  const completion = await llm.complete({
    system:
      'You are a senior causal-inference reviewer. Score the methodological soundness ' +
      'of a property-management hypothesis from 0.00 to 1.00. Reply ONLY in JSON: ' +
      '{"score": number, "critique": string}.',
    prompt: [
      `Statement: ${h.statement}`,
      `Treatment: ${h.treatment}`,
      `Outcome:   ${h.outcome}`,
      `Confounders: ${h.confounders.join(', ') || '(none)'}`,
      `Area:      ${h.area}`,
    ].join('\n'),
    maxTokens: 220,
    metadata: { agent: 'reflection', hypothesisId: h.id },
  });
  const parsed = safeParse(completion.text);
  return {
    hypothesisId: h.id,
    score: clamp01(parsed.score),
    critique: parsed.critique.slice(0, 280),
  };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function safeParse(raw: string): { score: number; critique: string } {
  const trimmed = stripFences(raw);
  try {
    const obj = JSON.parse(trimmed) as { score?: unknown; critique?: unknown };
    return {
      score: typeof obj.score === 'number' ? obj.score : 0,
      critique: typeof obj.critique === 'string' ? obj.critique : '',
    };
  } catch {
    return { score: 0, critique: 'reflection-agent: malformed LLM response' };
  }
}

function stripFences(raw: string): string {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence && fence[1]) return fence[1].trim();
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) return raw.slice(first, last + 1);
  return raw.trim();
}
