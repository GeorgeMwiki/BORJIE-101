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
 * What this flags (a file is an offender when ALL hold):
 *   1. It is a component / page `.tsx` that RENDERS user-facing English —
 *      either a JSX text node of >= 2 English words, or one of the
 *      user-facing attributes (`title=` / `label=` / `placeholder=` /
 *      `aria-label=` / `eyebrow=` / `subtitle=`) carrying English prose; AND
 *   2. it has ZERO `pickByLocale` / `useLocale` token in the file (it cannot
 *      be selecting a per-locale branch); AND
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

/** A file is locale-aware if it selects a per-locale branch anywhere. */
function isLocaleAware(src: string): boolean {
  return /\b(pickByLocale|useLocale)\b/.test(src);
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
 * Return the sorted list of component / page files (relative to `srcRoot`)
 * that render user-facing English prose yet have ZERO locale awareness — the
 * surface-level EN/SW mix under the `sw` toggle.
 */
export function findHardcodedEnComponents(srcRoot: string): string[] {
  const files: string[] = [];
  listComponentFiles(srcRoot, srcRoot, files);
  const offenders = files.filter((rel) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- trusted build-time scanner over the repo's own src tree (no user input)
    const raw = readFileSync(join(srcRoot, rel), 'utf8');
    if (isLocaleAware(raw)) return false;
    const code = stripNonRenderLines(raw);
    return hasEnglishJsxTextNode(code) || hasEnglishUserFacingAttr(code);
  });
  return offenders.sort();
}
