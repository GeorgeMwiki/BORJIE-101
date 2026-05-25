/**
 * Piece M — sentiment-analyzer.
 *
 * Two-stage cascade:
 *   1. Local heuristic — fast, deterministic, zero-token. Catches the
 *      common "blocker / stuck / frustrated" + "done / smashing it"
 *      cases without round-tripping the kernel.
 *   2. ContentGenerator.inferSentiment fallback for ambiguous text.
 *
 * Fail-open: returns score=0 (neutral) on any kernel error so a
 * downstream null check is unnecessary at the call site that wants a
 * number.
 */

import type { ContentGenerator, WorkforceDeps } from './types.js';

const POSITIVE_WORDS = [
  'great',
  'done',
  'finished',
  'completed',
  'smashing',
  'awesome',
  'excellent',
  'happy',
  'progress',
  'good',
  'fixed',
  'resolved',
  'sorted',
];
const NEGATIVE_WORDS = [
  'stuck',
  'blocked',
  'frustrated',
  'angry',
  'cannot',
  "can't",
  'problem',
  'fail',
  'failed',
  'broken',
  'overdue',
  'sick',
  'tired',
  'overwhelmed',
];

export function heuristicSentiment(text: string): number {
  const tokens = text.toLowerCase().split(/[^a-z']+/).filter(Boolean);
  let score = 0;
  for (const t of tokens) {
    if (POSITIVE_WORDS.includes(t)) score += 1;
    if (NEGATIVE_WORDS.includes(t)) score -= 1;
  }
  if (score === 0) return 0;
  // Normalise into [-1, 1].
  const denom = Math.max(Math.abs(score), 3);
  const raw = score / denom;
  return Math.max(-1, Math.min(1, raw));
}

export async function runSentimentAnalysis(
  deps: WorkforceDeps,
  args: { text: string }
): Promise<{ score: number; source: 'heuristic' | 'kernel' | 'neutral' }> {
  const text = (args.text ?? '').trim();
  if (!text) {
    return { score: 0, source: 'neutral' };
  }

  const heuristic = heuristicSentiment(text);
  // Only fall through to the kernel if the heuristic was inconclusive
  // AND the text is substantive (>= 8 tokens).
  const tokenCount = text.split(/\s+/).length;
  if (heuristic !== 0 || tokenCount < 8) {
    return { score: heuristic, source: 'heuristic' };
  }

  try {
    const r = await (deps.content as ContentGenerator).inferSentiment({ text });
    return { score: clamp(r.score, -1, 1), source: 'kernel' };
  } catch {
    return { score: 0, source: 'neutral' };
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(lo, Math.min(hi, n));
}
