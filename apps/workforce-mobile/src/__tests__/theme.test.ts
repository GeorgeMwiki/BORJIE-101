import { describe, expect, it } from 'vitest'
import { colors } from '../theme/colors'
import { workforcePersonaSpec } from '../roles/persona'

describe('workforce-mobile theme tokens', () => {
  it('exposes the Borjie ore-green primary palette', () => {
    expect(colors.gold).toMatch(/^#[0-9A-Fa-f]{6}$/)
    expect(colors.earth900).toMatch(/^#[0-9A-Fa-f]{6}$/)
  })

  it('exposes neutral surface tokens', () => {
    expect(colors.surface).toMatch(/^#[0-9A-Fa-f]{6}$/)
    expect(colors.surfaceAlt).toMatch(/^#[0-9A-Fa-f]{6}$/)
  })

  it('exposes semantic text tokens', () => {
    expect(colors.text).toMatch(/^#[0-9A-Fa-f]{6}$/)
    expect(colors.textMuted).toMatch(/^#[0-9A-Fa-f]{6}$/)
  })
})

describe('workforce-mobile persona wiring', () => {
  it('resolves owner persona spec from @borjie/persona-runtime', () => {
    const spec = workforcePersonaSpec('owner')
    expect(spec.slug).toBe('T1_owner_strategist')
    expect(spec.powerTier).toBe(1)
  })

  it('resolves manager persona spec', () => {
    const spec = workforcePersonaSpec('manager')
    expect(spec.slug).toBe('T3_module_manager')
    expect(spec.powerTier).toBe(3)
  })

  it('resolves employee persona spec', () => {
    const spec = workforcePersonaSpec('employee')
    expect(spec.slug).toBe('T4_field_employee')
    expect(spec.powerTier).toBe(4)
  })
})
