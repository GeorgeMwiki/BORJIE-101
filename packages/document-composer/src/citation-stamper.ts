/**
 * Citation stamper — turns caller-supplied `ResearchSource` records
 * into `Citation` rows with provenance hashes, and hash-chains the
 * full composed document.
 *
 * Pure functions only. Caller owns persistence.
 */

import { createHash } from 'node:crypto';
import { appendEntry, type ChainEntry } from '@borjie/audit-hash-chain';
import {
  CitationNotFoundError,
  type Citation,
  type ComposedDocumentChainEntry,
  type ProvenanceStamp,
  type ResearchSource,
} from './types.js';

/**
 * sha256-hex of the canonical UTF-8 body of a source. Used as the
 * citation's `contentHash` so any later mutation of the source is
 * detectable.
 */
export function hashContent(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

/**
 * Project research sources to Citation rows. Throws
 * `CitationNotFoundError` if any source's content is empty — a strong
 * signal the caller resolved a stale or broken pointer.
 */
export function stampCitations(args: {
  readonly sources: ReadonlyArray<ResearchSource>;
  readonly tenantId: string;
  readonly nowIso: string;
}): ReadonlyArray<Citation> {
  return args.sources.map((src, idx) => {
    if (src.content.length === 0) {
      throw new CitationNotFoundError(src.uri, args.tenantId);
    }
    const citation: Citation = {
      id: `cit-${idx + 1}`,
      sourceUri: src.uri,
      sourceTitle: src.title,
      accessedAt: src.accessedAt ?? args.nowIso,
      contentHash: hashContent(src.content),
      ...(src.excerpt !== undefined ? { excerpt: src.excerpt } : {}),
    };
    return citation;
  });
}

/**
 * Project a hash-chain ChainEntry onto our minimal public shape so we
 * don't leak the audit-hash-chain payload type to consumers.
 */
function projectChainEntry(entry: ChainEntry): ComposedDocumentChainEntry {
  return {
    index: entry.index,
    prevHash: entry.prevHash,
    rowHash: entry.rowHash,
    sealedAtIso: entry.sealedAtIso,
  };
}

/**
 * Seal a composed document into a hash chain. The chain has two
 * entries: the provenance stamp and the rendered content hash. Both
 * carry the tenantId so tenant-scoped verifiers can replay only their
 * own segment.
 *
 * Returns a NEW chain (never mutates).
 */
export function sealComposedDocument(args: {
  readonly provenance: ProvenanceStamp;
  readonly citations: ReadonlyArray<Citation>;
  readonly content: string;
  readonly documentId: string;
  readonly sealedAtIso: string;
}): ReadonlyArray<ComposedDocumentChainEntry> {
  const provenancePayload = {
    kind: 'document.composed.provenance',
    documentId: args.documentId,
    tenantId: args.provenance.tenantId,
    provenance: args.provenance,
    citationIds: args.citations.map((c) => c.id),
  };
  const contentPayload = {
    kind: 'document.composed.content',
    documentId: args.documentId,
    tenantId: args.provenance.tenantId,
    contentHash: hashContent(args.content),
    citationCount: args.citations.length,
  };
  const chain1 = appendEntry([], provenancePayload, {
    sealedAtIso: args.sealedAtIso,
  });
  const chain2 = appendEntry(chain1, contentPayload, {
    sealedAtIso: args.sealedAtIso,
  });
  return chain2.map(projectChainEntry);
}
