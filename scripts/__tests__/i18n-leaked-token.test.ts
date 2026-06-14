import { describe, it, expect } from 'vitest'
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Repo-wide i18n leaked-token guard.
 *
 * Structural guard (DEPLOY-TRUST PROOF): a model chat-template / end-of-sequence
 * token accidentally baked into a translation (e.g. "Akili Kuu\n<|end_of_text|>"
 * found + stripped from apps/marketing/src/i18n/sw.json) renders literally to the
 * user. This test fails the build if ANY i18n dictionary in the repo carries one,
 * so the class can never silently return — on any surface, in any locale.
 *
 * The first assertion is a POSITIVE CONTROL proving the detector is alive; the
 * second proves real dictionaries are clean. Red-capability + green-reality.
 */

const LEAKED_TOKENS = [
  '<|end_of_text|>',
  '<|endoftext|>',
  '<|eot_id|>',
  '<|im_end|>',
  '<|im_start|>',
  '</s>',
] as const

const ROOT = process.cwd()
const SCAN_ROOTS = ['apps', 'packages', 'services']
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.expo',
  'dist',
  'build',
  '.turbo',
  '.git',
  'coverage',
])

/** Collect every *.json that lives under a directory named `i18n` (any depth). */
function findI18nDictionaries(): string[] {
  const found: string[] = []
  const walk = (dir: string, insideI18n: boolean): void => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      const full = join(dir, name)
      let st: ReturnType<typeof statSync>
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue
        walk(full, insideI18n || name === 'i18n')
      } else if (insideI18n && name.endsWith('.json')) {
        found.push(full)
      }
    }
  }
  for (const r of SCAN_ROOTS) {
    const base = join(ROOT, r)
    if (existsSync(base)) walk(base, false)
  }
  return found
}

const tokensIn = (text: string): string[] => LEAKED_TOKENS.filter((t) => text.includes(t))

describe('i18n leaked-token guard (repo-wide)', () => {
  const files = findI18nDictionaries()

  it('positive control: the detector flags a leaked model token', () => {
    // proves the guard is ALIVE — a known-corrupted string must trip it
    expect(tokensIn('Akili Kuu\n<|end_of_text|>')).toHaveLength(1)
  })

  it('discovers i18n dictionaries to scan', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('no i18n dictionary contains a leaked model token', () => {
    const leaks: Array<{ file: string; tokens: string[] }> = []
    for (const file of files) {
      const hits = tokensIn(readFileSync(file, 'utf8'))
      if (hits.length > 0) leaks.push({ file: file.replace(`${ROOT}/`, ''), tokens: hits })
    }
    expect(
      leaks,
      `leaked model tokens found in i18n — strip them, keep the human-readable text:\n${JSON.stringify(leaks, null, 2)}`,
    ).toEqual([])
  })
})
