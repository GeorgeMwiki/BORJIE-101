/**
 * Jurisdiction discovery service — JC-1.
 *
 * Composes the seeded short-circuit + web-search + corpus-search +
 * synthesizer + cache adapters into a single `discover()` call.
 *
 *   1. Normalize input (alpha-2 code or country name → canonical).
 *   2. Check the curated seed set (#207). If present, return the
 *      seed result and skip the network entirely.
 *   3. Check the cache (`discovered_jurisdictions` table). If a
 *      non-expired entry exists, return it.
 *   4. Run the web + corpus probes in parallel.
 *   5. Synthesize a `JurisdictionProfile`.
 *   6. Persist to cache (best-effort — never fails the user-facing
 *      call).
 *   7. Return the result.
 *
 * Failure mode: when both probes fail OR throw, the service falls
 * back to a low-confidence stub with `origin = 'fallback'` and the
 * `lowConfidence` flag set so Mr. Mwikila renders an explicit
 * disclaimer ("I could not verify this in real time — best
 * available information shown below"). Mr. Mwikila NEVER says
 * "I don't know".
 */

import pino from 'pino';

import {
  JURISDICTION_AUTHORITIES,
} from '../jurisdiction-resolver/authorities.js';
import { normalizeCountryInput } from './country-normalizer.js';
import { synthesize } from './synthesizer.js';
import type {
  BrainWebSearchAdapter,
  CorpusSearchAdapter,
  DiscoveryCacheAdapter,
  DiscoveryResult,
  DiscoverySource,
  JurisdictionDiscoveryService,
  JurisdictionProfile,
} from './types.js';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  name: 'jurisdiction-discovery',
});

interface DiscoveryDeps {
  readonly webSearch: BrainWebSearchAdapter;
  readonly corpus: CorpusSearchAdapter;
  readonly cache: DiscoveryCacheAdapter;
}

interface DiscoveryOptions {
  readonly webHitLimit?: number;
  readonly corpusHitLimit?: number;
}

const DEFAULT_WEB_HIT_LIMIT = 6;
const DEFAULT_CORPUS_HIT_LIMIT = 6;

// ─── Seeded short-circuit ─────────────────────────────────────────────

/**
 * When the country is in #207's curated seed, build the discovery
 * result directly from the resolver's static snapshot — no network
 * call needed. Confidence is 1.00 since the seed is the ground truth.
 */
function buildSeededResult(
  code: string,
): DiscoveryResult | null {
  const seed = JURISDICTION_AUTHORITIES.find((e) => e.countryCode === code);
  if (!seed) return null;
  const profile: JurisdictionProfile = Object.freeze({
    countryCode: seed.countryCode,
    countryName: seed.countryName,
    regulators: Object.freeze([
      Object.freeze({
        name: seed.mineralAuthority,
        domain: 'mineral_licensing' as const,
        mandate: 'Mining / extraction licensing',
      }),
      Object.freeze({
        name: seed.environmentalAuthority,
        domain: 'environment' as const,
        mandate: 'Environmental compliance',
      }),
      Object.freeze({
        name: seed.transparencyInitiative,
        domain: 'transparency' as const,
        mandate: 'Extractive transparency',
      }),
      Object.freeze({
        name: seed.auditAuthority,
        domain: 'audit' as const,
        mandate: 'External audit',
      }),
    ]),
    currency: 'SEEDED',
    languages: ['en'],
    legalFramework: 'Curated seed (#207)',
    validityScore: 1.0,
  });
  const sources: ReadonlyArray<DiscoverySource> = Object.freeze([
    Object.freeze({
      kind: 'fallback' as const,
      id: `seed:${seed.countryCode}`,
      title: `Borjie curated jurisdiction snapshot — ${seed.countryName}`,
      snippet: `${seed.mineralAuthority} / ${seed.environmentalAuthority} / ${seed.transparencyInitiative} / ${seed.auditAuthority}`,
    }),
  ]);
  return Object.freeze({
    profile,
    sources,
    origin: 'seed' as const,
    lowConfidence: false,
  });
}

// ─── Service implementation ───────────────────────────────────────────

class DefaultDiscoveryService implements JurisdictionDiscoveryService {
  constructor(
    private readonly deps: DiscoveryDeps,
    private readonly options: DiscoveryOptions = {},
  ) {}

  async discover(
    countryCodeOrName: string,
  ): Promise<DiscoveryResult> {
    if (!countryCodeOrName || countryCodeOrName.trim().length === 0) {
      throw new Error('jurisdiction-discovery: country is required');
    }
    const { code, name } = normalizeCountryInput(countryCodeOrName);

    // 1. Seeded short-circuit.
    const seeded = buildSeededResult(code);
    if (seeded) return seeded;

    // 2. Cache hit.
    try {
      const cached = await this.deps.cache.get(code);
      if (cached) {
        logger.debug(
          { code, name },
          'jurisdiction-discovery: cache hit',
        );
        return Object.freeze({
          ...cached,
          origin: 'cache' as const,
        });
      }
    } catch (err) {
      logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          code,
        },
        'jurisdiction-discovery: cache get failed — continuing',
      );
    }

    // 3. Run web + corpus probes in parallel.
    const webLimit = this.options.webHitLimit ?? DEFAULT_WEB_HIT_LIMIT;
    const corpusLimit =
      this.options.corpusHitLimit ?? DEFAULT_CORPUS_HIT_LIMIT;
    const webQuery = `mining regulator ${name} license ${name} mineral authority ${name}`;
    const corpusQuery = `${name} mining regulator license authority`;

    const [webRes, corpusRes] = await Promise.allSettled([
      this.deps.webSearch.search({ query: webQuery, limit: webLimit }),
      this.deps.corpus.search({ query: corpusQuery, limit: corpusLimit }),
    ]);
    const webHits =
      webRes.status === 'fulfilled' ? webRes.value : [];
    const corpusHits =
      corpusRes.status === 'fulfilled' ? corpusRes.value : [];

    if (webRes.status === 'rejected') {
      logger.warn(
        {
          err:
            webRes.reason instanceof Error
              ? webRes.reason.message
              : String(webRes.reason),
          code,
        },
        'jurisdiction-discovery: web search failed — using corpus only',
      );
    }
    if (corpusRes.status === 'rejected') {
      logger.warn(
        {
          err:
            corpusRes.reason instanceof Error
              ? corpusRes.reason.message
              : String(corpusRes.reason),
          code,
        },
        'jurisdiction-discovery: corpus search failed — using web only',
      );
    }

    // 4. Synthesize.
    const { profile, sources } = synthesize({
      countryCode: code,
      countryName: name,
      webHits,
      corpusHits,
    });

    const allEmpty = webHits.length === 0 && corpusHits.length === 0;
    const origin: DiscoveryResult['origin'] = allEmpty
      ? 'fallback'
      : 'discovered';
    const lowConfidence = profile.validityScore < 0.5;

    const result: DiscoveryResult = Object.freeze({
      profile,
      sources,
      origin,
      lowConfidence,
    });

    // 5. Best-effort cache write.
    try {
      await this.deps.cache.put({ countryCode: code, result });
    } catch (err) {
      logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          code,
        },
        'jurisdiction-discovery: cache put failed — continuing',
      );
    }

    return result;
  }
}

export function createJurisdictionDiscoveryService(
  deps: DiscoveryDeps,
  options?: DiscoveryOptions,
): JurisdictionDiscoveryService {
  return new DefaultDiscoveryService(deps, options);
}
