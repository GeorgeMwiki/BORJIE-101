/**
 * Age-of-consent table for child data processing, per jurisdiction.
 *
 * Sources:
 *   - COPPA 16 CFR Part 312 (US federal floor — under 13 needs verifiable parental consent)
 *   - GDPR Art. 8 (EU base age 16; member states may lower to 13)
 *   - UK Age-Appropriate Design Code (12+); GDPR Art. 8 default applies
 *   - POPIA Sec. 35 (ZA under 18 needs parental/guardian consent)
 *   - TZ Personal Data Protection Act 2022 § 28 (under 18)
 *   - KE Data Protection Act 2019 §33 (under 18)
 *   - UG Data Protection and Privacy Act 2019 §8 (under 18)
 *   - RW Law 058/2021 Art. 23 (under 18)
 *   - NG NDPA 2023 §31 (under 18)
 *
 * Returns the minimum age (inclusive) at which the subject can grant
 * their own consent. Below that, `parentalConsent()` must be used.
 */

import type { Jurisdiction } from '../types.js';

const AGE_OF_CONSENT_FOR_DATA: Readonly<Record<Jurisdiction, number>> = Object.freeze({
  GLOBAL: 18,
  EU: 16,
  UK: 13,
  US: 13,
  'US-CA': 13,
  ZA: 18,
  TZ: 18,
  KE: 18,
  UG: 18,
  RW: 18,
  NG: 18,
});

export function ageOfDataConsent(jurisdiction: Jurisdiction): number {
  return AGE_OF_CONSENT_FOR_DATA[jurisdiction];
}

export function needsParentalConsent(
  subjectAge: number,
  jurisdiction: Jurisdiction,
): boolean {
  return subjectAge < ageOfDataConsent(jurisdiction);
}
