/**
 * Per-jurisdiction recording-consent notices.
 *
 * Coverage as of 2026-05-25:
 *   - East Africa: TZ (POPIA-aligned + DPA 2022), KE (DPA 2019), UG (DPA 2019), RW (Law 058/2021)
 *   - Africa-wide: NG (NDPA 2023), ZA (POPIA 2013)
 *   - EU: GDPR 2016/679 Art.6/7/9 — biometric voice = special category
 *   - GB: UK GDPR + DPA 2018
 *   - US: federal wiretap one-party (default), plus the eleven "all-party-consent" states
 *
 * Each notice has: text to be displayed/spoken, whether it must be
 * audible (as opposed to displayed visually), whether explicit consent
 * is required vs notice-only, and whether biometric data falls under a
 * stricter special-category regime (matters for voice-biometric storage).
 *
 * Sources (cited in Docs/AUDIO_LOGICS_LITFIN_RESEARCH_2026-05-25.md):
 *   - TZ Personal Data Protection Act 2022, s.6 (lawful basis), s.18 (notification)
 *   - KE Data Protection Act 2019, s.30 (consent), s.44 (CCTV/recording)
 *   - GDPR Art.6(1)(a), Art.7 (conditions for consent), Art.9 (biometric)
 *   - US 18 USC §2511 (federal 1-party); CA Penal §632, IL 720 ILCS 5/14-2, etc.
 */

import { AudioLogicsLitfinError, type Jurisdiction, type RecordingNoticeSpec } from '../types.js';

const NOTICES: Readonly<Record<Jurisdiction, RecordingNoticeSpec>> = Object.freeze({
  TZ: {
    jurisdiction: 'TZ',
    noticeText:
      'For training, compliance, and dispute-resolution purposes, this call may be recorded under Tanzania Personal Data Protection Act, 2022. By continuing, you consent to the recording. You may opt out at any time by ending this call.',
    mustBeAudible: true,
    requiresExplicitConsent: true,
    biometricSpecialCategory: true,
    statutoryCitations: [
      'TZ Personal Data Protection Act, 2022 s.6',
      'TZ Personal Data Protection Act, 2022 s.18',
    ],
  },
  KE: {
    jurisdiction: 'KE',
    noticeText:
      'Maelezo ya simu hii yanaweza kurekodiwa kwa madhumuni ya mafunzo na kuthibitisha taarifa, kwa mujibu wa Data Protection Act 2019. Kuendelea kwa simu hii kunaonyesha kibali chako.',
    mustBeAudible: true,
    requiresExplicitConsent: true,
    biometricSpecialCategory: true,
    statutoryCitations: [
      'KE Data Protection Act, 2019 s.30',
      'KE Data Protection (General) Regulations, 2021 r.13',
    ],
  },
  UG: {
    jurisdiction: 'UG',
    noticeText:
      'This call may be recorded for service-quality and dispute-resolution purposes under the Uganda Data Protection and Privacy Act 2019. Please confirm if you consent to the recording.',
    mustBeAudible: true,
    requiresExplicitConsent: true,
    biometricSpecialCategory: true,
    statutoryCitations: ['UG Data Protection and Privacy Act, 2019 s.7'],
  },
  RW: {
    jurisdiction: 'RW',
    noticeText:
      'Iki kiganiro gishobora kwandikwa kugira ngo dushyigikire ubuziranenge bw’ícyifuzo cyawe, kuva muri Itegeko No 058/2021. Tukomeze, ukaba uyemera.',
    mustBeAudible: true,
    requiresExplicitConsent: true,
    biometricSpecialCategory: true,
    statutoryCitations: [
      'RW Law N° 058/2021 of 13/10/2021 relating to the protection of personal data and privacy',
    ],
  },
  NG: {
    jurisdiction: 'NG',
    noticeText:
      'This call may be recorded for service-quality, compliance, and dispute-resolution purposes under the Nigeria Data Protection Act 2023. By continuing, you consent to the recording.',
    mustBeAudible: true,
    requiresExplicitConsent: true,
    biometricSpecialCategory: true,
    statutoryCitations: ['NG Data Protection Act, 2023 s.25 — Consent'],
  },
  ZA: {
    jurisdiction: 'ZA',
    noticeText:
      'For quality and compliance purposes, this call may be recorded under the Protection of Personal Information Act, 2013 (POPIA). By continuing, you consent to the recording.',
    mustBeAudible: true,
    requiresExplicitConsent: true,
    biometricSpecialCategory: true,
    statutoryCitations: ['ZA POPIA, 2013 s.11 — Consent', 'ZA POPIA, 2013 s.26 — Special personal information'],
  },
  EU: {
    jurisdiction: 'EU',
    noticeText:
      'This call may be recorded for service-quality, training, and compliance under GDPR Art.6(1)(a) and, where voice biometric features are processed, Art.9(2)(a). You have the right to withdraw consent at any time without affecting prior processing.',
    mustBeAudible: true,
    requiresExplicitConsent: true,
    biometricSpecialCategory: true,
    statutoryCitations: [
      'EU Regulation 2016/679 (GDPR) Art.6(1)(a)',
      'EU Regulation 2016/679 (GDPR) Art.7',
      'EU Regulation 2016/679 (GDPR) Art.9(2)(a)',
    ],
  },
  GB: {
    jurisdiction: 'GB',
    noticeText:
      'This call may be recorded for quality and training purposes under UK GDPR and the Data Protection Act 2018. You may withdraw consent at any time by ending the call.',
    mustBeAudible: true,
    requiresExplicitConsent: true,
    biometricSpecialCategory: true,
    statutoryCitations: ['UK GDPR Art.6(1)(a)', 'UK Data Protection Act 2018 s.10'],
  },
  'US-1P': {
    jurisdiction: 'US-1P',
    noticeText:
      'This call may be recorded for quality assurance and service-improvement purposes.',
    mustBeAudible: false,
    requiresExplicitConsent: false,
    biometricSpecialCategory: false,
    statutoryCitations: [
      'US 18 USC §2511 — Federal one-party-consent default',
      'AL, AK, AZ, AR, CO, DC, GA, HI, ID, IN, IA, KS, KY, LA, ME, MN, MS, MO, NE, NJ, NM, NY, NC, ND, OH, OK, RI, SC, SD, TN, TX, UT, VT, VA, WV, WI, WY',
    ],
  },
  'US-2P': {
    jurisdiction: 'US-2P',
    noticeText:
      'This call may be recorded. As required by your state’s all-party-consent law, please confirm verbally that you consent to the recording before we proceed.',
    mustBeAudible: true,
    requiresExplicitConsent: true,
    biometricSpecialCategory: false,
    statutoryCitations: [
      'CA Penal Code §632',
      'FL Stat. §934.03',
      'IL 720 ILCS 5/14-2',
      'MD Cts. & Jud. Proc. §10-402',
      'MA Gen. Laws ch. 272 §99',
      'MI Comp. Laws §750.539c',
      'MT Code §45-8-213',
      'NV Rev. Stat. §200.620',
      'NH Rev. Stat. §570-A',
      'PA Title 18 §5704',
      'WA Rev. Code §9.73.030',
    ],
  },
});

/**
 * Return the recording-notice spec for a given jurisdiction.
 *
 * @throws AudioLogicsLitfinError when the jurisdiction is not recognised.
 */
export function getRecordingNotice(jurisdiction: Jurisdiction): RecordingNoticeSpec {
  const spec = NOTICES[jurisdiction];
  if (!spec) {
    throw new AudioLogicsLitfinError(
      `unknown jurisdiction: ${jurisdiction}`,
      'compliance-unknown-jurisdiction',
    );
  }
  return spec;
}

/** All jurisdictions we ship out of the box. */
export function listSupportedJurisdictions(): ReadonlyArray<Jurisdiction> {
  return Object.freeze(Object.keys(NOTICES)) as ReadonlyArray<Jurisdiction>;
}
