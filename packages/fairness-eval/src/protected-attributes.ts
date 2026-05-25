/**
 * Pre-shipped protected-attribute registry.
 *
 * US — Fair Housing Act (FHA) categories:
 *   race, color, religion, sex, familial status, national origin, disability.
 *   42 U.S.C. § 3604(a).
 *
 * TZ — anti-discrimination categories (Constitution Art. 13(5), Persons with
 * Disabilities Act, 2010):
 *   tribe, gender, disability, marital status, pregnancy.
 *
 * KE — Employment Act / Constitution Art. 27 (sample similar set):
 *   tribe, gender, disability, marital status, pregnancy, religion.
 *
 * Callers can add more attributes via `withAttributes()` — the registry
 * is treated as immutable input to `createFairnessEval`.
 */

import type { ProtectedAttributeSpec } from './types.js';

export const FAIR_HOUSING_ACT_ATTRIBUTES: ReadonlyArray<ProtectedAttributeSpec> = [
  {
    id: 'race',
    profileKey: 'race',
    values: ['black', 'white', 'asian', 'native_american', 'pacific_islander', 'other'],
    jurisdictions: ['US'],
    citation: '42 U.S.C. § 3604(a) — Fair Housing Act',
  },
  {
    id: 'color',
    profileKey: 'color',
    values: ['dark', 'medium', 'light'],
    jurisdictions: ['US'],
    citation: '42 U.S.C. § 3604(a) — Fair Housing Act',
  },
  {
    id: 'religion',
    profileKey: 'religion',
    values: ['christian', 'muslim', 'jewish', 'hindu', 'buddhist', 'none', 'other'],
    jurisdictions: ['US'],
    citation: '42 U.S.C. § 3604(a) — Fair Housing Act',
  },
  {
    id: 'sex',
    profileKey: 'sex',
    values: ['female', 'male', 'non_binary'],
    jurisdictions: ['US'],
    citation: '42 U.S.C. § 3604(a) — Fair Housing Act',
  },
  {
    id: 'familial_status',
    profileKey: 'familial_status',
    values: ['single', 'married', 'with_children', 'pregnant'],
    jurisdictions: ['US'],
    citation: '42 U.S.C. § 3604(a) — Fair Housing Act',
  },
  {
    id: 'national_origin',
    profileKey: 'national_origin',
    values: ['us', 'mexico', 'china', 'india', 'nigeria', 'other'],
    jurisdictions: ['US'],
    citation: '42 U.S.C. § 3604(a) — Fair Housing Act',
  },
  {
    id: 'disability',
    profileKey: 'disability',
    values: ['none', 'mobility', 'visual', 'cognitive', 'hearing'],
    jurisdictions: ['US'],
    citation: '42 U.S.C. § 3604(f) — Fair Housing Act',
  },
];

export const TZ_ANTI_DISCRIMINATION_ATTRIBUTES: ReadonlyArray<ProtectedAttributeSpec> = [
  {
    id: 'tribe',
    profileKey: 'tribe',
    values: ['sukuma', 'chagga', 'haya', 'nyamwezi', 'maasai', 'other'],
    jurisdictions: ['TZ'],
    citation: 'TZ Constitution Art. 13(5)',
  },
  {
    id: 'gender',
    profileKey: 'gender',
    values: ['female', 'male', 'non_binary'],
    jurisdictions: ['TZ'],
    citation: 'TZ Constitution Art. 13(5)',
  },
  {
    id: 'disability',
    profileKey: 'disability',
    values: ['none', 'mobility', 'visual', 'cognitive', 'hearing'],
    jurisdictions: ['TZ'],
    citation: 'TZ Persons with Disabilities Act, 2010',
  },
  {
    id: 'marital_status',
    profileKey: 'marital_status',
    values: ['single', 'married', 'divorced', 'widowed'],
    jurisdictions: ['TZ'],
    citation: 'TZ Constitution Art. 13(5)',
  },
  {
    id: 'pregnancy',
    profileKey: 'is_pregnant',
    values: ['true', 'false'],
    jurisdictions: ['TZ'],
    citation: 'TZ Employment & Labour Relations Act',
  },
];

export const KE_ANTI_DISCRIMINATION_ATTRIBUTES: ReadonlyArray<ProtectedAttributeSpec> = [
  {
    id: 'tribe',
    profileKey: 'tribe',
    values: ['kikuyu', 'luhya', 'kalenjin', 'luo', 'kamba', 'other'],
    jurisdictions: ['KE'],
    citation: 'KE Constitution Art. 27',
  },
  {
    id: 'gender',
    profileKey: 'gender',
    values: ['female', 'male', 'non_binary'],
    jurisdictions: ['KE'],
    citation: 'KE Constitution Art. 27',
  },
  {
    id: 'disability',
    profileKey: 'disability',
    values: ['none', 'mobility', 'visual', 'cognitive', 'hearing'],
    jurisdictions: ['KE'],
    citation: 'KE Persons with Disabilities Act, 2003',
  },
  {
    id: 'marital_status',
    profileKey: 'marital_status',
    values: ['single', 'married', 'divorced', 'widowed'],
    jurisdictions: ['KE'],
    citation: 'KE Constitution Art. 27',
  },
  {
    id: 'pregnancy',
    profileKey: 'is_pregnant',
    values: ['true', 'false'],
    jurisdictions: ['KE'],
    citation: 'KE Employment Act, 2007',
  },
  {
    id: 'religion',
    profileKey: 'religion',
    values: ['christian', 'muslim', 'hindu', 'traditional', 'none'],
    jurisdictions: ['KE'],
    citation: 'KE Constitution Art. 27',
  },
];

/** All pre-shipped attributes. */
export const DEFAULT_ATTRIBUTES: ReadonlyArray<ProtectedAttributeSpec> = [
  ...FAIR_HOUSING_ACT_ATTRIBUTES,
  ...TZ_ANTI_DISCRIMINATION_ATTRIBUTES,
  ...KE_ANTI_DISCRIMINATION_ATTRIBUTES,
];

/**
 * Filter the registry to attributes applicable in `jurisdiction`.
 * Returns the matching spec list — same-id attributes from multiple
 * jurisdictions are de-duplicated by id.
 */
export function attributesFor(
  jurisdiction: string,
  registry: ReadonlyArray<ProtectedAttributeSpec> = DEFAULT_ATTRIBUTES,
): ReadonlyArray<ProtectedAttributeSpec> {
  const seen = new Set<string>();
  const out: ProtectedAttributeSpec[] = [];
  for (const spec of registry) {
    if (!spec.jurisdictions.includes(jurisdiction)) continue;
    if (seen.has(spec.id)) continue;
    seen.add(spec.id);
    out.push(spec);
  }
  return out;
}
