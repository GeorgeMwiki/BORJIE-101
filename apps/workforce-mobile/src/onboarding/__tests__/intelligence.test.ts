import { describe, expect, it } from 'vitest'
import {
  classifyRole,
  recommendCertifications,
  calibrateAiTone,
  INTELLIGENCE_VERSION
} from '../intelligence'

describe('classifyRole — Swahili happy paths', () => {
  it('detects an owner from "mwenye mgodi"', () => {
    const result = classifyRole('Mimi ni mwenye mgodi wa dhahabu', 'sw')
    expect(result.role).toBe('owner')
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.matchedKeywords).toContain('mwenye')
  })

  it('detects a manager from "meneja wa shifti"', () => {
    const result = classifyRole('Mimi ni meneja wa shifti ya asubuhi', 'sw')
    expect(result.role).toBe('manager')
    expect(result.matchedKeywords).toContain('meneja')
  })

  it('detects an employee from "mfanyakazi wa chini"', () => {
    const result = classifyRole('Mimi ni mfanyakazi wa chini ya ardhi', 'sw')
    expect(result.role).toBe('employee')
    expect(result.matchedKeywords).toContain('mfanyakazi')
  })

  it('returns matched keywords as evidence for the auditor', () => {
    const result = classifyRole('msimamizi wa foreman wa shifti', 'sw')
    expect(result.role).toBe('manager')
    expect(result.matchedKeywords.length).toBeGreaterThan(0)
  })
})

describe('classifyRole — English happy paths', () => {
  it('detects an owner from "I am the owner"', () => {
    const result = classifyRole('I am the owner of the mine', 'en')
    expect(result.role).toBe('owner')
    expect(result.matchedKeywords).toContain('owner')
  })

  it('detects a manager from "shift supervisor"', () => {
    const result = classifyRole('I am the shift supervisor at the pit', 'en')
    expect(result.role).toBe('manager')
    expect(result.matchedKeywords).toContain('supervisor')
  })

  it('detects an employee from "excavator operator"', () => {
    const result = classifyRole('I am an excavator operator', 'en')
    expect(result.role).toBe('employee')
    expect(result.matchedKeywords).toContain('operator')
  })
})

describe('classifyRole — edge cases and ambiguity', () => {
  it('defaults to employee on empty input with zero confidence', () => {
    const result = classifyRole('', 'sw')
    expect(result.role).toBe('employee')
    expect(result.confidence).toBe(0)
    expect(result.matchedKeywords).toHaveLength(0)
  })

  it('defaults to employee on whitespace-only input', () => {
    const result = classifyRole('   \n\t  ', 'en')
    expect(result.role).toBe('employee')
    expect(result.confidence).toBe(0)
  })

  it('defaults to employee on unknown vocabulary', () => {
    const result = classifyRole('xylophone purple sandwich', 'en')
    expect(result.role).toBe('employee')
    expect(result.confidence).toBe(0)
    expect(result.matchedKeywords).toHaveLength(0)
  })

  it('breaks owner vs employee tie towards employee', () => {
    const result = classifyRole('mwenye mfanyakazi', 'sw')
    expect(result.role).toBe('employee')
  })

  it('clamps confidence into [0, 1]', () => {
    const result = classifyRole('owner owner owner owner', 'en')
    expect(result.confidence).toBeGreaterThanOrEqual(0)
    expect(result.confidence).toBeLessThanOrEqual(1)
  })

  it('returns low confidence when multiple roles compete weakly', () => {
    const result = classifyRole('boss meneja worker', 'sw')
    expect(result.confidence).toBeLessThanOrEqual(1)
    expect(result.confidence).toBeGreaterThan(0)
  })
})

describe('recommendCertifications', () => {
  it('recommends excavator + first-aid for excavator operators (en)', () => {
    const recs = recommendCertifications('I run the excavator at the pit', 'en')
    expect(recs).toContain('excavator-license')
    expect(recs).toContain('first-aid')
  })

  it('recommends haul-truck + first-aid for truck drivers (sw)', () => {
    const recs = recommendCertifications('Mimi ni dereva wa truck', 'sw')
    expect(recs).toContain('haul-truck-license')
    expect(recs).toContain('first-aid')
  })

  it('recommends underground-cert for shaft work', () => {
    const recs = recommendCertifications('I work in the underground shaft', 'en')
    expect(recs).toContain('underground-cert')
  })

  it('recommends blaster-permit for explosives work (sw)', () => {
    const recs = recommendCertifications('mimi ni mlipuaji wa baruti', 'sw')
    expect(recs).toContain('blaster-permit')
  })

  it('defaults to first-aid only when no triggers match', () => {
    const recs = recommendCertifications('hakuna kitu', 'sw')
    expect(recs).toEqual(['first-aid'])
  })

  it('returns a readonly tuple', () => {
    const recs = recommendCertifications('excavator', 'en')
    expect(Object.isFrozen(recs)).toBe(true)
  })

  it('does not duplicate first-aid when triggers also imply it', () => {
    const recs = recommendCertifications('excavator first-aid', 'en')
    const firstAidCount = recs.filter((cert) => cert === 'first-aid').length
    expect(firstAidCount).toBe(1)
  })
})

describe('calibrateAiTone', () => {
  it('picks "brief" when brevity is high', () => {
    expect(calibrateAiTone({ formality: 0.5, brevity: 0.9, humor: 0.5 })).toBe('brief')
  })

  it('picks "with-jokes" when humour is high and formality is low', () => {
    expect(calibrateAiTone({ formality: 0.2, brevity: 0.3, humor: 0.8 })).toBe('with-jokes')
  })

  it('picks "formal" when formality is high and brevity is low', () => {
    expect(calibrateAiTone({ formality: 0.9, brevity: 0.3, humor: 0.1 })).toBe('formal')
  })

  it('falls back to "friendly" when sliders are balanced', () => {
    expect(calibrateAiTone({ formality: 0.5, brevity: 0.5, humor: 0.3 })).toBe('friendly')
  })

  it('prefers brevity over humour when both are high', () => {
    expect(calibrateAiTone({ formality: 0.2, brevity: 0.9, humor: 0.9 })).toBe('brief')
  })

  it('clamps out-of-range slider values', () => {
    expect(calibrateAiTone({ formality: -1, brevity: 2, humor: NaN })).toBe('brief')
  })
})

describe('intelligence module metadata', () => {
  it('exposes a stable version identifier for swap-in tracking', () => {
    expect(INTELLIGENCE_VERSION).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+/)
  })
})
