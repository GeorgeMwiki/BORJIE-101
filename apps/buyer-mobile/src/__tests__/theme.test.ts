import { describe, expect, it } from 'vitest'
import { colors } from '../theme/colors'
import { buyerPersonaSpec } from '../auth/persona'

describe('buyer-mobile theme tokens', () => {
  it('exposes the mining marketplace palette', () => {
    expect(colors.forest).toMatch(/^#[0-9A-Fa-f]{6}$/)
    expect(colors.gold).toMatch(/^#[0-9A-Fa-f]{6}$/)
    expect(colors.copper).toMatch(/^#[0-9A-Fa-f]{6}$/)
  })

  it('exposes semantic state tokens with paired soft backgrounds', () => {
    expect(colors.success).toMatch(/^#[0-9A-Fa-f]{6}$/)
    expect(colors.successSoft).toMatch(/^#[0-9A-Fa-f]{6}$/)
    expect(colors.warning).toMatch(/^#[0-9A-Fa-f]{6}$/)
    expect(colors.warningSoft).toMatch(/^#[0-9A-Fa-f]{6}$/)
    expect(colors.danger).toMatch(/^#[0-9A-Fa-f]{6}$/)
    expect(colors.dangerSoft).toMatch(/^#[0-9A-Fa-f]{6}$/)
  })
})

describe('buyer-mobile persona wiring', () => {
  it('resolves T5 customer concierge spec from @borjie/persona-runtime', () => {
    const spec = buyerPersonaSpec()
    expect(spec.slug).toBe('T5_customer_concierge')
    expect(spec.powerTier).toBe(5)
  })
})
