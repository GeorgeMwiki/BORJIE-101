/**
 * Regression test — contract-422 finding (1): buyer KYC was POSTing the
 * NESTED wizard state {personal,nida,company,aml} to the gateway's FLAT
 * SubmitKycSchema, which 422'd → buyer onboarding dead.
 *
 * `toSubmitKycBody` is the translation layer. These tests assert its output
 * VALIDATES against a faithful copy of the gateway `SubmitKycSchema`
 * (services/api-gateway/src/routes/mining/_openapi/owner-cockpit-schemas.ts).
 * Posting the raw nested state must FAIL the same schema — proving the
 * translation is load-bearing.
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import type { KycSubmission } from '@/types/kyc'
import { toSubmitKycBody } from '@/kyc/toSubmitKycBody'

// Faithful copy of the gateway SubmitKycSchema (kind enum + flat fields).
const BuyerKindEnum = z.enum([
  'trader',
  'smelter',
  'refinery',
  'export_buyer',
  'bot',
  'broker',
])

const SubmitKycSchema = z.object({
  name: z.string().min(1).max(200),
  kind: BuyerKindEnum,
  country: z.string().length(2).default('TZ'),
  companyId: z.string().optional(),
  licenceNumber: z.string().max(200).optional(),
  nidaId: z.string().min(6).max(40).optional(),
  tin: z.string().min(6).max(40).optional(),
  amlScreenResult: z.enum(['clear', 'flagged', 'pending']).default('pending'),
  contactName: z.string().max(200).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().max(40).optional(),
})

const wizardState: KycSubmission = {
  personal: {
    fullName: 'Asha Mwangeka',
    phone: '+255713000111',
    email: 'asha@example.co.tz',
  },
  nida: { frontImageUri: 'file://front.jpg', backImageUri: 'file://back.jpg' },
  company: {
    tin: '123456789',
    registrationDocUri: 'file://reg.pdf',
    registrationDocName: 'BRELA cert',
  },
  aml: { sourceOfFunds: 'mining proceeds', isPep: false, sanctionsConsent: true },
}

describe('toSubmitKycBody — gateway SubmitKycSchema contract', () => {
  it('produces a body that VALIDATES against the gateway schema', () => {
    const body = toSubmitKycBody(wizardState)
    const parsed = SubmitKycSchema.safeParse(body)
    expect(parsed.success).toBe(true)
  })

  it('maps the wizard fields onto the flat shape', () => {
    const body = toSubmitKycBody(wizardState, 'smelter')
    expect(body).toEqual({
      name: 'Asha Mwangeka',
      kind: 'smelter',
      country: 'TZ',
      tin: '123456789',
      contactName: 'Asha Mwangeka',
      contactEmail: 'asha@example.co.tz',
      contactPhone: '+255713000111',
      amlScreenResult: 'pending',
    })
  })

  it('defaults kind to trader when not supplied', () => {
    expect(toSubmitKycBody(wizardState).kind).toBe('trader')
  })

  it('omits a blank TIN rather than sending an invalid empty string', () => {
    const noTin = {
      ...wizardState,
      company: { ...wizardState.company, tin: '   ' },
    }
    const body = toSubmitKycBody(noTin)
    expect('tin' in body).toBe(false)
    expect(SubmitKycSchema.safeParse(body).success).toBe(true)
  })

  it('the RAW nested wizard state would FAIL the gateway schema (the 422 cause)', () => {
    const parsed = SubmitKycSchema.safeParse(
      wizardState as unknown as Record<string, unknown>,
    )
    expect(parsed.success).toBe(false)
  })
})
