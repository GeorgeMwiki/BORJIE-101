/**
 * Raw-error-message render scanner — the admin-console tripwire against
 * rendering a gateway error's RAW (locale-NEUTRAL, English) `message` to the
 * user instead of localizing it through the shared catalog.
 *
 * The class this kills (Class A):
 *   The api-client carries a failure as `{ code, message }` where `message` is
 *   the raw wire diagnostic (dev-only) and `code` is the stable gateway code.
 *   A render site that shows `query.error.message` / `err.message` puts that
 *   raw English string in front of the operator. Under the `sw` toggle that is
 *   language MIXING (English error under Swahili chrome), on every failure,
 *   that neither the intra-string locale-purity scanner nor the hardcoded-EN
 *   component scanner can see (the leaked text is a runtime VALUE, not a
 *   literal). The fix is `localizeApiError(err, locale)` from
 *   `@borjie/error-catalog`, which resolves the stable `code` to localized copy.
 *
 * What this flags (a file is an offender when it carries either shape OUTSIDE
 * the i18n tooling / api-client / tests):
 *   1. a JSX-rendered raw error message — `{<ident>.error.message}` (the
 *      react-query error-state render) — that is NOT inside a
 *      `localizeApiError(...)` call; OR
 *   2. an `err instanceof Error ? err.message : ...` ternary (the onError
 *      toast pattern) that surfaces the raw `.message` instead of localizing.
 *
 * What it deliberately IGNORES (to keep the false-positive rate at zero):
 *   - `localizeApiError(<ident>.error, locale)` / `localizeApiError(err, …)` —
 *     the localized path is the FIX, not a leak;
 *   - `.message` reads that feed a logger / structured-log call (dev channel),
 *     never a render;
 *   - the api-client + error-catalog modules themselves (they DEFINE the
 *     `message` field), and i18n tooling / tests.
 *
 * The heuristic is a text scanner (not a full JSX/TS parser): it runs
 * build-time over OUR OWN tree, and the enforcement test proves it bites
 * (a mutation reintroducing a raw render flips it RED). It mirrors the shape
 * of `locale-purity.ts` / `hardcoded-en.ts`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A JSX render of a raw react-query error message: `{<ident>.error.message}`
 * (e.g. `{query.error.message}`, `{catalogQuery.error.message}`). The `.error`
 * segment is what distinguishes a react-query error render from an arbitrary
 * `.message` field read.
 */
const RAW_ERROR_JSX = /\{\s*[A-Za-z_$][\w$]*\.error\.message\s*\}/;

/**
 * The onError-toast leak: `<id> instanceof Error ? <id>.message : ...`. The
 * raw `.message` branch is the leak; the localized form replaces the whole
 * ternary with `localizeApiError(<id>, locale)`.
 */
const RAW_ERROR_TERNARY = /\b([A-Za-z_$][\w$]*) instanceof Error \?\s*\1\.message\b/;

/**
 * Strip whole-line comments and import lines so a `.message` mention in a
 * doc-comment or a module path is never matched.
 */
function stripNonRenderLines(src: string): string {
  return src
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return false;
      if (t.startsWith('import ') || t.startsWith('export {')) return false;
      return true;
    })
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
    if (!/\.tsx$/.test(entry.name)) continue;
    const rel = full.slice(root.length + 1);
    if (rel.startsWith('i18n/')) continue;
    if (/__tests__|\.test\.|\.spec\./.test(rel)) continue;
    acc.push(rel);
  }
}

/** True when the file carries a raw-error render leak (either shape). */
export function fileRendersRawError(src: string): boolean {
  const code = stripNonRenderLines(src);
  return RAW_ERROR_JSX.test(code) || RAW_ERROR_TERNARY.test(code);
}

/**
 * Return the sorted list of component / page `.tsx` files (relative to
 * `srcRoot`) that render a RAW gateway error message instead of localizing it
 * through `localizeApiError`.
 */
export function findRawErrorRenders(srcRoot: string): string[] {
  const files: string[] = [];
  listSourceFiles(srcRoot, srcRoot, files);
  return files
    .filter((rel) => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- trusted build-time scanner over the repo's own src tree (no user input)
      const raw = readFileSync(join(srcRoot, rel), 'utf8');
      return fileRendersRawError(raw);
    })
    .sort();
}
