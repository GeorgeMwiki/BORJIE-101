/**
 * detectLanguage — best-effort ISO 639-1 detector.
 *
 * Strategy:
 *   1. If `franc-min` is installed (peer dep), use it — it covers ~80
 *      languages with one-line lookups.
 *   2. Otherwise fall back to a tiny keyword-based scorer that handles
 *      our TZ/KE/UG/NG primary set (en, sw, fr, ar, pt, lg, yo).
 *
 * The detector is fully synchronous in the fallback path. The franc
 * path is async because we dynamically import the peer.
 */

import type { LanguageCode } from '../types.js';

const FRANC_TO_LANG: Readonly<Record<string, LanguageCode>> = Object.freeze({
  eng: 'en',
  swa: 'sw',
  fra: 'fr',
  arb: 'ar',
  por: 'pt',
  kin: 'rw',
  lug: 'lg',
  som: 'so',
  amh: 'am',
  yor: 'yo',
  ibo: 'ig',
  hau: 'ha',
  zul: 'zu',
});

const FALLBACK_KEYWORDS: ReadonlyArray<{ readonly lang: LanguageCode; readonly terms: ReadonlyArray<string> }> =
  Object.freeze([
    { lang: 'sw', terms: ['mkataba', 'mwenye', 'mpangaji', 'kodi', 'nyumba', 'mwezi', 'tarehe'] },
    { lang: 'fr', terms: ['contrat', 'loyer', 'locataire', 'propriétaire', 'mensuel', 'date'] },
    { lang: 'pt', terms: ['contrato', 'aluguer', 'inquilino', 'proprietário', 'mensal', 'data'] },
    { lang: 'lg', terms: ['enyumba', 'omupangisa', 'omuwumbi', 'kukola', 'omwezi'] },
    { lang: 'yo', terms: ['adehun', 'ile', 'osu', 'oluyalo', 'iyaluile'] },
    { lang: 'en', terms: ['agreement', 'tenant', 'landlord', 'rent', 'month', 'date'] },
  ]);

const ARABIC_RANGE = /[؀-ۿ]/;
const AMHARIC_RANGE = /[ሀ-፿]/;

export interface DetectLanguageOptions {
  /**
   * Inject a custom franc loader for tests. When provided, the dynamic
   * import is skipped.
   */
  readonly loader?: () => Promise<((s: string) => string) | null>;
}

export async function detectLanguage(
  text: string,
  options: DetectLanguageOptions = {}
): Promise<LanguageCode> {
  const cleaned = text.trim();
  if (cleaned.length === 0) return 'und';

  // Script-based quick checks before any token analysis.
  if (ARABIC_RANGE.test(cleaned)) return 'ar';
  if (AMHARIC_RANGE.test(cleaned)) return 'am';

  const franc = await loadFranc(options.loader);
  if (franc) {
    const code = franc(cleaned);
    return FRANC_TO_LANG[code] ?? fallbackDetect(cleaned);
  }
  return fallbackDetect(cleaned);
}

/** Synchronous detector with the fallback heuristic only. */
export function detectLanguageSync(text: string): LanguageCode {
  const cleaned = text.trim();
  if (cleaned.length === 0) return 'und';
  if (ARABIC_RANGE.test(cleaned)) return 'ar';
  if (AMHARIC_RANGE.test(cleaned)) return 'am';
  return fallbackDetect(cleaned);
}

function fallbackDetect(text: string): LanguageCode {
  const lower = text.toLowerCase();
  let bestLang: LanguageCode = 'und';
  let bestScore = 0;
  for (const entry of FALLBACK_KEYWORDS) {
    let score = 0;
    for (const term of entry.terms) {
      if (lower.includes(term)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestLang = entry.lang;
    }
  }
  return bestScore > 0 ? bestLang : 'und';
}

async function loadFranc(
  loader?: () => Promise<((s: string) => string) | null>
): Promise<((s: string) => string) | null> {
  if (loader) return await loader();
  try {
    const mod = (await import('franc-min' as string)) as { franc: (s: string) => string };
    return mod.franc;
  } catch {
    return null;
  }
}
