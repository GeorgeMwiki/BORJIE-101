/**
 * Entity extraction — pure orchestration over an `EntityExtractorPort`.
 *
 * The actual LLM call lives behind the port (production) or a mock
 * (tests). This module is responsible for:
 *
 *   1. Calling the port.
 *   2. Canonicalising entity names (trim + de-duplicate by
 *      case-insensitive name).
 *   3. Returning an immutable, alphabetically-stable list.
 *
 * No mutation — every step returns a new array.
 */

import type {
  EntityExtractorPort,
  ExtractedEntity,
} from '../types.js';

interface CanonicaliseResult {
  readonly entities: ReadonlyArray<ExtractedEntity>;
}

/** Trim + collapse internal whitespace. */
function normaliseName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/** Lowercase normalised name — the de-dup key. */
function dedupKey(name: string): string {
  return normaliseName(name).toLowerCase();
}

/**
 * De-duplicate by case-insensitive name. The longest description
 * wins (heuristic: the entity that was described most fully is
 * likely the canonical record).
 */
export function canonicaliseEntities(
  raw: ReadonlyArray<ExtractedEntity>,
): CanonicaliseResult {
  const byKey = new Map<string, ExtractedEntity>();
  for (const e of raw) {
    const key = dedupKey(e.name);
    if (key.length === 0) continue;
    const existing = byKey.get(key);
    const cleaned: ExtractedEntity = {
      name: normaliseName(e.name),
      type: e.type,
      description: e.description.trim(),
    };
    if (existing === undefined) {
      byKey.set(key, cleaned);
    } else if (cleaned.description.length > existing.description.length) {
      byKey.set(key, cleaned);
    }
  }
  const out = Array.from(byKey.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  return { entities: out };
}

export interface ExtractEntitiesArgs {
  readonly port: EntityExtractorPort;
  readonly text: string;
}

/**
 * Extract entities from one chunk of text via the LLM port, then
 * canonicalise. Returns an immutable list.
 */
export async function extractEntities(
  args: ExtractEntitiesArgs,
): Promise<ReadonlyArray<ExtractedEntity>> {
  if (args.text.trim().length === 0) return [];
  const raw = await args.port.extract(args.text);
  return canonicaliseEntities(raw).entities;
}
