// Refusal Grammar — unit tests (6 fixtures + format coverage).

import { describe, expect, it } from 'vitest'
import {
  ALL_SAMPLE_REFUSALS,
  formatRefusal,
  REFUSAL_ABOVE_AUTONOMY_CAP,
  REFUSAL_CLASSIFIER_BLOCKED,
  REFUSAL_DESTRUCTIVE_NO_APPROVAL,
  REFUSAL_JURISDICTION,
  REFUSAL_MISSING_DATA,
  REFUSAL_MODEL_UNCERTAIN,
  type Refusal,
  type RefusalClass
} from '../index.js'

describe('Refusal samples', () => {
  it('fixture #1: REFUSAL_ABOVE_AUTONOMY_CAP is a wont refusal with escalation', () => {
    expect(REFUSAL_ABOVE_AUTONOMY_CAP.class).toBe<RefusalClass>('wont')
    expect(REFUSAL_ABOVE_AUTONOMY_CAP.code).toBe('ABOVE_AUTONOMY_CAP')
    expect(REFUSAL_ABOVE_AUTONOMY_CAP.escalation_path).toMatch(/owner/)
    expect(REFUSAL_ABOVE_AUTONOMY_CAP.alternative).toBeTruthy()
  })

  it('fixture #2: REFUSAL_DESTRUCTIVE_NO_APPROVAL requires 2 roles to escalate', () => {
    expect(REFUSAL_DESTRUCTIVE_NO_APPROVAL.class).toBe<RefusalClass>('wont')
    expect(REFUSAL_DESTRUCTIVE_NO_APPROVAL.escalation_path).toContain('owner')
    expect(REFUSAL_DESTRUCTIVE_NO_APPROVAL.escalation_path).toContain('manager')
    expect(REFUSAL_DESTRUCTIVE_NO_APPROVAL.code).toBe('DESTRUCTIVE_NO_APPROVAL')
  })

  it('fixture #3: REFUSAL_MISSING_DATA is a cant refusal with self-serve alt', () => {
    expect(REFUSAL_MISSING_DATA.class).toBe<RefusalClass>('cant')
    expect(REFUSAL_MISSING_DATA.escalation_path).toMatch(/self-serve/)
    expect(REFUSAL_MISSING_DATA.code).toBe('MISSING_DATA')
  })

  it('fixture #4: REFUSAL_JURISDICTION is a cant refusal pointing at legal', () => {
    expect(REFUSAL_JURISDICTION.class).toBe<RefusalClass>('cant')
    expect(REFUSAL_JURISDICTION.escalation_path).toBe('role:legal')
    expect(REFUSAL_JURISDICTION.code).toBe('JURISDICTION_UNSUPPORTED')
  })

  it('fixture #5: REFUSAL_MODEL_UNCERTAIN is uncertain, not wont/cant', () => {
    expect(REFUSAL_MODEL_UNCERTAIN.class).toBe<RefusalClass>('uncertain')
    expect(REFUSAL_MODEL_UNCERTAIN.code).toBe('MODEL_UNCERTAIN')
    expect(REFUSAL_MODEL_UNCERTAIN.alternative).toBeTruthy()
  })

  it('fixture #6: REFUSAL_CLASSIFIER_BLOCKED is wont and points at admin', () => {
    expect(REFUSAL_CLASSIFIER_BLOCKED.class).toBe<RefusalClass>('wont')
    expect(REFUSAL_CLASSIFIER_BLOCKED.escalation_path).toBe('role:admin')
    expect(REFUSAL_CLASSIFIER_BLOCKED.code).toBe('CLASSIFIER_BLOCKED')
  })

  it('all six samples have distinct codes', () => {
    const codes = ALL_SAMPLE_REFUSALS.map((r) => r.code)
    expect(new Set(codes).size).toBe(6)
  })

  it('all six samples have owner-safe reasons (no stack traces / model IDs)', () => {
    const banned = [/stack/i, /traceback/i, /model_id/i, /\$\{/]
    for (const r of ALL_SAMPLE_REFUSALS) {
      for (const re of banned) {
        expect(r.reason_owner_safe).not.toMatch(re)
      }
    }
  })

  it('all six samples have non-empty reason text', () => {
    for (const r of ALL_SAMPLE_REFUSALS) {
      expect(r.reason_owner_safe.length).toBeGreaterThan(10)
    }
  })

  it('ALL_SAMPLE_REFUSALS exports exactly 6 refusals', () => {
    expect(ALL_SAMPLE_REFUSALS).toHaveLength(6)
  })
})

describe('formatRefusal', () => {
  it('wraps a refusal in the AG-UI envelope shape', () => {
    const envelope = formatRefusal(REFUSAL_ABOVE_AUTONOMY_CAP)
    expect(envelope).toEqual({
      ag_ui_kind: 'refusal_card',
      payload: REFUSAL_ABOVE_AUTONOMY_CAP
    })
  })

  it('returns a new envelope object each call', () => {
    const a = formatRefusal(REFUSAL_MISSING_DATA)
    const b = formatRefusal(REFUSAL_MISSING_DATA)
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })

  it('preserves the passed refusal reference inside the envelope', () => {
    const envelope = formatRefusal(REFUSAL_MISSING_DATA)
    expect(envelope.payload).toBe(REFUSAL_MISSING_DATA)
  })

  it('works on custom refusals as well as the samples', () => {
    const custom: Refusal = {
      class: 'cant',
      reason_owner_safe: 'I dont have access to that file.'
    }
    const envelope = formatRefusal(custom)
    expect(envelope.ag_ui_kind).toBe('refusal_card')
    expect(envelope.payload).toBe(custom)
  })
})
