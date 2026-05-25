/**
 * Tanzania Personal Data Protection Act, 2022 (Act No. 11 of 2022).
 *
 * Regulator: Personal Data Protection Commission (PDPC). Established
 * by the Act; operational since 2023.
 *
 * Reference: Docs/COMPLIANCE/TZ_PDPA_2022.md +
 * Docs/COMPLIANCE/PDPA-tz-runbook.md.
 */

import type { ControlCatalog } from '../types.js';

export const tzDpaCatalog: ControlCatalog = {
  frameworkId: 'tz-dpa',
  displayName: 'Tanzania Personal Data Protection Act, 2022 (Act 11 of 2022)',
  version: '2022',
  jurisdiction: 'TZ',
  controls: [
    {
      id: 'TZ.S6.Principles',
      name: 'Section 6 — Principles of personal data processing',
      description:
        'Lawfulness, fairness, transparency, purpose limitation, data ' +
        'minimisation, accuracy, storage limitation, integrity, ' +
        'confidentiality, accountability.',
      jurisdiction: 'TZ',
      satisfiedBy: ['Docs/COMPLIANCE/lawful-basis-register.json', 'packages/compliance-plugins'],
    },
    {
      id: 'TZ.S8.LawfulBasis',
      name: 'Section 8 — Lawful basis for processing',
      description:
        'Processing must rely on consent, contract, legal obligation, ' +
        'vital interest, public interest, or legitimate interest of the ' +
        'data controller.',
      jurisdiction: 'TZ',
      satisfiedBy: ['Docs/COMPLIANCE/lawful-basis-register.json'],
    },
    {
      id: 'TZ.S14.NoticeToSubject',
      name: 'Section 14 — Notice at collection',
      description:
        'Data controller must inform data subject of identity, purposes, ' +
        'categories, recipients, retention, rights, and cross-border ' +
        'transfers at the time of collection.',
      jurisdiction: 'TZ',
      satisfiedBy: ['apps/portal/src/privacy-notice'],
    },
    {
      id: 'TZ.S20.SubjectRights',
      name: 'Section 20 — Rights of data subject',
      description:
        'Right of access, rectification, erasure, restriction, ' +
        'portability, and to object to processing. 30-day response SLA.',
      jurisdiction: 'TZ',
      satisfiedBy: [
        'packages/compliance-pack/src/dsar',
        'packages/compliance-pack/src/erasure-cascade',
      ],
    },
    {
      id: 'TZ.S26.Security',
      name: 'Section 26 — Security of processing',
      description:
        'Data controller must implement appropriate technical and ' +
        'organisational measures, including encryption and access control.',
      jurisdiction: 'TZ',
      satisfiedBy: ['packages/compliance-pack/src/encryption', 'packages/authz-policy'],
    },
    {
      id: 'TZ.S28.BreachNotification',
      name: 'Section 28 — Breach notification (72 hours)',
      description:
        'Data controller must notify the PDPC within 72 hours of becoming ' +
        'aware of a personal data breach. Affected subjects must be ' +
        'notified without undue delay where high risk.',
      jurisdiction: 'TZ',
      satisfiedBy: ['packages/compliance-pack/src/breach'],
    },
    {
      id: 'TZ.S32.CrossBorder',
      name: 'Section 32 — Cross-border transfers',
      description:
        'Transfer of personal data outside Tanzania permitted only to ' +
        'jurisdictions with adequate protection or with explicit consent / ' +
        'standard contractual clauses approved by the PDPC.',
      jurisdiction: 'TZ',
      satisfiedBy: ['packages/compliance-pack/src/residency'],
    },
    {
      id: 'TZ.S34.DPO',
      name: 'Section 34 — Data Protection Officer requirement',
      description:
        'Data controllers processing personal data above prescribed ' +
        'thresholds must designate a DPO.',
      jurisdiction: 'TZ',
      satisfiedBy: ['hr/dpo-appointment-letter'],
    },
    {
      id: 'TZ.S38.Registration',
      name: 'Section 38 — Registration with PDPC',
      description:
        'Data controllers and processors must register with the PDPC and ' +
        'renew annually. Operating without registration is an offence.',
      jurisdiction: 'TZ',
      satisfiedBy: ['Docs/COMPLIANCE/PDPA-tz-runbook.md'],
    },
    {
      id: 'TZ.S45.FinancialRetention',
      name: 'Income Tax Act § 80 — 7-year financial records retention',
      description:
        'Financial records subject to tax-law retention CANNOT be erased ' +
        'on DSAR for 7 years; pseudonymisation or legal-hold required.',
      jurisdiction: 'TZ',
      satisfiedBy: ['packages/compliance-pack/src/erasure-cascade'],
    },
  ],
};
