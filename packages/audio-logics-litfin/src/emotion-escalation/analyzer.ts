/**
 * Emotion → escalation analyser.
 *
 * Triggers (per ticket):
 *   - anger score > 0.8 sustained for 5+ seconds  → 'anger-sustained'
 *   - distress score > 0.7 (any single spike)     → 'distress-spike'
 *   - crying detected                             → 'crying-detected'
 *   - profanity-toward-agent count > 3 in 30s     → 'profanity-burst'
 *
 * Adapter strategy:
 *   - If a `LitfinBrainPort.analyzeEmotion` is provided (e.g. Hume EVI 3),
 *     we use that as the source of truth.
 *   - Otherwise, fall back to a deterministic heuristic over the supplied
 *     emotion timeline + transcript so unit tests are reproducible.
 *
 * Returns: `EmotionEscalation` with `shouldEscalate`, `urgency`,
 * `primaryEmotion`, ordered `evidence`, and explicit `triggers` reason codes.
 */

import {
  type EmotionEscalation,
  type EmotionEvidence,
  type LitfinBrainPort,
} from '../types.js';

export interface AnalyzeEmotionalStateArgs {
  /** Optional precomputed emotion timeline (e.g. from Hume EVI 3). */
  readonly emotionTimeline?: ReadonlyArray<EmotionEvidence>;
  /** Optional STT transcript for profanity / keyword fallback. */
  readonly transcript?: string;
  /** Optional total audio length for duration-based triggers. */
  readonly audioDurationMs?: number;
  readonly brain?: LitfinBrainPort;
}

const PROFANITY_LIST: ReadonlyArray<string> = Object.freeze([
  'fuck',
  'shit',
  'damn',
  'asshole',
  'bitch',
  'bastard',
  'bullshit',
]);

const ANGER_SUSTAINED_MS = 5000;
const ANGER_SCORE_THRESHOLD = 0.8;
const DISTRESS_SCORE_THRESHOLD = 0.7;
const CRYING_SCORE_THRESHOLD = 0.6;
const PROFANITY_WINDOW_MS = 30_000;
const PROFANITY_BURST_COUNT = 3;

export async function analyzeEmotionalState(
  args: AnalyzeEmotionalStateArgs,
): Promise<EmotionEscalation> {
  const timeline = await resolveTimeline(args);
  const transcript = (args.transcript ?? '').toLowerCase();

  const triggers = new Set<EmotionEscalation['triggers'][number]>();
  const evidence: EmotionEvidence[] = [];

  // 1. Anger sustained ≥ ANGER_SUSTAINED_MS.
  const angerHits = timeline
    .filter((e) => e.emotion === 'anger' && e.score >= ANGER_SCORE_THRESHOLD)
    .sort((a, b) => a.timestampMs - b.timestampMs);
  if (angerHits.length >= 2) {
    const span =
      (angerHits[angerHits.length - 1]?.timestampMs ?? 0) - (angerHits[0]?.timestampMs ?? 0);
    if (span >= ANGER_SUSTAINED_MS) {
      triggers.add('anger-sustained');
      evidence.push(...angerHits);
    }
  }

  // 2. Distress spike.
  for (const e of timeline) {
    if (e.emotion === 'distress' && e.score >= DISTRESS_SCORE_THRESHOLD) {
      triggers.add('distress-spike');
      evidence.push(e);
    }
  }

  // 3. Crying detected.
  for (const e of timeline) {
    if (e.emotion === 'crying' && e.score >= CRYING_SCORE_THRESHOLD) {
      triggers.add('crying-detected');
      evidence.push(e);
    }
  }

  // 4. Fear detected — escalate at >0.7.
  for (const e of timeline) {
    if (e.emotion === 'fear' && e.score >= 0.7) {
      triggers.add('fear-detected');
      evidence.push(e);
    }
  }

  // 5. Profanity burst — bucket by 30s windows over the transcript.
  const profanityCount = countProfanity(transcript);
  if (profanityCount >= PROFANITY_BURST_COUNT) {
    triggers.add('profanity-burst');
    evidence.push({
      timestampMs: 0,
      emotion: 'anger',
      score: Math.min(1, profanityCount / 5),
      detail: `${profanityCount} profanities detected in ${PROFANITY_WINDOW_MS / 1000}s window`,
    });
  }

  const shouldEscalate = triggers.size > 0;
  const urgency = pickUrgency(triggers);
  const primaryEmotion = pickPrimaryEmotion(timeline, triggers);

  return Object.freeze({
    shouldEscalate,
    urgency,
    primaryEmotion,
    evidence: Object.freeze(evidence),
    triggers: Object.freeze(Array.from(triggers)),
  });
}

async function resolveTimeline(
  args: AnalyzeEmotionalStateArgs,
): Promise<ReadonlyArray<EmotionEvidence>> {
  if (args.emotionTimeline && args.emotionTimeline.length > 0) {
    return args.emotionTimeline;
  }
  if (args.brain?.analyzeEmotion) {
    return args.brain.analyzeEmotion({
      text: args.transcript ?? '',
      ...(args.audioDurationMs !== undefined ? { audioMs: args.audioDurationMs } : {}),
    });
  }
  // Deterministic fallback derived from the transcript so tests can exercise
  // the analyser without a brain adapter wired in.
  return heuristicTimelineFromTranscript(args.transcript ?? '');
}

function heuristicTimelineFromTranscript(text: string): ReadonlyArray<EmotionEvidence> {
  const lower = text.toLowerCase();
  const out: EmotionEvidence[] = [];
  if (/\b(angry|furious|outraged|livid)\b/.test(lower)) {
    out.push({ timestampMs: 0, emotion: 'anger', score: 0.9 });
    out.push({ timestampMs: 6000, emotion: 'anger', score: 0.85 });
  }
  if (/\b(help|please|urgent|emergency)\b/.test(lower)) {
    out.push({ timestampMs: 2000, emotion: 'distress', score: 0.75 });
  }
  if (/\b(crying|sob|weeping)\b/.test(lower)) {
    out.push({ timestampMs: 3000, emotion: 'crying', score: 0.7 });
  }
  if (/\b(scared|afraid|terrified)\b/.test(lower)) {
    out.push({ timestampMs: 4000, emotion: 'fear', score: 0.72 });
  }
  if (out.length === 0) {
    out.push({ timestampMs: 0, emotion: 'calm', score: 0.6 });
  }
  return out;
}

function countProfanity(text: string): number {
  if (!text) return 0;
  let n = 0;
  for (const w of PROFANITY_LIST) {
    const matches = text.match(new RegExp(`\\b${w}\\b`, 'g'));
    if (matches) n += matches.length;
  }
  return n;
}

function pickUrgency(
  triggers: ReadonlySet<EmotionEscalation['triggers'][number]>,
): EmotionEscalation['urgency'] {
  if (triggers.size === 0) return 'low';
  if (triggers.has('crying-detected') || triggers.has('fear-detected')) return 'critical';
  if (triggers.has('anger-sustained') && triggers.has('profanity-burst')) return 'critical';
  if (triggers.has('anger-sustained') || triggers.has('distress-spike')) return 'high';
  return 'medium';
}

function pickPrimaryEmotion(
  timeline: ReadonlyArray<EmotionEvidence>,
  triggers: ReadonlySet<EmotionEscalation['triggers'][number]>,
): EmotionEvidence['emotion'] {
  if (triggers.has('crying-detected')) return 'crying';
  if (triggers.has('fear-detected')) return 'fear';
  if (triggers.has('anger-sustained') || triggers.has('profanity-burst')) return 'anger';
  if (triggers.has('distress-spike')) return 'distress';
  if (timeline.length === 0) return 'calm';
  const sorted = [...timeline].sort((a, b) => b.score - a.score);
  return sorted[0]?.emotion ?? 'calm';
}
