/**
 * Raw-error-render scanner — the app-wide tripwire against rendering a raw
 * gateway error message (English wire copy) into a user-facing surface.
 *
 * WHY THIS EXISTS (Class A, language-engineering canon)
 * The gateway emits a locale-NEUTRAL envelope `{ error: { code, message } }`
 * where `message` is raw English DEV copy. Showing that `message` under an
 * `sw` session — `setError(err.message)`, `setToast(err.message)`, or
 * `... instanceof ApiError ? err.message : t(...)` rendered in an <Alert> —
 * is language MIXING, at the same severity as a functional bug. The canon:
 * NEVER render `err.message`; localise the stable `code` through
 * `localizeApiError(err, locale)` (@borjie/error-catalog).
 *
 * This scanner is the structural backstop for that review discipline. It
 * walks the owner-web source tree and flags any `.ts`/`.tsx` file whose
 * CODE (comment lines stripped) contains a forbidden raw-error-render
 * pattern. A file is "clean" once every error render flows through
 * `localizeApiError` (or a localised dictionary string / stable code) — at
 * which point its raw-`.message` renders are gone and it drops out of the
 * leak set.
 *
 * Enforcement lives in `__tests__/raw-error-render.test.ts` with the SAME
 * shrink-only ratchet as the locale-purity guard:
 *   - a NEW leak (file not on the allowlist) fails the build;
 *   - a STALE allowlist entry (file that no longer leaks) ALSO fails,
 *     forcing the baseline to shrink monotonically toward zero.
 *
 * Mutation proof: revert any converted site to `setError(err.message)` (or
 * `instanceof ApiError ? err.message`) and the file re-enters the leak set,
 * turning the "no NEW leak" assertion RED.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Forbidden raw-error-render patterns (matched against comment-stripped
 * code). Each says "a raw error `.message` is reaching a user-facing
 * render/state slot":
 *
 *  1. set<Anything>Error|Toast|Message(  …  .message  )  — the value put
 *     into a user-facing state setter is (or contains) a raw `.message`.
 *  2. instanceof ApiError ? <x>.message                  — the classic
 *     "render the raw English ApiError body" ternary.
 *  3. { (err|error|e|cause).message }                    — a BARE JSX render
 *     of the raw message in an <Alert>/inline error node (round-12b: the
 *     AskBorjie / HomeChat inline-error class the ApiError ternary missed).
 *  4. instanceof Error ? <x>.message : <LOCALISED>       — the precise
 *     MIXING signature: the fallback branch is localised (`t(…)`,
 *     `pickByLocale(…)`, `copy.x`, `S.x`, `JS.x`, `*.sw`/`*.en`) but the
 *     Error branch renders the raw English `.message` (the LicenceSurface /
 *     PlanBilling / sign-in class the `instanceof ApiError`-only pattern
 *     never saw — most caught errors are plain `Error`, not `ApiError`).
 *  5. (message|error|detail|title|description): … instanceof Error ?
 *     <x>.message                                        — a user-facing
 *     STATE FIELD / prop assigned the raw message (the genui-tab /
 *     jurisdiction / personal-kb `setState({ message: err.message })`
 *     class). `const x = …` assignments are NOT matched (those feed
 *     internal throws / dev fields), only an object property whose KEY is a
 *     known user-facing slot.
 *
 * Deliberately broad: a false positive just keeps a file on the allowlist
 * one cycle longer (the safe direction). The localised replacement
 * (`localizeError(err, locale)` / `localizeApiError(err, locale)`) contains
 * no bare `.message`, so a converted site stops matching.
 */
const RAW_ERROR_PATTERNS: readonly RegExp[] = [
  // setError(... err.message ...) / setToast(... error.message ...) etc. on
  // ONE logical line (the state-setter call and the `.message` together).
  /\bset[A-Za-z]*(?:Error|Toast|Message)\s*\([^)\n]*\b(?:err|error|e|cause)\.message\b/,
  // `instanceof ApiError ? <expr>.message` — rendering the raw ApiError body.
  /instanceof\s+ApiError\s*\?\s*[A-Za-z0-9_.]*\.message\b/,
  // `{ err.message }` — a bare JSX expression-container render of the raw
  // message. The leading `{` + trailing `}` distinguish a JSX render from an
  // object literal property (which pattern 5 owns).
  /\{\s*(?:err|error|e|cause)\.message\s*\}/,
  // `instanceof Error ? <x>.message : <LOCALISED>` — raw English on the Error
  // branch, localised on the fallback = the mixing bug. The localised set is
  // the i18n call shapes used across owner-web.
  /instanceof\s+Error\s*\?\s*[A-Za-z0-9_.]*\.message\s*:\s*(?:t\(|pickByLocale\(|copy\.|S\.|JS\.|COPY\.|[A-Za-z0-9_]+\.(?:sw|en)\b)/,
  // `<userFacingKey>: <…> instanceof Error ? <x>.message` — a user-facing
  // state-field / prop assigned the raw message. Keyed on the slot name so a
  // `const x =` internal assignment (dev message / throw arg) is NOT matched.
  /\b(?:message|error|detail|title|description)\s*:\s*[^,;\n]*\binstanceof\s+Error\s*\?\s*[A-Za-z0-9_.]*\.message\b/,
];

/** Strip whole-line comments so `.message` in a doc-comment never trips it. */
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
    // Tests are exempt (they assert on the patterns themselves).
    if (/__tests__|\.test\.|\.spec\./.test(rel)) continue;
    acc.push(rel);
  }
}

/**
 * Return the sorted list of source files (relative to `srcRoot`) that still
 * render a raw gateway error `.message` into a user-facing surface.
 */
export function findRawErrorRenders(srcRoot: string): string[] {
  const files: string[] = [];
  listSourceFiles(srcRoot, srcRoot, files);
  const leaks = files.filter((rel) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- trusted build-time scanner over the repo's own src tree (no user input)
    const code = stripCommentLines(readFileSync(join(srcRoot, rel), 'utf8'));
    return RAW_ERROR_PATTERNS.some((re) => re.test(code));
  });
  return leaks.sort();
}
