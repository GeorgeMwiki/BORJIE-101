/**
 * Supersedence resolver.
 *
 * Wave 18HH. Pure helper. Given a list of `BlackboardPosting`s for a
 * subject, returns the *tip* postings — i.e. those not superseded by
 * any other posting in the list. Used by the patterns layer to find
 * the current state without filtering at the reader level.
 */

import type { BlackboardPosting } from '../types.js';

export function resolveTipPostings(
  postings: ReadonlyArray<BlackboardPosting>,
): ReadonlyArray<BlackboardPosting> {
  const supersededIds = new Set(
    postings
      .map((p) => p.supersedesPostingId)
      .filter((id): id is string => id !== null),
  );
  return postings.filter((p) => !supersededIds.has(p.id));
}

/**
 * Detect orphan supersedence references — postings whose
 * `supersedesPostingId` does not match any posting in the input set.
 * Returns the orphan posting IDs.
 */
export function findOrphanSupersedences(
  postings: ReadonlyArray<BlackboardPosting>,
): ReadonlyArray<string> {
  const knownIds = new Set(postings.map((p) => p.id));
  const orphans: string[] = [];
  for (const p of postings) {
    if (
      p.supersedesPostingId !== null &&
      !knownIds.has(p.supersedesPostingId)
    ) {
      orphans.push(p.id);
    }
  }
  return orphans;
}
