/**
 * Intent classifier — Discipline 1, stage 1.
 *
 * Pure-ish classifier with a deterministic keyword floor (mirrors
 * `@borjie/dynamic-ui/intent-recognition`) plus an optional LLM lift
 * for ambiguous utterances. The floor pattern guarantees the kernel
 * never makes a network call for the unambiguous cases.
 *
 * @module @borjie/cognitive-engine/reasoning/intent-classifier
 */

import type { CognitiveLlmPort } from '../types.js';

export interface IntentClassification {
  readonly intent: string;
  readonly confidence: number;
}

/** Keyword bundle for a single intent. */
export interface IntentKeywordPattern {
  readonly intent: string;
  readonly any_of: ReadonlyArray<string>;
  readonly boosters?: ReadonlyArray<string>;
}

/** Default pattern library — the five atomic capabilities + ingest hint. */
export const DEFAULT_INTENT_PATTERNS: ReadonlyArray<IntentKeywordPattern> = [
  {
    intent: 'research',
    any_of: ['research', 'investigate', 'find out', 'look up', 'compare'],
    boosters: ['gold price', 'regulator', 'royalty', 'commodity'],
  },
  {
    intent: 'compose_tab',
    any_of: ['create tab', 'new tab', 'open tab', 'show me a tab'],
  },
  {
    intent: 'compose_doc',
    any_of: ['report', 'document', 'board pack', 'briefing', 'memo'],
  },
  {
    intent: 'compose_media',
    any_of: ['image', 'video', 'illustration', 'render', 'thumbnail'],
  },
  {
    intent: 'compose_campaign',
    any_of: ['campaign', 'launch', 'announce', 'promote'],
  },
  {
    intent: 'ingest_data',
    any_of: ['upload', 'attached', 'from this file', 'in this excel', 'this csv'],
  },
];

const FLOOR_CONFIDENCE = 0.7;

/** Run the keyword floor first; LLM only if no keyword hits. */
export async function classifyIntent(
  utterance: string,
  options?: {
    readonly patterns?: ReadonlyArray<IntentKeywordPattern>;
    readonly llm?: CognitiveLlmPort;
  },
): Promise<IntentClassification> {
  const patterns = options?.patterns ?? DEFAULT_INTENT_PATTERNS;
  const lowered = utterance.toLowerCase();

  let best: IntentClassification = { intent: 'unknown', confidence: 0 };
  for (const p of patterns) {
    const baseHit = p.any_of.some((t) => lowered.includes(t));
    if (!baseHit) continue;
    const boosterHits = (p.boosters ?? []).filter((b) => lowered.includes(b)).length;
    const score = Math.min(1, FLOOR_CONFIDENCE + 0.1 * boosterHits);
    if (score > best.confidence) {
      best = { intent: p.intent, confidence: score };
    }
  }

  if (best.confidence >= FLOOR_CONFIDENCE) return best;

  // No keyword hit — escalate to LLM if we have one wired.
  if (!options?.llm) {
    return { intent: 'unknown', confidence: 0.3 };
  }

  const candidates = patterns.map((p) => p.intent).join(', ');
  const system =
    'You classify a user utterance into ONE of these intents: ' +
    candidates +
    ', or "unknown". Reply ONLY with the intent literal, no prose.';
  const res = await options.llm.classify({
    system,
    user: utterance,
    thinkingBudgetTokens: 0,
  });
  const intent = res.text.trim().split(/\s+/)[0] ?? 'unknown';
  return {
    intent: patterns.some((p) => p.intent === intent) ? intent : 'unknown',
    confidence: 0.6,
  };
}
