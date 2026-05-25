/**
 * Citations — structured references attached to every RAG answer.
 *
 * Each citation carries enough identity for the UI to link back to the
 * source (document id, chunk index, URL) and enough context for the
 * persona to cite it in plain language ("Per the Tanzania Rental Act,
 * section 12, paragraph 3...").
 */

import { z } from 'zod';
import type { KnowledgeChunk } from './knowledge-store.js';

export const CitationSchema = z.object({
  citationId: z.string().min(1),
  source: z.string().min(1),
  sourceId: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  title: z.string().min(1),
  chunkIndex: z.number().int().nonnegative(),
  countryCode: z.string().length(2).optional(),
  kind: z.enum(['knowledge_base', 'policy_pack', 'playbook', 'legal_reference']),
  quotedFrom: z.string().max(1000).optional(),
});
export type Citation = z.infer<typeof CitationSchema>;

export function buildCitation(chunk: KnowledgeChunk): Citation {
  const citationId = `cit_${chunk.id}`;
  return CitationSchema.parse({
    citationId,
    source: chunk.knowledgeSource,
    ...(chunk.sourceId !== undefined ? { sourceId: chunk.sourceId } : {}),
    ...(chunk.sourceUrl !== undefined ? { sourceUrl: chunk.sourceUrl } : {}),
    title: chunk.title,
    chunkIndex: chunk.chunkIndex,
    ...(chunk.countryCode !== undefined ? { countryCode: chunk.countryCode } : {}),
    kind: chunk.kind,
    quotedFrom: chunk.content.slice(0, 160),
  });
}

export function renderCitationInline(citation: Citation): string {
  const parts = [citation.title];
  if (citation.countryCode) parts.push(`(${citation.countryCode})`);
  if (citation.sourceId) parts.push(`§${citation.sourceId}`);
  return parts.join(' ');
}
