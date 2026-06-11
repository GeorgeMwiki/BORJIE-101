/**
 * Compliance-corpus chunker — pure, dependency-free text splitter for the
 * jurisdiction compliance learn-feed.
 *
 * The admin compliance learn-feed (`POST /admin/jurisdictions/:code/
 * ingest-compliance`) receives a country's regulatory TEXT and must write
 * it as discrete rows into `intelligence_corpus_chunks` so the
 * jurisdiction-discovery corpus probe (ILIKE over `text` + `source_file`)
 * can later find it. This module turns one blob of regulatory prose into a
 * deterministic, bounded list of chunks.
 *
 * Strategy (robust + simple, no NLP dependency):
 *   1. Split on blank-line paragraph boundaries (markdown-friendly).
 *   2. Greedily pack paragraphs into ≤ `maxChars` windows so a single chunk
 *      is a coherent passage, not a sentence fragment.
 *   3. Hard-split any single paragraph longer than `maxChars` on a char
 *      boundary so no chunk ever exceeds the window (keeps embedding +
 *      ILIKE scans bounded).
 *
 * Pure + immutable: no I/O, no mutation of inputs, fully unit-testable.
 *
 * DEFERRED (out of scope here): vision/PDF extraction. Content arrives as
 * TEXT — an admin or the MD extracts/pastes the regulatory prose. A future
 * follow-on can OCR/VLM a PDF into this same TEXT entrypoint; the learn-feed
 * downstream of this chunker stays unchanged.
 */

const DEFAULT_MAX_CHARS = 1600;
const DEFAULT_MIN_CHARS = 1;

export interface ChunkOptions {
  /** Soft upper bound on a chunk's character length. Default 1600. */
  readonly maxChars?: number;
  /** Drop chunks shorter than this (after trim). Default 1. */
  readonly minChars?: number;
}

/**
 * Split regulatory text into ordered, bounded chunks. Returns an immutable
 * array; empty input yields an empty array (caller decides how to treat it).
 */
export function chunkComplianceText(
  raw: string,
  options: ChunkOptions = {},
): ReadonlyArray<string> {
  const maxChars = Math.max(200, options.maxChars ?? DEFAULT_MAX_CHARS);
  const minChars = Math.max(0, options.minChars ?? DEFAULT_MIN_CHARS);

  const normalized = raw.replace(/\r\n/g, '\n').trim();
  if (normalized.length === 0) return Object.freeze([]);

  const paragraphs = normalized
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const packed: string[] = [];
  let current = '';

  const flush = (): void => {
    const trimmed = current.trim();
    if (trimmed.length >= minChars && trimmed.length > 0) packed.push(trimmed);
    current = '';
  };

  for (const paragraph of paragraphs) {
    // A single oversized paragraph is hard-split on a char boundary.
    if (paragraph.length > maxChars) {
      flush();
      for (const piece of hardSplit(paragraph, maxChars)) {
        if (piece.trim().length >= minChars) packed.push(piece.trim());
      }
      continue;
    }
    // Would appending overflow the window? Flush first, then start fresh.
    const candidate = current.length === 0 ? paragraph : `${current}\n\n${paragraph}`;
    if (candidate.length > maxChars) {
      flush();
      current = paragraph;
    } else {
      current = candidate;
    }
  }
  flush();

  return Object.freeze(packed);
}

/** Split an oversized string into ≤ size pieces on a plain char boundary. */
function hardSplit(text: string, size: number): ReadonlyArray<string> {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(text.slice(i, i + size));
  }
  return out;
}
