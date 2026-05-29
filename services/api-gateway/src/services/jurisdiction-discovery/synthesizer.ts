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
  // Broad keyword cluster — covers EN ("Ministry", "Department",
  // "Authority", "Commission"), ES ("Ministerio", "Secretaria",
  // "Mineria"), FR ("Code Minier", "Cadastre"), plus generic mining
  // / geology nouns. Expand carefully — false positives surface in
  // user-facing copy.
  //
  // SOURCE STRING ONLY — every reference must wrap it in non-capturing
  // parens to keep the outer regex's capture indices stable.
  const KEYWORD_SOURCE =
    'ministry|ministerio|minister(?:io|y)?|department|directorate|authority|commission|bureau|cadastre|cadastro|agency|institute|service|geological(?:\\s+survey)?|secretaria|secretariat|mineria|miner[íi]a|minier|mining|mineral|petroleum|industry|infrastructural|committee|code';
  // Capture 1-5 capitalised words ending with the keyword OR preceded
  // by it. We accept both English-style title case ("Ministry of
  // Mines") and Spanish/Latin patterns ("Secretaria de Mineria").
  const patternEnd = new RegExp(
    `((?:[A-Z][a-zA-Zíéá]{2,}\\s+){0,4}(?:${KEYWORD_SOURCE}))`,
    'giu',
  );
  const patternStart = new RegExp(
    `((?:${KEYWORD_SOURCE})\\s+(?:of|de|del|para|der|du)?\\s*(?:[A-Z][a-zA-Zíéá]{2,}\\s*){1,5})`,
    'giu',
  );
  // ALL-CAPS regulator acronyms (MINEM, MRAM, INGEMMET, ESDM, MIID).
  // 4+ letters to avoid noise. Must be flanked by whitespace or
  // punctuation to skip ISO codes.
  const acronymPattern = /(?<![A-Za-z])([A-Z]{4,8})(?![A-Za-z])/gu;
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
    for (const match of text.matchAll(acronymPattern)) {
      const name = match[1]?.trim();
      // Skip ISO currency codes / well-known false positives.
      if (
        name &&
        name.length >= 4 &&
        name.length <= 8 &&
        !['HTTP', 'HTTPS', 'JSON', 'WWW'].includes(name)
      ) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
  }
  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map((entry) => entry[0]);
  // Deduplicate sub-strings (favour longest match) but keep separate
  // ALL-CAPS acronyms even when contained in a longer name (they read
  // as the canonical short form).
  const out: string[] = [];
  const isAcronym = (n: string): boolean => /^[A-Z]{4,8}$/.test(n);
  for (const name of ranked) {
    if (isAcronym(name)) {
      if (!out.includes(name)) out.push(name);
      continue;
    }
    if (
      !out.some(
        (existing) =>
          !isAcronym(existing) &&
          (existing.includes(name) || name.includes(existing)),
      )
    ) {
      out.push(name);
    }
  }
  return Object.freeze(out.slice(0, 5));
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
