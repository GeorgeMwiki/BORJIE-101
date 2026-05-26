/**
 * Entity extraction port + reference impl.
 *
 * Returns the salted-hash `EntityHit` array. Entity kinds are the
 * closed `ENTITY_KINDS` set; the salted hash is the same one the
 * redactor used (spans + values stay aligned).
 *
 * Reference impl reads the `redacted_spans` returned by the redactor
 * and maps redacted PII kinds → entity kinds. The production impl will
 * inject a finetuned NER model that also surfaces non-PII entities
 * (people, orgs, locations, mining-domain terms).
 */

import {
  ENTITY_KINDS,
  type EntityExtractorPort,
  type EntityHit,
  type EntityKind,
  type RedactedText,
} from '../types.js';

export {
  type EntityExtractorPort,
} from '../types.js';

/**
 * Map redactor PII kinds → entity kinds. Anything not in this map is
 * dropped (intentionally — the redactor's `card`, `tin`, `iban`,
 * `mpesa`, etc. are NOT mining-domain entities the cognitive-memory
 * wants to index).
 */
const REDACTED_KIND_TO_ENTITY: Readonly<Record<string, EntityKind>> = {
  email: 'person',
  phone: 'person',
  nida: 'person',
  passport: 'person',
};

/**
 * Reference rules for non-PII mining-domain terms. Keyword → entity
 * kind. The production NER model replaces these.
 */
const REFERENCE_MINING_TERMS: ReadonlyArray<{
  readonly keyword: string;
  readonly kind: EntityKind;
}> = [
  { keyword: 'gold', kind: 'mineral' },
  { keyword: 'dhahabu', kind: 'mineral' },
  { keyword: 'copper', kind: 'mineral' },
  { keyword: 'shaba', kind: 'mineral' },
  { keyword: 'tanzanite', kind: 'mineral' },
  { keyword: 'tumemadini', kind: 'org' },
  { keyword: 'nemc', kind: 'org' },
  { keyword: 'tra', kind: 'org' },
  { keyword: 'geita', kind: 'location' },
  { keyword: 'mara', kind: 'location' },
  { keyword: 'mwanza', kind: 'location' },
  { keyword: 'parcel', kind: 'parcel_id' },
  { keyword: 'parseli', kind: 'parcel_id' },
  { keyword: 'licence', kind: 'licence_id' },
  { keyword: 'leseni', kind: 'licence_id' },
];

export function createReferenceEntityExtractor(): EntityExtractorPort {
  return {
    extract(redacted: RedactedText): Promise<ReadonlyArray<EntityHit>> {
      const hits: EntityHit[] = [];

      // 1) PII spans → entity hits (already-hashed).
      for (const span of redacted.redacted_spans) {
        const mapped = REDACTED_KIND_TO_ENTITY[span.kind];
        if (mapped && ENTITY_KINDS.includes(mapped)) {
          hits.push({
            kind: mapped,
            value_hash: span.value_hash,
            span: { start: span.start, end: span.end },
          });
        }
      }

      // 2) Non-PII keyword hits → use the keyword itself as the
      //    surface value, hash it via a stable prefix so the
      //    cognitive-memory can recall by the same key. The prefix
      //    matches the redactor's `[KIND_HASH:...]` convention so
      //    downstream tooling can tell the two apart.
      const lc = redacted.text.toLowerCase();
      for (const term of REFERENCE_MINING_TERMS) {
        const idx = lc.indexOf(term.keyword.toLowerCase());
        if (idx >= 0) {
          hits.push({
            kind: term.kind,
            value_hash: `kw:${term.keyword.toLowerCase()}`,
            span: { start: idx, end: idx + term.keyword.length },
          });
        }
      }

      return Promise.resolve(hits);
    },
  };
}
