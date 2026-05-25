/**
 * Knowledge Store — tenant-scoped institutional knowledge.
 *
 * Backs a curated knowledge base (policies, playbooks, country legal packs)
 * that the personas consult via RAG. Distinct from:
 *   - ai_semantic_memories — per-persona interaction memory (Agent D owns it)
 *   - document_embeddings  — per-uploaded-document RAG
 *
 * This module is storage-agnostic. The default InMemoryKnowledgeStore is
 * used in tests and in deployments without Postgres; production uses the
 * DrizzleKnowledgeStore wired in composition.
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';

export const KnowledgeKindSchema = z.enum([
  'knowledge_base',
  'policy_pack',
  'playbook',
  'legal_reference',
]);
export type KnowledgeKind = z.infer<typeof KnowledgeKindSchema>;

export const KnowledgeChunkSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  knowledgeSource: z.string().min(1),
  sourceId: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  kind: KnowledgeKindSchema.default('knowledge_base'),
  title: z.string().min(1).max(500),
  chunkIndex: z.number().int().nonnegative().default(0),
  content: z.string().min(1),
  embedding: z.array(z.number()).optional(),
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.unknown()).default({}),
  countryCode: z.string().length(2).optional(),
  createdAt: z.string().datetime().default(() => new Date().toISOString()),
  updatedAt: z.string().datetime().default(() => new Date().toISOString()),
});
export type KnowledgeChunk = z.infer<typeof KnowledgeChunkSchema>;

export const KnowledgeQuerySchema = z.object({
  tenantId: z.string().min(1),
  query: z.string().min(1).max(2000),
  kind: KnowledgeKindSchema.optional(),
  countryCode: z.string().length(2).optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(25).default(5),
});
export type KnowledgeQuery = z.infer<typeof KnowledgeQuerySchema>;

export interface KnowledgeStore {
  upsert(chunk: Omit<KnowledgeChunk, 'id' | 'createdAt' | 'updatedAt'>): Promise<KnowledgeChunk>;
  search(query: KnowledgeQuery): Promise<readonly KnowledgeChunk[]>;
  list(tenantId: string, kind?: KnowledgeKind): Promise<readonly KnowledgeChunk[]>;
  remove(tenantId: string, id: string): Promise<boolean>;
}

/**
 * In-memory knowledge store — test fixture. Enforces tenant isolation by
 * refusing reads/writes that cross the tenantId boundary.
 */
export class InMemoryKnowledgeStore implements KnowledgeStore {
  private readonly chunks: Map<string, KnowledgeChunk> = new Map();

  async upsert(input: Omit<KnowledgeChunk, 'id' | 'createdAt' | 'updatedAt'>): Promise<KnowledgeChunk> {
    const now = new Date().toISOString();
    const id = randomUUID();
    const chunk: KnowledgeChunk = KnowledgeChunkSchema.parse({
      ...input,
      id,
      createdAt: now,
      updatedAt: now,
    });
    this.chunks.set(id, chunk);
    return chunk;
  }

  async search(query: KnowledgeQuery): Promise<readonly KnowledgeChunk[]> {
    const parsed = KnowledgeQuerySchema.parse(query);
    const q = parsed.query.toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);

    const results: Array<{ chunk: KnowledgeChunk; score: number }> = [];
    for (const c of this.chunks.values()) {
      if (c.tenantId !== parsed.tenantId) continue;
      if (parsed.kind && c.kind !== parsed.kind) continue;
      if (parsed.countryCode && c.countryCode && c.countryCode !== parsed.countryCode) continue;
      if (parsed.tags && parsed.tags.length > 0) {
        const matches = parsed.tags.every((t) => c.tags.includes(t));
        if (!matches) continue;
      }
      const haystack = `${c.title}\n${c.content}`.toLowerCase();
      let score = 0;
      for (const t of terms) if (haystack.includes(t)) score += 1;
      if (score > 0) results.push({ chunk: c, score });
    }
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, parsed.limit)
      .map((r) => r.chunk);
  }

  async list(tenantId: string, kind?: KnowledgeKind): Promise<readonly KnowledgeChunk[]> {
    return Array.from(this.chunks.values()).filter(
      (c) => c.tenantId === tenantId && (!kind || c.kind === kind)
    );
  }

  async remove(tenantId: string, id: string): Promise<boolean> {
    const existing = this.chunks.get(id);
    if (!existing || existing.tenantId !== tenantId) return false;
    this.chunks.delete(id);
    return true;
  }
}
