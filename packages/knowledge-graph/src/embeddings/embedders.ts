/**
 * Graph-aware embedders.
 *
 * Strategy (naive, but battle-tested for GraphRAG MVP):
 *   1. Build a "node card" — concatenate the node's own text fields
 *      with its 1-hop neighbours' text fields.
 *   2. Hand the resulting blob to a text embedder.
 *   3. Cache and return the vector.
 *
 * The text embedder is itself a port — production wires in OpenAI's
 * text-embedding-3-small (via `@borjie/user-context-store`), and
 * tests use a deterministic seeded mock.
 *
 * Why this is a good baseline:
 *   - It captures BOTH a node's content AND its local neighbourhood,
 *     so two nodes with similar neighbourhoods cluster together (the
 *     same intuition behind GraphSAGE 1-hop sampling).
 *   - It's pluggable — a future swap to RGCN, ComplEx, or BoxE only
 *     touches this file plus a new factory.
 */

import { createHash } from 'crypto';
import type {
  EmbeddingVector,
  KGEmbedderPort,
  Node,
  Subgraph,
} from '../types.js';

export interface TextEmbedder {
  embed(text: string): Promise<ReadonlyArray<number>>;
  readonly dimension: number;
}

function nodeToText(node: Node): string {
  const propsBlob = Object.entries(node.properties)
    .map(([k, v]) => `${k}=${stringifyValue(v)}`)
    .join(' ');
  return `${node.class}#${node.id} ${propsBlob}`;
}

function stringifyValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return String(v);
  }
  try {
    return JSON.stringify(v);
  } catch {
    return '';
  }
}

export function createTextGraphEmbedder(args: {
  readonly textEmbedder: TextEmbedder;
}): KGEmbedderPort {
  const dim = args.textEmbedder.dimension;
  if (!Number.isFinite(dim) || dim <= 0) {
    throw new Error(
      'createTextGraphEmbedder: textEmbedder must have positive dimension',
    );
  }

  async function embedNode(eArgs: {
    readonly node: Node;
    readonly neighbors: ReadonlyArray<Node>;
  }): Promise<EmbeddingVector> {
    const selfText = nodeToText(eArgs.node);
    const neighbourText = eArgs.neighbors
      .map((n) => nodeToText(n))
      .join(' | ');
    const blob = `[SELF] ${selfText} [NEIGHBOURS] ${neighbourText}`;
    const vec = await args.textEmbedder.embed(blob);
    return {
      nodeId: eArgs.node.id,
      tenantId: eArgs.node.tenantId,
      vector: vec,
      dimension: dim,
    };
  }

  async function embedSubgraph(sub: Subgraph): Promise<EmbeddingVector> {
    // Mean-pool node embeddings.
    if (sub.nodes.length === 0) {
      throw new Error('embedSubgraph: empty subgraph');
    }
    const vectors: ReadonlyArray<number>[] = [];
    for (const n of sub.nodes) {
      // For subgraph embedding, neighbours = other nodes in subgraph.
      const others = sub.nodes.filter((x) => x.id !== n.id).slice(0, 5);
      const ev = await embedNode({ node: n, neighbors: others });
      vectors.push(ev.vector);
    }
    const mean = meanPool(vectors, dim);
    return {
      nodeId: `subgraph::${sub.tenantId}::${sub.nodes
        .map((n) => n.id)
        .sort()
        .join(',')}`,
      tenantId: sub.tenantId,
      vector: mean,
      dimension: dim,
    };
  }

  return { embedNode, embedSubgraph, dimension: dim };
}

function meanPool(
  vectors: ReadonlyArray<ReadonlyArray<number>>,
  dim: number,
): ReadonlyArray<number> {
  const out = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) {
      out[i] = (out[i] ?? 0) + (v[i] ?? 0);
    }
  }
  return out.map((x) => x / vectors.length);
}

/**
 * Deterministic SHA-256-seeded mock embedder.
 * Same input → same vector across runs/processes.
 * Used for tests, CI, and offline evals.
 */
export function createMockGraphEmbedder(opts: {
  readonly dimension?: number;
}): KGEmbedderPort {
  const dim = opts.dimension ?? 64;
  if (dim <= 0 || dim > 4096) {
    throw new Error('createMockGraphEmbedder: dimension must be in (0, 4096]');
  }

  const textEmbedder: TextEmbedder = {
    dimension: dim,
    async embed(text: string): Promise<ReadonlyArray<number>> {
      const hash = createHash('sha256').update(text).digest();
      const v = new Array<number>(dim);
      for (let i = 0; i < dim; i++) {
        // Expand SHA-256 bytes into [-1, 1] via deterministic pattern
        const byte = hash[i % hash.length] ?? 0;
        const second = hash[(i * 7 + 3) % hash.length] ?? 0;
        const raw = (byte + second) / 510 - 0.5;
        v[i] = raw * 2;
      }
      // L2-normalise so cosine-similarity is well-behaved.
      let sum = 0;
      for (const x of v) sum += x * x;
      const norm = Math.sqrt(sum) || 1;
      return v.map((x) => x / norm);
    },
  };
  return createTextGraphEmbedder({ textEmbedder });
}

/** Cosine similarity for [-1, 1] L2-normalised vectors. */
export function cosineSimilarity(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
): number {
  if (a.length !== b.length) {
    throw new Error(
      `cosineSimilarity: dimension mismatch (${a.length} vs ${b.length})`,
    );
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}
