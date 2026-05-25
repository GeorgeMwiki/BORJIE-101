/**
 * Tiny BM25-ish retriever. Pure in-package implementation so the chat-
 * with-doc flow works without an embedder. When an `EmbedderPort` is
 * provided, it's used as a re-ranker on top of the BM25 candidates.
 *
 * For the multi-tenant SaaS this is a placeholder — production callers
 * will plug a vector store. The interface is the same.
 */

import type { EmbedderPort } from '../types.js';
import type { DocChunk } from './chunker.js';

export interface RetrievalResult {
  readonly chunk: DocChunk;
  readonly score: number;
}

export interface RetrieverConfig {
  readonly chunks: ReadonlyArray<DocChunk>;
  readonly embedder?: EmbedderPort;
}

export interface RetrieveOptions {
  readonly topK?: number;
}

export async function retrieve(
  config: RetrieverConfig,
  query: string,
  options: RetrieveOptions = {}
): Promise<RetrievalResult[]> {
  const topK = options.topK ?? 4;
  const bm25 = bm25Score(config.chunks, query);
  if (!config.embedder) {
    return bm25.slice(0, topK);
  }
  return await rerankWithEmbeddings(config.embedder, query, bm25, topK);
}

function bm25Score(
  chunks: ReadonlyArray<DocChunk>,
  query: string
): RetrievalResult[] {
  const terms = tokenize(query);
  if (terms.length === 0 || chunks.length === 0) return [];
  const docFreq = new Map<string, number>();
  const docTerms: Array<Map<string, number>> = chunks.map((chunk) => {
    const toks = tokenize(chunk.text);
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of new Set(toks)) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
    return tf;
  });
  const avgLen =
    docTerms.reduce((sum, tf) => sum + sum_of_values(tf), 0) / docTerms.length;
  const k1 = 1.5;
  const b = 0.75;
  const N = chunks.length;
  const scored: RetrievalResult[] = chunks.map((chunk, idx) => {
    const tf = docTerms[idx]!;
    const docLen = sum_of_values(tf);
    let score = 0;
    for (const term of terms) {
      const f = tf.get(term) ?? 0;
      if (f === 0) continue;
      const df = docFreq.get(term) ?? 0;
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
      const numerator = f * (k1 + 1);
      const denominator = f + k1 * (1 - b + b * (docLen / Math.max(avgLen, 1)));
      score += idf * (numerator / denominator);
    }
    return { chunk, score };
  });
  return scored.sort((a, b) => b.score - a.score).filter((r) => r.score > 0);
}

async function rerankWithEmbeddings(
  embedder: EmbedderPort,
  query: string,
  candidates: RetrievalResult[],
  topK: number
): Promise<RetrievalResult[]> {
  const top = candidates.slice(0, Math.max(topK * 3, topK));
  if (top.length === 0) return [];
  const inputs = [query, ...top.map((r) => r.chunk.text)];
  const embeddings = await embedder.embed(inputs);
  const queryEmb = embeddings[0]!;
  const ranked = top.map((r, idx) => ({
    chunk: r.chunk,
    score: cosine(queryEmb, embeddings[idx + 1]!),
  }));
  return ranked.sort((a, b) => b.score - a.score).slice(0, topK);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\sÀ-ſ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function sum_of_values(map: Map<string, number>): number {
  let total = 0;
  for (const v of map.values()) total += v;
  return total;
}

function cosine(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
