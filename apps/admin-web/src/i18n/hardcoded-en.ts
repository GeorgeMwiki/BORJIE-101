/**
 * Hardcoded-EN component detector — the admin-console tripwire against the
 * SURFACE-LEVEL language mix the round-9 intra-string scanner is BLIND to.
 *
 * Why a second scanner:
 *   `locale-purity.ts` catches a single rendered STRING carrying both
 *   languages (`Platform - Uangalifu`). It says NOTHING about a component
 *   whose every visible string is pure, correct English but which has NO
 *   locale awareness at all. Under the `sw` toggle that component renders
 *   English while the chrome around it renders Swahili — a mix at the
 *   SURFACE, on every load, that the intra-string gate cannot see (no single
 *   string is bilingual). The zero-mix canon forbids it just the same: one
 *   language per rendered context, matching the active locale.
 *
 * What this flags (a file is an offender when 1 + 3 hold AND EITHER 2a or 2b):
 *   1. It is a component / page `.tsx` that RENDERS user-facing English —
 *      either a JSX text node of >= 2 English words, or one of the
 *      user-facing attributes (`title=` / `label=` / `placeholder=` /
 *      `aria-label=` / `eyebrow=` / `subtitle=`) carrying English prose; AND
 *   2a. (NO-LOCALE shape) it has ZERO `pickByLocale` / `useLocale` token in the
 *      file (it cannot be selecting a per-locale branch); OR
 *   2b. (USES-LOCALE-BUT-HARDCODES-ENGLISH shape — the round-13 widening) it
 *      RESOLVES the active locale (`useLocale()` / a `bcp47For(locale)` date
 *      formatter) but has ZERO `pickByLocale` — so it localizes the DATE/number
 *      yet emits its prose as hardcoded title-case English. Under `sw` the
 *      timestamps read Swahili-formatted while the surrounding copy stays
 *      English: the same surface-level mix, hidden from the original rule
 *      because the bare `useLocale` token tripped its locale-aware exemption.
 *      Only `pickByLocale` (a per-locale STRING branch) clears prose; resolving
 *      the locale for formatting alone does not; OR
 *   2c. (PER-STRING-LEAK shape — the round-14 widening) the file DOES localize
 *      most of its surface with `pickByLocale`, but a FEW rendered prose runs
 *      escaped the i18n layer (a hardcoded JSX text node, or a string-literal
 *      `title=` / `placeholder=` value). The round-13 rule cleared the WHOLE
 *      file the instant it saw `pickByLocale` ANYWHERE — so a single hardcoded
 *      sentence inside an otherwise-localized component was invisible. This
 *      widening removes the whole-file exemption: clearing is now decided
 *      PER RENDERED STRING. A prose run clears ONLY when it is itself wrapped in
 *      the i18n layer — a localized render reaches the screen as `{pickByLocale(
 *      …)}` (a JSX expression) or `attr={pickByLocale(…)}` (an expression
 *      attribute), and the render scanners below structurally skip BOTH the
 *      `{ … }` text-node form and the `={ … }` expression-attribute form. What
 *      remains visible to the scanner is exactly the prose that bypassed i18n:
 *      a bare `>English run<` text node or a `="English run"` string-literal
 *      attribute. The `en:` / `sw:` literals inside a `pickByLocale` argument
 *      object are object-property values — neither a `> <` text node nor a
 *      matched attribute value — so a correctly localized string is never
 *      flagged; AND
 *   3. it is not i18n tooling / a test / a type-only `.ts` module.
 *
 * What it deliberately IGNORES (to keep the false-positive rate at zero):
 *   - `${...}` interpolation (variable names are CODE, not rendered prose);
 *   - brand names (`Borjie`, `Mr Mwikila`) — they are locale-neutral;
 *   - pure technical / ALL-CAPS command tokens (`CONFIRM`, `NDJSON`, `API`);
 *   - `className=` / `data-testid=` / `href=` / `key=` and other structural
 *     attributes (never rendered to the user);
 *   - whole-line comments and import lines.
 *
 * The heuristic is intentionally a text scanner (not a full JSX parser): it
 * runs build-time over OUR OWN tree, and the enforcement test proves it bites
 * (a mutation flips it RED). It mirrors the shape of `locale-purity.ts`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Common English UI words. A JSX text node or user-facing attribute value
 * needs >= 2 of these (as whole words) to count as rendered English prose.
 * Curated to exclude Swahili loanwords (`data`, `email`) and pure tech
 * tokens so a label like "Tenant ID" or "API" never trips alone.
 */
const ENGLISH_WORD =
  /\b(the|and|or|with|to|of|in|on|for|a|an|is|are|was|were|be|by|from|this|that|these|those|your|you|we|our|all|no|not|new|view|open|close|back|next|previous|edit|delete|create|update|cancel|submit|confirm|save|send|search|filter|export|import|refresh|loading|pending|active|inactive|failed|approved|rejected|expired|overdue|remaining|today|health|platform|system|worker|workers|site|sites|licence|license|company|companies|shipment|shipments|regulator|regulators|subject|review|dashboard|settings|reports?|report|welcome|please|sorry|continue|profile|overview|owner|manager|employee|buyer|seller|status|details?|detail|summary|alerts?|alert|brief|briefs|fleet|across|every|never|single|named|industry|conversations?|conversation|observer|voice|note|notes|helpful|wrong|optional|tell|me|what|was|available|environment|endpoint|aggregate|aggregates|counts?|count|queued|sent|skipped|critical|high|medium|low|severity|kind|message|offline|online|index|window|prior|show|shown|mock|threads?|thread|left|column|talk|budget|privacy|trail|audit|slice|selector|bulk|action|drawer|feedback|thumbs|up|down|reason|select|selected|apply|clear|run|stop|start|enable|disable|enabled|disabled|add|remove|none|empty|unavailable|unwired|service|services|cycle|last|over|under|total|totals|tenants?|tenant)\b/i;

/**
 * Brand / proper-noun tokens that are locale-neutral. Stripped before the
 * English-word count so "Borjie HQ" alone never reads as English prose.
 */
const BRAND_TOKENS = /\b(Borjie|Mwikila|Jarvis|HQ|Mr)\b/g;

/**
 * Strip whole-line comments and import/export-from lines so prose in
 * doc-comments and module paths is never matched.
 */
function stripNonRenderLines(src: string): string {
  return src
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) {
        return false;
      }
      if (t.startsWith('import ') || t.startsWith('export {')) return false;
      return true;
    })
    .join('\n');
}

/**
 * Remove `${...}` interpolation, brand tokens, and ALL-CAPS command tokens
 * before counting English words, so an interpolated template, a brand line,
 * or a `CONFIRM` token does not read as prose.
 */
function normalizeForMatch(text: string): string {
  return text
    .replace(/\$\{[^}]*\}/g, ' ')
    .replace(BRAND_TOKENS, ' ')
    .replace(/\b[A-Z][A-Z0-9_]{2,}\b/g, ' ');
}

/** A run of text is English PROSE if it carries >= 2 English marker words. */
function isEnglishProse(text: string): boolean {
  const normalized = normalizeForMatch(text);
  const matches = normalized.match(ENGLISH_WORD);
  if (!matches) return false;
  // Count DISTINCT positions: re-run with the global flag.
  const all = normalized.match(new RegExp(ENGLISH_WORD.source, 'gi'));
  return (all?.length ?? 0) >= 2;
}

/**
 * Characters that never appear inside a genuine JSX TEXT node but are
 * pervasive in code. A run between `>` and `<` that carries any of these is
 * a JS expression caught by the heuristic (e.g. an arrow `() => diffLines(…)`
 * sitting before a later `<div>`), NOT rendered prose — so it is discarded.
 * Guards the well-known weakness of a `>`-to-`<` text scanner.
 */
const CODE_PUNCTUATION = /[(){}[\];=`]|=>|\$\{/;

/**
 * Pull every JSX text node — text that sits between `>` and `<` — and test
 * it for English prose. Runs carrying code punctuation (an arrow function, a
 * call, an assignment) are discarded as JS, not prose, so a `() =>` before a
 * later `<` cannot masquerade as a text node.
 */
function hasEnglishJsxTextNode(src: string): boolean {
  const re = />([^<>{}]+)</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const text = m[1]!.trim();
    if (text.length < 3) continue;
    if (CODE_PUNCTUATION.test(text)) continue;
    if (isEnglishProse(text)) return true;
  }
  return false;
}

/**
 * User-facing JSX attributes whose value IS rendered to the operator. Any of
 * these carrying English prose is a leak under `sw`. Structural attributes
 * (`className`, `data-testid`, `href`, `key`, `id`, `type`, `role`) are
 * intentionally absent — they are never shown.
 */
const USER_FACING_ATTR =
  /\b(title|label|placeholder|aria-label|eyebrow|subtitle)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g;

function hasEnglishUserFacingAttr(src: string): boolean {
  let m: RegExpExecArray | null;
  USER_FACING_ATTR.lastIndex = 0;
  while ((m = USER_FACING_ATTR.exec(src)) !== null) {
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    if (isEnglishProse(value)) return true;
  }
  return false;
}

/**
 * A file CLEARS the prose check only if it selects a per-locale STRING branch
 * (`pickByLocale`). Resolving the locale for date/number formatting alone
 * (`useLocale()` / `bcp47For(locale)`) does NOT clear prose — that is exactly
 * the round-13 "uses-locale-but-hardcodes-English" shape this guard now bites.
 */
function selectsPerLocaleString(src: string): boolean {
  return /\bpickByLocale\b/.test(src);
}

/**
 * A file merely RESOLVES the active locale (for formatting) when it touches
 * `useLocale` / `bcp47For` but has no `pickByLocale`. Used only to classify a
 * caught file's shape for the failure message; both shapes fail the build.
 */
function resolvesLocaleForFormattingOnly(src: string): boolean {
  return (
    !selectsPerLocaleString(src) && /\b(useLocale|bcp47For)\b/.test(src)
  );
}

function listComponentFiles(dir: string, root: string, acc: string[]): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- trusted build-time scanner over the repo's own src tree (no user input)
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      listComponentFiles(full, root, acc);
      continue;
    }
    // Only `.tsx` can render JSX — `.ts` modules carry no user-facing surface.
    if (!/\.tsx$/.test(entry.name)) continue;
    const rel = full.slice(root.length + 1);
    if (rel.startsWith('i18n/')) continue;
    if (/__tests__|\.test\.|\.spec\./.test(rel)) continue;
    acc.push(rel);
  }
}

/**
 * The shape of a caught hardcoded-EN file:
 *   - `no-locale`: zero `pickByLocale`/`useLocale`/`bcp47For` — the original
 *     round-9/10 class (a wholly locale-unaware component).
 *   - `uses-locale-but-hardcodes-english`: resolves the locale for date/number
 *     formatting (`useLocale`/`bcp47For`) yet has no `pickByLocale` to localize
 *     its prose — the round-13 widening.
 *   - `per-string-leak`: localizes MOST of its surface with `pickByLocale` but
 *     leaks a few rendered prose runs straight to the screen (a hardcoded JSX
 *     text node or a string-literal `title=`/`placeholder=`) — the round-14
 *     widening. The whole-file `pickByLocale` exemption no longer hides it.
 */
export type HardcodedEnShape =
  | 'no-locale'
  | 'uses-locale-but-hardcodes-english'
  | 'per-string-leak';

export interface HardcodedEnOffender {
  readonly file: string;
  readonly shape: HardcodedEnShape;
}

/**
 * Classify a CAUGHT file's shape. A file reaches here only after a rendered
 * prose run escaped the i18n layer (a bare text node or a string-literal
 * attribute). The distinction is in how much locale machinery the file already
 * carries around that leak:
 *   - it selects a per-locale string branch elsewhere (`pickByLocale`) yet still
 *     leaked one → `per-string-leak` (round-14);
 *   - it resolves the locale only for formatting (`useLocale`/`bcp47For`) with
 *     no `pickByLocale` at all → `uses-locale-but-hardcodes-english` (round-13);
 *   - it has no locale awareness whatsoever → `no-locale` (round-9/10).
 */
function classifyShape(raw: string): HardcodedEnShape {
  if (selectsPerLocaleString(raw)) return 'per-string-leak';
  if (resolvesLocaleForFormattingOnly(raw)) {
    return 'uses-locale-but-hardcodes-english';
  }
  return 'no-locale';
}

/**
 * Return every component / page file (relative to `srcRoot`) that renders a
 * user-facing English prose run OUTSIDE the i18n layer — tagged with its shape.
 *
 * Clearing is decided PER RENDERED STRING, not per file: the presence of
 * `pickByLocale` somewhere no longer exempts a file. A localized render reaches
 * the screen as `{pickByLocale(…)}` or `attr={pickByLocale(…)}`, and the two
 * render scanners structurally skip both the `{ … }` text-node and the `={ … }`
 * expression-attribute forms — so they only ever SEE prose that bypassed i18n
 * (a bare `>run<` text node or a `="run"` string-literal attribute). The
 * `en:`/`sw:` literals inside a `pickByLocale` argument object are object
 * property values (neither shape the scanners match), so a correctly localized
 * string is never flagged. This makes the per-string-leak inside an otherwise
 * localized component (round-14) visible without re-flagging clean files.
 */
export function findHardcodedEnOffenders(srcRoot: string): HardcodedEnOffender[] {
  const files: string[] = [];
  listComponentFiles(srcRoot, srcRoot, files);
  const offenders: HardcodedEnOffender[] = [];
  for (const rel of files) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- trusted build-time scanner over the repo's own src tree (no user input)
    const raw = readFileSync(join(srcRoot, rel), 'utf8');
    const code = stripNonRenderLines(raw);
    if (!hasEnglishJsxTextNode(code) && !hasEnglishUserFacingAttr(code)) {
      continue;
    }
    offenders.push({ file: rel, shape: classifyShape(raw) });
  }
  return offenders.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Return the sorted list of component / page files (relative to `srcRoot`)
 * that render user-facing English prose yet do not localize that prose — the
 * surface-level EN/SW mix under the `sw` toggle. Covers BOTH the no-locale and
 * the uses-locale-but-hardcodes-English shapes.
 */
export function findHardcodedEnComponents(srcRoot: string): string[] {
  return findHardcodedEnOffenders(srcRoot).map((o) => o.file);
}
