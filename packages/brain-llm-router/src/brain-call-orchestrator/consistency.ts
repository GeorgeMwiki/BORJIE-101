/**
 * Self-Consistency vote helper (M-B pattern, but implemented locally here
 * so the orchestrator can call it without a hard dependency on M-B).
 *
 * Pattern (research §7 #5): take N samples of a response; majority-vote
 * the first text block (lowercased + trimmed). Confidence = winning
 * count / N. Cheap accuracy lift — turns Haiku into Sonnet at ~3x cost.
 */

import type { BrainLLMResponse } from '../types.js';

export interface VoteResult {
  readonly winner: BrainLLMResponse;
  readonly consistency: number; // [0..1] winning count / N
  readonly samples: number;
}

export function majorityVote(samples: readonly BrainLLMResponse[]): VoteResult {
  if (samples.length === 0) {
    throw new Error('majorityVote: samples must be non-empty');
  }
  if (samples.length === 1) {
    return { winner: samples[0]!, consistency: 1, samples: 1 };
  }

  const counts = new Map<string, { count: number; sample: BrainLLMResponse }>();
  for (const s of samples) {
    const key = normaliseFirstText(s);
    const existing = counts.get(key);
    if (existing === undefined) {
      counts.set(key, { count: 1, sample: s });
    } else {
      existing.count += 1;
    }
  }
  let best: { count: number; sample: BrainLLMResponse } | undefined;
  for (const [, value] of counts) {
    if (best === undefined || value.count > best.count) best = value;
  }
  if (best === undefined) {
    return { winner: samples[0]!, consistency: 0, samples: samples.length };
  }
  return {
    winner: best.sample,
    consistency: best.count / samples.length,
    samples: samples.length,
  };
}

function normaliseFirstText(resp: BrainLLMResponse): string {
  const first = resp.content.find((c) => c.type === 'text');
  if (first === undefined || first.type !== 'text') return '';
  return first.text.trim().toLowerCase();
}
