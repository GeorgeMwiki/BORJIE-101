/**
 * Locale-purity scanner — the admin-console tripwire against EN/SW
 * code-switching INSIDE a single rendered string.
 *
 * Why admin-web needs its own (different) scanner:
 *   owner-web migrated ALL Swahili into `src/i18n/` dictionaries, so its
 *   guard can flag *any* Swahili literal in a source file as a leak. The
 *   admin console keeps its bilingual copy INLINE via
 *   `pickByLocale(locale, { en, sw })` blocks — so Swahili literals are
 *   expected and correct there, and "any Swahili literal == leak" would
 *   baseline ~90 legitimate files and guard nothing.
 *
 *   The class that actually escaped review for rounds was intra-string
 *   MIXING: a single rendered string carrying BOTH languages — e.g. the
 *   `eyebrow="Platform - Uangalifu"` (English "Platform" + Swahili
 *   "Uangalifu"), or a code-switched subtitle. That is the exact thing the
 *   language canon forbids (one language per rendered context), and it is
 *   what this scanner detects.
 *
 * Heuristic: walk the source tree, pull every string literal, and flag a
 * literal that contains BOTH a Swahili marker word AND an English marker
 * word in the SAME string. Interpolation expressions (`${...}`) and
 * ALL-CAPS literal command tokens (e.g. `CONFIRM`, `NDJSON`) are stripped
 * first, so a pure-Swahili template like
 * `Huduma ya juu ilirudisha ${status}` is NOT a false positive.
 *
 * Enforcement lives in `__tests__/locale-purity.test.ts`:
 *   - a NEW mix (file not on the allowlist) fails the build;
 *   - a STALE allowlist entry (file that no longer mixes) ALSO fails,
 *     forcing the baseline to shrink monotonically toward zero.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Swahili marker words — content/function words with no English collision
 * and which are NOT loanwords (so `data`, `email`, `LLM`, `CSV` never
 * count). Presence of any (as a whole word) marks a string as containing
 * Swahili. Kept broad on the SW side: a broad SW match alone is harmless;
 * a hit only fires when an English word ALSO appears in the same string.
 */
const SWAHILI_TOKENS =
  /\b(kwa|ili|kwenye|yako|tena|wafanyakazi|mfanyakazi|madini|leseni|mgodi|migodi|dashibodi|mkurugenzi|mmiliki|ingia|nenosiri|tafadhali|samahani|kuendelea|kuthibitisha|hazina|gharama|mauzo|wasifu|zabuni|biashara|inahitajika|hakiki|imeshindwa|maelezo|karibu|habari|asante|fedha|mipangilio|wateja|ripoti|uzingatiaji|niarifu|ujumbe|afya|jukwaa|uangalifu|takwimu|mfumo|hali|ukurasa|huduma|ombi|maombi|mhusika|mdhibiti|vipimo|matukio|ucheleweshaji|matumizi|mzunguko|kura|mteja|eneo|kampuni|mzigo|aina|hifadhi|bandika)\b/i;

/**
 * English marker words — common UI nouns/verbs that have a clear Swahili
 * equivalent and are NOT Swahili loanwords. If one of these appears in the
 * SAME string as a Swahili marker, the string is code-switched. Curated
 * deliberately tight (no `data`, `email`, `id`, proper nouns) to keep the
 * false-positive rate at zero on the real tree.
 */
const ENGLISH_TOKENS =
  /\b(the|and|with|health|platform|system|worker|site|licence|license|tenant|company|shipment|overdue|remaining|today|failed|required|regulator|subject|kind|review|approved|received|exporting|exported|delivered|rejected|expired|capture|inbound|dashboard|settings|reports?|welcome|please|sorry|continue|profile|overview|owner|manager|employee|buyer|seller|pending|active|inactive|export|import|search|filter|status|details?|summary|loading|refresh|cancel|submit|confirm|delete|create|update|edit|view|open|close|back|next|previous)\b/i;

/** Strip whole-line comments so Swahili/English in doc-comments is ignored. */
function stripCommentLines(src: string): string {
  return src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
}

/**
 * Extract every single-, double-, and backtick-quoted string literal from a
 * source blob. Good enough for a build-time heuristic over our own tree —
 * it does not need to be a full JS lexer.
 */
function extractStringLiterals(src: string): string[] {
  const out: string[] = [];
  const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '');
  }
  return out;
}

/**
 * Remove `${...}` interpolation expressions (variable names are CODE, not
 * rendered prose) and ALL-CAPS literal command tokens (e.g. `CONFIRM`,
 * `NDJSON`) before language matching, so a pure-Swahili template that
 * happens to interpolate `${status}` is not mis-flagged as mixed.
 */
function normalizeForMatch(literal: string): string {
  return literal
    .replace(/\$\{[^}]*\}/g, ' ')
    .replace(/\b[A-Z][A-Z0-9_]{2,}\b/g, ' ');
}

function listSourceFiles(dir: string, root: string, acc: string[]): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- trusted build-time scanner over the repo's own src tree (no user input)
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      listSourceFiles(full, root, acc);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    const rel = full.slice(root.length + 1);
    // i18n tooling (this scanner + the allowlist) and tests are exempt.
    if (rel.startsWith('i18n/')) continue;
    if (/__tests__|\.test\.|\.spec\./.test(rel)) continue;
    acc.push(rel);
  }
}

/**
 * Return the sorted list of source files (relative to `srcRoot`) that
 * contain at least one string literal mixing English and Swahili.
 */
export function findLanguageMixes(srcRoot: string): string[] {
  const files: string[] = [];
  listSourceFiles(srcRoot, srcRoot, files);
  const mixed = files.filter((rel) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- trusted build-time scanner over the repo's own src tree (no user input)
    const code = stripCommentLines(readFileSync(join(srcRoot, rel), 'utf8'));
    return extractStringLiterals(code).some((literal) => {
      const normalized = normalizeForMatch(literal);
      return SWAHILI_TOKENS.test(normalized) && ENGLISH_TOKENS.test(normalized);
    });
  });
  return mixed.sort();
}
