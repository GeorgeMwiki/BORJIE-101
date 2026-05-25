/**
 * Fragment linking — score whether two fragments belong to the same
 * subject. Reuses the entity-resolution scoring primitives so
 * unification and entity dedup share a single scoring contract.
 */
import {
  cosineSimilarity,
  fuzzyStringSimilarity,
  normalizeIdentifier,
} from '../entity-resolution/scoring.js';
import type { LinkProposal, ProfileFragment } from '../types.js';

const STRONG_FIELDS = [
  'email',
  'phone',
  'nationalId',
  'kraPin',
  'mpesaMsisdn',
  'stripeCustomerId',
] as const;

const CANONICAL_NAME_FIELDS = ['displayName', 'fullName', 'name', 'firstName'] as const;

function bestCanonical(fragment: ProfileFragment): string | undefined {
  for (const f of CANONICAL_NAME_FIELDS) {
    const v = fragment.attributes[f];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

export interface LinkFragmentsArgs {
  readonly fragmentA: ProfileFragment;
  readonly fragmentB: ProfileFragment;
  /** Override scoring weights. */
  readonly weights?: {
    readonly embedding?: number;
    readonly fuzzy?: number;
    readonly structural?: number;
  };
}

const DEFAULT_WEIGHTS = { embedding: 0.45, fuzzy: 0.35, structural: 1 };

export function linkFragments(args: LinkFragmentsArgs): LinkProposal {
  const { fragmentA, fragmentB } = args;
  const weights = { ...DEFAULT_WEIGHTS, ...(args.weights ?? {}) };
  const reasons: string[] = [];

  // Reject cross-tenant immediately — multi-tenant safety net.
  if (fragmentA.tenantId !== fragmentB.tenantId) {
    return {
      aId: fragmentA.id,
      bId: fragmentB.id,
      score: 0,
      reasons: ['cross_tenant'],
    };
  }

  // 1. Structural — strong field matches.
  let structural = 0;
  for (const f of STRONG_FIELDS) {
    const a = normalizeIdentifier(fragmentA.attributes[f]);
    const b = normalizeIdentifier(fragmentB.attributes[f]);
    if (a && b && a === b) {
      structural = 1;
      reasons.push(`shared_${f}`);
    }
  }

  // 2. Fuzzy name match
  const fuzzy = fuzzyStringSimilarity(
    bestCanonical(fragmentA),
    bestCanonical(fragmentB),
  );
  if (fuzzy > 0.85) reasons.push('near_identical_name');

  // 3. Embedding similarity
  const embedding = Math.max(
    0,
    cosineSimilarity(fragmentA.embedding, fragmentB.embedding),
  );
  if (embedding > 0.85) reasons.push('high_embedding_similarity');

  // If subjectHintId is shared and explicit, force a strong link.
  if (
    fragmentA.subjectHintId &&
    fragmentB.subjectHintId &&
    fragmentA.subjectHintId === fragmentB.subjectHintId
  ) {
    reasons.push('shared_subject_hint');
    return {
      aId: fragmentA.id,
      bId: fragmentB.id,
      score: 1,
      reasons,
    };
  }

  const score =
    structural >= 1
      ? 1
      : weights.embedding * embedding + weights.fuzzy * fuzzy;

  return {
    aId: fragmentA.id,
    bId: fragmentB.id,
    score: Math.max(0, Math.min(1, score)),
    reasons: reasons.length > 0 ? reasons : ['no_strong_signal'],
  };
}
