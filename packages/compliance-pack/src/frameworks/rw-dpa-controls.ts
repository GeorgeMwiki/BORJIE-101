/**
 * Rwanda Law No. 058/2021 of 13/10/2021 relating to the protection
 * of personal data and privacy.
 *
 * Regulator: National Cyber Security Authority (NCSA) data protection
 * supervisory function.
 *
 * Reference: official text published in Official Gazette No. Special
 * of 15/10/2021.
 */

import type { ControlCatalog } from '../types.js';

export const rwDpaCatalog: ControlCatalog = {
  frameworkId: 'rw-dpa',
  displayName: 'Rwanda Data Protection and Privacy Law 058/2021',
  version: '2021',
  jurisdiction: 'RW',
  controls: [
    {
      id: 'RW.Art.5.Principles',
      name: 'Article 5 — Principles of personal data processing',
      description:
        'Lawful, fair, transparent processing; purpose limitation; ' +
        'data minimisation; accuracy; storage limitation; integrity and ' +
        'confidentiality.',
      jurisdiction: 'RW',
      satisfiedBy: ['Docs/COMPLIANCE/lawful-basis-register.json'],
    },
    {
      id: 'RW.Art.7.Consent',
      name: 'Article 7 — Conditions for consent',
      description:
        'Consent must be a freely given, specific, informed, and ' +
        'unambiguous indication. Withdrawable at any time.',
      jurisdiction: 'RW',
      satisfiedBy: ['Docs/COMPLIANCE/consent-revocation-runbook.md'],
    },
    {
      id: 'RW.Art.17.Notice',
      name: 'Article 17 — Information provided to the data subject',
      description:
        'Data controller must inform subject of identity, purposes, ' +
        'legal basis, recipients, retention period, and rights.',
      jurisdiction: 'RW',
      satisfiedBy: ['apps/portal/src/privacy-notice'],
    },
    {
      id: 'RW.Art.20.AccessRight',
      name: 'Article 20 — Right of access',
      description:
        'Data subject has the right to obtain confirmation of processing ' +
        'and a copy of personal data being processed.',
      jurisdiction: 'RW',
      satisfiedBy: ['packages/compliance-pack/src/dsar'],
    },
    {
      id: 'RW.Art.22.Erasure',
      name: 'Article 22 — Right to erasure',
      description:
        'Data subject has the right to obtain erasure of personal data ' +
        'without undue delay where listed grounds apply.',
      jurisdiction: 'RW',
      satisfiedBy: ['packages/compliance-pack/src/erasure-cascade'],
    },
    {
      id: 'RW.Art.34.Security',
      name: 'Article 34 — Security of processing',
      description:
        'Data controller and processor must implement appropriate ' +
        'technical and organisational measures, including pseudonymisation ' +
        'and encryption.',
      jurisdiction: 'RW',
      satisfiedBy: ['packages/compliance-pack/src/encryption'],
    },
    {
      id: 'RW.Art.36.BreachNotification',
      name: 'Article 36 — Notification of personal data breach (48 hours)',
      description:
        'Data controller must notify the supervisory authority within ' +
        '48 hours of becoming aware. Subjects must be notified without ' +
        'undue delay where breach is likely to result in high risk.',
      jurisdiction: 'RW',
      satisfiedBy: ['packages/compliance-pack/src/breach'],
    },
    {
      id: 'RW.Art.48.CrossBorder',
      name: 'Article 48 — Transfer of data outside Rwanda',
      description:
        'Transfer outside Rwanda requires adequate level of protection, ' +
        'BCRs, contractual safeguards, or explicit consent.',
      jurisdiction: 'RW',
      satisfiedBy: ['packages/compliance-pack/src/residency'],
    },
    {
      id: 'RW.Art.50.Registration',
      name: 'Article 50 — Registration of data controller / processor',
      description:
        'Data controllers and processors must register with the ' +
        'supervisory authority before commencing processing.',
      jurisdiction: 'RW',
      satisfiedBy: ['Docs/COMPLIANCE/RW-runbook.md'],
    },
  ],
};
