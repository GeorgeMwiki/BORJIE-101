/**
 * Per-jurisdiction KYC requirement matrix.
 *
 * Each entry describes the regulator-mandated document set a vendor
 * must furnish to clear KYC in that country. The registry consults
 * this table at `submitKyc()` — vendors below the bar stay in
 * `pending` until every required document is attached.
 *
 * Coverage (2026 baseline):
 *   TZ  — Tanzania         (TRA + BRELA)
 *   KE  — Kenya            (KRA + NCA + bank statement)
 *   UG  — Uganda           (URSB + URA equivalent)
 *   RW  — Rwanda           (RRA + RDB)
 *   NG  — Nigeria          (CAC + FIRS)
 *
 * Fallback: any country not in the table gets the GENERIC profile,
 * which still requires business registration + tax compliance +
 * bank statement + director ID + insurance.
 */

import type { JurisdictionKycRequirements, KycDocumentType } from '../types.js';

export const JURISDICTION_KYC: ReadonlyArray<JurisdictionKycRequirements> = [
  {
    country: 'TZ',
    jurisdictionName: 'Tanzania',
    requiredDocuments: [
      'brela_registration',
      'tra_tax_clearance',
      'bank_statement',
      'director_id',
      'insurance_certificate',
    ] as ReadonlyArray<KycDocumentType>,
    optionalDocuments: ['professional_indemnity'] as ReadonlyArray<KycDocumentType>,
    regulatorNotes: [
      'BRELA certificate must show current directors as of submission.',
      'TRA tax clearance is valid for 6 months from issuance.',
    ],
  },
  {
    country: 'KE',
    jurisdictionName: 'Kenya',
    requiredDocuments: [
      'business_registration_certificate',
      'kra_pin',
      'tax_compliance_certificate',
      'bank_statement',
      'director_id',
      'insurance_certificate',
    ] as ReadonlyArray<KycDocumentType>,
    optionalDocuments: ['nca_registration', 'professional_indemnity'] as ReadonlyArray<KycDocumentType>,
    regulatorNotes: [
      'NCA registration is mandatory for construction/maintenance vendors above contract class NCA6.',
      'KRA PIN must match the company name on the certificate of incorporation.',
    ],
  },
  {
    country: 'UG',
    jurisdictionName: 'Uganda',
    requiredDocuments: [
      'ursb_registration',
      'tax_compliance_certificate',
      'bank_statement',
      'director_id',
      'insurance_certificate',
    ] as ReadonlyArray<KycDocumentType>,
    optionalDocuments: ['professional_indemnity'] as ReadonlyArray<KycDocumentType>,
    regulatorNotes: [
      'URSB certificate of incorporation must be filed within the last 12 months for active status.',
    ],
  },
  {
    country: 'RW',
    jurisdictionName: 'Rwanda',
    requiredDocuments: [
      'business_registration_certificate',
      'rra_certificate',
      'bank_statement',
      'director_id',
      'insurance_certificate',
    ] as ReadonlyArray<KycDocumentType>,
    optionalDocuments: ['professional_indemnity'] as ReadonlyArray<KycDocumentType>,
    regulatorNotes: [
      'RDB business registration plus RRA tax clearance — both required for vendors above RWF 5M annual turnover.',
    ],
  },
  {
    country: 'NG',
    jurisdictionName: 'Nigeria',
    requiredDocuments: [
      'cac_certificate',
      'firs_tin',
      'tax_compliance_certificate',
      'bank_statement',
      'director_id',
      'insurance_certificate',
    ] as ReadonlyArray<KycDocumentType>,
    optionalDocuments: ['professional_indemnity'] as ReadonlyArray<KycDocumentType>,
    regulatorNotes: [
      'CAC Form CO7 (particulars of directors) is mandatory along with the certificate.',
      'FIRS TIN must be active in the FIRS portal at time of approval.',
    ],
  },
];

const GENERIC_KYC: JurisdictionKycRequirements = {
  country: 'XX',
  jurisdictionName: 'Generic / Unspecified',
  requiredDocuments: [
    'business_registration_certificate',
    'tax_compliance_certificate',
    'bank_statement',
    'director_id',
    'insurance_certificate',
  ] as ReadonlyArray<KycDocumentType>,
  optionalDocuments: ['professional_indemnity'] as ReadonlyArray<KycDocumentType>,
  regulatorNotes: [
    'No jurisdiction-specific KYC profile registered. Falling back to platform-default minimums.',
  ],
};

export function kycRequirementsFor(country: string): JurisdictionKycRequirements {
  const upper = country.trim().toUpperCase();
  return JURISDICTION_KYC.find((r) => r.country === upper) ?? GENERIC_KYC;
}

/** Returns the list of country codes with bespoke KYC profiles. */
export function supportedKycJurisdictions(): ReadonlyArray<string> {
  return JURISDICTION_KYC.map((r) => r.country);
}
