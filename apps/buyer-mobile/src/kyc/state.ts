import type { AmlValues, CompanyValues, NidaValues, PersonalValues } from '@/schemas/kyc'

export type KycStepKey = 'personal' | 'nida' | 'company' | 'aml' | 'review'

export const stepOrder: readonly KycStepKey[] = ['personal', 'nida', 'company', 'aml', 'review']

export interface KycWizardState {
  readonly personal: PersonalValues
  readonly nida: NidaValues
  readonly company: CompanyValues
  readonly aml: AmlValues
}

export const initialKycState: KycWizardState = {
  personal: { fullName: '', phone: '', email: '' },
  nida: { frontImageUri: '', backImageUri: '' },
  company: { tin: '', registrationDocUri: '', registrationDocName: '' },
  aml: { sourceOfFunds: '', isPep: false, sanctionsConsent: false }
}

export const stepTitleKey: Readonly<Record<KycStepKey, string>> = {
  personal: 'kyc.step_personal',
  nida: 'kyc.step_nida',
  company: 'kyc.step_company',
  aml: 'kyc.step_aml',
  review: 'kyc.step_review'
}
