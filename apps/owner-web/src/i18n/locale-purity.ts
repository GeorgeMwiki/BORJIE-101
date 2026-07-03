/**
 * Locale-purity scanner — the app-wide tripwire that makes EN/SW mixing
 * impossible to ship by accident.
 *
 * It walks the owner-web source tree and flags any `.ts`/`.tsx` file that
 * contains hardcoded Swahili in CODE (comment lines stripped first, so
 * Swahili prose in a doc-comment never trips it). A file is "pure" once
 * every user-facing string flows through `t()` (the dictionaries hold the
 * Swahili; source files hold only keys + English-source data) — at which
 * point its Swahili literals are gone and it drops out of the leak set.
 *
 * Enforcement lives in `__tests__/locale-purity.test.ts`:
 *   - a NEW leak (file not on the allowlist) fails the build;
 *   - a STALE allowlist entry (file that no longer leaks) ALSO fails,
 *     forcing the baseline to shrink monotonically toward zero.
 *
 * Heuristic ported from the discovery-session audit (/tmp/mix-audit2.mjs).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Swahili marker tokens. Presence of any (as a whole word, in code) is a
 * strong signal of a hardcoded Swahili string. Kept deliberately broad —
 * false positives just mean a file stays on the allowlist one cycle
 * longer, which is the safe direction.
 */
const SWAHILI_TOKENS =
  /\b(kwa|ili|kwenye|yako|tena|wafanyakazi|mfanyakazi|madini|leseni|mgodi|migodi|nyumbani|dashibodi|mkurugenzi|mmiliki|ingia|nenosiri|nywila|tafadhali|samahani|kuendelea|kuthibitisha|hazina|gharama|mauzo|wasifu|zabuni|biashara|inahitajika|hakiki|imeshindwa|maelezo|karibu|habari|asante|fedha|mipangilio|wateja|ripoti|uzingatiaji|hati|mali|niarifu|toka|inatoka|tueleze|ujumbe)\b/i;

/** Strip whole-line comments so Swahili in doc-comments is ignored. */
function stripCommentLines(src: string): string {
  return src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
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
    // The dictionaries hold the only legitimate Swahili; tests are exempt.
    if (rel.startsWith('i18n/')) continue;
    if (/__tests__|\.test\.|\.spec\./.test(rel)) continue;
    acc.push(rel);
  }
}

/**
 * Return the sorted list of source files (relative to `srcRoot`) that
 * still contain hardcoded Swahili in code.
 */
export function findSwahiliLeaks(srcRoot: string): string[] {
  const files: string[] = [];
  listSourceFiles(srcRoot, srcRoot, files);
  const leaks = files.filter((rel) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- trusted build-time scanner over the repo's own src tree (no user input)
    const code = stripCommentLines(readFileSync(join(srcRoot, rel), 'utf8'));
    return SWAHILI_TOKENS.test(code);
  });
  return leaks.sort();
}

// ─────────────────────────────────────────────────────────────────────────
// English-in-Swahili detector — the TWIN gap `findSwahiliLeaks` cannot see.
//
// `findSwahiliLeaks` drives Swahili OUT of components INTO the `i18n/` tree,
// which it then EXEMPTS. That left the `sw:` half of the hand-authored
// `i18n/strings/*` bilingual pairs unscanned — so an untranslated English word
// sitting inside a Swahili string (`sw: 'Counter zinasubiri'`,
// `sw: 'Pakia hati · Upload document'`) was a FALSE-GREEN: pure zero-mix by the
// language canon, invisible to every gate. This detector closes that class by
// scanning ONLY the `sw:` string literals for free-standing English markers.
//
// The generated `dictionaries/sw.ts` is out of scope here — it carries no `sw:`
// inline pairs (it is a `"key": "value"` tree) and is contamination-checked by
// its generator (`scripts/i18n-generate-sw.ts`).
// ─────────────────────────────────────────────────────────────────────────

/**
 * Common English words that have NO business inside a Swahili string and are
 * NOT domain loanwords/proper nouns — function words + common UI/domain
 * vocabulary that always have a Swahili equivalent. A COMPREHENSIVE set, not a
 * hand-picked few: a narrow list is a false-green risk (it missed `events` /
 * `team` / `only` until each leak surfaced). This full set was verified to
 * produce ZERO false positives across all ~2950 sw values in the real bundle
 * (with the length≥2 guard below that lets single-letter labels — "shaft A" —
 * through). A genuine loanword that trips it is added to ENGLISH_PROPER_NOUNS.
 */
const ENGLISH_MARKER_WORDS = new Set<string>(
  (
    'the be to of and in that have it for not on with he as you do at this but ' +
    'his by from they we say her she or an will my one all would there their ' +
    'what so up out if about who get which go me when make can like time no ' +
    'just him know take people into year good some could them see other than ' +
    'then now look only come its over think also back after use two how our ' +
    'work first well way even new want because any these give day most us is ' +
    'are was were been has had did got said made went team ' +
    'open close cancel submit save saved search loading settings profile ' +
    'report reports overview show stop expand collapse upload download ' +
    'selected needed remaining ready need call matched pending average price ' +
    'prices sell buy buyer buyers seller distance unknown status total amount ' +
    'document documents counter offer offers outbound inbound today yesterday ' +
    'tomorrow welcome hello please thanks thank failed error retry next ' +
    'previous back home page dashboard account sign login logout register ' +
    'edit delete update create remove add view list detail summary approved ' +
    'rejected draft signed sent received per each every enable disable active ' +
    'inactive online offline invoice payment balance revenue cost profit loss ' +
    'shift event events period date time hour hours day days week month year ' +
    'manager worker workforce site mineral licence royalty market listing bid'
  ).split(/\s+/),
);

/**
 * Proper nouns / brand+feature names / acronyms — locale-invariant, never
 * translated in ANY locale ("Windows Hello", "Touch ID", "Chat", "Mwikila",
 * "parcel" the domain loanword). A marker word that IS one of these is not a
 * leak.
 */
const ENGLISH_PROPER_NOUNS = new Set<string>([
  'parcel', 'parcels', 'rfb', 'rfbs', 'eia', 'nida', 'lbma', 'lmbm', 'pdf',
  'portfolio', 'dashibodi', 'batch', 'docs', 'eta', 'gps', 'api', 'sms',
  'chat', 'mwikila', 'borjie', 'windows', 'hello', 'touch', 'id',
  'ledgerservice', 'kiosk',
]);

/**
 * Reduce a `sw` value to its "free English" residue: drop `{placeholders}`
 * (the token inside is a variable name, not rendered copy), URL/path tokens
 * (`/api/v1/reports`), keyboard chords (`Shift+Enter`), and hyphenated
 * compounds (`drag-and-drop`, `report-engine`, `clock-in` — retained technical
 * terms used identically in both locales). What survives is prose that, if it
 * carries an English marker, is a genuine mix.
 */
function englishResidue(value: string): string {
  return value
    .replace(/\{[^}]*\}/g, ' ')
    .split(/\s+/)
    .filter(
      (tok) =>
        !tok.includes('/') && !tok.includes('+') && !/[a-z]-[a-z]/i.test(tok),
    )
    .join(' ');
}

/**
 * First English marker word in a `sw` value, or `null` if the residue is pure
 * Swahili. Tokenizes the residue (lower-cased, punctuation stripped) and
 * returns the first token that is a length≥2 English marker and not a proper
 * noun. The length≥2 guard lets single-letter labels ("shaft A", "phase I")
 * through — those are designators, not the English article "a".
 */
function firstEnglishMarker(value: string): string | null {
  const tokens = englishResidue(value)
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/);
  for (const tok of tokens) {
    if (
      tok.length >= 2 &&
      ENGLISH_MARKER_WORDS.has(tok) &&
      !ENGLISH_PROPER_NOUNS.has(tok)
    ) {
      return tok;
    }
  }
  return null;
}

/** Whether the `i18n/strings` tree should be scanned (skip tests). */
function isScannableStringModule(rel: string): boolean {
  if (!/\.(ts|tsx)$/.test(rel)) return false;
  if (/__tests__|\.test\.|\.spec\./.test(rel)) return false;
  // Only the hand-authored bilingual `strings/*` modules carry `sw:` pairs.
  return rel.startsWith('strings/');
}

function listI18nFiles(dir: string, root: string, acc: string[]): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- trusted build-time scanner over the repo's own src tree (no user input)
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      listI18nFiles(full, root, acc);
      continue;
    }
    const rel = full.slice(root.length + 1);
    if (isScannableStringModule(rel)) acc.push(rel);
  }
}

/** A single English-in-Swahili leak: the file, 1-based line, value, marker. */
export interface EnglishInSwahiliLeak {
  readonly file: string;
  readonly line: number;
  readonly value: string;
  readonly marker: string;
}

/**
 * The `sw:` PREFIX — the key, an optional arrow-function wrapper
 * (`sw: (x: string): string => …`), up to the first value token. What follows
 * is consumed as a string-concatenation expression (below), so no value shape
 * can evade the scan.
 */
const SW_PREFIX =
  /\bsw:\s*(?:\([^)]*\)(?:\s*:\s*[\w<>[\] |]+)?\s*=>\s*)?/g;

/** A single string literal at the START of `s` — quote/double/backtick. */
const LEADING_STRING = /^(['"`])((?:\\.|(?!\1)[\s\S])*)\1/;

/** Whitespace + `+` + whitespace: a string-concatenation continuation. */
const CONCAT_JOIN = /^\s*\+\s*/;

/**
 * Return every English-in-Swahili leak under `i18nRoot/strings` — a `sw:`
 * value whose residue carries a free-standing English marker that is not a
 * proper noun.
 *
 * Consumes the FULL value after `sw:`, including a `'a' + 'b' + `c`` string
 * concatenation spanning newlines (a continuation segment is a separate literal
 * NOT preceded by `sw:`, so a naive quote-only regex would scan only the first
 * segment — a false-green). The leak line is derived from the match offset;
 * results sort by `file:line` for a stable, diffable gate.
 */
export function findEnglishInSwahiliLeaks(
  i18nRoot: string,
): EnglishInSwahiliLeak[] {
  const files: string[] = [];
  listI18nFiles(i18nRoot, i18nRoot, files);
  const leaks: EnglishInSwahiliLeak[] = [];
  for (const rel of files) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- trusted build-time scanner over the repo's own src tree (no user input)
    const src = readFileSync(join(i18nRoot, rel), 'utf8');
    SW_PREFIX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SW_PREFIX.exec(src)) !== null) {
      // From the end of the `sw:` prefix, pull every `+`-joined string literal.
      let pos = SW_PREFIX.lastIndex;
      const segments: string[] = [];
      for (;;) {
        const lit = LEADING_STRING.exec(src.slice(pos));
        if (!lit) break;
        segments.push(lit[2] ?? '');
        pos += lit[0].length;
        const join = CONCAT_JOIN.exec(src.slice(pos));
        if (!join) break;
        pos += join[0].length;
      }
      // Skip past the consumed value so a `sw:` substring inside it can't
      // re-trigger a match.
      SW_PREFIX.lastIndex = Math.max(SW_PREFIX.lastIndex, pos);
      if (segments.length === 0) continue;
      const value = segments.join('');
      const hit = firstEnglishMarker(value);
      if (hit) {
        // 1-based line of the `sw:` match start.
        const line = src.slice(0, m.index).split('\n').length;
        leaks.push({ file: rel, line, value, marker: hit });
      }
    }
  }
  return leaks.sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1,
  );
}
