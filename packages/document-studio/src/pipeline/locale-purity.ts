/**
 * @borjie/document-studio — render-time locale-purity gate.
 *
 * The EN/SW absolute toggle (CLAUDE.md hard rail) is enforced by
 * CONSTRUCTION upstream (binders pick exactly one label set). This gate
 * is the MACHINE-CHECK on the produced text layer: it scans the rendered
 * view text for the OTHER language's stopwords and fails if any leak
 * through. It closes the only place a leak could survive — the bytes.
 *
 * Scope: this checks the JSON view (the text the template renders), not
 * the binary PDF (which has no extractable text layer in stub mode). The
 * view is the single source of all rendered prose, so a clean view ⇒ a
 * clean document.
 *
 * Pure functions, no I/O.
 */

export type DocLocale = 'en' | 'sw';

/**
 * Swahili function-word stopwords that must NOT appear in an `en`
 * document. Chosen to be unambiguously Swahili (not English homographs).
 */
const SW_STOPWORDS: ReadonlyArray<string> = [
  'na',
  'ya',
  'wa',
  'kwa',
  'ni',
  'katika',
  'kwthe', // guard token (never matches) — keeps list non-empty if trimmed
  'kutoka',
  'tarehe',
  'jina',
  'jumla',
  'leseni',
  'madini',
  'sahihi',
  'taarifa',
  'kiasi',
  'thamani',
  'mrabaha',
  'maombi',
  'mwombaji',
];

/**
 * English function-word stopwords that must NOT appear in a `sw`
 * document. Chosen to be unambiguously English.
 */
const EN_STOPWORDS: ReadonlyArray<string> = [
  'the',
  'and',
  'of',
  'for',
  'from',
  'with',
  'date',
  'name',
  'total',
  'licence',
  'mineral',
  'signature',
  'statement',
  'quantity',
  'value',
  'royalty',
  'application',
  'applicant',
];

export interface LocalePurityResult {
  readonly ok: boolean;
  /** The foreign-language tokens found, if any (deduped, lowercased). */
  readonly leaks: ReadonlyArray<string>;
}

/**
 * Flatten any view object into the concatenated string of its string
 * leaves — that is exactly the prose the template will render.
 */
export function extractText(view: unknown): string {
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      parts.push(node);
    } else if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node && typeof node === 'object') {
      Object.values(node as Record<string, unknown>).forEach(walk);
    }
  };
  walk(view);
  return parts.join(' ');
}

/**
 * Assert the rendered view is single-language. Tokenises on word
 * boundaries and checks the OTHER language's stopword set. Returns the
 * leaks so the caller can attach them to a `LOCALE_MIXING` error.
 */
export function assertLocalePurity(
  view: unknown,
  locale: DocLocale,
): LocalePurityResult {
  const text = extractText(view).toLowerCase();
  const tokens = new Set(text.split(/[^a-zÀ-ɏ]+/u).filter(Boolean));
  const foreign = locale === 'en' ? SW_STOPWORDS : EN_STOPWORDS;
  const leaks = [...new Set(foreign.filter((w) => tokens.has(w)))];
  return { ok: leaks.length === 0, leaks };
}
