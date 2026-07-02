/**
 * TRACK — workforce-mobile reachable-stub closeout.
 *
 * O-M-05 and W-M-17 are de-linked from every tab but their Stack routes stay
 * deep-linkable. A terminal PlaceholderList/PhotoSlot render on a reachable
 * route is a stub bug; W-M-17 additionally used to hardcode Swahili-only copy
 * (wrong language under EN). Both are now fail-safe Redirects to their real
 * parent tab, so:
 *
 *   1. Neither file renders a terminal placeholder — no PlaceholderList /
 *      PhotoSlot / StubBlocks import survives; each returns a <Redirect>.
 *   2. W-M-17 carries ZERO hardcoded language literals (no Swahili or English
 *      user-facing string sits in the component; a Redirect renders no copy).
 *   3. The redirect target is a real screen file under app/.
 *   4. The RoleGuard still wraps each route so an unauthorized role gets the
 *      localized forbidden card, never a silent redirect leak.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const APP_DIR = join(__dirname, '..', '..', 'app')

const O_M_05 = join(APP_DIR, 'owner', 'O-M-05.tsx')
const W_M_17 = join(APP_DIR, 'worker', 'W-M-17.tsx')

function read(file: string): string {
  return readFileSync(file, 'utf8')
}

// Strip block + line comments so a doc-comment describing the old stub is not
// mistaken for live copy or a live import.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('reachable stubs redirect to a real screen (no terminal placeholder)', () => {
  it.each([
    ['O-M-05', O_M_05],
    ['W-M-17', W_M_17],
  ])('%s renders a Redirect, not a placeholder stub', (_id, file) => {
    const code = stripComments(read(file))
    // Renders a redirect...
    expect(code).toMatch(/<Redirect\s+href=/)
    // ...and no longer imports or renders any stub/placeholder block.
    expect(code).not.toMatch(/PlaceholderList/)
    expect(code).not.toMatch(/PhotoSlot/)
    expect(code).not.toMatch(/StubBlocks/)
  })

  it.each([
    ['O-M-05', O_M_05, '/(tabs)/sites'],
    ['W-M-17', W_M_17, '/(tabs)/field'],
  ])('%s redirect target is a real screen file', (_id, file, target) => {
    const code = stripComments(read(file))
    expect(code).toContain(`href="${target}"`)
    // e.g. "/(tabs)/sites" -> app/(tabs)/sites.tsx must exist.
    const rel = target.replace(/^\//, '')
    expect(existsSync(join(APP_DIR, `${rel}.tsx`))).toBe(true)
  })

  it.each([
    ['O-M-05', O_M_05],
    ['W-M-17', W_M_17],
  ])('%s still gates through RoleGuard before redirecting', (_id, file) => {
    const code = stripComments(read(file))
    expect(code).toMatch(/<RoleGuard\s+screenId=/)
  })
})

describe('W-M-17 carries no hardcoded language literals', () => {
  it('has zero Swahili-only stub strings in the component', () => {
    const code = stripComments(read(W_M_17))
    // The strings the old stub hardcoded, in either language, must be gone.
    for (const literal of [
      'Pakia picha',
      'Picha 1',
      'Picha 2',
      'Alama',
      'Hakuna alama bado',
      'Upload',
      'Photo',
      'Marks',
    ]) {
      expect(code).not.toContain(literal)
    }
  })

  it('renders no <Text>/<Section>/<Title> copy element (redirect emits no locale-bound string)', () => {
    const code = stripComments(read(W_M_17))
    // A redirect surface must not render any copy-bearing element, so there is
    // no string that could settle in the wrong language.
    expect(code).not.toMatch(/<Text/)
    expect(code).not.toMatch(/<Section/)
    expect(code).not.toMatch(/title=/)
    expect(code).not.toMatch(/label=/)
  })
})
