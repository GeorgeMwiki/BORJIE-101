/**
 * Knowledge Indexer — ingests documents / policy texts into the knowledge store.
 *
 * Splits long documents into overlapping chunks, normalises whitespace,
 * and hands them to the store with stable sourceId so re-ingestion is
 * idempotent (existing chunks for the same sourceId are overwritten).
 */

import { z } from 'zod';
import { KnowledgeStore, KnowledgeKind, KnowledgeChunk } from './knowledge-store.js';

export const IndexDocumentSchema = z.object({
  tenantId: z.string().min(1),
  knowledgeSource: z.string().min(1),
  sourceId: z.string().min(1),
  sourceUrl: z.string().url().optional(),
  kind: z.enum(['knowledge_base', 'policy_pack', 'playbook', 'legal_reference']).default('knowledge_base'),
  title: z.string().min(1).max(500),
  body: z.string().min(1),
  tags: z.array(z.string()).default([]),
  countryCode: z.string().length(2).optional(),
  chunkSize: z.number().int().positive().max(8000).default(1200),
  chunkOverlap: z.number().int().nonnegative().default(200),
});
export type IndexDocumentInput = z.infer<typeof IndexDocumentSchema>;

export interface IndexResult {
  readonly tenantId: string;
  readonly sourceId: string;
  readonly chunkCount: number;
  readonly chunks: readonly KnowledgeChunk[];
}

/**
 * Ingest a document. Returns the persisted chunks. Caller is responsible
 * for removing stale chunks from the same sourceId before a re-ingest —
 * this module only writes.
 */
export async function indexDocument(
  store: KnowledgeStore,
  input: IndexDocumentInput
): Promise<IndexResult> {
  const parsed = IndexDocumentSchema.parse(input);
  const chunks = splitIntoChunks(parsed.body, parsed.chunkSize, parsed.chunkOverlap);
  const persisted: KnowledgeChunk[] = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const record = await store.upsert({
      tenantId: parsed.tenantId,
      knowledgeSource: parsed.knowledgeSource,
      sourceId: parsed.sourceId,
      ...(parsed.sourceUrl !== undefined ? { sourceUrl: parsed.sourceUrl } : {}),
      kind: parsed.kind as KnowledgeKind,
      title: parsed.title,
      chunkIndex: i,
      content: chunk,
      tags: parsed.tags,
      metadata: { totalChunks: chunks.length },
      ...(parsed.countryCode !== undefined ? { countryCode: parsed.countryCode } : {}),
    });
    persisted.push(record);
  }
  return {
    tenantId: parsed.tenantId,
    sourceId: parsed.sourceId,
    chunkCount: persisted.length,
    chunks: persisted,
  };
}

/**
 * Split text into overlapping chunks at paragraph boundaries where possible.
 * Falls back to hard character split if paragraphs are too long.
 */
export function splitIntoChunks(
  text: string,
  size: number,
  overlap: number
): readonly string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  if (normalized.length === 0) return [];
  if (normalized.length <= size) return [normalized];

  const paragraphs = normalized.split(/\n\s*\n/);
  const chunks: string[] = [];
  let current = '';
  for (const p of paragraphs) {
    if ((current + '\n\n' + p).length > size) {
      if (current) {
        chunks.push(current.trim());
        // Overlap: keep last `overlap` chars for the next chunk.
        current = current.slice(Math.max(0, current.length - overlap));
      }
      if (p.length > size) {
        // Hard-split an oversized paragraph.
        for (let i = 0; i < p.length; i += size - overlap) {
          chunks.push(p.slice(i, i + size).trim());
        }
        current = '';
        continue;
      }
    }
    current = current ? `${current}\n\n${p}` : p;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter((c) => c.length > 0);
}
