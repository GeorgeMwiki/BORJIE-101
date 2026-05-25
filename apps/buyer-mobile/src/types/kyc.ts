export type KycStage = 'submitted' | 'reviewing' | 'approved' | 'rejected'

export interface KycPersonal {
  readonly fullName: string
  readonly phone: string
  readonly email: string
}

export interface KycNida {
  readonly frontImageUri: string
  readonly backImageUri: string
}

export interface KycCompany {
  readonly tin: string
  readonly registrationDocUri: string
  readonly registrationDocName: string
}

export interface KycAml {
  readonly sourceOfFunds: string
  readonly isPep: boolean
  readonly sanctionsConsent: boolean
}

export interface KycSubmission {
  readonly personal: KycPersonal
  readonly nida: KycNida
  readonly company: KycCompany
  readonly aml: KycAml
}

export interface KycRecord {
  readonly id: string
  readonly stage: KycStage
  readonly updatedAt: string
  readonly rejectionReason: string | null
}
