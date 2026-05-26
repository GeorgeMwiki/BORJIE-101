/**
 * Platform cell repository — reference in-memory implementation
 * (Wave 18W). Reads-only at the tenant boundary in production; the
 * federation-promoter is the only writer.
 */

import type {
  MemoryKind,
  PlatformCellRepository,
  PlatformMemoryCell,
} from '../types.js';
import { cosineSimilarity } from './cell-repository.js';

export function createInMemoryPlatformCellRepository(
  initial: ReadonlyArray<PlatformMemoryCell> = [],
): PlatformCellRepository {
  const store: Map<string, PlatformMemoryCell> = new Map();
  for (const c of initial) {
    store.set(c.id, c);
  }
  return {
    async searchByEmbedding(
      embedding: ReadonlyArray<number>,
      opts: { readonly limit: number; readonly kinds?: ReadonlyArray<MemoryKind> },
    ): Promise<
      ReadonlyArray<{ readonly cell: PlatformMemoryCell; readonly similarity: number }>
    > {
      const kinds_set = opts.kinds !== undefined ? new Set<MemoryKind>(opts.kinds) : null;
      const matches: Array<{
        readonly cell: PlatformMemoryCell;
        readonly similarity: number;
      }> = [];
      for (const cell of store.values()) {
        if (kinds_set !== null && !kinds_set.has(cell.kind)) {
          continue;
        }
        matches.push({
          cell,
          similarity: cosineSimilarity(cell.embedding, embedding),
        });
      }
      matches.sort((a, b) => b.similarity - a.similarity);
      return matches.slice(0, opts.limit);
    },
    async insert(cell: PlatformMemoryCell): Promise<PlatformMemoryCell> {
      store.set(cell.id, cell);
      return cell;
    },
  };
}
