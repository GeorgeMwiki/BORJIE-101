/**
 * communication-quality scorer.
 *
 * LLM-judged comm quality. Stubbed for Phase E.4 — returns a heuristic
 * score based on the presence + length of `run.comm`, with bonus if any
 * observed action's `tone` matches one of the expected actions' tones.
 *
 * Phase E.5 replaces this with a real LLM judge prompt (rubric: clarity,
 * empathy, accuracy, brevity).
 */

import type { Scorer } from './types.js';

export const communicationQuality: Scorer = (fixture, run) => {
  const comm = run.comm?.trim() ?? '';
  if (!comm) {
    return {
      scorer: 'communication-quality',
      score: 0,
      rationale: 'no comm text observed',
    };
  }

  // Base score from length sanity (between 40 and 1200 chars).
  let base = 0.5;
  if (comm.length >= 40 && comm.length <= 1200) base = 0.7;
  if (comm.length > 1200) base = 0.55; // overly long

  // Tone-match bonus: any observed action carries a tone that matches an
  // expected action's tone (string-equal, since fixtures encode tones as
  // dash-separated tags).
  const expectedTones = new Set<string>();
  for (const a of fixture.expected_actions) {
    const tone = typeof a.tone === 'string' ? a.tone : null;
    if (tone) expectedTones.add(tone);
  }
  let toneBonus = 0;
  for (const a of run.actions) {
    if (a.tone && expectedTones.has(a.tone)) {
      toneBonus = 0.2;
      break;
    }
  }

  const final = Math.min(1, base + toneBonus);
  return {
    scorer: 'communication-quality',
    score: final,
    rationale: `len=${comm.length} base=${base} toneBonus=${toneBonus} (heuristic — LLM judge in Phase E.5)`,
  };
};
