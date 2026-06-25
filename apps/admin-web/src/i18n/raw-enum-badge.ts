/**
 * Raw-enum-badge-label scanner — the admin-console tripwire against rendering a
 * RAW bounded-enum TOKEN as a badge/pill label instead of localizing it.
 *
 * The class this kills (Class B):
 *   The recurring anti-pattern is `<StubBadge tone={tone(x)}>{x}</StubBadge>` /
 *   `<Badge variant={v(row.outcome)}>{row.outcome}</Badge>`. The TONE/variant is
 *   bounded (mapped through a closed helper), but the LABEL `{x}` is the RAW
 *   gateway enum token — a mixed-case English string like `Indexed`, `High`,
 *   `running`, `OK`, `executed`. Under the `sw` toggle that raw token is a
 *   language MIX (English label under Swahili chrome), on every load, that
 *   neither the intra-string locale-purity scanner nor the hardcoded-EN
 *   component scanner can see (the token is an interpolated VALUE, not a
 *   literal). The fix is `localizeEnumLabel(MAP, value, locale)` from
 *   `@/lib/internal/enum-labels` (or any `pickByLocale` / localizer call).
 *
 * What this flags (a `<StubBadge …>` / `<Badge …>` element is an offender when):
 *   its CHILD is a BARE bounded-enum member expression — `{<ident>.<field>}`
 *   where `<field>` is one of the bounded enum names (`status`, `state`,
 *   `severity`, `outcome`, `kind`, `posture`, `level`) — and the child is NOT
 *   wrapped in a localizer call (`localizeEnumLabel(` / `pickByLocale(` /
 *   `localizeApiError(`) or any other function call.
 *
 * What it deliberately IGNORES (false-positive rate at zero):
 *   - a child already wrapped in a localizer / any `fn(...)` call (the FIX);
 *   - a child that is FREE DATA, not a bounded enum (`{row.provider}`,
 *     `{agent.trigger}`, `{p.firstPersonNoun}`, `{j.domain}`, `{x.name}`,
 *     `{item.source}`) — identifiers / proper-nouns / regulator names are
 *     locale-neutral, not translatable enums, so they are not in the bounded
 *     field set;
 *   - a child that is a localized string / `{N} {label}` composition or any
 *     expression that is not a bare single member access;
 *   - i18n tooling, the enum-labels module itself, and tests.
 *
 * Build-time text scanner over OUR OWN tree; the enforcement test proves it
 * bites (a mutation reintroducing a raw label flips it RED). Mirrors the shape
 * of `locale-purity.ts` / `hardcoded-en.ts`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The bounded enum FIELD names a badge label may carry. A `{<ident>.<field>}`
 * child whose field is in this set is a TRANSLATABLE token (status / severity /
 * lifecycle), distinct from a free-data field (provider / trigger / name /
 * source) which is locale-neutral and intentionally NOT listed.
 */
const BOUNDED_ENUM_FIELD =
  /^(status|state|severity|outcome|kind|posture|level)$/;

/**
 * Match a `<StubBadge …>CHILD</StubBadge>` or `<Badge …>CHILD</Badge>` element
 * (single- OR multi-line) and capture the trimmed CHILD. `[\s\S]*?` spans the
 * attribute list and any whitespace around the child.
 */
const BADGE_ELEMENT = /<(StubBadge|Badge)\b[^>]*>([\s\S]*?)<\/\1>/g;

/**
 * A bare bounded-enum member expression as the WHOLE child:
 * `{ <ident>.<boundedField> }` with nothing else. The `^…$` (after trimming)
 * is what excludes a `{N} {label}` composition or a `localizeX(...)` call —
 * those are not a single bare member access.
 */
const BARE_ENUM_CHILD = /^\{\s*([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\}$/;

/** Strip whole-line comments and import lines from the scan surface. */
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

/** True when a badge/pill renders a BARE bounded-enum token as its label. */
export function fileRendersRawEnumBadge(src: string): boolean {
  const code = stripNonRenderLines(src);
  BADGE_ELEMENT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BADGE_ELEMENT.exec(code)) !== null) {
    const child = (m[2] ?? '').trim();
    const bare = BARE_ENUM_CHILD.exec(child);
    if (!bare) continue;
    const field = bare[2] ?? '';
    if (BOUNDED_ENUM_FIELD.test(field)) return true;
  }
  return false;
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

/**
 * Return the sorted list of component / page `.tsx` files (relative to
 * `srcRoot`) that render a RAW bounded-enum token as a badge/pill label
 * instead of localizing it.
 */
export function findRawEnumBadges(srcRoot: string): string[] {
  const files: string[] = [];
  listSourceFiles(srcRoot, srcRoot, files);
  return files
    .filter((rel) => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- trusted build-time scanner over the repo's own src tree (no user input)
      const raw = readFileSync(join(srcRoot, rel), 'utf8');
      return fileRendersRawEnumBadge(raw);
    })
    .sort();
}
