import { z } from 'zod'

export const personalSchema = z.object({
  fullName: z.string().min(3, 'min_3'),
  phone: z.string().min(9, 'min_9'),
  email: z.string().email('email')
})

export const nidaSchema = z.object({
  frontImageUri: z.string().min(1, 'required'),
  backImageUri: z.string().min(1, 'required')
})

export const companySchema = z.object({
  tin: z.string().regex(/^\d{9}(?:-\d)?$/, 'tin'),
  registrationDocUri: z.string().min(1, 'required'),
  registrationDocName: z.string().min(1, 'required')
})

export const amlSchema = z.object({
  sourceOfFunds: z.string().min(5, 'min_5'),
  isPep: z.boolean(),
  sanctionsConsent: z.boolean().refine((val) => val === true, { message: 'required' })
})

export const fullKycSchema = z.object({
  personal: personalSchema,
  nida: nidaSchema,
  company: companySchema,
  aml: amlSchema
})

export type PersonalValues = z.infer<typeof personalSchema>
export type NidaValues = z.infer<typeof nidaSchema>
export type CompanyValues = z.infer<typeof companySchema>
export type AmlValues = z.infer<typeof amlSchema>
export type FullKycValues = z.infer<typeof fullKycSchema>
