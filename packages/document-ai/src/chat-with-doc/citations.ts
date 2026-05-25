/**
 * Citation extractor — parses brain output into structured DocCitation[].
 *
 * Convention: the brain is prompted to emit answers with inline
 *   [doc:<docId>#p<page>:b<blockId>:"quoted span"]
 * markers. This module strips the markers from the answer text and
 * resolves each into a DocCitation. Unparseable markers are silently
 * dropped — they fall through to the empty list.
 */

import type { DocCitation } from '../types.js';

const CITATION_REGEX = /\[doc:([^#\s]+)#p(\d+):([^:\s]+):"([^"]+)"\]/g;

export interface ParsedAnswer {
  readonly cleanAnswer: string;
  readonly citations: ReadonlyArray<DocCitation>;
}

export function parseAnswerWithCitations(rawAnswer: string): ParsedAnswer {
  const citations: DocCitation[] = [];
  const seen = new Set<string>();
  const cleanAnswer = rawAnswer.replace(CITATION_REGEX, (_match, docId, page, blockId, quote) => {
    const key = `${docId}|${page}|${blockId}|${quote}`;
    if (!seen.has(key)) {
      seen.add(key);
      citations.push({
        docId,
        pageNumber: Number(page),
        blockId,
        quote,
      });
    }
    return `[${citations.length}]`;
  }).trim();
  return { cleanAnswer, citations };
}

/**
 * Helper for brains that want to construct citation markers
 * programmatically. Keeps the format in one place.
 */
export function formatCitationMarker(c: DocCitation): string {
  return `[doc:${c.docId}#p${c.pageNumber}:${c.blockId}:"${c.quote}"]`;
}
