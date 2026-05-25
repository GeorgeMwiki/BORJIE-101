/**
 * Learning Style Detector — infers a user's preferred learning style
 * (visual / verbal / hands-on) from interaction signals.
 *
 * Pure functional scorer. No I/O. Caller feeds signals in, gets back
 * normalized scores and a dominant style.
 */

export type LearningStyle = 'visual' | 'verbal' | 'hands-on' | 'mixed';

export interface InteractionSignal {
  readonly kind:
    | 'click-diagram'
    | 'click-text'
    | 'play-video'
    | 'read-transcript'
    | 'voice-input'
    | 'text-input'
    | 'quiz-multiple-choice'
    | 'quiz-free-form'
    | 'task-completed'
    | 'task-abandoned';
  readonly dwellMs: number;
  readonly timestamp: string;
}

export interface LearningStyleScores {
  readonly visual: number;
  readonly verbal: number;
  readonly handsOn: number;
}

export interface LearningStyleProfile {
  readonly scores: LearningStyleScores;
  readonly dominantStyle: LearningStyle;
  readonly sampleSize: number;
  readonly confidence: number;
}

const VISUAL_KINDS: ReadonlySet<InteractionSignal['kind']> = new Set([
  'click-diagram',
  'play-video',
]);

const VERBAL_KINDS: ReadonlySet<InteractionSignal['kind']> = new Set([
  'click-text',
  'read-transcript',
  'voice-input',
  'text-input',
  'quiz-free-form',
]);

const HANDS_ON_KINDS: ReadonlySet<InteractionSignal['kind']> = new Set([
  'task-completed',
  'task-abandoned',
  'quiz-multiple-choice',
]);

function normalize(a: number, b: number, c: number): LearningStyleScores {
  const total = a + b + c;
  if (total === 0) {
    return { visual: 0, verbal: 0, handsOn: 0 };
  }
  return {
    visual: a / total,
    verbal: b / total,
    handsOn: c / total,
  };
}

function dominantOf(scores: LearningStyleScores): LearningStyle {
  const { visual, verbal, handsOn } = scores;
  const max = Math.max(visual, verbal, handsOn);
  if (max === 0) return 'mixed';
  // If the top two are within 5 percentage points, call it mixed
  const sorted = [visual, verbal, handsOn].sort((a, b) => b - a);
  if (sorted[0]! - sorted[1]! < 0.05) return 'mixed';
  if (max === visual) return 'visual';
  if (max === verbal) return 'verbal';
  return 'hands-on';
}

export function detectLearningStyle(
  signals: readonly InteractionSignal[],
): LearningStyleProfile {
  let visualWeight = 0;
  let verbalWeight = 0;
  let handsOnWeight = 0;

  for (const signal of signals) {
    const weight = Math.max(1, Math.min(signal.dwellMs / 1000, 60));
    if (VISUAL_KINDS.has(signal.kind)) visualWeight += weight;
    else if (VERBAL_KINDS.has(signal.kind)) verbalWeight += weight;
    else if (HANDS_ON_KINDS.has(signal.kind)) handsOnWeight += weight;
  }

  const scores = normalize(visualWeight, verbalWeight, handsOnWeight);
  const dominantStyle = dominantOf(scores);
  const sampleSize = signals.length;
  const confidence = Math.min(1, sampleSize / 20);

  return {
    scores,
    dominantStyle,
    sampleSize,
    confidence,
  };
}

export function mergeStyleProfiles(
  a: LearningStyleProfile,
  b: LearningStyleProfile,
): LearningStyleProfile {
  const totalSample = a.sampleSize + b.sampleSize;
  if (totalSample === 0) return a;
  const scores: LearningStyleScores = {
    visual: (a.scores.visual * a.sampleSize + b.scores.visual * b.sampleSize) / totalSample,
    verbal: (a.scores.verbal * a.sampleSize + b.scores.verbal * b.sampleSize) / totalSample,
    handsOn: (a.scores.handsOn * a.sampleSize + b.scores.handsOn * b.sampleSize) / totalSample,
  };
  return {
    scores,
    dominantStyle: dominantOf(scores),
    sampleSize: totalSample,
    confidence: Math.min(1, totalSample / 20),
  };
}
