/**
 * Per-jurisdiction protected-attribute registry.
 *
 * Sources cited in `Docs/BIAS_HANDLING_SOTA_2026-05-25.md`. Each
 * entry maps a statute to its protected categories and the
 * application contexts (housing / credit / employment / generic)
 * in which it applies.
 *
 * Jurisdiction keys are ISO-3166-1 alpha-2 codes:
 *   - 'US-FHA'  → US Fair Housing Act
 *   - 'US-ECOA' → US Equal Credit Opportunity Act
 *   - 'UK'      → UK Equality Act 2010
 *   - 'KE'      → Kenya Constitution Article 27
 *   - 'TZ'      → Tanzania Constitution Article 13
 *
 * Use `getApplicableProtections({ jurisdiction, context })` to
 * pick the right list at runtime.
 */

import type { ProtectedAttribute, ProtectionContext } from '../types.js';

const ALL_CONTEXTS: ReadonlyArray<ProtectionContext> = [
  'housing',
  'credit',
  'employment',
  'generic',
];

// --- US — Fair Housing Act (42 U.S.C. § 3604) ----------------------------

export const US_FHA_PROTECTIONS: ReadonlyArray<ProtectedAttribute> = [
  { id: 'race', label: 'Race', jurisdiction: 'US-FHA', citation: '42 U.S.C. § 3604(a)', contexts: ['housing', 'generic'] },
  { id: 'color', label: 'Color', jurisdiction: 'US-FHA', citation: '42 U.S.C. § 3604(a)', contexts: ['housing', 'generic'] },
  { id: 'religion', label: 'Religion', jurisdiction: 'US-FHA', citation: '42 U.S.C. § 3604(a)', contexts: ['housing', 'generic'] },
  { id: 'sex', label: 'Sex', jurisdiction: 'US-FHA', citation: '42 U.S.C. § 3604(a) (added 1974)', contexts: ['housing', 'generic'] },
  { id: 'familial_status', label: 'Familial status', jurisdiction: 'US-FHA', citation: '42 U.S.C. § 3604 (added 1988)', contexts: ['housing'] },
  { id: 'national_origin', label: 'National origin', jurisdiction: 'US-FHA', citation: '42 U.S.C. § 3604(a)', contexts: ['housing', 'generic'] },
  { id: 'disability', label: 'Disability / handicap', jurisdiction: 'US-FHA', citation: '42 U.S.C. § 3604(f) (added 1988)', contexts: ['housing', 'employment', 'generic'] },
];

// --- US — Equal Credit Opportunity Act (15 U.S.C. § 1691) ----------------

export const US_ECOA_PROTECTIONS: ReadonlyArray<ProtectedAttribute> = [
  { id: 'race', label: 'Race', jurisdiction: 'US-ECOA', citation: '15 U.S.C. § 1691(a)(1)', contexts: ['credit', 'generic'] },
  { id: 'color', label: 'Color', jurisdiction: 'US-ECOA', citation: '15 U.S.C. § 1691(a)(1)', contexts: ['credit', 'generic'] },
  { id: 'religion', label: 'Religion', jurisdiction: 'US-ECOA', citation: '15 U.S.C. § 1691(a)(1)', contexts: ['credit', 'generic'] },
  { id: 'national_origin', label: 'National origin', jurisdiction: 'US-ECOA', citation: '15 U.S.C. § 1691(a)(1)', contexts: ['credit', 'generic'] },
  { id: 'sex', label: 'Sex', jurisdiction: 'US-ECOA', citation: '15 U.S.C. § 1691(a)(1)', contexts: ['credit', 'generic'] },
  { id: 'marital_status', label: 'Marital status', jurisdiction: 'US-ECOA', citation: '15 U.S.C. § 1691(a)(1)', contexts: ['credit'] },
  { id: 'age', label: 'Age', jurisdiction: 'US-ECOA', citation: '15 U.S.C. § 1691(a)(1)', contexts: ['credit'] },
  { id: 'public_assistance', label: 'Receipt of public assistance', jurisdiction: 'US-ECOA', citation: '15 U.S.C. § 1691(a)(2)', contexts: ['credit'] },
  { id: 'consumer_rights', label: 'Exercise of Consumer Credit Protection Act rights', jurisdiction: 'US-ECOA', citation: '15 U.S.C. § 1691(a)(3)', contexts: ['credit'] },
];

// --- UK — Equality Act 2010 § 4 ------------------------------------------

export const UK_EQUALITY_ACT_PROTECTIONS: ReadonlyArray<ProtectedAttribute> = [
  { id: 'age', label: 'Age', jurisdiction: 'UK', citation: 'Equality Act 2010 §5', contexts: ALL_CONTEXTS },
  { id: 'disability', label: 'Disability', jurisdiction: 'UK', citation: 'Equality Act 2010 §6', contexts: ALL_CONTEXTS },
  { id: 'gender_reassignment', label: 'Gender reassignment', jurisdiction: 'UK', citation: 'Equality Act 2010 §7', contexts: ALL_CONTEXTS },
  { id: 'marriage_civil_partnership', label: 'Marriage and civil partnership', jurisdiction: 'UK', citation: 'Equality Act 2010 §8', contexts: ['employment', 'generic'] },
  { id: 'pregnancy_maternity', label: 'Pregnancy and maternity', jurisdiction: 'UK', citation: 'Equality Act 2010 §17–18', contexts: ALL_CONTEXTS },
  { id: 'race', label: 'Race', jurisdiction: 'UK', citation: 'Equality Act 2010 §9', contexts: ALL_CONTEXTS },
  { id: 'religion_belief', label: 'Religion or belief', jurisdiction: 'UK', citation: 'Equality Act 2010 §10', contexts: ALL_CONTEXTS },
  { id: 'sex', label: 'Sex', jurisdiction: 'UK', citation: 'Equality Act 2010 §11', contexts: ALL_CONTEXTS },
  { id: 'sexual_orientation', label: 'Sexual orientation', jurisdiction: 'UK', citation: 'Equality Act 2010 §12', contexts: ALL_CONTEXTS },
];

// --- KE — Constitution of Kenya 2010, Article 27 ------------------------

export const KE_ART27_PROTECTIONS: ReadonlyArray<ProtectedAttribute> = [
  { id: 'race', label: 'Race', jurisdiction: 'KE', citation: 'Constitution of Kenya Art. 27(4)', contexts: ALL_CONTEXTS },
  { id: 'sex', label: 'Sex', jurisdiction: 'KE', citation: 'Constitution of Kenya Art. 27(4)', contexts: ALL_CONTEXTS },
  { id: 'pregnancy', label: 'Pregnancy', jurisdiction: 'KE', citation: 'Constitution of Kenya Art. 27(4)', contexts: ALL_CONTEXTS },
  { id: 'marital_status', label: 'Marital status', jurisdiction: 'KE', citation: 'Constitution of Kenya Art. 27(4)', contexts: ALL_CONTEXTS },
  { id: 'health_status', label: 'Health status', jurisdiction: 'KE', citation: 'Constitution of Kenya Art. 27(4)', contexts: ALL_CONTEXTS },
  { id: 'ethnic_social_origin', label: 'Ethnic or social origin', jurisdiction: 'KE', citation: 'Constitution of Kenya Art. 27(4)', contexts: ALL_CONTEXTS },
  { id: 'color', label: 'Colour', jurisdiction: 'KE', citation: 'Constitution of Kenya Art. 27(4)', contexts: ALL_CONTEXTS },
  { id: 'age', label: 'Age', jurisdiction: 'KE', citation: 'Constitution of Kenya Art. 27(4)', contexts: ALL_CONTEXTS },
  { id: 'disability', label: 'Disability', jurisdiction: 'KE', citation: 'Constitution of Kenya Art. 27(4) + Persons with Disabilities Act 2003', contexts: ALL_CONTEXTS },
  { id: 'religion', label: 'Religion', jurisdiction: 'KE', citation: 'Constitution of Kenya Art. 27(4)', contexts: ALL_CONTEXTS },
  { id: 'conscience_belief', label: 'Conscience / belief', jurisdiction: 'KE', citation: 'Constitution of Kenya Art. 27(4)', contexts: ALL_CONTEXTS },
  { id: 'culture_language', label: 'Culture / dress / language', jurisdiction: 'KE', citation: 'Constitution of Kenya Art. 27(4)', contexts: ALL_CONTEXTS },
  { id: 'birth', label: 'Birth', jurisdiction: 'KE', citation: 'Constitution of Kenya Art. 27(4)', contexts: ALL_CONTEXTS },
];

// --- TZ — Constitution of the United Republic of Tanzania, Article 13 ---

export const TZ_ART13_PROTECTIONS: ReadonlyArray<ProtectedAttribute> = [
  { id: 'nationality', label: 'Nationality', jurisdiction: 'TZ', citation: 'Constitution of TZ Art. 13(5)', contexts: ALL_CONTEXTS },
  { id: 'tribe', label: 'Tribe', jurisdiction: 'TZ', citation: 'Constitution of TZ Art. 13(5)', contexts: ALL_CONTEXTS },
  { id: 'place_of_origin', label: 'Place of origin', jurisdiction: 'TZ', citation: 'Constitution of TZ Art. 13(5)', contexts: ALL_CONTEXTS },
  { id: 'political_opinion', label: 'Political opinion', jurisdiction: 'TZ', citation: 'Constitution of TZ Art. 13(5)', contexts: ALL_CONTEXTS },
  { id: 'color', label: 'Colour', jurisdiction: 'TZ', citation: 'Constitution of TZ Art. 13(5)', contexts: ALL_CONTEXTS },
  { id: 'religion', label: 'Religion', jurisdiction: 'TZ', citation: 'Constitution of TZ Art. 13(5)', contexts: ALL_CONTEXTS },
  { id: 'sex', label: 'Sex', jurisdiction: 'TZ', citation: 'Constitution of TZ Art. 13(5)', contexts: ALL_CONTEXTS },
  { id: 'station_in_life', label: 'Station in life', jurisdiction: 'TZ', citation: 'Constitution of TZ Art. 13(5)', contexts: ALL_CONTEXTS },
  { id: 'age', label: 'Age', jurisdiction: 'TZ', citation: 'Employment and Labour Relations Act 2004 §7', contexts: ['employment'] },
  { id: 'disability', label: 'Disability', jurisdiction: 'TZ', citation: 'Persons with Disabilities Act 2010', contexts: ALL_CONTEXTS },
  { id: 'pregnancy', label: 'Pregnancy', jurisdiction: 'TZ', citation: 'Employment and Labour Relations Act 2004 §7', contexts: ['employment'] },
];

// ---------------------------------------------------------------------------
// Aggregate registry + lookups
// ---------------------------------------------------------------------------

export const ALL_JURISDICTIONS = [
  'US-FHA',
  'US-ECOA',
  'UK',
  'KE',
  'TZ',
] as const;

export type SupportedJurisdiction = (typeof ALL_JURISDICTIONS)[number];

export const PROTECTION_REGISTRY: Readonly<
  Record<SupportedJurisdiction, ReadonlyArray<ProtectedAttribute>>
> = {
  'US-FHA': US_FHA_PROTECTIONS,
  'US-ECOA': US_ECOA_PROTECTIONS,
  UK: UK_EQUALITY_ACT_PROTECTIONS,
  KE: KE_ART27_PROTECTIONS,
  TZ: TZ_ART13_PROTECTIONS,
};

/**
 * Returns the list of protected attributes applicable to a given
 * (jurisdiction, context) pair. Throws if jurisdiction unknown.
 */
export function getApplicableProtections(args: {
  jurisdiction: SupportedJurisdiction | string;
  context?: ProtectionContext;
}): ReadonlyArray<ProtectedAttribute> {
  const j = args.jurisdiction;
  if (!(j in PROTECTION_REGISTRY)) {
    throw new Error(
      `[bias-handling] unknown jurisdiction '${j}'. Supported: ${ALL_JURISDICTIONS.join(', ')}.`,
    );
  }
  const all = PROTECTION_REGISTRY[j as SupportedJurisdiction];
  if (!args.context) return all;
  return all.filter((p) => p.contexts.includes(args.context as ProtectionContext));
}
