/**
 * Semantic Excerpt Extractor
 *
 * Replaces the 400-char keyword-window heuristic with an LLM-graded chunk
 * selector. Workflow:
 *
 *   1. Strip HTML tags, collapse whitespace.
 *   2. Split into ~600-char overlapping chunks.
 *   3. Score each chunk against the query via lightweight TF-IDF
 *      (zero-LLM-cost, deterministic).
 *   4. If TRUTH_ENGINE_SEMANTIC_LLM=true, send the top-3 chunks to Claude
 *      Haiku for a final "best chunk + key sentence" extraction.
 *   5. Otherwise return the highest TF-IDF chunk verbatim.
 *
 * Falls back gracefully — never throws on LLM error, always returns the best
 * deterministic chunk so callers can persist evidence even if budget is hit.
 */

import { brainChat } from "@/core/brain";

const CHUNK_SIZE = 600;
const CHUNK_STRIDE = 300;
const TOP_CHUNKS_FOR_LLM = 3;

export interface SemanticExtractArgs {
  readonly html: string;
  readonly query: string;
  readonly maxLength?: number;
}

export interface SemanticExtractResult {
  readonly excerpt: string;
  readonly score: number;
  readonly method: "tfidf" | "llm" | "fallback";
}

/**
 * Extract the most relevant excerpt from raw HTML for a given research query.
 * Always returns SOMETHING (or null only if the page is too short to extract
 * meaningful text). Never throws.
 */
export async function extractRelevantExcerpt(
  args: SemanticExtractArgs,
): Promise<SemanticExtractResult | null> {
  const cleaned = stripToText(args.html);
  if (cleaned.length < 50) return null;

  const max = args.maxLength ?? 1200;

  const chunks = chunkText(cleaned, CHUNK_SIZE, CHUNK_STRIDE);
  if (chunks.length === 0) {
    return {
      excerpt: cleaned.slice(0, max),
      score: 0.1,
      method: "fallback",
    };
  }

  const scored = [...scoreChunks(chunks, args.query)]
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_CHUNKS_FOR_LLM);

  if (scored.length === 0 || scored[0].score === 0) {
    return {
      excerpt: cleaned.slice(0, max),
      score: 0.1,
      method: "fallback",
    };
  }

  // If LLM-grading is enabled and Claude is available, ask it to pick the
  // single best window from the top-3 candidates. This is a Haiku-grade call
  // (~$0.0002 per page) so we run it for every fetch in production.
  if (process.env.TRUTH_ENGINE_SEMANTIC_LLM === "true") {
    const llm = await pickWithLLM(scored, args.query, max);
    if (llm) return llm;
  }

  // Deterministic best chunk
  return {
    excerpt: scored[0].text.slice(0, max),
    score: scored[0].score,
    method: "tfidf",
  };
}

// ---------------------------------------------------------------------------
// Text preparation
// ---------------------------------------------------------------------------

function stripToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function chunkText(text: string, size: number, stride: number): string[] {
  if (text.length <= size) return [text];
  const out: string[] = [];
  for (let i = 0; i + 50 < text.length; i += stride) {
    out.push(text.slice(i, i + size));
    if (i + size >= text.length) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// TF-IDF scoring (zero LLM cost, deterministic)
// ---------------------------------------------------------------------------

interface ScoredChunk {
  readonly text: string;
  readonly score: number;
}

function scoreChunks(
  chunks: readonly string[],
  query: string,
): readonly ScoredChunk[] {
  const queryTerms = tokenize(query).filter((t) => t.length > 2);
  if (queryTerms.length === 0) {
    // Without query terms, prefer chunks containing dense numeric facts
    return chunks.map((text) => ({
      text,
      score: numericDensity(text),
    }));
  }

  // Document frequency per term
  const df = new Map<string, number>();
  for (const term of new Set(queryTerms)) {
    df.set(
      term,
      chunks.filter((c) => c.toLowerCase().includes(term)).length || 1,
    );
  }

  return chunks.map((text) => {
    const lower = text.toLowerCase();
    let score = 0;
    for (const term of queryTerms) {
      // Term frequency in chunk
      const tf = (lower.match(new RegExp(escapeRegExp(term), "g")) ?? [])
        .length;
      if (tf === 0) continue;
      // Inverse document frequency (smoothed)
      const idf = Math.log(1 + chunks.length / (df.get(term) ?? 1));
      score += tf * idf;
    }
    // Boost chunks with numeric facts (we're a numeric-fact engine)
    score *= 1 + 0.3 * numericDensity(text);
    return { text, score };
  });
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s.%]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function numericDensity(text: string): number {
  const numbers = text.match(/\d/g) ?? [];
  return Math.min(1, numbers.length / Math.max(1, text.length));
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// LLM-graded chunk picker (optional, opt-in via env flag)
// ---------------------------------------------------------------------------

async function pickWithLLM(
  candidates: readonly ScoredChunk[],
  query: string,
  maxLength: number,
): Promise<SemanticExtractResult | null> {
  try {
    const prompt = [
      `You are a fact-extraction researcher. From the candidates below, return ONLY the single shortest passage that DIRECTLY answers the query.`,
      `If no candidate clearly contains the answer, return the strongest one verbatim.`,
      `Reply with the passage text only. No commentary, no quotation marks.`,
      ``,
      `Query: ${query}`,
      ``,
      ...candidates.map(
        (c, i) => `--- Candidate ${i + 1} ---\n${c.text.slice(0, 1500)}\n`,
      ),
    ].join("\n");

    const response = await Promise.race([
      brainChat([{ role: "user", content: prompt }], undefined, {
        taskName: "truth-engine-semantic-extract",
        model: process.env.CLAUDE_MODEL_FAST ?? "claude-sonnet-4-6",
        maxTokens: 600,
      }),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("semantic_llm_timeout")), 6_000),
      ),
    ]);

    if (!response || response.length < 30) return null;

    return {
      excerpt: response.trim().slice(0, maxLength),
      score: candidates[0].score,
      method: "llm",
    };
  } catch {
    return null;
  }
}
