/**
 * Recursive Higher-Order Thought (HOT) — one-level meta-thought.
 *
 * Given the agent's previous turn's "thought" (its CoT trace summary
 * or normalised reasoning), the recursive-HOT module produces a
 * one-level meta-thought: "the agent's thought about that thought."
 *
 * Bounded to ONE level of recursion to avoid the infinite-regress
 * trap. The output is a short, declarative sentence the agent can
 * mix back into the next turn's system prompt as part of its
 * self-model.
 *
 * Pure heuristic — pattern-matches the prior thought for confidence
 * markers, hedges, and self-references, and emits a meta-comment.
 * A model-backed version can replace this later by wiring through
 * an optional `judge` port.
 */

export interface RecursiveHotInput {
  /** The previous turn's normalised thought text (CoT or summary). */
  readonly priorThought: string;
  /**
   * Optional confidence score from the previous turn (0..1). When
   * supplied, biases the meta-comment toward calibration language.
   */
  readonly priorConfidence?: number;
  /**
   * Optional outcome — was the prior turn an answer, a soft, or a
   * refusal? Biases the meta-comment toward course-correction.
   */
  readonly priorOutcome?: 'answer' | 'softened' | 'refusal';
}

export interface RecursiveHotResult {
  readonly metaThought: string;
  readonly category:
    | 'overconfident'
    | 'underconfident'
    | 'recovered'
    | 'consistent'
    | 'speculative'
    | 'grounded';
}

const HEDGE_MARKERS: ReadonlyArray<RegExp> = [
  /\bI think\b/i,
  /\bI believe\b/i,
  /\bperhaps\b/i,
  /\bmaybe\b/i,
  /\bI'?m not sure\b/i,
  /\bit'?s possible\b/i,
];

const ASSERTION_MARKERS: ReadonlyArray<RegExp> = [
  /\bdefinitely\b/i,
  /\bcertainly\b/i,
  /\babsolutely\b/i,
  /\bguarantee\b/i,
  /\balways\b/i,
  /\bnever\b/i,
];

const GROUNDING_MARKERS: ReadonlyArray<RegExp> = [
  /\baccording to\b/i,
  /\bbased on\b/i,
  /\bcited\b/i,
  /\bsection\b/i,
  /\bs\.\d/i,
];

function countMatches(
  text: string,
  patterns: ReadonlyArray<RegExp>,
): number {
  let n = 0;
  for (const p of patterns) {
    if (p.test(text)) n += 1;
  }
  return n;
}

export function generateRecursiveHot(
  input: RecursiveHotInput,
): RecursiveHotResult {
  const text = input.priorThought ?? '';
  if (!text || text.trim().length === 0) {
    return {
      metaThought:
        'My prior thought was empty — I should ask the user a clarifying question next.',
      category: 'underconfident',
    };
  }

  const conf = typeof input.priorConfidence === 'number'
    ? Math.max(0, Math.min(1, input.priorConfidence))
    : null;
  const outcome = input.priorOutcome;
  const hedges = countMatches(text, HEDGE_MARKERS);
  const assertions = countMatches(text, ASSERTION_MARKERS);
  const grounded = countMatches(text, GROUNDING_MARKERS);

  if (outcome === 'refusal') {
    return {
      metaThought:
        'I refused last turn. My next thought should explain WHY in one sentence and offer an alternative.',
      category: 'recovered',
    };
  }

  if (assertions >= 2 && grounded === 0) {
    return {
      metaThought:
        'I was assertive without citing evidence. My next thought should add a citation or hedge.',
      category: 'overconfident',
    };
  }

  if (conf !== null && conf < 0.3) {
    return {
      metaThought:
        'My last thought had low confidence. I should request more grounding facts before answering.',
      category: 'underconfident',
    };
  }

  if (conf !== null && conf > 0.85 && grounded > 0) {
    return {
      metaThought:
        'My last thought was confident AND grounded. I can keep this lane.',
      category: 'consistent',
    };
  }

  if (hedges >= 2 && assertions === 0) {
    return {
      metaThought:
        'I was overly hedged. The next thought should commit to a concrete position when grounded.',
      category: 'speculative',
    };
  }

  if (grounded > 0) {
    return {
      metaThought: 'My prior thought was grounded — I can build on it.',
      category: 'grounded',
    };
  }

  return {
    metaThought:
      'My prior thought was neutral. Next turn I should attach a concrete fact or quantifier.',
    category: 'consistent',
  };
}
