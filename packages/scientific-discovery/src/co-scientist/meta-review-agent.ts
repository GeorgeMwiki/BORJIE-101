/**
 * Meta-review agent — Co-Scientist agent #6 of 6.
 *
 * Role: synthesise the tournament + refutation + proximity into a single
 * weekly summary. Per the Google AI Co-Scientist blog, the meta-review
 * agent "writes a final synthesis to inform the next round of generation".
 *
 * Pure function — the LLM is asked for plain-English prose.
 */

import type { LLMClient, RankedHypothesis } from '../types.js';
import type { ReflectionVerdict } from './reflection-agent.js';
import type { ProximityLink } from './proximity-agent.js';

export interface MetaReviewInput {
  readonly runId: string;
  readonly ranked: readonly RankedHypothesis[];
  readonly reflections: readonly ReflectionVerdict[];
  readonly proximityLinks: readonly ProximityLink[];
  readonly llm: LLMClient;
}

export interface MetaReview {
  readonly runId: string;
  readonly summary: string;
  readonly topThreeIds: readonly string[];
  readonly nextSeeds: readonly string[];
}

export async function metaReview(input: MetaReviewInput): Promise<MetaReview> {
  const top = input.ranked.slice(0, 3);
  const topIds = top.map((r) => r.hypothesis.id);

  const bullets = top.map((r) => {
    const refl = input.reflections.find((x) => x.hypothesisId === r.hypothesis.id);
    const reflScore = refl ? refl.score.toFixed(2) : 'n/a';
    return `- [${r.elo.rating.toFixed(0)} Elo, refl=${reflScore}] ${r.hypothesis.statement}`;
  });

  const proximityCount = input.proximityLinks.length;

  const completion = await input.llm.complete({
    system:
      'You are the Meta-Review agent of the Scientific Discovery loop for a ' +
      'property-management SaaS. Write a 4-sentence executive summary of the round, ' +
      'then list 3 NEW seed ideas the system should investigate next. Reply in JSON: ' +
      '{"summary": string, "nextSeeds": string[]}.',
    prompt: [
      `Run id: ${input.runId}`,
      'Top 3 hypotheses:',
      ...bullets,
      `Proximity links found: ${proximityCount}`,
    ].join('\n'),
    maxTokens: 360,
    metadata: { agent: 'meta-review', runId: input.runId },
  });

  const parsed = parseMetaJson(completion.text);

  return {
    runId: input.runId,
    summary: parsed.summary || 'Meta-review: LLM returned no summary.',
    topThreeIds: topIds,
    nextSeeds: parsed.nextSeeds.slice(0, 5),
  };
}

function parseMetaJson(raw: string): { summary: string; nextSeeds: string[] } {
  const trimmed = stripFences(raw);
  try {
    const obj = JSON.parse(trimmed) as { summary?: unknown; nextSeeds?: unknown };
    const summary = typeof obj.summary === 'string' ? obj.summary : '';
    const nextSeeds = Array.isArray(obj.nextSeeds)
      ? obj.nextSeeds.filter((s): s is string => typeof s === 'string')
      : [];
    return { summary, nextSeeds };
  } catch {
    return { summary: '', nextSeeds: [] };
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
