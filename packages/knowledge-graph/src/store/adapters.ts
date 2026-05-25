/**
 * Optional adapter factories — KuzuDB (embedded) and Neo4j.
 *
 * Both are deferred to runtime composition: this package does NOT
 * import `kuzu` or `neo4j-driver` directly. The factories return
 * objects implementing `KGStorePort` once the user wires in the
 * actual driver.
 *
 * Why deferred?
 *   - Keeps the dependency footprint minimal.
 *   - Lets tenants choose: in-memory (default), KuzuDB (embedded
 *     property graph, https://kuzudb.com/), or Neo4j 5 (server).
 *
 * The runtime wiring lives in the app composition root, not here.
 */

import type { KGStorePort } from '../types.js';

export interface KuzuAdapterOptions {
  /** Path to the KuzuDB database directory. */
  readonly dbPath: string;
  /** Optional read-only mode. */
  readonly readOnly?: boolean;
  /** Driver instance injected by the composition root. */
  readonly driver: unknown;
}

export interface Neo4jAdapterOptions {
  readonly uri: string;
  readonly auth: {
    readonly username: string;
    readonly password: string;
  };
  /** Driver instance injected by the composition root. */
  readonly driver: unknown;
}

/**
 * Create a KuzuDB-backed store. The actual implementation is in
 * `@borjie/graph-sync/adapters/kuzu` (lives there because that
 * package owns the Cypher schema). Returns a stub adapter here.
 */
export function createKuzuAdapter(opts: KuzuAdapterOptions): KGStorePort {
  if (!opts.driver) {
    throw new Error(
      'createKuzuAdapter: driver is required. Install `kuzu` and wire from composition root.',
    );
  }
  if (!opts.dbPath) {
    throw new Error('createKuzuAdapter: dbPath is required.');
  }
  throw new Error(
    'createKuzuAdapter: KuzuDB adapter not implemented in this package. ' +
      'Wire @borjie/graph-sync/adapters/kuzu in composition root.',
  );
}

/**
 * Create a Neo4j-backed store. Defer to `@borjie/graph-sync`
 * which already owns the production Neo4j connection pool.
 */
export function createNeo4jAdapter(opts: Neo4jAdapterOptions): KGStorePort {
  if (!opts.driver) {
    throw new Error(
      'createNeo4jAdapter: driver is required. Use @borjie/graph-sync.createNeo4jClient().',
    );
  }
  if (!opts.uri) {
    throw new Error('createNeo4jAdapter: uri is required.');
  }
  throw new Error(
    'createNeo4jAdapter: Neo4j adapter not implemented in this package. ' +
      'Use @borjie/graph-sync.Neo4jClient + GraphRAG pipeline directly.',
  );
}
