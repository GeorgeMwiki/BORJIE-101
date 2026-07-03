/**
 * GATE — whole-app workforce-mobile zero-mix / locale wall (round 13).
 *
 * The gauntlet had NO whole-copy locale gate for workforce-mobile (the
 * admin/owner gates catch INTRA-string mixing, never PURE-single-language copy
 * under the wrong active locale, nor a sw-by-default). This is that missing
 * wall: a STATIC scanner over the entire `src/` + `app/` tree that, per CLASS,
 * holds a SHRINK-ONLY allowlist (a file may be REMOVED as it is fixed, NEVER
 * added) so the offender count can only go DOWN.
 *
 * Classes (each the language-engineering canon — CLAUDE.md):
 *   1. INLINE-LOCALE-TERNARY  — `isSw ? '…' : '…'` / `lang === 'sw' ? '…' : …`
 *      with a STRING LITERAL branch (hardcoded bilingual copy inline instead of
 *      a single-locale `t()` lookup). Data-selection ternaries that pick a
 *      `*Sw`/`*En` FIELD (no quoted literal) are NOT this class.
 *   2. CROSS-LANGUAGE-FALLBACK — a paired `*En ?? *Sw` / `*Sw ?? *En`
 *      (`||` too): substituting the other language when the active-locale value
 *      is null. The canon keeps the field null and renders a localized
 *      placeholder; cross-fallback IS mixing.
 *   3. RAW-ERROR-MESSAGE — `setError…(… .message)` or a JSX `{x.message}` render
 *      (the raw English wire/Error message under `sw` is mixing). Errors must
 *      localize by code via `@borjie/error-catalog`.
 *   4. SW-DEFAULT — `?? 'sw'` / `|| 'sw'` / `= 'sw'` as a locale DEFAULT. The
 *      default user language is EN (CLAUDE.md "English default").
 *
 * COMMENTS are STRIPPED before matching so a doc-comment that NAMES a forbidden
 * pattern (e.g. "never `isSw ? '…' : '…'`") is not a hit — the scanner reads
 * executable CODE, not prose. String-literal contents are KEPT so a real
 * hardcoded ternary branch is still visible.
 *
 * Pure node (no JSX) so it runs in the workforce-mobile vitest `node` env.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const APP_ROOT = join(__dirname, '..', '..')
const SCAN_DIRS = ['src', 'app']

/** Files exempt from the scan entirely (the gate itself + the prior gate). */
const SCAN_EXEMPT = new Set<string>([
  'src/__tests__/whole-app-zero-mix.gate.test.ts',
  'src/__tests__/enum-and-error-localization.gate.test.ts',
])

// ─── source enumeration ─────────────────────────────────────────────────────

function listSourceFiles(): ReadonlyArray<string> {
  const out: string[] = []
  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const st = statSync(full)
      if (st.isDirectory()) {
        if (entry === 'node_modules' || entry === '__tests__' && false) continue
        walk(full)
        continue
      }
      if (!/\.(ts|tsx)$/.test(entry)) continue
      if (/\.(test|spec)\.tsx?$/.test(entry)) continue
      out.push(full)
    }
  }
  for (const d of SCAN_DIRS) {
    walk(join(APP_ROOT, d))
  }
  return out
}

/**
 * Strip ONLY line + block comments (string/template literals are KEPT intact),
 * so the scanner reads executable CODE — a doc-comment that NAMES a forbidden
 * pattern is neutralized, while real string-literal copy in a ternary branch is
 * preserved for the detectors to match. (String-literal text that itself
 * happens to spell a detector pattern is vanishingly rare in this app and would
 * be a deliberate adversarial case; comments are the real false-positive
 * source, and those are removed.)
 */
function stripComments(src: string): string {
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    const c2 = src[i + 1]
    // Line comment
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') i++
      continue
    }
    // Block comment
    if (c === '/' && c2 === '*') {
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++
      i += 2
      continue
    }
    // String / template literal — copy through verbatim (including contents) so
    // a `isSw ? 'Haraka' : 'Urgent'` branch is visible to the detector.
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      out += quote
      i++
      while (i < n && src[i] !== quote) {
        out += src[i]
        if (src[i] === '\\') {
          out += src[i + 1] ?? ''
          i += 2
          continue
        }
        i++
      }
      out += src[i] ?? ''
      i++
      continue
    }
    out += c
    i++
  }
  return out
}

// ─── class detectors (run over the COMMENT-STRIPPED source) ──────────────────

/**
 * Class 1 — inline locale ternary whose consequent is a NON-EMPTY STRING
 * LITERAL. Matches `isSw ? '…'`, `!isSw ? '…'`, `lang === 'sw' ? '…'`,
 * `'sw' === lang ? '…'` (single/double/backtick quote) where the branch is a
 * hardcoded literal. A data-selection ternary that picks a `*Sw`/`*En` field
 * (`isSw ? task.titleSw : task.titleEn`) has NO quote after `?` and is NOT a
 * hit. The literal must be non-empty (at least one char between the quotes) so
 * an empty `''` placeholder is not counted.
 */
const INLINE_TERNARY =
  /(?:!?\bisSw\b|\blang\s*===\s*'sw'|'sw'\s*===\s*\blang\b|\blang\s*===\s*"sw"|"sw"\s*===\s*\blang\b)\s*\?\s*(?:'[^']+'|"[^"]+"|`[^`]+`)/g

/**
 * Class 2 — cross-language fallback between a paired EN/SW field. Caught two
 * ways so the WRAPPED form (the exact bug closed this round) is not missed:
 *   (a) ADJACENT — `xEn ?? ySw` / `xSw ?? yEn` (and `||`): an identifier ending
 *       En/Sw directly falling back to one ending the OTHER suffix.
 *   (b) ASSIGNED-TARGET — `titleEn = …(…) ?? titleSw` (or `:` for an object
 *       property): a value bound to a `*En` (or `*Sw`) name whose RHS
 *       `??`/`||`-falls-back to a bare identifier ending in the OTHER suffix,
 *       even when the active-locale value is WRAPPED in a call. Constrained to a
 *       single line (`[^\\n=]` after the `[:=]`) so it never spans statements.
 * A `*Sw ?? '—'` placeholder fallback (no other-suffix identifier) is NOT a hit.
 */
// (a) adjacent `*En ?? *Sw` / `*Sw ?? *En`; (b) assigned-target wrapped form
// `*En = …(…) ?? *Sw` (and the Sw→En mirror), constrained to a single line.
const CROSS_FALLBACK =
  /\b[\w.]*En\b\s*(?:\?\?|\|\|)\s*[\w.]*Sw\b|\b[\w.]*Sw\b\s*(?:\?\?|\|\|)\s*[\w.]*En\b|\b\w*En\b\s*[:=]\s*[^\n=][^\n]*?(?:\?\?|\|\|)\s*\w*Sw\b|\b\w*Sw\b\s*[:=]\s*[^\n=][^\n]*?(?:\?\?|\|\|)\s*\w*En\b/g

/**
 * Class 3 — raw error message into error state or a JSX render.
 *   (a) `set…Error…(… <chain>.message …)` — sets error UI copy from a raw
 *       `.message`. Localize by code via `localizeApiError` instead.
 *   (b) a JSX `{<chain>.message}` render — the chain may be MULTI-SEGMENT and
 *       optionally-chained (`{mutation.error.message}`, `{err?.message}`,
 *       `{cause?.message}`, `{x.error?.message ?? '…'}`), EXCLUDING a
 *       `styles`-rooted ref (`{styles.message}` / `style={styles.message}` — a
 *       StyleSheet ref). The braced form is anchored to a SINGLE-LINE render
 *       whose sole content is a `.message` member-chain plus an OPTIONAL `??`
 *       fallback, so a multi-line code block / object literal / function-call
 *       argument that merely mentions `.message` is NOT a hit.
 *
 *       The PRIOR regex only matched single-segment `{ident.message}` and MISSED
 *       the real leak shape `{mutation.error.message}` (two segments) — a
 *       false-green this round closed. Re-introducing either shape is RED.
 */
const RAW_ERROR_MESSAGE =
  /set[A-Za-z]*[Ee]rror[A-Za-z]*\([^)]*\b[\w$.?]+\??\.message\b|\{\s*(?!styles\b)[\w$]+(?:\??\.[\w$]+)*\??\.message\s*(?:\?\?\s*[^{}\n]*)?\}/g

/**
 * Class 4 — a Swahili locale DEFAULT, in either quote style:
 *   - `?? 'sw'` / `|| 'sw'` (nullish/or default)
 *   - `= 'sw'` (assignment / default param), but NOT `=== 'sw'` / `!== 'sw'`
 *     / `== 'sw'` (comparisons) nor a type-union `: 'sw' | 'en'`.
 *   - a JSX-attribute / prop default `Lang="sw"` (NO spaces around `=`, the
 *     onboarding `initialLang="sw"` seed) — keyed on a `Lang` attribute name
 *     with no surrounding whitespace so a TYPE ALIAS `type Lang = 'sw' | 'en'`
 *     (spaces around `=`, `| 'en'` follows) is NOT a hit.
 * Only a genuine fallback/assign/default to Swahili is the offense.
 */
const SW_DEFAULT =
  /(?:\?\?|\|\|)\s*['"]sw['"](?!\s*[|])|(?<![=!<>|])=\s*['"]sw['"](?!\s*[|])|[A-Za-z]*[Ll]ang="sw"/g

/**
 * Class 5 — an UNCONDITIONAL hardcoded Swahili literal in a user-facing JSX
 * ATTRIBUTE (`title="…"`, `label='…'`, `placeholder`, `accessibilityLabel`,
 * `hint`, `heading`, `subtitle`, `cta`, `emptyLabel`, `caption`, `header`) as a
 * BARE STRING (`prop="…"` / `prop='…'`, NOT `prop={…}`). A bare string attribute
 * CANNOT be locale-gated — gating requires a `{ sw ? … : … }` expression with
 * braces — so a Swahili stem inside one renders Swahili to every user regardless
 * of locale. This is the exact shape the round-6 documents-family vein took
 * (`<Section title="Hati hai">`, `label="Pakia hati mpya"`). A `{…}` expression
 * attribute is NOT a hit (it can be a single-locale `t.*` lookup or a gated
 * ternary). The stem list uses word boundaries on short/ambiguous stems so an
 * English attribute value is not a false hit.
 */
const SW_STEM =
  'inapakia|inatuma|imeshindwa|imeshindikana|hakuna|bado|\\bhati\\b|pakia|\\btuma\\b|uliza|leseni|migodi|shifti|mauzo|fedha|hatari|bonyeza|tafadhali|andika|karibu|asante|habari|haijulikani|haijapatikana|\\bzote\\b|subiri|imekwisha|mmiliki|meneja|mfanyakazi|maamuzi|ushahidi|\\bsaini\\b|ramani|arifa|fungua|nyuma|endelea|\\bfunga\\b|ghairi|thibitisha|hariri|\\bfuta\\b|ongeza|chagua|\\bsimu\\b|\\bkidole\\b|\\bbidhaa\\b|\\bppe\\b|rasmi'
const HARDCODED_SW_JSX_ATTR = new RegExp(
  '\\b(?:title|label|placeholder|accessibilityLabel|hint|heading|subtitle|cta|emptyLabel|caption|header)=(["\'])(?:(?!\\1).)*\\b(?:' +
    SW_STEM +
    ')\\b(?:(?!\\1).)*\\1',
  'gi',
)

interface ClassDef {
  readonly id: string
  readonly re: RegExp
  /** Shrink-only allowlist — REMOVE as fixed; NEVER add. */
  readonly allow: ReadonlySet<string>
}

// The allowlist captures the FULL remaining offender set so the gate is GREEN
// today and can only shrink. The named round-13 fixes (useI18n EN-default,
// queries.adapters + TodayTasks cross-fallback, manager assign + tasks/index,
// W-M-02 / W-M-03 cross-fallback, the sw-defaults) are ABSENT from the lists
// below — they are fixed, so re-introducing the pattern there turns the gate RED.

const CLASSES: ReadonlyArray<ClassDef> = [
  {
    // EMPTY — the whole inline-bilingual-copy register was drained: every
    // owner/manager/worker screen now reads single-language copy from the i18n
    // bundle (`t.*` / `pickStrings(lang).*`) or a pure `{ sw, en }` data-pick;
    // no `isSw ? '…' : '…'` / `lang === 'sw' ? '…' : …` string-literal ternaries
    // remain. Re-introducing one is RED.
    id: 'INLINE-LOCALE-TERNARY',
    re: INLINE_TERNARY,
    allow: new Set<string>([]),
  },
  {
    // EMPTY — every paired `*En ?? *Sw` / `*Sw ?? *En` cross-language fallback
    // was closed this round (queries.adapters, TodayTasks, tasks/index, W-M-02,
    // W-M-03, EmployeeDashboard toolbox). Re-introducing one is RED.
    id: 'CROSS-LANGUAGE-FALLBACK',
    re: CROSS_FALLBACK,
    allow: new Set<string>([]),
  },
  {
    // EMPTY — every raw `.message` set into error UI was drained: all error
    // copy now localizes by code via `localizeApiError` from
    // @borjie/error-catalog (narrative, W-M-03/12/18/20, FeedbackButton,
    // useWorkforceTabConfig). Re-introducing a raw `.message` render is RED.
    id: 'RAW-ERROR-MESSAGE',
    re: RAW_ERROR_MESSAGE,
    allow: new Set<string>([]),
  },
  {
    // The named sw-defaults (useI18n, onboarding state, W-M-20, O-M-23,
    // pickStrings) are FIXED → EN. Only the ThemeSettings default-prop remains.
    id: 'SW-DEFAULT',
    re: SW_DEFAULT,
    allow: new Set<string>(['src/profile/ThemeSettings.tsx']),
  },
  {
    // Rounds 4-7 drained the reachable screens of bare-string Swahili JSX
    // attributes (documents family, O-M-*/W-M-* screens). The ONLY remaining
    // offenders are 6 ORPHANED legacy worker screens (W-M-01/03/10/13/15/18) —
    // superseded by the named `onboarding/*` flow, referenced only in
    // src/roles/access.ts with NO CTA/Link/router.push anywhere (unreachable via
    // normal use; KI-023). They are allowlisted (shrink-only): fixing/deleting
    // one removes it here, and a NEW bare-string Swahili attr in ANY other file
    // turns the gate RED — the guard against the next hidden-file-family vein.
    id: 'HARDCODED-SW-JSX-ATTR',
    re: HARDCODED_SW_JSX_ATTR,
    allow: new Set<string>([
      'app/worker/W-M-01.tsx',
      'app/worker/W-M-03.tsx',
      'app/worker/W-M-10.tsx',
      'app/worker/W-M-13.tsx',
      'app/worker/W-M-15.tsx',
      'app/worker/W-M-18.tsx',
    ]),
  },
]

// ─── the gate ────────────────────────────────────────────────────────────────

const FILES = listSourceFiles()

function relPath(full: string): string {
  return relative(APP_ROOT, full)
}

describe('whole-app zero-mix gate — shrink-only allowlist per class', () => {
  for (const cls of CLASSES) {
    it(`${cls.id}: no NEW offender outside the shrink-only allowlist`, () => {
      const offenders: string[] = []
      for (const full of FILES) {
        const rel = relPath(full)
        if (SCAN_EXEMPT.has(rel)) continue
        const code = stripComments(readFileSync(full, 'utf8'))
        cls.re.lastIndex = 0
        if (cls.re.test(code) && !cls.allow.has(rel)) {
          offenders.push(rel)
        }
      }
      expect(
        offenders,
        `NEW ${cls.id} offender(s) not on the allowlist: ${offenders.join(', ')}`,
      ).toEqual([])
    })

    it(`${cls.id}: every allowlisted file still exists + still offends (shrink-only)`, () => {
      const stale: string[] = []
      for (const rel of cls.allow) {
        const full = join(APP_ROOT, rel)
        let code: string
        try {
          code = stripComments(readFileSync(full, 'utf8'))
        } catch {
          stale.push(`${rel} (missing)`)
          continue
        }
        cls.re.lastIndex = 0
        if (!cls.re.test(code)) {
          // The file was FIXED — remove it from the allowlist (the ratchet).
          stale.push(`${rel} (fixed — remove from allowlist)`)
        }
      }
      expect(
        stale,
        `${cls.id} allowlist is stale (must shrink): ${stale.join(', ')}`,
      ).toEqual([])
    })
  }

  it('the named round-13 fixes are NOT allowlisted (regression guard)', () => {
    // These files were fixed this round; if any pattern returns there the gate
    // must catch it — they must never be on any class allowlist.
    const FIXED = [
      'src/i18n/useI18n.ts',
      'src/home/employee/queries.adapters.ts',
      'src/home/employee/TodayTasks.tsx',
      'app/(manager)/tasks/[id]/assign.tsx',
    ]
    for (const cls of CLASSES) {
      for (const f of FIXED) {
        expect(cls.allow.has(f), `${f} must not be on ${cls.id} allowlist`).toBe(
          false,
        )
      }
    }
  })
})
