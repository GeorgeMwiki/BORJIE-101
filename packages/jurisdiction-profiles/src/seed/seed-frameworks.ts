/**
 * Compliance Framework seed — 16 named regulations + their per-article
 * Borjie package mappings.
 *
 * Each `audit_hash` is produced by `linkRegistryRow` so the seed is
 * deterministic + replay-safe. Citations carry URL + title + date so
 * a regulator audit can re-verify each row against the upstream
 * source.
 *
 * Spec: Docs/DESIGN/UNIVERSAL_JURISDICTION_SPEC.md §2.1
 */

import type {
  ComplianceFramework,
  FrameworkControlMapping,
} from '../types.js';
import { linkRegistryRow } from '../registry/audit-link.js';

// Helper that hashes a framework body using its id, returning a stable
// audit_hash. Pure / deterministic.
function fwHash(id: string): string {
  return linkRegistryRow({ kind: 'framework', id });
}

function mapHash(framework_id: string, article_ref: string, pkg: string): string {
  return linkRegistryRow({
    kind: 'mapping',
    id: `${framework_id}::${article_ref}::${pkg}`,
  });
}

// ---------------------------------------------------------------------------
// 1. GDPR (EU)
// ---------------------------------------------------------------------------
export const gdpr: ComplianceFramework = {
  id: 'gdpr',
  display_name: 'EU General Data Protection Regulation (Reg. 2016/679)',
  jurisdictions: ['de', 'fr', 'es', 'it', 'nl', 'pl', 'se', 'fi', 'ie', 'pt'],
  effective_date: '2018-05-25',
  article_registry: {
    articles: [
      { ref: 'Art. 5', title: 'Principles relating to processing of personal data', topic: 'data-minimisation' },
      { ref: 'Art. 7', title: 'Conditions for consent', topic: 'consent' },
      { ref: 'Art. 17', title: 'Right to erasure (right to be forgotten)', topic: 'rtbf' },
      { ref: 'Art. 30', title: 'Records of processing activities', topic: 'audit-trail' },
      { ref: 'Art. 32', title: 'Security of processing', topic: 'security-safeguards' },
      { ref: 'Art. 33', title: 'Notification of personal data breach to the supervisory authority', topic: 'breach-notification' },
      { ref: 'Art. 34', title: 'Communication of personal data breach to data subject', topic: 'breach-notification' },
      { ref: 'Art. 35', title: 'Data protection impact assessment', topic: 'dpia' },
      { ref: 'Art. 44', title: 'General principle for transfers', topic: 'cross-border-transfer' },
    ],
  },
  source_url: 'https://gdpr-info.eu/art-33-gdpr/',
  source_title: 'GDPR Info — Art. 33 Notification of a personal data breach to the supervisory authority',
  source_date: '2018-05-25',
  audit_hash: fwHash('gdpr'),
};

// ---------------------------------------------------------------------------
// 2. UK GDPR + DPA 2018
// ---------------------------------------------------------------------------
export const ukGdpr: ComplianceFramework = {
  id: 'uk_gdpr',
  display_name: 'UK GDPR + Data Protection Act 2018',
  jurisdictions: ['gb-eng', 'gb-sct', 'gb-wls', 'gb-nir'],
  effective_date: '2021-01-01',
  article_registry: {
    articles: [
      { ref: 'Art. 33 UK GDPR', title: 'Personal data breach notification — ICO', topic: 'breach-notification' },
      { ref: 'Art. 17 UK GDPR', title: 'Right to erasure', topic: 'rtbf' },
      { ref: 'DPA 2018 s.170', title: 'Unlawful obtaining of personal data', topic: 'security-safeguards' },
    ],
  },
  source_url: 'https://ico.org.uk/for-organisations/report-a-breach/personal-data-breach/',
  source_title: 'ICO — Personal data breach reporting guidance (UK GDPR)',
  source_date: '2018-05-25',
  audit_hash: fwHash('uk_gdpr'),
};

// ---------------------------------------------------------------------------
// 3. Tanzania DPA 2022
// ---------------------------------------------------------------------------
export const tzDpa2022: ComplianceFramework = {
  id: 'tz_dpa_2022',
  display_name: 'Tanzania Personal Data Protection Act 2022',
  jurisdictions: ['tz'],
  effective_date: '2023-05-01',
  article_registry: {
    articles: [
      { ref: 's.6 TZ DPA', title: 'Lawful basis of processing', topic: 'consent' },
      { ref: 's.27 TZ DPA', title: 'Notification of breach without undue delay', topic: 'breach-notification' },
      { ref: 's.30 TZ DPA', title: 'Right to erasure of personal data', topic: 'rtbf' },
      { ref: 's.36 TZ DPA', title: 'Cross-border transfer restrictions', topic: 'cross-border-transfer' },
    ],
  },
  source_url: 'https://www.clydeco.com/en/insights/2023/02/tanzania-personal-data-protection-act-of-2022',
  source_title: 'Tanzania: The Personal Data Protection Act of 2022 — Clyde & Co Insights',
  source_date: '2023-02-15',
  audit_hash: fwHash('tz_dpa_2022'),
};

// ---------------------------------------------------------------------------
// 4. Kenya DPA 2019
// ---------------------------------------------------------------------------
export const keDpa2019: ComplianceFramework = {
  id: 'ke_dpa_2019',
  display_name: 'Kenya Data Protection Act No. 24 of 2019',
  jurisdictions: ['ke'],
  effective_date: '2019-11-25',
  article_registry: {
    articles: [
      { ref: 's.40 KE DPA', title: 'Right to erasure of false or misleading data', topic: 'rtbf' },
      { ref: 's.43 KE DPA', title: 'Notification of breach within 72 hours', topic: 'breach-notification' },
      { ref: 's.48 KE DPA', title: 'Cross-border transfer of personal data', topic: 'cross-border-transfer' },
    ],
  },
  source_url: 'https://www.kentrade.go.ke/wp-content/uploads/2022/09/Data-Protection-Act-1.pdf',
  source_title: 'Laws of Kenya — Data Protection Act No. 24 of 2019',
  source_date: '2019-11-25',
  audit_hash: fwHash('ke_dpa_2019'),
};

// ---------------------------------------------------------------------------
// 5. Nigeria NDPA 2023
// ---------------------------------------------------------------------------
export const ndpa2023: ComplianceFramework = {
  id: 'ndpa_2023',
  display_name: 'Nigeria Data Protection Act 2023',
  jurisdictions: ['ng'],
  effective_date: '2023-06-12',
  article_registry: {
    articles: [
      { ref: 's.40 NDPA', title: 'Personal data breach notification to NDPC within 72 hours', topic: 'breach-notification' },
      { ref: 's.35 NDPA', title: 'Right to erasure of personal data', topic: 'rtbf' },
      { ref: 's.41 NDPA', title: 'Transfer of personal data outside Nigeria', topic: 'cross-border-transfer' },
    ],
  },
  source_url: 'https://securiti.ai/overview-of-nigeria-data-protection-act/',
  source_title: 'An Overview of Nigeria\'s Data Protection Act 2023 — Securiti',
  source_date: '2023-06-12',
  audit_hash: fwHash('ndpa_2023'),
};

// ---------------------------------------------------------------------------
// 6. POPIA (South Africa)
// ---------------------------------------------------------------------------
export const popia: ComplianceFramework = {
  id: 'popia',
  display_name: 'South Africa Protection of Personal Information Act No. 4 of 2013',
  jurisdictions: ['za'],
  effective_date: '2021-07-01',
  article_registry: {
    articles: [
      { ref: 's.22 POPIA', title: 'Notification of security compromises as soon as reasonably possible', topic: 'breach-notification' },
      { ref: 's.24 POPIA', title: 'Right to erasure of personal information', topic: 'rtbf' },
      { ref: 's.72 POPIA', title: 'Trans-border information flows', topic: 'cross-border-transfer' },
    ],
  },
  source_url: 'https://popia.co.za/',
  source_title: 'POPIA — Protection of Personal Information Act (RSA) — popia.co.za',
  source_date: '2021-07-01',
  audit_hash: fwHash('popia'),
};

// ---------------------------------------------------------------------------
// 7. CCPA (California)
// ---------------------------------------------------------------------------
export const ccpa: ComplianceFramework = {
  id: 'ccpa',
  display_name: 'California Consumer Privacy Act of 2018',
  jurisdictions: ['us-ca'],
  effective_date: '2020-01-01',
  article_registry: {
    articles: [
      { ref: 'Cal. Civ. Code § 1798.82', title: 'Data breach notification', topic: 'breach-notification' },
      { ref: 'Cal. Civ. Code § 1798.105', title: 'Right to deletion of personal information', topic: 'rtbf' },
      { ref: 'Cal. Civ. Code § 1798.135', title: 'Do-not-sell opt-out', topic: 'consent' },
    ],
  },
  source_url: 'https://www.oag.ca.gov/privacy/ccpa',
  source_title: 'California Consumer Privacy Act (CCPA) — California Attorney General',
  source_date: '2020-01-01',
  audit_hash: fwHash('ccpa'),
};

// ---------------------------------------------------------------------------
// 8. CPRA (California Privacy Rights Act, amends CCPA)
// ---------------------------------------------------------------------------
export const cpra: ComplianceFramework = {
  id: 'cpra',
  display_name: 'California Privacy Rights Act of 2020 (amending CCPA)',
  jurisdictions: ['us-ca'],
  effective_date: '2023-01-01',
  article_registry: {
    articles: [
      { ref: 'CPRA § 1798.100', title: 'Consumer right to know what personal information is collected', topic: 'data-subject-rights' },
      { ref: 'CPRA § 1798.121', title: 'Right to limit use of sensitive personal information', topic: 'sensitive-data-handling' },
      { ref: 'CPRA § 1798.140', title: 'Definitions including sensitive personal information', topic: 'sensitive-data-handling' },
    ],
  },
  source_url: 'https://oag.ca.gov/privacy/databreach/reporting',
  source_title: 'Data Security Breach Reporting — California Attorney General',
  source_date: '2026-01-01',
  audit_hash: fwHash('cpra'),
};

// ---------------------------------------------------------------------------
// 9. LGPD (Brazil)
// ---------------------------------------------------------------------------
export const lgpd: ComplianceFramework = {
  id: 'lgpd',
  display_name: 'Brazil Lei Geral de Proteção de Dados (Law 13.709/2018)',
  jurisdictions: ['br'],
  effective_date: '2020-09-18',
  article_registry: {
    articles: [
      { ref: 'Art. 48 LGPD', title: 'Communication of breach within 3 working days', topic: 'breach-notification' },
      { ref: 'Art. 18(VI) LGPD', title: 'Right to deletion of personal data', topic: 'rtbf' },
      { ref: 'Art. 33 LGPD', title: 'International data transfer', topic: 'cross-border-transfer' },
    ],
  },
  source_url: 'https://iapp.org/news/a/anpd-s-regulation-on-security-incidents',
  source_title: 'ANPD\'s Regulation on Security Incidents (Resolution CD/ANPD 15/2024) — IAPP',
  source_date: '2024-04-24',
  audit_hash: fwHash('lgpd'),
};

// ---------------------------------------------------------------------------
// 10. PDPA Singapore
// ---------------------------------------------------------------------------
export const pdpaSg: ComplianceFramework = {
  id: 'pdpa_sg',
  display_name: 'Singapore Personal Data Protection Act 2012 (amended 2020)',
  jurisdictions: ['sg'],
  effective_date: '2021-02-01',
  article_registry: {
    articles: [
      { ref: 'PDPA s.26D', title: 'Notification of notifiable data breach to PDPC within 3 calendar days', topic: 'breach-notification' },
      { ref: 'PDPA s.21', title: 'Access to personal data', topic: 'data-subject-rights' },
      { ref: 'PDPA s.26', title: 'Transfer limitation obligation', topic: 'cross-border-transfer' },
    ],
  },
  source_url: 'https://www.pdpc.gov.sg/report-data-breach',
  source_title: 'Report a Data Breach — PDPC Singapore',
  source_date: '2021-02-01',
  audit_hash: fwHash('pdpa_sg'),
};

// ---------------------------------------------------------------------------
// 11. DPDP India 2023
// ---------------------------------------------------------------------------
export const dpdpIn: ComplianceFramework = {
  id: 'dpdp_in',
  display_name: 'India Digital Personal Data Protection Act 2023 + Rules 2025',
  jurisdictions: ['in'],
  effective_date: '2025-11-13',
  article_registry: {
    articles: [
      { ref: 'DPDP s.8(6)', title: 'Personal data breach notification to Data Protection Board within 72 hours', topic: 'breach-notification' },
      { ref: 'DPDP s.12(3)', title: 'Right to erasure of personal data', topic: 'rtbf' },
      { ref: 'DPDP s.16', title: 'Transfer of personal data outside India', topic: 'cross-border-transfer' },
    ],
  },
  source_url: 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2190655',
  source_title: 'DPDP Rules 2025 Notified — Press Information Bureau (Government of India)',
  source_date: '2025-11-13',
  audit_hash: fwHash('dpdp_in'),
};

// ---------------------------------------------------------------------------
// 12. PIPL (China)
// ---------------------------------------------------------------------------
export const pipl: ComplianceFramework = {
  id: 'pipl',
  display_name: 'China Personal Information Protection Law',
  jurisdictions: ['cn'],
  effective_date: '2021-11-01',
  article_registry: {
    articles: [
      { ref: 'PIPL Art. 57', title: 'Immediate notification of personal information breach', topic: 'breach-notification' },
      { ref: 'PIPL Art. 47', title: 'Right to deletion restricted by national-security exceptions', topic: 'rtbf' },
      { ref: 'PIPL Art. 38', title: 'Cross-border transfer security assessment', topic: 'cross-border-transfer' },
    ],
  },
  source_url: 'https://www.china-briefing.com/doing-business-guide/china/company-establishment/pipl-personal-information-protection-law',
  source_title: 'PIPL — China Personal Information Protection Law Compliance Guide',
  source_date: '2021-11-01',
  audit_hash: fwHash('pipl'),
};

// ---------------------------------------------------------------------------
// 13. KVKK (Türkiye)
// ---------------------------------------------------------------------------
export const kvkk: ComplianceFramework = {
  id: 'kvkk',
  display_name: 'Türkiye Kişisel Verileri Koruma Kanunu (Law No. 6698)',
  jurisdictions: ['tr'],
  effective_date: '2016-04-07',
  article_registry: {
    articles: [
      { ref: 'KVKK Art. 12(5)', title: 'Notification of data breach within 72 hours per Board Decision 2019/10', topic: 'breach-notification' },
      { ref: 'KVKK Art. 7', title: 'Destruction obligation for personal data', topic: 'rtbf' },
      { ref: 'KVKK Art. 9', title: 'Transfer of personal data abroad', topic: 'cross-border-transfer' },
    ],
  },
  source_url: 'https://www.kvkk.gov.tr/Icerik/6601/Obligations-Concerning-Data-Security-',
  source_title: 'Obligations Concerning Data Security — KVKK Türkiye',
  source_date: '2019-01-24',
  audit_hash: fwHash('kvkk'),
};

// ---------------------------------------------------------------------------
// 14. LFPDPPP (Mexico)
// ---------------------------------------------------------------------------
export const lfpdppp: ComplianceFramework = {
  id: 'lfpdppp',
  display_name: 'Mexico Federal Law on Protection of Personal Data Held by Private Parties',
  jurisdictions: ['mx'],
  effective_date: '2025-03-20',
  article_registry: {
    articles: [
      { ref: 'LFPDPPP Art. 64', title: 'Breach notification without undue delay', topic: 'breach-notification' },
      { ref: 'LFPDPPP Art. 32', title: 'ARCO rights (Access, Rectification, Cancellation, Opposition)', topic: 'data-subject-rights' },
      { ref: 'LFPDPPP Art. 36', title: 'International transfers of personal data', topic: 'cross-border-transfer' },
    ],
  },
  source_url: 'https://www.basham.com.mx/mailing/Federal%20LAW.pdf',
  source_title: 'LFPDPPP — Federal Law on Protection of Personal Data Held by Private Parties (Mexico, republished)',
  source_date: '2025-03-20',
  audit_hash: fwHash('lfpdppp'),
};

// ---------------------------------------------------------------------------
// 15. PIPEDA (Canada)
// ---------------------------------------------------------------------------
export const pipeda: ComplianceFramework = {
  id: 'pipeda',
  display_name: 'Canada Personal Information Protection and Electronic Documents Act',
  jurisdictions: ['ca'],
  effective_date: '2018-11-01',
  article_registry: {
    articles: [
      { ref: 'PIPEDA s.10.1', title: 'Report breach of security safeguards as soon as feasible', topic: 'breach-notification' },
      { ref: 'PIPEDA Principle 4.3', title: 'Withdrawal of consent', topic: 'consent' },
      { ref: 'PIPEDA Principle 4.5', title: 'Limiting use, disclosure, and retention', topic: 'retention' },
    ],
  },
  source_url: 'https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/',
  source_title: 'PIPEDA — Office of the Privacy Commissioner of Canada',
  source_date: '2018-11-01',
  audit_hash: fwHash('pipeda'),
};

// ---------------------------------------------------------------------------
// 16. APPI (Japan)
// ---------------------------------------------------------------------------
export const appi: ComplianceFramework = {
  id: 'appi',
  display_name: 'Japan Act on the Protection of Personal Information (APPI, amended 2022)',
  jurisdictions: ['jp'],
  effective_date: '2022-04-01',
  article_registry: {
    articles: [
      { ref: 'APPI Art. 26', title: 'Preliminary breach report promptly (3–5 days)', topic: 'breach-notification' },
      { ref: 'APPI Art. 34', title: 'Right to discontinuance of use of personal information', topic: 'rtbf' },
      { ref: 'APPI Art. 28', title: 'Restriction on cross-border transfer to third party', topic: 'cross-border-transfer' },
    ],
  },
  source_url: 'https://www.japaneselawtranslation.go.jp/en/laws/view/4241/en',
  source_title: 'APPI — Act on the Protection of Personal Information (Japan, English translation)',
  source_date: '2022-04-01',
  audit_hash: fwHash('appi'),
};

// ---------------------------------------------------------------------------
// US sectoral frameworks — HIPAA, FERPA, COPPA
// ---------------------------------------------------------------------------

export const hipaa: ComplianceFramework = {
  id: 'hipaa',
  display_name: 'US Health Insurance Portability and Accountability Act (HIPAA)',
  jurisdictions: ['us-ca', 'us-ny', 'us-tx'],
  effective_date: '2003-04-14',
  article_registry: {
    articles: [
      { ref: '45 CFR §164.404', title: 'Breach notification to individuals within 60 days', topic: 'breach-notification' },
      { ref: '45 CFR §164.530', title: 'Administrative safeguards', topic: 'security-safeguards' },
      { ref: '45 CFR §164.312', title: 'Technical safeguards', topic: 'encryption-at-rest' },
    ],
  },
  source_url: 'https://www.hhs.gov/hipaa/for-professionals/breach-notification/index.html',
  source_title: 'HIPAA Breach Notification Rule — US HHS',
  source_date: '2013-09-23',
  audit_hash: fwHash('hipaa'),
};

export const ferpa: ComplianceFramework = {
  id: 'ferpa',
  display_name: 'US Family Educational Rights and Privacy Act (FERPA)',
  jurisdictions: ['us-ca', 'us-ny', 'us-tx'],
  effective_date: '1974-08-21',
  article_registry: {
    articles: [
      { ref: '20 USC §1232g', title: 'Education records access + amendment + disclosure', topic: 'data-subject-rights' },
      { ref: '34 CFR §99.31', title: 'Disclosure without consent — limited exceptions', topic: 'consent' },
    ],
  },
  source_url: 'https://studentprivacy.ed.gov/ferpa',
  source_title: 'FERPA — US Department of Education Student Privacy Office',
  source_date: '2020-12-15',
  audit_hash: fwHash('ferpa'),
};

export const coppa: ComplianceFramework = {
  id: 'coppa',
  display_name: 'US Children\'s Online Privacy Protection Act (COPPA)',
  jurisdictions: ['us-ca', 'us-ny', 'us-tx'],
  effective_date: '2000-04-21',
  article_registry: {
    articles: [
      { ref: '16 CFR §312.5', title: 'Verifiable parental consent before collecting child personal information', topic: 'consent' },
      { ref: '16 CFR §312.8', title: 'Confidentiality, security, and integrity of children\'s personal information', topic: 'security-safeguards' },
    ],
  },
  source_url: 'https://www.ftc.gov/legal-library/browse/rules/childrens-online-privacy-protection-rule-coppa',
  source_title: 'Children\'s Online Privacy Protection Rule (COPPA) — US Federal Trade Commission',
  source_date: '2013-07-01',
  audit_hash: fwHash('coppa'),
};

// ---------------------------------------------------------------------------
// Full framework seed array
// ---------------------------------------------------------------------------

export const ALL_FRAMEWORKS: ReadonlyArray<ComplianceFramework> = [
  gdpr,
  ukGdpr,
  tzDpa2022,
  keDpa2019,
  ndpa2023,
  popia,
  ccpa,
  cpra,
  lgpd,
  pdpaSg,
  dpdpIn,
  pipl,
  kvkk,
  lfpdppp,
  pipeda,
  appi,
  hipaa,
  ferpa,
  coppa,
];

// ---------------------------------------------------------------------------
// Control mappings — one per major article-to-package implementation
// ---------------------------------------------------------------------------

export const ALL_CONTROL_MAPPINGS: ReadonlyArray<FrameworkControlMapping> = [
  // GDPR
  {
    framework_id: 'gdpr',
    article_ref: 'Art. 33',
    control_kind: 'breach-notification',
    package_name: '@borjie/data-protection',
    impl_pointer: 'packages/data-protection/src/breach-notification/scheduler.ts',
    audit_hash: mapHash('gdpr', 'Art. 33', '@borjie/data-protection'),
  },
  {
    framework_id: 'gdpr',
    article_ref: 'Art. 17',
    control_kind: 'rtbf',
    package_name: '@borjie/data-protection',
    impl_pointer: 'packages/data-protection/src/rtbf/cascade.ts',
    audit_hash: mapHash('gdpr', 'Art. 17', '@borjie/data-protection'),
  },
  {
    framework_id: 'gdpr',
    article_ref: 'Art. 32',
    control_kind: 'encryption-at-rest',
    package_name: '@borjie/data-protection',
    impl_pointer: 'packages/data-protection/src/encryption/key-vault.ts',
    audit_hash: mapHash('gdpr', 'Art. 32', '@borjie/data-protection'),
  },
  {
    framework_id: 'gdpr',
    article_ref: 'Art. 30',
    control_kind: 'audit-trail',
    package_name: '@borjie/audit-hash-chain',
    impl_pointer: 'packages/audit-hash-chain/src/chain.ts',
    audit_hash: mapHash('gdpr', 'Art. 30', '@borjie/audit-hash-chain'),
  },
  // UK GDPR
  {
    framework_id: 'uk_gdpr',
    article_ref: 'Art. 33 UK GDPR',
    control_kind: 'breach-notification',
    package_name: '@borjie/data-protection',
    impl_pointer: 'packages/data-protection/src/breach-notification/scheduler.ts',
    audit_hash: mapHash('uk_gdpr', 'Art. 33 UK GDPR', '@borjie/data-protection'),
  },
  // TZ DPA 2022
  {
    framework_id: 'tz_dpa_2022',
    article_ref: 's.27 TZ DPA',
    control_kind: 'breach-notification',
    package_name: '@borjie/data-protection',
    impl_pointer: 'packages/data-protection/src/breach-notification/scheduler.ts',
    audit_hash: mapHash('tz_dpa_2022', 's.27 TZ DPA', '@borjie/data-protection'),
  },
  {
    framework_id: 'tz_dpa_2022',
    article_ref: 's.30 TZ DPA',
    control_kind: 'rtbf',
    package_name: '@borjie/data-protection',
    impl_pointer: 'packages/data-protection/src/rtbf/cascade.ts',
    audit_hash: mapHash('tz_dpa_2022', 's.30 TZ DPA', '@borjie/data-protection'),
  },
  // KE DPA
  {
    framework_id: 'ke_dpa_2019',
    article_ref: 's.43 KE DPA',
    control_kind: 'breach-notification',
    package_name: '@borjie/data-protection',
    impl_pointer: 'packages/data-protection/src/breach-notification/scheduler.ts',
    audit_hash: mapHash('ke_dpa_2019', 's.43 KE DPA', '@borjie/data-protection'),
  },
  // NDPA NG
  {
    framework_id: 'ndpa_2023',
    article_ref: 's.40 NDPA',
    control_kind: 'breach-notification',
    package_name: '@borjie/data-protection',
    impl_pointer: 'packages/data-protection/src/breach-notification/scheduler.ts',
    audit_hash: mapHash('ndpa_2023', 's.40 NDPA', '@borjie/data-protection'),
  },
  // POPIA ZA
  {
    framework_id: 'popia',
    article_ref: 's.22 POPIA',
    control_kind: 'breach-notification',
    package_name: '@borjie/data-protection',
    impl_pointer: 'packages/data-protection/src/breach-notification/scheduler.ts',
    audit_hash: mapHash('popia', 's.22 POPIA', '@borjie/data-protection'),
  },
  // CCPA + CPRA
  {
    framework_id: 'ccpa',
    article_ref: 'Cal. Civ. Code § 1798.82',
    control_kind: 'breach-notification',
    package_name: '@borjie/data-protection',
    impl_pointer: 'packages/data-protection/src/breach-notification/scheduler.ts',
    audit_hash: mapHash('ccpa', 'Cal. Civ. Code § 1798.82', '@borjie/data-protection'),
  },
  {
    framework_id: 'ccpa',
    article_ref: 'Cal. Civ. Code § 1798.105',
    control_kind: 'rtbf',
    package_name: '@borjie/data-protection',
    impl_pointer: 'packages/data-protection/src/rtbf/cascade.ts',
    audit_hash: mapHash('ccpa', 'Cal. Civ. Code § 1798.105', '@borjie/data-protection'),
  },
  {
    framework_id: 'cpra',
    article_ref: 'CPRA § 1798.121',
    control_kind: 'sensitive-data-handling',
    package_name: '@borjie/data-protection',
    impl_pointer: 'packages/data-protection/src/classification/lattice.ts',
    audit_hash: mapHash('cpra', 'CPRA § 1798.121', '@borjie/data-protection'),
  },
  // LGPD
  {
    framework_id: 'lgpd',
    article_ref: 'Art. 48 LGPD',
    control_kind: 'breach-notification',
    package_name: '@borjie/data-protection',
    impl_pointer: 'packages/data-protection/src/breach-notification/scheduler.ts',
    audit_hash: mapHash('lgpd', 'Art. 48 LGPD', '@borjie/data-protection'),
  },
  // PDPA SG
  {
    framework_id: 'pdpa_sg',
    article_ref: 'PDPA s.26D',
    control_kind: 'breach-notification',
    package_name: '@borjie/data-protection',
    impl_pointer: 'packages/data-protection/src/breach-notification/scheduler.ts',
    audit_hash: mapHash('pdpa_sg', 'PDPA s.26D', '@borjie/data-protection'),
  },
  // DPDP IN
  {
    framework_id: 'dpdp_in',
    article_ref: 'DPDP s.8(6)',
    control_kind: 'breach-notification',
    package_name: '@borjie/data-protection',
    impl_pointer: 'packages/data-protection/src/breach-notification/scheduler.ts',
    audit_hash: mapHash('dpdp_in', 'DPDP s.8(6)', '@borjie/data-protection'),
  },
  // PIPL
  {
    framework_id: 'pipl',
    article_ref: 'PIPL Art. 57',
    control_kind: 'breach-notification',
    package_name: '@borjie/data-protection',
    impl_pointer: 'packages/data-protection/src/breach-notification/scheduler.ts',
    audit_hash: mapHash('pipl', 'PIPL Art. 57', '@borjie/data-protection'),
  },
  {
    framework_id: 'pipl',
    article_ref: 'PIPL Art. 38',
    control_kind: 'cross-border-transfer',
    package_name: '@borjie/data-protection',
    impl_pointer: 'packages/data-protection/src/transfer/cac-assessment.ts',
    audit_hash: mapHash('pipl', 'PIPL Art. 38', '@borjie/data-protection'),
  },
  // KVKK TR
  {
    framework_id: 'kvkk',
    article_ref: 'KVKK Art. 12(5)',
    control_kind: 'breach-notification',
    package_name: '@borjie/data-protection',
    impl_pointer: 'packages/data-protection/src/breach-notification/scheduler.ts',
    audit_hash: mapHash('kvkk', 'KVKK Art. 12(5)', '@borjie/data-protection'),
  },
  // LFPDPPP MX
  {
    framework_id: 'lfpdppp',
    article_ref: 'LFPDPPP Art. 64',
    control_kind: 'breach-notification',
    package_name: '@borjie/data-protection',
    impl_pointer: 'packages/data-protection/src/breach-notification/scheduler.ts',
    audit_hash: mapHash('lfpdppp', 'LFPDPPP Art. 64', '@borjie/data-protection'),
  },
  // PIPEDA CA
  {
    framework_id: 'pipeda',
    article_ref: 'PIPEDA s.10.1',
    control_kind: 'breach-notification',
    package_name: '@borjie/data-protection',
    impl_pointer: 'packages/data-protection/src/breach-notification/scheduler.ts',
    audit_hash: mapHash('pipeda', 'PIPEDA s.10.1', '@borjie/data-protection'),
  },
  // APPI JP
  {
    framework_id: 'appi',
    article_ref: 'APPI Art. 26',
    control_kind: 'breach-notification',
    package_name: '@borjie/data-protection',
    impl_pointer: 'packages/data-protection/src/breach-notification/scheduler.ts',
    audit_hash: mapHash('appi', 'APPI Art. 26', '@borjie/data-protection'),
  },
  // HIPAA US
  {
    framework_id: 'hipaa',
    article_ref: '45 CFR §164.404',
    control_kind: 'breach-notification',
    package_name: '@borjie/data-protection',
    impl_pointer: 'packages/data-protection/src/breach-notification/scheduler.ts',
    audit_hash: mapHash('hipaa', '45 CFR §164.404', '@borjie/data-protection'),
  },
  {
    framework_id: 'hipaa',
    article_ref: '45 CFR §164.312',
    control_kind: 'encryption-at-rest',
    package_name: '@borjie/data-protection',
    impl_pointer: 'packages/data-protection/src/encryption/key-vault.ts',
    audit_hash: mapHash('hipaa', '45 CFR §164.312', '@borjie/data-protection'),
  },
  // FERPA US
  {
    framework_id: 'ferpa',
    article_ref: '20 USC §1232g',
    control_kind: 'data-subject-rights',
    package_name: '@borjie/data-protection',
    impl_pointer: 'packages/data-protection/src/rtbf/cascade.ts',
    audit_hash: mapHash('ferpa', '20 USC §1232g', '@borjie/data-protection'),
  },
  // COPPA US
  {
    framework_id: 'coppa',
    article_ref: '16 CFR §312.5',
    control_kind: 'consent',
    package_name: '@borjie/data-protection',
    impl_pointer: 'packages/data-protection/src/consent/registry.ts',
    audit_hash: mapHash('coppa', '16 CFR §312.5', '@borjie/data-protection'),
  },
];
