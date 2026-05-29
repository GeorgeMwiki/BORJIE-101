/**
 * MCP `roots/*` — file URIs the client exposes to the server.
 *
 * Per MCP 2024-11-05:
 *   - The client owns a list of "roots" (typically project / folder paths).
 *   - The server queries them via `roots/list`.
 *   - The client signals changes via `notifications/roots/list_changed`.
 *
 * Borjie use case: an external agent pins a local mining-corpus folder
 * as a root. Mr. Mwikila ingests it via the corpus pipeline (the same
 * `borjie-corpus-ingest` worker that powers `intelligence_corpus_chunks`).
 *
 * The dispatcher delegates to a `RootsProvider`; the api-gateway adapter
 * supplies a provider that proxies the request back to the client over
 * the live MCP channel and caches the response in memory for this
 * session.
 */

import { z } from 'zod';

export const rootSchema = z.object({
  uri: z.string().regex(/^file:\/\//, 'root uri must be file:// scheme'),
  name: z.string().optional(),
});

export type Root = z.infer<typeof rootSchema>;

export interface RootsProvider {
  list(): Promise<ReadonlyArray<Root>>;
}

/** Fixture provider used by tests. */
export function createStaticRootsProvider(
  roots: ReadonlyArray<Root>,
): RootsProvider {
  const frozen = Object.freeze([...roots]);
  const provider: RootsProvider = {
    async list(): Promise<ReadonlyArray<Root>> {
      return frozen;
    },
  };
  return Object.freeze(provider);
}

/** Empty provider — server reports zero roots. */
export function createEmptyRootsProvider(): RootsProvider {
  return createStaticRootsProvider([]);
}

/**
 * In-memory provider that lets the server (or a Borjie-internal job
 * like the corpus ingest) push roots received from the client into the
 * cache. The api-gateway adapter uses this so a long-running tool can
 * read the cached list without re-asking the client.
 */
export interface MutableRootsProvider extends RootsProvider {
  set(roots: ReadonlyArray<Root>): void;
  add(root: Root): void;
  remove(uri: string): void;
  snapshot(): ReadonlyArray<Root>;
}

export function createMutableRootsProvider(): MutableRootsProvider {
  let current: ReadonlyArray<Root> = Object.freeze([]);
  const provider: MutableRootsProvider = {
    async list(): Promise<ReadonlyArray<Root>> {
      return current;
    },
    set(roots: ReadonlyArray<Root>): void {
      current = Object.freeze([...roots]);
    },
    add(root: Root): void {
      current = Object.freeze([...current.filter((r) => r.uri !== root.uri), root]);
    },
    remove(uri: string): void {
      current = Object.freeze(current.filter((r) => r.uri !== uri));
    },
    snapshot(): ReadonlyArray<Root> {
      return current;
    },
  };
  return Object.freeze(provider);
}
