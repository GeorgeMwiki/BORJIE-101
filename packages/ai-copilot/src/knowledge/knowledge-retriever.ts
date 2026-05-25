/**
 * Knowledge Retriever — RAG over the tenant knowledge store.
 *
 * Returns a ranked list of citations the persona weaves into its answer.
 * Every returned chunk carries enough metadata for the UI to show a
 * "Source: Tanzania Rental Act §12, paragraph 3" tooltip.
 */

import { z } from 'zod';
import { KnowledgeStore, KnowledgeChunk } from './knowledge-store.js';
import { buildCitation, Citation } from './citations.js';

export const RetrieveSchema = z.object({
  tenantId: z.string().min(1),
  query: z.string().min(1).max(2000),
  kind: z.enum(['knowledge_base', 'policy_pack', 'playbook', 'legal_reference']).optional(),
  countryCode: z.string().length(2).optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(20).default(5),
});
export type RetrieveInput = z.infer<typeof RetrieveSchema>;

export interface RetrievedAnswer {
  readonly snippets: ReadonlyArray<{
    readonly chunk: KnowledgeChunk;
    readonly citation: Citation;
    readonly snippet: string;
  }>;
  readonly totalFound: number;
}

export async function retrieveKnowledge(
  store: KnowledgeStore,
  input: RetrieveInput
): Promise<RetrievedAnswer> {
  const parsed = RetrieveSchema.parse(input);
  const query = {
    tenantId: parsed.tenantId,
    query: parsed.query,
    ...(parsed.kind !== undefined ? { kind: parsed.kind } : {}),
    ...(parsed.countryCode !== undefined ? { countryCode: parsed.countryCode } : {}),
    ...(parsed.tags !== undefined ? { tags: parsed.tags } : {}),
    limit: parsed.limit,
  };
  const chunks = await store.search(query);
  const snippets = chunks.map((chunk) => ({
    chunk,
    citation: buildCitation(chunk),
    snippet: summarize(chunk.content, parsed.query),
  }));
  return {
    snippets,
    totalFound: chunks.length,
  };
}

/**
 * Extract a snippet around the first query-term hit — best-effort summary
 * for display in the UI. Max 320 chars.
 */
function summarize(content: string, query: string): string {
  const q = query.toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  const lowered = content.toLowerCase();
  let pos = -1;
  for (const t of terms) {
    const p = lowered.indexOf(t);
    if (p >= 0 && (pos < 0 || p < pos)) pos = p;
  }
  if (pos < 0) return content.slice(0, 320);
  const start = Math.max(0, pos - 80);
  const end = Math.min(content.length, pos + 240);
  return (start > 0 ? '... ' : '') + content.slice(start, end) + (end < content.length ? ' ...' : '');
}
