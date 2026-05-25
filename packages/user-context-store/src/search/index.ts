/**
 * Search public barrel.
 *
 * Consumer-facing wrapper: `searchScoped(args)` takes an index and a
 * scope, calls the index, and returns hits.
 */
import type { Role, SearchHit } from '../types.js';
import { InMemoryCorpusIndex } from './in-memory-index.js';

export interface SearchScopedArgs {
  readonly index: InMemoryCorpusIndex;
  readonly tenantId: string;
  readonly userId: string;
  readonly role: Role;
  readonly query: string;
  readonly k?: number;
}

/**
 * Wrapper around `index.searchScoped` — kept so the public surface is
 * a function, not a class method, which gives consumers a stable
 * import even if we swap the index implementation later.
 */
export async function searchScoped(
  args: SearchScopedArgs,
): Promise<ReadonlyArray<SearchHit>> {
  return args.index.searchScoped({
    tenantId: args.tenantId,
    userId: args.userId,
    role: args.role,
    query: args.query,
    ...(args.k !== undefined ? { k: args.k } : {}),
  });
}

export { createMockEmbedder, createOpenAIEmbedder } from './embedders.js';
export { InMemoryCorpusIndex } from './in-memory-index.js';
