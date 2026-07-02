/**
 * TRACK D — workforce-mobile nav reachability + locale-formatter gate.
 *
 * Pure node (no JSX) so it runs in the workforce-mobile vitest `node` env.
 *
 * Proves three things:
 *   1. Every O-M-* / W-M-* screen id LINKED from a tab screen resolves to a
 *      real file under app/owner|worker AND is present in the role-access map
 *      (a link to a missing screen or an ungated id is a dead/leaky route).
 *   2. The reachable-stub screens (O-M-05, W-M-17) are NOT linked from any tab
 *      (a routed placeholder-only stub is a reachable-stub bug).
 *   3. No host-default formatter (bare .toLocaleString / .toLocaleDateString /
 *      .toLocaleTimeString / new Intl.*()  with no BCP-47 arg) remains under
 *      app/ — every render must resolve the ACTIVE app locale.
 *   4. The active-locale formatters produce locale-correct output.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { SCREEN_ROLE_ACCESS } from '../roles/access'
import { bcp47For, formatDateTime, formatInteger } from '../home/owner/format'

const APP_ROOT = join(__dirname, '..', '..')
const APP_DIR = join(APP_ROOT, 'app')
const TABS_DIR = join(APP_DIR, '(tabs)')

// ─── 1 + 2. tab-link reachability ───────────────────────────────────────────

function tabLinkedScreenIds(): ReadonlyArray<string> {
  const ids = new Set<string>()
  for (const entry of readdirSync(TABS_DIR)) {
    if (!entry.endsWith('.tsx')) continue
    const src = readFileSync(join(TABS_DIR, entry), 'utf8')
    // Strip block + line comments so a doc-comment naming a stub id is not a hit.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
    for (const m of code.matchAll(/['"]([OW]-M-\d{2})['"]/g)) {
      const id = m[1]
      if (id) ids.add(id)
    }
  }
  return [...ids]
}

function screenFileFor(id: string): string {
  const dir = id.startsWith('O-M-') ? 'owner' : 'worker'
  return join(APP_DIR, dir, `${id}.tsx`)
}

describe('track-d tab-link reachability', () => {
  const linked = tabLinkedScreenIds()

  it('links at least one owner and one worker screen', () => {
    expect(linked.some((id) => id.startsWith('O-M-'))).toBe(true)
    expect(linked.some((id) => id.startsWith('W-M-'))).toBe(true)
  })

  it.each(tabLinkedScreenIds())(
    '%s resolves to a real screen file and is role-gated in the access map',
    (id) => {
      expect(existsSync(screenFileFor(id))).toBe(true)
      const roles = SCREEN_ROLE_ACCESS[id]
      expect(roles).toBeDefined()
      expect(roles?.length ?? 0).toBeGreaterThan(0)
    },
  )

  it('does NOT link the placeholder-only stubs O-M-05 / W-M-17', () => {
    expect(linked).not.toContain('O-M-05')
    expect(linked).not.toContain('W-M-17')
  })
})

// ─── 3. no host-default formatter under app/ ─────────────────────────────────

function listAppFiles(dir: string): ReadonlyArray<string> {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...listAppFiles(full))
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

// A bare toLocale*() with no argument, or a new Intl.*() whose first argument
// is NOT a locale resolver (bcp47For / a lang/locale var). We only flag the
// no-arg / literal-less forms; a resolved-locale call is fine.
const HOST_DEFAULT_RE =
  /\.toLocale(?:String|DateString|TimeString)\(\)|new Intl\.[A-Za-z]+\(\s*\)/g

describe('track-d host-default formatter gate (app/)', () => {
  it('has zero bare host-locale formatters under app/', () => {
    const offenders: string[] = []
    for (const file of listAppFiles(APP_DIR)) {
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '')
      if (HOST_DEFAULT_RE.test(code)) {
        offenders.push(file.slice(APP_ROOT.length + 1))
      }
      HOST_DEFAULT_RE.lastIndex = 0
    }
    expect(offenders).toEqual([])
  })
})

// ─── 4. active-locale formatter correctness ──────────────────────────────────

describe('track-d active-locale formatters', () => {
  it('resolves BCP-47 from the active app locale, never the host default', () => {
    expect(bcp47For('sw')).toBe('sw-TZ')
    expect(bcp47For('en')).toBe('en-GB')
  })

  it('formatInteger groups digits per the active locale', () => {
    // en-GB groups with a comma; a bad number degrades to em-dash (never NaN).
    expect(formatInteger(1234567, 'en')).toBe('1,234,567')
    expect(formatInteger(Number.NaN, 'en')).toBe('—')
  })

  it('formatDateTime renders a real date and degrades bad input to em-dash', () => {
    const out = formatDateTime('2026-07-02T09:30:00.000Z', 'en')
    expect(out).toMatch(/2026/)
    expect(out).not.toMatch(/Invalid/)
    expect(formatDateTime('not-a-date', 'en')).toBe('—')
  })
})
