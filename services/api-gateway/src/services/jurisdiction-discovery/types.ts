/**
 * Jurisdiction-discovery types — JC-1.
 *
 * The discovery service is the answer to "Mr. Mwikila must NEVER say
 * 'I don't know' about a country". When a tenant or user asks about
 * a jurisdiction we have not seeded (e.g. Peru, Mongolia, DRC), the
 * service runs a discovery pipeline:
 *
 *   1. Seeded short-circuit — if the country is in #207's curated
 *      regulator-jurisdictions table the resolver answers immediately
 *      and the pipeline never runs.
 *   2. Web search — query the brain's web-search tool for the
 *      regulator landscape ("mining regulator [country] license
 *      [country] mineral authority [country]").
 *   3. Corpus search — scan `intelligence_corpus_chunks` for prior
 *      mentions of the country. The corpus is tenant-agnostic so this
 *      hits everything our brain ever ingested.
 *   4. Synthesis — fuse the two signal streams into a structured
 *      `JurisdictionProfile` { country, regulators[], currency,
 *      language(s), legal_framework, validity_score }.
 *   5. Cache — persist the profile in `discovered_jurisdictions` so
 *      subsequent turns in the SAME conversation share the same view.
 *      Cache TTL is short (24h) — promotion to the curated seed is a
 *      separate four-eye admin step (JC-7).
 *
 * Tenant scope: the cache table is GLOBAL — no tenant_id. Only Borjie
 * internal admin reads / writes it (migration 0148 + RLS policy).
 *
 * Failure mode: when discovery fails (web search timeout, corpus
 * unavailable) the service returns a low-confidence profile with the
 * structure intact + `validityScore = 0` so the brain can render the
 * "best-effort" disclaimer without saying "I don't know".
 */

/** Single regulatory authority surfaced by discovery. */
export interface DiscoveredRegulator {
  /** Authority name (e.g. "MINEM" for Peru). */
  readonly name: string;
  /** Domain — licensing / environment / transparency / audit. */
  readonly domain:
    | 'mineral_licensing'
    | 'environment'
    | 'transparency'
    | 'audit'
    | 'unknown';
  /** Free-text role / mandate description. */
  readonly mandate?: string;
  /** Optional website URL. */
  readonly url?: string;
}

/** Source citation surfaced with every discovered profile. */
export interface DiscoverySource {
  readonly kind: 'web_search' | 'corpus' | 'fallback';
  /** Stable identifier — URL for web hits, evidence_id for corpus. */
  readonly id: string;
  /** Title / snippet. */
  readonly title: string;
  /** Optional excerpt for traceability. */
  readonly snippet?: string;
}

/** Structured profile of a jurisdiction discovered on demand. */
export interface JurisdictionProfile {
  /** ISO-3166-1 alpha-2 country code. */
  readonly countryCode: string;
  /** Country name (English). */
  readonly countryName: string;
  /** Discovered regulators (1+ entries). */
  readonly regulators: ReadonlyArray<DiscoveredRegulator>;
  /** ISO-4217 primary currency (best-effort, may be "UNKNOWN"). */
  readonly currency: string;
  /** Official / business languages — at least one entry. */
  readonly languages: ReadonlyArray<string>;
  /** Legal-framework short label (e.g. "Mining Law 27343"). */
  readonly legalFramework?: string;
  /**
   * Validity score in [0, 1]. Computed from:
   *   - seed-table match  ⇒ 1.00 (short-circuit before discovery)
   *   - both web+corpus hits agree ⇒ 0.85
   *   - one source only ⇒ 0.55
   *   - no source / fallback only ⇒ 0.20
   */
  readonly validityScore: number;
}

/** Result returned from `discoverJurisdiction()`. */
export interface DiscoveryResult {
  readonly profile: JurisdictionProfile;
  readonly sources: ReadonlyArray<DiscoverySource>;
  /**
   * Where the profile came from:
   *   - 'seed'     — matched the curated jurisdiction-authorities snapshot.
   *   - 'cache'    — pulled a previous discovery from the cache table.
   *   - 'discovered' — freshly synthesised this call.
   *   - 'fallback' — discovery pipeline failed, low-confidence stub.
   */
  readonly origin: 'seed' | 'cache' | 'discovered' | 'fallback';
  /** True when the brain should flag low confidence to the user. */
  readonly lowConfidence: boolean;
}

/** Brain tool — web search adapter (small surface, easy to fake). */
export interface BrainWebSearchAdapter {
  search(input: {
    readonly query: string;
    readonly limit?: number;
  }): Promise<ReadonlyArray<{
    readonly url: string;
    readonly title: string;
    readonly snippet: string;
  }>>;
}

/** Corpus search adapter — reads `intelligence_corpus_chunks`. */
export interface CorpusSearchAdapter {
  search(input: {
    readonly query: string;
    readonly limit?: number;
  }): Promise<ReadonlyArray<{
    readonly evidenceId: string;
    readonly title: string;
    readonly snippet: string;
  }>>;
}

/** Cache adapter — reads / writes `discovered_jurisdictions`. */
export interface DiscoveryCacheAdapter {
  /** Returns the cached profile when present and not expired. */
  get(countryCode: string): Promise<DiscoveryResult | null>;
  /** Upserts a freshly-discovered profile. */
  put(input: {
    readonly countryCode: string;
    readonly result: DiscoveryResult;
  }): Promise<void>;
}

/** Service contract. */
export interface JurisdictionDiscoveryService {
  /**
   * Resolve a jurisdiction profile by country code or name.
   *
   * @param countryCodeOrName ISO-3166-1 alpha-2 (e.g. "PE") OR a
   *        country name ("Peru"). The implementation normalizes both.
   */
  discover(
    countryCodeOrName: string,
  ): Promise<DiscoveryResult>;
}
