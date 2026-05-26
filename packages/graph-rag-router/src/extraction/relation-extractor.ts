/**
 * Relation extraction — pure orchestration over a `RelationExtractorPort`.
 *
 * Like the entity extractor, the LLM call sits behind the port.
 * This module:
 *
 *   1. Calls the port with the source text + the entities found in it.
 *   2. Filters relations whose endpoints aren't in the entity set
 *      (the LLM occasionally hallucinates extra entities — we drop
 *      them rather than silently introducing untracked nodes).
 *   3. De-duplicates by `(from, to, kind)`.
 */

import type {
  ExtractedEntity,
  ExtractedRelation,
  RelationExtractorPort,
} from '../types.js';

/** Lower-case + trim — the comparison key for entity / relation lookups. */
function key(s: string): string {
  return s.trim().toLowerCase();
}

interface FilterArgs {
  readonly entities: ReadonlyArray<ExtractedEntity>;
  readonly relations: ReadonlyArray<ExtractedRelation>;
}

/**
 * Drop relations referencing unknown entities, then de-duplicate by
 * `(from, to, kind)`. Pure / immutable.
 */
export function filterRelations(
  args: FilterArgs,
): ReadonlyArray<ExtractedRelation> {
  const entityKeys = new Set(args.entities.map((e) => key(e.name)));
  const seen = new Set<string>();
  const out: ExtractedRelation[] = [];
  for (const r of args.relations) {
    const fromK = key(r.from);
    const toK = key(r.to);
    if (!entityKeys.has(fromK) || !entityKeys.has(toK)) continue;
    if (fromK === toK) continue;
    const sig = `${fromK}|${toK}|${key(r.kind)}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({
      from: r.from.trim(),
      to: r.to.trim(),
      kind: r.kind.trim(),
      description: r.description.trim(),
    });
  }
  return out;
}

export interface ExtractRelationsArgs {
  readonly port: RelationExtractorPort;
  readonly text: string;
  readonly entities: ReadonlyArray<ExtractedEntity>;
}

export async function extractRelations(
  args: ExtractRelationsArgs,
): Promise<ReadonlyArray<ExtractedRelation>> {
  if (args.entities.length < 2) return [];
  if (args.text.trim().length === 0) return [];
  const raw = await args.port.extract(args.text, args.entities);
  return filterRelations({ entities: args.entities, relations: raw });
}
