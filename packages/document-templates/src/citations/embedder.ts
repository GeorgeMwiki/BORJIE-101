/**
 * Citation embedder — given an IRDoc, ensures every numeric / dated /
 * regulatory claim in the body carries a `[citationId]` marker
 * matching one of the doc's `SpanCitation` ids.
 *
 * Wraps the lower-level `verifyDocumentCitations` from
 * `@borjie/document-studio/citations` and adapts the input shape.
 * This is the citation gate that runs PRE-PERSISTENCE per spec §6
 * ("a doc with any uncited numeric, monetary, dated, or regulatory
 * claim is refused by the composer").
 */

import { verifyDocumentCitations } from '@borjie/document-studio/citations';
import type { Citation as VerifierCitation } from '@borjie/document-studio/citations';
import type { IRDoc, SpanCitation } from '../types.js';
import { CompositionError } from '../types.js';

/**
 * Extract all body text from an IRDoc — used as the corpus the
 * citation verifier scans for uncited numeric / statute claims.
 */
export function extractCorpus(doc: IRDoc): string {
  const lines: string[] = [doc.title];
  if (doc.subtitle !== undefined) lines.push(doc.subtitle);
  for (const section of doc.sections) {
    lines.push(section.title);
    for (const block of section.blocks) {
      if (block.text !== undefined) {
        // If the block has a citation id, append the marker so the
        // verifier sees the claim as cited.
        if (block.citationId !== undefined && block.citationId.length > 0) {
          lines.push(`${block.text} [${block.citationId}]`);
        } else {
          lines.push(block.text);
        }
      }
      if (block.kpis !== undefined) {
        for (const k of block.kpis) {
          const suffix =
            k.citationId !== undefined && k.citationId.length > 0
              ? ` [${k.citationId}]`
              : '';
          lines.push(`${k.label}: ${k.value}${suffix}`);
        }
      }
      if (block.headers !== undefined) {
        lines.push(block.headers.join(' | '));
      }
      if (block.rows !== undefined) {
        for (const row of block.rows) {
          lines.push(row.join(' | '));
        }
      }
    }
  }
  return lines.join('\n');
}

function toVerifierCitations(
  spans: ReadonlyArray<SpanCitation>,
): ReadonlyArray<VerifierCitation> {
  return spans.map((c) => {
    const kind = mapSourceKind(c.source.kind);
    return {
      id: c.id,
      claim: c.claim,
      source: {
        kind,
        ref: c.source.ref,
        ...(c.source.url !== undefined ? { url: c.source.url } : {}),
      },
    };
  });
}

function mapSourceKind(
  k: SpanCitation['source']['kind'],
): VerifierCitation['source']['kind'] {
  switch (k) {
    case 'corpus_chunk':
    case 'research_result':
    case 'external':
    case 'assay_cert':
      return 'external';
    case 'ledger':
      return 'ledger';
    case 'measurement':
      return 'measurement';
    case 'statute':
      return 'statute';
    default:
      return 'external';
  }
}

/**
 * Verify the doc's citations satisfy the pre-persistence gate. Throws
 * `CompositionError` with code `CITATION_GAP` when claims are
 * uncited.
 */
export function enforceCitationGate(doc: IRDoc): void {
  const corpus = extractCorpus(doc);
  const verifierCitations = toVerifierCitations(doc.citations);
  const result = verifyDocumentCitations({
    text: corpus,
    citations: verifierCitations,
  });
  if (!result.ok) {
    throw new CompositionError(
      'CITATION_GAP',
      `composer refused: ${result.missing.length} uncited claim(s)`,
      result.missing.map((m) => `${m.reason}:${m.fragment}`),
    );
  }
}

/**
 * Returns the formatted footnote line for a span citation per spec §6:
 *   `[doc:UUID p.PAGE] retrieved YYYY-MM-DD`
 */
export function formatFootnote(c: SpanCitation, retrievedIso?: string): string {
  const dt = retrievedIso ?? new Date().toISOString().slice(0, 10);
  return `[${c.id}] ${c.claim} (${c.source.kind}:${c.source.ref}) retrieved ${dt}`;
}
