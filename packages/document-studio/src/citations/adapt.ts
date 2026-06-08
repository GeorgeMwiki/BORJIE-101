/**
 * @borjie/document-studio — citation shape adapter.
 *
 * The package has two `Citation` shapes that pre-date this lane:
 *   - `types.ts` `Citation` — the rich public request shape (source.kind
 *     ∈ ledger_entry | lease | invoice | message | photo | statute |
 *     tenant_record | computation).
 *   - `citation-verifier.ts` `Citation` — the narrower verifier shape
 *     (source.kind ∈ ledger | lease | statute | measurement | external).
 *
 * Both are public exports already consumed elsewhere, so rather than
 * change either contract, this adapter maps the rich shape → the verifier
 * shape. The two gates (`verifyDocumentCitations`, `citationsSha256`)
 * only read `id`, `claim`, and the source as strings, so the mapping is
 * lossless for their purposes.
 */

import type { Citation as RichCitation } from '../types.js';
import type { Citation as VerifierCitation } from './citation-verifier.js';

const KIND_MAP: Record<RichCitation['source']['kind'], VerifierCitation['source']['kind']> = {
  ledger_entry: 'ledger',
  lease: 'lease',
  invoice: 'external',
  message: 'external',
  photo: 'measurement',
  statute: 'statute',
  tenant_record: 'external',
  computation: 'measurement',
};

/** Map a single rich citation → the verifier's narrower shape. */
export function toVerifierCitation(c: RichCitation): VerifierCitation {
  return {
    id: c.id,
    claim: c.claim,
    source: {
      kind: KIND_MAP[c.source.kind],
      ref: c.source.ref,
      ...(c.source.url !== undefined ? { url: c.source.url } : {}),
    },
  };
}

/** Map a set of rich citations → verifier citations. */
export function toVerifierCitations(
  citations: ReadonlyArray<RichCitation>,
): ReadonlyArray<VerifierCitation> {
  return citations.map(toVerifierCitation);
}
