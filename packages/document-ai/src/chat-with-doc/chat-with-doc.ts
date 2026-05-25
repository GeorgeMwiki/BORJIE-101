/**
 * chatWithDoc — single-doc Q&A.
 *
 * Pipeline:
 *   1. Chunk the parsed document.
 *   2. Retrieve top-k chunks via BM25 (+ optional embedder re-rank).
 *   3. Build a tightly-scoped prompt that lists every candidate chunk
 *      with its block id so the brain can cite back into it.
 *   4. Call the brain.
 *   5. Parse citation markers out of the answer.
 */

import type {
  BrainPort,
  ChatAnswer,
  ChatTurn,
  EmbedderPort,
  ParsedDocument,
} from '../types.js';
import { chunkDocument } from './chunker.js';
import { retrieve } from './retriever.js';
import { parseAnswerWithCitations } from './citations.js';

export interface ChatWithDocConfig {
  readonly doc: ParsedDocument;
  readonly question: string;
  readonly brain: BrainPort;
  readonly history?: ReadonlyArray<ChatTurn>;
  readonly embedder?: EmbedderPort;
  readonly topK?: number;
  readonly maxAnswerTokens?: number;
}

export async function chatWithDoc(config: ChatWithDocConfig): Promise<ChatAnswer> {
  const chunks = chunkDocument(config.doc);
  const candidates = await retrieve(
    config.embedder ? { chunks, embedder: config.embedder } : { chunks },
    config.question,
    { topK: config.topK ?? 4 }
  );

  if (candidates.length === 0) {
    return {
      answer: "I couldn't find anything in the document that answers that.",
      citations: [],
      confidence: 0,
    };
  }

  const prompt = buildPrompt({
    docId: config.doc.id,
    question: config.question,
    candidates: candidates.map((c) => ({
      blockIdsCsv: c.chunk.blockIds.join(','),
      pageNumber: c.chunk.pageNumber,
      text: c.chunk.text,
    })),
    ...(config.history ? { history: config.history } : {}),
  });

  const result = await config.brain.complete(prompt, {
    temperature: 0,
    maxTokens: config.maxAnswerTokens ?? 1024,
  });

  const parsed = parseAnswerWithCitations(result.text);
  const confidence = parsed.citations.length > 0 ? 0.85 : 0.5;
  const tokensUsed = result.tokensUsed;
  return {
    answer: parsed.cleanAnswer,
    citations: parsed.citations,
    confidence,
    ...(tokensUsed !== undefined ? { tokensUsed } : {}),
  };
}

interface BuildPromptInput {
  readonly docId: string;
  readonly question: string;
  readonly candidates: ReadonlyArray<{
    readonly blockIdsCsv: string;
    readonly pageNumber: number;
    readonly text: string;
  }>;
  readonly history?: ReadonlyArray<ChatTurn>;
}

function buildPrompt(input: BuildPromptInput): string {
  const historyBlock = (input.history ?? [])
    .map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`)
    .join('\n');
  const contextBlock = input.candidates
    .map((c, idx) => {
      const firstBlock = c.blockIdsCsv.split(',')[0]!;
      return `[chunk ${idx + 1} | doc:${input.docId} | page ${c.pageNumber} | block ${firstBlock}]\n${c.text}`;
    })
    .join('\n\n');
  return [
    'You are a document assistant. Answer ONLY from the supplied chunks.',
    'Cite every factual claim by appending markers in this format:',
    '  [doc:<docId>#p<page>:<blockId>:"<exact quoted span>"]',
    'If the chunks do not contain the answer, say so explicitly.',
    historyBlock ? `\nCONVERSATION HISTORY:\n${historyBlock}` : '',
    `\nDOCUMENT CHUNKS:\n${contextBlock}`,
    `\nQUESTION: ${input.question}`,
    '\nANSWER:',
  ]
    .filter((entry) => entry.length > 0)
    .join('\n');
}
