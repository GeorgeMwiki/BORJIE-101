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
  /\b(kwa|ili|kwenye|yako|tena|wafanyakazi|mfanyakazi|madini|leseni|mgodi|migodi|nyumbani|dashibodi|mkurugenzi|mmiliki|ingia|nenosiri|nywila|tafadhali|samahani|kuendelea|kuthibitisha|hazina|gharama|mauzo|wasifu|zabuni|biashara|inahitajika|hakiki|imeshindwa|maelezo|karibu|habari|asante|fedha|mipangilio|wateja|ripoti|uzingatiaji|hati|mali)\b/i;

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
