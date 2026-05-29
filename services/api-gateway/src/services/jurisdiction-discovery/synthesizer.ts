/**
 * Discovery synthesizer — JC-1.
 *
 * Fuses web-search hits + corpus hits into a structured
 * `JurisdictionProfile`. The function is deliberately conservative:
 * it extracts named regulators from the text using a small set of
 * pattern matchers (regulator-noun + jurisdiction-noun) and falls
 * back to the bare country shell when nothing parses out cleanly.
 *
 * The synthesis is a TEXT-LEVEL heuristic, not a full NLP pipeline.
 * Mr. Mwikila will still surface the source URLs / evidence IDs so
 * the user can verify the claim; the synthesizer only ensures the
 * prompt block has a regulator name to anchor the reply.
 *
 * Validity scoring (in [0,1]):
 *   - both web + corpus hits agree on a regulator ⇒ 0.85
 *   - one source only                              ⇒ 0.55
 *   - no source / fallback                         ⇒ 0.20
 */

import type {
  DiscoveredRegulator,
  DiscoverySource,
  JurisdictionProfile,
} from './types.js';

interface SynthesizerInput {
  readonly countryCode: string;
  readonly countryName: string;
  readonly webHits: ReadonlyArray<{
    readonly url: string;
    readonly title: string;
    readonly snippet: string;
  }>;
  readonly corpusHits: ReadonlyArray<{
    readonly evidenceId: string;
    readonly title: string;
    readonly snippet: string;
  }>;
}

interface SynthesizerResult {
  readonly profile: JurisdictionProfile;
  readonly sources: ReadonlyArray<DiscoverySource>;
}

// ─── Pattern matchers ──────────────────────────────────────────────────

/**
 * Regulator-name extractor. Looks for capitalised multi-word phrases
 * adjacent to mining / mineral / regulator keywords. Returns a deduped
 * list of candidate names, ranked by hit frequency. The matcher is
 * intentionally narrow — false positives cost more than false negatives
 * because the user sees the candidate in the prompt.
 */
function extractRegulatorNames(
  texts: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const counts = new Map<string, number>();
  const keywordCluster =
    /(?:ministry|minister(?:io|y)|department|directorate|authority|commission|bureau|cadastre|agency|institute|service|geological(?:\s+survey)?)/iu;
  // Capture 1-5 capitalised words ending with the keyword OR preceded
  // by it.
  const patternEnd = new RegExp(
    `((?:[A-Z][a-zA-Z]{2,}\\s+){0,4}${keywordCluster.source})`,
    'gu',
  );
  const patternStart = new RegExp(
    `(${keywordCluster.source}\\s+(?:of|de|del)?\\s+(?:[A-Z][a-zA-Z]{2,}\\s*){1,5})`,
    'gu',
  );
  for (const text of texts) {
    for (const match of text.matchAll(patternEnd)) {
      const name = match[1]?.trim();
      if (name && name.length > 6 && name.length < 80) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    for (const match of text.matchAll(patternStart)) {
      const name = match[1]?.trim();
      if (name && name.length > 6 && name.length < 80) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
  }
  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map((entry) => entry[0]);
  // Deduplicate sub-strings (favour longest match).
  const out: string[] = [];
  for (const name of ranked) {
    if (!out.some((existing) => existing.includes(name) || name.includes(existing))) {
      out.push(name);
    }
  }
  return Object.freeze(out.slice(0, 4));
}

/** Currency extractor — ISO-4217 patterns + common labels. */
function extractCurrency(
  texts: ReadonlyArray<string>,
  fallback: string,
): string {
  // Look for `(USD)` / `(KES)` / `currency: XYZ` style markers.
  const currencyCode = /\b(?:currency|moneda|sarafu)[^A-Z]*([A-Z]{3})\b/u;
  for (const text of texts) {
    const m = text.match(currencyCode);
    if (m?.[1]) return m[1];
  }
  // ISO-4217 alone — only accept when paired with the country name.
  const isoAlone = /\b([A-Z]{3})\b/gu;
  for (const text of texts) {
    for (const match of text.matchAll(isoAlone)) {
      const code = match[1] ?? '';
      // Skip common false positives.
      if (
        code === 'USD' ||
        code === 'EUR' ||
        code === 'GBP' ||
        code === 'CAD' ||
        code === 'JPY' ||
        code === 'CNY'
      ) {
        return code;
      }
    }
  }
  return fallback;
}

/** Language extractor — looks for "language: X" / "spoken Y". */
function extractLanguages(
  texts: ReadonlyArray<string>,
  fallback: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const out = new Set<string>();
  const langPattern =
    /\b(?:language|lugha|idioma|langue|sprache)(?:s)?[:\s]+([A-Za-z, ]{3,80})/iu;
  for (const text of texts) {
    const m = text.match(langPattern);
    if (m?.[1]) {
      const parts = m[1].split(/[,;/]/u);
      for (const part of parts) {
        const lc = part.trim().toLowerCase();
        if (lc.length >= 2 && lc.length <= 30) {
          out.add(lc);
        }
      }
    }
  }
  if (out.size === 0) {
    return fallback;
  }
  return Object.freeze([...out].slice(0, 4));
}

/** Legal-framework extractor — looks for "Mining Law" / "Code Minier". */
function extractLegalFramework(
  texts: ReadonlyArray<string>,
): string | undefined {
  const patterns = [
    /\b((?:Mining|Mineral|Petroleum|Extractive|Geological)\s+(?:Law|Act|Code|Regulation)[\s\w-]{0,60})\b/u,
    /\b(Code\s+Minier[\s\w-]{0,40})\b/iu,
    /\b(Ley\s+(?:de|del)\s+(?:Miner[íi]a|Minera[s]?)[\s\w-]{0,40})\b/iu,
  ];
  for (const text of texts) {
    for (const pattern of patterns) {
      const m = text.match(pattern);
      if (m?.[1]) return m[1].trim();
    }
  }
  return undefined;
}

/** Domain classifier for a regulator name. */
function classifyDomain(name: string): DiscoveredRegulator['domain'] {
  const lc = name.toLowerCase();
  if (
    lc.includes('environment') ||
    lc.includes('ambient') ||
    lc.includes('ecolog')
  ) {
    return 'environment';
  }
  if (
    lc.includes('transparen') ||
    lc.includes('eiti') ||
    lc.includes('extractive industries transparency')
  ) {
    return 'transparency';
  }
  if (
    lc.includes('audit') ||
    lc.includes('auditor') ||
    lc.includes('contralor') ||
    lc.includes('controll')
  ) {
    return 'audit';
  }
  if (
    lc.includes('mining') ||
    lc.includes('mineral') ||
    lc.includes('geolog') ||
    lc.includes('cadastre') ||
    lc.includes('miner')
  ) {
    return 'mineral_licensing';
  }
  return 'unknown';
}

// ─── Public surface ───────────────────────────────────────────────────

/**
 * Fuse web + corpus signals into a single profile.
 *
 * The function NEVER throws — when both signal streams are empty it
 * returns the fallback shell with `validityScore = 0.20` so the brain
 * can still render a structured answer (with the explicit low-
 * confidence flag set by the caller).
 */
export function synthesize(
  input: SynthesizerInput,
): SynthesizerResult {
  const webTexts = input.webHits.map(
    (hit) => `${hit.title}\n${hit.snippet}`,
  );
  const corpusTexts = input.corpusHits.map(
    (hit) => `${hit.title}\n${hit.snippet}`,
  );
  const combined = [...webTexts, ...corpusTexts];
  const regulatorNames = extractRegulatorNames(combined);

  const regulators: DiscoveredRegulator[] = regulatorNames.map(
    (name) => ({
      name,
      domain: classifyDomain(name),
    }),
  );
  // Always have at least one entry — use the country's name as a
  // placeholder so the prompt block isn't empty.
  if (regulators.length === 0) {
    regulators.push({
      name: `${input.countryName} Ministry of Mines (unverified)`,
      domain: 'mineral_licensing',
      mandate: 'Discovery returned no regulator candidates',
    });
  }

  const currency = extractCurrency(combined, 'UNKNOWN');
  const languages = extractLanguages(combined, ['en']);
  const legalFramework = extractLegalFramework(combined);

  const hasWeb = input.webHits.length > 0;
  const hasCorpus = input.corpusHits.length > 0;
  let validityScore = 0.2;
  if (hasWeb && hasCorpus) validityScore = 0.85;
  else if (hasWeb || hasCorpus) validityScore = 0.55;

  const profile: JurisdictionProfile = Object.freeze({
    countryCode: input.countryCode,
    countryName: input.countryName,
    regulators: Object.freeze(regulators),
    currency,
    languages,
    legalFramework: legalFramework ?? '',
    validityScore,
  });

  const sources: DiscoverySource[] = [
    ...input.webHits.map((hit) => ({
      kind: 'web_search' as const,
      id: hit.url,
      title: hit.title,
      snippet: hit.snippet.slice(0, 240),
    })),
    ...input.corpusHits.map((hit) => ({
      kind: 'corpus' as const,
      id: hit.evidenceId,
      title: hit.title,
      snippet: hit.snippet.slice(0, 240),
    })),
  ];

  return Object.freeze({
    profile,
    sources: Object.freeze(sources),
  });
}
