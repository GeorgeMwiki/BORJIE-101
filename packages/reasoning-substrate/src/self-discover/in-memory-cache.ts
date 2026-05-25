/**
 * In-memory ReasoningStructureCachePort.
 *
 * Reference adapter for tests + dev. Production binds to the K-D
 * TemporalKG store via the api-gateway composition root; the cache
 * key is `(taskClass, jurisdiction)` and the schemaVersion is checked
 * on read.
 */

import { REASONING_STRUCTURE_SCHEMA_VERSION } from './types.js';
import type {
  BossnyumbaTaskClass,
  ReasoningStructure,
  ReasoningStructureCachePort,
} from './types.js';

function cacheKey(taskClass: BossnyumbaTaskClass, jurisdiction: string): string {
  return `${taskClass}::${jurisdiction}`;
}

export function createInMemoryReasoningStructureCache(): ReasoningStructureCachePort & {
  /** Test helper — expose internal state for assertions. */
  readonly _entries: Map<string, ReasoningStructure>;
} {
  const entries = new Map<string, ReasoningStructure>();
  return {
    _entries: entries,
    async lookup(args) {
      const k = cacheKey(args.taskClass, args.jurisdiction);
      const hit = entries.get(k);
      if (!hit) return null;
      if (hit.schemaVersion !== REASONING_STRUCTURE_SCHEMA_VERSION) return null;
      return hit;
    },
    async store(structure) {
      const k = cacheKey(structure.taskClass, structure.jurisdiction);
      entries.set(k, structure);
    },
    async invalidateStaleSchemaVersions(currentSchemaVersion) {
      let removed = 0;
      for (const [k, v] of entries) {
        if (v.schemaVersion < currentSchemaVersion) {
          entries.delete(k);
          removed += 1;
        }
      }
      return removed;
    },
  };
}
