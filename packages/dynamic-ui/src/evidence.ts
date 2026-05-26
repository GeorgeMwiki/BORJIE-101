/**
 * Citation envelope — wraps span-citations into a Tab Recipe output.
 *
 * Source of truth: spec §2 Layer 2 ("Every field added must cite the
 * corpus passage that justified including it; that citation becomes a
 * tooltip the operator can read") + §7 anti-pattern #5.
 *
 * The envelope is intentionally tiny. It serves two purposes:
 *
 *   1. Collect every `citation_id` referenced by a FormSchema's
 *      required fields into a deduplicated, ordered list so the renderer
 *      can pre-fetch the corpus passages once instead of N times.
 *   2. Surface a helper that returns the bilingual rule body for one
 *      citation id, with a `null` fallback for unknown ids (the corpus
 *      may be ahead of the recipe in some environments).
 */

import type {
  CitationContract,
  CorpusAccessor,
  Field,
  FieldGroup,
  FormSchema,
} from './types.js';

/** Resolved citation body, suitable for tooltip render. */
export interface ResolvedCitation {
  readonly citation_id: string;
  readonly rule: string;
  readonly rule_en: string;
  readonly rule_sw: string;
}

/**
 * Walk a FormSchema and collect every citation contract referenced by
 * any required field's `required_because`.
 *
 * The output is ordered: first occurrence wins. Stable order matters
 * because the renderer uses it to lay out the "Why this field?"
 * tooltip stack.
 */
export function collectCitationContracts(
  schema: FormSchema,
): ReadonlyArray<CitationContract> {
  const seen = new Set<string>();
  const out: CitationContract[] = [];
  for (const group of schema.groups) {
    for (const field of group.fields) {
      const contract = field.required_because;
      if (!contract) continue;
      if (seen.has(contract.citation_id)) continue;
      seen.add(contract.citation_id);
      out.push(contract);
    }
  }
  return out;
}

/**
 * Resolve a citation against the corpus, falling back to the contract's
 * `rule` text if the corpus is silent. Returns `null` only if both the
 * corpus AND the contract are silent — that should never happen because
 * `composer.ts` already validated `required_because.rule`.
 */
export async function resolveCitation(
  contract: CitationContract,
  corpus: CorpusAccessor,
): Promise<ResolvedCitation | null> {
  const body = await corpus.lookup(contract.citation_id);
  if (body) {
    return {
      citation_id: contract.citation_id,
      rule: contract.rule,
      rule_en: body.rule_en,
      rule_sw: body.rule_sw,
    };
  }
  if (!contract.rule) {
    return null;
  }
  return {
    citation_id: contract.citation_id,
    rule: contract.rule,
    rule_en: contract.rule,
    rule_sw: contract.rule,
  };
}

/**
 * Bulk-resolve every citation contract in a FormSchema. Returns a Map
 * keyed by `citation_id` so the renderer can look up by id in O(1).
 */
export async function resolveAllCitations(
  schema: FormSchema,
  corpus: CorpusAccessor,
): Promise<ReadonlyMap<string, ResolvedCitation>> {
  const contracts = collectCitationContracts(schema);
  const entries = await Promise.all(
    contracts.map(async (c) => {
      const resolved = await resolveCitation(c, corpus);
      return resolved ? ([c.citation_id, resolved] as const) : null;
    }),
  );
  return new Map(entries.filter((e): e is readonly [string, ResolvedCitation] => e !== null));
}

/** True if every required field carries a non-empty citation contract. */
export function hasFullCitationCoverage(schema: FormSchema): boolean {
  for (const group of schema.groups) {
    for (const field of group.fields) {
      if (field.required && !field.required_because?.citation_id) {
        return false;
      }
    }
  }
  return true;
}

/** Convenience — citation ids declared by required fields. */
export function citationIdsFromGroups(
  groups: ReadonlyArray<FieldGroup>,
): ReadonlyArray<string> {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    for (const field of group.fields) {
      if (!field.required) continue;
      const id = field.required_because?.citation_id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Convenience — citation ids declared by a single field. */
export function citationIdsFromField(field: Field): ReadonlyArray<string> {
  if (!field.required || !field.required_because?.citation_id) {
    return [];
  }
  return [field.required_because.citation_id];
}
