/**
 * Claims validator — per spec §8.
 *
 * Walks a composed body and identifies factual claims missing a
 * resolvable `[cite:ID]` inline citation. Returns the list of uncited
 * claims; never mutates.
 *
 * "Factual claim" heuristic (deliberately conservative):
 *  - Numeric tokens followed by units (`%`, `g/t`, `USD`, `TZS`, `tons`).
 *  - Dated tokens (`YYYY`, `Q1`, `H2`, month names).
 *  - Regulatory phrases (`under §...`, `the Mining Act`).
 *
 * Each detected claim must be followed within `MAX_CITE_DISTANCE`
 * characters by a `[cite:...]` token whose id appears in the supplied
 * citation set.
 */

import type { SpanCitation } from '../types.js';

export interface UncitedClaim {
  readonly claim: string;
  /** Character position in the body where the claim starts. */
  readonly position: number;
  readonly reason: 'no_cite_token' | 'unknown_cite_id';
}

const MAX_CITE_DISTANCE = 120;

const NUMERIC_CLAIM_RE =
  /\b\d+(?:[.,]\d+)?\s*(?:%|g\/t|tons?\b|kg\b|TZS\b|USD\b|EUR\b|km\b|hectares?\b|MT\b|tCO2e?\b|bps?\b)/gi;

const DATED_CLAIM_RE =
  /\b(?:Q[1-4]|H[12])\s*\d{2,4}\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b|(?<![\w-])(?:20|19)\d{2}(?![\w-])/gi;

const REGULATORY_CLAIM_RE =
  /\b(?:under\s+§|the\s+Mining\s+Act|the\s+Tumemadini|the\s+Land\s+Act|the\s+NEMC|PDPA|GDPR|HIPAA)\b[^.]*?(?:\.|$)/gi;

const CITE_TOKEN_RE = /\[cite:([a-zA-Z0-9_\-:.]+)\]/g;

/**
 * Scan a body for uncited factual claims.
 */
export function findUncitedClaims(
  body: string,
  citations: ReadonlyArray<SpanCitation>,
): ReadonlyArray<UncitedClaim> {
  const citationIds = new Set(citations.map((c) => c.id));
  const claimRegexes: ReadonlyArray<RegExp> = [
    NUMERIC_CLAIM_RE,
    DATED_CLAIM_RE,
    REGULATORY_CLAIM_RE,
  ];

  const uncited: Array<UncitedClaim> = [];

  for (const re of claimRegexes) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null = re.exec(body);
    while (match !== null) {
      const claimText = match[0];
      const start = match.index;
      const lookahead = body.slice(start, start + claimText.length + MAX_CITE_DISTANCE);
      const result = resolveNearbyCite(lookahead, citationIds);
      if (result.kind === 'missing') {
        uncited.push({
          claim: claimText,
          position: start,
          reason: 'no_cite_token',
        });
      } else if (result.kind === 'unknown_id') {
        uncited.push({
          claim: claimText,
          position: start,
          reason: 'unknown_cite_id',
        });
      }
      match = re.exec(body);
    }
  }

  return Object.freeze(uncited);
}

interface CiteResolution {
  readonly kind: 'present' | 'missing' | 'unknown_id';
}

function resolveNearbyCite(
  windowText: string,
  knownIds: ReadonlySet<string>,
): CiteResolution {
  CITE_TOKEN_RE.lastIndex = 0;
  const cite = CITE_TOKEN_RE.exec(windowText);
  if (cite === null) {
    return { kind: 'missing' };
  }
  const id = cite[1];
  if (id === undefined) {
    return { kind: 'missing' };
  }
  if (!knownIds.has(id)) {
    return { kind: 'unknown_id' };
  }
  return { kind: 'present' };
}

/**
 * Convenience: pure boolean — true when no uncited claims exist.
 */
export function claimsAllCited(
  body: string,
  citations: ReadonlyArray<SpanCitation>,
): boolean {
  return findUncitedClaims(body, citations).length === 0;
}
