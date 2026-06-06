/**
 * Document-chat EXTRACTIVE answer builder (OW-2).
 *
 * Turns the evidence chunks bound to a doc-intelligence session into a REAL,
 * SYNCHRONOUS, cited answer — WITHOUT fabricating prose. The answer quotes the
 * highest-overlap passage(s) verbatim from the document and lists the backing
 * evidence chunk ids inline (CLAUDE.md: every AI output cites ≥1 evidence_id;
 * the Auditor rejects empty-evidence chains, and we never synthesise a quote
 * that is not in the source).
 *
 * This mirrors the blessed deterministic citation-first fallback already used
 * by services/api-gateway/src/routes/doc-chat.router.ts — extractive, local,
 * no LLM dependency — so the `/sessions/:id/ask` route can return a written
 * `answer` synchronously instead of `answer:null`. When a real LLM doc-chat
 * orchestrator is wired it can replace `buildExtractiveAnswer` without changing
 * the response shape.
 *
 * Bilingual preface (CLAUDE.md "English default · bilingual sw/en", absolute
 * toggle — never mix): the single-language lead-in is chosen by `language`.
 */

export interface EvidenceChunk {
  readonly id: string;
  readonly text: string;
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'what', 'which', 'when', 'where', 'how', 'why',
  'this', 'that', 'from', 'into', 'about', 'have', 'has', 'are', 'was', 'were',
  'our', 'your', 'their', 'his', 'her', 'its', 'who', 'whom', 'whose', 'will',
  'does', 'did', 'can', 'could', 'should', 'would', 'may', 'might', 'a', 'an',
]);

/** Lower-case word tokens length>2, stop-words removed. */
export function tokenize(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

interface RankedChunk {
  readonly id: string;
  readonly text: string;
  readonly score: number;
}

/**
 * Rank chunks by shared-token overlap with the question, normalised by chunk
 * length so a long chunk does not dominate purely by size. Returns only
 * chunks with a positive score, best first.
 */
export function rankChunks(
  chunks: ReadonlyArray<EvidenceChunk>,
  question: string,
): ReadonlyArray<RankedChunk> {
  const qTokens = new Set(tokenize(question));
  if (qTokens.size === 0) return [];
  return chunks
    .map((c) => {
      const tokens = tokenize(c.text);
      let overlap = 0;
      for (const t of tokens) if (qTokens.has(t)) overlap += 1;
      const score = tokens.length > 0 ? overlap / Math.sqrt(tokens.length) : 0;
      return { id: c.id, text: c.text, score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
}

const QUOTE_MAX_CHARS = 320;

function clampQuote(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= QUOTE_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, QUOTE_MAX_CHARS).trimEnd()}…`;
}

export interface ExtractiveAnswer {
  /** The written, cited answer — or null when no chunk overlaps the question. */
  readonly answer: string | null;
  /** The evidence chunk ids actually used to ground the answer (ranked). */
  readonly citedEvidenceIds: ReadonlyArray<string>;
  /** 'extractive' (quoted source) | 'no_evidence' (nothing matched). */
  readonly mode: 'extractive' | 'no_evidence';
}

/**
 * Build a synchronous, cited, EXTRACTIVE answer from the session's evidence
 * chunks. Quotes the top passage(s) verbatim and cites their ids. Never
 * fabricates: when nothing overlaps the question, returns `answer:null` +
 * `mode:'no_evidence'` so the caller can render an honest "no evidence" state.
 *
 * @param chunks    the chunk texts (+ ids) bound to the session's documents.
 * @param question  the owner's question.
 * @param language  'en' | 'sw' — single-language lead-in (never mixed).
 */
export function buildExtractiveAnswer(args: {
  readonly chunks: ReadonlyArray<EvidenceChunk>;
  readonly question: string;
  readonly language: 'en' | 'sw';
}): ExtractiveAnswer {
  const ranked = rankChunks(args.chunks, args.question);
  if (ranked.length === 0) {
    return { answer: null, citedEvidenceIds: [], mode: 'no_evidence' };
  }

  // Use up to the top 2 distinct passages so the answer is grounded but tight.
  const top = ranked.slice(0, 2);
  const isSw = args.language === 'sw';

  const lead = isSw
    ? 'Kwa mujibu wa hati hii, kifungu husika kinasomeka:'
    : 'Based on this document, the most relevant passage reads:';
  const more =
    top.length > 1
      ? isSw
        ? ' Kifungu kingine kinachohusiana kinaongeza:'
        : ' A further relevant passage adds:'
      : '';

  const firstQuote = `“${clampQuote(top[0]!.text)}”`;
  const secondQuote =
    top.length > 1 ? ` ${`“${clampQuote(top[1]!.text)}”`}` : '';

  const answer = `${lead} ${firstQuote}${more}${secondQuote}`;

  return {
    answer,
    citedEvidenceIds: top.map((c) => c.id),
    mode: 'extractive',
  };
}
