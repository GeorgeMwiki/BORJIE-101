/**
 * Uganda Data Protection and Privacy Act, 2019.
 *
 * Regulator: Personal Data Protection Office (PDPO), under the
 * National Information Technology Authority Uganda (NITA-U).
 *
 * Reference: https://www.nita.go.ug/.
 */

import type { ControlCatalog } from '../types.js';

export const ugDpaCatalog: ControlCatalog = {
  frameworkId: 'ug-dpa',
  displayName: 'Uganda Data Protection and Privacy Act, 2019',
  version: '2019',
  jurisdiction: 'UG',
  controls: [
    {
      id: 'UG.S3.Principles',
      name: 'Section 3 — Principles relating to data protection',
      description:
        'Lawfulness, fairness, accountability, purpose specification, ' +
        'minimality, security, integrity, accuracy.',
      jurisdiction: 'UG',
      satisfiedBy: ['Docs/COMPLIANCE/lawful-basis-register.json'],
    },
    {
      id: 'UG.S7.Consent',
      name: 'Section 7 — Consent',
      description:
        'Consent must be obtained prior to collection or processing. ' +
        'Special category data requires explicit consent.',
      jurisdiction: 'UG',
      satisfiedBy: ['Docs/COMPLIANCE/consent-revocation-runbook.md'],
    },
    {
      id: 'UG.S15.NoticeToSubject',
      name: 'Section 15 — Notice to data subject',
      description:
        'Data collector must notify subject of identity, purpose, ' +
        'recipients, retention, rights, and consequences of failure to ' +
        'provide data.',
      jurisdiction: 'UG',
      satisfiedBy: ['apps/portal/src/privacy-notice'],
    },
    {
      id: 'UG.S22.SubjectRights',
      name: 'Section 22 — Rights of data subject',
      description:
        'Right of access, correction, deletion, objection, and ' +
        'prevention of processing for direct marketing.',
      jurisdiction: 'UG',
      satisfiedBy: [
        'packages/compliance-pack/src/dsar',
        'packages/compliance-pack/src/erasure-cascade',
      ],
    },
    {
      id: 'UG.S20.Security',
      name: 'Section 20 — Security of data',
      description:
        'Data collector, processor and controller must secure integrity ' +
        'of personal data through technical and organisational measures.',
      jurisdiction: 'UG',
      satisfiedBy: ['packages/compliance-pack/src/encryption'],
    },
    {
      id: 'UG.S23.BreachNotification',
      name: 'Section 23 — Notification of security breaches (72 hours)',
      description:
        'Data controller must notify the Authority within 72 hours and ' +
        'the data subject without undue delay of any personal data breach.',
      jurisdiction: 'UG',
      satisfiedBy: ['packages/compliance-pack/src/breach'],
    },
    {
      id: 'UG.S19.CrossBorder',
      name: 'Section 19 — Processing data outside Uganda',
      description:
        'Personal data may only be processed outside Uganda where there ' +
        'is proof of adequate measures for the protection of the data.',
      jurisdiction: 'UG',
      satisfiedBy: ['packages/compliance-pack/src/residency'],
    },
    {
      id: 'UG.S29.Registration',
      name: 'Section 29 — Registration of data collectors/processors',
      description:
        'Every data collector, processor, and controller must register ' +
        'with the National Information Technology Authority (NITA-U).',
      jurisdiction: 'UG',
      satisfiedBy: ['Docs/COMPLIANCE/UG-runbook.md'],
    },
  ],
};
