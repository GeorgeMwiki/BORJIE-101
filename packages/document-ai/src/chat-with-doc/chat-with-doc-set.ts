/**
 * chatWithDocSet — multi-doc reasoning.
 *
 * For each doc we run an independent BM25 pass and take the top-k
 * chunks. Aggregated chunks are sorted by score, capped at a global
 * budget, then passed to the brain with per-doc tags so the answer
 * citation markers can resolve back to the right document.
 *
 * `crossDocSynthesis` is set when chunks from more than one source
 * actually made it into the final prompt (we infer that a real cross-
 * doc answer needed multiple sources).
 */

import type {
  BrainPort,
  ChatTurn,
  EmbedderPort,
  MultiDocAnswer,
  ParsedDocument,
} from '../types.js';
import { chunkDocument } from './chunker.js';
import { retrieve } from './retriever.js';
import { parseAnswerWithCitations } from './citations.js';

export interface ChatWithDocSetConfig {
  readonly docs: ReadonlyArray<ParsedDocument>;
  readonly question: string;
  readonly brain: BrainPort;
  readonly history?: ReadonlyArray<ChatTurn>;
  readonly embedder?: EmbedderPort;
  /** Top-k chunks PER document. Default 3. */
  readonly perDocTopK?: number;
  /** Global cap on chunks sent to the brain. Default 8. */
  readonly globalChunkBudget?: number;
  readonly maxAnswerTokens?: number;
}

export async function chatWithDocSet(
  config: ChatWithDocSetConfig
): Promise<MultiDocAnswer> {
  const perDocTopK = config.perDocTopK ?? 3;
  const globalBudget = config.globalChunkBudget ?? 8;

  const perDocResults = await Promise.all(
    config.docs.map(async (doc) => {
      const chunks = chunkDocument(doc);
      const hits = await retrieve(
        config.embedder ? { chunks, embedder: config.embedder } : { chunks },
        config.question,
        { topK: perDocTopK }
      );
      return { doc, hits };
    })
  );

  const allHits = perDocResults
    .flatMap((entry) => entry.hits.map((hit) => ({ docId: entry.doc.id, hit })))
    .sort((a, b) => b.hit.score - a.hit.score)
    .slice(0, globalBudget);

  if (allHits.length === 0) {
    return {
      answer: "I couldn't find anything across these documents that answers that.",
      citations: [],
      confidence: 0,
      perDocContribution: config.docs.map((d) => ({ docId: d.id, score: 0 })),
      crossDocSynthesis: false,
    };
  }

  const promptContext = allHits
    .map((entry, idx) => {
      const firstBlock = entry.hit.chunk.blockIds[0]!;
      return `[chunk ${idx + 1} | doc:${entry.docId} | page ${entry.hit.chunk.pageNumber} | block ${firstBlock}]\n${entry.hit.chunk.text}`;
    })
    .join('\n\n');

  const historyBlock = (config.history ?? [])
    .map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`)
    .join('\n');

  const prompt = [
    'You are a multi-document assistant. Answer ONLY from the supplied chunks.',
    'Cross-reference across documents when the answer requires it.',
    'Cite every factual claim with markers in this format:',
    '  [doc:<docId>#p<page>:<blockId>:"<exact quoted span>"]',
    historyBlock ? `\nCONVERSATION HISTORY:\n${historyBlock}` : '',
    `\nDOCUMENT CHUNKS:\n${promptContext}`,
    `\nQUESTION: ${config.question}`,
    '\nANSWER:',
  ]
    .filter((entry) => entry.length > 0)
    .join('\n');

  const result = await config.brain.complete(prompt, {
    temperature: 0,
    maxTokens: config.maxAnswerTokens ?? 2048,
  });

  const parsed = parseAnswerWithCitations(result.text);

  const perDocContribution = computePerDocContribution(allHits, config.docs);
  const crossDocSynthesis =
    new Set(allHits.map((h) => h.docId)).size > 1;

  const tokensUsed = result.tokensUsed;
  return {
    answer: parsed.cleanAnswer,
    citations: parsed.citations,
    confidence: parsed.citations.length > 0 ? 0.85 : 0.5,
    perDocContribution,
    crossDocSynthesis,
    ...(tokensUsed !== undefined ? { tokensUsed } : {}),
  };
}

function computePerDocContribution(
  hits: ReadonlyArray<{ readonly docId: string; readonly hit: { readonly score: number } }>,
  docs: ReadonlyArray<ParsedDocument>
): ReadonlyArray<{ readonly docId: string; readonly score: number }> {
  const totals = new Map<string, number>();
  for (const entry of hits) {
    totals.set(entry.docId, (totals.get(entry.docId) ?? 0) + entry.hit.score);
  }
  const grand = Array.from(totals.values()).reduce((a, b) => a + b, 0);
  return docs.map((d) => ({
    docId: d.id,
    score: grand > 0 ? (totals.get(d.id) ?? 0) / grand : 0,
  }));
}
