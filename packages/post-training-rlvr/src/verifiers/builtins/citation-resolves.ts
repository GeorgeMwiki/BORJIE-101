/**
 * `citation-resolves` verifier — fetch the cited URL and verify the
 * response body contains the claimed text substring.
 *
 * Real HTTP is used in production (node 18+ global `fetch`); in tests
 * a deterministic `Fetcher` port is injected so the test suite runs
 * offline. This is the live-test discipline applied at the boundary.
 */

import type {
  RlvrTrace,
  Verifier,
  VerificationResult,
} from '../../types.js';

export interface Fetcher {
  (url: string): Promise<{
    readonly ok: boolean;
    readonly status: number;
    readonly text: () => Promise<string>;
  }>;
}

const defaultFetcher: Fetcher = async (url: string) => {
  const response = await fetch(url);
  return {
    ok: response.ok,
    status: response.status,
    text: () => response.text(),
  };
};

export interface CitationResolvesConfig {
  readonly fetcher?: Fetcher;
}

interface CitationClaim {
  readonly url: string;
  readonly claim: string;
}

function extractCitations(trace: RlvrTrace): ReadonlyArray<CitationClaim> {
  const meta = trace.metadata as Record<string, unknown>;
  const raw = meta['citations'];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((c): CitationClaim[] => {
    if (
      typeof c !== 'object' ||
      c === null ||
      typeof (c as { url?: unknown }).url !== 'string' ||
      typeof (c as { claim?: unknown }).claim !== 'string'
    ) {
      return [];
    }
    const cast = c as { url: string; claim: string };
    return [{ url: cast.url, claim: cast.claim }];
  });
}

export function createCitationResolvesVerifier(
  config: CitationResolvesConfig = {},
): Verifier {
  const fetcher = config.fetcher ?? defaultFetcher;

  return {
    name: 'citation-resolves',
    version: '1.0.0',

    applies(trace: RlvrTrace): boolean {
      return extractCitations(trace).length > 0;
    },

    async verify(trace: RlvrTrace): Promise<VerificationResult> {
      const citations = extractCitations(trace);
      const perCitation: Array<{
        url: string;
        ok: boolean;
        status: number;
        textMatched: boolean;
        error?: string;
      }> = [];

      for (const { url, claim } of citations) {
        try {
          const response = await fetcher(url);
          if (!response.ok) {
            perCitation.push({
              url,
              ok: false,
              status: response.status,
              textMatched: false,
            });
            continue;
          }
          const body = await response.text();
          const matched = body.includes(claim);
          perCitation.push({
            url,
            ok: true,
            status: response.status,
            textMatched: matched,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          perCitation.push({
            url,
            ok: false,
            status: 0,
            textMatched: false,
            error: message,
          });
        }
      }

      const total = perCitation.length;
      const passing = perCitation.filter(
        (c) => c.ok && c.textMatched,
      ).length;

      if (total === 0) {
        return Object.freeze({
          verifierName: 'citation-resolves',
          verdict: 'skip' as const,
          reward: 0,
          evidence: Object.freeze({ reason: 'no_citations' }),
          confidence: 0,
        });
      }

      const ratio = passing / total;
      const verdict =
        ratio === 1 ? 'pass' : ratio === 0 ? 'fail' : 'partial';
      return Object.freeze({
        verifierName: 'citation-resolves',
        verdict,
        reward: ratio,
        evidence: Object.freeze({
          total,
          passing,
          perCitation: Object.freeze(perCitation),
        }),
        confidence: 0.95,
      });
    },
  };
}
