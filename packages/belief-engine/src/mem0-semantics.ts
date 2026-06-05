/**
 * Mem0 ADD / UPDATE / DELETE / NOOP extraction semantics.
 *
 * When a new candidate fact arrives, decide what to do relative to the
 * existing facts for the same (scope, subject):
 *
 *   ADD    — claim is new; persist a fresh fact.
 *   UPDATE — claim refines / contradicts an existing fact; supersede it
 *            (downstream bi-temporal writer chains valid_to + supersedesId).
 *   DELETE — claim explicitly revokes an old fact ("no longer …",
 *            "stopped …"); the target's valid_to flips to now.
 *   NOOP   — claim is already known with equal-or-higher confidence; skip.
 *
 * PURE — no side effects. Callers persist via their own bi-temporal writer,
 * so the decision can be inspected / logged / replayed in audit.
 *
 * Reference: Mem0 (arXiv 2404.13501). Ported from LITFIN
 * litfin-ai/memory/v2/mem0-semantics.ts.
 */

export type Mem0Decision =
  | { readonly kind: 'add'; readonly reason: string }
  | {
      readonly kind: 'update';
      readonly supersedesId: string;
      readonly similarity: number;
      readonly reason: string;
    }
  | {
      readonly kind: 'delete';
      readonly targetId: string;
      readonly similarity: number;
      readonly reason: string;
    }
  | {
      readonly kind: 'noop';
      readonly matchedId: string;
      readonly similarity: number;
      readonly reason: string;
    };

export interface Mem0Candidate {
  readonly factText: string;
  readonly factType: string;
  readonly embedding?: ReadonlyArray<number>;
  /** 0..1 confidence. Defaults to 1. */
  readonly confidence?: number;
  /** Caller hint that the candidate NEGATES a prior fact. */
  readonly explicitNegation?: boolean;
}

export interface Mem0ExistingFact {
  readonly id: string;
  readonly factText: string;
  readonly factType: string;
  readonly embedding?: ReadonlyArray<number>;
  readonly confidence: number;
}

export interface DecideMem0Options {
  readonly contradictionThreshold?: number;
  readonly noopThreshold?: number;
  readonly deleteThreshold?: number;
}

const DEFAULT_CONTRADICTION_THRESHOLD = 0.85;
const DEFAULT_NOOP_THRESHOLD = 0.92;
const DEFAULT_DELETE_THRESHOLD = 0.7;

const NEGATION_PATTERNS: ReadonlyArray<RegExp> = [
  /\bno longer\b/i,
  /\bnot anymore\b/i,
  /\bstopped\b/i,
  /\bquit\b/i,
  /\bcancel(?:led|s)?\b/i,
  /\bwithdrawn\b/i,
  /\bno more\b/i,
  /\brevoke[ds]?\b/i,
];

function looksLikeNegation(text: string): boolean {
  return NEGATION_PATTERNS.some((re) => re.test(text));
}

function normaliseText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cosineSimilarity(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function jaccardSimilarity(a: string, b: string): number {
  const aTokens = new Set(normaliseText(a).split(' ').filter(Boolean));
  const bTokens = new Set(normaliseText(b).split(' ').filter(Boolean));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let intersect = 0;
  for (const t of aTokens) if (bTokens.has(t)) intersect += 1;
  const union = aTokens.size + bTokens.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

function pairSimilarity(
  candidate: Mem0Candidate,
  existing: Mem0ExistingFact,
): number {
  if (
    candidate.embedding &&
    existing.embedding &&
    candidate.embedding.length > 0 &&
    candidate.embedding.length === existing.embedding.length
  ) {
    return cosineSimilarity(candidate.embedding, existing.embedding);
  }
  return jaccardSimilarity(candidate.factText, existing.factText);
}

function stripNegation(text: string): string {
  let out = text;
  for (const re of [
    /\bno longer\b/gi,
    /\bnot anymore\b/gi,
    /\bno more\b/gi,
    /\bstopped\b/gi,
    /\bquit\b/gi,
    /\bcancel(?:led|s)?\b/gi,
    /\bwithdrawn\b/gi,
    /\brevoke[ds]?\b/gi,
  ]) {
    out = out.replace(re, ' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}

function negationStripSimilarity(
  candidate: Mem0Candidate,
  existing: Mem0ExistingFact,
): number {
  return jaccardSimilarity(stripNegation(candidate.factText), existing.factText);
}

interface BestMatch {
  readonly fact: Mem0ExistingFact;
  readonly similarity: number;
}

function findBestMatch(
  candidate: Mem0Candidate,
  existing: ReadonlyArray<Mem0ExistingFact>,
  scorer: (c: Mem0Candidate, f: Mem0ExistingFact) => number,
): BestMatch | null {
  let best: BestMatch | null = null;
  for (const fact of existing) {
    if (fact.factType !== candidate.factType) continue;
    const sim = scorer(candidate, fact);
    if (!best || sim > best.similarity) best = { fact, similarity: sim };
  }
  return best;
}

function carriesSameClaim(
  candidate: Mem0Candidate,
  existing: Mem0ExistingFact,
): boolean {
  if (
    looksLikeNegation(candidate.factText) ||
    looksLikeNegation(existing.factText)
  ) {
    return false;
  }
  const candidateTokens = new Set(
    normaliseText(candidate.factText).split(' ').filter(Boolean),
  );
  const existingTokens = new Set(
    normaliseText(existing.factText).split(' ').filter(Boolean),
  );
  if (candidateTokens.size === 0 || existingTokens.size === 0) return false;
  let intersect = 0;
  for (const t of candidateTokens) if (existingTokens.has(t)) intersect += 1;
  return (
    intersect / candidateTokens.size >= 0.9 &&
    intersect / existingTokens.size >= 0.9
  );
}

/**
 * Decide ADD / UPDATE / DELETE / NOOP for a candidate fact relative to the
 * existing fact list (already filtered to the same scope + subject). PURE.
 */
export function decideMem0Op(
  candidate: Mem0Candidate,
  existing: ReadonlyArray<Mem0ExistingFact>,
  opts?: DecideMem0Options,
): Mem0Decision {
  const contradictionThreshold =
    opts?.contradictionThreshold ?? DEFAULT_CONTRADICTION_THRESHOLD;
  const noopThreshold = opts?.noopThreshold ?? DEFAULT_NOOP_THRESHOLD;
  const deleteThreshold = opts?.deleteThreshold ?? DEFAULT_DELETE_THRESHOLD;

  // 1. negation → DELETE
  const negation =
    candidate.explicitNegation === true ||
    looksLikeNegation(candidate.factText);
  if (negation) {
    const best = findBestMatch(candidate, existing, negationStripSimilarity);
    if (best && best.similarity >= deleteThreshold) {
      return {
        kind: 'delete',
        targetId: best.fact.id,
        similarity: best.similarity,
        reason: `negation detected; revoking fact ${best.fact.id} (similarity ${best.similarity.toFixed(2)} >= ${deleteThreshold}).`,
      };
    }
    return {
      kind: 'add',
      reason:
        'negation detected but no prior fact passes the delete threshold; recording as a new claim.',
    };
  }

  // 2. best non-negated match
  const best = findBestMatch(candidate, existing, pairSimilarity);
  if (!best) {
    return {
      kind: 'add',
      reason: 'no existing fact in the same factType — recording as new.',
    };
  }

  // 3. NOOP vs UPDATE
  if (best.similarity >= noopThreshold && carriesSameClaim(candidate, best.fact)) {
    const candidateConfidence = candidate.confidence ?? 1;
    if (candidateConfidence <= best.fact.confidence) {
      return {
        kind: 'noop',
        matchedId: best.fact.id,
        similarity: best.similarity,
        reason: `candidate matches fact ${best.fact.id} (similarity ${best.similarity.toFixed(2)} >= ${noopThreshold}) and brings no higher confidence.`,
      };
    }
    return {
      kind: 'update',
      supersedesId: best.fact.id,
      similarity: best.similarity,
      reason: `same claim as fact ${best.fact.id} but higher confidence (${candidateConfidence.toFixed(2)} > ${best.fact.confidence.toFixed(2)}) — supersede.`,
    };
  }
  if (best.similarity >= contradictionThreshold) {
    return {
      kind: 'update',
      supersedesId: best.fact.id,
      similarity: best.similarity,
      reason: `candidate contradicts / refines fact ${best.fact.id} (similarity ${best.similarity.toFixed(2)} >= ${contradictionThreshold}) — supersede.`,
    };
  }

  // 4. default → ADD
  return {
    kind: 'add',
    reason: `best match ${best.fact.id} similarity ${best.similarity.toFixed(2)} < ${contradictionThreshold} — recording as new.`,
  };
}

/** Human-readable label per decision (audit-trail UI). */
export function describeMem0Decision(d: Mem0Decision): string {
  switch (d.kind) {
    case 'add':
      return `ADD: ${d.reason}`;
    case 'update':
      return `UPDATE supersedes=${d.supersedesId} (sim=${d.similarity.toFixed(2)}): ${d.reason}`;
    case 'delete':
      return `DELETE target=${d.targetId} (sim=${d.similarity.toFixed(2)}): ${d.reason}`;
    case 'noop':
      return `NOOP matched=${d.matchedId} (sim=${d.similarity.toFixed(2)}): ${d.reason}`;
    default: {
      const _e: never = d;
      return _e;
    }
  }
}
