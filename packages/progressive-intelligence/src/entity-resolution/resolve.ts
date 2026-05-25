/**
 * Entity resolution — dedup + canonicalization.
 *
 * Combines three signals:
 *   1. Cosine similarity on attribute embeddings (semantic dedup)
 *   2. Fuzzy string similarity on the displayName / canonical strings
 *      for the kind
 *   3. Structural rules — same email OR same phone is a "strong" match
 *      no matter what the other signals say
 *
 * The orchestrator is deterministic: same input → same `MatchDecision`.
 */
import type {
  Embedder,
  Entity,
  EntityKind,
  MatchCandidate,
  MatchDecision,
  MatchScoreBreakdown,
  MatchVerdict,
} from '../types.js';
import {
  cosineSimilarity,
  fuzzyStringSimilarity,
  normalizeIdentifier,
} from './scoring.js';

/**
 * Per-kind fields used for fuzzy + structural matching. Open shape —
 * callers may extend at runtime via `customCanonicalFields`.
 */
const CANONICAL_FIELDS_BY_KIND: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  tenant: ['displayName', 'name', 'fullName'],
  vendor: ['displayName', 'companyName', 'tradingName'],
  property: ['name', 'propertyCode'],
  parcel: ['parcelNumber', 'plotNumber', 'name'],
  contact_person: ['fullName', 'displayName', 'name'],
};

const STRONG_IDENTITY_FIELDS = ['email', 'phone', 'nationalId', 'kraPin'] as const;

export interface ResolveEntityArgs {
  /** The new / probe entity we're trying to place. */
  readonly probe: MatchCandidate;
  /** Existing candidates to score against. */
  readonly candidates: ReadonlyArray<MatchCandidate>;
  /** Embedder used only if a candidate lacks a pre-computed embedding. */
  readonly embedder?: Embedder;
  /**
   * Match threshold; verdict is `match` if score >= match,
   * `uncertain` if score >= uncertain, else `no_match`.
   * Defaults: match=0.78, uncertain=0.55.
   */
  readonly thresholds?: { readonly match: number; readonly uncertain: number };
  /** Extra fields per kind to consider canonical for fuzzy match. */
  readonly customCanonicalFields?: Readonly<Record<string, ReadonlyArray<string>>>;
  /**
   * Override scorer if the default composite isn't what you want.
   * Receives the three signals + the breakdown so you can re-weight.
   */
  readonly scorer?: (signals: {
    readonly embedding: number;
    readonly fuzzyString: number;
    readonly structural: number;
    readonly probe: Entity;
    readonly candidate: Entity;
  }) => number;
}

const DEFAULT_THRESHOLDS = { match: 0.78, uncertain: 0.55 };

function pickCanonicalString(
  entity: Entity,
  kind: EntityKind,
  custom?: Readonly<Record<string, ReadonlyArray<string>>>,
): string | undefined {
  const fields = custom?.[kind] ?? CANONICAL_FIELDS_BY_KIND[kind] ?? ['name'];
  for (const f of fields) {
    const v = entity.attributes[f];
    if (typeof v === 'string' && v.trim().length > 0) {
      return v.trim();
    }
  }
  return undefined;
}

function strongIdentityScore(probe: Entity, candidate: Entity): {
  score: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  for (const f of STRONG_IDENTITY_FIELDS) {
    const a = normalizeIdentifier(probe.attributes[f]);
    const b = normalizeIdentifier(candidate.attributes[f]);
    if (a && b && a === b) {
      reasons.push(`shared_${f}`);
    }
  }
  return { score: reasons.length > 0 ? 1 : 0, reasons };
}

function compositeScore(
  embedding: number,
  fuzzyString: number,
  structural: number,
): number {
  // Strong identity overrides everything else — same phone/email is a
  // human-confirmable match. Otherwise blend semantic + fuzzy.
  if (structural >= 1) return 1;
  return 0.55 * embedding + 0.45 * fuzzyString;
}

async function ensureEmbedding(
  candidate: MatchCandidate,
  embedder: Embedder | undefined,
  kind: EntityKind,
  custom?: Readonly<Record<string, ReadonlyArray<string>>>,
): Promise<ReadonlyArray<number> | undefined> {
  if (candidate.embedding) return candidate.embedding;
  if (!embedder) return undefined;
  const text = pickCanonicalString(candidate.entity, kind, custom);
  if (!text) return undefined;
  try {
    return await embedder.embed(text);
  } catch {
    return undefined;
  }
}

/**
 * Resolve a probe entity against a set of candidates.
 *
 * Same input → same output. Sorts matches highest-score-first.
 */
export async function resolveEntity(
  args: ResolveEntityArgs,
): Promise<MatchDecision> {
  const { probe, candidates } = args;
  const thresholds = args.thresholds ?? DEFAULT_THRESHOLDS;
  if (candidates.length === 0) {
    const empty: MatchScoreBreakdown = {
      embedding: 0,
      fuzzyString: 0,
      structural: 0,
      composite: 0,
    };
    return {
      verdict: 'no_match',
      score: 0,
      breakdown: empty,
      matches: [],
      reasons: ['no_candidates'],
    };
  }

  const probeKind = probe.entity.kind;
  const probeEmbedding = await ensureEmbedding(
    probe,
    args.embedder,
    probeKind,
    args.customCanonicalFields,
  );
  const probeCanonical = pickCanonicalString(
    probe.entity,
    probeKind,
    args.customCanonicalFields,
  );

  type Scored = {
    candidate: MatchCandidate;
    breakdown: MatchScoreBreakdown;
    reasons: string[];
  };

  const scored: Scored[] = [];

  for (const c of candidates) {
    // Skip cross-tenant matches outright — multi-tenant guard.
    if (c.entity.tenantId !== probe.entity.tenantId) continue;
    if (c.entity.kind !== probeKind) continue;
    if (c.entity.id === probe.entity.id) continue;

    const candidateEmbedding = await ensureEmbedding(
      c,
      args.embedder,
      probeKind,
      args.customCanonicalFields,
    );
    const candidateCanonical = pickCanonicalString(
      c.entity,
      probeKind,
      args.customCanonicalFields,
    );
    const reasons: string[] = [];

    // 1. Embedding signal — only counted if BOTH sides have an embedding.
    let embeddingSignal = 0;
    if (probeEmbedding && candidateEmbedding) {
      embeddingSignal = Math.max(
        0,
        cosineSimilarity(probeEmbedding, candidateEmbedding),
      );
      if (embeddingSignal > 0.8) reasons.push('high_embedding_similarity');
    }

    // 2. Fuzzy string signal on canonical name(s).
    const fuzzy = fuzzyStringSimilarity(probeCanonical, candidateCanonical);
    if (fuzzy > 0.85) reasons.push('near_identical_name');

    // 3. Structural — strong identity fields.
    const { score: structural, reasons: structuralReasons } = strongIdentityScore(
      probe.entity,
      c.entity,
    );
    reasons.push(...structuralReasons);

    const composite = args.scorer
      ? args.scorer({
          embedding: embeddingSignal,
          fuzzyString: fuzzy,
          structural,
          probe: probe.entity,
          candidate: c.entity,
        })
      : compositeScore(embeddingSignal, fuzzy, structural);

    const breakdown: MatchScoreBreakdown = {
      embedding: embeddingSignal,
      fuzzyString: fuzzy,
      structural,
      composite,
    };
    scored.push({ candidate: c, breakdown, reasons });
  }

  if (scored.length === 0) {
    const empty: MatchScoreBreakdown = {
      embedding: 0,
      fuzzyString: 0,
      structural: 0,
      composite: 0,
    };
    return {
      verdict: 'no_match',
      score: 0,
      breakdown: empty,
      matches: [],
      reasons: ['no_compatible_candidates'],
    };
  }

  // Sort descending by composite. Ties broken by structural (more reliable).
  scored.sort((a, b) => {
    if (b.breakdown.composite !== a.breakdown.composite) {
      return b.breakdown.composite - a.breakdown.composite;
    }
    return b.breakdown.structural - a.breakdown.structural;
  });
  const top = scored[0] as Scored;
  let verdict: MatchVerdict;
  if (top.breakdown.composite >= thresholds.match) {
    verdict = 'match';
  } else if (top.breakdown.composite >= thresholds.uncertain) {
    verdict = 'uncertain';
  } else {
    verdict = 'no_match';
  }

  // Matches list = all candidates at or above the uncertain threshold,
  // preserving sort order.
  const matches = scored
    .filter((s) => s.breakdown.composite >= thresholds.uncertain)
    .map((s) => s.candidate);

  return {
    verdict,
    score: top.breakdown.composite,
    breakdown: top.breakdown,
    matches,
    reasons: top.reasons.length > 0 ? top.reasons : ['below_threshold'],
  };
}
