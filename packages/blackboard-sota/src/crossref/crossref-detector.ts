/**
 * Cross-reference detector — explicit-regex + semantic-cosine.
 *
 * Wave BLACKBOARD-CORE. For each candidate (src, dst) pair within a
 * region, decide whether `src` references `dst` and, if so, with
 * what `ref_kind` and confidence. Two passes:
 *
 *   1. **Explicit refs** — high-precision regex over the post
 *      content. Looks for canonical phrasings:
 *
 *        "see post #abc"                  → cites
 *        "per post abc1234"               → cites
 *        "contradicts post #abc"          → contradicts
 *        "answers post #abc"              → answers
 *        "supersedes post #abc"           → supersedes
 *        "elaborates on post #abc"        → elaborates
 *
 *      The post id can be the full UUID, a short prefix (>=4 chars),
 *      or a `#hash` suffix the UI surfaces. The matcher returns
 *      confidence 0.95 for an exact prefix hit.
 *
 *   2. **Semantic refs** — for each later post, compute cosine
 *      similarity against every earlier post in the same region. If
 *      similarity >= SEMANTIC_XREF_THRESHOLD (0.85), label the link
 *      as `elaborates` with confidence = similarity. A later
 *      reranker pass may promote `elaborates → contradicts`.
 *
 * Returns a list of `RecordCrossReferenceInput` records the caller
 * persists. The detector is **stateless** — repeated invocations on
 * the same input produce the same output.
 *
 * Spec: Docs/DESIGN/BLACKBOARD_SOTA_2026.md §7.
 */

import {
  BLACKBOARD_CONSTANTS,
  type CrossReferenceKind,
  type Post,
  type RecordCrossReferenceInput,
} from '../types.js';
import { cosineSimilarity } from './embedding-port.js';

interface RefPhraseRule {
  /** Pattern; group 1 must capture the referenced post id (prefix). */
  readonly pattern: RegExp;
  readonly kind: CrossReferenceKind;
  readonly confidence: number;
}

const REF_PHRASE_RULES: ReadonlyArray<RefPhraseRule> = [
  {
    pattern: /\bcontradicts\b[^\n]{0,40}?\bpost\b\s*#?([a-f0-9-]{4,})/gi,
    kind: 'contradicts',
    confidence: 0.95,
  },
  {
    pattern: /\banswers\b[^\n]{0,40}?\bpost\b\s*#?([a-f0-9-]{4,})/gi,
    kind: 'answers',
    confidence: 0.95,
  },
  {
    pattern: /\bsupersedes\b[^\n]{0,40}?\bpost\b\s*#?([a-f0-9-]{4,})/gi,
    kind: 'supersedes',
    confidence: 0.95,
  },
  {
    pattern: /\belaborates(?:\s+on)?\b[^\n]{0,40}?\bpost\b\s*#?([a-f0-9-]{4,})/gi,
    kind: 'elaborates',
    confidence: 0.9,
  },
  {
    pattern: /\b(?:see|per|cf\.?|c\.f\.?)\b[^\n]{0,40}?\bpost\b\s*#?([a-f0-9-]{4,})/gi,
    kind: 'cites',
    confidence: 0.92,
  },
];

export interface DetectCrossReferencesInput {
  readonly tenantId: string;
  readonly posts: ReadonlyArray<Post>;
  /**
   * Optional override of the semantic threshold. Defaults to
   * `BLACKBOARD_CONSTANTS.SEMANTIC_XREF_THRESHOLD` (0.85).
   */
  readonly semanticThreshold?: number;
}

export interface CrossReferenceDetector {
  detect(
    input: DetectCrossReferencesInput,
  ): ReadonlyArray<RecordCrossReferenceInput>;
}

export function createCrossReferenceDetector(): CrossReferenceDetector {
  return {
    detect(input) {
      const { tenantId, posts } = input;
      const threshold =
        input.semanticThreshold ?? BLACKBOARD_CONSTANTS.SEMANTIC_XREF_THRESHOLD;
      const refs: RecordCrossReferenceInput[] = [];
      const seen = new Set<string>();

      // Indexed by post id and short id (first 8 chars of UUID — the
      // UI surfaces a `#1a2b3c4d`-style short hash).
      const byShort = new Map<string, Post>();
      const byFullId = new Map<string, Post>();
      for (const p of posts) {
        byFullId.set(p.id, p);
        const short = p.id.slice(0, 8);
        byShort.set(short, p);
      }

      function record(
        src: Post,
        dst: Post,
        kind: CrossReferenceKind,
        confidence: number,
      ): void {
        if (src.id === dst.id) return;
        // Cap confidence at 1.0 just in case.
        const cf = Math.max(0, Math.min(1, confidence));
        const key = `${src.id}::${dst.id}::${kind}`;
        if (seen.has(key)) return;
        seen.add(key);
        refs.push({
          tenantId,
          srcPostId: src.id,
          dstPostId: dst.id,
          refKind: kind,
          confidence: cf,
        });
      }

      // -------------------------------------------------------------
      // Pass 1 — explicit regex refs
      // -------------------------------------------------------------
      for (const src of posts) {
        for (const rule of REF_PHRASE_RULES) {
          // Reset lastIndex — pattern is /g/ to capture all matches.
          rule.pattern.lastIndex = 0;
          let match: RegExpExecArray | null;
          while ((match = rule.pattern.exec(src.content)) !== null) {
            const prefix = match[1];
            if (prefix === undefined) continue;
            const dst = resolveByPrefix(prefix, byFullId, byShort);
            if (dst === null) continue;
            record(src, dst, rule.kind, rule.confidence);
          }
        }
      }

      // -------------------------------------------------------------
      // Pass 2 — semantic refs (cosine over earlier posts)
      // -------------------------------------------------------------
      const ordered = posts
        .slice()
        .sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());
      for (let i = 0; i < ordered.length; i += 1) {
        const src = ordered[i];
        if (src === undefined) continue;
        if (src.contentEmbedding === null) continue;
        const srcVec = src.contentEmbedding;
        for (let j = 0; j < i; j += 1) {
          const dst = ordered[j];
          if (dst === undefined) continue;
          if (dst.contentEmbedding === null) continue;
          const sim = cosineSimilarity(srcVec, dst.contentEmbedding);
          if (sim < threshold) continue;
          record(src, dst, 'elaborates', sim);
        }
      }

      return refs;
    },
  };
}

function resolveByPrefix(
  prefix: string,
  byFullId: Map<string, Post>,
  byShort: Map<string, Post>,
): Post | null {
  const exact = byFullId.get(prefix);
  if (exact !== undefined) return exact;
  if (prefix.length >= 8) {
    const short = byShort.get(prefix.slice(0, 8));
    if (short !== undefined) return short;
  }
  // Otherwise try first-N matches against the byShort map; if exactly
  // one matches the prefix, accept it.
  let onlyMatch: Post | null = null;
  for (const post of byShort.values()) {
    if (post.id.startsWith(prefix)) {
      if (onlyMatch !== null) return null; // ambiguous, abort
      onlyMatch = post;
    }
  }
  return onlyMatch;
}
