/**
 * Source Authority Tiers
 *
 * Each domain gets an authority weight in [0, 1]. Higher = more trustworthy.
 * Confidence for a claim aggregates evidence authority via evidence-scorer.ts.
 *
 * Tiers (descending authority):
 *   1.00 — primary regulator / official government publication
 *   0.95 — bank-official source (rate sheet, press release)
 *   0.85 — global multilateral (World Bank, IMF, BIS, FAO)
 *   0.75 — major international news (Reuters, FT, Bloomberg, AP)
 *   0.70 — reputable local news (The Citizen, Daily News, Mwananchi)
 *   0.65 — cross-LLM consensus (3 providers agree)
 *   0.60 — verified user contribution (org admin, officer with role)
 *   0.50 — cross-LLM consensus (2 providers agree)
 *   0.30 — anonymous user contribution
 */

const AUTHORITY_BY_DOMAIN: Readonly<Record<string, number>> = {
  // Tier 1.0 — Tanzanian official gov / regulator
  "bot.go.tz": 1.0,
  "tra.go.tz": 1.0,
  "brela.go.tz": 1.0,
  "nbs.go.tz": 1.0,
  "fcc.go.tz": 1.0,
  "nemc.go.tz": 1.0,
  "fiu.go.tz": 1.0,
  "tcra.go.tz": 1.0,
  "parliament.go.tz": 1.0,
  "ras.go.tz": 1.0,

  // Tier 0.95 — Bank official sources (Tanzania)
  "demo-bank.test": 0.95,
  "nmbbank.co.tz": 0.95,
  "nbc.co.tz": 0.95,
  "stanbicbank.co.tz": 0.95,
  "dtbafrica.com": 0.95,
  "eximbank-tz.com": 0.95,
  "kcbgroup.com": 0.95,
  "equitybankgroup.com": 0.95,
  "absa.co.tz": 0.95,
  "standardchartered.co.tz": 0.95,

  // Tier 0.85 — Global multilateral
  "worldbank.org": 0.85,
  "imf.org": 0.85,
  "bis.org": 0.85,
  "fao.org": 0.85,
  "afdb.org": 0.85,
  "afsic.net": 0.8,

  // Tier 0.75 — Major international news / data
  "reuters.com": 0.75,
  "ft.com": 0.75,
  "bloomberg.com": 0.75,
  "ap.org": 0.75,
  "wsj.com": 0.7,

  // Tier 0.70 — Reputable Tanzanian news
  "thecitizen.co.tz": 0.7,
  "dailynews.co.tz": 0.7,
  "mwananchi.co.tz": 0.7,
  "ippmedia.com": 0.65,

  // Tier 0.50 — General news / aggregators (lower trust)
  "wikipedia.org": 0.5,
  "investopedia.com": 0.5,
};

const AUTHORITY_BY_SOURCE_TYPE: Readonly<
  Record<
    | "official_gov"
    | "bank_official"
    | "regulator"
    | "news"
    | "academic"
    | "industry_report"
    | "user_contributed"
    | "llm_consensus"
    | "partner_api",
    number
  >
> = {
  official_gov: 0.95,
  regulator: 0.95,
  bank_official: 0.9,
  partner_api: 0.85,
  academic: 0.8,
  industry_report: 0.75,
  news: 0.65,
  llm_consensus: 0.55,
  user_contributed: 0.5,
};

/**
 * Resolve authority for an evidence source. Domain match wins; falls back to
 * source_type baseline. User-contributed evidence is downweighted unless the
 * contributor has a verified org role (caller must pass that as a boost).
 */
export function resolveSourceAuthority(args: {
  readonly sourceUrl: string | null;
  readonly sourceDomain: string | null;
  readonly sourceType: keyof typeof AUTHORITY_BY_SOURCE_TYPE;
  readonly verifiedContributor?: boolean;
}): number {
  const { sourceDomain, sourceType, verifiedContributor } = args;

  // Domain wins if we know it
  if (sourceDomain) {
    const domainAuthority = AUTHORITY_BY_DOMAIN[sourceDomain.toLowerCase()];
    if (typeof domainAuthority === "number") {
      return domainAuthority;
    }
  }

  // Fall back to source-type baseline
  const baseline = AUTHORITY_BY_SOURCE_TYPE[sourceType];

  if (sourceType === "user_contributed") {
    return verifiedContributor ? 0.6 : 0.3;
  }

  if (sourceType === "llm_consensus") {
    // Boost for higher consensus is applied by evidence-scorer
    return baseline;
  }

  return baseline;
}

/**
 * Extract the registrable domain from a URL. Returns null on parse failure
 * so callers can decide whether to use the source-type baseline.
 */
export function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}
